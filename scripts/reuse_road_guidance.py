#!/usr/bin/env python3
"""Reuse a recent, immutable-GPX-compatible release bundle for native-only fixes."""
import enrich_road_guidance as road
import road_safety
import io
import json
import os
from pathlib import Path
import urllib.request
import urllib.parse
import zipfile
from datetime import datetime, timezone
import time
from guidance_audit import summarize


SEEN_INCOMPATIBLE=set()

def main():
    token = os.environ['GH_TOKEN']
    repo = os.environ['GITHUB_REPOSITORY']
    root = Path(__file__).resolve().parent.parent
    catalog = road.load_catalog()
    validator = road_safety.validator_digest()
    digest = road.catalog_digest()
    class SafeRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, response, code, message, headers, newurl):
            redirected = super().redirect_request(request,response,code,message,headers,newurl)
            if redirected and urllib.parse.urlparse(newurl).netloc != urllib.parse.urlparse(request.full_url).netloc:
                redirected.remove_header('Authorization')
            return redirected
    opener = urllib.request.build_opener(SafeRedirect())
    def request(url, binary=False):
        req = urllib.request.Request(url, headers={'Authorization':'Bearer '+token,'Accept':'application/octet-stream' if binary else 'application/vnd.github+json'})
        with opener.open(req,timeout=60) as response:
            return response.read() if binary else json.load(response)
    try:
        releases = request(f'https://api.github.com/repos/{repo}/releases?per_page=40')
        for release in releases:
            if not release.get('tag_name','').startswith('ios-preview-'):
                continue
            asset = next((a for a in release.get('assets',[]) if a['name']=='navigation-data.zip'),None)
            if not asset or asset["id"] in SEEN_INCOMPATIBLE: continue
            raw = request(asset['url'],True)
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                coverage = json.loads(archive.read('road-guidance/coverage.json'))
                if coverage.get('gpxSHA256') == digest and not (root/'build/road-guidance-before.json').exists():
                    samples=[json.loads(archive.read(name)) for name in archive.namelist() if name.startswith('road-guidance/') and name.endswith('.json') and not name.endswith('/coverage.json')]
                    (root/'build').mkdir(exist_ok=True)
                    (root/'build/road-guidance-before.json').write_text(json.dumps({'sourceRelease':release['tag_name'],**summarize(samples)},ensure_ascii=False,indent=2)+'\n')
                age = datetime.now(timezone.utc)-datetime.fromisoformat(coverage['generatedAt'])
                if coverage.get('validatorSHA256') != validator or coverage.get('speedLimitPolicy') != road_safety.SPEED_LIMIT_POLICY or coverage['gpxSHA256'] != digest or age.total_seconds() < 0 or age.days >= 7 or not coverage['validated']:
                    SEEN_INCOMPATIBLE.add(asset['id'])
                    continue
                if len(coverage.get('routes',[])) != len(catalog): continue
                # Only known route IDs and the coverage report may be extracted;
                # copies committed for the web app are replaced, never mixed in.
                for stale in (root/'road-guidance').glob('*.json'):
                    stale.unlink()
                names = {'road-guidance/'+str(r['id'])+'.json' for r in catalog}
                names.add('road-guidance/coverage.json')
                for name in archive.namelist():
                    if name not in names: continue
                    target = root/name
                    target.parent.mkdir(exist_ok=True)
                    target.write_bytes(archive.read(name))
                with open(os.environ['GITHUB_OUTPUT'],'a') as output:
                    output.write('reused=true\n')
                print('Reused validated instructions:',release['tag_name'],coverage['generatedAt'],coverage['validated'],'routes')
                return True
    except Exception as error:
        print('No compatible release cache:',str(error))
    print('Fresh OSM generation required')

if __name__=='__main__':
    deadline=time.monotonic()+int(os.environ.get('ROAD_GUIDANCE_WAIT_SECONDS','0'))
    while not main():
        if time.monotonic()>=deadline:break
        print('Waiting for the iOS producer to publish newly validated road data…',flush=True)
        time.sleep(30)


