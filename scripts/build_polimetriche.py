#!/usr/bin/env python3
"""Build fares/polimetriche-padova.json from the Busitalia PDFs.

Inputs (not stored in the repo):
  Polimetriche_Padova_2410.pdf  63 pages, text layer. Page 1 = rules,
                                pages 2-63 = one lower-triangular class matrix per line.
  Prezziario_Biglietti.pdf      scanned; on-board prices typed in PRICES below.
  GTFS Busitalia pattern snapshot (tests/fixtures) only to place fare nodes on the map.

Matrix rows and columns are keyed by the stop NUMBER printed in the PDF; the
numbering can have gaps (e.g. E031 has no stop 2) and a few cells point to a
column without a row: those cells are dropped because no stop can be picked.

Usage: build_polimetriche.py POLIMETRICHE.pdf GTFS_PATTERNS.zip OUT.json
"""
import csv, io, json, math, re, sys, unicodedata, zipfile, collections

# Prezziario Busitalia Veneto, bacino di Padova: "Biglietto a bordo" column.
# Padova–Tessera and Montegrotto/Abano–Tessera use the newer amounts of
# Comunicazione n.478 del 27.08.2024 and of the polimetrica (agg. 10/2024),
# not the older 10,00 / 13,00 still printed in the price table.
CLASS_PRICES = {1: '2,50', 2: '3,50', 3: '4,00', 4: '4,50', 5: '5,50', 6: '6,00', 7: '7,00',
                8: '7,50', 9: '8,50', 10: '9,00', 11: '10,00', 12: '10,50', 13: '11,50'}
LABELS = {f'C{k}': f'Classe {k} = € {v} a bordo' for k, v in CLASS_PRICES.items()}
LABELS.update({
    'TU1': 'TU1 = € 2,50 a bordo',
    'TU2': 'TU2 = € 3,00 a bordo',
    'PD-TESSERA': 'Tariffa turistica = € 13,00 a bordo (bambini fino a 11 anni € 6,50)',
    'ABANO-TESSERA': 'Tariffa turistica = € 15,00 a bordo (bambini fino a 11 anni € 7,50)',
    '': 'Classe non indicata nella polimetrica di questa linea',
})

# Fare nodes whose municipality is certain: Padova (TU1) and the other 12
# municipalities of the Conurbazione (TU2), as listed on page 1 of the PDF.
CONURBAZIONE = {
 'PADOVA': 'Padova',
 'ABANO HOTEL EUROPA': 'Abano Terme', 'ABANO ISTITUTI': 'Abano Terme', 'ABANO MUNICIPIO': 'Abano Terme', 'ABANO TERME FS': 'Abano Terme',
 'ALBIGNASEGO CENTRO': 'Albignasego', "CARPANEDO D'ALB.": 'Albignasego', 'MANDRIOLA': 'Albignasego',
 'LIMENA MUNICIPIO': 'Limena', 'LIMENA Z.I. ZILMET': 'Limena',
 'NOVENTA PADOVANA': 'Noventa Padovana',
 "PONTE SAN NICOLO'": 'Ponte San Nicolò', 'RONCAGLIA': 'Ponte San Nicolò',
 'RUBANO MUNICIPIO': 'Rubano', 'BOSCO DI RUBANO': 'Rubano', 'SARMEOLA': 'Rubano', 'VILLAGUATTERA': 'Rubano',
 'SAONARA': 'Saonara',
 'SELVAZZANO': 'Selvazzano Dentro', 'CASELLE SELV.': 'Selvazzano Dentro', 'CHIESETTA SELV.': 'Selvazzano Dentro', 'TENCAROLA': 'Selvazzano Dentro',
 'VIGODARZERE CHIESA': 'Vigodarzere', 'SALETTO DI VIGOD.': 'Vigodarzere',
 'VIGONZA': 'Vigonza', 'VIGONZA V. GRANDI': 'Vigonza', 'BUSA DI VIGONZA': 'Vigonza', 'PERAGA CACCIANE': 'Vigonza',
 'CODIVERNO': 'Vigonza', 'PIONCA': 'Vigonza', 'PERAROLO': 'Vigonza',
 'VILLAFRANCA PADOVANA': 'Villafranca Padovana', "TAGGI' DI SOPRA": 'Villafranca Padovana', "TAGGI' DI SOTTO": 'Villafranca Padovana',
}
TESSERA = 'TESSERA AEROPORTO'
ABANO_MONTEGROTTO = {'MONTEGROTTO TERME', 'MONTEGROTTO TURRI', 'ABANO HOTEL EUROPA', 'ABANO ISTITUTI', 'ABANO MUNICIPIO', 'ABANO TERME FS'}

