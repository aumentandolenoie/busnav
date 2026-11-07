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
MAX_INPUT_POINTS = 550
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
    indices = sorted({round(i * (len(points) - 1) / (limit - 1)) for i in range(limit)})
    return [points[i] for i in indices]


def trace_request(points):
    return {
        "shape": [{"lat": lat, "lon": lng} for lat, lng in downsample(points)],
        "shape_match": "map_snap",
        "costing": "bus",
        "directions_options": {"language": "it-IT", "units": "kilometers", "directions_type": "instructions"},
    }


def get_response(endpoint, points):
    if not endpoint.startswith(("https://", "http://localhost:", "http://127.0.0.1:")):
        raise ValueError("Use HTTPS or a localhost Valhalla instance")
    uri = endpoint.rstrip("/")
    if not uri.endswith("/trace_route"):
        uri += "/trace_route"
    req = urllib.request.Request(
        uri, json.dumps(trace_request(points)).encode("utf8"),
        {"Content-Type": "application/json", "X-Client-Id": "lineapilot-academy-validation"},
        method="POST")
    with urllib.request.urlopen(req, timeout=90) as reply:
        return json.load(reply)


def convert(route, response):
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
    if abs(official_dist[-1] - matched_dist[-1]) > max(90, official_dist[-1] * MAX_LENGTH_DEVIATION):
        raise ValueError("Road shape length differs from obligatory Academy GPX")
    # Verify direction and continuity, not merely a high GPS proximity score.
    projected = [project(p, official, official_dist) for p in matched]
    errors = sorted(x[0] for x in projected)
    if errors[-1] > MAX_POINT_DISTANCE_M or errors[int((len(errors)-1)*0.95)] > MAX_DISTANCE_M:
        raise ValueError("Road geometry deviates from obligatory Academy GPX")
    if projected[0][1] > 65 or official_dist[-1] - projected[-1][1] > 65:
        raise ValueError("Matched trace does not cover Academy endpoints")
    # Account for route intersections: match progression MUST NOT run backwards.
    previous = -1
    for _, at in projected:
        if at + 100 < previous:
            raise ValueError("Valhalla reversed or shortcut an official Academy segment")
        previous = max(previous, at)
    maneuvers = []
    for maneuver in leg.get("maneuvers", []):
        typ = maneuver.get("type")
        if typ not in MANEUVER_TYPES:
            continue
        index = maneuver.get("begin_shape_index")
        if not isinstance(index, int) or index < 0 or index >= len(projected):
            continue
        deviation, at = projected[index]
        instruction = str(maneuver.get("instruction", "")).strip()
        if deviation > 30 or at < 60 or at > official_dist[-1] - 40:
            continue
        if not instruction or len(instruction) > 160:
            continue
        if maneuvers and at < maneuvers[-1]["at"] + 55:
            continue
        if typ in (26, 27):
            kind = "roundabout"
            side = "rotatoria"
        else:
            kind = "turn"
            side = "sinistra" if MANEUVER_TYPES[typ] == "left" else "destra"
        maneuvers.append({"at": int(round(at)), "kind": kind, "side": side, "text": instruction})
    if not maneuvers:
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
        "turns": maneuvers,
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
    catalog = json.loads((ROOT / "official-routes.json").read_text(encoding="utf8"))
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


if __name__ == "__main__":
    main()
