import { describe, expect, it } from 'vitest';
import { PROGRESS, type Progress } from '../src/core/models';
import { ACHIEVEMENTS, achievementRows, achievementScore, achKey, awardAchievements } from '../src/game/achievements';
import { applySet, MILESTONE_BY_ID, type SetSummary } from '../src/game/progression';

const fresh = (o: Partial<Progress> = {}): Progress => ({ ...PROGRESS.defaults(), ...o });

const set = (o: Partial<SetSummary> = {}): SetSummary => ({
  venue: 'basement', slot: 'peak', minutes: 20, grade: 'B', average: 0.62, encore: false, full: true, transitions: 6, bassSwaps: 1, longBlends: 1, filterFades: 1, echoOuts: 0, perfect: 1, keyMixes: 3, drops: 4, mistakes: 2, slotMatch: 0.7, avgEnergy: 0.6, fullMinute: false, peakVibe: 0.85, board: 'starter2', ...o,
});

describe('achievements', () => {
  it('have unique ids and rising goals', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(a.goals[0] < a.goals[1] && a.goals[1] < a.goals[2]).toBe(true);
  });

  it('award every level reached once, with its cash', () => {
    const p = fresh({ stats: { perfect: 120 }, cash: 10 });
    const r = awardAchievements(p);
    expect(r.got.filter((g) => g.id === 'perfect').map((g) => g.level)).toEqual([1, 2]);
    const after = { ...p, ...r.patch };
    expect(after.cash).toBe(10 + 50 + 200);
    expect(after.unlocked).toContain(achKey('perfect', 2));
    // nothing twice
    expect(awardAchievements(after).got).toEqual([]);
  });

  it('come out of a set: an S grade is Flawless bronze, on the results', () => {
    const out = applySet(fresh(), set({ grade: 'S', encore: true }));
    const ids = out.achievements.map((g) => `${g.id}:${g.level}`);
    expect(ids).toContain('flawless:1');
    expect(ids).toContain('encores:1');
    expect(out.unlocked.some((n) => n.kind === 'achievement' && n.label.startsWith('Flawless · Bronze'))).toBe(true);
    const milestoneCash = out.milestones.reduce((s, id) => s + (MILESTONE_BY_ID.get(id)?.cash ?? 0), 0);
    expect(out.patch.cash).toBe(out.rewards.cash + milestoneCash + out.achievements.reduce((s, g) => s + g.cash, 0));
  });

  it('show progress to the next level', () => {
    const p = fresh({ setsPlayed: 15 });
    const r = achievementRows(p).find((x) => x.a.id === 'sets')!;
    expect(r.level).toBe(1);
    expect(r.next).toBe('Play 25 sets');
    expect(r.k).toBeCloseTo(0.5);
    expect(achievementScore(p)).toEqual({ got: 1, of: ACHIEVEMENTS.length * 3 });
  });
});
