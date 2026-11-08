/* Ordered GTFS-to-GPX alignment. Does not reverse trips or modify the GPX. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RouteStops=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const rad=Math.PI/180;
 const cache=new WeakMap();
 function distance(a,b){const y=(b.lat-a.lat)*111320,x=(b.lng-a.lng)*111320*Math.cos((a.lat+b.lat)/2*rad);return Math.hypot(x,y)}
 function projections(stop,points,dists){
  let byStop=cache.get(points);if(!byStop){byStop=new Map();cache.set(points,byStop)}
  const key=[stop.stop_id,stop.lat,stop.lng].join(':');if(byStop.has(key))return byStop.get(key);
  const hits=[];let nearest={d:Infinity,along:0};
  for(let i=0;i<points.length-1;i++){
   const a=points[i],b=points[i+1],scale=111320*Math.cos((stop.lat+a.lat)/2*rad);
   const x=(b.lng-a.lng)*scale,y=(b.lat-a.lat)*111320,px=(stop.lng-a.lng)*scale,py=(stop.lat-a.lat)*111320;
   const t=x*x+y*y?Math.max(0,Math.min(1,(px*x+py*y)/(x*x+y*y))):0;
   const hit={d:Math.hypot(px-x*t,py-y*t),along:dists[i]+t*(dists[i+1]-dists[i])};
   if(hit.d<nearest.d)nearest=hit;
   if(hit.d<=160)hits.push(hit);
  }
  // Collapse neighbouring segment projections, but retain different visits to
  // a repeated stop. Greedy nearest-only matching loses loops and turnbacks.
  hits.sort((a,b)=>a.d-b.d);
  const candidates=[];for(const hit of hits)if(!candidates.some(x=>Math.abs(x.along-hit.along)<35))candidates.push(hit);
  candidates.sort((a,b)=>a.along-b.along);
  const value={candidates,nearest};byStop.set(key,value);return value;
 }
 function match(stops,points,dists){
  const total=dists.at(-1)||0;
  const fail=reason=>({ok:false,offsets:[],errors:[],reason,message:'Associazione rifiutata: '+reason});
  if(stops.length<2||points.length<2||total<5)return fail('sequenza o GPX troppo breve');
  let layers=[];
  for(let i=0;i<stops.length;i++){
   const stop=stops[i].stop;if(!stop||!Number.isFinite(stop.lat)||!Number.isFinite(stop.lng))return fail('coordinate fermata non valide');
   const base=projections(stop,points,dists);
   let choices=base.candidates.map(h=>({...h,endpoint:
    i===0&&h.along<=50&&distance(stop,points[0])<=250||
    i===stops.length-1&&total-h.along<=50&&distance(stop,points.at(-1))<=250}));
   // Only the first/last GTFS stop may use this bounded terminal exception.
   // Its REAL coordinate is preserved; only the announcement offset is anchored.
   if(i===0&&distance(stop,points[0])<=250)choices.push({d:distance(stop,points[0]),along:0,endpoint:true});
   if(i===stops.length-1&&distance(stop,points.at(-1))<=250)choices.push({d:distance(stop,points.at(-1)),along:total,endpoint:true});
   if(!choices.length)return fail('fermata fuori GPX: '+(stop.stop_name||stop.stop_id)+' ('+Math.round(base.nearest.d)+' m)');
   const previous=layers.at(-1),nodes=[];
   for(const c of choices){
    let best=Infinity,parent=-1;
    if(!previous){best=0}else for(let j=0;j<previous.length;j++){
     const p=previous[j];if(c.along<p.along-15)continue;
     const score=p.score+Math.max(0,p.along-c.along)*3;
     if(score<best){best=score;parent=j}
    }
    if(Number.isFinite(best))nodes.push({...c,score:best+c.d+(c.endpoint?20:0),parent});
   }
   if(!nodes.length)return fail('ordine GTFS incompatibile con il verso del GPX');
   layers.push(nodes);
  }
  const last=layers.at(-1);let index=last.reduce((best,x,i)=>x.score<last[best].score?i:best,0),path=[];
  for(let i=layers.length-1;i>=0;i--){const h=layers[i][index];path.push(h);index=h.parent}path.reverse();
  const offsets=[];for(const hit of path)offsets.push(Math.max(offsets.at(-1)||0,hit.along));
  if(offsets.at(-1)-offsets[0]<Math.min(300,total*.15))return fail('fermate concentrate in un tratto troppo breve');
  const errors=path.map(h=>h.d),endpointExceptions=path.filter(h=>h.endpoint&&h.d>100).length;
  const interiorOutliers=path.filter(h=>!h.endpoint&&h.d>100).length;
  if(interiorOutliers>Math.max(1,Math.floor(stops.length*.08)))return fail('troppe fermate intermedie oltre 100 m dal GPX');
  return {ok:true,offsets,errors,endpointExceptions,start:offsets[0],end:offsets.at(-1),span:offsets.at(-1)-offsets[0],meanError:errors.reduce((a,b)=>a+b,0)/errors.length,
   message:stops.length+' fermate GTFS nel verso corretto · scostamento massimo '+Math.round(Math.max(...errors))+' m'+(endpointExceptions?' · '+endpointExceptions+' capolinea ancorati agli estremi GPX (coordinate originali conservate)':'')};
 }
 return {match,projections,distance};
});
