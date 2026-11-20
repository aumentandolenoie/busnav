#!/usr/bin/env python3
"""Replace the route catalog with the GPX of the OneDrive folder "Mappe Busitalia Veneto".

Usage: python3 scripts/import_mappe.py OneDrive_YYYY-MM-DD.zip

Writes official-routes.json (all routes, ids 0..N-1 in a stable order),
an empty academy-supplemental-routes.json and academy-evidence.json. Route
evidence (destination indicators and winter shifts) is matched again against
the indicator records and shift legs already extracted from the Academy PDFs,
which are kept in academy-evidence.json. The coordinates of every GPX are
stored as read (rounded to 1e-6°, consecutive duplicates removed).
"""
import argparse, collections, difflib, hashlib, json, pathlib, re, sys, unicodedata, zipfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from import_academy_evidence import route_title, code as indicator_code  # noqa: E402

CATEGORY_ORDER = ['Extraurbano', 'Colli', 'Urbano', 'Navette Concerti', 'Padova Marathon']
FOLDERS = {'Linee Extraurbane': 'Extraurbano', 'Linee Colli': 'Colli', 'Linee Urbane': 'Urbano',
           'Navette Concerti': 'Navette Concerti', 'Padova Marathon': 'Padova Marathon'}
TAGS = re.compile(r'\s*[\[(](?:DEV(?:\.|IAZIONE)?\s*MERCAT(?:O|ALE)|MERCATALE)[\])]\s*', re.I)
DAYS = {'LUNEDI': 'Lunedì', 'MARTEDI': 'Martedì', 'MERCOLEDI': 'Mercoledì', 'GIOVEDI': 'Giovedì',
        'VENERDI': 'Venerdì', 'SABATO': 'Sabato', 'DOMENICA': 'Domenica'}


def ascii_upper(value):
    return unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().upper()


def points_of(raw):
    root = ET.fromstring(raw)
    if root.tag.rsplit('}', 1)[-1] != 'gpx':
        raise ValueError('not a GPX document')
    tracks = [p for p in root.iter() if p.tag.rsplit('}', 1)[-1] == 'trkpt']
    source = tracks or [p for p in root.iter() if p.tag.rsplit('}', 1)[-1] == 'rtept']
    out = []
    for p in source:
        q = [round(float(p.attrib['lat']), 6), round(float(p.attrib['lon']), 6)]
        if not out or out[-1] != q:
            out.append(q)
    if len(out) < 2:
        raise ValueError('fewer than two points')
    return out


def split_code(stem):
    """'1026 _ Cavarzere - Padova' → ('1026', None, 'Cavarzere - Padova').

    Colli files also carry the line: '[TLB] TL _ Luvignano…' and
    'AB - [A] Monteortone…' give the indicator code and the line letter."""
    stem = re.sub(r'\s+', ' ', TAGS.sub(' ', stem)).strip()
    stem = re.sub(r'\s*[\[(]DIRETTA[\])]', ' (diretta)', stem, flags=re.I)
    # File names cannot hold every apostrophe: "Ca_ Bianca", "Vo_" → "Ca’ Bianca", "Vo’".
    stem = re.sub(r'(?<=[A-Za-zà-üÀ-Ü])_(?=\s|$|\))', '’', stem)
    stem = re.sub(r'^[\s_-]+', '', stem)
    m = re.match(r'^\[([^\]]+)\]\s*([A-Z]{1,4})\s*_\s*(.+)$', stem)
    if m:
        return m.group(1).strip(), m.group(2), m.group(3).strip()
    m = re.match(r'^([A-Z]{1,4})\s*-\s*\[([A-Z]{1,4})\]\s*(.+)$', stem)
    if m:
        return m.group(1), m.group(2), m.group(3).strip()
    m = re.match(r'^\[([^\]]+)\]\s*(.+)$', stem)
    if m:
        return m.group(1).strip(), None, m.group(2).strip()
    m = re.match(r'^(\d{1,4}[A-Z]{0,3}|[A-Z]{1,4}\d{0,2}[A-Z]?)\s*[_-]\s*(.+)$', stem)
    if m and not re.fullmatch(r'POMERIGGIO|SERA|MATTINA', m.group(1)):
        return m.group(1), None, m.group(2).strip()
    return '', None, stem


