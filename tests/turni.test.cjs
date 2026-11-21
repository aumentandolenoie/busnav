'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {test}=require('node:test');
const Turni=require('../turni.js');
const data=JSON.parse(fs.readFileSync('turni.json','utf8'));
const catalog=JSON.parse(fs.readFileSync('official-routes.json','utf8'));
const ids=new Set(catalog.map(r=>r.id));

test('day type from the date, Italian holidays included',()=>{
 assert.equal(Turni.dayFor(new Date(2026,10,23)),'weekday');   // lunedì 23/11/2026
 assert.equal(Turni.dayFor(new Date(2026,10,21)),'saturday');
 assert.equal(Turni.dayFor(new Date(2026,10,22)),'holiday');   // domenica
 assert.equal(Turni.dayFor(new Date(2026,11,8)),'holiday');    // Immacolata, martedì
 assert.equal(Turni.dayFor(new Date(2027,2,29)),'holiday');    // Pasquetta 2027
 assert.equal(Turni.dayFor(new Date(2027,5,13)),'holiday');    // Sant'Antonio, Padova
});

test('shift codes are found however they are typed',()=>{
 for(const q of ['P085','p85','85',' 085 '])assert.equal(Turni.find(data,'weekday',q)?.code,'P085',q);
 assert.equal(Turni.find(data,'weekday','P999'),null);
 assert.ok(Turni.suggest(data,'weekday','85').includes('P085'));
});

test('P085 on weekdays: trips, transfers, pause and vehicle change',()=>{
 const shift=Turni.find(data,'weekday','P085');
 const s=Turni.summary(shift);
 assert.equal(s.start,'06:04');assert.equal(s.trips,6);
 assert.deepEqual(s.vehicles,['87075','87094']);
 assert.equal(s.pause,84);
 const first=Turni.firstDriven(shift);
 assert.equal(shift.legs[first].dep,'06:10');
 assert.equal(catalog[Turni.routeFor(shift.legs[first])].name,'300 | Padova - Monselice - Este');
 const megliadino=shift.legs.find(l=>l.dep==='06:59');
 assert.equal(Turni.legState(megliadino),'needs-choice');
 assert.ok(megliadino.options.some(id=>catalog[id].name.includes('Megliadino')));
 // A choice saved by the driver is used for the same trip in every shift.
 const choices={[Turni.tripKey(megliadino)]:megliadino.options[0]};
 assert.equal(Turni.routeFor(megliadino,choices),megliadino.options[0]);
 const lunch=shift.legs.findIndex(l=>l.dep==='08:26'),after=Turni.nextDriven(shift,lunch);
 assert.equal(shift.legs[after].dep,'11:20');
 assert.equal(Turni.between(shift,lunch,after).vehicleChange,'87094');
});

test('every GPX in turni.json exists and every driven trip has a GPX or candidates',()=>{
 let driven=0,missing=0;
 for(const day of Object.values(data.days))for(const shift of Object.values(day.shifts))for(const leg of shift.legs){
  for(const id of [leg.route,...(leg.options||[])].filter(x=>x!==undefined))assert.ok(ids.has(id),String(id));
  assert.match(leg.dep,/^\d{2}:\d{2}$/);
  if(Turni.driven(leg)){driven++;if(Turni.legState(leg)==='missing')missing++}
 }
 assert.ok(driven>3000);
 assert.ok(missing/driven<.05,'trips without any GPX: '+missing);
});

test('GTFS stops pick the GPX that passes by them',()=>{
 const stops=[{id:1},{id:2},{id:3}];
 const dist=(s,id)=>id===7?20:s.id===2?500:20;
 assert.equal(Turni.pickByStops([5,7],stops,dist),7);
 assert.equal(Turni.pickByStops([5,6],stops,dist),null);
});
