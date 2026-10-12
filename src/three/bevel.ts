/* Bevelled boxes: the cheap way to make hard-edged props catch the light. */
import * as THREE from 'three';

/**
 * How far to chamfer a box of this size: nothing on thin plates and strips
 * (their edges are too small to see), a few millimetres on small parts, up to
 * 3 cm on furniture and bigger.
 */
export function autoBevel(w: number, h: number, d: number): number {
  const m = Math.min(w, h, d);
  if (m < 0.015) return 0;
  return Math.min(0.03, Math.max(0.003, m * 0.12));
}

/**
 * A box whose edges and corners are chamfered by `b`. It keeps a BoxGeometry's
 * 24 vertices, in the same order and with the same uvs (so `boxUV` still
 * applies): every face shrinks by `b` and the gaps are closed by a strip along
 * each edge and a triangle at each corner. Those reuse the faces' own
 * vertices, so across a strip the normal turns from one face's to the other's
 * and the edge shades like a rounded one, for 32 more triangles and no more
 * vertices. Each face keeps its material group (it takes in half of every
 * strip next to it, and the side faces take the corners), so material arrays
 * still work.
 */
export function bevelBox(w: number, h: number, d: number, b = autoBevel(w, h, d)): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  b = Math.min(b, w * 0.45, h * 0.45, d * 0.45);
  if (!(b > 1e-5)) return g;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  // at[corner][axis]: the vertex at that corner on the face across that axis
  const at: number[][] = Array.from({ length: 8 }, () => [-1, -1, -1]);
  const corner = (sx: number, sy: number, sz: number) => (sx > 0 ? 1 : 0) | (sy > 0 ? 2 : 0) | (sz > 0 ? 4 : 0);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const axis = Math.abs(n.x) > 0.5 ? 0 : Math.abs(n.y) > 0.5 ? 1 : 2;
    at[corner(v.x, v.y, v.z)][axis] = i;
    // pull the vertex in along the face, away from the face's edges
    for (let a = 0; a < 3; a++) if (a !== axis) v.setComponent(a, v.getComponent(a) - Math.sign(v.getComponent(a)) * b);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // the face a vertex sits on (BoxGeometry's group order: +x, -x, +y, -y, +z, -z)
  const faceOf = (i: number) => Math.floor(i / 4);
  const tris: number[][] = [[], [], [], [], [], []];
  const old = g.index!.array;
  for (let k = 0; k < old.length; k += 3) tris[faceOf(old[k])].push(old[k], old[k + 1], old[k + 2]);
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  // wind a triangle so it faces away from the box's centre
  const add = (face: number, i0: number, i1: number, i2: number) => {
    v.fromBufferAttribute(pos, i0);
    a.fromBufferAttribute(pos, i1).sub(v);
    c.fromBufferAttribute(pos, i2).sub(v);
    const out = a.clone().cross(c).dot(v.add(a.add(c).multiplyScalar(1 / 3))) > 0;
    if (out) tris[face].push(i0, i1, i2);
    else tris[face].push(i0, i2, i1);
  };
  // the twelve edge strips: the edge along `ax` between corners c0 and c1
  for (let ax = 0; ax < 3; ax++) {
    const [p, q] = [0, 1, 2].filter((x) => x !== ax);
    for (let k = 0; k < 4; k++) {
      const s = [0, 0, 0];
      s[p] = k & 1 ? 1 : -1;
      s[q] = k & 2 ? 1 : -1;
      s[ax] = -1;
      const c0 = corner(s[0], s[1], s[2]);
      s[ax] = 1;
      const c1 = corner(s[0], s[1], s[2]);
      const ap0 = at[c0][p];
      const ap1 = at[c1][p];
      const aq0 = at[c0][q];
      const aq1 = at[c1][q];
      add(faceOf(ap0), ap0, ap1, aq1);
      add(faceOf(aq0), ap0, aq1, aq0);
    }
  }
  // the eight corners, each given to the corner's side face across x
  for (let k = 0; k < 8; k++) add(faceOf(at[k][0]), at[k][0], at[k][1], at[k][2]);
  const index: number[] = [];
  g.clearGroups();
  for (let f = 0; f < 6; f++) {
    g.addGroup(index.length, tris[f].length, f);
    index.push(...tris[f]);
  }
  g.setIndex(index);
  return g;
}
