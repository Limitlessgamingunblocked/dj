/*
 * Tempo and beat-grid estimation.
 *
 *  1. Spectral-flux onset envelope (~90 frames/s) → autocorrelation scored at
 *     beat, 2-beat and bar lags with a mild prior toward dance tempos.
 *  2. Fine tempo: fold a 1 kHz kick-weighted novelty curve at candidate
 *     periods and keep the tempo whose folded histogram is sharpest. Over a
 *     whole track this resolves the tempo to ~0.01 BPM.
 *  3. Grid phase from the folded histogram, anchored on the first strong beat.
 */
import { Biquad, decimate, magnitudes } from './fft';

export interface TempoResult {
  bpm: number;
  firstBeat: number;
  confidence: number;
}

export function onsetEnvelope(mono: Float32Array, sr: number): { env: Float32Array; low: Float32Array; fps: number; lag: number } {
  const factor = Math.max(1, Math.round(sr / 11025));
  const x = decimate(mono, factor);
  const srd = sr / factor;
  const N = 1024;
  const hop = 128;
  const frames = Math.max(0, Math.floor((x.length - N) / hop));
  const env = new Float32Array(frames);
  const lowEnv = new Float32Array(frames);
  const lowBin = Math.floor((3500 / srd) * N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const mag = new Float32Array(N / 2);
  let prev = new Float32Array(N / 2);
  let cur = new Float32Array(N / 2);
  const maxBin = Math.min(N / 2, Math.floor((6000 / srd) * N));
  for (let f = 0; f < frames; f++) {
    magnitudes(x, f * hop, N, re, im, mag);
    let flux = 0;
    let low = 0;
    for (let k = 1; k < maxBin; k++) {
      const v = Math.log1p(100 * mag[k]);
      cur[k] = v;
      const d = v - prev[k];
      if (d > 0) {
        flux += k < 12 ? d * 1.5 : d; // emphasise the kick region a little
        if (k < lowBin) low += d;
      }
    }
    env[f] = flux;
    lowEnv[f] = low;
    const t = prev;
    prev = cur;
    cur = t;
  }
  // remove the local mean and half-wave rectify
  const fps = srd / hop;
  const w = Math.round(fps * 0.4);
  const detrend = (src: Float32Array) => {
    const out = new Float32Array(frames);
    let acc = 0;
    for (let i = 0; i < frames; i++) {
      acc += src[i];
      if (i >= 2 * w) acc -= src[i - 2 * w];
      const center = i - w;
      if (center >= 0) out[center] = Math.max(0, src[center] - acc / Math.min(i + 1, 2 * w));
    }
    return out;
  };
  const out = detrend(env);
  const low = detrend(lowEnv);
  // frames are labelled by window start; flux peaks as an onset crosses the
  // steep part of the Hann window at ~3/4 of its length
  return { env: out, low, fps, lag: (0.75 * N) / hop };
}

export function kickNovelty(mono: Float32Array, sr: number): Float32Array {
  // low band energy envelope (one-pole, ~4 ms) sampled every millisecond → log → rising slope
  const lp1 = new Biquad('lp', 160, sr);
  const lp2 = new Biquad('lp', 160, sr);
  const hop = sr / 1000;
  const n = Math.floor(mono.length / hop);
  const energy = new Float32Array(n);
  const a = Math.exp(-1 / (0.004 * sr));
  let env = 0;
  let j = 0;
  let next = hop;
  for (let i = 0; i < mono.length && j < n; i++) {
    const v = lp2.run(lp1.run(mono[i]));
    env = env * a + v * v * (1 - a);
    if (i + 1 >= next) {
      energy[j++] = Math.log(1e-9 + env);
      next += hop;
    }
  }
  const nov = new Float32Array(n);
  const shift = 5; // compensate filter + envelope delay (ms)
  for (let i = 6; i < n; i++) {
    const d = energy[i] - energy[i - 6];
    if (d > 0.4) nov[i - shift] = d;
  }
  return nov;
}

function interp(a: Float32Array, x: number): number {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= a.length) return 0;
  const t = x - i;
  return a[i] * (1 - t) + a[i + 1] * t;
}

function coarseTempo(env: Float32Array, fps: number): number {
  const maxLag = Math.ceil((fps * 60) / 60) * 4 + 4;
  const n = env.length;
  const acf = new Float32Array(maxLag + 2);
  for (let l = 1; l <= maxLag + 1; l++) {
    let s = 0;
    for (let i = 0; i + l < n; i++) s += env[i] * env[i + l];
    acf[l] = s / (n - l);
  }
  let best = 120;
  let bestScore = -Infinity;
  for (let bpm = 70; bpm <= 180; bpm += 0.05) {
    const lag = (fps * 60) / bpm;
    if (lag * 4 > maxLag) continue;
    const score = interp(acf, lag) + 0.5 * interp(acf, lag * 2) + 0.35 * interp(acf, lag * 4);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 124) / 0.55, 2));
    const s = score * (0.6 + 0.4 * prior);
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  return best;
}

interface Sparse {
  idx: Float64Array;
  val: Float32Array;
}

function sparsify(nov: Float32Array, threshold: number): Sparse {
  let n = 0;
  for (let i = 0; i < nov.length; i++) if (nov[i] > threshold) n++;
  const idx = new Float64Array(n);
  const val = new Float32Array(n);
  for (let i = 0, j = 0; i < nov.length; i++) {
    if (nov[i] > threshold) {
      idx[j] = i;
      val[j++] = nov[i];
    }
  }
  return { idx, val };
}

