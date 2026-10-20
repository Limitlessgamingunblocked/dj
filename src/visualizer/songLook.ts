/*
 * Each song's look: its colours, the modes the auto VJ plays for it and how
 * the drums, the melody and the vocal show up over the picture. The same
 * song always gets the same look; two songs almost never share one.
 *   - colours: the key sets the hue (round the circle of fifths, so related
 *     keys sit close; minor keys go deeper), the genre sets how bright and
 *     how saturated, the song itself picks the colour scheme
 *   - modes: eight that suit the genre (techno gets hard geometry and op art,
 *     house gets warm liquid looks, trance gets flight and lasers, the
 *     16mm film and the set sculpture suit the deeper, longer ones…), always
 *     with calm, groove and peak ones so the auto VJ can follow the track
 *   - layers: a drum style, a melody style and a vocal style, and how strong
 *     each is (an ambient track barely shows its drums)
 *   - pace: how often the screens move to the next mode, by the song's feel
 *     and tempo (a chill track drifts every 16 bars, bass music cuts every 4)
 * Pure; the visual player asks for one whenever the lead track changes.
 */
import type { ModeInfo } from './kit';

export type DrumStyle = 'punch' | 'rings' | 'bars' | 'shatter';
export type MelodyStyle = 'ribbon' | 'aurora' | 'orbit';
export type VocalStyle = 'halo' | 'wave' | 'rays';
export const DRUM_STYLES: DrumStyle[] = ['punch', 'rings', 'bars', 'shatter'];
export const MELODY_STYLES: MelodyStyle[] = ['ribbon', 'aurora', 'orbit'];
export const VOCAL_STYLES: VocalStyle[] = ['halo', 'wave', 'rays'];

export interface SongInput {
  id: string;
  title?: string;
  bpm?: number;
  /** pitch class of the key (0 = C) and whether it's minor */
  key?: { root: number; minor: boolean } | null;
  genre?: string;
}

export interface SongLook {
  /** the song it's for */
  id: string;
  family: Family;
  colors: [string, string, string];
  /** the modes the auto VJ plays for this song, and the one it opens on */
  pool: string[];
  first: string;
  /** bars each mode plays before the next: 4, 8 or 16 */
  pace: number;
  drum: DrumStyle;
  melody: MelodyStyle;
  vocal: VocalStyle;
  /** how strong each layer is, 0..1 */
  drumAmt: number;
  melodyAmt: number;
  vocalAmt: number;
}

export type Family = 'techno' | 'house' | 'trance' | 'bass' | 'urban' | 'chill' | 'any';

const FAMILY: Record<string, Family> = {
  Techno: 'techno',
  'Tech House': 'techno',
  Hardstyle: 'bass',
  House: 'house',
  'Deep House': 'house',
  'Afro House': 'house',
  Disco: 'house',
  'UK Garage': 'house',
  Trance: 'trance',
  'Drum & Bass': 'bass',
  Dubstep: 'bass',
  Trap: 'bass',
  'Hip Hop': 'urban',
  'R&B': 'urban',
  Pop: 'urban',
  Reggaeton: 'urban',
  'Lo-fi': 'chill',
  Ambient: 'chill',
};

/** the modes that suit each family, best first */
const FITS: Record<Family, string[]> = {
  techno: ['strobe', 'moire', 'circuit', 'sonar', 'warp', 'lasers', 'crt', 'echo', 'mosh', 'rain', 'cells', 'hexfloor', 'matrix', 'film', 'sculpture'],
  house: ['ink', 'caustics', 'kaleido', 'plasma', 'cells', 'city', 'orb', 'chrome', 'aurora', 'grid', 'nameboard', 'morph', 'film', 'sculpture'],
  trance: ['hyper', 'fractal', 'lasers', 'warp', 'galaxy', 'aurora', 'kaleido', 'mandel', 'orb', 'echo', 'sonar', 'sculpture'],
  bass: ['mosh', 'galaxy', 'strobe', 'hexfloor', 'hyper', 'orb', 'fractal', 'lasers', 'city', 'rain', 'echo', 'morph'],
  urban: ['city', 'crt', 'ink', 'chrome', 'grid', 'nameboard', 'morph', 'plasma', 'rain', 'kaleido', 'orb', 'caustics'],
  chill: ['aurora', 'caustics', 'ink', 'chrome', 'grid', 'mandel', 'plasma', 'moire', 'morph', 'sonar', 'film'],
  any: [],
};

const STYLE: Record<Family, { drum: DrumStyle[]; melody: MelodyStyle[]; vocal: VocalStyle[]; amt: [number, number, number]; sat: number; light: number }> = {
  techno: { drum: ['bars', 'punch'], melody: ['orbit', 'ribbon'], vocal: ['wave', 'halo'], amt: [0.9, 0.55, 0.7], sat: 0.55, light: 0.55 },
  house: { drum: ['rings', 'punch'], melody: ['ribbon', 'orbit'], vocal: ['halo', 'rays'], amt: [0.75, 0.75, 0.85], sat: 0.85, light: 0.55 },
  trance: { drum: ['punch', 'rings'], melody: ['aurora', 'ribbon'], vocal: ['rays', 'halo'], amt: [0.7, 0.95, 0.8], sat: 0.9, light: 0.55 },
  bass: { drum: ['shatter', 'rings'], melody: ['ribbon', 'orbit'], vocal: ['wave', 'rays'], amt: [1, 0.6, 0.75], sat: 1, light: 0.5 },
  urban: { drum: ['punch', 'shatter'], melody: ['ribbon', 'aurora'], vocal: ['halo', 'wave'], amt: [0.85, 0.65, 1], sat: 0.8, light: 0.55 },
  chill: { drum: ['rings', 'punch'], melody: ['aurora', 'orbit'], vocal: ['halo', 'rays'], amt: [0.35, 0.9, 0.8], sat: 0.6, light: 0.6 },
  any: { drum: DRUM_STYLES, melody: MELODY_STYLES, vocal: VOCAL_STYLES, amt: [0.8, 0.75, 0.85], sat: 0.85, light: 0.55 },
};

