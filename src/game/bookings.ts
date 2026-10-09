/*
 * Bookings (Section 9.3): promoters send offers to the calendar in your hub.
 * Each offer has a venue, a slot, a set length, the pay, what the crowd
 * expects and a bonus objective ("hit 3 bass swaps"). Your reputation steers
 * which slots and objectives come your way; followers bring special offers
 * (the Boat Party from tier 5, B2B sets with the rivals). Every set you play
 * moves the career on a night; offers for nights that have passed go.
 *
 * Pure logic: the app keeps the list in the career's bookings save.
 */
import type { Booking, BookingsSave, GoalKind, Progress, Reputation } from '../core/models';
import { CAREER, CAREER_VENUES, venueLock, type CareerVenue, type SetSummary } from './progression';
import { RIVAL_IDS } from './rivals';
import type { SlotId } from './vibe';

/** fictional promoters (no real ones), one or two per venue */
export const PROMOTERS: Record<CareerVenue, string[]> = {
  bedroom: ['Stream Night', 'Late Bedroom Sessions'],
  basement: ['Low Ceiling Collective', 'Sweat Box'],
  rooftop: ['Skyline Sessions', 'Golden Hour Club'],
  warehouse: ['Concrete Jungle', 'Unit 9 Rave'],
  beach: ['Tide & Timber', 'Salt Terrace'],
  boat: ['River Rave'],
  festival: ['Horizon Festival', 'Big Field Weekender'],
  sunrise: ['First Light'],
};

export const EXPECTATION: Record<SlotId, string[]> = {
  warmup: ['Deep warm-up, don’t go too hard', 'Ease them in: groovy and low-key', 'Warm the room, save the bangers'],
  peak: ['Peak time: they want big drops', 'Full room, full energy', 'Bring the heat, keep it moving'],
  closing: ['Close it out: emotional, one last lift', 'Take them home with something euphoric', 'The final hour: make it count'],
  afterhours: ['Afterhours: weird, hypnotic, long blends', 'Deep and minimal till the lights come on', 'For the heads: slow, rolling, hypnotic'],
};

interface GoalDef {
  kind: GoalKind;
  /** how many, for a set of this length */
  n: (minutes: number) => number;
  text: (n: number) => string;
}

export const GOAL_DEFS: GoalDef[] = [
  { kind: 'bass_swap', n: (m) => Math.max(2, Math.round(m / 7)), text: (n) => `Hit ${n} bass swaps` },
  { kind: 'long_blend', n: (m) => Math.max(1, Math.round(m / 10)), text: (n) => `Play ${n} long blend${n > 1 ? 's' : ''}` },
  { kind: 'filter_fade', n: (m) => Math.max(1, Math.round(m / 10)), text: (n) => `Do ${n} filter fade${n > 1 ? 's' : ''}` },
  { kind: 'echo_out', n: () => 1, text: () => 'Echo out at least once' },
  { kind: 'perfect', n: (m) => Math.max(1, Math.round(m / 10)), text: (n) => `Land ${n} perfect transition${n > 1 ? 's' : ''}` },
  { kind: 'key_mix', n: (m) => Math.max(2, Math.round(m / 6)), text: (n) => `Mix in key ${n} times` },
  { kind: 'drop', n: (m) => Math.max(2, Math.round(m / 5)), text: (n) => `Drop ${n} tracks after a build` },
  { kind: 'encore', n: () => 1, text: () => 'Get an encore' },
  { kind: 'grade_a', n: () => 1, text: () => 'Grade A or better' },
  { kind: 'no_mistakes', n: () => 2, text: (n) => `No more than ${n} mistakes` },
  { kind: 'slot_match', n: () => 75, text: (n) => `Follow the slot’s energy (${n}%+)` },
  { kind: 'vibe_peak', n: () => 95, text: (n) => `Get the room to ${n}% vibe` },
];
const GOAL = new Map(GOAL_DEFS.map((g) => [g.kind, g]));

export function goalText(g: { kind: GoalKind; n: number }): string {
  return GOAL.get(g.kind)?.text(g.n) ?? '';
}

