"""Extract explicitly mapped limits and directional fixed enforcement from OSM."""
import argparse
import bisect
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path


SPEED_LIMIT_POLICY = 2


def validator_digest():
    scripts = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for name in ("enrich_road_guidance.py", "road_safety.py", "enrich_catalog.py"):
        digest.update(name.encode() + b"\0" + (scripts / name).read_bytes() + b"\0")
    return digest.hexdigest()


def explicit_speed(tags):
    """Require positive evidence of an unconditional, signposted road limit."""
    metadata = {"maxspeed:source", "maxspeed:type", "maxspeed:reason"}
    if any(key.startswith("maxspeed:") and key not in metadata for key in tags):
        return None
    sources = {tags[key].strip().lower() for key in ("source:maxspeed", "maxspeed:source", "maxspeed:type")
               if tags.get(key, "").strip()}
    if not sources or not sources <= {"sign", "markings"}:
        return None
    match = re.fullmatch(r"([0-9]{1,3})(?:\s+km/h)?", tags.get("maxspeed", "").strip())
    if not match:
        return None
    value = int(match[1])
    return value if 5 <= value <= 130 else None


def extract(pbf):
    import osmium

    relations = []
    needed = set()
    node_ways = defaultdict(list)
    limits = {}
    nodes = {}

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

    class Ways(osmium.SimpleHandler):
        def way(self, way):
            tags = way.tags
            if not tags.get("highway"):
                return
            value = explicit_speed({tag.k: tag.v for tag in tags if tag.k.startswith("maxspeed") or tag.k == "source:maxspeed"})
            if value is not None:
                limits[str(way.id)] = value
            for node in way.nodes:
                if node.ref in needed:
                    node_ways[node.ref].append(way.id)

    class Nodes(osmium.SimpleHandler):
        def node(self, node):
            if node.id in needed and node.location.valid():
                if node.tags.get("mobile") != "yes" and node.tags.get("temporary") != "yes":
                    nodes[node.id] = [node.location.lat, node.location.lon]

    Relations().apply_file(pbf)
    Ways().apply_file(pbf)
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
    print(f"OSM road safety source: {len(limits)} ways with explicit limits, {len(cameras)} directional fixed sites", flush=True)
    return {"limits": limits, "cameras": cameras}


def index_catalog(data):
    by_way = defaultdict(list)
    for camera in data["cameras"]:
        for way in camera["fromWays"]:
            by_way[way].append(camera)
    return data["limits"], by_way


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
                segments.append([begin, finish, limits[str(way)]])
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
                    alerts.append({"id": camera["id"], "at": begin, "kind": camera["kind"]})
    return segments, alerts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(extract(args.pbf), separators=(",", ":")))


if __name__ == "__main__":
    main()
