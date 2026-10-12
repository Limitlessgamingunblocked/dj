/*
 * The crowd: one instanced mesh of jointed people posed in the vertex shader.
 *   – a skeleton of rigid parts (thighs, shins, upper arms, forearms, head,
 *     torso) bent at hips, knees, shoulders, elbows and neck; knees bend on
 *     the beat and kick transients, the weight steps from leg to leg, the
 *     body leans into the beat, hips sway, shoulders twist, heads nod and
 *     look around
 *   – behaviours blend per person with slowly drifting noise and the show
 *     state: club-dance arms, hands in the air waving, fist pumps on the
 *     beat, clapping overhead in build-ups, everyone up and jumping on drops
 *     and hook lines, filming with a phone (screen and torch light up)
 *   – roles: dancers, LED-sign holders (scrolling-dot signs held overhead),
 *     VIP guests by the booth (drink in hand, swaying, chatting, filming;
 *     phone lights up in the breakdowns) and the DJ (hands on the decks, a
 *     hand up on the drop); the staff: security (arms folded, a nod when it's
 *     going well), bartenders (shaking drinks), the lighting tech (hands on
 *     the desk)
 *   – the regulars (Section 8.2), picked from the dancers at every venue: the
 *     marathon dancer (never stops), the filmer (phone up the whole set),
 *     the towel guy (spins a towel overhead on every drop), the bar-leaner
 *     (only dances when the vibe's really high) and, at festivals, the
 *     shoulder-riders who pop up at the peak
 *   – the figure: a shaped torso, rounded shoulders, jaw, nose and ears,
 *     trainers; clothing: tops in the venue's palette, sleeves, trousers (or
 *     shorts, more at the warm venues) and shoes picked per person, skin and
 *     hair tones varied, long hair on some, caps on a few, builds slimmer
 *     and broader
 *   – performance: dancers are grouped in ~6 m chunks, each its own instanced
 *     mesh, so chunks off screen are culled; chunks far from the camera swap
 *     to a low-detail model (a little under half the triangles). Both models
 *     share one set of vertex buffers.
 */
import * as THREE from 'three';
import { nameService } from '../../name/NameService';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';
import { blobTexture } from './details';
import { useLightMap, type LightMap } from './lightmap';
import { rng } from './tex';
import { CrowdSteam, sweatStep } from './airlife';

export type CrowdRole = 'dancer' | 'sign' | 'vip' | 'dj' | 'marathon' | 'filmer' | 'towel' | 'barlean' | 'rider' | 'security' | 'bartender';
const ROLE_CODE: Record<CrowdRole, number> = { dancer: 0, sign: 1, vip: 2, dj: 3, marathon: 4, filmer: 5, towel: 6, barlean: 7, rider: 8, security: 9, bartender: 10 };

export interface CrowdSpot {
  x: number;
  z: number;
  y?: number;
  /** yaw; defaults to facing the DJ booth */
  face?: number;
  scale?: number;
  role?: CrowdRole;
}

export interface CrowdOptions {
  clothes?: string[];
  seed?: number;
  /** share of people filming on their phones */
  phones?: number;
  /** share of people holding a drink */
  drinks?: number;
  /** LED signs held up (picked from the people closest to the booth) */
  signs?: number;
  /** role for spots that don't name one */
  role?: CrowdRole;
  booth?: THREE.Vector3;
  /** soft contact shadows on the floor under each person (default on) */
  shadows?: boolean;
  /**
   * The regulars picked from the dancers (Section 8.2): a marathon dancer, a
   * filmer or two, the towel guy (default on for a crowd of 30 or more), and
   * how many shoulder-riders (festivals).
   */
  regulars?: boolean;
  riders?: number;
  /** the venue's floor light map: people are lit by the light landing where they stand */
  lightMap?: LightMap;
  /** share of people in shorts (more at the warm outdoor venues) */
  shorts?: number;
  /** body heat rising off the crowd at the peak (0 for none; default on for 40 or more people) */
  steam?: number;
}

let shadowGeo: THREE.BufferGeometry | null = null;
let shadowMat: THREE.MeshBasicMaterial | null = null;

/* bones */
const B = { body: 0, thighL: 1, thighR: 2, shinL: 3, shinR: 4, upperL: 5, foreL: 6, upperR: 7, foreR: 8, head: 9, sign: 10 };
/* materials (longHair, cap and hairUp, a quiff, are worn by some people; shin is the trouser leg or, in shorts, bare skin) */
const M = { top: 0, bottoms: 1, skin: 2, hair: 3, shoes: 4, sleeveUp: 5, sleeveLo: 6, cup: 7, phone: 8, screen: 9, torch: 10, signFrame: 11, signFace: 12, towel: 13, longHair: 14, shin: 15, cap: 16, hairUp: 17 };
export const PERSON_BONES = B;
export const PERSON_MATS = M;

/*
 * Profiles (radius against height) the body parts are turned from. Stylised
 * realism: real proportions, smooth continuous forms, a little character in
 * the shapes (a calf, a thigh that fills out, a forearm that narrows to the
 * wrist), never blocky segments.
 */
/* the torso, hips to the base of the neck: the waist in, the ribcage, the slope of the shoulders */
const TORSO: [number, number][] = [
  [0, 0.94],
  [0.142, 0.94],
  [0.137, 0.98],
  [0.13, 1.03],
  [0.127, 1.08],
  [0.132, 1.14],
  [0.145, 1.2],
  [0.157, 1.26],
  [0.164, 1.31],
  [0.167, 1.35],
  [0.161, 1.39],
  [0.142, 1.42],
  [0.108, 1.444],
  [0.066, 1.458],
  [0, 1.466],
];
/* the lower leg, ankle to knee: the calf bulges high and the shin runs straight */
const SHIN: [number, number][] = [
  [0.034, 0.06],
  [0.038, 0.11],
  [0.045, 0.18],
  [0.054, 0.27],
  [0.057, 0.33],
  [0.053, 0.41],
  [0.05, 0.47],
  [0.052, 0.52],
];
/* the thigh, knee to hip: it fills out towards the hip */
const THIGH: [number, number][] = [
  [0.054, 0.49],
  [0.058, 0.56],
  [0.067, 0.65],
  [0.077, 0.75],
  [0.085, 0.84],
  [0.089, 0.91],
  [0.086, 0.97],
];
/* the upper arm, elbow to shoulder, and the forearm, wrist to elbow */
const UPPER_ARM: [number, number][] = [
  [0.041, 1.13],
  [0.044, 1.18],
  [0.049, 1.26],
  [0.052, 1.33],
  [0.052, 1.4],
];
const FOREARM: [number, number][] = [
  [0.029, 0.875],
  [0.031, 0.91],
  [0.037, 0.98],
  [0.041, 1.06],
  [0.041, 1.14],
];
/* the pelvis, under the torso, in the trousers: it carries the body's outline down to the legs */
const PELVIS: [number, number][] = [
  [0.08, 0.83],
  [0.125, 0.86],
  [0.143, 0.9],
  [0.147, 0.95],
  [0.142, 0.99],
];
/* the neck */
const NECK: [number, number][] = [
  [0.054, 1.43],
  [0.047, 1.47],
  [0.044, 1.52],
  [0.046, 1.56],
];

const personGeo: (THREE.BufferGeometry | null)[] = [null, null];

function part(g: THREE.BufferGeometry, bone: number, mat: number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  g.setAttribute('aBone', new THREE.Float32BufferAttribute(new Float32Array(n).fill(bone), 1));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(new Float32Array(n).fill(mat), 1));
  return g;
}

