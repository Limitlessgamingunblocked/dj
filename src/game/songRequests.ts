/*
 * Song requests from the crowd: someone on the floor shouts for a track from
 * your library. The game shortlists tracks that would work next (the coach's
 * picks, plus a couple of wildcards), and the AI (core/ai.ts) plays a person
 * in tonight's crowd: it picks one, says who they are and writes what they
 * shout and what's on their cardboard sign. Without the AI, the crowd's own
 * lines below do the same job.
 *
 * Pure: the prompt in, the reply out, checked. The app layer makes the call.
 */
import { isBlocked } from '../name/filter';

export interface SongCandidate {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  genre?: string;
}

export interface SongAsk {
  trackId: string;
  title: string;
  artist: string;
  /** who's asking: "Hen do bride", "Bucket hat lad" */
  who: string;
  /** what they shout */
  shout: string;
  /** their cardboard sign, in capitals */
  sign: string;
  /** the AI wrote it (or the built-in lines did) */
  ai: boolean;
}

export interface AskContext {
  venue: string;
  /** the set's slot when it's a gig: warm-up, peak, closing… */
  slot?: string;
  /** 0..1 */
  vibe: number;
  djName: string;
  playing: { title: string; artist: string; bpm: number; genre?: string } | null;
  /** who asked recently, so tonight's crowd isn't one person */
  recent: string[];
}

export const SHOUT_MAX = 110;
export const SIGN_MAX = 22;
export const WHO_MAX = 28;

/** the crowd's own people and lines, for when there's no AI */
const PEOPLE = [
  'Hen do bride',
  'Bucket hat lad',
  'Girl on shoulders',
  'Birthday girl',
  'Raver in shades',
  'Front row regular',
  'Glitter twins',
  'First-timer',
  'Guy at the bar',
  'Night bus crew',
  'Fan with a sign',
  'Stag do best man',
  'Couple by the speakers',
  'Hi-vis dancer',
  'Kandi kid',
];

const LINES = [
  'Any chance of {title}?! Please please please',
  'PLAY {TITLE}!!',
  'It’s my birthday! Can you play {title}?',
  '{artist}! Go on, play {title}!',
  'I came all this way for {title}',
  'Drop {title} next, it’ll go off',
  'Have you got {title}? My mate LOVES it',
  '{title} would be MASSIVE right now',
  'Oi DJ! {title}! Trust me!',
  'We’ve been waiting all night for {title}',
  'One request: {title}. That’s all I ask',
  'If you play {title} I’ll dance on the speaker',
];

const SIGNS = ['{T}?!', '{T} PLZ', 'PLAY {T}!', '{T} NEXT!', '♥ {T} ♥'];

const SOFT_TRACK = /\s*[([](original|extended|radio|club|album)?\s*(mix|edit|version)?[)\]]\s*$/i;

/** a title the crowd would shout: no "(Original Mix)" tails */
export function shoutTitle(title: string): string {
  const t = title.replace(SOFT_TRACK, '').trim();
  return t || title.trim();
}

function knownArtist(a: string): boolean {
  const s = a.trim().toLowerCase();
  return !!s && s !== 'unknown' && s !== 'unknown artist';
}

function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const sp = head.lastIndexOf(' ');
  return (sp > max * 0.6 ? head.slice(0, sp) : head).replace(/[\s,.;:!?–-]+$/, '') + '…';
}

export function signFor(title: string, rnd: () => number = Math.random): string {
  const t = shoutTitle(title).toUpperCase();
  const tpl = SIGNS[Math.floor(rnd() * SIGNS.length) % SIGNS.length];
  const room = SIGN_MAX - (tpl.length - 3);
  return tpl.replace('{T}', t.length > room ? cut(t, room) : t);
}

/** the crowd's own request, no AI: tracks near the top of the shortlist come up more */
export function builtInAsk(cands: SongCandidate[], ctx: Pick<AskContext, 'recent'>, rnd: () => number = Math.random): SongAsk | null {
  if (!cands.length) return null;
  const c = cands[Math.floor(rnd() * rnd() * cands.length) % cands.length];
  const people = PEOPLE.filter((p) => !ctx.recent.includes(p));
  const who = (people.length ? people : PEOPLE)[Math.floor(rnd() * (people.length || PEOPLE.length)) % (people.length || PEOPLE.length)];
  const lines = knownArtist(c.artist) ? LINES : LINES.filter((l) => !l.includes('{artist}'));
  const title = shoutTitle(c.title);
  const line = lines[Math.floor(rnd() * lines.length) % lines.length];
  const shout = line.replace('{title}', title).replace('{TITLE}', title.toUpperCase()).replace('{artist}', c.artist.trim());
  return { trackId: c.id, title: c.title, artist: c.artist, who, shout: cut(shout, SHOUT_MAX), sign: signFor(c.title, rnd), ai: false };
}

