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
  // Lines without a number of their own (Deviazioni mercatali, Colli 1061…):
  // the Academy evidence first, then the polimetrica whose stops the GPX serves.
  if(!codes.length)codes=evidenceLines(route).map(c=>polimetricaCode(c,index)).filter(Boolean);
  if(!codes.length)codes=servedLines(data,route);
  return [...new Set(codes)].map(c=>index.get(c));
 }
 /** GTFS/Academy code → polimetrica code: E005V → E005, E0092 → E009, EA → A. */
 function polimetricaCode(code,index){
  const c=String(code||'').trim().toUpperCase();
  if(index.has(c))return c;
  const m=/^E(\d{3})/.exec(c);
  if(m&&index.has('E'+m[1]))return 'E'+m[1];
  if(/^E[A-Z]+$/.test(c)&&index.has(c.slice(1)))return c.slice(1);
  return null;
 }
 /** Lines named by the Academy indicators, then by the duty sheets (most frequent first). */
 function evidenceLines(route){
  const ev=route?._evidence;if(!ev)return [];
  const counts=new Map();
  for(const s of ev.shiftMatches||[])if(s?.line)counts.set(s.line,(counts.get(s.line)||0)+1);
  return [...(ev.lineAliases||[]),...[...counts].sort((a,b)=>b[1]-a[1]).map(([c])=>c)];
 }
 const plain=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
 /** Last resort: polimetrica lines with at least 3 fare nodes on this GPX (within 300 m)
     or named in its title. The best one, with any tie. */
 function servedLines(data,route){
  const pts=Array.isArray(route?.points)?route.points:[];
  if(!pts.length)return [];
  const words=new Set(plain(route.name).split(' '));
  const scored=[];
  for(const l of data.lines){
   let n=0;
   for(const s of l.stops){
    const key=plain(s[0]).split(' ').find(w=>w.length>=4&&w!=='PONTE');
    let hit=!!key&&words.has(key);
    for(let k=0;!hit&&s.length>=3&&k<pts.length;k++)hit=metres(s[1],s[2],pts[k][0],pts[k][1])<300;
    if(hit)n++;
   }
   if(n>=3)scored.push({code:l.code,n,share:n/l.stops.length});
  }
  scored.sort((a,b)=>b.n-a.n||b.share-a.share);
  return scored.filter(x=>x.n===scored[0].n).slice(0,3).map(x=>x.code);
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
 return {NEAREST_LIMIT,suggestedLines,nearestStop,fare,lineLabel,metres,evidenceLines};
});
