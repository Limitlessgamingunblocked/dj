/*
 * Which genre a track shows in the library, and tidying genre names.
 *   1. the genre you picked for it (right-click → Genre, or click its genre)
 *   2. the genre in the file's own tags, tidied to one spelling per genre
 *      ("hip-hop", "HipHop" and "Hip Hop" all sort together)
 *   3. the analyser's guess from the sound (analysis/genre.ts)
 */
import { GENRES } from '../analysis/genre';
import type { LibraryTrack } from '../core/types';

export type GenreSource = 'you' | 'tag' | 'guess' | 'none';

export interface GenreGuessLite {
  genre: string;
  confidence: number;
  runnerUp: string;
}

/** spellings people (and taggers) use, folded to one name */
const ALIASES: Record<string, string> = {
  hiphop: 'Hip Hop',
  rap: 'Hip Hop',
  'boom bap': 'Hip Hop',
  dnb: 'Drum & Bass',
  'd&b': 'Drum & Bass',
  'd and b': 'Drum & Bass',
  'drum and bass': 'Drum & Bass',
  'drum n bass': 'Drum & Bass',
  drumandbass: 'Drum & Bass',
  liquid: 'Drum & Bass',
  rnb: 'R&B',
  'r and b': 'R&B',
  'r n b': 'R&B',
  'rhythm and blues': 'R&B',
  techhouse: 'Tech House',
  deephouse: 'Deep House',
  afrohouse: 'Afro House',
  ukg: 'UK Garage',
  garage: 'UK Garage',
  '2 step': 'UK Garage',
  '2step': 'UK Garage',
  'nu disco': 'Disco',
  'nudisco': 'Disco',
  lofi: 'Lo-fi',
  'lo fi': 'Lo-fi',
  'lofi hip hop': 'Lo-fi',
  reguetón: 'Reggaeton',
  reguetonero: 'Reggaeton',
  chillout: 'Ambient',
  'dance pop': 'Pop',
  'hard style': 'Hardstyle',
};

const BY_KEY = new Map<string, string>(GENRES.map((g) => [key(g), g]));

function key(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_/.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** one spelling per genre; anything we don't know is kept, with tidy capitals */
export function normalizeGenre(raw: string): string {
  const s = raw.replace(/^\(\d+\)\s*/, '').trim();
  if (!s) return '';
  const k = key(s);
  const known = BY_KEY.get(k) ?? ALIASES[k] ?? ALIASES[k.replace(/\s/g, '')] ?? BY_KEY.get(k.replace(/\s/g, ''));
  if (known) return known;
  // ALL CAPS or all lower case → Title Case; otherwise keep how it was written
  if (s === s.toUpperCase() || s === s.toLowerCase()) return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return s;
}

export function resolveGenre(meta: { genre: string }, guess: GenreGuessLite | null | undefined, mine: string | undefined): { genre: string; source: GenreSource } {
  if (mine) return { genre: mine, source: 'you' };
  const tag = normalizeGenre(meta.genre ?? '');
  if (tag) return { genre: tag, source: 'tag' };
  if (guess?.genre) return { genre: guess.genre, source: 'guess' };
  return { genre: '', source: 'none' };
}

export function genreOf(t: LibraryTrack): { genre: string; source: GenreSource } {
  return resolveGenre(t.meta, t.analysis?.genre, t.genre);
}

/** a line for the genre's tooltip */
export function genreNote(t: LibraryTrack): string {
  const g = genreOf(t);
  if (g.source === 'you') return 'You set this genre. Click to change it.';
  if (g.source === 'tag') return 'From the file’s tags. Click to change it.';
  if (g.source === 'guess') {
    const a = t.analysis?.genre;
    const sure = a ? Math.round(a.confidence * 100) : 0;
    return `Detected from the sound${a ? ` (${sure < 25 ? 'not sure' : `${sure}% sure`}, or maybe ${a.runnerUp})` : ''}. Click to change it.`;
  }
  return 'Not analysed yet.';
}
