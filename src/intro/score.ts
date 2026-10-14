/*
 * The cutscene's soundtrack, synthesised: a deep, rolling minimal groove in
 * F dorian at 124 BPM. A round kick, a bouncy two-bar bassline, swung hats
 * and shakers, a clap on two and four, a little rim and conga, and dub chord
 * stabs (Fm9, Ebmaj9) through a tape-ish delay into a small room.
 *
 * Each part of the night is the same track heard from somewhere else:
 *   street   rain on the cab, its radio playing the tune through a small speaker
 *   door     the kick and bass through a wall, rain on the pavement
 *   open     the push bar, and the filter sweeping open as the door does
 *   inside   the full groove, a break at bar 6 with a riser and a clap roll
 *   title    the drop, then a four-bar loop under the title screen
 *
 * Every part renders offline (OfflineAudioContext) into a buffer, so the
 * music doesn't care how busy the main thread is while the game loads. The
 * drums are rendered once as one-shots and sequenced; bass and chords are
 * played note by note. Loops are rendered twice over and the second pass
 * kept, so the delay and reverb tails wrap round the loop point.
 */
import { BAR, BARS, BEAT, BREAK_BAR, type Part } from './plan';

type Ctx = BaseAudioContext;

const S16 = BEAT / 4;
/** the shuffle: every other 16th lands late (58 %) */
const SWING = 0.16 * S16;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** where a 16th step falls in a bar */
function step(bar0: number, s: number): number {
  return bar0 + s * S16 + (s % 2 ? SWING : 0);
}

/* ------------------------------------------------------------------ */
/* the drum kit, rendered once                                          */
/* ------------------------------------------------------------------ */

type Hit = 'kick' | 'hat' | 'ohat' | 'clap' | 'rim' | 'conga' | 'shaker' | 'crash' | 'boom' | 'clunk' | 'thunk' | 'step' | 'tickGlass' | 'tickWet';
const HITS: Hit[] = ['kick', 'hat', 'ohat', 'clap', 'rim', 'conga', 'shaker', 'crash', 'boom', 'clunk', 'thunk', 'step', 'tickGlass', 'tickWet'];

function noiseBuffer(ctx: Ctx, seconds: number, seed = 1): AudioBuffer {
  const b = ctx.createBuffer(2, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  let s = seed * 9301 + 49297;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      s = (s * 16807) % 2147483647;
      d[i] = (s / 2147483647) * 2 - 1;
    }
  }
  return b;
}

function noise(ctx: Ctx, buf: AudioBuffer, t: number, dur: number, out: AudioNode, offset = 0): AudioBufferSourceNode {
  const n = ctx.createBufferSource();
  n.buffer = buf;
  n.connect(out);
  n.start(t, offset % (buf.duration - dur - 0.01), dur);
  return n;
}

function env(ctx: Ctx, out: AudioNode, t: number, peak: number, attack: number, tau: number, end?: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(0, t + attack, tau);
  if (end !== undefined) g.gain.setValueAtTime(0, end);
  g.connect(out);
  return g;
}

function filter(ctx: Ctx, type: BiquadFilterType, f: number, q = 0.707, out?: AudioNode): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  if (out) b.connect(out);
  return b;
}

function osc(ctx: Ctx, type: OscillatorType, f: number, t: number, dur: number, out: AudioNode): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.connect(out);
  o.start(t);
  o.stop(t + dur);
  return o;
}