# Polimetrica name -> GTFS stop name, where the automatic match is wrong or missing.
GTFS_NAME = {
    'PADOVA': 'PADOVA AUTOSTAZIONE', 'PIOVE AUTOST.': 'PIOVE DI SACCO AUTOSTAZIONE',
    'ABANO TERME FS': 'Abano/Stazione', 'TESSERA AEROPORTO': 'AEROPORTO VENEZIA MARCO POLO',
    'ADRIA AUTOSTAZIONE': 'ADRIA FS', "S. ELENA D'ESTE": 'S. ELENA', 'COLL. MANFREDINI': 'ESTE MANFREDINI S.R. 10',
    'S. DONO': 'S.DONO', 'S. EUFEMIA CENTRO': 'S. EUFEMIA', 'S. BORTOLO SS 16': 'S. BORTOLO',
    'BV. LOREGGIA': 'INCROCIO PER LOREGGIA', 'BV. CAVINATI': 'BIVIO VIA CAVINATI', 'BV. ABBAZIA': 'ABBAZIA PISANI',
    'CAMISANO VIC.': 'CAMISANO CENTRO', "MASERA' V. BOLZANI": "MASERA'",
}

def group_by_top(words, tol=3):
    groups = []
    for w in sorted(words, key=lambda w: w['top']):
        if groups and abs(groups[-1][0]['top'] - w['top']) < tol:
            groups[-1].append(w)
        else:
            groups.append([w])
    return groups

def parse_pdf(path):
    import pdfplumber
    pdf = pdfplumber.open(path)
    rules = pdf.pages[0].extract_text()
    assert 'TU1 (€ 2,50 a bordo)' in rules and 'TU2 (€ 3,00 a bordo)' in rules, 'page 1 rules changed'
    out = []
    for pno, p in enumerate(pdf.pages[1:], start=2):
        m = re.search(r'Stampa Polimetrica della linea\s*(\S+)\s*:\s*(.*)', p.extract_text() or '')
        code, title = m.group(1), re.sub(r'\s*-\s*\d{3}\s*$', '', m.group(2).strip())
        words = p.extract_words(extra_attrs=['fontname', 'size'])
        vlines = sorted({round(l['x0'], 1) for l in p.lines if abs(l['x0'] - l['x1']) < .5 and l['x0'] > 140})
        def column_index(w):
            xc = (w['x0'] + w['x1']) / 2
            return max(i for i, x in enumerate(vlines) if x <= xc)
        colnum = {column_index(w): int(w['text']) for w in words
                  if w['fontname'].endswith('F2') and 60 < w['top'] < 76 and w['x0'] > 140}
        rows = []
        for g in group_by_top([w for w in words if w['x1'] < 148 and 70 < w['top'] < 540]):
            g.sort(key=lambda w: w['x0'])
            mm = re.match(r'(\d+)\s*-\s*(.*)', ' '.join(w['text'] for w in g))
            assert mm, (pno, g)
            rows.append((int(mm.group(1)), mm.group(2).strip(), g[0]['top']))
        nums = [r[0] for r in rows]
        assert nums == sorted(nums) and len(set(nums)) == len(nums), (pno, nums)
        cells = {}
        for w in words:
            if not (w['fontname'].endswith('F1') and w['x0'] > 140 and 70 < w['top'] < 540):
                continue
            assert re.fullmatch(r'\d{1,2}', w['text']), (pno, w['text'])
            col = colnum[column_index(w)]
            r = min(rows, key=lambda r: abs(r[2] - w['top']))
            assert abs(r[2] - w['top']) < 3 and col < r[0], (pno, code, r, col)
            assert (r[0], col) not in cells
            cells[(r[0], col)] = int(w['text'])
        out.append({'code': code, 'title': title, 'page': pno, 'stops': [(n, name) for n, name, _ in rows], 'cells': cells})
    return out

def norm(s):
    s = unicodedata.normalize('NFKD', s.upper()).encode('ascii', 'ignore').decode()
    s = re.sub(r"['°]", ' ', s.strip())
    s = re.sub(r'\s+R$', '', s)
    return re.sub(r'\s+', ' ', s).strip()

def tokens(s):
    return [t for t in re.split(r'[\s\-/,()]+', norm(s)) if t]

def prefix_match(ptoks, gtoks):
    """Every polimetrica token must equal (or, when abbreviated with '.', prefix)
    a GTFS token, in order; the GTFS name may have extra tokens."""
    j = 0
    for t in ptoks:
        base = t.rstrip('.')
        if not base:
            continue
        while j < len(gtoks):
            g = gtoks[j].rstrip('.')
            j += 1
            if g == base or (t.endswith('.') and g.startswith(base)) or (gtoks[j-1].endswith('.') and len(g) >= 3 and base.startswith(g)):
                break
        else:
            return False
    return True

def metres(a, b):
    y = (b[0]-a[0])*111320; x = (b[1]-a[1])*111320*math.cos(math.radians(a[0]))
    return math.hypot(x, y)

