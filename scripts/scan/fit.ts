/*
 * Fits a generated character (a textured GLB from an image-to-3D service,
 * stood in an A-pose, usually with a rig of its own) onto the DJ body's
 * skeleton, so the game can drive it like the modelled body:
 *   – turned to face +z, scaled to the body's height at the hips and stood on the floor
 *   – the body's skeleton posed into the character's A-pose (each limb turned
 *     along the character's own limb, from its rig's joints)
 *   – each vertex skinned like the posed body's nearest skin (a few
 *     neighbours blended), then un-posed back to the body's rest pose
 *   – written out as one skinned mesh on the body's skeleton, its textures
 *     shrunk and saved as JPEG to fit the page's size budget
 * Runs in the browser (under the dev server); scripts/scan/fit.mjs drives it.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface FitOptions {
  /** the body model's URL (the skeleton and skin weights to borrow) */
  body: string;
  /** the generated character's URL */
  scan: string;
  /** largest texture side in the output */
  maxTexture?: number;
}

export interface FitReport {
  glb: ArrayBuffer;
  bones: string[];
  scanBones: string[];
  vertices: number;
  triangles: number;
  height: number;
  turned: boolean;
}

const loader = new GLTFLoader();

/**
 * The limbs we pose the body along: the body's bone and its child, and the
 * names the generated rig may give the same two joints (Meshy's and Mixamo's
 * LeftArm / LeftForeArm…, or plain upper_arm_l…).
 */
const LIMBS: [string, string, string[], string[]][] = [];
for (const [s, Side] of [
  ['l', 'Left'],
  ['r', 'Right'],
] as const) {
  LIMBS.push(
    [`upper_arm_${s}`, `forearm_${s}`, [`${Side}Arm`, `upper_arm_${s}`], [`${Side}ForeArm`, `forearm_${s}`]],
    [`forearm_${s}`, `hand_${s}`, [`${Side}ForeArm`, `forearm_${s}`], [`${Side}Hand`, `hand_${s}`]],
    [`thigh_${s}`, `shin_${s}`, [`${Side}UpLeg`, `thigh_${s}`], [`${Side}Leg`, `shin_${s}`]],
    [`shin_${s}`, `foot_${s}`, [`${Side}Leg`, `shin_${s}`], [`${Side}Foot`, `foot_${s}`]],
  );
}

/** a scan joint by any of its usual names (with or without a "mixamorig:" prefix) */
function findBone(names: string[], want: string[]): string | undefined {
  const bare = (n: string) => n.replace(/^mixamorig[0-9]*:?/i, '').toLowerCase();
  return names.find((n) => want.some((w) => bare(n) === w.toLowerCase()));
}

/** a copy of a texture drawn at most `size` across */
function shrink(t: THREE.Texture | null, size: number): THREE.Texture | null {
  const img = t?.image as { width: number; height: number } | undefined;
  if (!t || !img || (img.width <= size && img.height <= size)) return t;
  const k = size / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
  const out = new THREE.CanvasTexture(c);
  for (const key of ['flipY', 'wrapS', 'wrapT', 'colorSpace', 'channel'] as const) (out as unknown as Record<string, unknown>)[key] = t[key];
  return out;
}

