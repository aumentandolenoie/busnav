#!/usr/bin/env python3
"""Prepare all official routes with bounded traces, without writing GPX geometry."""
import argparse
import hashlib
import json
import pathlib
from datetime import datetime, timezone
import enrich_road_guidance as road

ROOT = pathlib.Path(__file__).resolve().parent.parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--endpoint', required=True)
    args = parser.parse_args()
    source = ROOT / 'official-routes.json'
    original = source.read_bytes()
    catalog = json.loads(original)
    out = ROOT / 'road-guidance'
    out.mkdir(exist_ok=True)
    report = {'generatedAt': datetime.now(timezone.utc).isoformat(),
              'gpxSHA256': hashlib.sha256(original).hexdigest(), 'routes': []}
    for index, route in enumerate(catalog):
        target = out / (str(route['id'])+'.json')
        target.unlink(missing_ok=True)
        try:
            data = road.convert(route, road.get_response(args.endpoint,route['points']))
            data['generatedAt'] = report['generatedAt']
            target.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
            report['routes'].append({'id':route['id'],'status':'validated','turns':len(data['turns'])})
            print(f"{index+1}/{len(catalog)} {route['id']}: OK {len(data['turns'])} manovre",flush=True)
        except Exception as error:
            report['routes'].append({'id':route['id'],'status':'unavailable','reason':str(error)[:300]})
            print(f"{index+1}/{len(catalog)} {route['id']}: escluso: {error}",flush=True)
    report['validated'] = sum(r['status']=='validated' for r in report['routes'])
    (out/'coverage.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    assert source.read_bytes() == original, 'Official GPX changed!'
    print(f"Coverage: {report['validated']}/{len(catalog)}. GPX SHA256: {report['gpxSHA256']}",flush=True)
    if not report['validated']:
        raise SystemExit('No validated directions; refusing to publish a navigator without road guidance')

if __name__ == '__main__':
    main()
