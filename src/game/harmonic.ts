/*
 * The harmonic coach: where each key sits on the Camelot wheel, and which of
 * your tracks mix in key with what's playing (same key, a step round the
 * wheel, the relative major or minor, an energy boost), ranked with tempo.
 */
import { camelotNumber, makeKey } from '../analysis/keys';
import type { KeyInfo, LibraryTrack } from '../core/types';
import { keyRelation, tempoMatch, type KeyRelationKind } from '../setbuilder/harmony';

/** the key at a spot on the wheel (1..12, inner minor ring A or outer major ring B) */
export function keyAt(n: number, minor: boolean): KeyInfo {
  for (let r = 0; r < 12; r++) if (camelotNumber(r, minor) === n) return makeKey(r, minor);
  return makeKey(0, minor);
}

/** a key's spot on the wheel */
export function wheelSpot(k: KeyInfo): { n: number; minor: boolean } {
  return { n: parseInt(k.camelot, 10), minor: k.camelot.endsWith('A') };
}

export interface HarmonicPick {
  id: string;
  title: string;
  artist: string;
  key: KeyInfo;
  bpm: number;
  kind: KeyRelationKind;
  label: string;
  /** 0..1: key first, then tempo */
  score: number;
  /** the pitch change to meet the tempo, percent */
  pct: number;
}

/** your tracks that mix with this key and tempo, best first (clashes left out) */
export function harmonicPicks(key: KeyInfo | null, bpm: number, tracks: LibraryTrack[], exclude: string[] = [], max = 24): HarmonicPick[] {
  if (!key) return [];
  const out: HarmonicPick[] = [];
  for (const t of tracks) {
    const k = t.analysis?.key;
    if (!k || exclude.includes(t.id) || t.status === 'error') continue;
    const rel = keyRelation(key, k);
    if (rel.kind === 'clash' || rel.kind === 'unknown') continue;
    const tb = t.analysis?.bpm ?? 0;
    const tm = bpm > 0 && tb > 0 ? tempoMatch(bpm, tb) : { pct: 0 };
    const tempo = bpm > 0 && tb > 0 ? Math.max(0, 1 - Math.abs(tm.pct) / 8) : 0.5;
    out.push({ id: t.id, title: t.meta.title, artist: t.meta.artist, key: k, bpm: tb, kind: rel.kind, label: rel.label, score: rel.score * 0.72 + tempo * 0.28, pct: tm.pct });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/** the spots on the wheel that mix with a key, and how well (for lighting the wheel) */
export function wheelGlow(key: KeyInfo | null): Map<string, number> {
  const m = new Map<string, number>();
  if (!key) return m;
  for (let n = 1; n <= 12; n++)
    for (const minor of [true, false]) {
      const rel = keyRelation(key, keyAt(n, minor));
      if (rel.kind !== 'clash') m.set(`${n}${minor ? 'A' : 'B'}`, rel.score);
    }
  return m;
}
