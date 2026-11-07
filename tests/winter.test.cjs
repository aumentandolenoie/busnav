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
 while(depth&&end<source.length){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;end++}
 return source.slice(match.index,end);
}
const funcs=['winterValidCatalog','winterCategoryForLine','winterNorm','winterParts','winterRank','winterLineFamily'];
const lib=new Function(funcs.map(fn).join('\n')+';return {winterValidCatalog,winterCategoryForLine,winterNorm,winterRank,winterLineFamily};')();

test('the extracted 2026/27 winter catalog loads on its own without user-uploaded files',()=>{
 assert.equal(lib.winterValidCatalog(data),true);
 assert.equal(data.length,570);
 assert.equal(data.reduce((n,row)=>n+row[3].length,0),3724);
 assert.deepEqual([...new Set(data.map(x=>x[0]))].sort(),['D','F','S']);
 for(const day of ['F','S','D']){
  assert.ok(data.some(x=>x[0]===day&&/^P\\d{3}$/.test(x[1])));
 }
 assert.ok(data.some(x=>x[3].some(leg=>leg[3]==='E060-V')));
 assert.ok(data.some(x=>x[3].some(leg=>leg[3]==='E060-Z')));
 assert.match(source,/winterLoadBundled\\(\\)/);
 assert.match(source,/fetch\\('\.\\/winter-turns\\.json'\\)/);
 assert.match(prepare,/winter-turns\\.json/);
});

test('PDF shift categories and variants are not silently conflated',()=>{
 assert.equal(lib.winterCategoryForLine('E060-V'),'Extraurbano');
 assert.equal(lib.winterCategoryForLine('E060-Z'),'Extraurbano');
 assert.equal(lib.winterCategoryForLine('M'),'Colli');
 assert.equal(lib.winterCategoryForLine('TL'),'Colli');
 assert.equal(lib.winterCategoryForLine('U06'),'Urbano');
 assert.equal(lib.winterLineFamily('E060-V'),lib.winterLineFamily('E060-Z'));
 assert.equal(lib.winterLineFamily('E105'),'105');
 assert.ok(data.some(x=>x[3].some(l=>l[4]&&/NON TRANSITA|DEVIAZIONE|EFFETTUA PARTENZA/i.test(l[4]))));
});

test('winter UI always uses original Academy GPX and independent Busitalia stops',()=>{
 assert.match(source,/selectedOfficial=route/);
 assert.match(source,/showAcademyRoute\\(false\\)/);
 assert.match(source,/showAcademyRoute\\(true\\)/);
 assert.match(source,/uniqueAcademyVariants\\(buildAcademyMatches\\(route\\)\\.results\\)/);
 assert.match(source,/current\\?\\.reliable/);
 assert.match(source,/stopSequenceKey\\(match\\.stops\\)/);
 assert.match(core,/function matchStopsStrict\\(/);
 assert.match(source,/winterEndpointsAgree/);
 assert.match(html,/id="winterCategory"/);
 assert.match(html,/id="winterDay"/);
 assert.match(html,/id="winterTurn"/);
 assert.match(html,/id="winterJourney"/);
 assert.match(html,/id="winterGpx"/);
});

test('winter IPA has a separate bundle ID and app name, leaving main intact',()=>{
 assert.match(ios,/PRODUCT_BUNDLE_IDENTIFIER: app\\.lineapilot\\.turni\\.experiment/);
 assert.match(plist,/<string>LineaPilot Turni<\\/string>/);
 assert.match(prepare,/cp index\\.html app\\.js winter\\.js winter-turns\\.json/);
 assert.match(fs.readFileSync('scripts/build-ios-unsigned.sh','utf8'),/LineaPilot-Turni-unsigned\\.ipa/);
});

test('invalid or incomplete PDF entries are rejected rather than matched to an invented route',()=>{
 assert.equal(lib.winterValidCatalog([]),false);
 assert.equal(lib.winterValidCatalog([['F','BAD','PADOVA',[]]]),false);
 assert.equal(lib.winterCategoryForLine(''), '');
 assert.equal(lib.winterCategoryForLine('E'), '');
 assert.match(source,/Non ho trovato GPX Academy/);
 assert.match(source,/Non creo percorsi alternativi/);
});
