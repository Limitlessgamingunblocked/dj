/*
 * Offline procedural synthesis for the sampler (pure TS, runs in a worker):
 * one-shot sounds (air horn, siren, laser, impact, riser ...). The voices are
 * exported for the test fixtures, which build whole test tracks from them.
 */
import { rng } from '../core/util';

export interface Rendered {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

export const TAU = Math.PI * 2;
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private sr: number) {}
  set(type: 'lp' | 'hp' | 'bp', f: number, q: number): this {
    f = Math.min(f, this.sr * 0.45);
    const w = (TAU * f) / this.sr;
    const cs = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (type === 'lp') {
      this.b0 = (1 - cs) / 2 / a0;
      this.b1 = (1 - cs) / a0;
      this.b2 = this.b0;
    } else if (type === 'hp') {
      this.b0 = (1 + cs) / 2 / a0;
      this.b1 = -(1 + cs) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    }
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export class Mix {
  readonly L: Float32Array;
  readonly R: Float32Array;
  constructor(
    readonly sr: number,
    seconds: number,
  ) {
    const n = Math.ceil(seconds * sr);
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
  }
  get length(): number {
    return this.L.length;
  }
  add(i: number, l: number, r: number): void {
    if (i >= 0 && i < this.L.length) {
      this.L[i] += l;
      this.R[i] += r;
    }
  }
}
/* ------------------------------------------------------------------ */
/* voices                                                               */
/* ------------------------------------------------------------------ */

export function kick(m: Mix, t: number, gain: number, punch = 1, tail = 0.38): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor(tail * 1.2 * sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    const f = 44 + 120 * punch * Math.exp(-s * 38) + 30 * Math.exp(-s * 300);
    ph += (TAU * f) / sr;
    const env = Math.exp(-s / tail) * (1 - Math.exp(-s * 900));
    let v = Math.sin(ph) * env;
    v = Math.tanh(v * 1.6);
    const click = s < 0.004 ? (1 - s / 0.004) * 0.35 : 0;
    const out = (v + click) * gain;
    m.add(start + i, out, out);
  }
}

export function clap(m: Mix, t: number, gain: number, rnd: () => number): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor(0.35 * sr);
  const bp = new Biquad(sr).set('bp', 1300, 1.1);
  const bp2 = new Biquad(sr).set('bp', 2400, 1.4);
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    const burst = s < 0.03 ? Math.exp(-((s % 0.0105) / 0.0035)) : 0;
    const tail = Math.exp(-s / 0.09) * (s >= 0.02 ? 1 : 0);
    const x = rnd() * 2 - 1;
    const v = (bp.run(x) * 1.4 + bp2.run(x) * 0.6) * (burst + tail * 0.8) * gain;
    m.add(start + i, v * 0.9, v);
  }
}

export function riser(m: Mix, t: number, dur: number, gain: number, rnd: () => number): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor(dur * sr);
  const bp = new Biquad(sr);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    if (i % 64 === 0) bp.set('bp', 300 + 9000 * p * p, 1.5);
    const v = bp.run(rnd() * 2 - 1) * p * p * gain;
    m.add(start + i, v * (0.8 + 0.2 * Math.sin(p * 40)), v * (0.8 - 0.2 * Math.sin(p * 40)));
  }
}

export function crash(m: Mix, t: number, gain: number, rnd: () => number): void {
  const sr = m.sr;
  const start = Math.floor(t * sr);
  const n = Math.floor(2.2 * sr);
  const hp = new Biquad(sr).set('hp', 4000, 0.6);
  const hp2 = new Biquad(sr).set('hp', 4000, 0.6);
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    const env = Math.exp(-s / 0.6);
    m.add(start + i, hp.run(rnd() * 2 - 1) * env * gain, hp2.run(rnd() * 2 - 1) * env * gain);
  }
}

/** Rimshot tuned to `f` (body) with a click ringing two octaves up. */
/* ------------------------------------------------------------------ */
/* sampler sounds                                                       */
/* ------------------------------------------------------------------ */

export const SAMPLE_NAMES = ['Air Horn', 'Siren', 'Laser Zap', 'Impact', 'White Riser', 'Clap Stack', 'Scratch', 'Reverse Crash'] as const;
export type SampleName = (typeof SAMPLE_NAMES)[number];

