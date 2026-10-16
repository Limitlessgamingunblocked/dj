/*
 * Arms that let go of the body. A scan is fitted stood with its arms down, the
 * inside of each arm against the side of the shirt or jacket, and its rig
 * often gives that side of the body to the arm: so when the arm goes up it
 * drags the jacket's side up with it, a wing of cloth from the armpit to the
 * hip (worst on a puffer or a baggy tee). This hands those points back to the
 * body before the weights are blurred (skinSmooth.ts).
 *
 * A point belongs to the body, not the arm, when it sits further in than the
 * arm's own surface does at that height (the arm's thickness measured from
 * its outside, where nothing else is near), or a little further in and facing
 * out towards the arm (the side of the shirt, not the inside of the sleeve,
 * which faces in). Only below the armpit: the shoulder still has to stretch.
 */
import * as THREE from 'three';

/** how many slices along the arm its thickness is measured in */
const SLICES = 14;
/** how far past the wrist the hand reaches (m) */
const HAND = 0.2;
/** how far below the shoulder joint the armpit starts (m): above it the shoulder keeps its stretch */
const ARMPIT = 0.05;

/**
 * Give the body back the points an arm's rig took from it, in place. Returns
 * how many points were handed back (for the tests and the lab).
 */
export function freeTorso(sm: THREE.SkinnedMesh): number {
  const geo = sm.geometry;
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  if (!pos || !nor || !si || !sw) return 0;
  const bones = sm.skeleton.bones;
  const ix = (n: string) => bones.findIndex((b) => b.name === n);
  // where each joint is at rest, in the same space as the skin's points
  const joint = (i: number) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sm.skeleton.boneInverses[i]).invert());
  const bind = sm.bindMatrix;
  const bindN = new THREE.Matrix3().getNormalMatrix(bind);
  const trunk = ['chest', 'spine', 'hips'].map(ix);
  if (trunk.some((i) => i < 0)) return 0;
  const trunkY = trunk.map((i) => joint(i).y);

  let freed = 0;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const near = new THREE.Vector3();
  const seg = new THREE.Line3();
  for (const s of ['l', 'r'] as const) {
    const ua = ix(`upper_arm_${s}`);
    const fa = ix(`forearm_${s}`);
    const hd = ix(`hand_${s}`);
    if (ua < 0 || fa < 0 || hd < 0) continue;
    // the arm's bones: the upper arm and everything hanging off it (forearm, hand, fingers)
    const arm = new Set<number>();
    const hand = new Set<number>();
    bones.forEach((b, i) => {
      for (let p: THREE.Object3D | null = b; p; p = p.parent) {
        if (p === bones[hd]) hand.add(i);
        if (p === bones[ua]) arm.add(i);
      }
    });
    const S = joint(ua);
    const E = joint(fa);
    const Wr = joint(hd);
    const tip = Wr.clone().add(Wr.clone().sub(E).normalize().multiplyScalar(HAND));
    const out = Math.sign(S.x) || 1;
    const legs = [S.distanceTo(E), E.distanceTo(Wr), HAND];
    const total = legs[0] + legs[1] + legs[2];
    const chain = [S, E, Wr, tip];
    const wrist = (legs[0] + legs[1]) / total;
    // where along the arm a point is (0 shoulder .. 1 fingertips), how far out of its line, and which way
    const place = (p: THREE.Vector3) => {
      let best = Infinity;
      let at = 0;
      let run = 0;
      for (let k = 0; k < 3; k++) {
        seg.set(chain[k], chain[k + 1]);
        const t = seg.closestPointToPointParameter(p, true);
        seg.at(t, near);
        const d = near.distanceToSquared(p);
        if (d < best) {
          best = d;
          at = (run + t * legs[k]) / total;
          _c.copy(near);
        }
        run += legs[k];
      }
      return { at, r: Math.sqrt(best), side: (p.x - _c.x) * out };
    };

    // the arm slice by slice: how far in its own inner surface comes (the arm's points that face the body),
    // and how thick it is front to back
    const ins: number[][] = Array.from({ length: SLICES }, () => []);
    const zLo = new Float32Array(SLICES).fill(Infinity);
    const zHi = new Float32Array(SLICES).fill(-Infinity);
    const armW = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let j = 0; j < 4; j++) if (arm.has(si.getComponent(i, j))) w += sw.getComponent(i, j);
      armW[i] = w;
      if (w < 0.9) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(bind);
      const p = place(v);
      const k = Math.min(SLICES - 1, Math.floor(p.at * SLICES));
      n.fromBufferAttribute(nor, i).applyMatrix3(bindN).normalize();
      if (n.x * out < -0.3) ins[k].push(-p.side);
      if (p.side > 0) {
        zLo[k] = Math.min(zLo[k], v.z);
        zHi[k] = Math.max(zHi[k], v.z);
      }
    }
    const inner = new Float32Array(SLICES).fill(NaN);
    const thick = new Float32Array(SLICES).fill(NaN);
    for (let k = 0; k < SLICES; k++) {
      if (zHi[k] > zLo[k]) thick[k] = zHi[k] - zLo[k];
      const a = ins[k].sort((x, y) => x - y);
      if (a.length >= 3) inner[k] = a[Math.floor(a.length * 0.9)];
    }
    // (a slice with too few to measure takes its neighbours')
    for (const f of [inner, thick]) {
      for (let k = 0; k < SLICES; k++) {
        if (!Number.isNaN(f[k])) continue;
        const a = [k - 1, k + 1, k - 2, k + 2].filter((j) => j >= 0 && j < SLICES && !Number.isNaN(f[j]));
        f[k] = a.length ? f[a[0]] : f === thick ? 0.12 : 0.06;
      }
    }

    for (let i = 0; i < pos.count; i++) {
      if (armW[i] < 0.02) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(bind);
      // the shoulder and the armpit keep their stretch
      if (v.y > S.y - ARMPIT) continue;
      const p = place(v);
      // (the hand itself is left alone: its fingers curl in towards the body)
      if (p.at > wrist) continue;
      let handW = 0;
      for (let j = 0; j < 4; j++) if (hand.has(si.getComponent(i, j))) handW += sw.getComponent(i, j);
      if (handW > 0.3) continue;
      const k = Math.min(SLICES - 1, Math.floor(p.at * SLICES));
      // how far in past the arm's own inner surface
      const past = -p.side - inner[k];
      n.fromBufferAttribute(nor, i).applyMatrix3(bindN).normalize();
      const facingArm = n.x * out;
      // (never the inside of the arm itself, which faces the body)
      if (facingArm < -0.2 || !(past > thick[k] * 0.3 || (past > thick[k] * 0.06 && facingArm > 0.35))) continue;
      // hand it to the trunk bones it already has, or the one at its height
      let keep = 0;
      for (let j = 0; j < 4; j++) {
        if (arm.has(si.getComponent(i, j))) sw.setComponent(i, j, 0);
        else keep += sw.getComponent(i, j);
      }
      if (keep < 0.05) {
        const t = v.y > trunkY[0] ? 0 : v.y > trunkY[1] ? 1 : 2;
        si.setComponent(i, 0, trunk[t]);
        sw.setComponent(i, 0, 1);
        for (let j = 1; j < 4; j++) sw.setComponent(i, j, 0);
      } else for (let j = 0; j < 4; j++) sw.setComponent(i, j, sw.getComponent(i, j) / keep);
      freed++;
    }
  }
  if (freed) {
    si.needsUpdate = true;
    sw.needsUpdate = true;
  }
  return freed;
}
const _c = new THREE.Vector3();
