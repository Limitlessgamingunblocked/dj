/*
 * Key detection: long-term chromagram (log-frequency mapping of a 4096-point
 * spectrum between 55 Hz and 2 kHz, per-frame normalised) correlated with
 * Krumhansl–Kessler major/minor profiles for all 24 keys.
 */
import type { KeyInfo } from '../core/types';
import { decimate, magnitudes } from './fft';
import { makeKey } from './keys';

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function chromagram(mono: Float32Array, sr: number): number[] {
  const factor = Math.max(1, Math.round(sr / 5512.5));
  const x = decimate(mono, factor);
  const srd = sr / factor;
  const N = 4096;
  const hop = 2048;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const mag = new Float32Array(N / 2);
  // precompute bin → pitch class weights
  const binPc: number[] = [];
  const binW: number[] = [];
  const bins: number[] = [];
  for (let k = 1; k < N / 2; k++) {
    const f = (k * srd) / N;
    if (f < 55 || f > 2000) continue;
    const p = 69 + 12 * Math.log2(f / 440);
    const r = Math.round(p);
    const w = Math.max(0, 1 - 2.2 * Math.abs(p - r));
    if (w <= 0) continue;
    bins.push(k);
    binPc.push(((r % 12) + 12) % 12);
    binW.push(w * (f < 110 ? 0.6 : 1));
  }
  const total = new Array(12).fill(0);
  const frames = Math.floor((x.length - N) / hop);
  const frameEnergy: number[] = [];
  const frameChroma: number[][] = [];
  for (let f = 0; f < frames; f++) {
    magnitudes(x, f * hop, N, re, im, mag);
    const c = new Array(12).fill(0);
    let e = 0;
    for (let j = 0; j < bins.length; j++) {
      const m = mag[bins[j]];
      c[binPc[j]] += binW[j] * Math.sqrt(m);
      e += m * m;
    }
    frameEnergy.push(e);
    frameChroma.push(c);
  }
  const sortedE = [...frameEnergy].sort((a, b) => a - b);
  const gate = sortedE[Math.floor(sortedE.length * 0.2)] ?? 0;
  for (let f = 0; f < frameChroma.length; f++) {
    if (frameEnergy[f] <= gate) continue;
    const c = frameChroma[f];
    const mx = Math.max(...c);
    if (mx <= 0) continue;
    for (let i = 0; i < 12; i++) total[i] += c[i] / mx;
  }
  return total;
}

export function detectKey(mono: Float32Array, sr: number): KeyInfo | null {
  if (mono.length < sr * 5) return null;
  const chroma = chromagram(mono, sr);
  if (chroma.every((v) => v === 0)) return null;
  const scores: { root: number; minor: boolean; r: number }[] = [];
  for (let root = 0; root < 12; root++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - root + 12) % 12]);
    scores.push({ root, minor: false, r: pearson(chroma, rot(MAJOR)) });
    scores.push({ root, minor: true, r: pearson(chroma, rot(MINOR)) });
  }
  scores.sort((a, b) => b.r - a.r);
  const best = scores[0];
  const conf = Math.max(0, Math.min(1, (best.r - scores[1].r) * 8 + best.r * 0.3));
  return makeKey(best.root, best.minor, conf);
}
