/*
 * The crowd: one instanced mesh of jointed people posed in the vertex shader.
 *   – a skeleton of rigid parts (thighs, shins, upper arms, forearms, head,
 *     torso) bent at hips, knees, shoulders, elbows and neck; knees bend on
 *     the beat and kick transients, hips sway, shoulders twist, heads nod
 *     and look around
 *   – behaviours blend per person with slowly drifting noise and the show
 *     state: club-dance arms, hands in the air waving, fist pumps on the
 *     beat, clapping overhead in build-ups, everyone up and jumping on drops
 *     and hook lines, filming with a phone (screen and torch light up)
 *   – roles: dancers, LED-sign holders (scrolling-dot signs held overhead),
 *     VIP guests by the booth (drink in hand, swaying, chatting, filming)
 *     and the DJ (hands on the decks, a hand up on the drop)
 *   – clothing: tops in the venue's palette, sleeves, trousers and shoes
 *     picked per person, skin and hair tones varied
 *   – performance: dancers are grouped in ~6 m chunks, each its own instanced
 *     mesh, so chunks off screen are culled; chunks far from the camera swap
 *     to a low-detail model (a little under half the triangles). Both models
 *     share one set of vertex buffers.
 */
import * as THREE from 'three';
import { nameService } from '../../name/NameService';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';
import { blobTexture } from './details';
import { useLightMap, type LightMap } from './lightmap';
import { rng } from './tex';

export type CrowdRole = 'dancer' | 'sign' | 'vip' | 'dj';
const ROLE_CODE: Record<CrowdRole, number> = { dancer: 0, sign: 1, vip: 2, dj: 3 };

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
  /** the venue's floor light map: people are lit by the light landing where they stand */
  lightMap?: LightMap;
}

let shadowGeo: THREE.BufferGeometry | null = null;
let shadowMat: THREE.MeshBasicMaterial | null = null;

/* bones */
const B = { body: 0, thighL: 1, thighR: 2, shinL: 3, shinR: 4, upperL: 5, foreL: 6, upperR: 7, foreR: 8, head: 9, sign: 10 };
/* materials */
const M = { top: 0, bottoms: 1, skin: 2, hair: 3, shoes: 4, sleeveUp: 5, sleeveLo: 6, cup: 7, phone: 8, screen: 9, torch: 10, signFrame: 11, signFace: 12 };

const personGeo: (THREE.BufferGeometry | null)[] = [null, null];

function part(g: THREE.BufferGeometry, bone: number, mat: number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  g.setAttribute('aBone', new THREE.Float32BufferAttribute(new Float32Array(n).fill(bone), 1));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(new Float32Array(n).fill(mat), 1));
  return g;
}

/**
 * Rest pose: standing, facing +Z, feet on y = 0, about 1.75 m tall.
 * detail 0 is the close-up model; detail 1 keeps the same skeleton and props
 * with far fewer segments (used for dancers away from the camera).
 */
