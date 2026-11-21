#!/usr/bin/env python3
"""Read the Busitalia shift PDFs ("Turni … EXTRAURBANO") into turni-legs.json.

Usage: python3 scripts/extract_turni.py feriale.pdf:weekday sabato.pdf:saturday [festivo.pdf:holiday] [-o turni-legs.json]

Every row of every shift is read by the x position of its words under the
column headers (Partenza, Arrivo, Percorso, TurnoVettura, Nota, Linea, Tipo).
Lines without a departure time continue the row above (wrapped description,
note or line code "E013-" + "V"). "Pre turno", "Post ripresa"… are kept as
shift events. The script stops on anything it cannot place, so a wrong
reading never reaches the app; checks are printed at the end.
"""
import argparse, collections, hashlib, json, pathlib, re, sys
import pdfplumber

TIME = re.compile(r'^\d{1,2}:\d{2}$')
EVENT = re.compile(r'^(\d{1,2})\.(\d{2})$')
LINE_CODE = re.compile(r'^(?:E\d{3}[0-9A-Z]?(?:-[VZ0-9])?|E\d{3}_\d|U\d{1,3}[A-Z]?|[A-Z]{1,4}\d?)$')


def columns(header):
    """Column x boundaries from the header words of a shift block."""
    x = {w['text']: w['x0'] for w in header}
    return {'dep': (0, x['Arrivo'] - 15), 'arr': (x['Arrivo'] - 15, x['Percorso'] - 50),
            'desc': (x['Percorso'] - 50, x['TurnoVettura'] - 1), 'vehicle': (x['TurnoVettura'] - 1, x['TurnoVettura'] + 34),
            'note': (x['TurnoVettura'] + 34, x['Linea'] - 5), 'line': (x['Linea'] - 5, x['Tipo'] - 4), 'type': (x['Tipo'] - 4, 10_000)}


def lines_of(page):
    words = page.extract_words(extra_attrs=['fontname', 'size'])
    rows = collections.defaultdict(list)
    for w in words:
        key = round(w['top'] / 2.5)
        # a word slightly lower/higher than its neighbours joins the existing line
        for k in (key, key - 1, key + 1):
            if k in rows and abs(rows[k][0]['top'] - w['top']) < 2.2:
                key = k
                break
        rows[key].append(w)
    return [sorted(ws, key=lambda w: w['x0']) for _, ws in sorted(rows.items(), key=lambda kv: kv[1][0]['top'])]


def text(ws):
    return ' '.join(w['text'] for w in ws).strip()


def read(path, day):
    document = pathlib.Path(path).name
    shifts, problems = {}, []
    valid_from = None
    current = None
    cols = None
    with pdfplumber.open(path) as pdf:
        for page_no, page in enumerate(pdf.pages, 1):
            for ws in lines_of(page):
                t = text(ws)
                if 'TABELLA DI MARCIA' in t:
                    break  # empty "tabella di marcia" form at the end of the document
                m = re.search(r'TURNI VALIDI DAL (\d{2}/\d{2}/\d{4})', t)
                if m:
                    valid_from = valid_from or m.group(1)
                    continue
                m = re.match(r'^((?:INV\.?|INVERNALE|EST\.?|ESTIVO)\b.*?)\b(P\d{3})\s*-\s*(.+)$', t)
                if m and any('Bold' in w['fontname'] for w in ws):
                    code = m.group(2)
                    if code in shifts:
                        problems.append(f'{document} p.{page_no}: {code} appears twice')
                    current = shifts[code] = {'shift': code, 'depot': m.group(3).strip(), 'header': m.group(1).strip(),
                                              'page': page_no, 'legs': [], 'events': [], 'totals': {}}
                    continue
                if current is not None and (t.startswith('Voci') or (not current['legs'] and re.fullmatch(r'(?:[A-Z][A-Za-z ]+?\s+\d+,\d+\s*)+', t))):
                    for k, v in re.findall(r'([A-Z][A-Za-z ]+?)\s+(\d+,\d+)', t):
                        current['totals'][k.strip()] = v
                    continue
                if {'Partenza', 'Arrivo', 'Linea', 'Tipo'} <= {w['text'] for w in ws}:
                    cols = columns(ws)
                    continue
                if re.match(r'^Pag \d+|^\d{2}/\d{2}/\d{4}|^BUSITALIA', t) or t in ('', 'BUSITALIA'):
                    continue
                if current is None or cols is None:
                    if t and not re.search(r'Pag\s+\d+', t):
                        problems.append(f'{document} p.{page_no}: text outside a shift: {t[:60]}')
                    continue
                first = ws[0]
                ev = EVENT.match(first['text'])
                if ev and len(ws) >= 2 and re.match(r'^(Pre|Post)\b', text(ws[1:])):
                    current['events'].append({'time': f'{int(ev.group(1)):02d}:{ev.group(2)}', 'what': text(ws[1:])})
                    continue
                cell = collections.defaultdict(list)
                for w in ws:
                    mid = (w['x0'] + w['x1']) / 2 if w['x1'] - w['x0'] < 60 else w['x0'] + 5
                    name = next((k for k, (a, b) in cols.items() if a <= mid < b), None)
                    if name is None:
                        problems.append(f"{document} p.{page_no} {current['shift']}: word outside columns: {w['text']}")
                        continue
                    if name == 'arr' and not TIME.match(w['text']):
                        name = 'desc'  # a long description starts under the Arrivo column
                    cell[name].append(w['text'])
                dep = ' '.join(cell['dep'])
                if TIME.match(dep):
                    arr = ' '.join(cell['arr'])
                    if not TIME.match(arr):
                        problems.append(f"{document} p.{page_no} {current['shift']} {dep}: arrival '{arr}'")
                    current['legs'].append({k: ' '.join(cell[k]) for k in ('dep', 'arr', 'desc', 'vehicle', 'note', 'line', 'type')} | {'page': page_no})
                    current['legs'][-1]['line'] = current['legs'][-1]['line'].upper()
                    continue
                if cell['dep'] or cell['arr'] or cell['vehicle']:
                    problems.append(f"{document} p.{page_no} {current['shift']}: unexpected row: {t[:80]}")
                    continue
                if not current['legs']:
                    problems.append(f"{document} p.{page_no} {current['shift']}: text before the first row: {t[:80]}")
                    continue
                leg = current['legs'][-1]
                for k in ('desc', 'note'):
                    if cell[k]:
                        leg[k] = (leg[k] + ' ' + ' '.join(cell[k])).strip()
                if cell['line']:
                    leg['line'] = (leg['line'] + ''.join(cell['line'])).upper()
                if cell['type']:
                    leg['type'] = (leg['type'] + ' ' + ' '.join(cell['type'])).strip()
    return document, valid_from, shifts, problems


