/*
 * The regulars: named fans (fictional) who follow you from venue to venue.
 * Each has a favourite style. Play well and play their music and they come
 * back, closer to the front each time, with a sign; disappoint them and they
 * drift away. Loyalty is kept between sessions (settings key "regulars").
 * Pure logic: the gig director reports each set; the crowd shows who's in.
 */
import { loadSetting, saveSetting } from '../core/settings';

export interface Regular {
  id: string;
  name: string;
  /** what they call their music, for the lines */
  style: string;
  /** the genres they love */
  genres: string[];
  /** their shirt, so you can spot them */
  color: string;
  /** their sign when they're at the front ({dj} is your name) */
  sign: string;
  /** what they say when you play their music */
  cheer: string;
}

export const REGULARS: Regular[] = [
  { id: 'jess', name: 'Jess', style: 'house', genres: ['House', 'Tech House', 'Disco'], color: '#ff4fb0', sign: 'JESS ♥ {dj}', cheer: 'Jess is jacking at the front' },
  { id: 'marco', name: 'Marco', style: 'techno', genres: ['Techno', 'Hardstyle'], color: '#e8e8e8', sign: 'HARDER {dj}!', cheer: 'Marco’s stomping right by the booth' },
  { id: 'priya', name: 'Priya', style: 'drum & bass', genres: ['Drum & Bass', 'Dubstep'], color: '#3dff7a', sign: 'PRIYA WANTS BASS', cheer: 'Priya’s bouncing off the walls' },
  { id: 'theo', name: 'Theo', style: 'deep house', genres: ['Deep House', 'Lo-fi', 'Ambient'], color: '#7fb3ff', sign: 'DEEPER PLEASE', cheer: 'Theo’s eyes closed, lost in it' },
  { id: 'ama', name: 'Ama', style: 'afro house', genres: ['Afro House', 'Reggaeton'], color: '#ffb547', sign: 'AMA CAME BACK!', cheer: 'Ama’s got the whole front row moving' },
  { id: 'kenji', name: 'Kenji', style: 'trance', genres: ['Trance', 'Pop'], color: '#9d8cff', sign: 'HANDS UP FOR {dj}', cheer: 'Kenji’s hands are in the air' },
  { id: 'rosa', name: 'Rosa', style: 'disco and garage', genres: ['UK Garage', 'Disco', 'R&B'], color: '#ff7a1a', sign: 'ROSA’S BIRTHDAY!', cheer: 'Rosa’s dancing like it’s her birthday' },
  { id: 'dev', name: 'Dev', style: 'hip hop and trap', genres: ['Hip Hop', 'Trap'], color: '#2ee6ff', sign: 'DEV SAYS RUN IT BACK', cheer: 'Dev’s rapping every word' },
];

export type Loyalty = Record<string, number>;

/** loyalty from storage: only known fans, each 0..1 */
export function cleanLoyalty(raw: unknown): Loyalty {
  const out: Loyalty = {};
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  for (const f of REGULARS) {
    const v = r[f.id];
    out[f.id] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.2;
  }
  return out;
}

export function loadLoyalty(): Loyalty {
  return cleanLoyalty(loadSetting<unknown>('regulars', null));
}

export function saveLoyalty(l: Loyalty): void {
  saveSetting('regulars', l);
}

/** in tonight (loyalty 0.35 or more), and at the front (0.6 or more) */
export function attending(l: Loyalty): { fan: Regular; front: boolean }[] {
  return REGULARS.filter((f) => (l[f.id] ?? 0) >= 0.35)
    .sort((a, b) => (l[b.id] ?? 0) - (l[a.id] ?? 0))
    .map((fan) => ({ fan, front: (l[fan.id] ?? 0) >= 0.6 }));
}

/** a fan's sign, with your name in */
export function signFor(f: Regular, dj: string): string {
  return f.sign.replace('{dj}', (dj || 'DJ').toUpperCase());
}

/** the fan who loves this genre most, if any */
export function fanOf(genre: string): Regular | null {
  return REGULARS.find((f) => f.genres[0] === genre) ?? REGULARS.find((f) => f.genres.includes(genre)) ?? null;
}

const GRADE_K: Record<string, number> = { S: 1, A: 0.75, B: 0.45, C: 0.15, D: -0.2 };

export interface SetReport {
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  /** seconds of each genre played to the room */
  genres: Record<string, number>;
  /** the set was played to the end */
  full: boolean;
}

/**
 * After a set: each fan who was in (or would have come) gets closer to you
 * for a good set, more if you played their music, and drifts if it was poor
 * or none of their music came on. Returns the new loyalty and what changed.
 */
export function afterSet(l: Loyalty, r: SetReport): { loyalty: Loyalty; changes: { fan: Regular; delta: number }[] } {
  const total = Object.values(r.genres).reduce((a, b) => a + b, 0);
  const out: Loyalty = { ...l };
  const changes: { fan: Regular; delta: number }[] = [];
  for (const f of REGULARS) {
    const before = l[f.id] ?? 0.2;
    const mine = total > 0 ? f.genres.reduce((a, g) => a + (r.genres[g] ?? 0), 0) / total : 0;
    let d = 0.06 * (GRADE_K[r.grade] ?? 0) + 0.22 * mine;
    // none of their music in a full set: they drift a little
    if (r.full && mine === 0) d -= 0.03;
    if (!r.full) d *= 0.5;
    const after = Math.max(0, Math.min(1, before + d));
    out[f.id] = Math.round(after * 1000) / 1000;
    if (Math.abs(after - before) >= 0.01) changes.push({ fan: f, delta: after - before });
  }
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { loyalty: out, changes };
}
