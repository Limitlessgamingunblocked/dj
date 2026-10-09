/*
 * The career (Section 9): fame tiers and the venues they open, what each
 * venue pays, the reputation your playing earns, milestones and their
 * rewards, and something new every set or two.
 *
 *   tier  fame   opens
 *   1     0      Bedroom → Basement (after your first set)
 *   2     150    Rooftop Bar
 *   3     550    Warehouse Rave
 *   4     1300   Beach Club Terrace
 *   5     2700   Boat Party offers, B2B with rivals
 *   6     5200   Main-Stage Festival
 *   7     9500   Sunrise Closing Set ("max": the ending, replayable forever)
 *
 * Everything here is plain data in, plain data out: the gig director calls
 * applySet() at the end of a set and saves what comes back.
 */
import { HAIR, ITEMS, OUTFIT_SETS, type Unlock } from '../character/catalog';
import { owned } from '../character/look';
import type { Progress, Reputation } from '../core/models';
import type { Grade, SlotId, VibeEvent } from './vibe';

export const CAREER_VENUES = ['bedroom', 'basement', 'rooftop', 'warehouse', 'beach', 'boat', 'festival', 'sunrise'] as const;
export type CareerVenue = (typeof CAREER_VENUES)[number];

export interface VenueCareer {
  name: string;
  /** the fame tier that opens it */
  tier: number;
  capacity: number;
  /** what a set there is worth, against the Basement */
  pay: { fame: number; cash: number; followers: number };
}

export const CAREER: Record<CareerVenue, VenueCareer> = {
  bedroom: { name: 'Bedroom stream', tier: 1, capacity: 50, pay: { fame: 0.5, cash: 0.2, followers: 1.4 } },
  basement: { name: 'Basement Club', tier: 1, capacity: 80, pay: { fame: 1, cash: 1, followers: 1 } },
  rooftop: { name: 'Rooftop Bar', tier: 2, capacity: 250, pay: { fame: 1.6, cash: 1.8, followers: 1.3 } },
  warehouse: { name: 'Warehouse Rave', tier: 3, capacity: 1500, pay: { fame: 2.6, cash: 2.4, followers: 1.8 } },
  beach: { name: 'Beach Club Terrace', tier: 4, capacity: 2000, pay: { fame: 3.4, cash: 3.6, followers: 2.4 } },
  boat: { name: 'Boat Party', tier: 5, capacity: 400, pay: { fame: 3.8, cash: 4, followers: 3 } },
  festival: { name: 'Main-Stage Festival', tier: 6, capacity: 40000, pay: { fame: 6, cash: 6, followers: 5 } },
  sunrise: { name: 'Sunrise Closing Set', tier: 7, capacity: 10000, pay: { fame: 6, cash: 5, followers: 5 } },
};
/** the real rooms in free play */
const FREE_PLAY_PAY = { fame: 1.5, cash: 1.5, followers: 1.5 };

export const isCareerVenue = (id: string): id is CareerVenue => (CAREER_VENUES as readonly string[]).includes(id);

/** fame needed for each tier (index = tier − 1) */
export const TIER_FAME = [0, 150, 550, 1300, 2700, 5200, 9500];
export const TIER_NAMES = ['Bedroom DJ', 'Local', 'Rising', 'Club regular', 'Resident', 'Headliner', 'Legend'];

export function tierFor(fame: number): number {
  let t = 1;
  for (let i = 1; i < TIER_FAME.length; i++) if (fame >= TIER_FAME[i]) t = i + 1;
  return t;
}

/** fame still needed for the next tier (null at the top) */
export function toNextTier(p: Pick<Progress, 'fame' | 'tier'>): number | null {
  return p.tier >= TIER_FAME.length ? null : Math.max(0, TIER_FAME[p.tier] - p.fame);
}

/** why a venue is closed to you (null: it's open) */
export function venueLock(id: string, p: Pick<Progress, 'tier' | 'setsPlayed' | 'unlocked' | 'sandbox'>): string | null {
  if (p.sandbox || !isCareerVenue(id)) return null;
  if (id === 'basement') return p.setsPlayed < 1 ? 'Play a set in the Bedroom first' : null;
  if (id === 'boat') {
    if (p.unlocked.includes('venue:boat')) return null;
    return p.tier < 5 ? 'Fame tier 5 brings a boat party offer' : 'Play the boat party booking offer';
  }
  const need = CAREER[id].tier;
  return p.tier < need ? `Fame tier ${need} (${TIER_NAMES[need - 1]})` : null;
}

