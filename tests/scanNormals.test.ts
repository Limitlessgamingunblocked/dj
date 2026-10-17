import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { healSeams } from '../src/character/scanNormals';

/** two copies each of two points (a texture cut runs between them), with normals a little apart; and a corner whose copies face away from each other */
function cut() {
  const pos = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0];
  const tilt = (a: number) => [Math.sin(a), 0, Math.cos(a)];
  const nor = [...tilt(-0.2), ...tilt(0.2), ...tilt(-0.3), ...tilt(0.1), 0, 0, 1, 1, 0, 0];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

describe('smooth skin across the scan’s seams', () => {
  it('gives the copies of a point the one normal between them', () => {
    const geo = cut();
    expect(healSeams(geo)).toBe(4);
    const n = geo.getAttribute('normal');
    const v = (i: number) => new THREE.Vector3().fromBufferAttribute(n, i);
    expect(v(0).distanceTo(v(1))).toBeLessThan(1e-6);
    expect(v(0).x).toBeCloseTo(0, 6);
    expect(v(2).distanceTo(v(3))).toBeLessThan(1e-6);
    expect(v(2).length()).toBeCloseTo(1, 6);
  });
  it('keeps a real edge (copies facing well apart) as it is', () => {
    const geo = cut();
    healSeams(geo);
    const n = geo.getAttribute('normal');
    expect([n.getX(4), n.getY(4), n.getZ(4)]).toEqual([0, 0, 1]);
    expect([n.getX(5), n.getY(5), n.getZ(5)]).toEqual([1, 0, 0]);
  });
});
