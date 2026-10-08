import { describe, expect, it } from 'vitest';
import { NEUTRAL_GRADE, sectionGrade } from '../src/three/lens';

describe('grade by section', () => {
  const base = { ...NEUTRAL_GRADE, contrast: 1.12, saturation: 1.1, lift: 0.01 };

  it('leaves the venue grade alone in the groove', () => {
    expect(sectionGrade(base, 0, 0)).toEqual({ contrast: 1.12, saturation: 1.1, lift: 0.01 });
  });

  it('goes softer in a breakdown and harder, richer at the peak', () => {
    const down = sectionGrade(base, 1, 0);
    const peak = sectionGrade(base, 0, 1);
    expect(down.contrast).toBeLessThan(base.contrast);
    expect(down.saturation).toBeLessThan(base.saturation);
    expect(down.lift).toBeGreaterThan(base.lift);
    expect(peak.contrast).toBeGreaterThan(base.contrast);
    expect(peak.saturation).toBeGreaterThan(base.saturation);
    // a breakdown wins over a fading peak envelope
    expect(sectionGrade(base, 1, 1).contrast).toBeCloseTo(down.contrast, 6);
  });

  it('stays gentle and survives bad input', () => {
    for (const [b, p] of [[2, 0], [0, 5], [Number.NaN, Number.NaN], [-1, -1]]) {
      const g = sectionGrade(base, b, p);
      expect(g.contrast / base.contrast).toBeGreaterThan(0.9);
      expect(g.contrast / base.contrast).toBeLessThan(1.11);
      expect(Number.isFinite(g.saturation)).toBe(true);
    }
  });
});