export async function fitScan(o: FitOptions): Promise<FitReport> {
  const [bodyGltf, scanGltf] = await Promise.all([loader.loadAsync(o.body), loader.loadAsync(o.scan)]);

  /* ---------------- the body: its skeleton at rest, its skin */
  const body = bodyGltf.scene;
  body.updateMatrixWorld(true);
  const bodyMeshes: THREE.SkinnedMesh[] = [];
  body.traverse((x) => {
    if ((x as THREE.SkinnedMesh).isSkinnedMesh) bodyMeshes.push(x as THREE.SkinnedMesh);
  });
  const skeleton = bodyMeshes[0].skeleton;
  const bones = skeleton.bones;
  const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
  const restWorld = bones.map((b) => b.matrixWorld.clone());
  const jointRest = (name: string) => new THREE.Vector3().setFromMatrixPosition(restWorld[boneIndex.get(name)!]);

  /* ---------------- the scan: its mesh in its bind pose, its joints */
  const scan = scanGltf.scene;
  scan.updateMatrixWorld(true);
  const scanMeshes: THREE.Mesh[] = [];
  scan.traverse((x) => {
    if ((x as THREE.Mesh).isMesh) scanMeshes.push(x as THREE.Mesh);
  });
  if (!scanMeshes.length) throw new Error('no mesh in the scan');
  const joints = new Map<string, THREE.Vector3>();
  for (const m of scanMeshes) {
    const sk = (m as THREE.SkinnedMesh).skeleton;
    if (!sk) continue;
    sk.bones.forEach((b, i) => {
      // the bone's place in the bind pose: its inverse bind matrix, inverted, in the mesh's bind space
      const w = sk.boneInverses[i].clone().invert().premultiply((m as THREE.SkinnedMesh).bindMatrix.clone().premultiply(m.parent!.matrixWorld));
      joints.set(b.name, new THREE.Vector3().setFromMatrixPosition(w));
    });
  }
  const scanBones = [...joints.keys()];

  // one geometry in world space (bind pose for skinned meshes), with its material
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  for (const m of scanMeshes) {
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'tangent'].includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    const sm = m as THREE.SkinnedMesh;
    g.applyMatrix4(sm.isSkinnedMesh ? sm.bindMatrix.clone().premultiply(m.parent!.matrixWorld) : m.matrixWorld);
    geos.push(g);
    mats.push(Array.isArray(m.material) ? m.material[0] : m.material);
  }
  const geo = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, true)!;
  const mat = mats.length === 1 ? mats[0] : mats;

  /* ---------------- stand it where the body stands */
  const box = new THREE.Box3().setFromBufferAttribute(geo.attributes.position as THREE.BufferAttribute);
  // which way it faces: its left arm should be on +x, as the body's is
  const lArm = findBone(scanBones, ['LeftArm', 'upper_arm_l']);
  const rArm = findBone(scanBones, ['RightArm', 'upper_arm_r']);
  let turned = false;
  const xform = new THREE.Matrix4();
  if (lArm && rArm && joints.get(lArm)!.x < joints.get(rArm)!.x) {
    xform.makeRotationY(Math.PI);
    turned = true;
  }
  // scale: the hips' height (the cap and the soles would throw a head-to-toe match)
  const hipsName = findBone(scanBones, ['Hips', 'pelvis', 'hips']);
  const hipsY = hipsName ? joints.get(hipsName)!.y - box.min.y : (box.max.y - box.min.y) * 0.53;
  const bodyHips = jointRest('hips');
  const k = bodyHips.y / hipsY;
  const hipsXZ = hipsName ? joints.get(hipsName)!.clone() : box.getCenter(new THREE.Vector3());
  const place = new THREE.Matrix4()
    .makeTranslation(bodyHips.x, 0, bodyHips.z)
    .multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(xform)
    .multiply(new THREE.Matrix4().makeTranslation(-hipsXZ.x, -box.min.y, -hipsXZ.z));
  geo.applyMatrix4(place);
  for (const p of joints.values()) p.applyMatrix4(place);

  /* ---------------- pose the body's limbs along the scan's */
  const parentsFirst = (name: string) => {
    const b = bones[boneIndex.get(name)!];
    b.parent?.updateWorldMatrix(true, false);
    b.updateMatrixWorld(true);
    return b;
  };
  for (const [bone, child, re, reChild] of LIMBS) {
    const a = findBone(scanBones, re);
    const c = findBone(scanBones, reChild);
    if (!a || !c || !boneIndex.has(bone) || !boneIndex.has(child)) continue;
    const b = parentsFirst(bone);
    const ch = bones[boneIndex.get(child)!];
    const from = new THREE.Vector3().setFromMatrixPosition(ch.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(b.matrixWorld)).normalize();
    const to = joints.get(c)!.clone().sub(joints.get(a)!).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(from, to);
    const wq = b.getWorldQuaternion(new THREE.Quaternion());
    const pq = b.parent!.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(pq.invert().multiply(turn.multiply(wq)));
    b.updateMatrixWorld(true);
  }
  body.updateMatrixWorld(true);
  skeleton.update();
  const posed = bones.map((b, i) => b.matrixWorld.clone().multiply(skeleton.boneInverses[i]));

  /* ---------------- the posed body's skin, in a grid for nearest lookups */
  const pts: number[] = [];
  const wIdx: number[] = [];
  const wVal: number[] = [];
  const v = new THREE.Vector3();
  for (const m of bodyMeshes) {
    m.morphTargetInfluences?.fill(0);
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    const si = m.geometry.attributes.skinIndex as THREE.BufferAttribute;
    const sw = m.geometry.attributes.skinWeight as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      pts.push(v.x, v.y, v.z);
      for (let j = 0; j < 4; j++) {
        // (each mesh's skeleton lists the same bones, in the same order)
        wIdx.push(boneIndex.get(m.skeleton.bones[si.getComponent(i, j)].name)!);
        wVal.push(sw.getComponent(i, j));
      }
    }
  }
  const CELL = 0.04;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  for (let i = 0; i < pts.length / 3; i++) {
    const kk = key(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    let c = grid.get(kk);
    if (!c) grid.set(kk, (c = []));
    c.push(i);
  }
  const nearest = (x: number, y: number, z: number, n: number): [number, number][] => {
    for (let r = 1; r < 12; r++) {
      const found: [number, number][] = [];
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      const cz = Math.floor(z / CELL);
      for (let i = -r; i <= r; i++)
        for (let j = -r; j <= r; j++)
          for (let l = -r; l <= r; l++) {
            const c = grid.get(`${cx + i},${cy + j},${cz + l}`);
            if (c) for (const p of c) found.push([p, (pts[p * 3] - x) ** 2 + (pts[p * 3 + 1] - y) ** 2 + (pts[p * 3 + 2] - z) ** 2]);
          }
      if (found.length >= n) return found.sort((a, b) => a[1] - b[1]).slice(0, n);
    }
    return [];
  };

  /* ---------------- skin each vertex, then take it back to the rest pose */
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const N = pos.count;
  const skinIndex = new Uint16Array(N * 4);
  const skinWeight = new Float32Array(N * 4);
  const M = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  for (let i = 0; i < N; i++) {
    v.fromBufferAttribute(pos, i);
    const near = nearest(v.x, v.y, v.z, 8);
    const acc = new Map<number, number>();
    const d0 = Math.sqrt(near[0]?.[1] ?? 0);
    for (const [p, d2] of near) {
      // the closest skin counts most; ones much further off hardly at all
      const w = 1 / (Math.sqrt(d2) - d0 + 0.004) ** 2;
      for (let j = 0; j < 4; j++) {
        const b = wIdx[p * 4 + j];
        const bw = wVal[p * 4 + j] * w;
        if (bw > 0) acc.set(b, (acc.get(b) ?? 0) + bw);
      }
    }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((a, [, w]) => a + w, 0) || 1;
    M.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    top.forEach(([b, w], j) => {
      skinIndex[i * 4 + j] = b;
      skinWeight[i * 4 + j] = w / sum;
      tmp.copy(posed[b]).multiplyScalar(w / sum);
      for (let e = 0; e < 16; e++) M.elements[e] += tmp.elements[e];
    });
    if (!top.length) {
      skinIndex[i * 4] = boneIndex.get('hips')!;
      skinWeight[i * 4] = 1;
      M.identity();
    }
    M.invert();
    v.applyMatrix4(M);
    pos.setXYZ(i, v.x, v.y, v.z);
    if (nor) {
      nm.getNormalMatrix(M);
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      nor.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  if (geo.attributes.tangent) geo.deleteAttribute('tangent');
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  /* ---------------- back to rest, and out: the body's bones and the fitted mesh */
  bones.forEach((b, i) => {
    const local = restWorld[i].clone();
    if (b.parent && (b.parent as THREE.Bone).isBone) local.premultiply(restWorld[bones.indexOf(b.parent as THREE.Bone)].clone().invert());
    else if (b.parent) local.premultiply(b.parent.matrixWorld.clone().invert());
    local.decompose(b.position, b.quaternion, b.scale);
  });
  body.updateMatrixWorld(true);
  const root = bones.find((b) => !(b.parent as THREE.Bone)?.isBone)!;
  const out = new THREE.Group();
  out.name = 'scan';
  // the skeleton's root, wherever it hung in the body's scene
  const rootParentWorld = root.parent!.matrixWorld.clone();
  root.applyMatrix4(rootParentWorld);
  out.add(root);
  out.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'scan_body';
  out.add(mesh);
  mesh.bind(new THREE.Skeleton(bones, skeleton.boneInverses), new THREE.Matrix4());
  const maxTexture = o.maxTexture ?? 2048;
  for (const m of Array.isArray(mat) ? mat : [mat]) {
    const s = m as THREE.MeshStandardMaterial;
    // (no glow: the generator's emissive map only lights the whole figure up flat)
    s.emissiveMap = null;
    s.emissive?.set(0);
    // (cloth and skin aren't metal: the map's metal channel only darkens them under club lights; its roughness stays)
    s.metalness = 0;
    // the colour at full size; the surface maps (bumps, shine) at half, which nobody sees the difference in
    s.normalMap = shrink(s.normalMap, maxTexture / 2);
    const rough = shrink(s.roughnessMap, maxTexture / 2);
    s.roughnessMap = rough;
    s.metalnessMap = s.metalnessMap ? rough : null;
    for (const t of [s.map, s.normalMap, s.roughnessMap, s.metalnessMap, s.aoMap]) if (t) t.userData.mimeType = 'image/jpeg';
  }
  const glb = (await new GLTFExporter().parseAsync(out, { binary: true, maxTextureSize: maxTexture, onlyVisible: false })) as ArrayBuffer;
  return {
    glb,
    bones: bones.map((b) => b.name),
    scanBones,
    vertices: N,
    triangles: (geo.index ? geo.index.count : N) / 3,
    height: new THREE.Box3().setFromBufferAttribute(geo.attributes.position as THREE.BufferAttribute).max.y,
    turned,
  };
}
