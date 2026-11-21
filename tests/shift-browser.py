"""Shift mode in the browser: search P085, start the first trip, reach the
terminus, choose the pause and resume. Saves screenshots in build/."""
import importlib.util, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('sv', ROOT / 'tests' / 'safari-voice-browser.py')
sv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sv)
ENGINES = [a for a in sys.argv[1:] if not a.startswith('--')] or ['chromium', 'webkit']
channel = 'chrome' if '--chrome' in sys.argv else None


def run(engine):
    server = sv.serve()
    base = f'http://127.0.0.1:{server.server_address[1]}'
    out = ROOT / 'build'
    out.mkdir(exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = getattr(p, engine).launch(**({'channel': channel} if channel and engine == 'chromium' else {}))
            context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                                          geolocation={'latitude': 45.4106, 'longitude': 11.8810},
                                          permissions=['geolocation'] if engine == 'chromium' else [])
            page = context.new_page()
            # Monday 23/11/2026, 06:05: before the first trip of P085.
            page.clock.install(time='2026-11-23T06:05:00')

            def route(request):
                url = request.request.url
                if url.startswith(base):
                    return request.continue_()
                if 'leaflet' in url and url.endswith('.js'):
                    return request.fulfill(status=200, content_type='application/javascript', body=sv.LEAFLET_STUB)
                return request.abort()
            page.route('**/*', route)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(base + '/index.html')
            page.wait_for_function("academy.length>0", timeout=30000)
            assert page.evaluate("shiftDay.value") == '2026-11-23'
            assert page.evaluate("shiftDay.options[0].textContent") == 'Oggi · Lun 23/11 · Feriale'
            page.fill('#shiftSearch', 'p85')
            page.press('#shiftSearch', 'Enter')
            page.wait_for_selector('#shiftResult .shift-leg', timeout=20000)
            text = page.inner_text('#shiftResult')
            assert 'P085' in text and '06:04 → 14:21' in text and 'Padova - Monselice - Este' in text, text[:400]
            assert 'Pausa 09:54 – 11:14' in text and 'Presa servizio 05:54 · fine 14:26 · deposito Padova' in text, text
            page.screenshot(path=str(out / f'shift-search-{engine}.png'), full_page=True)
            # Choose the GPX of the 06:59 trip once: it is remembered.
            select = page.locator('select[aria-label="GPX della corsa delle 06:59"]')
            first_option = select.locator('option').nth(1).get_attribute('value')
            select.select_option(first_option)
            assert page.evaluate("Object.values(shiftChoices).includes(%s)" % first_option)
            page.click('.shift-start')
            page.wait_for_function("current&&current.academy&&shiftRun&&current.academy.id===shiftRun.routeId", timeout=20000)
            assert page.evaluate("current.academy.name") == '300 | Padova - Monselice - Este'
            # No focused <select>: on iOS its menu would keep the native drive screen from opening.
            assert page.evaluate("document.activeElement?.tagName") != 'SELECT'
            # Terminus of the 06:10 trip.
            page.evaluate("shiftTrack(current.dists.at(-1),5)")
            page.wait_for_selector('#shiftSheet:not([hidden])')
            sheet = page.inner_text('#shiftSheet')
            assert 'Capolinea raggiunto' in sheet and 'PROSSIMA CORSA' in sheet.upper() and '06:59' in sheet, sheet
            page.screenshot(path=str(out / f'shift-terminus-{engine}.png'))
            # 06:45: pause until 06:59, then the next trip with the GPX chosen above.
            page.clock.set_system_time('2026-11-23T06:45:00')
            page.get_by_role('button', name='Pausa fino alle 06:59').click()
            page.wait_for_function("document.querySelector('.shift-clock')?.textContent.includes('fino alle 06:59')")
            page.screenshot(path=str(out / f'shift-pause-{engine}.png'))
            page.get_by_role('button', name='Riprendi: corsa delle 06:59').click()
            page.wait_for_function("current&&current.academy&&current.academy.id===%s" % first_option, timeout=20000)
            assert page.evaluate("readyShift.textContent").startswith('Turno P085 · corsa 2 di 6')
            # Friday 27/11: P046 12:55 takes the market-day detour GPX, the normal one stays selectable.
            page.evaluate("stopNavigation();closeShiftSheet();showWizardStep(0)")
            page.select_option('#shiftDay', '2026-11-27')
            page.fill('#shiftSearch', 'P046')
            page.press('#shiftSearch', 'Enter')
            page.wait_for_selector('#shiftResult .shift-market', timeout=20000)
            market = page.inner_text('#shiftResult .shift-market')
            assert 'Deviazione mercatale del venerdì · Piazzola, fino alle ore 15' in market and 'GPX deviazione: 263' in market, market
            page.screenshot(path=str(out / f'shift-market-{engine}.png'), full_page=True)
            page.get_by_role('button', name='Usa il percorso normale').click()
            assert 'Percorso normale' in page.inner_text('#shiftResult .shift-market')
            page.get_by_role('button', name='Usa la deviazione mercatale').click()
            assert 'Deviazione mercatale del venerdì' in page.inner_text('#shiftResult .shift-market')
            page.select_option('#shiftDay', '2026-11-23')
            page.fill('#shiftSearch', 'P085')
            page.press('#shiftSearch', 'Enter')
            # Simulation: purple button under the start, speed 10x; the terminus comes by itself.
            page.select_option('#shiftDay', '2026-11-23')
            page.fill('#shiftSearch', 'P085')
            page.press('#shiftSearch', 'Enter')
            page.wait_for_selector('#shiftResult .shift-sim')
            saved = page.evaluate("localStorage.getItem('lineapilot-shift-run')")
            page.get_by_role('button', name='10x').click()
            assert page.evaluate("shiftSimSpeed") == 10
            page.screenshot(path=str(out / f'shift-sim-{engine}.png'))
            page.click('.shift-sim')
            page.wait_for_function("shiftRun&&shiftRun.sim&&simulation!==null", timeout=20000)
            assert page.evaluate("readyShift.textContent").startswith('Simulazione 10x · Turno P085 · corsa 1 di 6')
            # fast-forward the virtual drive to the end of the GPX
            page.evaluate("simIndex=current.dists.at(-1)-60")
            page.clock.run_for(3000)
            page.wait_for_selector('#shiftSheet:not([hidden])', timeout=20000)
            sheet = page.inner_text('#shiftSheet')
            assert 'SIMULAZIONE · TURNO P085' in sheet.upper() and 'Capolinea raggiunto' in sheet and 'Pausa fino alle 06:59' not in sheet, sheet
            assert page.evaluate("Math.round(shiftNow())") == 6 * 60 + 59  # virtual clock at the scheduled arrival
            assert page.evaluate("localStorage.getItem('lineapilot-shift-run')") == saved, 'a simulation never replaces the real shift'
            page.get_by_role('button', name='Termina simulazione').click()
            assert page.evaluate("shiftRun&&!shiftRun.sim&&shiftRun.code") == 'P085', 'the real shift is back'
            # Reload: the running shift is restored for today.
            page.reload()
            page.wait_for_function("academy.length>0", timeout=30000)
            # (the fake clock may start after the first script run: restore again under it)
            assert page.evaluate("restoreShiftRun()")
            page.wait_for_selector('#shiftResult .shift-leg.current', timeout=30000)
            assert 'Riprendi turno' in page.inner_text('#shiftResult')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
    print('Shift mode checks passed on', engine)


if __name__ == '__main__':
    for name in ENGINES:
        run(name)
