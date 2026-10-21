// Downloaded CC0 audio, provenance and sample-exact seam: assets/music/SOURCES.md.
const STATES = ['explore', 'tense', 'result'];
const FADE = 0.04;
const trackFor = state => state === 'result' ? 'result' : 'explore';
const rateFor = state => state === 'tense' ? 1.25 : 1;
export function createMusicPlayer(opts = {}) {
  let ctx, master, analyser, samples, active, wanted = false, playing = false;
  let state = 'explore', muted = false, offset = 0, generation = 0, error = null;
  const cache = new Map();
  const doc = opts.document ?? globalThis.document;
  let storage;
  try { storage = opts.storage ?? globalThis.localStorage; muted = storage?.getItem('zteam-rpg-muted') === 'true'; } catch { /* Private-mode storage is optional. */ }
  const factory = opts.audioContextFactory ?? (() => {
    const Audio = globalThis.AudioContext ?? globalThis.window?.AudioContext ?? globalThis.webkitAudioContext ?? globalThis.window?.webkitAudioContext;
    if (!Audio) throw new Error('AudioContext unavailable');
    return new Audio();
  });
  const fetchAudio = opts.fetch ?? globalThis.fetch;
  function validate(next) { if (!STATES.includes(next)) throw new RangeError(`Unknown state: ${next}`); }
  function position(node = active) {
    if (!node) return offset;
    const elapsed = node.offset + Math.max(0, ctx.currentTime - node.started) * node.rate;
    return node.source.loop ? elapsed % node.buffer.duration : Math.min(elapsed, node.buffer.duration);
  }
  function ramp(param, value, duration = FADE) {
    const now = ctx.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
    param.linearRampToValueAtTime(value, now + duration);
  }
  function retire() {
    if (!active) return;
    const old = active; active = null;
    ramp(old.gain.gain, 0);
    old.source.stop(ctx.currentTime + FADE);
  }
  function halt() {
    offset = position(); generation++; playing = false; retire();
  }
  function output() {
    if (master) return;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.22;
    analyser = ctx.createAnalyser(); analyser.fftSize = 256;
    samples = new Float32Array(analyser.fftSize);
    master.connect(analyser); analyser.connect(ctx.destination);
  }
  function load(track) {
    if (!cache.has(track)) {
      const pending = (async () => {
        const response = await fetchAudio(new URL(`./assets/music/${track}.wav`, import.meta.url));
        if (!response.ok) throw new Error(`Music download failed: ${response.status ?? track}`);
        const data = await response.arrayBuffer();
        // Callback form also supports older Safari; current Safari additionally returns a Promise.
        return new Promise((resolve, reject) => {
          const decoded = ctx.decodeAudioData(data, resolve, reject);
          decoded?.then(resolve, reject);
        });
      })();
      cache.set(track, pending);
      pending.catch(() => { if (cache.get(track) === pending) cache.delete(track); });
    }
    return cache.get(track);
  }
  async function start(next) {
    const request = ++generation;
    try {
      ctx ??= factory();
      const resume = ctx.resume(); // Synchronous gesture stack, BEFORE any await/fetch/decode.
      await resume;
      if (request !== generation || !wanted || doc?.hidden) return;
      output();
      const track = trackFor(next), buffer = await load(track);
      if (request !== generation || !wanted || doc?.hidden) return;
      const nextOffset = active && trackFor(active.state) === track ? position() : offset;
      const startOffset = next === 'result' ? Math.min(nextOffset, buffer.duration) : nextOffset % buffer.duration;
      if (next === 'result' && startOffset >= buffer.duration) { wanted = playing = false; return; }
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = buffer; source.loop = next !== 'result';
      source.loopStart = 0; source.loopEnd = buffer.duration;
      const rate = rateFor(next), now = ctx.currentTime;
      source.playbackRate.setValueAtTime(rate, now);
      source.connect(gain); gain.connect(master);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(1, now + FADE);
      retire();
      const node = {source, gain, buffer, state: next, rate, offset: startOffset, started: now};
      active = node;
      source.onended = () => {
        source.disconnect(); gain.disconnect();
        if (active === node) {
          active = null; playing = false;
          // A previous one-shot may end while the next state's asset is still loading.
          if (state === node.state) { wanted = false; offset = buffer.duration; }
        }
      };
      source.start(now, startOffset); playing = true; error = null;
    } catch (failure) {
      if (request === generation) { error = String(failure.message ?? failure); wanted = false; halt(); }
      throw failure;
    }
  }
  const api = {
    async play(next = state) {
      validate(next);
      if (next !== state) { offset = trackFor(next) === trackFor(state) ? position() : 0; state = next; }
      if (playing && active?.state === next) return;
      wanted = true;
      await start(next);
    },
    async setState(next) {
      validate(next);
      if (next === state) return;
      offset = trackFor(next) === trackFor(state) ? position() : 0;
      state = next;
      // Invalidate even a load already pending while hidden/paused.
      generation++;
      if (wanted && !doc?.hidden) await start(next);
    },
    pause() { wanted = false; halt(); },
    setMuted(value) {
      muted = Boolean(value);
      try { storage?.setItem('zteam-rpg-muted', String(muted)); } catch { /* Disabled storage must not break audio. */ }
      if (master) ramp(master.gain, muted ? 0 : 0.22, 0.015);
    },
    cue(name) {
      const cues = {capture:[660,1047,0.18], lost:[330,110,0.28], horn:[196,294,0.55]};
      if (!Object.hasOwn(cues, name)) throw new RangeError(`Unknown cue: ${name}`);
      if (muted || !ctx || ctx.state !== 'running' || doc?.hidden) return false;
      output();
      const [from,to,duration] = cues[name], now = ctx.currentTime;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = name === 'horn' ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(from, now); osc.frequency.linearRampToValueAtTime(to, now + duration * 0.7);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.16, now + 0.008);
      gain.gain.linearRampToValueAtTime(0, now + duration);
      osc.connect(gain); gain.connect(master);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      osc.start(now); osc.stop(now + duration); return true;
    },
    getState() {
      let level = 0;
      if (playing && !muted && analyser) {
        analyser.getFloatTimeDomainData(samples);
        level = Math.sqrt(samples.reduce((sum,v) => sum + v*v, 0) / samples.length);
      }
      return { playing, muted, state, track: trackFor(state), contextState: ctx?.state ?? 'uninitialized', level, currentTime: ctx?.currentTime ?? 0, position: position(), error };
    },
  };
  doc?.addEventListener('visibilitychange', () => {
    if (doc.hidden) halt();
    else if (wanted) start(state).catch(failure => {
      // Event handlers cannot return promises to callers: expose failure in getState and logger.
      opts.logger?.warn?.('Music foreground resume failed', failure);
    });
  });
  return api;
}
