"""Extract bus speed limits (with their reliability) and fixed speed / red-light cameras from OSM."""
import argparse
import bisect
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path


SPEED_LIMIT_POLICY = 3

# Reliability of a displayed limit, from the OSM evidence on the way.
TIER_SIGN = 1     # source:maxspeed=sign/markings: value read from a road sign
TIER_MAPPED = 2   # explicit numeric maxspeed, no stated source
TIER_LEGAL = 3    # Italian legal default for the mapped road context (IT:urban, IT:rural, ...)
TIER_NAMES = {TIER_SIGN: "sign", TIER_MAPPED: "mapped", TIER_LEGAL: "legal"}

# Codice della Strada art. 142 c.1 general limits for the OSM context codes.
ITALIAN_DEFAULTS = {"it:urban": 50, "it:rural": 90, "it:trunk": 110, "it:motorway": 130}
# Art. 142 c.3 lett. f: autobus e filobus oltre 8 t: 80 km/h fuori dei centri
# abitati, 100 km/h in autostrada. Busitalia vehicles are all above 8 t, so the
# limit shown to the driver is the road limit capped by the bus limit.
BUS_MOTORWAY_KMH = 100
BUS_OTHER_KMH = 80
MOTORWAY_HIGHWAYS = {"motorway", "motorway_link"}

# Tags that only describe the limit or concern other vehicles do not change it for a bus.
_METADATA = {"maxspeed:source", "maxspeed:type", "maxspeed:reason", "maxspeed:note",
             "maxspeed:advisory", "maxspeed:practical"}
_OTHER_VEHICLES = ("maxspeed:hgv", "maxspeed:goods", "maxspeed:trailer", "maxspeed:caravan",
                   "maxspeed:motorcycle", "maxspeed:moped", "maxspeed:mofa", "maxspeed:agricultural",
                   "maxspeed:hazmat", "maxspeed:motorcar", "maxspeed:motorhome")
_BUS_KEYS = ("maxspeed:bus", "maxspeed:coach", "maxspeed:psv")


def validator_digest():
    scripts = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for name in ("enrich_road_guidance.py", "road_safety.py", "enrich_catalog.py"):
        digest.update(name.encode() + b"\0" + (scripts / name).read_bytes() + b"\0")
    return digest.hexdigest()


def _kmh(value):
    match = re.fullmatch(r"([0-9]{1,3})(?:\s*km/h)?", (value or "").strip().lower())
    return int(match[1]) if match else None


def classify_speed(tags, highway=""):
    """Return (bus limit km/h, reliability tier) for an unconditional limit, else None.

    Directional, conditional, per-lane or variable limits are rejected: one value
    could be wrong for the direction or the moment in which the bus drives.
    """
    bus_value = None
    for key in tags:
        if not key.startswith("maxspeed:") or key in _METADATA:
            continue
        if any(key == prefix or key.startswith(prefix + ":") for prefix in _OTHER_VEHICLES):
            continue
        if key in _BUS_KEYS:
            value = _kmh(tags[key])
            if value is None or (bus_value is not None and bus_value != value):
                return None
            bus_value = value
            continue
        return None  # forward/backward/conditional/lanes/variable/bus:conditional/...
    sources = {tags[key].strip().lower() for key in ("source:maxspeed", "maxspeed:source", "maxspeed:type")
               if tags.get(key, "").strip()}
    legal = sources & ITALIAN_DEFAULTS.keys()
    signed = sources & {"sign", "markings"}
    raw = (tags.get("maxspeed") or "").strip()
    if raw.lower() in ITALIAN_DEFAULTS:
        if signed or (legal and legal != {raw.lower()}):
            return None
        road_value, tier = ITALIAN_DEFAULTS[raw.lower()], TIER_LEGAL
    elif raw:
        road_value = _kmh(raw)
        if road_value is None:
            return None  # none, walk, mph, multiple values ...
        if signed and legal:
            return None  # contradictory evidence
        if legal:
            if len(legal) != 1 or ITALIAN_DEFAULTS[next(iter(legal))] != road_value:
                return None  # value does not match the stated legal context
            tier = TIER_LEGAL
        elif signed:
            tier = TIER_SIGN if sources <= {"sign", "markings"} else TIER_MAPPED
        else:
            tier = TIER_MAPPED
    elif bus_value is not None:
        road_value, tier = bus_value, TIER_MAPPED
    else:
        return None
    value = min(road_value, bus_value) if bus_value is not None else road_value
    cap = BUS_MOTORWAY_KMH if highway in MOTORWAY_HIGHWAYS else BUS_OTHER_KMH
    value = min(value, cap)
    return (value, tier) if 5 <= value <= 130 else None