/** a body part turned from a profile (every other point at low detail), closed at both ends, centred on x, z */
function turned(profile: [number, number][], radial: number, lo: boolean, x = 0, z = 0): THREE.BufferGeometry {
  const pts = lo ? profile.filter((_, i) => i % 2 === 0 || i === profile.length - 1) : profile;
  const first = pts[0];
  const last = pts[pts.length - 1];
  // the ends close with a little dome, so a wrist or a hem never shows the inside of the tube
  const closed: [number, number][] = [[0, first[1] - first[0] * 0.35], ...pts, [0, last[1] + last[0] * 0.35]];
  return new THREE.LatheGeometry(
    closed.map(([r, y]) => new THREE.Vector2(r, y)),
    radial,
  ).translate(x, 0, z);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The head's shape on a unit sphere: the skull, narrowing through the jaw to
 * the chin, the back of the jaw tucked into the neck, the forehead a touch
 * flatter. One surface, so the face shades as one piece.
 */
function shapeHead(v: THREE.Vector3): THREE.Vector3 {
  const t = Math.max(0, -v.y);
  let x = v.x * (1 - 0.3 * t * t);
  let z = v.z;
  if (z < 0) z *= 1 - 0.38 * t;
  else z *= 1 - 0.08 * t + 0.06 * smooth(0.55, 1, t) * smooth(0.3, 0.9, v.z);
  if (z > 0 && v.y > 0.3) z *= 0.96;
  if (v.y > -0.25 && v.y < 0.15 && z > 0) x *= 1.03;
  return v.set(x * 0.084, v.y * 0.112, z * 0.1);
}

/** a sphere made into the head (or, scaled out, the hair over it), welded so it shades without a seam */
function headGeometry(ws: number, hs: number, thetaLen = Math.PI, hairline?: (phi: number) => number, thick = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, thetaLen);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (hairline) {
      // the hair: rows past the hairline (lower at the back, higher at the front) are drawn up to it,
      // and the hair thins to nothing at its edge so it meets the skin instead of sitting on it
      const phi = Math.atan2(v.x, v.z);
      const theta = Math.acos(Math.max(-1, Math.min(1, v.y)));
      const limit = hairline(phi);
      const th = Math.min(theta, limit);
      const s = Math.sin(th);
      v.set((v.x / Math.max(1e-6, Math.sin(theta))) * s, Math.cos(th), (v.z / Math.max(1e-6, Math.sin(theta))) * s);
      if (!Number.isFinite(v.x)) v.set(0, 1, 0);
      const k = 1 + thick * (1 - smooth(0.62, 1, th / limit));
      shapeHead(v).multiplyScalar(k);
    } else shapeHead(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  const w = mergeVertices(g, 1e-5);
  w.computeVertexNormals();
  w.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(w.attributes.position.count * 2), 2));
  return w;
}

/**
 * Rest pose: standing, facing +Z, feet on y = 0, about 1.75 m tall.
 * detail 0 is the close-up model; detail 1 keeps the same skeleton and props
 * with far fewer segments (used for dancers away from the camera, and for the
 * far crowd's cut-outs). The joints are where the pose expects them: hips at
 * 0.9, knees 0.5, shoulders 1.42, elbows 1.14, the neck 1.47; knee and elbow
 * caps fill the bend so a bent leg or arm never opens a gap.
 */
export function personGeometry(detail: 0 | 1 = 0): THREE.BufferGeometry {
  const cached = personGeo[detail];
  if (cached) return cached;
  const lo = detail === 1;
  const R = (hi: number, low: number) => (lo ? low : hi);
  const cap = (r: number, len: number, caps: number, radial: number) => new THREE.CapsuleGeometry(r, len, lo ? Math.max(1, caps - 1) : caps, lo ? Math.max(4, radial - 4) : radial);
  const sph = (r: number, ws: number, hs: number, ...rest: number[]) => new THREE.SphereGeometry(r, lo ? Math.max(5, Math.round(ws / 2)) : ws, lo ? Math.max(3, Math.round(hs / 2)) : hs, ...rest);
  const parts: THREE.BufferGeometry[] = [];
  for (const sd of [-1, 1]) {
    const L = sd < 0;
    const lx = sd * 0.09;
    const ax = sd * 0.2;
    const shin = L ? B.shinL : B.shinR;
    const thigh = L ? B.thighL : B.thighR;
    const upper = L ? B.upperL : B.upperR;
    const fore = L ? B.foreL : B.foreR;
    parts.push(
      // trainers: a rounded toe and heel, flatter than they are wide (the sole and laces are painted)
      part(cap(0.047, 0.15, 2, 10).rotateX(Math.PI / 2).scale(1.1, 0.72, 1).translate(lx, 0.035, 0.046), shin, M.shoes),
      part(turned(SHIN, R(12, 6), lo, lx), shin, M.shin),
      // the knee cap turns with the shin, so a bent knee stays closed
      part(sph(0.05, 10, 6).scale(1, 1, 1.04).translate(lx, 0.505, 0.003), shin, M.shin),
      part(turned(THIGH, R(12, 6), lo, lx), thigh, M.bottoms),
      // the shoulder's round (it turns with the arm, so a raised arm keeps its shoulder)
      part(sph(0.056, 10, 7).scale(1, 0.9, 0.9).translate(ax, 1.378, 0), upper, M.sleeveUp),
      part(turned(UPPER_ARM, R(12, 6), lo, ax), upper, M.sleeveUp),
      part(sph(0.043, 8, 5).translate(ax, 1.14, 0), fore, M.sleeveLo),
      part(turned(FOREARM, R(10, 5), lo, ax), fore, M.sleeveLo),
      // the hand: palm and fingers in one mitten, the palm towards the leg
      part(sph(0.042, 8, 7).scale(0.55, 1.3, 0.9).translate(ax - sd * 0.004, 0.818, 0.006), fore, M.skin),
    );
    if (!lo) {
      // the thumb, forward of the palm
      parts.push(part(cap(0.0115, 0.028, 2, 6).rotateX(-0.5).rotateZ(sd * 0.25).translate(ax - sd * 0.006, 0.83, 0.036), fore, M.skin));
      // ears
      parts.push(part(sph(0.027, 6, 5).scale(0.36, 1, 0.66).translate(sd * 0.081, 1.597, -0.004), B.head, M.skin));
    }
  }
  parts.push(
    part(turned(PELVIS, R(16, 8), lo).scale(1.12, 1, 0.7), B.body, M.bottoms),
    // the torso, deeper at the chest than the waist
    part(new THREE.LatheGeometry(lo ? TORSO.filter((_, i) => i % 2 === 0 || i === TORSO.length - 1).map(([r, y]) => new THREE.Vector2(r, y)) : TORSO.map(([r, y]) => new THREE.Vector2(r, y)), R(16, 8)).scale(1.12, 1, 0.68), B.body, M.top),
    part(turned(NECK, R(12, 6), lo), B.head, M.skin),
    // the head in one piece: the skull a little large for the body (it reads at a distance), narrowing to the jaw
    part(headGeometry(R(18, 9), R(14, 7)).translate(0, 1.6, 0.004), B.head, M.skin),
    // the hair: a shell over the skull, the hairline high on the forehead, over the tops of the ears, down to the nape
    part(headGeometry(R(18, 9), R(10, 5), Math.PI * 0.66, (phi) => Math.PI * (0.4 + 0.24 * smooth(0.5, 2.9, Math.abs(phi))), 0.07).translate(0, 1.6, 0.004), B.head, M.hair),
    // a quiff: volume over the front of the crown (some people)
    part(sph(0.074, R(12, 6), R(8, 4)).scale(0.92, 0.3, 0.86).rotateX(-0.32).translate(0, 1.692, 0.03), B.head, M.hairUp),
    // long hair down the back and over the shoulders (some people)
    part(new THREE.CylinderGeometry(0.095, 0.122, 0.28, R(16, 6), R(2, 1), true, Math.PI * 0.32, Math.PI * 1.36).scale(0.92, 1, 0.98).translate(0, 1.5, -0.012), B.head, M.longHair),
    // a cap, peak forward (some people)
    part(sph(0.12, 12, 4, 0, Math.PI * 2, 0, Math.PI * 0.44).scale(0.8, 0.86, 0.95).translate(0, 1.633, -0.004), B.head, M.cap),
    part(new THREE.CylinderGeometry(0.085, 0.085, 0.01, R(12, 5), 1, false, -Math.PI / 2, Math.PI).scale(0.86, 1, 0.9).translate(0, 1.656, 0.052), B.head, M.cap),
    // phone in the right hand: screen faces the holder once the arm is raised, torch on the back
    part(new THREE.BoxGeometry(0.07, 0.14, 0.012).translate(0.2, 0.76, 0.03), B.foreR, M.phone),
    part(new THREE.PlaneGeometry(0.062, 0.128).translate(0.2, 0.76, 0.0365), B.foreR, M.screen),
    // cup in the left hand, pre-tilted so it stands upright in the drinking pose
    part(new THREE.CylinderGeometry(0.036, 0.028, 0.11, R(10, 5)).translate(0, 0.02, 0.04).rotateX(2.2).translate(-0.2, 0.83, 0), B.foreL, M.cup),
    // LED sign held overhead
    part(new THREE.BoxGeometry(0.76, 0.22, 0.02).translate(0, 2.1, 0.12), B.sign, M.signFrame),
    part(new THREE.PlaneGeometry(0.72, 0.18).translate(0, 2.1, 0.1305), B.sign, M.signFace),
    // the towel guy's towel, hanging from the right hand (it whirls when the arm goes up)
    part(new THREE.PlaneGeometry(0.32, 0.56, 1, lo ? 1 : 3).translate(0.2, 0.5, 0.02), B.foreR, M.towel),
  );
  if (!lo) {
    parts.push(part(new THREE.PlaneGeometry(0.014, 0.014).rotateY(Math.PI).translate(0.215, 0.705, 0.0235), B.foreR, M.torch));
    // the nose
    parts.push(part(sph(0.02, 8, 6).scale(0.66, 1.12, 1).translate(0, 1.588, 0.094), B.head, M.skin));
  }
  const geo = mergeGeometries(parts)!;
  personGeo[detail] = geo;
  return geo;
}

