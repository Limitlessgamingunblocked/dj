/*
 * The crowd's body: a real human figure in place of turned tubes.
 *
 * The mesh is MakeHuman's (CC0), converted by scripts/crowd-body/build.mjs
 * into crowdbody.data.ts: reposed into the crowd's rest pose, simplified into
 * three levels of detail that share one set of vertices (the front row's
 * close-up, the crowd's near model, its far one), with
 *   – the crowd's bones and a blend per vertex: the bone it follows and how
 *     much of that bone's own joint turn it takes (crowd.ts bends shoulders,
 *     elbows, hips, knees and the neck smoothly with it)
 *   – a region per vertex (torso, upper arm, forearm, hand, head, thigh,
 *     shin, foot, eye) that becomes the crowd's material codes
 *   – five shape offsets every person mixes their own amount of in the vertex
 *     shader: a woman's figure, a heavier or slimmer build, more or less
 *     muscle, African and East Asian features (normals too for the first
 *     three), packed as half floats into three uvec4 attributes
 *
 * Built from it here: the body for a level of detail with clothes a little
 * proud of the skin and shoes over the feet, the hair as a shell over the
 * scalp, brows over the brow ridge, and the eyes. Props and hats get the
 * same attributes (attach) and borrow the nearest body vertex's offsets, so a
 * cap still fits a smaller head and a phone stays in a narrower hand.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BODY_DATA, BODY_JOINTS, BODY_JOINTS_FEMALE, BODY_LANDMARKS, BODY_LAYOUT, BODY_REGION } from './crowdbody.data';

export const JOINTS = BODY_JOINTS;
export const JOINTS_FEMALE = BODY_JOINTS_FEMALE;
export const LANDMARKS = BODY_LANDMARKS;
export { BODY_REGION };
const R = BODY_REGION;

/** the morph attributes (half floats, two to a uint) */
export const MORPH_ATTRS = ['aMorphA', 'aMorphB', 'aMorphC'] as const;

interface Decoded {
  n: number;
  pos: Float32Array;
  nor: Float32Array;
  bone: Uint8Array;
  f: Float32Array;
  region: Uint8Array;
  /** per vertex, 24 half floats as 12 uints: woman (pos, normal), build (pos, normal), muscle (pos, normal), African, East Asian */
  morph: Uint32Array;
  /** the position offsets (metres) per morph, for borrowing */
  dpos: Float32Array[];
  lods: Uint16Array[];
  eyes: Uint16Array;
}

let data: Decoded | null = null;

function decode(): Decoded {
  if (data) return data;
  const L = BODY_LAYOUT;
  const raw = atob(BODY_DATA);
  const bin = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  const buf = bin.buffer;
  const n = L.vertices;
  const o = L.offsets;
  let s = 0;
  const qpos = new Int16Array(buf, o[s++], n * 3);
  const qnor = new Int8Array(buf, o[s++], n * 3);
  const rig = new Uint8Array(buf, o[s++], n * 3);
  const dq = [0, 1, 2, 3, 4].map(() => new Int16Array(buf, o[s++], n * 3));
  const nq = [0, 1, 2].map(() => new Int8Array(buf, o[s++], n * 3));
  const lods = L.lods.map((c) => new Uint16Array(buf, o[s++], c));
  const eyes = new Uint16Array(buf, o[s++], L.eyes);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    pos[i] = qpos[i] * L.posScale;
    nor[i] = qnor[i] / 127;
  }
  const bone = new Uint8Array(n);
  const f = new Float32Array(n);
  const region = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    bone[i] = rig[i * 3];
    f[i] = rig[i * 3 + 1] / 255;
    region[i] = rig[i * 3 + 2];
  }
  const dpos = dq.map((q) => Float32Array.from(q, (v) => v * L.morphScale));
  const dnor = nq.map((q) => Float32Array.from(q, (v) => v * L.normalMorphScale));
  const morph = new Uint32Array(n * 12);
  const halves = new Uint16Array(24);
  for (let i = 0; i < n; i++) {
    let h = 0;
    const put = (a: Float32Array) => {
      for (let k = 0; k < 3; k++) halves[h++] = THREE.DataUtils.toHalfFloat(a[i * 3 + k]);
    };
    put(dpos[0]);
    put(dnor[0]);
    put(dpos[1]);
    put(dnor[1]);
    put(dpos[2]);
    put(dnor[2]);
    put(dpos[3]);
    put(dpos[4]);
    for (let k = 0; k < 12; k++) morph[i * 12 + k] = halves[k * 2] | (halves[k * 2 + 1] << 16);
  }
  data = { n, pos, nor, bone, f, region, morph, dpos, lods, eyes };
  return data;
}

