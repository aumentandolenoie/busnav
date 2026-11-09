"""Compare the previous and new GPX speed bundles without writing navigation data."""
from collections import Counter, defaultdict
import json
from pathlib import Path
import runpy


def compare_intervals(total, old, new):
    events = defaultdict(list)
    events[0]
    events[total]
    for version, rows in enumerate((old, new)):
        for start, end, value in rows:
            start, end = max(0, start), min(total, end)
            if start < end:
                events[start].append((version, value, 1))
                events[end].append((version, value, -1))
    active = [Counter(), Counter()]
    result = Counter()
    previous = 0
    for at, changes in sorted(events.items()):
        a, b = [next(iter(current)) if len(current) == 1 else None for current in active]
        length = at - previous
        if a is not None:
            result["before"] += length
        if b is not None:
            result["after"] += length
        if a is None and b is not None:
            result["added"] += length
        if a is not None and b is None:
            result["removed"] += length
        if a is not None and b is not None and a != b:
            result["changed"] += length
        for version, value, delta in changes:
            active[version][value] += delta
            if not active[version][value]:
                del active[version][value]
        previous = at
    return result


def main():
    old, new = Path("build/old/road-guidance"), Path("build/new/road-guidance")
    previous = json.loads((old/"coverage.json").read_text())
    latest = json.loads((new/"coverage.json").read_text())
    assert previous["gpxSHA256"] == latest["gpxSHA256"]
    metadata = {str(row["id"]):row for row in latest["routes"]}
    assert len(metadata) == len(previous["routes"]) == 789
    results = Counter()
    recovered, empty = [], []
    cameras_changed = []
    total = 0
    for identifier, row in metadata.items():
        a = json.loads((old/f"{identifier}.json").read_text())
        b = json.loads((new/f"{identifier}.json").read_text())
        assert a["fingerprint"] == b["fingerprint"], identifier
        length = b["coverage"]["totalM"]
        total += length
        stats = compare_intervals(length, a.get("speedLimits", []), b.get("speedLimits", []))
        results.update(stats)
        if stats["before"] == 0 and stats["after"] > 0:
            recovered.append((identifier, row["name"], stats["after"]))
        if stats["after"] == 0:
            empty.append((identifier, row["name"]))
        if a.get("roadCameras", []) != b.get("roadCameras", []):
            cameras_changed.append(identifier)
    lines = ["# Aggiornamento dei limiti di velocità", "",
             "Confronto fra gli archivi di navigazione distribuiti. Le distanze sommano i GPX e le loro varianti.",
             "", "| Misura | Risultato |", "| --- | ---: |"]
    lines += [f"| Distanza GPX totale | {total/1000:,.1f} km |",
              f"| Limiti prima | {results['before']/1000:,.1f} km ({100*results['before']/total:.1f}%) |",
              f"| Limiti dopo | {results['after']/1000:,.1f} km ({100*results['after']/total:.1f}%) |",
              f"| Distanza con un nuovo limite | {results['added']/1000:,.1f} km |",
              f"| Distanza con dato precedente assente nel nuovo archivio | {results['removed']/1000:,.1f} km |",
              f"| Distanza con valore diverso | {results['changed']/1000:,.1f} km |",
              f"| Percorsi recuperati | {len(recovered)} |",
              f"| Percorsi ancora senza un valore | {len(empty)} |",
              f"| Percorsi con dati di postazioni diversi fra i due archivi | {len(cameras_changed)} |",
              "", "## Percorsi recuperati", "", "| GPX | Percorso | km con limite |", "| --- | --- | ---: |"]
    lines += [f"| {identifier} | {name.replace('|','–')} | {metres/1000:.2f} |"
              for identifier, name, metres in recovered]
    lines += ["", "## Percorsi ancora senza un valore", ""]
    lines += [f"- GPX {identifier} · {name}" for identifier, name in empty]
    pilot = runpy.run_path(".github/tools/overture-speed-pilot.py")
    route = next(r for r in pilot["road"].load_catalog() if str(r["id"]) == "688")
    features = json.loads(Path("build/overture-padova.geojson").read_text())["features"]
    candidates = []
    pilot["audit"](route, features, candidates=candidates)
    published = json.loads((new/"688.json").read_text())
    comparison = compare_intervals(published["coverage"]["totalM"], published["speedLimits"], candidates)
    lines += ["", "## Confronto con Overture sulla 13B", "",
              f"- {comparison['after']/1000:.2f} km con candidati Overture univoci.",
              f"- {comparison['added']/1000:.2f} km di candidati su tratti senza limite nel nuovo archivio OSM.",
              f"- {comparison['changed']/1000:.2f} km con valori diversi dove entrambe le fonti hanno un candidato.",
              "", "I candidati Overture restano separati dai dati distribuiti. "
              "La provenienza del singolo valore e l'associazione alla strada richiedono verifica.",
              "", "[Confronto pilota Overture](overture-speed-pilot.md)."]
    report = "\n".join(lines) + "\n"
    Path("reports/speed-limit-recovery.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