/** Sharpness of the novelty curve folded at the beat period of `bpm`. */
function foldScore(sp: Sparse, bpm: number, bins = 64): number {
  const period = 60000 / bpm; // in ms samples
  const hist = new Float32Array(bins);
  let total = 0;
  const scale = bins / period;
  const { idx, val } = sp;
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    hist[Math.floor((i % period) * scale) % bins] += val[j];
    total += val[j];
  }
  let best = 0;
  for (let b = 0; b < bins; b++) {
    const s = hist[(b + bins - 1) % bins] * 0.5 + hist[b] + hist[(b + 1) % bins] * 0.5;
    if (s > best) best = s;
  }
  return total > 0 ? best / total : 0;
}

export function detectTempo(mono: Float32Array, sr: number): TempoResult {
  const duration = mono.length / sr;
  if (duration < 4) return { bpm: 120, firstBeat: 0, confidence: 0 };
  const { env, low, fps, lag } = onsetEnvelope(mono, sr);
  let bpm = coarseTempo(env, fps);

  // 1 kHz novelty: kick band plus upsampled broadband flux
  const kick = kickNovelty(mono, sr);
  let kmax = 0;
  for (let i = 0; i < kick.length; i++) kmax = Math.max(kmax, kick[i]);
  let emax = 0;
  for (let i = 0; i < env.length; i++) emax = Math.max(emax, env[i]);
  const nov = new Float32Array(kick.length);
  for (let i = 0; i < nov.length; i++) {
    const k = kmax > 0 ? kick[i] / kmax : 0;
    const e = emax > 0 ? interp(env, (i / 1000) * fps - lag) / emax : 0;
    nov[i] = k + 0.5 * e;
  }

  const sp = sparsify(nov, 0.04);
  // fine search around the coarse estimate, then a finer pass
  let best = bpm;
  let bestScore = -1;
  for (let b = bpm - 2.5; b <= bpm + 2.5; b += 0.02) {
    const score = foldScore(sp, b);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  bpm = best;
  for (let b = best - 0.03; b <= best + 0.03; b += 0.0025) {
    const score = foldScore(sp, b, 128);
    if (score > bestScore) {
      bestScore = score;
      bpm = b;
    }
  }
  // most dance music is produced at an integer tempo
  const rounded = Math.round(bpm);
  if (Math.abs(bpm - rounded) < 0.08) {
    const a = foldScore(sp, rounded, 128);
    const b = foldScore(sp, bpm, 128);
    if (a >= b * 0.97) bpm = rounded;
  } else {
    bpm = Math.round(bpm * 100) / 100;
  }
  if (bpm < 78) bpm *= 2;
  if (bpm > 182) bpm /= 2;

  // phase: fold kick novelty plus low-mid flux (kick, snare, clap; not hats)
  // over one bar at 1 ms resolution. The beat phase is chosen with a concave
  // score over the four beat positions, which prefers energy on every beat
  // (kick/snare backbeat) over one loud syncopated hit.
  const period = 60000 / bpm;
  const barPeriod = period * 4;
  const barBins = Math.max(4, Math.round(barPeriod));
  const bar = new Float32Array(barBins);
  let lmax = 0;
  for (let i = 0; i < low.length; i++) lmax = Math.max(lmax, low[i]);
  for (let i = 0; i < kick.length; i++) {
    const lm = lmax > 0 ? interp(low, (i / 1000) * fps - lag) / lmax : 0;
    const k = kmax > 0 ? kick[i] / kmax : 0;
    if (k === 0 && lm <= 0.02) continue;
    bar[Math.floor(((i % barPeriod) / barPeriod) * barBins) % barBins] += k + lm;
  }
  const smooth = new Float32Array(barBins);
  for (let b = 0; b < barBins; b++) {
    let acc = 0;
    for (let k = -4; k <= 4; k++) acc += bar[(b + k + barBins) % barBins] * (1 - Math.abs(k) / 5);
    smooth[b] = acc;
  }
  const beatBins = barBins / 4;
  let phase = 0;
  let pbest = -Infinity;
  for (let b = 0; b < Math.ceil(beatBins); b++) {
    let sc = 0;
    for (let k = 0; k < 4; k++) sc += Math.sqrt(smooth[Math.round(b + k * beatBins) % barBins]);
    if (sc > pbest) {
      pbest = sc;
      phase = b;
    }
  }
  const bins = barBins / 4;
  const beatSec = 60 / bpm;
  let first = ((phase / bins) * period) / 1000;
  first = first % beatSec;

  // anchor the grid on the first strong beat (treated as a downbeat)
  const strengths: number[] = [];
  for (let t = first; t < duration; t += beatSec) {
    const c = Math.round(t * 1000);
    let m = 0;
    for (let k = c - 20; k <= c + 20; k++) if (k >= 0 && k < kick.length) m = Math.max(m, kick[k]);
    strengths.push(m);
  }
  const sorted = [...strengths].sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.75)] || 0;
  const firstStrong = strengths.findIndex((s) => s > ref * 0.35);
  if (firstStrong > 0) first += firstStrong * beatSec;

  const confidence = Math.min(1, Math.max(0, (bestScore - 1 / 64) * 6));
  return { bpm, firstBeat: first, confidence };
}