/** the crowd's material codes for the body's regions (crowd.ts and frontrow.ts own the codes) */
export interface BodyMats {
  top: number;
  bottoms: number;
  skin: number;
  sleeveUp: number;
  sleeveLo: number;
  shin: number;
  shoes: number;
  eye: number;
}

/** where the top meets the trousers (the shaders refine it per pixel) */
export const WAIST_Y = JOINTS.hip[1] + 0.07;

/* clothes sit a little proud of the skin, shoes over the feet */
const PROUD: Record<number, number> = { [R.torso]: 0.003, [R.upper]: 0.0025, [R.fore]: 0.002, [R.thigh]: 0.003, [R.shin]: 0.0025, [R.foot]: 0.007 };

/** a geometry over a list of the body's vertices: one entry per output vertex (the body vertex it copies, its material, its offset along the normal) */
function build(src: number[], mats: number[], push: number[], thick: number[]): THREE.BufferGeometry {
  const d = decode();
  const n = src.length;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const aBone = new Float32Array(n);
  const aMat = new Float32Array(n);
  const aW = new Float32Array(n);
  const aRig = new Float32Array(n * 4);
  const morph = MORPH_ATTRS.map(() => new Uint32Array(n * 4));
  for (let j = 0; j < n; j++) {
    const i = src[j];
    for (let k = 0; k < 3; k++) {
      nor[j * 3 + k] = d.nor[i * 3 + k];
      pos[j * 3 + k] = d.pos[i * 3 + k] + d.nor[i * 3 + k] * push[j];
    }
    uv[j * 2] = thick[j];
    aBone[j] = d.bone[i];
    aMat[j] = mats[j];
    aW[j] = d.f[i];
    aRig.set([d.bone[i], mats[j], d.f[i], 0], j * 4);
    for (let a = 0; a < 3; a++) for (let k = 0; k < 4; k++) morph[a][j * 4 + k] = d.morph[i * 12 + a * 4 + k];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aBone', new THREE.BufferAttribute(aBone, 1));
  g.setAttribute('aMat', new THREE.BufferAttribute(aMat, 1));
  g.setAttribute('aW', new THREE.BufferAttribute(aW, 1));
  g.setAttribute('aRig', new THREE.BufferAttribute(aRig, 4));
  MORPH_ATTRS.forEach((name, a) => g.setAttribute(name, morphAttr(morph[a])));
  return g;
}

function morphAttr(a: Uint32Array): THREE.BufferAttribute {
  const attr = new THREE.BufferAttribute(a, 4);
  attr.gpuType = THREE.IntType;
  return attr;
}

/** the regions' materials */
function regionMat(m: BodyMats, region: number, y: number): number {
  switch (region) {
    case R.torso:
      return y > WAIST_Y ? m.top : m.bottoms;
    case R.upper:
      return m.sleeveUp;
    case R.fore:
      return m.sleeveLo;
    case R.thigh:
      return m.bottoms;
    case R.shin:
      return m.shin;
    case R.foot:
      return m.shoes;
    case R.eye:
      return m.eye;
    default:
      return m.skin;
  }
}

/** triangles to an indexed geometry, a vertex for each (body vertex, material) so no triangle blends two materials */
function trisToGeometry(tris: ArrayLike<number>, triMat: (t: number) => number, push: (i: number) => number, thick: (i: number) => number = () => 0): THREE.BufferGeometry {
  const key = new Map<number, number>();
  const src: number[] = [];
  const mats: number[] = [];
  const pushes: number[] = [];
  const thicks: number[] = [];
  const index: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const m = triMat(t);
    for (let k = 0; k < 3; k++) {
      const i = tris[t + k];
      const id = i * 64 + m;
      let j = key.get(id);
      if (j === undefined) {
        j = src.length;
        key.set(id, j);
        src.push(i);
        mats.push(m);
        pushes.push(push(i));
        thicks.push(thick(i));
      }
      index.push(j);
    }
  }
  const g = build(src, mats, pushes, thicks);
  g.setIndex(index);
  return g;
}