def describe(path):
    """Category, line, variant, display name and market day for one GPX path."""
    parts = path.split('/')
    top = next((i for i, p in enumerate(parts) if p in FOLDERS), None)
    if top is None:
        raise ValueError('unknown folder')
    category = FOLDERS[parts[top]]
    folders = parts[top + 1:-1]
    stem = re.sub(r'(?i)\.gpx$', '', parts[-1]).strip()
    variant, line_code, title = split_code(stem)
    title = re.sub(r'(?<=[^\W_])_(?=[^\W_])', '/', title)  # "Scalcerle_Natta" → "Scalcerle/Natta"
    day = place = ''
    if category == 'Extraurbano':
        if folders and ascii_upper(folders[0]).startswith('DEVIAZIONI MERCATALI'):
            line = 'Deviazioni mercatali'
            day = DAYS.get(ascii_upper(folders[1]).strip(), folders[1].title()) if len(folders) > 1 else ''
            place = folders[2].strip() if len(folders) > 2 else ''
        else:
            m = re.fullmatch(r'E0*(\d+)', folders[0] if folders else '')
            if not m:
                raise ValueError('extra-urban GPX outside a line folder')
            line = m.group(1)
    elif category == 'Urbano':
        folder = folders[0] if folders else ''
        m = re.match(r'U0*(\d+)', folder)
        line = m.group(1) if m else re.sub(r'\s*\(.*\)$', '', folder).strip()
        if 'FESTIVO' in folder.upper():
            line += ' festivo'
    elif category == 'Colli':
        line = line_code or (variant if re.fullmatch(r'[A-Z]{1,4}', variant) else 'Colli')
    elif category == 'Navette Concerti':
        folder = folders[0] if folders else ''
        m = re.match(r'\[([^\]]+)\]\s*(.*)', folder)
        line = (m.group(1).title() + ' · ' + m.group(2)) if m else folder
        variant, title = '', stem
    else:
        line = 'Padova Marathon'
    shown = line_code or variant
    name = (shown + ' | ' + title) if shown else title
    return {'category': category, 'line': line, 'variant': variant, 'name': name,
            'filename': stem, 'marketDay': day, 'marketPlace': place}


