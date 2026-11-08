#!/usr/bin/env python3
"""Check actual APK resources, all GPX, voice coverage and native map runtime."""
import hashlib,json,pathlib,sys,zipfile
path=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'android/app/build/outputs/apk/debug/app-debug.apk')
with zipfile.ZipFile(path) as z:
    assert z.testzip() is None
    original=z.read('assets/official-routes.json');extra=z.read('assets/academy-supplemental-routes.json')
    assert len(json.loads(original))==787 and len(json.loads(extra))==2
    assert hashlib.sha256(original).hexdigest()=='1a6bb11b15550def33e20095758c0f48dc33259ef2f4010fd9bc5c22aa346ac7'
    coverage=json.loads(z.read('assets/road-guidance/coverage.json'))
    assert len(coverage['routes'])==789
    assert coverage['gpxSHA256']==hashlib.sha256(original+b'\0'+extra).hexdigest()
    for route in coverage['routes']:
        if route['status'] in ('validated','partial'):assert z.getinfo('assets/road-guidance/'+str(route['id'])+'.json').file_size>0
    assert any(n.startswith('lib/arm64-v8a/') and n.endswith('.so') and ('maplibre' in n or 'mbgl' in n) for n in z.namelist()),'Native map runtime missing'
    for name in ['leaflet.js','leaflet.css','leaflet-rotate.js','jszip.js']:assert z.getinfo('assets/vendor/'+name).file_size>0
    html=z.read('assets/index.html').decode();assert 'https://unpkg.com/' not in html and 'https://cdnjs.cloudflare.com/' not in html
    assert z.getinfo('assets/apple-touch-icon.png').file_size>0
print('APK: 789 immutable GPX, identical validated voice coverage, native map runtime, offline UI and icons verified')