/** did the set hit the objective? */
export function goalMet(g: { kind: GoalKind; n: number }, s: SetSummary): boolean {
  switch (g.kind) {
    case 'bass_swap':
      return s.bassSwaps >= g.n;
    case 'long_blend':
      return s.longBlends >= g.n;
    case 'filter_fade':
      return s.filterFades >= g.n;
    case 'echo_out':
      return s.echoOuts >= g.n;
    case 'perfect':
      return s.perfect >= g.n;
    case 'key_mix':
      return s.keyMixes >= g.n;
    case 'drop':
      return s.drops >= g.n;
    case 'encore':
      return s.encore;
    case 'grade_a':
      return s.grade === 'A' || s.grade === 'S';
    case 'no_mistakes':
      return s.full && s.mistakes <= g.n;
    case 'slot_match':
      return s.slotMatch * 100 >= g.n;
    case 'vibe_peak':
      return s.peakVibe * 100 >= g.n;
  }
}

/* ------------------------------------------------------------------ */
/* making offers                                                        */
/* ------------------------------------------------------------------ */

/** which slots and objectives each reputation brings */
const REP_SLOTS: Record<Reputation, SlotId[]> = {
  'deep-groover': ['warmup', 'afterhours', 'warmup'],
  'rave-starter': ['peak', 'peak', 'closing'],
  'bass-swap': ['peak', 'closing'],
  selector: ['closing', 'afterhours'],
  'crowd-whisperer': ['warmup', 'peak', 'closing', 'afterhours'],
};
const REP_GOALS: Record<Reputation, GoalKind[]> = {
  'deep-groover': ['long_blend', 'filter_fade', 'slot_match'],
  'rave-starter': ['drop', 'vibe_peak', 'encore'],
  'bass-swap': ['bass_swap', 'bass_swap', 'perfect'],
  selector: ['key_mix', 'perfect', 'grade_a'],
  'crowd-whisperer': ['slot_match', 'no_mistakes', 'grade_a'],
};
const SLOT_GOALS: Record<SlotId, GoalKind[]> = {
  warmup: ['long_blend', 'slot_match', 'filter_fade', 'no_mistakes'],
  peak: ['drop', 'bass_swap', 'vibe_peak', 'perfect'],
  closing: ['encore', 'key_mix', 'grade_a', 'echo_out'],
  afterhours: ['long_blend', 'key_mix', 'slot_match', 'filter_fade'],
};
const SLOT_PAY: Record<SlotId, number> = { warmup: 0.8, peak: 1.25, closing: 1.1, afterhours: 0.9 };
const LENGTHS: Record<CareerVenue, (10 | 20 | 30 | 60)[]> = {
  bedroom: [10, 20],
  basement: [10, 20, 30],
  rooftop: [20, 30],
  warehouse: [20, 30, 60],
  beach: [20, 30, 60],
  boat: [30],
  festival: [30, 60],
  sunrise: [60, 30],
};

type Rng = () => number;
const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];

/** the fee: venue, slot, length, how big you are */
export function payFor(venue: CareerVenue, slot: SlotId, minutes: number, p: Pick<Progress, 'followers' | 'reputation'>): number {
  const base = 60 * CAREER[venue].pay.cash * SLOT_PAY[slot] * Math.pow(minutes / 20, 0.7);
  const draw = 1 + Math.min(1, Math.log10(1 + p.followers) / 6);
  const whisper = p.reputation === 'crowd-whisperer' ? 1.2 : 1;
  return Math.max(15, Math.round((base * draw * whisper) / 5) * 5);
}

/** one offer at a venue */
export function makeOffer(venue: CareerVenue, night: number, p: Pick<Progress, 'followers' | 'reputation'>, r: Rng, id: string, special: string | null = null): Booking {
  const rep = p.reputation;
  const slot: SlotId = special === 'boat' ? 'peak' : rep && r() < 0.6 ? pick(r, REP_SLOTS[rep]) : pick(r, ['warmup', 'peak', 'closing', 'afterhours'] as const);
  const minutes = pick(r, LENGTHS[venue]);
  const kind: GoalKind = rep && r() < 0.5 ? pick(r, REP_GOALS[rep]) : pick(r, SLOT_GOALS[slot]);
  const def = GOAL.get(kind)!;
  const goal = { kind, n: def.n(minutes) };
  const promoter = pick(r, PROMOTERS[venue]);
  return {
    id,
    venue,
    slot,
    minutes,
    pay: Math.round(payFor(venue, slot, minutes, p) * (special ? 1.6 : 1)),
    expectation: special === 'boat' ? 'Two decks, one boat, the whole city watching: peak time on the water' : special?.startsWith('b2b:') ? 'Back to back: trade tracks, read each other, build the chemistry' : pick(r, EXPECTATION[slot]),
    objective: def.text(goal.n),
    goal,
    promoter,
    night,
    special,
    date: new Date(Date.UTC(2026, 0, 1) + night * 86_400_000).toISOString(),
    status: 'offered',
    result: null,
  };
}

