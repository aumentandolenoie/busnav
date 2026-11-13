/* LineaPilot v0.1 — prototype; not a certified road navigator. */
'use strict';
const $=id=>document.getElementById(id);
const FEED='https://proxy.busone.app/biv/gtfs.zip';
// iOS native bridge is present ONLY in the Swift wrapper. The web PWA remains unchanged.
const nativeMode=!!window.webkit?.messageHandlers?.lineaPilot||!!window.LineaPilotAndroid?.postMessage;
let nativeActive=false;
function nativePost(data){
 if(!nativeMode)return false;
 try{if(window.LineaPilotAndroid?.postMessage)window.LineaPilotAndroid.postMessage(JSON.stringify(data));else window.webkit.messageHandlers.lineaPilot.postMessage(data);return true}
 catch(e){console.warn('Native bridge:',e);return false}
}
window.lineaPilotNativeReceive=(type,data)=>{
 if(type==='previewReady'){document.body.classList.add('native-preview');const notice=$('toast');if(notice&&notice.parentElement!==document.body)document.body.appendChild(notice);return}
 if(type==='ended'){nativeActive=false;stopNavigation();return}
 if(type==='error'){nativeActive=false;stopNavigation();toast(data?.message||'Navigazione nativa non disponibile');return}
 if(type==='voices'){applyVoiceOptions(data?.voices||[],window.LineaPilotAndroid?'android':'ios');return}
 if(type==='releases'){processAppReleases(data?.releases||[],updateCheckManual);return}
 if(type==='updateError'){$('updateStatus').textContent='Verifica aggiornamenti non riuscita: '+(data?.message||'Errore rete');return}
 if(!nativeActive)return;
 if(type==='location'&&data&&Number.isFinite(data.lat)&&Number.isFinite(data.lng)){
  // Native drive screen, stop progression and speech share one GPXTracker.
  realGpsFix={lat:data.lat,lng:data.lng};realGpsFixAt=Date.now();
 }else if(type==='status'&&data?.message){
  $('gpsStatus').textContent=data.message;
  setVoiceStatus(data.message);
 }
};

// Italian voice preferences are local per device, never tied to the GPX.
const voicePreferences=(()=>{
 try{
  const data=JSON.parse(localStorage.getItem('lineapilot-voice')||'{}');
  return {id:typeof data.id==='string'?data.id:'',rate:Number.isFinite(+data.rate)?Math.min(1.25,Math.max(.75,+data.rate)):1};
 }catch{return {id:'',rate:1}}
})();
let availableItalianVoices=[],voiceSource='';
function persistVoicePreferences(){
 try{localStorage.setItem('lineapilot-voice',JSON.stringify(voicePreferences))}catch{}
}
function voiceQualityLabel(voice){
 if(voice?.premium||Number(voice?.quality)>=5)return 'Premium';
 if(voice?.enhanced)return 'qualità avanzata';
 return 'qualità base';
}
function describeSelectedVoice(voices,id,source){
 if(source==='android'){const selected=voices.find(v=>v.id===id)||voices.find(v=>!v.network)||voices[0];return selected?(id?'Voce selezionata: ':'Voce automatica: ')+selected.name+(selected.enhanced?' · qualità alta':'')+(selected.network?' · richiede Internet.':' · disponibile senza connessione.'):'Installa una voce italiana nelle impostazioni Sintesi vocale di Android, poi premi Rileva voci.'}
 if(source!=='ios')return 'Scegli una voce italiana e ascolta l’anteprima.';
 const selected=voices.find(v=>v.id===id)||voices[0];
 if(!selected)return 'Nessuna voce italiana disponibile. Scarica una voce italiana nelle impostazioni Accessibilità di iPhone, poi torna qui.';
 const summary=(id&&selected.id===id?'Voce selezionata: ':'Voce automatica: ')+selected.name+' · '+voiceQualityLabel(selected)+'.';
 if(!selected.enhanced&&!selected.premium)return summary+' Per una voce più naturale, scarica una voce italiana Premium o di qualità avanzata in Impostazioni → Accessibilità → Contenuto letto ad alta voce (o Leggi e parla) → Voci → Italiano. Poi torna nell’app e premi Rileva voci.';
 return summary+' Sintesi sul dispositivo, disponibile anche senza connessione. La voce di Siri/Mappe non è selezionabile direttamente dall’app.';
}
function updateVoiceQualityInfo(){
 $('voiceQualityInfo').textContent=describeSelectedVoice(availableItalianVoices,$('voiceSelect').value,voiceSource);
}
function applyVoiceOptions(list,source){
 voiceSource=source;
 const dropdown=$('voiceSelect'),saved=voicePreferences.id;
 availableItalianVoices=list.filter(v=>String(v.lang||'').toLowerCase().startsWith('it'));
 dropdown.replaceChildren();
 const automatic=document.createElement('option');automatic.value='';automatic.textContent='Automatica · migliore voce italiana';dropdown.add(automatic);
 availableItalianVoices.sort((a,b)=>(b.quality||0)-(a.quality||0)||Number(String(b.lang).toLowerCase()==='it-it')-Number(String(a.lang).toLowerCase()==='it-it')||String(a.name).localeCompare(String(b.name),'it'));
 for(const voice of availableItalianVoices){
  const o=document.createElement('option');o.value=voice.id;o.textContent=voice.name+(source==='ios'?' · '+voiceQualityLabel(voice):voice.enhanced?' · qualità alta':'');
  dropdown.add(o);
 }
 if(saved&&availableItalianVoices.some(v=>v.id===saved))dropdown.value=saved;
 else dropdown.value='';
 dropdown.disabled=!availableItalianVoices.length;
 updateVoiceQualityInfo();
}
// Safari on iPhone exposes the iOS voices: prefer Premium, then Enhanced
// ("Avanzata"), then the compact ones; skip Eloquence and novelty voices,
// which are hard to understand while driving.
function safariVoiceQuality(v){
 const uri=String(v.voiceURI||'').toLowerCase(),name=String(v.name||'').toLowerCase();
 if(uri.includes('eloquence')||uri.includes('speech.synthesis.voice')||/\b(rocko|shelley|grandma|grandpa|eddy|flo|reed|sandy)\b/.test(name))return 0;
 if(uri.includes('premium')||name.includes('premium'))return 4;
 if(uri.includes('enhanced')||name.includes('avanzat')||name.includes('enhanced')||name.includes('migliorat'))return 3;
 return v.localService?2:1;
}
function loadItalianVoices(){
 if(window.LineaPilotAndroid){
  try{const voices=JSON.parse(window.LineaPilotAndroid.listVoices());applyVoiceOptions(voices,'android')}catch(e){console.warn('Voci Android:',e)}
  return;
 }
 if(nativeMode){nativePost({type:'listVoices'});return}
 if(!('speechSynthesis'in window))return;
 applyVoiceOptions(speechSynthesis.getVoices().filter(v=>String(v.lang).toLowerCase().startsWith('it'))
  .map(v=>({id:v.voiceURI,name:v.name,lang:v.lang,quality:safariVoiceQuality(v),enhanced:safariVoiceQuality(v)>=3}))
  .filter(v=>v.quality>0),'web');
}
function syncVoiceSettings(){
 voicePreferences.id=$('voiceSelect').value;
 voicePreferences.rate=Math.min(1.25,Math.max(.75,Number($('voiceRate').value)||1));
 $('voiceRateValue').textContent=voicePreferences.rate.toFixed(2).replace('.',',')+'×';
 persistVoicePreferences();
 updateVoiceQualityInfo();
 if(nativeMode)nativePost({type:'settings',voiceId:voicePreferences.id,rate:voicePreferences.rate});
}
$('voiceRate').value=String(voicePreferences.rate);
$('voiceRateValue').textContent=voicePreferences.rate.toFixed(2).replace('.',',')+'×';
$('voiceSelect').addEventListener('change',syncVoiceSettings);
$('voiceRate').addEventListener('input',syncVoiceSettings);
$('refreshVoices').addEventListener('click',loadItalianVoices);
if('speechSynthesis'in window) {
 speechSynthesis.addEventListener?.('voiceschanged',loadItalianVoices);
 loadItalianVoices();
}
if(nativeMode)loadItalianVoices();
if(window.LineaPilotAndroid)loadItalianVoices();

