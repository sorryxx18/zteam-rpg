// Original 8-bar chip miniatures. No sampled or downloaded audio.
export function createMusicPlayer(opts = {}) {
  let ctx, playing = false, muted = false, track = null;
  const factory = opts.audioContextFactory ?? (() => {
    const AudioContext = globalThis.AudioContext ?? globalThis.window?.AudioContext ?? globalThis.window?.webkitAudioContext;
    if (!AudioContext) throw new Error('AudioContext unavailable');
    return new AudioContext();
  });
  const timers = opts.timers ?? globalThis;
  let master, analyser, samples, timer, sequence, index = 0, origin = 0, scheduledNotes = 0;
  const active = new Set();
  let generation = 0;
  function stop() {
    generation++;
    playing = false;
    if (timer !== undefined) { timers.clearInterval(timer); timer = undefined; }
    for (const {osc, gain} of active) {
      const now = ctx.currentTime;
      if (gain.gain.cancelAndHoldAtTime) gain.gain.cancelAndHoldAtTime(now);
      else { gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); }
      gain.gain.linearRampToValueAtTime(0, now + 0.01);
      osc.stop(now + 0.01);
    }
    active.clear();
  }
  function schedule() {
    const beat = 60 / SCORES[track].bpm;
    // A throttled tab must not enqueue a burst of overdue notes.
    if (origin + sequence[index].at * beat < ctx.currentTime - 0.15) {
      origin = ctx.currentTime + 0.02;
      index = 0;
    }
    while (origin + sequence[index].at * beat < ctx.currentTime + 0.12) {
      const event = sequence[index];
      const start = origin + event.at * beat;
      const duration = event.beats * beat * 0.86;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = event.voice === 'bass' ? 'triangle' : 'square';
      osc.frequency.setValueAtTime(440 * 2 ** ((event.midi - 69) / 12), start);
      const peak = event.voice === 'bass' ? 0.15 : 0.075;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.008);
      gain.gain.setValueAtTime(peak, start + duration - 0.018);
      gain.gain.linearRampToValueAtTime(0, start + duration);
      osc.connect(gain); gain.connect(master);
      const node = { osc, gain };
      active.add(node);
      osc.onended = () => { active.delete(node); osc.disconnect(); gain.disconnect(); };
      osc.start(start); osc.stop(start + duration);
      scheduledNotes++;
      if (++index === sequence.length) { index = 0; origin += 32 * beat; }
    }
  }
  const doc = opts.document ?? globalThis.document;
  let wanted = false;
  doc?.addEventListener('visibilitychange', () => {
    if (doc.hidden) stop();
    else if (wanted && track) api.play(track).catch(error => {
      wanted = false;
      opts.logger?.warn?.('Music resume failed', error);
    });
  });
  const api = {
    async play(id) {
      const nextSequence = buildSequence(id);
      if (playing && track === id) return;
      stop();
      wanted = true; track = id;
      sequence = nextSequence;
      const request = generation;
      try {
        ctx ??= factory();
        const resuming = ctx.resume(); // Keep inside the user-gesture call stack.
        await resuming;
      } catch (error) {
        if (request === generation) { wanted = false; stop(); }
        throw error;
      }
      if (request !== generation || doc?.hidden) return;
      if (!master) {
        master = ctx.createGain(); master.gain.value = muted ? 0 : 0.22;
        analyser = ctx.createAnalyser(); analyser.fftSize = 256;
        samples = new Float32Array(analyser.fftSize);
        master.connect(analyser); analyser.connect(ctx.destination);
      }
      track = id; playing = true; origin = ctx.currentTime + 0.02; index = 0;
      schedule();
      timer = timers.setInterval(schedule, 25);
    },
    pause() { wanted = false; stop(); },
    setMuted(value) {
      muted = Boolean(value);
      if (master) {
        const now = ctx.currentTime;
        if (master.gain.cancelAndHoldAtTime) master.gain.cancelAndHoldAtTime(now);
        else { master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now); }
        master.gain.linearRampToValueAtTime(muted ? 0 : 0.22, now + 0.015);
      }
    },
    getState() {
      let level = 0;
      if (playing && !muted && analyser) {
        analyser.getFloatTimeDomainData(samples);
        level = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
      }
      return { playing, muted, track, contextState: ctx?.state ?? 'uninitialized', level, scheduledNotes, currentTime: ctx?.currentTime ?? 0 };
    },
  };
  return api;
}

export const TRACKS = Object.freeze([
  Object.freeze({ id: 'street', name: '街角散步' }),
  Object.freeze({ id: 'march', name: '整裝出發' }),
  Object.freeze({ id: 'night', name: '夜巡微光' }),
]);
const SCORES = {
  street: { bpm: 108, melody: [64,67,69,67,62,64,71,69,67,64,62,59,60,64,67,62,64,69,72,71,67,69,64,62,60,62,67,64,62,59,62,64], bass: [48,45,53,55,48,45,53,55] },
  march: { bpm: 124, melody: [62,69,66,74,71,69,66,64,67,71,74,69,66,64,61,69,62,66,69,76,74,71,69,66,67,64,69,61,64,66,69,62], bass: [38,38,43,45,38,47,43,45] },
  night: { bpm: 84, melody: [69,72,76,71,67,74,71,64,65,69,72,76,74,71,67,64,69,76,79,74,72,67,71,74,65,72,69,64,67,71,64,69], bass: [45,40,41,43,45,40,41,40] },
};
export function buildSequence(trackId) {
  if (!Object.hasOwn(SCORES, trackId)) throw new RangeError(`Unknown track: ${trackId}`);
  const score = SCORES[trackId];
  return [
    ...score.melody.map((midi, at) => ({ midi, at, beats: 1, voice: 'melody' })),
    ...score.bass.flatMap((midi, bar) => [0, 2].map(offset => ({ midi, at: bar * 4 + offset, beats: 2, voice: 'bass' }))),
  ].sort((a, b) => a.at - b.at);
}
