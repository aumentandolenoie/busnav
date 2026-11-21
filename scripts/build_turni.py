#!/usr/bin/env python3
"""Build turni.json: every driver shift, its trips and the GPX to drive for each.

Usage: python3 scripts/build_turni.py [--legs turni-legs.json]

The legs come from the shift PDFs (scripts/extract_turni.py writes
turni-legs.json; without it the legs already stored in academy-evidence.json
are used). Each passenger trip is matched to the GPX of its line by the places
in its description; when several GPX fit equally well the app asks once (or
resolves it with the GTFS timetable of that departure).
"""
import argparse, collections, difflib, json, pathlib, re, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
DAY_LABEL = {'weekday': 'Feriale', 'saturday': 'Sabato', 'holiday': 'Festivo'}
ABBR = [(r'\bPIOVE (?:DI )?S\.?(?=\s|$|-)', 'PIOVE DI SACCO'), (r'\bCITT?\.', 'CITTADELLA'), (r'\bVILLA C\.', 'VILLA DEL CONTE'),
        (r'\bBADIA P\.?', 'BADIA POLESINE'), (r'\bCONS\.', 'CONSORZIO'), (r'\bAUTOSTAZ\.?', 'AUTOSTAZIONE'),
        (r'\bOSP\.', 'OSPEDALE'), (r'\bIST\.', 'ISTITUTO'), (r'\bS\.F\.', 'SAN FIDENZIO'),
        (r'\bCASALE SC\.', 'CASALE DI SCODOSIA'), (r'\bBORG\.', 'BORGORICCO'), (r'\bS\.\s*', 'SAN '), (r'\bSS\.', ''), (r'\bP\.(?=\s|$|-)', '')]
DROP = {'VIA', 'DI', 'DEL', 'DELLA', 'DA', 'E', 'DIRETTA', 'DEV', 'DIR', 'FS', 'STAZIONE', 'CENTRO', 'AUTOSTAZIONE',
        'CAPOLINEA', 'PIAZZA', 'PER'}
SERVICE_TYPES = {'', '-', 'Bis', 'Serv.Stud', 'Bus trans', 'BusTrans'}


def places(text):
    s = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().upper()
    s = re.sub(r'^[^|]*\|', '', s)
    s = re.sub(r'\(.*?\)', '', s)
    for a, b in ABBR:
        s = re.sub(a, b, s)
    out = []
    for seg in re.split(r'\s*-\s*', s):
        words = frozenset(w for w in re.sub(r'[^A-Z ]', ' ', seg).split() if w not in DROP and len(w) > 1)
        if words:
            out.append(words)
    return out


def seg_similarity(a, b):
    best = max((difflib.SequenceMatcher(None, x, y).ratio() for x in a for y in b), default=0)
    return best if best > .8 else len(a & b) / max(len(a), len(b))


def score(leg_places, route_places):
    """Same first and last place weigh most; places in between add the rest."""
    if len(leg_places) < 2 or len(route_places) < 2:
        return 0
    ends = (seg_similarity(leg_places[0], route_places[0]) + seg_similarity(leg_places[-1], route_places[-1])) / 2
    middle = leg_places[1:-1]
    mid = sum(max(seg_similarity(x, y) for y in route_places) for x in middle) / len(middle) if middle else 1
    full = ends * .8 + mid * .2 - max(0, len(route_places) - len(leg_places)) * .03
    # The trip may be only a part of a longer GPX (Este → Montagnana on a
    # Padova → … → Montagnana track): found, but never chosen without asking.
    starts = [i for i, y in enumerate(route_places) if seg_similarity(leg_places[0], y) > .8]
    ends_at = [i for i, y in enumerate(route_places) if seg_similarity(leg_places[-1], y) > .8]
    if starts and ends_at and min(starts) < max(ends_at) and (min(starts) > 0 or max(ends_at) < len(route_places) - 1):
        inner = route_places[min(starts):max(ends_at) + 1]
        part = sum(max(seg_similarity(x, y) for y in inner) for x in middle) / len(middle) if middle else 1
        full = max(full, .8 + part * .2 - max(0, len(inner) - len(leg_places)) * .03 - .12)
    return full


def clean_line(line):
    """'E013VE013V' (a cell read twice) → 'E013V'; empty stays empty."""
    line = (line or '').strip()
    m = re.fullmatch(r'((?:E\d{3,4}[A-Z]?|U\d+[A-Z]?|[A-Z]{1,3}))\1?', line)
    if m:
        return m.group(1)
    codes = re.findall(r'E\d{3,4}[A-Z]?|U\d+[A-Z]?', line)
    return codes[0] if codes else line


