#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="android/app/src/main/assets"
mkdir -p "$DEST"
cp index.html app.js route-stops.js tickets.js corsie.js turni.js turni.json style.css sw.js manifest.webmanifest icon.svg official-routes.json academy-supplemental-routes.json academy-evidence.json "$DEST/"
cp apple-touch-icon.png "$DEST/"
# On-board ticket calculator data (polimetriche), read by the web layer.
mkdir -p "$DEST/fares"
cp fares/polimetriche-padova.json "$DEST/fares/"
mkdir -p "$DEST/icons"
cp icons/*.png "$DEST/icons/"
if [ -d road-guidance ]; then
 mkdir -p "$DEST/road-guidance"
 find road-guidance -maxdepth 1 -type f -name '*.json' -exec cp '{}' "$DEST/road-guidance/" \;
fi
if [ -n "${GITHUB_SHA:-}" ]; then
 TAG="android-preview-${GITHUB_SHA:0:12}"
 sed -i "1i window.LINEAPILOT_BUILD_TAG='$TAG';" "$DEST/app.js"
fi
python3 - <<'PY'
import hashlib,json
base='android/app/src/main/assets/'
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


bash scripts/bundle-web-libraries.sh "$DEST"
