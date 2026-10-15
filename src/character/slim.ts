/*
 * Slimmer scanned people. The generator builds its people thick-set: deep in
 * the belly, broad in the waist, with chunky arms and legs. Each point of the
 * skin is drawn in towards the middle of the bones it follows (the line from
 * a bone's joint to the next one down), by its weights: the waist and belly
 * most, the chest and hips less, the arms and legs a little, the head, hands
 * and feet not at all. The joints stay where they are, so the person moves
 * exactly as before, just leaner.
 */
import * as THREE from 'three';

/** how much of each point's distance from its bone's middle line goes, across (x) and front to back (z) */
const SLIM: Record<string, [number, number]> = {
  hips: [0.05, 0.1],
  spine: [0.12, 0.16],
  chest: [0.07, 0.1],
  neck: [0.06, 0.06],
  upper_arm: [0.12, 0.12],
  forearm: [0.08, 0.08],
  thigh: [0.12, 0.12],
  shin: [0.07, 0.07],
};
/** each bone's middle line runs to this one */
const NEXT: Record<string, string> = {
  hips: 'spine',
  spine: 'chest',
  chest: 'neck',
  neck: 'head',
  upper_arm: 'forearm',
  forearm: 'hand',
  thigh: 'shin',
  shin: 'foot',
};

/** draw a skinned mesh's skin in towards its bones, in place (its geometry, shared by every copy) */
export function slimSkin(mesh: THREE.SkinnedMesh, amount = 1): void {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const bones = mesh.skeleton?.bones;
  if (!pos || !si || !sw || !bones) return;

  // each bone's middle line at rest, in the mesh's bind space
  const at = bones.map((_, i) => new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert()));
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  const line: ({ a: THREE.Vector3; d: THREE.Vector3; k: [number, number] } | null)[] = bones.map((b, i) => {
    const kind = b.name.replace(/_[lr]$/, '');
    const k = SLIM[kind];
    const to = byName.get(NEXT[kind] + b.name.slice(kind.length));
    if (!k || to === undefined) return null;
    const d = at[to].clone().sub(at[i]);
    const len = d.length();
    return len > 1e-4 ? { a: at[i], d: d.divideScalar(len), k: [k[0] * amount, k[1] * amount] } : null;
  });

  const bind = mesh.bindMatrix;
  const unbind = mesh.bindMatrixInverse;
  const v = new THREE.Vector3();
  const off = new THREE.Vector3();
  const move = new THREE.Vector3();
  for (let p = 0; p < pos.count; p++) {
    v.fromBufferAttribute(pos, p).applyMatrix4(bind);
    move.set(0, 0, 0);
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(p, c);
      const l = w > 0 ? line[si.getComponent(p, c)] : null;
      if (!l) continue;
      // straight out from the middle line
      off.copy(v).sub(l.a);
      off.addScaledVector(l.d, -off.dot(l.d));
      move.x -= w * l.k[0] * off.x;
      move.y -= w * l.k[0] * off.y;
      move.z -= w * l.k[1] * off.z;
    }
    v.add(move).applyMatrix4(unbind);
    pos.setXYZ(p, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}
