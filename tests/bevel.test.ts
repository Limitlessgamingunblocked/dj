import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { autoBevel, bevelBox } from '../src/three/bevel';

function triangles(g: THREE.BufferGeometry): number[][] {
  const idx = g.index!.array;
  const out: number[][] = [];
  for (let k = 0; k < idx.length; k += 3) out.push([idx[k], idx[k + 1], idx[k + 2]]);
  return out;
}

describe('bevelled boxes', () => {
  it('keep a plain box on thin plates and chamfer the rest by size', () => {
    expect(autoBevel(1, 0.01, 1)).toBe(0);
    expect(autoBevel(0.05, 0.05, 0.05)).toBeCloseTo(0.006);
    expect(autoBevel(2, 2, 2)).toBe(0.03);
    expect(autoBevel(24, -0.6, 15)).toBe(0);
    expect(bevelBox(1, 0.004, 1).index!.count / 3).toBe(12);
  });

  it('have the same 24 vertices as a box, 44 triangles and the same bounds', () => {
    const g = bevelBox(0.6, 0.9, 0.4, 0.02);
    expect(g.attributes.position.count).toBe(24);
    expect(g.index!.count / 3).toBe(44);
    g.computeBoundingBox();
    const s = g.boundingBox!.getSize(new THREE.Vector3());
    expect(s.x).toBeCloseTo(0.6);
    expect(s.y).toBeCloseTo(0.9);
    expect(s.z).toBeCloseTo(0.4);
  });

  it('are closed, with every triangle facing out and none degenerate', () => {
    const g = bevelBox(1.2, 0.3, 0.7, 0.03);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const edges = new Map<string, number>();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const [i, j, k] of triangles(g)) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, j).sub(a);
      c.fromBufferAttribute(pos, k).sub(a);
      const n = b.clone().cross(c);
      expect(n.length()).toBeGreaterThan(1e-6);
      const centroid = a.clone().add(b.clone().add(c).multiplyScalar(1 / 3));
      expect(n.dot(centroid)).toBeGreaterThan(0);
      for (const [p, q] of [
        [i, j],
        [j, k],
        [k, i],
      ]) {
        const key = p < q ? `${p}-${q}` : `${q}-${p}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const count of edges.values()) expect(count).toBe(2);
  });

  it('keep one material group per face covering every triangle', () => {
    const g = bevelBox(1, 1, 1, 0.05);
    expect(g.groups.map((x) => x.materialIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(g.groups.reduce((n, x) => n + x.count, 0)).toBe(g.index!.count);
    for (let f = 1; f < 6; f++) expect(g.groups[f].start).toBe(g.groups[f - 1].start + g.groups[f - 1].count);
  });

  it('never chamfer past the middle of a small box', () => {
    const g = bevelBox(0.02, 0.02, 0.02, 0.5);
    g.computeBoundingBox();
    expect(g.boundingBox!.getSize(new THREE.Vector3()).x).toBeCloseTo(0.02);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getX(i))).toBeLessThanOrEqual(0.0100001);
  });
});
