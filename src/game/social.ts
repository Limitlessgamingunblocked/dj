/*
 * The social feed (Section 9.6): a made-up social app on the phone in your
 * hub. Fictional fans post about your sets with your name and handle, the
 * promoters and the papers chime in, and the clips you save (Sections
 * 11–12) go up as posts with likes and comments. Likes and replies scale
 * with your followers; how good the set was decides what they say.
 *
 * Pure: the app keeps the posts in the career's feed save.
 */
import type { FeedSave, Post, PostComment } from '../core/models';
import type { SetSummary } from './progression';

type Rng = () => number;
const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];

/* fictional fans: first names and made-up handles (no real accounts) */
const FIRST = ['Bex', 'Nico', 'Jas', 'Priya', 'Tomas', 'Lena', 'Kofi', 'Mei', 'Sam', 'Rosa', 'Theo', 'Aisha', 'Dev', 'Ines', 'Callum', 'Yuki', 'Marta', 'Obi', 'Freya', 'Luca', 'Zara', 'Ben', 'Noor', 'Iggy'];
const HANDLE_A = ['night', 'bass', 'vinyl', 'sub', 'strobe', 'last', 'late', 'deep', 'neon', 'warehouse', 'afters', 'kick', 'groove', 'rave'];
const HANDLE_B = ['bus', 'head', 'kid', 'owl', 'queen', 'lad', 'gremlin', 'diaries', 'tapes', 'mode', 'rat', 'fan', 'heart', 'shoes'];

export interface Fan {
  author: string;
  handle: string;
}

/** a made-up fan (the same seed gives the same person) */
export function fan(r: Rng): Fan {
  const author = pick(r, FIRST);
  return { author, handle: `@${pick(r, HANDLE_A)}_${pick(r, HANDLE_B)}${r() < 0.4 ? Math.floor(r() * 99) : ''}` };
}

/** your own handle, from your DJ name */
export function handleFor(dj: string): string {
  const h = dj
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 18);
  return `@${h || 'dj'}`;
}

/** likes for a post: grows with followers, and with how good it was (0..1) */
export function likesFor(followers: number, quality: number, r: Rng): number {
  const reach = 3 + Math.pow(Math.max(0, followers), 0.82) * 0.09;
  return Math.max(0, Math.round(reach * (0.4 + quality * 1.2) * (0.75 + r() * 0.5)));
}

const GREAT = [
  '{name} at {venue} last night. Still not over it.',
  'Whoever booked {name} for {venue}: thank you. Unreal.',
  'That {name} set. I need the tracklist. All of it.',
  'Lost my voice at {venue}. Worth it. {name} 🔥',
  '{name} read that room like a book. Every blend was butter.',
];
const GOOD = [
  'Solid set from {name} at {venue}, great vibes all night.',
  '{name} at {venue}: proper dancing music. More of this please.',
  'Didn’t know {name} before tonight. Following now.',
  'Big night at {venue}. {name} kept it moving.',
];
const MEH = [
  '{name} at {venue} was ok. Got going in the end.',
  'Bit of a slow one from {name} tonight, the last half hour was good though.',
  '{venue} was quiet but {name} played some bits.',
];
const ROUGH = [
  'Rough night for {name} at {venue}. We’ve all been there.',
  'Couple of trainwrecks from {name} tonight 😬 still went home happy',
];
const MOMENTS: [keyof SetSummary | 'encore' | 'bass' | 'blend' | 'perfect', string][] = [
  ['encore', 'They made {name} play an encore. ONE MORE TUNE!'],
  ['bass', '{name}’s bass swaps tonight were filthy. Clean as anything.'],
  ['blend', 'That long blend from {name} at {venue}. Couldn’t tell where one track ended.'],
  ['perfect', 'The transition at {venue} tonight. {name} doesn’t miss.'],
];
const CLIP_TEXT = [
  'Caught this at {venue} 🎥',
  'This moment at {venue}. Sound on.',
  'POV: {venue}, {name} on the decks',
  'Can’t stop watching this one',
];
const COMMENTS_GOOD = ['the energy 🔥', 'need this track ID', 'I was there!!', 'goosebumps', 'that drop though', 'when’s the next one?', 'this is the one', 'tune'];
const COMMENTS_MEH = ['decent', 'nice one', 'was a vibe', 'more of this'];

