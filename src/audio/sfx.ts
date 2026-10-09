/*
 * Little synthesised sounds for game moments, played straight to the output
 * (not into the mix, so they never land in a recording):
 *   buzz   a neon letter striking up: a crackle and a short mains hum
 *   bass   a sub hit for a big reveal
 *   cheer  a small crowd going up, with a whistle or two
 */

function out(ctx: AudioContext, level: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = level;
  g.connect(ctx.destination);
  return g;
}

function noise(ctx: AudioContext, secs: number): AudioBufferSourceNode {
  const len = Math.max(1, Math.floor(ctx.sampleRate * secs));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

/** a letter of the sign striking up */
export function buzz(ctx: AudioContext, level = 0.18): void {
  const t = ctx.currentTime;
  const o = out(ctx, level);
  // the crackle
  const n = noise(ctx, 0.08);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2800 + Math.random() * 1500;
  bp.Q.value = 1.2;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t);
  for (let i = 0; i < 4; i++) ng.gain.setValueAtTime(Math.random() < 0.6 ? 0.9 : 0.1, t + i * 0.012);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  n.connect(bp).connect(ng).connect(o);
  n.start(t);
  // the hum: mains frequency and its buzz
  const hum = ctx.createOscillator();
  hum.type = 'sawtooth';
  hum.frequency.value = 100;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0.0001, t);
  hg.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
  hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  hum.connect(lp).connect(hg).connect(o);
  hum.start(t);
  hum.stop(t + 0.35);
}

/** a sub hit */
export function bass(ctx: AudioContext, level = 0.8): void {
  const t = ctx.currentTime;
  const o = out(ctx, level);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(1, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  osc.connect(g).connect(o);
  osc.start(t);
  osc.stop(t + 1.5);
  // the click of the beater
  const n = noise(ctx, 0.03);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1500;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.5, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  n.connect(hp).connect(ng).connect(o);
  n.start(t);
}

/** a small crowd cheering */
export function cheer(ctx: AudioContext, level = 0.35, secs = 3.2): void {
  const t = ctx.currentTime;
  const o = out(ctx, level);
  // the roar: band-limited noise that swells and dies away
  for (const [f, q, pan] of [
    [900, 0.7, -0.4],
    [1600, 0.9, 0.4],
    [2600, 1.1, 0],
  ]) {
    const n = noise(ctx, secs);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    n.connect(bp).connect(g).connect(p).connect(o);
    n.start(t);
  }
  // a couple of whistles
  for (let i = 0; i < 2; i++) {
    const s = t + 0.3 + Math.random() * 0.9;
    const w = ctx.createOscillator();
    w.type = 'sine';
    w.frequency.setValueAtTime(1500 + Math.random() * 500, s);
    w.frequency.linearRampToValueAtTime(2400 + Math.random() * 400, s + 0.18);
    w.frequency.linearRampToValueAtTime(1900, s + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.12, s + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.55);
    w.connect(g).connect(o);
    w.start(s);
    w.stop(s + 0.6);
  }
}
