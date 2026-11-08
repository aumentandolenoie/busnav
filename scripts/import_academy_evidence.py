#!/usr/bin/env python3
"""Read Academy source files by CONTENT, including GPX without a .gpx suffix.

Derive page-attributed service metadata. Do not invent stops from destination
names and do not alter any coordinate in official-routes.json.
"""
import argparse,collections,difflib,hashlib,io,json,pathlib,re,unicodedata,zipfile
import xml.etree.ElementTree as ET
import pdfplumber
ROOT=pathlib.Path(__file__).resolve().parent.parent

def norm(value):
    value=unicodedata.normalize('NFKD',str(value or '')).encode('ascii','ignore').decode().upper()
    return re.sub(r'[^A-Z0-9]+',' ',value).strip()

def route_title(value,strip_code=False):
    value=re.sub(r'(?<=[a-zà-ü])(?=[A-ZÀ-Ü])',' ',value)
    if strip_code:
        value=re.sub(r'^\s*\d+\s*[|_-]?\s*','',value)
        value=re.sub(r'^\s*[A-Z]{1,3}\d?[A-Z]*\s*[|_-]\s*','',value)
    value=norm(re.sub(r'(?i)\.gpx','',value))
    for pattern,replacement in [
        (r'\bPADO VA\b','PADOVA'),(r'\bPIOVE (?:DI SACCO|S)\b','PIOVE SACCO'),
        (r'\bS ANGELO\b','SANT ANGELO'),(r'\bNOV(?:ENTA)? (?:P|PADOVANA)\b','NOVENTA PADOVANA'),
        (r'\bPONTE DI BRENTA\b','PONTE BRENTA'),(r'\b(?:DA|A)\b','')]:
        value=re.sub(pattern,replacement,value)
    return clean(value)

def clean(value):return re.sub(r'\s+',' ',str(value or '')).strip()
def code(value):return re.sub(r'\s+','',str(value or '')).upper().lstrip('0') or '0'
def point_key(points):
    # Existing catalog rounds to six decimals and drops consecutive duplicates.
    normalized=[]
    for a,b in points:
        p=[round(float(a),6),round(float(b),6)]
        if not normalized or normalized[-1]!=p:normalized.append(p)
    return hashlib.sha256(json.dumps(normalized,separators=(',',':')).encode()).hexdigest()
def sha(data):return hashlib.sha256(data).hexdigest()

def read_indicators(pdf,source,kind):
    records=[]
    for page_number,page in enumerate(pdf.pages,1):
        for table in page.extract_tables():
            current=None
            for row in table:
                cells=[clean(x) for x in row]
                if not any(cells):continue
                identifier=cells[0]
                if not re.fullmatch(r'[A-Za-z0-9]+',identifier or '') or identifier.lower() in ('codice','numero','stringhe'):continue
                # Some wrapped rows are split by the PDF drawing grid.
                if kind=='extra' and len(cells)>=3:
                    record={'code':code(identifier),'display':identifier,'fixed':cells[1],'scrolling':cells[2]}
                elif len(cells)>=4:
                    record={'code':code(identifier),'display':identifier,'line':cells[1],'fixed':cells[2],'scrolling':cells[3]}
                else:continue
                if not record['fixed'] and not record['scrolling']:continue
                record.update(document=source,page=page_number,kind=kind)
                record['outOfService']='FUORI SERVIZIO' in norm(record['fixed']+' '+record['scrolling'])
                records.append(record)
    return records

def read_shifts(pdf,source,day):
    legs=[]
    for page_number,page in enumerate(pdf.pages,1):
        text=page.extract_text() or ''
        validity=re.search(r'TURNI VALIDI DAL\s+(\d{2}/\d{2}/\d{4})',text)
        tables=page.find_tables()
        for table in tables:
            rows=table.extract()
            if not rows or not any('Partenza' in str(c) for c in rows[0]):continue
            before=page.crop((0,0,page.width,max(1,table.bbox[1]))).extract_text() or ''
            shifts=re.findall(r'\b([A-Z]{1,3}\d{3})\s*-\s*([A-ZÀ-Ü ]+)',before)
            shift=shifts[-1][0] if shifts else None
            current=None
            for row in rows[1:]:
                cells=[clean(x) for x in row]
                if len(cells)<7:continue
                if re.fullmatch(r'\d{2}:\d{2}',cells[0]):
                    if current:legs.append(current)
                    current={'departure':cells[0],'arrival':cells[1],'description':cells[2],'vehicleDuty':cells[3],
                             'note':cells[4],'line':cells[5],'type':cells[6],'shift':shift,'day':day,
                             'validFrom':validity.group(1) if validity else None,'document':source,'page':page_number}
                elif current and not cells[0] and not cells[1]:
                    for key,index in [('description',2),('vehicleDuty',3),('note',4),('line',5),('type',6)]:
                        if cells[index]:current[key]=clean(current[key]+' '+cells[index])
            if current:legs.append(current)
    for leg in legs:
        leg['line']=re.sub(r'[\s-]+','',leg['line']).upper()
    return legs

