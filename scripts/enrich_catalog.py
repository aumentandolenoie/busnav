#!/usr/bin/env python3
"""Prepare all official routes with bounded traces, without writing GPX geometry."""
import argparse
import hashlib
import json
import pathlib
from datetime import datetime, timezone
import enrich_road_guidance as road
from guidance_audit import summarize

ROOT = pathlib.Path(__file__).resolve().parent.parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--endpoint', required=True)
    args = parser.parse_args()
    source = ROOT / 'official-routes.json'
    original = source.read_bytes()
    catalog = road.load_catalog()
    out = ROOT / 'road-guidance'
    out.mkdir(exist_ok=True)
    report = {'validatorSHA256': hashlib.sha256((ROOT/'scripts/enrich_road_guidance.py').read_bytes()).hexdigest(), 'generatedAt': datetime.now(timezone.utc).isoformat(),
              'gpxSHA256': road.catalog_digest(), 'routes': []}
    for index, route in enumerate(catalog):
        target = out / (str(route['id'])+'.json')
        target.unlink(missing_ok=True)
        data,attempts=road.annotate_route(route,args.endpoint)
        row={'id':route['id'],'name':route['name'],'category':route['category'],'line':route['line'],'attempts':attempts}
        if data:
            data=road.refine_roundabouts(route,data,args.endpoint)
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
    audit={'before':json.loads((ROOT/'build/road-guidance-before.json').read_text()) if (ROOT/'build/road-guidance-before.json').exists() else None,
           'after':summarize(json.loads(p.read_text()) for p in out.glob('*.json') if p.name!='coverage.json')}
    baseline_path=ROOT/'reports/roundabout-recovery-input.json'
    if baseline_path.exists():
        baseline=json.loads(baseline_path.read_text());comparisons=[]
        for old in baseline['maneuvers']:
            current=json.loads((out/(str(old['id'])+'.json')).read_text())
            turns=[t for t in current['turns'] if t['kind']=='roundabout' and abs(t['at']-old['at'])<3]
            if len(turns)!=1:status='missing-or-ambiguous'
            else:status='unresolved' if 'GPX ufficiale' in turns[0]['text'] else 'recovered'
            comparisons.append({**old,'status':status,'text':turns[0]['text'] if len(turns)==1 else None})
        audit['baselineRecovery']={'initial':baseline['count'],'recovered':sum(c['status']=='recovered' for c in comparisons),'unresolved':sum(c['status']!='recovered' for c in comparisons),'maneuvers':comparisons}
    (ROOT/'reports/road-guidance-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
    print('Roundabout audit:',json.dumps({k:v for k,v in audit['after'].items() if k!='samples'}),flush=True)
    assert source.read_bytes() == original, 'Official GPX changed!'
    print(f"Coverage: {report['validated']} full + {report['partial']} partial /{len(catalog)}. GPX SHA256: {report['gpxSHA256']}",flush=True)
    if not report['validated']:
        raise SystemExit('No validated directions; refusing to publish a navigator without road guidance')

if __name__ == '__main__':
    main()

