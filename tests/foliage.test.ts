import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { leafClump } from '../src/three/venues/foliage';
import { rng } from '../src/three/venues/tex';

describe('leaf clumps', () => {
  it('are lumpy balls about the size asked for, flatter underneath', () => {
    const g = leafClump(0.5, rng(7));
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.x).toBeGreaterThan(0.4);
    expect(b.max.x).toBeLessThan(0.65);
    expect(b.max.y).toBeGreaterThan(0.4);
    // the underside sits higher than the top is tall
    expect(-b.min.y).toBeLessThan(b.max.y);
    // not a ball: the distance from the middle varies
    const p = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const r: number[] = [];
    for (let i = 0; i < p.count; i++) if (v.fromBufferAttribute(p, i).y >= 0) r.push(v.length());
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(0.05);
  });

  it('stay closed: copies of a corner shared by several faces move together', () => {
    const g = leafClump(0.4, rng(3), 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    const ico = new THREE.IcosahedronGeometry(0.4, 1).attributes.position as THREE.BufferAttribute;
    expect(p.count).toBe(ico.count);
    // corners that started in the same place end in the same place
    const at = new Map<string, string>();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const key = a.fromBufferAttribute(ico, i).toArray().map((x) => x.toFixed(4)).join(',');
      const moved = b.fromBufferAttribute(p, i).toArray().map((x) => x.toFixed(4)).join(',');
      const seen = at.get(key);
      if (seen) expect(moved).toBe(seen);
      else at.set(key, moved);
    }
  });
});
