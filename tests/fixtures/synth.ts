/*
 * Test fixture: full-length synthetic dance tracks with a known arrangement
 * (intro, groove, breakdown, build, drop, outro), tempo and key. The tests
 * render them to check the analysis, the section finder and the set builder
 * against ground truth. The game itself ships no tracks.
 */
import type { DemoSpec } from '../../src/core/types';
import { rng } from '../../src/core/util';
import { Biquad, clap, crash, kick, Mix, mtof, riser, TAU, type Rendered } from '../../src/audio/synth';

function hat(m: Mix, t: number, gain: number, open: boolean, rnd: () => number, pan = 0): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const dec = open ? 0.22 : 0.035;
  const n = Math.floor(dec * 5 * sr);
  const hp = new Biquad(sr).set('hp', 7500, 0.8);
  const bp = new Biquad(sr).set('bp', 10500, 1.2);
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    const env = Math.exp(-s / dec);
    const x = rnd() * 2 - 1;
    const v = (hp.run(x) * 0.6 + bp.run(x) * 0.8) * env * gain;
    m.add(start + i, v * (1 - pan), v * (1 + pan));
  }
}

function snare(m: Mix, t: number, gain: number, rnd: () => number): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor(0.25 * sr);
  const hp = new Biquad(sr).set('hp', 1800, 0.7);
  const body = new Biquad(sr).set('bp', 900, 0.9);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    ph += (TAU * (200 - 40 * Math.min(1, s * 20))) / sr;
    const tone = Math.sin(ph) * Math.exp(-s / 0.06) * 0.7;
    const x = rnd() * 2 - 1;
    const noise = (hp.run(x) * 0.8 + body.run(x) * 1.2) * Math.exp(-s / 0.08);
    const v = (tone + noise) * gain;
    m.add(start + i, v, v);
  }
}

function bassNote(m: Mix, t: number, dur: number, midi: number, gain: number, style: DemoSpec['style'], duck: Float32Array): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor((dur + 0.05) * sr);
  const f = mtof(midi);
  const lp = new Biquad(sr);
  let ph = 0;
  let sub = 0;
  // filter character per style: [base, sweep, decay, Q, saw mix, sine mix]
  const ch: Record<string, [number, number, number, number, number, number]> = {
    techno: [300, 2200, 14, 6, 0.55, 0.55],
    minimal: [140, 520, 26, 1, 0.42, 0.62],
    rolling: [200, 900, 20, 1.6, 0.5, 0.55],
    techhouse: [240, 1700, 17, 2.6, 0.6, 0.5],
    rave: [170, 600, 20, 0.8, 0.35, 0.72],
  };
  const [cb, cs, cd, cq, sawMix, sineMix] = ch[style] ?? [180, 900, 22, 1.2, 0.5, 0.55];
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    ph += f / sr;
    if (ph >= 1) ph -= 1;
    sub += (TAU * f) / sr;
    const saw = 2 * ph - 1;
    const env = s < dur ? 1 - Math.exp(-s * 400) : Math.exp(-(s - dur) * 60);
    const cut = cb + cs * Math.exp(-s * cd);
    if (i % 32 === 0) lp.set('lp', cut, cq);
    let v = lp.run(saw) * sawMix + Math.sin(sub) * sineMix;
    v = Math.tanh(v * 1.4) * env * gain;
    const d = duck[start + i] ?? 1;
    m.add(start + i, v * d, v * d);
  }
}

function stab(m: Mix, t: number, dur: number, notes: number[], gain: number, bright: number, duck: Float32Array): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor((dur + 0.3) * sr);
  const lpL = new Biquad(sr);
  const lpR = new Biquad(sr);
  const k = notes.length;
  const incL = new Float64Array(k);
  const incR = new Float64Array(k);
  const phL = new Float64Array(k);
  const phR = new Float64Array(k).fill(0.33);
  for (let j = 0; j < k; j++) {
    const f = mtof(notes[j]);
    incL[j] = (f * 0.994) / sr;
    incR[j] = (f * 1.006) / sr;
  }
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    let l = 0;
    let r = 0;
    for (let j = 0; j < k; j++) {
      phL[j] += incL[j];
      if (phL[j] >= 1) phL[j] -= 1;
      phR[j] += incR[j];
      if (phR[j] >= 1) phR[j] -= 1;
      l += 2 * phL[j] - 1;
      r += 2 * phR[j] - 1;
    }
    const env = (s < dur ? 1 : Math.exp(-(s - dur) * 14)) * Math.exp(-s * 2.2) * (1 - Math.exp(-s * 300));
    if (i % 32 === 0) {
      const c = 500 + bright * 3500 * Math.exp(-s * 8);
      lpL.set('lp', c, 1.4);
      lpR.set('lp', c, 1.4);
    }
    const g = (gain / k) * env * (duck[start + i] ?? 1);
    m.add(start + i, lpL.run(l) * g, lpR.run(r) * g);
  }
}

function pad(m: Mix, t: number, dur: number, notes: number[], gain: number, duck: Float32Array): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor((dur + 1.2) * sr);
  const lpL = new Biquad(sr).set('lp', 1800, 0.7);
  const lpR = new Biquad(sr).set('lp', 1800, 0.7);
  const k = notes.length * 3;
  const inc = new Float64Array(k);
  const ph = new Float64Array(k);
  for (let j = 0; j < notes.length; j++) {
    const f = mtof(notes[j]);
    for (let d = 0; d < 3; d++) inc[j * 3 + d] = (f * (1 + (d - 1) * 0.008)) / sr;
  }
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    let l = 0;
    let r = 0;
    for (let j = 0; j < k; j += 3) {
      let a = ph[j] + inc[j];
      if (a >= 1) a -= 1;
      ph[j] = a;
      let b = ph[j + 1] + inc[j + 1];
      if (b >= 1) b -= 1;
      ph[j + 1] = b;
      let c = ph[j + 2] + inc[j + 2];
      if (c >= 1) c -= 1;
      ph[j + 2] = c;
      const vb = (2 * b - 1) * 0.5;
      l += 2 * a - 1 + vb;
      r += 2 * c - 1 + vb;
    }
    const env = Math.min(1, s / 0.8) * (s < dur ? 1 : Math.exp(-(s - dur) * 3));
    const g = (gain / notes.length) * env * (0.55 + 0.45 * (duck[start + i] ?? 1));
    m.add(start + i, lpL.run(l) * g, lpR.run(r) * g);
  }
}

