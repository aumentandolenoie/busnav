/* LineaPilot Turni experimental UI.
 * PDF text supplies schedules/turn identifiers ONLY, not verified full stop lists.
 * Original Academy GPX remains the sole navigated path; Busitalia GTFS supplies stops.
 */
'use strict';
const WINTER_DATA_KEY='lineapilot-winter-pdf-catalog-v1';
const WINTER_CHOICES_KEY='lineapilot-winter-explicit-associations-v1';
let winterCatalog=[],winterSelection=null,winterOptions=[],winterSelectedLeg=null,winterGpxCandidates=[];
let winterRun=0;
const winterEl=id=>document.getElementById(id);
function winterCategoryForLine(code){
 const value=String(code||'').trim().toUpperCase();
 if(/^E\d{3}/.test(value))return 'Extraurbano';
 if(['A','AT','M','T','TL'].includes(value))return 'Colli';
 if(/^U\d{1,2}$/.test(value)||/^\d{1,2}[A-Z]?$/.test(value))return 'Urbano';
 return '';
}
function winterValidCatalog(rows){
 if(!Array.isArray(rows)||rows.length<1||rows.length>2000)return false;
 return rows.every(row=>
  Array.isArray(row)&&row.length===4&&['F','S','D'].includes(row[0])&&
  /^P\d{3}$/.test(row[1])&&typeof row[2]==='string'&&row[2].length<120&&
  Array.isArray(row[3])&&row[3].length<=100&&row[3].every(leg=>
   Array.isArray(leg)&&leg.length>=4&&leg.length<=6&&
   /^\d\d:\d\d$/.test(leg[0])&&/^\d\d:\d\d$/.test(leg[1])&&
   typeof leg[2]==='string'&&leg[2].length<200&&
   typeof leg[3]==='string'&&leg[3].length<25&&
   (leg[4]===undefined||typeof leg[4]==='string')&&
   (leg[5]===undefined||Number.isInteger(leg[5]))
  ));
}
function winterSafeStore(key,value){
 try{localStorage.setItem(key,value);return true}catch(err){console.warn('Memoria turni non disponibile:',err);return false}
}
function winterSaved(){
 try{
  const value=JSON.parse(localStorage.getItem(WINTER_CHOICES_KEY)||'{}');
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 }catch{return {}}
}
function winterSig(entry){
 const [day,p,depot]=entry;
 const leg=winterSelectedLeg;
 return [day,p,depot,leg?.[3]||'',leg?.[2]||'',leg?.[4]||''].join('||');
}
function winterNorm(v){
 return String(v||'').toLocaleUpperCase('it').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]+/g,' ').trim();
}
function winterParts(value){
 return winterNorm(value).split(/\s+/).filter(x=>x.length>=3&&
  !['PADOVA','AUTOSTAZIONE','FERROVIA','LINEA','CIRCOLARE','ISTITUTO','DIRETTA','CORSA','CENTRO'].includes(x));
}
function winterRank(route,leg){
 const query=winterParts(leg[2]);
 const haystack=new Set(winterParts([route.name,route.filename,route.variant].join(' ')));
 return query.filter(s=>haystack.has(s)).length;
}
function winterLineFamily(raw){
 const text=String(raw||'').toUpperCase().trim();
 // E060-V and E060-Z are distinct scheduled legs; only their common E060
 // family is used to discover Academy candidates (never to certify variant).
 const match=/^E(\d{3})(?:-[VZ])?$/.exec(text);
 return normAcademyCode(match?'E'+match[1]:text);
}
function winterNormalizedRouteName(route){
 return winterNorm(academyTrackTitle(route));
}
function winterInternalTitle(route){
 return winterNorm(String(route.name||'').replace(/^\s*\d{2,5}\s*[|·-]\s*/,''));
}
function winterAcademyTitlesConsistent(route){
 // Conflicting geographic descriptions in the GPX filename and embedded
 // track metadata always require manual review.
 return winterNormalizedRouteName(route)===winterInternalTitle(route);
}
function winterExactAcademyMatches(cat,leg,candidates){
 const target=winterNorm(leg[2]);
 if(!target||!cat||String(leg[4]||'').trim())return [];
 return candidates.filter(x=>winterAcademyTitlesConsistent(x.route)&&
  winterNormalizedRouteName(x.route)===target);
}
function winterRouteMatches(cat,leg){
 const code=winterLineFamily(leg[3]);
 if(!code)return [];
 const candidates=academy.filter(route=>route.category===cat&&
  [...academyRouteCodes(route)].some(candidate=>candidate===code||
   // GTFS/Academy codes can differ by prefix E/U but must keep same line family.
   normAcademyCode(candidate)===code));
 return candidates.map(route=>({route,score:winterRank(route,leg)}))
  .sort((a,b)=>b.score-a.score||a.route.name.localeCompare(b.route.name,'it'));
}
function winterClearActiveRoute(){
 ++winterRun;
 if(current){stopNavigation();current=null}
 selectedOfficial=null;
 turns=[];
 winterEl('startNav').disabled=true;
 winterEl('demoBtn').disabled=true;
 winterEl('stopNav').disabled=true;
 winterEl('nextDetail').textContent='Scegli una corsa invernale e verifica il GPX Academy.';
}
function winterStatus(message,problem=false){
 winterEl('winterMappingStatus').textContent=message;
 winterEl('winterMappingStatus').dataset.problem=problem?'yes':'no';
}
function winterRefresh(){
 winterClearActiveRoute();
 winterSelection=null;winterSelectedLeg=null;winterOptions=[];winterGpxCandidates=[];
 winterEl('winterGpxWrap').hidden=true;
 winterEl('winterJourneyWrap').hidden=true;
 winterEl('winterJourneyInfo').textContent='';
 winterStatus('Seleziona tipo di servizio, giornata e codice turno.');
 const cat=winterEl('winterCategory').value;
 winterEl('winterDay').disabled=!cat;
 if(!cat){setOptions(winterEl('winterTurn'),[],'Scegli prima il giorno…');return}
 winterRefreshTurns();
}
function winterRefreshTurns(){
 winterClearActiveRoute();
 const cat=winterEl('winterCategory').value,day=winterEl('winterDay').value;
 setOptions(winterEl('winterTurn'),[],'Scegli un codice turno…');
 setOptions(winterEl('winterJourney'),[],'Scegli un turno…');
 winterEl('winterJourneyWrap').hidden=true;
 winterEl('winterGpxWrap').hidden=true;
 if(!cat||!day)return;
 winterOptions=winterCatalog.filter(row=>row[0]===day&&row[3].some(leg=>winterCategoryForLine(leg[3])===cat));
 const choices=winterOptions.map((row,i)=>[String(i),row[1]+' · '+row[2]]).sort((a,b)=>a[1].localeCompare(b[1],'it',{numeric:true}));
 setOptions(winterEl('winterTurn'),choices,'Scegli turno P001, P002…');
 winterEl('winterStatus').textContent=choices.length+
  ' turni del PDF disponibili per '+cat+' / '+({F:'feriale',S:'sabato',D:'festivo'}[day])+'.';
 if(!choices.length)winterStatus('Il PDF non contiene corse classificate per questi filtri. Usa la scelta manuale Academy.',true);
}
function winterRefreshJourneys(){
 winterClearActiveRoute();
 winterSelectedLeg=null;winterEl('winterGpxWrap').hidden=true;
 const idx=Number(winterEl('winterTurn').value);
 winterSelection=winterEl('winterTurn').value!==''?winterOptions[idx]:null;
 if(!winterSelection){winterEl('winterJourneyWrap').hidden=true;return}
 const cat=winterEl('winterCategory').value;
 const grouped=new Map();
 for(const leg of winterSelection[3]){
  if(winterCategoryForLine(leg[3])!==cat)continue;
  // Same route and notes at multiple departure times is one path choice.
  const signature=[winterNorm(leg[2]),winterNorm(leg[3]),winterNorm(leg[4]||'')].join('|');
  if(!grouped.has(signature))grouped.set(signature,{leg,times:[]});
  grouped.get(signature).times.push(leg[0]);
 }
 const list=[...grouped.values()];
 winterEl('winterJourneyWrap').hidden=list.length<=1;
 setOptions(winterEl('winterJourney'),list.map((item,i)=>
  [String(i),item.leg[3]+' · '+item.leg[2]+
   (item.leg[4]?' · ⚠ Nota PDF':'')]),'Scegli il percorso del turno…');
 winterEl('winterJourney')._winterRoutes=list;
 if(list.length===1){
  winterEl('winterJourney').value='0';
  winterSelectJourney();
 }else{
  winterEl('winterJourneyInfo').textContent=list.length+' percorsi differenti: scegli in base alla corsa e alle eventuali deviazioni.';
  winterStatus('Il turno comprende più percorsi: seleziona quello da effettuare.');
 }
}
function winterSelectJourney(){
 winterClearActiveRoute();
 if(!winterSelection)return;
 const idx=Number(winterEl('winterJourney').value);
 const item=winterEl('winterJourney')._winterRoutes?.[idx];
 if(!item)return;
 winterSelectedLeg=item.leg;
 const [start,end,desc,line,note,page]=item.leg;
 winterEl('winterJourneyInfo').textContent='Linea '+line+' · '+start+'–'+end+
  (item.times.length>1?' · altre partenze: '+item.times.slice(1,8).join(', '):'')+
  (note?' · ⚠ Nota PDF da verificare: '+note:'')+' · pag. '+(page||'—');
 winterGpxCandidates=winterRouteMatches(winterEl('winterCategory').value,item.leg);
 const saved=winterSaved()[winterSig(winterSelection)];
 const savedRoute=winterGpxCandidates.find(x=>
   String(x.route.id)===String(saved?.academyId)&&
   saved?.academyFingerprint===academyFingerprint(x.route.points));
 const exact=winterExactAcademyMatches(winterEl('winterCategory').value,item.leg,winterGpxCandidates);
 winterEl('winterGpxWrap').hidden=winterGpxCandidates.length<=1&&!exact.length;
 setOptions(winterEl('winterGpx'),winterGpxCandidates.map(x=>[
  String(x.route.id),academyDisplayName(x.route)+(x.score?' · '+x.score+' località in comune':'')
 ]),'Scegli GPX ufficiale corrispondente…');
 let picked=savedRoute?.route||null;
 // Never select by "best" text similarity: only one EXACT PDF↔GPX name
 // within the same category and line may be auto-associated.
 // GPX 1278 is safely identified here as "Padova - Aeroporto Marco Polo".
 if(!picked&&exact.length===1)picked=exact[0].route;
 if(!picked){
  winterEl('winterGpxWrap').hidden=false;
  winterStatus(String(item.leg[4]||'').trim()?
   'Nota o deviazione nel PDF: verifica manualmente il tracciato GPX ufficiale prima di confermare.':
   winterGpxCandidates.length?
   'PDF e codice linea non permettono un abbinamento univoco: verifica il GPX Academy prima di navigare.':
   'Non ho trovato GPX Academy con la stessa linea. Non creo percorsi alternativi.',true);
  winterEl('winterManual').open=true;
  return;
 }
 winterEl('winterGpx').value=String(picked.id);
 winterUseAcademy(picked);
}
function winterSelectGpx(){
 const found=winterGpxCandidates.find(x=>String(x.route.id)===winterEl('winterGpx').value);
 if(found)winterUseAcademy(found.route,true);
}
function winterVariantVerifiedByGTFS(match,leg){
 const expected=/-([VZ])$/i.exec(String(leg[3]||''));
 if(!expected)return true;
 // V/Z are distinct PDF itineraries. The GPX and the geometric match alone
 // cannot prove which one is running unless GTFS explicitly labels it.
 return match.legs.every(part=>{
  const route=feed?.routesById.get(part.trip.route_id);
  const label=String(route?.route_short_name||route?.route_long_name||'').toUpperCase();
  return new RegExp('(?:^|[^A-Z0-9])E?0*\\d{1,3}[- ]'+expected[1]+'(?:$|[^A-Z0-9])').test(label);
 });
}
function winterEndpointsAgree(leg,stops){
 if(stops.length<2)return false;
 const description=winterNorm(leg[2]);
 const first=winterNorm(stops[0].stop?.stop_name||'');
 const last=winterNorm(stops.at(-1).stop?.stop_name||'');
 const strong=s=>s.split(' ').filter(w=>w.length>=5);
 const a=strong(first).some(w=>description.includes(w));
 const b=strong(last).some(w=>description.includes(w));
 return a&&b;
}
function winterUseAcademy(route,explicit=false){
 if(!winterSelection||!winterSelectedLeg)return;
 const token=++winterRun;
 const id=String(route.id);
 selectedOfficial=route;
 resetAcademyGtfs();
 showAcademyRoute(false); // ORIGINAL Academy geometry, never GTFS-derived.
 const key=winterSig(winterSelection),saved=winterSaved()[key];
 const fingerprint=academyFingerprint(route.points);
 const previouslyConfirmed=String(saved?.academyId)===id&&saved?.academyFingerprint===fingerprint;
 const needsApproval=!explicit&&!previouslyConfirmed;
 if(explicit){
  const rows=winterSaved();
  const unchanged=previouslyConfirmed?saved:{};
  rows[key]={...unchanged,academyId:id,academyFingerprint:fingerprint};
  winterSafeStore(WINTER_CHOICES_KEY,JSON.stringify(rows));
 }
 if(needsApproval){
  // Matching a *name* is a suggestion, not proof of bus-service equivalence.
  // Never enable GPS navigation until GTFS validates it or the driver confirms.
  winterEl('startNav').disabled=true;
  winterEl('demoBtn').disabled=true;
 }
 winterStatus('GPX Academy: '+academyDisplayName(route)+'. Verifica della sequenza fermate GTFS Busitalia…');
 if(!feed){
  if(needsApproval){
   winterEl('winterGpxWrap').hidden=false;
   winterEl('winterGpx').value='';
   winterStatus('GPX proposto da PDF e nome file, ma senza GTFS non è verificato: confermalo nel menu prima di navigare.',true);
  }else winterStatus('GPX Academy confermato. GTFS non ancora disponibile: navigazione senza annunci fermate.');
  return;
 }
 try{
  const matches=uniqueAcademyVariants(buildAcademyMatches(route).results);
  if(token!==winterRun||String(selectedOfficial?.id)!==id)return;
  academyGtfsMatches=new Map(matches.map((x,i)=>['academy-match-'+i,x]));
  setOptions(winterEl('academyGtfsTrip'),
   matches.map((x,i)=>['academy-match-'+i,variantFriendlyLabel(x,matches)]),
   'Scegli le fermate GTFS…');
  const stored=matches.find(x=>saved?.academyFingerprint===academyFingerprint(route.points)&&
   saved?.stopSignature===stopSequenceKey(x.stops));
  const verifiedSingle=matches.length===1&&!String(winterSelectedLeg[4]||'').trim()&&
   winterEndpointsAgree(winterSelectedLeg,matches[0].stops)&&
   winterVariantVerifiedByGTFS(matches[0],winterSelectedLeg);
  const confirmed=stored||(verifiedSingle?matches[0]:null);
  if(confirmed){
   const selected=[...academyGtfsMatches].find(([,x])=>x===confirmed);
   winterEl('academyGtfsTrip').value=selected[0];
   showAcademyRoute(true); // also performs original matchStopsStrict().
   if(current?.reliable&&String(current?.academy?.id)===id){
    winterStatus('Percorso Academy e fermate Busitalia associati. Navigazione pronta.');
    return;
   }
  }
  if(matches.length===1){
   winterEl('academyGtfsTrip').value='academy-match-0';
   winterEl('mergeOfficial').disabled=false;
  }
  renderAcademyStopComparison();
  refreshVariantPreview();
  if(needsApproval){
   winterEl('winterGpxWrap').hidden=false;
   winterEl('winterGpx').value='';
   winterEl('mergeOfficial').disabled=true;
   winterStatus('GPX proposto: il PDF non certifica automaticamente il tracciato. Seleziona e conferma il GPX corretto; il sistema ricorderà la scelta.',true);
   return;
  }
  winterStatus(matches.length?
   matches.length+' sequenze GTFS compatibili. Controlla e conferma le fermate nella sezione manuale.':
   'GTFS non contiene una sequenza completa compatibile: GPS sul GPX disponibile, annunci fermate disabilitati.',true);
  winterEl('winterManual').open=true;
 }catch(err){
  if(needsApproval){
   winterEl('winterGpxWrap').hidden=false;
   winterEl('winterGpx').value='';
  }
  winterStatus('Impossibile associare le fermate: '+err.message+'. Il percorso Academy resta solo una proposta finché non confermato.',true);
  winterEl('winterManual').open=true;
 }
}
function winterResetImportState(){
 winterCatalog=[];
 winterRefresh();
 winterEl('winterStatus').textContent='Nessun catalogo PDF importato. Apri “Importazione iniziale catalogo PDF” per caricarlo.';
 winterEl('winterTurn').disabled=true;
}
async function winterImportFile(file){
 if(!file||file.size>5_000_000)throw Error('File mancante o troppo grande (max 5 MB)');
 const rows=JSON.parse(await file.text());
 if(!winterValidCatalog(rows))throw Error('Il file non è il catalogo PDF dei turni previsto');
 winterCatalog=rows;
 const persisted=winterSafeStore(WINTER_DATA_KEY,JSON.stringify(rows));
 winterEl('winterStatus').textContent=rows.length+' schede turno aggiornate dai PDF (2026/27). '+
  (persisted?'Catalogo salvato sul dispositivo.':'Memoria non disponibile: reimportare al prossimo avvio.');
 winterRefreshTurns();
}
winterEl('winterCategory').addEventListener('change',winterRefresh);
winterEl('winterDay').addEventListener('change',winterRefreshTurns);
winterEl('winterTurn').addEventListener('change',winterRefreshJourneys);
winterEl('winterJourney').addEventListener('change',winterSelectJourney);
winterEl('winterGpx').addEventListener('change',winterSelectGpx);
winterEl('winterImport').addEventListener('change',async event=>{
 try{await winterImportFile(event.target.files?.[0])}
 catch(err){winterStatus('Errore importazione PDF: '+err.message,true)}
});
winterEl('winterClear').addEventListener('click',()=>{
 try{localStorage.removeItem(WINTER_DATA_KEY);localStorage.removeItem(WINTER_CHOICES_KEY)}catch{}
 winterLoadBundled(); // Reset any override, restore the bundled official-PDF extract.
});
winterEl('mergeOfficial').addEventListener('click',()=>{
 if(!winterSelection||!winterSelectedLeg||!current?.reliable||
  String(current?.academy?.id)!==String(selectedOfficial?.id))return;
 const match=academyGtfsMatches.get(winterEl('academyGtfsTrip').value);
 if(!match)return;
 const saved=winterSaved();
 saved[winterSig(winterSelection)]={
  academyId:String(selectedOfficial.id),
  academyFingerprint:academyFingerprint(selectedOfficial.points),
  stopSignature:stopSequenceKey(match.stops)
 };
 winterSafeStore(WINTER_CHOICES_KEY,JSON.stringify(saved));
 winterStatus('Fermate verificate e associazione salvata: non sarà necessario riselezionarle sullo stesso dispositivo.');
});
window.addEventListener('lineapilot:academy-ready',()=>{
 if(winterSelection&&winterSelectedLeg&&!selectedOfficial)winterSelectJourney();
});
window.addEventListener('lineapilot:gtfs-ready',()=>{
 if(winterSelection&&winterSelectedLeg&&selectedOfficial)winterUseAcademy(selectedOfficial);
});
async function winterLoadBundled(){
 // An explicitly imported correction takes precedence over the bundled extract.
 try{
  const stored=JSON.parse(localStorage.getItem(WINTER_DATA_KEY)||'null');
  if(winterValidCatalog(stored)){
   winterCatalog=stored;
   winterEl('winterStatus').textContent=stored.length+' turni invernali: correzione locale applicata al catalogo incluso.';
   winterRefreshTurns();
   return;
  }
 }catch{}
 try{
  let rows;
  if(nativeMode){
   rows=await new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('GET','./winter-turns.json',true);
    xhr.onload=()=>{if(xhr.status!==0&&(xhr.status<200||xhr.status>=300)){reject(Error('HTTP '+xhr.status));return}
     try{resolve(JSON.parse(xhr.responseText))}catch(e){reject(e)}};
    xhr.onerror=()=>reject(Error('File di turni integrato non accessibile'));xhr.send();
   });
  }else{
   const response=await fetch('./winter-turns.json');
   if(!response.ok)throw Error('HTTP '+response.status);
   rows=await response.json();
  }
  if(!winterValidCatalog(rows))throw Error('Catalogo integrato non valido');
  winterCatalog=rows;
  winterEl('winterStatus').textContent=rows.length+' turni invernali 2026/27 dal PDF integrato. Nessuna importazione necessaria.';
  winterRefreshTurns();
  return;
 }catch(err){
  console.warn('Catalogo PDF integrato non disponibile:',err);
 }
 try{
  const saved=JSON.parse(localStorage.getItem(WINTER_DATA_KEY)||'null');
  if(winterValidCatalog(saved)){
   winterCatalog=saved;
   winterEl('winterStatus').textContent=saved.length+' turni PDF recuperati dalla memoria locale.';
   winterRefreshTurns();
   return;
  }
 }catch{}
 winterResetImportState();
}
winterLoadBundled();
