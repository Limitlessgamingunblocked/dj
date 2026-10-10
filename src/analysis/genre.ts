/*
 * Genre from the audio (runs in the analysis worker, after tempo and key).
 *
 * Three slices of the track's body (a quarter, half and three quarters in,
 * 24 s each) are measured on the beat grid:
 *   rhythm   kick, snare and hat onsets folded onto the 16 steps of a bar:
 *            four on the floor, a backbeat (2 and 4), a half-time snare (3),
 *            the dembow, a 2-step kick, off-beat hats, how busy the hats are
 *            and whether they roll, and the swing of the off-beat 16ths
 *   tone     how much of the energy sits in the sub, the bass, the mids
 *            (voice and chords) and the top; brightness
 *   pulse    how clearly there's a beat at all, and how busy the onsets are
 * Each genre is a set of soft rules over those (a tempo range, rhythms it
 * needs or rules out, a tonal balance); the best score wins, and how far it
 * beats the runner-up is the confidence. It's a guess from the sound, so a
 * genre in the file's own tags is shown instead, and you can set any track's
 * genre by hand (library/genres.ts).
 */
import { magnitudes } from './fft';

export const GENRES = [
  'House',
  'Deep House',
  'Tech House',
  'Techno',
  'Trance',
  'Hardstyle',
  'Drum & Bass',
  'Dubstep',
  'UK Garage',
  'Disco',
  'Afro House',
  'Trap',
  'Hip Hop',
  'R&B',
  'Pop',
  'Reggaeton',
  'Lo-fi',
  'Ambient',
] as const;
export type Genre = (typeof GENRES)[number];

export interface GenreFeatures {
  bpm: number;
  /** kick on every beat, 0..1 */
  fourFloor: number;
  /** snare/clap on 2 and 4, 0..1 */
  backbeat: number;
  /** snare on 3 only (half-time feel), 0..1 */
  halftime: number;
  /** the reggaeton dembow (3+3+2 snare against the kick), 0..1 */
  dembow: number;
  /** kick on 1 and the "and" of 3 with the 2 and 4 kicks missing (2-step, breakbeats), 0..1 */
  twoStep: number;
  /** open hats between the beats, 0..1 */
  offbeatHat: number;
  /** share of the 16 steps with a hat on them, 0..1 */
  hatDensity: number;
  /** hat onsets faster than 16ths (trap rolls), 0..1 */
  hatRoll: number;
  /** late off-beat 16ths: 0 straight, ~0.33 heavy swing */
  swing: number;
  /** energy shares (they sum to about 1) */
  sub: number;
  bass: number;
  mid: number;
  high: number;
  /** spectral centroid, Hz */
  centroid: number;
  /** how clearly the music pulses on the beat, 0..1 */
  pulse: number;
  /** onsets per second (all bands) */
  density: number;
  minor: boolean;
}

export interface GenreGuess {
  genre: Genre;
  /** 0..1: how far the winner beats the next best */
  confidence: number;
  /** the next best, for "House / Tech House" style hints */
  runnerUp: Genre;
  features: GenreFeatures;
}

/* ------------------------------------------------------------------ */
/* measuring                                                            */
/* ------------------------------------------------------------------ */

const SR = 22050;
const N = 1024;
const HOP = 256;
const SLICE = 24;

function decimateTo(mono: Float32Array, sr: number): { x: Float32Array; sr: number } {
  const f = Math.max(1, Math.round(sr / SR));
  if (f === 1) return { x: mono, sr };
  const n = Math.floor(mono.length / f);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < f; k++) s += mono[i * f + k];
    out[i] = s / f;
  }
  return { x: out, sr: sr / f };
}

interface Slice {
  /** per frame: positive flux in the kick, snare and hat bands, and all bands */
  kick: Float32Array;
  snare: Float32Array;
  hat: Float32Array;
  all: Float32Array;
  /** summed energy per band over the slice */
  e: { sub: number; bass: number; mid: number; high: number; total: number; centroidNum: number; centroidDen: number };
  /** time of frame 0 in the track, seconds */
  t0: number;
  fps: number;
}

