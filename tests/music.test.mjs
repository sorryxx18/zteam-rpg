import test from 'node:test';
import assert from 'node:assert/strict';
import {createMusicPlayer} from '../music.mjs';
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('real delivered CC0 WAVs fit 2MB; loop is sample-bounded with a continuous non-silent seam',async()=>{
  const root=new URL('../assets/music/',import.meta.url);
  const evidence=await readFile(new URL('SOURCES.md',root),'utf8');
  const metadata=JSON.parse(evidence.match(/```json\n([\s\S]*?)\n```/)[1]);
  const files=(await readdir(root)).filter(n=>/\.(wav|mp3|ogg|flac)$/i.test(n));
  assert.deepEqual(files.sort(),['explore.wav','result.wav']);
  let bytes=0;
  for(const file of files){
    const wav=await readFile(new URL(file,root));bytes+=wav.length;
    assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');
    let pcm,rate,channels,bits,format;
    for(let p=12;p+8<=wav.length;){const type=wav.toString('ascii',p,p+4),size=wav.readUInt32LE(p+4);if(type==='fmt '){format=wav.readUInt16LE(p+8);channels=wav.readUInt16LE(p+10);rate=wav.readUInt32LE(p+12);bits=wav.readUInt16LE(p+22);}if(type==='data')pcm=wav.subarray(p+8,p+8+size);p+=8+size+(size%2);}
    assert.equal(format,1);assert.equal(channels,1);assert.equal(rate,22050);assert.equal(bits,16);
    const m=metadata.files[file];assert.equal(pcm.length/2/rate,m.duration);
    assert.equal(createHash('sha256').update(wav).digest('hex'),m.sha256);
    assert.equal(m.loopStart,0);assert.equal(m.loopEnd,m.duration);
    if(file==='explore.wav'){
      assert.ok(Math.abs(pcm.readInt16LE(0)-pcm.readInt16LE(pcm.length-2))<=1,'sample-exact seam');
      for(const start of [0,pcm.length-2204]){let power=0;for(let i=start;i<start+2204;i+=2)power+=pcm.readInt16LE(i)**2;assert.ok(Math.sqrt(power/1102)>500,'no silent loop padding');}
    }
  }
  assert.ok(bytes<=2_000_000);
  assert.match(evidence,/license-name[^>]*>CC0/);assert.match(evidence,/publicdomain\/zero\/1.0/);
});

// Fake Web Audio verifies scheduling/state only; it does NOT prove audible quality or Safari playback.
function harness({fetch: fetchOverride, stored = null} = {}) {
  const sources=[], gains=[], oscillators=[], calls=[], values=new Map(stored ? [['zteam-rpg-muted',stored]] : []);
  const param=()=>({value:0,events:[],setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);},linearRampToValueAtTime(v,t){this.value=v;this.events.push(['ramp',v,t]);},cancelScheduledValues(){},cancelAndHoldAtTime(){}});
  const node=()=>({connect(){},disconnect(){this.disconnected=true;}});
  const ctx={state:'suspended',currentTime:10,destination:{},resume(){calls.push('resume');this.state='running';return Promise.resolve();},
    createGain(){const n={...node(),gain:param()};gains.push(n);return n;},
    createAnalyser(){return {...node(),fftSize:256,getFloatTimeDomainData(a){a.fill(0.04);}};},
    decodeAudioData(){return Promise.resolve({duration:16,sampleRate:22050});},
    createBufferSource(){const n={...node(),playbackRate:param(),start(...args){this.starts=args;},stop(t){this.stopAt=t;}};sources.push(n);return n;},
    createOscillator(){const n={...node(),frequency:param(),start(t){this.startAt=t;},stop(t){this.stopAt=t;}};oscillators.push(n);return n;}};
  const doc=new EventTarget();doc.hidden=false;
  const storage={getItem(k){return values.get(k)??null;},setItem(k,v){values.set(k,v);}};
  let creations=0;
  const player=createMusicPlayer({audioContextFactory(){creations++;calls.push('create');return ctx;},fetch:fetchOverride??(async url=>{calls.push(String(url));return {ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};}),storage,document:doc});
  return {player,ctx,sources,gains,oscillators,calls,values,doc,get creations(){return creations;}};
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};

test('mute persists, suppresses cues, and context stays lazy until explicit play',async()=>{
  const h=harness({stored:'true'});
  assert.equal(h.player.getState().muted,true);
  h.player.cue('horn');assert.equal(h.creations,0);
  h.player.setMuted(false);assert.equal(h.values.get('zteam-rpg-muted'),'false');
  await h.player.play();
  for(const name of ['capture','lost','horn'])assert.equal(h.player.cue(name),true);
  assert.equal(h.oscillators.length,3);
  assert.ok(h.oscillators.every(o=>o.stopAt-o.startAt<=0.7));
  h.player.setMuted(true);assert.equal(h.player.cue('capture'),false);
  assert.equal(h.player.getState().level,0);
  h.player.pause();assert.equal(h.player.getState().playing,false);
});

