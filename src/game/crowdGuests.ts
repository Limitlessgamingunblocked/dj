/*
 * Join the crowd: friends on the floor of your set (app/jointhecrowd.ts runs
 * it, ui/CrowdGuest.ts is their page). Pure: the messages both sides send
 * (and checking what a guest sends, since it comes off the network), how a
 * friend's taps are judged against the tempo, how their hype builds and
 * fades, and where on the floor each of them stands.
 *
 * The taps are judged on the friend's own clock, by how evenly they land at
 * the track's tempo (a beat apart, or two, or half). Their audio is a stream
 * that arrives a moment late, so where the beat falls on the host's clock
 * says nothing about whether they're on it; keeping time with the music
 * they hear does.
 */
import type { Look } from '../core/models';
import { checkLook } from '../core/models';

/* ---------------- the messages ---------------- */

/** what a friend can do with their hands: the same moves the DJ's character does */
export type GuestMove = 'jump' | 'hands_up' | 'clap' | 'point' | 'fist_pump';
export const GUEST_MOVES: { id: GuestMove; label: string }[] = [
  { id: 'jump', label: 'Jump' },
  { id: 'hands_up', label: 'Hands up' },
  { id: 'clap', label: 'Clap' },
  { id: 'fist_pump', label: 'Fist pump' },
  { id: 'point', label: 'Point' },
];

/** where on the floor a friend dances */
export type SpotId = 'front-left' | 'front' | 'front-right' | 'middle-left' | 'middle' | 'middle-right' | 'back';
export const SPOTS: { id: SpotId; label: string; row: number; side: number }[] = [
  { id: 'front-left', label: 'Front left', row: 0, side: -1 },
  { id: 'front', label: 'Front, by the booth', row: 0, side: 0 },
  { id: 'front-right', label: 'Front right', row: 0, side: 1 },
  { id: 'middle-left', label: 'Middle left', row: 1, side: -1 },
  { id: 'middle', label: 'Middle of the floor', row: 1, side: 0 },
  { id: 'middle-right', label: 'Middle right', row: 1, side: 1 },
  { id: 'back', label: 'At the back', row: 2, side: 0 },
];

/** friend → you */
export type GuestMsg =
  | { t: 'hello'; name: string; look: Look | null; spot: SpotId }
  /** a tap on the beat, at the friend's own clock (ms) */
  | { t: 'tap'; at: number }
  | { t: 'move'; id: GuestMove }
  /** their LED sign held up (null puts it down) */
  | { t: 'sign'; text: string | null }
  | { t: 'request'; trackId: string }
  | { t: 'horn' }
  | { t: 'spot'; id: SpotId }
  /** the camera to their spot for a few bars */
  | { t: 'cam' }
  | { t: 'bye' };

export interface FloorTrack {
  id: string;
  title: string;
  artist: string;
}

export interface FloorState {
  dj: string;
  venue: string;
  track: string;
  bpm: number;
  playing: boolean;
  vibe: number;
  /** how deep into a build the music is (0..1): a drop's coming */
  build: number;
  you: { hype: number; groove: number; spot: SpotId; sign: string | null };
  friends: { name: string; hype: number }[];
  /** what you're allowed to do */
  horn: boolean;
  cam: boolean;
}

/** you → a friend */
export type HostMsg =
  | { t: 'welcome'; id: string; dj: string }
  | { t: 'state'; s: FloorState }
  /** the track dropped (jump!) */
  | { t: 'drop' }
  | { t: 'library'; tracks: FloorTrack[] }
  /** a line for them: their request played, the air horn's cooling down… */
  | { t: 'note'; text: string; tone?: 'good' | 'hype' | 'info' }
  | { t: 'bye'; why: string };

export const MAX_NAME = 18;
export const MAX_SIGN = 24;

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').replace(CONTROL, '').trim() : '';
  return [...s].slice(0, MAX_NAME).join('') || 'Friend';
}

/** an LED sign's words: one line, capitals, short enough to read from the booth */
export function cleanSign(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').replace(CONTROL, '').trim().toUpperCase();
  return s ? [...s].slice(0, MAX_SIGN).join('') : null;
}

const isSpot = (x: unknown): x is SpotId => SPOTS.some((s) => s.id === x);
const isMove = (x: unknown): x is GuestMove => GUEST_MOVES.some((m) => m.id === x);

/** what a friend sent, checked (anything else is dropped) */
export function parseGuestMsg(x: unknown): GuestMsg | null {
  if (typeof x !== 'object' || x === null) return null;
  const m = x as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return { t: 'hello', name: cleanName(m.name), look: m.look ? checkLook(m.look) : null, spot: isSpot(m.spot) ? m.spot : 'front' };
    case 'tap':
      return typeof m.at === 'number' && Number.isFinite(m.at) ? { t: 'tap', at: m.at } : null;
    case 'move':
      return isMove(m.id) ? { t: 'move', id: m.id } : null;
    case 'sign':
      return { t: 'sign', text: cleanSign(m.text) };
    case 'request':
      return typeof m.trackId === 'string' && m.trackId.length < 200 ? { t: 'request', trackId: m.trackId } : null;
    case 'spot':
      return isSpot(m.id) ? { t: 'spot', id: m.id } : null;
    case 'horn':
    case 'cam':
    case 'bye':
      return { t: m.t };
    default:
      return null;
  }
}

export function isHostMsg(x: unknown): x is HostMsg {
  return typeof x === 'object' && x !== null && typeof (x as { t?: unknown }).t === 'string';
}

/* ---------------- keeping time ---------------- */

