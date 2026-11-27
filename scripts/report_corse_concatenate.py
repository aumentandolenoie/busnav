#!/usr/bin/env python3
"""Report: shift trips run back to back (A→B then B→C with the same bus) and whether a
single official GPX covers A→C. Analysis only: the app is not changed.

Writes reports/corse-concatenate.json.
"""
import collections
import json
import math
import pathlib
import re
import sys
import unicodedata

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import enrich_road_guidance as road  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
NEAR_END_M = 700        # GPX ends this close count as the same place
ON_M = 40               # a point this close to a GPX is on it
COVER = 0.93            # share of a short GPX that must lie on the long one
MAX_GAP_MIN = 30        # longer stops are not a chain


def minutes(t):
    m = re.match(r'(\d{1,2})[:.](\d{2})', str(t or ''))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def norm(text):
    text = unicodedata.normalize('NFKD', str(text or '')).encode('ascii', 'ignore').decode().upper()
    return ' '.join(re.sub(r'[^A-Z0-9 ]', ' ', text).split())


STOP = {'VIA', 'DI', 'DEL', 'DELLA', 'S', 'SAN', 'SANTA', 'HUB', 'LA', 'IL', 'OSP', 'IST', 'P', 'Z', 'I', 'ACTV', 'C', 'B', 'GO'}


def places(desc):
    """First and last place of 'A - B - C' as sets of significant words."""
    parts = [norm(x) for x in re.split(r'\s*-\s*', str(desc or '')) if norm(x)]
    words = lambda t: {w for w in t.split() if len(w) >= 3 and w not in STOP}
    return (words(parts[0]), words(parts[-1])) if len(parts) >= 2 else (set(), set())


def options(leg):
    ids = [leg['route']] if leg.get('route') else []
    return ids + [i for i in leg.get('options') or [] if i not in ids]


