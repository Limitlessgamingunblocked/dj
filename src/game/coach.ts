/*
 * The next-track coach (Chill and Club assists): one track from your crate that
 * would mix well next. In key with what's playing, close in tempo, and near
 * the energy the slot wants a few minutes from now; never one played tonight.
 *
 * Pure: the app hands it the crate and what's on the decks.
 */
import { compatibility } from '../analysis/keys';
import type { KeyInfo } from '../core/types';

export interface CoachTrack {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: KeyInfo | null;
  /** 1..10 */
  energy: number;
}

export interface Suggestion {
  id: string;
  title: string;
  artist: string;
  /** "in key · 124 BPM · energy 6" */
  why: string;
}

/** tempo distance, folding double and half time */
function tempoGap(a: number, b: number): number {
  let r = a / Math.max(1, b);
  if (r > 1.5) r /= 2;
  else if (r < 0.75) r *= 2;
  return Math.abs(r - 1);
}

export function suggestNext(o: { playing: { bpm: number; key: KeyInfo | null } | null; want: number; tracks: CoachTrack[]; exclude: Set<string> }): Suggestion | null {
  let best: { t: CoachTrack; score: number; inKey: boolean } | null = null;
  for (const t of o.tracks) {
    if (o.exclude.has(t.id) || !t.bpm) continue;
    let score = -Math.abs(t.energy / 10 - o.want) * 5;
    let inKey = false;
    if (o.playing) {
      const c = t.key && o.playing.key ? compatibility(t.key, o.playing.key) : undefined;
      inKey = c === 'same' || c === 'harmonic';
      score += c === undefined ? 0 : c === null ? -2.5 : inKey ? 2.5 : 1;
      const gap = tempoGap(t.bpm, o.playing.bpm);
      score += gap <= 0.03 ? 2 : gap <= 0.06 ? 0.8 : -3;
    }
    if (!best || score > best.score) best = { t, score, inKey };
  }
  if (!best) return null;
  const t = best.t;
  const why = [best.inKey ? 'in key' : null, `${Math.round(t.bpm)} BPM`, `energy ${t.energy}`].filter(Boolean).join(' · ');
  return { id: t.id, title: t.title, artist: t.artist, why };
}
