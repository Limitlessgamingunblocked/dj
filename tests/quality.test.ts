import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, QUALITY_STEPS, lodFor } from '../src/three/quality';

const feed = (q: AdaptiveQuality, ms: number, seconds: number) => {
  let changes = 0;
  for (let t = 0; t < seconds * 1000; t += ms) if (q.sample(ms)) changes++;
  return changes;
};

describe('adaptive quality', () => {
  it('stays put at a steady 60 fps', () => {
    const q = new AdaptiveQuality();
    feed(q, 16.7, 30);
    expect(q.level).toBe(0);
  });

  it('steps down when frames run long, one level per cooldown', () => {
    const q = new AdaptiveQuality();
    feed(q, 33.3, 2);
    expect(q.level).toBe(1);
    feed(q, 33.3, 30);
    expect(q.level).toBe(QUALITY_STEPS.length - 1);
  });

  it('ignores the odd long frame and huge hitches', () => {
    const q = new AdaptiveQuality();
    for (let i = 0; i < 2000; i++) q.sample(i % 20 === 0 ? 40 : 16.7);
    q.sample(5000);
    expect(q.level).toBe(0);
  });

  it('probes back up after a calm spell and backs off when the probe fails', () => {
    const q = new AdaptiveQuality({ calm: 4 });
    feed(q, 33.3, 12);
    const low = q.level;
    expect(low).toBeGreaterThan(1);
    // fast again: it should climb back step by step
    feed(q, 16.7, 6);
    expect(q.level).toBe(low - 1);
    // the next probe drops frames again: back down, and the next try waits longer
    feed(q, 33.3, 4);
    expect(q.level).toBe(low);
    const before = q.level;
    feed(q, 16.7, 5);
    expect(q.level).toBe(before); // 4 s calm × backoff 2 = 8 s not reached yet
    feed(q, 16.7, 6);
    expect(q.level).toBe(before - 1);
  });

  it('does nothing when disabled', () => {
    const q = new AdaptiveQuality();
    q.enabled = false;
    feed(q, 50, 10);
    expect(q.level).toBe(0);
  });

  it('steps get cheaper monotonically', () => {
    for (let i = 1; i < QUALITY_STEPS.length; i++) {
      expect(QUALITY_STEPS[i].renderScale).toBeLessThan(QUALITY_STEPS[i - 1].renderScale);
      expect(QUALITY_STEPS[i].crowdDetail).toBeLessThanOrEqual(QUALITY_STEPS[i - 1].crowdDetail);
    }
  });

  it('picks crowd detail by distance', () => {
    expect(lodFor(5, 12)).toBe(0);
    expect(lodFor(12, 12)).toBe(0);
    expect(lodFor(20, 12)).toBe(1);
  });
});
