#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/valhalla
# Use upstream's scripted image; no dependency on a public routing demo or API key.
docker run -d --name busnav-valhalla -p 127.0.0.1:8002:8002 \
  -v "$PWD/build/valhalla:/custom_files" \
  -e tile_urls=https://download.geofabrik.de/europe/italy/nord-est-latest.osm.pbf \
  -e server_threads=2 -e build_elevation=False -e build_time_zones=False \
  -e build_admins=True ghcr.io/valhalla/valhalla-scripted:latest
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
python3 scripts/enrich_catalog.py --endpoint http://127.0.0.1:8002