/** the body at a level of detail (0 the front row's, 1 the crowd's near model, 2 its far one), with the eyes if asked */
export function bodyGeometry(lod: 0 | 1 | 2, mats: BodyMats, o: { eyes?: boolean } = {}): THREE.BufferGeometry {
  const d = decode();
  // the feet are inside the shoes (shoeGeometry)
  const all = d.lods[lod];
  const tris: number[] = [];
  for (let t = 0; t < all.length; t += 3) {
    const feet = [0, 1, 2].filter((k) => d.region[all[t + k]] === R.foot).length;
    if (feet < 2) tris.push(all[t], all[t + 1], all[t + 2]);
  }
  if (o.eyes) tris.push(...d.eyes);
  const y = (t: number) => (d.pos[tris[t] * 3 + 1] + d.pos[tris[t + 1] * 3 + 1] + d.pos[tris[t + 2] * 3 + 1]) / 3;
  const region = (t: number) => {
    // the region most of the corners are in (the first corner's on a three-way split)
    const a = d.region[tris[t]];
    const b = d.region[tris[t + 1]];
    const c = d.region[tris[t + 2]];
    return b === c ? b : a;
  };
  return trisToGeometry(
    tris,
    (t) => regionMat(mats, region(t), y(t)),
    (i) => PROUD[d.region[i]] ?? 0,
  );
}

/* ------------------------------------------------------------------ shoes */

const FOOT = LANDMARKS.foot;
/** where a shoe's middle sits (the right foot: +x) */
export const SHOE = { x: (FOOT.lo[0] + FOOT.hi[0]) / 2, z0: FOOT.lo[2] - 0.008, z1: FOOT.hi[2] + 0.012, w: (FOOT.hi[0] - FOOT.lo[0]) / 2 + 0.008 };

/**
 * A trainer over each foot: a flat sole, a rounded toe, the heel counter up
 * round the ankle (the leg goes down inside it), turned out a touch. Shapes
 * made here, so they're the right side's; mirrored for the left.
 */
export function shoeShape(sd: number, ws: number, hs: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position;
  const len = (SHOE.z1 - SHOE.z0) / 2;
  const zc = (SHOE.z0 + SHOE.z1) / 2;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i);
    const vy = p.getY(i);
    const vz = p.getZ(i);
    const z = zc + vz * len;
    // the top: high at the heel and the ankle, low over the toes
    const t = (z - SHOE.z0) / (SHOE.z1 - SHOE.z0);
    // (crowd.ts paints the body's own foot above this as the leg)
    const top = 0.112 - 0.02 * smoothstep(0.1, 0.5, t) - 0.045 * smoothstep(0.55, 1.0, t);
    const y = ((vy + 1) / 2) ** 0.8 * top;
    // wider across the ball of the foot than at the heel
    const w = SHOE.w * (0.82 + 0.2 * smoothstep(0.0, 0.6, t) - 0.12 * smoothstep(0.8, 1.0, t));
    p.setXYZ(i, vx * w, Math.max(0.0, y), z);
  }
  g.rotateY(sd * 0.1);
  g.translate(sd * SHOE.x, 0, 0);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

/** a shape welded (no seams in its shading), with fresh normals and a blank uv */
export function welded(g: THREE.BufferGeometry, eps = 1e-6): THREE.BufferGeometry {
  if (g.attributes.normal) g.deleteAttribute('normal');
  if (g.attributes.uv) g.deleteAttribute('uv');
  const w = mergeVertices(g, eps);
  w.computeVertexNormals();
  w.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(w.attributes.position.count * 2), 2));
  return w;
}

/* ------------------------------------------------------------------ hair and brows */

const E = LANDMARKS.eye;
/** the lowest the hair ever comes (the shaders raise it per style): over the forehead, down past the temples and to the nape */
export function hairlineY(x: number, z: number): number {
  const a = Math.abs(Math.atan2(x, z - 0.02)) / Math.PI;
  // front of the head 0, the sides 0.5, the back 1
  const front = E[1] + 0.036;
  const temple = E[1] + 0.028;
  const side = E[1] + 0.012;
  const back = E[1] - 0.115;
  if (a < 0.22) return front + (temple - front) * smoothstep(0.08, 0.22, a);
  if (a < 0.5) return temple + (side - temple) * smoothstep(0.22, 0.5, a);
  return side + (back - side) * smoothstep(0.5, 0.85, a);
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** the ears stay out of the hair */
const inEar = (x: number, y: number, z: number) => Math.abs(x) > 0.062 && y < E[1] + 0.012 && y > E[1] - 0.075 && z < 0.06 && z > -0.035;

/**
 * The hair: the scalp's triangles again, pushed out along the normal (thin
 * at the hairline, fuller over the crown). uv.x carries the thickness, so
 * the shader can take a style down to a crop.
 */
export function hairGeometry(lod: 0 | 1 | 2, mat: number): THREE.BufferGeometry {
  const d = decode();
  const src = d.lods[lod];
  const tris: number[] = [];
  const above = (i: number) => {
    const x = d.pos[i * 3];
    const y = d.pos[i * 3 + 1];
    const z = d.pos[i * 3 + 2];
    return d.region[i] === R.head && y > hairlineY(x, z) - 0.012 && !inEar(x, y, z);
  };
  // a triangle across the line comes too (the shaders cut the line per pixel), so the big triangles at the temples of
  // the simpler meshes don't leave a notch of skin there
  const head = (i: number) => d.region[i] === R.head && !inEar(d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]);
  for (let t = 0; t < src.length; t += 3) {
    const c = [src[t], src[t + 1], src[t + 2]];
    if (c.every(head) && c.some(above)) tris.push(c[0], c[1], c[2]);
  }
  const thick = (i: number) => {
    const x = d.pos[i * 3];
    const y = d.pos[i * 3 + 1];
    const z = d.pos[i * 3 + 2];
    const over = y - hairlineY(x, z);
    return 0.0025 + 0.011 * smoothstep(0.0, 0.07, over) + 0.004 * smoothstep(1.66, 1.74, y);
  };
  return trisToGeometry(tris, () => mat, thick, thick);
}

