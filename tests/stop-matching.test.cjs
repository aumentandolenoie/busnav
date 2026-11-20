'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
const matcher=require('../route-stops.js');
const catalog=JSON.parse(fs.readFileSync('official-routes.json'));
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/line15-stops.json'));
// GTFS stops of the fixture were taken for the Marco Polo trips of line 15 (E015).
const idOf=name=>{const r=catalog.find(r=>r.name===name);assert.ok(r,name);return r.id};
const OUTBOUND=idOf('1278 | Padova - Aeroporto Marco Polo'),INBOUND=idOf('1026 | Aeroporto Marco Polo - Padova');
function pointsFor(id){const points=catalog.find(r=>r.id===id).points.map(([lat,lng])=>({lat,lng})),ds=[0];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],rad=Math.PI/180,h=Math.sin((b.lat-a.lat)*rad/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lng-a.lng)*rad/2)**2;ds.push(ds.at(-1)+12742000*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)))}return {points,ds}}
test('line 15 outbound uses its own seven GTFS stops, with bounded terminal exceptions',()=>{
 const {points,ds}=pointsFor(OUTBOUND),stops=fixture.routes['176'].stops;
 const original=JSON.stringify(stops),result=matcher.match(stops,points,ds);
 assert.equal(result.ok,true);assert.equal(result.offsets.length,7);assert.ok(result.endpointExceptions>=1&&result.endpointExceptions<=2);
 assert.equal(result.offsets[0],0);assert.equal(result.offsets.at(-1),ds.at(-1));
 assert.ok(result.errors.slice(1,-1).every(d=>d<7));assert.equal(JSON.stringify(stops),original);
 assert.equal(stops[5].stop.stop_name,'VIA SAN MARCO - DELLE GRAZIE');
 const opposite=fixture.routes['172'].stops;
 assert.equal(opposite[1].stop.stop_name,'VIA SAN MARCO - SAN LAZZARO');
 assert.notDeepEqual(stops.map(s=>s.stop.stop_id),opposite.map(s=>s.stop.stop_id).reverse());
});
test('line 15 inbound still accepts its original GTFS direction',()=>{
 const {points,ds}=pointsFor(INBOUND),result=matcher.match(fixture.routes['172'].stops,points,ds);
 assert.equal(result.ok,true);assert.equal(result.offsets.length,7);
 assert.ok(result.offsets.every((n,i,a)=>i===0||n>=a[i-1]));
});
test('a distant intermediate stop cannot hide behind an outlier allowance',()=>{
 const points=[{lat:45,lng:11},{lat:45,lng:11.01}],ds=[0,787];
 const stops=[points[0],{lat:45.05,lng:11.005},points[1]].map((p,i)=>({stop:{...p,stop_id:String(i)}}));
 assert.equal(matcher.match(stops,points,ds).ok,false);
});
test('ordered alignment preserves separate visits to a stop on a loop',()=>{
 const points=[{lat:45,lng:11},{lat:45,lng:11.01},{lat:45.01,lng:11.01},{lat:45,lng:11}],ds=[0,787,1900,3260];
 const stops=[points[0],points[1],points[2],points[3]].map((p,i)=>({stop:{...p,stop_id:String(i)}}));
 const result=matcher.match(stops,points,ds);assert.equal(result.ok,true);
 assert.equal(result.offsets[0],0);assert.equal(result.offsets.at(-1),3260);
});
test('reverse-direction GTFS is rejected, never silently reversed',()=>{
 const {points,ds}=pointsFor(176);
 assert.equal(matcher.match(fixture.routes['172'].stops,points,ds).ok,false);
});

function appFunction(name){
 const s=fs.readFileSync('app.js','utf8'),m=new RegExp('function\\s+'+name+'\\s*\\(').exec(s);
 let i=s.indexOf('{',m.index),depth=1,end=i+1;
 while(depth){if(s[end]==='{')depth++;if(s[end]==='}')depth--;end++}
 return s.slice(m.index,end);
}
test('numeric GTFS suffixes and urban/extraurban domains retain their meaning',()=>{
 const api=new Function(['normAcademyCode','academyRouteCodes','gtfsFitsAcademyCode'].map(appFunction).join('\n')+';return gtfsFitsAcademyCode')();
 const chosen=line=>({category:'Extraurbano',line:String(line),variant:'',name:''});
 assert.equal(api(chosen(9),{route_short_name:'E0092'}),true);
 assert.equal(api(chosen(10),{route_short_name:'E0102'}),true);
 assert.equal(api(chosen(102),{route_short_name:'E0102'}),false);
 assert.equal(api(chosen(15),{route_short_name:'U15'}),false);
 assert.equal(api({category:'Urbano',line:'15'}, {route_short_name:'E015V'}),false);
});

