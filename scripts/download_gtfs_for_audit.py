#!/usr/bin/env python3
"""Fetch the public Busitalia GTFS with a declared personal client identity."""
import argparse
import csv
import io
import json
from pathlib import Path
import urllib.request
import zipfile
from datetime import datetime, timezone
import hashlib

parser=argparse.ArgumentParser()
parser.add_argument('output',type=Path)
parser.add_argument('--snapshot',type=Path,help='Use the explicitly dated pattern fixture, without downloading')
args=parser.parse_args()
url='https://proxy.busone.app/biv/gtfs.zip'
if args.snapshot:
    data=args.snapshot.read_bytes()
    metadata={'url':url,'retrievedAt':'2026-11-08','snapshot':True,'deduplicatedPatterns':True,
              'snapshotSHA256':hashlib.sha256(data).hexdigest(),
              'description':'One original trip per identical route_id and ordered stop_id sequence; no stop coordinates or order changed.'}
    print('Using explicitly dated Busitalia pattern snapshot:',args.snapshot)
else:
    request=urllib.request.Request(url,headers={
        'X-BusOne-Client':'LineaPilot; https://github.com/aumentandolenoie/busnav',
        'X-BusOne-Use':'personal',
    })
    with urllib.request.urlopen(request,timeout=90) as response:
        data=response.read(100*1024*1024+1)
    metadata={'url':url,'retrievedAt':datetime.now(timezone.utc).isoformat(),'snapshot':False}
if len(data)>100*1024*1024:raise SystemExit('GTFS exceeds size limit')
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    files={}
    for name in ['routes','trips','stops','stop_times']:
        filename=next(n for n in archive.namelist() if n.split('/')[-1].lower()==name+'.txt')
        files[name]=list(csv.DictReader(io.TextIOWrapper(archive.open(filename),encoding='utf-8-sig')))
files['_source']=metadata
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(files,ensure_ascii=False,separators=(',',':')))
print('Busitalia GTFS:',len(files['routes']),'routes,',len(files['stops']),'stops')
