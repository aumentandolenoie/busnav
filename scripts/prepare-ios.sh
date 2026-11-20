#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p ios/Web
# Copy originals, never alter the Academy catalog.
cp index.html app.js route-stops.js tickets.js corsie.js style.css sw.js manifest.webmanifest icon.svg official-routes.json academy-supplemental-routes.json academy-evidence.json ios/Web/
cp apple-touch-icon.png "ios/Web/"
# On-board ticket calculator data (polimetriche), read by the web layer.
mkdir -p "ios/Web/fares"
cp fares/polimetriche-padova.json "ios/Web/fares/"
mkdir -p "ios/Web/icons"
cp icons/*.png "ios/Web/icons/"
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
import hashlib,json
base='ios/Web/'
original=open(base+'official-routes.json','rb').read()
routes=json.loads(original);extra=json.load(open(base+'academy-supplemental-routes.json'))
evidence=json.load(open(base+'academy-evidence.json'))
catalog=evidence['catalog']
# The catalog must match the counts and digest written by scripts/import_mappe.py.
assert len(routes)+len(extra)==catalog['total'] and len({r['id'] for r in routes+extra})==catalog['total']
assert {c:sum(r['category']==c for r in routes+extra) for c in catalog['categories']}==catalog['categories']
assert hashlib.sha256(original).hexdigest()==evidence['originalCatalogSHA256']
assert len(evidence['routes'])==catalog['total']
print('Catalogo GPX:',catalog['total'],'percorsi',catalog['categories'])
PY


# Bundle runtime libraries: the route picker starts without a CDN connection.
bash scripts/bundle-web-libraries.sh ios/Web
