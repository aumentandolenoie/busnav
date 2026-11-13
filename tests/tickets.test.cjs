'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {test}=require('node:test');
const Tickets=require('../tickets.js');
const data=JSON.parse(fs.readFileSync('fares/polimetriche-padova.json','utf8'));
const cases=JSON.parse(fs.readFileSync('tests/fixtures/ticket-cases.json','utf8'));
const line=code=>data.lines.find(l=>l.code===code);
const stop=(l,name)=>l.stops.findIndex(s=>s[0]===name);

test('polimetriche: 62 lines, complete lower triangles, every code priced',()=>{
 assert.equal(data.lines.length,62);
 assert.equal(new Set(data.lines.map(l=>l.code)).size,62);
 for(const l of data.lines){
  assert.equal(l.fares.length,l.stops.length,l.code);
  l.fares.forEach((row,i)=>assert.equal(row.length,i+1,l.code+' row '+i));
  for(const s of l.stops){
   assert.equal(typeof s[0],'string');
   assert.ok(s.length===1||(s.length===3&&s[1]>44.5&&s[1]<46&&s[2]>11&&s[2]<12.7),l.code+' '+s[0]);
  }
  for(const row of l.fares)for(const code of row)assert.ok(code in data.labels,l.code+' '+code);
 }
 // Only on-board prices: each label states "a bordo" or that no class exists.
 for(const [code,text] of Object.entries(data.labels))assert.ok(code===''||/ a bordo/.test(text),text);
 assert.equal(data.labels.C1,'Classe 1 = € 2,50 a bordo');
 assert.equal(data.labels.C13,'Classe 13 = € 11,50 a bordo');
 // Comunicato n.634/2026: dedicated € 13,00 ticket, € 13,00 + € 2,00 from Montegrotto.
 assert.match(data.notes['PD-TESSERA'],/^Solo biglietto dedicato da € 13,00\./);
 assert.match(data.notes['ABANO-TESSERA'],/^Biglietto dedicato da € 13,00 \+ biglietto da € 2,00\./);
 for(const code of Object.keys(data.notes))assert.ok(code in data.labels,code);
});
test('fares match the polimetrica cells checked against the PDF',()=>{
 for(const c of cases.fares){
  const l=line(c.line),from=stop(l,c.from),to=stop(l,c.to);
  assert.ok(from>=0&&to>=0,c.line+' '+c.from+' '+c.to);
  assert.equal(Tickets.fare(data,l,from,to).text,c.text,c.line+' '+c.from+'→'+c.to);
  assert.equal(Tickets.fare(data,l,from,to).note,c.note,c.line+' '+c.from+'→'+c.to+' note');
 }
 assert.equal(Tickets.fare(data,line('E001'),-1,3),null);
 assert.equal(Tickets.fare(data,line('E001'),0,99),null);
});
test('boarding stop is the nearest fare node, only when close',()=>{
 for(const c of cases.nearest){
  const l=line(c.line),i=Tickets.nearestStop(l,c.lat,c.lng);
  assert.equal(i<0?null:l.stops[i][0],c.stop);
 }
});
test('running line suggests its polimetrica',()=>{
 for(const c of cases.suggested)assert.deepEqual(Tickets.suggestedLines(data,c.route).map(i=>data.lines[i].code),c.lines,JSON.stringify(c.route));
 // Every Academy extra-urban line with a polimetrica gets one.
 const routes=JSON.parse(fs.readFileSync('official-routes.json','utf8'));
 const missing=new Set(routes.filter(r=>r.category!=='Urbano'&&!Tickets.suggestedLines(data,r).length).map(r=>r.line.trim()));
 assert.deepEqual([...missing].sort(),['61','Colli','Deviazioni mercatali']);
});
