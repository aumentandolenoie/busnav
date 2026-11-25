"""Temporary detours in the browser: the detour GPX replaces the official one only
inside the communication's windows, the normal route is one tap away, a replaced
communication is listed as such, and shift trips pick the detour from their own times.
Uses deviazioni.json when present, else a stand-in built from the official GPX."""
import importlib.util, json, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('sv', ROOT / 'tests' / 'safari-voice-browser.py')
sv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sv)
ENGINES = [a for a in sys.argv[1:] if not a.startswith('--')] or ['chromium', 'webkit']
channel = 'chrome' if '--chrome' in sys.argv else None


def stand_in():
    path = ROOT / 'deviazioni.json'
    if path.exists():
        return path.read_text()
    routes = {r['id']: r for r in json.loads((ROOT / 'official-routes.json').read_text()) if r['id'] in (132, 135)}
    windows = [{'from': f'2026-11-{d}T20:30', 'to': f'2026-11-{d + 1}T05:30'} for d in (25, 26, 27)]
    return json.dumps({
        'version': 1, 'updatedAt': '2026-11-25T15:00:00+00:00',
        'communications': [
            {'number': 656, 'date': '2026-11-23', 'title': 'Deviazione', 'lines': ['E015-V'], 'status': 'sostituita', 'replacedBy': 665, 'windows': [], 'detours': []},
            {'number': 665, 'date': '2026-11-25', 'title': 'Chiusura raccordo Marco Polo', 'lines': ['E015-V'], 'status': 'valida',
             'replaces': [656], 'windows': windows, 'detours': [{'route': 665135, 'base': 135, 'direction': 'Da Padova per Aeroporto'},
                                                                 {'route': 665132, 'base': 132, 'direction': 'Da Aeroporto per Padova'}]}],
        'routes': [{**{k: routes[b][k] for k in ('category', 'line', 'variant', 'filename', 'points')}, 'id': 665000 + b, 'base': b,
                    'communication': 665, 'name': routes[b]['name'] + ' · deviazione Com. 665', 'direction': d, 'text': 'Percorso di prova',
                    'leaveAtM': lo, 'rejoinAtM': hi, 'baseLengthM': 45000, 'guidance': None}
                   for b, d, lo, hi in ((135, 'Da Padova per Aeroporto', 31000, 43000), (132, 'Da Aeroporto per Padova', 300, 13000))]})


