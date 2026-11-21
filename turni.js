/* Driver shifts (turni.json): find a shift, pick the GPX of each trip, follow
   the shift trip by trip. Shared by the web app and, through it, iOS and Android. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Turni=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const DRIVEN=new Set(['service','empty']);

 // Easter Sunday (Gregorian computus), for Pasquetta.
 function easter(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
   h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
   month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(year,month-1,day);
 }
 /** 'weekday' | 'saturday' | 'holiday' for a date (Italian holidays and Padova's patron, 13 June). */
 function dayFor(date){
  const d=new Date(date.getFullYear(),date.getMonth(),date.getDate()),md=(d.getMonth()+1)+'-'+d.getDate();
  const fixed=new Set(['1-1','1-6','4-25','5-1','6-2','6-13','8-15','11-1','12-8','12-25','12-26']);
  const monday=easter(d.getFullYear());monday.setDate(monday.getDate()+1);
  if(d.getDay()===0||fixed.has(md)||d.getTime()===monday.getTime())return 'holiday';
  return d.getDay()===6?'saturday':'weekday';
 }
 /** 'p85', '85', 'P085 ' → 'P085'. */
 function code(query){
  const m=/^\s*([a-z]?)\s*0*(\d{1,4})\s*$/i.exec(String(query||''));
  return m?(m[1]||'P').toUpperCase()+m[2].padStart(3,'0'):String(query||'').trim().toUpperCase();
 }
 function find(data,day,query){
  const shifts=data?.days?.[day]?.shifts||{},key=code(query);
  return shifts[key]?{code:key,day,...shifts[key]}:null;
 }
 /** Shift codes starting like the query, for suggestions. */
 function suggest(data,day,query,limit=6){
  const q=String(query||'').trim().toUpperCase().replace(/^P?0*/,'');
  if(!q)return [];
  return Object.keys(data?.days?.[day]?.shifts||{}).filter(k=>k.replace(/^P0*/,'').startsWith(q)).slice(0,limit);
 }
 const driven=leg=>DRIVEN.has(leg?.kind);
 function legKey(leg){return [leg.line,leg.desc,leg.dep].join('|')}
 function tripKey(leg){return [leg.line,leg.desc].join('|')}
 /** GPX id for a trip: the driver's earlier choice, the sure match, or null. */
 function routeFor(leg,choices={}){
  if(!driven(leg))return null;
  const saved=choices[legKey(leg)]??choices[tripKey(leg)];
  if(Number.isInteger(saved))return saved;
  return Number.isInteger(leg.route)?leg.route:null;
 }
 /** 'needs-choice' when several GPX fit, 'missing' when none, else 'ok'. */
 function legState(leg,choices={}){
  if(!driven(leg))return 'info';
  if(routeFor(leg,choices)!==null)return 'ok';
  return leg.options?.length?'needs-choice':'missing';
 }
 function minutes(hhmm){const m=/^(\d{1,2})[:.](\d{2})/.exec(String(hhmm||''));return m?+m[1]*60+ +m[2]:null}
 function duration(min){
  if(!Number.isFinite(min))return '';
  const h=Math.floor(min/60),m=Math.round(min%60);
  return h?h+' h'+(m?' '+m+' min':''):m+' min';
 }
 function nextDriven(shift,from){
  for(let i=from+1;i<shift.legs.length;i++)if(driven(shift.legs[i]))return i;
  return -1;
 }
 function firstDriven(shift){return nextDriven(shift,-1)}
 /** Short summary of a shift: start, end, trips, vehicles, longest pause. */
 function summary(shift){
  const legs=shift.legs,trips=legs.filter(driven);
  const vehicles=[...new Set(legs.map(l=>l.vehicle).filter(Boolean))];
  let pause=0;
  for(let i=1;i<legs.length;i++){const gap=minutes(legs[i].dep)-minutes(legs[i-1].arr);if(gap>pause)pause=gap}
  return {start:legs[0]?.dep||'',end:legs.at(-1)?.arr||'',trips:trips.length,vehicles,pause};
 }
 /** Things to do between two driven trips: transfers, vehicle change, standby. */
 function between(shift,from,to){
  const out=[],legs=shift.legs;
  for(let i=from+1;i<to;i++)out.push(legs[i]);
  const before=legs[from]?.vehicle,after=legs[to]?.vehicle;
  return {legs:out,vehicleChange:before&&after&&before!==after?after:null};
 }
 /** Among candidate GPX, the one that passes by the stops of the GTFS trip
     leaving at this time (distance(stop, routeId) in metres is provided by the app). */
 function pickByStops(options,stops,distance){
  if(!options?.length||!stops?.length)return null;
  const scored=options.map(id=>({id,share:stops.filter(s=>distance(s,id)<=70).length/stops.length})).sort((a,b)=>b.share-a.share);
  const [best,second]=scored;
  return best.share>=.9&&(!second||best.share-second.share>=.1)?best.id:null;
 }
 return {dayFor,code,find,suggest,driven,legKey,tripKey,routeFor,legState,minutes,duration,nextDriven,firstDriven,summary,between,pickByStops};
});