const SYSTEM = [
  'You write for the crowd in a DJ video game.',
  'Each time, you become one person in tonight’s crowd who shouts a song request at the DJ.',
  'Keep it fun, warm and PG: no swearing, nothing sexual, no insults, no real people except the track’s own artist.',
  'Answer with one JSON object and nothing else.',
].join(' ');

/** the chat for one request: a system line and the night so far */
export function requestPrompt(cands: SongCandidate[], ctx: AskContext): { role: 'system' | 'user'; content: string }[] {
  const mood = ctx.vibe > 0.85 ? 'losing their minds' : ctx.vibe > 0.6 ? 'dancing hard' : ctx.vibe > 0.35 ? 'warming up' : 'a bit flat';
  const now = ctx.playing ? `"${ctx.playing.title}"${knownArtist(ctx.playing.artist) ? ` by ${ctx.playing.artist}` : ''} (${Math.round(ctx.playing.bpm)} BPM${ctx.playing.genre ? `, ${ctx.playing.genre}` : ''})` : 'nothing yet';
  const list = cands.map((c, i) => `${i + 1}. "${shoutTitle(c.title)}"${knownArtist(c.artist) ? ` by ${c.artist}` : ''} (${Math.round(c.bpm)} BPM${c.genre ? `, ${c.genre}` : ''})`).join('\n');
  const user = [
    `Venue: ${ctx.venue}${ctx.slot ? `, ${ctx.slot} set` : ''}. DJ: ${ctx.djName || 'the DJ'}. The crowd is ${mood}.`,
    `Playing now: ${now}.`,
    'Tracks the DJ has with them:',
    list,
    ctx.recent.length ? `People who already asked tonight (be someone else): ${ctx.recent.join(', ')}.` : '',
    'Pick the one track a person in this crowd would shout for right now, decide who they are, and write their shout.',
    `Reply as JSON: {"pick": <track number>, "who": "<2 to 4 words, like Hen do bride>", "shout": "<under ${SHOUT_MAX - 20} characters, says the track's name>", "sign": "<their cardboard sign, under ${SIGN_MAX} characters, capitals>"}`,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}

function clean(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = v
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
    .trim();
  return cut(s, max);
}

/** a word the name filter refuses, leaving out the track's own title and artist; word by word, as the filter is built for names */
function rude(s: string, c: SongCandidate): boolean {
  const own = new Set(`${c.title} ${c.artist}`.toLowerCase().split(/[^\p{L}\p{N}']+/u));
  return s
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w && !own.has(w.toLowerCase()))
    .some((w) => isBlocked(w));
}

/** The AI's reply as a request, or null when it isn't usable (the built-in lines take over). */
export function parseRequest(text: string, cands: SongCandidate[]): SongAsk | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const n = typeof o.pick === 'number' ? o.pick : typeof o.pick === 'string' ? parseInt(o.pick, 10) : NaN;
  const c = Number.isInteger(n) ? cands[n - 1] : undefined;
  if (!c) return null;
  const who = clean(o.who, WHO_MAX);
  const shout = clean(o.shout, SHOUT_MAX);
  let sign = clean(o.sign, SIGN_MAX).toUpperCase();
  if (!who || !shout) return null;
  // the filter checks the AI's own words, not the track's name (a title can say anything)
  if (rude(who, c) || rude(shout, c) || rude(sign, c)) return null;
  if (!sign) sign = signFor(c.title);
  return { trackId: c.id, title: c.title, artist: c.artist, who, shout, sign, ai: true };
}

/** the shortlist: the best few for right now, and a wildcard or two from further down */
export function shortlist(ranked: SongCandidate[], rest: SongCandidate[], rnd: () => number = Math.random, n = 8): SongCandidate[] {
  const top = ranked.slice(0, Math.max(0, n - 2));
  const seen = new Set(top.map((c) => c.id));
  const pool = [...ranked.slice(top.length), ...rest].filter((c) => !seen.has(c.id));
  const out = top.slice();
  while (out.length < n && pool.length) {
    const c = pool.splice(Math.floor(rnd() * pool.length) % pool.length, 1)[0];
    if (!seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}
