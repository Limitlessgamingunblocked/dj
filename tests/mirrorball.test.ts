import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sphereDirs, spotHit } from '../src/three/venues/mirrorball';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('mirror-ball spots', () => {
  it('spreads its facets evenly round the ball', () => {
    const d = sphereDirs(200);
    expect(d).toHaveLength(200);
    for (const v of d) expect(v.length()).toBeCloseTo(1, 6);
    // as many up as down, and no two on top of each other
    expect(d.filter((v) => v.y > 0).length).toBe(100);
    let closest = Infinity;
    for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) closest = Math.min(closest, d[i].distanceTo(d[j]));
    expect(closest).toBeGreaterThan(0.15);
  });

  it('lands each spot on the wall, floor or ceiling of the room', () => {
    const min = V(-9.5, -0.6, -9.5);
    const max = V(9.5, 6.4, 4.5);
    const ball = V(0, 5.4, -4.2);
    for (const dir of sphereDirs(300))
      for (const a of [0, 1.1, 2.9, 5]) {
        const { t, axis } = spotHit(ball, dir, a, min, max);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const p = ball.clone().add(V(c * dir.x + s * dir.z, dir.y, -s * dir.x + c * dir.z).multiplyScalar(t));
        // inside the box, on the face it says it hit
        for (const k of ['x', 'y', 'z'] as const) {
          expect(p[k]).toBeGreaterThanOrEqual(min[k] - 1e-6);
          expect(p[k]).toBeLessThanOrEqual(max[k] + 1e-6);
        }
        const k = (['x', 'y', 'z'] as const)[axis];
        expect(Math.min(Math.abs(p[k] - min[k]), Math.abs(p[k] - max[k]))).toBeLessThan(1e-6);
      }
  });

  it('moves the spots as the ball turns', () => {
    const min = V(-8.5, -0.7, -17);
    const max = V(8.5, 4.8, 2.6);
    const dir = V(1, -0.2, 0.3).normalize();
    const a = spotHit(V(0, 4, -6), dir, 0, min, max);
    const b = spotHit(V(0, 4, -6), dir, 0.3, min, max);
    expect(a.t).not.toBeCloseTo(b.t, 3);
  });
});
