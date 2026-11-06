'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const js=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
function sourceOf(name){
 const match=new RegExp('function\\s+'+name+'\\s*\\(').exec(js);
 assert.ok(match,'Missing '+name);
 let first=js.indexOf('{',match.index),depth=1,index=first+1;
 while(depth&&index<js.length){if(js[index]==='{')depth++;else if(js[index]==='}')depth--;index++;}
 assert.equal(depth,0,'Unbalanced function '+name);
 return js.slice(match.index,index);
}
test('application and service worker parse as JavaScript',()=>{
 new Function(js);new Function(sw);
});
test('all JS element selectors correspond to HTML ids',()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 for(const [,id] of js.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(id),'Missing element #'+id);
});
test('787 Academy GPX stay complete and uniquely identified',()=>{
 const routes=JSON.parse(fs.readFileSync('official-routes.json','utf8'));
 assert.equal(routes.length,787);
 assert.equal(new Set(routes.map(r=>r.id)).size,787);
 for(const [category,expected] of Object.entries({Extraurbano:557,Colli:29,Urbano:201})){
  assert.equal(routes.filter(r=>r.category===category).length,expected);
 }
 assert.ok(routes.every(r=>Array.isArray(r.points)&&r.points.length>=2));
});
test('GPX interpolation never returns the start after journey end',()=>{
 const f=vm.runInNewContext(sourceOf('pointAt')+';pointAt');
 const pts=[{lat:45,lng:11},{lat:46,lng:12},{lat:47,lng:13}];
 const ds=[0,100,200];
 assert.equal(f(pts,ds,-50).lat,45);
 assert.equal(f(pts,ds,0).lat,45);
 assert.equal(f(pts,ds,50).lat,45.5);
 assert.equal(f(pts,ds,200).lat,47);
 assert.equal(f(pts,ds,250).lat,47);
});
test('voice and Academy matching remain present',()=>{
 for(const name of ['matchStopsStrict','buildAcademyMatches','planStopVoice','startGPS','stopNavigation','recenterOnRealGPS','stableRouteMatch'])sourceOf(name);
 assert.match(js, /_stopAuthority==='supplemental'/);
 assert.match(js, /updateNavigationHeading\(points,dists,along\)/);
 assert.match(html, /id="navigationPosition"/);
});
test('no removal of PWA offline fallback',()=>{
 assert.match(sw, /caches\.match/);
 assert.match(html, /manifest\.webmanifest/);
});

test('GPS follow camera accumulates small movements instead of stalling',()=>{
 const code=sourceOf('followStableCamera');
 const calls=[];
 const map={
  getZoom:()=>16,
  setView:(p)=>calls.push(['initial',p]),
  panTo:(p)=>calls.push(['follow',p])
 };
 const display={hidden:true};
 const metres=(a,b)=>Math.hypot((b.lat-a.lat)*111194,(b.lng-a.lng)*80000);
 const follow=new Function('map','$','metres',`let navigationFullscreen=true,lastCameraPoint=null; ${code};return followStableCamera;`)(map,()=>display,metres);
 const starting=45.40;
 for(let i=0;i<=10;i++)follow({lat:starting+i*0.000012,lng:11.88},false,false); // ~1.33 m/update
 assert.ok(calls.length>=4,'Camera must move after several small GPS updates');
 assert.equal(calls[0][0],'initial');
 assert.ok(calls.some(c=>c[0]==='follow'));
 assert.ok(Math.abs(calls.at(-1)[1][0]-(starting+10*0.000012))<0.00004);
 assert.equal(display.hidden,false);
});
