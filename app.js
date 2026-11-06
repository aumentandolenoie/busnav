/* LineaPilot v0.1 — prototype; not a certified road navigator. */
'use strict';
const $=id=>document.getElementById(id);
const FEED='https://proxy.busone.app/biv/gtfs.zip';
const map=L.map('map',{zoomControl:false,rotate:true,touchRotate:false,dragRotate:false,shiftKeyRotate:false}).setView([45.4064,11.8768],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
L.control.zoom({position:'topright'}).addTo(map);
let academy=[], selectedOfficial=null, feed=null, current=null, watcher=null, simulation=null, simIndex=0, locationMarker=null, accuracyCircle=null, lineLayer=null, stopLayer=null;
let nextStopIdx=0,lastFix=null,lastSpokenStop=-1,lastSpokenTurn=-1,lastProgress=0,lastAlong=0, turns=[];
let navigationFullscreen=false,lastNavHeading=null,lastCameraAt=0,lastCameraPoint=null,lastMatchedAt=0,hasMatchedFix=false;
function enterNavigationView(){
 navigationFullscreen=true;
 document.body.classList.add('navigating');
 $('navFullscreenBar').hidden=false;
 $('headingStatus').textContent='↑ Attesa direzione';
 $('followToggle').checked=true;
 requestAnimationFrame(()=>{map.invalidateSize({pan:false});/* Await first reliable GPS fix before centring; avoid jumping to the GPX origin. */});
}
function leaveNavigationView(){
 if(!navigationFullscreen)return;
 navigationFullscreen=false;document.body.classList.remove('navigating');
 $('navFullscreenBar').hidden=true;lastNavHeading=null;lastCameraAt=0;lastCameraPoint=null;lastMatchedAt=0;hasMatchedFix=false;
 if(typeof map.setHeading==='function')map.setHeading(null);
 if(typeof map.stopHeadingUp==='function')map.stopHeadingUp();
 if(typeof map.setBearing==='function')map.setBearing(0);
 requestAnimationFrame(()=>{map.invalidateSize({pan:false});if(lineLayer&&lineLayer.getBounds().isValid())map.fitBounds(lineLayer.getBounds(),{padding:[40,40]});});
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
 if(typeof map.setHeading==='function')map.setHeading(lastNavHeading,{ease:0.12,deadzone:2});
 else if(typeof map.setBearing==='function')map.setBearing(-lastNavHeading);
 $('headingStatus').textContent='GPX · '+Math.round(lastNavHeading)+'°';
}
function stableRouteMatch(p,points,dists,speed,isDemo){
 const now=Date.now(),global=nearestOnShape(p,points,dists);
 if(!hasMatchedFix){hasMatchedFix=true;lastMatchedAt=now;return global;}
 const elapsed=Math.max(.5,Math.min(15,(now-lastMatchedAt)/1000));
 lastMatchedAt=now;
 const maxProgress=isDemo?90:Math.max(65,Math.min(220,Math.max(speed,4)*elapsed*2+45));
 const minAlong=Math.max(0,lastAlong-45),maxAlong=Math.min(dists.at(-1)||0,lastAlong+maxProgress);
 const i0=dists.findIndex(d=>d>=minAlong),i1=dists.findIndex(d=>d>=maxAlong);
 const start=Math.max(0,(i0<0?points.length-2:i0)-2);
 const end=Math.min(points.length-1,(i1<0?points.length-1:i1)+2);
 const local=nearestOnShape(p,points,dists,start,end);
 if(local.d<=Math.max(75,global.d+25)){
  // Keep the same section of route at close crossings or overlapping roads.
  if(local.along<lastAlong-45)return {...local,along:lastAlong};
  return local;
 }
 // Ignore sudden implausible skips to another portion of the line;
 // do not advance stops or rotate the map on an untrusted fix.
 return {d:Infinity,along:lastAlong,idx:local.idx};
}
function followStableCamera(points,dists,along,isDemo){
 if(!navigationFullscreen||!$('followToggle').checked)return;
 const now=Date.now();
 const center=pointAt(points,dists,along);
 if(lastCameraPoint&&metres(lastCameraPoint,center)<24&&now-lastCameraAt<2500)return;
 // Throttle pans so the entire map does not jump on every GPS fix.
 const first=!lastCameraPoint;
 lastCameraPoint=center;lastCameraAt=now;
 map.panTo([center.lat,center.lng],{animate:!first,duration:.65});
}
$('exitNavigation').addEventListener('click',()=>{stopNavigation();$('navStatus').textContent='Navigazione terminata'});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&navigationFullscreen){stopNavigation();$('navStatus').textContent='Navigazione terminata'}});