/* ------------------------------------------------------------------ */
/* a set, summed up                                                     */
/* ------------------------------------------------------------------ */

export interface SetSummary {
  venue: string;
  slot: SlotId;
  minutes: number;
  grade: Grade;
  /** average vibe 0..1 */
  average: number;
  encore: boolean;
  /** played (nearly) to the end */
  full: boolean;
  transitions: number;
  bassSwaps: number;
  longBlends: number;
  filterFades: number;
  echoOuts: number;
  perfect: number;
  keyMixes: number;
  drops: number;
  mistakes: number;
  /** how closely the room's energy followed the slot, 0..1 */
  slotMatch: number;
  avgEnergy: number;
  /** a full minute at 100 % */
  fullMinute: boolean;
  /** the highest vibe reached */
  peakVibe: number;
  board: string;
}

type Timeline = { t: number; vibe: number; energy: number; target: number }[];

/** what a set adds up to, from the vibe meter's log and timeline */
export function summarize(o: { venue: string; slot: SlotId; minutes: number; grade: Grade; average: number; encore: boolean; full: boolean; fullMinute: boolean; peakVibe: number; board: string; log: VibeEvent[]; timeline: Timeline }): SetSummary {
  const tr = o.log.filter((e): e is Extract<VibeEvent, { kind: 'transition' }> => e.kind === 'transition');
  const count = (name: string) => tr.filter((e) => e.name === name).length;
  const tl = o.timeline.filter((p) => p.energy > 0.02);
  const slotMatch = tl.length ? 1 - tl.reduce((s, p) => s + Math.abs(p.energy - p.target), 0) / tl.length : 0;
  const avgEnergy = tl.length ? tl.reduce((s, p) => s + p.energy, 0) / tl.length : 0;
  return {
    venue: o.venue,
    slot: o.slot,
    minutes: o.minutes,
    grade: o.grade,
    average: o.average,
    encore: o.encore,
    full: o.full,
    transitions: tr.length,
    bassSwaps: count('bass_swap'),
    longBlends: count('long_blend'),
    filterFades: count('filter_fade'),
    echoOuts: count('echo_out'),
    perfect: tr.filter((e) => e.band === 'perfect' && e.name !== 'quick_cut').length,
    keyMixes: tr.filter((e) => e.keyBonus).length,
    drops: o.log.filter((e) => e.kind === 'drop').length,
    mistakes: o.log.filter((e) => e.kind === 'mistake').length,
    slotMatch: Math.max(0, Math.min(1, slotMatch)),
    avgEnergy,
    fullMinute: o.fullMinute,
    peakVibe: o.peakVibe,
    board: o.board,
  };
}

/* ------------------------------------------------------------------ */
/* rewards                                                              */
/* ------------------------------------------------------------------ */

const GRADE_FAME: Record<Grade, number> = { S: 70, A: 48, B: 30, C: 15, D: 5 };
const GRADE_PAY: Record<Grade, number> = { S: 1.3, A: 1.15, B: 1, C: 0.85, D: 0.6 };

export interface Rewards {
  fame: number;
  cash: number;
  followers: number;
}

/** what a set earns; a booking pays its fee (scaled by how it went), and a met objective adds a quarter */
export function rewardsFor(grade: Grade, venue: string, minutes: number, encore: boolean, booking?: { pay: number; met: boolean }): Rewards {
  const p = isCareerVenue(venue) ? CAREER[venue].pay : FREE_PLAY_PAY;
  const len = Math.pow(Math.max(1, minutes) / 10, 0.6);
  const bonus = (encore ? 1.25 : 1) * (booking?.met ? 1.25 : 1);
  const g = GRADE_FAME[grade];
  return {
    fame: Math.round(g * p.fame * len * bonus),
    cash: Math.round(booking ? booking.pay * GRADE_PAY[grade] * (booking.met ? 1.25 : 1) : (20 + g * 1.5) * p.cash * len * bonus),
    followers: Math.round(g * 2.4 * p.followers * len * bonus),
  };
}

/* ------------------------------------------------------------------ */
/* reputation (Section 9.4)                                             */
/* ------------------------------------------------------------------ */

