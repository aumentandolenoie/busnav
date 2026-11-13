#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="android/app/src/main/assets"
mkdir -p "$DEST"
cp index.html app.js route-stops.js tickets.js style.css sw.js manifest.webmanifest icon.svg official-routes.json academy-supplemental-routes.json academy-evidence.json "$DEST/"
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
import json
from pathlib import Path
routes = json.loads(Path('android/app/src/main/assets/official-routes.json').read_text(encoding='utf8'))
extra=json.load(open('android/app/src/main/assets/academy-supplemental-routes.json'))
assert len(extra)==2 and len({r['id'] for r in routes+extra})==789
assert len(routes) == 787
assert {name: sum(r['category'] == name for r in routes) for name in ('Extraurbano','Urbano','Colli')} == {'Extraurbano':557,'Urbano':201,'Colli':29}
print('Android Academy GPX: 787 percorsi originali.')
PY


bash scripts/bundle-web-libraries.sh "$DEST"
