#!/usr/bin/env python3
"""Reuse a recent, immutable-GPX-compatible release bundle for native-only fixes."""
import enrich_road_guidance as road
import hashlib
import io
import json
import os
from pathlib import Path
import urllib.request
import urllib.parse
import zipfile
from datetime import datetime, timezone


def main():
    token = os.environ['GH_TOKEN']
    repo = os.environ['GITHUB_REPOSITORY']
    root = Path(__file__).resolve().parent.parent
    catalog = road.load_catalog()
    legacy_validator = 'b3aa6a071569f084b2cf6e0e569af409619f22d1341f5aceb75b956e662072f2'
    validator = hashlib.sha256((root/'scripts/enrich_road_guidance.py').read_bytes()).hexdigest()
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
            if not asset: continue
            raw = request(asset['url'],True)
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                coverage = json.loads(archive.read('road-guidance/coverage.json'))
                age = datetime.now(timezone.utc)-datetime.fromisoformat(coverage['generatedAt'])
                if coverage.get('validatorSHA256',legacy_validator) != validator or coverage['gpxSHA256'] != digest or age.total_seconds() < 0 or age.days >= 7 or not coverage['validated']:
                    continue
                if len(coverage.get('routes',[])) != len(catalog): continue
                # Only known route IDs and the coverage report may be extracted.
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
                return
    except Exception as error:
        print('No compatible release cache:',str(error))
    print('Fresh OSM generation required')

if __name__=='__main__': main()
