/*
 * Finding the arrangement of your own tracks: where the intro ends, the
 * breakdowns, the builds into them, the drops and the outro. Dance music is
 * built in 8-bar phrases and its sections are told apart mostly by the low end
 * (the kick and the bass drop out for a breakdown and slam back on the drop),
 * so this reads the analysis waveform's low band bar by bar, on the beat grid,
 * and marks phrase boundaries where it changes.
 *
 * It needs nothing new from the analysis, so tracks already in the library get
 * markers without being analysed again. The results are cached per analysis.
 */
import type { TrackAnalysis } from '../core/types';
import type { Section, SectionKind } from './tracks';

const PHRASE = 8;
const cache = new WeakMap<TrackAnalysis, Section[] | null>();

/** the sections of an analysed track (null when there's too little to go on) */
export function detectSections(a: TrackAnalysis): Section[] | null {
  if (cache.has(a)) return cache.get(a)!;
  const s = find(a);
  cache.set(a, s);
  return s;
}

/** per-bar low-band and full-band level, 0..1, from the first downbeat */
export function barLevels(a: TrackAnalysis): { low: number[]; full: number[]; bar: number } {
  const bar = (60 / a.bpm) * 4;
  const w = a.waveform;
  const pts = w.length / 4;
  const low: number[] = [];
  const full: number[] = [];
  for (let t = Math.max(0, a.firstBeat); t + bar * 0.5 < a.duration; t += bar) {
    const i0 = Math.floor(t * a.waveRate);
    const i1 = Math.min(pts, Math.floor((t + bar) * a.waveRate));
    let l = 0;
    let f = 0;
    let n = 0;
    for (let i = i0; i < i1; i++) {
      l += w[i * 4];
      f += w[i * 4 + 3];
      n++;
    }
    low.push(n ? l / n / 255 : 0);
    full.push(n ? f / n / 255 : 0);
  }
  return { low, full, bar };
}

function find(a: TrackAnalysis): Section[] | null {
  if (!a.bpm || a.duration < 45 || !a.waveform?.length) return null;
  const { low, full, bar } = barLevels(a);
  const bars = low.length;
  if (bars < PHRASE * 3) return null;
  // a phrase is "full" when its low end is near the track's loud level
  const nP = Math.ceil(bars / PHRASE);
  const pLow: number[] = [];
  const pFull: number[] = [];
  for (let p = 0; p < nP; p++) {
    const sl = low.slice(p * PHRASE, (p + 1) * PHRASE);
    const sf = full.slice(p * PHRASE, (p + 1) * PHRASE);
    pLow.push(sl.reduce((x, y) => x + y, 0) / sl.length);
    pFull.push(sf.reduce((x, y) => x + y, 0) / sf.length);
  }
  const sorted = [...pLow].sort((x, y) => x - y);
  const loud = sorted[Math.floor(sorted.length * 0.8)];
  if (loud <= 0.02) return null;
  const strong = pLow.map((l) => l >= loud * 0.72);
  const weak = pLow.map((l) => l < loud * 0.5);

  const out: { kind: SectionKind; bar: number }[] = [{ kind: 'intro', bar: 0 }];
  // the groove starts with the first strong phrase (an intro is at most 32 bars here)
  const g = Math.min(strong.indexOf(true) < 0 ? 0 : strong.indexOf(true), 4);
  if (g > 0) out.push({ kind: 'groove', bar: g * PHRASE });
  else out.push({ kind: 'groove', bar: Math.min(PHRASE * 2, bars - PHRASE) });
  // the outro: after the last strong phrase (or the last 16 bars when the track stays full)
  let lastStrong = strong.lastIndexOf(true);
  if (lastStrong < 0) lastStrong = nP - 1;
  const outroP = Math.min(Math.max(lastStrong + 1, g + 2), nP - 1);
  // (on a phrase line: at most the last 16 bars when the track stays full to the end)
  const outroBar = Math.min(outroP * PHRASE, Math.max(Math.floor((bars - PHRASE * 2) / PHRASE) * PHRASE, (g + 2) * PHRASE));
  // breakdowns: weak runs between the groove and the outro; each one's end is a drop
  let p = Math.max(g, 1) + 1;
  while (p < outroP) {
    if (!weak[p]) {
      p++;
      continue;
    }
    let q = p;
    while (q < outroP && !strong[q]) q++;
    // a drop needs a strong phrase after the breakdown
    if (q < outroP && strong[q]) {
      const start = p * PHRASE;
      const dropBar = refineDrop(low, q * PHRASE, loud);
      const len = dropBar - start;
      out.push({ kind: 'breakdown', bar: start });
      // the build: the second half of a long breakdown, or the last 4 bars of a short one
      out.push({ kind: 'build', bar: dropBar - (len >= 16 ? Math.floor(len / 2 / 4) * 4 : Math.min(4, Math.max(1, len - 1))) });
      out.push({ kind: 'drop', bar: dropBar });
    }
    p = q + 1;
  }
  out.push({ kind: 'outro', bar: outroBar });
  // in order, no duplicates or zero-length sections
  const clean: { kind: SectionKind; bar: number }[] = [];
  for (const s of out.sort((x, y) => x.bar - y.bar)) {
    const prev = clean[clean.length - 1];
    if (prev && s.bar <= prev.bar) {
      if (s.kind !== 'groove') clean[clean.length - 1] = { kind: s.kind, bar: prev.bar };
      continue;
    }
    clean.push(s);
  }
  return clean.map((s) => ({ kind: s.kind, bar: s.bar, t: Math.max(0, a.firstBeat) + s.bar * bar }));
}

/**
 * The drop lands on the first strong bar near the phrase line (tracks don't
 * always line up with the grid's phrases); search ±4 bars, preferring the line.
 */
function refineDrop(low: number[], guess: number, loud: number): number {
  for (const d of [0, -4, 4, -2, 2]) {
    const b = guess + d;
    if (b < 1 || b >= low.length) continue;
    if (low[b] >= loud * 0.72 && low[b - 1] < loud * 0.6) return b;
  }
  return guess;
}
