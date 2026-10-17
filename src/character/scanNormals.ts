/*
 * Smooth skin across the scan's seams. A scanned character's mesh is cut into
 * islands for its texture, and along every cut each point is there twice (once
 * per island) with its own normal, so the light breaks there: a face lit in
 * flat panels with a hard line down a cheek, a hoodie in facets. This gives
 * the copies of a point one normal between them, the average of theirs, so
 * the surface is lit as the one smooth surface it is. Copies whose normals
 * point really differently (a fold, the rim of a hat brim, the edge of a lens)
 * are a real edge, and keep theirs.
 */
import * as THREE from 'three';

/** copies of a point whose normals are further apart than this (cosine, about 70°) are a real edge */
const EDGE = 0.35;
/** how near two points have to be to count as the same one (m) */
const SAME = 1e-4;
/** how far from its middle a scan reaches (m) */
const RANGE = 3;

/**
 * Give each point's copies one normal between them, in place. Returns how
 * many normals changed (for the tests).
 */
export function healSeams(geo: THREE.BufferGeometry, edge = EDGE): number {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  if (!pos || !nor) return 0;
  // the copies of each point
  // (keyed by where it is, to a tenth of a millimetre, within ±3 m: a whole number, not a string)
  const at = new Map<number, number[]>();
  const q = 1 / SAME;
  const R = 2 * RANGE * q + 1;
  const cell = (v: number) => Math.round((v + RANGE) * q);
  for (let i = 0; i < pos.count; i++) {
    const k = (cell(pos.getX(i)) * R + cell(pos.getY(i))) * R + cell(pos.getZ(i));
    const a = at.get(k);
    if (a) a.push(i);
    else at.set(k, [i]);
  }
  const out = new Float32Array(nor.count * 3);
  for (let i = 0; i < nor.count; i++) out.set([nor.getX(i), nor.getY(i), nor.getZ(i)], i * 3);
  const n = new THREE.Vector3();
  const m = new THREE.Vector3();
  const sum = new THREE.Vector3();
  let changed = 0;
  for (const copies of at.values()) {
    if (copies.length < 2) continue;
    for (const i of copies) {
      n.fromBufferAttribute(nor, i);
      sum.set(0, 0, 0);
      for (const j of copies) {
        m.fromBufferAttribute(nor, j);
        if (m.dot(n) > edge) sum.add(m);
      }
      if (sum.lengthSq() < 1e-12) continue;
      sum.normalize();
      if (sum.dot(n) < 0.9999) changed++;
      out.set([sum.x, sum.y, sum.z], i * 3);
    }
  }
  if (changed) {
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    nor.needsUpdate = true;
  }
  return changed;
}
