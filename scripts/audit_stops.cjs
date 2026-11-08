#!/usr/bin/env node
// Exercise the SAME browser matching code against every immutable Academy GPX.
const fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const app=fs.readFileSync('app.js','utf8');
function sourceOf(name){const m=new RegExp('(?:async )?function\\s+'+name+'\\s*\\(').exec(app);if(!m)throw Error('Missing '+name);let a=app.indexOf('{',m.index),d=1,b=a+1;while(d&&b<app.length){if(app[b]==='{')d++;else if(app[b]==='}')d--;b++;}return app.slice(m.index,b)}
const names=['normAcademyCode','academyRouteCodes','gtfsFitsAcademyCode','evaluateGtfsSegment','candidateGtfsSegments','samePhysicalStop','stopSequenceKey','hasStopInSequence','variantStopNames','variantSignature','uniqueAcademyVariants','buildAcademyMatches','matchStopsStrict','metres','project','shapeMetrics','nearestOnShape'];
const input=process.argv[2]||'investigation/feed.json',output=process.argv[3]||'reports/stop-coverage.json';
const raw=fs.readFileSync(input),data=JSON.parse(raw);
const stopsById=new Map(data.stops.map(s=>[s.stop_id,{...s,lat:+s.stop_lat,lng:+s.stop_lon}]));
const routes=data.routes.map(r=>({...r,_stopAuthority:'busitalia'})),routesById=new Map(routes.map(r=>[r.route_id,r]));
const tripsByRoute=new Map(),timesByTrip=new Map(),shapesById=new Map();
for(const t of data.trips){if(!tripsByRoute.has(t.route_id))tripsByRoute.set(t.route_id,[]);tripsByRoute.get(t.route_id).push(t)}
for(const s of data.stop_times){if(!timesByTrip.has(s.trip_id))timesByTrip.set(s.trip_id,[]);timesByTrip.get(s.trip_id).push({stop:stopsById.get(s.stop_id),seq:+s.stop_sequence,arrival:s.arrival_time,departure:s.departure_time})}
for(const ss of timesByTrip.values())ss.sort((a,b)=>a.seq-b.seq);
const feed={routes,routesById,tripsByRoute,timesByTrip,stopsById,shapesById};
const api=new Function('feed','RouteStops',`const rad=Math.PI/180;${names.map(sourceOf).join('\n')};return {${names.join(',')}}`)(feed,require('../route-stops.js'));
const gpx=fs.readFileSync('official-routes.json'),catalog=[...JSON.parse(gpx),...JSON.parse(fs.readFileSync('academy-supplemental-routes.json'))],rows=[];
const evidence=JSON.parse(fs.readFileSync('academy-evidence.json'));for(const r of catalog)r._evidence=evidence.routes[String(r.id)];
for(const r of catalog){
 const found=api.buildAcademyMatches(r),matches=api.uniqueAcademyVariants(found.results);
 const complete=matches.filter(m=>!m.reviewRequired);
 const row={id:r.id,category:r.category,line:r.line,name:r.name,status:r._evidence?.serviceStatus==='out-of-service'?'out-of-service':complete.length?'full-sequence':matches.length?'review-required':'missing',variants:matches.length,candidateSequences:found.groupCount,compatibleSegments:found.segments,broadSearch:!!found.broad,
  proposals:matches.map(m=>({tripId:m.trip.trip_id,route:feed.routesById.get(m.trip.route_id).route_short_name,association:m.association,reviewRequired:!!m.reviewRequired,
   gpxSpanCoverage:Math.round(m.coverage*10000)/100,meanDeviationM:Math.round(m.averageError*10)/10,endpointExceptions:m.match.endpointExceptions||0,omittedStops:m.omittedStops||[],
   stops:m.stops.map((s,i)=>({id:s.stop.stop_id,name:s.stop.stop_name,lat:s.stop.lat,lng:s.stop.lng,alongM:Math.round(m.match.offsets[i]||0)}))}))};
 rows.push(row);
 if(rows.length%50===0)console.log('Stop audit',rows.length+'/'+catalog.length);
}
const usedStops={};
for(const row of rows)for(const proposal of row.proposals){
 for(const stop of proposal.stops)usedStops[stop.id]={name:stop.name,lat:stop.lat,lng:stop.lng};
 proposal.stopIds=proposal.stops.map(s=>s.id);proposal.offsetsM=proposal.stops.map(s=>s.alongM);delete proposal.stops;
}
const report={sourceMetadata:data._source||{retrievedAt:'2026-11-08',snapshot:true},stops:usedStops,generatedAt:new Date().toISOString(),source:'Busitalia Veneto GTFS (BusOne mirror)',sourceURL:'https://proxy.busone.app/biv/gtfs.zip',feedSHA256:crypto.createHash('sha256').update(raw).digest('hex'),gpxSHA256:crypto.createHash('sha256').update(gpx).update(Buffer.from([0])).update(fs.readFileSync('academy-supplemental-routes.json')).digest('hex'),
 summary:{routes:rows.length,fullSequence:rows.filter(x=>x.status==='full-sequence').length,reviewRequired:rows.filter(x=>x.status==='review-required').length,outOfService:rows.filter(x=>x.status==='out-of-service').length,missing:rows.filter(x=>x.status==='missing').length},routes:rows};
fs.mkdirSync(require('path').dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report)+'\n');
if(!fs.readFileSync('official-routes.json').equals(gpx))throw Error('Official GPX changed');
const csvQuote=x=>'"'+String(x??'').replaceAll('"','""')+'"';
const csv=[['GPX_ID','Categoria','Linea','Percorso','Stato','Varianti','Fermate_migliore_proposta','Copertura_span_GPX_percento','Associazione','GTFS_linea','GTFS_corsa','Fermate_GTFS_escluse']];
for(const r of rows){const p=r.proposals[0];csv.push([r.id,r.category,r.line,r.name,r.status,r.variants,p?.stopIds.length||0,p?.gpxSpanCoverage||0,p?.association||'',p?.route||'',p?.tripId||'',(p?.omittedStops||[]).join(' | ')])}
fs.writeFileSync(output.replace(/\.json$/,'.csv'),'\uFEFF'+csv.map(r=>r.map(csvQuote).join(',')).join('\n')+'\n');
console.log(JSON.stringify(report.summary));
module.exports={api,feed,report};