def main():
    turni = json.loads((ROOT / 'turni.json').read_text())
    catalog = {r['id']: r for r in json.loads((ROOT / 'official-routes.json').read_text())}
    dist = {i: road.cumulative(r['points']) for i, r in catalog.items()}

    def d(a, b):
        return road.distance(a, b)

    def on(short, long):
        """Share of `short` on `long`, where along `long` it starts/ends, and the stretches off it."""
        pts, lp, ld = catalog[short]['points'], catalog[long]['points'], dist[long]
        sd = dist[short]
        hits, off, cur = 0, [], None
        alongs = []
        for i in range(0, len(pts), 3):
            dev, along = road.project(pts[i], lp, ld)
            alongs.append(along)
            if dev <= ON_M:
                hits += 1
                if cur:
                    off.append(cur); cur = None
            else:
                cur = cur or [sd[i], sd[i]]; cur[1] = sd[i]
        if cur:
            off.append(cur)
        n = len(range(0, len(pts), 3))
        return hits / n, alongs[0], alongs[-1], [[round(a), round(b)] for a, b in off]

    cover_cache = {}

    def covering(a_ids, b_ids):
        """GPX that start where trip a starts, end where trip b ends and carry both trips.
        The GPX of a or b can itself be the whole journey (e.g. "Padova - Noale - Treviso"
        used for Noale → Treviso). The change of trip is where a's GPX ends or b's starts,
        whichever lies inside the journey GPX."""
        out = []
        for a in a_ids:
            for b in b_ids:
                start, end = catalog[a]['points'][0], catalog[b]['points'][-1]
                for cid, c in catalog.items():
                    if d(c['points'][0], start) > NEAR_END_M or d(c['points'][-1], end) > NEAR_END_M:
                        continue
                    key = (a, b, cid)
                    if key not in cover_cache:
                        sa, a0, a1, a_off = on(a, cid)
                        sb, b0, b1, b_off = on(b, cid)
                        total = dist[cid][-1]
                        inner = [x for x in (a1, b0) if 0.03 * total < x < 0.97 * total]
                        split = min(inner, key=lambda x: abs(x - total / 2)) if inner else None
                        ok = sa >= COVER and sb >= COVER and split is not None
                        cover_cache[key] = {'id': cid, 'name': c['name'], 'aOn': round(sa * 100), 'bOn': round(sb * 100),
                                            'aOff': a_off, 'bOff': b_off, 'splitAtM': round(split) if split else None,
                                            'lengthM': round(total), 'ok': ok}
                    if cover_cache[key]['ok'] and all(x['id'] != cid for x in out):
                        out.append(cover_cache[key])
        return out

    chains, returns, unknown, other = [], collections.Counter(), collections.Counter(), collections.Counter()
    gaps = collections.Counter()
    for day, data in turni['days'].items():
        for code, shift in data['shifts'].items():
            legs = shift['legs']
            for i in range(len(legs) - 1):
                a, b = legs[i], legs[i + 1]
                if a.get('kind') != 'service' or b.get('kind') != 'service':
                    continue
                ga, gb = minutes(b.get('dep')), minutes(a.get('arr'))
                if ga is None or gb is None:
                    continue
                gap = (ga - gb) % 1440
                if gap > MAX_GAP_MIN or a.get('vehicle') != b.get('vehicle'):
                    continue
                a0, a1 = places(a.get('desc'))
                b0, b1 = places(b.get('desc'))
                key = (a.get('line'), a.get('desc'), b.get('line'), b.get('desc'))
                if not (a1 & b0):                     # b does not start where a ends
                    other[key] += 1
                    continue
                if b1 & a0:                           # back to where it started: real terminus
                    returns[key] += 1
                    continue
                ao, bo = options(a), options(b)
                if not ao or not bo:
                    unknown[key] += 1
                    continue
                gaps[gap] += 1
                chains.append({'day': day, 'shift': code, 'a': a, 'b': b, 'gap': gap, 'aIds': ao, 'bIds': bo})

    patterns = {}
    for c in chains:
        a, b = c['a'], c['b']
        key = (a.get('line'), norm(a.get('desc')), b.get('line'), norm(b.get('desc')), tuple(c['aIds']), tuple(c['bIds']))
        p = patterns.setdefault(key, {
            'aLine': a.get('line'), 'aDesc': a.get('desc'), 'bLine': b.get('line'), 'bDesc': b.get('desc'),
            'aGpx': [[i, catalog[i]['name']] for i in c['aIds']], 'bGpx': [[i, catalog[i]['name']] for i in c['bIds']],
            'count': 0, 'gaps': collections.Counter(), 'shifts': [], 'notes': collections.Counter(), 'cover': None})
        p['count'] += 1
        p['gaps'][c['gap']] += 1
        p['shifts'].append(f"{c['shift']} {c['day'][:3]} {a.get('dep')}")
        for n in (a.get('note'), b.get('note')):
            if n:
                p['notes'][n] += 1
    for p in patterns.values():
        p['cover'] = covering([x[0] for x in p['aGpx']], [x[0] for x in p['bGpx']])
        p['gaps'] = dict(sorted(p['gaps'].items()))
        p['notes'] = dict(p['notes'])

    # ACTV: every trip that names ACTV, chained or not.
    actv = collections.Counter()
    for day, data in turni['days'].items():
        for code, shift in data['shifts'].items():
            legs = shift['legs']
            for i, l in enumerate(legs):
                text = ' '.join([l.get('desc') or '', l.get('note') or ''])
                if 'ACTV' in text.upper() and l.get('kind') == 'service':
                    nxt = legs[i + 1] if i + 1 < len(legs) else {}
                    prv = legs[i - 1] if i else {}
                    gap_n = (minutes(nxt.get('dep')) - minutes(l.get('arr'))) % 1440 if nxt.get('dep') and minutes(l.get('arr')) is not None else None
                    actv[(l.get('line'), l.get('desc'), l.get('note') or '', tuple(options(l)),
                          f"{nxt.get('kind', '')}: {nxt.get('desc', '')}" if nxt else '', gap_n, code, day)] += 1

    out = {
        'chains': len(chains),
        'gaps': dict(sorted(gaps.items())),
        'patterns': sorted(patterns.values(), key=lambda p: -p['count']),
        'returns': [[*k, v] for k, v in returns.most_common()],
        'notContinuing': [[*k, v] for k, v in other.most_common()],
        'withoutGpx': [[*k, v] for k, v in unknown.most_common()],
        'actv': [[*k, v] for k, v in actv.items()],
    }
    (ROOT / 'reports').mkdir(exist_ok=True)
    (ROOT / 'reports' / 'corse-concatenate.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    covered = [p for p in out['patterns'] if p['cover']]
    print('catene', len(chains), 'modelli', len(patterns), 'con GPX unico', len(covered),
          'occorrenze coperte', sum(p['count'] for p in covered))
    print('soste al punto intermedio', out['gaps'])
    print('ritorni (veri capolinea)', sum(v for *_, v in out['returns']), 'senza GPX', sum(v for *_, v in out['withoutGpx']),
          'non proseguono', sum(v for *_, v in out['notContinuing']))


if __name__ == '__main__':
    main()
