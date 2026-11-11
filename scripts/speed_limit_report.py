#!/usr/bin/env python3
"""Speed limit coverage per official GPX and per reliability tier.

Usage: speed_limit_report.py ROAD_GUIDANCE_DIR_OR_navigation-data.zip [OUT_PREFIX]
Writes OUT_PREFIX.md (summary) and OUT_PREFIX.csv (one row per GPX).
"""
import csv
import io
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

TIERS = {1: "cartello", 2: "mappato", 3: "legale"}


def load(source):
    source = Path(source)
    if source.suffix == ".zip":
        with zipfile.ZipFile(source) as archive:
            for name in archive.namelist():
                if name.endswith(".json") and not name.endswith("coverage.json"):
                    yield json.loads(archive.read(name))
    else:
        for path in source.glob("*.json"):
            if path.name != "coverage.json":
                yield json.loads(path.read_text())


def covered(segments):
    total, reach = 0.0, -1.0
    for a, b in sorted((s[0], s[1]) for s in segments):
        total += max(0.0, b - max(a, reach))
        reach = max(reach, b)
    return total


def main():
    source = sys.argv[1]
    prefix = Path(sys.argv[2] if len(sys.argv) > 2 else "reports/speed-limit-coverage")
    names = {}
    catalog = Path(__file__).resolve().parent.parent / "official-routes.json"
    if catalog.exists():
        names = {str(r["id"]): (r.get("category", ""), r.get("name", "")) for r in json.loads(catalog.read_text())}
    rows, by_tier, by_value = [], Counter(), Counter()
    policy = Counter()
    for data in load(source):
        segments = data.get("speedLimits") or []
        policy[data.get("speedLimitPolicy")] += 1
        length = data.get("officialLengthM") or 0
        tiers = Counter()
        for tier in TIERS:
            # Overlapping windows can repeat a stretch: count each metre once.
            tiers[tier] = covered([s for s in segments if (s[3] if len(s) > 3 else 1) == tier])
            by_tier[tier] += tiers[tier]
        for value in {s[2] for s in segments}:
            by_value[value] += covered([s for s in segments if s[2] == value])
        metres = covered(segments)
        category, name = names.get(str(data.get("academyId")), ("", ""))
        rows.append({"gpx": data.get("academyId"), "categoria": category, "percorso": name,
                     "km": round(length / 1000, 2), "km_con_limite": round(metres / 1000, 2),
                     "percentuale": round(100 * metres / length, 1) if length else 0.0,
                     **{"km_" + TIERS[t]: round(tiers[t] / 1000, 2) for t in TIERS}})
    rows.sort(key=lambda r: (r["percentuale"], str(r["gpx"])))
    prefix.parent.mkdir(parents=True, exist_ok=True)
    with open(prefix.with_suffix(".csv"), "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    total = sum(r["km"] for r in rows)
    limited = sum(r["km_con_limite"] for r in rows)
    buckets = [("nessun limite", 0, 0.05), ("meno del 25%", 0.05, 25), ("25-50%", 25, 50),
               ("50-75%", 50, 75), ("75-90%", 75, 90), ("almeno 90%", 90, 101)]
    lines = [
        "# Copertura dei limiti di velocità",
        "",
        f"Fonte: OpenStreetMap (estratto Geofabrik Nord-Est), abbinato ai GPX Academy. Policy dati: {dict(policy)}.",
        "",
        "| Misura | Valore |",
        "| --- | ---: |",
        f"| Percorsi GPX | {len(rows)} |",
        f"| Distanza totale | {total:,.0f} km |",
        f"| Distanza con limite | {limited:,.0f} km ({100 * limited / total:.1f}%) |",
    ]
    for tier, label in TIERS.items():
        lines.append(f"| di cui {label} | {by_tier[tier] / 1000:,.0f} km |")
    lines += ["", "## Percorsi per copertura", "", "| Copertura | Percorsi |", "| --- | ---: |"]
    for label, low, high in buckets:
        lines.append(f"| {label} | {sum(1 for r in rows if low <= r['percentuale'] < high)} |")
    lines += ["", "## Valori mostrati (km)", "", "| km/h | km |", "| ---: | ---: |"]
    for value, metres in sorted(by_value.items()):
        lines.append(f"| {value} | {metres / 1000:,.0f} |")
    lines += ["", "Livelli di affidabilità:",
              "- **cartello**: in OSM il valore è dichiarato letto da un cartello (`source:maxspeed=sign/markings`);",
              "- **mappato**: valore numerico inserito in OSM senza fonte dichiarata;",
              "- **legale**: limite generale dell'art. 142 c.1 CdS per il contesto indicato in OSM (`IT:urban` 50, `IT:rural` 90, ...).",
              "",
              "Tutti i valori sono già convertiti per autobus oltre 8 t (art. 142 c.3 lett. f CdS): massimo 80 km/h, 100 km/h in autostrada.",
              "Limiti per direzione, a orario, per corsia o variabili non vengono mostrati.",
              "",
              f"Elenco completo per percorso: [{prefix.with_suffix('.csv').name}]({prefix.with_suffix('.csv').name})."]
    prefix.with_suffix(".md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:16]))


if __name__ == "__main__":
    main()