def run(engine):
    server = sv.serve()
    base = f'http://127.0.0.1:{server.server_address[1]}'
    out = ROOT / 'build'
    out.mkdir(exist_ok=True)
    body = stand_in()
    try:
        with sync_playwright() as p:
            browser = getattr(p, engine).launch(**({'channel': channel} if channel and engine == 'chromium' else {}))
            context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            page = context.new_page()
            # Wednesday 25/11/2026, 21:00: inside the first night of n.665.
            page.clock.install(time='2026-11-25T21:00:00')

            def route(request):
                url = request.request.url
                if url.startswith(base + '/deviazioni.json'):
                    return request.fulfill(status=200, content_type='application/json', body=body)
                if url.startswith(base):
                    return request.continue_()
                if 'leaflet' in url and url.endswith('.js'):
                    return request.fulfill(status=200, content_type='application/javascript', body=sv.LEAFLET_STUB)
                return request.abort()
            page.route('**/*', route)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(base + '/index.html')
            page.wait_for_function("academy.length>0&&deviazioniData", timeout=30000)
            listing = page.inner_text('#detourList')
            assert 'Com. n.665' in listing and 'In corso' in listing, listing
            assert 'Com. n.656' in listing and 'Sostituita' in listing, listing
            page.screenshot(path=str(out / f'detour-list-{engine}.png'))
            # Manual: Padova → Aeroporto now → detour GPX, normal route one tap away.
            page.evaluate("pickAcademyRoute(academy.find(r=>r.id===135),false)")
            assert page.evaluate("selectedOfficial.id") == 665135
            assert page.evaluate("current.academy.id") == 665135 and page.evaluate("!!current.academy._detour")
            if (ROOT / 'deviazioni.json').exists():
                # The detour's own voice instructions pass the same validation as official GPX.
                page.wait_for_function("turns.length>0", timeout=10000)
                assert page.evaluate("turns.some(t=>/Forte Carpenedo/.test(t.text))"), page.evaluate("turns.map(t=>t.text)")
            box = page.inner_text('#detourBox')
            assert 'Com. n.665' in box and 'Usa il percorso normale' in box, box
            page.screenshot(path=str(out / f'detour-manual-{engine}.png'), full_page=True)
            page.click('#detourBox .shift-market-toggle')
            assert page.evaluate("selectedOfficial.id") == 135
            assert 'Percorso normale' in page.inner_text('#detourBox')
            page.click('#detourBox .shift-market-toggle')
            assert page.evaluate("selectedOfficial.id") == 665135
            # Another line is not touched.
            page.evaluate("pickAcademyRoute(academy.find(r=>r.id===133),false)")
            assert page.evaluate("selectedOfficial.id") == 133 and page.is_hidden('#detourBox')
            # Shift P008 on 25/11: 19:30 to the airport is before the closure, 20:30 back is detoured.
            page.fill('#shiftSearch', 'P008')
            page.press('#shiftSearch', 'Enter')
            page.wait_for_selector('#shiftResult .shift-leg', timeout=20000)
            res = page.evaluate("""(()=>{const s=currentShift()||shiftShown;return s.legs.filter(Turni.driven).filter(l=>[132,135].includes(shiftPlan(l,s).route))
               .map(l=>({dep:l.dep,detour:shiftDetour(l,s)?.route?.id||null}))})()""")
            assert {'dep': '19:30', 'detour': None} in res and {'dep': '20:30', 'detour': 665132} in res, res
            assert page.locator('#shiftResult .shift-market.detour').count() >= 1
            page.screenshot(path=str(out / f'detour-shift-{engine}.png'), full_page=True)
            # Afternoon: no detour anywhere.
            page.evaluate("pickAcademyRoute(academy.find(r=>r.id===132),false)")
            assert page.evaluate("selectedOfficial.id") == 665132
            # 19:42 from Padova reaches the raccordo around 20:16 (trip 45 min in the shifts): normal route.
            page.clock.set_system_time('2026-11-25T19:42:00')
            assert page.evaluate("timetableMinutes(135)") == 45
            page.evaluate("pickAcademyRoute(academy.find(r=>r.id===135),false)")
            assert page.evaluate("selectedOfficial.id") == 135
            page.clock.set_system_time('2026-11-25T19:58:00')
            page.evaluate("pickAcademyRoute(academy.find(r=>r.id===135),false)")
            assert page.evaluate("selectedOfficial.id") == 665135
                        # 16:00, outside the windows: "Vedi deviazione" shows the detour anyway, then back to normal.
            page.clock.set_system_time('2026-11-25T16:00:00')
            page.evaluate("renderDetourList()")
            item = page.locator('#detourList details.detour-item.programmata')
            item.locator('summary').click()
            item.locator('.detour-see').first.click()
            assert page.evaluate("current.academy.id") in (665132, 665135), page.evaluate("current.academy.id")
            box = page.inner_text('#detourBox')
            assert 'Anteprima' in box and 'non è in vigore' in box, box
            page.screenshot(path=str(out / f'detour-preview-{engine}.png'), full_page=True)
            page.click('#detourBox .shift-market-toggle')
            assert page.evaluate("!current.academy._detour") and page.is_hidden('#detourBox')
            # "Simula deviazione" at 5x starts shortly before the detour.
            item.locator('.shift-speed button[data-speed="5"]').click()
            item.locator('.detour-sim').first.click()
            page.wait_for_function("!!simulation", timeout=5000)
            assert page.evaluate("demoSpeed()") == 5
            start = page.evaluate("demoStartM()")
            leave = page.evaluate("current.academy._detour.leaveAtM")
            assert leave - 1500 <= start <= leave or start == 0, (start, leave)
            page.evaluate("stopNavigation()")
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
    print('OK', engine)


for engine in ENGINES:
    run(engine)
