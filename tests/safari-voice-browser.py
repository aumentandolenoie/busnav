"""Web app as used on iPhone Safari: voice unlock rule, silent switch and the driving view with real JS.

Safari speaks only if the first utterance starts while a tap is being handled;
afterwards speech works from code. The mock below enforces exactly that rule, so
an `await` before the first utterance (the bug that left the web voice silent
until "Riattiva voce" was tapped) makes this test fail.
The ring/silent switch is modelled as ON: speech is audible only once the page
switched to media audio (navigator.audioSession.type = "playback", or a media
element played inside a tap on iOS without the Audio Session API).
"""
from pathlib import Path
import functools, http.server, json, sys, threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
IPHONE = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 '
          '(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1')
ENGINES = [a for a in sys.argv[1:] if not a.startswith('--')] or ['chromium', 'webkit']
LEAFLET_STUB = ("(function(){const f=function(){};const p=new Proxy(f,{get:(t,k)=>k===Symbol.toPrimitive?(()=>0):"
                "k==='then'?undefined:p,apply:()=>p,construct:()=>p});window.L=p;})();")
SAFARI_SPEECH = """
window.__inGesture=false;window.__said=[];window.__dropped=[];window.__mediaInTap=0;
Object.defineProperty(navigator,'audioSession',{value:{type:'auto'},configurable:true});
const realPlay=HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play=function(){if(window.__inGesture)window.__mediaInTap++;return Promise.resolve()};
addEventListener('click',()=>{window.__inGesture=true},true);
addEventListener('click',()=>{window.__inGesture=false},false);
(()=>{let unlocked=false;const synth={speaking:false,pending:false,paused:false,
 getVoices:()=>[{name:'Federica (Premium)',lang:'it-IT',voiceURI:'com.apple.voice.premium.it-IT.Federica',localService:true},
  {name:'Alice',lang:'it-IT',voiceURI:'com.apple.voice.compact.it-IT.Alice',localService:true},
  {name:'Eddy (italiano)',lang:'it-IT',voiceURI:'com.apple.eloquence.it-IT.Eddy',localService:true}],
 addEventListener(){},resume(){},cancel(){this.speaking=false},
 speak(u){if(!unlocked&&!window.__inGesture){window.__dropped.push(u.text);return}
  unlocked=true;this.speaking=true;
  setTimeout(()=>{u.onstart&&u.onstart();if(u.text.trim())window.__said.push([u.text,u.voice&&u.voice.name,navigator.audioSession.type==='playback'||window.__mediaInTap>0]);
   setTimeout(()=>{this.speaking=false;u.onend&&u.onend()},300)},40)}};
 Object.defineProperty(window,'speechSynthesis',{value:synth,configurable:true});
 window.SpeechSynthesisUtterance=function(t){this.text=t};})();
"""


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def open_route(page, base):
    def route(request):
        url = request.request.url
        if url.startswith(base):
            return request.continue_()
        if 'leaflet' in url and url.endswith('.js'):
            return request.fulfill(status=200, content_type='application/javascript', body=LEAFLET_STUB)
        if url.endswith('.js'):
            return request.fulfill(status=200, content_type='application/javascript', body='')
        return request.abort()
    page.route('**/*', route)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base + '/index.html')
    page.wait_for_function("academyCount.textContent.includes('percorsi')", timeout=20000)
    page.evaluate("pickAcademyRoute(academy.find(r=>r.id===124))")
    page.wait_for_function("current&&turns.some(t=>t.verifiedRoad)&&current.roadCameras.length>0", timeout=20000)
    return errors


DRIVE = """(async()=>{const c=current.roadCameras[0];for(let a=0;a<c.at-120;a+=15){
 updatePosition(pointAt(current.points,current.dists,a),5,13.9,false);await new Promise(r=>setTimeout(r,40))}})()"""


