import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loopsToShapes, simplifyLoop, traceContours } from '../src/three/logo3d';

function mask(w: number, h: number, filled: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = filled(x, y) ? 1 : 0;
  return m;
}

describe('tracing the wordmark', () => {
  it('traces a filled square as one closed loop round it', () => {
    const loops = traceContours(mask(10, 10, (x, y) => x >= 2 && x <= 6 && y >= 3 && y <= 7), 10, 10);
    expect(loops).toHaveLength(1);
    const area = Math.abs(THREE.ShapeUtils.area(loops[0]));
    // 5 × 5 pixels, outlined through the pixel edges' midpoints (corners cut)
    expect(area).toBeGreaterThan(20);
    expect(area).toBeLessThan(26);
  });

  it("finds a letter's hole as a hole, not a second letter", () => {
    const ring = mask(20, 20, (x, y) => x >= 3 && x <= 15 && y >= 3 && y <= 15 && !(x >= 7 && x <= 11 && y >= 7 && y <= 11));
    const loops = traceContours(ring, 20, 20);
    expect(loops).toHaveLength(2);
    const shapes = loopsToShapes(loops);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(1);
  });

  it('keeps separate letters separate, even touching at a corner', () => {
    const two = mask(16, 8, (x, y) => (x >= 1 && x <= 5 && y >= 1 && y <= 5) || (x >= 6 && x <= 10 && y >= 6 && y <= 7) || (x >= 11 && x <= 14 && y >= 1 && y <= 5));
    const shapes = loopsToShapes(traceContours(two, 16, 8));
    expect(shapes.length).toBe(3);
  });

  it('thins a straight run down to its corners', () => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 20; i++) pts.push(new THREE.Vector2(i, 0));
    for (let i = 1; i <= 20; i++) pts.push(new THREE.Vector2(20, i));
    for (let i = 19; i >= 0; i--) pts.push(new THREE.Vector2(i, 20));
    for (let i = 19; i >= 1; i--) pts.push(new THREE.Vector2(0, i));
    const s = simplifyLoop(pts, 0.5);
    expect(s.length).toBeLessThanOrEqual(5);
    expect(Math.abs(THREE.ShapeUtils.area(s))).toBeCloseTo(400, 0);
  });
});
