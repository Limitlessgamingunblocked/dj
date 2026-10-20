import { describe, expect, it } from 'vitest';
import { BAR, BARS, BEAT, BREAK_BAR, doorStart, INSIDE_SHOTS, kickEnv, openTime, shotAt, timeline } from '../src/intro/plan';
import { partLength } from '../src/intro/score';

const onBar = (t: number, from = 0) => Math.abs(((t - from) / BAR) % 1) < 1e-6 || Math.abs((((t - from) / BAR) % 1) - 1) < 1e-6;

describe('the launch cutscene clock', () => {
  it('runs at 124 BPM in four-beat bars', () => {
    expect(BEAT).toBeCloseTo(60 / 124);
    expect(BAR).toBeCloseTo(4 * BEAT);
  });

  it('starts the full cut in the cab and the short cut at the door', () => {
    expect(doorStart('full')).toBeCloseTo(BARS.street * BAR);
    expect(doorStart('short')).toBe(0);
  });

  it('opens the door on a bar line, after the least time on the door', () => {
    // loaded early: the full cut still gives the door two bars
    expect(openTime('full', 1)).toBeCloseTo(doorStart('full') + 2 * BAR);
    expect(openTime('short', 0.2)).toBeCloseTo(BAR);
    // loaded late: the next bar line far enough ahead to schedule the sweep
    for (const now of [3.1, 7.77, 20.02, 31.5]) {
      const t = openTime('short', now, 0.25);
      expect(t).toBeGreaterThanOrEqual(now + 0.25 - 1e-9);
      expect(t - now).toBeLessThan(BAR + 0.25 + 1e-9);
      expect(onBar(t)).toBe(true);
    }
  });

  it('lays out the room and the title after the door', () => {
    const full = timeline('full', 10 * BAR);
    expect(full.inside).toBeCloseTo(11 * BAR);
    expect(full.insideFrom).toBe(0);
    expect(full.title - full.inside).toBeCloseTo(BARS.inside * BAR);
    // the short cut joins the room at the break, and gets to the drop in two bars
    const short = timeline('short', BAR);
    expect(short.insideFrom).toBeCloseTo(BREAK_BAR * BAR);
    expect(short.title - short.inside).toBeCloseTo((BARS.inside - BREAK_BAR) * BAR);
  });

  it('cuts between shots on the bar, ending on the pull back through the break', () => {
    expect(shotAt(0).id).toBe('crowd');
    expect(shotAt(2 * BAR + 0.01).id).toBe('hands');
    expect(shotAt(BREAK_BAR * BAR).id).toBe('pullback');
    expect(shotAt(BARS.inside * BAR - 0.01).u).toBeGreaterThan(0.99);
    for (const s of INSIDE_SHOTS) expect(Number.isInteger(s.bar)).toBe(true);
    // the short cut only sees the pull back
    expect(shotAt(timeline('short', 0).insideFrom).id).toBe('pullback');
  });

  it('pulses on the kick', () => {
    expect(kickEnv(0)).toBeCloseTo(1);
    expect(kickEnv(BEAT * 3)).toBeCloseTo(1);
    expect(kickEnv(BEAT * 0.5)).toBeLessThan(0.3);
  });

  it('renders loops to their exact length and lets one-shots ring on', () => {
    expect(partLength('door')).toBeCloseTo(BARS.door * BAR);
    expect(partLength('title')).toBeCloseTo(BARS.title * BAR);
    expect(partLength('street')).toBeCloseTo((BARS.street + 1) * BAR);
  });
});
