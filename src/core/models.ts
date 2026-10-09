/*
 * The career's saved data (Section 16.3), each with a format version, a
 * validator and its defaults, for the SaveSystem:
 *   Profile    the DJ name, tagline
 *   Progress   fame, cash, followers, tier, unlocks, milestones, reputation
 *   Looks      saved character + outfit looks          (filled in by Stage 2)
 *   Boards     custom boards                           (filled in by Stage 5)
 *   Crates     playlists for gigs
 *   Recordings recordings and clips                    (filled in by Stage 4)
 *   Bookings   gig offers and the calendar             (filled in by Stage 6)
 * Validators repair rather than reject: unknown fields are dropped, numbers
 * clamped, bad entries skipped, so a save from an older build or a
 * hand-edited file still loads.
 */
import type { SaveSpec } from './SaveSystem';

/* ------------------------------------------------------------------ */
/* checking helpers                                                     */
/* ------------------------------------------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {});
const num = (v: unknown, lo: number, hi: number, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
const int = (v: unknown, lo: number, hi: number, fb: number): number => Math.round(num(v, lo, hi, fb));
const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);
const str = (v: unknown, max: number, fb = ''): string => (typeof v === 'string' ? v.slice(0, max) : fb);
const oneOf = <T>(v: unknown, list: readonly T[], fb: T): T => (list.includes(v as T) ? (v as T) : fb);
const ID = /^[\w-]{1,64}$/;
const id = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) ? v : null);
const date = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
/** a list, each entry checked; entries that come back null are skipped */
function list<T>(v: unknown, each: (x: unknown) => T | null, max = 10_000): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v.slice(0, max)) {
    const r = each(x);
    if (r !== null) out.push(r);
  }
  return out;
}
const strings = (v: unknown, max = 1000): string[] => list(v, (x) => (typeof x === 'string' && x.length <= 64 ? x : null), max);
const dedupe = (a: string[]) => [...new Set(a)];

/* ------------------------------------------------------------------ */
/* profile                                                              */
/* ------------------------------------------------------------------ */

export interface Profile {
  /** the DJ name: 1–20 characters (empty until the naming scene) */
  name: string;
  /** up to 30 characters ("ALL NIGHT LONG") */
  tagline: string;
  /** show the name in capitals (on by default) */
  uppercase: boolean;
  createdAt: string | null;
}