function drawHit(ctx: Ctx, hit: Hit, t: number, out: AudioNode, nb: AudioBuffer): void {
  switch (hit) {
    case 'kick': {
      // round and short: a sine dropping from 150 Hz into the 40s, a soft click on top, a little drive
      const drive = ctx.createWaveShaper();
      drive.curve = tanhCurve(1.6);
      drive.connect(out);
      const body = env(ctx, drive, t, 0.95, 0.002, 0.12);
      const o = osc(ctx, 'sine', 150, t, 0.7, body);
      o.frequency.exponentialRampToValueAtTime(54, t + 0.07);
      o.frequency.exponentialRampToValueAtTime(43, t + 0.4);
      const click = env(ctx, drive, t, 0.22, 0.0005, 0.004);
      noise(ctx, nb, t, 0.03, filter(ctx, 'bandpass', 3200, 0.9, click));
      break;
    }
    case 'hat':
    case 'ohat': {
      // six detuned squares (the 808's metal) and noise, very high up
      const open = hit === 'ohat';
      const hp = filter(ctx, 'highpass', 7400, 0.8);
      const bp = filter(ctx, 'bandpass', 10500, 0.6, hp);
      const g = env(ctx, out, t, open ? 0.5 : 0.62, 0.001, open ? 0.075 : 0.016);
      hp.connect(g);
      for (const f of [205.3, 284.6, 304.4, 369.6, 522.7, 800.1]) osc(ctx, 'square', f * 1.6, t, open ? 0.6 : 0.15, bp);
      const air = ctx.createGain();
      air.gain.value = 0.55;
      air.connect(hp);
      noise(ctx, nb, t, open ? 0.6 : 0.15, air, 0.3);
      break;
    }
    case 'clap': {
      // three quick slaps and a short room
      const bp = filter(ctx, 'bandpass', 1150, 1.1, out);
      for (const [dt, a] of [[0, 0.8], [0.011, 0.7], [0.023, 0.9]] as const) noise(ctx, nb, t + dt, 0.05, env(ctx, bp, t + dt, a, 0.0007, 0.0045), dt * 7);
      noise(ctx, nb, t + 0.033, 0.5, env(ctx, bp, t + 0.033, 0.55, 0.001, 0.07), 0.9);
      break;
    }
    case 'rim': {
      const hp = filter(ctx, 'highpass', 320, 0.7, out);
      osc(ctx, 'sine', 1720, t, 0.08, env(ctx, hp, t, 0.5, 0.0005, 0.012));
      osc(ctx, 'triangle', 465, t, 0.1, env(ctx, hp, t, 0.6, 0.0005, 0.02));
      noise(ctx, nb, t, 0.02, env(ctx, filter(ctx, 'bandpass', 4000, 1, hp), t, 0.25, 0.0003, 0.003), 1.3);
      break;
    }
    case 'conga': {
      const o = osc(ctx, 'sine', 300, t, 0.4, env(ctx, out, t, 0.8, 0.001, 0.07));
      o.frequency.exponentialRampToValueAtTime(228, t + 0.05);
      noise(ctx, nb, t, 0.02, env(ctx, filter(ctx, 'bandpass', 2200, 1, out), t, 0.12, 0.0005, 0.004), 1.7);
      break;
    }
    case 'shaker': {
      const hp = filter(ctx, 'highpass', 5200, 0.7, out);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.012);
      g.gain.setTargetAtTime(0, t + 0.014, 0.018);
      g.connect(hp);
      noise(ctx, nb, t, 0.12, g, 0.55);
      break;
    }
    case 'crash': {
      // a long, washy cymbal for the drop
      const hp = filter(ctx, 'highpass', 4200, 0.6, out);
      noise(ctx, nb, t, 2.4, env(ctx, hp, t, 0.6, 0.002, 0.55), 0.1);
      for (const f of [340, 476, 590, 711, 853]) osc(ctx, 'square', f * 2.3, t, 2.4, env(ctx, filter(ctx, 'bandpass', 8000, 0.5, hp), t, 0.08, 0.002, 0.45));
      break;
    }
    case 'boom': {
      // the sub drop under the impact
      const o = osc(ctx, 'sine', 62, t, 2.4, env(ctx, out, t, 0.9, 0.004, 0.55));
      o.frequency.exponentialRampToValueAtTime(31, t + 1.4);
      break;
    }
    case 'clunk': {
      // the door's push bar going down, a heavy door unlatching
      osc(ctx, 'sine', 120, t, 0.4, env(ctx, out, t, 0.7, 0.001, 0.06));
      noise(ctx, nb, t, 0.12, env(ctx, filter(ctx, 'bandpass', 2600, 2.5, out), t, 0.55, 0.0005, 0.02), 0.2);
      noise(ctx, nb, t + 0.07, 0.12, env(ctx, filter(ctx, 'bandpass', 1500, 3, out), t + 0.07, 0.35, 0.0005, 0.025), 0.4);
      break;
    }
    case 'thunk': {
      // a car door shutting
      osc(ctx, 'sine', 72, t, 0.5, env(ctx, out, t, 0.9, 0.002, 0.09));
      noise(ctx, nb, t, 0.3, env(ctx, filter(ctx, 'lowpass', 700, 0.8, out), t, 0.6, 0.001, 0.05), 0.6);
      noise(ctx, nb, t + 0.01, 0.1, env(ctx, filter(ctx, 'bandpass', 3000, 2, out), t + 0.01, 0.12, 0.0005, 0.01), 1.1);
      break;
    }
    case 'tickGlass':
    case 'tickWet':
      // one rain drop
      noise(ctx, nb, t, 0.02, env(ctx, filter(ctx, 'bandpass', hit === 'tickGlass' ? 2600 : 4200, 1.4, out), t, 0.5, 0.0004, 0.004), 0.5);
      break;
    case 'step': {
      // a footstep on a wet pavement
      noise(ctx, nb, t, 0.2, env(ctx, filter(ctx, 'lowpass', 900, 0.8, out), t, 0.5, 0.003, 0.03), 0.8);
      noise(ctx, nb, t + 0.02, 0.2, env(ctx, filter(ctx, 'bandpass', 3800, 1.5, out), t + 0.02, 0.18, 0.004, 0.04), 1.2);
      break;
    }
  }
}

function tanhCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / k;
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* the tune                                                             */
/* ------------------------------------------------------------------ */

/** F dorian: Fm9 then Ebmaj9, the bass holding F then Eb */
const CHORDS = [
  [56, 60, 63, 67, 72],
  [55, 58, 62, 65, 70],
];
/** the bassline, two bars: [16th, midi note, length in 16ths] */
const BASS: [number, number, number][][] = [
  [[2, 41, 1], [3, 29, 1], [6, 29, 1], [7, 32, 1], [10, 41, 1], [11, 29, 1], [14, 36, 2]],
  [[2, 39, 1], [3, 27, 1], [6, 27, 1], [7, 31, 1], [10, 39, 1], [11, 27, 1], [13, 29, 1], [14, 34, 2]],
];

function bassNote(ctx: Ctx, out: AudioNode, t: number, f: number, len: number): void {
  const vca = ctx.createGain();
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(0.5, t + 0.004);
  vca.gain.setTargetAtTime(0.32, t + 0.004, 0.08);
  vca.gain.setTargetAtTime(0, t + len * 0.8, 0.012);
  vca.connect(out);
  const lp = filter(ctx, 'lowpass', 1200, 5, vca);
  lp.frequency.setValueAtTime(1300, t);
  lp.frequency.setTargetAtTime(210, t, 0.05);
  osc(ctx, 'sawtooth', f, t, len + 0.1, lp);
  const sub = ctx.createGain();
  sub.gain.value = 0.75;
  sub.connect(vca);
  osc(ctx, 'sine', f, t, len + 0.1, sub);
}

/** an electric-piano-ish dub stab: two-operator FM, a bright attack that mellows fast */
function stabNote(ctx: Ctx, out: AudioNode, t: number, f: number): void {
  const amp = env(ctx, out, t, 0.075, 0.003, 0.22);
  const car = osc(ctx, 'sine', f, t, 1.6, amp);
  const mod = ctx.createOscillator();
  mod.frequency.value = f;
  const idx = ctx.createGain();
  idx.gain.setValueAtTime(f * 2.4, t);
  idx.gain.setTargetAtTime(f * 0.25, t, 0.08);
  mod.connect(idx);
  idx.connect(car.frequency);
  mod.start(t);
  mod.stop(t + 1.6);
  // a little body underneath
  const lp = filter(ctx, 'lowpass', 1800, 0.7, env(ctx, out, t, 0.02, 0.004, 0.18));
  osc(ctx, 'sawtooth', f * 1.003, t, 1.2, lp);
}