/** about how long a mode stays up, in seconds, by the feel of the music: chill drifts, bass and urban cut quick */
const HOLD: Record<Family, number> = { chill: 40, trance: 16, house: 15, techno: 15, any: 15, bass: 7, urban: 8 };

/** bars per mode for a song: the family's hold time at its tempo, to the nearest phrase length (4, 8 or 16) */
export function songPace(family: Family, bpm = 120): number {
  const bar = 240 / Math.max(60, Math.min(200, bpm));
  const bars = HOLD[family] / bar;
  let best = 8;
  for (const n of [4, 8, 16]) if (Math.abs(Math.log2(n / bars)) < Math.abs(Math.log2(best / bars)) - 1e-9) best = n;
  return best;
}

/** colour schemes round the base hue */
const SCHEMES: number[][] = [
  [0, 0.08, -0.08], // analogous
  [0, 0.5, 0.06], // complementary
  [0, 0.33, 0.67], // triad
  [0, 0.42, 0.58], // split complementary
  [0, -0.12, 0.45], // accent
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function shuffle<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hsl(h: number, s: number, l: number): string {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export function familyOf(genre: string | undefined): Family {
  return (genre && FAMILY[genre]) || 'any';
}

export function songLook(s: SongInput, modes: ModeInfo[]): SongLook {
  const seed = hash(`${s.id}|${s.title ?? ''}`);
  const r = rng(seed);
  const family = familyOf(s.genre);
  const st = STYLE[family];
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];

  // colours: the key round the circle of fifths, or the song's own hue
  const base = s.key ? ((s.key.root * 7) % 12) / 12 + (s.key.minor ? 0.58 : 0) : r();
  const scheme = SCHEMES[Math.floor(r() * SCHEMES.length) % SCHEMES.length];
  const sat = Math.min(1, st.sat * (s.key?.minor ? 0.92 : 1) + (r() - 0.5) * 0.1);
  const light = st.light - (s.key?.minor ? 0.04 : 0);
  // techno keeps one colour and two near-whites; everyone else gets the full scheme
  const colors = scheme.map((d, i) => (family === 'techno' && i > 0 ? hsl(base + d, sat * 0.25, 0.72) : hsl(base + d + (r() - 0.5) * 0.03, sat, light + (i === 2 ? 0.08 : 0)))) as [string, string, string];

  // modes: eight from the family's list, then make sure calm, groove and peak are all there
  const known = new Set(modes.map((m) => m.id));
  const fits = (FITS[family].length ? FITS[family] : modes.map((m) => m.id)).filter((id) => known.has(id));
  const shuffled = shuffle([...fits], r);
  const pool = shuffled.slice(0, Math.min(8, shuffled.length));
  for (const energy of ['calm', 'mid', 'peak'] as const) {
    const have = pool.filter((id) => modes.find((m) => m.id === id)?.energy === energy).length;
    const extra = shuffle(modes.filter((m) => m.energy === energy && !pool.includes(m.id)), r);
    for (let i = have; i < 2 && extra.length; i++) pool.push(extra.shift()!.id);
  }
  const groove = pool.filter((id) => modes.find((m) => m.id === id)?.energy !== 'peak');
  const first = groove.length ? pick(groove) : pool[0];

  // layer styles: mostly the family's, sometimes any, so songs in one genre still differ
  const style = <T>(fit: readonly T[], all: readonly T[]): T => (r() < 0.7 ? pick(fit) : pick(all));
  const drum = style(st.drum, DRUM_STYLES);
  const melody = style(st.melody, MELODY_STYLES);
  const vocal = style(st.vocal, VOCAL_STYLES);
  const vary = () => 0.9 + r() * 0.2;
  // tempo nudges how hard the drums show: slow songs lean on the melody
  const bpm = s.bpm ?? 120;
  const tempo = Math.max(0.75, Math.min(1.15, bpm / 124));
  return {
    id: s.id,
    family,
    colors,
    pool,
    first,
    pace: songPace(family, bpm),
    drum,
    melody,
    vocal,
    drumAmt: Math.min(1, st.amt[0] * tempo * vary()),
    melodyAmt: Math.min(1, st.amt[1] * vary()),
    vocalAmt: Math.min(1, st.amt[2] * vary()),
  };
}

/** a few words for the panel: "Techno look: bars, orbit, wave" */
export function describeLook(l: SongLook): string {
  const fam = l.family === 'any' ? 'Its own' : `${l.family[0].toUpperCase()}${l.family.slice(1)}`;
  return `${fam} look · drums: ${l.drum} · melody: ${l.melody} · vocals: ${l.vocal}`;
}
