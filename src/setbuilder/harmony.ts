/*
 * Mixing relationships for the set builder: Camelot-wheel key relations with a
 * 0–1 score, key-shift fixes for clashes, and tempo matching that allows
 * half/double time.
 */
import { makeKey } from '../analysis/keys';
import type { KeyInfo } from '../core/types';

export type KeyRelationKind = 'same' | 'relative' | 'adjacent' | 'diagonal' | 'boost' | 'clash' | 'unknown';

export interface KeyRelation {
  kind: KeyRelationKind;
  /** 0–1: how smoothly the two keys mix */
  score: number;
  label: string;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

function camelot(k: KeyInfo): { n: number; minor: boolean } {
  return { n: parseInt(k.camelot, 10), minor: k.camelot.endsWith('A') };
}

/** How the key of `to` follows the key of `from` on the Camelot wheel. */
export function keyRelation(from: KeyInfo | null | undefined, to: KeyInfo | null | undefined): KeyRelation {
  if (!from || !to) return { kind: 'unknown', score: 0.5, label: 'Key unknown' };
  const a = camelot(from);
  const b = camelot(to);
  const d = mod(b.n - a.n, 12);
  if (a.minor === b.minor) {
    if (d === 0) return { kind: 'same', score: 1, label: 'Same key' };
    if (d === 1) return { kind: 'adjacent', score: 0.92, label: '+1 on the wheel (lift)' };
    if (d === 11) return { kind: 'adjacent', score: 0.9, label: '−1 on the wheel (settle)' };
    if (d === 7) return { kind: 'boost', score: 0.62, label: 'Energy boost (+1 semitone)' };
    if (d === 2) return { kind: 'boost', score: 0.58, label: 'Energy boost (+2 on the wheel)' };
  } else {
    if (d === 0) return { kind: 'relative', score: 0.9, label: `Relative ${b.minor ? 'minor' : 'major'}` };
    if (d === 1 || d === 11) return { kind: 'diagonal', score: 0.6, label: 'Diagonal mood change' };
  }
  return { kind: 'clash', score: 0.1, label: 'Key clash' };
}

/**
 * Smallest key shift (in semitones, ±2 at most) for the incoming track that
 * turns a weak key relation into a smooth one, or null when none helps.
 */
export function keyShiftFix(from: KeyInfo | null | undefined, to: KeyInfo | null | undefined): { semis: number; key: KeyInfo } | null {
  if (!from || !to) return null;
  if (keyRelation(from, to).score >= 0.85) return null;
  for (const s of [1, -1, 2, -2]) {
    const k = makeKey(to.root + s, to.minor);
    if (keyRelation(from, k).score >= 0.88) return { semis: s, key: k };
  }
  return null;
}

export interface TempoMatch {
  /** tempo of the incoming track as it will be mixed (its own, doubled or halved) */
  effective: number;
  /** pitch change on the incoming deck to meet the outgoing tempo, in percent */
  pct: number;
  mode: 'direct' | 'double' | 'half';
}

/** Tempo change needed to beat-match `to` against `from`, allowing half/double time. */
export function tempoMatch(from: number, to: number): TempoMatch {
  const opts: [number, TempoMatch['mode']][] = [
    [to, 'direct'],
    [to * 2, 'double'],
    [to / 2, 'half'],
  ];
  let best = opts[0];
  for (const o of opts) if (Math.abs(Math.log(from / o[0])) < Math.abs(Math.log(from / best[0]))) best = o;
  return { effective: best[0], pct: (from / best[0] - 1) * 100, mode: best[1] };
}

/** 1 when the tempos lock within 1.5 %, falling to 0 at `tolerancePct`. */
export function tempoScore(from: number, to: number, tolerancePct: number): number {
  const d = Math.abs(tempoMatch(from, to).pct);
  if (d <= 1.5) return 1;
  return Math.max(0, 1 - (d - 1.5) / Math.max(0.5, tolerancePct - 1.5));
}
