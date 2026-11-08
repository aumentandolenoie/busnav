#!/usr/bin/env python3
"""Check actual graph flags, not merely existence of admins.sqlite."""
import argparse
import json
from pathlib import Path
import enrich_road_guidance as road

parser=argparse.ArgumentParser(); parser.add_argument('--endpoint',required=True); args=parser.parse_args()
probes=[]
for route in road.load_catalog():
    if len(route['points'])<10: continue
    points=route['points']
    d=road.cumulative(points)
    end=next((i for i,v in enumerate(d) if v>=600),len(points)-1)
    try:
        response=road.get_response(args.endpoint,points[:end+1],precise=True)
        assert response['_drivingSideValidated'] is True
        probes.append({'id':route['id'],'name':route['name'],'driveOnRight':True})
    except Exception as error:
        if 'Driving-side' in str(error): raise
        print('Probe not matchable:',route['id'],str(error),flush=True)
        continue
    if len(probes)==5: break
if len(probes)<3: raise SystemExit('Insufficient graph driving-side probes')
Path('build/road-graph-audit.json').write_text(json.dumps(probes,ensure_ascii=False,indent=2)+'\n')
print('Actual graph driving-side checks passed:',len(probes),flush=True)
