/*
 * Set codes: a short code that carries a set, to paste to a friend. It holds
 * the venue, your DJ name, the tracklist (title, artist, BPM: the friend
 * plays it with their own copies of the tracks) and, in a crazy room, the
 * room's look and scene slots. Opening a code goes to the venue, sets the
 * room up and makes a crate of the tracks they have, in order, and lists the
 * ones they don't.
 *
 * Format: "DH1." + base64url of deflated JSON, or "DH0." + base64url of the
 * JSON where the browser can't compress.
 */

export interface SetTrack {
  title: string;
  artist: string;
  bpm: number;
}

export interface SetCode {
  v: 1;
  dj: string;
  venue: string;
  tracks: SetTrack[];
  /** a crazy room's look and its scene slots */
  room?: { look: unknown; scenes: unknown[] };
}

const MAX_TRACKS = 40;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** a set as data, trimmed to what a code carries */
export function cleanSetCode(raw: unknown): SetCode | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.venue !== 'string' || !Array.isArray(r.tracks)) return null;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const tracks = r.tracks
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({ title: str(t.title, 80), artist: str(t.artist, 60), bpm: typeof t.bpm === 'number' && Number.isFinite(t.bpm) ? Math.round(t.bpm * 10) / 10 : 0 }))
    .filter((t) => t.title)
    .slice(0, MAX_TRACKS);
  const room = typeof r.room === 'object' && r.room !== null ? (r.room as { look?: unknown; scenes?: unknown }) : null;
  return {
    v: 1,
    dj: str(r.dj, 24),
    venue: str(r.venue, 40),
    tracks,
    ...(room ? { room: { look: room.look ?? null, scenes: Array.isArray(room.scenes) ? room.scenes.slice(0, 4) : [] } } : {}),
  };
}

export async function encodeSetCode(set: SetCode): Promise<string> {
  const clean = cleanSetCode(set)!;
  // short keys: a code people paste
  const json = JSON.stringify({ v: 1, d: clean.dj, p: clean.venue, t: clean.tracks.map((t) => [t.title, t.artist, t.bpm]), r: clean.room });
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') {
    try {
      return `DH1.${b64url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
    } catch {
      /* fall through to the plain code */
    }
  }
  return `DH0.${b64url(bytes)}`;
}

export async function decodeSetCode(code: string): Promise<SetCode | null> {
  const c = code.trim().replace(/\s+/g, '');
  const m = /^DH([01])\.([A-Za-z0-9_-]+)$/.exec(c);
  if (!m) return null;
  try {
    let bytes = unb64url(m[2]);
    if (m[1] === '1') {
      if (typeof DecompressionStream !== 'function') return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    const o = JSON.parse(new TextDecoder().decode(bytes)) as { v: number; d: unknown; p: unknown; t: unknown[]; r?: unknown };
    return cleanSetCode({ v: o.v, dj: o.d, venue: o.p, tracks: Array.isArray(o.t) ? o.t.map((x) => (Array.isArray(x) ? { title: x[0], artist: x[1], bpm: x[2] } : null)) : [], room: o.r });
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** which of the code's tracks are in a library: by title and artist, then by title alone */
export function matchTracks<T extends { id: string; title: string; artist: string }>(want: SetTrack[], have: T[]): { found: T[]; missing: SetTrack[] } {
  const byBoth = new Map<string, T>();
  const byTitle = new Map<string, T>();
  for (const t of have) {
    byBoth.set(`${norm(t.title)}|${norm(t.artist)}`, t);
    if (!byTitle.has(norm(t.title))) byTitle.set(norm(t.title), t);
  }
  const found: T[] = [];
  const missing: SetTrack[] = [];
  for (const w of want) {
    const t = byBoth.get(`${norm(w.title)}|${norm(w.artist)}`) ?? byTitle.get(norm(w.title));
    if (t && !found.includes(t)) found.push(t);
    else missing.push(w);
  }
  return { found, missing };
}
