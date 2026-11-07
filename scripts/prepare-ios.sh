#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p ios/Web
# Copy originals, never alter the Academy catalog.
cp index.html app.js style.css sw.js manifest.webmanifest icon.svg official-routes.json ios/Web/
if [ -n "${GITHUB_SHA:-}" ]; then
  TAG="ios-preview-${GITHUB_SHA:0:12}"
  { printf "window.LINEAPILOT_BUILD_TAG='%s';\n" "$TAG"; cat ios/Web/app.js; } > ios/Web/app.js.versioned
  mv ios/Web/app.js.versioned ios/Web/app.js
fi
# Only validated guidance files may be bundled; official GPX remains unchanged.
if [ -d road-guidance ]; then
  mkdir -p ios/Web/road-guidance
  find road-guidance -maxdepth 1 -type f -name '*.json' -exec cp {} ios/Web/road-guidance/ \;
fi
test -s ios/Web/official-routes.json
python3 - <<'PY'
import json
with open("ios/Web/official-routes.json", encoding="utf-8") as f:
    routes=json.load(f)
assert len(routes)==787
assert {c:sum(x["category"]==c for x in routes) for c in ["Extraurbano","Urbano","Colli"]}=={"Extraurbano":557,"Urbano":201,"Colli":29}
print("Academy catalog: 787 intact routes.")
PY