function measure(x: Float32Array, sr: number, from: number, to: number): Slice {
  const binHz = sr / N;
  const b = (hz: number) => Math.max(1, Math.min(N / 2 - 1, Math.round(hz / binHz)));
  const [sub0, sub1, kick1, bass1, snare0, snare1, mid1, hat0] = [b(25), b(60), b(140), b(250), b(180), b(4000), b(4000), b(6000)];
  const frames = Math.max(0, Math.floor((to - from - N) / HOP));
  const kick = new Float32Array(frames);
  const snare = new Float32Array(frames);
  const hat = new Float32Array(frames);
  const all = new Float32Array(frames);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const mag = new Float32Array(N / 2);
  let prev = new Float32Array(N / 2);
  let cur = new Float32Array(N / 2);
  const e = { sub: 0, bass: 0, mid: 0, high: 0, total: 0, centroidNum: 0, centroidDen: 0 };
  for (let f = 0; f < frames; f++) {
    magnitudes(x, from + f * HOP, N, re, im, mag);
    let fk = 0;
    let fs = 0;
    let fh = 0;
    let fa = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = mag[k];
      const p = m * m;
      if (k >= sub0 && k < sub1) e.sub += p;
      else if (k >= sub1 && k < bass1) e.bass += p;
      else if (k >= bass1 && k < mid1) e.mid += p;
      else if (k >= mid1) e.high += p;
      e.total += p;
      if (k >= bass1) {
        e.centroidNum += p * k * binHz;
        e.centroidDen += p;
      }
      const v = Math.log1p(100 * m);
      cur[k] = v;
      const d = v - prev[k];
      if (d > 0) {
        fa += d;
        if (k >= sub0 && k < kick1) fk += d;
        if (k >= snare0 && k < snare1) fs += d;
        if (k >= hat0) fh += d;
      }
    }
    kick[f] = fk;
    snare[f] = fs;
    hat[f] = fh;
    all[f] = fa;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return { kick, snare, hat, all, e, t0: (from + 0.75 * N) / sr, fps: sr / HOP };
}

/** remove a running mean and keep what sticks out (onsets, not sustained noise) */
function peaks(a: Float32Array, fps: number): Float32Array {
  const w = Math.max(2, Math.round(fps * 0.25));
  const out = new Float32Array(a.length);
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc += a[i];
    if (i >= 2 * w) acc -= a[i - 2 * w];
    const c = i - w;
    if (c >= 0) out[c] = Math.max(0, a[c] - (acc / Math.min(i + 1, 2 * w)) * 1.15);
  }
  return out;
}

/** onset strength folded onto the 16 steps of a bar (and 48 per beat, for swing) */
function fold(a: Float32Array, s: Slice, bpm: number, firstBeat: number): { steps: Float32Array; fine: Float32Array } {
  const beat = 60 / bpm;
  const steps = new Float32Array(16);
  const fine = new Float32Array(48);
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v <= 0) continue;
    const t = s.t0 + i / s.fps - firstBeat;
    const inBar = (((t / (beat * 4)) % 1) + 1) % 1;
    const st = Math.round(inBar * 16) % 16;
    steps[st] += v;
    const inBeat = (((t / beat) % 1) + 1) % 1;
    fine[Math.floor(inBeat * 48) % 48] += v;
  }
  return { steps, fine };
}

/** how peaked onsets folded onto an 8th are: the two best 3-bin spots against chance (6 of 24 bins) */
function pulseOf(f: Float32Array): number {
  const n = f.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += f[i];
  if (total <= 0) return 0;
  const s3 = (b: number) => f[(b + n - 1) % n] + f[b] + f[(b + 1) % n];
  let p1 = 0;
  for (let b = 1; b < n; b++) if (s3(b) > s3(p1)) p1 = b;
  let p2 = -1;
  for (let b = 0; b < n; b++) {
    const d = Math.min(Math.abs(b - p1), n - Math.abs(b - p1));
    if (d > 3 && (p2 < 0 || s3(b) > s3(p2))) p2 = b;
  }
  const frac = (s3(p1) + (p2 >= 0 ? s3(p2) : 0)) / total;
  return clamp01((frac - 0.25) / 0.6);
}

const mean = (a: ArrayLike<number>, idx: number[]) => idx.reduce((s, i) => s + a[i], 0) / idx.length;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** how much `on` stands above `off`, 0..1 */
const contrast = (on: number, off: number) => clamp01((on - off) / (on + off + 1e-9));

