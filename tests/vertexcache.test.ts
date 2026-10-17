import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { personGeometry } from '../src/three/venues/crowd';
import { frontGeometry } from '../src/three/venues/frontrow';
import { cacheMissRatio, optimizeVertexCache, vertexCacheOrder } from '../src/three/vertexcache';

/** each triangle as its three vertices, rotated to start at the smallest (so the winding is kept) */
const triangles = (idx: ArrayLike<number>) => {
  const out: string[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const t = [idx[i], idx[i + 1], idx[i + 2]];
    const k = t.indexOf(Math.min(...t));
    out.push([t[k], t[(k + 1) % 3], t[(k + 2) % 3]].join(','));
  }
  return out.sort();
};

describe('the triangle order for the vertex cache', () => {
  it('keeps every triangle and its winding, only the order changes', () => {
    const g = new THREE.TorusKnotGeometry(1, 0.3, 64, 12);
    const idx = g.index!.array as Uint16Array;
    const o = vertexCacheOrder(idx, g.attributes.position.count);
    expect(o).toBeInstanceOf(Uint16Array);
    expect(triangles(o)).toEqual(triangles(idx));
  });

  it("shades each of the crowd's vertices about once, not twice", () => {
    for (const g of [personGeometry(0), personGeometry(1), frontGeometry()]) {
      const idx = g.index!.array;
      const verts = g.attributes.position.count;
      // the best a mesh can do is shade each vertex once: verts / triangles
      const floor = verts / (idx.length / 3);
      expect(cacheMissRatio(idx, 32)).toBeLessThan(floor * 1.3);
      expect(cacheMissRatio(idx, 16)).toBeLessThan(0.8);
    }
  });

  it('keeps each geometry group to its own range', () => {
    const g = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const before = g.index!.array.slice();
    optimizeVertexCache(g);
    for (const r of g.groups) expect(triangles(g.index!.array.slice(r.start, r.start + r.count))).toEqual(triangles(before.slice(r.start, r.start + r.count)));
  });

  it('beats the order the parts were merged in', () => {
    const g = new THREE.TorusKnotGeometry(1, 0.3, 128, 16);
    const idx = g.index!.array as Uint16Array;
    // the torus knot comes in strips (already fair); a mesh merged from shuffled parts is much worse, and gets the same result
    const tris = idx.length / 3;
    const order = Array.from({ length: tris }, (_, i) => i).sort((a, b) => Math.sin(a * 12.9898) - Math.sin(b * 12.9898));
    const shuffled = new Uint16Array(idx.length);
    order.forEach((t, i) => shuffled.set(idx.subarray(t * 3, t * 3 + 3), i * 3));
    const o = vertexCacheOrder(shuffled, g.attributes.position.count);
    expect(cacheMissRatio(shuffled, 32)).toBeGreaterThan(2);
    expect(cacheMissRatio(o, 32)).toBeLessThan(0.75);
  });
});
