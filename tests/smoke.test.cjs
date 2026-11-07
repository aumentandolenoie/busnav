'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const js=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
function sourceOf(name){
 const match=new RegExp('function\\s+'+name+'\\s*\\(').exec(js);
 assert.ok(match,'Missing '+name);
 let first=js.indexOf('{',match.index),depth=1,index=first+1;
 while(depth&&index<js.length){if(js[index]==='{')depth++;else if(js[index]==='}')depth--;index++;}
 assert.equal(depth,0,'Unbalanced function '+name);
 return js.slice(match.index,index);
}
test('application and service worker parse as JavaScript',()=>{
 new Function(js);new Function(sw);
});
test('all JS element selectors correspond to HTML ids',()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 for(const [,id] of js.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(id),'Missing element #'+id);
});
test('787 Academy GPX stay complete and uniquely identified',()=>{
 const routes=JSON.parse(fs.readFileSync('official-routes.json','utf8'));
 assert.equal(routes.length,787);
 assert.equal(new Set(routes.map(r=>r.id)).size,787);
 for(const [category,expected] of Object.entries({Extraurbano:557,Colli:29,Urbano:201})){
  assert.equal(routes.filter(r=>r.category===category).length,expected);
 }
 assert.ok(routes.every(r=>Array.isArray(r.points)&&r.points.length>=2));
});
test('GPX interpolation never returns the start after journey end',()=>{
 const f=vm.runInNewContext(sourceOf('pointAt')+';pointAt');
 const pts=[{lat:45,lng:11},{lat:46,lng:12},{lat:47,lng:13}];
 const ds=[0,100,200];
 assert.equal(f(pts,ds,-50).lat,45);
 assert.equal(f(pts,ds,0).lat,45);
 assert.equal(f(pts,ds,50).lat,45.5);
 assert.equal(f(pts,ds,200).lat,47);
 assert.equal(f(pts,ds,250).lat,47);
});
test('voice and Academy matching remain present',()=>{
 for(const name of ['matchStopsStrict','buildAcademyMatches','planStopVoice','startGPS','stopNavigation','recenterOnRealGPS','stableRouteMatch'])sourceOf(name);
 assert.match(js, /_stopAuthority==='supplemental'/);
 assert.match(js, /updateNavigationHeading\(points,dists,along\)/);
 assert.match(html, /id="navigationPosition"/);
});
test('no removal of PWA offline fallback',()=>{
 assert.match(sw, /caches\.match/);
 assert.match(html, /manifest\.webmanifest/);
});

test('GPS follow camera accumulates small movements instead of stalling',()=>{
 const code=sourceOf('followStableCamera');
 const calls=[];
 const map={
  getZoom:()=>16,
  setView:(p)=>calls.push(['initial',p]),
  panTo:(p)=>calls.push(['follow',p])
 };
 const display={hidden:true};
 const metres=(a,b)=>Math.hypot((b.lat-a.lat)*111194,(b.lng-a.lng)*80000);
 const follow=new Function('map','$','metres',`let navigationFullscreen=true,lastCameraPoint=null; ${code};return followStableCamera;`)(map,()=>display,metres);
 const starting=45.40;
 for(let i=0;i<=10;i++)follow({lat:starting+i*0.000012,lng:11.88},false,false); // ~1.33 m/update
 assert.ok(calls.length>=4,'Camera must move after several small GPS updates');
 assert.equal(calls[0][0],'initial');
 assert.ok(calls.some(c=>c[0]==='follow'));
 assert.ok(Math.abs(calls.at(-1)[1][0]-(starting+10*0.000012))<0.00004);
 assert.equal(display.hidden,false);
});

