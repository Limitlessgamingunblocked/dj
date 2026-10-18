/*
 * Ghost duels: send a finished set to a friend as a code (or a link), and
 * they play the same night against your ghost. Nobody has to be online at the
 * same time: the code carries everything the duel needs.
 *   – the night: a daily's date (its venue, slot, twist and objectives come
 *     from the date) or a venue, slot and length
 *   – your run: the score, the grade and the room's vibe and your score through
 *     the set, which run as a ghost on their vibe meter, ahead or behind live
 *   – the tracklist (title, artist, BPM), so they can make a crate of the ones
 *     they have
 * When they finish, their results show both lines and who won, and they can
 * send their run back for a rematch.
 *
 * Format: "DG1." + base64url of deflated JSON, or "DG0." + base64url of the
 * JSON where the browser can't compress. The run is resampled onto an even
 * grid (every few seconds) so a long set still makes a code people can paste.
 *
 * Pure: the app plays the night and shows the screens.
 */
import { b64url, pipe, unb64url, type SetTrack } from './setcode';
import type { Ghost, GhostPoint } from './ghost';
import { ghostAt } from './ghost';
import { SLOTS, type SlotId } from './vibe';

export interface Duel {
  v: 1;
  /** who played it */
  dj: string;
  /** the daily it was played on (YYYY-MM-DD), or null: a set at a venue */
  daily: string | null;
  venue: string;
  slot: SlotId;
  minutes: number;
  score: number;
  grade: string;
  /** the run: [set seconds, vibe 0..1, score] */
  pts: GhostPoint[];
  tracks: SetTrack[];
  /** a rematch: the score of the run this one answered */
  answers?: number;
}

const MAX_TRACKS = 40;
/** the most samples a code carries (a 60-minute set is every 15 s) */
const MAX_SAMPLES = 240;
const GRADES = ['S', 'A', 'B', 'C', 'D'];

/** the duel's run as a ghost, for the meter and the live points */
export function duelGhost(d: Duel): Ghost {
  return { key: d.daily ?? `duel:${d.venue}`, score: d.score, grade: d.grade, pts: d.pts };
}

/** a duel as data, checked field by field (a pasted or hand-edited code can't break the game) */
export function cleanDuel(raw: unknown): Duel | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.venue !== 'string' || !r.venue || !Array.isArray(r.pts)) return null;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const slot = (typeof r.slot === 'string' && r.slot in SLOTS ? r.slot : 'peak') as SlotId;
  const minutes = Math.round(num(r.minutes));
  if (minutes < 1 || minutes > 120) return null;
  const pts = r.pts
    .filter((x): x is number[] => Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number' && Number.isFinite(n)))
    .map((x): GhostPoint => [Math.max(0, Math.min(minutes * 60 + 600, x[0])), Math.max(0, Math.min(1, x[1])), Math.max(0, Math.round(x[2]))])
    .sort((a, b) => a[0] - b[0])
    .slice(0, 2000);
  if (pts.length < 2) return null;
  const tracks = Array.isArray(r.tracks)
    ? r.tracks
        .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
        .map((t) => ({ title: str(t.title, 80), artist: str(t.artist, 60), bpm: typeof t.bpm === 'number' && Number.isFinite(t.bpm) ? Math.round(t.bpm * 10) / 10 : 0 }))
        .filter((t) => t.title)
        .slice(0, MAX_TRACKS)
    : [];
  const daily = typeof r.daily === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.daily) ? r.daily : null;
  const score = Math.max(0, Math.round(num(r.score) || pts[pts.length - 1][2]));
  return {
    v: 1,
    dj: str(r.dj, 24),
    daily,
    venue: str(r.venue, 40),
    slot,
    minutes,
    score,
    grade: GRADES.includes(r.grade as string) ? (r.grade as string) : '',
    pts,
    tracks,
    ...(typeof r.answers === 'number' && Number.isFinite(r.answers) && r.answers >= 0 ? { answers: Math.round(r.answers) } : {}),
  };
}

/** the run on an even grid of `step` seconds, ending on its last sample */
export function resample(pts: GhostPoint[]): { step: number; end: number; vibe: number[]; score: number[] } {
  const end = pts.length ? pts[pts.length - 1][0] : 0;
  const step = Math.max(2, Math.ceil(end / (MAX_SAMPLES - 1)));
  const g: Ghost = { key: '', score: 0, grade: '', pts };
  const n = Math.ceil(end / step);
  const vibe: number[] = [];
  const score: number[] = [];
  for (let i = 0; i <= n; i++) {
    const at = ghostAt(g, Math.min(end, i * step));
    vibe.push(Math.round((at?.vibe ?? 0) * 100));
    score.push(at?.score ?? 0);
  }
  return { step, end: Math.round(end * 10) / 10, vibe, score };
}

