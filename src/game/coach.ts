/*
 * The next-track coach: tracks from your crate that would mix well next. In
 * key with what's playing, close in tempo, near the energy wanted a few
 * minutes from now (a gig's slot, or in free play a touch above what's on, so
 * the night keeps building), the same genre if it can; never one played
 * tonight. With nothing playing it picks an opener: a warm-up track.
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
  genre?: string;
}

export interface Suggestion {
  id: string;
  title: string;
  artist: string;
  /** "in key · 124 BPM · energy 6 · lifts it" */
  why: string;
}

export interface Playing {
  bpm: number;
  key: KeyInfo | null;
  /** 0..1, when known: the suggestion says whether it lifts the energy, keeps it or brings it down */
  energy?: number;
  genre?: string;
}

/** tempo distance, folding double and half time */
function tempoGap(a: number, b: number): number {
  let r = a / Math.max(1, b);
  if (r > 1.5) r /= 2;
  else if (r < 0.75) r *= 2;
  return Math.abs(r - 1);
}

/** the energy (0..1) the next track should bring outside a gig: a step above what's on, or a warm-up opener */
export function freeWant(playingEnergy: number | null): number {
  if (playingEnergy === null) return 0.45;
  return Math.min(0.95, playingEnergy + 0.06);
}

/** the best `n` next tracks, best first */
export function rankNext(o: { playing: Playing | null; want: number; tracks: CoachTrack[]; exclude: Set<string>; n?: number }): Suggestion[] {
  const scored: { t: CoachTrack; score: number; inKey: boolean }[] = [];
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
      if (o.playing.genre && t.genre === o.playing.genre) score += 0.6;
    }
    scored.push({ t, score, inKey });
  }
  // best first; ties keep the crate's order
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, o.n ?? 3).map(({ t, inKey }) => {
    const mood = o.playing?.energy === undefined ? (o.playing ? null : 'a warm opener') : t.energy / 10 - o.playing.energy > 0.08 ? 'lifts it' : o.playing.energy - t.energy / 10 > 0.08 ? 'brings it down' : 'keeps it';
    const why = [inKey ? 'in key' : null, `${Math.round(t.bpm)} BPM`, `energy ${t.energy}`, mood].filter(Boolean).join(' · ');
    return { id: t.id, title: t.title, artist: t.artist, why };
  });
}

export function suggestNext(o: { playing: Playing | null; want: number; tracks: CoachTrack[]; exclude: Set<string> }): Suggestion | null {
  return rankNext({ ...o, n: 1 })[0] ?? null;
}
