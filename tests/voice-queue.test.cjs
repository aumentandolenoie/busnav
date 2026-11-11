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
  ['resetVoiceGuidance','setVoiceStatus','setupVoice','voiceSpeaksFirst','chainVoiceText','takeNextVoice','enqueueVoice','drainVoice','speak'].map(sourceOf).join('\n'),context);
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