def point_key(points):
    return hashlib.sha256(json.dumps(points, separators=(',', ':')).encode()).hexdigest()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('zip', type=pathlib.Path)
    parser.add_argument('--report', type=pathlib.Path, default=ROOT / 'reports' / 'gpx-import.json')
    args = parser.parse_args()
    old_catalog = json.loads((ROOT / 'official-routes.json').read_text())
    supplemental_path = ROOT / 'academy-supplemental-routes.json'
    if supplemental_path.exists():
        old_catalog += json.loads(supplemental_path.read_text())
    old_evidence = json.loads((ROOT / 'academy-evidence.json').read_text())
    old_geometry = {point_key(r['points']): r for r in old_catalog}

    routes, problems = [], []
    with zipfile.ZipFile(args.zip) as archive:
        for item in sorted(archive.infolist(), key=lambda i: i.filename):
            if item.is_dir() or not item.filename.lower().endswith('.gpx'):
                continue
            try:
                info = describe(item.filename)
                info['points'] = points_of(archive.read(item))
            except (ValueError, ET.ParseError) as error:
                problems.append({'path': item.filename, 'error': str(error)})
                continue
            info['sourcePath'] = item.filename
            routes.append(info)
    if not routes or problems:
        raise SystemExit('Import stopped: ' + json.dumps(problems, ensure_ascii=False, indent=1))

    rank = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    natural = lambda s: [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]
    routes.sort(key=lambda r: (rank.get(r['category'], 99), natural(r['line']), natural(r['name']), r['sourcePath']))

    # Files with the same ordered coordinates in the same line: one choice in
    # the picker (the same GPX may also be filed under another line folder).
    first_by_geometry, duplicates = {}, {}
    for index, route in enumerate(routes):
        key = (route['category'], route['line'], point_key(route['points']))
        if key in first_by_geometry:
            duplicates[str(index)] = first_by_geometry[key]
        else:
            first_by_geometry[key] = index

    by_code = collections.defaultdict(list)
    for record in old_evidence['indicators']:
        by_code[record['code']].append(record)
    legs = old_evidence['shiftLegs']
    normalized_legs = [(leg, route_title(leg['description'])) for leg in legs if leg['description']]

    catalog, evidence_routes, report_rows = [], {}, []
    for index, route in enumerate(routes):
        record = {'id': index, 'category': route['category'], 'line': route['line'], 'variant': route['variant'],
                  'name': route['name'], 'filename': route['filename'], 'points': route['points']}
        catalog.append(record)
        domain = 'urban' if route['category'] == 'Urbano' else 'colli' if route['category'] == 'Colli' else 'extra'
        candidates = [indicator_code(route['variant'])] if route['variant'] else []
        if route['category'] in ('Navette Concerti', 'Padova Marathon'):
            candidates = []
        records = [r for c in dict.fromkeys(candidates) for r in by_code[c]
                   if r['kind'] == domain or (domain == 'colli' and c.isdigit() and r['kind'] == 'extra')]
        conflicting = any(r['outOfService'] for r in records) and any(not r['outOfService'] for r in records)
        inactive = bool(records) and any(r['outOfService'] for r in records) and not conflicting
        title = route_title(route['name'], strip_code=True)
        scored = []
        if len(title) > 5 and route['category'] in ('Extraurbano', 'Colli', 'Urbano'):
            for leg, description in normalized_legs:
                matcher = difflib.SequenceMatcher(None, title, description)
                if matcher.real_quick_ratio() < .90 or matcher.quick_ratio() < .90:
                    continue
                score = matcher.ratio()
                if score >= .90:
                    scored.append({**leg, 'descriptionScore': round(score, 4)})
        scored.sort(key=lambda x: -x['descriptionScore'])
        aliases = sorted({r['line'] for r in records if r.get('line') and re.fullmatch(r'[A-Z]*\d*[A-Z]*', r['line'])})
        aliases += sorted({l['line'] for l in scored if l['descriptionScore'] >= .97 and l['line'] and l['type'] not in ('Trasf.', 'Diretta')})
        evidence = {'sourcePaths': [route['sourcePath']], 'indicatorRecords': records,
                    'serviceStatus': 'out-of-service' if inactive else 'conflicting-indicator' if conflicting else 'passenger-or-unspecified',
                    'lineAliases': sorted(set(aliases)), 'shiftMatches': scored[:16]}
        if route['marketDay']:
            evidence['marketDay'] = route['marketDay']
            evidence['marketPlace'] = route['marketPlace']
        if str(index) in duplicates:
            evidence['sameGeometryAs'] = duplicates[str(index)]
        evidence_routes[str(index)] = evidence
        old = old_geometry.get(point_key(route['points']))
        report_rows.append({'id': index, 'path': route['sourcePath'], 'category': route['category'], 'line': route['line'],
                            'name': route['name'], 'sameAsPrevious': old['name'] if old else None})

    # A market-day detour without its own evidence takes the lines of the other
    # detours in the same folder (same day and town), e.g. Noventa P. → E073.
    folder_lines = collections.defaultdict(set)
    for index, route in enumerate(routes):
        if route['marketDay']:
            folder_lines[(route['marketDay'], route['marketPlace'])].update(evidence_routes[str(index)]['lineAliases'])
    for index, route in enumerate(routes):
        evidence = evidence_routes[str(index)]
        if route['marketDay'] and not evidence['lineAliases'] and folder_lines[(route['marketDay'], route['marketPlace'])]:
            evidence['lineAliases'] = sorted(folder_lines[(route['marketDay'], route['marketPlace'])])
            evidence['lineAliasesFrom'] = 'market-folder'
    categories = collections.Counter(r['category'] for r in catalog)
    official = json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + '\n'
    out = {'version': 2, 'source': 'Mappe Busitalia Veneto (OneDrive)', 'sourceZipSHA256': sha(args.zip.read_bytes()),
           'originalCatalogSHA256': sha(official.encode()),
           'catalog': {'original': len(catalog), 'supplemental': 0, 'total': len(catalog),
                       'categories': {c: categories[c] for c in CATEGORY_ORDER if categories[c]},
                       'duplicates': len(duplicates)},
           'documents': old_evidence['documents'], 'indicators': old_evidence['indicators'],
           'shiftLegs': legs, 'routes': evidence_routes}
    (ROOT / 'official-routes.json').write_text(official)
    supplemental_path.write_text('[]\n')
    (ROOT / 'academy-evidence.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n')
    # Previous routes: same coordinates, same title with new coordinates, or gone.
    titles = {(r['category'], route_title(r['name'], strip_code=True)) for r in catalog}
    new_geometry = {key[-1] for key in first_by_geometry}
    previous = {'identical': 0, 'updated': 0, 'removed': []}
    for r in old_catalog:
        if point_key(r['points']) in new_geometry:
            previous['identical'] += 1
        elif (r['category'], route_title(r['name'], strip_code=True)) in titles:
            previous['updated'] += 1
        else:
            previous['removed'].append({'category': r['category'], 'line': r['line'].strip(), 'name': r['name']})
    args.report.parent.mkdir(exist_ok=True)
    args.report.write_text(json.dumps({'catalog': out['catalog'], 'previousCatalog': previous, 'routes': report_rows},
                                      ensure_ascii=False, indent=1) + '\n')
    print('catalog', out['catalog'])
    print('previous catalog: identical', previous['identical'], '· updated', previous['updated'], '· removed', len(previous['removed']))


if __name__ == '__main__':
    main()
