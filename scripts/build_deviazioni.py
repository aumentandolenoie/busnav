#!/usr/bin/env python3
"""Temporary detours (deviazioni-src/<n>.json → deviazioni.json).

Each source file is one company communication: validity windows, the
communications it cancels/replaces (or extends) and, for every official GPX it
touches, the streets of the detour in order, each with an approximate point.

The official GPX is never modified. A detour GPX is:
  official GPX up to where the routed detour leaves it
  + Valhalla route forced through the named streets
  + official GPX from where the detour rejoins it.
The result is refused (job fails) unless the route really uses the named
streets in that order, keeps away from the closed stretch and makes no U-turn.
Road guidance comes from the same annotate_route() used for every official GPX.
"""
import argparse
import json
import math
import pathlib
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import enrich_road_guidance as road  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'deviazioni-src'
OUT = ROOT / 'deviazioni.json'
REPORTS = ROOT / 'reports' / 'deviazioni'
ON_BASE_M = 35.0          # a routed point this close to the official GPX is "still on it"
CLOSED_CLEARANCE_M = 80.0  # the detour must stay this far from the closed stretch
SNAP_RADIUS_M = 800.0      # an approximate street point must be this close to the street
BUS_KMH = 30.0


def norm(name):
    text = unicodedata.normalize('NFKD', str(name or '')).encode('ascii', 'ignore').decode().lower()
    return ' '.join(text.replace("'", ' ').replace('’', ' ').split())


def bearing(a, b):
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    x = math.sin(dl) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def angle_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


def load_sources():
    sources = []
    for path in sorted(SRC.glob('*.json'), key=lambda p: int(p.stem) if p.stem.isdigit() else 0):
        data = json.loads(path.read_text())
        if int(data['number']) != int(path.stem):
            raise SystemExit(f'{path.name}: number {data["number"]} differs from the file name')
        sources.append(data)
    return sources


def street_index(pbf, names):
    """Node polylines of highways named like the detour streets (OSM ids preserved)."""
    import osmium
    wanted = {norm(n) for n in names}
    found = {n: [] for n in wanted}

    class Ways(osmium.SimpleHandler):
        def way(self, w):
            if 'highway' not in w.tags:
                return
            labels = {norm(w.tags.get(k)) for k in ('name', 'alt_name', 'official_name', 'old_name') if w.tags.get(k)}
            for label in labels & wanted:
                try:
                    found[label].append([(n.lat, n.lon) for n in w.nodes])
                except osmium.InvalidLocationError:
                    pass
    Ways().apply_file(str(pbf), locations=True)
    return found


def snap_via(via, ways, prev_point, next_point):
    """Closest node of the named street to the approximate point, and the street
    direction there that agrees with the direction of travel."""
    best = None
    for line in ways.get(norm(via['street']), []):
        for i, p in enumerate(line):
            d = road.distance(p, via['near'])
            if best is None or d < best[0]:
                best = (d, line, i)
    if best is None or best[0] > SNAP_RADIUS_M:
        raise SystemExit(f"{via['street']}: nessuna strada con questo nome entro {SNAP_RADIUS_M:.0f} m da {via['near']}")
    _, line, i = best
    a, b = (line[i], line[i + 1]) if i + 1 < len(line) else (line[i - 1], line[i])
    along = bearing(a, b)
    travel = bearing(prev_point, next_point)
    heading = along if angle_diff(along, travel) <= 90 else (along + 180) % 360
    return {'lat': line[i][0], 'lon': line[i][1], 'type': 'through', 'street': via['street'],
            'heading': round(heading), 'heading_tolerance': 60}


