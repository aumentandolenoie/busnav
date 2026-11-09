"""Measure shipped coverage and replay verified windows on the local Valhalla graph."""
import argparse
from collections import Counter, defaultdict
import csv
import json
from pathlib import Path
import re

import enrich_road_guidance as road
import road_safety

BUNDLE = Path("road-guidance")
REPORT = Path("reports")
SOURCE_TAG = "ios-preview-aeacc9af4443"
LABELS = {
    "published": "Limite visualizzato",
    "unmapped": "Nessun limite numerico mappato sulla strada verificata",
    "non_numeric": "Tag presente senza un valore univoco in km/h",
    "conditional": "Limite variabile, condizionato, per corsia o categoria",
    "directional": "Limite direzionale escluso dall'esportatore",
    "numeric_metadata": "Valore numerico con formato o metadati non gestiti",
    "numeric_unpublished": "Limite numerico compatibile, non presente nell'archivio",
    "unverified": "Strada o geometria non confermata sul GPX",
    "conflict": "Fonti sovrapposte discordanti",
}
META = {"maxspeed:source", "maxspeed:type", "maxspeed:reason"}


def measure(total, published, evidence):
    events = defaultdict(list)
    events[0]
    events[total]
    for family, rows in (("p", published), ("e", evidence)):
        for begin, end, key in rows:
            begin, end = max(0, begin), min(total, end)
            if end > begin:
                events[begin].append((family, key, 1))
                events[end].append((family, key, -1))
    speeds, ways, lengths = Counter(), Counter(), Counter()
    previous = 0
    for point, delta in sorted(events.items()):
        if len(speeds) == 1:
            reason = "published"
        elif len(speeds) > 1 or len(ways) > 1:
            reason = "conflict"
        elif ways:
            reason = next(iter(ways))[1]
        else:
            reason = "unverified"
        lengths[reason] += point - previous
        for family, key, change in delta:
            active = speeds if family == "p" else ways
            active[key] += change
            if not active[key]:
                del active[key]
        previous = point
    return lengths


def source_reason(tags):
    related = {key for key in tags if key.startswith("maxspeed:") and key not in META
               and not key.startswith("maxspeed:advisory")}
    if related - {"maxspeed:forward", "maxspeed:backward"}:
        return "conditional"
    if related:
        return "directional"
    value = tags.get("maxspeed", "")
    if value in {"signals", "variable"}:
        return "conditional"
    match = re.fullmatch(r"(\d{1,3})(?:\s+km/h)?", value.strip())
    if not match or not 5 <= int(match[1]) <= 130:
        return "non_numeric" if value else "unmapped"
    if value != match[1] or any(key.startswith("maxspeed:") and key != "maxspeed:source" for key in tags):
        return "numeric_metadata"
    return "numeric_unpublished"


def replay(route, attempts):
    points = route["points"]
    distances = road.cumulative(points)
    verified = []
    failed = 0
    for attempt in attempts:
        if not attempt["accepted"]:
            continue
        strategy = attempt["strategy"]
        if strategy.startswith("whole-"):
            start, end = 0, len(points)-1
        else:
            match = re.fullmatch(r"window-(\d+)-(\d+)-(?:precise|default)(?:-strict)?", strategy)
            if not match:
                failed += 1
                continue
            start, end = map(int, match.groups())
        part = {**route, "points": points[start:end+1]}
        try:
            response = road.get_response("http://127.0.0.1:8002", part["points"], precise="precise" in strategy)
            road.convert(part, response, allow_empty=True, strict_local=strategy.endswith("-strict"))
            attrs = response["_edgeAttributes"]
            if attrs.get("shape") != response["trip"]["legs"][0]["shape"]:
                raise ValueError("road attribute shape differs")
            matched = road.decode_polyline(attrs["shape"])
            official = part["points"]
            official_dist = road.cumulative(official)
            projected = road.ordered_projection(matched, official, official_dist)
            inspected = []
            road_safety.annotate(({}, {}), attrs["edges"], matched, projected, official, official_dist, inspected=inspected)
        except (ValueError, OSError, KeyError) as error:
            print(f"Could not reproduce {route['id']} {strategy}: {error}", flush=True)
            failed += 1
            continue
        verified.extend((a+distances[start], b+distances[start], way)
                        for a,b,way in inspected if isinstance(way,int) and way>0)
    return verified, failed