test('partial road guidance never claims full coverage or accepts a maneuver in a gap',()=>{
 const api=new Function(['academyFingerprint','validRoadGuidance'].map(appFunction).join('\n')+';return {academyFingerprint,validRoadGuidance}')();
 const points=[[45,11],[45,11.01]],chosen={id:'demo',points},total=787;
 const data={version:1,source:'valhalla-osm',language:'it-IT',academyId:'demo',fingerprint:api.academyFingerprint(points),officialLengthM:total,
  validation:{passed:true,maxDeviationM:5,p95DeviationM:3},turns:[{at:200,kind:'turn',side:'destra',text:'Svolta a destra'}],
  coverage:{complete:false,percent:(total-100)/total*100,ranges:[[0,300],[400,total]]}};
 assert.equal(api.validRoadGuidance(data,chosen,[0,total]),true);
 assert.equal(api.validRoadGuidance({...data,coverage:{...data.coverage,complete:true}},chosen,[0,total]),false);
 assert.equal(api.validRoadGuidance({...data,turns:[{...data.turns[0],at:350}]},chosen,[0,total]),false);
 assert.equal(api.validRoadGuidance({...data,coverage:{...data.coverage,percent:100}},chosen,[0,total]),false);
 assert.equal(api.validRoadGuidance({...data,turns:[],noManeuvers:true,coverage:{complete:true,percent:100,ranges:[[0,total]]}},chosen,[0,total]),true);
});

test('road offsets and coverage are normalized to the same distance model as GPS/stops',()=>{
 const api=new Function('const SPEED_BRIDGE_M=100;'+['academyFingerprint','validRoadGuidance','bridgeSpeedLimits','normalizeRoadGuidance'].map(appFunction).join('\n')+';return {academyFingerprint,validRoadGuidance,normalizeRoadGuidance}')();
 const points=[[45,11],[45,12]],chosen={id:'long',points},total=80000,sourceTotal=80090;
 const data={version:1,source:'valhalla-osm',language:'it-IT',academyId:'long',fingerprint:api.academyFingerprint(points),officialLengthM:sourceTotal,
  validation:{passed:true,maxDeviationM:5,p95DeviationM:3},turns:[{at:40045,kind:'turn',side:'destra',text:'Svolta a destra'}],
  coverage:{complete:true,totalM:sourceTotal,coveredM:sourceTotal,percent:100,ranges:[[0,sourceTotal]],gaps:[]}};
 assert.equal(api.validRoadGuidance(data,chosen,[0,total]),true);
 data.speedLimits=[[0,sourceTotal,90]];
 assert.deepEqual(api.normalizeRoadGuidance(data,total).speedLimits,[]);
 data.speedLimitPolicy=2;
 data.speedLimits=[[40045,sourceTotal,50]];
 const normalized=api.normalizeRoadGuidance(data,total);
 assert.deepEqual(normalized.speedLimits,[[40000,total,50]]);
 assert.equal(normalized.turns[0].at,40000);assert.equal(normalized.coverage.ranges[0][1],total);
 assert.equal(normalized.coverage.coveredM,total);
 // Policy 3 rows carry the OSM evidence (1 sign, 2 mapped, 3 legal default) as a 4th value.
 data.speedLimitPolicy=3;
 data.speedLimits=[[0,40045,80,3],[40045,sourceTotal,50,1],[10,20,50,7]];
 assert.deepEqual(api.normalizeRoadGuidance(data,total).speedLimits,[[0,40000,80],[40000,total,50]]);
});

test('the imported folder is the only GPX source and every route keeps its source path',()=>{
 const crypto=require('node:crypto');
 const evidence=JSON.parse(fs.readFileSync('academy-evidence.json'));
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync('official-routes.json')).digest('hex'),evidence.originalCatalogSHA256);
 assert.deepEqual(JSON.parse(fs.readFileSync('academy-supplemental-routes.json')),[]);
 assert.equal(evidence.catalog.total,catalog.length);
 assert.ok(Object.values(evidence.routes).every(r=>r.sourcePaths.length===1&&r.sourcePaths[0].startsWith('Mappe Busitalia Veneto/')));
});
test('official outside-service indicators suppress passenger matching, not GPX navigation',()=>{
 const evidence=JSON.parse(fs.readFileSync('academy-evidence.json'));
 const byName=name=>evidence.routes[idOf(name)];
 for(const name of ['999 | Bassano - Mussolente (diretta)','999 | Bojon - Lova (diretta)','999 | Monselice - Abano Giarre (diretta)'])
  assert.equal(byName(name).serviceStatus,'out-of-service',name);
 assert.equal(byName('201 | Padova - Ca’ Bianca').serviceStatus,'passenger-or-unspecified');
 const build=new Function(appFunction('buildAcademyMatches')+';return buildAcademyMatches')();
 const result=build({_evidence:evidence.routes[idOf('999 | Bojon - Lova (diretta)')]});
 assert.equal(result.outOfService,true);assert.equal(result.results.length,0);
});
test('page-attributed Academy line aliases participate in GTFS matching',()=>{
 const evidence=JSON.parse(fs.readFileSync('academy-evidence.json'));
 const api=new Function(['normAcademyCode','academyRouteCodes','gtfsFitsAcademyCode'].map(appFunction).join('\n')+';return gtfsFitsAcademyCode')();
 const colli=catalog.find(r=>r.category==='Colli'&&r.variant==='1072');
 assert.equal(api({...colli,_evidence:evidence.routes[colli.id]},{route_short_name:'EM'}),true);
 const market=catalog.find(r=>/mercat/i.test(r.line)&&r.variant==='597');
 assert.equal(api({category:'Extraurbano',line:'Deviazioni mercatali',variant:'597',name:'597',_evidence:evidence.routes[market.id]},{route_short_name:'E071'}),true);
 assert.ok(evidence.routes[market.id].shiftMatches.some(r=>r.page>0&&r.document&&r.line==='E071'));
});