const ACADEMY_EXPECTED={Extraurbano:557,Colli:29,Urbano:201};
const ACADEMY_DOCUMENTS={
  'Turni Invernali':{'Feriale':['1 FERIALE dal 02_11_2026 - _27-5.pdf'],'Sabato':['2 SABATO  anno scolastico 2026 - _27-2.pdf'],'Festivo':['3 FESTIVO EXTRAURBANO anno scolastico 2026 - _27-1.pdf']},
  'Indicatori di percorso':{'Colli':['Linee Colli.pdf'],'Extraurbano':['Linee Extraurbanee.pdf'],'Urbano':['Linee Urbane.pdf']}
};
const sortIt=(a,b)=>String(a).localeCompare(String(b),'it',{numeric:true,sensitivity:'base'});
function academyGroupName(r){return String(r.line||'Altri percorsi').trim();}
async function loadAcademy(){try{
 const res=await fetch('./official-routes.json');if(!res.ok)throw Error('HTTP '+res.status);
 const data=await res.json();if(!Array.isArray(data))throw Error('Catalogo non valido');
 academy=data;const ids=new Set(data.map(r=>r.id)),stats={};
 for(const category of Object.keys(ACADEMY_EXPECTED))stats[category]=data.filter(r=>r.category===category).length;
 const complete=data.length===787&&ids.size===787&&Object.keys(ACADEMY_EXPECTED).every(k=>stats[k]===ACADEMY_EXPECTED[k])&&data.every(r=>Array.isArray(r.points)&&r.points.length>=2);
 $('academyCount').textContent=complete?'Catalogo completo: 787/787 GPX (557 Extraurbano, 29 Colli, 201 Urbano).':'ATTENZIONE: catalogo incompleto o non valido ('+data.length+'/787).';
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
  $('academyCount').textContent=academy.length+' percorsi GPX disponibili · seleziona una categoria';
  onAcademySelected();return;
 }
 if(ACADEMY_DOCUMENTS[category]){
  const groups=Object.keys(ACADEMY_DOCUMENTS[category]).sort(sortIt);
  setOptions($('academyLine'),groups.map(g=>[g,g]),'Scegli gruppo…');
  if(groups.includes(previousLine))$('academyLine').value=previousLine;
  filterAcademyRoutes();return;
 }
 const paths=academy.filter(r=>r.category===category);
 const groups=[...new Set(paths.map(academyGroupName))].sort(sortIt);
 setOptions($('academyLine'),groups.map(g=>[g,g+' ('+paths.filter(r=>academyGroupName(r)===g).length+')']),'Scegli linea…');
 if(groups.includes(previousLine))$('academyLine').value=previousLine;
 filterAcademyRoutes();
}
function filterAcademyRoutes(){
 const cat=$('academyCategory').value,line=$('academyLine').value;
 const previous=$('academyRoute').value;
 if(!line){setOptions($('academyRoute'),[],'Scegli prima la linea…');$('academyCount').textContent=academy.filter(r=>r.category===cat).length+' percorsi nella categoria';onAcademySelected();return;}
 if(ACADEMY_DOCUMENTS[cat]){
  const docs=ACADEMY_DOCUMENTS[cat][line]||[];
  setOptions($('academyRoute'),docs.map(d=>[d,d]),'Scegli documento…');
  if(docs.includes(previous))$('academyRoute').value=previous;
  $('academyCount').textContent=docs.length+' documento/i PDF · non sono GPX';
  onAcademySelected();return;
 }
 const q=$('academySearch').value.trim().toLocaleLowerCase('it');
 const matches=academy.filter(r=>r.category===cat&&academyGroupName(r)===line&&(!q||[r.name,r.variant,r.filename].join(' ').toLocaleLowerCase('it').includes(q))).sort((a,b)=>sortIt(a.name,b.name));
 setOptions($('academyRoute'),matches.map(r=>[String(r.id),r.name]),'Scegli percorso…');
 if(matches.some(r=>String(r.id)===previous))$('academyRoute').value=previous;
 $('academyCount').textContent=matches.length+' percorsi trovati in '+cat+' / '+line+' (nessun limite ai risultati)';
 onAcademySelected();
}
let academyGtfsMatches=new Map();
function resetAcademyGtfs(){
 academyGtfsMatches=new Map();$('academyDiff').hidden=true;$('academyDiffList').replaceChildren();
 setOptions($('academyGtfsTrip'),[],'Nessuna corsa verificata');
 $('findGtfsAcademy').disabled=!selectedOfficial||!feed;
 $('mergeOfficial').disabled=true;
 $('academyGtfsStatus').textContent=feed?'Seleziona un GPX e cerca le corse GTFS compatibili.':'Carica un GTFS per trovare le fermate.';
}
function normAcademyCode(s){
 const x=String(s||'').trim().toUpperCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
 return x.replace(/^U(?=\d)/,'').replace(/^E(?=\d)/,'').replace(/^0+(?=\d)/,'');
}
function academyRouteCodes(r){
 // Line or directory must not override the original Academy name: these are match candidates only.
 const values=[r.line,r.variant];
 if(/^\d+[A-Z]*\b/i.test(r.name||''))values.push(String(r.name).trim().split(/[\s|_-]/)[0]);
 const keys=new Set(values.map(normAcademyCode).filter(Boolean));
 // Variant 10D matches GTFS route 10; "Deviazioni mercatali" may have variant 523.
 for(const v of [...keys])if(/^\d+[A-Z]+$/.test(v))keys.add(v.replace(/[A-Z]+$/,''));
 return keys;
}
function gtfsFitsAcademyCode(r,route){
 const codes=academyRouteCodes(r);
 const family=code=>String(code||'').replace(/^(\d+)[A-Z]+$/,'$1');
 const keys=new Set([...codes].flatMap(c=>[c,family(c)]));
 const raw=String(route?.route_short_name||route?.route_long_name||'');
 return raw.split(/[\/;,]+/).flatMap(v=>[v,v.split(/[_-]/)[0]]).map(normAcademyCode)
  .some(code=>code&&(keys.has(code)||keys.has(family(code))));
}
function timeOfTrip(t){
 const x=feed.timesByTrip.get(t.trip_id)||[];
 return (x[0]?.departure||'—')+' → '+(x.at(-1)?.arrival||'—');
}
// Compare GTFS segments to the Academy polyline, without altering its geometry.
function evaluateGtfsSegment(stops,points,dists){
 if(stops.length<2)return null;
 const offsets=[],errors=[];let last=-Infinity,backward=0;
 for(const item of stops){
  const h=nearestOnShape(item.stop,points,dists);let candidate=h;
  if(h.along+70<last){
   const ix=dists.findIndex(d=>d>=last);
   const forward=nearestOnShape(item.stop,points,dists,Math.max(0,(ix<0?dists.length-1:ix)-2));
   if(forward.d<=100&&forward.d<h.d+35)candidate=forward;
  }
  if(candidate.along+70<last)backward++;
  last=candidate.along;offsets.push(candidate.along);errors.push(candidate.d);
 }
 const outliers=errors.filter(d=>d>100).length;
 const total=dists.at(-1)||1;
 const span=offsets.at(-1)-offsets[0];
 if(backward||outliers>Math.max(1,Math.floor(stops.length*.05))||span<300||offsets.some(x=>!Number.isFinite(x)))return null;
 return {start:offsets[0],end:offsets.at(-1),span,meanError:errors.reduce((x,y)=>x+y,0)/errors.length,first:stops[0].stop,last:stops.at(-1).stop,stops};
}
function candidateGtfsSegments(chosen,pts,dists){
 // Only the Busitalia/primary feed provides stop sequences. Supplemental MOM is excluded.
 const groups=new Map();
 for(const route of feed.routes){
  if(route._stopAuthority==='supplemental'||!gtfsFitsAcademyCode(chosen,route))continue;
  for(const t of feed.tripsByRoute.get(route.route_id)||[]){
   const a=feed.timesByTrip.get(t.trip_id)||[];
   if(a.length<2)continue;
   const key=t.route_id+'|'+a.map(x=>x.stop?.stop_id||'?').join('|');
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(t);
  }
 }
 const segments=[];
 for(const trips of groups.values()){
  const t=trips[0],ss=(feed.timesByTrip.get(t.trip_id)||[]).filter(x=>x.stop&&Number.isFinite(x.stop.lat)&&Number.isFinite(x.stop.lng));
  const m=evaluateGtfsSegment(ss,pts,dists);
  if(m)segments.push({...m,trip:t,alternatives:trips});
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
function buildAcademyMatches(chosen){
 const pts=chosen.points.map(([lat,lng])=>({lat,lng})),dists=shapeMetrics(pts),total=dists.at(-1)||1;
 const {segments,groupCount}=candidateGtfsSegments(chosen,pts,dists);
 const results=[],full=x=>x.start<Math.max(700,total*.12)&&x.end>total*.85&&x.span>total*.68;
 for(const x of segments)if(full(x)){
  const match=matchStopsStrict(x.stops,pts,dists);
  if(match.ok)results.push({trip:x.trip,legs:[x],stops:x.stops,averageError:x.meanError,coverage:x.span/total,match});
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
     results.push({trip:chain.legs[0].trip,legs:candidate.legs,stops,averageError:candidate.error,coverage:(candidate.end-candidate.start)/total,match});
    }else if(depth<4&&candidate.end<total*.96)next.push(candidate);
   }
  }
  // Limit combinatorial growth on networks with many overlapping service variants.
  next.sort((a,b)=>b.end-a.end||a.error-b.error);
  frontier=next.slice(0,120);
 }
 results.sort((a,b)=>b.coverage-a.coverage||a.averageError-b.averageError);
 return {results,segments:segments.length,groupCount};
}
function findGtfsForAcademy(){
 if(!selectedOfficial||!feed)return;
 const button=$('findGtfsAcademy');button.disabled=true;
 $('academyGtfsStatus').textContent='Confronto delle fermate GTFS con il GPX Academy…';
 academyGtfsMatches=new Map();$('academyDiff').hidden=true;$('academyDiffList').replaceChildren();
 try{
  const {results,segments,groupCount}=buildAcademyMatches(selectedOfficial);
  academyGtfsMatches=new Map();const options=[];
  results.forEach((x,i)=>{
   const id='academy-match-'+i;academyGtfsMatches.set(id,x);
   const codes=x.legs.map(l=>feed.routesById.get(l.trip.route_id)?.route_short_name||'?').join(' + ');
   options.push([id,'Variante '+(i+1)+' · '+(x.legs.length>1?x.legs.length+' tratte':'Corsa unica')+' · '+codes+' · '+x.stops.length+' fermate · copertura '+Math.round(x.coverage*100)+'% · scarto '+Math.round(x.averageError)+' m']);
  });
  setOptions($('academyGtfsTrip'),options,'Scegli una sequenza di fermate…');
  renderAcademyStopComparison();
  $('academyGtfsStatus').textContent=results.length?
   results.length+' combinazioni geometriche compatibili; controlla fermate, direzione e variante. La combinazione non prova una corsa diretta dello stesso autobus.':
   'Nessuna corrispondenza completa ('+segments+' segmenti compatibili da '+groupCount+' sequenze GTFS). Il GPX non viene modificato.';
  $('mergeOfficial').disabled=true;
 }catch(e){console.error(e);$('academyGtfsStatus').textContent='Errore di associazione: '+e.message;}
 finally{button.disabled=false}
}
$('findGtfsAcademy').addEventListener('click',findGtfsForAcademy);
$('academyGtfsTrip').addEventListener('change',()=>{
 $('mergeOfficial').disabled=!selectedOfficial||!academyGtfsMatches.has($('academyGtfsTrip').value);
 renderAcademyStopComparison();
});
function onAcademySelected(){
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
$('academyCategory').addEventListener('change',()=>{$('academySearch').value='';filterAcademy()});
$('academyLine').addEventListener('change',()=>{$('academySearch').value='';filterAcademyRoutes()});
$('academySearch').addEventListener('input',filterAcademyRoutes);
$('academyRoute').addEventListener('change',onAcademySelected);
function selectedGTFS(){return tripsInDirection().find(t=>t.trip_id===$('tripSelect').value)}
function showAcademyRoute(merge=false){const chosen=selectedOfficial;if(!chosen){toast('Seleziona un GPX Academy');return}const points=chosen.points.map(([lat,lng])=>({lat,lng}));const dists=shapeMetrics(points);let stops=[],offsets=[],diagnostic='GPX Academy senza fermate. Per aggiungerle, carica il GTFS e associa una corsa precisa.';let trip={trip_headsign:chosen.name};let reliable=false;
if(merge){if(!feed){toast('Prima importa il GTFS');return}const academyMatch=academyGtfsMatches.get($('academyGtfsTrip').value);const gt=academyMatch?.trip||selectedGTFS();if(!gt){toast('Seleziona una corsa GTFS corrispondente');return}const gtfsRoute=feed.routesById.get(gt.route_id);const num=normAcademyCode(gtfsRoute?.route_short_name||'');const officialNum=[...academyRouteCodes(chosen)].join(', ');if(gtfsRoute?._stopAuthority==='supplemental'){$('officialInfo').textContent='Le fermate MOM non sono utilizzate. Importa Busitalia come feed principale; le fermate comuni sono già nel suo GTFS.';toast('Fermate MOM escluse');return}if(!academyMatch&&!gtfsFitsAcademyCode(chosen,gtfsRoute||{})){$('officialInfo').textContent=`Abbinamento bloccato: linea GTFS ${num} diversa dal GPX ${officialNum}. Seleziona la corsa corretta.`;toast('Linea GPX e GTFS non corrispondono');return}
const candidates=academyMatch?.stops||(feed.timesByTrip.get(gt.trip_id)||[]).filter(x=>x.stop&&Number.isFinite(x.stop.lat)&&Number.isFinite(x.stop.lng));if(candidates.length<2){toast('Nessuna sequenza di fermate disponibile');return}const match=matchStopsStrict(candidates,points,dists);diagnostic=match.message;if(!match.ok){$('officialInfo').textContent=diagnostic;toast('Abbinamento non affidabile: navigazione fermate non abilitata');return}stops=candidates;offsets=match.offsets;trip={...gt,trip_headsign:academyMatch?.legs?.length>1?chosen.name:gt.trip_headsign};reliable=true}
stopNavigation();current={trip,stops,points,dists,offsets,fallback:false,academy:chosen,reliable};nextStopIdx=0;lastSpokenStop=-1;lastSpokenTurn=-1;lastAlong=0;turns=computeTurns(points,dists);if(lineLayer)map.removeLayer(lineLayer);if(stopLayer)map.removeLayer(stopLayer);lineLayer=L.polyline(points,{color:'#0da2a5',weight:6,opacity:.9}).addTo(map);stopLayer=L.layerGroup();stops.forEach((s,i)=>L.circleMarker([s.stop.lat,s.stop.lng],{radius:6,color:'#fff',weight:2,fillColor:'#2362e7',fillOpacity:1}).bindPopup(`${i+1}. ${escapeHTML(s.stop.stop_name)}`).addTo(stopLayer));stopLayer.addTo(map);map.fitBounds(lineLayer.getBounds(),{padding:[55,55]});$('stopCount').textContent=stops.length?stops.length+' fermate':'Fermate non associate';$('navStatus').textContent='GPX Academy caricato';$('nextName').textContent=stops[0]?.stop.stop_name||'GPX senza fermate';$('nextDetail').textContent=merge?'GPS e simulazione disponibili':'Associa prima una corsa GTFS per gli annunci';$('nextDistance').textContent='—';$('demoBtn').disabled=false;$('startNav').disabled=false;renderStops();$('progressLabel').textContent='0 / '+stops.length+' fermate';$('turnHint').textContent='Svolte geometriche sperimentali (non stradali)';$('officialInfo').textContent=diagnostic;toast(merge?'GPX Academy e fermate GTFS associati':'Tracciato GPX Academy visualizzato');}
function matchStopsStrict(stops,points,dists){let offsets=[],last=-1,outliers=0,maxError=0,backward=0;const total=dists.at(-1);for(const st of stops){const p=st.stop;const start=Math.max(0,dists.findIndex(d=>d>=Math.max(0,last-30))-1);const near=nearestOnShape(p,points,dists,start);const global=nearestOnShape(p,points,dists);if(global.along<last-150 && global.d+25<near.d)backward++;
if(near.d>100)outliers++;maxError=Math.max(maxError,near.d);offsets.push(near.along);if(near.along+50<last)backward++;last=Math.max(last,near.along)}
const limit=Math.max(1,Math.floor(stops.length*.08));const ok=outliers<=limit&&backward===0&&offsets[0]<total-500&&offsets.at(-1)>total*.25;
const message=`Confronto GTFS/GPX: ${stops.length} fermate, ${outliers} oltre 100 m dal GPX (soglia ${limit}), distanza massima ${Math.round(maxError)} m, anomalie sequenza ${backward}. `+(ok?'Verifica geometrica superata: associazione provvisoria, da controllare visivamente.':'Associazione rifiutata: controlla direzione e variante.');return {ok,offsets,message}}
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
function clearRoute(){current=null;if(lineLayer)map.removeLayer(lineLayer);if(stopLayer)map.removeLayer(stopLayer);lineLayer=stopLayer=null;$('stopList').innerHTML='<p class="empty">Seleziona una corsa per vedere le fermate.</p>';$('stopCount').textContent='—';$('nextName').textContent='—';$('nextDetail').textContent='Carica una linea per iniziare';$('nextDistance').textContent='—';$('navStatus').textContent='Seleziona una corsa';$('progressBar').style.width='0%';$('progressLabel').textContent='0 / 0 fermate';$('turnHint').textContent='Percorso non attivo'}
const rad=Math.PI/180;function metres(a,b){let dlat=(b.lat-a.lat)*rad,dlng=(b.lng-a.lng)*rad,s=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;return 12742000*Math.atan2(Math.sqrt(s),Math.sqrt(1-s))}
function project(p,a,b){const x=(b.lng-a.lng)*111320*Math.cos((p.lat+a.lat)/2*rad),y=(b.lat-a.lat)*111320;const px=(p.lng-a.lng)*111320*Math.cos((p.lat+a.lat)/2*rad),py=(p.lat-a.lat)*111320;let t=(x*x+y*y)?Math.max(0,Math.min(1,(px*x+py*y)/(x*x+y*y))):0;return {t,d:Math.hypot(px-x*t,py-y*t)}}
function shapeMetrics(points){const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+metres(points[i-1],points[i]));return cumulative}
function nearestOnShape(p,pts,dist,start=0,end=pts.length-1){let best={d:Infinity,along:0,idx:0};for(let i=start;i<Math.min(end,pts.length-1);i++){let v=project(p,pts[i],pts[i+1]);if(v.d<best.d){best={d:v.d,along:dist[i]+v.t*(dist[i+1]-dist[i]),idx:i}}}return best}
function stopOffsets(stops,pts,dist){let last=0;return stops.map(s=>{if(!s.stop)return last;const hit=nearestOnShape(s.stop,pts,dist); // permits routes that revisit same point: ordered forward candidate preferred
let best=hit;if(hit.along<last-80){const forward=nearestOnShape(s.stop,pts,dist,Math.max(0,dist.findIndex(d=>d>=last)-1));if(forward.d<150)best=forward}last=Math.max(last,best.along);return last})}
function bearing(a,b){const lat1=a.lat*rad,lat2=b.lat*rad,lon=(b.lng-a.lng)*rad;let y=Math.sin(lon)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon);return Math.atan2(y,x)*180/Math.PI}
function deltaHeading(a,b){return ((b-a+540)%360)-180}
function pointAt(pts,dists,at){const idx=Math.max(0,dists.findIndex(x=>x>=at));if(idx===0)return pts[0];if(idx<0)return pts.at(-1);const t=(at-dists[idx-1])/(dists[idx]-dists[idx-1]||1);return {lat:pts[idx-1].lat+(pts[idx].lat-pts[idx-1].lat)*t,lng:pts[idx-1].lng+(pts[idx].lng-pts[idx-1].lng)*t}}
function computeTurns(pts,dists){const list=[];const total=dists.at(-1)||0;for(let d=100;d<total-100;d+=30){const a=pointAt(pts,dists,d-75),b=pointAt(pts,dists,d),c=pointAt(pts,dists,d+75);const deg=deltaHeading(bearing(a,b),bearing(b,c));if(Math.abs(deg)>47&&(!list.length||d-list.at(-1).at>170))list.push({at:d,side:deg>0?'destra':'sinistra',deg})}return list}
function selectTrip(){stopNavigation();const trip=tripsInDirection().find(t=>t.trip_id===$('tripSelect').value);if(!trip)return;const stops=(feed.timesByTrip.get(trip.trip_id)||[]).filter(x=>x.stop&&Number.isFinite(x.stop.lat)&&Number.isFinite(x.stop.lng));let points=feed.shapesById.get(trip.shape_id)||[];let fallback=false;if(points.length<2){points=stops.map(s=>({lat:s.stop.lat,lng:s.stop.lng}));fallback=true}if(points.length<2){toast('La corsa non ha una geometria valida');return}const dists=shapeMetrics(points),offsets=stopOffsets(stops,points,dists);current={trip,stops,points,dists,offsets,fallback};nextStopIdx=0;lastSpokenStop=-1;lastSpokenTurn=-1;lastProgress=0;lastAlong=0;turns=fallback?[]:computeTurns(points,dists);if(lineLayer)map.removeLayer(lineLayer);if(stopLayer)map.removeLayer(stopLayer);lineLayer=L.polyline(points,{color:'#2869ed',weight:6,opacity:.9}).addTo(map);stopLayer=L.layerGroup();stops.forEach((s,i)=>L.circleMarker([s.stop.lat,s.stop.lng],{radius:6,color:'#fff',weight:2,fillColor:'#2362e7',fillOpacity:1}).bindPopup(`${i+1}. ${escapeHTML(s.stop.stop_name)}`).addTo(stopLayer));stopLayer.addTo(map);map.fitBounds(lineLayer.getBounds(),{padding:[55,55]});$('stopCount').textContent=stops.length+' fermate';$('navStatus').textContent='Percorso caricato';$('nextName').textContent=stops[0]?.stop.stop_name||'—';$('nextDetail').textContent='Avvia il GPS o la simulazione';$('nextDistance').textContent='—';$('demoBtn').disabled=false;renderStops();$('progressLabel').textContent='0 / '+stops.length+' fermate';$('turnHint').textContent=fallback?'Shape assente · svolte disabilitate':'Svolte indicative dalla shape';if(fallback)toast('ATTENZIONE: tracciato mancante; collegamento semplificato tra fermate, non valido per la guida');}
function escapeHTML(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function renderStops(){if(!current)return;if(!current.stops.length){$('stopList').innerHTML='<p class="empty">GPX Academy: importa e associa una corsa GTFS per vedere le fermate.</p>';return}const frag=document.createDocumentFragment();current.stops.forEach((s,i)=>{const el=document.createElement('div');el.className='stop-row '+(i<nextStopIdx?'done':i===nextStopIdx?'current':'');el.innerHTML=`<div class="stop-num">${i+1}</div><div><strong>${escapeHTML(s.stop.stop_name)}</strong><small>${escapeHTML(s.arrival||'')} · ${escapeHTML(s.stop.stop_id)}</small></div>`;frag.append(el)});$('stopList').replaceChildren(frag)}
// GPS-like spoken guidance. All distances are measured along the Academy GPX.
let voiceQueue=[],voiceBusy=false,voiceGeneration=0,voiceUnlocked=false,activeVoicePriority=null,firstVoiceFix=true;
let spokenStopStages=new Map(),lastVoiceTime=0,lastPositionSample=null,filteredSpeed=0;
function resetVoiceGuidance(){
 voiceGeneration++;voiceQueue=[];voiceBusy=false;spokenStopStages.clear();
 lastVoiceTime=0;lastPositionSample=null;filteredSpeed=0;activeVoicePriority=null;firstVoiceFix=true;
 if('speechSynthesis'in window)try{speechSynthesis.cancel()}catch(e){console.warn(e)}
}
function setupVoice(){
 if(!('speechSynthesis'in window))return false;
 voiceUnlocked=true;
 return true;
}
function enqueueVoice(message,priority='normal'){
 if(!$('voiceToggle').checked||!setupVoice())return false;
 // Stop warnings preempt speculative curve announcements; they never preempt another stop.
 if(priority==='stop'){
  voiceQueue=voiceQueue.filter(x=>x.priority!=='turn');
  if(voiceBusy&&activeVoicePriority==='turn'){
   voiceGeneration++;voiceBusy=false;activeVoicePriority=null;
   try{speechSynthesis.cancel()}catch(e){console.warn(e)}
  }
 }
 if(priority==='turn'&&(voiceBusy||voiceQueue.some(x=>x.priority==='stop')))return false;
 if(voiceQueue.length>3)voiceQueue=voiceQueue.slice(-2);
 voiceQueue.push({message,priority});
 drainVoice();return true;
}
function drainVoice(){
 if(voiceBusy||!voiceQueue.length||!('speechSynthesis'in window))return;
 const item=voiceQueue.shift(),generation=voiceGeneration;
 voiceBusy=true;activeVoicePriority=item.priority;
 try{
  const speech=new SpeechSynthesisUtterance(item.message);
  speech.lang='it-IT';speech.rate=1.02;speech.pitch=1;
  const voices=speechSynthesis.getVoices();
  const italian=voices.find(v=>v.lang.toLowerCase()==='it-it')||voices.find(v=>v.lang.toLowerCase().startsWith('it'));
  if(italian)speech.voice=italian;
  let completed=false;
  const finish=()=>{if(completed||generation!==voiceGeneration)return;completed=true;voiceBusy=false;activeVoicePriority=null;drainVoice()};
  speech.onend=finish;speech.onerror=finish;
  speechSynthesis.speak(speech);
 }catch(e){voiceBusy=false;activeVoicePriority=null;console.warn('Sintesi vocale:',e);drainVoice()}
}
function speak(message,priority='normal'){return enqueueVoice(message,priority)}
function niceDistance(m){return m<1000?Math.round(Math.max(0,m)/10)*10+' m':(m/1000).toFixed(1)+' km'}
function speechDistance(m){return m<1000?Math.max(50,Math.round(m/50)*50)+' metri':(m/1000).toFixed(1).replace('.',',')+' chilometri'}
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
  if(enqueueVoice('Tra '+speechDistance(remaining)+', prossima fermata: '+stop.stop_name+'.','stop')){
   spokenStopStages.set(stopIndex,1);lastSpokenStop=stopIndex;
  }
  stage=spokenStopStages.get(stopIndex)||0;
 }
 // Optional final cue at short range; never at the same update as the first cue.
 if(stage===1&&remaining<=65&&remaining>=8&&lastSpokenStop===stopIndex&&
    (mps>2||isDemo)&&!voiceBusy&&!voiceQueue.length){
  if(enqueueVoice('Fermata in arrivo: '+stop.stop_name+'.','stop'))spokenStopStages.set(stopIndex,2);
 }
}
function updatePosition(p,accuracy=0,reportedSpeed=null,isDemo=false,reportedHeading=null){
 if(!current)return;
 lastFix=p;const {points,dists,offsets,stops}=current;
 const speed=speedEstimate(p,reportedSpeed,isDemo);
 let near=stableRouteMatch(p,points,dists,speed,isDemo);
 if(near.d>180){$('gpsStatus').textContent='Fuori percorso';$('navStatus').textContent='GPS lontano dal tracciato';$('turnHint').textContent='Verifica percorso / deviazione';return}
 if(!isDemo&&accuracy>110){$('gpsStatus').textContent='GPS poco preciso ±'+Math.round(accuracy)+' m';return}
 // Prevent map and stop list from moving backwards due to GPS jitter.
 if(near.along<lastAlong-30)near={...near,along:lastAlong};
 const along=near.along;
 // A capolinea is often also GTFS stop #1: on departure, the next alert is stop #2.
 if(firstVoiceFix){
  firstVoiceFix=false;
  if(stops.length>1&&offsets[0]<=50&&Math.abs(along-offsets[0])<30)nextStopIdx=1;
 }
 lastAlong=Math.max(lastAlong,along-30);
 updateNavigationHeading(points,dists,along);
 $('gpsStatus').textContent=isDemo?'Simulazione':accuracy?'GPS ±'+Math.round(accuracy)+' m':'GPS attivo';
 $('navStatus').textContent=current.trip.trip_headsign||'Corsa in corso';
 // This value must move forward only once the stop is actually passed.
 while(nextStopIdx<stops.length&&along>offsets[nextStopIdx]+35)nextStopIdx++;
 renderStops();
 const done=stops.length>0&&nextStopIdx>=stops.length;
 const remaining=done?0:Math.max(0,offsets[nextStopIdx]-along);
 $('nextName').textContent=!stops.length?'Nessuna fermata associata':done?'Capolinea raggiunto':stops[nextStopIdx].stop.stop_name;
 $('nextDetail').textContent=!stops.length?'Solo geometria GPX':done?'Fine della corsa':'Fermata '+(nextStopIdx+1)+' di '+stops.length;
 $('nextDistance').textContent=!stops.length?'—':done?'✓':niceDistance(remaining);
 $('progressBar').style.width=Math.min(100,Math.max(0,along/(dists.at(-1)||1)*100))+'%';
 $('progressLabel').textContent=nextStopIdx+' / '+stops.length+' fermate';
 if(stops.length&&!done&&near.d<65){
  planStopVoice(nextStopIdx,remaining,speed,near.d>65,isDemo);
 }
 const turn=turns.find(t=>t.at>along+20&&t.at<along+450);
 if(turn){
  const d=turn.at-along;
  $('turnHint').textContent='Possibile svolta a '+turn.side+' tra '+niceDistance(d);
  const idx=turns.indexOf(turn);
  // Do not interrupt a stop announcement or narrate a turn close to a stop.
  if($('turnToggle').checked&&d<140&&idx!==lastSpokenTurn&&!voiceBusy&&
      (!stops.length||done||remaining>220)&&near.d<50){
   if(speak('Possibile svolta a '+turn.side+' tra circa '+speechDistance(d)+'.','turn'))lastSpokenTurn=idx;
  }
 }else $('turnHint').textContent=done?'Corsa completata':'Segui il tracciato GPX';
 followStableCamera(points,dists,along,isDemo);
 if(!locationMarker)locationMarker=L.circleMarker([p.lat,p.lng],{radius:9,color:'#fff',weight:3,fillColor:'#0c55eb',fillOpacity:1}).addTo(map);
 else locationMarker.setLatLng([p.lat,p.lng]);
 if(accuracy&&!isDemo){
  if(!accuracyCircle)accuracyCircle=L.circle([p.lat,p.lng],{radius:accuracy,weight:1,color:'#4288ff',fillOpacity:.08}).addTo(map);
  else accuracyCircle.setLatLng([p.lat,p.lng]).setRadius(accuracy)
 }
}
function stopNavigation(){
 // Immediately stop browser position updates and speech on manual exit.
 if(watcher!==null){navigator.geolocation.clearWatch(watcher);watcher=null}
 if(simulation){clearInterval(simulation);simulation=null}
 resetVoiceGuidance();leaveNavigationView();
 $('stopNav').disabled=true;$('startNav').disabled=!current;$('demoBtn').disabled=!current;
 $('gpsStatus').textContent='GPS inattivo';
}
function startGPS(){if(!current)return;stopNavigation();setupVoice();if(!('geolocation'in navigator)){toast('GPS non disponibile nel browser');return}if(!window.isSecureContext){toast('Per il GPS occorre HTTPS oppure localhost');return}lastAlong=0;lastSpokenStop=-1;lastSpokenTurn=-1;nextStopIdx=0;renderStops();enterNavigationView();$('gpsStatus').textContent='Ricerca GPS…';watcher=navigator.geolocation.watchPosition(pos=>{const p={lat:pos.coords.latitude,lng:pos.coords.longitude};updatePosition(p,pos.coords.accuracy,pos.coords.speed,false,pos.coords.heading)},err=>{
  const reason=err.message||'Errore di localizzazione';
  const wasWatching=watcher!==null;
  if(err.code===1){ // permission denied: no GPS can be received
   stopNavigation();$('navStatus').textContent='GPS non autorizzato';
  }else{
   $('gpsStatus').textContent='GPS temporaneamente non disponibile';
   if(wasWatching)toast('Segnale GPS non disponibile: '+reason);
  }
  if(err.code===1)toast('GPS non autorizzato: '+reason);
 },{enableHighAccuracy:true,maximumAge:1000,timeout:15000});$('stopNav').disabled=false;$('startNav').disabled=true;$('demoBtn').disabled=true;}
