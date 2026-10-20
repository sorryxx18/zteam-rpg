import test from 'node:test';
import assert from 'node:assert/strict';
const music = await import('../music.mjs').catch(() => ({}));

function harness({deferred = false} = {}) {
  const timers = new Map();
  const oscillators = [];
  const gains = [];
  const param = () => ({ value: 0, events: [], setValueAtTime(v,t) {this.value=v; this.events.push(['set',v,t]);}, linearRampToValueAtTime(v,t) {this.value=v; this.events.push(['ramp',v,t]);}, cancelScheduledValues() {} });
  const resumes=[];
  let resolveResume;
  const ctx = {
    currentTime: 10, state: 'suspended', resumes: 0, destination: {},
    resume() { this.resumes++; if (deferred) return new Promise(r => {resolveResume=()=>{this.state='running';r();}; resumes.push(resolveResume);}); this.state='running'; return Promise.resolve(); },
    createGain() { const n={gain:param(), connect(){}, disconnect(){}}; gains.push(n); return n; },
    createAnalyser() {return {fftSize:256, connect(){}, getFloatTimeDomainData(a){a.fill(0.04);}};},
    createOscillator() {const n={frequency:param(), connect(){}, disconnect(){this.disconnected=true;}, start(t){this.startAt=t;}, stop(t){this.stops??=[];this.stops.push(t);}}; oscillators.push(n); return n;},
  };
  const doc = new EventTarget(); doc.hidden=false;
  let creations=0, serial=0;
  const player = music.createMusicPlayer({audioContextFactory(){creations++; return ctx;}, timers:{setInterval(fn){timers.set(++serial,fn);return serial;},clearInterval(id){timers.delete(id);}}, document:doc});
  return {player, ctx, timers, oscillators, gains, doc, get creations(){return creations;}, resolveAll(){resumes.forEach(r=>r());}, resolve(){resolveResume();}, tick(){for(const fn of timers.values()) fn();}};
}

test('player is lazy with a synchronous immutable-by-copy state and graceful absent audio', async () => {
  assert.equal(typeof music.createMusicPlayer, 'function');
  const h=harness();
  assert.equal(h.creations,0);
  assert.deepEqual(h.player.getState(), {playing:false,muted:false,track:null,contextState:'uninitialized',level:0,scheduledNotes:0,currentTime:0});
  const snapshot=h.player.getState(); snapshot.playing=true;
  assert.equal(h.player.getState().playing,false);
  h.player.pause(); h.player.setMuted(true);
  const unavailable=music.createMusicPlayer({audioContextFactory(){throw new Error('AudioContext unavailable');}});
  await assert.rejects(unavailable.play('street'), /unavailable/);
  assert.equal(unavailable.getState().playing,false);
  await assert.rejects(h.player.play('invalid'), /Unknown track/);
  assert.equal(h.creations,0);
});

test('play resumes in gesture stack and schedules quiet enveloped two-voice notes with lookahead loops', async () => {
  const h=harness();
  const promise=h.player.play('street');
  assert.equal(h.ctx.resumes,1, 'resume must precede first await');
  await promise;
  assert.equal(h.player.getState().playing,true);
  assert.equal(h.player.getState().track,'street');
  assert.equal(h.timers.size,1);
  assert.equal(h.oscillators.length,2);
  assert.ok(h.player.getState().level > 0);
  assert.equal(h.player.getState().currentTime,10);
  for(const osc of h.oscillators) {
    assert.ok(['square','triangle'].includes(osc.type));
    assert.ok(osc.frequency.value > 0);
    assert.ok(osc.startAt >= 10 && osc.startAt < 10.15);
    assert.ok(osc.stops[0] > osc.startAt);
  }
  const envelopes=h.gains.filter(g=>g.gain.events.length>=4);
  assert.equal(envelopes.length,2);
  for(const g of envelopes) {
    assert.equal(g.gain.events[0][1],0);
    assert.equal(g.gain.events.at(-1)[1],0);
    assert.ok(Math.max(...g.gain.events.map(e=>e[1])) <= 0.16);
  }
  let last=h.oscillators.length;
  for(let i=0;i<400;i++) {h.ctx.currentTime+=0.05; h.tick();}
  assert.ok(h.oscillators.length > 48, 'schedules beyond first 32-beat loop');
  assert.ok(h.player.getState().scheduledNotes > last);
  assert.ok(h.oscillators.every(o=>o.startAt>=10));
});