export function personGeometry(detail: 0 | 1 = 0): THREE.BufferGeometry {
  const cached = personGeo[detail];
  if (cached) return cached;
  const lo = detail === 1;
  const cap = (r: number, len: number, caps: number, radial: number) => new THREE.CapsuleGeometry(r, len, lo ? Math.max(1, caps - 1) : caps, lo ? Math.max(4, radial - 2) : radial);
  const sph = (r: number, ws: number, hs: number, ...rest: number[]) => new THREE.SphereGeometry(r, lo ? Math.max(4, ws - 3) : ws, lo ? Math.max(3, hs - 2) : hs, ...rest);
  const parts: THREE.BufferGeometry[] = [];
  for (const sd of [-1, 1]) {
    const L = sd < 0;
    parts.push(
      part(new THREE.BoxGeometry(0.1, 0.07, 0.25).translate(sd * 0.09, 0.035, 0.045), L ? B.shinL : B.shinR, M.shoes),
      part(cap(0.055, 0.34, 2, 7).translate(sd * 0.09, 0.3, 0), L ? B.shinL : B.shinR, M.bottoms),
      part(cap(0.072, 0.32, 2, 7).translate(sd * 0.09, 0.7, 0), L ? B.thighL : B.thighR, M.bottoms),
      part(cap(0.05, 0.2, 2, 7).translate(sd * 0.2, 1.28, 0), L ? B.upperL : B.upperR, M.sleeveUp),
      part(cap(0.042, 0.2, 2, 6).translate(sd * 0.2, 1.01, 0), L ? B.foreL : B.foreR, M.sleeveLo),
      part(sph(0.045, 6, 5).scale(0.8, 1.25, 0.6).translate(sd * 0.2, 0.83, 0.005), L ? B.foreL : B.foreR, M.skin),
    );
  }
  parts.push(
    part(sph(1, 10, 6).scale(0.165, 0.13, 0.12).translate(0, 0.93, 0), B.body, M.bottoms),
    part(cap(0.16, 0.3, 3, 10).scale(1.05, 1, 0.62).translate(0, 1.2, 0), B.body, M.top),
    part(new THREE.CylinderGeometry(0.045, 0.05, 0.1, lo ? 5 : 7).translate(0, 1.47, 0), B.head, M.skin),
    part(sph(0.105, 10, 8).scale(0.9, 1.08, 1).translate(0, 1.6, 0), B.head, M.skin),
    part(sph(0.112, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.92, 1.05, 1.02).translate(0, 1.615, -0.006), B.head, M.hair),
    // phone in the right hand: screen faces the holder once the arm is raised, torch on the back
    part(new THREE.BoxGeometry(0.07, 0.14, 0.012).translate(0.2, 0.76, 0.03), B.foreR, M.phone),
    part(new THREE.PlaneGeometry(0.062, 0.128).translate(0.2, 0.76, 0.0365), B.foreR, M.screen),
    // cup in the left hand, pre-tilted so it stands upright in the drinking pose
    part(new THREE.CylinderGeometry(0.036, 0.028, 0.11, lo ? 5 : 8).translate(0, 0.02, 0.04).rotateX(2.2).translate(-0.2, 0.83, 0), B.foreL, M.cup),
    // LED sign held overhead
    part(new THREE.BoxGeometry(0.76, 0.22, 0.02).translate(0, 2.1, 0.12), B.sign, M.signFrame),
    part(new THREE.PlaneGeometry(0.72, 0.18).translate(0, 2.1, 0.1305), B.sign, M.signFace),
  );
  if (!lo) parts.push(part(new THREE.PlaneGeometry(0.014, 0.014).rotateY(Math.PI).translate(0.215, 0.705, 0.0235), B.foreR, M.torch));
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
let signTex: THREE.CanvasTexture | null = null;
function signAtlas(): THREE.Texture {
  if (signTex) return signTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 4;
  drawSigns();
  // a rename shows up on the signs straight away
  nameService.onChange(drawSigns);
  return signTex;
}

function drawSigns(): void {
  if (!signTex) return;
  const c = signTex.image as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  const rows = SIGNS.map((s, i) => (i === SIGNS.length - 1 && nameService.named ? { text: nameService.text, color: '#ff2e88' } : s));
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

const VERT_HEAD = /* glsl */ `
  attribute float aBone;
  attribute float aMat;
  attribute vec4 iSeed;
  attribute vec4 iInfo;
  uniform float uBeat, uTime, uBob, uHands, uJump, uClap, uCheer, uKick, uCold, uSync;
  varying float vMat;
  varying vec4 vSeed;
  varying vec2 vUv2;
  varying float vSignRow;
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
    float dj = step(2.5, role);
    float dancer = 1.0 - sign - vip - dj;
    float ph = fract(uBeat + iSeed.x * 0.12);
    float hit = (1.0 - ph) * (1.0 - ph);
    float E = clamp(uHands * 1.9 - iSeed.y * 1.3, 0.0, 1.0);
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
    // phones: the filmers, plus (cold) people scrolling at chest height
    float wFilm = iInfo.y * smoothstep(0.3, 0.4, vnoise(uTime * 0.05 + iSeed.w * 11.0) + uCheer * 0.3) * (1.0 - wClap);
    float wScroll = uCold * step(0.55, fract(iSeed.y * 7.3)) * (1.0 - iInfo.y) * dancer;
    aR = mix(aR, vec3(0.1, 0.25, 1.35), wScroll);
    aR = mix(aR, vec3(0.12, 1.95, 0.6), wFilm);
    float wDrink = iInfo.w * (1.0 - wClap) * (1.0 - wUp) * (1.0 - wCheer);
    aL = mix(aL, vec3(0.12, 0.45 + 0.08 * hit, 1.75), wDrink);
    aL = mix(aL, vec3(-0.2, 2.75, 0.35), sign);
    aR = mix(aR, vec3(-0.2, 2.75, 0.35), sign);
    vec3 djL = vec3(0.1 + 0.08 * sin(uTime * 0.7 + 1.0), 0.6 + 0.12 * sin(uTime * 1.3), 0.5 + 0.1 * sin(uTime * 0.9));
    vec3 djR = vec3(0.1 + 0.08 * sin(uTime * 0.6), 0.6 + 0.12 * sin(uTime * 1.1 + 2.0), 0.5 + 0.1 * sin(uTime * 1.7));
    djR = mix(djR, vec3(-0.05, 2.45 + 0.25 * pump, 0.5), uCheer);
    aL = mix(aL, djL, dj);
    aR = mix(aR, djR, dj);
    // body: knees bend on the beat and on kicks, hips sway, shoulders twist
    float bounce = uBob * (0.5 + iSeed.z * 0.9) * (1.0 - vip * 0.55) * (1.0 - dj * 0.4);
    float k = min(0.7, bounce * 5.0 * hit + uKick * 0.07 * dancer + 0.04);
    float sway = sin(uBeat * 1.5708 + iSeed.x * 6.283) * (0.04 + 0.06 * vip + 0.03 * E);
    float twist = sin(uBeat * 0.7854 + iSeed.w * 6.283) * (0.12 + 0.1 * vip) * (1.0 - dj * 0.7);
    float shiftX = sin(uBeat * 1.5708 + iSeed.x * 6.283) * 0.035 * (1.0 - dj);
    float nod = hit * uBob * 3.0 + dj * 0.18 * hit;
    // cold: chatting, turning to friends; euphoric: everyone moving as one
    float turn = (vnoise(uTime * 0.25 + iSeed.w * 23.0) - 0.5) * (0.5 + vip * 1.4 + uCold * 1.8) * (1.0 - dj * 0.8);
    float jumpPh = mix(iSeed.x, 0.0, uSync);
    float jump = uJump * max(0.0, sin(fract(uBeat * 0.5 + jumpPh) * 6.283)) * (0.4 + iSeed.z * 0.6) * 0.32 * (dancer + sign * 0.5);
    jump += wCheer * max(0.0, sin(fract(uBeat + iSeed.x * 0.2) * 6.283)) * 0.12 * dancer;
    vec3 P = vec3(0.0, 0.95, 0.0);
    mat3 Ru = rotY(twist) * rotZ(sway);
    vec3 S = vec3(shiftX, 0.0, 0.0);
    float b = aBone;
    mat3 R = mat3(1.0);
    vec3 T = vec3(0.0);
    if (b < 0.5) {
      R = Ru;
      T = P + S - Ru * P;
    } else if (b < 2.5) {
      vec3 hip = vec3(b < 1.5 ? -0.09 : 0.09, 0.9, 0.0);
      R = rotX(-k);
      T = hip - R * hip;
    } else if (b < 4.5) {
      float sd = b < 3.5 ? -1.0 : 1.0;
      vec3 hip = vec3(sd * 0.09, 0.9, 0.0);
      vec3 knee = vec3(sd * 0.09, 0.5, 0.0);
      vec3 knee2 = hip + rotX(-k) * (knee - hip);
      R = rotX(k);
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
    T.y += jump - 0.8 * (1.0 - cos(k));
    // props only when they're in use
    float vis = 1.0;
    if (aMat > 6.5 && aMat < 7.5) vis = step(0.5, wDrink);
    else if (aMat > 7.5 && aMat < 10.5) vis = step(0.5, wFilm);
    else if (aMat > 10.5) vis = sign;
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
  uniform float uSignGlow, uTime, uPhotos;
  uniform vec3 uRim, uRimFrom;
  float crowdHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  varying float vMat;
  varying vec4 vSeed;
  varying vec2 vUv2;
  varying float vSignRow;
`;

const FRAG_COLOR = /* glsl */ `
  float tone = fract(vSeed.w * 7.13);
  vec3 skin = mix(vec3(0.93, 0.7, 0.56), vec3(0.3, 0.19, 0.13), tone) * 0.6;
  float hv = fract(tone * 13.7);
  vec3 top = diffuseColor.rgb;
  vec3 hair = hv < 0.45 ? vec3(0.03, 0.025, 0.02) : hv < 0.7 ? vec3(0.16, 0.09, 0.05) : hv < 0.82 ? vec3(0.55, 0.42, 0.25) : top * 1.1;
  float bv = fract(vSeed.z * 31.7);
  vec3 bottoms = bv < 0.4 ? vec3(0.025) : bv < 0.7 ? vec3(0.06, 0.09, 0.17) : bv < 0.85 ? vec3(0.24, 0.21, 0.15) : vec3(0.11);
  vec3 shoes = fract(vSeed.y * 19.1) < 0.4 ? vec3(0.78) : vec3(0.03);
  float sleeve = fract(vSeed.x * 3.3);
  vec3 col = top;
  vec3 glow = vec3(0.0);
  float m = vMat;
  if (m > 0.5 && m < 1.5) col = bottoms;
  else if (m > 1.5 && m < 2.5) col = skin;
  else if (m > 2.5 && m < 3.5) col = hair;
  else if (m > 3.5 && m < 4.5) col = shoes;
  else if (m > 4.5 && m < 5.5) col = sleeve < 0.15 ? skin : top;
  else if (m > 5.5 && m < 6.5) col = sleeve < 0.6 ? skin : top;
  else if (m > 6.5 && m < 7.5) col = fract(vSeed.w * 5.1) < 0.5 ? vec3(0.6, 0.05, 0.04) : vec3(0.72, 0.74, 0.78);
  else if (m > 7.5 && m < 8.5) col = vec3(0.02);
  else if (m > 8.5 && m < 9.5) { col = vec3(0.0); glow = vec3(0.55, 0.64, 0.85) * 1.05; }
  else if (m > 9.5 && m < 10.5) {
    col = vec3(0.02);
    glow = vec3(2.2) * step(0.6, fract(vSeed.y * 7.0));
    // taking photos after the drop: each phone fires its flash now and then
    if (uPhotos > 0.001) glow += vec3(16.0) * step(1.0 - 0.06 * uPhotos, crowdHash(vec2(vSeed.x * 113.0, floor(uTime * 9.0 + vSeed.z * 9.0))));
  }
  else if (m > 10.5 && m < 11.5) col = vec3(0.02);
  else if (m > 11.5) {
    vec3 t = texture2D(uSigns, vec2(vUv2.x, (vSignRow + vUv2.y) / 8.0)).rgb;
    vec2 cell = fract(vUv2 * vec2(80.0, 20.0)) - 0.5;
    float led = smoothstep(0.5, 0.22, length(cell));
    col = vec3(0.0);
    glow = t * (0.25 + led * 1.6) * uSignGlow;
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
    uSigns: { value: null as THREE.Texture | null },
    uSignGlow: { value: 1 },
    uPhotos: { value: 0 },
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
    const clothes = (o.clothes ?? ['#1b1d22', '#2a2d33', '#101114', '#3a2f2a', '#23262d', '#d9d6cf', '#5a1e22', '#1d2b3a']).map((c) => new THREE.Color(c));
    const booth = o.booth ?? new THREE.Vector3(0, 0, 0.2);
    // the rim comes from the rig over and behind the booth
    this.u.uRimFrom.value.set(booth.x, booth.y + 3.5, booth.z + 1.3);
    const n = spots.length;
    const seeds = new Float32Array(n * 4);
    const info = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seeds[i] = r();
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
    // the first sign near the front is the superfan's (sign row 0: the DJ's name)
    let signRow = 0;
    spots.forEach((s, i) => {
      const role: CrowdRole = signIdx.has(i) ? 'sign' : (s.role ?? o.role ?? 'dancer');
      const code = ROLE_CODE[role];
      const drinks = o.drinks ?? (role === 'vip' ? 0.75 : 0.1);
      const phones = role === 'vip' ? Math.max(0.3, o.phones ?? 0) : (o.phones ?? 0);
      info[i * 4] = code;
      info[i * 4 + 1] = role !== 'dj' && role !== 'sign' && r() < phones ? 1 : 0;
      info[i * 4 + 2] = role === 'sign' ? signRow++ % SIGNS.length : 0;
      info[i * 4 + 3] = role !== 'dj' && role !== 'sign' && r() < drinks ? 1 : 0;
    });

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    this.u.uSigns.value = signIdx.size ? signAtlas() : null;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\ncomputePose();\nobjectNormal = poseR * objectNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed = poseR * transformed + poseT;\nvMat = aMat;\nvSeed = iSeed;\nvUv2 = uv;\nvSignRow = iInfo.z;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
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
      const sc = s.scale ?? 0.9 + r() * 0.2;
      q.setFromAxisAngle(yAxis, face);
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y ?? 0, s.z), q, new THREE.Vector3(sc, sc, sc)));
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
        cs.set(seeds.subarray(i * 4, i * 4 + 4), j * 4);
        ci.set(info.subarray(i * 4, i * 4 + 4), j * 4);
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
  }

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
    // the crowd's state (Section 8.1): cold below a quarter, as one when euphoric
    u.uCold.value += (Math.max(0, Math.min(1, (0.3 - hype) / 0.15)) - u.uCold.value) * Math.min(1, dt * 0.8);
    u.uSync.value += ((s.playing ? Math.max(0, Math.min(1, (hype - 0.85) / 0.1)) : 0) - u.uSync.value) * Math.min(1, dt * 0.8);
    u.uSignGlow.value = (0.8 + 0.35 * Math.pow(1 - (((s.beat % 1) + 1) % 1), 2)) * (0.6 + 0.4 * s.master);
    u.uPhotos.value = s.photos;
    // the rim: the show's colours, harder with the wash and the kick, white in the strobes
    const rim = u.uRim.value;
    rim.copy(s.colors[0]).lerp(s.colors[1], 0.5 + 0.5 * Math.sin(s.t * 0.3)).lerp(RIM_WHITE, 0.25 + s.flash * 0.5);
    rim.multiplyScalar(((0.25 + s.wash * 0.5 + s.kick * 0.25 + s.peak * 0.2) * s.master + s.flash * 0.8) * 0.9);
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