export function genreFeatures(mono: Float32Array, sampleRate: number, bpm: number, firstBeat: number, minor: boolean): GenreFeatures {
  const { x, sr } = decimateTo(mono, sampleRate);
  const dur = x.length / sr;
  const slices: Slice[] = [];
  const len = Math.min(SLICE, dur * 0.3);
  for (const at of dur > 40 ? [0.25, 0.5, 0.75] : [0.5]) {
    const c = dur * at;
    const from = Math.max(0, Math.floor((c - len / 2) * sr));
    const to = Math.min(x.length, Math.floor((c + len / 2) * sr));
    if (to - from > N * 4) slices.push(measure(x, sr, from, to));
  }
  const kick = new Float32Array(16);
  const snare = new Float32Array(16);
  const hat = new Float32Array(16);
  const hatFine = new Float32Array(48);
  const all16 = new Float32Array(16);
  const eighth = new Float32Array(24);
  let onsets = 0;
  let secs = 0;
  let rollHits = 0;
  let rollBeats = 0;
  const E = { sub: 0, bass: 0, mid: 0, high: 0, total: 0, centroidNum: 0, centroidDen: 0 };
  let hatSum = 0;
  let allSum = 0;
  for (const s of slices) {
    const k = fold(peaks(s.kick, s.fps), s, bpm, firstBeat);
    const sn = fold(peaks(s.snare, s.fps), s, bpm, firstBeat);
    const hp = peaks(s.hat, s.fps);
    const h = fold(hp, s, bpm, firstBeat);
    const ap = peaks(s.all, s.fps);
    const a = fold(ap, s, bpm, firstBeat);
    for (let i = 0; i < 16; i++) {
      kick[i] += k.steps[i];
      snare[i] += sn.steps[i];
      hat[i] += h.steps[i];
      all16[i] += a.steps[i];
    }
    for (let i = 0; i < 48; i++) hatFine[i] += h.fine[i];
    // pulse: onsets folded onto an 8th note; a beat piles them into one or two spots (the 8th and its
    // off-beat 16th, straight or swung) wherever the grid's offset is, noise spreads them out
    const beat = 60 / bpm;
    for (let i = 0; i < ap.length; i++) {
      if (ap[i] <= 0) continue;
      const t = s.t0 + i / s.fps - firstBeat;
      const ph = (((t / (beat / 2)) % 1) + 1) % 1;
      eighth[Math.floor(ph * 24) % 24] += ap[i];
    }
    for (let i = 0; i < hp.length; i++) hatSum += hp[i];
    for (let i = 0; i < ap.length; i++) allSum += ap[i];
    // onset rate, and hat hits closer together than a 16th (rolls)
    let amax = 0;
    let asum = 0;
    for (let i = 0; i < ap.length; i++) {
      amax = Math.max(amax, ap[i]);
      asum += ap[i];
    }
    // an onset stands well above the average, but a few huge hits don't hide the rest
    const athr = Math.max((asum / Math.max(1, ap.length)) * 3, amax * 0.04);
    let hmax = 0;
    for (let i = 0; i < hp.length; i++) hmax = Math.max(hmax, hp[i]);
    let last = -1e9;
    let lastHat = -1e9;
    for (let i = 1; i < ap.length - 1; i++) {
      if (ap[i] > athr && ap[i] >= ap[i - 1] && ap[i] > ap[i + 1] && i - last > s.fps * 0.05) {
        onsets++;
        last = i;
      }
      if (hp[i] > hmax * 0.2 && hp[i] >= hp[i - 1] && hp[i] > hp[i + 1]) {
        const gap = (i - lastHat) / s.fps;
        if (gap < (beat / 4) * 0.58 && gap > 0.02) rollHits++;
        lastHat = i;
      }
    }
    rollBeats += s.kick.length / s.fps / beat;
    secs += s.kick.length / s.fps;
    for (const key of Object.keys(E) as (keyof typeof E)[]) E[key] += s.e[key];
  }
  const beats = [0, 4, 8, 12];
  const offs = [2, 6, 10, 14];
  const sixteenths = [1, 3, 5, 7, 9, 11, 13, 15];
  const kOn = mean(kick, beats);
  const kOff = mean(kick, [...offs, ...sixteenths]);
  const kMin = Math.min(...beats.map((i) => kick[i]));
  const kMax = Math.max(...beats.map((i) => kick[i]), 1e-9);
  // every beat kicked, about equally, and the off-steps quieter
  const fourFloor = clamp01(contrast(kOn, kOff) * 1.6) * clamp01((kMin / kMax) * 1.4);
  const sOther = mean(snare, [0, 2, 6, 8, 10, 14]);
  const backbeat = contrast(mean(snare, [4, 12]), sOther) * clamp01((Math.min(snare[4], snare[12]) / (Math.max(snare[4], snare[12]) + 1e-9)) * 1.5);
  const halftime = contrast(snare[8], (snare[4] + snare[12]) / 2) * contrast(snare[8], mean(snare, [0, 2, 6, 10, 14]));
  const dembow = contrast(mean(snare, [3, 6, 11, 14]), mean(snare, [0, 1, 2, 4, 5, 7, 8, 9, 10, 12, 13, 15])) * clamp01(contrast(kOn, kOff) * 1.5);
  const twoStep = contrast(mean(kick, [0, 10]), (kick[4] + kick[12]) / 2);
  const offbeatHat = contrast(mean(hat, offs), mean(hat, beats));
  let hMax = 0;
  for (let i = 0; i < 16; i++) hMax = Math.max(hMax, hat[i]);
  let hatSteps = 0;
  for (let i = 0; i < 16; i++) if (hat[i] > hMax * 0.35) hatSteps++;
  // hats only count when there are hats: a quiet top end isn't a busy one
  const hatsThere = allSum > 0 && hatSum / allSum > 0.03;
  const hatDensity = hMax > 0 && hatsThere ? hatSteps / 16 : 0;
  // swing: where the off-beat 16th's hats land between the straight spot (12/48) and the triplet spot (16/48)
  let swNum = 0;
  let swDen = 0;
  for (let i = 9; i <= 18; i++) {
    swNum += hatFine[i] * i;
    swDen += hatFine[i];
  }
  const swing = swDen > 0 ? clamp01((swNum / swDen - 12) / 12) : 0;
  const total = E.total || 1;
  return {
    bpm,
    fourFloor,
    backbeat,
    halftime,
    dembow,
    twoStep,
    offbeatHat,
    hatDensity,
    hatRoll: rollBeats > 0 && hatsThere ? clamp01(rollHits / rollBeats / 1.5) : 0,
    swing,
    sub: E.sub / total,
    bass: E.bass / total,
    mid: E.mid / total,
    high: E.high / total,
    centroid: E.centroidDen > 0 ? E.centroidNum / E.centroidDen : 0,
    // a handful of onsets can look peaked by chance: a pulse needs a steady stream of them
    pulse: pulseOf(eighth) * clamp01(secs > 0 ? onsets / secs / 1.5 : 0),
    density: secs > 0 ? onsets / secs : 0,
    minor,
  };
}

