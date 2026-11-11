#!/usr/bin/env python3
"""Prepare all official routes with bounded traces, without writing GPX geometry."""
import argparse
import json
import pathlib
from datetime import datetime, timezone
import enrich_road_guidance as road
import road_safety
from guidance_audit import summarize

ROOT = pathlib.Path(__file__).resolve().parent.parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--endpoint', required=True)
    parser.add_argument('--road-safety', type=pathlib.Path)
    args = parser.parse_args()
    safety = road_safety.index_catalog(json.loads(args.road_safety.read_text())) if args.road_safety else None
    safety_stats = {'limitRoutes': 0, 'cameraRoutes': 0, 'speed': 0, 'redLight': 0,
                    'routeKm': 0.0, 'limitKm': 0.0, 'limitKmByTier': {name: 0.0 for name in road_safety.TIER_NAMES.values()}}
    source = ROOT / 'official-routes.json'
    original = source.read_bytes()
    catalog = road.load_catalog()
    out = ROOT / 'road-guidance'
    out.mkdir(exist_ok=True)
    report = {'validatorSHA256': road_safety.validator_digest(), 'generatedAt': datetime.now(timezone.utc).isoformat(),
              'speedLimitPolicy': road_safety.SPEED_LIMIT_POLICY, 'gpxSHA256': road.catalog_digest(), 'routes': []}
    for index, route in enumerate(catalog):
        target = out / (str(route['id'])+'.json')
        target.unlink(missing_ok=True)
        data,attempts=road.annotate_route(route,args.endpoint,safety)
        row={'id':route['id'],'name':route['name'],'category':route['category'],'line':route['line'],'attempts':attempts}
        if data:
            data=road.refine_roundabouts(route,data,args.endpoint)
            # Keep only contiguous validated portions and deduplicate the same site
            # where two trace windows overlap.
            ranges = data['coverage']['ranges']
            data['speedLimits'] = [[a,b,*rest] for a,b,*rest in data['speedLimits']
                                   if any(lo <= a < b <= hi for lo,hi in ranges)]
            # Per-route coverage of displayable limits and their reliability.
            by_tier = {name: 0.0 for name in road_safety.TIER_NAMES.values()}
            covered = 0.0; reach = -1.0
            for a, b, _, *tier in sorted(data['speedLimits']):
                by_tier[road_safety.TIER_NAMES.get(tier[0] if tier else road_safety.TIER_SIGN, 'sign')] += b - a
                covered += max(0.0, b - max(a, reach)); reach = max(reach, b)
            length = data['officialLengthM']
            row['speedLimitCoverage'] = {'percent': round(100 * covered / length, 1) if length else 0.0,
                                         'metresByTier': {k: round(v) for k, v in by_tier.items()}}
            safety_stats['routeKm'] += length / 1000; safety_stats['limitKm'] += covered / 1000
            for name, metres in by_tier.items():
                safety_stats['limitKmByTier'][name] += metres / 1000
            cameras = []
            for camera in sorted(data['roadCameras'], key=lambda c:c['at']):
                if any(lo <= camera['at'] <= hi for lo,hi in ranges) and not any(
                    c['id']==camera['id'] and abs(c['at']-camera['at'])<25 for c in cameras
                ):
                    cameras.append(camera)
            data['roadCameras'] = cameras
            row['hasSpeedLimits'] = bool(data['speedLimits'])
            safety_stats['limitRoutes'] += row['hasSpeedLimits']
            safety_stats['cameraRoutes'] += bool(cameras)
            for camera in cameras:
                safety_stats[camera['kind']] += 1
            data['generatedAt'] = report['generatedAt']
            data['speedLimitPolicy'] = road_safety.SPEED_LIMIT_POLICY
            target.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
            complete=data['coverage']['complete']
            row.update(status='validated' if complete else 'partial',turns=len(data['turns']),coverage=data['coverage'],solution=data['solution'])
            print(f"{index+1}/{len(catalog)} {route['id']}: {'OK' if complete else 'PARTIAL'} {len(data['turns'])} manovre {data['coverage']['percent']}%",flush=True)
        else:
            row.update(status='unavailable',reason=attempts[-1]['reason'] if attempts else 'No valid trace')
            print(f"{index+1}/{len(catalog)} {route['id']}: escluso: {row['reason']}",flush=True)
        report['routes'].append(row)
    if safety is not None and not safety_stats['limitRoutes']:
        raise RuntimeError('No usable speed limits matched the official GPX')
    safety_stats['routeKm'] = round(safety_stats['routeKm'], 1)
    safety_stats['limitKm'] = round(safety_stats['limitKm'], 1)
    safety_stats['limitKmByTier'] = {k: round(v, 1) for k, v in safety_stats['limitKmByTier'].items()}
    report['roadSafety'] = safety_stats
    print('Road safety audit:', json.dumps(safety_stats), flush=True)
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