function pluck(m: Mix, t: number, midi: number, gain: number, pan: number): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor(0.45 * sr);
  const f = mtof(midi);
  const lp = new Biquad(sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    ph += f / sr;
    if (ph >= 1) ph -= 1;
    const sq = ph < 0.5 ? 1 : -1;
    if (i % 32 === 0) lp.set('lp', 400 + 5000 * Math.exp(-s * 18), 2);
    const v = lp.run(sq) * Math.exp(-s * 7) * gain;
    m.add(start + i, v * (1 - pan), v * (1 + pan));
  }
}

function rim(m: Mix, t: number, gain: number, pan = 0.25, f = 520): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor(0.07 * sr);
  const bp = new Biquad(sr).set('bp', f * 4, 4);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    ph += (TAU * f) / sr;
    const v = (Math.sin(ph) * Math.exp(-s / 0.01) * 0.5 + bp.run(i < 12 ? 1 : 0) * 1.6) * gain;
    m.add(start + i, v * (1 - pan), v * (1 + pan));
  }
}

function shaker(m: Mix, t: number, gain: number, rnd: () => number, pan = 0): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor(0.09 * sr);
  const hp = new Biquad(sr).set('hp', 5200, 0.9);
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    const env = Math.min(1, s / 0.008) * Math.exp(-s / 0.035);
    const v = hp.run(rnd() * 2 - 1) * env * gain;
    m.add(start + i, v * (1 - pan), v * (1 + pan));
  }
}

function conga(m: Mix, t: number, gain: number, f: number, pan: number, rnd: () => number): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor(0.3 * sr);
  const bp = new Biquad(sr).set('bp', 2200, 1.5);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    ph += (TAU * f * (1 + 0.35 * Math.exp(-s * 70))) / sr;
    const v = (Math.sin(ph) * Math.exp(-s / 0.12) + bp.run(rnd() * 2 - 1) * Math.exp(-s / 0.008) * 0.5) * gain;
    m.add(start + i, v * (1 - pan), v * (1 + pan));
  }
}

/** Rendered once per chord and stamped: bright, fast-decaying rave piano. */
function pianoChord(sr: number, notes: number[], len: number): Float32Array {
  const n = Math.floor(len * sr);
  const out = new Float32Array(n);
  const hammer = rng(notes.reduce((a, b) => a * 31 + b, 7));
  for (const midi of notes) {
    const f = mtof(midi);
    const amps = [0.5, 0.3, 0.1, 0.12, 0.04];
    for (let h = 1; h <= 5; h++) {
      const inc = (TAU * f * h * (1 + 0.0004 * h * h)) / sr;
      const amp = amps[h - 1];
      const tau = 0.9 / h + 0.08;
      let ph = hammer() * TAU;
      for (let i = 0; i < n; i++) {
        ph += inc;
        out[i] += Math.sin(ph) * amp * Math.exp(-i / sr / tau);
      }
    }
  }
  for (let i = 0; i < Math.min(n, sr * 0.004); i++) out[i] += (hammer() * 2 - 1) * 0.25 * (1 - i / (sr * 0.004));
  for (let i = 0; i < n; i++) out[i] *= Math.min(1, i / (sr * 0.0015)) / notes.length;
  return out;
}

function stamp(m: Mix, buf: Float32Array, t: number, gain: number, pan = 0, duck?: Float32Array): void {
  const start = Math.floor(t * m.sr);
  for (let i = 0; i < buf.length; i++) {
    const d = duck ? (0.6 + 0.4 * (duck[start + i] ?? 1)) : 1;
    const v = buf[i] * gain * d;
    m.add(start + i, v * (1 - pan), v * (1 + pan));
  }
}

const VOWELS: Record<string, [number, number, number]> = {
  a: [800, 1150, 2900],
  e: [480, 1900, 2600],
  i: [300, 2250, 3000],
  o: [450, 800, 2830],
  u: [330, 700, 2500],
};