/** the brows: the brow ridge's triangles, a hair's breadth out (the shader draws their shape) */
export function browGeometry(lod: 0 | 1 | 2, mat: number): THREE.BufferGeometry {
  const d = decode();
  const src = d.lods[lod];
  const tris: number[] = [];
  const on = (i: number) => {
    const x = Math.abs(d.pos[i * 3]);
    const y = d.pos[i * 3 + 1];
    const z = d.pos[i * 3 + 2];
    return d.region[i] === R.head && x > 0.004 && x < 0.07 && y > E[1] + 0.004 && y < E[1] + 0.042 && z > 0.07;
  };
  for (let t = 0; t < src.length; t += 3) if (on(src[t]) && on(src[t + 1]) && on(src[t + 2])) tris.push(src[t], src[t + 1], src[t + 2]);
  return trisToGeometry(tris, () => mat, () => 0.0012);
}

/**
 * A shell over a region of the body (a jacket over the top and sleeves):
 * the body's own triangles pushed out, so it fits every figure.
 */
export function shellGeometry(lod: 0 | 1 | 2, pick: (region: number, y: number) => number | null, out: number): THREE.BufferGeometry {
  const d = decode();
  const src = d.lods[lod];
  const tris: number[] = [];
  const mats: number[] = [];
  for (let t = 0; t < src.length; t += 3) {
    const r = d.region[src[t + 1]] === d.region[src[t + 2]] ? d.region[src[t + 1]] : d.region[src[t]];
    const y = (d.pos[src[t] * 3 + 1] + d.pos[src[t + 1] * 3 + 1] + d.pos[src[t + 2] * 3 + 1]) / 3;
    const m = pick(r, y);
    if (m === null) continue;
    tris.push(src[t], src[t + 1], src[t + 2]);
    mats.push(m);
  }
  return trisToGeometry(tris, (t) => mats[t / 3], (i) => (PROUD[d.region[i]] ?? 0) + out);
}

/* ------------------------------------------------------------------ attaching parts */

/**
 * Give a part made elsewhere (a prop, a hat, the long hair) the body's
 * attributes: it follows its bone rigidly (aW 1), and borrows the shape
 * offsets of the nearest body vertex on the same bone, so it moves with the
 * figure it's on.
 */
