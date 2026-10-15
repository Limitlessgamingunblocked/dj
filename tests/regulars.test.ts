import { describe, expect, it } from 'vitest';
import { REGULAR_SCAN, regularCast, regularMoves, regularSpots } from '../src/three/Regulars';
import { MEN_MOVES, WOMEN_MOVES } from '../src/character/clubDance';
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
  it('are men and women, the first the floor regular, all scanned people, none twice', () => {
    expect(regularCast(0, 0).look.options.scan).toBe(REGULAR_SCAN);
    expect(hasModel(REGULAR_SCAN)).toBe(true);
    const twelve = Array.from({ length: 12 }, (_, i) => regularCast(i, 5));
    const scans = twelve.map((r) => r.look.options.scan as string);
    for (const scan of scans) {
      expect(scan).toMatch(/^character_scan_/);
      expect(scan).not.toMatch(/android|bot|minimal/);
      expect(hasModel(scan)).toBe(true);
    }
    expect(new Set(scans).size).toBe(12);
    expect(twelve.filter((r) => r.woman).length).toBeGreaterThanOrEqual(3);
  });
  it("dance their own kind's moves", () => {
    for (let seed = 0; seed < 8; seed++) {
      const w = regularMoves(true, seed);
      const m = regularMoves(false, seed);
      expect(new Set(w).size).toBe(3);
      for (const x of w) expect(WOMEN_MOVES).toContain(x);
      for (const x of m) expect(MEN_MOVES).toContain(x);
    }
  });
});
