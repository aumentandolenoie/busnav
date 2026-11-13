'use strict';
// Spoken guidance: close cues are chained in route order and a stuck synthesizer
// never silences the following cues (regression: voice stopped until the top button).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const js=fs.readFileSync('app.js','utf8');
function sourceOf(name){
 const match=new RegExp('function\\s+'+name+'\\s*\\(').exec(js);
 assert.ok(match,'Missing '+name);
 // Skip the parameter list: default values such as options={} contain braces.
 let open=js.indexOf('(',match.index),parens=1,cursor=open+1;
 while(parens&&cursor<js.length){if(js[cursor]==='(')parens++;else if(js[cursor]===')')parens--;cursor++;}
 let first=js.indexOf('{',cursor),depth=1,index=first+1;
 while(depth&&index<js.length){if(js[index]==='{')depth++;else if(js[index]==='}')depth--;index++;}
 return js.slice(match.index,index);
}
function harness(){
 let clock=1_000_000,timers=[],timerId=0;
 const spoken=[],utterances=[];
 const synth={speaking:false,pending:false,paused:false,
  speak(u){utterances.push(u);spoken.push(u.text);this.speaking=true},
  cancel(){const u=utterances.find(x=>!x.done);this.speaking=false;if(u){u.done=true;u.onerror?.({error:'interrupted'})}},
  resume(){},getVoices:()=>[]};
 const status={dataset:{}};
 const context={
  Date:{now:()=>clock},console:{warn(){}},
  setTimeout:(fn,ms)=>{const id=++timerId;timers.push({id,at:clock+ms,fn});return id},
  clearTimeout:id=>{timers=timers.filter(t=>t.id!==id)},
  speechSynthesis:synth,
  SpeechSynthesisUtterance:function(text){this.text=text},
  window:{},
  nativeActive:false,
  voicePreferences:{id:'',rate:1},
  $:id=>id==='voiceToggle'?{checked:true}:status,
 };
 context.window.speechSynthesis=synth;
 vm.createContext(context);
 const decl=js.slice(js.indexOf('let voiceQueue=[]'),js.indexOf('function resetVoiceGuidance'));
 vm.runInContext(decl.replace(/^let /gm,'var ').replace(/^const /gm,'var ')+
  'var driveVoiceProblem=false,driveVoiceText="";\n'+['resetVoiceGuidance','setVoiceStatus','renderDriveStatus','setupVoice','voiceSpeaksFirst','chainVoiceText','takeNextVoice','enqueueVoice','drainVoice','speak'].map(sourceOf).join('\n'),context);
 const api={
  context,spoken,utterances,synth,
  advance(ms){const end=clock+ms;for(;;){timers.sort((a,b)=>a.at-b.at);const t=timers[0];if(!t||t.at>end)break;timers.shift();clock=t.at;t.fn()}clock=end},
  start(i=utterances.length-1){utterances[i].onstart?.()},
  end(i=utterances.length-1){const u=utterances[i];u.done=true;synth.speaking=false;u.onend?.()},
  position(along){vm.runInContext('voiceAlong='+along+';voicePositionOk=true',context)},
  say:(...a)=>context.enqueueVoice(...a),
 };
 return api;
}
test('close stop and turn cues are chained, nearest first, with live distances',()=>{
 const h=harness();
 h.position(0);
 assert.equal(h.say('Tra 300 metri, prossima fermata: Noale.','stop',{key:'stop:1',target:300,build:l=>'Tra '+Math.round(l)+' metri, prossima fermata: Noale.'}),true);
 h.start();
 // While the stop is being read, two manoeuvres come up: neither is dropped.
 assert.equal(h.say('Tra circa 200 metri, svolta a destra.','turn',{key:'turn:4',target:420,build:l=>'Tra circa '+Math.round(l)+' metri, svolta a destra.'}),true);
 assert.equal(h.say('Tra circa 150 metri, svolta a sinistra.','turn',{key:'turn:3',target:180,build:l=>'Tra circa '+Math.round(l)+' metri, svolta a sinistra.'}),true);
 assert.equal(h.spoken.length,1,'The first cue is never cut off');
 h.position(30);
 h.end();
 assert.equal(h.spoken[1],'Poi, tra circa 150 metri, svolta a sinistra.','Nearest manoeuvre first, distance recomputed');
 h.start();h.end();
 assert.equal(h.spoken[2],'Poi, tra circa 390 metri, svolta a destra.');
});
test('a synthesizer that never reports the end does not silence later cues',()=>{
 const h=harness();
 h.say('Tra 200 metri, prossima fermata: Noale.','stop');
 h.start(); // started, but onend never arrives (the reported bug)
 h.say('Tra poco, svolta a destra.','turn');
 h.advance(15000);
 assert.equal(h.spoken.length,2,'Watchdog released the queue');
 assert.equal(h.spoken[1],'Poi, tra poco, svolta a destra.');
 h.start();h.end();
 h.say('Fermata in arrivo: Noale.','stop');
 assert.equal(h.spoken.length,3,'Guidance continues without pressing any button');
});
test('an utterance that never starts is skipped and the queue continues',()=>{
 const h=harness();
 h.say('Prima.','normal');
 h.say('Seconda.','normal');
 h.advance(6000);
 assert.equal(h.spoken.at(-1),'Seconda.');
});
test('passed and duplicate cues are not read late',()=>{
 const h=harness();
 h.position(0);
 h.say('Uno.','normal');h.start();
 h.say('Svolta.','turn',{key:'turn:1',target:100});
 h.say('Tra poco, svolta.','turn',{key:'turn:1',target:100});
 assert.equal(h.context.voiceQueue.length,1,'Same manoeuvre queued once');
 h.position(200);
 h.end();
 assert.equal(h.spoken.length,1,'A manoeuvre already passed is discarded');
});
test('Android bridge accepts the tokens of queued web cues',()=>{
 const java=fs.readFileSync('android/app/src/main/java/app/lineapilot/android/MainActivity.java','utf8');
 const accepted=new RegExp('^'+/token\.matches\("([^"]+)"\)/.exec(java)[1]+'$');
 const h=harness();
 const tokens=[];
 h.context.window.LineaPilotAndroid={speak:(m,v,r,token)=>tokens.push(token),stopSpeech(){}};
 h.say('Uno.','normal');
 h.context.window.lineaPilotAndroidSpeechDone(tokens[0],true);
 h.say('Due.','normal');
 assert.equal(tokens.length,2,'Second cue spoken after the Android callback');
 for(const token of tokens)assert.match(token,accepted);
});
test('web speed limit and camera rules match the native apps',()=>{
 const api=new Function('let current;'+['guidanceCovers','webSpeedLimit','nextWebCamera'].map(sourceOf).join('\n')+
  '\nreturn {set:c=>{current=c},webSpeedLimit,nextWebCamera};')();
 api.set({speedLimits:[[0,500,50],[500,900,80]],roadCameras:[{at:300,kind:'speed'},{at:700,kind:'redLight'}],
  guidanceCoverage:{ranges:[[0,600]]}});
 assert.equal(api.webSpeedLimit(200,5,2),50);
 assert.equal(api.webSpeedLimit(200,20,2),null,'Imprecise GPS hides the sign');
 assert.equal(api.webSpeedLimit(200,5,12),null,'Far from the GPX hides the sign');
 assert.equal(api.webSpeedLimit(495,5,2),null,'Two values in the uncertainty window');
 assert.equal(api.webSpeedLimit(700,5,2),null,'Outside validated guidance');
 assert.equal(api.nextWebCamera(100,350),0);
 assert.equal(api.nextWebCamera(100,350,new Set([0])),-1,'Camera beyond validated guidance');
 assert.equal(api.nextWebCamera(310,350),-1);
});
test('distances: 50 m steps from 100 m, 10 m from 50 m, 5 m below (same table as iOS/Android)',()=>{
 const api=new Function(['roundedDistance','kilometreText','niceDistance','speechDistance'].map(sourceOf).join('\n')+
  '\nreturn {niceDistance,speechDistance};')();
 const table=JSON.parse(fs.readFileSync('tests/fixtures/distance-text.json','utf8'));
 for(const [metres,display,spoken] of table){
  assert.equal(api.niceDistance(metres),display,'display '+metres);
  assert.equal(api.speechDistance(metres),spoken,'voice '+metres);
 }
});
