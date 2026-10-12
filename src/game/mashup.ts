/*
 * The mashup and edit builder's plan (the rendering is media/mashup.ts):
 *   - a mashup: track B is the bed (its tempo, its intro and drop), track A
 *     is laid over it, tempo-matched. A's top (its vocals and melody) rides
 *     B's beat (B's drums and bass), then each gets its best section in full.
 *   - an edit: one track rearranged into an extended mix: a long intro, the
 *     build, the drop twice with the breakdown between, and the outro.
 * Tempo matching is by resampling, as a turntable's pitch does, so the key
 * moves with it; the plan says by how much, and how the keys then sit.
 * Every part starts on a bar of its track's beat grid.
 */
import { shiftKey } from '../analysis/keys';
import type { KeyInfo } from '../core/types';
import { keyRelation } from '../setbuilder/harmony';
import type { Section } from './tracks';

export interface MashSource {
  id: string;
  title: string;
  bpm: number;
  firstBeat: number;
  duration: number;
  key: KeyInfo | null;
  sections: Section[] | null;
}

/** full: the whole sound; beat: drums and bass (lows and highs); top: vocals and melody (the mids) */
export type Layer = 'full' | 'beat' | 'top';

export interface MashPart {
  src: 'A' | 'B';
  /** where it starts in the source, seconds (on a bar) */
  from: number;
  /** where it lands in the new track, in bars */
  at: number;
  bars: number;
  layer: Layer;
  /** a label for the timeline */
  label: string;
}

export interface MashPlan {
  kind: 'mashup' | 'edit';
  title: string;
  /** the new track's tempo */
  bpm: number;
  /** playback rates (1 = untouched) */
  rate: { A: number; B: number };
  /** A's key change from the rate, semitones */
  semis: number;
  keyA: KeyInfo | null;
  keyB: KeyInfo | null;
  /** how A (as played) sits with B */
  keyNote: string;
  keyScore: number;
  parts: MashPart[];
  bars: number;
  /** honest warnings (a big tempo jump, no beat grid) */
  warnings: string[];
}

const barLen = (bpm: number) => (60 / bpm) * 4;

/** the start of a bar on a track's grid, at or after t */
function onBar(s: MashSource, t: number): number {
  const L = barLen(s.bpm);
  const n = Math.max(0, Math.ceil((t - s.firstBeat) / L - 1e-6));
  return s.firstBeat + n * L;
}

/** how many whole bars a track has from t */
function barsFrom(s: MashSource, t: number): number {
  return Math.max(0, Math.floor((s.duration - t) / barLen(s.bpm)));
}

/** the track's best section: its drop (or the loudest-sounding part, a third of the way in) */
export function bestSection(s: MashSource): number {
  const drop = s.sections?.find((x) => x.kind === 'drop') ?? s.sections?.find((x) => x.kind === 'groove');
  return onBar(s, drop ? drop.t : s.duration * 0.35);
}

/** the section before the drop (a breakdown or build), for an edit's middle */
function breakSection(s: MashSource): number | null {
  const b = s.sections?.find((x) => x.kind === 'breakdown') ?? s.sections?.find((x) => x.kind === 'build');
  return b ? onBar(s, b.t) : null;
}

/** the rate that brings `from` to `to`, allowing half and double time, closest to 1 */
export function matchRate(from: number, to: number): number {
  if (!(from > 0) || !(to > 0)) return 1;
  const opts = [to / from, to / (from * 2), (to * 2) / from];
  return opts.reduce((a, b) => (Math.abs(Math.log(b)) < Math.abs(Math.log(a)) ? b : a));
}