/* ------------------------------------------------------------------ */
/* deciding                                                             */
/* ------------------------------------------------------------------ */

/** 1 inside [lo, hi], falling off outside over `soft` BPM */
const inRange = (v: number, lo: number, hi: number, soft = 6) => (v < lo ? Math.exp(-0.5 * ((lo - v) / soft) ** 2) : v > hi ? Math.exp(-0.5 * ((v - hi) / soft) ** 2) : 1);
/** near `x` (0..1 scale), with `w` the width */
const near = (v: number, x: number, w: number) => Math.exp(-0.5 * ((v - x) / w) ** 2);
const hi = (v: number, at = 0.5) => clamp01(v / at);
const lo = (v: number, at = 0.5) => clamp01(1 - v / at);

/** the score of each genre for these features (higher is better) */
export function genreScores(f: GenreFeatures): Record<Genre, number> {
  const b = f.bpm;
  // half and double time read as the same tempo for the slow genres
  const slow = (lo_: number, hi_: number) => Math.max(inRange(b, lo_, hi_), inRange(b / 2, lo_, hi_) * 0.9, inRange(b * 2, lo_, hi_) * 0.6);
  const ff = f.fourFloor;
  const notFF = lo(ff, 0.45);
  // the top end is mostly hats; dark means little air above the mids
  const dark = lo(f.centroid - 1500, 4000);
  const bright = hi(f.centroid - 1500, 3500);
  // chords, pads and voices live in the mids: melodic and vocal music has them, drum tracks don't
  const melodic = hi(f.mid, 0.15);
  const vocal = hi(f.mid, 0.3);
  const subby = hi(f.sub, 0.25);
  const beat = hi(f.pulse - 0.2, 0.4);
  const s = {
    House: inRange(b, 118, 128, 4) * (0.6 * hi(ff, 0.5) + 0.25 * hi(f.offbeatHat, 0.4) + 0.15 * near(f.centroid, 2400, 1200)) * beat,
    'Deep House': inRange(b, 115, 124, 4) * (0.55 * hi(ff, 0.5) + 0.25 * dark + 0.2 * lo(f.high, 0.12)) * beat * (f.minor ? 1 : 0.85),
    'Tech House': inRange(b, 123, 128, 3) * (0.5 * hi(ff, 0.5) + 0.3 * hi(f.hatDensity, 0.6) + 0.2 * lo(f.mid, 0.35)) * beat,
    Techno: inRange(b, 126, 145, 4) * (0.55 * hi(ff, 0.5) + 0.3 * lo(f.mid, 0.12) + 0.15 * dark) * beat * (f.minor ? 1 : 0.85),
    Trance: inRange(b, 130, 142, 4) * (0.45 * hi(ff, 0.5) + 0.2 * hi(f.offbeatHat, 0.4) + 0.35 * melodic) * beat * (0.4 + 0.6 * melodic),
    Hardstyle: inRange(b, 145, 160, 4) * hi(ff, 0.5) * (0.7 + 0.3 * hi(f.bass + f.sub, 0.5)) * beat,
    'Drum & Bass': inRange(b, 164, 180, 4) * notFF * (0.45 * hi(f.backbeat, 0.35) + 0.3 * hi(f.hatDensity, 0.5) + 0.25 * subby) * beat,
    Dubstep: inRange(b, 136, 150, 4) * notFF * (0.55 * hi(f.halftime, 0.35) + 0.45 * subby) * lo(f.hatRoll, 0.5) * beat,
    'UK Garage': inRange(b, 122, 138, 5) * (0.4 * hi(f.swing, 0.12) + 0.35 * hi(f.twoStep, 0.35) + 0.25 * hi(f.backbeat, 0.3)) * lo(ff, 0.8) * beat,
    Disco: inRange(b, 110, 126, 5) * (0.45 * hi(ff, 0.5) + 0.3 * hi(f.offbeatHat, 0.4) + 0.25 * lo(f.sub, 0.15)) * beat * (f.minor ? 0.8 : 1) * bright,
    'Afro House': inRange(b, 118, 124, 3) * (0.45 * hi(ff, 0.5) + 0.35 * hi(f.hatDensity, 0.65) + 0.2 * hi(f.swing, 0.1)) * beat,
    Trap: slow(130, 160) * notFF * (0.35 * hi(f.halftime, 0.35) + 0.35 * hi(f.hatRoll, 0.35) + 0.3 * subby) * beat,
    'Hip Hop': slow(80, 100) * notFF * (0.4 * hi(f.backbeat, 0.35) + 0.2 * hi(f.swing, 0.12) + 0.2 * vocal + 0.2 * lo(f.hatRoll, 0.4)) * beat,
    // R&B is smooth: few busy hats, no shuffle running underneath
    'R&B': slow(60, 80) * notFF * (0.35 * hi(f.backbeat + f.halftime, 0.35) + 0.35 * vocal + 0.3 * lo(f.density, 4)) * beat * (0.4 + 0.6 * lo(f.hatDensity, 0.6)) * lo(f.swing, 0.25),
    Pop: inRange(b, 95, 130, 6) * (0.35 * hi(f.backbeat, 0.35) + 0.35 * vocal + 0.3 * bright) * (f.minor ? 0.85 : 1) * beat * (1 - 0.5 * hi(ff, 0.6)),
    Reggaeton: slow(86, 100) * hi(f.dembow, 0.3) * beat,
    'Lo-fi': slow(70, 92) * notFF * (0.35 * hi(f.swing, 0.12) + 0.35 * dark + 0.3 * lo(f.high, 0.08)) * beat,
    Ambient: lo(f.pulse - 0.1, 0.4) * lo(f.density, 3) * (0.6 + 0.4 * lo(f.high, 0.12)),
  } satisfies Record<Genre, number>;
  return s;
}