/** a warm pad (the cab radio's chords) */
function padChord(ctx: Ctx, out: AudioNode, t: number, len: number, notes: number[], gain: number): void {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.6);
  g.gain.setValueAtTime(gain, t + len - 0.4);
  g.gain.linearRampToValueAtTime(0, t + len + 0.2);
  const lp = filter(ctx, 'lowpass', 1100, 0.6, g);
  g.connect(out);
  for (const n of notes) for (const d of [-0.006, 0, 0.007]) osc(ctx, 'sawtooth', hz(n) * (1 + d), t, len + 0.3, lp);
}

/* ------------------------------------------------------------------ */
/* the kit: every sound rendered once, on its own                       */
/* ------------------------------------------------------------------ */

/** how long each one-shot rings */
const HIT_SECONDS: Record<Hit, number> = { kick: 0.8, hat: 0.25, ohat: 0.7, clap: 0.6, rim: 0.2, conga: 0.5, shaker: 0.2, crash: 2.6, boom: 2.4, clunk: 0.5, thunk: 0.6, step: 0.35, tickGlass: 0.03, tickWet: 0.03 };

export type Kit = Record<string, AudioBuffer>;

/** one sound in a little offline render of its own (an offline render costs every node for its whole length) */
async function oneShot(sampleRate: number, seconds: number, draw: (ctx: Ctx, out: AudioNode, nb: AudioBuffer) => void): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate);
  draw(ctx, ctx.destination, noiseBuffer(ctx, Math.max(0.2, Math.min(3, seconds + 0.2)), 7));
  return ctx.startRendering();
}

const bassKey = (n: number, len: number) => `bass${n}:${len}`;

/** the drums, every bass note the line uses, the two chord stabs and the pads, rendered at once */
export async function renderKit(sampleRate: number): Promise<Kit> {
  const jobs: [string, Promise<AudioBuffer>][] = [];
  for (const hit of HITS) jobs.push([hit, oneShot(sampleRate, HIT_SECONDS[hit], (c, out, nb) => drawHit(c, hit, 0.001, out, nb))]);
  const notes = new Set<string>();
  for (const bar of BASS)
    for (const [, n, len] of bar) {
      const k = bassKey(n, len);
      if (notes.has(k)) continue;
      notes.add(k);
      jobs.push([k, oneShot(sampleRate, len * S16 + 0.15, (c, out) => bassNote(c, out, 0.001, hz(n), len * S16))]);
    }
  CHORDS.forEach((ch, i) => {
    jobs.push([`stab${i}`, oneShot(sampleRate, 1.7, (c, out) => ch.forEach((n) => stabNote(c, out, 0.001, hz(n))))]);
    jobs.push([`pad${i}`, oneShot(sampleRate, BAR + 0.6, (c, out) => padChord(c, out, 0, BAR, ch, 1))]);
  });
  jobs.push(['padLong', oneShot(sampleRate, BAR * 2 + 0.6, (c, out) => padChord(c, out, 0, BAR * 2, CHORDS[0], 1))]);
  const kit: Kit = {};
  const done = await Promise.all(jobs.map(([, p]) => p));
  jobs.forEach(([k], i) => (kit[k] = done[i]));
  return kit;
}

/* ------------------------------------------------------------------ */
/* sequencing: one-shots mixed into a few stereo tracks, in JS          */
/* ------------------------------------------------------------------ */

class Track {
  readonly ch: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];
  constructor(
    readonly n: number,
    readonly sr: number,
  ) {
    this.ch = [new Float32Array(n), new Float32Array(n)];
  }

  /** add a one-shot at `t` seconds, with gain and pan (−1..1) */
  add(buf: AudioBuffer | undefined, t: number, gain: number, pan = 0): void {
    if (!buf) return;
    const at = Math.round(t * this.sr);
    const gl = gain * (pan > 0 ? 1 - pan : 1);
    const gr = gain * (pan < 0 ? 1 + pan : 1);
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const [oL, oR] = this.ch;
    const end = Math.min(buf.length, this.n - at);
    for (let i = Math.max(0, -at); i < end; i++) {
      oL[at + i] += L[i] * gl;
      oR[at + i] += R[i] * gr;
    }
  }

  buffer(): AudioBuffer {
    const b = new AudioBuffer({ length: this.n, sampleRate: this.sr, numberOfChannels: 2 });
    b.copyToChannel(this.ch[0], 0);
    b.copyToChannel(this.ch[1], 1);
    return b;
  }
}

