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


def gtfs_patterns(path):
    """{(line, headsign): [stop coordinates, …]} from the dated GTFS pattern snapshot."""
    import csv, io, zipfile
    if not path.exists():
        return {}
    z = zipfile.ZipFile(path)
    rd = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(n), encoding='utf-8-sig')))
    routes = {r['route_id']: r['route_short_name'] for r in rd('routes.txt')}
    trips = {t['trip_id']: routes[t['route_id']] for t in rd('trips.txt')}
    stops = {s['stop_id']: (float(s['stop_lat']), float(s['stop_lon'])) for s in rd('stops.txt')}
    rows = collections.defaultdict(list)
    for r in rd('stop_times.txt'):
        rows[r['trip_id']].append(r)
    out = collections.defaultdict(set)
    for trip, rs in rows.items():
        rs.sort(key=lambda r: int(r['stop_sequence']))
        pts = tuple(stops[r['stop_id']] for r in rs)
        for h in {r['stop_headsign'] for r in rs if r['stop_headsign']}:
            out[(trips[trip], re.sub(r'[^A-Z0-9]', '', h.upper()))].add(pts)
    return out


def stop_share(stops, route_points):
    """(share of the GTFS stops within 70 m of the GPX, share of the GPX within
    400 m of a stop): a GPX with an extra detour scores lower on the second."""
    import numpy as np
    s, p = np.radians(np.array(stops)), np.radians(np.array(route_points))
    lat = s[:, :1]
    dx = (p[None, :, 1] - s[:, None, 1]) * np.cos(lat) * 6371000
    dy = (p[None, :, 0] - s[:, None, 0]) * 6371000
    d = np.hypot(dx, dy)
    return float((d.min(axis=1) <= 70).mean()), float((d.min(axis=0) <= 400).mean())


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
    if kind.startswith('Trasf') or kind == 'A piedi' or 'Post turno' in kind or not desc or 'DEPOSITO' in desc.upper():
        return 'transfer'
    if kind == 'Diretta':
        return 'empty'
    if kind in ('Disp.', 'TAttesa'):
        return 'standby'
    return 'service'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--legs', type=pathlib.Path, default=ROOT / 'turni-src' / 'turni-legs.json', help='from scripts/extract_turni.py')
    args = parser.parse_args()
    catalog = json.loads((ROOT / 'official-routes.json').read_text())
    evidence = json.loads((ROOT / 'academy-evidence.json').read_text())
    legs, documents, meta = [], [], {}
    if args.legs and args.legs.exists():
        source = json.loads(args.legs.read_text())
        legs, documents, meta = source['legs'], source['documents'], source.get('shifts', {})
    # Days whose PDF has not been read again keep the legs of the Academy PDFs.
    read_days = {d['day'] for d in documents}
    old = [l for l in evidence['shiftLegs'] if l['day'] not in read_days]
    legs = legs + old
    documents = documents + [{'name': d['name'], 'day': next((l['day'] for l in old if l['document'] == d['name']), None),
                              'validFrom': next((l['validFrom'] for l in old if l['document'] == d['name']), None), 'reread': False}
                             for d in evidence['documents'] if any(l['document'] == d['name'] for l in old)]

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

    # Market-day detours: the GPX of the "DEVIAZIONI MERCATALI" folder with the
    # same code as the normal GPX (and the same line), driven on that weekday.
    markets = collections.defaultdict(list)
    for r in catalog:
        ev = evidence['routes'][str(r['id'])]
        if r['line'] == 'Deviazioni mercatali' and ev.get('marketDay'):
            markets[r['variant']].append((r, ev))
    WEEKDAY = {'Lunedì': 1, 'Martedì': 2, 'Mercoledì': 3, 'Giovedì': 4, 'Venerdì': 5, 'Sabato': 6}

    def window(place):
        m = re.search(r'(\d{1,2})\s*-\s*(\d{1,2})\)', place)
        if m:
            return f'{int(m.group(1)):02d}:00', f'{int(m.group(2)):02d}:00'
        m = re.search(r'fino alle (?:ore )?(\d{1,2})', place, re.I)
        return None, (f'{int(m.group(1)):02d}:00' if m else None)

    def market_for(item, ids, day):
        found = []
        base = 'E' + re.findall(r'E(\d{3})', item['line'])[0] if re.findall(r'E(\d{3})', item['line']) else item['line']
        for normal in ids:
            for r, ev in markets.get(catalog[normal]['variant'], []):
                weekday = WEEKDAY.get(ev['marketDay'])
                if weekday is None or (day == 'saturday') != (weekday == 6) or day == 'holiday':
                    continue
                if ev['lineAliases'] and base not in ev['lineAliases']:
                    continue
                start, until = window(ev.get('marketPlace', ''))
                if (start and item['dep'] < start) or (until and item['dep'] >= until):
                    continue
                found.append({'normal': normal, 'route': r['id'], 'weekday': weekday, 'day': ev['marketDay'],
                              'place': ev.get('marketPlace', ''), 'from': start, 'until': until})
        return found

    patterns = gtfs_patterns(ROOT / 'tests' / 'fixtures' / 'busitalia-patterns-2026-11-08.zip')
    points = {r['id']: [tuple(p) for p in r['points']] for r in catalog}
    share_cache = {}
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
                options = [i for s, i in ranked if s >= max(.6, best - .1)][:4]
                # The GTFS trips with this line and description: the GPX that passes
                # by all their stops is the one (every pattern must agree).
                pats = patterns.get((line, re.sub(r'[^A-Z0-9]', '', item['desc'].upper())))
                picks = set()
                for pts in pats or ():
                    shares = sorted(((share_cache.setdefault((pts, i), stop_share(pts, points[i])), i) for i in options), reverse=True)
                    (best_stops, best_gpx), pick = shares[0]
                    rival = shares[1][0] if len(shares) > 1 else (0, 0)
                    ok = best_stops >= .9 and (best_stops - rival[0] >= .1 or (best_stops - rival[0] < .1 and best_gpx - rival[1] >= .05 and best_stops >= rival[0]))
                    picks.add(pick if ok else None)
                if len(picks) == 1 and None not in picks:
                    item['route'] = picks.pop()
                    item['routeFrom'] = 'gtfs'
                    stats['gtfs'] += 1
                else:
                    item['options'] = options
                    stats['choice'] += 1
            else:
                stats['missing'] += 1
        if kind == 'service':
            found = market_for(item, [i for i in [item.get('route'), *item.get('options', [])] if i is not None], leg['day'])
            if found:
                item['market'] = found
                stats['market'] += 1
        info = meta.get(leg['day'], {}).get(leg['shift'], {})
        shift = shifts[leg['day']].setdefault(leg['shift'], {'depot': info.get('depot', ''), 'events': info.get('events', []), 'legs': []})
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