/** close sub-styles: when the analyser can't tell them apart it says the family instead */
const FAMILY: Partial<Record<Genre, Genre>> = { House: 'House', 'Deep House': 'House', 'Tech House': 'House', 'Afro House': 'House', 'Hip Hop': 'Hip Hop', 'Lo-fi': 'Hip Hop' };

const sureness = (best: number, next: number) => (best > 0 ? clamp01(((best - next) / best) * 2) * clamp01(best * 2) : 0);

export function classifyGenre(f: GenreFeatures): GenreGuess {
  const scores = genreScores(f);
  const ranked = (Object.entries(scores) as [Genre, number][]).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  const confidence = sureness(best[1], second[1]);
  const fam = FAMILY[best[0]];
  if (confidence < 0.3 && fam && FAMILY[second[0]] === fam) {
    // "House" for sure beats "Deep House, maybe Afro House"
    const outside = ranked.find(([g]) => FAMILY[g] !== fam);
    return { genre: fam, runnerUp: best[0] === fam ? second[0] : best[0], confidence: sureness(best[1], outside ? outside[1] : 0), features: f };
  }
  return { genre: best[0], runnerUp: second[0], confidence, features: f };
}

export function detectGenre(mono: Float32Array, sampleRate: number, bpm: number, firstBeat: number, minor: boolean): GenreGuess {
  return classifyGenre(genreFeatures(mono, sampleRate, bpm, firstBeat, minor));
}