def leg_kind(leg):
    desc, kind = leg['description'].strip(), (leg['type'] or '').strip()
    if kind.startswith('Trasf') or 'Post turno' in kind or not desc or 'DEPOSITO' in desc.upper():
        return 'transfer'
    if kind == 'Diretta':
        return 'empty'
    if kind in ('Disp.', 'TAttesa'):
        return 'standby'
    return 'service'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--legs', type=pathlib.Path, help='turni-legs.json from scripts/extract_turni.py')
    args = parser.parse_args()
    catalog = json.loads((ROOT / 'official-routes.json').read_text())
    evidence = json.loads((ROOT / 'academy-evidence.json').read_text())
    if args.legs:
        source = json.loads(args.legs.read_text())
        legs, documents = source['legs'], source['documents']
    else:
        legs = evidence['shiftLegs']
        documents = [{'name': d['name'], 'day': next((l['day'] for l in legs if l['document'] == d['name']), None),
                      'validFrom': next((l['validFrom'] for l in legs if l['document'] == d['name']), None)}
                     for d in evidence['documents'] if any(l['document'] == d['name'] for l in legs)]

    status = {str(k): v['serviceStatus'] for k, v in evidence['routes'].items()}
    by_line = collections.defaultdict(list)
    for r in catalog:
        by_line[(r['category'], r['line'])].append(r)
    route_places = {r['id']: places(r['name']) for r in catalog}

    def candidates(line, kind):
        numbers = [str(int(n)) for n in re.findall(r'E(\d{3})', line)]
        if numbers:
            pool = [r for n in dict.fromkeys(numbers) for r in by_line[('Extraurbano', n)]]
        elif line in ('M', 'A', 'AT', 'ATL', 'TL', 'T'):
            pool = by_line[('Colli', line)]
        elif line in ('EM', 'EA'):
            pool = [r for (cat, _), rs in by_line.items() if cat == 'Colli' for r in rs]
        elif re.fullmatch(r'U\d+[A-Z]?', line):
            pool = by_line[('Urbano', str(int(re.sub(r'\D', '', line))))]
        else:
            pool = []
        out_of_service = lambda r: status[str(r['id'])] == 'out-of-service'
        return [r for r in pool if out_of_service(r) == (kind == 'empty')] or pool

    shifts = collections.defaultdict(dict)
    stats = collections.Counter()
    for leg in legs:
        kind = leg_kind(leg)
        line = clean_line(leg['line'])
        hhmm = lambda v: (re.search(r'\d{1,2}:\d{2}', v or '') or [''])[0].zfill(5)
        item = {'dep': hhmm(leg['departure']), 'arr': hhmm(leg['arrival']), 'kind': kind, 'line': line,
                'desc': re.sub(r'\s+', ' ', leg['description']).strip(), 'note': re.sub(r'\s+', ' ', leg['note']).strip(),
                'vehicle': leg['vehicleDuty'], 'type': leg['type'].strip()}
        if kind in ('service', 'empty'):
            wanted = places(item['desc'])
            ranked = sorted(((score(wanted, route_places[r['id']]), r['id']) for r in candidates(line, kind)), reverse=True)
            best = ranked[0][0] if ranked else 0
            second = ranked[1][0] if len(ranked) > 1 else 0
            if best >= .9 and best - second >= .04:
                item['route'] = ranked[0][1]
                stats['sure'] += 1
            elif best >= .6:
                item['options'] = [i for s, i in ranked if s >= max(.6, best - .1)][:4]
                stats['choice'] += 1
            else:
                stats['missing'] += 1
        shift = shifts[leg['day']].setdefault(leg['shift'], {'legs': []})
        shift['legs'].append(item)
    for day in shifts.values():
        for shift in day.values():
            shift['legs'].sort(key=lambda l: l['dep'])

    out = {'version': 1, 'documents': documents,
           'days': {d: {'label': DAY_LABEL[d], 'validFrom': next((x['validFrom'] for x in documents if x['day'] == d), None),
                        'shifts': dict(sorted(shifts[d].items()))} for d in DAY_LABEL if d in shifts},
           'stats': dict(stats)}
    (ROOT / 'turni.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n')
    print({d: len(v['shifts']) for d, v in out['days'].items()}, dict(stats))


if __name__ == '__main__':
    main()