def explicit_speed(tags, highway=""):
    """Bus limit in km/h for the way, or None (see classify_speed)."""
    result = classify_speed(tags, highway)
    return result[0] if result else None


# Point cameras mapped as a single OSM node (far more common than enforcement
# relations). "speed" = fixed speed camera, "redLight" = red-light camera.
def point_camera_kind(tags):
    if tags.get("mobile") == "yes" or tags.get("temporary") == "yes":
        return None
    if tags.get("highway") == "speed_camera":
        return "speed"
    if tags.get("highway") == "red_light_camera":
        return "redLight"
    if tags.get("man_made") == "surveillance" and (
            tags.get("surveillance") == "red_light" or tags.get("surveillance:type") == "red_light_camera"):
        return "redLight"
    return None


def oneway_sense(tags):
    """+1 one-way along the way, -1 against it, 0 two-way."""
    value = (tags.get("oneway") or "").lower()
    if value in ("yes", "true", "1") or tags.get("junction") in ("roundabout", "circular") \
            or tags.get("highway") in ("motorway", "motorway_link"):
        return -1 if value == "-1" else 1
    return -1 if value == "-1" else 0


def point_camera_senses(direction, oneway):
    """Driving directions a camera node on a way applies to, and whether that is certain.

    Returns [(sense, certain)], sense +1 along the way nodes, -1 against them.
    direction=forward/backward is relative to the way: certain. A one-way road has a
    single possible direction: certain. direction=both: both, certain. Anything else
    (absent, degrees, compass points, whose meaning in OSM is ambiguous between the
    facing of the camera and the monitored traffic): both directions, NOT certain.
    """
    value = (direction or "").strip().lower()
    if value == "forward":
        return [(1, True)]
    if value == "backward":
        return [(-1, True)]
    if oneway:
        return [(oneway, True)]
    if value == "both":
        return [(1, True), (-1, True)]
    return [(1, False), (-1, False)]


def extract(pbf):
    import osmium

    relations = []
    needed = set()
    node_ways = defaultdict(list)
    limits = {}
    nodes = {}
    point_tags = {}          # camera node id -> (kind, direction tag, location)
    point_ways = defaultdict(list)   # camera node id -> [(way id, before ids, after ids, oneway)]

    class Relations(osmium.SimpleHandler):
        def relation(self, relation):
            tags = relation.tags
            kind = {"maxspeed": "speed", "traffic_signals": "redLight"}.get(tags.get("enforcement"))
            if tags.get("type") != "enforcement" or not kind:
                return
            if tags.get("mobile") == "yes" or tags.get("temporary") == "yes":
                return
            roles = {}
            for member in relation.members:
                if member.role not in ("from", "to", "device"):
                    continue
                if member.type != "n" or member.role in roles:
                    return
                roles[member.role] = member.ref
            if not {"from", "device"} <= roles.keys():
                return
            roles.setdefault("to", roles["device"])
            if roles["from"] == roles["to"]:
                return
            needed.update(roles.values())
            relations.append((relation.id, kind, roles))

    class PointCameras(osmium.SimpleHandler):
        def node(self, node):
            tags = {tag.k: tag.v for tag in node.tags}
            kind = point_camera_kind(tags)
            if kind and node.location.valid():
                point_tags[node.id] = (kind, tags.get("direction", ""), [node.location.lat, node.location.lon])

    class Ways(osmium.SimpleHandler):
        def way(self, way):
            tags = way.tags
            if not tags.get("highway"):
                return
            result = classify_speed({tag.k: tag.v for tag in tags if tag.k.startswith("maxspeed") or tag.k == "source:maxspeed"},
                                    tags.get("highway"))
            if result is not None:
                limits[str(way.id)] = list(result)
            refs = [node.ref for node in way.nodes]
            for index, ref in enumerate(refs):
                if ref in needed:
                    node_ways[ref].append(way.id)
                if ref in point_tags:
                    # Up to 4 nodes each side, nearest first, to find an approach point.
                    before, after = refs[max(0, index - 4):index][::-1], refs[index + 1:index + 5]
                    point_ways[ref].append((way.id, before, after, oneway_sense({t.k: t.v for t in tags})))

    class Nodes(osmium.SimpleHandler):
        def node(self, node):
            if node.id in needed and node.location.valid():
                if node.tags.get("mobile") != "yes" and node.tags.get("temporary") != "yes":
                    nodes[node.id] = [node.location.lat, node.location.lon]

    Relations().apply_file(pbf)
    PointCameras().apply_file(pbf)
    # A node that is already the device of an enforcement relation keeps the relation.
    for _, _, roles in relations:
        point_tags.pop(roles["device"], None)
    Ways().apply_file(pbf)
    for ref, entries in point_ways.items():
        for _, before, after, _ in entries:
            needed.update(before + after)
    Nodes().apply_file(pbf)
    cameras = []
    for identifier, kind, roles in relations:
        approach, departure, device = (roles[role] for role in ("from", "to", "device"))
        if not all(node in nodes for node in (approach, departure, device)):
            continue
        if not node_ways[approach] or not node_ways[departure]:
            continue
        cameras.append({"id": identifier, "kind": kind, "from": nodes[approach], "to": nodes[departure],
                        "device": nodes[device], "fromWays": node_ways[approach], "toWays": node_ways[departure]})
    relation_sites = len(cameras)
    cameras += point_cameras(point_tags, point_ways, nodes)
    off_road = sum(1 for ref in point_tags if ref not in point_ways)
    tiers = {name: sum(1 for _, tier in limits.values() if tier == code) for code, name in TIER_NAMES.items()}
    print(f"OSM road safety source: {len(limits)} ways with usable limits {tiers}, {relation_sites} enforcement relations, "
          f"{len(point_tags)} point cameras ({off_road} not on a road way, unused), {len(cameras)} camera approaches", flush=True)
    return {"limits": limits, "cameras": cameras}