export function renderSample(name: SampleName, sampleRate = 44100): Rendered {
  const rnd = rng(name.length * 977);
  const sr = sampleRate;
  let m: Mix;
  switch (name) {
    case 'Air Horn': {
      m = new Mix(sr, 2.2);
      const blasts = [
        [0, 0.18],
        [0.24, 0.18],
        [0.48, 1.2],
      ];
      for (const [t, d] of blasts) {
        const start = Math.floor(t * sr);
        const n = Math.floor((d + 0.08) * sr);
        const ph = [0, 0, 0, 0];
        const fs = [466, 587, 698, 932];
        const bp = new Biquad(sr).set('bp', 1500, 0.8);
        for (let i = 0; i < n; i++) {
          const s = i / sr;
          const bend = 1 - 0.08 * Math.exp(-s * 30);
          let v = 0;
          fs.forEach((f, k) => {
            ph[k] += (f * bend * (1 + k * 0.003)) / sr;
            if (ph[k] >= 1) ph[k] -= 1;
            v += 2 * ph[k] - 1;
          });
          const env = Math.min(1, s * 60) * (s < d ? 1 : Math.exp(-(s - d) * 40));
          const out = Math.tanh((v * 0.4 + bp.run(v) * 0.5) * 1.5) * env * 0.55;
          m.add(start + i, out, out);
        }
      }
      break;
    }
    case 'Siren': {
      m = new Mix(sr, 2.5);
      let ph = 0;
      for (let i = 0; i < m.length; i++) {
        const s = i / sr;
        const f = 900 + 450 * Math.sin(TAU * 1.6 * s);
        ph += f / sr;
        const v = (ph % 1 < 0.5 ? 1 : -1) * 0.25 + Math.sin(TAU * ph) * 0.3;
        const env = Math.min(1, s * 20) * Math.min(1, (2.5 - s) * 4);
        m.add(i, v * env, v * env);
      }
      break;
    }
    case 'Laser Zap': {
      m = new Mix(sr, 0.6);
      let ph = 0;
      for (let i = 0; i < m.length; i++) {
        const s = i / sr;
        ph += (2800 * Math.exp(-s * 9) + 80) / sr;
        const v = (ph % 1 < 0.5 ? 1 : -1) * Math.exp(-s * 5) * 0.35;
        m.add(i, v, v);
      }
      break;
    }
    case 'Impact': {
      m = new Mix(sr, 3);
      kick(m, 0, 1, 1.4, 1.2);
      crash(m, 0, 0.35, rnd);
      break;
    }
    case 'White Riser': {
      m = new Mix(sr, 4);
      riser(m, 0, 4, 0.9, rnd);
      break;
    }
    case 'Clap Stack': {
      m = new Mix(sr, 0.8);
      clap(m, 0, 0.7, rnd);
      clap(m, 0.012, 0.4, rnd);
      break;
    }
    case 'Scratch': {
      m = new Mix(sr, 0.7);
      // "baby scratch" gesture over a vocal-ish buzz
      let ph = 0;
      const bp = new Biquad(sr).set('bp', 1200, 2.5);
      for (let i = 0; i < m.length; i++) {
        const s = i / sr;
        const speed = Math.sin(TAU * 3.2 * s);
        ph += (Math.abs(speed) * 520) / sr;
        const buzz = (ph % 1) * 2 - 1 + (rnd() - 0.5) * 0.4;
        const v = bp.run(buzz) * Math.min(1, Math.abs(speed) * 2) * 0.9;
        m.add(i, v, v);
      }
      break;
    }
    case 'Reverse Crash':
    default: {
      m = new Mix(sr, 2.2);
      crash(m, 0, 0.5, rnd);
      m.L.reverse();
      m.R.reverse();
      break;
    }
  }
  return { sampleRate: sr, left: m.L, right: m.R };
}

/* The first four open on the decks; the rest give the set builder a crate of fictional artists and labels to work with,
 * including four groups synthesised in the sounds its artist style profiles describe (deep minimal, percussive
 * rolling minimal, bouncy tech house, rave house). All artists, labels and titles are made up. */
