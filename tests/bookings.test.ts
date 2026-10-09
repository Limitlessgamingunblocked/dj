import { describe, expect, it } from 'vitest';
import { BOOKINGS, PROGRESS, type BookingsSave, type Progress } from '../src/core/models';
import { memoryStore, SaveSystem } from '../src/core/SaveSystem';
import { accept, decline, GOAL_DEFS, goalMet, goalText, makeOffer, payFor, played, PROMOTERS, refreshOffers, seeded } from '../src/game/bookings';
import { CAREER_VENUES, type SetSummary } from '../src/game/progression';

const fresh = (o: Partial<Progress> = {}): Progress => ({ ...PROGRESS.defaults(), ...o });
const empty = (): BookingsSave => BOOKINGS.defaults();

function set(o: Partial<SetSummary> = {}): SetSummary {
  return {
    venue: 'basement',
    slot: 'peak',
    minutes: 20,
    grade: 'B',
    average: 0.62,
    encore: false,
    full: true,
    transitions: 6,
    bassSwaps: 1,
    longBlends: 1,
    filterFades: 1,
    echoOuts: 0,
    perfect: 1,
    keyMixes: 3,
    drops: 4,
    mistakes: 2,
    slotMatch: 0.7,
    avgEnergy: 0.6,
    fullMinute: false,
    peakVibe: 0.85,
    board: 'starter2',
    ...o,
  };
}

describe('bonus objectives (Section 9.3)', () => {
  it('reads each objective off the set', () => {
    expect(goalMet({ kind: 'bass_swap', n: 3 }, set({ bassSwaps: 3 }))).toBe(true);
    expect(goalMet({ kind: 'bass_swap', n: 3 }, set({ bassSwaps: 2 }))).toBe(false);
    expect(goalMet({ kind: 'encore', n: 1 }, set({ encore: true }))).toBe(true);
    expect(goalMet({ kind: 'grade_a', n: 1 }, set({ grade: 'S' }))).toBe(true);
    expect(goalMet({ kind: 'grade_a', n: 1 }, set({ grade: 'B' }))).toBe(false);
    // "no more than 2 mistakes" needs the whole set played
    expect(goalMet({ kind: 'no_mistakes', n: 2 }, set({ mistakes: 1, full: false }))).toBe(false);
    expect(goalMet({ kind: 'no_mistakes', n: 2 }, set({ mistakes: 2 }))).toBe(true);
    expect(goalMet({ kind: 'slot_match', n: 75 }, set({ slotMatch: 0.76 }))).toBe(true);
    expect(goalMet({ kind: 'vibe_peak', n: 95 }, set({ peakVibe: 0.9 }))).toBe(false);
    expect(goalText({ kind: 'bass_swap', n: 3 })).toBe('Hit 3 bass swaps');
    expect(goalText({ kind: 'long_blend', n: 1 })).toBe('Play 1 long blend');
    // every kind has words, and scales with the set
    for (const g of GOAL_DEFS) {
      expect(g.text(g.n(20)).length).toBeGreaterThan(5);
      expect(g.n(60)).toBeGreaterThanOrEqual(g.n(10));
    }
  });
});

describe('offers', () => {
  it('pays more for bigger rooms, peak time and longer sets', () => {
    const p = fresh();
    expect(payFor('warehouse', 'peak', 20, p)).toBeGreaterThan(payFor('basement', 'peak', 20, p));
    expect(payFor('basement', 'peak', 20, p)).toBeGreaterThan(payFor('basement', 'warmup', 20, p));
    expect(payFor('basement', 'peak', 60, p)).toBeGreaterThan(payFor('basement', 'peak', 20, p));
    expect(payFor('basement', 'peak', 20, { ...p, followers: 50_000 })).toBeGreaterThan(payFor('basement', 'peak', 20, p));
    expect(payFor('bedroom', 'warmup', 10, p) % 5).toBe(0);
  });

  it('come from a fictional promoter, with what the crowd wants and an objective that fits the length', () => {
    const o = makeOffer('basement', 3, fresh(), seeded(4), 'bk1');
    expect(PROMOTERS.basement).toContain(o.promoter);
    expect(o.expectation.length).toBeGreaterThan(5);
    expect(o.objective).toBe(goalText(o.goal));
    expect([10, 20, 30]).toContain(o.minutes);
    expect(o.night).toBe(3);
    expect(o.status).toBe('offered');
    // it survives the save's validation as it is
    const back = BOOKINGS.validate({ items: [o], night: 1 });
    expect(back.items[0]).toEqual(o);
  });

  it('a reputation steers the slots: a Deep Groover gets warm-ups and afterhours', () => {
    const p = fresh({ reputation: 'deep-groover' });
    const slots = Array.from({ length: 60 }, (_, i) => makeOffer('basement', 1, p, seeded(i + 1), `bk${i}`).slot);
    const deep = slots.filter((s) => s === 'warmup' || s === 'afterhours').length;
    expect(deep / slots.length).toBeGreaterThan(0.6);
  });
});