// App installation updates are explicit opt-in downloads, never silent installs.
// GitHub 'latest' ignores prereleases: use the releases list for test IPA/APK.
const RELEASES_URL='https://api.github.com/repos/aumentandolenoie/busnav/releases?per_page=40';
let availableUpdate=null,updateCheckManual=false,lastUpdateCheck=0;
// Re-check on app resume without flooding GitHub API during GPS navigation.
function processAppReleases(releases,manual=false){
 const tag=String(window.LINEAPILOT_BUILD_TAG||'');
 const platform=tag.startsWith('ios-preview-')?'ios':tag.startsWith('android-preview-')?'android':null;
 if(!platform)return;
 const assetName=platform==='ios'?'LineaPilot-unsigned.ipa':'LineaPilot-debug.apk';
 const matching=releases.filter(r=>!r.draft&&r.tag_name?.startsWith(platform+'-preview-')&&
  r.assets?.some(a=>a.name===assetName&&a.browser_download_url?.startsWith('https://github.com/aumentandolenoie/busnav/releases/download/')));
 matching.sort((a,b)=>Date.parse(b.published_at||b.created_at)-Date.parse(a.published_at||a.created_at));
 const newest=matching[0],installed=matching.find(r=>r.tag_name===tag);
 if(!newest||!installed||newest.tag_name===tag||
   Date.parse(newest.published_at||newest.created_at)<=Date.parse(installed.published_at||installed.created_at)){
  if(manual)$('updateStatus').textContent=installed?'LineaPilot è aggiornato.':'Impossibile verificare la versione installata: consulta le release GitHub.';
  return;
 }
 const asset=newest.assets.find(a=>a.name===assetName);
 if(!asset)return;
 availableUpdate={tag:newest.tag_name,url:asset.browser_download_url};
 try{if(!manual&&localStorage.getItem('lineapilot-dismissed-update')===newest.tag_name)return}catch{}
 $('appUpdateTitle').textContent='Aggiornamento LineaPilot disponibile';
 $('appUpdateDetail').textContent='Nuova build '+newest.tag_name.split('-').at(-1)+' · installazione manuale richiesta';
 $('appUpdateBanner').hidden=false;
 $('updateStatus').textContent='Nuova versione disponibile.';
}
async function checkForAppUpdates(manual=false){
 lastUpdateCheck=Date.now();
 const tag=String(window.LINEAPILOT_BUILD_TAG||'');
 const platform=tag.startsWith('ios-preview-')?'ios':tag.startsWith('android-preview-')?'android':null;
 if(!platform){
  if(manual)$('updateStatus').textContent='La versione web si aggiorna al ricaricamento della pagina.';
  return;
 }
 try{
  updateCheckManual=manual;
  if(manual)$('updateStatus').textContent='Controllo nuove versioni…';
  if(nativeMode){nativePost({type:'checkUpdates'});return}
  const response=await fetch(RELEASES_URL,{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
  if(!response.ok)throw Error('HTTP '+response.status);
  processAppReleases(await response.json(),manual);
 }catch(e){
  if(manual)$('updateStatus').textContent='Verifica aggiornamenti non riuscita: '+e.message;
  console.warn('Aggiornamenti:',e);
 }
}
$('checkUpdates').addEventListener('click',()=>checkForAppUpdates(true));
$('appUpdateOpen').addEventListener('click',()=>{
 if(!availableUpdate)return;
 if(nativeMode)nativePost({type:'openUpdate',url:availableUpdate.url});
 else if(window.LineaPilotAndroid)window.LineaPilotAndroid.openExternal(availableUpdate.url);
 else window.open(availableUpdate.url,'_blank','noopener');
});
$('appUpdateDismiss').addEventListener('click',()=>{
 $('appUpdateBanner').hidden=true;
 if(availableUpdate)try{localStorage.setItem('lineapilot-dismissed-update',availableUpdate.tag)}catch{}
});
window.lineaPilotCheckUpdatesOnResume=()=>{
 if(window.LINEAPILOT_BUILD_TAG&&Date.now()-lastUpdateCheck>10*60*1000)
  checkForAppUpdates();
};
if(window.LINEAPILOT_BUILD_TAG)setTimeout(()=>checkForAppUpdates(),4500);

const map=L.map('map',{zoomControl:false,rotate:true,touchRotate:false,dragRotate:false,shiftKeyRotate:false}).setView([45.4064,11.8768],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
L.control.zoom({position:'topright'}).addTo(map);
let academy=[], selectedOfficial=null, feed=null, current=null, watcher=null, simulation=null, simIndex=0, locationMarker=null, accuracyCircle=null, lineLayer=null, stopLayer=null;
let nextStopIdx=0,lastFix=null,lastSpokenStop=-1,lastSpokenTurn=-1,lastProgress=0,lastAlong=0, turns=[];
let roadGuidanceLoadId=0,roadGuidanceReady=Promise.resolve();
function academyFingerprint(points){
 let h=2166136261;
 for(const point of points){
  const lat=Array.isArray(point)?point[0]:point.lat;
  const lng=Array.isArray(point)?point[1]:point.lng;
  for(const value of [lat,lng]){
   h=Math.imul(h^(Math.round(value*100000)|0),16777619)>>>0;
  }
 }
 return points.length+'-'+h.toString(16).padStart(8,'0');
}
function validRoadGuidance(data,chosen,dists){
 if(!data||data.version!==1||data.source!=='valhalla-osm'||data.language!=='it-IT'||
  String(data.academyId)!==String(chosen.id)||data.fingerprint!==academyFingerprint(chosen.points)||
  data.validation?.passed!==true||!Array.isArray(data.turns)||(!data.turns.length&&!(data.noManeuvers===true&&data.coverage?.ranges?.length)))return false;
 const total=dists.at(-1)||0,sourceTotal=data.coverage?.totalM||data.officialLengthM;
 if(!Number.isFinite(sourceTotal)||sourceTotal<=0)return false;
 if(!Number.isFinite(data.officialLengthM)||!Number.isFinite(data.validation.maxDeviationM)||
  !Number.isFinite(data.validation.p95DeviationM)||
  Math.abs(data.officialLengthM-total)>Math.max(80,total*.025))return false;
 if(data.validation.maxDeviationM>85||data.validation.p95DeviationM>45)return false;
 if(data.coverage){
  const c=data.coverage;
  if(typeof c.complete!=='boolean'||!Number.isFinite(c.percent)||c.percent<0||c.percent>100||!Array.isArray(c.ranges)||!c.ranges.length)return false;
  let end=-1,covered=0;
  for(const r of c.ranges){
   if(!Array.isArray(r)||r.length!==2||!r.every(Number.isFinite)||r[0]<0||r[1]<=r[0]||r[0]<end||r[1]>sourceTotal+1)return false;
   covered+=r[1]-r[0];end=r[1];
  }
  if(Math.abs(c.percent-covered/sourceTotal*100)>1)return false;
  if(c.complete&&(c.ranges.length!==1||c.ranges[0][0]>1||Math.abs(c.ranges[0][1]-sourceTotal)>1))return false;
 }

 let previous=-1;
 for(const t of data.turns){
  if(!Number.isFinite(t.at)||t.at<0||t.at>sourceTotal+1||t.at<=previous||
   !['turn','roundabout'].includes(t.kind)||!['sinistra','destra','rotatoria'].includes(t.side)||
   typeof t.text!=='string'||!t.text.trim()||t.text.length>160)return false;
  if(data.coverage&&!data.coverage.ranges.some(r=>t.at>=r[0]&&t.at<=r[1]))return false;
  previous=t.at;
 }
 return true;
}
function normalizeRoadGuidance(data,total){
 // Exporters can use a local planar metric. GPS and stop offsets use the
 // canonical haversine metric, so normalize ALL maneuver/range offsets once.
 const sourceTotal=data.coverage?.totalM||data.officialLengthM,scale=total/sourceTotal;
 const at=m=>Math.min(total,Math.max(0,m*scale));
 const source=data.coverage||{complete:true,percent:100,ranges:[[0,sourceTotal]],gaps:[]};
 const coverage={...source,totalM:total,coveredM:(source.coveredM??sourceTotal)*scale,
  ranges:source.complete?[[0,total]]:source.ranges.map(r=>r.map(at)),gaps:(source.gaps||[]).map(r=>r.map(at))};
 // Policy 2: signposted limits only. Policy 3: bus limits (art. 142 c.3 CdS) with
 // a 4th value for the OSM evidence: 1 road sign, 2 mapped value, 3 legal default.
 const speedLimits=([2,3].includes(data.speedLimitPolicy)&&Array.isArray(data.speedLimits)?data.speedLimits:[]).filter(r=>
  Array.isArray(r)&&(r.length===3||r.length===4&&[1,2,3].includes(r[3]))&&r.every(Number.isFinite)&&r[0]>=0&&r[0]<r[1]&&r[1]<=sourceTotal+1&&
  Number.isInteger(r[2])&&r[2]>=5&&r[2]<=130).map(([a,b,k])=>[at(a),at(b),k]);
 const roadCameras=(Array.isArray(data.roadCameras)?data.roadCameras:[]).filter(c=>
  c&&Number.isFinite(c.at)&&c.at>=0&&c.at<=sourceTotal+1&&['speed','redLight'].includes(c.kind))
  .map(c=>({at:at(c.at),kind:c.kind}));
 return {turns:data.turns.map(t=>({...t,at:at(t.at),verifiedRoad:true})),coverage,speedLimits,roadCameras};
}
async function loadRoadGuidance(chosen,dists){
 const serial=++roadGuidanceLoadId;
 const id=String(chosen.id);
 if(!/^[a-zA-Z0-9_-]+$/.test(id))return;
 try{
  const url='./road-guidance/'+encodeURIComponent(id)+'.json';
  let data;
  if(nativeMode){
   data=await new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('GET',url,true);
    xhr.onload=()=>{if(xhr.status!==0&&(xhr.status<200||xhr.status>=300)){reject(Error('HTTP '+xhr.status));return}
     try{resolve(JSON.parse(xhr.responseText))}catch(err){reject(err)}};
    xhr.onerror=()=>reject(Error('Risorsa non presente'));xhr.send();
   });
  }else{
   const response=await fetch(url);
   if(!response.ok)return;
   data=await response.json();
  }
  // Re-check the official Academy object: a delayed network reply must never
  // apply road instructions to another route or a subsequent selection.
  if(serial!==roadGuidanceLoadId||!current?.academy||
     String(current.academy.id)!==id||!validRoadGuidance(data,chosen,dists))return;
  const normalized=normalizeRoadGuidance(data,dists.at(-1));
  turns=normalized.turns;
  current.guidanceDate=data.generatedAt||'';
  current.guidanceCoverage=normalized.coverage;
  current.speedLimits=normalized.speedLimits;
  current.roadCameras=normalized.roadCameras;
  refreshReadySummary();
  $('turnHint').textContent='Manovre stradali in italiano, verificate sul GPX Academy';
  if(nativeActive){
   // Do not hot-swap a running native trip: the native route is immutable
   // during navigation. New manoeuvres apply at the next GPS start.
   $('turnHint').textContent='Manovre stradali pronte per il prossimo avvio';
  }
 }catch(err){console.info('Nessun arricchimento stradale valido per Academy '+id,err.message)}
}

let navigationFullscreen=false,lastNavHeading=null,lastCameraAt=0,lastCameraPoint=null,lastMatchedAt=0,hasMatchedFix=false,realGpsFix=null,realGpsFixAt=0,recoveryCandidate=null;

// ---- Driving view (same layout and wording as the iOS app's DriveViewController) ----
const DRIVE_ICONS={
 up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5V4.5M5.5 11 12 4.5 18.5 11"/></svg>',
 left:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-7.5a4.5 4.5 0 0 0-4.5-4.5H4.5M9 4.5 4.5 9 9 13.5"/></svg>',
 right:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21v-7.5A4.5 4.5 0 0 1 11.5 9h8M15 4.5 19.5 9 15 13.5"/></svg>',
 roundabout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19.4 9.6A7.6 7.6 0 0 0 5.7 6.8M4.6 2.9v4.6h4.6M4.6 14.4a7.6 7.6 0 0 0 13.7 2.8M19.4 21.1v-4.6h-4.6"/></svg>',
 warning:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.6M12 17.4v.2"/></svg>',
 speaker:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.2h3.7L12 5v14l-4.8-4.2H3.5z" fill="currentColor"/><path d="M15.6 9a4.2 4.2 0 0 1 0 6M18.4 6.3a8 8 0 0 1 0 11.4"/></svg>',
 speakerOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.2h3.7L12 5v14l-4.8-4.2H3.5z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
 location:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.6 3.4 3.7 10.6c-.8.4-.7 1.5.1 1.7l6.6 1.4 1.4 6.6c.2.8 1.3.9 1.7.1z"/></svg>'
};
let driveVoiceProblem=false,driveVoiceText='Voce in attesa',driveNorthUp=false,driveLayoutFrame=0,driveMapBox='',wakeLock=null;
function setDriveTurn(distance,text,icon){
 if(!$('driveView'))return;
 $('driveDistance').textContent=distance;$('driveInstruction').textContent=text;
 const el=$('driveSymbol');if(el.dataset.icon!==icon){el.dataset.icon=icon;el.innerHTML=DRIVE_ICONS[icon]||DRIVE_ICONS.up}
}
function setDriveStop(name,distance){$('driveStopName').textContent=name;$('driveStopDistance').textContent=distance}
function renderDriveStatus(){
 const el=$('driveStatus');if(!el)return;
 const gps=$('gpsStatus')?.textContent||'';
 el.textContent=driveVoiceProblem?driveVoiceText+' · tocca 🔊 in alto per riattivare':[gps,driveVoiceText].filter(Boolean).join(' · ');
 el.dataset.problem=driveVoiceProblem?'yes':'no';
}
// On-board ticket calculator (polimetriche Busitalia, see tickets.js). It is an
// overlay inside the drive view: navigation, GPS and voice keep running.
let ticketData=null,ticketDataPromise=null,ticketState={route:null,line:-1,from:-1,to:-1};
const TICKET_DATA_URL='fares/polimetriche-padova.json';
// XMLHttpRequest fallback: some WKWebView custom-scheme loads fail with fetch().
function ticketDataXHR(){
 return new Promise((resolve,reject)=>{
  const x=new XMLHttpRequest();x.open('GET',TICKET_DATA_URL);
  x.onload=()=>{try{if(x.status&&x.status!==200)throw Error('HTTP '+x.status);resolve(JSON.parse(x.responseText))}catch(e){reject(e)}};
  x.onerror=()=>reject(Error('rete'));x.send();
 });
}
function loadTicketData(){
 if(ticketData)return Promise.resolve(ticketData);
 if(!ticketDataPromise)ticketDataPromise=fetch(TICKET_DATA_URL)
  .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()})
  .catch(()=>ticketDataXHR())
  .then(d=>{if(!Array.isArray(d?.lines)||!d.labels)throw Error('formato non valido');ticketData=d;return d})
  .catch(e=>{ticketDataPromise=null;console.info('Polimetriche non disponibili',e.message);return null});
 return ticketDataPromise;
}
function ticketOption(value,text){const o=document.createElement('option');o.value=String(value);o.textContent=text;return o}
function renderTicketLines(){
 const select=$('ticketLine'),data=ticketData;select.replaceChildren();
 if(!data){select.append(ticketOption(-1,'Polimetriche non disponibili'));select.disabled=true;return}
 select.disabled=false;
 const suggested=Tickets.suggestedLines(data,current?.academy);
 if(ticketState.line<0)select.append(ticketOption(-1,'Scegli la linea'));
 const add=(parent,i)=>parent.append(ticketOption(i,Tickets.lineLabel(data.lines[i])));
 if(suggested.length){
  const group=document.createElement('optgroup');group.label='Linea in corso';suggested.forEach(i=>add(group,i));select.append(group);
  const rest=document.createElement('optgroup');rest.label='Altre linee';data.lines.forEach((_,i)=>{if(!suggested.includes(i))add(rest,i)});select.append(rest);
 }else data.lines.forEach((_,i)=>add(select,i));
 select.value=String(ticketState.line);
}
function renderTicketStops(){
 const line=ticketData?.lines[ticketState.line];
 for(const [id,key,empty] of [['ticketFrom','from','Scegli la salita'],['ticketTo','to','Scegli la discesa']]){
  const select=$(id);select.replaceChildren();select.disabled=!line;
  if(!line){select.append(ticketOption(-1,'—'));continue}
  if(ticketState[key]<0)select.append(ticketOption(-1,empty));
  line.stops.forEach((s,i)=>select.append(ticketOption(i,(i+1)+' · '+s[0])));
  select.value=String(ticketState[key]);
 }
 renderTicketResult();
}
function renderTicketResult(){
 const out=$('ticketResult'),line=ticketData?.lines[ticketState.line];
 let text='',empty=true,note='';
 if(!ticketData)text='Polimetriche non disponibili: controlla la connessione e riprova';
 else if(!line)text='Scegli la linea della polimetrica';
 else if(ticketState.from<0)text='Scegli la salita';
 else if(ticketState.to<0)text='Scegli la discesa';
 else{const f=Tickets.fare(ticketData,line,ticketState.from,ticketState.to);text=f?.text||ticketData.labels[''];empty=!f||f.code==='';note=f?.note||''}
 out.textContent=text;out.dataset.empty=empty?'yes':'no';
 $('ticketFareNote').textContent=note;$('ticketFareNote').hidden=!note;
}
async function openTicketSheet(){
 const sheet=$('ticketSheet');
 sheet.hidden=false;$('ticketButton').setAttribute('aria-expanded','true');scheduleDriveLayout();
 $('ticketResult').textContent='Caricamento polimetriche…';$('ticketResult').dataset.empty='yes';
 const data=await loadTicketData();
 if(sheet.hidden)return;
 const route=current?.academy||null;
 if(data&&ticketState.route!==route){
  const suggested=Tickets.suggestedLines(data,route);
  ticketState={route,line:suggested.length?suggested[0]:-1,from:-1,to:-1};
 }
 // Boarding stop: the fare node nearest to the bus, every time the sheet opens.
 const line=data?.lines[ticketState.line];
 if(line&&lastFix){const near=Tickets.nearestStop(line,lastFix.lat,lastFix.lng);if(near>=0){ticketState.from=near;if(ticketState.to===near)ticketState.to=-1}}
 renderTicketLines();renderTicketStops();
}
function closeTicketSheet(){$('ticketSheet').hidden=true;$('ticketButton').setAttribute('aria-expanded','false')}
$('ticketButton').addEventListener('click',()=>{$('ticketSheet').hidden?openTicketSheet():closeTicketSheet()});
$('ticketClose').addEventListener('click',closeTicketSheet);
$('ticketLine').addEventListener('change',e=>{
 ticketState.line=Number(e.target.value);ticketState.from=-1;ticketState.to=-1;
 const line=ticketData?.lines[ticketState.line];
 if(line&&lastFix)ticketState.from=Tickets.nearestStop(line,lastFix.lat,lastFix.lng);
 renderTicketLines();renderTicketStops();
});
$('ticketFrom').addEventListener('change',e=>{ticketState.from=Number(e.target.value);renderTicketStops()});
$('ticketTo').addEventListener('change',e=>{ticketState.to=Number(e.target.value);renderTicketStops()});
/** Same data for the native drive screens (iOS and Android). */
function nativeTicketPayload(){
 // Without data the native app reads its bundled copy and suggests the line itself.
 if(!ticketData)return null;
 return {labels:ticketData.labels,notes:ticketData.notes||{},lines:ticketData.lines.map(l=>({code:l.code,title:l.title,stops:l.stops,fares:l.fares})),suggested:Tickets.suggestedLines(ticketData,current?.academy)};
}
function renderDriveVoiceButton(){
 const on=$('voiceToggle').checked,b=$('driveVoiceToggle');
 b.innerHTML=on?DRIVE_ICONS.speaker:DRIVE_ICONS.speakerOff;b.setAttribute('aria-pressed',String(on));
}
// Reads the safe-area insets, which CSS exposes only through env().
function driveSafeArea(){
 const c=getComputedStyle($('driveSafeProbe'));
 return {top:parseFloat(c.paddingTop)||0,right:parseFloat(c.paddingRight)||0,bottom:parseFloat(c.paddingBottom)||0,left:parseFloat(c.paddingLeft)||0};
}
// Like the iOS app: the vehicle sits at 75 % of the free map area between the
// panels (right of the panel column in landscape), so more road ahead is visible.
// The Leaflet map is enlarged so that its centre - followed fix and rotation pivot -
// lands exactly there.
const DRIVE_POSITION_ANCHOR=.75;
function layoutDriveView(){
 driveLayoutFrame=0;
 if(!navigationFullscreen)return;
 const wrap=document.querySelector('.map-wrap'),W=wrap.clientWidth,H=wrap.clientHeight;
 if(!W||!H)return;
 const safe=driveSafeArea(),landscape=W>H,top=$('driveTop'),bottom=$('driveBottom'),tools=$('driveTools');
 const topBottom=top.offsetTop+top.offsetHeight;
 bottom.style.maxHeight=Math.max(120,landscape?H-safe.bottom-8-(topBottom+8):Math.min(.48*(H-safe.top-safe.bottom),H-safe.bottom-8-(topBottom+60)))+'px';
 const bottomTop=bottom.offsetTop;
 tools.style.bottom=landscape?'':(H-bottomTop+9)+'px';tools.dataset.placed='yes';
 const ticketTools=$('driveTicketTools'),sheet=$('ticketSheet'),toolsBottom=landscape?'':(H-bottomTop+9)+'px';
 const column=landscape?(top.offsetLeft+top.offsetWidth+12)+'px':'';
 ticketTools.style.bottom=toolsBottom;ticketTools.style.left=column;ticketTools.dataset.placed='yes';
 // Above the speed/compass row when it fits, otherwise over the stop panel
 // (the instruction panel stays visible: guidance goes on underneath).
 const above=bottomTop-9-(topBottom+8),fits=landscape||above>=260;
 sheet.style.left=column;
 sheet.style.bottom=landscape?'':fits?toolsBottom:(safe.bottom+8)+'px';
 sheet.style.maxHeight=landscape?'':Math.max(160,fits?above:H-safe.bottom-8-(topBottom+8))+'px';
 const view=landscape?{left:top.offsetLeft+top.offsetWidth+8,top:safe.top+8,right:W-safe.right-8,bottom:H-safe.bottom-8}
  :{left:safe.left+8,top:topBottom+8,right:W-safe.right-8,bottom:bottomTop-8};
 const ax=(view.left+view.right)/2,ay=view.top+Math.max(0,view.bottom-view.top)*DRIVE_POSITION_ANCHOR;
 wrap.style.setProperty('--nav-anchor-x',ax+'px');wrap.style.setProperty('--nav-anchor-y',ay+'px');
 wrap.style.setProperty('--drive-top-bottom',topBottom+'px');
 const w=Math.ceil(2*Math.max(ax,W-ax)),h=Math.ceil(2*Math.max(ay,H-ay));
 const box=[Math.round(ax-w/2),Math.round(ay-h/2),w,h].join();
 if(box===driveMapBox)return;
 driveMapBox=box;
 Object.assign($('map').style,{position:'absolute',inset:'auto',left:Math.round(ax-w/2)+'px',top:Math.round(ay-h/2)+'px',width:w+'px',height:h+'px'});
 map.invalidateSize({pan:false});
 if(lastCameraPoint)map.setView([lastCameraPoint.lat,lastCameraPoint.lng],map.getZoom(),{animate:false});
}
function scheduleDriveLayout(){if(!driveLayoutFrame)driveLayoutFrame=requestAnimationFrame(layoutDriveView)}
function resetDriveMapBox(){driveMapBox='';delete $('driveTools').dataset.placed;delete $('driveTicketTools').dataset.placed;const el=$('map');['position','inset','left','top','width','height'].forEach(k=>el.style[k]='')}
if(window.ResizeObserver){const ro=new ResizeObserver(scheduleDriveLayout);['driveTop','driveBottom'].forEach(id=>$(id)&&ro.observe($(id)))}
addEventListener('resize',scheduleDriveLayout);
window.visualViewport?.addEventListener('resize',scheduleDriveLayout);
if(window.MutationObserver&&$('gpsStatus'))new MutationObserver(renderDriveStatus).observe($('gpsStatus'),{childList:true,characterData:true,subtree:true});
// Safari: keep the screen on while driving (locked screen pauses GPS and speech).
async function keepScreenOn(){
 if(!navigationFullscreen||!('wakeLock'in navigator)||wakeLock)return;
 try{wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null})}catch(e){console.info('Wake lock non disponibile',e.message)}
}
function releaseScreen(){try{wakeLock?.release()}catch(e){}wakeLock=null}
// Top-panel speaker, like the iOS repeat button. Being a tap, it also
// re-enables speech on Safari after the app was in the background.
function repeatNavigationInstruction(){
 if(nativeActive){nativePost({type:'testVoice'});return}
 if(!$('voiceToggle').checked){setVoiceStatus('Annunci disattivati: tocca l’altoparlante in basso');return}
 resetVoiceGuidance();primeSpeech();
 if(!setupVoice()||!current)return;
 const along=voiceAlong??lastAlong,stops=current.stops||[];
 const stopAt=nextStopIdx<stops.length?current.offsets[nextStopIdx]:Infinity;
 const covered=current.guidanceCoverage?.ranges?.find(r=>along>=r[0]&&along<=r[1]);
 const turn=turns.find(t=>t.verifiedRoad&&t.at>along+5&&(!current.guidanceCoverage||covered&&t.at<=covered[1]));
 let message='Segui il percorso ufficiale.';
 if(turn&&turn.at<stopAt){const d=turn.at-along;message=d>20?'Tra circa '+speechDistance(d)+', '+turnSpeechLabel(turn)+'.':turn.text.replace(/[.!?\s]+$/,'')+'.'}
 else if(nextStopIdx<stops.length)message='Prossima fermata: '+stops[nextStopIdx].stop.stop_name+'.';
 enqueueVoice(message,'normal',{key:'manual'});
}
function turnSpeechLabel(turn){const t=turn.text.replace(/[.!?\s]+$/,'');return t.charAt(0).toLowerCase()+t.slice(1)}
// Safari speaks only if the first utterance starts inside a tap: call this
// synchronously in the tap handler, before any await.
function primeSpeech(){
 if(nativeMode||window.LineaPilotAndroid||!('speechSynthesis'in window))return;
 playThroughSilentSwitch();
 try{const u=new SpeechSynthesisUtterance(' ');u.volume=0;u.lang='it-IT';speechSynthesis.speak(u)}catch(e){console.warn(e)}
}
// iPhone: with the ring/silent switch on, Safari mutes speech of web pages
// ("ambient" audio). A "playback" audio session (Safari 16.4+) and, for older
// iOS, a short silent clip played inside the tap switch the page to media audio,
// which the switch does not mute - like the native app's AVAudioSession(.playback).
const isAppleTouchDevice=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
let silentClipUrl=null;
function silentClip(){
 if(silentClipUrl)return silentClipUrl;
 const samples=800,bytes=new Uint8Array(44+samples),view=new DataView(bytes.buffer);
 const text=(at,value)=>[...value].forEach((c,i)=>bytes[at+i]=c.charCodeAt(0));
 text(0,'RIFF');view.setUint32(4,36+samples,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);
 view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,8000,true);
 view.setUint16(32,1,true);view.setUint16(34,8,true);text(36,'data');view.setUint32(40,samples,true);
 bytes.fill(128,44); // 0.1 s of 8-bit silence
 let binary='';bytes.forEach(b=>binary+=String.fromCharCode(b));
 return silentClipUrl='data:audio/wav;base64,'+btoa(binary);
}
function setAudioSessionType(type){try{if(navigator.audioSession&&navigator.audioSession.type!==type)navigator.audioSession.type=type}catch(e){console.warn('Audio session',e)}}
function playThroughSilentSwitch(){
 setAudioSessionType('playback');
 if(!isAppleTouchDevice)return;
 try{const clip=new Audio(silentClip());clip.setAttribute('playsinline','');clip.volume=0;const played=clip.play();played?.catch?.(()=>{})}catch(e){console.warn(e)}
}
function enterNavigationView(){
 navigationFullscreen=true;
 document.body.classList.add('navigating');
 $('driveView').hidden=false;
 driveNorthUp=false;$('driveCompass').setAttribute('aria-pressed','false');
 renderDriveVoiceButton();
 const verified=turns.some(t=>t.verifiedRoad);
 setDriveTurn('Attesa GPS',verified?'Segui il percorso ufficiale':'Manovre stradali non disponibili','up');
 setDriveStop(current?.stops?.[0]?.stop?.stop_name||'Solo percorso GPX','');
 $('followToggle').checked=true;
 // Keep the map locked to the route while driving. No free dragging that
 // leaves the position icon away from the map's tracked center.
 map.dragging.disable();
 $('navigationPosition').hidden=true;
 refreshStopVoiceAvailability();
 keepScreenOn();
 setVoiceStatus('Voce in attesa');
 if(locationMarker)locationMarker.setStyle({opacity:0,fillOpacity:0});
 if(accuracyCircle&&map.hasLayer(accuracyCircle))map.removeLayer(accuracyCircle);
 resetDriveMapBox();scheduleDriveLayout();/* Await first reliable GPS fix before centring; avoid jumping to the GPX origin. */
}
function leaveNavigationView(){
 if(!navigationFullscreen)return;
 navigationFullscreen=false;document.body.classList.remove('navigating');
 closeTicketSheet();$('driveView').hidden=true;resetDriveMapBox();releaseScreen();setAudioSessionType('auto');lastNavHeading=null;lastCameraAt=0;lastCameraPoint=null;lastMatchedAt=0;hasMatchedFix=false;recoveryCandidate=null;
 $('navigationPosition').hidden=true;
 map.dragging.enable();
 if(locationMarker)locationMarker.setStyle({opacity:1,fillOpacity:1});
 if(accuracyCircle&&!map.hasLayer(accuracyCircle))accuracyCircle.addTo(map);
 if(typeof map.setHeading==='function')map.setHeading(null);
 if(typeof map.stopHeadingUp==='function')map.stopHeadingUp();
 if(typeof map.setBearing==='function')map.setBearing(0);
 requestAnimationFrame(()=>{map.invalidateSize({pan:false});if(lineLayer&&lineLayer.getBounds().isValid())fitWebBounds(lineLayer.getBounds(),{padding:[40,40]});});
}
function headingFromGPX(points,dists,along){
 // Sample over a longer section of the official route, instead of its
 // small GPS bends or noisy device compass values.
 const total=dists.at(-1)||0;
 const begin=Math.max(0,along-35),end=Math.min(total,along+105);
 if(end-begin<15)return null;
 const a=pointAt(points,dists,begin),b=pointAt(points,dists,end);
 if(metres(a,b)<18)return null; // avoid bearing from near-repeated/loop geometry
 return (bearing(a,b)+360)%360;
}
function updateNavigationHeading(points,dists,along){
 if(!navigationFullscreen)return;
 // Academy geometry is the authority. GPS heading is intentionally ignored:
 // phone magnetometers and GPS bearings fluctuate too much while driving slowly.
 const target=headingFromGPX(points,dists,along);
 if(target===null)return;
 if(lastNavHeading===null)lastNavHeading=target;
 else{
  const diff=((target-lastNavHeading+540)%360)-180;
  if(Math.abs(diff)<12)return; // dead zone: don't rotate for minor route bends
  const step=Math.max(-12,Math.min(12,diff*.22));
  lastNavHeading=(lastNavHeading+step+360)%360;
 }
 applyDriveHeading();
}
// Heading-up like the iOS app; the compass button switches to north-up and back.
function applyDriveHeading(){
 const heading=driveNorthUp||lastNavHeading===null?0:lastNavHeading;
 if(typeof map.setHeading==='function')map.setHeading(heading,{ease:0.12,deadzone:2});
 else if(typeof map.setBearing==='function')map.setBearing(-heading);
 $('driveNeedle')?.setAttribute('transform','rotate('+(-heading)+' 18 18)');
 // The arrow keeps pointing along the road when the map is north-up.
 const arrow=$('navigationPosition').querySelector('svg');
 if(arrow)arrow.style.transform=driveNorthUp&&lastNavHeading!==null?'rotate('+lastNavHeading+'deg)':'';
}
function stableRouteMatch(p,points,dists,speed,isDemo){
 const now=Date.now(),global=nearestOnShape(p,points,dists);
 // True off-route must be evaluated globally before accepting any local projection.
 if(global.d>180){recoveryCandidate=null;return {...global,offRoute:true}}
 if(!hasMatchedFix){
  if(global.d>140)return {...global,offRoute:global.d>180,waiting:true};
  hasMatchedFix=true;lastMatchedAt=now;recoveryCandidate=null;
  return global;
 }
 const elapsed=Math.max(.5,Math.min(15,(now-lastMatchedAt)/1000));
 lastMatchedAt=now;
 // GPS fixes can be seconds apart, especially on iOS. A fixed 220-metre
 // search window otherwise traps the vehicle behind forever.
 const maxProgress=isDemo?110:Math.max(90,Math.min(320,Math.max(speed,5)*elapsed*2.4+65));
 const minAlong=Math.max(0,lastAlong-55),maxAlong=Math.min(dists.at(-1)||0,lastAlong+maxProgress);
 const i0=dists.findIndex(d=>d>=minAlong),i1=dists.findIndex(d=>d>=maxAlong);
 const start=Math.max(0,(i0<0?points.length-2:i0)-2);
 const end=Math.min(points.length-1,Math.max(start+1,(i1<0?points.length-1:i1)+2));
 const local=nearestOnShape(p,points,dists,start,end);
 if(local.d<=Math.max(95,Math.min(145,global.d+30))&&local.along>=lastAlong-75){
  recoveryCandidate=null;
  return local;
 }
 // Only the distance to the WHOLE GPX proves a real route deviation.
 // Being outside a narrow progress window is not "GPS lontano dal tracciato".
 if(global.d<=125&&global.along>=lastAlong-70){
  const old=recoveryCandidate;
  const consecutive=old&&now-old.at<20000&&Math.abs(global.along-old.along)<Math.max(180,speed*elapsed*3+75);
  recoveryCandidate={along:global.along,at:now,count:consecutive?old.count+1:1};
  if(recoveryCandidate.count>=2){
   recoveryCandidate=null;
   return {...global,reacquired:true};
  }
  // Hold turns and stop progression until two consistent fixes agree.
  return {d:global.d,along:lastAlong,idx:global.idx,recovering:true};
 }
 recoveryCandidate=null;
 if(global.d<=180){
  return {d:global.d,along:lastAlong,idx:global.idx,recovering:true};
 }
 return {d:global.d,along:lastAlong,idx:global.idx,offRoute:true};
}
function followStableCamera(position,isDemo=false,force=false){
 if(!navigationFullscreen||!position)return;
 // The camera follows the actual GPS fix. Compare against the position
 // LAST RENDERED on the map, not the last raw fix: small movements accumulate.
 const fix={lat:position.lat,lng:position.lng};
 if(!Number.isFinite(fix.lat)||!Number.isFinite(fix.lng))return;
 if(!lastCameraPoint){
  map.setView([fix.lat,fix.lng],Math.max(16,map.getZoom()),{animate:false});
  lastCameraPoint=fix;
 }else if(force||metres(lastCameraPoint,fix)>=3){
  map.panTo([fix.lat,fix.lng],{animate:false});
  lastCameraPoint=fix;
 }
 $('navigationPosition').hidden=false;
}
function recenterOnRealGPS(){
 // The location button must NEVER recenter on the GPX projection.
 // Live geolocation is authoritative for the user's actual position.
 if(nativeMode&&nativeActive){if(realGpsFix){const p=realGpsFix;lastCameraPoint=null;followStableCamera(p,false,true)}else toast('In attesa del primo GPS nativo');return}
 if(realGpsFix&&Date.now()-realGpsFixAt<10000){
  const fix=realGpsFix;
  if(navigationFullscreen){
   lastCameraPoint=null;
   followStableCamera(fix,false,true);
  }else map.setView([fix.lat,fix.lng],16,{animate:false});
  toast('Mappa centrata sulla tua posizione GPS');
  return;
 }
 if(!('geolocation' in navigator)){
  toast('GPS non disponibile su questo dispositivo');return;
 }
 toast('Ricerca della posizione GPS…');
 navigator.geolocation.getCurrentPosition(pos=>{
  const c=pos.coords;
  if(!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)||c.accuracy>120){
   toast('Posizione GPS troppo imprecisa, riprova');return;
  }
  realGpsFix={lat:c.latitude,lng:c.longitude};realGpsFixAt=Date.now();
  if(navigationFullscreen){lastCameraPoint=null;followStableCamera(realGpsFix,false,true)}
  else map.setView([c.latitude,c.longitude],16,{animate:false});
  toast('Mappa centrata sulla tua posizione GPS');
 },err=>toast('Impossibile trovare la posizione GPS: '+err.message),
 {enableHighAccuracy:true,maximumAge:2000,timeout:12000});
}
$('exitNavigation').addEventListener('click',()=>{stopNavigation();$('navStatus').textContent='Navigazione terminata'});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&navigationFullscreen){stopNavigation();$('navStatus').textContent='Navigazione terminata'}});