/** A geometry that shares `base`'s vertex buffers and adds per-chunk instance attributes. */
function chunkGeometry(base: THREE.BufferGeometry, inst: Record<string, THREE.InstancedBufferAttribute>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setIndex(base.index);
  for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
  for (const [name, attr] of Object.entries(inst)) g.setAttribute(name, attr);
  return g;
}

/* LED sign messages (one row each in the atlas) */
const SIGNS: { text: string; color: string }[] = [
  // the last row is the superfan's sign (sign row 0: the texture is flipped): the DJ's name once they have one
  { text: 'ONE MORE TUNE', color: '#ff2a3c' },
  { text: 'HI MUM', color: '#2ee6ff' },
  { text: 'I ♥ HOUSE', color: '#ff3df0' },
  { text: 'BIG TUNE!', color: '#ffd23f' },
  { text: 'DROP IT', color: '#3dff7a' },
  { text: 'WE WANT MORE', color: '#ff7a1a' },
  { text: 'PLAY IT AGAIN', color: '#8a7dff' },
  { text: 'LOVE THIS', color: '#ffffff' },
];
/* the funny ones: a few swap in for the regular messages at every venue */
const FUNNY: { text: string; color: string }[] = [
  { text: 'TOLD MUM I’M AT THE LIBRARY', color: '#2ee6ff' },
  { text: 'MARRY ME DJ', color: '#ff3df0' },
  { text: 'IT’S MY BIRTHDAY', color: '#ffd23f' },
  { text: 'SKIPPED WORK FOR THIS', color: '#3dff7a' },
  { text: 'BASS FACE', color: '#ff7a1a' },
  { text: 'I CAME FOR THE DROP', color: '#8a7dff' },
  { text: 'WHO NEEDS SLEEP', color: '#ffffff' },
  { text: 'MY FEET HATE YOU', color: '#ff2a3c' },
  { text: 'PLAY ONE MY DAD KNOWS', color: '#2ee6ff' },
  { text: 'TURN IT UP TO 11', color: '#ffd23f' },
  { text: 'NOD IF YOU’RE LOST', color: '#3dff7a' },
  { text: 'MORE COWBELL', color: '#ff7a1a' },
];
let signTex: THREE.CanvasTexture | null = null;
let signRows: { text: string; color: string }[] = SIGNS;

/** the messages on the crowd's signs: three funny ones in with the regulars, a new pick each time */
function shuffleSigns(): void {
  const rows = SIGNS.slice();
  const pool = FUNNY.slice();
  for (const i of [1, 3, 5]) rows[i] = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  signRows = rows;
  drawSigns();
}

function signAtlas(): THREE.Texture {
  if (signTex) return signTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 4;
  shuffleSigns();
  // a rename shows up on the signs straight away
  nameService.onChange(drawSigns);
  return signTex;
}

function drawSigns(): void {
  if (!signTex) return;
  const c = signTex.image as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  const rows = signRows.map((s, i) => (i === signRows.length - 1 && nameService.named ? { text: nameService.text, color: '#ff2e88' } : s));
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 1024);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  rows.forEach((s, i) => {
    const y = i * 128 + 64;
    let size = 104;
    g.font = `900 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    const w = g.measureText(s.text).width;
    if (w > 470) {
      size *= 470 / w;
      g.font = `900 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    }
    g.fillStyle = s.color;
    g.fillText(s.text, 256, y + 4);
  });
  signTex.needsUpdate = true;
}