/**
 * How well a run of taps keeps time at `bpm`, 0..1: each gap between taps
 * against the nearest of a half beat, a beat or two beats; a gap that fits
 * none of them breaks the run. Needs a few taps (the last 8 count).
 */
export function groove(taps: number[], bpm: number): number {
  if (!(bpm > 40) || taps.length < 3) return 0;
  const beat = 60000 / bpm;
  const recent = taps.slice(-9);
  let sum = 0;
  let n = 0;
  for (let i = 1; i < recent.length; i++) {
    const gap = recent[i] - recent[i - 1];
    if (gap <= 0) continue;
    let best = 1;
    for (const k of [0.5, 1, 2]) best = Math.min(best, Math.abs(gap - beat * k) / (beat * k));
    // within 5% of the beat is spot on; 15% off is another tempo
    sum += best <= 0.05 ? 1 : best >= 0.15 ? 0 : 1 - (best - 0.05) / 0.1;
    n++;
  }
  if (!n) return 0;
  // a short run counts for less until it's been going a bar or two
  return (sum / n) * Math.min(1, n / 6);
}

/* ---------------- hype ---------------- */

/** seconds after a drop reaches them that a jump still catches it (their stream is a little late) */
export const DROP_WINDOW = 3;

/**
 * One friend's hype, 0..1: it builds while they keep time and dance, jumps
 * when they catch a drop, and fades when they stop.
 */
export class GuestHype {
  hype = 0;
  groove = 0;
  private taps: number[] = [];
  private lastTapAt = -1e9;
  /** host seconds */
  private t = 0;
  private lastActive = -1e9;
  private dropAt = -1e9;
  private caught = true;
  /** how many drops they caught this set */
  drops = 0;

  /** a tap at the friend's clock (ms); false when it's too soon after the last one to count */
  tap(at: number): boolean {
    if (at - this.lastTapAt < 120) return false;
    // a long gap (or their clock jumped) starts a new run
    if (at - this.lastTapAt > 2500 || at < this.lastTapAt) this.taps = [];
    this.lastTapAt = at;
    this.taps.push(at);
    if (this.taps.length > 12) this.taps.shift();
    this.lastActive = this.t;
    return true;
  }

  /** a move: jumping just after a drop catches it (true) */
  move(id: GuestMove): boolean {
    this.lastActive = this.t;
    this.hype = Math.min(1, this.hype + 0.04);
    if (id === 'jump' && !this.caught && this.t - this.dropAt <= DROP_WINDOW) {
      this.caught = true;
      this.drops++;
      this.hype = Math.min(1, this.hype + 0.3);
      return true;
    }
    return false;
  }

  /** the track dropped */
  drop(): void {
    this.dropAt = this.t;
    this.caught = false;
  }

  update(dt: number, bpm: number): void {
    this.t += dt;
    this.groove = this.t - this.lastActive < 3 ? groove(this.taps, bpm) : 0;
    const idle = this.t - this.lastActive;
    // keeping time lifts it towards how well they're doing it; doing nothing lets it fall
    if (this.groove > 0.2) this.hype += (Math.max(this.hype, this.groove) - this.hype) * Math.min(1, dt * 0.35) + dt * 0.01 * this.groove;
    else if (idle > 4) this.hype -= dt * (idle > 15 ? 0.06 : 0.025);
    this.hype = Math.max(0, Math.min(1, this.hype));
  }

  /** dancing (not stood still) */
  get active(): boolean {
    return this.t - this.lastActive < 6;
  }
}

/**
 * How much the friends on the floor lift the vibe meter per second: a
 * little for each of them with their hype up, with a ceiling so a full room
 * of friends helps without carrying a bad set.
 */
export function friendLift(hypes: number[]): number {
  let sum = 0;
  for (const h of hypes) sum += Math.max(0, h - 0.25);
  return 0.006 * Math.min(2.5, sum);
}

/* ---------------- rate limits ---------------- */

/** a cooldown per friend and kind (air horn, the camera) */
export class Cooldowns {
  private at = new Map<string, number>();
  constructor(private seconds: Record<string, number>) {}

  /** true (and the clock starts) when it's allowed now */
  take(kind: string, who: string, now: number): boolean {
    const key = `${kind}:${who}`;
    const s = this.seconds[kind] ?? 0;
    const last = this.at.get(key);
    if (last !== undefined && now - last < s) return false;
    this.at.set(key, now);
    return true;
  }

  /** seconds until it's allowed again */
  left(kind: string, who: string, now: number): number {
    const last = this.at.get(`${kind}:${who}`);
    return last === undefined ? 0 : Math.max(0, (this.seconds[kind] ?? 0) - (now - last));
  }
}

/* ---------------- where they stand ---------------- */

/**
 * Where a friend stands, as an angle off the line from the booth to the
 * crowd (radians, + to the crowd's right) and a distance from the booth (m).
 * `nth` is how many friends already stand at the same spot: they gather
 * round it, not on top of each other.
 */
export function spotPlace(id: SpotId, nth: number, front: number): { angle: number; radius: number } {
  const s = SPOTS.find((x) => x.id === id) ?? SPOTS[1];
  const radius = front + s.row * 1.5;
  // the same width on the floor at every row: a narrower angle further back
  const across = s.side * 1.6;
  const ring = [
    [0, 0],
    [0.65, 0.2],
    [-0.65, 0.2],
    [0.35, 0.75],
    [-0.35, 0.75],
    [1.0, 0.7],
    [-1.0, 0.7],
  ];
  const [dx, dr] = ring[nth % ring.length];
  const extra = Math.floor(nth / ring.length) * 0.9;
  const r = radius + dr + extra;
  return { angle: (across + dx) / r, radius: r };
}