test('Academy selection groups only confirmed duplicate files and keeps homonymous variants',()=>{
 const api=new Function('const sortIt=(a,b)=>a.localeCompare(b,"it",{numeric:true});\nlet ACADEMY_ROUTE_ALIASES=new Map();\n'+
  appFunction('academyMarketDay')+'\n'+appFunction('academyMarketPlace')+'\n'+appFunction('academyRouteChoices')+'\nreturn {academyRouteChoices,setAliases:m=>{ACADEMY_ROUTE_ALIASES=m}};')();
 const evidence=JSON.parse(fs.readFileSync('academy-evidence.json')).routes;
 const routes=catalog.map(r=>({...r,_evidence:evidence[String(r.id)]})),byId=new Map(routes.map(r=>[r.id,r]));
 // Same rule as loadAcademy(): files with identical coordinates share one choice.
 const aliases=new Map(routes.filter(r=>Number.isInteger(r._evidence.sameGeometryAs)).map(r=>[r.id,r._evidence.sameGeometryAs]));
 api.setAliases(aliases);
 for(const [alias,id] of aliases){
  const a=byId.get(alias),b=byId.get(id);
  assert.deepEqual(a.points,b.points);
  assert.ok(id<alias);
 }
 const groups=new Map();
 for(const route of routes){
  const key=JSON.stringify([route.category,route.line.trim()]);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(route);
 }
 const total=Array.from(groups.values(),group=>api.academyRouteChoices(group,'').length).reduce((a,b)=>a+b,0);
 assert.equal(total,routes.length-aliases.size);
 // A copy with the same coordinates in the same line is offered once.
 const copy={...byId.get(0),id:-1,_evidence:{...byId.get(0)._evidence,sameGeometryAs:0}};
 api.setAliases(new Map([[-1,0]]));
 assert.deepEqual(api.academyRouteChoices([byId.get(0),copy],'').map(([value])=>value),['0']);
 // Market-day detours: day, town and hours from the folder name.
 const market=routes.filter(r=>/mercat/i.test(r.line)&&['225','370'].includes(r.variant));
 assert.deepEqual(api.academyRouteChoices(market,'').map(([,name])=>name),
  ['225 | Padova - Piazzola - Carmignano · Venerdì · Piazzola, fino alle ore 15','370 | Noventa Padovana - Ist. Cornaro - Padova · Martedì · Noventa P., ore 7–14']);
 // Same name and code: the GPX number tells the two files apart.
 const twins=routes.filter(r=>r.name==='5B | Ferrovia - Voltabrusegana');
 assert.equal(twins.length,2);
 assert.deepEqual(api.academyRouteChoices(twins,'').map(([,name])=>name.split(' · ')[1]).sort(),twins.map(r=>'GPX '+r.id).sort());
});
test('catalogue search finds lines directly, ignoring accents, apostrophes and separators',()=>{
 const js=fs.readFileSync('app.js','utf8');
 const constant=name=>js.match(new RegExp('const '+name+'=[\\s\\S]*?;\\n'))[0];
 const api=new Function('let ACADEMY_ROUTE_ALIASES=new Map();\n'+constant('ACADEMY_DOCUMENTS')+constant('sortIt')+
  ['academyGroupName','academyMarketDay','academySearchText','searchAcademyRoutes'].map(appFunction).join('\n')+
  '\nreturn {searchAcademyRoutes,academySearchText};')();
 const routes=[...catalog,...JSON.parse(fs.readFileSync('academy-supplemental-routes.json'))];
 const names=query=>api.searchAcademyRoutes(routes,query).map(r=>r.name);
 assert.equal(api.academySearchText('Ca’ Bianca | Cà-Bianca'),'ca bianca ca bianca');
 assert.equal(names('201 Padova Ca bianca')[0],'201 | Padova - Ca’ Bianca');
 assert.equal(names('201 padova ca’ bianca')[0],'201 | Padova - Ca’ Bianca');
 assert.ok(names('ca bianca').length>=8,'All Ca’ Bianca routes');
 assert.ok(names('ca bianca').every(n=>/c[aà]’? ?bianca/i.test(n.replace(/'/g,'’'))));
 assert.deepEqual(names('E201'),names('201'));
 assert.ok(api.searchAcademyRoutes(routes,'15').slice(0,3).every(r=>/^15[A-Z]*\b/.test(r.name)),'Code 15 before 150');
 assert.deepEqual(names(''),[]);
 assert.deepEqual(names('zzzz inesistente'),[]);
 assert.ok(names('bojon').length>=10&&names('bojon').every(n=>/bojon/i.test(n)));
});