const ACADEMY_EXPECTED={Extraurbano:559,Colli:29,Urbano:201};
const ACADEMY_DOCUMENTS={
  'Turni Invernali':{'Feriale':['1 FERIALE dal 02_11_2026 - _27-5.pdf'],'Sabato':['2 SABATO  anno scolastico 2026 - _27-2.pdf'],'Festivo':['3 FESTIVO EXTRAURBANO anno scolastico 2026 - _27-1.pdf']},
  'Indicatori di percorso':{'Colli':['Linee Colli.pdf'],'Extraurbano':['Linee Extraurbanee.pdf'],'Urbano':['Linee Urbane.pdf']}
};
const sortIt=(a,b)=>String(a).localeCompare(String(b),'it',{numeric:true,sensitivity:'base'});
function academyGroupName(r){return String(r.line||'Altri percorsi').trim();}
// Market-day detours: the Academy folder ("…/Deviazioni mercatali /5 Venerdì /…") gives the day.
function academyMarketDay(route){
 for(const path of route?._evidence?.sourcePaths||[]){
  const m=/deviazioni mercatali\s*\/\s*\d+\s+([^/]+?)\s*\//i.exec(path);
  if(m)return m[1].trim();
 }
 return '';
}
function academyLineLabel(route){const day=academyMarketDay(route);return academyGroupName(route)+(day?' ('+day+')':'')}
// These Academy files share the same ordered coordinates, service evidence
// and stop proposals. Keep the source IDs and group only the picker options.
const ACADEMY_ROUTE_ALIASES=new Map([[2,3],[55,56],[76,75],[103,101],[110,109],[208,209]]);
function academyRouteChoices(routes,query){
 const normalize=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('it');
 const groups=new Map(),titles=new Map();
 for(const route of routes){
  const id=ACADEMY_ROUTE_ALIASES.get(route.id)??route.id;
  if(!groups.has(id))groups.set(id,[]);
  groups.get(id).push(route);
  if(id!==route.id)continue;
  const title=normalize(route.name);
  if(!titles.has(title))titles.set(title,[]);
  titles.get(title).push(route);
 }
 const choices=[];
 for(const [id,group] of groups){
  const route=group.find(r=>r.id===id)??group[0];
  if(query&&!group.some(r=>normalize([r.name,r.variant,r.filename].join(' ')).includes(query)))continue;
  const homonyms=titles.get(normalize(route.name))??[];
  const code=String(route.variant??'').trim();
  const distinctCode=code&&homonyms.filter(r=>normalize(r.variant)===normalize(code)).length===1;
  const label=homonyms.length<=1?route.name:route.name+(distinctCode?' · cod. '+code:' · GPX '+route.id);
  const day=academyMarketDay(route);
  choices.push([String(route.id),day?label+' · '+day:label]);
 }
 return choices.sort((a,b)=>sortIt(a[1],b[1]));
}
// XMLHttpRequest is supported by WKURLSchemeHandler for bundled JSON.
async function readAcademyJSON(path){
 if(nativeMode)return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('GET','./'+path,true);
  xhr.onload=()=>{if(xhr.status!==0&&(xhr.status<200||xhr.status>=300)){reject(Error('Academy HTTP '+xhr.status));return}try{resolve(JSON.parse(xhr.responseText))}catch(e){reject(e)}};
  xhr.onerror=()=>reject(Error('Dati Academy locali non accessibili'));xhr.send();
 });
 const response=await fetch('./'+path);if(!response.ok)throw Error('HTTP '+response.status);return response.json();
}
async function loadAcademy(){try{
 const [original,supplemental,evidence]=await Promise.all(['official-routes.json','academy-supplemental-routes.json','academy-evidence.json'].map(readAcademyJSON));
 if(!Array.isArray(original)||original.length!==787||!Array.isArray(supplemental)||supplemental.length!==2)throw Error('Catalogo non valido');
 const data=[...original,...supplemental].map(r=>({...r,_evidence:evidence.routes[String(r.id)]}));
 academy=data;const ids=new Set(data.map(r=>r.id)),stats={};
 for(const category of Object.keys(ACADEMY_EXPECTED))stats[category]=data.filter(r=>r.category===category).length;
 const complete=data.length===789&&ids.size===789&&Object.keys(ACADEMY_EXPECTED).every(k=>stats[k]===ACADEMY_EXPECTED[k])&&data.every(r=>Array.isArray(r.points)&&r.points.length>=2);
 $('academyCount').textContent=complete?'Catalogo completo: 789/789 GPX (559 Extraurbano, 29 Colli, 201 Urbano).':'ATTENZIONE: catalogo incompleto o non valido ('+data.length+'/789).';
 $('officialInfo').textContent=complete?'Seleziona categoria, linea e variante. Le due sezioni documentali contengono PDF, non tracciati GPS.':'Controllare official-routes.json prima della navigazione.';
 filterAcademy();
}catch(e){$('academyCount').textContent='Catalogo GPX non disponibile';$('officialInfo').textContent='Errore caricamento GPX: '+e.message}}
function filterAcademy(){
 const category=$('academyCategory').value;
 const previousLine=$('academyLine').value;
 selectedOfficial=null;
 if(!category){
  setOptions($('academyLine'),[],'Scegli prima la categoria…');
  setOptions($('academyRoute'),[],'Scegli prima la linea…');
  $('academyCount').textContent=academy.filter(r=>!ACADEMY_ROUTE_ALIASES.has(r.id)).length+' percorsi GPX disponibili · seleziona una categoria';
  onAcademySelected();return;
 }
 if(ACADEMY_DOCUMENTS[category]){
  const groups=Object.keys(ACADEMY_DOCUMENTS[category]).sort(sortIt);
  setOptions($('academyLine'),groups.map(g=>[g,g]),'Scegli gruppo…');
  if(groups.includes(previousLine))$('academyLine').value=previousLine;
  filterAcademyRoutes();return;
 }
 const paths=academy.filter(r=>r.category===category&&!ACADEMY_ROUTE_ALIASES.has(r.id));
 const groups=[...new Set(paths.map(academyGroupName))].sort(sortIt);
 setOptions($('academyLine'),groups.map(g=>[g,g+' ('+paths.filter(r=>academyGroupName(r)===g).length+')']),'Scegli linea…');
 if(groups.includes(previousLine))$('academyLine').value=previousLine;
 filterAcademyRoutes();
}
function filterAcademyRoutes(){
 const cat=$('academyCategory').value,line=$('academyLine').value;
 const previous=$('academyRoute').value;
 const paths=academy.filter(r=>r.category===cat);
 if(!line){setOptions($('academyRoute'),[],'Scegli prima la linea…');$('academyCount').textContent=paths.filter(r=>!ACADEMY_ROUTE_ALIASES.has(r.id)).length+' percorsi nella categoria';onAcademySelected();return;}
 if(ACADEMY_DOCUMENTS[cat]){
  const docs=ACADEMY_DOCUMENTS[cat][line]||[];
  setOptions($('academyRoute'),docs.map(d=>[d,d]),'Scegli documento…');
  if(docs.includes(previous))$('academyRoute').value=previous;
  $('academyCount').textContent=docs.length+' documento/i PDF · non sono GPX';
  onAcademySelected();return;
 }
 const choices=academyRouteChoices(paths.filter(r=>academyGroupName(r)===line),'');
 setOptions($('academyRoute'),choices,'Scegli percorso…');
 const selected=String(ACADEMY_ROUTE_ALIASES.get(Number(previous))??previous);
 if(choices.some(([id])=>id===selected))$('academyRoute').value=selected;
 $('academyCount').textContent=choices.length+' percorsi trovati in '+cat+' / '+line+' (nessun limite ai risultati)';
 onAcademySelected();
}
let academyGtfsMatches=new Map();
function resetAcademyGtfs(){
 $('confirmStopProposal').checked=false;$('confirmStopProposalLabel').hidden=true;
 academyGtfsMatches=new Map();$('academyDiff').hidden=true;$('academyDiffList').replaceChildren();
 $('academyVariantPreview').hidden=true;$('academyVariantPreview').replaceChildren();
 setOptions($('academyGtfsTrip'),[],'Nessuna corsa verificata');
 $('findGtfsAcademy').disabled=!selectedOfficial||!feed;
 $('mergeOfficial').disabled=true;
 $('academyGtfsStatus').textContent=feed?'Seleziona un GPX e cerca le corse GTFS compatibili.':'Le fermate Busitalia vengono caricate automaticamente.';
}
function normAcademyCode(s){
 const x=String(s||'').trim().toUpperCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
 return x.replace(/^U(?=\d)/,'').replace(/^E(?=\d)/,'').replace(/^0+(?=\d)/,'');
}
function academyRouteCodes(r){
 // Line or directory must not override the original Academy name: these are match candidates only.
 const values=[r.line,r.variant,...(r._evidence?.lineAliases||[])];
 if(/^\d+[A-Z]*\b/i.test(r.name||''))values.push(String(r.name).trim().split(/[\s|_-]/)[0]);
 const keys=new Set(values.map(normAcademyCode).filter(Boolean));
 // Variant 10D matches GTFS route 10; "Deviazioni mercatali" may have variant 523.
 for(const v of [...keys])if(/^\d+[A-Z]+$/.test(v))keys.add(v.replace(/[A-Z]+$/,''));
 return keys;
}
function gtfsFitsAcademyCode(r,route){
 const raw=String(route?.route_short_name||'').trim().toUpperCase();
 // GTFS E0092 / E0102 are services 9 / 10 with a numeric suffix, not
 // services 92 / 102. Keep the original zero padding until after parsing.
 if(r.category==='Urbano'&&!raw.startsWith('U'))return false;
 if(r.category==='Extraurbano'&&raw.startsWith('U'))return false;
 if(r.category==='Colli'&&/^[UE]\d/.test(raw))return false;
 const codes=academyRouteCodes(r),family=code=>String(code||'').replace(/^(\d+)[A-Z]+$/,'$1');
 const keys=new Set([...codes].flatMap(c=>[c,family(c)]));
 const parts=raw.split(/[\/;,]+/).flatMap(v=>[v,v.split(/[_-]/)[0]]);
 return parts.some(part=>{
  const numericSuffix=/^E(\d{3})\d$/.exec(part);
  const code=normAcademyCode(numericSuffix?numericSuffix[1]:part);
  return code&&(keys.has(code)||keys.has(family(code)));
 });
}
function timeOfTrip(t){
 const x=feed.timesByTrip.get(t.trip_id)||[];
 return (x[0]?.departure||'—')+' → '+(x.at(-1)?.arrival||'—');
}
// Compare GTFS segments to the Academy polyline, without altering its geometry.
function evaluateGtfsSegment(stops,points,dists){
 const result=RouteStops.match(stops,points,dists);
 if(!result.ok)return null;
 return {...result,first:stops[0].stop,last:stops.at(-1).stop,stops};
}
function candidateGtfsSegments(chosen,pts,dists,broad=false){
 const groups=new Map();
 for(const route of feed.routes){
  if(route._stopAuthority==='supplemental'||String(route.route_type)!=='3')continue;
  const raw=String(route.route_short_name||'').toUpperCase();
  const domain=chosen.category==='Urbano'?raw.startsWith('U'):chosen.category==='Colli'?!/^[UE]\d/.test(raw):!raw.startsWith('U');
  if(!domain||(!broad&&!gtfsFitsAcademyCode(chosen,route)))continue;
  for(const t of feed.tripsByRoute.get(route.route_id)||[]){
   const a=feed.timesByTrip.get(t.trip_id)||[];if(a.length<2)continue;
   const key=t.route_id+'|'+a.map(x=>x.stop?.stop_id||'?').join('|');
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);
  }
 }
 const segments=[];
 for(const trips of groups.values()){
  const t=trips[0],ss=(feed.timesByTrip.get(t.trip_id)||[]).filter(x=>x.stop&&Number.isFinite(x.stop.lat)&&Number.isFinite(x.stop.lng));
  const hits=ss.map(x=>RouteStops.projections(x.stop,pts,dists));
  if(broad){
   const near=hits.filter((h,i)=>h.nearest.d<160||(i===0&&RouteStops.distance(ss[i].stop,pts[0])<=250)||(i===ss.length-1&&RouteStops.distance(ss[i].stop,pts.at(-1))<=250));
   if(near.length<2)continue;
   const span=Math.max(...near.map(h=>h.nearest.along))-Math.min(...near.map(h=>h.nearest.along));
   if(span<Math.min(300,(dists.at(-1)||1)*.1))continue;
  }
  const m=evaluateGtfsSegment(ss,pts,dists);
  if(m){segments.push({...m,trip:t,alternatives:trips,association:broad?'geometry-confirmed':'full-sequence',reviewRequired:broad});continue}
  // Subroutes and official detours may omit prefix/suffix or off-GPX stops.
  // Keep ORIGINAL GTFS order/coordinates and record every omitted stop.
  // Such a proposal is explicitly partial; it is never labelled a full trip.
  const retained=ss.filter((x,i)=>hits[i].nearest.d<=100||
   (i===0&&RouteStops.distance(x.stop,pts[0])<=250)||
   (i===ss.length-1&&RouteStops.distance(x.stop,pts.at(-1))<=250));
  if(retained.length<2||retained.length===ss.length)continue;
  const subset=evaluateGtfsSegment(retained,pts,dists);
  if(!subset)continue;
  const positions=retained.map(x=>ss.indexOf(x));
  const continuous=positions.every((n,i)=>i===0||n===positions[i-1]+1);
  segments.push({...subset,trip:t,alternatives:trips,association:continuous?'subsequence':'detour-subset',reviewRequired:true,
   omittedStops:ss.filter(x=>!retained.includes(x)).map(x=>x.stop.stop_name),originalStopCount:ss.length,routeInferred:broad});
 }
 return {segments,groupCount:groups.size};
}
function samePhysicalStop(a,b){
 if(!a||!b||!Number.isFinite(a.lat)||!Number.isFinite(b.lat))return false;
 const distance=metres(a,b);
 if(distance>35)return false;
 const names=[a.stop_name,b.stop_name].map(v=>String(v||'').normalize('NFKD').toUpperCase().replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,''));
 return (a.stop_id&&a.stop_id===b.stop_id)||(names[0]&&names[0]===names[1]);
}
function stopSequenceKey(stops){return stops.map(x=>[x.stop?.stop_id||'',Math.round(x.stop?.lat*100000||0),Math.round(x.stop?.lng*100000||0)].join(':')).join('|')}
function makeInfoLine(parent,value,strong=false){
 const item=document.createElement('p');item.className='help';item.textContent=value;if(strong)item.style.fontWeight='700';parent.append(item);
}
function describeMatch(x){
 return x.legs.map((l,i)=>{
  const route=feed.routesById.get(l.trip.route_id);
  const first=l.stops[0]?.stop?.stop_name||'?';
  const last=l.stops.at(-1)?.stop?.stop_name||'?';
  return (i+1)+'. '+(route?.route_short_name||'?')+' '+first+' → '+last+' ('+l.stops.length+' fermate)';
 }).join(' | ');
}
function hasStopInSequence(stop,seq){return seq.some(item=>samePhysicalStop(stop,item.stop))}
function variantStopNames(match){
 return (match?.stops||[]).map(x=>x.stop?.stop_name||x.stop?.stop_id||'Fermata senza nome');
}
function variantSignature(match){
 // Different trip IDs and timetables can represent precisely the same stop
 // sequence. Display these once; do not fabricate extra "variants".
 return stopSequenceKey(match.stops);
}
function uniqueAcademyVariants(matches){
 const bySequence=new Map();
 for(const match of matches){
  const key=variantSignature(match),old=bySequence.get(key);
  const rank=x=>x.reviewRequired?1:0;
  if(!old||rank(match)<rank(old)||(rank(match)===rank(old)&&
   ((match.legs.length===1&&old.legs.length>1)||
    (match.legs.length===old.legs.length&&(match.coverage>old.coverage||
     (match.coverage===old.coverage&&match.averageError<old.averageError))))))bySequence.set(key,match);
 }
 return [...bySequence.values()];
}
function variantDistinguishingStops(match,all){
 const other=all.filter(x=>x!==match);
 if(!other.length)return [];
 return match.stops.filter(st=>other.some(alt=>!hasStopInSequence(st.stop,alt.stops)))
  .map(st=>st.stop?.stop_name||st.stop?.stop_id||'Fermata senza nome')
  .filter((name,i,list)=>list.indexOf(name)===i);
}
function variantFriendlyLabel(match,all){
 const names=variantStopNames(match);
 const first=names[0]||'Partenza sconosciuta',last=names.at(-1)||'Destinazione sconosciuta';
 const special=variantDistinguishingStops(match,all).filter(n=>n!==first&&n!==last);
 const marker=special.length?' · via '+special.slice(0,2).join(', '):'';
 const legs=match.reviewRequired?' · '+(match.incompleteRoute?'solo '+Math.round(match.coverage*100)+'% del GPX · ':'')+'verifica variante':match.legs.length>1?' · '+match.legs.length+' corse GTFS concatenate':'';
 return first+' → '+last+marker+' · '+names.length+' fermate'+legs;
}
function updateStopConfirmation(){
 const selected=academyGtfsMatches.get($('academyGtfsTrip').value);
 $('confirmStopProposalLabel').hidden=!selected?.reviewRequired;
 $('mergeOfficial').disabled=!selected||(selected.reviewRequired&&!$('confirmStopProposal').checked);
}
$('confirmStopProposal').addEventListener('change',updateStopConfirmation);
function refreshVariantPreview(){
 $('confirmStopProposal').checked=false;
 updateStopConfirmation();
 const output=$('academyVariantPreview');
 const selected=academyGtfsMatches.get($('academyGtfsTrip').value);
 if(!selected){
  output.hidden=true;
  output.replaceChildren();
  return;
 }
 output.replaceChildren();
 output.hidden=false;
 const all=[...academyGtfsMatches.values()];
 const names=variantStopNames(selected);
 const headline=document.createElement('strong');
 headline.textContent=names[0]+' → '+names.at(-1);
 output.append(headline);
 makeInfoLine(output,names.length+' fermate · '+(selected.legs.length>1?'Attenzione: '+selected.legs.length+' corse GTFS concatenate, non una corsa unica':'Corsa GTFS unica'));
 if(selected.reviewRequired){
  makeInfoLine(output,'Da verificare: '+(selected.association==='detour-subset'?'alcune fermate della corsa GTFS sono fuori da questa variante GPX e sono state escluse.':'sequenza associata per sottotratta, concatenazione o confronto geometrico; non è confermata come corsa completa.'));
  if(selected.omittedStops?.length)makeInfoLine(output,'Fermate GTFS escluse perché fuori GPX: '+selected.omittedStops.join(' · '));
 }
 const unique=variantDistinguishingStops(selected,all);
 if(unique.length)makeInfoLine(output,'Fermate che distinguono questa variante: '+unique.slice(0,8).join(' · ')+(unique.length>8?' · …':''));
 else if(all.length>1)makeInfoLine(output,'Nessuna fermata esclusiva: confronta capolinea e ordine delle fermate.');
 const details=document.createElement('details'),summary=document.createElement('summary');
 summary.textContent='Visualizza tutte le '+names.length+' fermate nell’ordine';
 details.append(summary);
 const ol=document.createElement('ol');ol.className='variant-stops-list';
 names.forEach(name=>{const li=document.createElement('li');li.textContent=name;ol.append(li)});
 details.append(ol);output.append(details);
}
function renderAcademyStopComparison(){
 const panel=$('academyDiff'),root=$('academyDiffList');
 root.replaceChildren();
 const results=[...academyGtfsMatches.entries()];
 panel.hidden=results.length<2;
 if(results.length<2)return;
 const selected=academyGtfsMatches.get($('academyGtfsTrip').value)||results[0][1];
 const all=results.map(([id,x])=>x.stops);
 const common=selected.stops.filter(st=>all.every(seq=>hasStopInSequence(st.stop,seq)));
 makeInfoLine(root,results.length+' varianti geograficamente compatibili. '+common.length+' fermate della variante selezionata risultano comuni a tutte. Questo confronto non certifica le fermate in servizio.',true);
 // Compare each variant against the currently selected sequence, not just total counts.
 for(const [id,x] of results){
  const wrapper=document.createElement('section');wrapper.className='academy-diff-item';
  const title=document.createElement('strong');
  const idx=results.findIndex(([key])=>key===id)+1;
  title.textContent='Variante '+idx+(x===selected?' (selezionata)':'')+' · '+x.stops.length+' fermate';
  wrapper.append(title);
  makeInfoLine(wrapper,describeMatch(x));
  const notInSelected=x.stops.filter(st=>!hasStopInSequence(st.stop,selected.stops));
  const missingFromX=selected.stops.filter(st=>!hasStopInSequence(st.stop,x.stops));
  const shared=x.stops.filter(st=>hasStopInSequence(st.stop,selected.stops)).length;
  if(x===selected){makeInfoLine(wrapper,'Riferimento del confronto: '+shared+' fermate.');}
  else {
   makeInfoLine(wrapper,'In comune con la selezionata: '+shared+' · Solo in questa: '+notInSelected.length+' · Mancanti rispetto alla selezionata: '+missingFromX.length);
   for(const [label,rows] of [['Solo in questa variante',notInSelected],['Presenti nella selezionata ma non in questa',missingFromX]]){
    if(!rows.length)continue;
    const p=document.createElement('p');p.className='help';
    p.textContent=label+': '+rows.map(st=>st.stop?.stop_name||st.stop?.stop_id||'Fermata senza nome').join('; ');
    wrapper.append(p);
   }
  }
  root.append(wrapper);
 }
}
function buildAcademyMatches(chosen,broad=false){
 if(chosen._evidence?.serviceStatus==='out-of-service')return {results:[],segments:0,groupCount:0,outOfService:true};
 const pts=chosen.points.map(([lat,lng])=>({lat,lng})),dists=shapeMetrics(pts),total=dists.at(-1)||1;
 const {segments,groupCount}=candidateGtfsSegments(chosen,pts,dists,broad);
 const results=[],full=x=>x.start<Math.max(700,total*.12)&&x.end>total*.85&&x.span>total*.68;
 for(const x of segments)if(full(x)){
  const match=matchStopsStrict(x.stops,pts,dists);
  if(match.ok)results.push({trip:x.trip,legs:[x],stops:x.stops,averageError:x.meanError,coverage:x.span/total,match,association:x.association,reviewRequired:!!x.reviewRequired,omittedStops:x.omittedStops||[]});
 }
 // Explore up to four segments when a whole Academy route is split into multiple GTFS trips.
 // Never interpolate invented stops and never join geographically disconnected legs.
 const ordered=segments.sort((a,b)=>a.start-b.start||b.end-a.end);
 const seen=new Set();
 let frontier=ordered.filter(x=>x.start<Math.max(700,total*.12)).map(x=>({legs:[x],stops:x.stops,start:x.start,end:x.end,error:x.meanError}));
 for(let depth=2;depth<=4&&frontier.length;depth++){
  const next=[];
  for(const chain of frontier){
   const last=chain.legs.at(-1);
   for(const leg of ordered){
    if(chain.legs.includes(leg)||leg.end<=last.end+400||leg.start<last.end-260||leg.start>last.end+2200)continue;
    const gap=metres(last.last,leg.first);
    if(gap>320)continue;
    const sameStop=samePhysicalStop(last.last,leg.first);
    const stops=chain.stops.concat(leg.stops.slice(sameStop?1:0));
    const candidate={legs:[...chain.legs,leg],stops,start:chain.start,end:leg.end,error:(chain.error*(depth-1)+leg.meanError)/depth};
    if(full({start:candidate.start,end:candidate.end,span:candidate.end-candidate.start})){
     const match=matchStopsStrict(stops,pts,dists);
     if(!match.ok)continue;
     const key=stopSequenceKey(stops);
     if(seen.has(key))continue;seen.add(key);
     results.push({trip:chain.legs[0].trip,legs:candidate.legs,stops,averageError:candidate.error,coverage:(candidate.end-candidate.start)/total,match,association:"chain",reviewRequired:true,omittedStops:candidate.legs.flatMap(x=>x.omittedStops||[])});
    }else if(depth<4&&candidate.end<total*.96)next.push(candidate);
   }
  }
  // Limit combinatorial growth on networks with many overlapping service variants.
  next.sort((a,b)=>b.end-a.end||a.error-b.error);
  frontier=next.slice(0,120);
 }
 results.sort((a,b)=>b.coverage-a.coverage||a.averageError-b.averageError);
 if(!results.length&&!broad)return buildAcademyMatches(chosen,true);
 if(!results.length&&broad){
  const partial=segments.filter(x=>x.stops.length>=2&&x.span>=Math.min(1000,total*.15)).sort((a,b)=>b.span-a.span||a.meanError-b.meanError);
  for(const x of partial.slice(0,12)){
   const match=matchStopsStrict(x.stops,pts,dists);if(!match.ok)continue;
   results.push({trip:x.trip,legs:[x],stops:x.stops,averageError:x.meanError,coverage:x.span/total,match,association:'partial-sequence',reviewRequired:true,incompleteRoute:true,omittedStops:x.omittedStops||[]});
  }
 }
 if(chosen._evidence?.serviceStatus==='conflicting-indicator')for(const result of results)result.reviewRequired=true;
 results.sort((a,b)=>Number(a.reviewRequired)-Number(b.reviewRequired)||b.coverage-a.coverage||a.averageError-b.averageError);
 return {results,segments:segments.length,groupCount,broad};
}
function findGtfsForAcademy(){
 if(!selectedOfficial||!feed)return;
 if(selectedOfficial._evidence?.serviceStatus==='out-of-service'){academyGtfsMatches=new Map();setOptions($('academyGtfsTrip'),[],'Fuori servizio');$('academyGtfsStatus').textContent='Indicatore ufficiale FUORI SERVIZIO: trasferimento senza sequenza di fermate passeggeri. La guida stradale sul GPX resta disponibile.';$('mergeOfficial').disabled=true;return}
 const button=$('findGtfsAcademy');button.disabled=true;
 $('academyGtfsStatus').textContent='Confronto delle fermate GTFS con il GPX Academy…';
 academyGtfsMatches=new Map();$('academyDiff').hidden=true;$('academyDiffList').replaceChildren();
 try{
  const {results,segments,groupCount}=buildAcademyMatches(selectedOfficial);
  // Many matching GTFS trips have identical stops. Show one choice per actual
  // sequence, not one choice per journey ID or equivalent chain.
  const distinct=uniqueAcademyVariants(results);
  academyGtfsMatches=new Map();const options=[];
  distinct.forEach((x,i)=>{
   const id='academy-match-'+i;academyGtfsMatches.set(id,x);
   options.push([id,variantFriendlyLabel(x,distinct)]);
  });
  setOptions($('academyGtfsTrip'),options,'Seleziona in base alle fermate…');
  if(distinct.length===1)$('academyGtfsTrip').value='academy-match-0';
  renderAcademyStopComparison();
  refreshVariantPreview();
  $('academyGtfsStatus').textContent=distinct.length?
   distinct.length+' sequenze/proposte di fermate distinte ('+Math.max(0,results.length-distinct.length)+' duplicati nascosti). Controlla partenza, arrivo e fermate particolari prima di confermare.':
   'Nessuna corrispondenza completa ('+segments+' segmenti compatibili da '+groupCount+' sequenze GTFS). Il GPX non viene modificato.';
  $('mergeOfficial').disabled=distinct.length!==1;
  updateStopConfirmation();
 }catch(e){console.error(e);$('academyGtfsStatus').textContent='Errore di associazione: '+e.message;}
 finally{button.disabled=false}
}
$('findGtfsAcademy').addEventListener('click',findGtfsForAcademy);
$('academyGtfsTrip').addEventListener('change',()=>{
 $('mergeOfficial').disabled=!selectedOfficial||!academyGtfsMatches.has($('academyGtfsTrip').value);
 renderAcademyStopComparison();
 refreshVariantPreview();
});
function onAcademySelected(){
 stopNavigation();roadGuidanceLoadId++;
 current=null;turns=[];
 if(lineLayer){map.removeLayer(lineLayer);lineLayer=null}
 if(stopLayer){map.removeLayer(stopLayer);stopLayer=null}
 $('startNav').disabled=true;$('demoBtn').disabled=true;
 const cat=$('academyCategory').value,line=$('academyLine').value;
 if(ACADEMY_DOCUMENTS[cat]){
  selectedOfficial=null;$('showOfficial').disabled=true;$('mergeOfficial').disabled=true;resetAcademyGtfs();
  $('officialInfo').textContent=$('academyRoute').value?'Documento: '+$('academyRoute').value+'. Il PDF originale non è incluso nel catalogo GPS; questa sezione è un indice, non una mappa navigabile.':'Sezione documentale: scegli prima il gruppo e il PDF.';
  return;
 }
 selectedOfficial=academy.find(r=>String(r.id)===$('academyRoute').value&&r.category===cat&&academyGroupName(r)===line)||null;
 $('showOfficial').disabled=!selectedOfficial;
 resetAcademyGtfs();
 if(selectedOfficial){$('officialInfo').textContent=selectedOfficial.category+', linea '+selectedOfficial.line+', variante '+(selectedOfficial.variant||'—')+': '+selectedOfficial.name+'. Puoi avviare il GPS direttamente su questo GPX.';showAcademyRoute(false);}
 else $('officialInfo').textContent='Scegli categoria, linea e percorso effettivo.';
}
// Free search over the whole catalogue: "201 padova ca bianca" finds
// "201 | Padova - Ca’ Bianca" regardless of accents, apostrophes and separators.
function academySearchText(value){
 return String(value??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLocaleLowerCase('it')
  .replace(/['’‘`´]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function searchAcademyRoutes(routes,query){
 const tokens=academySearchText(query).split(' ').filter(Boolean);
 if(!tokens.length)return [];
 const results=[];
 for(const route of routes){
  if(ACADEMY_ROUTE_ALIASES.has(route.id)||ACADEMY_DOCUMENTS[route.category])continue;
  const name=academySearchText(route.name),code=academySearchText(route.variant);
  const words=academySearchText([route.variant,route.name,route.line,route.category,route.filename,academyMarketDay(route)].join(' ')).split(' ');
  // Every typed word must start a word of the route (numbers too: "20" finds 201).
  // GTFS-style codes are accepted as well: "U15" / "E201" also find 15 / 201.
  const matches=t=>words.some(w=>w.startsWith(t))||/^[ue]\d/.test(t)&&words.some(w=>w.startsWith(t.slice(1)));
  if(!tokens.every(matches))continue;
  const lead=tokens[0].replace(/^[ue](?=\d)/,''),first=name.split(' ')[0];
  const score=(code&&code===lead?4:0)+(first===lead?2:first.replace(/[a-z]+$/,'')===lead?1.5:0)+(name.startsWith(tokens.join(' '))?1:0);
  results.push({route,score});
 }
 return results.sort((a,b)=>b.score-a.score||sortIt(a.route.name,b.route.name)).map(r=>r.route);
}
function academySearchLabel(route){
 const code=String(route.variant??'').trim();
 return [route.category,'linea '+academyLineLabel(route),code&&'cod. '+code,'GPX '+route.id].filter(Boolean).join(' · ');
}
function renderAcademySearch(){
 const box=$('academySearchResults'),query=$('academySearch').value;
 const found=query.trim()?searchAcademyRoutes(academy,query):[];
 box.replaceChildren();
 box.hidden=!query.trim();
 if(!query.trim())return;
 if(!found.length){const empty=document.createElement('p');empty.className='help';empty.textContent='Nessun percorso trovato. Prova con il numero della linea o una località.';box.append(empty);return}
 const count=document.createElement('p');count.className='help';count.textContent=found.length===1?'1 percorso trovato':found.length+' percorsi trovati';box.append(count);
 for(const route of found){
  const button=document.createElement('button');button.type='button';button.setAttribute('role','listitem');button.dataset.routeId=route.id;
  const title=document.createElement('strong');title.textContent=route.name;
  const detail=document.createElement('small');detail.textContent=academySearchLabel(route);
  button.append(title,detail);
  button.addEventListener('click',()=>pickAcademyRoute(route));
  box.append(button);
 }
}
function pickAcademyRoute(route){
 $('academyCategory').value=route.category;filterAcademy();
 $('academyLine').value=academyGroupName(route);filterAcademyRoutes();
 $('academyRoute').value=String(route.id);onAcademySelected();
 $('academySearch').value='';renderAcademySearch();
 $('academyCount').textContent='Selezionato: '+route.name+' ('+academySearchLabel(route)+')';
 $('academyRoute').focus({preventScroll:true});
}
$('academyCategory').addEventListener('change',filterAcademy);
$('academyLine').addEventListener('change',filterAcademyRoutes);
$('academySearch').addEventListener('input',renderAcademySearch);
$('academySearch').addEventListener('keydown',e=>{
 if(e.key!=='Enter')return;
 e.preventDefault();
 const first=searchAcademyRoutes(academy,$('academySearch').value)[0];
 if(first)pickAcademyRoute(first);
});
$('academyRoute').addEventListener('change',onAcademySelected);
function selectedGTFS(){return tripsInDirection().find(t=>t.trip_id===$('tripSelect').value)}
function fitWebBounds(bounds,options){
 if(nativeMode&&document.body.classList.contains('native-preview'))return;
 map.fitBounds(bounds,options);
}
function syncNativeRoutePreview(){
 if(!nativeMode)return;
 const route=current?.academy?{points:current.points.map(p=>[p.lat,p.lng]),stopCoordinates:current.stops.map(s=>[s.stop.lat,s.stop.lng]),stops:current.stops.map(s=>s.stop.stop_name)}:null;
 nativePost({type:'previewRoute',route});
}
function showAcademyRoute(merge=false){const chosen=selectedOfficial;if(!chosen){toast('Seleziona un GPX Academy');return}const points=chosen.points.map(([lat,lng])=>({lat,lng}));const dists=shapeMetrics(points);let stops=[],offsets=[],diagnostic='GPX pronto. Per annunciare le fermate scegli una sequenza GTFS Busitalia verificata.';let trip={trip_headsign:chosen.name};let reliable=false;
if(chosen._evidence?.serviceStatus==='out-of-service'){if(merge){toast('Indicatore FUORI SERVIZIO: nessuna fermata passeggeri');return}diagnostic='Trasferimento FUORI SERVIZIO, confermato dagli indicatori Academy. Navigazione stradale sul GPX.'}
if(merge){if(!feed){toast('Prima importa il GTFS');return}const academyMatch=academyGtfsMatches.get($('academyGtfsTrip').value);if(academyMatch?.reviewRequired&&!$('confirmStopProposal').checked){toast('Verifica e conferma la proposta di fermate prima di usarla');return}const gt=academyMatch?.trip||selectedGTFS();if(!gt){toast('Seleziona una corsa GTFS corrispondente');return}const gtfsRoute=feed.routesById.get(gt.route_id);const num=normAcademyCode(gtfsRoute?.route_short_name||'');const officialNum=[...academyRouteCodes(chosen)].join(', ');if(gtfsRoute?._stopAuthority==='supplemental'){$('officialInfo').textContent='Le fermate MOM non sono utilizzate. Importa Busitalia come feed principale; le fermate comuni sono già nel suo GTFS.';toast('Fermate MOM escluse');return}if(!academyMatch&&!gtfsFitsAcademyCode(chosen,gtfsRoute||{})){$('officialInfo').textContent=`Abbinamento bloccato: linea GTFS ${num} diversa dal GPX ${officialNum}. Seleziona la corsa corretta.`;toast('Linea GPX e GTFS non corrispondono');return}
const candidates=academyMatch?.stops||(feed.timesByTrip.get(gt.trip_id)||[]).filter(x=>x.stop&&Number.isFinite(x.stop.lat)&&Number.isFinite(x.stop.lng));if(candidates.length<2){toast('Nessuna sequenza di fermate disponibile');return}const match=matchStopsStrict(candidates,points,dists);diagnostic=match.message;if(!match.ok){$('officialInfo').textContent=diagnostic;toast('Abbinamento non affidabile: navigazione fermate non abilitata');return}stops=candidates;offsets=match.offsets;trip={...gt,trip_headsign:academyMatch?.legs?.length>1?chosen.name:gt.trip_headsign};reliable=true}
stopNavigation();current={trip,stops,points,dists,offsets,fallback:false,academy:chosen,reliable,stopProposal:merge?academyGtfsMatches.get($('academyGtfsTrip').value):null};nextStopIdx=0;lastSpokenStop=-1;lastSpokenTurn=-1;lastAlong=0;turns=[];roadGuidanceReady=loadRoadGuidance(chosen,dists);if(lineLayer)map.removeLayer(lineLayer);if(stopLayer)map.removeLayer(stopLayer);lineLayer=L.polyline(points,{color:'#0da2a5',weight:6,opacity:.9}).addTo(map);stopLayer=L.layerGroup();stops.forEach((s,i)=>L.circleMarker([s.stop.lat,s.stop.lng],{radius:6,color:'#fff',weight:2,fillColor:'#2362e7',fillOpacity:1}).bindPopup(`${i+1}. ${escapeHTML(s.stop.stop_name)}`).addTo(stopLayer));stopLayer.addTo(map);fitWebBounds(lineLayer.getBounds(),{padding:[55,55]});$('stopCount').textContent=stops.length?stops.length+' fermate':chosen._evidence?.serviceStatus==='out-of-service'?'Fuori servizio':'Fermate non associate';$('navStatus').textContent='GPX Academy caricato';$('nextName').textContent=stops[0]?.stop.stop_name||'GPX senza fermate';$('nextDetail').textContent=chosen._evidence?.serviceStatus==='out-of-service'?'Trasferimento: seguire il GPX ufficiale':merge?'GPS e simulazione disponibili':'Associa prima una corsa GTFS per gli annunci';$('nextDistance').textContent='—';$('demoBtn').disabled=false;$('startNav').disabled=false;renderStops();$('progressLabel').textContent='0 / '+stops.length+' fermate';$('turnHint').textContent='Verifica istruzioni stradali…';const evidence=chosen._evidence;const indicator=evidence?.indicatorRecords?.[0];const shift=evidence?.shiftMatches?.[0];if(indicator)diagnostic+=' Indicatore '+indicator.display+': '+indicator.fixed+' (pag. '+indicator.page+').';if(shift)diagnostic+=' Riscontro nei turni: '+shift.shift+', '+shift.departure+'–'+shift.arrival+', linea '+shift.line+' (pag. '+shift.page+').';if(evidence?.serviceStatus==='conflicting-indicator')diagnostic+=' Codici indicatore discordanti: verifica la corsa prima di confermare le fermate.';$('officialInfo').textContent=diagnostic;toast(merge?'GPX Academy e fermate GTFS associati':'Tracciato GPX Academy visualizzato');syncNativeRoutePreview();}
function matchStopsStrict(stops,points,dists){return RouteStops.match(stops,points,dists)}
$('showOfficial').addEventListener('click',()=>showAcademyRoute(false));$('mergeOfficial').addEventListener('click',()=>showAcademyRoute(true));

let toastTimeout=null;
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('show'),5500)}
function status(text){$('feedMsg').textContent=text;}
function parseCSV(text){text=text.replace(/^\uFEFF/,'');let rows=[],row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}else if(c==='"')quoted=true;else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}else field+=c}if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}const headers=rows.shift()||[];return rows.filter(r=>r.length>1||r[0]).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])))}
async function getGTFS(zipBlob){if(!window.JSZip)throw Error('Libreria ZIP non disponibile: serve connessione Internet.');const zip=await JSZip.loadAsync(zipBlob);const files={};for(const name of ['routes','trips','stops','stop_times','shapes','calendar','calendar_dates']){const file=Object.values(zip.files).find(f=>f.name.split('/').pop().toLowerCase()===name+'.txt');if(file){status('Lettura '+name+'.txt…');files[name]=parseCSV(await file.async('string'))}else if(!['calendar','calendar_dates','shapes'].includes(name))throw Error('Nel GTFS manca '+name+'.txt')}
const routes=files.routes, trips=files.trips, stops=files.stops, stopTimes=files.stop_times, shapes=files.shapes||[];
const stopsById=new Map(stops.map(s=>[s.stop_id,{...s,lat:+s.stop_lat,lng:+s.stop_lon}]));
const shapesById=new Map();for(const s of shapes){if(!shapesById.has(s.shape_id))shapesById.set(s.shape_id,[]);shapesById.get(s.shape_id).push({lat:+s.shape_pt_lat,lng:+s.shape_pt_lon,seq:+s.shape_pt_sequence,dist:s.shape_dist_traveled?+s.shape_dist_traveled:null})}for(const pts of shapesById.values())pts.sort((a,b)=>a.seq-b.seq);
const timesByTrip=new Map();for(const s of stopTimes){if(!timesByTrip.has(s.trip_id))timesByTrip.set(s.trip_id,[]);timesByTrip.get(s.trip_id).push({stop:stopsById.get(s.stop_id),seq:+s.stop_sequence,arrival:s.arrival_time,departure:s.departure_time,dist:s.shape_dist_traveled?+s.shape_dist_traveled:null})}for(const ss of timesByTrip.values())ss.sort((a,b)=>a.seq-b.seq);
const routesById=new Map(routes.map(r=>[r.route_id,r]));const tripsByRoute=new Map();for(const t of trips){if(!tripsByRoute.has(t.route_id))tripsByRoute.set(t.route_id,[]);tripsByRoute.get(t.route_id).push(t)}
return {routes,routesById,tripsByRoute,timesByTrip,shapesById,stopsById,calendar:files.calendar||[],calendarDates:files.calendar_dates||[],updated:new Date().toISOString()};}
function asOption(value,label){const opt=document.createElement('option');opt.value=value;opt.textContent=label;return opt}
function setOptions(element,options,placeholder){element.replaceChildren();if(placeholder)element.add(asOption('',placeholder));for(const [val,lab] of options)element.add(asOption(val,lab));element.disabled=!options.length;}
// Namespace GTFS identifiers on import: agency files can reuse the same IDs.
let gtfsImportSequence=0;
function appendOfficialFeed(base,additional){
 const prefix='source'+(++gtfsImportSequence)+':';
 const stops=new Map();
 for(const [id,s] of additional.stopsById)stops.set(prefix+id,{...s,stop_id:prefix+id});
 const routes=additional.routes.map(r=>({...r,route_id:prefix+r.route_id,_stopAuthority:'supplemental'}));
 const routesById=new Map([...base.routesById,...routes.map(r=>[r.route_id,r])]);
 const tripsByRoute=new Map(base.tripsByRoute);
 for(const [routeId,trips] of additional.tripsByRoute)tripsByRoute.set(prefix+routeId,trips.map(t=>({...t,trip_id:prefix+t.trip_id,route_id:prefix+t.route_id,shape_id:prefix+(t.shape_id||''),service_id:prefix+(t.service_id||'')})));
 const timesByTrip=new Map(base.timesByTrip);
 for(const [id,entries] of additional.timesByTrip)timesByTrip.set(prefix+id,entries.map(e=>({...e,stop:e.stop?stops.get(prefix+e.stop.stop_id):null})));
 const shapesById=new Map(base.shapesById);
 for(const [id,pts] of additional.shapesById)shapesById.set(prefix+id,pts);
 return {...base,routes:[...base.routes,...routes],routesById,tripsByRoute,timesByTrip,shapesById,stopsById:new Map([...base.stopsById,...stops]),sources:(base.sources||1)+1,updated:new Date().toISOString()};
}
function handleFeed(f,append=false){if(!append||!feed)f={...f,routes:f.routes.map(r=>({...r,_stopAuthority:'busitalia'})),sources:1};feed=append&&feed?appendOfficialFeed(feed,f):f;resetAcademyGtfs();const routes=feed.routes.filter(r=>r._stopAuthority!=='supplemental'&&feed.tripsByRoute.has(r.route_id)).sort((a,b)=>(a.route_short_name||a.route_long_name).localeCompare(b.route_short_name||b.route_long_name,'it',{numeric:true}));setOptions($('routeSelect'),routes.map(r=>[r.route_id,(r.route_short_name||'—')+' · '+(r.route_long_name||'Percorso')]),'Scegli una linea…');$('dataStatus').textContent=routes.length+' linee';status(`Pronto: ${routes.length} linee, ${feed.stopsById.size} fermate, ${feed.sources||1} feed. I GPX Academy restano invariati.`);$('routeSelect').dispatchEvent(new Event('change'));}
function groupTrips(){if(!feed)return[];const trips=feed.tripsByRoute.get($('routeSelect').value)||[];const groups=new Map();for(const t of trips){const label=(t.trip_headsign||'Direzione '+(t.direction_id||'0')).trim();const key=(t.direction_id||'')+'|'+label;if(!groups.has(key))groups.set(key,{label,trips:[]});groups.get(key).trips.push(t)}return [...groups.entries()].map(([key,g])=>[key,g.label+' ('+g.trips.length+' corse)']);}
function tripsInDirection(){const trips=feed?.tripsByRoute.get($('routeSelect').value)||[];return trips.filter(t=>((t.direction_id||'')+'|'+(t.trip_headsign||'Direzione '+(t.direction_id||'0')).trim())===$('directionSelect').value)}
function tripLabel(t){const times=feed.timesByTrip.get(t.trip_id)||[];const a=times[0]?.departure||'—';const b=times.at(-1)?.arrival||'—';const n=times.length;return `${a} → ${b} · ${n} fermate · ${t.service_id||'servizio'}`}
$('routeSelect').addEventListener('change',()=>{if(!current?.academy)stopNavigation();$('mergeOfficial').disabled=!academyGtfsMatches.has($('academyGtfsTrip').value);setOptions($('directionSelect'),groupTrips(),'Scegli direzione…');setOptions($('tripSelect'),[],'—');$('showRoute').disabled=true;$('startNav').disabled=!current?.academy;if(!current?.academy)clearRoute()});
$('directionSelect').addEventListener('change',()=>{$('mergeOfficial').disabled=!academyGtfsMatches.has($('academyGtfsTrip').value);const trips=tripsInDirection().filter(t=>(feed.timesByTrip.get(t.trip_id)||[]).length>1);trips.sort((a,b)=>(feed.timesByTrip.get(a.trip_id)?.[0]?.departure||'').localeCompare(feed.timesByTrip.get(b.trip_id)?.[0]?.departure||''));setOptions($('tripSelect'),trips.map(t=>[t.trip_id,tripLabel(t)]),'Scegli corsa…');$('showRoute').disabled=true;$('startNav').disabled=!current?.academy;if(!current?.academy)clearRoute()});
$('tripSelect').addEventListener('change',()=>{const ok=!!$('tripSelect').value;$('mergeOfficial').disabled=!academyGtfsMatches.has($('academyGtfsTrip').value)&&(!ok||!selectedOfficial);$('showRoute').disabled=!ok;if(current?.academy){$('startNav').disabled=false;return} $('startNav').disabled=!ok;if(ok)selectTrip();else if(!current?.academy)clearRoute()});
function clearRoute(){current=null;syncNativeRoutePreview();if(lineLayer)map.removeLayer(lineLayer);if(stopLayer)map.removeLayer(stopLayer);lineLayer=stopLayer=null;$('stopList').innerHTML='<p class="empty">Seleziona una corsa per vedere le fermate.</p>';$('stopCount').textContent='—';$('nextName').textContent='—';$('nextDetail').textContent='Carica una linea per iniziare';$('nextDistance').textContent='—';$('navStatus').textContent='Seleziona una corsa';$('progressBar').style.width='0%';$('progressLabel').textContent='0 / 0 fermate';$('turnHint').textContent='Percorso non attivo'}
const rad=Math.PI/180;function metres(a,b){let dlat=(b.lat-a.lat)*rad,dlng=(b.lng-a.lng)*rad,s=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;return 12742000*Math.atan2(Math.sqrt(s),Math.sqrt(1-s))}
function project(p,a,b){const x=(b.lng-a.lng)*111320*Math.cos((p.lat+a.lat)/2*rad),y=(b.lat-a.lat)*111320;const px=(p.lng-a.lng)*111320*Math.cos((p.lat+a.lat)/2*rad),py=(p.lat-a.lat)*111320;let t=(x*x+y*y)?Math.max(0,Math.min(1,(px*x+py*y)/(x*x+y*y))):0;return {t,d:Math.hypot(px-x*t,py-y*t)}}
function shapeMetrics(points){const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+metres(points[i-1],points[i]));return cumulative}
function nearestOnShape(p,pts,dist,start=0,end=pts.length-1){let best={d:Infinity,along:0,idx:0};for(let i=start;i<Math.min(end,pts.length-1);i++){let v=project(p,pts[i],pts[i+1]);if(v.d<best.d){best={d:v.d,along:dist[i]+v.t*(dist[i+1]-dist[i]),idx:i}}}return best}
function stopOffsets(stops,pts,dist){let last=0;return stops.map(s=>{if(!s.stop)return last;const hit=nearestOnShape(s.stop,pts,dist); // permits routes that revisit same point: ordered forward candidate preferred
let best=hit;if(hit.along<last-80){const forward=nearestOnShape(s.stop,pts,dist,Math.max(0,dist.findIndex(d=>d>=last)-1));if(forward.d<150)best=forward}last=Math.max(last,best.along);return last})}
function bearing(a,b){const lat1=a.lat*rad,lat2=b.lat*rad,lon=(b.lng-a.lng)*rad;let y=Math.sin(lon)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon);return Math.atan2(y,x)*180/Math.PI}
function deltaHeading(a,b){return ((b-a+540)%360)-180}
function pointAt(pts,dists,at){
 if(!pts.length)return null;
 if(pts.length===1||!Number.isFinite(at)||at<=0)return pts[0];
 const total=dists.at(-1)||0;
 if(at>=total)return pts.at(-1);
 const idx=dists.findIndex(x=>x>=at);
 if(idx<=0)return pts[0];const t=(at-dists[idx-1])/(dists[idx]-dists[idx-1]||1);return {lat:pts[idx-1].lat+(pts[idx].lat-pts[idx-1].lat)*t,lng:pts[idx-1].lng+(pts[idx].lng-pts[idx-1].lng)*t}}