export const REPUTATION: Record<Reputation, { label: string; blurb: string }> = {
  'deep-groover': { label: 'Deep Groover', blurb: 'Long blends, rolling grooves. Warm-ups and afterhours want you.' },
  'rave-starter': { label: 'Rave Starter', blurb: 'Big drops, high energy. Peak-time slots come your way.' },
  'bass-swap': { label: 'Bass Swap King/Queen', blurb: 'Clean bass swaps, every time. Promoters ask for them.' },
  selector: { label: 'Selector', blurb: 'Great track choices and key mixing. Closing sets and the heads.' },
  'crowd-whisperer': { label: 'Crowd Whisperer', blurb: 'Always on the slot. The best-paying bookings.' },
};
const REPS = Object.keys(REPUTATION) as Reputation[];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** how much a set leans to each reputation, 0..1 */
export function repScores(s: SetSummary): Record<Reputation, number> {
  const tr = Math.max(1, s.transitions);
  return {
    'deep-groover': clamp01((s.longBlends / tr) * 1.4) * (1 - Math.max(0, s.avgEnergy - 0.6)) * Math.min(1, s.longBlends / 2),
    'rave-starter': clamp01(s.drops / Math.max(1, s.minutes / 4)) * clamp01(s.avgEnergy / 0.72),
    'bass-swap': clamp01(s.bassSwaps / 4) * Math.sqrt(s.bassSwaps / tr),
    selector: clamp01((s.keyMixes / tr) * 1.2) * clamp01(s.transitions / 4),
    'crowd-whisperer': clamp01((s.slotMatch - 0.55) / 0.35),
  };
}