function startDemo(){if(!current)return;stopNavigation();setupVoice();enterNavigationView();simIndex=0;lastAlong=0;lastSpokenStop=-1;lastSpokenTurn=-1;nextStopIdx=0;renderStops();const dist=current.dists.at(-1);const advance=Math.max(12,Math.min(40,dist/180));function tick(){const point=pointAt(current.points,current.dists,simIndex);updatePosition(point,0,null,true);simIndex+=advance;if(simIndex>dist+90){stopNavigation();$('navStatus').textContent='Simulazione completata';toast('Simulazione completata')}}tick();simulation=setInterval(tick,700);$('stopNav').disabled=false;$('startNav').disabled=true;$('demoBtn').disabled=true;toast('Simulazione attiva: non è la tua posizione reale');}
$('loadFeed').addEventListener('click',async()=>{const btn=$('loadFeed');btn.disabled=true;status('Download GTFS in corso…');try{const res=await fetch(FEED);if(!res.ok)throw Error('HTTP '+res.status);const blob=await res.blob();if(blob.size<1000)throw Error('File ZIP troppo piccolo');const f=await getGTFS(blob);handleFeed(f);saveZip(blob).catch(()=>{});toast('Dati caricati correttamente')}catch(err){status('Impossibile scaricare il feed: '+err.message+'. Importa ZIP manualmente.');toast('Download non riuscito (possibile blocco CORS o rete)')}finally{btn.disabled=false}});
$('fileFeed').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{status('Importazione ZIP…');const f=await getGTFS(file);handleFeed(f);saveZip(file).catch(()=>{});toast('GTFS importato')}catch(err){status('Errore importazione: '+err.message)}e.target.value=''});
$('extraFeed').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{status('Importazione GTFS aggiuntivo '+file.name+'…');const f=await getGTFS(file);handleFeed(f,true);toast('GTFS aggiuntivo integrato: '+file.name)}
 catch(err){status('Errore importazione GTFS aggiuntivo: '+err.message)}
 e.target.value='';
});
$('testVoice').addEventListener('click',()=>{resetVoiceGuidance();if(!$('voiceToggle').checked){toast('Attiva prima gli annunci vocali');return}if(!speak('Prova audio LineaPilot. Tra duecento metri, prossima fermata.','stop'))toast('Sintesi vocale non disponibile: controlla il volume e le impostazioni di Safari');});
$('voiceToggle').addEventListener('change',()=>{if(!$('voiceToggle').checked)resetVoiceGuidance()});
$('showRoute').addEventListener('click',selectTrip);$('startNav').addEventListener('click',startGPS);$('stopNav').addEventListener('click',()=>{stopNavigation();$('navStatus').textContent='Navigazione terminata'});$('demoBtn').addEventListener('click',startDemo);$('recenterBtn').addEventListener('click',()=>{if(lastFix)map.setView([lastFix.lat,lastFix.lng],16);else if(lineLayer)map.fitBounds(lineLayer.getBounds(),{padding:[50,50]})});
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('lineapilot-db',1);req.onupgradeneeded=()=>req.result.createObjectStore('feeds');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function saveZip(blob){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('feeds','readwrite');tx.objectStore('feeds').put(blob,'biv');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
async function restoreZip(){try{const db=await openDB();const blob=await new Promise((resolve,reject)=>{const tx=db.transaction('feeds','readonly');const req=tx.objectStore('feeds').get('biv');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});db.close();if(blob){status('Ripristino dati salvati…');handleFeed(await getGTFS(blob));toast('GTFS recuperato dalla memoria del dispositivo')}}catch(err){console.warn('Cache GTFS:',err)}}
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
restoreZip();
loadAcademy();