/** Formant-synthesised vocal chop gliding between vowels, e.g. "hey" = ['e', 'i']. */
function voxChop(sr: number, midi: number, vowels: string[], len: number, breathy = 0.1, seed = 1): Float32Array {
  const n = Math.floor(len * sr);
  const out = new Float32Array(n);
  const r = rng(seed);
  const f0 = mtof(midi);
  const bands = [new Biquad(sr), new Biquad(sr), new Biquad(sr)];
  const gains = [1, 0.55, 0.28];
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    const p = Math.min(1, s / Math.max(0.01, len * 0.7));
    const k = Math.min(vowels.length - 1.001, p * (vowels.length - 1));
    const a = VOWELS[vowels[Math.floor(k)]] ?? VOWELS.a;
    const b = VOWELS[vowels[Math.ceil(k)]] ?? a;
    const fr = k - Math.floor(k);
    if (i % 64 === 0) bands.forEach((bq, j) => bq.set('bp', a[j] + (b[j] - a[j]) * fr, 9 - j * 2));
    ph += (f0 * (1 + 0.012 * Math.sin(s * 34))) / sr;
    if (ph >= 1) ph -= 1;
    const src = (2 * ph - 1) * 0.8 + (r() * 2 - 1) * breathy;
    let v = 0;
    for (let j = 0; j < 3; j++) v += bands[j].run(src) * gains[j];
    const env = Math.min(1, s / 0.015) * Math.min(1, (len - s) / 0.06);
    out[i] = v * env * 2.2;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* demo track                                                           */
/* ------------------------------------------------------------------ */

const PROGRESSIONS = {
  minor: [
    [0, 3, 7],
    [8, 12, 15],
    [3, 7, 10],
    [10, 14, 17],
  ],
  major: [
    [0, 4, 7],
    [7, 11, 14],
    [9, 12, 16],
    [5, 9, 12],
  ],
};

export function renderDemoTrack(spec: DemoSpec, sampleRate = 44100): Rendered {
  const rnd = rng(spec.seed);
  const beat = 60 / spec.bpm;
  const bar = beat * 4;
  const offset = 0.05; // first downbeat
  const total = spec.bars * bar + offset + 2.5;
  const m = new Mix(sampleRate, total);
  const prog = spec.minor ? PROGRESSIONS.minor : PROGRESSIONS.major;
  const root = spec.root;
  const style = spec.style;

  // section plan (bars)
  const B = spec.bars;
  const sec = (from: number, to: number) => (b: number) => b >= Math.round(B * from) && b < Math.round(B * to);
  const intro = sec(0, 0.125);
  const groove = sec(0.125, 0.5);
  const breakdown = sec(0.5, 0.625);
  const drop = sec(0.625, 0.875);
  const outro = sec(0.875, 1);
  const hasKick = (b: number) => !breakdown(b);
  const hasBass = (b: number) => (groove(b) && b >= Math.round(B * 0.1875)) || drop(b) || (outro(b) && b < B - 4);
  const hasChords = (b: number) => (groove(b) && b >= Math.round(B * 0.25)) || drop(b) || breakdown(b);
  const hasLead = (b: number) => drop(b) || (breakdown(b) && b >= Math.round(B * 0.5625));

  // sidechain envelope from kick positions
  const duck = new Float32Array(m.length).fill(1);
  const kickTimes: number[] = [];
  for (let b = 0; b < B; b++) {
    if (!hasKick(b)) continue;
    for (let q = 0; q < 4; q++) {
      if (style === 'breaks') {
        const pat = [0, 2.5];
        if (q === 0) pat.forEach((p) => kickTimes.push(offset + b * bar + p * beat));
        continue;
      }
      if (style === 'garage') {
        if (q === 0 || q === 2) kickTimes.push(offset + b * bar + q * beat + (q === 2 ? beat * 0.5 : 0));
        continue;
      }
      kickTimes.push(offset + b * bar + q * beat);
    }
  }
  for (const kt of kickTimes) {
    const s = Math.floor(kt * sampleRate);
    const n = Math.floor(beat * 0.9 * sampleRate);
    for (let i = 0; i < n && s + i < duck.length; i++) {
      const t = i / sampleRate;
      duck[s + i] = Math.min(duck[s + i], 1 - 0.75 * Math.exp(-t / (beat * 0.22)));
    }
  }

  const KICK: Partial<Record<DemoSpec['style'], [number, number, number]>> = {
    techno: [0.95, 1.2, 0.45],
    minimal: [0.84, 0.9, 0.3],
    rolling: [0.9, 1, 0.34],
    techhouse: [0.96, 1.25, 0.42],
    rave: [0.95, 1.1, 0.4],
  };
  const [kickGain, kickPunch, kickTail] = KICK[style] ?? [0.9, 1, 0.36];
  for (const kt of kickTimes) kick(m, kt, kickGain, kickPunch, kickTail);

  // one-shot buffers stamped many times
  // chops sit on the tonic and fifth so they reinforce the key
  const chopHey = voxChop(sampleRate, 60 + (root % 12), ['e', 'i'], beat * 0.45, 0.12, spec.seed);
  const chopYeah = voxChop(sampleRate, 60 + ((root + 7) % 12), ['i', 'a'], beat * 0.7, 0.1, spec.seed + 1);
  const chopOh = voxChop(sampleRate, 55 + ((root + 5) % 12), ['o', 'u'], beat * 1.8, 0.08, spec.seed + 2);
  const pianoCache = new Map<number, Float32Array>();
  const piano = (ci: number, notes: number[]) => {
    let b = pianoCache.get(ci);
    if (!b) pianoCache.set(ci, (b = pianoChord(sampleRate, notes, beat * 1.6)));
    return b;
  };
  // congas tuned to the key: tonic low, fifth high, tonic an octave up for the flam
  const cLo = mtof(48 + (root % 12));
  const cHi = mtof(48 + ((root + 7) % 12) + ((root + 7) % 12 < root % 12 ? 12 : 0));
  const CONGAS: [number, number][] = [
    [2, cLo],
    [3, cHi],
    [6, cLo],
    [8, cHi],
    [11, cLo],
    [14, cHi],
    [15, cLo * 2],
  ];
  const deepStyle = style === 'minimal' || style === 'rolling';

  for (let b = 0; b < B; b++) {
    const t0 = offset + b * bar;
    // deep minimal vamps on the tonic and the sixth; the others walk the four-chord loop
    const chord = style === 'minimal' ? prog[Math.floor(b / 4) % 2 ? 1 : 0] : prog[Math.floor(b / 2) % 4];
    const chordRoot = root + chord[0];

    // hats
    if (!breakdown(b) || b >= Math.round(B * 0.59)) {
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * (beat / 4) + (style === 'garage' && s % 2 === 1 ? beat * 0.07 : 0);
        const pos = s % 4;
        if (style === 'minimal') {
          const sw = s % 2 === 1 ? beat * 0.09 : 0;
          hat(m, t + sw, pos === 2 ? 0.16 : s % 2 ? 0.07 : 0.045, false, rnd, (s % 4) * 0.08 - 0.12);
          if (!intro(b)) shaker(m, t + sw, 0.035 + (s % 4 === 2 ? 0.02 : 0), rnd, 0.3);
        } else if (style === 'rolling') {
          shaker(m, t, s % 4 === 2 ? 0.08 : 0.045, rnd, -0.25);
          if (pos === 2 && !intro(b)) hat(m, t, 0.14, true, rnd, 0.2);
        } else if (style === 'techhouse') {
          if (pos === 2) hat(m, t, intro(b) ? 0.14 : 0.26, !intro(b), rnd, 0.15);
          else hat(m, t, 0.07, false, rnd, -0.2);
        } else if (style === 'rave') {
          if (s % 2 === 0) hat(m, t, s % 4 === 2 ? 0.2 : 0.1, s % 4 === 2 && drop(b), rnd, 0.1);
        } else if (style === 'house' || style === 'garage') {
          if (pos === 2) hat(m, t, 0.22, !intro(b), rnd, 0.2);
          else if (s % 2 === 1 && !intro(b)) hat(m, t, 0.07, false, rnd, -0.3);
        } else if (style === 'techno') {
          hat(m, t, pos === 2 ? 0.2 : 0.09, pos === 2 && drop(b), rnd, (s % 3) * 0.1 - 0.1);
        } else {
          if (s % 2 === 0) hat(m, t, s % 4 === 2 ? 0.18 : 0.09, false, rnd, 0.15);
        }
      }
    }

    // claps / snares
    if (deepStyle && !breakdown(b)) {
      // rims and congas carry the groove, even in the intro
      if (style === 'minimal') for (const q of [3, 7, 10, 14]) rim(m, t0 + q * (beat / 4) + (q % 2 ? beat * 0.09 : 0), 0.16, q % 2 ? 0.3 : -0.3, mtof(60 + (root % 12)));
      else for (const [q, f] of CONGAS) conga(m, t0 + q * (beat / 4), 0.24, f, f > cLo * 1.2 ? 0.35 : -0.35, rnd);
    }
    if (!intro(b) && !breakdown(b)) {
      if (style === 'breaks') {
        snare(m, t0 + beat, 0.5, rnd);
        snare(m, t0 + beat * 3, 0.5, rnd);
        if (b % 2 === 1) snare(m, t0 + beat * 3.75, 0.25, rnd);
      } else if (style === 'rave') {
        snare(m, t0 + beat, 0.46, rnd);
        snare(m, t0 + beat * 3, 0.46, rnd);
        clap(m, t0 + beat, 0.2, rnd);
        clap(m, t0 + beat * 3, 0.2, rnd);
        for (const q of [7, 9, 15]) snare(m, t0 + q * (beat / 4), 0.16, rnd);
      } else if (style === 'techhouse') {
        clap(m, t0 + beat, 0.42, rnd);
        clap(m, t0 + beat * 3, 0.42, rnd);
        snare(m, t0 + beat, 0.18, rnd);
        snare(m, t0 + beat * 3, 0.18, rnd);
        if (b % 8 === 7) for (let q = 12; q < 16; q++) snare(m, t0 + q * (beat / 4), 0.12 + (q - 12) * 0.05, rnd);
      } else if (style === 'minimal') {
        clap(m, t0 + beat, 0.26, rnd);
        clap(m, t0 + beat * 3, 0.26, rnd);
      } else {
        clap(m, t0 + beat, 0.42, rnd);
        clap(m, t0 + beat * 3, 0.42, rnd);
      }
    }
    // snare build at the end of the breakdown
    if (breakdown(b) && b >= Math.round(B * 0.625) - 2) {
      const steps = b === Math.round(B * 0.625) - 1 ? 16 : 8;
      for (let s = 0; s < steps; s++) snare(m, t0 + (s * bar) / steps, 0.12 + 0.3 * (s / steps), rnd);
    }

    // bass
    if (hasBass(b)) {
      const bassMidi = 36 + (chordRoot % 12);
      if (style === 'minimal') {
        const pat: [number, number][] = [
          [2, 0],
          [3, 0],
          [6, 12],
          [9, 0],
          [10, 7],
          [13, 0],
          [14, b % 2 ? 12 : 7],
        ];
        for (const [q, o] of pat) bassNote(m, t0 + q * (beat / 4), beat * 0.2, bassMidi + o, 0.42, style, duck);
      } else if (style === 'rolling') {
        for (const q of [2, 6, 10, 14]) bassNote(m, t0 + q * (beat / 4), beat * 0.34, bassMidi + (q === 14 && b % 4 === 3 ? 12 : 0), 0.48, style, duck);
        for (const q of [3, 11]) bassNote(m, t0 + q * (beat / 4), beat * 0.12, bassMidi + 12, 0.24, style, duck);
      } else if (style === 'techhouse') {
        const pat = [null, null, 0, 12, null, 0, null, 12, null, null, 0, 12, null, 7, 12, null];
        pat.forEach((o, q) => o !== null && bassNote(m, t0 + q * (beat / 4), beat * 0.17, bassMidi + o, 0.5, style, duck));
      } else if (style === 'rave') {
        for (let q = 0; q < 4; q++) bassNote(m, t0 + q * beat + beat / 2, beat * 0.4, bassMidi + (q === 3 ? 12 : 0), 0.5, style, duck);
      } else if (style === 'house') {
        for (let q = 0; q < 4; q++) bassNote(m, t0 + q * beat + beat / 2, beat * 0.42, bassMidi + (q === 3 && b % 2 ? 7 : 0), 0.5, style, duck);
      } else if (style === 'techno') {
        for (let s = 0; s < 16; s++) {
          if (s % 4 === 0) continue;
          const acc = [0, 12, 0, 7, 0, 12, 7, 0][s % 8];
          bassNote(m, t0 + s * (beat / 4), beat * 0.2, bassMidi + acc, 0.36, style, duck);
        }
      } else if (style === 'garage') {
        bassNote(m, t0, beat * 1.4, bassMidi, 0.55, style, duck);
        bassNote(m, t0 + beat * 2.5, beat * 0.8, bassMidi + (b % 2 ? 3 : 0), 0.5, style, duck);
      } else {
        bassNote(m, t0, beat * 0.9, bassMidi, 0.55, style, duck);
        bassNote(m, t0 + beat * 1.5, beat * 0.4, bassMidi + 12, 0.4, style, duck);
        bassNote(m, t0 + beat * 2.5, beat * 1.2, bassMidi, 0.5, style, duck);
      }
    }

    // chords
    if (hasChords(b)) {
      const notes = chord.map((c) => 60 + ((root + c) % 12) + (c >= 12 ? 0 : 0));
      // jazzy 7th/9th voicing for the deep styles, stacked in thirds on the scale so it stays in key
      const scale = spec.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
      const deg = Math.max(0, scale.indexOf(chord[0] % 12));
      const nine = [0, 2, 4, 6, 8].map((k, j) => {
        const d = deg + k;
        return 60 + ((root + scale[d % 7]) % 12) + (j >= 3 ? 12 : 0);
      });
      if (style === 'rave') {
        const pv = [...notes, notes[0] + 12];
        if (breakdown(b)) {
          if (b % 2 === 0) stamp(m, piano(Math.floor(b / 2) % 4, pv), t0, 0.5);
          if (b % 2 === 0) stamp(m, piano(Math.floor(b / 2) % 4, pv), t0 + beat * 2.5, 0.35);
        } else for (const hh of [0.5, 1.5, 2.5, 3.5]) stamp(m, piano(Math.floor(b / 2) % 4, pv), t0 + hh * beat, drop(b) ? 0.42 : 0.3, 0, duck);
        if (drop(b) && b % 2 === 0) stab(m, t0, beat * 0.5, notes.map((x) => x - 12), 0.3, 1, duck);
      } else if (breakdown(b)) {
        if (b % 2 === 0) pad(m, t0, bar * 2, deepStyle ? nine : notes.map((x) => x - 12).concat(notes), 0.35, duck);
      } else if (style === 'minimal') {
        for (const q of [3, 10]) stab(m, t0 + q * (beat / 4), beat * 0.16, nine, 0.26, 0.3, duck);
      } else if (style === 'rolling') {
        if (b % 2 === 1) stab(m, t0 + beat * 3.75, beat * 0.2, nine, 0.2, 0.4, duck);
      } else if (style === 'techhouse') {
        if (b % 4 === 3) stab(m, t0 + beat * 2.5, beat * 0.3, notes.map((x) => x - 12), 0.22, 0.6, duck);
      } else if (style === 'house' || style === 'garage') {
        const hits = style === 'house' ? [0.5, 1.5, 2.75, 3.5] : [0.75, 2.25, 3.5];
        hits.forEach((h) => stab(m, t0 + h * beat, beat * 0.3, notes, 0.34, 0.8, duck));
      } else if (style === 'techno') {
        if (b % 2 === 0) stab(m, t0 + beat * 0.75, beat * 0.2, notes.map((x) => x - 12), 0.28, 0.5, duck);
        if (b % 4 === 3) stab(m, t0 + beat * 2.75, beat * 0.2, notes.map((x) => x - 12), 0.22, 0.5, duck);
      } else {
        if (b % 2 === 0) pad(m, t0, bar * 2, notes, 0.2, duck);
      }
    }

    // vocal chops
    if (style === 'techhouse' && (groove(b) || drop(b)) && b % 2 === 1) stamp(m, drop(b) ? chopHey : chopYeah, t0 + beat * 3.5, drop(b) ? 0.34 : 0.26, 0.1, duck);
    if (style === 'techhouse' && breakdown(b) && b % 2 === 0) stamp(m, chopOh, t0, 0.26, -0.1);
    if (style === 'rolling' && (groove(b) || drop(b)) && b % 4 === 2) stamp(m, chopOh, t0 + beat * 0.5, 0.14, 0.2, duck);
    if (style === 'rave' && drop(b)) for (const q of [1.5, 3.5]) stamp(m, chopHey, t0 + q * beat, 0.24, q > 2 ? 0.2 : -0.2, duck);
    if (style === 'rave' && breakdown(b) && b % 2 === 1) stamp(m, chopOh, t0, 0.3);

    // lead arpeggio
    if (hasLead(b) && !deepStyle && style !== 'techhouse' && style !== 'rave') {
      const tones = chord.map((c) => 72 + ((root + c) % 12));
      const seq = [0, 1, 2, 1, 0, 2, 1, 2];
      for (let s = 0; s < 8; s++) {
        const nm = tones[seq[(s + b) % 8] % 3] + (s === 6 ? 12 : 0);
        pluck(m, t0 + s * (beat / 2), nm, breakdown(b) ? 0.12 : 0.16, s % 2 ? 0.35 : -0.35);
      }
    }

    // transitions
    if (b === Math.round(B * 0.625) - 4) riser(m, t0, bar * 4, 0.35, rnd);
    if (b === 0 || b === Math.round(B * 0.125) || b === Math.round(B * 0.625) || b === Math.round(B * 0.875)) crash(m, t0, 0.22, rnd);
  }

  // master: gentle saturation and peak normalisation
  let peak = 0;
  for (let i = 0; i < m.length; i++) {
    m.L[i] = Math.tanh(m.L[i] * 0.9);
    m.R[i] = Math.tanh(m.R[i] * 0.9);
    peak = Math.max(peak, Math.abs(m.L[i]), Math.abs(m.R[i]));
  }
  const g = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < m.length; i++) {
    m.L[i] *= g;
    m.R[i] *= g;
  }
  return { sampleRate, left: m.L, right: m.R };
}

