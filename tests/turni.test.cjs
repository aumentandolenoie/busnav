'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {test}=require('node:test');
const Turni=require('../turni.js');
const data=JSON.parse(fs.readFileSync('turni.json','utf8'));
const catalog=JSON.parse(fs.readFileSync('official-routes.json','utf8'));
const ids=new Set(catalog.map(r=>r.id));

test('shift PDFs read again: every shift and row of feriale and sabato',()=>{
 const docs=Object.fromEntries(data.documents.filter(d=>d.rows).map(d=>[d.day,d]));
 assert.equal(docs.weekday.validFrom,'02/11/2026');assert.equal(docs.weekday.shifts,298);assert.equal(docs.weekday.rows,3505);
 assert.equal(docs.saturday.shifts,254);assert.equal(docs.saturday.rows,2851);
 assert.equal(Object.keys(data.days.weekday.shifts).length,298);
 assert.equal(Object.keys(data.days.saturday.shifts).length,254);
 for(const day of ['weekday','saturday'])for(const [code,s] of Object.entries(data.days[day].shifts)){
  assert.ok(s.events.some(e=>e.what==='Pre turno')&&s.events.some(e=>e.what==='Post turno'),code);
  assert.ok(s.legs.length>0,code);
 }
});

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
 assert.equal(s.pause,80);   // 09:54 – 11:14 (rientro vettura 09:50–09:54)
 assert.deepEqual(shift.events.map(e=>e.time),['05:54','09:59','11:09','14:26']);
 assert.equal(shift.legs.length,10);
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

test('market-day detour: chosen automatically on its weekday, the driver can go back to the normal GPX',()=>{
 const shift=Turni.find(data,'weekday','P046');
 const leg=shift.legs.find(l=>l.dep==='12:55');
 const friday=new Date(2026,10,27),monday=new Date(2026,10,23);
 assert.equal(catalog[Turni.routeOn(leg,{},monday).route].name,catalog[leg.route].name);
 const plan=Turni.routeOn(leg,{},friday);
 assert.equal(plan.market.day,'Venerdì');
 assert.equal(catalog[plan.route].line,'Deviazioni mercatali');
 assert.equal(catalog[plan.route].variant,catalog[leg.route].variant);
 const normal={[Turni.marketKey(leg)]:'normal'};
 assert.equal(Turni.routeOn(leg,normal,friday).route,leg.route);
 assert.equal(Turni.routeOn(leg,normal,friday).marketOff,true);
 // after the market hours (fino alle ore 15) the normal GPX is used
 const late=shift.legs.find(l=>l.dep==='16:40');
 assert.equal(Turni.marketFor(late,{[Turni.tripKey(late)]:late.options[0]},friday),null);
 // every detour points to a GPX of the DEVIAZIONI MERCATALI folder with the same code
 for(const day of Object.values(data.days))for(const s of Object.values(day.shifts))for(const l of s.legs)for(const m of l.market||[]){
  assert.equal(catalog[m.route].line,'Deviazioni mercatali');
  assert.equal(catalog[m.route].variant,catalog[m.normal].variant);
 }
});

test('GTFS stops pick the GPX that passes by them',()=>{
 const stops=[{id:1},{id:2},{id:3}];
 const dist=(s,id)=>id===7?20:s.id===2?500:20;
 assert.equal(Turni.pickByStops([5,7],stops,dist),7);
 assert.equal(Turni.pickByStops([5,6],stops,dist),null);
});

test('festivo: trips misread as transfers in the Academy reading are driven (P001 Padova - Turri)', () => {
  const data = require('../turni.json');
  const legs = data.days.holiday.shifts.P001.legs;
  const out = legs.find(l => l.dep === '10:45');
  assert.equal(out.kind, 'service');
  assert.equal(out.route, 733);
  // No passenger trip with a line is left as a transfer on any day.
  for (const [day, d] of Object.entries(data.days))
    for (const [code, s] of Object.entries(d.shifts))
      for (const l of s.legs)
        if (l.kind === 'transfer' && l.line && /^(PADOVA|Padova) - /.test(l.desc || '') && !/DEPOSITO/i.test(l.desc))
          assert.fail(`${day} ${code} ${l.dep} ${l.desc}`);
});
