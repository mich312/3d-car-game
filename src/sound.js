// Procedural sound effects — everything is synthesized with WebAudio, no
// asset downloads. initAudio() must be called from a user gesture (the
// lobby's START ENGINE click); every play function is a no-op before that.

let ctx = null;
let master = null;
let noise = null; // cached 1s white-noise buffer
let boostGain = null;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Noise burst through a lowpass — the crunch of a crash, scaled to impact.
export function playCrash(power) {
  if (!ctx) return;
  const k = clamp01((power - 7) / 28);
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(500 + k * 1800, t);
  lp.frequency.exponentialRampToValueAtTime(120, t + 0.28);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.15 + k * 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  src.connect(lp).connect(g).connect(master);
  src.start(t, Math.random() * 0.4, 0.35);
}

// Low sine drop + noise tap — landing after a jump.
export function playThud(hard) {
  if (!ctx) return;
  const k = clamp01(hard);
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(95, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.12 + k * 0.35, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.22);
}

// Continuous filtered-noise hiss while the nitro burns.
export function setBoost(on) {
  if (!ctx) return;
  if (!boostGain) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 950;
    bp.Q.value = 0.8;
    boostGain = ctx.createGain();
    boostGain.gain.value = 0;
    src.connect(bp).connect(boostGain).connect(master);
    src.start();
  }
  const t = ctx.currentTime;
  boostGain.gain.cancelScheduledValues(t);
  boostGain.gain.linearRampToValueAtTime(on ? 0.09 : 0, t + 0.12);
}

// Two quick rising blips — coin / crystal pickup.
export function playCoin() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [880, 1318].forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = ctx.createGain();
    const t0 = t + i * 0.07;
    g.gain.setValueAtTime(0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.14);
  });
}

// Little three-note arpeggio for records.
export function playFanfare() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [523, 659, 784].forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    const g = ctx.createGain();
    const t0 = t + i * 0.11;
    g.gain.setValueAtTime(0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  });
}

// Plasticky tap — a traffic cone going flying.
export function playKnock() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(420, t);
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.09);
}