describe('the calendar', () => {
  it('fills up with offers at the venues you can play, and keeps them stable for a night', () => {
    const p = fresh();
    const a = refreshOffers(empty(), p, seeded(1));
    const offered = a.items.filter((b) => b.status === 'offered');
    expect(offered).toHaveLength(4);
    // a new career only has the Bedroom
    for (const b of offered) expect(b.venue).toBe('bedroom');
    for (const b of offered) expect(b.night).toBeGreaterThanOrEqual(1);
    // there's always something for tonight
    expect(offered.some((b) => b.night === 1)).toBe(true);
    // nothing new when you look again the same night
    expect(refreshOffers(a, p, seeded(99))).toEqual(a);
    const ids = new Set(a.items.map((b) => b.id));
    expect(ids.size).toBe(a.items.length);
  });

  it('sends bigger rooms as you climb, and only rooms you have opened', () => {
    const p = fresh({ tier: 3, setsPlayed: 10 });
    const a = refreshOffers(empty(), p, seeded(3));
    const venues = new Set(a.items.map((b) => b.venue));
    expect(venues.has('warehouse')).toBe(true);
    for (const v of venues) expect(['bedroom', 'basement', 'rooftop', 'warehouse']).toContain(v);
  });

  it('brings special offers at tier 5: the Boat Party once you have the followers, and a B2B', () => {
    const p = fresh({ tier: 5, setsPlayed: 30, followers: 4000 });
    const a = refreshOffers(empty(), p, seeded(5));
    const boat = a.items.find((b) => b.special === 'boat');
    expect(boat?.venue).toBe('boat');
    expect(boat?.slot).toBe('peak');
    const b2b = a.items.find((b) => b.special?.startsWith('b2b:'));
    expect(b2b).toBeTruthy();
    expect(['marlowe', 'kiki_volt', 'double_dutch', 'nox']).toContain(b2b!.special!.slice(4));
    // specials pay more
    expect(boat!.pay).toBeGreaterThan(payFor('boat', 'peak', 30, p));
    // not before tier 5, nor the boat without the followers, nor once it's open
    expect(refreshOffers(empty(), fresh({ tier: 4, setsPlayed: 20, followers: 9000 }), seeded(5)).items.some((b) => b.special)).toBe(false);
    expect(refreshOffers(empty(), fresh({ tier: 5, setsPlayed: 30, followers: 100 }), seeded(5)).items.some((b) => b.special === 'boat')).toBe(false);
    expect(refreshOffers(empty(), { ...p, unlocked: ['venue:boat'] }, seeded(5)).items.some((b) => b.special === 'boat')).toBe(false);
  });

  it('accepts, declines, plays; offers for nights gone by expire', () => {
    const p = fresh({ tier: 2, setsPlayed: 3 });
    let s = refreshOffers(empty(), p, seeded(2));
    const [first, second] = s.items;
    s = accept(s, first.id);
    s = decline(s, second.id);
    expect(s.items.find((b) => b.id === first.id)!.status).toBe('accepted');
    expect(s.items.find((b) => b.id === second.id)!.status).toBe('declined');
    // booked that night: its other offers go, and no new ones come for it
    for (const b of s.items) if (b.night === first.night && b.id !== first.id) expect(b.status).not.toBe('offered');
    expect(refreshOffers(s, p, seeded(7)).items.filter((b) => b.night === first.night && b.status === 'offered')).toHaveLength(0);
    // declining refills the list
    s = refreshOffers(s, p, seeded(2));
    expect(s.items.filter((b) => b.status === 'offered' && !b.special)).toHaveLength(4);
    // playing the booking moves the career to the night after it
    s = played(s, first.id, { grade: 'A', met: true });
    const done = s.items.find((b) => b.id === first.id)!;
    expect(done.status).toBe('played');
    expect(done.result).toEqual({ grade: 'A', met: true });
    expect(s.night).toBe(Math.max(2, first.night + 1));
    // a free set moves it on one
    const n = s.night;
    s = played(s, null, null);
    expect(s.night).toBe(n + 1);
    // offers for nights that passed are gone after the next refresh; accepted and played ones stay
    s = refreshOffers(s, p, seeded(s.night));
    for (const b of s.items) if (b.status === 'offered') expect(b.night).toBeGreaterThanOrEqual(s.night);
    expect(s.items.some((b) => b.id === first.id)).toBe(true);
    // can't decline what you've played
    expect(decline(s, first.id).items.find((b) => b.id === first.id)!.status).toBe('played');
  });

  it('every career venue has promoters', () => {
    for (const v of CAREER_VENUES) expect(PROMOTERS[v].length).toBeGreaterThan(0);
  });
});

describe('the career keeps the calendar', () => {
  it('saves offers through a reload, refreshes once a night, and erases with the career', async () => {
    const { Career } = await import('../src/game/Career');
    const kv = memoryStore();
    const c = new Career(new SaveSystem(kv));
    const a = c.refreshBookings();
    expect(a.items.filter((b) => b.status === 'offered')).toHaveLength(4);
    c.setBookings(accept(a, a.items[0].id));
    c.saves.flush();
    const again = new Career(new SaveSystem(kv));
    expect(again.bookings.items[0].status).toBe('accepted');
    expect(again.refreshBookings()).toEqual(again.bookings);
    again.erase();
    expect(again.bookings).toEqual(BOOKINGS.defaults());
  });
});