/** the reputation from the running scores: the strongest, once it's clear (two sets in) */
export function reputationFrom(stats: Record<string, number>, sets: number): Reputation | null {
  if (sets < 2) return null;
  let best: Reputation | null = null;
  let top = 0.32;
  for (const r of REPS) {
    const v = stats[`rep:${r}`] ?? 0;
    if (v > top) {
      top = v;
      best = r;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* milestones (Section 9.5)                                             */
/* ------------------------------------------------------------------ */

export interface Milestone {
  id: string;
  label: string;
  /** what it gives you, in words */
  reward: string;
  /** what it unlocks (milestone:<id> always; titles; cash) */
  title?: string;
  cash?: number;
}

export const MILESTONES: Milestone[] = [
  { id: 'first_set', label: 'First full set', reward: '$50 and the title "Debut"', title: 'Debut', cash: 50 },
  { id: 'first_perfect', label: 'First perfect transition', reward: 'The title "Locked In"', title: 'Locked In' },
  { id: 'first_encore', label: 'First encore', reward: '$80', cash: 80 },
  { id: 'first_s', label: 'First S grade', reward: 'The title "Flawless"', title: 'Flawless' },
  { id: 'sold_out', label: 'First sold-out show', reward: '$150 and the title "Sold Out"', title: 'Sold Out', cash: 150 },
  { id: 'vibe_full_minute', label: '100% vibe for a full minute', reward: 'The title "Euphoria"', title: 'Euphoria' },
  { id: 'acid', label: 'Acid house: 100% in the Warehouse', reward: 'The Acid Smiley set and smiley pupils' },
  { id: 'every_venue', label: 'Play every venue', reward: '$500 and the title "Globetrotter"', title: 'Globetrotter', cash: 500 },
  { id: 'bass_swaps_100', label: '100 bass swaps', reward: 'The title "Low End Theory"', title: 'Low End Theory' },
  { id: 'clips_10', label: 'Save 10 clips', reward: '$100 and the title "Content Machine"', title: 'Content Machine', cash: 100 },
  // the Board Builder's "50+ components" milestone went with the builder: play five different boards instead
  { id: 'boards_5', label: 'Play sets on 5 different boards', reward: 'The title "Gear Head"', title: 'Gear Head' },
  { id: 'close_sunrise', label: 'Close the sunrise set', reward: 'The title "Legend" and the Sunrise Set outfit', title: 'Legend' },
];
export const MILESTONE_BY_ID = new Map(MILESTONES.map((m) => [m.id, m]));

/** milestones a set (and the totals after it) reach */
export function milestonesFor(s: SetSummary, after: Pick<Progress, 'stats' | 'venuesPlayed' | 'boardsPlayed'>, have: string[]): string[] {
  const got = new Set(have);
  const out: string[] = [];
  const reach = (id: string, ok: boolean) => {
    if (ok && !got.has(id)) out.push(id);
  };
  reach('first_set', s.full);
  reach('first_perfect', s.perfect > 0);
  reach('first_encore', s.encore);
  reach('first_s', s.grade === 'S');
  reach('sold_out', s.full && s.average >= 0.78 && isCareerVenue(s.venue) && s.venue !== 'bedroom');
  reach('vibe_full_minute', s.fullMinute);
  reach('acid', s.venue === 'warehouse' && s.peakVibe >= 0.99);
  reach('every_venue', CAREER_VENUES.every((v) => after.venuesPlayed.includes(v)));
  reach('bass_swaps_100', (after.stats.bass_swaps ?? 0) >= 100);
  reach('clips_10', (after.stats.clips ?? 0) >= 10);
  reach('boards_5', after.boardsPlayed.length >= 5);
  reach('close_sunrise', s.venue === 'sunrise' && s.full);
  return out;
}

/* ------------------------------------------------------------------ */
/* unlocks: what's new after a set                                      */
/* ------------------------------------------------------------------ */

export interface NewThing {
  kind: 'venue' | 'item' | 'set' | 'hair' | 'tier' | 'title' | 'reputation' | 'story';
  label: string;
}

const UNLOCKABLES: { kind: NewThing['kind']; label: string; unlock: Unlock }[] = [
  ...ITEMS.map((i) => ({ kind: 'item' as const, label: i.label, unlock: i.unlock })),
  ...OUTFIT_SETS.map((o) => ({ kind: 'set' as const, label: `${o.label} (outfit)`, unlock: o.unlock })),
  ...HAIR.map((h) => ({ kind: 'hair' as const, label: `${h.label} (hair)`, unlock: h.unlock })),
];

type Owns = Pick<Progress, 'tier' | 'setsPlayed' | 'unlocked' | 'sandbox'>;

/** everything that's open after but wasn't before: venues, wardrobe pieces */
export function newUnlocks(before: Owns, after: Owns): NewThing[] {
  const out: NewThing[] = [];
  for (const v of CAREER_VENUES) if (venueLock(v, before) && !venueLock(v, after)) out.push({ kind: 'venue', label: CAREER[v].name });
  for (const u of UNLOCKABLES) if (u.unlock !== 'start' && !owned(u.unlock, before) && owned(u.unlock, after)) out.push({ kind: u.kind, label: u.label });
  return out;
}

/* ------------------------------------------------------------------ */
/* story moments: when nothing else is new, something still happens     */
/* ------------------------------------------------------------------ */

export const STORY: { text: string; followers?: number; cash?: number }[] = [
  { text: 'A local radio show played twenty minutes of your last set.', followers: 120 },
  { text: 'Your first fan email: "that bassline at 1am, what WAS it?"', followers: 60 },
  { text: 'A record shop owner put your mix on in the shop all Saturday.', followers: 90, cash: 40 },
  { text: 'A small label sent you a promo pack. Free records!', cash: 80 },
  { text: 'Someone made a fan edit of your drop. It’s doing numbers.', followers: 250 },
  { text: 'A promoter from out of town asked for your rider.', cash: 120 },
  { text: 'You got recognised on the night bus.', followers: 150 },
  { text: 'A music blog called you “one to watch”.', followers: 300 },
  { text: 'Your old school friends started a group chat called "{name} fan club".', followers: 80 },
  { text: 'A podcast invited you on to talk about digging for records.', followers: 220, cash: 60 },
  { text: 'A clothing brand sent you a box of merch to wear in the booth.', cash: 150 },
  { text: 'A producer DMed you asking to remix one of their tracks.', followers: 180 },
  { text: 'Your set made a magazine’s “mixes of the month”.', followers: 400 },
  { text: 'A booking agent left a card in the booth.', cash: 200 },
  { text: 'Fans started bringing signs with your name on.', followers: 350 },
  { text: 'A festival’s talent buyer was in the crowd. They stayed till the end.', followers: 300, cash: 150 },
  { text: 'Your mix hit the front page of a big streaming site.', followers: 600 },
  { text: 'A legendary resident told you to “keep doing what you’re doing”.', followers: 200 },
];

/* ------------------------------------------------------------------ */
/* the end of a set                                                     */
/* ------------------------------------------------------------------ */

export interface SetOutcome {
  /** what to save */
  patch: Partial<Progress>;
  rewards: Rewards;
  milestones: string[];
  tierUp: number | null;
  /** everything new: venues, wardrobe, titles, a new reputation */
  unlocked: NewThing[];
  reputation: Reputation | null;
  /** a story moment this set brought ({name} is your DJ name) */
  story: string | null;
}

const EMA = 0.4;

/** the booking a set was played for: its fee, whether the objective was hit, and any special ('boat', 'b2b:<rival>') */
export interface BookingTerms {
  pay: number;
  met: boolean;
  special?: string | null;
}

export function applySet(p: Progress, s: SetSummary, booking?: BookingTerms): SetOutcome {
  const rewards = rewardsFor(s.grade, s.venue, s.minutes, s.encore, booking);
  const stats = { ...p.stats };
  const add = (k: string, n: number) => (stats[k] = (stats[k] ?? 0) + n);
  add('sets', 1);
  add('bass_swaps', s.bassSwaps);
  add('long_blends', s.longBlends);
  add('perfect', s.perfect);
  add('key_mixes', s.keyMixes);
  add('drops', s.drops);
  add('minutes', Math.round(s.minutes));
  if (s.average >= 0.78 && s.full) add('sold_out', 1);
  if (booking) add(booking.met ? 'objectives_met' : 'objectives_missed', 1);
  // reputation: a running score per tag, so recent sets count most
  const scores = repScores(s);
  for (const r of REPS) stats[`rep:${r}`] = (stats[`rep:${r}`] ?? 0) * (1 - EMA) + scores[r] * EMA;
  const venuesPlayed = isCareerVenue(s.venue) && !p.venuesPlayed.includes(s.venue) ? [...p.venuesPlayed, s.venue] : p.venuesPlayed;
  const boardsPlayed = s.board && !p.boardsPlayed.includes(s.board) ? [...p.boardsPlayed, s.board] : p.boardsPlayed;
  const milestones = milestonesFor(s, { stats, venuesPlayed, boardsPlayed }, p.milestones);
  const fame = p.fame + rewards.fame;
  const tier = Math.max(p.tier, tierFor(fame));
  const setsPlayed = p.setsPlayed + 1;
  const unlocked = [...p.unlocked];
  // the boat party booking opens the Boat for good
  if (booking?.special === 'boat') unlocked.push('venue:boat');
  let cash = p.cash + rewards.cash;
  const titles: NewThing[] = [];
  for (const id of milestones) {
    unlocked.push(`milestone:${id}`);
    const m = MILESTONE_BY_ID.get(id);
    if (m?.title) {
      unlocked.push(`title:${m.title}`);
      titles.push({ kind: 'title', label: `Title: ${m.title}` });
    }
    if (m?.cash) cash += m.cash;
  }
  const reputation = reputationFrom(stats, setsPlayed);
  const patch: Partial<Progress> = {
    fame,
    cash,
    followers: p.followers + rewards.followers,
    setsPlayed,
    tier,
    milestones: [...p.milestones, ...milestones],
    unlocked: [...new Set(unlocked)],
    stats,
    venuesPlayed,
    boardsPlayed,
    reputation,
  };
  const after = { ...p, ...patch };
  const news = [...newUnlocks(p, after), ...titles];
  if (tier > p.tier) news.unshift({ kind: 'tier', label: `Fame tier ${tier}: ${TIER_NAMES[tier - 1]}` });
  if (reputation && reputation !== p.reputation) news.push({ kind: 'reputation', label: `Reputation: ${REPUTATION[reputation].label}` });
  // two quiet sets in a row: a story moment, so something new comes every set or two (Section 9.8)
  let story: string | null = null;
  if (news.length) stats.quiet = 0;
  else if ((stats.quiet ?? 0) >= 1) {
    const beat = STORY[(stats.story ?? 0) % STORY.length];
    story = beat.text;
    stats.story = (stats.story ?? 0) + 1;
    stats.quiet = 0;
    patch.followers = (patch.followers ?? p.followers) + (beat.followers ?? 0);
    patch.cash = (patch.cash ?? p.cash) + (beat.cash ?? 0);
    news.push({ kind: 'story', label: beat.text });
  } else stats.quiet = (stats.quiet ?? 0) + 1;
  return { patch, rewards, milestones, tierUp: tier > p.tier ? tier : null, unlocked: news, reputation, story };
}

/** what's coming next, for the results screen and the hub ("Rooftop Bar at 150 fame: 40 to go") */
export function nextGoal(p: Progress): string {
  const next = toNextTier(p);
  if (next === null) return 'You’re a legend. Every venue is yours.';
  const t = p.tier + 1;
  const v = CAREER_VENUES.find((x) => CAREER[x].tier === t && x !== 'boat');
  return `${v ? CAREER[v].name : `Tier ${t}`} at fame ${TIER_FAME[p.tier]}: ${next} to go`;
}
