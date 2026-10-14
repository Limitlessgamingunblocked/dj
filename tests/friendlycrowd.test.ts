import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { growHead, HEAD_GROW, HEAD_LIFT, HEAD_PIVOT, HEAD_SPACE_GLSL, PERSON_BONES, PERSON_MATS, personGeometry } from '../src/three/venues/crowd';
import { frontGeometry } from '../src/three/venues/frontrow';

/** the bounds of a model's skin on the head bone (the head, the ears and the neck) */
function headBounds(g: THREE.BufferGeometry): THREE.Box3 {
  const pos = g.attributes.position;
  const bone = g.attributes.aBone.array as Float32Array;
  const mat = g.attributes.aMat.array as Float32Array;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) if (bone[i] === PERSON_BONES.head && mat[i] === PERSON_MATS.skin) box.expandByPoint(v.fromBufferAttribute(pos, i));
  return box;
}

describe('the friendlier crowd', () => {
  it('draws the head larger than life, crown and all', () => {
    for (const g of [personGeometry(0), personGeometry(1), frontGeometry()]) {
      const box = headBounds(g);
      // the skull's top: 1.6 + 0.108 grown about the pivot and lifted
      expect(box.max.y).toBeCloseTo(HEAD_PIVOT + HEAD_LIFT + 0.108 * HEAD_GROW, 2);
      // wider than the old 0.168 m head
      expect(box.max.x - box.min.x).toBeGreaterThan(0.19);
    }
  });

  it('leaves the neck where the pose expects it', () => {
    const g = personGeometry(0);
    const pos = g.attributes.position;
    const bone = g.attributes.aBone.array as Float32Array;
    const mat = g.attributes.aMat.array as Float32Array;
    let low = Infinity;
    for (let i = 0; i < pos.count; i++) if (bone[i] === PERSON_BONES.head && mat[i] === PERSON_MATS.skin) low = Math.min(low, pos.getY(i));
    // the neck's base (1.43, closed with a little dome) is unchanged
    expect(low).toBeGreaterThan(1.4);
    expect(low).toBeLessThan(1.43);
  });

  it('maps a grown point back into the head space the face is painted in', () => {
    const p = new THREE.Vector3(0.033, 1.603, 0.09);
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p.toArray(), 3));
    growHead(g);
    const q = new THREE.Vector3().fromBufferAttribute(g.attributes.position, 0);
    expect(q.y).toBeGreaterThan(p.y);
    // the shader's inverse, with the constants it's built from
    const back = q.clone().sub(new THREE.Vector3(0, HEAD_PIVOT + HEAD_LIFT, 0)).divideScalar(HEAD_GROW).add(new THREE.Vector3(0, HEAD_PIVOT, 0));
    expect(back.distanceTo(p)).toBeLessThan(1e-6);
    expect(HEAD_SPACE_GLSL).toContain(HEAD_GROW.toFixed(4));
    expect(HEAD_SPACE_GLSL).toContain((HEAD_PIVOT + HEAD_LIFT).toFixed(4));
  });
});
