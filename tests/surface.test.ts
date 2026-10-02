import { describe, expect, it } from 'vitest';
import { surfaceData } from '../src/three/venues/tex';

const S = 64;
const mean = (a: Uint8ClampedArray) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += a[i];
  return s / (a.length / 4);
};

describe('surface maps', () => {
  it('is deterministic per key and differs between keys', () => {
    const a = surfaceData('wall', { bumps: 0.6 }, S);
    const b = surfaceData('wall', { bumps: 0.6 }, S);
    const c = surfaceData('floor', { bumps: 0.6 }, S);
    expect(a.normal).toEqual(b.normal);
    expect(a.rough).toEqual(b.rough);
    expect(a.normal).not.toEqual(c.normal);
  });

  it('encodes unit normals pointing out of the surface', () => {
    const { normal } = surfaceData('concrete', { bumps: 1, grain: 1, seams: 16 }, S);
    for (let i = 0; i < normal.length; i += 4) {
      const x = normal[i] / 127.5 - 1;
      const y = normal[i + 1] / 127.5 - 1;
      const z = normal[i + 2] / 127.5 - 1;
      expect(z).toBeGreaterThan(0.2);
      expect(Math.hypot(x, y, z)).toBeGreaterThan(0.97);
      expect(Math.hypot(x, y, z)).toBeLessThan(1.03);
    }
  });

  it('keeps roughness in range, and polish makes it smoother on average', () => {
    const matte = surfaceData('floor', { rough: 0.7, roughVar: 0.2 }, S).rough;
    const worn = surfaceData('floor', { rough: 0.7, roughVar: 0.2, polish: 0.6 }, S).rough;
    for (let i = 0; i < matte.length; i += 4) {
      expect(matte[i]).toBeGreaterThanOrEqual(Math.floor(0.04 * 255));
      expect(matte[i + 1]).toBe(matte[i]);
    }
    expect(mean(worn)).toBeLessThan(mean(matte) - 2);
    expect(Math.abs(mean(matte) / 255 - 0.7)).toBeLessThan(0.08);
  });

  it('tiles: the normal across the wrap edge matches the inside', () => {
    // a seam row at y = 0 tilts the normals in the rows either side of it, on both edges of the tile
    const { normal } = surfaceData('seamed', { bumps: 0, grain: 0, seams: S }, S);
    const rowY = (y: number) => {
      let s = 0;
      for (let x = 0; x < S; x++) s += normal[(y * S + x) * 4 + 1] - 127.5;
      return s / S;
    };
    expect(Math.abs(rowY(1))).toBeGreaterThan(10);
    expect(Math.abs(rowY(S - 1))).toBeGreaterThan(10);
    expect(Math.sign(rowY(1))).toBe(-Math.sign(rowY(S - 1)));
  });
});