export async function encodeDuel(duel: Duel): Promise<string> {
  const d = cleanDuel(duel);
  if (!d) throw new Error('not a duel');
  const s = resample(d.pts);
  // short keys and score steps (not totals): a code people paste
  const json = JSON.stringify({
    v: 1,
    d: d.dj,
    k: d.daily,
    p: d.venue,
    s: d.slot,
    m: d.minutes,
    c: d.score,
    g: d.grade,
    e: s.step,
    l: s.end,
    vb: s.vibe,
    sc: s.score.map((x, i) => (i ? x - s.score[i - 1] : x)),
    t: d.tracks.map((t) => [t.title, t.artist, t.bpm]),
    a: d.answers,
  });
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') {
    try {
      return `DG1.${b64url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
    } catch {
      /* fall through to the plain code */
    }
  }
  return `DG0.${b64url(bytes)}`;
}

/** the code inside a pasted code or link (…#duel=DG1.…), or null */
export function findDuelCode(text: string): string | null {
  const m = /DG[01]\.[A-Za-z0-9_-]+/.exec(text.replace(/\s+/g, ''));
  return m ? m[0] : null;
}

export async function decodeDuel(text: string): Promise<Duel | null> {
  const code = findDuelCode(text);
  if (!code) return null;
  try {
    let bytes = unb64url(code.slice(4));
    if (code[2] === '1') {
      if (typeof DecompressionStream !== 'function') return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    const o = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const step = typeof o.e === 'number' && o.e > 0 ? o.e : 2;
    const end = typeof o.l === 'number' ? o.l : 0;
    const vb = Array.isArray(o.vb) ? o.vb : [];
    const sc = Array.isArray(o.sc) ? o.sc : [];
    let total = 0;
    const pts: unknown[] = vb.slice(0, 2000).map((v, i) => {
      total += typeof sc[i] === 'number' ? (sc[i] as number) : 0;
      return [Math.min(end, i * step), typeof v === 'number' ? v / 100 : 0, total];
    });
    return cleanDuel({
      v: o.v,
      dj: o.d,
      daily: o.k,
      venue: o.p,
      slot: o.s,
      minutes: o.m,
      score: o.c,
      grade: o.g,
      pts,
      tracks: Array.isArray(o.t) ? o.t.map((x) => (Array.isArray(x) ? { title: x[0], artist: x[1], bpm: x[2] } : null)) : [],
      answers: o.a,
    });
  } catch {
    return null;
  }
}

/** a link that opens the duel (where the game runs from a web address) */
export function duelLink(base: string, code: string): string {
  return `${base.replace(/#.*$/, '')}#duel=${code}`;
}

export interface DuelOutcome {
  /** you won, they won, or level */
  result: 'won' | 'lost' | 'draw';
  /** how many points between you */
  margin: number;
  /** where you were furthest ahead and furthest behind on points (positive: you ahead) */
  bestLead: number;
  worstLead: number;
}

/** who won: the final scores; and how the race went, from both runs' samples */
export function duelOutcome(you: { score: number; pts: GhostPoint[] }, them: Duel): DuelOutcome {
  const margin = you.score - them.score;
  const g = duelGhost(them);
  let bestLead = 0;
  let worstLead = 0;
  for (const p of you.pts) {
    const at = ghostAt(g, p[0]);
    if (!at) continue;
    const lead = p[2] - at.score;
    bestLead = Math.max(bestLead, lead);
    worstLead = Math.min(worstLead, lead);
  }
  // the finish counts too (the last points can land after the last sample)
  return { result: margin > 0 ? 'won' : margin < 0 ? 'lost' : 'draw', margin: Math.abs(margin), bestLead: Math.max(bestLead, margin), worstLead: Math.min(worstLead, margin) };
}

/** the duel's outcome as a line to paste back to the friend */
export function duelShareText(o: { you: string; them: string; venueName: string; yourScore: number; theirScore: number; outcome: DuelOutcome }): string {
  const fmt = (n: number) => n.toLocaleString('en-GB');
  const head = o.outcome.result === 'won' ? `👻 I beat ${o.them}'s ghost` : o.outcome.result === 'lost' ? `👻 ${o.them}'s ghost beat me` : `👻 Dead level with ${o.them}'s ghost`;
  return [`${head} at ${o.venueName}`, `${o.you} ${fmt(o.yourScore)} · ${o.them} ${fmt(o.theirScore)}`].join('\n');
}
