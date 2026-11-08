"""Render production HTML/CSS without GTFS/network; test real browser geometry."""
from pathlib import Path
import json,re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text();html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S);html=re.sub(r'<link[^>]*>','',html)
css=(ROOT/'style.css').read_text()
out=ROOT/'build/layout-browser';out.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
 for engine in ['chromium','webkit']:
  browser=getattr(p,engine).launch()
  for w,h,top,bottom,left,right in [(320,568,20,0,0,0),(375,667,20,0,0,0),(390,844,59,34,0,0),(440,956,62,34,0,0),(844,390,0,21,59,59)]:
   for large in [False,True]:
    page=browser.new_page(viewport={'width':w,'height':h},device_scale_factor=1)
    for mode in ['navigation','preparation']:
     doc=html
     if mode=='navigation':
      doc=doc.replace('<body>','<body class="navigating">')
      doc=doc.replace('id="navFullscreenBar" class="nav-fullscreen-bar" hidden','id="navFullscreenBar" class="nav-fullscreen-bar"')
      doc=doc.replace('id="voiceNavigationControls" hidden','id="voiceNavigationControls"')
      doc=doc.replace('id="navStatus">Seleziona una corsa','id="navStatus">GPS in verifica: seguire il percorso ufficiale')
      doc=doc.replace('id="nextName">—','id="nextName">PADOVA AUTOSTAZIONE – CAPOLINEA PROVVISORIO VIALE DELLA STAZIONE')
      doc=doc.replace('id="turnHint">Percorso non attivo','id="turnHint">Alla prossima rotonda prendi la terza uscita in direzione Aeroporto Marco Polo')
      doc=doc.replace('>Voce in attesa<','>App riaperta: controlla gli annunci vocali e la precisione della posizione<')
     else:doc=doc.replace('<details class="panel advanced-panel">','<details class="panel advanced-panel" open>')
     overrides=f':root{{--safe-top:{top}px;--safe-bottom:{bottom}px;--safe-left:{left}px;--safe-right:{right}px}}'
     if large:overrides+='button,.map-top strong,#nextName,#voiceNavStatus,#headingStatus{font-size:22px!important}'
     page.set_content(doc.replace('</head>','<style>'+css+overrides+'</style></head>'))
     name=f'{engine}-{mode}-{w}x{h}-{int(large)}'
     if mode=='navigation':
      report=page.evaluate('''() => {
       const ids=['exitNavigation','activateNavVoice','recenterBtn'];
       const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
       return {buttons:ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id,...rect(e),hit:e===hit||e.contains(hit)}}),panels:['.nav-fullscreen-bar','.map-top','.voice-navigation-controls','.map-controls','.next-card'].map(s=>({id:s,...rect(document.querySelector(s))}))};
      }''')
      for b in report['buttons']:
       assert b['width']>=43.9 and b['height']>=43.9,(name,'small button',b)
       assert b['y']>=top and b['bottom']<=h-bottom+.5 and b['x']>=left and b['right']<=w-right+.5,(name,'unsafe button',b)
       assert b['hit'],(name,'covered button',b)
      for i,a in enumerate(report['panels']):
       assert a['y']>=top-.5 and a['bottom']<=h-bottom+.5,(name,'unsafe panel',a)
       for b in report['panels'][i+1:]:
        overlap=min(a['right'],b['right'])-max(a['x'],b['x'])>1 and min(a['bottom'],b['bottom'])-max(a['y'],b['y'])>1
        assert not overlap,(name,'panels overlap',a,b)
      results.append({'case':name,**report})
     else:
      assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(name,'horizontal overflow')
      for button in page.locator('button').all():
       if not button.is_visible():continue
       button.scroll_into_view_if_needed()
       r=button.bounding_box();assert r['width']>=43.9 and r['height']>=43.9,(name,'small prep button',r)
       assert button.evaluate('(e) => {const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===hit||e.contains(hit)}'),(name,'covered prep button',button.get_attribute('id'))
      results.append({'case':name,'preparationControls':'passed'})
     page.screenshot(path=str(out/(name+'.png')),full_page=False)
    page.close()
  browser.close()
(out/'results.json').write_text(json.dumps(results,indent=2))
(out/'results.json').write_text(json.dumps(results,indent=2))
print(f'{len(results)} browser layout scenarios passed; screenshots and rectangles in {out}')
