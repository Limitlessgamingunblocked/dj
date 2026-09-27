/*
 * Vocal activity from the decoded audio, for aligning lyrics:
 *   – mid (L+R) and side (L−R) are analysed separately at ~11 kHz; lead
 *     vocals sit in the centre, so side energy is subtracted
 *   – only tonal energy (spectral peaks above the local floor) in the voice
 *     band (250 Hz–3.5 kHz) counts, which ignores most drums and noise
 *   – the result is a 0–1 activity curve and a list of syllable-like onsets
 * Plain-text lyrics are then laid over the vocal-active time in proportion
 * to their syllables; line-timed lyrics get their words snapped to onsets.
 * It is a heuristic: dense pads or leads in the voice band can fool it, so
 * the editor also has tap-sync and an offset control.
 */
import type { PcmData } from '../core/types';
import { magnitudes } from '../analysis/fft';
import { spreadWords, syllables, type LyricLine, type LyricWord } from './lyrics';

export interface VocalMap {
  /** frames per second */
  rate: number;
  activity: Float32Array;
  onsets: number[];
  duration: number;
}

const N = 1024;
const HOP = 256;

function downmix(pcm: PcmData, factor: number): { mid: Float32Array; side: Float32Array } {
  const L = pcm.channels[0];
  const R = pcm.channels[1] ?? L;
  const n = Math.floor(L.length / factor);
  const mid = new Float32Array(n);
  const side = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    let s = 0;
    const o = i * factor;
    for (let k = 0; k < factor; k++) {
      m += L[o + k] + R[o + k];
      s += L[o + k] - R[o + k];
    }
    mid[i] = m / (2 * factor);
    side[i] = s / (2 * factor);
  }
  return { mid, side };
}

/** Tonal energy per bin: magnitude above the local spectral mean. */
function tonal(mag: Float32Array, k0: number, k1: number, out: Float32Array): number {
  const W = 6;
  let sum = 0;
  for (let k = k0; k <= k1; k++) {
    let floor = 0;
    for (let j = k - W; j <= k + W; j++) floor += mag[j];
    floor /= 2 * W + 1;
    const v = Math.max(0, mag[k] - floor * 1.7);
    out[k] = v;
    sum += v;
  }
  return sum;
}

export async function analyzeVocals(pcm: PcmData, onProgress?: (f: number) => void): Promise<VocalMap> {
  const factor = Math.max(1, Math.round(pcm.sampleRate / 11025));
  const sr = pcm.sampleRate / factor;
  const { mid, side } = downmix(pcm, factor);
  const frames = Math.max(0, Math.floor((mid.length - N) / HOP));
  const rate = sr / HOP;
  const k0 = Math.max(8, Math.floor((250 / sr) * N));
  const k1 = Math.min(N / 2 - 8, Math.ceil((3500 / sr) * N));
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const magM = new Float32Array(N / 2);
  const magS = new Float32Array(N / 2);
  const tonM = new Float32Array(N / 2);
  const tonS = new Float32Array(N / 2);
  const prev = new Float32Array(N / 2);
  const energy = new Float32Array(frames);
  const flux = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    magnitudes(mid, f * HOP, N, re, im, magM);
    magnitudes(side, f * HOP, N, re, im, magS);
    tonal(magM, k0, k1, tonM);
    tonal(magS, k0, k1, tonS);
    let e = 0;
    let fl = 0;
    for (let k = k0; k <= k1; k++) {
      const v = Math.max(0, tonM[k] - 0.9 * tonS[k]);
      e += v;
      if (v > prev[k]) fl += v - prev[k];
      prev[k] = v;
    }
    energy[f] = e;
    flux[f] = fl;
    if (f % 600 === 599) {
      onProgress?.(f / frames);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  // normalise against the track's own spread
  const sorted = Array.from(energy).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.35)] ?? 0;
  const hi = sorted[Math.floor(sorted.length * 0.92)] ?? 1;
  const activity = new Float32Array(frames);
  const win = Math.max(1, Math.round(rate * 0.08));
  for (let f = 0; f < frames; f++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, f - win); j <= Math.min(frames - 1, f + win); j++) {
      s += energy[j];
      n++;
    }
    activity[f] = Math.min(1, Math.max(0, (s / n - lo) / Math.max(1e-9, hi - lo)));
  }
  // onsets: flux peaks above a moving threshold, at least 90 ms apart
  const onsets: number[] = [];
  const W = Math.round(rate * 0.5);
  let last = -1e9;
  for (let f = 1; f < frames - 1; f++) {
    if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1] || activity[f] < 0.3) continue;
    let m = 0;
    let n = 0;
    for (let j = Math.max(0, f - W); j <= Math.min(frames - 1, f + W); j++) {
      m += flux[j];
      n++;
    }
    if (flux[f] > (m / n) * 1.5 && f - last > rate * 0.09) {
      onsets.push(f / rate);
      last = f;
    }
  }
  onProgress?.(1);
  return { rate, activity, onsets, duration: frames / rate };
}