test('same-track clicks are idempotent; switching and pause retire every old oscillator and timer', async () => {
  const h=harness(); await h.player.play('street');
  const old=[...h.oscillators];
  await h.player.play('street');
  assert.equal(h.oscillators.length,old.length);
  assert.equal(h.timers.size,1);
  await h.player.play('march');
  assert.equal(h.player.getState().track,'march');
  assert.equal(h.timers.size,1);
  assert.ok(old.every(o=>o.stops.length===2));
  assert.ok(old.every(o=>o.stops.at(-1)<=10.012));
  const before=h.oscillators.length;
  h.player.pause(); h.ctx.currentTime=11; h.tick();
  assert.equal(h.timers.size,0);
  assert.equal(h.oscillators.length,before);
  assert.equal(h.player.getState().playing,false);
  assert.equal(h.player.getState().level,0);
  assert.ok(h.oscillators.every(o=>o.stops.length===2));
});

test('pending resumes cannot resurrect pause or let rapid switches create overlapping timers', async () => {
  const h=harness({deferred:true});
  const first=h.player.play('street');
  h.player.pause(); h.resolve(); await first;
  assert.equal(h.player.getState().playing,false);
  assert.equal(h.timers.size,0);
  const a=h.player.play('street'); const b=h.player.play('night');
  h.resolveAll(); await Promise.all([a,b]);
  assert.equal(h.player.getState().track,'night');
  assert.equal(h.oscillators.length,2);
  assert.equal(h.timers.size,1);
  h.player.pause();
});

test('mute ramps actual master gain to zero and preserves play, pause and switch intent', async () => {
  const h=harness(); await h.player.play('street');
  const master=h.gains[0];
  h.player.setMuted(true);
  assert.equal(master.gain.events.at(-1)?.[1],0);
  assert.equal(h.player.getState().level,0);
  assert.equal(h.player.getState().playing,true);
  await h.player.play('night');
  assert.equal(h.player.getState().muted,true);
  h.player.pause(); h.player.setMuted(false);
  assert.equal(h.timers.size,0);
  assert.equal(h.player.getState().playing,false);
  await h.player.play('march');
  assert.ok(master.gain.events.at(-1)[1]>0);
  assert.ok(h.player.getState().level>0);
  h.player.pause();
});

test('visibility auto-pauses and restores only prior play intent without changing mute', async () => {
  const h=harness(); await h.player.play('night'); h.player.setMuted(true);
  h.doc.hidden=true; h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.player.getState().playing,false);
  assert.equal(h.timers.size,0);
  h.doc.hidden=false; h.doc.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.player.getState().playing,true);
  assert.equal(h.player.getState().muted,true);
  assert.equal(h.player.getState().track,'night');
  h.doc.hidden=true; h.doc.dispatchEvent(new Event('visibilitychange'));
  h.player.pause();
  h.doc.hidden=false; h.doc.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  assert.equal(h.player.getState().playing,false);
  assert.equal(h.timers.size,0);
  const pending=harness({deferred:true}); const p=pending.player.play('street');
  pending.doc.hidden=true; pending.doc.dispatchEvent(new Event('visibilitychange'));
  pending.resolve(); await p;
  assert.equal(pending.timers.size,0);
});

test('inherited object names are rejected as invalid tracks without disturbing playback', async () => {
  const h=harness(); await h.player.play('march');
  assert.throws(()=>music.buildSequence('toString'), /Unknown track/);
  await assert.rejects(h.player.play('__proto__'), /Unknown track/);
  assert.equal(h.player.getState().track,'march');
  assert.equal(h.timers.size,1); h.player.pause();
});

test('failed resume clears playback intent so visibility cannot silently retry it', async () => {
  const h=harness(); h.ctx.resume=()=>{h.ctx.resumes++;return Promise.reject(new Error('gesture denied'));};
  await assert.rejects(h.player.play('night'), /gesture denied/);
  h.doc.hidden=true; h.doc.dispatchEvent(new Event('visibilitychange'));
  h.doc.hidden=false; h.doc.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.ctx.resumes,1);
  assert.equal(h.player.getState().playing,false);
  assert.equal(h.timers.size,0);
});

test('three original tracks expose valid distinct looping two-voice scores', () => {
  assert.deepEqual(music.TRACKS, [
    {id:'street', name:'街角散步'}, {id:'march', name:'整裝出發'}, {id:'night', name:'夜巡微光'},
  ]);
  const scores = music.TRACKS.map(({id}) => music.buildSequence(id));
  for (const score of scores) {
    assert.ok(score.length >= 32);
    assert.deepEqual([...new Set(score.map(e => e.voice))].sort(), ['bass', 'melody']);
    for (const e of score) {
      assert.ok(Number.isInteger(e.midi) && e.midi >= 36 && e.midi <= 84);
      assert.ok(e.beats > 0 && e.at >= 0 && e.at + e.beats <= 32);
    }
    assert.equal(Math.max(...score.map(e => e.at + e.beats)), 32);
  }
  assert.equal(new Set(scores.map(s => JSON.stringify(s))).size, 3);
  assert.throws(() => music.buildSequence('missing'), /Unknown track/);
});
