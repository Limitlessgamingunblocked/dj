/*
 * The crowd's skeleton on the CPU: the joints and pivots the crowd's vertex
 * shader bends (crowd.ts), for a held pose. The far crowd draws its cut-outs
 * from the 3D people posed with this, so the people at the back are the same
 * shapes as the dancers at the front.
 */
import * as THREE from 'three';
import { PERSON_BONES as B, PERSON_MATS as M, personGeometry } from './crowd';

/** an arm: out to the side, forward / up, elbow bend (radians, as in the shader) */
export type ArmPose = [number, number, number];

export interface HeldPose {
  aL: ArmPose;
  aR: ArmPose;
  /** knee bend (radians); the hips drop to keep the feet on the floor */
  knee: number;
}

const HIP_Y = 0.9;
const KNEE_Y = 0.5;
const SHOULDER = new THREE.Vector3(0.2, 1.42, 0);
const ELBOW_Y = 1.14;

const rx = (a: number) => new THREE.Matrix4().makeRotationX(a);
const rz = (a: number) => new THREE.Matrix4().makeRotationZ(a);
const tr = (v: THREE.Vector3) => new THREE.Matrix4().makeTranslation(v.x, v.y, v.z);
const about = (pivot: THREE.Vector3, r: THREE.Matrix4) => tr(pivot).multiply(r).multiply(tr(pivot.clone().negate()));

/** The transform a bone takes a rest-pose point through in this pose. */
export function boneMatrix(bone: number, p: HeldPose): THREE.Matrix4 {
  const k = p.knee;
  let m = new THREE.Matrix4();
  if (bone === B.thighL || bone === B.thighR) {
    const sd = bone === B.thighL ? -1 : 1;
    m = about(new THREE.Vector3(sd * 0.09, HIP_Y, 0), rx(-k));
  } else if (bone === B.shinL || bone === B.shinR) {
    const sd = bone === B.shinL ? -1 : 1;
    const hip = new THREE.Vector3(sd * 0.09, HIP_Y, 0);
    const knee = new THREE.Vector3(sd * 0.09, KNEE_Y, 0);
    const knee2 = knee.clone().sub(hip).applyMatrix4(rx(-k)).add(hip);
    m = tr(knee2).multiply(rx(k)).multiply(tr(knee.clone().negate()));
  } else if (bone === B.upperL || bone === B.upperR || bone === B.foreL || bone === B.foreR) {
    const sd = bone === B.upperL || bone === B.foreL ? -1 : 1;
    const ap = sd < 0 ? p.aL : p.aR;
    const sh = new THREE.Vector3(sd * SHOULDER.x, SHOULDER.y, 0);
    const ra = rz(sd * ap[0]).multiply(rx(-ap[1]));
    if (bone === B.upperL || bone === B.upperR) m = about(sh, ra);
    else {
      const e0 = new THREE.Vector3(sd * SHOULDER.x, ELBOW_Y, 0);
      m = tr(sh).multiply(ra).multiply(tr(e0.clone().sub(sh))).multiply(rx(-ap[2])).multiply(tr(e0.clone().negate()));
    }
  }
  // bent knees bring the whole body down
  return new THREE.Matrix4().makeTranslation(0, -0.8 * (1 - Math.cos(k)), 0).multiply(m);
}

export interface PosedTri {
  /** the corners, posed (x, y, z each) */
  p: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** the mean of the corners' normals, posed */
  n: THREE.Vector3;
  mat: number;
}

/**
 * The low-detail person in a held pose as a list of triangles, without the
 * props and the parts only some people wear (drink, sign, towel, cap). The
 * phone and long hair come along when asked for.
 */
export function posedPerson(p: HeldPose, o: { phone?: boolean; longHair?: boolean } = {}): PosedTri[] {
  const g = personGeometry(1);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const bone = g.attributes.aBone;
  const mat = g.attributes.aMat;
  const idx = g.index!;
  const mats = new Map<number, { m: THREE.Matrix4; r: THREE.Matrix3 }>();
  const keep = (m: number) => m <= M.sleeveLo || m === M.shin || (!!o.phone && (m === M.phone || m === M.screen)) || (!!o.longHair && m === M.longHair);
  const out: PosedTri[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    const corners = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    const m = Math.round(mat.getX(corners[0]));
    if (!keep(m)) continue;
    const b = Math.round(bone.getX(corners[0]));
    let t = mats.get(b);
    if (!t) {
      const bm = boneMatrix(b, p);
      mats.set(b, (t = { m: bm, r: new THREE.Matrix3().setFromMatrix4(bm) }));
    }
    const n = new THREE.Vector3();
    const pts = corners.map((c) => {
      n.add(v.fromBufferAttribute(nor, c).applyMatrix3(t.r));
      return new THREE.Vector3().fromBufferAttribute(pos, c).applyMatrix4(t.m);
    }) as PosedTri['p'];
    out.push({ p: pts, n: n.normalize(), mat: m });
  }
  return out;
}
