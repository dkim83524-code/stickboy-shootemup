/*
 * All sound effects are synthesized here at startup into AudioBuffers; no audio files.
 * play(name, {pos}) applies simple distance attenuation and stereo panning.
 */

const SR = 44100;

function makeBuffer(ctx, dur, fn) {
  const n = Math.floor(SR * dur);
  const buf = ctx.createBuffer(1, n, SR);
  const d = buf.getChannelData(0);
  fn(d, n);
  // normalise to avoid clipping
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0.95) for (let i = 0; i < n; i++) d[i] *= 0.95 / peak;
  return buf;
}

const noise = () => Math.random() * 2 - 1;

/** One-pole low-pass that can have its cutoff changed per sample. */
function lowpass() {
  let y = 0;
  return (x, cutoff) => {
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    y += a * (x - y);
    return y;
  };
}

function tone() {
  let phase = 0;
  return (freq, shape = 'sine') => {
    phase += freq / SR;
    const p = phase % 1;
    if (shape === 'square') return p < 0.5 ? 1 : -1;
    if (shape === 'saw') return p * 2 - 1;
    if (shape === 'tri') return 1 - 4 * Math.abs(p - 0.5);
    return Math.sin(p * Math.PI * 2);
  };
}

const RECIPES = {
  minigun: [0.1, (d, n) => {
    const lp = lowpass();
    const t1 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = lp(noise(), 3200) * Math.exp(-t * 45) * 0.9 + t1(110 - t * 400) * Math.exp(-t * 55) * 0.6;
    }
  }],
  turret: [0.08, (d, n) => {
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = lp(noise(), 5000) * Math.exp(-t * 60) * 0.7;
    }
  }],
  rifle: [1.1, (d, n) => {
    const lp = lowpass();
    const lp2 = lowpass();
    const t1 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const x = noise();
      const crack = (x - lp2(x, 1500)) * Math.exp(-t * 40);
      const body = lp(x, 900 - t * 600) * Math.exp(-t * 5.5);
      d[i] = crack * 0.9 + body * 1.3 + t1(58) * Math.exp(-t * 9) * 0.7;
    }
  }],
  shotgun: [0.5, (d, n) => {
    const lp = lowpass();
    const t1 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = lp(noise(), 1800 - t * 2400) * Math.exp(-t * 9) * 1.2 + t1(70) * Math.exp(-t * 14) * 0.8;
    }
  }],
  revolver: [0.35, (d, n) => {
    const lp = lowpass();
    const hp = lowpass();
    const t1 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const x = noise();
      d[i] = lp(x, 2600) * Math.exp(-t * 15) + (x - hp(x, 3000)) * Math.exp(-t * 60) * 0.5 + t1(130 - t * 200) * Math.exp(-t * 25) * 0.6;
    }
  }],
  dronegun: [0.07, (d, n) => {
    const t1 = tone();
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = (t1(900 - t * 6000, 'square') * 0.3 + lp(noise(), 4000) * 0.6) * Math.exp(-t * 55);
    }
  }],
  punch: [0.2, (d, n) => {
    const t1 = tone();
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = t1(120 - t * 350) * Math.exp(-t * 28) + lp(noise(), 500) * Math.exp(-t * 35) * 1.2;
    }
  }],
  slash: [0.28, (d, n) => {
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.sin((Math.PI * t) / 0.28);
      d[i] = lp(noise(), 800 + t * 20000) * env * 0.9;
    }
  }],
  swing: [0.22, (d, n) => {
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.sin((Math.PI * t) / 0.22);
      d[i] = lp(noise(), 400 + t * 5000) * env * 0.6;
    }
  }],
  bolt: [0.3, (d, n) => {
    const t1 = tone();
    const t2 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = (t1(950 - t * 2200 + Math.sin(t * 90) * 60) * 0.6 + t2(1900 - t * 3000, 'tri') * 0.2) * Math.exp(-t * 10);
    }
  }],
  frost: [0.35, (d, n) => {
    const t1 = tone();
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const x = noise();
      d[i] = (t1(2200 - t * 2400) * 0.4 + (x - lp(x, 4000)) * 0.6) * Math.exp(-t * 9);
    }
  }],
  lightning: [0.5, (d, n) => {
    const lp = lowpass();
    let gate = 1;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (i % 300 === 0) gate = Math.random() < 0.6 ? 1 : 0.15;
      d[i] = lp(noise(), 6000) * gate * Math.exp(-t * 6) * 1.1;
    }
  }],
  cast: [1.2, (d, n) => {
    const t1 = tone();
    const t2 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t * 3) * Math.exp(-Math.max(0, t - 1) * 8);
      d[i] = (t1(180 + t * 420) * 0.5 + t2(270 + t * 630, 'tri') * 0.3) * env * (0.7 + 0.3 * Math.sin(t * 40));
    }
  }],
  explosion: [1.6, (d, n) => {
    const lp = lowpass();
    const t1 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = lp(noise(), Math.max(120, 2400 - t * 2200)) * Math.exp(-t * 2.8) * 1.6 + t1(48 - t * 10) * Math.exp(-t * 3.5) * 0.9;
    }
  }],
  slam: [0.8, (d, n) => {
    const lp = lowpass();
    const t1 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = lp(noise(), 700) * Math.exp(-t * 5) * 1.4 + t1(55 - t * 20) * Math.exp(-t * 5) * 1.0;
    }
  }],
  hit: [0.07, (d, n) => {
    const t1 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = t1(1500) * Math.exp(-t * 70) * 0.6;
    }
  }],
  headshot: [0.35, (d, n) => {
    const t1 = tone();
    const t2 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = (t1(2100) * 0.5 + t2(3150) * 0.3) * Math.exp(-t * 11);
    }
  }],
  kill: [0.45, (d, n) => {
    const t1 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = t < 0.12 ? 1100 : 1650;
      d[i] = t1(f, 'tri') * Math.exp(-(t < 0.12 ? t : t - 0.12) * 9) * 0.6;
    }
  }],
  hurt: [0.2, (d, n) => {
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = lp(noise(), 700) * Math.exp(-t * 18) * 1.3;
    }
  }],
  dash: [0.3, (d, n) => {
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.sin((Math.PI * t) / 0.3);
      d[i] = lp(noise(), 300 + t * 6000) * env;
    }
  }],
  blink: [0.35, (d, n) => {
    const t1 = tone();
    const t2 = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = (t1(1600 * Math.exp(-t * 6)) * 0.5 + t2(2400 * Math.exp(-t * 4), 'tri') * 0.3) * Math.exp(-t * 7);
    }
  }],
  grapple: [0.35, (d, n) => {
    const t1 = tone();
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = (t1(600 + t * 3000, 'saw') * 0.25 + lp(noise(), 3000) * 0.4) * Math.exp(-t * 6);
    }
  }],
  cloak: [0.6, (d, n) => {
    const t1 = tone();
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = (t1(700 - t * 800) * 0.35 + lp(noise(), 900) * 0.3) * Math.sin((Math.PI * t) / 0.6);
    }
  }],
  super: [1.0, (d, n) => {
    const a = tone();
    const b = tone();
    const c = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t * 12) * Math.exp(-t * 2.5);
      const bend = 1 + t * 0.25;
      d[i] = (a(220 * bend, 'saw') * 0.25 + b(277 * bend, 'saw') * 0.2 + c(330 * bend, 'tri') * 0.35) * env;
    }
  }],
  ready: [0.5, (d, n) => {
    const a = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = t < 0.15 ? 660 : t < 0.3 ? 880 : 1320;
      d[i] = a(f, 'tri') * 0.5 * Math.exp(-(t % 0.15) * 6);
    }
  }],
  heal: [0.6, (d, n) => {
    const a = tone();
    const b = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = t < 0.12 ? 660 : t < 0.24 ? 880 : 1100;
      d[i] = (a(f, 'tri') * 0.4 + b(f * 2) * 0.15) * Math.exp(-(t % 0.12) * 5) * Math.exp(-t * 2.5);
    }
  }],
  build: [0.35, (d, n) => {
    const a = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = t < 0.1 ? 420 : t < 0.2 ? 560 : 700;
      d[i] = a(f, 'square') * 0.25 * Math.exp(-(t % 0.1) * 20);
    }
  }],
  spin: [0.6, (d, n) => {
    const a = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = a(180 + t * 1200, 'saw') * 0.18 * Math.min(1, t * 8) * Math.exp(-t * 1.5);
    }
  }],
  reload: [0.4, (d, n) => {
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const k = t < 0.2 ? t : t - 0.22;
      d[i] = k >= 0 ? lp(noise(), 3500) * Math.exp(-k * 90) : 0;
    }
  }],
  knife: [0.2, (d, n) => {
    const lp = lowpass();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = lp(noise(), 1500 + t * 15000) * Math.sin((Math.PI * t) / 0.2) * 0.7;
    }
  }],
  ricochet: [0.35, (d, n) => {
    const a = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = a(3400 - t * 5000) * Math.exp(-t * 9) * 0.35;
    }
  }],
  deny: [0.18, (d, n) => {
    const a = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = a(130, 'square') * 0.2 * Math.exp(-t * 8);
    }
  }],
  empty: [0.06, (d, n) => {
    const lp = lowpass();
    for (let i = 0; i < n; i++) d[i] = lp(noise(), 5000) * Math.exp((-i / SR) * 120);
  }],
  step: [0.08, (d, n) => {
    const lp = lowpass();
    for (let i = 0; i < n; i++) d[i] = lp(noise(), 350) * Math.exp((-i / SR) * 50) * 0.6;
  }],
  land: [0.15, (d, n) => {
    const lp = lowpass();
    for (let i = 0; i < n; i++) d[i] = lp(noise(), 280) * Math.exp((-i / SR) * 25);
  }],
  pad: [0.5, (d, n) => {
    const a = tone();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = a(200 + t * 900, 'tri') * 0.5 * Math.exp(-t * 4);
    }
  }],
  drone: [0.5, (d, n) => {
    const a = tone();
    const b = tone();
    for (let i = 0; i < n; i++) {
      // loops seamlessly enough at 0.5s
      d[i] = a(180, 'saw') * 0.12 + b(182, 'saw') * 0.12;
    }
  }],
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.volume = 0.6;
    this.voices = 0;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.loops = new Map();
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    for (const [name, [dur, fn]] of Object.entries(RECIPES)) {
      this.buffers[name] = makeBuffer(this.ctx, dur, fn);
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(pos, yaw) {
    this.listener.x = pos.x;
    this.listener.y = pos.y;
    this.listener.z = pos.z;
    this.listener.yaw = yaw;
  }

  spatial(pos) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.x;
    const dy = pos.y - this.listener.y;
    const dz = pos.z - this.listener.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gain = 1 / (1 + (dist / 14) ** 2);
    // project onto listener's right vector
    const rx = Math.cos(this.listener.yaw);
    const rz = -Math.sin(this.listener.yaw);
    const pan = dist > 0.01 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist)) * 0.8 : 0;
    return { gain, pan };
  }

  play(name, { pos = null, volume = 1, rate = 1, jitter = 0.06 } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const buf = this.buffers[name];
    if (!buf) return;
    const { gain, pan } = this.spatial(pos);
    const g = gain * volume;
    if (g < 0.015) return;
    if (this.voices > 40) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const gn = ctx.createGain();
    gn.gain.value = g;
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan;
    src.connect(gn).connect(pn).connect(this.master);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      gn.disconnect();
      pn.disconnect();
    };
    src.start();
  }

  /** Start/update/stop a looping sound identified by key. */
  loop(key, name, { pos = null, volume = 1, rate = 1 } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    let l = this.loops.get(key);
    if (!l) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers[name];
      src.loop = true;
      const gn = ctx.createGain();
      const pn = ctx.createStereoPanner();
      src.connect(gn).connect(pn).connect(this.master);
      src.start();
      l = { src, gn, pn };
      this.loops.set(key, l);
    }
    const { gain, pan } = this.spatial(pos);
    l.gn.gain.value = gain * volume;
    l.pn.pan.value = pan;
    l.src.playbackRate.value = rate;
  }

  stopLoop(key) {
    const l = this.loops.get(key);
    if (!l) return;
    l.src.stop();
    l.src.disconnect();
    l.gn.disconnect();
    l.pn.disconnect();
    this.loops.delete(key);
  }

  stopAllLoops() {
    for (const key of [...this.loops.keys()]) this.stopLoop(key);
  }
}

export const sfx = new Sfx();
