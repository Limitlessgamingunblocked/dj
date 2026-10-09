import { describe, expect, it } from 'vitest';
import { PROGRESS, type Progress } from '../src/core/models';
import { applySet, CAREER, CAREER_VENUES, milestonesFor, repScores, reputationFrom, TIER_FAME, tierFor, venueLock, type SetSummary } from '../src/game/progression';

const fresh = (): Progress => PROGRESS.defaults();

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

const play = (p: Progress, s: SetSummary): Progress => ({ ...p, ...applySet(p, s).patch });

describe('the career path (Section 9.2)', () => {
  it('opens venues by fame tier: the basement after a first set, the boat by its special offer', () => {
    const p = fresh();
    expect(venueLock('bedroom', p)).toBeNull();
    expect(venueLock('basement', p)).toMatch(/Bedroom/);
    expect(venueLock('basement', { ...p, setsPlayed: 1 })).toBeNull();
    expect(venueLock('rooftop', { ...p, tier: 1 })).toMatch(/tier 2/);
    expect(venueLock('rooftop', { ...p, tier: 2 })).toBeNull();
    expect(venueLock('festival', { ...p, tier: 5 })).toMatch(/tier 6/);
    expect(venueLock('boat', { ...p, tier: 6 })).toMatch(/booking offer/);
    expect(venueLock('boat', { ...p, tier: 6, unlocked: ['venue:boat'] })).toBeNull();
    expect(venueLock('sunrise', { ...p, sandbox: true })).toBeNull();
    // the free-play rooms are always open
    expect(venueLock('dc10', p)).toBeNull();
    expect(tierFor(TIER_FAME[6])).toBe(7);
  });

  it('pays the fee for a booking, a quarter more for a met objective', () => {
    const p = fresh();
    const plain = applySet(p, set({ grade: 'B' }), { pay: 200, met: false });
    const met = applySet(p, set({ grade: 'B' }), { pay: 200, met: true });
    expect(plain.rewards.cash).toBe(200);
    expect(met.rewards.cash).toBe(250);
    expect(met.rewards.fame).toBeGreaterThan(plain.rewards.fame);
  });
});

describe('reputation (Section 9.4)', () => {
  it('is earned from how you play: long blends make a Deep Groover, big drops a Rave Starter', () => {
    const deep = set({ longBlends: 5, transitions: 6, drops: 1, avgEnergy: 0.45, bassSwaps: 0, keyMixes: 1, slotMatch: 0.6 });
    let p = play(fresh(), deep);
    expect(p.reputation).toBeNull(); // one set isn't a reputation
    p = play(p, deep);
    expect(p.reputation).toBe('deep-groover');
    const rave = set({ longBlends: 0, drops: 10, avgEnergy: 0.85, bassSwaps: 0, keyMixes: 1, slotMatch: 0.6 });
    for (let i = 0; i < 4; i++) p = play(p, rave);
    expect(p.reputation).toBe('rave-starter');
  });

  it('scores each tag from the set', () => {
    expect(repScores(set({ bassSwaps: 6, transitions: 6 }))['bass-swap']).toBeGreaterThan(0.9);
    expect(repScores(set({ slotMatch: 0.95 }))['crowd-whisperer']).toBeGreaterThan(0.9);
    expect(repScores(set({ keyMixes: 6, transitions: 6 })).selector).toBeGreaterThan(0.9);
    expect(reputationFrom({ 'rep:selector': 0.2 }, 5)).toBeNull();
  });
});

describe('milestones (Section 9.5)', () => {
  it('are reached once each, with rewards', () => {
    const p = fresh();
    const o = applySet(p, set({ full: true, perfect: 1, average: 0.82, fullMinute: true }));
    expect(o.milestones).toEqual(expect.arrayContaining(['first_set', 'first_perfect', 'sold_out', 'vibe_full_minute']));
    expect(o.patch.unlocked).toContain('title:Debut');
    expect(o.patch.cash).toBe(p.cash + o.rewards.cash + 50 + 150);
    const again = applySet({ ...p, ...o.patch }, set({ full: true, perfect: 1 }));
    expect(again.milestones).not.toContain('first_set');
  });

  it('acid house at the warehouse, every venue, the sunrise', () => {
    expect(milestonesFor(set({ venue: 'warehouse', peakVibe: 1 }), { stats: {}, venuesPlayed: [], boardsPlayed: [] }, [])).toContain('acid');
    expect(milestonesFor(set(), { stats: {}, venuesPlayed: [...CAREER_VENUES], boardsPlayed: [] }, [])).toContain('every_venue');
    expect(milestonesFor(set({ venue: 'sunrise' }), { stats: {}, venuesPlayed: [], boardsPlayed: [] }, [])).toContain('close_sunrise');
    expect(milestonesFor(set(), { stats: { bass_swaps: 100, clips: 10 }, venuesPlayed: [], boardsPlayed: ['a', 'b', 'c', 'd', 'e'] }, [])).toEqual(expect.arrayContaining(['bass_swaps_100', 'clips_10', 'boards_5']));
  });
});

describe('pacing (Section 9.8)', () => {
  it('a B-grade career unlocks something every set or two and reaches the sunrise', () => {
    let p = fresh();
    let quiet = 0;
    let worst = 0;
    let n = 0;
    const order = ['sunrise', 'festival', 'beach', 'warehouse', 'rooftop', 'basement', 'bedroom'] as const;
    while (p.tier < 7 && n < 200) {
      const venue = order.find((v) => !venueLock(v, p))!;
      const o = applySet(p, set({ venue, perfect: n === 0 ? 1 : 0, average: 0.62 }));
      p = { ...p, ...o.patch };
      quiet = o.unlocked.length || o.milestones.length ? 0 : quiet + 1;
      worst = Math.max(worst, quiet);
      n++;
    }
    expect(p.tier).toBe(7);
    // never more than one set in a row without something new
    expect(worst).toBeLessThanOrEqual(1);
    // a full career at a steady B, 20-minute sets: long, but not endless
    expect(n).toBeGreaterThan(30);
    expect(n).toBeLessThan(90);
    expect(CAREER.sunrise.tier).toBe(7);
  });
});
