// Tiny synthesised sound kit (WebAudio). No audio files needed.
let ctx = null, master = null, noiseBuf = null;

export function initAudio() {
  if (ctx) { ctx.resume?.(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}

function env(gainNode, t, a, peak, dur) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(peak, t + a);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function tone(type, f0, f1, dur, vol, delay = 0) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, 0.005, vol, dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, freq = 2000, q = 0.8, delay = 0) {
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t, 0.003, vol, dur);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.02);
}

const SOUNDS = {
  shot: (v) => { tone('square', 1300, 380, 0.05, 0.12 * v); noise(0.05, 0.25 * v, 3200, 1.2); },
  hit: () => tone('triangle', 1900, 1700, 0.05, 0.25),
  head: () => { tone('triangle', 2500, 2300, 0.07, 0.3); tone('sine', 3200, 3000, 0.05, 0.15, 0.02); },
  kill: () => { tone('triangle', 900, 900, 0.08, 0.3); tone('triangle', 1350, 1350, 0.12, 0.3, 0.07); },
  blink: (v) => { tone('sine', 400, 1800, 0.12, 0.25 * v); noise(0.15, 0.2 * v, 5000, 2); },
  rewind: () => { tone('sawtooth', 1400, 200, 1.2, 0.08); tone('sine', 900, 120, 1.2, 0.15); },
  rewindEnd: () => tone('sine', 300, 1200, 0.15, 0.2),
  reload: () => { tone('square', 500, 450, 0.04, 0.08); tone('square', 800, 760, 0.04, 0.08, 0.5); },
  jump: () => noise(0.06, 0.06, 900, 1),
  hurt: () => tone('sawtooth', 220, 140, 0.12, 0.12),
  throw: () => tone('sine', 600, 300, 0.2, 0.2),
  tick: () => tone('square', 2200, 2200, 0.03, 0.12),
  boom: (v) => { noise(0.8, 0.9 * v, 400, 0.4); tone('sine', 120, 35, 0.7, 0.6 * v); },
  stick: () => tone('triangle', 1500, 1000, 0.08, 0.25),
  ready: () => { tone('sine', 700, 700, 0.1, 0.2); tone('sine', 1050, 1050, 0.15, 0.2, 0.1); },
};

/** volume 0..1 (scaled by distance for other players' sounds) */
export function play(name, volume = 1) {
  if (!ctx || volume < 0.03) return;
  try { SOUNDS[name]?.(volume); } catch { /* ignore audio errors */ }
}