def main():
    parser=argparse.ArgumentParser();parser.add_argument('zip',type=pathlib.Path);parser.add_argument('--reuse-extraction',action='store_true');args=parser.parse_args()
    original=(ROOT/'official-routes.json').read_bytes();catalog=json.loads(original)
    geometries=collections.defaultdict(list)
    for route in catalog:geometries[point_key(route['points'])].append(route['id'])
    documents=[];indicators=[];legs=[];supplements=[];source_paths=collections.defaultdict(list)
    if args.reuse_extraction:
        cached=json.loads((ROOT/'academy-evidence.json').read_text());assert cached['sourceZipSHA256']==sha(args.zip.read_bytes())
        documents=cached['documents'];indicators=cached['indicators'];legs=cached['shiftLegs']
    with zipfile.ZipFile(args.zip) as archive:
        for item in archive.infolist():
            if item.is_dir() or item.file_size==0:continue
            raw=archive.read(item)
            if raw.lstrip().startswith(b'<?xml') or raw.lstrip().startswith(b'<gpx'):
                root=ET.fromstring(raw)
                if root.tag.rsplit('}',1)[-1]!='gpx':continue
                points=[[float(p.attrib['lat']),float(p.attrib['lon'])] for p in root.iter() if p.tag.rsplit('}',1)[-1] in ('trkpt','rtept')]
                if len(points)<2:continue
                ids=geometries[point_key(points)]
                if not ids:
                    line=re.search(r'/E(\d+)/',item.filename)
                    name=item.filename.split('/')[-1];prefix=re.match(r'(\d+)\s*',name)
                    new={'id':len(catalog)+len(supplements),'category':'Extraurbano','line':str(int(line.group(1))) if line else 'Altri',
                         'variant':prefix.group(1) if prefix else '', 'name':name,'filename':name,'points':points}
                    supplements.append(new);ids=[new['id']];geometries[point_key(points)]=ids
                for id in ids:source_paths[str(id)].append(item.filename)
            elif item.filename.lower().endswith('.pdf') and not args.reuse_extraction:
                kind='shifts' if 'Turni Invernale' in item.filename else 'indicators'
                documents.append({'name':item.filename,'sha256':sha(raw),'bytes':len(raw),'kind':kind})
                with pdfplumber.open(io.BytesIO(raw)) as pdf:
                    documents[-1]['pages']=len(pdf.pages)
                    if kind=='shifts':
                        day='weekday' if 'FERIALE' in item.filename else 'saturday' if 'SABATO' in item.filename else 'holiday'
                        legs.extend(read_shifts(pdf,item.filename,day))
                    else:
                        domain='colli' if 'Colli' in item.filename else 'urban' if 'Urbane.pdf' in item.filename else 'extra'
                        indicators.extend(read_indicators(pdf,item.filename,domain))
    assert len(catalog)==787 and len(supplements)==2, 'Unexpected source catalog: review before publishing'
    by_code=collections.defaultdict(list)
    for record in indicators:by_code[record['code']].append(record)
    normalized_legs=[(leg,route_title(leg['description'])) for leg in legs if leg['description']]
    routes={}
    for route in catalog+supplements:
        prefix=re.match(r'^(F0|\d+|[A-Z]{1,4})\b',route['name'].upper())
        candidates=[code(route['variant'])] if route['variant'] else []
        if prefix:candidates.insert(0,code(prefix.group(1)))
        if re.match(r'^999',route['name']):candidates.insert(0,'999')
        domain='urban' if route['category']=='Urbano' else 'colli' if route['category']=='Colli' else 'extra'
        records=[r for c in dict.fromkeys(candidates) for r in by_code[c] if (r['kind']==domain or (domain=='colli' and c.isdigit() and r['kind']=='extra'))]
        conflicting=any(r['outOfService'] for r in records) and any(not r['outOfService'] for r in records)
        inactive=bool(records) and any(r['outOfService'] for r in records) and not conflicting
        title=route_title(route['name'],strip_code=True)
        scored=[]
        if len(title)>5:
            for leg,description in normalized_legs:
                matcher=difflib.SequenceMatcher(None,title,description)
                if matcher.real_quick_ratio()<.90 or matcher.quick_ratio()<.90:continue
                score=matcher.ratio()
                if score>=.90:scored.append({**leg,'descriptionScore':round(score,4)})
        scored.sort(key=lambda x:-x['descriptionScore'])
        aliases=sorted({r['line'] for r in records if r.get('line') and re.fullmatch(r'[A-Z]*\d*[A-Z]*',r['line'])})
        aliases+=sorted({l['line'] for l in scored if l['descriptionScore']>=.97 and l['line'] and l['type'] not in ('Trasf.','Diretta')})
        routes[str(route['id'])]={'sourcePaths':source_paths[str(route['id'])],'indicatorRecords':records,
             'serviceStatus':'out-of-service' if inactive else 'conflicting-indicator' if conflicting else 'passenger-or-unspecified',
             'lineAliases':sorted(set(aliases)),'shiftMatches':scored[:16]}
    out={'version':1,'sourceZipSHA256':sha(args.zip.read_bytes()),'originalCatalogSHA256':sha(original),
         'catalog':{'original':len(catalog),'supplemental':len(supplements),'total':len(catalog+supplements),
                    'categories':dict(collections.Counter(r['category'] for r in catalog+supplements))},
         'documents':documents,'indicators':indicators,'shiftLegs':legs,'routes':routes}
    (ROOT/'academy-evidence.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
    (ROOT/'academy-supplemental-routes.json').write_text(json.dumps(supplements,ensure_ascii=False,separators=(',',':'))+'\n')
    assert (ROOT/'official-routes.json').read_bytes()==original
    print('catalog',out['catalog'],'indicators',len(indicators),'shift legs',len(legs),'out-of-service',sum(r['serviceStatus']=='out-of-service' for r in routes.values()))

if __name__=='__main__':main()
