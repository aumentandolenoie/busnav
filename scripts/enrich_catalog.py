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
    report = {'validatorSHA256': hashlib.sha256((ROOT/'scripts/enrich_road_guidance.py').read_bytes()).hexdigest(), 'generatedAt': datetime.now(timezone.utc).isoformat(),
              'gpxSHA256': hashlib.sha256(original).hexdigest(), 'routes': []}
    for index, route in enumerate(catalog):
        target = out / (str(route['id'])+'.json')
        target.unlink(missing_ok=True)
        data,attempts=road.annotate_route(route,args.endpoint)
        row={'id':route['id'],'name':route['name'],'category':route['category'],'line':route['line'],'attempts':attempts}
        if data:
            data['generatedAt'] = report['generatedAt']
            target.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
            complete=data['coverage']['complete']
            row.update(status='validated' if complete else 'partial',turns=len(data['turns']),coverage=data['coverage'],solution=data['solution'])
            print(f"{index+1}/{len(catalog)} {route['id']}: {'OK' if complete else 'PARTIAL'} {len(data['turns'])} manovre {data['coverage']['percent']}%",flush=True)
        else:
            row.update(status='unavailable',reason=attempts[-1]['reason'] if attempts else 'No valid trace')
            print(f"{index+1}/{len(catalog)} {route['id']}: escluso: {row['reason']}",flush=True)
        report['routes'].append(row)
    report['validated'] = sum(r['status']=='validated' for r in report['routes'])
    report['partial'] = sum(r['status']=='partial' for r in report['routes'])
    report['unavailable'] = sum(r['status']=='unavailable' for r in report['routes'])
    (out/'coverage.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    assert source.read_bytes() == original, 'Official GPX changed!'
    print(f"Coverage: {report['validated']} full + {report['partial']} partial /{len(catalog)}. GPX SHA256: {report['gpxSHA256']}",flush=True)
    if not report['validated']:
        raise SystemExit('No validated directions; refusing to publish a navigator without road guidance')

if __name__ == '__main__':
    main()