/** Lay untimed lines over the vocal-active parts of the track, in proportion to their syllables. */
export function alignToVocals(lines: { text: string; hook: boolean }[], v: VocalMap, trackDuration: number): LyricLine[] {
  const n = v.activity.length;
  // active = above threshold, with short gaps bridged
  const act = new Uint8Array(n);
  for (let f = 0; f < n; f++) act[f] = v.activity[f] > 0.45 ? 1 : 0;
  const bridge = Math.round(v.rate * 0.35);
  let lastOn = -1;
  for (let f = 0; f < n; f++) {
    if (act[f]) {
      if (lastOn >= 0 && f - lastOn <= bridge) for (let j = lastOn + 1; j < f; j++) act[j] = 1;
      lastOn = f;
    }
  }
  const cum = new Float32Array(n + 1);
  for (let f = 0; f < n; f++) cum[f + 1] = cum[f] + act[f] / v.rate;
  const total = cum[n];
  const weights = lines.map((l) => l.text.split(/\s+/).filter(Boolean).reduce((s, w) => s + syllables(w), 0) + 1.2);
  const W = weights.reduce((a, b) => a + b, 0);
  // too little vocal activity: spread over the middle of the track instead
  const sparse = total < 6;
  const span = sparse ? total || 1 : total;
  // active time → track time; a start lands on the next sung frame, an end on the last one
  const timeAt = (activeT: number, start: boolean): number => {
    if (sparse) return trackDuration * 0.12 + (activeT / span) * trackDuration * 0.76;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (start ? cum[mid] <= activeT + 1e-6 : cum[mid] < activeT - 1e-6) lo = mid + 1;
      else hi = mid;
    }
    return (start ? Math.max(0, lo - 1) : lo) / v.rate;
  };
  let acc = 0;
  const out: LyricLine[] = lines.map((l, i) => {
    const t = timeAt((acc / W) * span, true);
    const end = timeAt(((acc + weights[i] - 0.9) / W) * span, false);
    acc += weights[i];
    return { t, end: Math.max(t + 0.4, end), text: l.text, words: [], hook: l.hook };
  });
  for (const l of out) snapLine(l, v);
  return out;
}

/** Snap a line's words (estimated if missing) to the vocal onsets; the line starts with its first word. */
export function snapLine(l: LyricLine, v: VocalMap): void {
  l.words = snapWords(l.words.length ? l.words : spreadWords(l.text, l.t, l.end), v, l.end);
  if (l.words.length) l.t = Math.min(l.t, l.words[0].t);
}

/** Nudge estimated word starts onto nearby vocal onsets (±140 ms), keeping order. */
export function snapWords(words: LyricWord[], v: VocalMap, lineEnd: number): LyricWord[] {
  if (!v.onsets.length) return words;
  const out = words.map((w) => ({ ...w }));
  let oi = 0;
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    while (oi < v.onsets.length && v.onsets[oi] < w.t - 0.14) oi++;
    const cand = v.onsets[oi];
    if (cand !== undefined && Math.abs(cand - w.t) <= 0.14 && (i === 0 || cand > out[i - 1].t + 0.06)) {
      w.t = cand;
      oi++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i].end = Math.max(out[i].t + 0.08, Math.min(out[i + 1]?.t ?? lineEnd, out[i].end + 0.2));
  return out;
}