/** the venues open to you, best first */
function openVenues(p: Progress): CareerVenue[] {
  return CAREER_VENUES.filter((v) => !venueLock(v, p)).sort((a, b) => CAREER[b].tier - CAREER[a].tier);
}

/**
 * Bring the calendar up to date for the current night: offers for passed
 * nights go, and new ones arrive so there are a few to choose from (mostly
 * at your biggest venues, sometimes a smaller room). Special offers come once
 * you're big enough.
 */
export function refreshOffers(save: BookingsSave, p: Progress, r: Rng): BookingsSave {
  const night = save.night;
  let items = save.items.filter((b) => b.status === 'played' || b.status === 'accepted' || (b.status === 'offered' && b.night >= night));
  // keep the played history short
  const played = items.filter((b) => b.status === 'played');
  if (played.length > 30) items = items.filter((b) => b.status !== 'played' || played.indexOf(b) >= played.length - 30);
  const open = openVenues(p);
  const offered = () => items.filter((b) => b.status === 'offered');
  let seq = Math.max(0, ...items.map((b) => Number(b.id.replace(/\D/g, '')) || 0)) + 1;
  const nextId = () => `bk${seq++}`;
  // special offers (Section 9.2: tier 5 brings boat party offers and B2B with rivals; followers unlock specials)
  const has = (sp: string) => items.some((b) => b.special === sp && b.status !== 'declined');
  if (p.tier >= 5 && !p.unlocked.includes('venue:boat') && p.followers >= 3000 && !has('boat')) items.push(makeOffer('boat', night + 1, p, r, nextId(), 'boat'));
  if (p.tier >= 5 && !offered().some((b) => b.special?.startsWith('b2b:'))) {
    const rival = pick(r, RIVAL_IDS);
    const v = open.find((x) => x === 'warehouse' || x === 'beach' || x === 'festival') ?? open[0];
    items.push(makeOffer(v, night + 2, p, r, nextId(), `b2b:${rival}`));
  }
  const booked = (n: number) => items.some((b) => b.night === n && b.status === 'accepted');
  while (offered().filter((b) => !b.special).length < 4 && open.length) {
    // mostly your biggest rooms; now and then a smaller one
    const v = r() < 0.7 ? open[0] : pick(r, open.slice(0, 3));
    // something for tonight if you're free, then the coming nights you haven't booked
    const free = [0, 1, 2, 3, 4].map((d) => night + d).filter((n) => !booked(n));
    if (!free.length) break;
    const tonight = !booked(night) && !offered().some((b) => b.night === night);
    const nt = tonight ? night : pick(r, free);
    items.push(makeOffer(v, nt, p, r, nextId()));
  }
  return { ...save, items };
}

/** say yes: you're booked that night, so the other offers for it go */
export function accept(save: BookingsSave, id: string): BookingsSave {
  const yes = save.items.find((b) => b.id === id && b.status === 'offered');
  if (!yes) return save;
  return { ...save, items: save.items.map((b) => (b === yes ? { ...b, status: 'accepted' } : b.status === 'offered' && b.night === yes.night ? { ...b, status: 'declined' } : b)) };
}

export function decline(save: BookingsSave, id: string): BookingsSave {
  return { ...save, items: save.items.map((b) => (b.id === id && b.status !== 'played' ? { ...b, status: 'declined' } : b)) };
}

/** a booking played: its result, and the career moves on a night (to the night after it, if it was later) */
export function played(save: BookingsSave, id: string | null, result: { grade: string; met: boolean } | null): BookingsSave {
  const b = id ? save.items.find((x) => x.id === id) : null;
  const night = Math.max(save.night + 1, b ? b.night + 1 : 0);
  return { night, items: save.items.map((x) => (x.id === id ? { ...x, status: 'played', result } : x)) };
}

/** a seeded random source, so offers are stable for a night */
export function seeded(seed: number): Rng {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
