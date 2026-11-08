#!/usr/bin/env python3
"""Valhalla road annotation for Academy GPX. NEVER produces a replacement route.

Use a private/self-hosted Valhalla POST /trace_route API. Only guarded, matched
Italian instructions are exported; any doubt rejects the entire enrichment.
GPX points in official-routes.json are immutable and never written by this tool.
"""
import argparse
import json
import math
import pathlib
import urllib.request
import urllib.error

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAX_INPUT_POINTS = 16000
MAX_DISTANCE_M = 45.0
MAX_POINT_DISTANCE_M = 85.0
MAX_LENGTH_DEVIATION = 0.07
# Valhalla types: left/right turns and roundabout exit; depart/arrive/continue
# are deliberately excluded to prevent false instructions along the GPX.
MANEUVER_TYPES = {
    9: "right", 10: "right", 11: "right",
    14: "left", 15: "left", 16: "left",
    18: "right", 19: "left", 20: "right", 21: "left",
    23: "right", 24: "left", 26: "roundabout",
}


def load_catalog():
    original=(ROOT/'official-routes.json').read_bytes()
    supplement_path=ROOT/'academy-supplemental-routes.json'
    extra=supplement_path.read_bytes() if supplement_path.exists() else b'[]'
    return json.loads(original)+json.loads(extra)


def catalog_digest():
    import hashlib
    original=(ROOT/'official-routes.json').read_bytes()
    supplement_path=ROOT/'academy-supplemental-routes.json'
    if not supplement_path.exists():return hashlib.sha256(original).hexdigest()
    return hashlib.sha256(original+b'\0'+supplement_path.read_bytes()).hexdigest()