interface Tracks {
  /** the drums and bass (through the wall) */
  club: Track;
  /** the chords (through the wall and the dub delay) */
  keys: Track;
  /** reverb send */
  room: Track;
  /** outside the club: straight to the master */
  street: Track;
}

interface BarPlan {
  kick?: boolean;
  bass?: boolean;
  clap?: boolean;
  hats?: number;
  perc?: boolean;
  stab?: boolean;
  /** the clap roll into the drop (last bar of the break) */
  roll?: boolean;
}

function playBar(kit: Kit, tr: Tracks, bar: number, t0: number, p: BarPlan): void {
  const two = bar % 2;
  const { club, room, keys } = tr;
  for (let s = 0; s < 16; s++) {
    const t = step(t0, s);
    if (p.kick && s % 4 === 0) club.add(kit.kick, t, 0.95);
    if (p.hats) {
      const h = p.hats;
      if (s % 4 === 2) club.add(kit.ohat, t, 0.55 * h, 0.12);
      else if (s % 4 !== 0) club.add(kit.hat, t, (s % 2 ? 0.3 : 0.45) * h * (0.85 + (0.3 * ((s * 7) % 5)) / 5), -0.1);
      club.add(kit.shaker, t, (s % 4 === 0 ? 0.12 : s % 2 ? 0.22 : 0.15) * h, 0.32);
    }
    if (p.clap && (s === 4 || s === 12)) {
      club.add(kit.clap, t, 0.42);
      room.add(kit.clap, t, 0.14);
    }
    if (p.perc) {
      if ((two === 0 && s === 9) || (two === 1 && (s === 13 || s === 15))) club.add(kit.conga, t, 0.26, -0.28);
      if ((two === 0 && s === 7) || (two === 1 && s === 11)) club.add(kit.rim, t, 0.2, 0.24);
    }
    if (p.roll && s >= 8) club.add(kit.clap, t, 0.12 + 0.3 * ((s - 8) / 7), s % 2 ? 0.15 : -0.15);
  }
  if (p.bass) for (const [s, n, len] of BASS[two]) club.add(kit[bassKey(n, len)], step(t0, s), 1);
  if (p.stab) keys.add(kit[`stab${two}`], two === 0 ? step(t0, 3) : step(t0, 10), 1);
}

/** rain drops ticking on the glass or the pavement */
function ticks(kit: Kit, tr: Track, t0: number, t1: number, gain: number, glass: boolean): void {
  let s = glass ? 77 : 78;
  const rnd = () => ((s = (s * 16807) % 2147483647), s / 2147483647);
  for (let t = t0; t < t1; t += 0.02 + rnd() * 0.09) {
    const fade = Math.min(1, (t - t0) / 1.2, (t1 - t) / 1);
    tr.add(glass ? kit.tickGlass : kit.tickWet, t, gain * fade * rnd(), rnd() * 1.6 - 0.8);
  }
}

/* ------------------------------------------------------------------ */
/* the mix: one small offline pass per part (filters, delay, room)     */
/* ------------------------------------------------------------------ */

function reverbIR(ctx: Ctx, seconds: number, decay: number): AudioBuffer {
  const b = ctx.createBuffer(2, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  let s = 12345;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      s = (s * 16807) % 2147483647;
      const x = (s / 2147483647) * 2 - 1;
      // darker as it dies away
      const k = 0.25 + 0.7 * Math.exp(-i / (ctx.sampleRate * 0.25));
      lp += (x - lp) * k;
      d[i] = lp * Math.exp(-i / (ctx.sampleRate * decay));
    }
  }
  return b;
}