def gtfs_line(short):
    m = re.match(r'E(\d{3})', short)
    return 'E%03d' % int(m.group(1)) if m else {'EA': 'A', 'EM': 'M'}.get(short, short)

def place_nodes(lines, gtfs_zip):
    z = zipfile.ZipFile(gtfs_zip)
    rd = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(next(x for x in z.namelist() if x.endswith(n + '.txt'))), encoding='utf-8-sig')))
    routes = {r['route_id']: r for r in rd('routes')}
    stops = {s['stop_id']: s for s in rd('stops')}
    trips = {t['trip_id']: t for t in rd('trips')}
    by_line = collections.defaultdict(set)
    for st in rd('stop_times'):
        by_line[gtfs_line(routes[trips[st['trip_id']]['route_id']]['route_short_name'])].add(st['stop_id'])
    pos = lambda g: (float(g['stop_lat']), float(g['stop_lon']))
    everywhere = list(stops.values())
    report = collections.Counter()
    for l in lines:
        local = [stops[i] for i in by_line.get(re.sub(r'^(E\d{3}).*', r'\1', l['code']), ())]
        local_pts = [pos(g) for g in local]
        placed = []
        for n, name in l['stops']:
            target = GTFS_NAME.get(name, name); ptoks = tokens(target); found = None
            for pool, where, mode in ((local, 'line', 'exact'), (local, 'line', 'prefix'), (everywhere, 'all', 'exact'), (everywhere, 'all', 'prefix')):
                hit = [g for g in pool if (norm(g['stop_name']) == norm(target) if mode == 'exact' else prefix_match(ptoks, tokens(g['stop_name'])))]
                if hit:
                    found = (hit, where, mode); break
            if not found and local:
                hit = [g for g in local if tokens(g['stop_name'])[:1] == [ptoks[0].rstrip('.')]]
                if hit: found = (hit, 'line', 'first-token')
            point = None
            if found:
                hit, where, mode = found
                pts = [pos(g) for g in hit]
                c = min(pts, key=lambda p: min(metres(p, q) for q in local_pts)) if (where == 'all' and local_pts) else pts[0]
                cluster = [p for p in pts if metres(p, c) < 1500]
                point = (sum(p[0] for p in cluster)/len(cluster), sum(p[1] for p in cluster)/len(cluster))
                far = min((metres(point, q) for q in local_pts), default=0)
                if where == 'all' and mode == 'prefix' and far > 4000:
                    point = None   # same words, different place
            report['placed' if point else 'unplaced'] += 1
            placed.append(point)
        l['points'] = placed
    return report

def fare_code(a, b, cls):
    if cls is not None:
        return f'C{cls}'
    pair = {a, b}
    if TESSERA in pair:
        other = (pair - {TESSERA}) or {TESSERA}
        other = next(iter(other))
        if other == 'PADOVA': return 'PD-TESSERA'
        if other in ABANO_MONTEGROTTO: return 'ABANO-TESSERA'
        return ''
    ca, cb = CONURBAZIONE.get(a), CONURBAZIONE.get(b)
    if ca == cb == 'Padova': return 'TU1'
    if ca and cb: return 'TU2'
    return ''

def build(pdf_path, gtfs_zip):
    lines = parse_pdf(pdf_path)
    report = place_nodes(lines, gtfs_zip)
    out = []
    for l in lines:
        numbers = [n for n, _ in l['stops']]; names = [name for _, name in l['stops']]
        fares = []
        for i, a in enumerate(names):
            row = []
            for j in range(i + 1):
                if i == j:
                    # Same fare node: only an urban/conurbation fare applies.
                    code = fare_code(a, a, None) if a in CONURBAZIONE else ''
                else:
                    code = fare_code(a, names[j], l['cells'].get((numbers[i], numbers[j])))
                row.append(code)
            fares.append(row)
        dropped = sum(1 for (r, c) in l['cells'] if c not in numbers)
        out.append({'code': l['code'], 'title': l['title'], 'page': l['page'],
                    'stops': [[name] + ([round(p[0], 5), round(p[1], 5)] if p else []) for name, p in zip(names, l['points'])],
                    'fares': fares, **({'droppedCells': dropped} if dropped else {})})
    return {
        'version': 1,
        'source': 'Busitalia Veneto: Polimetriche servizio extraurbano Provincia di Padova (agg. 10/2024) e Prezziario biglietti a bordo; Comunicazione n.478 del 27.08.2024 per Tessera.',
        'note': 'Solo prezzi del biglietto a bordo, corsa semplice. Le classi vanno da salita e discesa sulla stessa linea.',
        'labels': LABELS,
        'lines': out,
    }, report

if __name__ == '__main__':
    data, report = build(sys.argv[1], sys.argv[2])
    with open(sys.argv[3], 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(len(data['lines']), 'lines;', dict(report))
