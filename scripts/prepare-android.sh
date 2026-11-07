#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="android/app/src/main/assets"
mkdir -p "$DEST"
cp index.html app.js style.css sw.js manifest.webmanifest icon.svg official-routes.json "$DEST/"
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
assert len(routes) == 787
assert {name: sum(r['category'] == name for r in routes) for name in ('Extraurbano','Urbano','Colli')} == {'Extraurbano':557,'Urbano':201,'Colli':29}
print('Android Academy GPX: 787 percorsi originali.')
PY