interface Mix {
  ctx: OfflineAudioContext;
  master: GainNode;
  /** the club, after the wall (its filter is the door) */
  wall: BiquadFilterNode;
  /** and how loud it is through it */
  wallGain: GainNode;
  room: GainNode;
  nb: AudioBuffer;
}

function play(ctx: Ctx, buf: AudioBuffer, out: AudioNode): void {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.connect(out);
  s.start(0);
}

function mix(tr: Tracks, sampleRate: number): Mix {
  const ctx = new OfflineAudioContext(2, tr.club.n, sampleRate);
  const nb = noiseBuffer(ctx, 4, 3);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3;
  comp.attack.value = 0.006;
  comp.release.value = 0.18;
  comp.knee.value = 8;
  const clip = ctx.createWaveShaper();
  clip.curve = tanhCurve(1.1);
  comp.connect(clip);
  clip.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(comp);
  // the club goes through the wall filter (wide open inside), its room with it
  const wallGain = ctx.createGain();
  wallGain.connect(master);
  const wall = filter(ctx, 'lowpass', 20000, 0.9, wallGain);
  const verb = ctx.createConvolver();
  verb.buffer = reverbIR(ctx, 1.8, 0.45);
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.32;
  verb.connect(verbOut);
  verbOut.connect(wall);
  const room = ctx.createGain();
  room.connect(verb);
  // dub delay on the chords: a dotted eighth, darker on every repeat
  const keys = ctx.createGain();
  keys.connect(wall);
  const delay = ctx.createDelay(2);
  delay.delayTime.value = BEAT * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.46;
  const dLp = filter(ctx, 'lowpass', 2300, 0.6);
  const dHp = filter(ctx, 'highpass', 320, 0.6);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  const pan = ctx.createStereoPanner();
  pan.pan.value = -0.35;
  keys.connect(delay);
  delay.connect(dLp);
  dLp.connect(dHp);
  dHp.connect(fb);
  fb.connect(delay);
  dHp.connect(wet);
  wet.connect(pan);
  pan.connect(wall);
  const keySend = ctx.createGain();
  keySend.gain.value = 0.4;
  keys.connect(keySend);
  keySend.connect(room);
  play(ctx, tr.club.buffer(), wall);
  play(ctx, tr.keys.buffer(), keys);
  play(ctx, tr.room.buffer(), room);
  play(ctx, tr.street.buffer(), master);
  return { ctx, master, wall, wallGain, nb, room };
}

/** a bed of rain: on the cab's glass, or on the pavement */
function rainBed(m: Mix, t0: number, t1: number, gain: number, glass: boolean): void {
  const { ctx, nb } = m;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 1.2);
  g.gain.setValueAtTime(gain, Math.max(t0 + 1.2, t1 - 1));
  g.gain.linearRampToValueAtTime(0, t1);
  g.connect(m.master);
  const hp = filter(ctx, 'highpass', glass ? 700 : 1300, 0.5, g);
  const lp = filter(ctx, 'lowpass', glass ? 5200 : 9000, 0.5, hp);
  const src = ctx.createBufferSource();
  src.buffer = nb;
  src.loop = true;
  src.connect(lp);
  src.start(t0);
  src.stop(t1);
}

/** the cab: engine and tyre rumble */
function cab(m: Mix, t0: number, t1: number): void {
  const { ctx, nb } = m;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.5, t0 + 1.5);
  g.gain.setValueAtTime(0.5, t1 - 1.6);
  g.gain.linearRampToValueAtTime(0, t1);
  g.connect(m.master);
  const lp = filter(ctx, 'lowpass', 110, 0.8, g);
  const src = ctx.createBufferSource();
  src.buffer = nb;
  src.loop = true;
  src.playbackRate.value = 0.5;
  src.connect(lp);
  src.start(t0);
  src.stop(t1);
  const hiss = filter(ctx, 'bandpass', 900, 0.5);
  const hg = ctx.createGain();
  hg.gain.value = 0.045;
  hiss.connect(hg);
  hg.connect(g);
  const src2 = ctx.createBufferSource();
  src2.buffer = nb;
  src2.loop = true;
  src2.connect(hiss);
  src2.start(t0, 2);
  src2.stop(t1);
}