def main():
    server = serve()
    (ROOT / 'build/safari-voice').mkdir(parents=True, exist_ok=True)
    base = f'http://127.0.0.1:{server.server_address[1]}'
    results = []
    with sync_playwright() as p:
        for engine in ENGINES:
            browser = getattr(p, engine).launch(**({'channel': 'chrome'} if engine == 'chromium' and '--chrome' in sys.argv else {}))
            # 1. Voice: start with real GPS from a tap, then drive without any further tap.
            context = browser.new_context(viewport={'width': 390, 'height': 844}, user_agent=IPHONE,
                                          geolocation={'latitude': 45.2272, 'longitude': 11.6585}, permissions=['geolocation'])
            context.add_init_script(SAFARI_SPEECH)
            page = context.new_page()
            errors = open_route(page, base)
            page.evaluate("voiceToggle.checked=true;startNav.disabled=false")
            page.evaluate("startNav.click()")
            page.wait_for_timeout(1500)
            assert page.evaluate("__said.length") >= 1, (engine, 'first cue dropped by Safari', page.evaluate("__dropped"))
            page.evaluate(DRIVE)
            page.wait_for_timeout(9000)
            said = page.evaluate("__said")
            texts = [t for t, _, _ in said]
            assert all(audible for _, _, audible in said), (engine, 'speech muted by the silent switch', said)
            assert page.evaluate("navigator.audioSession.type") == 'playback', engine
            assert page.evaluate("__mediaInTap") >= 1, (engine, 'silent clip not played inside the tap')
            assert len(said) >= 6, (engine, 'cues not spoken while driving', said, page.evaluate("__dropped"))
            assert any('autovelox' in t for t in texts), (engine, 'camera cue missing', texts)
            assert all(v == 'Federica (Premium)' for _, v, _ in said), (engine, 'best Italian voice not used', said)
            assert not any(', A' in t for t in texts), (engine, 'capital letter after the distance', texts)
            assert page.evaluate("driveStatus.dataset.problem") == 'no', (engine, page.evaluate("driveStatus.textContent"))
            assert not errors, (engine, errors)
            page.evaluate("exitNavigation.click()")
            assert page.evaluate("navigator.audioSession.type") == 'auto', (engine, 'audio session not released after Termina')
            results.append({'engine': engine, 'spoken': len(said), 'sample': texts[:4]})
            context.close()
            # 2. Driving view with the real layout code, portrait and landscape.
            for w, h, top, bottom, left, right in [(390, 844, 59, 34, 0, 0), (320, 568, 20, 0, 0, 0), (844, 390, 0, 21, 59, 59)]:
                context = browser.new_context(viewport={'width': w, 'height': h})
                context.add_init_script(SAFARI_SPEECH)
                page = context.new_page()
                page.add_init_script(f"document.addEventListener('DOMContentLoaded',()=>{{const s=document.createElement('style');"
                                     f"s.textContent=':root{{--safe-top:{top}px;--safe-bottom:{bottom}px;--safe-left:{left}px;--safe-right:{right}px}}';"
                                     f"document.head.append(s)}})")
                errors = open_route(page, base)
                page.evaluate("enterNavigationView()")
                page.evaluate(DRIVE)
                page.wait_for_timeout(2500)
                report = page.evaluate("""() => {
                  const rect = e => { const r = e.getBoundingClientRect(); return {x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height}; };
                  const ids = ['driveRepeat','exitNavigation','driveVoiceToggle','driveRecenter','driveCompass'];
                  return {
                    buttons: ids.map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(),
                      hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return {id, ...rect(e), hit: e === hit || e.contains(hit)}; }),
                    top: rect(driveTop), bottomPanel: rect(driveBottom), tools: rect(driveTools), arrow: rect(navigationPosition),
                    sign: speedLimitSign.hidden ? '' : speedLimitSign.textContent, turn: driveDistance.textContent + ' ' + driveInstruction.textContent };
                }""")
                name = f'{engine}-drive-{w}x{h}'
                for b in report['buttons']:
                    assert b['width'] >= 43.9 and b['height'] >= 43.9, (name, 'small button', b)
                    assert b['hit'], (name, 'covered button', b)
                    assert b['y'] >= top - .5 and b['bottom'] <= h - bottom + .5, (name, 'unsafe button', b)
                t, bp, tools, arrow = report['top'], report['bottomPanel'], report['tools'], report['arrow']
                assert t['bottom'] < bp['y'], (name, 'panels overlap', t, bp)
                landscape = w > h
                if not landscape:
                    assert tools['bottom'] <= bp['y'] + .5, (name, 'speed/compass row on the stop panel', tools, bp)
                    centre = arrow['y'] + arrow['height'] / 2
                    expected = t['bottom'] + 8 + (bp['y'] - 8 - t['bottom'] - 8) * .75
                    assert abs(centre - expected) < 3, (name, 'vehicle not at 75% of the free map', centre, expected)
                else:
                    assert arrow['x'] > t['right'], (name, 'vehicle hidden by the panel column', arrow, t)
                assert report['sign'], (name, 'speed limit sign missing')
                # 3. On-board ticket calculator: bottom-left button, sheet over the running navigation.
                ticket = page.evaluate("""() => { const r = ticketButton.getBoundingClientRect(), s = speedLimitSign.getBoundingClientRect();
                  const hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
                  return {x:r.x, y:r.y, w:r.width, h:r.height, bottom:r.bottom, hit: ticketButton.contains(hit), signY: s.y + s.height/2, signH: s.height}; }""")
                assert abs(ticket['w'] - 46) < .6 and abs(ticket['h'] - ticket['signH']) < .6, (name, 'ticket button not sized like the speed sign', ticket)
                assert ticket['hit'] and abs(ticket['y'] + ticket['h']/2 - ticket['signY']) < 2, (name, 'ticket button not on the speed sign row', ticket)
                if landscape:
                    assert ticket['x'] > t['right'], (name, 'ticket button under the panel column', ticket, t)
                else:
                    assert ticket['x'] <= left + 13 and ticket['bottom'] <= bp['y'] + .5, (name, 'ticket button not bottom-left', ticket)
                page.click('#ticketButton')
                page.wait_for_function("!ticketSheet.hidden && ticketLine.options.length > 5", timeout=5000)
                sheet = page.evaluate("""() => { const r = ticketSheet.getBoundingClientRect(), line = ticketData.lines[ticketState.line];
                  return {x:r.x, y:r.y, right:r.right, bottom:r.bottom, line: line && line.code, from: ticketFrom.selectedOptions[0].textContent,
                    near: line && line.stops[Tickets.nearestStop(line, lastFix.lat, lastFix.lng)][0],
                    result: ticketResult.textContent, nav: navigationFullscreen && !driveView.hidden && !!current}; }""")
                assert sheet['line'] == 'E008' and sheet['near'] and sheet['from'].endswith(' · ' + sheet['near']), (name, 'line or boarding stop not pre-filled', sheet)
                assert sheet['result'] == 'Scegli la discesa', (name, sheet)
                assert sheet['y'] >= t['bottom'] - .5 or landscape, (name, 'sheet covers the instruction panel', sheet, t)
                assert sheet['bottom'] <= h - bottom + .5 and sheet['x'] >= 0 and sheet['right'] <= w + .5, (name, 'sheet outside the screen', sheet)
                target = page.evaluate("ticketData.lines[ticketState.line].stops.findIndex(s => s[0] === 'BADIA AUTOSTAZIONE')")
                page.select_option('#ticketTo', str(target))
                expected = page.evaluate("Tickets.fare(ticketData, ticketData.lines[ticketState.line], ticketState.from, ticketState.to).text")
                got = page.evaluate("ticketResult.textContent")
                assert got == expected and got.endswith(' a bordo') and got.startswith('Classe '), (name, got, expected)
                page.evaluate(DRIVE)
                page.wait_for_timeout(600)
                assert page.evaluate("navigationFullscreen && !driveView.hidden && !ticketSheet.hidden && lastFix !== null"), (name, 'navigation stopped by the sheet')
                page.screenshot(path=str(ROOT / 'build/safari-voice' / (name + '-ticket.png')))
                page.click('#ticketClose')
                assert page.evaluate("ticketSheet.hidden && ticketButton.getAttribute('aria-expanded') === 'false'"), name
                results.append({'case': name + '-ticket', 'result': got})
                assert not errors, (name, errors)
                out = ROOT / 'build/safari-voice'
                page.screenshot(path=str(out / (name + '.png')))
                results.append({'case': name, 'turn': report['turn'], 'sign': report['sign']})
                context.close()
            browser.close()
    server.shutdown()
    print(json.dumps(results, indent=1, ensure_ascii=False))
    print(f'Safari voice and driving view checks passed on {", ".join(ENGINES)}')


if __name__ == '__main__':
    main()
