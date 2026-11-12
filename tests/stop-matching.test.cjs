'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
const matcher=require('../route-stops.js');
const catalog=JSON.parse(fs.readFileSync('official-routes.json'));
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/line15-stops.json'));
function pointsFor(id){const points=catalog.find(r=>r.id===id).points.map(([lat,lng])=>({lat,lng})),ds=[0];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],rad=Math.PI/180,h=Math.sin((b.lat-a.lat)*rad/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lng-a.lng)*rad/2)**2;ds.push(ds.at(-1)+12742000*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)))}return {points,ds}}
test('line 15 outbound uses its own seven GTFS stops, with bounded terminal exceptions',()=>{
 const {points,ds}=pointsFor(176),stops=fixture.routes['176'].stops;
 const original=JSON.stringify(stops),result=matcher.match(stops,points,ds);
 assert.equal(result.ok,true);assert.equal(result.offsets.length,7);assert.equal(result.endpointExceptions,2);
 assert.equal(result.offsets[0],0);assert.equal(result.offsets.at(-1),ds.at(-1));
 assert.ok(result.errors.slice(1,-1).every(d=>d<7));assert.equal(JSON.stringify(stops),original);
 assert.equal(stops[5].stop.stop_name,'VIA SAN MARCO - DELLE GRAZIE');
 const opposite=fixture.routes['172'].stops;
 assert.equal(opposite[1].stop.stop_name,'VIA SAN MARCO - SAN LAZZARO');
 assert.notDeepEqual(stops.map(s=>s.stop.stop_id),opposite.map(s=>s.stop.stop_id).reverse());
});
test('line 15 inbound still accepts its original GTFS direction',()=>{
 const {points,ds}=pointsFor(172),result=matcher.match(fixture.routes['172'].stops,points,ds);
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
 const api=new Function(['academyFingerprint','validRoadGuidance','normalizeRoadGuidance'].map(appFunction).join('\n')+';return {academyFingerprint,validRoadGuidance,normalizeRoadGuidance}')();
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

test('Academy ZIP adds only its two previously omitted tracks',()=>{
 const crypto=require('node:crypto');
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync('official-routes.json')).digest('hex'),'1a6bb11b15550def33e20095758c0f48dc33259ef2f4010fd9bc5c22aa346ac7');
 const supplemental=JSON.parse(fs.readFileSync('academy-supplemental-routes.json'));
 assert.deepEqual(supplemental.map(r=>r.id),[787,788]);
 assert.deepEqual(supplemental.map(r=>r.points.length),[395,958]);
 const evidence=JSON.parse(fs.readFileSync('academy-evidence.json'));
 assert.equal(evidence.catalog.total,789);
 assert.ok(Object.values(evidence.routes).every(r=>r.sourcePaths.length));
});
test('official outside-service indicators suppress passenger matching, not GPX navigation',()=>{
 const evidence=JSON.parse(fs.readFileSync('academy-evidence.json'));
 for(const id of [45,182,290,404,420,488])assert.equal(evidence.routes[id].serviceStatus,'out-of-service');
 assert.equal(evidence.routes[95].serviceStatus,'passenger-or-unspecified');
 for(const id of [196,345,405])assert.equal(evidence.routes[id].serviceStatus,'conflicting-indicator');
 const build=new Function(appFunction('buildAcademyMatches')+';return buildAcademyMatches')();
 const result=build({_evidence:evidence.routes[182]});
 assert.equal(result.outOfService,true);assert.equal(result.results.length,0);
});
test('page-attributed Academy line aliases participate in GTFS matching',()=>{
 const evidence=JSON.parse(fs.readFileSync('academy-evidence.json'));
 const api=new Function(['normAcademyCode','academyRouteCodes','gtfsFitsAcademyCode'].map(appFunction).join('\n')+';return gtfsFitsAcademyCode')();
 assert.equal(api({category:'Colli',line:'MLA',variant:'',name:'MLA',_evidence:evidence.routes[575]},{route_short_name:'M'}),true);
 assert.equal(api({category:'Extraurbano',line:'Deviazioni mercatali',variant:'597',name:'597',_evidence:evidence.routes[1]},{route_short_name:'E071'}),true);
 assert.ok(evidence.routes[1].shiftMatches.some(r=>r.page>0&&r.document&&r.line==='E071'));
});

