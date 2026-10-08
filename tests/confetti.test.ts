import { describe, expect, it } from 'vitest';
import { paperHeight, paperLanding } from '../src/three/venues/confetti';

describe('confetti flight', () => {
  it('rises, slows, then sinks at its flutter speed', () => {
    const k = 1.6;
    const sink = 0.9;
    const top = Math.log((10 + sink) / sink) / k;
    expect(paperHeight(0, 10, k, sink, top)).toBeGreaterThan(paperHeight(0, 10, k, sink, top - 0.2));
    expect(paperHeight(0, 10, k, sink, top)).toBeGreaterThan(paperHeight(0, 10, k, sink, top + 0.2));
    // long after: falling at the sink speed
    const v = (paperHeight(0, 10, k, sink, 20.01) - paperHeight(0, 10, k, sink, 20)) / 0.01;
    expect(v).toBeCloseTo(-sink, 3);
  });

  it('finds where it touches the floor', () => {
    for (const [vy, k, sink, floor] of [
      [8, 1.3, 0.35, -0.7],
      [12, 2.2, 1.15, -1.8],
      [3, 1.8, 0.9, 0],
    ]) {
      const t = 30;
      const land = paperLanding(0, vy, k, sink, floor, t);
      expect(Math.abs(paperHeight(0, vy, k, sink, land) - floor)).toBeLessThan(0.05);
      // and nowhere earlier, after the top of the arc
      for (let u = land * 0.9; u < land - 0.05; u += 0.05) expect(paperHeight(0, vy, k, sink, u)).toBeGreaterThan(floor);
    }
  });

  it('stays under the ceiling the venues allow for: 0.8 × speed', () => {
    // the highest piece: fastest launch (1.15 × speed), at the top of the cone (about 0.95 straight up
    // for a cannon pointing 0.8 up), the lightest drag
    for (const speed of [5, 6, 8, 12, 17]) {
      const vy = speed * 1.15 * 0.95;
      const k = 1.3;
      const sink = 0.35;
      const top = Math.log((vy + sink) / sink) / k;
      expect(paperHeight(0, vy, k, sink, top)).toBeLessThan(speed * 0.8);
    }
  });
});