def read_way_reasons(pbf, ids):
    import osmium

    reasons = {}

    class Ways(osmium.SimpleHandler):
        def way(self, way):
            if way.id in ids:
                reasons[way.id] = source_reason({tag.k:tag.v for tag in way.tags})

    Ways().apply_file(pbf)
    return reasons


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pbf")
    args = parser.parse_args()
    coverage = json.loads((BUNDLE/"coverage.json").read_text())
    if coverage["gpxSHA256"] != road.catalog_digest():
        raise SystemExit("Archive does not match official GPX")
    routes = road.load_catalog()
    rows = {str(row["id"]): row for row in coverage["routes"]}
    evidence, tags = {}, {}
    failed = 0
    if args.pbf:
        for i, route in enumerate(routes, 1):
            result, count = replay(route, rows[str(route["id"])]["attempts"])
            evidence[str(route["id"])] = result
            failed += count
            if i % 50 == 0:
                print(f"Replayed {i}/{len(routes)}", flush=True)
        tags = read_way_reasons(args.pbf, {way for intervals in evidence.values() for _,_,way in intervals})
    totals = Counter()
    empty = []
    report_rows = []
    for route in routes:
        identifier = str(route["id"])
        file = BUNDLE/(identifier+".json")
        data = json.loads(file.read_text()) if file.exists() else {}
        if data and data["fingerprint"] != road.fingerprint(route["points"]):
            raise SystemExit(f"GPX fingerprint mismatch on {identifier}")
        total = road.cumulative(route["points"])[-1]
        matched = [(a,b,(way,tags[way])) for a,b,way in evidence.get(identifier,[]) if way in tags]
        lengths = measure(total, data.get("speedLimits",[]), matched)
        totals.update(lengths)
        cameras = Counter(c["kind"] for c in data.get("roadCameras",[]))
        row = {"id":identifier,"percorso":route["name"],"totale_m":round(total),
               **{key:round(lengths[key]) for key in LABELS},
               "autovelox":cameras["speed"],"controllo_rosso":cameras["redLight"]}
        report_rows.append(row)
        if lengths["published"] <= 0:
            empty.append(row)
    REPORT.mkdir(exist_ok=True)
    with (REPORT/"speed-limit-coverage.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(report_rows[0]))
        writer.writeheader()
        writer.writerows(report_rows)
    total = sum(totals.values())
    camera_routes = sum(bool(row["autovelox"] or row["controllo_rosso"]) for row in report_rows)
    lines = ["# Verifica dei limiti di velocità lungo i GPX Academy", "",
             f"Archivio analizzato [{SOURCE_TAG}](https://github.com/aumentandolenoie/busnav/releases/tag/{SOURCE_TAG}).",
             "", f"Limite visualizzato su **{totals['published']/1000:,.1f} km su {total/1000:,.1f} km** "
             f"({100*totals['published']/total:.1f}%). Le distanze sommano anche le varianti di percorso.",
             f"**{len(empty)} percorsi** sono interamente privi di limiti. **{camera_routes} percorsi** hanno almeno un avviso per una postazione fissa.", ""]
    if args.pbf:
        lines += ["Le cause dei vuoti sono state verificate ricostruendo il grafo dall'estratto Nord-Est OSM corrente "
                  "e applicando gli stessi controlli di aderenza al GPX. I tag sono letti sulla strada associata al percorso.",
                  f"Finestre non riprodotte o prive di attributi allineabili: {failed}.",
                  "", "| Esito | km |", "| --- | ---: |"]
        lines += [f"| {label} | {totals[key]/1000:,.1f} |" for key,label in LABELS.items()]
    lines += ["", "## Percorsi senza limiti", "", "| GPX | Percorso | km | Causa prevalente |", "| --- | --- | ---: | --- |"]
    for row in empty:
        reason = LABELS[max((key for key in LABELS if key != "published"), key=lambda key: row[key])] if args.pbf else "Verifica della fonte in corso"
        name = row["percorso"].replace("|","–")
        lines.append(f"| {row['id']} | {name} | {row['totale_m']/1000:.2f} | {reason} |")
    lines += ["", "Il [CSV](speed-limit-coverage.csv) dettaglia ogni percorso. L'assenza di un avviso indica "
              "che l'archivio non dispone di una postazione fissa associata e verificata per quel GPX."]
    (REPORT/"speed-limit-coverage.md").write_text("\n".join(lines)+"\n")
    print(json.dumps({"totalM": total, "reasonsM": totals, "noLimits": empty, "cameraRoutes": camera_routes,
                      "failedWindows": failed}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