export function attach(g: THREE.BufferGeometry, bone: number, mat: number, follow = true): THREE.BufferGeometry {
  const d = decode();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('aBone', new THREE.BufferAttribute(new Float32Array(n).fill(bone), 1));
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
  g.setAttribute('aW', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  const rig = new Float32Array(n * 4);
  for (let j = 0; j < n; j++) rig.set([bone, mat, 1, 0], j * 4);
  g.setAttribute('aRig', new THREE.BufferAttribute(rig, 4));
  const morph = MORPH_ATTRS.map(() => new Uint32Array(n * 4));
  if (follow) {
    const pos = g.attributes.position;
    const cand: number[] = [];
    for (let i = 0; i < d.n; i++) if (d.bone[i] === bone && d.region[i] !== R.eye) cand.push(i);
    if (!cand.length) for (let i = 0; i < d.n; i++) cand.push(i);
    // halves 3-5, 9-11 and 15-17 are the normal offsets
    const isNormal = (h: number) => (h >= 3 && h <= 5) || (h >= 9 && h <= 11) || (h >= 15 && h <= 17);
    for (let j = 0; j < n; j++) {
      const x = pos.getX(j);
      const y = pos.getY(j);
      const z = pos.getZ(j);
      let best = -1;
      let bd = Infinity;
      for (const i of cand) {
        const dd = (d.pos[i * 3] - x) ** 2 + (d.pos[i * 3 + 1] - y) ** 2 + (d.pos[i * 3 + 2] - z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
      // the position offsets only (a rigid part keeps its own normals)
      const words = d.morph.subarray(best * 12, best * 12 + 12);
      for (let w = 0; w < 12; w++) {
        const lo = isNormal(w * 2) ? 0 : words[w] & 0xffff;
        const hi = isNormal(w * 2 + 1) ? 0 : words[w] >>> 16;
        morph[Math.floor(w / 4)][j * 4 + (w % 4)] = (lo | (hi << 16)) >>> 0;
      }
    }
  }
  MORPH_ATTRS.forEach((name, a) => g.setAttribute(name, morphAttr(morph[a])));
  return g;
}

/** after mergeGeometries: the merged morph attributes are integers again */
export function fixMorphTypes(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of MORPH_ATTRS) {
    const a = g.attributes[name] as THREE.BufferAttribute | undefined;
    if (a) a.gpuType = THREE.IntType;
  }
  return g;
}

/* ------------------------------------------------------------------ the shader side */

const v3 = (a: number[]) => `vec3(${a.map((x) => x.toFixed(4)).join(', ')})`;

/** GLSL: the morph attributes, and the shape mixed for this person (iBody: woman, build, muscle, ancestry + tone) */
export const MORPH_GLSL = /* glsl */ `
  attribute uvec4 aMorphA;
  attribute uvec4 aMorphB;
  attribute uvec4 aMorphC;
  attribute vec4 iBody;
  /* the person's mix of the African and East Asian shapes, from their ancestry (iBody.w: the whole part, 0 / 1 African / 2 East Asian; the fraction, the skin tone) */
  vec2 bodyAncestry() {
    float cls = floor(iBody.w);
    float h = fract(iBody.w * 37.13 + iSeed.x * 3.1);
    float tone = fract(iBody.w);
    float af = cls > 0.5 && cls < 1.5 ? 0.7 + 0.3 * h : 0.25 * smoothstep(0.45, 0.8, tone) * h;
    float asn = cls > 1.5 ? 0.75 + 0.25 * h : 0.0;
    return vec2(af, asn);
  }
  void morphBody(inout vec3 p, inout vec3 n) {
    vec2 a0 = unpackHalf2x16(aMorphA.x), a1 = unpackHalf2x16(aMorphA.y), a2 = unpackHalf2x16(aMorphA.z), a3 = unpackHalf2x16(aMorphA.w);
    vec2 b0 = unpackHalf2x16(aMorphB.x), b1 = unpackHalf2x16(aMorphB.y), b2 = unpackHalf2x16(aMorphB.z), b3 = unpackHalf2x16(aMorphB.w);
    vec2 c0 = unpackHalf2x16(aMorphC.x), c1 = unpackHalf2x16(aMorphC.y), c2 = unpackHalf2x16(aMorphC.z), c3 = unpackHalf2x16(aMorphC.w);
    vec2 anc = bodyAncestry();
    p += vec3(a0, a1.x) * iBody.x + vec3(a3, b0.x) * iBody.y + vec3(b2, b3.x) * iBody.z + vec3(c1, c2.x) * anc.x + vec3(c2.y, c3) * anc.y;
    n = normalize(n + vec3(a1.y, a2) * iBody.x + vec3(b0.y, b1) * iBody.y + vec3(b3.y, c0) * iBody.z);
  }
  /* the joints, moved for a woman's figure */
  vec3 jShoulder(float sd) { vec3 j = mix(${v3(JOINTS.shoulder)}, ${v3(JOINTS_FEMALE.shoulder)}, iBody.x); return vec3(sd * j.x, j.yz); }
  vec3 jElbow(float sd) { vec3 j = mix(${v3(JOINTS.elbow)}, ${v3(JOINTS_FEMALE.elbow)}, iBody.x); return vec3(sd * j.x, j.yz); }
  vec3 jHip(float sd) { vec3 j = mix(${v3(JOINTS.hip)}, ${v3(JOINTS_FEMALE.hip)}, iBody.x); return vec3(sd * j.x, j.yz); }
  vec3 jKnee(float sd) { vec3 j = mix(${v3(JOINTS.knee)}, ${v3(JOINTS_FEMALE.knee)}, iBody.x); return vec3(sd * j.x, j.yz); }
  vec3 jNeck() { return mix(${v3(JOINTS.neck)}, ${v3(JOINTS_FEMALE.neck)}, iBody.x); }
`;