export interface DemoTrack {
  title: string;
  artist: string;
  label?: string;
  genre?: string;
  spec: DemoSpec;
  /** the game's own library (Section 7): energy 1–10 and tags (src/game/tracks.ts reads them) */
  energy?: number;
  tags?: string[];
}

export const DEMO_TRACKS: DemoTrack[] = [
  { title: 'Midnight Circuit', artist: 'Deckhouse Demo', spec: { seed: 11, bpm: 124, root: 9, minor: true, style: 'house', bars: 64 } },
  { title: 'Sunset Garage', artist: 'Deckhouse Demo', spec: { seed: 42, bpm: 128, root: 5, minor: false, style: 'garage', bars: 64 } },
  { title: 'Glass Harbour', artist: 'Mira Solen', label: 'Tidal Room', spec: { seed: 101, bpm: 118, root: 7, minor: true, style: 'house', bars: 64 } },
  { title: 'Slow Bloom', artist: 'Mira Solen', label: 'Tidal Room', spec: { seed: 102, bpm: 120, root: 2, minor: true, style: 'garage', bars: 64 } },
  { title: 'Coastline Dub', artist: 'Low Orbit', label: 'Tidal Room', spec: { seed: 103, bpm: 121, root: 5, minor: false, style: 'house', bars: 64 } },
  { title: 'Morning Static', artist: 'Pale Arcade', label: 'Tidal Room', spec: { seed: 112, bpm: 122, root: 9, minor: true, style: 'garage', bars: 64 } },
  { title: 'Amber Frequency', artist: 'Low Orbit', label: 'Night Shift', spec: { seed: 104, bpm: 123, root: 9, minor: true, style: 'house', bars: 64 } },
  { title: 'Afterglow Two-Step', artist: 'Pale Arcade', label: 'Night Shift', spec: { seed: 111, bpm: 127, root: 10, minor: false, style: 'garage', bars: 64 } },
  { title: 'Canal Walk', artist: 'Jorik Maas', label: 'Backroom Grooves', genre: 'Deep Minimal House', spec: { seed: 201, bpm: 126, root: 2, minor: true, style: 'minimal', bars: 64 } },
  { title: 'Velvet Keys', artist: 'Jorik Maas', label: 'Backroom Grooves', genre: 'Deep Minimal House', spec: { seed: 202, bpm: 127, root: 9, minor: true, style: 'minimal', bars: 64 } },
  { title: 'Late Tram', artist: 'Nena Voss', label: 'Backroom Grooves', genre: 'Deep Minimal House', spec: { seed: 203, bpm: 126, root: 7, minor: true, style: 'minimal', bars: 64 } },
  { title: 'Side Street Shuffle', artist: 'Nena Voss', label: 'Backroom Grooves', genre: 'Deep Minimal House', spec: { seed: 204, bpm: 128, root: 4, minor: true, style: 'minimal', bars: 64 } },
  { title: 'Conga Theory', artist: 'Dario Kade', label: 'Hollow Drums', genre: 'Minimal Tech House', spec: { seed: 205, bpm: 128, root: 11, minor: true, style: 'rolling', bars: 64 } },
  { title: 'Rolling Stock', artist: 'Dario Kade', label: 'Hollow Drums', genre: 'Minimal Tech House', spec: { seed: 206, bpm: 129, root: 4, minor: true, style: 'rolling', bars: 64 } },
  { title: 'Loop Ritual', artist: 'Lune Twins', label: 'Hollow Drums', genre: 'Minimal Tech House', spec: { seed: 207, bpm: 128, root: 6, minor: true, style: 'rolling', bars: 64 } },
  { title: 'Night Market', artist: 'Lune Twins', label: 'Hollow Drums', genre: 'Minimal Tech House', spec: { seed: 208, bpm: 130, root: 1, minor: true, style: 'rolling', bars: 64 } },
  { title: 'Get It Moving', artist: 'Ollie Brand', label: 'Heatwave Recordings', genre: 'Tech House', spec: { seed: 209, bpm: 127, root: 9, minor: true, style: 'techhouse', bars: 64 } },
  { title: 'Bounce Protocol', artist: 'Ollie Brand', label: 'Heatwave Recordings', genre: 'Tech House', spec: { seed: 210, bpm: 128, root: 4, minor: true, style: 'techhouse', bars: 64 } },
  { title: 'Sunday Sweats', artist: 'Mack Tully', label: 'Heatwave Recordings', genre: 'Tech House', spec: { seed: 211, bpm: 127, root: 2, minor: true, style: 'techhouse', bars: 64 } },
  { title: 'Backseat Bass', artist: 'Mack Tully', label: 'Heatwave Recordings', genre: 'Tech House', spec: { seed: 212, bpm: 128, root: 11, minor: true, style: 'techhouse', bars: 64 } },
  { title: 'Hands Up Higher', artist: 'Hollis & Grey', label: 'Big Room Revival', genre: 'Rave House / Breaks', spec: { seed: 213, bpm: 128, root: 0, minor: false, style: 'rave', bars: 64 } },
  { title: 'Piano Rush', artist: 'Hollis & Grey', label: 'Big Room Revival', genre: 'Rave House / Breaks', spec: { seed: 214, bpm: 130, root: 7, minor: false, style: 'rave', bars: 64 } },
  { title: 'Euphoria Line', artist: 'Northern Ravers Club', label: 'Big Room Revival', genre: 'Rave House / Breaks', spec: { seed: 215, bpm: 129, root: 2, minor: false, style: 'rave', bars: 64 } },
  { title: 'Strobe Hymn', artist: 'Northern Ravers Club', label: 'Big Room Revival', genre: 'Rave House / Breaks', spec: { seed: 216, bpm: 131, root: 9, minor: false, style: 'rave', bars: 64 } },
  /* The game's first batch (Section 7): club-length (128 bars, about four minutes) with 16-bar drum intros and
   * outros so they blend, in the brief's three lanes plus UK garage and piano house, 122–128 BPM. Made-up artists. */
  { title: 'Low Ceiling Theory', artist: 'Cold Tap', label: 'Deckhouse Originals', genre: 'Deep House', energy: 4, tags: ['deep', 'groovy'], spec: { seed: 301, bpm: 123, root: 9, minor: true, style: 'minimal', bars: 128 } },
  { title: 'Third Floor Tape', artist: 'Night Clerk', label: 'Deckhouse Originals', genre: 'Deep House', energy: 4, tags: ['deep', 'groovy', 'afterhours'], spec: { seed: 302, bpm: 124, root: 4, minor: true, style: 'minimal', bars: 128 } },
  { title: 'Five AM Hum', artist: 'Night Clerk', label: 'Deckhouse Originals', genre: 'Minimal', energy: 3, tags: ['deep', 'afterhours'], spec: { seed: 303, bpm: 122, root: 2, minor: true, style: 'minimal', bars: 128 } },
  { title: 'Condensation', artist: 'Cold Tap', label: 'Deckhouse Originals', genre: 'Minimal Tech House', energy: 5, tags: ['rolling', 'deep', 'afterhours'], spec: { seed: 304, bpm: 125, root: 9, minor: true, style: 'rolling', bars: 128 } },
  { title: 'Bassline Pressure', artist: 'Saffron Lane', label: 'Deckhouse Originals', genre: 'Minimal Tech House', energy: 6, tags: ['rolling', 'groovy'], spec: { seed: 305, bpm: 126, root: 4, minor: true, style: 'rolling', bars: 128 } },
  { title: 'Two Step Telephone', artist: 'Paper Lanterns', label: 'Deckhouse Originals', genre: 'UK Garage', energy: 6, tags: ['garage', 'groovy'], spec: { seed: 306, bpm: 126, root: 0, minor: false, style: 'garage', bars: 128 } },
  { title: 'Last Bus Home', artist: 'Paper Lanterns', label: 'Deckhouse Originals', genre: 'UK Garage', energy: 6, tags: ['garage', 'closer'], spec: { seed: 307, bpm: 127, root: 7, minor: false, style: 'garage', bars: 128 } },
  { title: 'Hands On The Ceiling', artist: 'Mono Nadia', label: 'Deckhouse Originals', genre: 'Tech House', energy: 7, tags: ['groovy', 'vocal', 'peak'], spec: { seed: 308, bpm: 126, root: 11, minor: true, style: 'techhouse', bars: 128 } },
  { title: 'Shake The Booth', artist: 'Wet Paint', label: 'Deckhouse Originals', genre: 'Tech House', energy: 8, tags: ['vocal', 'peak'], spec: { seed: 309, bpm: 127, root: 4, minor: true, style: 'techhouse', bars: 128 } },
  { title: 'Sticky Floor', artist: 'Wet Paint', label: 'Deckhouse Originals', genre: 'Tech House', energy: 8, tags: ['vocal', 'peak', 'groovy'], spec: { seed: 310, bpm: 128, root: 6, minor: true, style: 'techhouse', bars: 128 } },
  { title: 'Piano In The Rain', artist: 'Gold Leaf Club', label: 'Deckhouse Originals', genre: 'Piano House', energy: 7, tags: ['piano', 'rave', 'closer'], spec: { seed: 311, bpm: 125, root: 0, minor: false, style: 'rave', bars: 128 } },
  { title: 'Strobe Church', artist: 'Kite Factory', label: 'Deckhouse Originals', genre: 'Rave House', energy: 9, tags: ['rave', 'piano', 'peak'], spec: { seed: 312, bpm: 128, root: 7, minor: false, style: 'rave', bars: 128 } },
  { title: 'Sunrise Ring Road', artist: 'Gold Leaf Club', label: 'Deckhouse Originals', genre: 'Piano House', energy: 7, tags: ['piano', 'closer', 'rave'], spec: { seed: 313, bpm: 124, root: 5, minor: false, style: 'rave', bars: 128 } },
  /* The full launch library (Section 7.1): 30 more in the same lanes, so there are 40+ originals across deep house,
   * minimal, minimal tech house, UK garage, tech house, rave house and piano house. */
  { title: 'Lamp Post Lullaby', artist: 'Amber Lanterns', label: 'Deckhouse Originals', genre: 'Deep House', energy: 4, tags: ['deep', 'groovy'], spec: { seed: 314, bpm: 122, root: 2, minor: true, style: 'house', bars: 128 } },
  { title: 'Steam On The Windows', artist: 'Soft Concrete', label: 'Deckhouse Originals', genre: 'Deep House', energy: 4, tags: ['deep', 'groovy', 'afterhours'], spec: { seed: 315, bpm: 123, root: 7, minor: true, style: 'minimal', bars: 128 } },
  { title: 'Slow Lift', artist: 'The Night Porters', label: 'Deckhouse Originals', genre: 'Deep House', energy: 5, tags: ['deep', 'groovy'], spec: { seed: 316, bpm: 124, root: 9, minor: false, style: 'house', bars: 128 } },
  { title: 'Back Room Velvet', artist: 'Velvet Cabin', label: 'Deckhouse Originals', genre: 'Deep House', energy: 4, tags: ['deep', 'groovy', 'closer'], spec: { seed: 317, bpm: 121, root: 5, minor: true, style: 'house', bars: 128 } },
  { title: 'Rain On The Skylight', artist: 'Amber Lanterns', label: 'Deckhouse Originals', genre: 'Deep House', energy: 3, tags: ['deep', 'afterhours'], spec: { seed: 318, bpm: 120, root: 0, minor: true, style: 'minimal', bars: 128 } },
  { title: 'Quiet Tuesday', artist: 'Soft Concrete', label: 'Deckhouse Originals', genre: 'Deep House', energy: 5, tags: ['deep', 'groovy'], spec: { seed: 319, bpm: 124, root: 4, minor: false, style: 'house', bars: 128 } },
  { title: 'Four Walls', artist: 'Low Hum Unit', label: 'Deckhouse Originals', genre: 'Minimal', energy: 3, tags: ['deep', 'afterhours'], spec: { seed: 320, bpm: 123, root: 11, minor: true, style: 'minimal', bars: 128 } },
  { title: 'Metronome Garden', artist: 'Grey Room Club', label: 'Deckhouse Originals', genre: 'Minimal', energy: 4, tags: ['deep', 'rolling', 'afterhours'], spec: { seed: 321, bpm: 125, root: 6, minor: true, style: 'minimal', bars: 128 } },
  { title: 'Hum Of The Fridge', artist: 'Low Hum Unit', label: 'Deckhouse Originals', genre: 'Minimal', energy: 3, tags: ['afterhours', 'deep'], spec: { seed: 322, bpm: 122, root: 1, minor: true, style: 'minimal', bars: 128 } },
  { title: 'Pale Static', artist: 'Grey Room Club', label: 'Deckhouse Originals', genre: 'Minimal', energy: 4, tags: ['deep', 'afterhours'], spec: { seed: 323, bpm: 124, root: 8, minor: true, style: 'minimal', bars: 128 } },
  { title: 'Low Battery', artist: 'Night Clerk', label: 'Deckhouse Originals', genre: 'Minimal', energy: 4, tags: ['rolling', 'afterhours'], spec: { seed: 324, bpm: 125, root: 3, minor: true, style: 'rolling', bars: 128 } },
  { title: 'Night Bus Loop', artist: 'Tunnel Vision Crew', label: 'Deckhouse Originals', genre: 'Minimal Tech House', energy: 6, tags: ['rolling', 'groovy'], spec: { seed: 325, bpm: 126, root: 10, minor: true, style: 'rolling', bars: 128 } },
  { title: 'Conveyor', artist: 'Saffron Lane', label: 'Deckhouse Originals', genre: 'Minimal Tech House', energy: 6, tags: ['rolling', 'peak'], spec: { seed: 326, bpm: 127, root: 7, minor: true, style: 'rolling', bars: 128 } },
  { title: 'Carousel Shuffle', artist: 'Tunnel Vision Crew', label: 'Deckhouse Originals', genre: 'Minimal Tech House', energy: 5, tags: ['rolling', 'groovy', 'afterhours'], spec: { seed: 327, bpm: 126, root: 2, minor: true, style: 'rolling', bars: 128 } },
  { title: 'Text Me Back', artist: 'Two Tone Cartel', label: 'Deckhouse Originals', genre: 'UK Garage', energy: 6, tags: ['garage', 'vocal', 'groovy'], spec: { seed: 328, bpm: 128, root: 5, minor: false, style: 'garage', bars: 128 } },
  { title: 'Pirate Signal', artist: 'Southbound Social', label: 'Deckhouse Originals', genre: 'UK Garage', energy: 7, tags: ['garage', 'peak'], spec: { seed: 329, bpm: 128, root: 9, minor: true, style: 'garage', bars: 128 } },
  { title: 'Bus Stop Romance', artist: 'Paper Lanterns', label: 'Deckhouse Originals', genre: 'UK Garage', energy: 6, tags: ['garage', 'groovy', 'closer'], spec: { seed: 330, bpm: 127, root: 2, minor: false, style: 'garage', bars: 128 } },
  { title: 'Sweet Talk Shuffle', artist: 'Two Tone Cartel', label: 'Deckhouse Originals', genre: 'UK Garage', energy: 6, tags: ['garage', 'vocal'], spec: { seed: 331, bpm: 129, root: 7, minor: true, style: 'garage', bars: 128 } },
  { title: 'Off The Kerb', artist: 'Southbound Social', label: 'Deckhouse Originals', genre: 'UK Garage', energy: 7, tags: ['garage', 'groovy', 'peak'], spec: { seed: 332, bpm: 130, root: 0, minor: true, style: 'garage', bars: 128 } },
  { title: 'Elbows Out', artist: 'Hot Desk', label: 'Deckhouse Originals', genre: 'Tech House', energy: 8, tags: ['groovy', 'peak', 'vocal'], spec: { seed: 333, bpm: 127, root: 9, minor: true, style: 'techhouse', bars: 128 } },
  { title: 'Queue Jump', artist: 'Late Checkout', label: 'Deckhouse Originals', genre: 'Tech House', energy: 7, tags: ['groovy', 'vocal'], spec: { seed: 334, bpm: 126, root: 6, minor: true, style: 'techhouse', bars: 128 } },
  { title: 'Coat Check', artist: 'Hot Desk', label: 'Deckhouse Originals', genre: 'Tech House', energy: 7, tags: ['groovy', 'peak'], spec: { seed: 335, bpm: 128, root: 1, minor: true, style: 'techhouse', bars: 128 } },
  { title: 'Drink Tokens', artist: 'Mono Nadia', label: 'Deckhouse Originals', genre: 'Tech House', energy: 8, tags: ['vocal', 'peak'], spec: { seed: 336, bpm: 128, root: 8, minor: true, style: 'techhouse', bars: 128 } },
  { title: 'Back Of The Queue', artist: 'Late Checkout', label: 'Deckhouse Originals', genre: 'Tech House', energy: 6, tags: ['groovy', 'rolling'], spec: { seed: 337, bpm: 125, root: 3, minor: true, style: 'techhouse', bars: 128 } },
  { title: 'Hands For Days', artist: 'Glowstick Choir', label: 'Deckhouse Originals', genre: 'Rave House', energy: 9, tags: ['rave', 'peak', 'piano'], spec: { seed: 338, bpm: 129, root: 4, minor: false, style: 'rave', bars: 128 } },
  { title: 'Lasers At Dawn', artist: 'Kite Factory', label: 'Deckhouse Originals', genre: 'Rave House', energy: 8, tags: ['rave', 'peak', 'closer'], spec: { seed: 339, bpm: 128, root: 9, minor: false, style: 'rave', bars: 128 } },
  { title: 'Whistle Posse', artist: 'Glowstick Choir', label: 'Deckhouse Originals', genre: 'Rave House', energy: 9, tags: ['rave', 'peak'], spec: { seed: 340, bpm: 130, root: 2, minor: true, style: 'rave', bars: 128 } },
  { title: 'Ivory Rush', artist: 'Ivory Weekend', label: 'Deckhouse Originals', genre: 'Piano House', energy: 7, tags: ['piano', 'groovy', 'peak'], spec: { seed: 341, bpm: 126, root: 7, minor: false, style: 'rave', bars: 128 } },
  { title: 'Sunday Hymnal', artist: 'Gold Leaf Club', label: 'Deckhouse Originals', genre: 'Piano House', energy: 6, tags: ['piano', 'closer'], spec: { seed: 342, bpm: 123, root: 0, minor: false, style: 'rave', bars: 128 } },
  { title: 'Piano On The Roof', artist: 'Ivory Weekend', label: 'Deckhouse Originals', genre: 'Piano House', energy: 7, tags: ['piano', 'rave', 'closer'], spec: { seed: 343, bpm: 125, root: 5, minor: false, style: 'rave', bars: 128 } },
];
