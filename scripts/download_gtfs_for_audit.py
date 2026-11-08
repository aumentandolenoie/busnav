#!/usr/bin/env python3
"""Fetch the public Busitalia GTFS with a declared personal client identity."""
import argparse
import csv
import io
import json
from pathlib import Path
import urllib.request
import zipfile

parser=argparse.ArgumentParser()
parser.add_argument('output',type=Path)
args=parser.parse_args()
url='https://proxy.busone.app/biv/gtfs.zip'
request=urllib.request.Request(url,headers={
    'X-BusOne-Client':'LineaPilot; https://github.com/aumentandolenoie/busnav',
    'X-BusOne-Use':'personal',
})
with urllib.request.urlopen(request,timeout=90) as response:
    data=response.read(100*1024*1024+1)
if len(data)>100*1024*1024:raise SystemExit('GTFS exceeds size limit')
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    files={}
    for name in ['routes','trips','stops','stop_times']:
        filename=next(n for n in archive.namelist() if n.split('/')[-1].lower()==name+'.txt')
        files[name]=list(csv.DictReader(io.TextIOWrapper(archive.open(filename),encoding='utf-8-sig')))
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(files,ensure_ascii=False,separators=(',',':')))
print('Busitalia GTFS:',len(files['routes']),'routes,',len(files['stops']),'stops')