test('advance stop calls are queued once and another stop is announced',()=>{
 const funcs=['stopAlertDistance','speechDistance','planStopVoice'].map(sourceOf).join('\n');
 const calls=[];
 const elements={voiceToggle:{checked:true}};
 const mock=new Function('current','spokenStopStages','enqueueVoice','$','calls',`
  let lastSpokenStop=-1,voiceBusy=false,voiceQueue=[];
  ${funcs}
  return {say:planStopVoice,threshold:stopAlertDistance};
 `)(
  {stops:[{stop:{stop_name:'Noale'}},{stop:{stop_name:'Treviso'}}]},
  new Map(),
  (msg,priority)=>{calls.push({msg,priority});return true},
  id=>elements[id],
  calls
 );
 mock.say(0,340,16,false,false);
 mock.say(0,300,16,false,false);
 mock.say(0,40,16,false,false);
 mock.say(1,260,12,false,false);
 assert.equal(calls.length,3);
 assert.match(calls[0].msg,/Noale/);
 assert.match(calls[1].msg,/Fermata in arrivo: Noale/);
 assert.match(calls[2].msg,/Treviso/);
 assert.ok(mock.threshold(16)>300);
});
test('navigation keeps voice reactivation and turns available',()=>{
 const markup=fs.readFileSync('index.html','utf8');
 assert.match(markup,/id="activateNavVoice"/);
 assert.match(markup,/id="voiceNavStatus"/);
 assert.match(markup,/id="voiceAvailability"/);
 assert.match(js,/function activateNavigationVoice/);
 assert.match(js,/renderAcademyStopComparison/);
 assert.match(js,/planTurnVoice\(turn,turnIndex,d,speed,near.d/);
 assert.match(js,/planStopVoice\(nextStopIdx,remaining,speed,false,isDemo\)/);
});

test('map matcher re-acquires a real route position after GPS skips several hundred metres',()=>{
 const fns=['metres','project','nearestOnShape','shapeMetrics','stableRouteMatch'].map(sourceOf).join('\n');
 // 120 evenly spaced points along a straight Academy route.
 const run=new Function(`
  const rad=Math.PI/180;
  let hasMatchedFix=false,lastMatchedAt=0,lastAlong=0,recoveryCandidate=null;
  ${fns}
  const pts=Array.from({length:121},(_,i)=>({lat:45.4,lng:11+i*0.001}));
  const ds=shapeMetrics(pts);
  const pos=i=>({lat:45.4,lng:11+i*0.001});
  const first=stableRouteMatch(pos(2),pts,ds,12,false);
  lastAlong=first.along;
  const normal=stableRouteMatch(pos(3),pts,ds,12,false);
  lastAlong=normal.along;
  const skipped=stableRouteMatch(pos(18),pts,ds,12,false);
  const recovery=stableRouteMatch(pos(18.1),pts,ds,12,false);
  lastAlong=recovery.along;
  const resumed=stableRouteMatch(pos(19),pts,ds,12,false);
  const off=stableRouteMatch({lat:45.42,lng:11.02},pts,ds,12,false);
  return {first,normal,skipped,recovery,resumed,off};
 `)();
 assert.equal(run.first.offRoute,undefined);
 assert.equal(run.normal.recovering,undefined);
 assert.equal(run.skipped.recovering,true);
 assert.notEqual(run.skipped.offRoute,true,'On-route skips must not be classified off-route');
 assert.equal(run.recovery.reacquired,true,'Two consistent GPS fixes must recover navigation');
 assert.ok(run.recovery.along>run.normal.along+500);
 assert.ok(run.resumed.along>=run.recovery.along-75);
 assert.equal(run.off.offRoute,true,'Actual GPS drift >180m must suspend guidance');
});

test('turn cues are staged, deduplicated and stop-prioritized',()=>{
 const fns=['speechDistance','turnAlertDistance','planTurnVoice'].map(sourceOf).join('\n');
 const calls=[];
 const run=new Function('calls',`
  const spokenTurnStages=new Map();
  let lastSpokenTurn=-1;
  const $=id=>({checked:true});
  const speak=(msg,priority)=>{calls.push({msg,priority});return true};
  ${fns}
  return {guide:planTurnVoice,lead:turnAlertDistance,stages:spokenTurnStages};
 `)(calls);
 const turn={side:'destra'};
 run.guide(turn,0,320,20,12,Infinity);
 run.guide(turn,0,260,20,12,Infinity);
 run.guide(turn,0,70,20,12,Infinity);
 run.guide(turn,0,45,20,12,Infinity);
 assert.equal(calls.length,2,'Exactly one early and one short-range turn notice');
 assert.equal(calls[0].priority,'turn');
 assert.match(calls[0].msg,/destra/);
 assert.equal(run.stages.get(0),2);
 run.guide({side:'sinistra'},1,170,10,10,90);
 assert.equal(calls.length,2,'Stop announcement must take precedence over turns');
 run.guide({side:'sinistra'},1,150,10,10,Infinity);
 assert.equal(calls.length,3);
 assert.match(calls[2].msg,/sinistra/);
});

test('native iOS bridge does not replace web PWA GPS',()=>{
 assert.match(js,/const nativeMode=!!window\.webkit\?\.messageHandlers\?\.lineaPilot/);
 assert.match(js,/if\(nativeMode\)\{[\s\S]*?nativePost\(\{type:'start'/);
 assert.match(js,/navigator\.geolocation\.watchPosition/);
 assert.match(js,/if\(nativeActive\)return false; \/\/ Swift owns stop\/turn audio/);
 assert.match(js,/window\.lineaPilotNativeReceive/);
 assert.match(js,/XMLHttpRequest is supported by WKURLSchemeHandler/);
 assert.match(js,/function downloadGTFSBlob/);
 assert.match(js,/!nativeMode&&'serviceWorker'in navigator/);
});
test('native iOS project and cloud pipeline are available',()=>{
 for(const file of ['ios/project.yml','ios/Sources/Info.plist','ios/Sources/AppDelegate.swift',
  'ios/Sources/BundledSite.swift','ios/Sources/NavigatorViewController.swift',
  'ios/Sources/NativeNavigation.swift','codemagic.yaml','.github/workflows/ios-ipa.yml']){
  assert.ok(fs.existsSync(file),'Missing native file: '+file);
 }
 const swift=fs.readFileSync('ios/Sources/NativeNavigation.swift','utf8');
 assert.match(swift,/allowsBackgroundLocationUpdates = backgroundAllowed/);
 assert.match(swift,/canUseBackgroundLocation/);
 assert.match(swift,/AVSpeechSynthesizer/);
 assert.match(swift,/stopIndex/);
 const workflow=fs.readFileSync('.github/workflows/ios-ipa.yml','utf8');
 assert.match(workflow,/gh release create/);
});

test('iOS WKWebView permits portrait scrolling to Academy and GTFS controls',()=>{
 const swift=fs.readFileSync('ios/Sources/NavigatorViewController.swift','utf8');
 const css=fs.readFileSync('style.css','utf8');
 assert.match(swift,/webView\.scrollView\.isScrollEnabled = true/);
 assert.doesNotMatch(swift,/webView\.scrollView\.isScrollEnabled = false/);
 assert.match(css,/@media\(max-width:800px\)/);
 assert.match(css,/\.sidebar\{order:2/);
 assert.match(css,/body\.navigating\{overflow:hidden\}/);
});

test('native GTFS ZIP uses URLSession bridge, not custom-scheme XHR',()=>{
 const swift=fs.readFileSync('ios/Sources/NavigatorViewController.swift','utf8');
 assert.match(swift,/case "downloadGTFS"/);
 assert.match(swift,/URLSession\.shared\.dataTask/);
 assert.match(swift,/sendGTFSChunks/);
 assert.match(swift,/deliverGTFS/);
 assert.match(js,/window\.lineaPilotGTFSReceive=/);
 assert.match(js,/type:'downloadGTFS'/);
 assert.match(js,/new Blob\(pending\.parts/);
 assert.doesNotMatch(js,/xhr\.open\('GET','\.\/gtfs\.zip'/);
});
test('native GTFS chunk assembly accepts ZIP bytes and handles errors',()=>{
 const a=js.indexOf('let nativeGtfsPending=null;');
 const b=js.indexOf('async function downloadGTFSBlob(',a);
 assert.ok(a>=0&&b>a);
 const code=js.slice(a,b);
 const run=new Function('Blob','atob',`
  ${code}
  let collected=null,failed=null,cleared=0;
  const id='gtfs-check';
  nativeGtfsPending={
    id, parts:[], total:0, timeout:1,
    resolve:x=>collected=x, reject:e=>failed=e
  };
  window.lineaPilotGTFSReceive(id,'chunk',btoa('PK'+'.'.repeat(1100)));
  window.lineaPilotGTFSReceive(id,'done','');
  return {collected,failed};
 `);
 // browser global window is supplied to the test function through a sandbox
 const original=global.window;
 global.window={};
 try{
  const result=run(Blob,atob);
  assert.ok(result.collected instanceof Blob);
  assert.equal(result.collected.size,1102);
  assert.equal(result.failed,null);
 }finally{global.window=original}
});

test('Core Location does not request unsupported background mode in LiveContainer',()=>{
 const swift=fs.readFileSync('ios/Sources/NativeNavigation.swift','utf8');
 assert.match(swift,/import MachO/);
 assert.match(swift,/_dyld_image_count/);
 assert.match(swift,/livecontainershared/);
 assert.match(swift,/!Self\.isHostedByLiveContainer && modes\.contains\("location"\)/);
 assert.match(swift,/manager\.allowsBackgroundLocationUpdates = backgroundAllowed/);
 assert.doesNotMatch(swift,/manager\.allowsBackgroundLocationUpdates = true/);
 assert.match(swift,/guard active, !locationUpdatesStarted else \{ return \}/);
 assert.match(swift,/GPS attivo in primo piano.*LiveContainer/);
});

test('simplified UI hides legacy GTFS imports and service selection without losing internal selectors',()=>{
 assert.doesNotMatch(html,/id="loadFeed"/);
 assert.doesNotMatch(html,/id="fileFeed"/);
 assert.doesNotMatch(html,/id="extraFeed"/);
 assert.doesNotMatch(html,/SELEZIONA IL SERVIZIO/);
 assert.match(html,/id="feedTitle"/);
 assert.match(html,/id="retryFeed"/);
 assert.match(html,/id="findGtfsAcademy"/);
 assert.match(html,/id="academyGtfsTrip"/);
 assert.match(html,/id="mergeOfficial"/);
 assert.match(html,/class="legacy-service-fields" hidden/);
 assert.match(html,/id="startNav"/);
 assert.match(html,/id="demoBtn"/);
 assert.match(html,/id="stopNav"/);
 assert.match(js,/initializeGTFS\(\);/);
 assert.doesNotMatch(js,/\$\('loadFeed'\)/);
 assert.doesNotMatch(js,/\$\('fileFeed'\)/);
 assert.doesNotMatch(js,/\$\('extraFeed'\)/);
});
test('GTFS startup restores cache without download and can refresh invalid data',async()=>{
 const code=sourceOf('initializeGTFS');
 const create=(cache,decode,download)=>{
  const calls={downloads:[],handled:0,states:[],saved:0};
  const run=new Function('readCachedZip','getGTFS','handleFeed','setFeedState','downloadGTFSBlob','saveZip','$','console',
   'let feedInitialization=null; '+code+';return initializeGTFS;')(
    async()=>cache,
    decode,
    ()=>calls.handled++,
    (state,title,detail)=>calls.states.push({state,title,detail}),
    async force=>{calls.downloads.push(force);return await download(force)},
    async()=>calls.saved++,
    ()=>({hidden:true}),
    {warn(){},error(){}}
   );
  return {run,calls};
 };
 const cached=new Blob([Buffer.alloc(2000)]);
 const loaded=create(cached,async()=>({routes:[]}),async()=>{throw Error('Should not download')});
 assert.equal(await loaded.run(),true);
 assert.equal(loaded.calls.downloads.length,0);
 assert.equal(loaded.calls.handled,1);
 assert.equal(loaded.calls.states.at(-1).state,'ready');
 const missing=create(null,async()=>({routes:[]}),async()=>cached);
 assert.equal(await missing.run(),true);
 assert.deepEqual(missing.calls.downloads,[false]);
 assert.equal(missing.calls.saved,1);
 let count=0;
 const corrupt=create(cached,async()=>{if(!count++)throw Error('Corrupt ZIP');return {routes:[]}},async()=>cached);
 assert.equal(await corrupt.run(),true);
 assert.deepEqual(corrupt.calls.downloads,[true]);
 const failed=create(null,async()=>({routes:[]}),async()=>{throw Error('Senza rete')});
 assert.equal(await failed.run(),false);
 assert.equal(failed.calls.states.at(-1).state,'error');
 assert.match(failed.calls.states.at(-1).detail,/Senza rete/);
});
test('native iOS caches validated GTFS ZIP to disk and supports retry refresh',()=>{
 const swift=fs.readFileSync('ios/Sources/NavigatorViewController.swift','utf8');
 assert.match(swift,/lineapilot-busitalia-gtfs\.zip/);
 assert.match(swift,/if !refresh, let url = cachedGTFSURL/);
 assert.match(swift,/cached\.starts\(with:/);
 assert.match(swift,/try data\.write\(to: destination, options: \.atomic\)/);
 assert.match(swift,/body\["refresh"\] as\? Bool \?\? false/);
});

test('GTFS options collapse identical stop sequences and use useful destinations',()=>{
 const functions=['variantStopNames','variantSignature','uniqueAcademyVariants','variantDistinguishingStops','variantFriendlyLabel','stopSequenceKey','hasStopInSequence']
  .map(sourceOf).join('\n');
 const mock=new Function('samePhysicalStop',functions+';return {uniqueAcademyVariants,variantFriendlyLabel,variantDistinguishingStops};')(
  (a,b)=>a.stop_id===b.stop_id
 );
 const mk=(codes,legs=1,coverage=.94,error=15)=>({
  stops:codes.map(code=>({stop:{stop_id:code,stop_name:({A:'Padova',B:'Limena',C:'Vigodarzere',D:'Camposampiero',E:'Borgoricco'})[code]}})),
  legs:Array.from({length:legs},()=>({trip:{}})),coverage,averageError:error
 });
 const a=mk(['A','B','D']),dup=mk(['A','B','D'],2,.97,10),alt=mk(['A','C','D']),other=mk(['A','E','D']);
 const distinct=mock.uniqueAcademyVariants([a,dup,alt,other]);
 assert.equal(distinct.length,3);
 assert.equal(distinct[0].legs.length,1,'Prefer a single GTFS journey over a synthetic chain of equal stops');
 assert.match(mock.variantFriendlyLabel(a,distinct),/Padova → Camposampiero/);
 assert.match(mock.variantFriendlyLabel(a,distinct),/via Limena/);
 assert.match(mock.variantFriendlyLabel(alt,distinct),/via Vigodarzere/);
 assert.deepEqual(mock.variantDistinguishingStops(a,distinct),['Limena']);
});
test('variant selection shows stop preview and does not auto-associate ambiguous matches',()=>{
 assert.match(html,/id="academyVariantPreview"/);
 assert.match(js,/function refreshVariantPreview/);
 assert.match(js,/function uniqueAcademyVariants/);
 assert.match(js,/if\(distinct.length===1\)\$\('academyGtfsTrip'\).value='academy-match-0'/);
 assert.match(js,/\$\('mergeOfficial'\).disabled=distinct.length!==1/);
 assert.match(js,/\$\('academyGtfsTrip'\).addEventListener\('change',[\s\S]*?refreshVariantPreview\(\)/);
 assert.match(js,/details\.append\(ol\)/);
});

test('road guidance validates official Academy fingerprint, language and geometry before playback',()=>{
 const funcs=['academyFingerprint','validRoadGuidance'].map(sourceOf).join('\n');
 const api=new Function(funcs+';return {academyFingerprint,validRoadGuidance}')();
 const points=[[45.0,11.0],[45.0,11.005],[45.005,11.005]];
 const chosen={id:'academy_demo',points};
 const fingerprint=api.academyFingerprint(points);
 const metres=(a,b)=>{const dy=(b[0]-a[0])*111320,dx=(b[1]-a[1])*111320*Math.cos((a[0]+b[0])/2*Math.PI/180);return Math.hypot(dx,dy)};
 const total=metres(points[0],points[1])+metres(points[1],points[2]);
 const good={version:1,source:'valhalla-osm',language:'it-IT',
  academyId:'academy_demo',fingerprint,officialLengthM:Math.round(total),
  validation:{passed:true,maxDeviationM:10,p95DeviationM:5},
  turns:[{at:180,kind:'turn',side:'destra',text:'Svolta a destra in Via Roma'}]};
 assert.equal(api.validRoadGuidance(good,chosen,[0,400,total]),true);
 assert.equal(api.validRoadGuidance({...good,fingerprint:'wrong'},chosen,[0,400,total]),false);
 assert.equal(api.validRoadGuidance({...good,language:'en-US'},chosen,[0,400,total]),false);
 assert.equal(api.validRoadGuidance({...good,validation:{...good.validation,passed:false}},chosen,[0,400,total]),false);
 assert.equal(api.validRoadGuidance({...good,validation:{passed:true}},chosen,[0,400,total]),false);
 assert.equal(api.validRoadGuidance({...good,officialLengthM:total+1000},chosen,[0,400,total]),false);
 assert.equal(api.validRoadGuidance({...good,turns:[{...good.turns[0],text:''}]},chosen,[0,400,total]),false);
 assert.equal(api.validRoadGuidance({...good,turns:[{...good.turns[0],at:total+10}]},chosen,[0,400,total]),false);
});
test('Academy remains the ONLY navigation route for web and native while Italian cues are optional',()=>{
 assert.match(js,/loadRoadGuidance\(chosen,dists\)/);
 assert.match(js,/turns=computeTurns\(points,dists\);loadRoadGuidance/);
 assert.match(js,/String\(current\.academy\.id\)!==id/);
 assert.match(js,/verifiedRoad:true/);
 assert.match(js,/turn\.verifiedRoad\?turn\.text:'Possibile svolta a '/);
 assert.match(js,/points:current\.points\.map\(p=>\[p\.lat,p\.lng\]\)/);
 const swift=fs.readFileSync('ios/Sources/NativeNavigation.swift','utf8');
 assert.match(swift,/verifiedRoad: Bool\?/);
 assert.match(swift,/Tra circa/);
 assert.match(swift,/let hit = nearest\(location\.coordinate, on: route\.points\)/);
 const prepare=fs.readFileSync('scripts/prepare-ios.sh','utf8');
 assert.match(prepare,/road-guidance/);
 assert.match(prepare,/official-routes\.json/);
});

test('native Italian voices and manual update download are available',()=>{
 assert.match(html,/id="voiceSelect"/);
 assert.match(html,/id="voiceRate"/);
 assert.match(html,/id="appUpdateBanner"/);
 assert.match(html,/id="checkUpdates"/);
 assert.match(js,/function applyVoiceOptions/);
 assert.match(js,/function processAppReleases/);
 assert.match(js,/newest\.tag_name===tag/);
 assert.match(js,/ios-preview-/);
 assert.match(js,/android-preview-/);
 assert.match(js,/window\.LINEAPILOT_BUILD_TAG/);
 assert.match(js,/type:'checkUpdates'/);
 assert.match(js,/type:'openUpdate'/);
 const swift=fs.readFileSync('ios/Sources/NativeNavigation.swift','utf8');
 const ctrl=fs.readFileSync('ios/Sources/NavigatorViewController.swift','utf8');
 assert.match(swift,/AVSpeechSynthesisVoice\.speechVoices\(\)/);
 assert.match(swift,/voice\.language\.lowercased\(\)\.hasPrefix\("it"\)/);
 assert.match(swift,/utterance\.rate/);
 assert.match(ctrl,/case "listVoices"/);
 assert.match(ctrl,/case "checkUpdates"/);
 assert.match(ctrl,/URLSession\.shared\.dataTask/);
});
test('Android project preserves Academy route and handles voice and geolocation',()=>{
 for(const f of ['android/build.gradle','android/app/build.gradle',
  'android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/java/app/lineapilot/android/MainActivity.java',
  'scripts/prepare-android.sh','.github/workflows/android-apk.yml']){
  assert.ok(fs.existsSync(f),'Missing Android file '+f);
 }
 const android=fs.readFileSync('android/app/src/main/java/app/lineapilot/android/MainActivity.java','utf8');
 assert.match(android,/WebViewAssetLoader/);
 assert.match(android,/onGeolocationPermissionsShowPrompt/);
 assert.match(android,/TextToSpeech/);
 assert.match(android,/setVoice/);
 assert.match(android,/void openExternal/);
 const script=fs.readFileSync('scripts/prepare-android.sh','utf8');
 assert.match(script,/official-routes\.json/);
 assert.match(script,/android-preview-/);
});