test('Academy selection groups only confirmed duplicate files and keeps homonymous variants',()=>{
 const js=fs.readFileSync('app.js','utf8');
 const aliases=js.match(/const ACADEMY_ROUTE_ALIASES=new Map\(.*\);/)[0];
 const api=new Function(aliases+'\nconst sortIt=(a,b)=>a.localeCompare(b,"it",{numeric:true});\n'+
  appFunction('academyRouteChoices')+'\nreturn {academyRouteChoices,ACADEMY_ROUTE_ALIASES};')();
 const evidence=JSON.parse(fs.readFileSync('academy-evidence.json')).routes;
 const supplemental=JSON.parse(fs.readFileSync('academy-supplemental-routes.json'));
 const routes=[...catalog,...supplemental],byId=new Map(routes.map(r=>[r.id,r]));
 assert.equal(byId.size,789);
 for(const [alias,id] of api.ACADEMY_ROUTE_ALIASES){
  const a=byId.get(alias),b=byId.get(id);
  assert.deepEqual([a.category,a.line.trim(),a.name,a.points],[b.category,b.line.trim(),b.name,b.points]);
  assert.ok(!a.variant||!b.variant||a.variant===b.variant);
  assert.deepEqual(evidence[alias],evidence[id]);
 }
 const groups=new Map();
 for(const route of routes){
  const key=JSON.stringify([route.category,route.line.trim()]);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(route);
 }
 const total=Array.from(groups.values(),group=>api.academyRouteChoices(group,'').length).reduce((a,b)=>a+b,0);
 assert.equal(total,783);
 const choices=(ids,query='')=>api.academyRouteChoices(ids.map(id=>byId.get(id)),query);
 assert.deepEqual(choices([2,3],'bojon(1)').map(([id])=>id),['3']);
 assert.deepEqual(choices([49,54]).map(([,name])=>name.split(' · ')[1]),['cod. 670','cod. 1078']);
 assert.deepEqual(choices([195,196]).map(([,name])=>name.split(' · ')[1]),['cod. 994','cod. 999']);
 assert.deepEqual(choices([106,107]).map(([,name])=>name.split(' · ')[1]),['GPX 106','GPX 107']);
 assert.equal(choices([172,176]).length,2);
});
test('catalogue search finds lines directly, ignoring accents, apostrophes and separators',()=>{
 const js=fs.readFileSync('app.js','utf8');
 const constant=name=>js.match(new RegExp('const '+name+'=[\\s\\S]*?;\\n'))[0];
 const api=new Function(constant('ACADEMY_ROUTE_ALIASES')+constant('ACADEMY_DOCUMENTS')+constant('sortIt')+
  ['academyGroupName','academySearchText','searchAcademyRoutes'].map(appFunction).join('\n')+
  '\nreturn {searchAcademyRoutes,academySearchText};')();
 const routes=[...catalog,...JSON.parse(fs.readFileSync('academy-supplemental-routes.json'))];
 const names=query=>api.searchAcademyRoutes(routes,query).map(r=>r.name);
 assert.equal(api.academySearchText('Ca’ Bianca | Cà-Bianca'),'ca bianca ca bianca');
 assert.equal(names('201 Padova Ca bianca')[0],'201 | Padova - Ca’ Bianca');
 assert.equal(names('201 padova ca’ bianca')[0],'201 | Padova - Ca’ Bianca');
 assert.ok(names('ca bianca').length>=8,'All Ca’ Bianca routes');
 assert.ok(names('ca bianca').every(n=>/c[aà]’? ?bianca/i.test(n.replace(/'/g,'’'))));
 assert.deepEqual(names('E201'),names('201'));
 assert.ok(api.searchAcademyRoutes(routes,'15').slice(0,3).every(r=>r.category==='Urbano'&&/^15[A-Z]*\b/.test(r.name)),'Line 15 before 150');
 assert.deepEqual(names(''),[]);
 assert.deepEqual(names('zzzz inesistente'),[]);
 const ids=api.searchAcademyRoutes(routes,'bojon').map(r=>r.id);
 assert.ok(ids.includes(3)&&!ids.includes(2),'Duplicate GPX files are listed once');
});
