import { describe, expect, it } from 'vitest';
import { cleanDaily, DAILY_VENUES, dailyFor, dailyMet, dailyNumber, dayBefore, dayKey, liveStreak, NO_DAILY, recordDaily, shareText, vibeSquares } from '../src/game/daily';
import type { SetSummary } from '../src/game/progression';

const summary = (o: Partial<SetSummary> = {}): SetSummary => ({ venue: 'festival', slot: 'peak', minutes: 10, grade: 'B', average: 0.6, encore: false, full: true, transitions: 3, bassSwaps: 0, longBlends: 0, filterFades: 0, echoOuts: 0, perfect: 0, keyMixes: 0, drops: 0, mistakes: 0, slotMatch: 0.5, avgEnergy: 0.6, fullMinute: false, peakVibe: 0.7, board: 'aio2', ...o });

describe('the daily challenge', () => {
  it('is the same for everyone on the same day, and different the next', () => {
    const a = dailyFor(new Date(2026, 9, 11, 9, 0));
    const b = dailyFor(new Date(2026, 9, 11, 23, 30));
    expect(b).toEqual(a);
    const days = Array.from({ length: 14 }, (_, i) => dailyFor(new Date(2026, 9, 11 + i)));
    expect(new Set(days.map((d) => `${d.venue}/${d.slot}/${d.goals.map((g) => g.kind).join()}`)).size).toBeGreaterThan(10);
  });

  it('numbers the days from 1 January 2026, and sends you to a real stage with three different objectives', () => {
    expect(dailyNumber('2026-01-01')).toBe(1);
    expect(dailyNumber('2026-10-11')).toBe(284);
    for (let i = 0; i < 60; i++) {
      const d = dailyFor(new Date(2026, 0, 1 + i));
      expect(DAILY_VENUES).toContain(d.venue);
      expect(new Set(d.goals.map((g) => g.kind)).size).toBe(3);
      expect(d.goals.every((g) => g.text.length > 0)).toBe(true);
      expect(d.minutes).toBe(10);
    }
  });

  it('knows the day before across months and years', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('checks the objectives against the set', () => {
    const d = { ...dailyFor(new Date(2026, 9, 11)), goals: [{ kind: 'perfect' as const, n: 1, text: '' }, { kind: 'grade_a' as const, n: 1, text: '' }, { kind: 'no_mistakes' as const, n: 2, text: '' }] };
    expect(dailyMet(d, summary({ perfect: 2, grade: 'B', mistakes: 1 }))).toEqual([true, false, true]);
  });

  it('turns the night into five squares and a few lines to share', () => {
    const tl = Array.from({ length: 600 }, (_, t) => ({ t, vibe: t < 120 ? 0.3 : t < 360 ? 0.55 : 0.85 }));
    expect(vibeSquares(tl, 600)).toBe('🟥🟨🟨🟩🟩');
    expect(vibeSquares([], 600)).toBe('⬛⬛⬛⬛⬛');
    const d = dailyFor(new Date(2026, 9, 11));
    const text = shareText(d, { grade: 'A', score: 12450, met: [true, false, true], squares: '🟥🟨🟨🟩🟩' }, 3);
    expect(text).toContain('Deckhouse Daily #284');
    expect(text).toContain('A · ✅❌✅ · 12,450 pts');
    expect(text).toContain('🔥 3-day streak');
    expect(text.split('\n').length).toBe(4);
  });

  it('counts the first set of the day, keeps a streak going day to day, and lets it lapse', () => {
    const r = { grade: 'B' as const, score: 100, met: [true, true, false], squares: '🟩🟩🟩🟩🟩' };
    const d1 = dailyFor(new Date(2026, 9, 11));
    const one = recordDaily(NO_DAILY, d1, r);
    expect(one.official).toBe(true);
    expect(one.save.streak).toBe(1);
    // again the same day: practice
    const again = recordDaily(one.save, d1, { ...r, score: 999 });
    expect(again.official).toBe(false);
    expect(again.save.history[0].score).toBe(100);
    const two = recordDaily(one.save, dailyFor(new Date(2026, 9, 12)), r);
    expect(two.save.streak).toBe(2);
    expect(liveStreak(two.save, '2026-10-13')).toBe(2);
    expect(liveStreak(two.save, '2026-10-14')).toBe(0);
    // a day missed: back to one
    const gap = recordDaily(two.save, dailyFor(new Date(2026, 9, 15)), r);
    expect(gap.save.streak).toBe(1);
    expect(gap.save.best).toBe(2);
  });

  it('survives a broken save', () => {
    expect(cleanDaily(null)).toEqual(NO_DAILY);
    const s = cleanDaily({ last: 'yesterday', streak: -3, best: 'x', history: [{ key: '2026-10-11', grade: 'Z', score: 5, met: 9 }, 7, { key: 'bad' }] });
    expect(s.last).toBeNull();
    expect(s.streak).toBe(0);
    expect(s.history.length).toBe(1);
    expect(s.history[0].grade).toBe('D');
    expect(s.history[0].met).toBe(3);
  });
});
