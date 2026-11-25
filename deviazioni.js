/* Temporary detours from company communications (deviazioni.json).
   A detour GPX replaces an official GPX only while one of the communication's
   windows overlaps the time the bus is on the detoured stretch. Communications
   cancelled or replaced by a later one are never used. Shared by the web app
   and, through it, iOS and Android. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Deviazioni=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MARGIN_MIN=10;      // minutes added around the time on the detoured stretch
 const BUS_KMH=35;         // estimate of a manual trip's duration from the GPX length
 const INACTIVE=new Set(['sostituita','annullata']);

 /** '2026-11-25T20:30' (local time in Italy) → Date. */
 function parse(text){
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(text||''));
  return m?new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5]):null;
 }
 function windows(comm){
  return (comm?.windows||[]).map(w=>({from:parse(w.from),to:parse(w.to)})).filter(w=>w.from&&w.to&&w.to>w.from);
 }
 function usable(comm){return !!comm&&!INACTIVE.has(comm.status)}
 function communication(data,number){return (data?.communications||[]).find(c=>+c.number===+number)||null}
 /** When the bus is on the detoured stretch of a trip run from start to end (Dates). */
 function stretch(route,start,end){
  const total=route.baseLengthM||0,span=end-start;
  const a=total>0?Math.max(0,Math.min(1,(route.leaveAtM||0)/total)):0;
  const b=total>0?Math.max(a,Math.min(1,(route.rejoinAtM??total)/total)):1;
  return {from:new Date(+start+span*a-MARGIN_MIN*60000),to:new Date(+start+span*b+MARGIN_MIN*60000)};
 }
 /** Detour of an official GPX for a trip from start to end: {route, communication, window} or null. */
 function forTrip(data,baseId,start,end){
  if(!(start instanceof Date)||!(end instanceof Date)||!(end>=start))return null;
  for(const route of data?.routes||[]){
   if(+route.base!==+baseId)continue;
   const comm=communication(data,route.communication);
   if(!usable(comm))continue;
   const s=stretch(route,start,end);
   const window=windows(comm).find(w=>w.from<s.to&&w.to>s.from);
   if(window)return {route,communication:comm,window};
  }
  return null;
 }
 /** Manual navigation starting now: the trip duration is estimated from the GPX length. */
 function forNow(data,baseId,now=new Date()){
  for(const route of data?.routes||[]){
   if(+route.base!==+baseId)continue;
   const minutes=Math.max(20,(route.baseLengthM||0)/1000/BUS_KMH*60);
   const found=forTrip({...data,routes:[route]},baseId,now,new Date(+now+minutes*60000));
   if(found)return found;
  }
  return null;
 }
 /** Date and time of a shift row: rows after midnight belong to the next day. */
 function legTimes(day,dep,arr,shiftStart){
  const min=t=>{const m=/^(\d{1,2})[:.](\d{2})/.exec(String(t||''));return m?+m[1]*60+ +m[2]:null};
  const d=min(dep),a=min(arr),s=min(shiftStart);
  if(d===null)return null;
  const base=new Date(day.getFullYear(),day.getMonth(),day.getDate());
  const startMin=d+(s!==null&&d<s-60?1440:0);
  let endMin=a===null?startMin:a+(s!==null&&a<s-60?1440:0);
  if(endMin<startMin)endMin+=1440;
  return {start:new Date(+base+startMin*60000),end:new Date(+base+endMin*60000)};
 }
 /** 'in-corso' | 'programmata' | 'conclusa' | 'sostituita' | 'annullata'. */
 function state(comm,now=new Date()){
  if(!usable(comm))return comm?.status||'annullata';
  const w=windows(comm);
  if(w.some(x=>x.from<=now&&now<x.to))return 'in-corso';
  if(w.some(x=>x.from>now))return 'programmata';
  return 'conclusa';
 }
 /** Communications to show: in progress and planned first, then those replaced in the
     last days (so the driver sees what no longer applies). Concluded ones drop after 2 days. */
 function list(data,now=new Date()){
  const order={'in-corso':0,programmata:1,sostituita:2,annullata:2,conclusa:3};
  return (data?.communications||[]).map(c=>{
   const w=windows(c),st=state(c,now),last=w.length?Math.max(...w.map(x=>+x.to)):null;
   const next=w.find(x=>x.to>now)||null;
   return {communication:c,state:st,next,last:last?new Date(last):null};
  }).filter(x=>{
   if(x.state==='conclusa')return x.last&&now-x.last<2*864e5;
   if(x.state==='sostituita'||x.state==='annullata'){
    const by=communication(data,x.communication.replacedBy);
    const end=windows(by).map(w=>+w.to);
    return !end.length||now<Math.max(...end);
   }
   return true;
  }).sort((a,b)=>order[a.state]-order[b.state]||(+b.communication.number)-(+a.communication.number));
 }
 /** The newer of two deviazioni.json (bundled copy vs. the one published online). */
 function newer(a,b){
  const ok=d=>d&&d.version===1&&Array.isArray(d.communications)&&Array.isArray(d.routes);
  if(!ok(a))return ok(b)?b:null;
  if(!ok(b))return a;
  return String(b.updatedAt||'')>String(a.updatedAt||'')?b:a;
 }
 function fmt(date){
  const p=n=>String(n).padStart(2,'0');
  return p(date.getDate())+'/'+p(date.getMonth()+1)+' '+p(date.getHours())+':'+p(date.getMinutes());
 }
 function windowText(w){return w?fmt(w.from)+' → '+fmt(w.to):''}
 return {parse,windows,usable,communication,stretch,forTrip,forNow,legTimes,state,list,newer,windowText,MARGIN_MIN};
});
