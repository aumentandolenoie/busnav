#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/valhalla
IMAGE=ghcr.io/valhalla/valhalla-scripted:latest
# Country borders must be complete BEFORE building routing tiles. A Nord-Est
# extract can omit the Italian country relation and corrupt drive_on_right.
curl -fL --retry 3 https://download.geofabrik.de/europe/italy-latest.osm.pbf -o build/valhalla/admin-italy.osm.pbf
docker run --rm --entrypoint /bin/bash -v "$PWD/build/valhalla:/custom_files" "$IMAGE" -ec '
  valhalla_build_config --mjolnir-admin /custom_files/admins.sqlite > /custom_files/admin-config.json
  valhalla_build_admins --config /custom_files/admin-config.json /custom_files/admin-italy.osm.pbf
'
python3 scripts/check-road-admins.py build/valhalla/admins.sqlite
rm build/valhalla/admin-italy.osm.pbf

# Use upstream's scripted image; no dependency on a public routing demo or API key.
docker run -d --name busnav-valhalla -p 127.0.0.1:8002:8002 \
  -v "$PWD/build/valhalla:/custom_files" \
  -e tile_urls=https://download.geofabrik.de/europe/italy/nord-est-latest.osm.pbf \
  -e server_threads=2 -e build_elevation=False -e build_time_zones=False \
  -e build_admins=False "$IMAGE"
ready=false
for attempt in $(seq 1 150); do
  if curl -sf http://127.0.0.1:8002/status > /dev/null; then ready=true; break; fi
  if ! docker inspect -f '{{.State.Running}}' busnav-valhalla | grep -q true; then
    docker logs --tail 100 busnav-valhalla; exit 1
  fi
  echo "Valhalla: preparazione grafo OSM ($attempt/150)"
  sleep 10
done
if [ "$ready" != true ]; then docker logs --tail 150 busnav-valhalla; exit 1; fi
python3 scripts/check-road-graph.py --endpoint http://127.0.0.1:8002
python3 -m pip install osmium
pbf=$(find build/valhalla -maxdepth 2 -name 'nord-est-latest.osm.pbf' -print -quit)
test -n "$pbf"
python3 scripts/road_safety.py "$pbf" build/road-safety.json
python3 scripts/enrich_catalog.py --endpoint http://127.0.0.1:8002 --road-safety build/road-safety.json
# Speed limit coverage per GPX and per reliability tier (cartello / mappato / legale).
python3 scripts/speed_limit_report.py road-guidance reports/speed-limit-coverage
