'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {test}=require('node:test');
globalThis.Tickets=require('../tickets.js');
const Corsie=require('../corsie.js');
const tickets=JSON.parse(fs.readFileSync('fares/polimetriche-padova.json','utf8'));
const evidence=JSON.parse(fs.readFileSync('academy-evidence.json','utf8')).routes;
const routes=JSON.parse(fs.readFileSync('official-routes.json','utf8')).map(r=>({...r,_evidence:evidence[String(r.id)]}));
const byId=id=>routes.find(r=>r.id===id);

test('table "Corsie": every line read from the document',()=>{
 // Cod. linea → corsia, row by row from the Busitalia sheet.
 const sheet={E001:4,E002:4,E003:1,E004:4,E005:4,E006:1,E007:5,E008:6,E009:6,E010:6,E011:6,E012:6,E013:6,
  E015:11,E016:6,E017:9,E018:9,E019:9,E020:9,E021:14,E026:8,E029:13,E031:8,E035:5,E036:13,E037:3,E038:13,
  E040:5,E041:3,E045:5,E060:3,E062:10,E063:10,E066:4,E071:7,E073:7,E074:14,E076:4,E080:8};
 for(const [code,bay] of Object.entries(sheet))assert.equal(Corsie.LINES[code],bay,code);
 for(const c of ['A','AT','ATL','M','T','TL'])assert.equal(Corsie.LINES[c],11,c);
});

test('label under the route name',()=>{
 const m=routes.find(r=>r.category==='Colli'&&r.line.trim()==='M');
 assert.equal(Corsie.label(m,tickets),'Corsia 11');
 assert.equal(Corsie.label(m,null),'Corsia 11','also before the ticket data is loaded');
 assert.equal(Corsie.label({category:'Extraurbano',line:'1',name:'x'},tickets),'Corsia 4');
 assert.equal(Corsie.label({category:'Urbano',line:'10',name:'x'},tickets),'');
 assert.equal(Corsie.label({category:'Extraurbano',line:'61',name:'Padova - Jesolo'},tickets),'');
 // Market detour without a line number: the line comes from the Academy evidence.
 assert.equal(Corsie.label(byId(18),tickets),'Corsia 14');
 // Two possible lines with different bays.
 assert.equal(Corsie.label(byId(26),tickets),'Corsia 5 o 14');
 // School trips: the institute bay is added when it differs from the line.
 assert.equal(Corsie.label(byId(355),tickets),'Corsia 13 · Ist. Valle: corsia 8');
 assert.equal(Corsie.label(byId(363),tickets),'Corsia 13');
 assert.equal(Corsie.label(byId(212),tickets),'Corsia 9 · Istituti via Cave: corsia 14');
});

test('every extra-urban and Colli route except the lines missing in the table has a bay',()=>{
 const missing=new Set(routes.filter(r=>r.category!=='Urbano'&&!Corsie.info(r,tickets).bays.length).map(r=>r.line.trim()));
 assert.deepEqual([...missing].sort((a,b)=>a.localeCompare(b,'it',{numeric:true})),['24','33','34','43','44','46','61','98','101','102','103','105']);
});