/** a long noise riser into the drop */
function riser(m: Mix, t0: number, t1: number, gain: number): void {
  const { ctx, nb } = m;
  const bp = filter(ctx, 'bandpass', 400, 1.6);
  bp.frequency.setValueAtTime(400, t0);
  bp.frequency.exponentialRampToValueAtTime(7000, t1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t1 - 0.02);
  g.gain.linearRampToValueAtTime(0, t1);
  bp.connect(g);
  g.connect(m.master);
  const r = ctx.createGain();
  r.gain.value = 0.3;
  g.connect(r);
  r.connect(m.room);
  const src = ctx.createBufferSource();
  src.buffer = nb;
  src.loop = true;
  src.connect(bp);
  src.start(t0);
  src.stop(t1);
}

function slice(buf: AudioBuffer, from: number, seconds: number): AudioBuffer {
  const a = Math.round(from * buf.sampleRate);
  const n = Math.min(buf.length - a, Math.round(seconds * buf.sampleRate));
  const out = new AudioBuffer({ length: n, sampleRate: buf.sampleRate, numberOfChannels: buf.numberOfChannels });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, a + n), c);
  return out;
}

/** the club through a wall: the kick and bass, quieter */
const THROUGH_WALL = 0.38;

/** loops render twice over; the second pass (tails wrapped round) is the loop */
const LOOPS: Partial<Record<Part, boolean>> = { door: true, title: true };

/** seconds a part's buffer runs (one-shots ring on a bar past their end) */
export function partLength(part: Part): number {
  return LOOPS[part] ? BARS[part] * BAR : (BARS[part] + 1) * BAR;
}

