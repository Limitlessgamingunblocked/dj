import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { catenary, Dresser } from '../src/three/venues/dress';
import type { ShowState } from '../src/three/venues/show';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const meshes = (d: Dresser) => d.object.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh);
const show = (o: Partial<ShowState>): ShowState => ({ master: 1, kick: 0, level: 0, colors: [new THREE.Color(1, 0, 0), new THREE.Color(0, 1, 0), new THREE.Color(0, 0, 1)], reduceFlash: false, ...o }) as unknown as ShowState;

describe('set dressing', () => {
  it('hangs a cable through both ends, sagging in the middle', () => {
    const pts = catenary(V(0, 3, 0), V(4, 3, 0), 0.5, 12);
    expect(pts[0].equals(V(0, 3, 0))).toBe(true);
    expect(pts[12].equals(V(4, 3, 0))).toBe(true);
    expect(pts[6].y).toBeCloseTo(2.5, 6);
    expect(pts[6].x).toBeCloseTo(2, 6);
  });

  it('merges every piece into one mesh per material', () => {
    const d = new Dresser(3);
    for (let i = 0; i < 40; i++) d.box('steel', 1, 1, 1, i, 0, 0);
    for (let i = 0; i < 25; i++) d.rod('red', V(i, 0, 0), V(i, 2, 0), 0.05);
    d.roadCase(V(0, 0, 5), 0.3, 1.2, 0.8, 0.8);
    d.done();
    const list = meshes(d);
    const mats = new Set(list.map((m) => m.material));
    expect(list.length).toBe(mats.size);
    // plain colours share a family's material, the colour carried per vertex: steel, aluminium and
    // black metal are one mesh; red, the case's laminate, white tape and rubber feet another
    expect(list.length).toBe(2);
    for (const m of list) {
      const g = m.geometry;
      expect(g.index).toBeNull();
      expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
      expect((m.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    }
    // the steel boxes keep steel's colour
    const metal = list.find((m) => (m.material as THREE.MeshStandardMaterial).metalness > 0.5)!;
    const col = metal.geometry.attributes.color as THREE.BufferAttribute;
    const steel = new THREE.Color(0x80858c);
    expect(col.getX(0)).toBeCloseTo(steel.r, 5);
    expect(col.getZ(0)).toBeCloseTo(steel.b, 5);
  });

  it('builds the same set from the same seed', () => {
    const build = () => {
      const d = new Dresser(42);
      d.tree(V(0, 0, 0), 8);
      d.pine(V(5, 0, 0), 9);
      d.scaffold(V(0, 0, 10), 3, 3, 3, 1.5);
      return meshes(d.done()).map((m) => Array.from(m.geometry.attributes.position.array as Float32Array));
    };
    expect(build()).toEqual(build());
  });

  it('lets lights of a kind share a material, in at most four phases for the ones that pulse', () => {
    const d = new Dresser(9);
    for (let i = 0; i < 30; i++) d.ampRack(V(i, 0, 0), 0, 6);
    d.done();
    // green (level) and amber (kick) share one each; red blinks in up to four phases
    const basics = meshes(d).filter((m) => (m.material as THREE.Material).type === 'MeshBasicMaterial');
    expect(basics.length).toBeGreaterThanOrEqual(3);
    expect(basics.length).toBeLessThanOrEqual(6);
  });

  it('drives its lights from the show, and holds neon steady when flashing is reduced', () => {
    const d = new Dresser(1);
    const kick = d.glow('#ffffff', 'kick', 1);
    const neon = d.glow('#ffffff', 'flicker', 1);
    const pal = d.glow('#ffffff', 'palette', 1, 2);
    d.update(show({ kick: 0 }), 0.016);
    const quiet = kick.color.r;
    d.update(show({ kick: 1 }), 0.016);
    expect(kick.color.r).toBeGreaterThan(quiet * 2);
    // the palette light takes the show's third colour
    expect(pal.color.b).toBeGreaterThan(0);
    expect(pal.color.r).toBe(0);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      d.update(show({ reduceFlash: true }), 0.01);
      seen.add(Math.round(neon.color.r * 1000));
    }
    expect(seen.size).toBe(1);
    seen.clear();
    for (let i = 0; i < 400; i++) {
      d.update(show({}), 0.01);
      seen.add(Math.round(neon.color.r * 1000));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
