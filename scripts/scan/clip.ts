/*
 * Moves a dance from a generated rig (an image-to-3D model rigged with a
 * motion-captured clip, e.g. Meshy's) onto the DJ body's skeleton, for the
 * game's own bones to play (src/character/danceClip.ts):
 *   – the body's limbs posed along the rig's own A-pose (as scripts/scan/fit.ts
 *     does), so a bone's turn away from that pose means the same on both
 *   – every frame, each rig joint's turn away from its bind pose, laid on the
 *     matching body bone's posed rotation: the body bone's rotation in the
 *     body's space, from its rest pose
 *   – the hips' travel, scaled to the body's height at the hips
 * Runs in the browser (under the dev server); scripts/scan/clip.mjs drives it.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { findBone, LIMBS } from './fit.ts';

/** the game's bones, and the rig joint each one follows */
const DRIVERS: [string, string[]][] = [
  ['hips', ['Hips', 'pelvis']],
  ['spine', ['Spine01', 'Spine1']],
  ['chest', ['Spine', 'Spine2']],
  ['neck', ['neck', 'Neck']],
  ['head', ['Head']],
];
for (const [s, Side] of [
  ['l', 'Left'],
  ['r', 'Right'],
] as const) {
  DRIVERS.push(
    [`shoulder_${s}`, [`${Side}Shoulder`]],
    [`upper_arm_${s}`, [`${Side}Arm`]],
    [`forearm_${s}`, [`${Side}ForeArm`]],
    [`hand_${s}`, [`${Side}Hand`]],
    [`thigh_${s}`, [`${Side}UpLeg`]],
    [`shin_${s}`, [`${Side}Leg`]],
    [`foot_${s}`, [`${Side}Foot`]],
  );
}

export interface ClipData {
  name: string;
  fps: number;
  frames: number;
  bones: string[];
  /** frames × bones × [x, y, z, w]: each bone's rotation in body space, from its rest pose */
  q: number[];
  /** frames × [x, y, z]: the hips' travel in body space (metres) */
  hips: number[];
}

const loader = new GLTFLoader();
const quatOf = (m: THREE.Matrix4) => {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  return q;
};

