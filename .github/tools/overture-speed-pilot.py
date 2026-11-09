"""Check explicit Overture limits on public locality extracts, without exporting GPX."""
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path.cwd() / "scripts"))
import enrich_road_guidance as road


def explicit_limit(properties):
    rules = properties.get("speed_limits") or []
    # Scope rules are meaningful. A pilot only counts one explicit full-width,
    # unconditional km/h rule with no conflicting alternatives.
    if len(rules) != 1:
        return None
    rule = rules[0]
    if rule.get("between") not in (None, [0, 1]) or any(v is not None for v in (rule.get("when") or {}).values()):
        return None
    speed = rule.get("max_speed") or {}
    value = speed.get("value")
    return value if speed.get("unit") == "km/h" and type(value) in (int, float) and 5 <= value <= 130 and value == int(value) else None


def overlap(shape, points, distances):
    hits = [road.project(p, points, distances) for p in road.sampled(shape, 5)]
    if max(error for error, _ in hits) > 4:
        return None
    if hits[0][1] > hits[-1][1]:
        hits.reverse()
    start, end = hits[0][1], hits[-1][1]
    length = road.cumulative(shape)
    if end - start < 6 or abs(end - start - length[-1]) > max(4, length[-1] * .05):
        return None
    if any(b[1] + 1 < a[1] for a, b in zip(hits, hits[1:])):
        return None
    core = road.clip_line(points, distances, start, end)
    if any(road.project(p, shape, length)[0] > 4 for p in road.sampled(core, 5)):
        return None
    return start, end


def measure(ranges, total):
    return sum(b - a for a, b in road.merged_ranges(ranges, total))


def audit(route, features, candidates=None):
    points = route["points"]
    distances = road.cumulative(points)
    south, north = min(p[0] for p in points), max(p[0] for p in points)
    west, east = min(p[1] for p in points), max(p[1] for p in points)
    matched, numeric = [], []
    provenance = Counter()
    for item in features:
        props, geometry = item.get("properties") or {}, item.get("geometry") or {}
        if props.get("subtype") != "road" or geometry.get("type") != "LineString":
            continue
        shape = [(lat, lon) for lon, lat, *_ in geometry["coordinates"]]
        if len(shape) < 2 or not all(south-.0001 <= lat <= north+.0001 and west-.00015 <= lon <= east+.00015
                                    for lat,lon in shape):
            continue
        interval = overlap(shape, points, distances)
        if interval is None:
            continue
        matched.append(interval)
        limit = explicit_limit(props)
        if limit is None:
            continue
        numeric.append(interval)
        if candidates is not None:
            candidates.append((*interval, limit))
        sources = [s["dataset"] for s in props.get("sources") or []
                   if (s.get("property") or "").startswith("/speed_limits") and s.get("dataset")]
        provenance.update(set(sources or ["Provenienza del singolo valore non indicata"]))
    return round(distances[-1]), round(measure(matched, distances[-1])), round(measure(numeric, distances[-1])), provenance


def main():
    inputs = {"407": "carmignano", "488": "piove", "489": "piove", "688": "padova"}
    extracts = {k: json.loads(Path(f"build/overture-{k}.geojson").read_text())["features"] for k in set(inputs.values())}
    lines = ["# Confronto pilota dei limiti con Overture Maps", "",
             "Release Overture 2026-10-21.0. Il confronto usa estratti geografici pubblici "
             "scaricati prima dell'abbinamento locale con i GPX. Le tratte campione erano prive "
             "di un limite visualizzato nella precedente build.", "",
             "| GPX | Percorso | Metri GPX | Metri con strada compatibile | Metri con un limite candidato |",
             "| --- | --- | ---: | ---: | ---: |"]
    counts = Counter()
    for route in road.load_catalog():
        key = str(route["id"])
        if key not in inputs:
            continue
        total, aligned, numeric, sources = audit(route, extracts[inputs[key]])
        name = route["name"].replace("|", "–")
        lines.append(f"| {key} | {name} | {total} | {aligned} | {numeric} |")
        counts.update(sources)
    lines += ["", "Sono contati solo limiti espliciti in km/h per l'intero segmento, senza restrizioni "
              "di orario, categoria o verso. I metri con strada compatibile misurano il confronto "
              "geometrico con questa soglia, anche dove il limite manca. I limiti candidati "
              "richiedono conferma della strada e della fonte prima della distribuzione.",
              "", f"Provenienza dei candidati per segmento: {dict(counts)}."]
    report = "\n".join(lines) + "\n"
    Path("reports/overture-speed-pilot.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