/** a mashup of A over B */
export function planMashup(A: MashSource, B: MashSource): MashPlan {
  const warnings: string[] = [];
  const rate = matchRate(A.bpm, B.bpm);
  const semis = 12 * Math.log2(rate);
  if (Math.abs(rate - 1) > 0.12) warnings.push(`${A.title} has to move ${Math.round(Math.abs(rate - 1) * 100)}% to meet ${B.title}’s tempo: it’ll sound ${rate > 1 ? 'sped up' : 'slowed down'}.`);
  const keyA = A.key ? shiftKey(A.key, Math.round(semis)) : null;
  const rel = keyRelation(keyA, B.key);
  if (rel.kind === 'clash') warnings.push('The keys clash as they’ll play. Swap which track is the beat, or pick another pair.');
  const bBest = bestSection(B);
  const aBest = bestSection(A);
  const bIntro = onBar(B, B.firstBeat);
  // how much of each is there to use
  const bBars = barsFrom(B, bIntro);
  const fit = (want: number, have: number) => Math.max(4, Math.min(want, have));
  const parts: MashPart[] = [];
  let at = 0;
  const push = (p: Omit<MashPart, 'at'>) => {
    parts.push({ ...p, at });
    at += p.bars;
  };
  push({ src: 'B', from: bIntro, bars: fit(8, Math.min(bBars, 8)), layer: 'full', label: `${B.title}: intro` });
  // A's top over B's beat (B's groove just before its drop, or its intro onwards)
  const grooveB = onBar(B, Math.max(bIntro + barLen(B.bpm) * 8, bBest - barLen(B.bpm) * 16));
  push({ src: 'B', from: grooveB, bars: fit(16, barsFrom(B, grooveB)), layer: 'beat', label: `${B.title}: beat` });
  parts.push({ src: 'A', from: aBest, at: at - parts[parts.length - 1].bars, bars: parts[parts.length - 1].bars, layer: 'top', label: `${A.title}: vocals and melody` });
  push({ src: 'B', from: bBest, bars: fit(16, barsFrom(B, bBest)), layer: 'full', label: `${B.title}: drop` });
  push({ src: 'A', from: aBest, bars: fit(16, Math.floor(barsFrom(A, aBest) / rate)), layer: 'full', label: `${A.title}: its best part` });
  // out: A's top over B's beat again, then B alone
  const outB = onBar(B, bBest + barLen(B.bpm) * 16);
  const outBars = fit(8, barsFrom(B, outB));
  push({ src: 'B', from: outB, bars: outBars, layer: 'beat', label: `${B.title}: beat` });
  parts.push({ src: 'A', from: onBar(A, aBest + barLen(A.bpm) * 8), at: at - outBars, bars: outBars, layer: 'top', label: `${A.title}: vocals and melody` });
  if (!A.sections || !B.sections) warnings.push('Sections were estimated from the audio: listen back and adjust if a part lands oddly.');
  return { kind: 'mashup', title: `${A.title} × ${B.title}`, bpm: B.bpm, rate: { A: rate, B: 1 }, semis, keyA, keyB: B.key, keyNote: rel.label, keyScore: rel.score, parts, bars: at, warnings };
}

/** an extended edit of one track */
export function planEdit(A: MashSource): MashPlan {
  const L = barLen(A.bpm);
  const intro = onBar(A, A.firstBeat);
  const best = bestSection(A);
  const brk = breakSection(A) ?? onBar(A, Math.max(intro, best - L * 16));
  const total = barsFrom(A, intro);
  const fit = (want: number, from: number) => Math.max(4, Math.min(want, barsFrom(A, from)));
  const parts: MashPart[] = [];
  let at = 0;
  const push = (from: number, bars: number, label: string) => {
    parts.push({ src: 'A', from, at, bars, layer: 'full', label });
    at += bars;
  };
  // a long intro: the first 8 bars twice (DJs want room to mix in)
  push(intro, fit(8, intro), 'Intro');
  push(intro, fit(8, intro), 'Intro again');
  push(onBar(A, intro + L * 8), fit(Math.min(16, Math.max(4, Math.floor((best - intro) / L) - 8)), intro + L * 8), 'Groove');
  push(best, fit(16, best), 'Drop');
  push(brk, fit(8, brk), 'Breakdown');
  push(best, fit(16, best), 'Drop again');
  const out = onBar(A, Math.max(best + L * 16, A.duration - L * 16));
  push(out, fit(16, out), 'Outro');
  const warnings: string[] = [];
  if (total < 32) warnings.push('This track is short: the edit repeats a lot of it.');
  if (!A.sections) warnings.push('Sections were estimated from the audio.');
  return { kind: 'edit', title: `${A.title} (Extended Edit)`, bpm: A.bpm, rate: { A: 1, B: 1 }, semis: 0, keyA: A.key, keyB: null, keyNote: '', keyScore: 1, parts, bars: at, warnings };
}

/** the new track's length, seconds */
export function planSeconds(p: MashPlan): number {
  return p.bars * barLen(p.bpm);
}