def valhalla_route(endpoint, locations):
    body = {'locations': locations, 'costing': 'bus', 'roundabout_exits': True,
            'directions_options': {'language': 'it-IT', 'units': 'kilometers'}}
    req = urllib.request.Request(endpoint.rstrip('/') + '/route', json.dumps(body).encode(),
                                 {'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=60) as reply:
        trip = json.load(reply)['trip']
    shape, maneuvers = [], []
    for leg in trip['legs']:
        pts = [[round(lat, 6), round(lon, 6)] for lat, lon in road.decode_polyline(leg['shape'], 6)]
        offset = len(shape) - (1 if shape else 0)
        shape += pts[1:] if shape else pts
        for m in leg['maneuvers']:
            maneuvers.append({**m, 'begin_shape_index': m['begin_shape_index'] + offset})
    return shape, maneuvers


def splice(base, routed, closed):
    """Official points before the detour + routed detour + official points after it."""
    before, after = base[:closed[0] + 1], base[closed[1]:]
    d_before, d_after = road.cumulative(before), road.cumulative(after)
    if road.project(routed[0], before, d_before)[0] > ON_BASE_M:
        raise SystemExit('Il percorso calcolato non parte sul GPX ufficiale')
    if road.project(routed[-1], after, d_after)[0] > ON_BASE_M:
        raise SystemExit('Il percorso calcolato non termina sul GPX ufficiale')
    k = 0
    while k + 1 < len(routed) and road.project(routed[k + 1], before, d_before)[0] <= ON_BASE_M:
        k += 1
    j = len(routed) - 1
    while j - 1 > k and road.project(routed[j - 1], after, d_after)[0] <= ON_BASE_M:
        j -= 1
    leave_at = road.project(routed[k], before, d_before)[1]
    rejoin_local = road.project(routed[j], after, d_after)[1]
    i_leave = max(i for i, d in enumerate(d_before) if d <= leave_at)
    i_rejoin = min(i for i, d in enumerate(d_after) if d >= rejoin_local)
    points = before[:i_leave + 1] + routed[k + 1:j] + after[i_rejoin:]
    base_d = road.cumulative(base)
    return points, {'leaveAtM': round(leave_at), 'rejoinAtM': round(base_d[closed[1]] + rejoin_local),
                    'baseLengthM': round(base_d[-1]), 'routedFrom': k, 'routedTo': j}


def guidance_for(route, endpoint, safety):
    data, attempts = road.annotate_route(route, endpoint, safety)
    if not data:
        return None, attempts
    data = road.refine_roundabouts(route, data, endpoint)
    ranges = data['coverage']['ranges']
    data['speedLimits'] = [[a, b, *rest] for a, b, *rest in data['speedLimits'] if any(lo <= a < b <= hi for lo, hi in ranges)]
    cameras = []
    for camera in sorted(data['roadCameras'], key=lambda c: c['at']):
        if any(lo <= camera['at'] <= hi for lo, hi in ranges) and not any(
                c['id'] == camera['id'] and abs(c['at'] - camera['at']) < 25 for c in cameras):
            cameras.append(camera)
    data['roadCameras'] = cameras
    import road_safety
    data['speedLimitPolicy'] = road_safety.SPEED_LIMIT_POLICY
    data['generatedAt'] = datetime.now(timezone.utc).isoformat()
    return data, attempts


def build_detour(source, detour, catalog, endpoint, ways, safety, report):
    base = next(r for r in catalog if r['id'] == detour['base'])
    pts = base['points']
    a, b = detour['cut']['from'], detour['cut']['to']
    closed = detour['closed']
    if not (0 <= a < closed[0] < closed[1] < b < len(pts)):
        raise SystemExit(f"{source['number']}/{base['id']}: indici cut/closed non coerenti")
    start = {'lat': pts[a][0], 'lon': pts[a][1], 'type': 'break',
             'heading': round(bearing(pts[a], pts[min(a + 3, len(pts) - 1)])), 'heading_tolerance': 45}
    end = {'lat': pts[b][0], 'lon': pts[b][1], 'type': 'break'}
    anchors = [pts[a]] + [v['near'] for v in detour['via']] + [pts[b]]
    vias = [snap_via(v, ways, anchors[i], anchors[i + 2]) for i, v in enumerate(detour['via'])]
    routed, maneuvers = valhalla_route(endpoint, [start, *vias, end])
    # Base cut [a, b] only: splice works on the official points around it.
    sub = pts[a:b + 1]
    points_sub, info = splice(sub, routed, [closed[0] - a, closed[1] - a])
    points = pts[:a] + points_sub + pts[b + 1:]
    base_d = road.cumulative(pts)
    info['leaveAtM'] += round(base_d[a]); info['rejoinAtM'] += round(base_d[a])
    # Checks: named streets in order, no U-turn, away from the closed stretch.
    streets = []
    for m in maneuvers:
        for name in m.get('street_names') or []:
            if not streets or streets[-1] != name:
                streets.append(name)
    order, pos = [], 0
    for v in detour['via']:
        hit = next((i for i in range(pos, len(streets)) if norm(streets[i]) == norm(v['street'])), None)
        order.append({'street': v['street'], 'found': hit is not None})
        if hit is not None:
            pos = hit + 1
    uturns = [m.get('instruction') for m in maneuvers if m.get('type') in (12, 13)]
    closed_pts = pts[closed[0]:closed[1] + 1]
    detour_pts = routed[info['routedFrom']:info['routedTo'] + 1]
    clearance = min(min(road.distance(p, q) for q in closed_pts) for p in detour_pts)
    rid = int(source['number']) * 1000 + base['id']
    row = {'id': rid, 'base': base['id'], 'name': base['name'], 'streets': streets, 'order': order,
           'uturns': uturns, 'closedClearanceM': round(clearance),
           'instructions': [m.get('instruction') for m in maneuvers], **info,
           'detourLengthM': round(road.cumulative(points)[-1])}
    report.append(row)
    print(json.dumps(row, ensure_ascii=False, indent=1), flush=True)
    problems = [f"strada non usata: {o['street']}" for o in order if not o['found']]
    if uturns:
        problems.append('inversione a U nel percorso calcolato')
    if clearance < CLOSED_CLEARANCE_M:
        problems.append(f'passa a {clearance:.0f} m dal tratto chiuso')
    if problems:
        raise SystemExit(f"{source['number']}/{base['id']}: " + '; '.join(problems))
    route = {'id': rid, 'category': base['category'], 'line': base['line'], 'variant': base['variant'],
             'name': base['name'] + ' · deviazione Com. ' + str(source['number']),
             'filename': base['filename'] + ' (deviazione ' + str(source['number']) + ')', 'points': points}
    guidance, attempts = guidance_for(route, endpoint, safety)
    row['guidance'] = 'none' if not guidance else ('complete' if guidance['coverage']['complete'] else f"partial {guidance['coverage']['percent']}%")
    if guidance:
        row['turns'] = [[round(t['at']), t['text']] for t in guidance['turns']]
        print('Manovre:', json.dumps(row['turns'], ensure_ascii=False, indent=1), flush=True)
    else:
        print('Nessuna istruzione stradale valida:', attempts[-3:], flush=True)
    return {**route, 'base': base['id'], 'communication': int(source['number']),
            'direction': detour['direction'], 'text': detour['text'],
            'leaveAtM': info['leaveAtM'], 'rejoinAtM': info['rejoinAtM'], 'baseLengthM': info['baseLengthM'],
            'guidance': guidance}


def statuses(sources):
    by_number = {int(s['number']): s for s in sources}
    out = {}
    for s in sources:
        for old in s.get('replaces', []):
            if old not in by_number:
                raise SystemExit(f"{s['number']}: sostituisce la n.{old}, che non è in deviazioni-src")
            out[int(old)] = {'status': 'sostituita', 'replacedBy': int(s['number'])}
    return out


def preview(route, base, closed, path):
    """PNG with OpenStreetMap tiles: official GPX grey, closed stretch red, detour blue."""
    from PIL import Image, ImageDraw
    import io
    pts = route['points']
    lats = [p[0] for p in pts if p not in base] + [p[0] for p in closed]
    lons = [p[1] for p in pts if p not in base] + [p[1] for p in closed]
    pad = 0.006
    s, n, w, e = min(lats) - pad, max(lats) + pad, min(lons) - pad, max(lons) + pad
    z = 14

    def xy(lat, lon):
        x = (lon + 180) / 360 * 2 ** z * 256
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** z * 256
        return x, y
    x0, y0 = xy(n, w); x1, y1 = xy(s, e)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    img = Image.new('RGB', ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256), 'white')
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            req = urllib.request.Request(f'https://tile.openstreetmap.org/{z}/{tx}/{ty}.png',
                                         headers={'User-Agent': 'LineaPilot detour preview (github.com/aumentandolenoie/busnav)'})
            with urllib.request.urlopen(req, timeout=30) as r:
                img.paste(Image.open(io.BytesIO(r.read())).convert('RGB'), ((tx - tx0) * 256, (ty - ty0) * 256))
    draw = ImageDraw.Draw(img, 'RGBA')

    def line(points, color, width):
        coords = [(xy(*p)[0] - tx0 * 256, xy(*p)[1] - ty0 * 256) for p in points]
        draw.line(coords, fill=color, width=width, joint='curve')
    line(base, (90, 90, 90, 150), 5)
    line(closed, (220, 30, 30, 220), 7)
    line(pts, (25, 90, 230, 230), 5)
    ax, ay = xy(*pts[0]); draw.text((10, 10), route['name'] + '  (grigio: normale, rosso: chiuso, blu: deviazione)', fill='black')
    img = img.crop((int(x0 - tx0 * 256), int(y0 - ty0 * 256), int(x1 - tx0 * 256), int(y1 - ty0 * 256)))
    img.save(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--endpoint', required=True)
    parser.add_argument('--pbf', required=True)
    parser.add_argument('--road-safety', type=pathlib.Path)
    parser.add_argument('--no-preview', action='store_true')
    args = parser.parse_args()
    import road_safety
    safety = road_safety.index_catalog(json.loads(args.road_safety.read_text())) if args.road_safety else None
    sources = load_sources()
    catalog = road.load_catalog()
    names = {v['street'] for s in sources for d in s.get('detours', []) for v in d['via']}
    ways = street_index(args.pbf, names)
    for name, lines in ways.items():
        print(f'Strada "{name}": {len(lines)} tratti OSM', flush=True)
    status = statuses(sources)
    previous = json.loads(OUT.read_text()) if OUT.exists() else {}
    REPORTS.mkdir(parents=True, exist_ok=True)
    report, routes, communications = [], [], []
    for s in sources:
        number = int(s['number'])
        st = status.get(number, {'status': 'valida'})
        detours = []
        if st['status'] == 'valida':
            for d in s.get('detours', []):
                route = build_detour(s, d, catalog, args.endpoint, ways, safety, report)
                routes.append(route)
                detours.append({'route': route['id'], 'base': d['base'], 'direction': d['direction']})
                if not args.no_preview:
                    base = next(r for r in catalog if r['id'] == d['base'])['points']
                    try:
                        preview(route, base, base[d['closed'][0]:d['closed'][1] + 1], REPORTS / f"{route['id']}.png")
                    except Exception as error:  # the map picture is only a check aid
                        print('Anteprima non creata:', error, flush=True)
        communications.append({k: s[k] for k in ('number', 'date', 'title', 'lines', 'summary', 'windowsText', 'windows',
                                                  'replaces', 'relation', 'windowsNote', 'extends') if k in s}
                              | st | {'detours': detours})
    data = {'version': 1, 'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'communications': communications, 'routes': routes}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    (REPORTS / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(f'deviazioni.json: {len(communications)} comunicazioni, {len(routes)} GPX di deviazione '
          f'(prima: {len(previous.get("routes", []))})', flush=True)


if __name__ == '__main__':
    main()
