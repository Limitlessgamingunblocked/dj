/*
 * The launch cutscene's clock: one night out, cut to a deep minimal groove at
 * 124 BPM. Every cut lands on a bar line, so the pictures and the music are
 * planned in bars here and nowhere else.
 *
 *   street   the ride across town in the rain, the club's music on the radio
 *   door     outside the club, the kick through the wall (loops while the game loads)
 *   open     the door opens: the filter sweeps open with it
 *   inside   the room: the crowd, hands on the decks, the DJ, then a break
 *   title    the drop, the name, and the groove carries on under the title screen
 *
 * The full cut plays on the first launch; later launches open on the door and
 * go straight to the break (about eight seconds once the game is ready).
 * Pure maths, no DOM: the worker drawing the street and the door reads it too.
 */

export const BPM = 124;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

/** bars of each part of the score */
export const BARS = {
  street: 8,
  /** the door loop's length (it repeats until the game's ready) */
  door: 2,
  open: 1,
  inside: 8,
  /** the title loop's length */
  title: 4,
} as const;

/** the bar of `inside` the break starts on (the short cut starts here) */
export const BREAK_BAR = 6;

export type Cut = 'full' | 'short';
export type Part = 'street' | 'door' | 'open' | 'inside' | 'title';

/** the shots inside, by bar of `inside` (each runs until the next) */
export const INSIDE_SHOTS = [
  { bar: 0, id: 'crowd' },
  { bar: 2, id: 'hands' },
  { bar: 4, id: 'hero' },
  { bar: BREAK_BAR, id: 'pullback' },
] as const;
export type InsideShot = (typeof INSIDE_SHOTS)[number]['id'];

/** the least time on the door before it opens (bars): the full cut lets it breathe */
export function doorMinBars(cut: Cut): number {
  return cut === 'full' ? 2 : 1;
}

/** where the street ends and the door starts (seconds into the intro) */
export function doorStart(cut: Cut): number {
  return cut === 'full' ? BARS.street * BAR : 0;
}

/**
 * When the door opens: the first bar line of the door loop at least `lead`
 * seconds from now (time to schedule the sweep) and at least the cut's minimum
 * time on the door.
 */
export function openTime(cut: Cut, now: number, lead = 0.25): number {
  const d0 = doorStart(cut);
  const earliest = Math.max(now + lead, d0 + doorMinBars(cut) * BAR);
  return d0 + Math.ceil((earliest - d0) / BAR - 1e-6) * BAR;
}

/** the timeline from the door opening on: where each part starts, and where inside starts playing from */
export interface Timeline {
  open: number;
  inside: number;
  /** seconds into the `inside` part the picture and music start from (the short cut joins at the break) */
  insideFrom: number;
  title: number;
}

export function timeline(cut: Cut, open: number): Timeline {
  const inside = open + BARS.open * BAR;
  const fromBar = cut === 'full' ? 0 : BREAK_BAR;
  return { open, inside, insideFrom: fromBar * BAR, title: inside + (BARS.inside - fromBar) * BAR };
}

/** the shot playing at `t` seconds into `inside`, and how far through it (0..1) */
export function shotAt(t: number): { id: InsideShot; index: number; u: number; start: number; length: number } {
  let i = 0;
  for (let k = 0; k < INSIDE_SHOTS.length; k++) if (t >= INSIDE_SHOTS[k].bar * BAR - 1e-6) i = k;
  const start = INSIDE_SHOTS[i].bar * BAR;
  const end = (i + 1 < INSIDE_SHOTS.length ? INSIDE_SHOTS[i + 1].bar : BARS.inside) * BAR;
  return { id: INSIDE_SHOTS[i].id, index: i, start, length: end - start, u: Math.min(1, Math.max(0, (t - start) / (end - start))) };
}

/** the beat position (in beats from the intro's start) at time t: the music never stops counting */
export function beatAt(t: number): number {
  return t / BEAT;
}

/** a kick's envelope at time t: 1 on the beat, falling away fast (the door's light leak, the lamp flicker) */
export function kickEnv(t: number, decay = 7): number {
  const ph = ((t / BEAT) % 1 + 1) % 1;
  return Math.exp(-ph * BEAT * decay);
}