export const VERT_HEAD = /* glsl */ `
  attribute float aBone;
  attribute float aMat;
  attribute vec4 iSeed;
  attribute vec4 iInfo;
  uniform float uBeat, uTime, uBob, uHands, uJump, uClap, uCheer, uKick, uCold, uSync, uHype, uRiders, uLook;
  varying float vMat;
  varying vec4 vSeed;
  varying vec2 vUv2;
  varying float vSignRow;
  varying vec3 vRest;
  varying float vBone;
  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
  float h1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
  float vnoise(float x) { float i = floor(x); float f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  mat3 poseR;
  vec3 poseT;
  void computePose() {
    float role = iInfo.x;
    float sign = step(0.5, role) * step(role, 1.5);
    float vip = step(1.5, role) * step(role, 2.5);
    float dj = step(2.5, role) * step(role, 3.5);
    float marathon = step(3.5, role) * step(role, 4.5);
    float filmer = step(4.5, role) * step(role, 5.5);
    float towel = step(5.5, role) * step(role, 6.5);
    float lean = step(6.5, role) * step(role, 7.5);
    float rider = step(7.5, role) * step(role, 8.5);
    float guard = step(8.5, role) * step(role, 9.5);
    float barman = step(9.5, role);
    // the bar-leaner only joins in when the room's really going
    float leanDance = lean * smoothstep(0.78, 0.92, uHype);
    float leaning = lean - leanDance;
    float staff = guard + barman;
    float dancer = 1.0 - sign - vip - dj - leaning - rider - staff;
    float ph = fract(uBeat + iSeed.x * 0.12);
    float hit = (1.0 - ph) * (1.0 - ph);
    float E = clamp(uHands * 1.9 - iSeed.y * 1.3, 0.0, 1.0);
    // the marathon dancer: going hard whatever the room's doing
    E = max(E, marathon * 0.85);
    float bob = max(uBob, marathon * 0.11);
    float n = vnoise(uBeat * 0.0625 + iSeed.x * 37.0);
    float swing = sin(uBeat * 3.14159 + iSeed.z * 6.283);
    float fb = fract(uBeat);
    // arms: x = out to the side, y = forward / up, z = elbow bend
    vec3 aL = vec3(0.18 + 0.06 * hit, 0.4 + 0.3 * hit, 1.4 + 0.25 * swing);
    vec3 aR = vec3(0.18 + 0.06 * hit, 0.4 + 0.3 * (1.0 - hit), 1.4 - 0.25 * swing);
    float wave = sin(uBeat * 1.5708 + iSeed.x * 6.283) * 0.28;
    float wUp = E * smoothstep(0.5, 0.6, n) * dancer;
    aL = mix(aL, vec3(2.5 + wave, 0.25, 0.35), wUp);
    aR = mix(aR, vec3(2.5 - wave, 0.25, 0.35), wUp);
    float pump = pow(1.0 - fb, 4.0);
    float wPump = E * (smoothstep(0.28, 0.36, n) - smoothstep(0.5, 0.6, n)) * dancer;
    aR = mix(aR, vec3(-0.05, 2.3 + 0.4 * pump, 1.2 - 1.0 * pump), wPump);
    float open = 1.0 - pow(1.0 - fb, 8.0);
    float wClap = uClap * step(0.25, fract(iSeed.z * 17.3)) * (dancer + vip * 0.5);
    aL = mix(aL, vec3(0.32 - 0.5 * open, 2.6, 0.3), wClap);
    aR = mix(aR, vec3(0.32 - 0.5 * open, 2.6, 0.3), wClap);
    float wCheer = uCheer * step(0.12, iSeed.y) * (dancer + vip * 0.7);
    aL = mix(aL, vec3(2.25 + wave * 0.3, 0.45, 0.25), wCheer);
    aR = mix(aR, vec3(2.25 - wave * 0.3, 0.45, 0.25), wCheer);
    // the room did something: some people point up at it
    float wPoint = uLook * step(0.55, fract(iSeed.w * 5.7)) * dancer;
    aR = mix(aR, vec3(0.45, 2.25, 0.1), wPoint);
    // phones: the filmers, plus (cold) people scrolling at chest height
    float wFilm = iInfo.y * smoothstep(0.3, 0.4, vnoise(uTime * 0.05 + iSeed.w * 11.0) + uCheer * 0.3) * (1.0 - wClap);
    // the filmer never puts it down; the VIP crew hold phone lights up through the breakdowns
    wFilm = max(wFilm, filmer);
    wFilm = max(wFilm, vip * smoothstep(0.2, 0.5, uClap) * step(0.35, fract(iSeed.z * 13.1)));
    float wScroll = uCold * step(0.55, fract(iSeed.y * 7.3)) * (1.0 - iInfo.y) * dancer * (1.0 - marathon) * (1.0 - filmer);
    aR = mix(aR, vec3(0.1, 0.25, 1.35), wScroll);
    aR = mix(aR, vec3(0.12, 1.95, 0.6), wFilm);
    float wDrink = iInfo.w * (1.0 - wClap) * (1.0 - wUp) * (1.0 - wCheer);
    aL = mix(aL, vec3(0.12, 0.45 + 0.08 * hit, 1.75), wDrink);
    aL = mix(aL, vec3(-0.2, 2.75, 0.35), sign);
    aR = mix(aR, vec3(-0.2, 2.75, 0.35), sign);
    // the towel, whirled overhead on the drop
    float wTowel = towel * clamp(uCheer * 1.5 + uJump, 0.0, 1.0);
    float ta = uTime * 9.0 + iSeed.x * 6.283;
    aR = mix(aR, vec3(0.3 + 0.35 * cos(ta), 2.55 + 0.3 * sin(ta), 0.2), wTowel);
    // leaning on the bar: forearms on the counter, drink in hand
    aL = mix(aL, vec3(0.1, 1.05, 1.7), leaning);
    aR = mix(aR, vec3(0.1, 1.1, 1.6), leaning);
    // security: arms folded
    aL = mix(aL, vec3(-0.35, 0.95, 2.2), guard);
    aR = mix(aR, vec3(-0.35, 1.05, 2.2), guard);
    // behind the bar: shaking a drink when it's busy, otherwise working the counter
    float shake = sin(uTime * 18.0) * 0.12 * smoothstep(0.6, 0.85, uHype);
    aL = mix(aL, vec3(0.1, 1.3 + shake, 1.3), barman);
    aR = mix(aR, vec3(0.1, 1.3 - shake, 1.3), barman);
    // up on someone's shoulders: both hands in the air
    aL = mix(aL, vec3(2.5 + wave, 0.25, 0.35), rider);
    aR = mix(aR, vec3(2.5 - wave, 0.25, 0.35), rider);
    vec3 djL = vec3(0.1 + 0.08 * sin(uTime * 0.7 + 1.0), 0.6 + 0.12 * sin(uTime * 1.3), 0.5 + 0.1 * sin(uTime * 0.9));
    vec3 djR = vec3(0.1 + 0.08 * sin(uTime * 0.6), 0.6 + 0.12 * sin(uTime * 1.1 + 2.0), 0.5 + 0.1 * sin(uTime * 1.7));
    djR = mix(djR, vec3(-0.05, 2.45 + 0.25 * pump, 0.5), uCheer);
    aL = mix(aL, djL, dj);
    aR = mix(aR, djR, dj);
    // body: knees bend on the beat and on kicks, hips sway, shoulders twist
    float bounce = bob * (0.5 + iSeed.z * 0.9) * (1.0 - vip * 0.55) * (1.0 - dj * 0.4) * (1.0 - leaning) * (1.0 - staff * 0.85) * (1.0 - rider);
    float k = min(0.7, bounce * 5.0 * hit + uKick * 0.07 * dancer + 0.04);
    // sitting on shoulders: knees bent right up, shins hanging
    k = mix(k, 1.45, rider);
    // the weight goes from leg to leg, a beat each (a step-touch): one knee bends, the other foot comes up
    float stepW = sin(uBeat * 3.14159 + iSeed.z * 6.283) * min(0.16, bounce * 1.8 + 0.03 * E) * dancer;
    float kL = max(0.0, k + stepW);
    float kR = max(0.0, k - stepW);
    // and the body leans into the beat
    float beatLean = (0.04 + 0.08 * E) * hit * dancer;
    float sway = sin(uBeat * 1.5708 + iSeed.x * 6.283) * (0.04 + 0.06 * vip + 0.03 * E);
    float twist = sin(uBeat * 0.7854 + iSeed.w * 6.283) * (0.12 + 0.1 * vip) * (1.0 - dj * 0.7);
    float shiftX = sin(uBeat * 1.5708 + iSeed.x * 6.283) * 0.035 * (1.0 - dj);
    float nod = hit * bob * 3.0 + dj * 0.18 * hit;
    // security gives a slow nod when the set's going well
    nod += guard * smoothstep(0.75, 0.9, uHype) * 0.25 * max(0.0, sin(uTime * 1.2 + iSeed.x * 6.0));
    // and everyone looks up at it
    nod -= uLook * 0.55 * (0.6 + 0.4 * iSeed.z) * (1.0 - staff);
    // cold: chatting, turning to friends; euphoric: everyone moving as one
    float turn = (vnoise(uTime * 0.25 + iSeed.w * 23.0) - 0.5) * (0.5 + vip * 1.4 + uCold * 1.8 * (1.0 - marathon) + staff * 0.8) * (1.0 - dj * 0.8);
    float jumpPh = mix(iSeed.x, 0.0, uSync);
    float jump = uJump * max(0.0, sin(fract(uBeat * 0.5 + jumpPh) * 6.283)) * (0.4 + iSeed.z * 0.6) * 0.32 * (dancer + sign * 0.5);
    jump += wCheer * max(0.0, sin(fract(uBeat + iSeed.x * 0.2) * 6.283)) * 0.12 * dancer;
    jump += marathon * max(0.0, sin(fract(uBeat * 0.5) * 6.283)) * 0.05;
    vec3 P = vec3(0.0, 0.95, 0.0);
    // the bar-leaner's lean over the counter
    mat3 Ru = rotY(twist) * rotZ(sway) * rotX(0.28 * leaning + beatLean);
    vec3 S = vec3(shiftX, 0.0, 0.0);
    float b = aBone;
    mat3 R = mat3(1.0);
    vec3 T = vec3(0.0);
    if (b < 0.5) {
      R = Ru;
      T = P + S - Ru * P;
    } else if (b < 2.5) {
      vec3 hip = vec3(b < 1.5 ? -0.09 : 0.09, 0.9, 0.0);
      R = rotX(-(b < 1.5 ? kL : kR));
      T = hip - R * hip;
    } else if (b < 4.5) {
      float sd = b < 3.5 ? -1.0 : 1.0;
      float kk = sd < 0.0 ? kL : kR;
      vec3 hip = vec3(sd * 0.09, 0.9, 0.0);
      vec3 knee = vec3(sd * 0.09, 0.5, 0.0);
      vec3 knee2 = hip + rotX(-kk) * (knee - hip);
      R = rotX(kk * (1.0 - rider));
      T = knee2 - R * knee;
    } else if (b < 8.5) {
      float sd = b < 6.5 ? -1.0 : 1.0;
      vec3 ap = sd < 0.0 ? aL : aR;
      vec3 Sh = vec3(sd * 0.2, 1.42, 0.0);
      mat3 Ra = rotZ(sd * ap.x) * rotX(-ap.y);
      if (b < 5.5 || (b > 6.5 && b < 7.5)) {
        R = Ru * Ra;
        T = Ru * (Sh - Ra * Sh - P) + P + S;
      } else {
        vec3 E0 = vec3(sd * 0.2, 1.14, 0.0);
        mat3 Re = rotX(-ap.z);
        R = Ru * Ra * Re;
        T = Ru * (Sh + Ra * (E0 - Sh) - Ra * Re * E0 - P) + P + S;
      }
    } else if (b < 9.5) {
      vec3 N = vec3(0.0, 1.47, 0.0);
      mat3 Rh = rotY(turn) * rotX(nod);
      R = Ru * Rh;
      T = Ru * (N - Rh * N - P) + P + S;
    } else {
      vec3 A = vec3(0.0, 2.0, 0.12);
      mat3 Rs = rotZ(sin(uBeat * 1.5708 + iSeed.x * 6.283) * 0.12);
      R = Ru * Rs;
      T = Ru * (A - Rs * A - P) + P + S;
    }
    // the body sits down as far as the straighter leg allows, so that foot stays on the floor
    T.y += jump - 0.8 * (1.0 - cos(min(kL, kR))) * (1.0 - rider);
    // the rider sits up on a friend's shoulders, there only for the peak
    float up = smoothstep(0.35, 0.6, uRiders);
    T.y += rider * (1.25 + 0.04 * hit);
    // props only when they're in use
    float vis = 1.0;
    float capOn = step(0.86, fract(iSeed.z * 5.91)) * (1.0 - staff) * (1.0 - dj);
    // a quiff on some people, never under a cap
    if (aMat > 16.5) vis = step(0.62, fract(iSeed.x * 4.7)) * (1.0 - capOn);
    else if (aMat > 15.5) vis = capOn;
    else if (aMat > 14.5) vis = 1.0;
    else if (aMat > 13.5) vis = step(0.6, fract(iSeed.w * 3.17)) * (1.0 - guard);
    else if (aMat > 12.5) vis = towel;
    else if (aMat > 10.5) vis = sign;
    else if (aMat > 7.5) vis = step(0.5, wFilm);
    else if (aMat > 6.5) vis = step(0.5, wDrink);
    if (rider > 0.5 && up < 0.5) vis = 0.0;
    if (vis < 0.5) {
      R = mat3(0.0);
      T = vec3(0.0, -50.0, 0.0);
    }
    poseR = R;
    poseT = T;
  }
`;

