#!/usr/bin/env bash
set -euo pipefail
DESTINATION="$1"
mkdir -p "$DESTINATION/vendor"
curl --fail --location --retry 3 https://unpkg.com/leaflet@1.9.4/dist/leaflet.js -o "$DESTINATION/vendor/leaflet.js"
curl --fail --location --retry 3 https://unpkg.com/leaflet@1.9.4/dist/leaflet.css -o "$DESTINATION/vendor/leaflet.css"
curl --fail --location --retry 3 https://unpkg.com/@tomickigrzegorz/leaflet-rotate@0.3.0/dist/leaflet-rotate.umd.min.js -o "$DESTINATION/vendor/leaflet-rotate.js"
curl --fail --location --retry 3 https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js -o "$DESTINATION/vendor/jszip.js"
python3 - "$DESTINATION" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])/'index.html';s=p.read_text()
for remote,local in {
'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js':'vendor/leaflet.js',
'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css':'vendor/leaflet.css',
'https://unpkg.com/@tomickigrzegorz/leaflet-rotate@0.3.0/dist/leaflet-rotate.umd.min.js':'vendor/leaflet-rotate.js',
'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js':'vendor/jszip.js',
}.items():s=s.replace(remote,local)
p.write_text(s)
PY