export async function retargetClip(o: { body: string; clip: string; fps?: number }): Promise<ClipData> {
  const [bodyGltf, clipGltf] = await Promise.all([loader.loadAsync(o.body), loader.loadAsync(o.clip)]);
  const fps = o.fps ?? 30;

  /* ---------------- the body at rest */
  const body = bodyGltf.scene;
  body.updateMatrixWorld(true);
  let skeleton: THREE.Skeleton | null = null;
  body.traverse((x) => {
    if (!skeleton && (x as THREE.SkinnedMesh).isSkinnedMesh) skeleton = (x as THREE.SkinnedMesh).skeleton;
  });
  if (!skeleton) throw new Error('no skeleton in the body');
  const bones = (skeleton as THREE.Skeleton).bones;
  const byName = new Map(bones.map((b) => [b.name, b]));
  const restQ = new Map(bones.map((b) => [b.name, b.getWorldQuaternion(new THREE.Quaternion())]));
  const bodyHipsY = byName.get('hips')!.getWorldPosition(new THREE.Vector3()).y;

  /* ---------------- the rig: its mesh's bind pose, its joints */
  const scene = clipGltf.scene;
  scene.updateMatrixWorld(true);
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse((x) => {
    if (!mesh && (x as THREE.SkinnedMesh).isSkinnedMesh) mesh = (x as THREE.SkinnedMesh);
  });
  if (!mesh) throw new Error('no rigged mesh in the clip');
  const m = mesh as THREE.SkinnedMesh;
  const sk = m.skeleton;
  const names = sk.bones.map((b) => b.name);
  // the bind pose, stood on the rig's own bones (so it's in the same frame the clip moves them in)
  sk.pose();
  scene.updateMatrixWorld(true);
  const bind = new Map<string, THREE.Matrix4>(sk.bones.map((b) => [b.name, b.matrixWorld.clone()]));
  const at = (n: string) => new THREE.Vector3().setFromMatrixPosition(bind.get(n)!);

  // which way it faces: its left arm should be on +x, as the body's is
  const lArm = findBone(names, ['LeftArm']);
  const rArm = findBone(names, ['RightArm']);
  const T = new THREE.Quaternion();
  if (lArm && rArm && at(lArm).x < at(rArm).x) T.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const Ti = T.clone().invert();
  // scale: the hips' height over the mesh's soles
  const box = new THREE.Box3().setFromObject(m, true);
  const hipsName = findBone(names, ['Hips', 'pelvis'])!;
  const k = bodyHipsY / (at(hipsName).y - box.min.y);

  /* ---------------- the body posed along the rig's A-pose (the same turns fit.ts makes) */
  for (const [bone, child, re, reChild] of LIMBS) {
    const a = findBone(names, re);
    const c = findBone(names, reChild);
    const b = byName.get(bone);
    const ch = byName.get(child);
    if (!a || !c || !b || !ch) continue;
    b.parent?.updateWorldMatrix(true, false);
    b.updateMatrixWorld(true);
    const from = ch.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
    const to = at(c).sub(at(a)).applyQuaternion(T).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(from, to);
    const wq = b.getWorldQuaternion(new THREE.Quaternion());
    const pq = b.parent!.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(pq.invert().multiply(turn.multiply(wq)));
    b.updateMatrixWorld(true);
  }
  body.updateMatrixWorld(true);
  // each bone's turn from rest into that pose
  const fit = new Map(bones.map((b) => [b.name, b.getWorldQuaternion(new THREE.Quaternion()).multiply(restQ.get(b.name)!.clone().invert())]));

  /* ---------------- play the clip, frame by frame */
  const anim = clipGltf.animations[0];
  if (!anim) throw new Error('no animation in the clip');
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(anim).play();
  const drive = DRIVERS.map(([bone, want]) => [bone, findBone(names, want)] as const).filter(([bone, j]) => j && byName.has(bone)) as [string, string][];
  const jointBone = new Map(sk.bones.map((b) => [b.name, b]));
  const bindQ = new Map(drive.map(([, j]) => [j, quatOf(bind.get(j)!)]));
  const hips0 = at(hipsName);
  const bindScale = new THREE.Vector3().setFromMatrixScale(bind.get(hipsName)!).x;
  const frames = Math.max(2, Math.round(anim.duration * fps));
  const q: number[] = [];
  const hips: number[] = [];
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  for (let f = 0; f < frames; f++) {
    mixer.setTime((f / fps) % anim.duration);
    scene.updateMatrixWorld(true);
    for (const [bone, j] of drive) {
      const now = jointBone.get(j)!.getWorldQuaternion(new THREE.Quaternion());
      // the joint's turn from its bind pose, seen from the body's side, on the posed body bone
      const d = now.multiply(bindQ.get(j)!.clone().invert());
      const dq = T.clone().multiply(d).multiply(Ti).multiply(fit.get(bone)!).normalize();
      q.push(r4(dq.x), r4(dq.y), r4(dq.z), r4(dq.w));
    }
    // (the clip moves the bones in its armature's units, the bind pose stands in the skin's: their scales' ratio between)
    const hm = jointBone.get(hipsName)!.matrixWorld;
    const r = new THREE.Vector3().setFromMatrixScale(hm).x / bindScale;
    const hp = new THREE.Vector3().setFromMatrixPosition(hm).divideScalar(r).sub(hips0).applyQuaternion(T).multiplyScalar(k);
    hips.push(r4(hp.x), r4(hp.y), r4(hp.z));
  }
  return { name: anim.name, fps, frames, bones: drive.map(([b]) => b), q, hips };
}