const FRAG_HEAD = /* glsl */ `
  uniform sampler2D uSigns;
  uniform float uSignGlow, uTime, uPhotos, uShorts, uSweat, uUV;
  uniform vec3 uRim, uRimFrom;
  float crowdHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  varying float vMat;
  varying vec4 vSeed;
  varying vec2 vUv2;
  varying float vSignRow;
  varying vec3 vRest;
  varying float vBone;
`;

const FRAG_COLOR = /* glsl */ `
  float tone = fract(vSeed.w * 7.13);
  vec3 skin = mix(vec3(0.93, 0.7, 0.56), vec3(0.3, 0.19, 0.13), tone) * 0.6;
  float hv = fract(tone * 13.7);
  vec3 top = diffuseColor.rgb;
  vec3 hair = hv < 0.45 ? vec3(0.03, 0.025, 0.02) : hv < 0.7 ? vec3(0.16, 0.09, 0.05) : hv < 0.82 ? vec3(0.55, 0.42, 0.25) : top * 1.1;
  float bv = fract(vSeed.z * 31.7);
  bool jeans = bv >= 0.4 && bv < 0.7;
  vec3 bottoms = bv < 0.4 ? vec3(0.025) : jeans ? vec3(0.06, 0.09, 0.17) : bv < 0.85 ? vec3(0.24, 0.21, 0.15) : vec3(0.11);
  vec3 shoes = fract(vSeed.y * 19.1) < 0.4 ? vec3(0.78) : vec3(0.03);
  float sleeve = fract(vSeed.x * 3.3);
  vec3 col = top;
  vec3 glow = vec3(0.0);
  float m = vMat;
  // stylised realism: one material vocabulary (soft skin, matte cotton, denim, hair with a sheen)
  float crowdRough = 0.86;
  vec3 p = vRest;
  // antialiasing width for the painted details (they shrink to nothing at a distance)
  float aa = max(fwidth(p.y) * 1.5, 0.0012);
  bool shortsOn = fract(vSeed.z * 11.3) < uShorts;
  if (m > 0.5 && m < 1.5) {
    col = bottoms;
    crowdRough = jeans ? 0.84 : 0.8;
    // shorts end a hand above the knee, with a turned hem
    if (shortsOn && p.y < 0.64) {
      col = p.y > 0.625 ? bottoms * 0.75 : skin;
      crowdRough = p.y > 0.625 ? 0.8 : mix(0.58, 0.3, uSweat);
    }
    // a belt for some, a buckle at the front
    if (p.y > 0.952 && p.y < 0.985 && fract(vSeed.w * 9.1) > 0.4) {
      col = vec3(0.03);
      crowdRough = 0.5;
      if (abs(p.x) < 0.016 && p.z > 0.06) col = vec3(0.5, 0.47, 0.42);
    }
  }
  else if (m > 1.5 && m < 2.5) {
    col = skin;
    crowdRough = mix(0.58, 0.3, uSweat);
    // the face, painted on the head's front: eyes with a catch light, brows, the mouth, a little colour in the cheeks
    if (vBone > 8.5 && vBone < 9.5 && p.z > 0.05 && p.y > 1.5) {
      vec2 q = vec2(abs(p.x), p.y - 1.6);
      float socket = exp(-dot(q - vec2(0.031, 0.006), q - vec2(0.031, 0.006)) / 0.0004);
      col *= 1.0 - 0.18 * socket;
      float e = length((q - vec2(0.031, 0.007)) / vec2(0.0105, 0.0068));
      float eye = 1.0 - smoothstep(1.0 - aa / 0.007, 1.0 + aa / 0.007, e);
      col = mix(col, vec3(0.035, 0.028, 0.026), eye);
      float catchL = 1.0 - smoothstep(0.0018, 0.0018 + aa, length(q - vec2(0.031 + sign(p.x) * 0.003, 0.0095)));
      col = mix(col, vec3(0.8), catchL * eye);
      float bx = (q.x - 0.032) / 0.017;
      float brow = (1.0 - smoothstep(1.0, 1.0 + aa / 0.017, abs(bx))) * (1.0 - smoothstep(0.0034, 0.0034 + aa, abs(q.y - 0.029 + 0.004 * bx * bx)));
      col = mix(col, hair * 0.8, brow * 0.9);
      float mx = q.x / 0.019;
      float mouth = (1.0 - smoothstep(1.0, 1.0 + aa / 0.019, mx)) * (1.0 - smoothstep(0.0026, 0.0026 + aa, abs(q.y + 0.048 + 0.003 * mx * mx)));
      col = mix(col, mix(skin, vec3(0.42, 0.16, 0.14), 0.6), mouth);
      float blush = exp(-dot(q - vec2(0.044, -0.02), q - vec2(0.044, -0.02)) / 0.00035);
      col = mix(col, col * vec3(1.12, 0.92, 0.9), blush * 0.6);
    }
  }
  else if (m > 2.5 && m < 3.5) {
    col = hair;
    crowdRough = 0.48;
  }
  else if (m > 3.5 && m < 4.5) {
    col = shoes;
    crowdRough = 0.55;
    float lx = sign(p.x) * 0.09;
    // a white sole and toe bumper, laces over the top, a two-band stripe down the side of some
    float soleCol = fract(vSeed.x * 23.1) < 0.7 ? 0.86 : 0.04;
    if (p.y < 0.017 || p.z > 0.108) { col = vec3(soleCol); crowdRough = 0.8; }
    else if (p.y > 0.046 && p.z > 0.02 && p.z < 0.088 && abs(p.x - lx) < 0.021) col = mix(col, vec3(0.9), step(0.5, fract(p.z * 110.0)) * 0.8);
    else if (abs(p.x - lx) > 0.034 && p.y > 0.024 && p.y < 0.044 && p.z > -0.01 && p.z < 0.08 && fract(vSeed.z * 7.7) > 0.5) col = mix(top, vec3(0.9), step(0.5, fract(p.y * 95.0)));
  }
  else if (m > 4.5 && m < 5.5) col = sleeve < 0.15 ? skin : top;
  else if (m > 5.5 && m < 6.5) col = sleeve < 0.6 ? skin : top;
  else if (m > 6.5 && m < 7.5) { col = fract(vSeed.w * 5.1) < 0.5 ? vec3(0.6, 0.05, 0.04) : vec3(0.72, 0.74, 0.78); crowdRough = 0.4; }
  else if (m > 7.5 && m < 8.5) { col = vec3(0.02); crowdRough = 0.35; }
  else if (m > 8.5 && m < 9.5) { col = vec3(0.0); glow = vec3(0.55, 0.64, 0.85) * 1.05; }
  else if (m > 9.5 && m < 10.5) {
    col = vec3(0.02);
    glow = vec3(2.2) * step(0.6, fract(vSeed.y * 7.0));
    // taking photos after the drop: each phone fires its flash now and then
    if (uPhotos > 0.001) glow += vec3(16.0) * step(1.0 - 0.06 * uPhotos, crowdHash(vec2(vSeed.x * 113.0, floor(uTime * 9.0 + vSeed.z * 9.0))));
  }
  else if (m > 10.5 && m < 11.5) col = vec3(0.02);
  else if (m > 16.5) { col = hair; crowdRough = 0.48; }
  // a cap: black, the top's colour or stone
  else if (m > 15.5) { float cv = fract(vSeed.x * 9.7); col = cv < 0.45 ? vec3(0.025) : cv < 0.8 ? top * 0.85 : vec3(0.5, 0.46, 0.38); crowdRough = 0.7; }
  // the lower leg: trousers, or bare in shorts
  else if (m > 14.5) {
    bool bare = shortsOn;
    col = bare ? skin : bottoms;
    crowdRough = bare ? mix(0.58, 0.3, uSweat) : 0.84;
  }
  else if (m > 13.5) { col = hair; crowdRough = 0.48; }
  else if (m > 12.5) col = fract(vSeed.y * 3.7) < 0.5 ? vec3(0.85, 0.85, 0.82) : top * 1.2;
  else if (m > 11.5) {
    vec3 t = texture2D(uSigns, vec2(vUv2.x, (vSignRow + vUv2.y) / 8.0)).rgb;
    vec2 cell = fract(vUv2 * vec2(80.0, 20.0)) - 0.5;
    float led = smoothstep(0.5, 0.22, length(cell));
    col = vec3(0.0);
    glow = t * (0.25 + led * 1.6) * uSignGlow;
  }
  // the top: a crew or V neckline, the rib of the collar, the hem; stripes, a chest print or a colour block on some
  if (m < 0.5) {
    float style = fract(vSeed.y * 5.31);
    float front = step(0.0, p.z);
    if (style < 0.2 && front > 0.5 && abs(p.x) < 0.055 && p.y > 1.452 - (0.055 - abs(p.x)) * 1.6) col = skin;
    else if (p.y > 1.452 && abs(p.x) < 0.062) col = skin;
    else if (p.y > 1.437 && abs(p.x) < 0.075) col = top * 0.72;
    else if (p.y < 0.975) col = top * 0.8;
    else if (style > 0.35 && style < 0.45 && p.y > 1.0 && p.y < 1.4) {
      // stripes, mostly tonal (a lighter or darker band of the same colour), white on a few
      vec3 band = fract(vSeed.x * 4.3) < 0.3 ? vec3(0.85) : fract(vSeed.x * 4.3) < 0.65 ? top * 0.45 : top * 0.55 + vec3(0.18);
      col = mix(top, band, smoothstep(0.5 - aa * 9.0, 0.5 + aa * 9.0, fract(p.y * 9.0)) * 0.8);
    }
    else if (style > 0.55 && style < 0.67 && front > 0.5 && p.z > 0.06) {
      // an abstract print on the chest: a ring, a dot or a chevron, in a contrasting colour
      vec2 c = vec2(p.x, p.y - 1.285);
      vec3 ink = fract(vSeed.w * 3.9) < 0.5 ? vec3(0.88) : vec3(1.0) - top * 0.8;
      float kind = fract(vSeed.z * 2.7);
      float r = length(c);
      float mark = kind < 0.33 ? smoothstep(0.005 + aa, 0.005, abs(r - 0.03)) : kind < 0.66 ? smoothstep(0.024 + aa, 0.024, r) : smoothstep(0.006 + aa, 0.006, abs(c.y + abs(c.x) * 0.7 - 0.01)) * step(abs(c.x), 0.038);
      col = mix(col, ink, mark * 0.75);
    }
    else if (style > 0.78 && style < 0.9 && p.y < 1.16) col = top * 0.55 + vec3(0.03);
  }
  // denim: a fine twill, the side seam and worn knees
  if (jeans && (m > 0.5 && m < 1.5 || (m > 14.5 && m < 15.5 && col == bottoms))) {
    float tw = fract((p.x * 0.7 + p.y) * 320.0);
    col *= 0.93 + 0.12 * smoothstep(0.3, 0.7, tw) * (1.0 - smoothstep(0.004, 0.01, aa));
    float lxs = sign(p.x) * 0.09;
    if (abs(p.z) < 0.005 && (p.x - lxs) * sign(p.x) > 0.02 && p.y < 0.95) col *= 1.35;
    if (p.z > 0.03 && p.y > 0.42 && p.y < 0.6) col *= 1.0 + 0.3 * (1.0 - abs(p.y - 0.51) / 0.09);
  }
  // hair: strands, so it reads as hair and not a helmet
  if ((m > 2.5 && m < 3.5) || (m > 13.5 && m < 14.5) || m > 16.5) {
    float strand = sin(atan(p.x, p.z + 0.001) * 70.0 + p.y * 40.0 + vSeed.x * 20.0);
    col *= 0.88 + 0.16 * strand * (1.0 - smoothstep(0.004, 0.01, aa));
  }
  // blacklight: white cloth glows blue-violet, bright colours fluoresce; skin and dark cloth stay dark
  if (uUV > 0.001) {
    float cloth = (m < 1.5 || (m > 3.5 && m < 6.5) || (m > 12.5 && m < 13.5) || (m > 15.5 && m < 16.5)) ? 1.0 : 0.0;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
    vec3 uvCol = mix(vec3(0.55, 0.5, 1.0) * lum * 1.6, col * 1.5, clamp(sat * 2.0, 0.0, 1.0));
    glow += uvCol * smoothstep(0.2, 0.6, lum + sat) * cloth * uUV * 1.1;
  }
  diffuseColor.rgb = col;
  totalEmissiveRadiance += glow;
`;