def point_cameras(point_tags, point_ways, nodes):
    """Turn camera nodes on road ways into approach records like enforcement relations.

    For each applicable driving direction the approach ("from") is the first way node
    8-150 m before the camera in that direction; the camera node is the "to"/device.
    """
    import enrich_road_guidance as road

    out = []
    for ref, (kind, direction, location) in point_tags.items():
        for way, before, after, oneway in point_ways.get(ref, ()):
            for sense, certain in point_camera_senses(direction, oneway):
                upstream = before if sense > 0 else after
                approach = next((nodes[n] for n in upstream if n in nodes and 8 <= road.distance(nodes[n], location) <= 150), None)
                if approach is None:
                    continue
                record = {"id": f"n{ref}{'+' if sense > 0 else '-'}", "kind": kind, "from": approach, "to": location,
                          "device": location, "fromWays": [way], "toWays": [way]}
                if not certain:
                    record["certain"] = False
                out.append(record)
    return out


def index_catalog(data):
    by_way = defaultdict(list)
    for camera in data["cameras"]:
        for way in camera["fromWays"]:
            by_way[way].append(camera)
    # Each limit is [km/h, tier]; a bare number (older extracts) counts as signposted.
    limits = {way: (list(value) if isinstance(value, (list, tuple)) else [value, TIER_SIGN])
              for way, value in data["limits"].items()}
    return limits, by_way


def same_driven_edge(shape, shape_dist, reference, progress, begin, finish):
    """Compare the local attribute edge with the accepted trace in travel order."""
    import enrich_road_guidance as road

    start = max(0, bisect.bisect_left(progress, begin - 12) - 1)
    end = min(len(reference), bisect.bisect_right(progress, finish + 12) + 1)
    local = reference[start:end]
    if len(local) < 2 or shape_dist[-1] < 5:
        return False
    local_dist = road.cumulative(local)
    hits = [road.project(p, local, local_dist) for p in road.sampled(shape, 3)]
    a, b = hits[0][1], hits[-1][1]
    if b <= a or abs(b - a - shape_dist[-1]) > max(2, shape_dist[-1] * .02):
        return False
    if any(error > 1.5 for error, _ in hits) or any(
            right[1] + .5 < left[1] for left, right in zip(hits, hits[1:])):
        return False
    core = road.clip_line(local, local_dist, a, b)
    return all(road.project(p, shape, shape_dist)[0] <= 1.5 for p in road.sampled(core, 3))