test('crossfades state switches; pause/background preserve phase and result ends once',async()=>{
  const h=harness();await h.player.play();
  const first=h.sources[0];h.ctx.currentTime+=3;
  await h.player.setState('tense');
  assert.equal(first.stopAt,13.04);
  assert.equal(h.sources[1].starts[1],3);
  assert.ok(h.gains.some(g=>g.gain.events.some(e=>e[0]==='ramp'&&e[1]===0)));
  h.ctx.currentTime+=2;
  h.doc.hidden=true;h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.player.getState().playing,false);
  h.ctx.currentTime+=100;
  h.doc.hidden=false;h.doc.dispatchEvent(new Event('visibilitychange'));await flush();
  assert.equal(h.player.getState().state,'tense');
  assert.equal(h.sources.at(-1).starts[1],5.5);
  await h.player.setState('result');assert.equal(h.sources.at(-1).loop,false);
  h.sources.at(-1).onended();assert.equal(h.player.getState().playing,false);
  h.doc.hidden=true;h.doc.dispatchEvent(new Event('visibilitychange'));
  h.doc.hidden=false;h.doc.dispatchEvent(new Event('visibilitychange'));await flush();
  assert.equal(h.player.getState().playing,false);
});

test('rapid async loads cannot resurrect paused or superseded music; failures are observable',async()=>{
  const pending=[];
  const h=harness({fetch:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
  const a=h.player.play('explore');await flush();
  const b=h.player.setState('result');await flush();
  pending[1].resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});await b;
  pending[0].reject(new Error('obsolete network'));await assert.rejects(a,/obsolete network/);
  assert.equal(h.player.getState().state,'result');assert.equal(h.player.getState().playing,true);
  const c=h.player.setState('explore');await flush();h.player.pause();
  pending[2].resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});await c;
  assert.equal(h.sources.length,1);assert.equal(h.player.getState().playing,false);
  const failed=harness({fetch:async()=>{throw new Error('offline');}});
  await assert.rejects(failed.player.play(),/offline/);
  assert.match(failed.player.getState().error,/offline/);
  assert.equal(failed.player.getState().playing,false);
});

test('ending old result during a pending exploration load does not cancel new intent',async()=>{
  let resolve;
  const h=harness({fetch:async url=>String(url).includes('result')?{ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}:new Promise(r=>{resolve=r;})});
  await h.player.play('result');
  const next=h.player.setState('explore');await flush();
  h.sources[0].onended();
  resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});await next;
  assert.equal(h.player.getState().playing,true);assert.equal(h.player.getState().state,'explore');
});

test('foreground resume failures remain observable and do not retry silently',async()=>{
  const h=harness();await h.player.play();
  h.doc.hidden=true;h.doc.dispatchEvent(new Event('visibilitychange'));
  h.ctx.resume=()=>Promise.reject(new Error('gesture expired'));
  h.doc.hidden=false;h.doc.dispatchEvent(new Event('visibilitychange'));await flush();
  assert.match(h.player.getState().error,/gesture expired/);assert.equal(h.player.getState().playing,false);
});

test('result survives background with original one-shot phase; pause invalidates pending resume',async()=>{
  const h=harness();await h.player.play('result');h.ctx.currentTime+=4;
  h.doc.hidden=true;h.doc.dispatchEvent(new Event('visibilitychange'));
  h.ctx.currentTime+=70;
  h.doc.hidden=false;h.doc.dispatchEvent(new Event('visibilitychange'));await flush();
  assert.equal(h.player.getState().state,'result');assert.equal(h.sources.at(-1).loop,false);
  assert.equal(h.sources.at(-1).starts[1],4);
  let resolve;h.player.pause();h.ctx.resume=()=>new Promise(r=>{resolve=r;});
  const pending=h.player.play('explore');h.player.pause();resolve();await pending;
  assert.equal(h.player.getState().playing,false);assert.equal(h.sources.length,2);
});

test('Safari callback decoding, denied gesture, HTTP/decode failure and blocked storage are explicit',async()=>{
  const callback=harness();callback.ctx.decodeAudioData=(_data,ok)=>{ok({duration:8,sampleRate:22050});};
  await callback.player.play();assert.equal(callback.player.getState().playing,true);
  const denied=harness();denied.ctx.resume=()=>Promise.reject(new Error('denied'));
  await assert.rejects(denied.player.play(),/denied/);assert.equal(denied.sources.length,0);
  const http=harness({fetch:async()=>({ok:false,status:404})});await assert.rejects(http.player.play(),/404/);
  const broken=harness();broken.ctx.decodeAudioData=()=>Promise.reject(new Error('bad WAV'));
  await assert.rejects(broken.player.play(),/bad WAV/);assert.match(broken.player.getState().error,/bad WAV/);
  const blocked=createMusicPlayer({storage:{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}}});
  assert.doesNotThrow(()=>blocked.setMuted(true));assert.equal(blocked.getState().muted,true);
  const absent=createMusicPlayer({storage:{},audioContextFactory(){throw new Error('Audio unavailable');}});
  await assert.rejects(absent.play(),/unavailable/);assert.equal(absent.getState().playing,false);
});

test('state may be selected before gesture; play creates/resumes synchronously before fetch',async()=>{
  const h=harness();
  await h.player.setState('tense');
  assert.equal(h.creations,0);assert.equal(h.player.getState().state,'tense');
  const p=h.player.play();assert.deepEqual(h.calls,['create','resume']);await p;
  assert.equal(h.player.getState().playing,true);assert.equal(h.player.getState().track,'explore');
  assert.equal(h.sources[0].playbackRate.value,1.25);
  assert.equal(h.sources[0].loop,true);assert.equal(h.sources[0].loopStart,0);assert.ok(h.sources[0].loopEnd>0);
  await h.player.setState('tense');assert.equal(h.sources.length,1);
  await assert.rejects(h.player.setState('__proto__'),/Unknown state/);
});
