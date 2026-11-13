/* On-board ticket calculator: Busitalia Padova polimetriche (fares/polimetriche-padova.json).
   Pure functions shared by the web app and the tests; iOS and Android receive the
   same data plus the suggested lines in the native route payload. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Tickets=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const rad=Math.PI/180;
 /** Boarding is suggested only when a fare node is this close to the bus. */
 const NEAREST_LIMIT=6000;
 // Academy Colli variants that run on a polimetrica of another code.
 const ALIASES={TD:['T','TL'],AB:['A','AT'],MLA:['M']};

 function metres(lat1,lng1,lat2,lng2){
  const y=(lat2-lat1)*111320,x=(lng2-lng1)*111320*Math.cos((lat1+lat2)/2*rad);
  return Math.hypot(x,y);
 }
 /** Polimetrica lines for an Academy route, best first (indexes into data.lines). */
 function suggestedLines(data,route){
  if(!data?.lines||!route)return [];
  const line=String(route.line||'').trim().toUpperCase(),name=String(route.name||'').toUpperCase();
  const index=new Map(data.lines.map((l,i)=>[l.code,i]));
  let codes=[];
  // Urban lines have no polimetrica: the driver can still pick one by hand.
  if(/^urban/i.test(String(route.category||'')))return [];
  if(/^\d{1,3}$/.test(line)){
   const base='E'+line.padStart(3,'0');
   codes=data.lines.map(l=>l.code).filter(c=>c===base||(c.startsWith(base)&&/^[A-Z]$/.test(c.slice(base.length))));
   // Line 19 also has the separate E019A polimetrica for the Liceo Galilei trips.
   if(/LICEO\s+GALI/.test(name))codes.sort((a,b)=>(b!==base)-(a!==base));
  }else if(index.has(line))codes=[line];
  else if(ALIASES[line])codes=ALIASES[line].filter(c=>index.has(c));
  return codes.map(c=>index.get(c));
 }
 /** Nearest fare node with a known position, or -1. */
 function nearestStop(line,lat,lng,limit=NEAREST_LIMIT){
  if(!line||!Number.isFinite(lat)||!Number.isFinite(lng))return -1;
  let best=-1,bestDistance=Infinity;
  line.stops.forEach((s,i)=>{
   if(s.length<3)return;
   const d=metres(lat,lng,s[1],s[2]);
   if(d<bestDistance){best=i;bestDistance=d}
  });
  return bestDistance<=limit?best:-1;
 }
 /** Fare between two stop indexes of a line (order does not matter). */
 function fare(data,line,from,to){
  if(!data||!line||!(from>=0)||!(to>=0)||from>=line.stops.length||to>=line.stops.length)return null;
  const code=line.fares[Math.max(from,to)]?.[Math.min(from,to)];
  if(code==null)return null;
  // note: how to sell it on board (e.g. which tickets to combine), may be ''.
  return {code,text:data.labels[code]??data.labels[''],note:data.notes?.[code]||''};
 }
 function lineLabel(line){return line.code+' · '+line.title}
 return {NEAREST_LIMIT,suggestedLines,nearestStop,fare,lineLabel,metres};
});