def annotate(catalog, attributes, matched, projected, official, distances, reference=None):
    """Return safety annotations only where matched edges tightly follow the GPX."""
    import enrich_road_guidance as road

    limits, by_way = catalog
    segments = []
    trusted = defaultdict(list)
    cameras = {}
    ranges = []
    reference_progress = []
    if reference is not None:
        reference, reference_projection = reference
        for _, at in reference_projection:
            reference_progress.append(max(at, reference_progress[-1] if reference_progress else 0))
    for edge in attributes:
        start, end, way = (edge.get(k) for k in ("begin_shape_index", "end_shape_index", "way_id"))
        if reference is not None and str(way) not in limits:
            continue
        if type(start) is not int or type(end) is not int or not 0 <= start < end < len(matched):
            continue
        begin, finish = projected[start][1], projected[end][1]
        if finish <= begin + 2 or max(e[0] for e in projected[start:end+1]) > 12:
            continue
        shape = matched[start:end+1]
        shape_dist = road.cumulative(shape)
        if abs(finish - begin - shape_dist[-1]) > max(8, shape_dist[-1] * .12):
            continue
        if any(projected[i+1][1] + 2 < projected[i][1] for i in range(start, end)):
            continue
        core = [road.coordinate_at(official, distances, begin)]
        core += official[bisect.bisect_right(distances, begin):bisect.bisect_left(distances, finish)]
        core.append(road.coordinate_at(official, distances, finish))
        core_dist = road.cumulative(core)
        if any(road.project(p, shape, shape_dist)[0] > 12 for p in road.sampled(core, 8)):
            continue
        if any(road.project(p, core, core_dist)[0] > 12 for p in road.sampled(shape, 8)):
            continue
        if reference is not None and not same_driven_edge(
                shape, shape_dist, reference, reference_progress, begin, finish):
            continue
        ranges.append((begin, finish))
        # A path good enough for voice or camera alerts can still be on a
        # parallel road with a different limit. Require a closer match for signs.
        if str(way) in limits and max(e[0] for e in projected[start:end+1]) <= 4:
            if (all(road.project(p, shape, shape_dist)[0] <= 4 for p in road.sampled(core, 4))
                    and all(road.project(p, core, core_dist)[0] <= 4 for p in road.sampled(shape, 4))):
                segments.append([begin, finish, *limits[str(way)]])
        trusted[way].append((begin, finish, shape, shape_dist))
        for camera in by_way.get(way, ()):
            cameras[camera["id"]] = camera

    def anchor(point, ways):
        offsets = []
        for way in ways:
            for begin, finish, shape, shape_dist in trusted.get(way, ()):
                deviation, along = road.project(point, shape, shape_dist)
                if deviation <= 5:
                    offsets.append(begin + along / shape_dist[-1] * (finish - begin))
        return sorted(offsets)

    continuous = road.merged_ranges(ranges, distances[-1])
    alerts = []
    for camera in cameras.values():
        straight = road.distance(camera["from"], camera["to"])
        if not 5 <= straight <= 220 or road.distance(camera["device"], camera["from"]) > 150:
            continue
        departures = anchor(camera["to"], camera["toWays"])
        for begin in anchor(camera["from"], camera["fromWays"]):
            if any(5 <= finish - begin <= min(250, straight * 2 + 20) and
                   any(a <= begin <= finish <= b for a, b in continuous)
                   for finish in departures):
                if not any(x["id"] == camera["id"] and abs(x["at"] - begin) < 20 for x in alerts):
                    alert = {"id": camera["id"], "at": begin, "kind": camera["kind"]}
                    if camera.get("certain") is False:
                        alert["certain"] = False
                    alerts.append(alert)
    # The same device reached through two mappings (relation and node, or two ways)
    # is announced once: keep the certain one within 40 m of the same kind.
    alerts.sort(key=lambda x: (x["at"], x.get("certain", True) is False))
    unique = []
    for alert in alerts:
        if any(u["kind"] == alert["kind"] and abs(u["at"] - alert["at"]) < 40 for u in unique):
            continue
        unique.append(alert)
    return segments, unique


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(extract(args.pbf), separators=(",", ":")))


if __name__ == "__main__":
    main()