/** Render one part of the score. */
export async function renderPart(part: Part, kit: Kit, sampleRate: number): Promise<AudioBuffer> {
  const bars = BARS[part];
  const pre = LOOPS[part] ? bars : 0;
  const total = pre + bars + 1;
  const n = Math.ceil(total * BAR * sampleRate);
  const tr: Tracks = { club: new Track(n, sampleRate), keys: new Track(n, sampleRate), room: new Track(n, sampleRate), street: new Track(n, sampleRate) };
  const groove = (from: number, to: number, plan: (bar: number) => BarPlan) => {
    for (let b = from; b < to; b++) playBar(kit, tr, b, b * BAR, plan(b));
  };
  let after: (m: Mix) => void = () => {};
  if (part === 'street') {
    // the cab's radio playing the tune, its chords held long; it cuts off when the cab door shuts
    groove(0, 8, (b) => ({ kick: b >= 2, bass: b >= 2, clap: b >= 4, hats: b >= 1 ? 0.8 : 0, perc: b >= 4, stab: true }));
    for (let b = 0; b < 8; b++) tr.keys.add(kit[`pad${b % 2}`], b * BAR, 0.035);
    ticks(kit, tr.street, 0, 8.6 * BAR, 0.22, true);
    // the cab pulls up, the door, two steps to the club
    tr.street.add(kit.thunk, BAR * 7 + BEAT, 0.6);
    tr.street.add(kit.step, BAR * 7 + BEAT * 2.5, 0.55);
    tr.street.add(kit.step, BAR * 7 + BEAT * 3.2, 0.5);
    ticks(kit, tr.street, BAR * 7 + BEAT, 9 * BAR, 0.25, false);
    after = (m) => {
      const { ctx } = m;
      m.wall.disconnect();
      const radio = ctx.createGain();
      radio.gain.setValueAtTime(0, 0);
      radio.gain.linearRampToValueAtTime(1, BAR * 1.5);
      radio.gain.setValueAtTime(1, BAR * 7 + BEAT);
      radio.gain.linearRampToValueAtTime(0, BAR * 7 + BEAT + 0.05);
      const hp = filter(ctx, 'highpass', 380, 0.9);
      const lp = filter(ctx, 'lowpass', 2800, 1.2, hp);
      const drive = ctx.createWaveShaper();
      drive.curve = tanhCurve(2.2);
      m.wall.connect(hp);
      lp.connect(drive);
      drive.connect(radio);
      radio.connect(m.master);
      rainBed(m, 0, 8.6 * BAR, 0.06, true);
      cab(m, 0, BAR * 6.4);
      rainBed(m, BAR * 7 + BEAT, 9 * BAR, 0.07, false);
    };
  } else if (part === 'door') {
    // outside: the club through a wall, rain on the pavement
    groove(0, total, () => ({ kick: true, bass: true, clap: true, hats: 0.6, perc: true, stab: true }));
    ticks(kit, tr.street, 0, total * BAR, 0.25, false);
    after = (m) => {
      m.wall.frequency.value = 240;
      m.wall.Q.value = 1.1;
      m.wallGain.gain.value = THROUGH_WALL;
      rainBed(m, 0, total * BAR, 0.08, false);
    };
  } else if (part === 'open') {
    // the push bar, then the door and the filter open together
    tr.street.add(kit.clunk, 0.005, 0.7);
    groove(0, 1, () => ({ kick: true, bass: true, clap: true, hats: 1, perc: true, stab: true }));
    after = (m) => {
      m.wallGain.gain.setValueAtTime(THROUGH_WALL, 0);
      m.wallGain.gain.exponentialRampToValueAtTime(1, BAR);
      m.wall.frequency.setValueAtTime(240, 0);
      m.wall.frequency.exponentialRampToValueAtTime(19000, BAR * 0.98);
      m.wall.Q.setValueAtTime(1.1, 0);
      m.wall.Q.linearRampToValueAtTime(3.5, BAR * 0.8);
      m.wall.Q.linearRampToValueAtTime(0.9, BAR);
      riser(m, BEAT, BAR, 0.16);
      rainBed(m, 0, BAR * 0.9, 0.07, false);
    };
  } else if (part === 'inside') {
    groove(0, bars, (b) =>
      b < BREAK_BAR
        ? { kick: true, bass: true, clap: true, hats: 1, perc: true, stab: true }
        : // the break: the kick and bass drop out, a chord echoes away, a riser and a clap roll
          { hats: b === BREAK_BAR ? 0.7 : 0.45, perc: b === BREAK_BAR, stab: b === BREAK_BAR, roll: b === BREAK_BAR + 1 },
    );
    tr.club.add(kit.crash, 0, 0.35);
    // a long chord over the break
    tr.keys.add(kit.padLong, BREAK_BAR * BAR, 0.03);
    after = (m) => riser(m, BREAK_BAR * BAR, bars * BAR, 0.22);
  } else {
    // the groove under the title (the drop's hit is its own buffer, played once)
    groove(0, total, () => ({ kick: true, bass: true, clap: true, hats: 1, perc: true, stab: true }));
  }
  const m = mix(tr, sampleRate);
  after(m);
  const out = await m.ctx.startRendering();
  return LOOPS[part] ? slice(out, pre * BAR, bars * BAR) : slice(out, 0, partLength(part));
}

/** the drop's hit (a crash and a sub boom), played once over the title loop's first downbeat */
export async function renderDrop(kit: Kit, sampleRate: number): Promise<AudioBuffer> {
  const n = Math.ceil(BAR * 1.5 * sampleRate);
  const tr: Tracks = { club: new Track(n, sampleRate), keys: new Track(n, sampleRate), room: new Track(n, sampleRate), street: new Track(n, sampleRate) };
  tr.club.add(kit.crash, 0, 0.45);
  tr.street.add(kit.boom, 0, 0.45);
  tr.room.add(kit.crash, 0, 0.2);
  return mix(tr, sampleRate).ctx.startRendering();
}

/**
 * The music bus's limiter: the drop lands on the title loop's first downbeat with the room's last
 * bar still ringing, and the sum would clip. (A DynamicsCompressor adds its own make-up gain, about
 * +2.3 dB at these settings, so the bus feeding it runs a little lower.)
 */
export function limiter(ctx: BaseAudioContext): DynamicsCompressorNode {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -4;
  c.knee.value = 2;
  c.ratio.value = 20;
  c.attack.value = 0.001;
  c.release.value = 0.15;
  return c;
}