// backlight: the stage's light catching the edges of people seen against it, so the crowd reads
// as silhouettes with bright rims from the floor instead of flat dark shapes
const FRAG_RIM = /* glsl */ `
  {
    vec3 rimV = normalize(vViewPosition);
    vec3 rimL = normalize((viewMatrix * vec4(uRimFrom, 1.0)).xyz + vViewPosition);
    float fres = 1.0 - clamp(dot(normal, rimV), 0.0, 1.0);
    fres *= fres * fres;
    float behind = clamp(dot(-rimV, rimL) * 0.6 + 0.4, 0.0, 1.0);
    float side = clamp(dot(normal, rimL) + 0.35, 0.0, 1.0);
    totalEmissiveRadiance += uRim * (0.2 + diffuseColor.rgb) * fres * behind * behind * side;
  }
`;

interface Chunk {
  mesh: THREE.InstancedMesh;
  geos: [THREE.BufferGeometry, THREE.BufferGeometry];
  center: THREE.Vector3;
  radius: number;
  lod: 0 | 1;
}

const CHUNK = 6;
const RIM_WHITE = new THREE.Color(1, 1, 1);

export class Crowd implements Fixture {
  /** distance (m) inside which chunks use the detailed model; scaled by the adaptive quality */
  static detailDistance = 12;
  readonly object = new THREE.Group();
  private chunks: Chunk[] = [];
  private shadows: THREE.InstancedMesh[] = [];
  private u = {
    uBeat: { value: 0 },
    uBob: { value: 0 },
    uHands: { value: 0 },
    uTime: { value: 0 },
    uJump: { value: 0 },
    uClap: { value: 0 },
    uCheer: { value: 0 },
    uKick: { value: 0 },
    uCold: { value: 0 },
    uSync: { value: 0 },
    uHype: { value: 0 },
    uRiders: { value: 0 },
    uSigns: { value: null as THREE.Texture | null },
    uSignGlow: { value: 1 },
    uPhotos: { value: 0 },
    uShorts: { value: 0.1 },
    uSweat: { value: 0 },
    uLook: { value: 0 },
    uUV: { value: 0 },
    uRim: { value: new THREE.Color(0, 0, 0) },
    uRimFrom: { value: new THREE.Vector3(0, 3.5, 1.5) },
  };
  private hands = 0;
  private jump = 0;
  private clap = 0;
  private cheer = 0;
  private camPos = new THREE.Vector3();

