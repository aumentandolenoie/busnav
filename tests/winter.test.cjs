'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('winter.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const core=fs.readFileSync('app.js','utf8');
const data=JSON.parse(fs.readFileSync('winter-turns.json','utf8'));
const prepare=fs.readFileSync('scripts/prepare-ios.sh','utf8');
const ios=fs.readFileSync('ios/project.yml','utf8');
const plist=fs.readFileSync('ios/Sources/Info.plist','utf8');

function fn(name){
 const re=new RegExp('function\\s+'+name+'\\s*\\(');
 const match=re.exec(source);
 assert.ok(match,'Function '+name+' must exist');
 const start=source.indexOf('{',match.index);
 let depth=1,end=start+1;
 while(depth&&end<source.length){
  if(source[end]==='{')depth++;
  else if(source[end]==='}')depth--;
  end++;
 }
 return source.slice(match.index,end);
}
const funcs=['winterValidCatalog','winterCategoryForLine','winterNorm','winterParts','winterRank','winterLineFamily'];
const officialNormalizer=core.slice(core.indexOf('function normAcademyCode('),core.indexOf('function academyRouteCodes('));
const lib=new Function(officialNormalizer+'\n'+funcs.map(fn).join('\n')+
 ';return {winterValidCatalog,winterCategoryForLine,winterNorm,winterRank,winterLineFamily};')();

test('winter PDF catalog loads without manual upload',()=>{
 assert.equal(lib.winterValidCatalog(data),true);
 assert.equal(data.length,570);
 assert.equal(data.reduce((n,row)=>n+row[3].length,0),3724);
 assert.deepEqual([...new Set(data.map(x=>x[0]))].sort(),['D','F','S']);
 for(const day of ['F','S','D'])
  assert.ok(data.some(x=>x[0]===day&&/^P\d{3}$/.test(x[1])));
 assert.ok(data.some(x=>x[3].some(leg=>leg[3]==='E060-V')));
 assert.ok(data.some(x=>x[3].some(leg=>leg[3]==='E060-Z')));
 assert.ok(source.includes('winterLoadBundled()'));
 assert.ok(source.includes("fetch('./winter-turns.json')"));
 assert.ok(prepare.includes('winter-turns.json'));
});

test('categories and PDF route suffixes retain the correct semantics',()=>{
 assert.equal(lib.winterCategoryForLine('E060-V'),'Extraurbano');
 assert.equal(lib.winterCategoryForLine('E060-Z'),'Extraurbano');
 assert.equal(lib.winterCategoryForLine('M'),'Colli');
 assert.equal(lib.winterCategoryForLine('TL'),'Colli');
 assert.equal(lib.winterCategoryForLine('U06'),'Urbano');
 assert.equal(lib.winterLineFamily('E060-V'),lib.winterLineFamily('E060-Z'));
 assert.equal(lib.winterLineFamily('E105'),'105');
 assert.ok(data.some(x=>x[3].some(l=>l[4]&&/NON TRANSITA|DEVIAZIONE|EFFETTUA PARTENZA/i.test(l[4]))));
});

test('winter workflow never replaces obligatory Academy GPX with GTFS geometry',()=>{
 for(const snippet of [
  'selectedOfficial=route','showAcademyRoute(false)','showAcademyRoute(true)',
  'uniqueAcademyVariants(buildAcademyMatches(route).results)',
  'current?.reliable','stopSequenceKey(match.stops)','winterEndpointsAgree'
 ])assert.ok(source.includes(snippet),snippet);
 assert.ok(core.includes('function matchStopsStrict('));
 for(const id of ['winterCategory','winterDay','winterTurn','winterJourney','winterGpx'])
  assert.ok(html.includes('id="'+id+'"'),id);
});

test('winter IPA and bundle ID differ from stable app',()=>{
 assert.ok(ios.includes('PRODUCT_BUNDLE_IDENTIFIER: app.lineapilot.turni.experiment'));
 assert.ok(plist.includes('<string>LineaPilot Turni</string>'));
 assert.ok(prepare.includes('cp index.html app.js winter.js winter-turns.json'));
 assert.ok(fs.readFileSync('scripts/build-ios-unsigned.sh','utf8').includes('LineaPilot-Turni-unsigned.ipa'));
});

test('invalid PDF data is rejected and unavailable GPX is never invented',()=>{
 assert.equal(lib.winterValidCatalog([]),false);
 assert.equal(lib.winterValidCatalog([['F','BAD','PADOVA',[]]]),false);
 assert.equal(lib.winterCategoryForLine(''), '');
 assert.equal(lib.winterCategoryForLine('E'), '');
 assert.ok(source.includes('Non ho trovato GPX Academy'));
 assert.ok(source.includes('Non creo percorsi alternativi'));
});
