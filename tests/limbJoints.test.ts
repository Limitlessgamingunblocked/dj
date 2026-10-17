import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bendJoints, ironJoints } from '../src/character/limbSkin';

/**
 * A left arm hanging straight down, as a tube of rings round it from the
 * shoulder to the wrist, skinned the ragged way a generator's rig does: the
 * points round the elbow handed to the upper arm or the forearm turn about.
 */
function arm() {
  const bone = (name: string, x: number, y: number, parent?: THREE.Bone) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, 0);
    parent?.add(b);
    return b;
  };
  const ua = bone('upper_arm_l', 0.2, 1.4);
  const fa = bone('forearm_l', 0, -0.3, ua);
  const hd = bone('hand_l', 0, -0.25, fa);
  const bones = [ua, fa, hd];
  const ys: number[] = [];
  for (let y = 1.38; y > 0.87; y -= 0.02) ys.push(y);
  const pos: number[] = [];
  const idx: number[] = [];
  const wt: number[] = [];
  const si: number[] = [];
  const R = 8;
  ys.forEach((y, r) => {
    for (let k = 0; k < R; k++) {
      const a = (k / R) * Math.PI * 2;
      pos.push(0.2 + 0.04 * Math.cos(a), y, 0.04 * Math.sin(a));
      // ragged: within 4 cm of the elbow (y 1.1), every other point the other bone's
      const lower = y < 1.1 ? 1 : 0;
      const b = Math.abs(y - 1.1) < 0.04 && k % 2 ? 1 - lower : lower;
      si.push(b, 0, 0, 0);
      wt.push(1, 0, 0, 0);
      if (r > 0) {
        const p = (r - 1) * R;
        const q = r * R;
        const k1 = (k + 1) % R;
        idx.push(p + k, q + k, q + k1, p + k, q + k1, p + k1);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
  geo.setIndex(idx);
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.add(ua);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { mesh, geo, ys, R };
}

/** the forearm's share of a point */
const lower = (geo: THREE.BufferGeometry, v: number) => {
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  let w = 0;
  for (let j = 0; j < 4; j++) if (si.getComponent(v, j) === 1) w += sw.getComponent(v, j);
  return w;
};

describe('elbows that bend in a curve', () => {
  it('shares each point round the joint out by how far past it it is, the same all the way round', () => {
    const { mesh, geo, ys, R } = arm();
    expect(bendJoints(mesh)).toBeGreaterThan(0);
    let last = -1;
    ys.forEach((y, r) => {
      const ring = Array.from({ length: R }, (_, k) => lower(geo, r * R + k));
      for (const w of ring) expect(w).toBeCloseTo(ring[0], 5);
      // further down the arm, more the forearm's
      expect(ring[0]).toBeGreaterThanOrEqual(last - 1e-6);
      last = ring[0];
      if (y > 1.25) expect(ring[0]).toBe(0);
      if (Math.abs(y - 1.1) < 0.005) expect(ring[0]).toBeCloseTo(0.5, 1);
      if (y < 0.95) expect(ring[0]).toBeCloseTo(1, 5);
    });
  });
  it('smooths a fold in the skin over the joint, and leaves the arm away from it as it was', () => {
    const { mesh, geo, ys, R } = arm();
    const pos = geo.getAttribute('position');
    const r = ys.findIndex((y) => Math.abs(y - 1.1) < 0.005);
    // one point at the elbow pushed out into a sliver
    const tooth = r * R;
    pos.setX(tooth, pos.getX(tooth) + 0.03);
    const far = 2 * R;
    const before = pos.getX(far);
    ironJoints(mesh);
    expect(pos.getX(tooth)).toBeLessThan(0.2 + 0.04 + 0.012);
    expect(pos.getX(far)).toBe(before);
    // the arm keeps (about) its thickness
    const opposite = r * R + R / 2;
    expect(pos.getX(tooth) - pos.getX(opposite)).toBeGreaterThan(0.07);
  });
});
