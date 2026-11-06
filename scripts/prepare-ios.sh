#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p ios/Web
# Copy originals, never alter the Academy catalog.
cp index.html app.js style.css sw.js manifest.webmanifest icon.svg official-routes.json ios/Web/
test -s ios/Web/official-routes.json
python3 - <<'PY'
import json
with open("ios/Web/official-routes.json", encoding="utf-8") as f:
    routes=json.load(f)
assert len(routes)==787
assert {c:sum(x["category"]==c for x in routes) for c in ["Extraurbano","Urbano","Colli"]}=={"Extraurbano":557,"Urbano":201,"Colli":29}
print("Academy catalog: 787 intact routes.")
PY
