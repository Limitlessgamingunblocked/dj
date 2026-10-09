import { describe, expect, it } from 'vitest';
import { makeKey } from '../src/analysis/keys';
import { Gig, rewardsFor, tierFor, TIER_FAME, type GigEvent } from '../src/game/Gig';
import type { DeckSnap } from '../src/game/vibe';

const BEAT = 60 / 124;
const deck = (o: Partial<DeckSnap> = {}): DeckSnap => ({ id: 1, trackId: 'a', artist: 'x', playing: true, audible: 1, bpm: 124, beat: 0, key: makeKey(9, true), energy: 0.6, section: 'groove', low: 0.5, filter: 0.5, echo: false, roll: false, ...o });

function play(g: Gig, secs: number, decks: (t: number) => DeckSnap[], dt = 0.25): GigEvent[] {
  const out: GigEvent[] = [];
  for (let s = 0; s < secs && g.phase !== 'over'; s += dt) out.push(...g.update(dt, decks(g.t), 0.5, 0, false));
  return out;
}

const gigWhat = (es: GigEvent[]) => es.filter((e) => e.kind === 'gig').map((e) => (e.kind === 'gig' ? e.what : ''));

describe('a gig', () => {
  it('starts the clock with the first track, not before', () => {
    const g = new Gig({ venue: 'basement', slot: 'peak', minutes: 10, assist: 'club' });
    play(g, 5, () => [deck({ playing: false })]);
    expect(g.phase).toBe('waiting');
    expect(g.t).toBe(0);
    const es = play(g, 5, (t) => [deck({ beat: t / BEAT })]);
    expect(gigWhat(es)).toContain('start');
    expect(g.t).toBeCloseTo(5, 5);
  });

  it('ends when time runs out with a cold room, and plays an encore for a hot one', () => {
    const cold = new Gig({ venue: 'basement', slot: 'peak', minutes: 1, assist: 'club' });
    cold.meter.vibe = 0.3;
    const es = play(cold, 70, (t) => [deck({ beat: t / BEAT, energy: 0.2 })]);
    expect(gigWhat(es)).toEqual(expect.arrayContaining(['start', 'time', 'over']));
    expect(cold.encore).toBe(false);

    const hot = new Gig({ venue: 'basement', slot: 'peak', minutes: 1, assist: 'club' });
    const es2: GigEvent[] = [];
    for (let s = 0; s < 70 && hot.phase !== 'over'; s += 0.25) {
      hot.meter.vibe = 0.9;
      es2.push(...hot.update(0.25, [deck({ beat: hot.t / BEAT, energy: 0.8 })], 0.5, 0, false));
    }
    expect(hot.phase).toBe('encore');
    expect(gigWhat(es2)).toContain('encore');
    // the encore: a new track for a minute ends the night
    const es3 = play(hot, 80, (t) => [deck({ trackId: 'encore', beat: t / BEAT })]);
    expect(gigWhat(es3)).toContain('over');
    const r = hot.results({ milestones: [], fame: 0, tier: 1 });
    expect(r.encore).toBe(true);
    expect(r.milestones).toContain('first_encore');
  });

  it('weights the Pro multiplier by how long Pro was on', () => {
    const g = new Gig({ venue: 'basement', slot: 'peak', minutes: 10, assist: 'club' });
    play(g, 30, (t) => [deck({ beat: t / BEAT })]);
    g.assist = 'pro';
    play(g, 30, (t) => [deck({ beat: t / BEAT })]);
    expect(g.multiplier).toBeCloseTo(1.25, 2);
  });

  it('pays more for a better grade, a longer set and an encore', () => {
    const a = rewardsFor('A', 'basement', 10, false);
    const c = rewardsFor('C', 'basement', 10, false);
    expect(a.fame).toBeGreaterThan(c.fame);
    expect(a.cash).toBeGreaterThan(c.cash);
    expect(rewardsFor('A', 'basement', 30, false).fame).toBeGreaterThan(a.fame);
    expect(rewardsFor('A', 'basement', 10, true).fame).toBeGreaterThan(a.fame);
    // the bedroom stream builds followers more than cash
    const bed = rewardsFor('A', 'bedroom', 10, false);
    expect(bed.followers).toBeGreaterThan(a.followers);
    expect(bed.cash).toBeLessThan(a.cash);
  });

  it('moves up the fame tiers', () => {
    expect(tierFor(0)).toBe(1);
    expect(tierFor(TIER_FAME[1])).toBe(2);
    expect(tierFor(TIER_FAME[2] - 1)).toBe(2);
    expect(tierFor(1e9)).toBe(TIER_FAME.length);
  });

  it('reports the set for the results screen, with first-time milestones', () => {
    const g = new Gig({ venue: 'basement', slot: 'warmup', minutes: 1, assist: 'club' });
    play(g, 70, (t) => [deck({ beat: t / BEAT, energy: 0.35 })]);
    const r = g.results({ milestones: [], fame: TIER_FAME[1] - 1, tier: 1 });
    expect(r.timeline.length).toBeGreaterThan(10);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(r.grade);
    expect(r.milestones).toContain('first_set');
    expect(r.rewards.fame).toBeGreaterThan(0);
    // enough fame for the next tier
    expect(r.tierUp).toBe(2);
    // a milestone already reached isn't reported again
    expect(g.results({ milestones: ['first_set'], fame: 0, tier: 1 }).milestones).not.toContain('first_set');
  });
});