  constructor(spots: CrowdSpot[], o: CrowdOptions = {}) {
    const r = rng(o.seed ?? 11);
    // the regulars (dancers given a character) and the riders added on top
    spots = spots.slice();
    const clothes = (o.clothes ?? ['#1b1d22', '#2a2d33', '#101114', '#3a2f2a', '#23262d', '#d9d6cf', '#5a1e22', '#1d2b3a']).map((c) => new THREE.Color(c));
    const booth = o.booth ?? new THREE.Vector3(0, 0, 0.2);
    this.u.uShorts.value = o.shorts ?? 0.1;
    // the rim comes from the rig over and behind the booth
    this.u.uRimFrom.value.set(booth.x, booth.y + 3.5, booth.z + 1.3);
    let n = spots.length;
    const seeds: number[] = [];
    const info: number[] = new Array(n * 4).fill(0);
    for (let i = 0; i < n * 4; i++) seeds.push(r());
    // sign holders: people near the front
    const signIdx = new Set<number>();
    if (o.signs) {
      const byDist = spots
        .map((s, i) => ({ i, d: Math.hypot(s.x - booth.x, s.z - booth.z) }))
        .filter(({ i }) => (spots[i].role ?? o.role ?? 'dancer') === 'dancer')
        .sort((a, b) => a.d - b.d);
      const front = byDist.slice(0, Math.max(o.signs * 3, Math.ceil(byDist.length * 0.3)));
      while (signIdx.size < Math.min(o.signs, front.length)) signIdx.add(front[Math.floor(r() * front.length)].i);
    }
    // the regulars: picked from the dancers in the front half, the same faces at every venue
    const regular = new Map<number, CrowdRole>();
    const dancers = spots
      .map((s, i) => ({ i, d: Math.hypot(s.x - booth.x, s.z - booth.z) }))
      .filter(({ i }) => !signIdx.has(i) && (spots[i].role ?? o.role ?? 'dancer') === 'dancer')
      .sort((a, b) => a.d - b.d);
    if ((o.regulars ?? n >= 30) && dancers.length >= 8) {
      const front = dancers.slice(0, Math.ceil(dancers.length * 0.5));
      const want: CrowdRole[] = ['marathon', 'filmer', 'towel', 'filmer'];
      for (const role of want) {
        for (let tries = 0; tries < 20; tries++) {
          const pick = front[Math.floor(r() * front.length)].i;
          if (!regular.has(pick)) {
            regular.set(pick, role);
            break;
          }
        }
      }
    }
    // shoulder-riders: up on the shoulders of people a little way back
    const riders: CrowdSpot[] = [];
    if (o.riders && dancers.length > 20) {
      const mid = dancers.slice(Math.floor(dancers.length * 0.2), Math.floor(dancers.length * 0.8));
      for (let k = 0; k < o.riders; k++) {
        const c = spots[mid[Math.floor(r() * mid.length)].i];
        riders.push({ x: c.x, z: c.z + 0.02, y: c.y, face: c.face, role: 'rider' });
      }
    }
    if (riders.length) {
      spots = [...spots, ...riders];
      for (let k = 0; k < riders.length * 4; k++) seeds.push(r());
      info.push(...new Array(riders.length * 4).fill(0));
    }
    // the first sign near the front is the superfan's (sign row 0: the DJ's name)
    let signRow = 0;
    spots.forEach((s, i) => {
      const role: CrowdRole = signIdx.has(i) ? 'sign' : (regular.get(i) ?? s.role ?? o.role ?? 'dancer');
      const code = ROLE_CODE[role];
      const drinks = o.drinks ?? (role === 'vip' ? 0.75 : 0.1);
      const phones = role === 'vip' ? Math.max(0.3, o.phones ?? 0) : (o.phones ?? 0);
      info[i * 4] = code;
      const hands = role !== 'dj' && role !== 'sign' && role !== 'security' && role !== 'bartender' && role !== 'rider' && role !== 'towel';
      info[i * 4 + 1] = role === 'filmer' || (hands && role !== 'marathon' && r() < phones) ? 1 : 0;
      info[i * 4 + 2] = role === 'sign' ? signRow++ % SIGNS.length : 0;
      info[i * 4 + 3] = role === 'barlean' || (hands && role !== 'marathon' && role !== 'filmer' && r() < drinks) ? 1 : 0;
    });

    n = spots.length;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    this.u.uSigns.value = signIdx.size ? signAtlas() : null;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\ncomputePose();\nobjectNormal = poseR * objectNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed = poseR * transformed + poseT;\nvMat = aMat;\nvSeed = iSeed;\nvUv2 = uv;\nvSignRow = iInfo.z;\nvRest = position;\nvBone = aBone;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
        // sweat: skin goes glossy over a long peak
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = crowdRough;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_RIM}`);
    };
    mat.customProgramCacheKey = () => 'crowd';
    if (o.lightMap) useLightMap(mat, o.lightMap, 0.9);

    // per-person placement (facing, scale, clothes), then grouped into chunks
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    spots.forEach((s, i) => {
      let face = s.face ?? Math.atan2(booth.x - s.x, booth.z - s.z);
      // some dancers turn to their friends instead of the booth
      if (s.face === undefined && info[i * 4] === 0 && r() < 0.1) face += (r() < 0.5 ? -1 : 1) * (1.1 + r() * 0.6);
      // a rider faces the way their friend does, and is a little smaller
      const sc = s.scale ?? (s.role === 'rider' ? 0.85 : 0.9 + r() * 0.2);
      // builds vary: slimmer and broader people (from the person's seed, so the picks above don't shift)
      const build = 0.92 + 0.16 * ((seeds[i * 4 + 1] * 7.77) % 1);
      q.setFromAxisAngle(yAxis, face);
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y ?? 0, s.z), q, new THREE.Vector3(sc * build, sc, sc * build)));
      cols.push(clothes[Math.floor(r() * clothes.length)]);
    });
    const cells = new Map<string, number[]>();
    spots.forEach((s, i) => {
      const key = `${Math.floor(s.x / CHUNK)},${Math.floor(s.z / CHUNK)},${Math.round((s.y ?? 0) / 2)}`;
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      list.push(i);
    });
    const hi = personGeometry(0);
    const lo = personGeometry(1);
    for (const idx of cells.values()) {
      const k = idx.length;
      const cs = new Float32Array(k * 4);
      const ci = new Float32Array(k * 4);
      idx.forEach((i, j) => {
        cs.set(seeds.slice(i * 4, i * 4 + 4), j * 4);
        ci.set(info.slice(i * 4, i * 4 + 4), j * 4);
      });
      const inst = { iSeed: new THREE.InstancedBufferAttribute(cs, 4), iInfo: new THREE.InstancedBufferAttribute(ci, 4) };
      const geos: [THREE.BufferGeometry, THREE.BufferGeometry] = [chunkGeometry(hi, inst), chunkGeometry(lo, inst)];
      const mesh = new THREE.InstancedMesh(geos[0], mat, k);
      idx.forEach((i, j) => {
        mesh.setMatrixAt(j, mats[i]);
        mesh.setColorAt(j, cols[i]);
      });
      mesh.computeBoundingSphere();
      // arms up, jumps and signs reach above the rest-pose bounds
      const sphere = mesh.boundingSphere!;
      sphere.radius += 0.8;
      this.chunks.push({ mesh, geos, center: sphere.center.clone(), radius: sphere.radius, lod: 0 });
      this.object.add(mesh);
    }
    if (o.shadows !== false && n) {
      // contact shadows: a soft dark patch under each person. Placement never changes, so one
      // instanced draw covers the whole crowd (per-chunk meshes doubled the crowd's draw calls)
      shadowGeo ??= new THREE.PlaneGeometry(0.8, 0.62).rotateX(-Math.PI / 2).translate(0, 0.015, 0.02);
      shadowMat ??= new THREE.MeshBasicMaterial({ color: 0x000000, map: blobTexture(), transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const sh = new THREE.InstancedMesh(shadowGeo, shadowMat, n);
      mats.forEach((m, i) => sh.setMatrixAt(i, m));
      sh.computeBoundingSphere();
      sh.renderOrder = -1;
      this.object.add(sh);
      this.shadows.push(sh);
    }
    this.steamGain = o.steam ?? (n >= 40 ? 1 : 0);
    if (this.steamGain > 0 && n) {
      this.steam = new CrowdSteam(spots.filter((s) => (s.role ?? o.role ?? 'dancer') !== 'dj'), Math.min(260, Math.round(n * 0.8)), (o.seed ?? 11) + 5);
      this.object.add(this.steam.object);
    }
  }

  /** the room's steam (built in the constructor for a big enough crowd) */
  private steam: CrowdSteam | null = null;
  private steamGain = 1;
  private sweat = 0;
  private steamLight = new THREE.Color();

  /** dancers in total */
  get count(): number {
    return this.chunks.reduce((n, c) => n + c.mesh.count, 0);
  }

  dispose(): void {
    for (const c of this.chunks) {
      // the shared person buffers stay alive for other crowds: only drop the per-chunk instance data
      for (const g of c.geos) {
        for (const name of Object.keys(g.attributes)) if (name !== 'iSeed' && name !== 'iInfo') g.deleteAttribute(name);
        g.setIndex(null);
        g.dispose();
      }
      c.mesh.dispose();
    }
    if (this.steam) {
      this.steam.object.geometry.dispose();
      (this.steam.object.material as THREE.Material).dispose();
    }
    // the shadow quad and material are shared by every crowd: keep them, drop only the instances
    for (const sh of this.shadows) {
      this.object.remove(sh);
      sh.dispose();
    }
  }

  /** Swap chunks between the detailed and low-detail model by distance from the camera. */
  private updateLod(camera: THREE.Camera): void {
    camera.getWorldPosition(this.camPos);
    this.object.worldToLocal(this.camPos);
    const near = Crowd.detailDistance;
    for (const c of this.chunks) {
      const d = Math.max(0, c.center.distanceTo(this.camPos) - c.radius);
      const want: 0 | 1 = c.lod === 0 ? (d > near * 1.12 ? 1 : 0) : d < near * 0.88 ? 0 : 1;
      if (want !== c.lod) {
        c.lod = want;
        c.mesh.geometry = c.geos[want];
      }
    }
  }

  /** 0..1: heads go up and some people point (a room doing something overhead) */
  set look(k: number) {
    this.u.uLook.value = k;
  }
  /** 0..1: blacklight on the crowd (white and bright clothes glow) */
  set uv(k: number) {
    this.u.uUV.value = k;
  }

  update(s: ShowState, dt: number, camera?: THREE.Camera): void {
    if (camera) this.updateLod(camera);
    const u = this.u;
    u.uBeat.value = s.beat;
    u.uTime.value += dt;
    const hype = s.hype;
    const moving = s.playing ? 1 : 0.15;
    u.uBob.value = (0.03 + hype * 0.07 + s.peak * 0.03) * moving;
    const handsTarget = s.playing ? Math.min(1, hype * hype * 0.8 + s.peak * 0.55 + s.drop * 0.3) : 0;
    this.hands += (handsTarget - this.hands) * Math.min(1, dt * 2);
    u.uHands.value = this.hands;
    const jumpTarget = s.playing ? Math.max(0, s.peak * (0.4 + hype * 0.6) - s.build) : 0;
    this.jump += (jumpTarget - this.jump) * Math.min(1, dt * 3);
    u.uJump.value = this.jump;
    // clap along through the build-up
    const clapTarget = s.playing ? Math.max(0, Math.min(1, (s.build - 0.45) * 3)) : 0;
    this.clap += (clapTarget - this.clap) * Math.min(1, dt * 4);
    u.uClap.value = this.clap;
    // the drop (and a hook line landing) gets everyone's arms up
    if (s.dropHit) this.cheer = 1;
    this.cheer = Math.max(this.cheer * Math.exp(-dt * 0.35), s.accent * 0.75 * (0.4 + hype * 0.6));
    u.uCheer.value = s.playing ? this.cheer : 0;
    u.uKick.value = s.kick;
    u.uHype.value = s.hype;
    // riders pop up at the peak and on the drop
    u.uRiders.value += ((s.playing ? Math.max(this.jump * 1.3, this.cheer * 0.8) * (s.hype > 0.7 ? 1 : 0) : 0) - u.uRiders.value) * Math.min(1, dt * 2);
    // the crowd's state (Section 8.1): cold below a quarter, as one when euphoric
    u.uCold.value += (Math.max(0, Math.min(1, (0.3 - hype) / 0.15)) - u.uCold.value) * Math.min(1, dt * 0.8);
    u.uSync.value += ((s.playing ? Math.max(0, Math.min(1, (hype - 0.85) / 0.1)) : 0) - u.uSync.value) * Math.min(1, dt * 0.8);
    u.uSignGlow.value = (0.8 + 0.35 * Math.pow(1 - (((s.beat % 1) + 1) % 1), 2)) * (0.6 + 0.4 * s.master);
    u.uPhotos.value = s.photos;
    // the rim: the show's colours, harder with the wash and the kick, white in the strobes
    const rim = u.uRim.value;
    rim.copy(s.colors[0]).lerp(s.colors[1], 0.5 + 0.5 * Math.sin(s.t * 0.3)).lerp(RIM_WHITE, 0.25 + s.flash * 0.5);
    rim.multiplyScalar(((0.25 + s.wash * 0.5 + s.kick * 0.25 + s.peak * 0.2) * s.master + s.flash * 0.8) * 0.9);
    // body heat: steam over the heads and sweat on the skin, built over a long peak
    this.sweat = sweatStep(this.sweat, dt, s.hype, s.peak, s.playing);
    u.uSweat.value = this.sweat;
    if (this.steam) {
      this.steamLight.copy(rim).multiplyScalar(this.steamGain);
      this.steam.update(dt, s.hype, s.peak, s.playing, this.steamLight, u.uRimFrom.value);
    }
  }
}

let crowdScale = 1;
/**
 * How full the venues are (Settings → Show): 0 is an empty room, 1 the
 * venue's normal crowd, 1.5 packed. Applies to venues built after the call.
 */
export function setCrowdScale(k: number): void {
  crowdScale = Math.max(0, Math.min(1.5, k));
}
export function getCrowdScale(): number {
  return crowdScale;
}

/** Scatter dancers over a rectangle (jittered grid), skipping `avoid` boxes. Density follows the crowd size setting. */
export function crowdArea(x0: number, x1: number, z0: number, z1: number, density: number, seed: number, o: { y?: number; avoid?: THREE.Box2[]; face?: number; role?: CrowdRole } = {}): CrowdSpot[] {
  const r = rng(seed);
  const spots: CrowdSpot[] = [];
  density *= crowdScale;
  if (density <= 0.001) return spots;
  const step = 1 / Math.sqrt(density);
  for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z += step) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += step) {
      const px = x + (r() - 0.5) * step * 0.8;
      const pz = z + (r() - 0.5) * step * 0.8;
      if (o.avoid?.some((b) => b.containsPoint(new THREE.Vector2(px, pz)))) continue;
      spots.push({ x: px, z: pz, y: o.y, face: o.face !== undefined ? o.face + (r() - 0.5) * 0.6 : undefined, role: o.role });
    }
  }
  return spots;
}