function computeTurns(pts,dists){const list=[];const total=dists.at(-1)||0;for(let d=100;d<total-100;d+=30){const a=pointAt(pts,dists,d-75),b=pointAt(pts,dists,d),c=pointAt(pts,dists,d+75);const deg=deltaHeading(bearing(a,b),bearing(b,c));if(Math.abs(deg)>47&&(!list.length||d-list.at(-1).at>170))list.push({at:d,side:deg>0?'destra':'sinistra',deg})}return list}
function selectTrip(){stopNavigation();const trip=tripsInDirection().find(t=>t.trip_id===$('tripSelect').value);if(!trip)return;const stops=(feed.timesByTrip.get(trip.trip_id)||[]).filter(x=>x.stop&&Number.isFinite(x.stop.lat)&&Number.isFinite(x.stop.lng));let points=feed.shapesById.get(trip.shape_id)||[];let fallback=false;if(points.length<2){points=stops.map(s=>({lat:s.stop.lat,lng:s.stop.lng}));fallback=true}if(points.length<2){toast('La corsa non ha una geometria valida');return}const dists=shapeMetrics(points),offsets=stopOffsets(stops,points,dists);current={trip,stops,points,dists,offsets,fallback};nextStopIdx=0;lastSpokenStop=-1;lastSpokenTurn=-1;lastProgress=0;lastAlong=0;turns=fallback?[]:computeTurns(points,dists);if(lineLayer)map.removeLayer(lineLayer);if(stopLayer)map.removeLayer(stopLayer);lineLayer=L.polyline(points,{color:'#2869ed',weight:6,opacity:.9}).addTo(map);stopLayer=L.layerGroup();stops.forEach((s,i)=>L.circleMarker([s.stop.lat,s.stop.lng],{radius:6,color:'#fff',weight:2,fillColor:'#2362e7',fillOpacity:1}).bindPopup(`${i+1}. ${escapeHTML(s.stop.stop_name)}`).addTo(stopLayer));stopLayer.addTo(map);fitWebBounds(lineLayer.getBounds(),{padding:[55,55]});$('stopCount').textContent=stops.length+' fermate';$('navStatus').textContent='Percorso caricato';$('nextName').textContent=stops[0]?.stop.stop_name||'—';$('nextDetail').textContent='Avvia il GPS o la simulazione';$('nextDistance').textContent='—';$('demoBtn').disabled=false;renderStops();$('progressLabel').textContent='0 / '+stops.length+' fermate';$('turnHint').textContent=fallback?'Shape assente · svolte disabilitate':'Svolte indicative dalla shape';if(fallback)toast('ATTENZIONE: tracciato mancante; collegamento semplificato tra fermate, non valido per la guida');}
function escapeHTML(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function renderStops(){if(!current)return;if(!current.stops.length){$('stopList').innerHTML='<p class="empty">GPX Academy: importa e associa una corsa GTFS per vedere le fermate.</p>';return}const frag=document.createDocumentFragment();current.stops.forEach((s,i)=>{const el=document.createElement('div');el.className='stop-row '+(i<nextStopIdx?'done':i===nextStopIdx?'current':'');el.innerHTML=`<div class="stop-num">${i+1}</div><div><strong>${escapeHTML(s.stop.stop_name)}</strong><small>${escapeHTML(s.arrival||'')} · ${escapeHTML(s.stop.stop_id)}</small></div>`;frag.append(el)});$('stopList').replaceChildren(frag);
 // Keep the current stop easy to find without changing the map camera.
 if(nextStopIdx<current.stops.length&&$('stopList').scrollHeight>$('stopList').clientHeight){
  const active=$('stopList').querySelector('.stop-row.current');
  if(active&&active.offsetTop>$('stopList').scrollTop+$('stopList').clientHeight-85)
   $('stopList').scrollTop=Math.max(0,active.offsetTop-90);
 }
}
// GPS-like spoken guidance. All distances are measured along the Academy GPX.
// Cues are queued instead of being dropped or cutting each other off: the stop or
// manoeuvre that comes first along the GPX is read first and the next one follows
// ("Poi, ..."). A stuck synthesizer is detected by a watchdog and the queue carries on.
let voiceQueue=[],voiceBusy=false,voiceGeneration=0,voiceUnlocked=false,activeVoicePriority=null,firstVoiceFix=true;
let spokenStopStages=new Map(),spokenTurnStages=new Map(),lastVoiceTime=0,lastPositionSample=null,filteredSpeed=0;
let voiceStarted=false,voiceSerial=0,activeVoiceKey=null,activeUtterance=null,voiceWatchdog=null,voiceDrainTimer=null;
let voiceFailures=0,voiceAlong=null,voicePositionOk=false,voiceLastEnd=0,voiceLastCancel=0,spokenRoadCameras=new Set();
const VOICE_MAX_PENDING=4,VOICE_MAX_AGE=25000,VOICE_CHAIN_WINDOW=2500;
function resetVoiceGuidance(){
 voiceGeneration++;voiceQueue=[];voiceBusy=false;spokenStopStages.clear();spokenTurnStages.clear();voiceStarted=false;
 lastVoiceTime=0;lastPositionSample=null;filteredSpeed=0;activeVoicePriority=null;firstVoiceFix=true;
 activeVoiceKey=null;activeUtterance=null;voiceFailures=0;voiceAlong=null;voicePositionOk=false;spokenRoadCameras=new Set();
 clearTimeout(voiceWatchdog);voiceWatchdog=null;clearTimeout(voiceDrainTimer);voiceDrainTimer=null;
 if(window.LineaPilotAndroid)try{window.LineaPilotAndroid.stopSpeech()}catch(e){console.warn(e)}
 if('speechSynthesis'in window)try{
  // Only wait before the next utterance if something was really playing: a cue
  // started from a tap must stay inside the user gesture for iOS Safari.
  if(speechSynthesis.speaking||speechSynthesis.pending)voiceLastCancel=Date.now();
  speechSynthesis.cancel();
 }catch(e){console.warn(e)}
}
function setVoiceStatus(message,problem=false){
 driveVoiceText=message;driveVoiceProblem=problem;renderDriveStatus();
}
function refreshStopVoiceAvailability(){
 const available=(current?.stops?.length||0)>0;
 $('voiceAvailability').textContent=available
  ? 'Fermate Busitalia associate: '+current.stops.length+'. Gli avvisi saranno anticipati lungo il GPX Academy.'
  : 'Nessuna fermata associata: il GPS funziona, ma non può annunciare le fermate. Associa prima una corsa GTFS Busitalia al GPX Academy.';
}
function setupVoice(){
 if(!('speechSynthesis'in window)&&!window.LineaPilotAndroid){setVoiceStatus('Voce non supportata',true);return false}
 voiceUnlocked=true;
 try{if(speechSynthesis.paused)speechSynthesis.resume()}catch(e){console.warn(e)}
 return true;
}
function voiceSpeaksFirst(a,b){
 const at=a.target??-Infinity,bt=b.target??-Infinity;
 return at!==bt?(at<bt?-1:1):a.seq-b.seq;
}
function chainVoiceText(text){
 const second=text.charAt(1);
 const lower=second&&second===second.toLowerCase()&&second!==second.toUpperCase();
 return 'Poi, '+(lower?text.charAt(0).toLowerCase():text.charAt(0))+text.slice(1);
}
// Removes and returns the next cue still worth saying. Cues tied to a position wait
// while GPS is unreliable and are discarded once passed or after waiting too long.
function takeNextVoice(now=Date.now()){
 voiceQueue=voiceQueue.filter(x=>now-x.at<=VOICE_MAX_AGE&&
  (x.target===null||!voicePositionOk||voiceAlong===null||voiceAlong<=x.target+5));
 for(let i=0;i<voiceQueue.length;i++){
  const item=voiceQueue[i];
  if(item.target!==null&&!voicePositionOk)continue;
  voiceQueue.splice(i--,1);
  const left=item.target===null||voiceAlong===null?null:item.target-voiceAlong;
  let text='';
  try{text=String(item.build(left)??'').trim()}catch(e){console.warn('Annuncio:',e)}
  if(!text)continue;
  if(item.behind&&now-voiceLastEnd<VOICE_CHAIN_WINDOW)text=chainVoiceText(text);
  return {...item,text};
 }
 return null;
}
function enqueueVoice(message,priority='normal',options={}){
 if(nativeActive)return false; // Swift owns stop/turn audio during native GPS sessions
 if(!$('voiceToggle').checked||!setupVoice())return false;
 const key=options.key||null,target=Number.isFinite(options.target)?options.target:null;
 // Already being read: do not repeat the same stop or manoeuvre.
 if(key&&voiceBusy&&activeVoiceKey===key)return true;
 const build=typeof options.build==='function'?options.build:()=>message;
 let item=key?voiceQueue.find(x=>x.key===key):null;
 if(item){item.message=message;item.build=build;item.priority=priority;item.at=Date.now();item.behind=item.behind||voiceBusy}
 else{
  item={message,build,priority,key,target,at:Date.now(),seq:++voiceSerial,behind:voiceBusy};
  // Cues already passed or expired never take the place of a new one.
  const now=Date.now();
  voiceQueue=voiceQueue.filter(x=>now-x.at<=VOICE_MAX_AGE&&(x.target===null||!voicePositionOk||voiceAlong===null||voiceAlong<=x.target+5));
  voiceQueue.push(item);
  voiceQueue.sort(voiceSpeaksFirst);
  if(voiceQueue.length>VOICE_MAX_PENDING)voiceQueue.length=VOICE_MAX_PENDING;
  if(!voiceQueue.includes(item))return false;
 }
 drainVoice();return true;
}
function drainVoice(){
 if(voiceBusy||!voiceQueue.length||(!('speechSynthesis'in window)&&!window.LineaPilotAndroid))return;
 // Speaking right after cancel() is often swallowed by Safari: leave a short gap.
 const wait=voiceLastCancel+250-Date.now();
 if(wait>0){clearTimeout(voiceDrainTimer);voiceDrainTimer=setTimeout(drainVoice,wait);return}
 if(!window.LineaPilotAndroid&&Date.now()-voiceLastCancel>1000){
  // We are idle: anything still marked as speaking is a stuck utterance.
  try{if(speechSynthesis.speaking||speechSynthesis.pending){speechSynthesis.cancel();voiceLastCancel=Date.now();clearTimeout(voiceDrainTimer);voiceDrainTimer=setTimeout(drainVoice,250);return}}catch(e){console.warn(e)}
 }
 const item=takeNextVoice();
 if(!item)return;
 const generation=voiceGeneration;
 let finished=false,started=false;
 voiceBusy=true;activeVoicePriority=item.priority;activeVoiceKey=item.key;
 setVoiceStatus('Annuncio in preparazione…');
 const finish=(ok,reason)=>{
  if(finished||generation!==voiceGeneration)return;
  finished=true;clearTimeout(voiceWatchdog);voiceWatchdog=null;
  voiceBusy=false;activeVoicePriority=null;activeVoiceKey=null;activeUtterance=null;
  if(ok)voiceLastEnd=Date.now(); // "Poi, ..." only after a cue that was really heard
  if(ok){voiceFailures=0;setVoiceStatus('Voce attiva')}
  else{
   voiceFailures++;console.warn('Voce:',reason);
   // A failed cue no longer empties the queue: the next one is tried anyway.
   setVoiceStatus(voiceFailures>=3?'Audio non riprodotto':'Annuncio non riprodotto · passo al successivo',true);
  }
  drainVoice();
 };
 const expected=item.text.length*110/Math.max(.5,voicePreferences.rate||1)+5000;
 const watch=(ms,onTimeout)=>{clearTimeout(voiceWatchdog);voiceWatchdog=setTimeout(()=>{if(!finished&&generation===voiceGeneration)onTimeout()},ms)};
 if(window.LineaPilotAndroid){
  const token=String(++voiceSerial); // the Android bridge only accepts digits
  window.lineaPilotAndroidSpeechDone=(callbackToken,ok)=>{if(callbackToken===token)finish(!!ok,'Android TTS')};
  try{
   window.LineaPilotAndroid.speak(item.text,voicePreferences.id,voicePreferences.rate,token);
   voiceStarted=true;
   // A lost completion callback must not keep the queue blocked.
   watch(expected,()=>{try{window.LineaPilotAndroid.stopSpeech()}catch(e){}finish(true,'fine annuncio non segnalata')});
  }catch(e){console.warn('TTS Android',e);finish(false,'Voce Android non disponibile')}
  return;
 }
 try{
  const speech=new SpeechSynthesisUtterance(item.text);
  activeUtterance=speech; // keep a reference: garbage-collected utterances never fire onend
  speech.lang='it-IT';speech.rate=voicePreferences.rate;speech.pitch=1;
  const voices=speechSynthesis.getVoices();
  // Chosen voice, otherwise the best Italian voice installed (Premium > Avanzata > base).
  const italian=voices.find(v=>v.voiceURI===voicePreferences.id&&v.lang.toLowerCase().startsWith('it'))||
   voices.filter(v=>v.lang.toLowerCase().startsWith('it')&&safariVoiceQuality(v)>0)
    .sort((a,b)=>safariVoiceQuality(b)-safariVoiceQuality(a)||Number(b.lang.toLowerCase()==='it-it')-Number(a.lang.toLowerCase()==='it-it'))[0];
  if(italian)speech.voice=italian;
  const abandon=(ok,reason)=>{
   // Our own cancel() fires onerror synchronously in some browsers: ignore it.
   const was=finished;finished=true;
   try{speechSynthesis.cancel()}catch(e){}
   voiceLastCancel=Date.now();finished=was;finish(ok,reason);
  };
  speech.onstart=()=>{
   if(finished||generation!==voiceGeneration)return;
   started=true;voiceStarted=true;
   setVoiceStatus(item.priority==='stop'?'Annuncio fermata…':item.priority==='turn'?'Avviso svolta…':'Voce attiva');
   // Some browsers never fire onend: release the queue after a generous delay.
   watch(expected,()=>abandon(true,'fine annuncio non segnalata'));
  };
  setAudioSessionType('playback');
  speech.onend=()=>finish(true);
  speech.onerror=e=>finish(false,e?.error||'errore audio');
  speechSynthesis.speak(speech);
  // On some iOS Safari sessions the utterance never starts: skip it, keep the queue alive.
  watch(5000,()=>{if(!started)abandon(false,'avvio non riuscito')});
 }catch(e){console.warn('Sintesi vocale:',e);finish(false,'Audio non disponibile')}
}
function speak(message,priority='normal',options={}){return enqueueVoice(message,priority,options)}
function activateNavigationVoice(){
 if(nativeActive){nativePost({type:'testVoice'});return}
 if(!$('voiceToggle').checked){setVoiceStatus('Attiva annunci vocali nelle impostazioni',true);return}
 resetVoiceGuidance();
 if(!setupVoice())return;
 const count=current?.stops?.length||0;
 const msg=count?'Guida vocale attiva. Prossime fermate abilitate.':'Guida vocale attiva. Per gli annunci delle fermate associa il G T F S Busitalia.';
 enqueueVoice(msg,'normal');
}
// One rounding rule for screen and voice, identical to DistanceText on iOS/Android:
// from 100 m in steps of 50 m, from 50 to 100 m in steps of 10 m, below 50 m in
// steps of 5 m; from 1 km in tenths of a km.
function roundedDistance(m){m=Number.isFinite(m)?Math.max(0,m):0;const step=m>=100?50:m>=50?10:5;return Math.round(m/step)*step}
function kilometreText(m){const tenths=Math.round(Math.max(0,m)/100);return tenths%10===0?String(tenths/10):Math.floor(tenths/10)+','+tenths%10}
function niceDistance(m){const value=roundedDistance(m);return value<1000?value+' m':kilometreText(m)+' km'}
function speechDistance(m){const value=roundedDistance(m);if(value<1000)return value+' metri';const km=kilometreText(m);return km+(km==='1'?' chilometro':' chilometri')}
function speedEstimate(p,reportedSpeed,isDemo){
 if(isDemo)return 13.9; // simulated 50 km/h for meaningful advance-alert tests
 const now=Date.now();
 let value=Number.isFinite(reportedSpeed)&&reportedSpeed>=0?reportedSpeed:null;
 if(value===null&&lastPositionSample){
  const elapsed=(now-lastPositionSample.at)/1000;
  if(elapsed>=1&&elapsed<=20){const move=metres(p,lastPositionSample.p)/elapsed;if(move<38)value=move}
 }
 lastPositionSample={p,at:now};
 if(value!==null)filteredSpeed=filteredSpeed?filteredSpeed*.65+value*.35:value;
 return Math.max(0,filteredSpeed);
}
function stopAlertDistance(mps){
 // 18-25 seconds of notice, bounded for urban and extra-urban speeds.
 return Math.max(140,Math.min(400,Math.round((Math.max(mps,6)*22)/10)*10));
}
function planStopVoice(stopIndex,remaining,mps,offRoute,isDemo){
 if(offRoute||!$('voiceToggle').checked||stopIndex<0||remaining<0)return;
 const stop=current?.stops[stopIndex]?.stop;
 if(!stop)return;
 const threshold=stopAlertDistance(mps);
 let stage=spokenStopStages.get(stopIndex)||0;
 // Only trigger the first announcement once within the early warning window.
 if(stage===0&&remaining<=threshold){
  const name=stop.stop_name;
  if(enqueueVoice('Tra '+speechDistance(remaining)+', prossima fermata: '+name+'.','stop',{key:'stop:'+stopIndex,target:current?.offsets?.[stopIndex],
     build:left=>left!==null&&left<40?'Fermata in arrivo: '+name+'.':'Tra '+speechDistance(left??remaining)+', prossima fermata: '+name+'.'})){
   spokenStopStages.set(stopIndex,1);lastSpokenStop=stopIndex;
  }
  stage=spokenStopStages.get(stopIndex)||0;
 }
 // Optional final cue at short range; never at the same update as the first cue.
 if(stage===1&&remaining<=65&&remaining>=8&&lastSpokenStop===stopIndex&&
    (mps>2||isDemo)){
  // Queued behind any cue being read; replaces the early notice if that is still waiting.
  if(enqueueVoice('Fermata in arrivo: '+stop.stop_name+'.','stop',{key:'stop:'+stopIndex,target:current?.offsets?.[stopIndex]}))spokenStopStages.set(stopIndex,2);
 }
}
function turnAlertDistance(speed){
 // Speed-aware GPX geometry notices: give approximately 18 seconds of lead time.
 return Math.max(150,Math.min(350,Math.round((Math.max(6,speed)*18)/10)*10));
}
function planTurnVoice(turn,turnIndex,remaining,speed,distanceFromGPX,stopRemaining=Infinity){
 if(!turn?.verifiedRoad)return;
 if(!$('turnToggle').checked||!$('voiceToggle').checked||
    distanceFromGPX>85||remaining<15||!turn)return;
 // These are indicative geometry changes, not confirmed road manoeuvres.
 if(Number.isFinite(stopRemaining)&&stopRemaining>=0&&stopRemaining<170)return;
 const lead=turnAlertDistance(speed),stage=spokenTurnStages.get(turnIndex)||0;
 // Lower-case after "Tra circa 250 metri, …" like the iOS/Android voice ("alla rotonda").
 const text=String(turn.text||'').replace(/[.!?\s]+$/,''),label=text.charAt(0).toLocaleLowerCase('it')+text.slice(1);
 if(stage===0&&remaining<=lead){
  if(speak('Tra circa '+speechDistance(remaining)+', '+label+'.','turn',{key:'turn:'+turnIndex,target:turn.at,
     build:left=>left!==null&&left<=85?'Tra poco, '+label+'.':'Tra circa '+speechDistance(left??remaining)+', '+label+'.'})){
   spokenTurnStages.set(turnIndex,1);lastSpokenTurn=turnIndex;
  }
 }else if(stage===1&&remaining<=85){
  if(speak('Tra poco, '+label+'.','turn',{key:'turn:'+turnIndex,target:turn.at}))spokenTurnStages.set(turnIndex,2);
 }
}
// Speed limits and fixed enforcement: same rules as NativeRoute (iOS/Android).
// A limit is shown only with a precise fix (±15 m, ≤8 m from the GPX) and when
// one single value covers the whole uncertainty window inside validated guidance.
function guidanceCovers(from,to){
 const coverage=current?.guidanceCoverage;
 if(!coverage)return true;
 return (coverage.ranges||[]).some(r=>r[0]<=from&&from<=r[1]&&r[0]<=to&&to<=r[1]);
}
function webSpeedLimit(along,accuracy,deviation){
 if(!Number.isFinite(along)||!(accuracy>=0&&accuracy<=15)||!(deviation>=0&&deviation<=8))return null;
 const radius=Math.max(8,accuracy+deviation),lower=along-radius,upper=along+radius;
 if(!guidanceCovers(lower,upper))return null;
 const rows=(current?.speedLimits||[]).filter(r=>r[0]<=upper&&r[1]>lower).sort((a,b)=>a[0]-b[0]);
 if(!rows.length)return null;
 const limit=rows[0][2];let through=lower;
 for(const r of rows){if(r[2]!==limit||r[0]>through)return null;through=Math.max(through,r[1])}
 return through>upper?limit:null;
}
function nextWebCamera(along,within,used=new Set()){
 let best=-1;
 (current?.roadCameras||[]).forEach((c,i)=>{
  if(used.has(i)||c.at<=along||c.at>along+within||!guidanceCovers(along,c.at))return;
  if(best<0||c.at<current.roadCameras[best].at)best=i;
 });
 return best;
}
const cameraTitle=c=>c.kind==='redLight'?'Controllo semaforico':'Autovelox fisso';
function hideRoadSafety(){
 const sign=$('speedLimitSign'),alert=$('roadAlert');
 if(sign){sign.hidden=true;sign.textContent='';sign.removeAttribute('aria-label')}
 if(alert)alert.hidden=true;
}
function updateRoadSafety(along,accuracy,deviation,speed){
 const limit=webSpeedLimit(along,accuracy,deviation),sign=$('speedLimitSign');
 sign.hidden=limit===null;sign.textContent=limit??'';
 if(limit===null)sign.removeAttribute('aria-label');else sign.setAttribute('aria-label','Limite di velocità '+limit+' chilometri orari');
 const shown=deviation<45?nextWebCamera(along,350):-1,alert=$('roadAlert');
 alert.hidden=shown<0;
 if(shown>=0){const c=current.roadCameras[shown];alert.textContent=cameraTitle(c)+' · '+niceDistance(c.at-along)}
 if(deviation>=45)return;
 const index=nextWebCamera(along,Math.max(120,Math.min(250,speed*12)),spokenRoadCameras);
 if(index<0)return;
 const camera=current.roadCameras[index],title=cameraTitle(camera).toLowerCase();
 if(camera.at-along<15)return;
 if(enqueueVoice('Tra circa '+speechDistance(camera.at-along)+', '+title+'.','normal',
   {key:'camera:'+index,target:camera.at,build:left=>left===null||left<15?null:'Tra circa '+speechDistance(left)+', '+title+'.'}))
  spokenRoadCameras.add(index);
}
function updatePosition(p,accuracy=0,reportedSpeed=null,isDemo=false,reportedHeading=null){
 if(!current)return;
 const {points,dists,offsets,stops}=current;
 if(!isDemo&&accuracy>110){voicePositionOk=false;hideRoadSafety();setDriveTurn('Annunci sospesi','Verifica posizione GPS','warning');$('gpsStatus').textContent='GPS poco preciso ±'+Math.round(accuracy)+' m';return}
 lastFix=p;
 if(!isDemo){realGpsFix={lat:p.lat,lng:p.lng};realGpsFixAt=Date.now();}
 const speed=speedEstimate(p,reportedSpeed,isDemo);
 // Keep the center on the GPS position even when the vehicle is off the Academy line.
 // Poor fixes are rejected above; the heading still comes from the GPX.
 followStableCamera(p,isDemo);
 let near=stableRouteMatch(p,points,dists,speed,isDemo);
 if(near.offRoute||near.d>180){
  voicePositionOk=false;hideRoadSafety();setDriveTurn('Annunci sospesi','Fuori dal percorso ufficiale','warning');
  $('gpsStatus').textContent='GPS fuori dal GPX · '+Math.round(near.d)+' m';
  $('navStatus').textContent='Posizione distante dal percorso Academy';
  $('turnHint').textContent='Avvisi sospesi finché la posizione non torna affidabile';
  return;
 }
 if(near.recovering||near.waiting){
  voicePositionOk=false;hideRoadSafety();setDriveTurn('Annunci sospesi',near.d>85?'Fuori dal percorso ufficiale':'Verifica posizione GPS','warning');
  $('gpsStatus').textContent='GPS · riallineamento al GPX';
  $('navStatus').textContent='Verifica avanzamento sul percorso';
  $('turnHint').textContent='Ricalcolo posizione: avvisi in attesa';
  return;
 }
 // Prevent map and stop list from moving backwards due to GPS jitter.
 if(near.along<lastAlong-30)near={...near,along:lastAlong};
 const along=near.along;
 // A capolinea is often also GTFS stop #1: on departure, the next alert is stop #2.
 if(firstVoiceFix){
  firstVoiceFix=false;
  if(stops.length>1&&offsets[0]<=50&&Math.abs(along-offsets[0])<30)nextStopIdx=1;
 }
 lastAlong=Math.max(lastAlong,along-30);
 // Queued cues use this position to recompute their distance when they are read.
 voiceAlong=along;voicePositionOk=near.d<100;
 updateNavigationHeading(points,dists,along);
 $('gpsStatus').textContent=isDemo?'Simulazione':accuracy?'GPS ±'+Math.round(accuracy)+' m':'GPS attivo';
 $('navStatus').textContent=current.trip.trip_headsign||'Corsa in corso';
 // This value must move forward only once the stop is actually passed.
 const previousStopIdx=nextStopIdx;
 while(nextStopIdx<stops.length&&along>offsets[nextStopIdx]+35)nextStopIdx++;
 // Avoid rebuilding every stop DOM node on every GPS update.
 if(nextStopIdx!==previousStopIdx)renderStops();
 const done=stops.length>0&&nextStopIdx>=stops.length;
 const remaining=done?0:Math.max(0,offsets[nextStopIdx]-along);
 $('nextName').textContent=!stops.length?'Nessuna fermata associata':done?'Capolinea raggiunto':stops[nextStopIdx].stop.stop_name;
 $('nextDetail').textContent=!stops.length?'Solo geometria GPX':done?'Fine della corsa':'Fermata '+(nextStopIdx+1)+' di '+stops.length;
 $('nextDistance').textContent=!stops.length?'—':done?'✓':niceDistance(remaining);
 $('progressBar').style.width=Math.min(100,Math.max(0,along/(dists.at(-1)||1)*100))+'%';
 $('progressLabel').textContent=nextStopIdx+' / '+stops.length+' fermate';
 const toEnd=Math.max(0,(dists.at(-1)||0)-along);
 if(stops.length&&!done)setDriveStop(stops[nextStopIdx].stop.stop_name,niceDistance(remaining)+' · fermata '+(nextStopIdx+1)+' di '+stops.length);
 else setDriveStop(stops.length?'Capolinea raggiunto':'Solo percorso GPX',niceDistance(toEnd)+' al termine');
 if(stops.length&&!done&&near.d<100){
  planStopVoice(nextStopIdx,remaining,speed,false,isDemo);
 }
 const covered=current.guidanceCoverage?.ranges?.find(r=>along>=r[0]&&along<=r[1]);
 const turnIndex=turns.findIndex(t=>t.at>along+15&&t.at<along+650&&(!current.guidanceCoverage||covered&&t.at<=covered[1]));
 if(turnIndex>=0){
  const turn=turns[turnIndex],d=turn.at-along;
  $('turnHint').textContent=turn.verifiedRoad?
   turn.text+' tra '+niceDistance(d)+' · GPX Academy':
   'Possibile svolta a '+turn.side+' tra '+niceDistance(d)+' (GPX indicativo)';
  planTurnVoice(turn,turnIndex,d,speed,near.d,stops.length&&!done?remaining:Infinity);
 }else $('turnHint').textContent=done?'Corsa completata':current.guidanceCoverage&&!covered?'Manovre non disponibili in questo tratto · segui il GPX':'Segui il tracciato GPX';
 // Driving panel: next verified manoeuvre inside validated guidance, as in the iOS app.
 const driveTurn=turns.find(t=>t.verifiedRoad&&t.at>along&&(!current.guidanceCoverage||covered&&t.at<=covered[1]));
 if(driveTurn)setDriveTurn(niceDistance(driveTurn.at-along),driveTurn.text,driveTurn.kind==='roundabout'?'roundabout':driveTurn.side==='sinistra'?'left':'right');
 else if(!current.guidanceCoverage||covered)setDriveTurn(niceDistance(toEnd),'Segui il GPX ufficiale','up');
 else setDriveTurn('Tratto non coperto','Manovre non disponibili qui: segui il GPX ufficiale','up');
 updateRoadSafety(along,isDemo?0:accuracy,near.d,speed);
 // Cues held during a GPS dropout resume as soon as the position is reliable again.
 drainVoice();
 // Map already follows the actual GPS fix, not the snapped GPX coordinate.
 if(!locationMarker)locationMarker=L.circleMarker([p.lat,p.lng],{radius:9,color:'#fff',weight:3,fillColor:'#0c55eb',fillOpacity:1}).addTo(map);
 else locationMarker.setLatLng([p.lat,p.lng]);
 if(navigationFullscreen)locationMarker.setStyle({opacity:0,fillOpacity:0});
 if(accuracy&&!isDemo&&!navigationFullscreen){
  if(!accuracyCircle)accuracyCircle=L.circle([p.lat,p.lng],{radius:accuracy,weight:1,color:'#4288ff',fillOpacity:.08}).addTo(map);
  else accuracyCircle.setLatLng([p.lat,p.lng]).setRadius(accuracy)
 }
}
function stopNavigation(){
 if(nativeActive){nativePost({type:'stop'});nativeActive=false}
 hideRoadSafety();
 // Immediately stop browser position updates and speech on manual exit.
 if(watcher!==null){navigator.geolocation.clearWatch(watcher);watcher=null}
 if(simulation){clearInterval(simulation);simulation=null}
 resetVoiceGuidance();leaveNavigationView();
 $('stopNav').disabled=true;$('startNav').disabled=!current;$('demoBtn').disabled=!current;
 $('gpsStatus').textContent='GPS inattivo';
}
async function startGPS(simulated=false){
 const demo=simulated===true;
 if(!current?.academy){toast('Seleziona un GPX ufficiale');return}
 primeSpeech(); // still inside the tap: Safari needs it before the await below
 const selection=current;
 $('startNav').disabled=true;
 await Promise.all([roadGuidanceReady,Promise.race([loadTicketData(),new Promise(r=>setTimeout(r,1500))])]);
 if(current!==selection)return;
 if(!turns.some(t=>t.verifiedRoad))toast('Istruzioni stradali non disponibili: segui il GPX sulla mappa');
 stopNavigation();
 if(nativeMode){
  // Native GPS and voice keep running independently of the WKWebView lifecycle.
  const route={
   name:current.academy.name,
   coverage:current.guidanceCoverage||{complete:false,percent:0,ranges:[]},
   speedLimits:current.speedLimits||[],
   roadCameras:current.roadCameras||[],
   stopCoordinates:current.stops.map(s=>[s.stop.lat,s.stop.lng]),
   points:current.points.map(p=>[p.lat,p.lng]),
   offsets:current.offsets,
   stops:current.stops.map(s=>s.stop?.stop_name||''),
   turns:turns.filter(t=>t.verifiedRoad).map(t=>({at:t.at,side:t.side,kind:t.kind||'turn',text:t.verifiedRoad?t.text:null,verifiedRoad:!!t.verifiedRoad})),
   tickets:nativeTicketPayload(),
   ticketRoute:{category:current.academy.category||'',line:String(current.academy.line||'').trim(),name:current.academy.name||'',aliases:Tickets.evidenceLines(current.academy)}
  };
  if(route.points.length<2){toast('Percorso non valido');return}
  setupVoice();lastAlong=0;lastSpokenStop=-1;lastSpokenTurn=-1;nextStopIdx=0;renderStops();
  enterNavigationView();
  nativeActive=true;
  const ok=nativePost({type:'start',route,demo,voice:$('voiceToggle').checked,turnVoice:$('turnToggle').checked,voiceId:voicePreferences.id,rate:voicePreferences.rate});
  if(!ok){nativeActive=false;leaveNavigationView();toast('Impossibile avviare il GPS nativo');return}
  $('gpsStatus').textContent='GPS nativo in avvio…';
  setVoiceStatus(demo?'SIMULAZIONE · posizione virtuale':'Voce italiana nativa · mantieni l’app in primo piano');
  $('stopNav').disabled=false;$('startNav').disabled=true;$('demoBtn').disabled=true;
  return;
 }
 setupVoice();
 if(!('geolocation'in navigator)){toast('GPS non disponibile nel browser');return}
 if(!window.isSecureContext){toast('Per il GPS occorre HTTPS oppure localhost');return}
 lastAlong=0;lastSpokenStop=-1;lastSpokenTurn=-1;nextStopIdx=0;renderStops();
 enterNavigationView();activateNavigationVoice();$('gpsStatus').textContent='Ricerca GPS…';
 watcher=navigator.geolocation.watchPosition(pos=>{
  const p={lat:pos.coords.latitude,lng:pos.coords.longitude};
  updatePosition(p,pos.coords.accuracy,pos.coords.speed,false,pos.coords.heading);
 },err=>{
  const reason=err.message||'Errore di localizzazione',wasWatching=watcher!==null;
  if(err.code===1){stopNavigation();$('navStatus').textContent='GPS non autorizzato'}
  else{$('gpsStatus').textContent='GPS temporaneamente non disponibile';if(wasWatching)toast('Segnale GPS non disponibile: '+reason)}
  if(err.code===1)toast('GPS non autorizzato: '+reason);
 },{enableHighAccuracy:true,maximumAge:1000,timeout:15000});
 $('stopNav').disabled=false;$('startNav').disabled=true;$('demoBtn').disabled=true;
}
async function startDemo(){if(!current)return;primeSpeech();if(nativeMode){await startGPS(true);return}stopNavigation();setupVoice();enterNavigationView();activateNavigationVoice();simIndex=0;lastAlong=0;lastSpokenStop=-1;lastSpokenTurn=-1;nextStopIdx=0;renderStops();const dist=current.dists.at(-1);const advance=Math.max(12,Math.min(40,dist/180));function tick(){const point=pointAt(current.points,current.dists,simIndex);updatePosition(point,0,null,true);simIndex+=advance;if(simIndex>dist+90){stopNavigation();$('navStatus').textContent='Simulazione completata';toast('Simulazione completata')}}tick();simulation=setInterval(tick,700);$('stopNav').disabled=false;$('startNav').disabled=true;$('demoBtn').disabled=true;toast('Simulazione attiva: non è la tua posizione reale');}
// Native GTFS transfer: URLSession downloads the ZIP, then sends base64 chunks
// over WKScriptMessageHandler. No fetch/XHR to a WebKit custom URL scheme.
let nativeGtfsPending=null;
window.lineaPilotGTFSReceive=(id,type,payload)=>{
 const pending=nativeGtfsPending;
 if(!pending||pending.id!==id)return;
 if(type==='chunk'){
  try{
   const raw=atob(payload);
   const bytes=new Uint8Array(raw.length);
   for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
   pending.parts.push(bytes);
   pending.total+=bytes.length;
   if(pending.total>100*1024*1024)throw Error('GTFS supera 100 MB');
  }catch(err){nativeGtfsPending=null;clearTimeout(pending.timeout);pending.reject(err)}
 }else if(type==='done'){
  nativeGtfsPending=null;clearTimeout(pending.timeout);
  if(pending.total<1000){pending.reject(Error('GTFS scaricato ma vuoto'));return}
  const first=pending.parts[0];
  if(!first||first[0]!==0x50||first[1]!==0x4b){
   pending.reject(Error('Il server non ha restituito un archivio ZIP valido'));return
  }
  pending.resolve(new Blob(pending.parts,{type:'application/zip'}));
 }else if(type==='error'){
  nativeGtfsPending=null;clearTimeout(pending.timeout);
  pending.reject(Error(String(payload||'Errore download nativo')));
 }
};
async function downloadGTFSBlob(forceDownload=false){
 if(!window.webkit?.messageHandlers?.lineaPilot){
  const res=await fetch(FEED);
  if(!res.ok)throw Error('HTTP '+res.status);
  return await res.blob();
 }
 if(nativeGtfsPending)throw Error('Download GTFS già in corso');
 return await new Promise((resolve,reject)=>{
  const id='gtfs-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const timeout=setTimeout(()=>{
   if(nativeGtfsPending?.id===id){
    nativeGtfsPending=null;
    reject(Error('Download GTFS scaduto: controlla la rete e riprova'));
   }
  },180000);
  nativeGtfsPending={id,resolve,reject,parts:[],total:0,timeout};
  if(!nativePost({type:'downloadGTFS',id,refresh:forceDownload})){
   clearTimeout(timeout);nativeGtfsPending=null;
   reject(Error('Comunicazione con il motore iOS non disponibile'));
  }
 });
}
// GTFS is loaded automatically during startup; manual upload controls are removed.
document.addEventListener('visibilitychange',()=>{
 if(!navigationFullscreen)return;
 if(document.hidden)setVoiceStatus('Schermo non attivo: GPS e voce potrebbero sospendersi',true);
 else{
  setVoiceStatus('App riaperta · verifica gli annunci');
  keepScreenOn();
  try{
   if('speechSynthesis'in window&&!window.LineaPilotAndroid){
    if(speechSynthesis.paused)speechSynthesis.resume();
    // After a lock/background Safari can keep a dead utterance "speaking".
    if(!voiceBusy&&(speechSynthesis.speaking||speechSynthesis.pending)){speechSynthesis.cancel();voiceLastCancel=Date.now()}
   }
  }catch(e){console.warn(e)}
 }
});
$('driveRepeat').addEventListener('click',repeatNavigationInstruction);
$('driveRecenter').addEventListener('click',recenterOnRealGPS);
$('driveCompass').addEventListener('click',()=>{driveNorthUp=!driveNorthUp;$('driveCompass').setAttribute('aria-pressed',String(driveNorthUp));$('driveCompass').setAttribute('aria-label',driveNorthUp?'Orienta nella direzione di marcia':'Orienta a nord');applyDriveHeading()});
$('driveVoiceToggle').addEventListener('click',()=>{
 const toggle=$('voiceToggle');toggle.checked=!toggle.checked;toggle.dispatchEvent(new Event('change'));renderDriveVoiceButton();
 if(toggle.checked){primeSpeech();if(!nativeActive){resetVoiceGuidance();if(setupVoice())enqueueVoice('Annunci attivi.','normal')}}
});
$('testVoice').addEventListener('click',()=>{resetVoiceGuidance();if(!$('voiceToggle').checked){toast('Attiva prima gli annunci vocali');return}if(nativeMode){syncVoiceSettings();nativePost({type:'testVoice'});return}if(!speak('Prova audio LineaPilot. Tra duecento metri, prossima fermata.','stop'))toast('Sintesi vocale non disponibile: controlla il volume e le impostazioni di Safari');});
$('voiceToggle').addEventListener('change',()=>{if(nativeActive)nativePost({type:'settings',voice:$('voiceToggle').checked,turnVoice:$('turnToggle').checked});if(!$('voiceToggle').checked){resetVoiceGuidance();setVoiceStatus('Voce disattivata')}else setVoiceStatus('Voce attiva')});
$('turnToggle').addEventListener('change',()=>{if(nativeActive)nativePost({type:'settings',voice:$('voiceToggle').checked,turnVoice:$('turnToggle').checked})});
$('showRoute').addEventListener('click',selectTrip);$('startNav').addEventListener('click',startGPS);$('stopNav').addEventListener('click',()=>{stopNavigation();$('navStatus').textContent='Navigazione terminata'});$('demoBtn').addEventListener('click',startDemo);$('recenterBtn').addEventListener('click',recenterOnRealGPS);
function openDB(){return new Promise((resolve,reject)=>{
 const req=indexedDB.open('lineapilot-db',1);
 req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('feeds'))req.result.createObjectStore('feeds')};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('Database GTFS non accessibile'));
})}
async function saveZip(blob){
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('feeds','readwrite');
  tx.objectStore('feeds').put(blob,'biv');
  tx.oncomplete=()=>{db.close();resolve()};
  tx.onerror=()=>{db.close();reject(tx.error||Error('Salvataggio GTFS fallito'))};
 });
}
async function readCachedZip(){
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('feeds','readonly'),req=tx.objectStore('feeds').get('biv');
  req.onsuccess=()=>{db.close();resolve(req.result||null)};
  req.onerror=()=>{db.close();reject(req.error||Error('Lettura GTFS salvato fallita'))};
 });
}
let feedInitialization=null;
function setFeedState(state,title,detail){
 const el=$('feedTitle'),dot=$('feedDot');
 el.textContent=title;
 dot.dataset.state=state;
 $('retryFeed').hidden=state!=='error';
 if(detail)status(detail);
 $('dataStatus').textContent=state==='ready'?'GTFS pronto':state==='error'?'GTFS non disponibile':'GTFS…';
}
async function initializeGTFS(forceDownload=false){
 if(feedInitialization)return feedInitialization;
 feedInitialization=(async()=>{
  $('retryFeed').hidden=true;
  setFeedState('loading','Preparazione fermate…','Controllo dei dati Busitalia salvati sul dispositivo.');
  try{
   let needsRefresh=forceDownload;
   if(!forceDownload){
    let cached=null;
    try{cached=await readCachedZip()}catch(e){console.warn('Cache GTFS non accessibile:',e)}
    if(cached&&cached.size>=1000){
     try{
      const parsed=await getGTFS(cached);
      handleFeed(parsed);
      setFeedState('ready','Fermate disponibili','GTFS Busitalia già presente sul dispositivo: nessun download necessario.');
      return true;
     }catch(err){needsRefresh=true;console.warn('GTFS in cache non valido, recupero nuovi dati:',err)}
    }
   }
   setFeedState('loading','Caricamento fermate…','Download GTFS Busitalia automatico in corso.');
   const zip=await downloadGTFSBlob(needsRefresh);
   if(!zip||zip.size<1000)throw Error('Archivio GTFS vuoto o non valido');
   const parsed=await getGTFS(zip);
   handleFeed(parsed);
   let cached=true;
   try{await saveZip(zip)}catch(err){cached=false;console.warn('GTFS non salvabile:',err)}
   setFeedState('ready','Fermate disponibili',cached
    ?'GTFS Busitalia pronto e conservato per i prossimi avvii.'
    :'GTFS Busitalia pronto; la memoria locale non è disponibile e potrebbe essere necessario riscaricarlo.');
   return true;
  }catch(err){
   console.error('Caricamento GTFS:',err);
   setFeedState('error','Fermate non disponibili','Errore GTFS Busitalia: '+(err?.message||String(err))+
    '. Il catalogo Academy resta utilizzabile, ma gli annunci delle fermate richiedono il GTFS.');
   return false;
  }finally{feedInitialization=null}
 })();
 return feedInitialization;
}
$('retryFeed').addEventListener('click',()=>initializeGTFS(true));
if(!nativeMode&&'serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
loadAcademy();
syncNativeRoutePreview();
loadTicketData();
initializeGTFS();


// Three explicit steps; stop variants are confirmed by the driver.
let wizardStep=0;
function refreshReadySummary(){
 $('readyRoute').textContent=current?.academy?.name||'Scegli un percorso';
 $('readyStops').textContent=current?.academy?._evidence?.serviceStatus==='out-of-service'?'Trasferimento fuori servizio: nessuna fermata passeggeri prevista.':current?.stops?.length?current.stops.length+' fermate associate'+(current.stopProposal?.reviewRequired?' · proposta confermata ('+Math.round(current.stopProposal.coverage*100)+'% del GPX)':'')+' · '+niceDistance(current.dists.at(-1)):'Nessuna fermata associata: annunci fermata non disponibili.';
 const count=turns.filter(t=>t.verifiedRoad).length,coverage=current?.guidanceCoverage;
 $('readyGuidance').textContent=coverage?(coverage.complete?
  (count?count+' manovre stradali disponibili':'GPX verificato senza manovre stradali da annunciare'):
  'Copertura stradale parziale: '+coverage.percent+'% del GPX · '+count+' manovre. Nei tratti non coperti segui il GPX; gli annunci delle fermate associate restano disponibili.'):
  'Manovre stradali non disponibili per questo GPX. La mappa e le fermate associate restano disponibili.';
 if(current?.guidanceDate)$('readyGuidance').textContent+=' · dati del '+new Date(current.guidanceDate).toLocaleDateString('it-IT');
 $('readyGuidance').dataset.ready=coverage?.complete?'yes':coverage?'partial':'no';
}
function showWizardStep(step){
 wizardStep=Math.max(0,Math.min(2,step));
 ['wizardRoute','wizardStops','wizardReady'].forEach((id,i)=>$(id).hidden=i!==wizardStep);
 document.querySelectorAll('.wizard-progress span').forEach((el,i)=>{
  if(i===wizardStep)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');
 });
 $('wizardBack').hidden=wizardStep===0;
 $('wizardNext').hidden=wizardStep===2;
 $('wizardNext').textContent=wizardStep===1&&current?.academy?._evidence?.serviceStatus!=='out-of-service'?'Continua senza fermate':'Continua';
 refreshReadySummary();
 document.querySelector('.sidebar-scroll').scrollTop=0;
 window.scrollTo({top:0,behavior:'smooth'});
 if(wizardStep===1&&selectedOfficial&&feed&&!academyGtfsMatches.size)findGtfsForAcademy();
}
$('wizardBack').addEventListener('click',()=>showWizardStep(wizardStep-1));
$('wizardNext').addEventListener('click',()=>{
 if(!current?.academy){toast('Scegli prima il percorso ufficiale');return}
 if(wizardStep===1&&$('academyGtfsTrip').value&&!current.stops.length){
  toast('Conferma le fermate con «Usa queste fermate», oppure deseleziona la variante');return;
 }
 showWizardStep(wizardStep+1);
});
$('mergeOfficial').addEventListener('click',()=>{if(current?.reliable)showWizardStep(2)});
showWizardStep(0);
