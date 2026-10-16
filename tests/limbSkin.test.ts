import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { freeTorso } from '../src/character/limbSkin';

/**
 * A trunk and a left arm hanging beside it: rings of points round the arm
 * (the arm's own, facing out of its line), the side of the shirt next to it
 * wrongly given to the arm (facing out towards it, and one facing forward,
 * further in), and a point up at the shoulder.
 */
function body() {
  const bone = (name: string, x: number, y: number, parent?: THREE.Bone) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, 0);
    parent?.add(b);
    return b;
  };
  const hips = bone('hips', 0, 1);
  const spine = bone('spine', 0, 0.15, hips);
  const chest = bone('chest', 0, 0.2, spine);
  const ua = bone('upper_arm_l', 0.2, 0.05, chest);
  const fa = bone('forearm_l', 0, -0.3, ua);
  const hd = bone('hand_l', 0, -0.25, fa);
  const bones = [hips, spine, chest, ua, fa, hd];
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const wt: number[] = [];
  const add = (p: number[], n: number[], b: number) => {
    pos.push(...p);
    nor.push(...n);
    idx.push(b, 0, 0, 0);
    wt.push(1, 0, 0, 0);
    return pos.length / 3 - 1;
  };
  const ring: number[] = [];
  for (const [y, b] of [
    [1.3, 3],
    [1.2, 3],
    [1.05, 4],
    [0.95, 4],
  ] as const) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ring.push(add([0.2 + 0.04 * Math.cos(a), y, 0.04 * Math.sin(a)], [Math.cos(a), 0, Math.sin(a)], b));
    }
  }
  const side = add([0.14, 1.2, 0], [1, 0, 0], 3);
  const front = add([0.08, 1.15, 0.1], [0, 0, 1], 3);
  const low = add([0.13, 1.0, 0.02], [1, 0, 0], 4);
  const shoulder = add([0.15, 1.38, 0], [1, 0, 0], 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.add(hips);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { mesh, geo, ring, side, front, low, shoulder };
}

const armWeight = (geo: THREE.BufferGeometry, v: number) => {
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  let w = 0;
  for (let j = 0; j < 4; j++) if (si.getComponent(v, j) >= 3) w += sw.getComponent(v, j);
  return w;
};

describe('arms that let go of the body', () => {
  it('gives the side of the shirt next to a hanging arm back to the trunk', () => {
    const { mesh, geo, side, front, low } = body();
    expect(freeTorso(mesh)).toBe(3);
    for (const v of [side, front, low]) expect(armWeight(geo, v)).toBe(0);
    // to the trunk bone at its height, whole
    const si = geo.getAttribute('skinIndex');
    const sw = geo.getAttribute('skinWeight');
    expect([si.getComponent(side, 0), sw.getComponent(side, 0)]).toEqual([1, 1]);
  });
  it('leaves the arm itself, its inside included, and the shoulder alone', () => {
    const { mesh, geo, ring, shoulder } = body();
    freeTorso(mesh);
    for (const v of ring) expect(armWeight(geo, v)).toBe(1);
    expect(armWeight(geo, shoulder)).toBe(1);
  });
});