def fingerprint(points):
    """Same FNV32 fingerprint as the browser, using ALL official GPX points."""
    h = 2166136261
    for lat, lng in points:
        for value in (round_coord(lat), round_coord(lng)):
            h = ((h ^ (value & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    return f"{len(points)}-{h:08x}"


def round_coord(value):
    # Coordinates are in Veneto (positive); Math.round parity with JavaScript.
    return math.floor(value * 100000 + 0.5)


def decode_polyline(value, precision=6):
    result, numbers, index = [], [], 0
    while index < len(value):
        shift = 0
        number = 0
        while True:
            if index >= len(value):
                raise ValueError("Truncated Valhalla polyline")
            code = ord(value[index]) - 63
            index += 1
            number |= (code & 0x1f) << shift
            shift += 5
            if code < 0x20:
                break
        numbers.append((number >> 1) ^ -(number & 1))
    if len(numbers) % 2:
        raise ValueError("Unpaired polyline coordinate")
    lat = lon = 0
    scale = 10 ** precision
    for a, b in zip(numbers[::2], numbers[1::2]):
        lat += a
        lon += b
        result.append((lat / scale, lon / scale))
    return result


def distance(a, b):
    lat = math.radians((a[0] + b[0]) / 2)
    x = (b[1] - a[1]) * 111320 * math.cos(lat)
    y = (b[0] - a[0]) * 111320
    return math.hypot(x, y)


def cumulative(points):
    values = [0.0]
    for i in range(1, len(points)):
        values.append(values[-1] + distance(points[i - 1], points[i]))
    return values


def project(p, points, distances):
    best = (float("inf"), 0.0)
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        latitude = (p[0] + a[0]) / 2
        factor = math.cos(math.radians(latitude)) * 111320
        dx, dy = (b[1] - a[1]) * factor, (b[0] - a[0]) * 111320
        px, py = (p[1] - a[1]) * factor, (p[0] - a[0]) * 111320
        length = dx * dx + dy * dy
        t = max(0.0, min(1.0, (px * dx + py * dy) / length)) if length else 0.0
        deviation = math.hypot(px - t * dx, py - t * dy)
        if deviation < best[0]:
            best = (deviation, distances[i] + t * (distances[i+1] - distances[i]))
    return best


def downsample(points, limit=MAX_INPUT_POINTS):
    if len(points) <= limit:
        return points
    # This is only for the trace API. The canonical route is NEVER simplified.
    raise ValueError("Trace exceeds supported point limit; never discard obligatory GPX bends")


def trace_request(points, precise=False):
    result = {
        "shape": [{"lat": lat, "lon": lng} for lat, lng in downsample(points)],
        "shape_match": "map_snap",
        "costing": "bus",
        "roundabout_exits": True,
        "directions_options": {"language": "it-IT", "units": "kilometers", "directions_type": "instructions"},
    }
    if precise:
        result["trace_options"] = {"gps_accuracy": 5, "search_radius": 35, "interpolation_distance": 1, "turn_penalty_factor": 0}
    return result


def get_response(endpoint, points, precise=False):
    if not endpoint.startswith(("https://", "http://localhost:", "http://127.0.0.1:")):
        raise ValueError("Use HTTPS or a localhost Valhalla instance")
    uri = endpoint.rstrip("/")
    if not uri.endswith("/trace_route"):
        uri += "/trace_route"
    req = urllib.request.Request(
        uri, json.dumps(trace_request(points,precise)).encode("utf8"),
        {"Content-Type": "application/json", "X-Client-Id": "lineapilot-academy-validation"},
        method="POST")
    with urllib.request.urlopen(req, timeout=30) as reply:
        result = json.load(reply)
    # Roundabout counting depends on driving-side flags, independently of shape.
    attributes = trace_request(points, precise)
    attributes["filters"] = {"action":"include","attributes":["edge.drive_on_right","edge.roundabout"]}
    attr_req = urllib.request.Request(uri.rsplit("/",1)[0]+"/trace_attributes",json.dumps(attributes).encode("utf8"),
        {"Content-Type":"application/json","X-Client-Id":"lineapilot-academy-validation"},method="POST")
    with urllib.request.urlopen(attr_req,timeout=30) as reply:
        attrs = json.load(reply)
    edges = attrs.get("edges",[])
    if not edges or any(edge.get("drive_on_right") is not True for edge in edges):
        raise ValueError("Driving-side graph validation failed: Italian trace must drive on right")
    result["_drivingSideValidated"] = True
    return result


def sampled(points, spacing=25):
    output = [points[0]]
    for a, b in zip(points, points[1:]):
        steps = max(1, math.ceil(distance(a,b)/spacing))
        for step in range(1,steps+1):
            t = step/steps
            output.append((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))
    return output


def ordered_projection(points, official, distances):
    # Spatial index accelerates large catalogs. Candidate segment projection is
    # exact; ordered tie-breaking disambiguates crossings/repeated termini.
    try:
        from scipy.spatial import cKDTree
    except ImportError:
        return [project(p, official, distances) for p in points]
    latitude = math.radians(official[0][0])
    scale = (111320,111320*math.cos(latitude))
    dense, segment = [], []
    for i,(a,b) in enumerate(zip(official,official[1:])):
        steps = max(1,math.ceil(distance(a,b)/35))
        for j in range(steps+1):
            t=j/steps
            dense.append(((a[0]+(b[0]-a[0])*t)*scale[0],(a[1]+(b[1]-a[1])*t)*scale[1]))
            segment.append(i)
    tree=cKDTree(dense)
    result=[]
    previous=0
    for p in points:
        _, indices=tree.query((p[0]*scale[0],p[1]*scale[1]),k=min(16,len(dense)))
        candidates=[]
        for i in {segment[int(j)] for j in indices}:
            deviation,at=project(p,official[i:i+2], [0,distances[i+1]-distances[i]])
            candidates.append((deviation,distances[i]+at))
        minimum=min(x[0] for x in candidates)
        forward=[x for x in candidates if x[0]<=minimum+3 and x[1]>=previous-30]
        hit=min(forward,key=lambda x:abs(x[1]-previous)) if forward else min(candidates)
        previous=max(previous,hit[1]); result.append(hit)
    return result

def roundabout_geometry(maneuver, matched, projected, official, official_dist):
    start, end = maneuver.get("begin_shape_index"), maneuver.get("end_shape_index")
    if type(start) is not int or type(end) is not int or not 0 <= start < end < len(matched):
        return False
    begin_at, end_at = projected[start][1], projected[end][1]
    if end_at <= begin_at or end_at-begin_at > 1200:
        return False
    # Include the departure arm: adjacent exits can lie within the global 85m
    # tolerance yet require a different exit number. Limit local error to 12m.
    lo, hi = max(0,start-1), min(len(matched)-1,end+1)
    ring = matched[lo:hi+1]
    ring_dist = cumulative(ring)
    official_part = [p for p,d in zip(official,official_dist) if projected[lo][1] <= d <= projected[hi][1]]
    if len(official_part)<2:
        return False
    a = [x[0] for x in ordered_projection(sampled(ring,5),official,official_dist)]
    b = [x[0] for x in ordered_projection(sampled(official_part,5),ring,ring_dist)]
    return max(a+b) <= 12


def convert(route, response, allow_empty=False, strict_local=False):
    official = [(float(a), float(b)) for a,b in route["points"]]
    if len(official) < 2:
        raise ValueError("Missing official GPX")
    trip = response.get("trip") or {}
    if not str(trip.get("language", "")).lower().startswith("it"):
        raise ValueError("Valhalla did not return Italian narrative")
    legs = trip.get("legs", [])
    if len(legs) != 1:
        raise ValueError("Multi-leg trace needs manual review")
    leg = legs[0]
    matched = decode_polyline(leg["shape"])
    if len(matched) < 2:
        raise ValueError("Empty matched shape")
    official_dist = cumulative(official)
    matched_dist = cumulative(matched)
    length_tolerance=max(8 if strict_local else 90, official_dist[-1]*MAX_LENGTH_DEVIATION)
    point_tolerance=min(35, max(8,official_dist[-1]*.15)) if strict_local else MAX_POINT_DISTANCE_M
    p95_tolerance=min(20,max(5,official_dist[-1]*.1)) if strict_local else MAX_DISTANCE_M
    endpoint_tolerance=min(20,max(3,official_dist[-1]*.07)) if strict_local else 65
    if abs(official_dist[-1] - matched_dist[-1]) > length_tolerance:
        raise ValueError(f"Road shape length differs from obligatory Academy GPX: official={official_dist[-1]:.1f}m matched={matched_dist[-1]:.1f}m")
    # Verify direction and continuity, not merely a high GPS proximity score.
    projected = ordered_projection(matched, official, official_dist)
    dense_matched = sampled(matched)
    dense_errors = [x[0] for x in ordered_projection(dense_matched, official, official_dist)]
    reverse_errors = [x[0] for x in ordered_projection(sampled(official), matched, matched_dist)]
    if max(dense_errors + reverse_errors) > point_tolerance:
        raise ValueError(f"Road trace skips or leaves an obligatory GPX segment: forward={max(dense_errors):.1f}m reverse={max(reverse_errors):.1f}m")
    errors = sorted(x[0] for x in projected)
    if errors[-1] > point_tolerance or errors[int((len(errors)-1)*0.95)] > p95_tolerance:
        raise ValueError("Road geometry deviates from obligatory Academy GPX")
    if projected[0][1] > endpoint_tolerance or official_dist[-1] - projected[-1][1] > endpoint_tolerance:
        raise ValueError("Matched trace does not cover Academy endpoints")
    # Account for route intersections: match progression MUST NOT run backwards.
    previous = -1
    for _, at in projected:
        if at + 100 < previous:
            raise ValueError("Valhalla reversed or shortcut an official Academy segment")
        previous = max(previous, at)
    maneuvers = []
    roundabout_audit = []
    for maneuver in leg.get("maneuvers", []):
        typ = maneuver.get("type")
        if typ not in MANEUVER_TYPES:
            continue
        index = maneuver.get("begin_shape_index")
        if not isinstance(index, int) or index < 0 or index >= len(projected):
            continue
        deviation, at = projected[index]
        instruction = str(maneuver.get("instruction", "")).strip()
        if deviation > min(30,point_tolerance) or at < (15 if strict_local else 60) or at > official_dist[-1] - (10 if strict_local else 40):
            continue
        if not instruction or len(instruction) > 160:
            continue
        if maneuvers and at <= maneuvers[-1]["at"]:
            continue
        if typ == 26:
            exit_count = maneuver.get("roundabout_exit_count")
            trustworthy = (type(exit_count) is int and 1 <= exit_count <= 20
                and response.get("_drivingSideValidated") is True
                and roundabout_geometry(maneuver,matched,projected,official,official_dist))
            roundabout_audit.append({"at":round(at),"reportedExit":exit_count,"numberVerified":trustworthy})
            ordinal = {1:"prima",2:"seconda",3:"terza",4:"quarta",5:"quinta",6:"sesta",7:"settima",8:"ottava",9:"nona",10:"decima"}
            instruction = (f"Alla rotonda, prendi la {ordinal.get(exit_count,str(exit_count)+'ª')} uscita" if trustworthy
                else "Alla rotonda, segui il percorso GPX ufficiale")
            kind = "roundabout"
            side = "rotatoria"
        else:
            kind = "turn"
            side = "sinistra" if MANEUVER_TYPES[typ] == "left" else "destra"
        maneuvers.append({"at": int(round(at)), "kind": kind, "side": side, "text": instruction})
    if not maneuvers and not allow_empty:
        raise ValueError("Valhalla found no road maneuvers: keep geometric fallback")
    return {
        "version": 1, "source": "valhalla-osm", "language": "it-IT",
        "academyId": str(route["id"]),
        "fingerprint": fingerprint(official),
        "officialLengthM": int(round(official_dist[-1])),
        "validation": {
            "passed": True, "maxDeviationM": round(errors[-1], 1),
            "p95DeviationM": round(errors[int((len(errors)-1)*0.95)], 1),
            "matchedLengthM": int(round(matched_dist[-1]))},
        "turns": maneuvers, "noManeuvers": not bool(maneuvers),
        "roundaboutAudit": roundabout_audit, "drivingSideValidated":response.get("_drivingSideValidated") is True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--route-id", required=True, help="Exact official-routes.json ID")
    parser.add_argument("--endpoint", help="Private Valhalla server, e.g. https://example.org/trace_route")
    parser.add_argument("--response-file", type=pathlib.Path, help="Offline Valhalla response for tests")
    parser.add_argument("--output-dir", type=pathlib.Path, default=ROOT / "road-guidance")
    args = parser.parse_args()
    if not args.endpoint and not args.response_file:
        parser.error("--endpoint or --response-file is required")
    catalog = load_catalog()
    route = next((x for x in catalog if str(x["id"]) == args.route_id), None)
    if not route:
        parser.error("Unknown Academy GPX ID: " + args.route_id)
    if not all(c.isascii() and (c.isalnum() or c in "-_") for c in args.route_id):
        parser.error("Academy ID contains unsupported filename characters")
    response = json.loads(args.response_file.read_text(encoding="utf8")) if args.response_file else get_response(args.endpoint, route["points"])
    guidance = convert(route, response)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output_dir / (str(route["id"]) + ".json")
    output.write_text(json.dumps(guidance, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf8")
    print(f"OK: {len(guidance['turns'])} Italian maneuvers for Academy {route['id']}: {output}")
    print("The official GPX was NEVER modified.")





def merged_ranges(ranges, total):
    merged=[]
    for start,end in sorted(ranges):
        start=max(0.0,start); end=min(total,end)
        if end<=start: continue
        if merged and start<=merged[-1][1]+0.01:
            merged[-1][1]=max(merged[-1][1],end)
        else: merged.append([start,end])
    return merged


def coverage_for(ranges,total):
    ranges=merged_ranges(ranges,total)
    gaps=[]; previous=0.0
    for start,end in ranges:
        if start>previous+0.01: gaps.append([previous,start])
        previous=end
    if previous<total-0.01: gaps.append([previous,total])
    covered=sum(b-a for a,b in ranges)
    return {"complete":not gaps,"coveredM":round(covered,1),"totalM":round(total,1),
            "percent":round(covered/max(1,total)*100,2),"ranges":ranges,"gaps":gaps}


def annotate_route(route,endpoint):
    """Try whole-trace matching, precision tuning, then overlapping GPX windows.

    Every accepted window passes the SAME strict bidirectional geometry checks.
    Failed intervals remain gaps: no invented instructions or replacement route.
    """
    points=route['points']; distances=cumulative(points); total=distances[-1]
    attempts=[]
    def attempt(part,label,precise,strict_local=False):
        try:
            data=convert(part,get_response(endpoint,part['points'],precise=precise),allow_empty=True,strict_local=strict_local)
            attempts.append({'strategy':label,'accepted':True,'turns':len(data['turns'])})
            return data
        except Exception as error:
            attempts.append({'strategy':label,'accepted':False,'reason':str(error)[:350]})
            return None
    for precise,label in [(False,'whole-default'),(True,'whole-precise')]:
        data=attempt(route,label,precise)
        if data:
            data['coverage']=coverage_for([[0,total]],total)
            data['solution']=label
            return data,attempts
    accepted=[]
    def window(start,end,depth=0):
        if end-start<1: return
        part={**route,'points':points[start:end+1]}
        strict_local=distances[end]-distances[start]<800
        data=attempt(part,f'window-{start}-{end}-precise'+('-strict' if strict_local else ''),True,strict_local)
        if not data: data=attempt(part,f'window-{start}-{end}-default'+('-strict' if strict_local else ''),False,strict_local)
        if data:
            data['coreMargins']=[15 if strict_local and start>0 else 0,10 if strict_local and end<len(points)-1 else 0]
            accepted.append((start,end,data));return
        if depth>=6 or distances[end]-distances[start]<180 or len(attempts)>180:return
        middle=(distances[start]+distances[end])/2
        left=next((i for i in range(start+1,end) if distances[i]>=middle+min(60,(distances[end]-distances[start])*.15)),end-1)
        right=next((i for i in range(start+1,end) if distances[i]>=middle-min(60,(distances[end]-distances[start])*.15)),start+1)
        if left>=end or right<=start:return
        window(start,left,depth+1);window(right,end,depth+1)
    start=0
    while start<len(points)-1:
        end=next((i for i in range(start+1,len(points)) if distances[i]-distances[start]>=2500),len(points)-1)
        if total-distances[end]<350:end=len(points)-1
        window(start,end)
        if end==len(points)-1:break
        following=next((i for i in range(start+1,end+1) if distances[i]>=distances[end]-350),end)
        start=max(start+1,following)
    if not accepted:return None,attempts
    coverage=coverage_for([[distances[a]+d['coreMargins'][0],distances[b]-d['coreMargins'][1]] for a,b,d in accepted],total)
    maneuvers=[]
    for start,end,data in accepted:
        for turn in data['turns']:
            candidate={**turn,'at':turn['at']+distances[start]}
            if not any(a<=candidate['at']<=b for a,b in coverage['ranges']):continue
            if not any(abs(candidate['at']-t['at'])<8 and candidate['text'].strip().lower()==t['text'].strip().lower() for t in maneuvers):
                maneuvers.append(candidate)
    maneuvers.sort(key=lambda t:t['at'])
    # Collocated, conflicting instructions cannot both be shown.
    unique=[]
    for turn in maneuvers:
        if unique and abs(turn['at']-unique[-1]['at'])<1:continue
        unique.append(turn)
    data={
        'version':1,'source':'valhalla-osm','language':'it-IT','academyId':str(route['id']),
        'fingerprint':fingerprint(points),'officialLengthM':round(total),
        'validation':{'passed':True,'maxDeviationM':max(d['validation']['maxDeviationM'] for _,_,d in accepted),
                      'p95DeviationM':max(d['validation']['p95DeviationM'] for _,_,d in accepted)},
        'turns':unique,'noManeuvers':not bool(unique),'coverage':coverage,'solution':'validated-windows',
        'drivingSideValidated':all(d.get('drivingSideValidated') for _,_,d in accepted),
        'roundaboutAudit':[{**r,'at':r['at']+distances[a]} for a,_,d in accepted for r in d.get('roundaboutAudit',[])],
    }
    return data,attempts

if __name__ == "__main__":
    main()

