import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { slimSkin } from '../src/character/slim';

/** a thigh: two bones down the y axis, points round the upper one, one on the foot */
function leg() {
  const thigh = new THREE.Bone();
  thigh.name = 'thigh_l';
  const shin = new THREE.Bone();
  shin.name = 'shin_l';
  shin.position.set(0, -0.4, 0);
  const foot = new THREE.Bone();
  foot.name = 'foot_l';
  foot.position.set(0, -0.4, 0);
  thigh.add(shin);
  shin.add(foot);
  thigh.position.set(0.1, 0.9, 0);
  const pos = [0.18, 0.7, 0, 0.1, 0.7, 0.08, 0.1, 0.1, 0.06];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0], 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.add(thigh);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([thigh, shin, foot]));
  return { mesh, pos: geo.getAttribute('position') };
}

describe('slimmer scanned people', () => {
  it('draws the skin in towards the bone it follows, along neither its length nor past it', () => {
    const { mesh, pos } = leg();
    slimSkin(mesh);
    // out to the side: nearer the thigh's line (x = 0.1), still outside it, at the same height
    expect(pos.getX(0)).toBeLessThan(0.18);
    expect(pos.getX(0)).toBeGreaterThan(0.15);
    expect(pos.getY(0)).toBeCloseTo(0.7, 5);
    // in front: nearer, at the same height
    expect(pos.getZ(1)).toBeLessThan(0.08);
    expect(pos.getZ(1)).toBeGreaterThan(0.06);
    expect(pos.getY(1)).toBeCloseTo(0.7, 5);
  });
  it('leaves the feet (and the head and hands) as they are', () => {
    const { mesh, pos } = leg();
    slimSkin(mesh);
    expect([pos.getX(2), pos.getY(2), pos.getZ(2)]).toEqual([expect.closeTo(0.1, 6), expect.closeTo(0.1, 6), expect.closeTo(0.06, 6)]);
  });
});
