/*
 * Artist sound profiles. When an anchor names one of these artists, the
 * builder also matches their *sound* — tempo range, energy, genre words and,
 * for the built-in demos, the groove style they were synthesised in — so a
 * set can be built "in the style of" an artist whose records aren't in the
 * library. Profiles are Deckhouse's reading of each artist's typical club
 * sound, not official descriptions; they only steer track selection.
 */
import type { DemoSpec } from '../core/types';
import { clamp } from '../core/util';
import type { TrackProfile } from './profile';

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when `anchor` appears in `field` as whole words ("carl cox" in "Carl Cox & Friends"). */
export function fieldMatches(field: string, anchor: string): boolean {
  const a = normalize(anchor);
  return !!a && ` ${normalize(field)} `.includes(` ${a} `);
}

export interface StyleProfile {
  id: string;
  name: string;
  aliases: string[];
  /** one line on the sound */
  sound: string;
  bpm: [number, number];
  /** relative energy band, 0–1 */
  energy: [number, number];
  /** genre words that point to this sound */
  genres: string[];
  /** genre words that point away from it */
  avoid: string[];
  /** demo groove styles that carry this sound, best first */
  demo: DemoSpec['style'][];
  mode?: 'minor' | 'major';
}

export const STYLES: StyleProfile[] = [
  {
    id: 'stussy',
    name: 'Chris Stussy',
    aliases: ['stussy'],
    sound: 'deep, rolling minimal house — swung hats, walking basslines, jazzy chord stabs',
    bpm: [125, 129],
    energy: [0.3, 0.6],
    genres: ['deep', 'minimal', 'house', 'garage', 'groove', 'micro', 'rominimal', 'dub'],
    avoid: ['techno', 'hard', 'trance', 'rave', 'psy', 'dnb', 'breaks'],
    demo: ['minimal', 'garage', 'house'],
    mode: 'minor',
  },
  {
    id: 'omar',
    name: 'OMAR+',
    aliases: ['omar plus', 'omar'],
    sound: 'percussive, groove-first minimal tech house — congas, shakers, hypnotic rolling loops',
    bpm: [126, 130],
    energy: [0.45, 0.7],
    genres: ['minimal', 'tech', 'house', 'percussive', 'groove', 'tribal', 'latin'],
    avoid: ['trance', 'rave', 'ambient', 'dnb', 'hard'],
    demo: ['rolling', 'minimal', 'house'],
  },
  {
    id: 'cloonee',
    name: 'Cloonee',
    aliases: [],
    sound: 'bouncy, bass-led tech house — chopped vocal hooks and big drops',
    bpm: [126, 129],
    energy: [0.6, 0.85],
    genres: ['tech', 'house', 'bass', 'groove'],
    avoid: ['deep', 'ambient', 'trance', 'dnb', 'downtempo', 'techno', 'breaks'],
    demo: ['techhouse', 'house'],
  },
  {
    id: 'prospa',
    name: 'Prospa',
    aliases: [],
    sound: 'euphoric rave house — breakbeats, rave piano, stabs and huge builds',
    bpm: [126, 133],
    energy: [0.74, 1],
    genres: ['rave', 'breaks', 'breakbeat', 'piano', 'hardcore', 'house', 'uk'],
    avoid: ['deep', 'minimal', 'ambient', 'downtempo', 'dub'],
    demo: ['rave', 'breaks'],
    mode: 'major',
  },
];

export function styleById(id: string): StyleProfile | undefined {
  return STYLES.find((s) => s.id === id);
}

/** The sound profile an anchor names, if any ("chris stussy", "Stussy", "OMAR+"). */
export function styleForAnchor(anchor: string): StyleProfile | null {
  const a = normalize(anchor);
  if (!a) return null;
  return STYLES.find((s) => normalize(s.name) === a || s.aliases.some((x) => normalize(x) === a)) ?? null;
}

/** Style anchors in the order the set should visit them. */
export function journeyOrder(anchors: string[], order: 'energy' | 'typed' = 'energy'): StyleProfile[] {
  const out: StyleProfile[] = [];
  for (const a of anchors) {
    const s = styleForAnchor(a);
    if (s && !out.includes(s)) out.push(s);
  }
  if (order === 'energy') out.sort((x, y) => x.energy[0] + x.energy[1] - (y.energy[0] + y.energy[1]));
  return out;
}

/** Distance of v outside [lo, hi] (0 inside). */
function outside(v: number, lo: number, hi: number): number {
  return v < lo ? lo - v : v > hi ? v - hi : 0;
}

/** How well a track carries a style, 0–1, with a short reason. */
export function styleFit(p: TrackProfile, st: StyleProfile): { score: number; why: string } {
  // tempo: half/double time counts
  const bpms = [p.bpm, p.bpm * 2, p.bpm / 2];
  const dist = Math.min(...bpms.map((b) => outside(b, st.bpm[0], st.bpm[1])));
  const tempo = Math.exp(-((dist / 2.6) ** 2));
  const energy = clamp(1 - outside(p.energy, st.energy[0], st.energy[1]) * 3.2, 0, 1);
  const words = normalize(`${p.genre} ${p.demoStyle ?? ''}`).split(' ').filter((w) => w.length > 2);
  let genre = words.length ? 0.35 : 0.45;
  if (words.some((w) => st.genres.includes(w))) genre = 0.85;
  if (words.some((w) => st.avoid.includes(w))) genre = Math.min(genre, 0.15);
  if (p.demoStyle) {
    const i = st.demo.indexOf(p.demoStyle as DemoSpec['style']);
    genre = i === 0 ? 1 : i > 0 ? 0.62 - i * 0.08 : Math.min(genre, 0.12);
  }
  let mode = 0.6;
  if (st.mode && p.key) mode = (st.mode === 'minor') === p.key.minor ? 1 : 0.35;
  // the genre evidence has to be there: tempo and energy alone fit half the club
  const score = clamp(0.25 * tempo + 0.2 * energy + 0.45 * genre + 0.1 * mode, 0, 1);
  const bits: string[] = [];
  if (tempo > 0.8) bits.push(`${Math.round(p.bpm)} BPM`);
  if (genre >= 0.85 && (p.genre || p.demoStyle)) bits.push(`${p.genre || p.demoStyle} feel`);
  if (energy > 0.8) bits.push('the right energy');
  return { score, why: bits.length ? `Sounds like ${st.name}: ${bits.join(', ')}` : `Close to ${st.name}’s sound` };
}