export interface NewPost extends Omit<Post, 'id' | 'date'> {}

const fill = (t: string, dj: string, venue: string) => t.replace(/\{name\}/g, dj).replace(/\{venue\}/g, venue);

function comments(n: number, good: boolean, r: Rng): PostComment[] {
  const out: PostComment[] = [];
  for (let i = 0; i < n; i++) out.push({ ...fan(r), text: pick(r, good ? COMMENTS_GOOD : COMMENTS_MEH) });
  return out;
}

/**
 * What people post after a set: two to four fans (what they say follows the
 * grade and the set's best bits), a word from the promoter for a big night,
 * and the story moment if one happened.
 */
export function postsForSet(o: { summary: SetSummary; dj: string; venueName: string; venue: string; followers: number; story?: string | null; moment?: string | null }, r: Rng): NewPost[] {
  const s = o.summary;
  const q = { S: 1, A: 0.85, B: 0.65, C: 0.4, D: 0.15 }[s.grade];
  const pool = s.grade === 'S' || s.grade === 'A' ? GREAT : s.grade === 'B' ? GOOD : s.grade === 'C' ? MEH : ROUGH;
  const n = s.grade === 'D' ? 1 : s.grade === 'C' ? 2 : s.grade === 'B' ? 3 : 4;
  const out: NewPost[] = [];
  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    let t = pick(r, pool);
    for (let k = 0; k < 4 && used.has(t); k++) t = pick(r, pool);
    used.add(t);
    out.push({ kind: 'fan', ...fan(r), text: fill(t, o.dj, o.venueName), likes: likesFor(o.followers, q, r), comments: comments(Math.floor(r() * 3 * q), q > 0.5, r), clip: null, venue: o.venue });
  }
  // the set's best bits
  const bits: string[] = [];
  if (s.encore) bits.push('encore');
  if (s.bassSwaps >= 3) bits.push('bass');
  if (s.longBlends >= 2) bits.push('blend');
  if (s.perfect >= 2) bits.push('perfect');
  if (bits.length && q >= 0.5) {
    const b = pick(r, bits);
    const t = MOMENTS.find(([k]) => k === b)![1];
    out.push({ kind: 'fan', ...fan(r), text: fill(t, o.dj, o.venueName), likes: likesFor(o.followers, q, r), comments: comments(1 + Math.floor(r() * 2), true, r), clip: null, venue: o.venue });
  }
  if (o.moment) out.push({ kind: 'fan', ...fan(r), text: fill(`${o.moment} at {venue}. {name}, what was that 😭`, o.dj, o.venueName), likes: likesFor(o.followers, 1, r) * 2, comments: comments(3, true, r), clip: null, venue: o.venue });
  if (q >= 0.85) out.push({ kind: 'promoter', author: `${o.venueName}`, handle: handleFor(o.venueName), text: fill('What a night. Thank you {name}. Back soon? 👀', o.dj, o.venueName), likes: likesFor(o.followers, q, r), comments: [], clip: null, venue: o.venue });
  if (o.story) out.push({ kind: 'news', author: 'Night Notes', handle: '@nightnotes', text: fill(o.story, o.dj, o.venueName), likes: likesFor(o.followers, 0.8, r), comments: comments(2, true, r), clip: null, venue: null });
  return out;
}

/** a clip you saved, posted from your account */
export function clipPost(o: { dj: string; venueName: string; venue: string; followers: number; clip: string }, r: Rng): NewPost {
  return { kind: 'clip', author: o.dj, handle: handleFor(o.dj), text: fill(pick(r, CLIP_TEXT), o.dj, o.venueName), likes: likesFor(o.followers, 0.9, r) * 3, comments: comments(2 + Math.floor(r() * 3), true, r), clip: o.clip, venue: o.venue };
}

/** add posts to the top of the feed (newest first), keeping the last `keep` */
export function addPosts(save: FeedSave, posts: NewPost[], now: Date, keep = 80): FeedSave {
  let seq = save.seq;
  const fresh: Post[] = posts.map((p, i) => ({ ...p, id: `post${seq++}`, date: new Date(now.getTime() - i * 60_000).toISOString() }));
  return { seq, posts: [...fresh, ...save.posts].slice(0, keep) };
}
