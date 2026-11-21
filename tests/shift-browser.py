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
            assert page.evaluate("shiftDay.value") == 'weekday'
            page.fill('#shiftSearch', 'p85')
            page.press('#shiftSearch', 'Enter')
            page.wait_for_selector('#shiftResult .shift-leg', timeout=20000)
            text = page.inner_text('#shiftResult')
            assert 'P085' in text and '06:04 → 14:21' in text and 'Padova - Monselice - Este' in text, text[:400]
            assert 'Pausa 09:50 – 11:14' in text, text
            page.screenshot(path=str(out / f'shift-search-{engine}.png'), full_page=True)
            # Choose the GPX of the 06:59 trip once: it is remembered.
            select = page.locator('select[aria-label="GPX della corsa delle 06:59"]')
            first_option = select.locator('option').nth(1).get_attribute('value')
            select.select_option(first_option)
            assert page.evaluate("Object.values(shiftChoices).includes(%s)" % first_option)
            page.click('.shift-start')
            page.wait_for_function("current&&current.academy&&shiftRun&&current.academy.id===shiftRun.routeId", timeout=20000)
            assert page.evaluate("current.academy.name") == '300 | Padova - Monselice - Este'
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