export const NAME_MAX = 20;
export const TAGLINE_MAX = 30;
/** letters (any alphabet), numbers, spaces and . & - ' (Section 3.1) */
const NAME_CHAR = /[\p{L}\p{N} .&'-]/u;
const TAGLINE_CHAR = /[\p{L}\p{N} .&'!?,:/+-]/u;

/** keep only the allowed characters, one space between words, and the length limit */
function clean(raw: unknown, allowed: RegExp, max: number): string {
  if (typeof raw !== 'string') return '';
  let s = '';
  for (const ch of raw.normalize('NFC')) if (allowed.test(ch)) s += ch;
  return s.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
export const cleanName = (raw: unknown): string => clean(raw, NAME_CHAR, NAME_MAX);
export const cleanTagline = (raw: unknown): string => clean(raw, TAGLINE_CHAR, TAGLINE_MAX);

export const PROFILE: SaveSpec<Profile> = {
  kind: 'profile',
  version: 1,
  migrations: {},
  defaults: () => ({ name: '', tagline: '', uppercase: true, createdAt: null }),
  validate(raw) {
    const r = obj(raw);
    return { name: cleanName(r.name), tagline: cleanTagline(r.tagline), uppercase: bool(r.uppercase, true), createdAt: date(r.createdAt) };
  },
};

/* ------------------------------------------------------------------ */
/* progress                                                             */
/* ------------------------------------------------------------------ */

export const REPUTATIONS = ['deep-groover', 'rave-starter', 'bass-swap', 'selector', 'crowd-whisperer'] as const;
export type Reputation = (typeof REPUTATIONS)[number];
/** fame tiers 1–6, then 7 = max (the sunrise closing set) — Section 9.2 */
export const MAX_TIER = 7;

export interface Progress {
  tier: number;
  fame: number;
  cash: number;
  followers: number;
  setsPlayed: number;
  /** ids of unlocked venues, items and board parts */
  unlocked: string[];
  /** ids of milestones reached */
  milestones: string[];
  reputation: Reputation | null;
  /** everything unlocked (sandbox mode, or the debug menu) */
  sandbox: boolean;
  /** the bedroom tutorial is done */
  tutorialDone: boolean;
}

export const PROGRESS: SaveSpec<Progress> = {
  kind: 'progress',
  version: 1,
  migrations: {},
  defaults: () => ({ tier: 1, fame: 0, cash: 0, followers: 0, setsPlayed: 0, unlocked: [], milestones: [], reputation: null, sandbox: false, tutorialDone: false }),
  validate(raw) {
    const r = obj(raw);
    return {
      tier: int(r.tier, 1, MAX_TIER, 1),
      fame: int(r.fame, 0, 1e9, 0),
      cash: int(r.cash, 0, 1e9, 0),
      followers: int(r.followers, 0, 1e10, 0),
      setsPlayed: int(r.setsPlayed, 0, 1e6, 0),
      unlocked: dedupe(strings(r.unlocked, 5000)),
      milestones: dedupe(strings(r.milestones, 500)),
      reputation: r.reputation === null ? null : oneOf<Reputation | null>(r.reputation, REPUTATIONS, null),
      sandbox: bool(r.sandbox, false),
      tutorialDone: bool(r.tutorialDone, false),
    };
  },
};

/* ------------------------------------------------------------------ */
/* looks (the character and outfit, Section 4)                         */
/* ------------------------------------------------------------------ */

// Version 2 (Stage 2B): options, tattoos and piercings were added; the sliders are named like the
// Blender shape keys they'll drive (src/character/catalog.ts)

export interface Tattoo {
  design: string;
  place: string;
  /** 0.3..1.5 */
  size: number;
  /** radians */
  rot: number;
  color: string;
}

export interface Look {
  id: string;
  name: string;
  /** body / face / eye / skin sliders by shape-key name (e.g. jaw_width), -1..1 (amounts 0..1) */
  sliders: Record<string, number>;
  /** colours by zone (skin, hair, hair2, iris_l, top_1…), #rrggbb */
  colors: Record<string, string>;
  /** the item in each outfit slot, and the hair style; null for nothing */
  items: Record<string, string | null>;
  /** enumerated choices (face shape, brows, groove style, materials and patterns per slot…) */
  options: Record<string, string>;
  tattoos: Tattoo[];
  piercings: string[];
}

const HEX = /^#[0-9a-f]{6}$/i;
const KEYNAME = /^[a-z][a-z0-9_]{0,47}$/;

function record<T>(v: unknown, each: (x: unknown) => T | undefined, max = 400): Record<string, T> {
  const out: Record<string, T> = {};
  let n = 0;
  for (const [k, x] of Object.entries(obj(v))) {
    if (!KEYNAME.test(k) || n >= max) continue;
    const r = each(x);
    if (r !== undefined) {
      out[k] = r;
      n++;
    }
  }
  return out;
}

const colour = (x: unknown): string | undefined => (typeof x === 'string' && HEX.test(x) ? x.toLowerCase() : undefined);

export function checkLook(raw: unknown): Look | null {
  const r = obj(raw);
  const lid = id(r.id);
  if (!lid) return null;
  return {
    id: lid,
    name: str(r.name, 40, 'Look'),
    sliders: record(r.sliders, (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(-1, x)) : undefined)),
    colors: record(r.colors, colour),
    items: record(r.items, (x) => (x === null ? null : (id(x) ?? undefined))),
    options: record(r.options, (x) => (typeof x === 'string' && ID.test(x) ? x : undefined)),
    tattoos: list(
      r.tattoos,
      (x) => {
        const o = obj(x);
        const design = id(o.design);
        const place = id(o.place);
        return design && place ? { design, place, size: num(o.size, 0.3, 1.5, 1), rot: num(o.rot, -Math.PI, Math.PI, 0), color: colour(o.color) ?? '#1a1a1a' } : null;
      },
      12,
    ),
    piercings: dedupe(list(r.piercings, (x) => id(x), 12)),
  };
}

export const LOOKS: SaveSpec<{ items: Look[]; current: string | null }> = {
  kind: 'looks',
  version: 2,
  migrations: {
    // v1 had no options, tattoos or piercings
    1: (d) => {
      const o = obj(d);
      return { ...o, items: (Array.isArray(o.items) ? o.items : []).map((l: unknown) => ({ options: {}, tattoos: [], piercings: [], ...obj(l) })) };
    },
  },
  defaults: () => ({ items: [], current: null }),
  validate(raw) {
    const r = obj(raw);
    const items = list(r.items, checkLook, 1000);
    const cur = id(r.current);
    return { items, current: cur && items.some((l) => l.id === cur) ? cur : null };
  },
};

/* ------------------------------------------------------------------ */
/* boards (Section 13)                                                  */
/* ------------------------------------------------------------------ */

/*
 * The boards you've built or collected. Each board's file (the documented
 * format in docs/board-format.md, checked against the component catalogue
 * when it opens) lives in the media store, since a big board is too much for
 * this save; the list here says what there is. The board on the stage keeps a
 * compact copy here too, so it's there the moment the game starts.
 */

export const BOARD_SOURCES = ['mine', 'remix', 'code', 'file'] as const;

export interface BoardEntry {
  id: string;
  name: string;
  created: string;
  /** when it was last saved */
  updated: string;
  /** how many parts it has (for the list) */
  parts: number;
  /** your rating: 0 for none, 1–5 stars */
  rating: number;
  /** the board it was remixed from */
  remixOf: string | null;
  source: (typeof BOARD_SOURCES)[number];
  /** gigs played on it */
  plays: number;
  favorite: boolean;
}

export interface BoardsSave {
  items: BoardEntry[];
  /** the board on the stage (an entry's id), if it's one of yours */
  current: string | null;
  /** that board's file, compact, so it builds before the media store has opened */
  currentFile: Record<string, unknown> | null;
  /** the parts you've starred in the builder's palette */
  favParts: string[];
  /** your ratings of the showcase boards (they aren't in `items`) */
  ratings: Record<string, number>;
  /** board files from an older save waiting to move into the media store */
  pending: Record<string, Record<string, unknown>>;
}

/** plain JSON, at most `max` characters of it */
function jsonObject(v: unknown, max: number): Record<string, unknown> | null {
  if (!isObj(v)) return null;
  try {
    const text = JSON.stringify(v);
    return text.length <= max ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function boardEntry(x: unknown): BoardEntry | null {
  const r = obj(x);
  const bid = id(r.id);
  if (!bid) return null;
  const created = date(r.created) ?? new Date(0).toISOString();
  return {
    id: bid,
    name: str(r.name, 60, 'My board') || 'My board',
    created,
    updated: date(r.updated) ?? created,
    parts: int(r.parts, 0, 1e6, 0),
    rating: int(r.rating, 0, 5, 0),
    remixOf: typeof r.remixOf === 'string' && r.remixOf.length <= 80 ? r.remixOf : null,
    source: oneOf(r.source, BOARD_SOURCES, 'mine'),
    plays: int(r.plays, 0, 1e9, 0),
    favorite: bool(r.favorite, false),
  };
}

export const BOARDS: SaveSpec<BoardsSave> = {
  kind: 'boards',
  version: 2,
  migrations: {
    // v1 (provisional, never written by a released build) kept whole boards in the save; their files move to the media store
    1: (d) => {
      const o = obj(d);
      const old = Array.isArray(o.items) ? o.items : [];
      const items: unknown[] = [];
      const pending: Record<string, unknown> = {};
      for (const b of old) {
        const r = obj(b);
        if (!id(r.id)) continue;
        items.push({ id: r.id, name: r.name, source: 'mine', parts: Array.isArray(r.components) ? r.components.length : 0 });
        pending[r.id as string] = { format: 'deckhouse-board', version: 1, ...r };
      }
      return { items, current: o.current ?? null, currentFile: null, favParts: [], ratings: {}, pending };
    },
  },
  defaults: () => ({ items: [], current: null, currentFile: null, favParts: [], ratings: {}, pending: {} }),
  validate(raw) {
    const r = obj(raw);
    const items = list(r.items, boardEntry, 500);
    const seen = new Set<string>();
    const unique = items.filter((b) => !seen.has(b.id) && !!seen.add(b.id));
    const cur = id(r.current);
    const current = cur && unique.some((b) => b.id === cur) ? cur : null;
    const file = current ? jsonObject(r.currentFile, 600_000) : null;
    const pending: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(obj(r.pending)).slice(0, 500)) {
      const f = jsonObject(v, 600_000);
      if (id(k) && f) pending[k] = f;
    }
    return {
      items: unique,
      current,
      currentFile: file && file.id === current ? file : null,
      favParts: dedupe(strings(r.favParts, 200)).filter((t) => KEYNAME.test(t)),
      ratings: record(r.ratings, (x) => (typeof x === 'number' && x >= 1 && x <= 5 ? Math.round(x) : undefined), 200),
      pending,
    };
  },
};

/* ------------------------------------------------------------------ */
/* crates                                                               */
/* ------------------------------------------------------------------ */

export interface Crate {
  id: string;
  name: string;
  trackIds: string[];
}

export const CRATES: SaveSpec<{ items: Crate[] }> = {
  kind: 'crates',
  version: 1,
  migrations: {},
  defaults: () => ({ items: [] }),
  validate(raw) {
    return {
      items: list(obj(raw).items, (x) => {
        const r = obj(x);
        const cid = id(r.id);
        return cid ? { id: cid, name: str(r.name, 60, 'Crate'), trackIds: dedupe(strings(r.trackIds, 2000)) } : null;
      }),
    };
  },
};

/* ------------------------------------------------------------------ */
/* recordings and clips (Stage 4)                                       */
/* ------------------------------------------------------------------ */

export const RECORD_KINDS = ['audio', 'video', 'booth'] as const;
export const ASPECTS = ['16:9', '9:16', '1:1'] as const;
export const GRADES = ['D', 'C', 'B', 'A', 'S'] as const;
/** where a set came from: the REC button, Save That Mix, Clip It, or the trim editor */
export const RECORD_SOURCES = ['rec', 'buffer', 'clip', 'trim'] as const;
export const MARKER_KINDS = ['vibe', 'drop', 'transition', 'signature', 'peak', 'chant'] as const;

export interface TracklistEntry {
  /** seconds from the start */
  at: number;
  title: string;
  artist: string;
}

/** a smart marker (Section 12.5), seconds from the start */
export interface Marker {
  at: number;
  kind: (typeof MARKER_KINDS)[number];
  label: string;
}

/** files in the media store (media/MediaStore.ts), by id */
export interface RecordingFiles {
  /** raw 24-bit stereo PCM (no header): exported as WAV or MP3 on demand */
  pcm?: string;
  /** the video, already encoded (WebM or MP4), audio included */
  video?: string;
  cover?: string;
  thumb?: string;
  /** a film strip of stills, `stripEvery` seconds apart, side by side (the trim editor's thumbnails) */
  strip?: string;
}

export interface Recording {
  id: string;
  kind: (typeof RECORD_KINDS)[number];
  source: (typeof RECORD_SOURCES)[number];
  venue: string;
  date: string;
  seconds: number;
  /** the PCM's sample rate */
  rate: number;
  grade: (typeof GRADES)[number] | null;
  tracklist: TracklistEntry[];
  markers: Marker[];
  favorite: boolean;
  title: string;
  aspect: (typeof ASPECTS)[number];
  files: RecordingFiles;
  /** bytes used by its files */
  bytes: number;
  /** bar lines (seconds from the start), for snapping when trimming */
  bars: number[];
  /** seconds between the film strip's stills */
  stripEvery: number;
}

const entry = (x: unknown): TracklistEntry | null => {
  const r = obj(x);
  return typeof r.title === 'string' ? { at: num(r.at, 0, 1e6, 0), title: str(r.title, 120), artist: str(r.artist, 120) } : null;
};

const marker = (x: unknown): Marker | null => {
  const r = obj(x);
  return typeof r.at === 'number' ? { at: num(r.at, 0, 1e6, 0), kind: oneOf(r.kind, MARKER_KINDS, 'vibe'), label: str(r.label, 80) } : null;
};

function recording(x: unknown): Recording | null {
  const o = obj(x);
  const rid = id(o.id);
  const d = date(o.date);
  if (!rid || !d) return null;
  const f = obj(o.files);
  const files: RecordingFiles = {};
  for (const k of ['pcm', 'video', 'cover', 'thumb', 'strip'] as const) {
    const v = id(f[k]);
    if (v) files[k] = v;
  }
  return {
    id: rid,
    kind: oneOf(o.kind, RECORD_KINDS, 'audio'),
    source: oneOf(o.source, RECORD_SOURCES, 'rec'),
    venue: id(o.venue) ?? 'unknown',
    date: d,
    seconds: num(o.seconds, 0, 86_400, 0),
    rate: int(o.rate, 8000, 192_000, 48_000),
    grade: o.grade === null ? null : oneOf<Recording['grade']>(o.grade, GRADES, null),
    tracklist: list(o.tracklist, entry, 500),
    markers: list(o.markers, marker, 2000),
    favorite: bool(o.favorite, false),
    title: str(o.title, 80, 'Set'),
    aspect: oneOf(o.aspect, ASPECTS, '16:9'),
    files,
    bytes: num(o.bytes, 0, 1e13, 0),
    bars: list(o.bars, (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x * 1000) / 1000 : null), 20_000),
    stripEvery: num(o.stripEvery, 0.5, 60, 2),
  };
}

export const RECORDINGS: SaveSpec<{ items: Recording[] }> = {
  kind: 'recordings',
  version: 2,
  migrations: {
    // v1 kept clips in a list of their own; nothing ever wrote either list before v2
    1: (d) => {
      const r = obj(d);
      const clips = Array.isArray(r.clips) ? r.clips.map((c) => ({ ...obj(c), source: 'clip', kind: 'video' })) : [];
      return { items: [...(Array.isArray(r.items) ? r.items : []), ...clips] };
    },
  },
  defaults: () => ({ items: [] }),
  validate(raw) {
    return { items: list(obj(raw).items, recording) };
  },
};

/* ------------------------------------------------------------------ */
/* bookings (Stage 6)                                                   */
/* ------------------------------------------------------------------ */

export const SLOTS = ['warmup', 'peak', 'closing', 'afterhours'] as const;
export const SET_LENGTHS = [10, 20, 30, 60] as const;
export const BOOKING_STATUS = ['offered', 'accepted', 'played', 'declined'] as const;

export interface Booking {
  id: string;
  venue: string;
  slot: (typeof SLOTS)[number];
  minutes: (typeof SET_LENGTHS)[number];
  pay: number;
  /** what the crowd wants ("deep warm-up, don't go too hard") */
  expectation: string;
  /** the bonus objective ("hit 3 bass swaps") */
  objective: string;
  date: string;
  status: (typeof BOOKING_STATUS)[number];
}

export const BOOKINGS: SaveSpec<{ items: Booking[] }> = {
  kind: 'bookings',
  version: 1,
  migrations: {},
  defaults: () => ({ items: [] }),
  validate(raw) {
    return {
      items: list(obj(raw).items, (x) => {
        const o = obj(x);
        const bid = id(o.id);
        const venue = id(o.venue);
        const d = date(o.date);
        if (!bid || !venue || !d) return null;
        return {
          id: bid,
          venue,
          slot: oneOf(o.slot, SLOTS, 'peak'),
          minutes: oneOf(o.minutes, SET_LENGTHS, 20),
          pay: int(o.pay, 0, 1e7, 0),
          expectation: str(o.expectation, 120),
          objective: str(o.objective, 120),
          date: d,
          status: oneOf(o.status, BOOKING_STATUS, 'offered'),
        };
      }),
    };
  },
};

/** every saved kind, for erase-all and the debug menu */
export const ALL_SPECS = [PROFILE, PROGRESS, LOOKS, BOARDS, CRATES, RECORDINGS, BOOKINGS] as const;
