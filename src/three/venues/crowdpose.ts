/*
 * The crowd's skeleton on the CPU: the joints and pivots the crowd's vertex
 * shader bends (crowd.ts), for a held pose. The far crowd draws its cut-outs
 * from the 3D people posed with this, so the people at the back are the same
 * shapes as the dancers at the front.
 */
import * as THREE from 'three';
import { PERSON_BONES as B, PERSON_MATS as M, personGeometry } from './crowd';
import { JOINTS } from './crowdbody';

/** an arm: out to the side, forward / up, elbow bend (radians, as in the shader) */
export type ArmPose = [number, number, number];

export interface HeldPose {
  aL: ArmPose;
  aR: ArmPose;
  /** knee bend (radians); the hips drop to keep the feet on the floor */
  knee: number;
}

const rx = (a: number) => new THREE.Matrix4().makeRotationX(a);
const rz = (a: number) => new THREE.Matrix4().makeRotationZ(a);
const tr = (v: THREE.Vector3) => new THREE.Matrix4().makeTranslation(v.x, v.y, v.z);
const about = (pivot: THREE.Vector3, r: THREE.Matrix4) => tr(pivot).multiply(r).multiply(tr(pivot.clone().negate()));
/** hip to ankle */
const LEG = JOINTS.hip[1] - JOINTS.ankle[1];
const joint = (j: readonly number[], sd = 1) => new THREE.Vector3(sd * j[0], j[1], j[2]);

/**
 * The transform a bone takes a rest-pose point through in this pose. fw is
 * how much of its own joint's turn the point takes (the aW attribute: 1 on
 * the bone, less towards its parent), as in the shader.
 */
export function boneMatrix(bone: number, p: HeldPose, fw = 1): THREE.Matrix4 {
  const k = p.knee;
  let m = new THREE.Matrix4();
  if (bone === B.thighL || bone === B.thighR) {
    const sd = bone === B.thighL ? -1 : 1;
    // the top of the thigh blends into the hips
    const t = about(joint(JOINTS.hip, sd), rx(-k)).elements;
    const id = new THREE.Matrix4().elements;
    m.fromArray(t.map((v, i) => id[i] * (1 - fw) + v * fw));
  } else if (bone === B.shinL || bone === B.shinR) {
    const sd = bone === B.shinL ? -1 : 1;
    const hip = joint(JOINTS.hip, sd);
    const knee = joint(JOINTS.knee, sd);
    const knee2 = knee.clone().sub(hip).applyMatrix4(rx(-k)).add(hip);
    m = tr(knee2).multiply(rx(-k + 2 * k * fw)).multiply(tr(knee.clone().negate()));
  } else if (bone === B.upperL || bone === B.upperR || bone === B.foreL || bone === B.foreR) {
    const sd = bone === B.upperL || bone === B.foreL ? -1 : 1;
    const ap = sd < 0 ? p.aL : p.aR;
    const sh = joint(JOINTS.shoulder, sd);
    const upper = bone === B.upperL || bone === B.upperR;
    const fa = upper ? fw : 1;
    const ra = rz(sd * ap[0] * fa).multiply(rx(-ap[1] * fa));
    if (upper) m = about(sh, ra);
    else {
      const e0 = joint(JOINTS.elbow, sd);
      m = tr(sh).multiply(ra).multiply(tr(e0.clone().sub(sh))).multiply(rx(-ap[2] * fw)).multiply(tr(e0.clone().negate()));
    }
  }
  // bent knees bring the whole body down, so the feet stay on the floor
  return new THREE.Matrix4().makeTranslation(0, -LEG * (1 - Math.cos(k)), 0).multiply(m);
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
  const fw = g.attributes.aW;
  const idx = g.index!;
  const mats = new Map<string, { m: THREE.Matrix4; r: THREE.Matrix3 }>();
  const keep = (m: number) => m <= M.sleeveLo || m === M.shin || m === M.eye || (!!o.phone && (m === M.phone || m === M.screen)) || (!!o.longHair && m === M.longHair);
  const out: PosedTri[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    const corners = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    const m = Math.round(mat.getX(corners[0]));
    if (!keep(m)) continue;
    const n = new THREE.Vector3();
    const pts = corners.map((c) => {
      // each corner by its own bone and share of the joint's turn, as the shader does
      const b = Math.round(bone.getX(c));
      const w = Math.round(fw.getX(c) * 20) / 20;
      const key = `${b}:${w}`;
      let t = mats.get(key);
      if (!t) {
        const bm = boneMatrix(b, p, w);
        mats.set(key, (t = { m: bm, r: new THREE.Matrix3().setFromMatrix4(bm) }));
      }
      n.add(v.fromBufferAttribute(nor, c).applyMatrix3(t.r));
      return new THREE.Vector3().fromBufferAttribute(pos, c).applyMatrix4(t.m);
    }) as PosedTri['p'];
    out.push({ p: pts, n: n.normalize(), mat: m });
  }
  return out;
}
