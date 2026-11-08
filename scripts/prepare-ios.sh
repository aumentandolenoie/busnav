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


# Bundle runtime libraries: the route picker must start without a CDN connection.
mkdir -p ios/Web/vendor
curl --fail --location --retry 3 https://unpkg.com/leaflet@1.9.4/dist/leaflet.js -o ios/Web/vendor/leaflet.js
curl --fail --location --retry 3 https://unpkg.com/leaflet@1.9.4/dist/leaflet.css -o ios/Web/vendor/leaflet.css
curl --fail --location --retry 3 https://unpkg.com/@tomickigrzegorz/leaflet-rotate@0.3.0/dist/leaflet-rotate.umd.min.js -o ios/Web/vendor/leaflet-rotate.js
curl --fail --location --retry 3 https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js -o ios/Web/vendor/jszip.js
python3 - <<'PYVENDOR'
from pathlib import Path
p=Path('ios/Web/index.html')
s=p.read_text()
for url,local in {
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js':'vendor/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css':'vendor/leaflet.css',
    'https://unpkg.com/@tomickigrzegorz/leaflet-rotate@0.3.0/dist/leaflet-rotate.umd.min.js':'vendor/leaflet-rotate.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js':'vendor/jszip.js',
}.items(): s=s.replace(url,local)
p.write_text(s)
PYVENDOR