def check(day, shifts):
    """Plausibility of what was read: times, order, line codes, transfers."""
    issues = []
    to_min = lambda v: int(v[:2]) * 60 + int(v[3:]) if v else None
    for code, s in shifts.items():
        legs = s['legs']
        if not legs:
            issues.append(f'{code}: no rows')
            continue
        for i, l in enumerate(legs):
            l['dep'], l['arr'] = l['dep'].zfill(5), l['arr'].zfill(5)
            a, b = to_min(l['dep']), to_min(l['arr'])
            if b < a and b + 1440 - a > 240:
                issues.append(f"{code} {l['dep']}: arrives {l['arr']}")
            if i and a < to_min(legs[i - 1]['arr']) - 1 and a + 1440 - to_min(legs[i - 1]['arr']) > 240:
                issues.append(f"{code} {l['dep']}: starts before the previous row ends ({legs[i - 1]['arr']})")
            if l['line'] and not LINE_CODE.match(l['line']):
                issues.append(f"{code} {l['dep']}: line code '{l['line']}'")
            if l['type'] not in ('-', 'Trasf.', 'Diretta', 'Bis', 'Serv.Stud', 'Bus trans', 'BusTrans', 'TAttesa', 'Disp.', 'A piedi', ''):
                issues.append(f"{code} {l['dep']}: type '{l['type']}'")
            if not l['vehicle'] and l['type'] not in ('Disp.', 'TAttesa', 'A piedi', 'Trasf.'):
                issues.append(f"{code} {l['dep']}: no vehicle")
            if l['type'] != 'Trasf.' and not l['desc'] and l['type'] not in ('TAttesa', 'Disp.'):
                issues.append(f"{code} {l['dep']}: trip without description")
        if not any(e['what'].startswith('Pre turno') for e in s['events']) or not any(e['what'].startswith('Post turno') for e in s['events']):
            issues.append(f'{code}: Pre/Post turno missing')
    return issues


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pdfs', nargs='+', help='file.pdf:weekday|saturday|holiday')
    parser.add_argument('-o', '--out', type=pathlib.Path, default=pathlib.Path('turni-legs.json'))
    args = parser.parse_args()
    legs, documents, meta, all_problems = [], [], {}, []
    for item in args.pdfs:
        path, day = item.rsplit(':', 1)
        document, valid_from, shifts, problems = read(path, day)
        issues = check(day, shifts)
        all_problems += problems + [f'{document}: {x}' for x in issues]
        documents.append({'name': document, 'day': day, 'validFrom': valid_from, 'shifts': len(shifts),
                          'rows': sum(len(s['legs']) for s in shifts.values()),
                          'sha256': hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()})
        for code, s in shifts.items():
            meta.setdefault(day, {})[code] = {'depot': s['depot'], 'events': s['events'], 'totals': s['totals'], 'page': s['page']}
            for l in s['legs']:
                legs.append({'departure': l['dep'], 'arrival': l['arr'], 'description': l['desc'], 'vehicleDuty': l['vehicle'],
                             'note': l['note'], 'line': l['line'].replace('-', ''), 'lineRaw': l['line'], 'type': l['type'], 'shift': code, 'day': day,
                             'validFrom': valid_from, 'document': document, 'page': l['page']})
        print(document, day, 'valid from', valid_from, '·', len(shifts), 'shifts ·', sum(len(s['legs']) for s in shifts.values()), 'rows')
    args.out.write_text(json.dumps({'documents': documents, 'shifts': meta, 'legs': legs, 'problems': all_problems},
                                   ensure_ascii=False, indent=0) + '\n')
    for p in all_problems:
        print('CHECK:', p)
    print(len(all_problems), 'rows to check')


if __name__ == '__main__':
    main()
