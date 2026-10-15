import { describe, expect, it } from 'vitest';
import { REGULAR_SCAN, regularLook, regularSpots } from '../src/three/Regulars';
import { hasModel } from '../src/three/assets';

describe('the regulars', () => {
  const spots = [
    { x: 0, z: -1.2 },
    { x: 0.2, z: -2.4 },
    { x: 0.6, z: -2.5 },
    { x: -1.6, z: -2.6 },
    { x: 1.8, z: -2.7 },
    { x: 5, z: -2.2 },
    { x: 0, z: -3.2, role: 'sign' as const },
  ];
  it("take the nearest dancers' places, apart, facing the booth", () => {
    const r = regularSpots(spots);
    expect(r.length).toBe(3);
    for (const p of r) {
      // never inside the booth, never off to the side
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(1.2);
      expect(Math.abs(p.x)).toBeLessThan(3.5);
      // in a dancer's own place (never a sign holder's)
      expect(spots[p.of]).toMatchObject({ x: p.x, z: p.z });
      expect(spots[p.of].role).toBeUndefined();
      // facing the booth: +z turned towards x = 0
      expect(Math.cos(p.face)).toBeGreaterThan(0.5);
    }
    // the nearest dancer first; the one just behind them is too close
    expect(r[0].of).toBe(1);
    expect(r.map((p) => p.of)).not.toContain(2);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) expect(Math.hypot(r[i].x - r[j].x, r[i].z - r[j].z)).toBeGreaterThanOrEqual(0.85);
  });
  it('none without a crowd', () => {
    expect(regularSpots([])).toEqual([]);
  });
  it('the first is the floor regular, the rest wear outfit sets, all scanned people', () => {
    expect(regularLook(0, 5).options.scan).toBe(REGULAR_SCAN);
    expect(hasModel(REGULAR_SCAN)).toBe(true);
    for (let i = 1; i < 6; i++) {
      const scan = regularLook(i, 5).options.scan as string;
      expect(scan).toMatch(/^character_scan_/);
      expect(scan).not.toMatch(/android|bot/);
      expect(hasModel(scan)).toBe(true);
    }
  });
});
