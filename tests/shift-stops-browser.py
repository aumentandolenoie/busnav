"""Shift trips get their stops from GTFS even when no trip leaves at exactly the shift time
(fixture: busitalia-patterns, one trip per pattern)."""
import importlib.util, pathlib, sys, json
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('sv',ROOT/'tests'/'safari-voice-browser.py');sv=importlib.util.module_from_spec(spec);spec.loader.exec_module(sv)
import shutil,subprocess
JSZIP=None
for c in ['/opt/node-tools/node_modules/jszip/dist/jszip.min.js','/opt/npm-tools/node_modules/jszip/dist/jszip.min.js',str(ROOT/'node_modules/jszip/dist/jszip.min.js')]:
    if pathlib.Path(c).exists():JSZIP=pathlib.Path(c).read_text();break
if JSZIP is None:
    subprocess.run(['npm','install','--no-save','--prefix',str(ROOT/'build/jszip'),'jszip@3.10.1'],check=True)
    JSZIP=(ROOT/'build/jszip/node_modules/jszip/dist/jszip.min.js').read_text()
server=sv.serve();base=f'http://127.0.0.1:{server.server_address[1]}'
with sync_playwright() as p:
    b=p.chromium.launch(**({'channel':'chrome'} if '--chrome' in sys.argv else {}));page=b.new_context(viewport={'width':390,'height':844}).new_page()
    page.clock.install(time='2026-11-27T11:20:00')
    def route(r):
        u=r.request.url
        if u.startswith(base):return r.continue_()
        if 'gtfs.zip' in u:return r.fulfill(status=200,content_type='application/zip',body=open(ROOT/'tests/fixtures/busitalia-patterns-2026-11-08.zip','rb').read())
        if 'jszip' in u:return r.fulfill(status=200,content_type='application/javascript',body=JSZIP)
        if 'leaflet' in u and u.endswith('.js'):return r.fulfill(status=200,content_type='application/javascript',body=sv.LEAFLET_STUB)
        return r.abort()
    page.route('**/*',route)
    errs=[];page.on('pageerror',lambda e:errs.append(str(e)));page.on('console',lambda m:print('console',m.text) if 'ferm' in m.text.lower() or 'stop' in m.text.lower() else None)
    page.goto(base+'/index.html');page.wait_for_function("academy.length>0",timeout=30000)
    page.fill('#shiftSearch','P054');page.press('#shiftSearch','Enter')
    page.wait_for_selector('#shiftResult .shift-leg',timeout=20000)
    page.evaluate("initializeGTFS()")
    page.wait_for_function("!!feed",timeout=60000)
    res=page.evaluate("""(()=>{const s=currentShift()||shiftShown;return s.legs.filter(l=>l.kind==='service').map(l=>{const t=shiftGtfsTrip(l);
      const r=shiftRoute(l);let n=null,status='';if(t&&r){pickAcademyRoute(r,false);showAcademyRoute(true,t);n=current?.stops?.length;status=document.getElementById('officialInfo')?.textContent||''}
      return {dep:l.dep,line:l.line,route:shiftRoute(l)?.id,trip:t?.trip_id||null,headsign:t?.trip_headsign,stops:n,gtfsStops:t?(feed.timesByTrip.get(t.trip_id)||[]).length:0,status:status.slice(0,160)}})})()""")
    for r in res: print(r)
    legs={r['dep']:r for r in res}
    # Shift P054, Mirano → Padova 12:20: no GTFS trip at exactly 12:20 → same-line trip that
    # starts and ends where the GPX does; its stops must be shown and announced.
    assert legs['12:20']['stops'] and legs['12:20']['stops'] > 20, legs['12:20']
    assert legs['11:25']['trip'] == '590006' and legs['11:25']['stops'] == 36, legs['11:25']
    assert not errs, errs
    print('Shift stop association checks passed')
server.shutdown()
