import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { twoBoneIK } from '../src/character/Avatar';

/** where the hand ends up, from the joint, for a rotation and an elbow bend (the rig's own FK) */
function fk(q: THREE.Quaternion, bend: number, a: number, b: number): { elbow: THREE.Vector3; hand: THREE.Vector3 } {
  const elbow = new THREE.Vector3(0, -a, 0).applyQuaternion(q);
  const fore = new THREE.Vector3(0, -b, 0).applyEuler(new THREE.Euler(-bend, 0, 0)).applyQuaternion(q);
  return { elbow, hand: elbow.clone().add(fore) };
}

describe('the hand reaching for a control', () => {
  const a = 0.29;
  const b = 0.26;
  const pole = new THREE.Vector3(0.9, -0.55, -0.45);

  it('puts the hand on targets within reach', () => {
    for (const t of [new THREE.Vector3(-0.1, -0.3, 0.35), new THREE.Vector3(0.05, -0.15, 0.4), new THREE.Vector3(-0.25, -0.4, 0.2), new THREE.Vector3(0, -0.5, 0.05)]) {
      const { q, bend } = twoBoneIK(t, a, b, pole);
      const { hand } = fk(q, bend, a, b);
      expect(hand.distanceTo(t)).toBeLessThan(1e-4);
      // the elbow bends the way an elbow does
      expect(bend).toBeGreaterThanOrEqual(0);
      expect(bend).toBeLessThan(Math.PI);
    }
  });

  it('points straight at a target out of reach, and folds for one close in', () => {
    const far = new THREE.Vector3(0, -0.2, 1.5);
    const r = twoBoneIK(far, a, b, pole);
    expect(r.bend).toBeLessThan(0.05);
    const { hand } = fk(r.q, r.bend, a, b);
    expect(hand.clone().normalize().dot(far.clone().normalize())).toBeGreaterThan(0.999);
    const near = twoBoneIK(new THREE.Vector3(0, -0.05, 0.05), a, b, pole);
    expect(near.bend).toBeGreaterThan(2);
  });

  it('keeps the elbow out towards the pole', () => {
    const t = new THREE.Vector3(0, -0.3, 0.35);
    const { q, bend } = twoBoneIK(t, a, b, pole);
    const { elbow } = fk(q, bend, a, b);
    // the elbow sits on the pole's side of the shoulder-to-hand line
    const off = elbow.clone().sub(t.clone().multiplyScalar(elbow.dot(t) / t.lengthSq()));
    expect(off.dot(pole)).toBeGreaterThan(0);
  });
});
