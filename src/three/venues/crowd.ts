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
 *   – the figure: friendly and stylised rather than realistic: a head a
 *     little larger than life with a smiling painted face (big round eyes,
 *     a button nose, a grin when the room's going), a shaped torso, rounded
 *     shoulders, warm skin tones, trainers; clothing: tops in the venue's palette, sleeves, trousers (or
 *     shorts, more at the warm venues) and shoes picked per person, skin and
 *     hair tones varied, long hair on some, caps on a few, builds slimmer
 *     and broader
 *   – performance: dancers are grouped in ~6 m chunks, each its own instanced
 *     mesh, so chunks off screen are culled; chunks far from the camera swap
 *     to a low-detail model (a little under half the triangles). Both models
 *     share one set of vertex buffers.
 *   – the front row: the couple of dozen dancers nearest the booth are one
 *     more instanced mesh of their own, built from a detailed close-up model
 *     and dressed for the venue's look (frontrow.ts). The same shader poses
 *     them, so they dance in step; they replace their low-detail selves.
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
import { crowdShow } from './crowdShow';
import { FRONT_COMMON, FRONT_LIGHT, FRONT_VIS, frontFrag, frontGeometry, LOOK_CODE, type CrowdLook } from './frontrow';
import { attach, bodyGeometry, fixMorphTypes, hairGeometry, JOINTS, JOINTS_FEMALE, LANDMARKS, MORPH_GLSL, SHOE, shoeShape, WAIST_Y, welded, type BodyMats } from './crowdbody';

export type CrowdRole = 'dancer' | 'sign' | 'vip' | 'dj' | 'marathon' | 'filmer' | 'towel' | 'barlean' | 'rider' | 'security' | 'bartender' | 'conga' | 'card';
const ROLE_CODE: Record<CrowdRole, number> = { dancer: 0, sign: 1, vip: 2, dj: 3, marathon: 4, filmer: 5, towel: 6, barlean: 7, rider: 8, security: 9, bartender: 10, conga: 11, card: 12 };
/** people in a conga line at once */
const CONGA = 10;

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
  /** hand-made cardboard signs (requests and messages; default a few in a crowd of 24 or more) */
  cards?: number;
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
  /**
   * The front row: how many of the dancers nearest the booth are drawn with
   * the detailed close-up model (frontrow.ts) in place of the crowd's (default
   * 24 in a crowd of 30 or more dancers, none in a smaller one).
   */
  frontRow?: number;
  /** what the front row wears: club (default), dark (Berghain), beach, festival or playa */
  look?: CrowdLook;
}

let shadowGeo: THREE.BufferGeometry | null = null;
let shadowMat: THREE.MeshBasicMaterial | null = null;

/* bones */
const B = { body: 0, thighL: 1, thighR: 2, shinL: 3, shinR: 4, upperL: 5, foreL: 6, upperR: 7, foreR: 8, head: 9, sign: 10 };
/* materials (longHair, cap and hairUp, a quiff, are worn by some people; shin is the trouser leg or, in shorts, bare skin) */
const M = { top: 0, bottoms: 1, skin: 2, hair: 3, shoes: 4, sleeveUp: 5, sleeveLo: 6, cup: 7, phone: 8, screen: 9, torch: 10, signFrame: 11, signFace: 12, towel: 13, longHair: 14, shin: 15, cap: 16, hairUp: 17, eye: 18, curls: 28, bun: 29, pony: 33 };
/* the body's regions as the crowd's materials (crowdbody.ts) */
export const BODY_MATS: BodyMats = { top: M.top, bottoms: M.bottoms, skin: M.skin, sleeveUp: M.sleeveUp, sleeveLo: M.sleeveLo, shin: M.shin, shoes: M.shoes, eye: M.eye };
export const PERSON_BONES = B;
export const PERSON_MATS = M;

const personGeo: (THREE.BufferGeometry | null)[] = [null, null];

/** a part made from shapes (a prop, a hat): rigid on its bone, moving with the figure it's on (crowdbody.ts) */
export function part(g: THREE.BufferGeometry, bone: number, mat: number): THREE.BufferGeometry {
  return attach(g, bone, mat, bone !== B.sign);
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Rest pose: standing, facing +Z, feet on y = 0, 1.75 m tall (each person is
 * scaled to their own height). The body is MakeHuman's (crowdbody.ts), shaped
 * per person in the vertex shader; the joints are crowdbody's JOINTS.
 * detail 0 is the close-up model; detail 1 keeps the same skeleton and props
 * with far fewer triangles (used for dancers away from the camera, and for the
 * far crowd's cut-outs).
 */
export function personGeometry(detail: 0 | 1 = 0): THREE.BufferGeometry {
  const cached = personGeo[detail];
  if (cached) return cached;
  const lo = detail === 1;
  const lod = lo ? 2 : 1;
  const parts: THREE.BufferGeometry[] = [bodyGeometry(lod, BODY_MATS, { eyes: !lo }), hairGeometry(lod, M.hair)];
  if (lo) for (const sd of [-1, 1]) parts.push(part(new THREE.SphereGeometry(LANDMARKS.eyeR, 6, 4).translate(sd * LANDMARKS.eye[0], LANDMARKS.eye[1], LANDMARKS.eye[2]), B.head, M.eye));
  for (const sd of [-1, 1]) parts.push(part(welded(shoeShape(sd, lo ? 8 : 14, lo ? 5 : 8)), sd < 0 ? B.shinL : B.shinR, M.shoes));
  parts.push(...headKit(lo), ...props(lo));
  const geo = fixMorphTypes(mergeGeometries(parts.map(plain))!);
  personGeo[detail] = geo;
  return geo;
}

/** shapes made by three come with a uv and normal; drop nothing, but make sure they're indexed like the body */
function plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g : mergeVertices(g, 1e-9);
}

/* the head's size and where it sits, for the hats and hair made from shapes (crowdbody.ts LANDMARKS) */
const HEAD = {
  /** the middle of the skull */
  c: new THREE.Vector3(0, LANDMARKS.eye[1] + 0.006, 0.035),
  /** half its width (over the ears' tops), height above the middle, half its depth */
  r: new THREE.Vector3(0.079, LANDMARKS.headTop - (LANDMARKS.eye[1] + 0.006), 0.101),
};
export const PERSON_HEAD = HEAD;
/** a unit-head shape (a sphere of radius 1 about the origin is the skull) onto the head */
function onHead(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.scale(HEAD.r.x, HEAD.r.y, HEAD.r.z).translate(HEAD.c.x, HEAD.c.y, HEAD.c.z);
}
/* the right hand's palm (the left mirrors it) */
export const PALM = new THREE.Vector3(LANDMARKS.hand[0], LANDMARKS.hand[1] + 0.03, LANDMARKS.hand[2] - 0.005);

/** the cap, the quiff and the long hair (some people) */
export function headKit(lo: boolean): THREE.BufferGeometry[] {
  const R = (hi: number, low: number) => (lo ? low : hi);
  const out: THREE.BufferGeometry[] = [];
  // a quiff: volume over the front of the crown
  out.push(part(onHead(new THREE.SphereGeometry(1, R(12, 6), R(8, 4)).scale(0.72, 0.3, 0.62).rotateX(-0.32).translate(0, 0.84, 0.36)), B.head, M.hairUp));
  // long hair: from under the hair at the crown, round the back of the head to the temples, falling straight (the shader cuts it to length)
  out.push(part(longHair(lo), B.head, M.longHair));
  // curls or an afro: a full, rounded volume over the head (the shader takes it back off the face)
  {
    const cu = new THREE.SphereGeometry(1.2, R(16, 8), R(10, 5), 0, Math.PI * 2, 0, Math.PI * 0.7);
    const p = cu.attributes.position;
    const d = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      d.fromBufferAttribute(p, i).normalize();
      const k = lo ? 1 : 1 + 0.05 * Math.sin(d.x * 13 + 1.7) * Math.sin(d.y * 15 + 0.3) * Math.sin(d.z * 11 + 2.1);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    out.push(part(onHead(welded(cu).translate(0, 0.16, -0.08)), B.head, M.curls));
  }
  // a bun high at the back
  out.push(part(onHead(new THREE.SphereGeometry(1, R(10, 6), R(7, 4)).scale(0.5, 0.36, 0.42).translate(0, 0.78, -0.86)), B.head, M.bun));
  // a ponytail from the back of the crown, tied, falling to the shoulders
  {
    const pt = new THREE.CapsuleGeometry(0.024, 0.2, R(3, 2), R(8, 5));
    const p = pt.attributes.position;
    for (let i = 0; i < p.count; i++) {
      // fuller below the tie, tapering to the ends
      const y = p.getY(i);
      const k = 1 + 0.35 * smooth(0.12, 0.0, y) - 0.5 * smooth(-0.02, -0.13, y);
      p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k);
    }
    out.push(part(pt.translate(0, -0.1, 0).rotateX(0.22).translate(0, HEAD.c.y + 0.05, HEAD.c.z - HEAD.r.z - 0.012), B.head, M.pony));
  }
  // a cap, peak forward
  out.push(part(onHead(new THREE.SphereGeometry(1.12, R(14, 8), R(5, 3), 0, Math.PI * 2, 0, Math.PI * 0.46).scale(1, 0.92, 1).translate(0, 0.08, -0.02)), B.head, M.cap));
  out.push(part(onHead(new THREE.CylinderGeometry(0.92, 0.92, 0.08, R(12, 6), 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 0.95).translate(0, 0.32, 0.62)), B.head, M.cap));
  return out;
}

/**
 * Long hair as a sheet: it starts under the hair over the crown, hugs the
 * back and sides of the head down to the temples, then falls straight to
 * below the shoulder blades, flaring a little. Seen from both sides (the
 * inside shows past the face).
 */
function longHair(lo: boolean): THREE.BufferGeometry {
  const nu = lo ? 8 : 20;
  const nv = lo ? 3 : 8;
  const reach = Math.PI * 0.66;
  const len = 0.44;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const phi = -reach + (2 * reach * i) / nu;
      const v = j / nv;
      const side = Math.abs(phi) / reach;
      const yTop = HEAD.c.y + 0.075 - 0.07 * side * side;
      const y = yTop - v * len;
      const ey = (y - HEAD.c.y) / HEAD.r.y;
      const rr = y > HEAD.c.y ? Math.sqrt(Math.max(0.05, 1 - ey * ey)) : 1;
      const k = 1.08 + 0.1 * smooth(0.05, 1, v) + (lo ? 0 : 0.015 * Math.sin(phi * 9 + v * 4));
      const th = Math.PI - phi;
      pos.push(Math.sin(th) * HEAD.r.x * rr * k, y, HEAD.c.z + Math.cos(th) * HEAD.r.z * rr * k);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + nu + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the other side: the same sheet, wound the other way, its normals turned in
  const back = g.clone();
  const bi = back.index!.array as Uint16Array | Uint32Array;
  for (let t = 0; t < bi.length; t += 3) [bi[t + 1], bi[t + 2]] = [bi[t + 2], bi[t + 1]];
  const bn = back.attributes.normal;
  for (let i = 0; i < bn.count; i++) bn.setXYZ(i, -bn.getX(i), -bn.getY(i), -bn.getZ(i));
  const both = mergeGeometries([g, back])!;
  both.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(both.attributes.position.count * 2), 2));
  return both;
}

/** the props: the phone (and its torch), the drink, the sign, the towel */
export function props(lo: boolean): THREE.BufferGeometry[] {
  const R = (hi: number, low: number) => (lo ? low : hi);
  const P = PALM;
  const out = [
    // phone in the right hand: screen faces the holder once the arm is raised, torch on the back
    part(new THREE.BoxGeometry(0.07, 0.14, 0.012).translate(P.x, P.y - 0.08, P.z + 0.026), B.foreR, M.phone),
    part(new THREE.PlaneGeometry(0.062, 0.128).translate(P.x, P.y - 0.08, P.z + 0.0325), B.foreR, M.screen),
    // cup in the left hand, pre-tilted so it stands upright in the drinking pose
    part(new THREE.CylinderGeometry(0.036, 0.028, 0.11, R(10, 5)).translate(0, 0.02, 0.04).rotateX(2.2).translate(-P.x, P.y - 0.01, P.z - 0.004), B.foreL, M.cup),
    // LED sign held overhead
    part(new THREE.BoxGeometry(0.76, 0.22, 0.02).translate(0, 2.1, 0.12), B.sign, M.signFrame),
    part(new THREE.PlaneGeometry(0.72, 0.18).translate(0, 2.1, 0.1305), B.sign, M.signFace),
    // the towel guy's towel, hanging from the right hand (it whirls when the arm goes up)
    part(new THREE.PlaneGeometry(0.32, 0.56, 1, lo ? 1 : 3).translate(P.x, P.y - 0.3, P.z + 0.014), B.foreR, M.towel),
  ];
  if (!lo) out.push(part(new THREE.PlaneGeometry(0.014, 0.014).rotateY(Math.PI).translate(P.x + 0.015, P.y - 0.135, P.z + 0.0195), B.foreR, M.torch));
  return out;
}

/** a hash of a person's seeds to [0, 1) */
const seedHash = (s: number[], k: number) => {
  const v = Math.sin(s[0] * 12.9898 + s[1] * 78.233 + s[2] * 45.164 + s[3] * 94.673 + k * 17.17) * 43758.5453;
  return v - Math.floor(v);
};
/** the standard normal at a probability (a quick approximation) */
const normalAt = (p: number) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.sign(q - 0.5) * Math.sqrt(-Math.log(4 * q * (1 - q)) * (Math.PI / 2) * 0.985);
};

/**
 * Who a person in the crowd is, from their seeds: the shape the crowd shader
 * mixes for them (iBody: woman 0/1, build -1 slim .. 1 heavy, muscle, and
 * ancestry + skin tone: the whole part 0 / 1 African / 2 East Asian, the
 * fraction the tone from fair to deep) and their height.
 */
export function crowdPerson(seed: number[]): { body: [number, number, number, number]; woman: boolean; height: (p: number) => number } {
  const woman = seedHash(seed, 1) < 0.5;
  const build = Math.max(-0.8, Math.min(1, 0.05 + 0.33 * normalAt(seedHash(seed, 2))));
  const muscle = Math.max(-0.7, Math.min(0.9, (woman ? -0.1 : 0.15) + 0.3 * normalAt(seedHash(seed, 3))));
  // ancestry and skin tone: a mixed city crowd
  const a = seedHash(seed, 4);
  const t = seedHash(seed, 5);
  let cls = 0;
  let tone: number;
  if (a < 0.2) {
    cls = 1;
    tone = 0.62 + 0.36 * t;
  } else if (a < 0.34) {
    cls = 2;
    tone = 0.12 + 0.25 * t;
  } else if (a < 0.52) tone = 0.32 + 0.3 * t;
  else tone = 0.02 + 0.3 * t;
  return {
    body: [woman ? 1 : 0, build, muscle, cls + Math.min(0.999, tone)],
    woman,
    height: (p) => (woman ? 1.635 : 1.77) + (woman ? 0.065 : 0.07) * Math.max(-2.2, Math.min(2.2, normalAt(p))),
  };
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

/* the cardboard signs: marker pen on brown board, one message a row (crowdShow.cards) */
let cardTex: THREE.CanvasTexture | null = null;
let cardVersion = -1;

function cardAtlas(): THREE.Texture {
  if (!cardTex) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 1024;
    cardTex = new THREE.CanvasTexture(c);
    cardTex.colorSpace = THREE.SRGBColorSpace;
    cardTex.anisotropy = 4;
  }
  drawCards();
  return cardTex;
}

/** redraw the cardboard signs when their messages change */
export function drawCards(): void {
  if (!cardTex || cardVersion === crowdShow.cardsVersion) return;
  cardVersion = crowdShow.cardsVersion;
  const c = cardTex.image as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  const inks = ['#141414', '#1a2a8a', '#9a1414', '#0f5a23'];
  for (let i = 0; i < 8; i++) {
    // rows run bottom-up in the texture (as the LED signs' do)
    const y = (7 - i) * 128;
    const board = g.createLinearGradient(0, y, 0, y + 128);
    board.addColorStop(0, '#c49a64');
    board.addColorStop(1, '#a87d4c');
    g.fillStyle = board;
    g.fillRect(0, y, 512, 128);
    // corrugation and a torn edge
    g.fillStyle = 'rgba(0,0,0,0.05)';
    for (let x = 0; x < 512; x += 9) g.fillRect(x, y, 3, 128);
    g.fillStyle = 'rgba(60,40,20,0.35)';
    g.fillRect(0, y, 512, 3);
    g.fillRect(0, y + 125, 512, 3);
    const text = (crowdShow.cards[i] ?? '').toUpperCase();
    if (!text) continue;
    let size = 78;
    g.font = `700 ${size}px "Permanent Marker", "Comic Sans MS", "Marker Felt", cursive`;
    const w = g.measureText(text).width;
    if (w > 480) {
      size *= 480 / w;
      g.font = `700 ${size}px "Permanent Marker", "Comic Sans MS", "Marker Felt", cursive`;
    }
    g.save();
    g.translate(256, y + 66);
    g.rotate(((i * 37) % 7 - 3) * 0.012);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = inks[i % inks.length];
    g.fillText(text, 0, 0);
    // a heart or underline on some
    if (i % 3 === 1) g.fillRect(-Math.min(220, w / 2), size * 0.5, Math.min(440, w), 5);
    g.restore();
  }
  cardTex.needsUpdate = true;
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
  attribute vec4 aRig;
  #define aBone aRig.x
  #define aMat aRig.y
  #define aW aRig.z
  attribute vec4 iSeed;
  attribute vec4 iInfo;
  ${MORPH_GLSL}
  uniform float uBeat, uTime, uBob, uHands, uJump, uClap, uCheer, uKick, uCold, uSync, uHype, uRiders, uLook;
  uniform vec4 uStyle, uCircle, uCopy;
  uniform float uSit, uLights, uWild, uCongaOn, uShorts;
  uniform vec2 uBooth;
  uniform vec2 uConga[${CONGA}];
  varying float vMat;
  varying float vCard;
  varying vec4 vSeed;
  varying vec2 vUv2;
  varying float vSignRow;
  varying vec3 vRest;
  flat varying float vBone;
  flat varying vec4 vBody;
  flat varying vec4 vLook;
  #ifdef CROWD_FRONT
  varying float vMouth;
  varying float vFilm;
  float poseMouth;
  float poseFilm;
  #endif
  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
  float h1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
  float vnoise(float x) { float i = floor(x); float f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  /*
   * The person: their hair (a style the shape of the head and their figure
   * suit) and its colour, a beard or stubble, from their seed and figure.
   * x: style 0 shaved, 1 buzz cut, 2 short, 3 textured fringe, 4 swept up
   * (the quiff), 5 curls / afro, 6 long, 7 bob, 8 bun, 9 ponytail;
   * y: hair colour (0 black .. 1 fair, above 1 dyed); z: facial hair (0 none,
   * 1 stubble, 2 beard); w: eye colour pick
   */
  vec4 personLook() {
    float woman = step(0.5, iBody.x);
    float cls = floor(iBody.w);
    float tone = fract(iBody.w);
    float h = fract(iSeed.x * 17.9 + iSeed.w * 3.7);
    float style;
    if (woman > 0.5) {
      // afro-textured hair more often curls, braids or a bun
      float c = cls > 0.5 && cls < 1.5 ? 0.3 : 0.08;
      style = h < c ? 5.0 : h < c + 0.36 ? 6.0 : h < c + 0.52 ? 7.0 : h < c + 0.68 ? 8.0 : h < c + 0.86 ? 9.0 : h < c + 0.94 ? 3.0 : h < c + 0.97 ? 4.0 : 1.0;
    } else {
      float c = cls > 0.5 && cls < 1.5 ? 0.22 : 0.06;
      style = h < 0.06 ? 0.0 : h < 0.06 + c ? 5.0 : h < 0.24 + c ? 1.0 : h < 0.5 + c ? 2.0 : h < 0.64 + c ? 3.0 : h < 0.76 + c ? 4.0 : h < 0.82 + c ? 6.0 : h < 0.85 + c ? 8.0 : 2.0;
    }
    // hair colour: dark for deeper skin and East Asian ancestry, every shade on fair skin, a few dyed
    float hc = fract(iSeed.y * 23.1 + iSeed.z * 1.7);
    float light = (cls < 0.5 ? 1.0 - smoothstep(0.25, 0.6, tone) : 0.0);
    float col = hc * mix(0.35, 1.0, light);
    if (fract(iSeed.w * 41.3) > 0.94) col = 1.0 + fract(iSeed.x * 7.7);
    // facial hair: men only, more with shorter hair
    float fh = fract(iSeed.z * 13.3 + iSeed.y * 2.1);
    float beard = woman > 0.5 ? 0.0 : fh < 0.22 ? 2.0 : fh < 0.5 ? 1.0 : 0.0;
    return vec4(style, col, beard, fract(iSeed.y * 29.3));
  }
  mat3 poseR;
  vec3 poseT;
  vec3 bodyPos;
  void computePose() {
    vLook = personLook();
    vBody = iBody;
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
    float barman = step(9.5, role) * step(role, 10.5);
    float conga = step(10.5, role) * step(role, 11.5);
    float card = step(11.5, role);
    vCard = card;
    // where this person stands (in the crowd's space), and which way they face
    mat3 IM = mat3(instanceMatrix);
    vec2 here = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
    float faceNow = atan(IM[2].x, IM[2].z);
    // the bar-leaner only joins in when the room's really going
    float leanDance = lean * smoothstep(0.78, 0.92, uHype);
    float leaning = lean - leanDance;
    float staff = guard + barman;
    // a cardboard sign is held like an LED one; the conga line counts as dancing
    sign = max(sign, card);
    float dancer = 1.0 - sign - vip - dj - leaning - rider - staff - conga;
    float mover = dancer + conga;
    // the dance circle: the soloist in the middle, everyone else pushed back into a ring facing them
    vec2 toC = here - uCircle.xy;
    float rC = length(toC);
    float solo = uCircle.w * (1.0 - step(0.05, rC)) * dancer;
    float ring = uCircle.w * (1.0 - step(uCircle.z + 1.2, rC)) * (1.0 - solo) * (dancer + sign);
    // copying your moves: the front rows, or everyone for a big one
    float front = max(uCopy.z, 1.0 - smoothstep(5.0, 9.0, length(here - uBooth)));
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
    // techno: more fists in the air; and your fist pump, copied
    wPump = max(wPump, uStyle.y * 0.5 * E * step(0.5, fract(iSeed.w * 3.3)) * dancer);
    wPump = max(wPump, uCopy.y * front * dancer);
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
    // pointing back at you, when you point at them
    float wPointDJ = uCopy.x * front * step(0.25, fract(iSeed.z * 9.1)) * dancer;
    aR = mix(aR, vec3(0.1, 1.6 + 0.08 * hit, 0.05), wPointDJ);
    // the ring round the dance circle claps the soloist on
    float wRing = ring * step(0.3, fract(iSeed.x * 7.9));
    aL = mix(aL, vec3(0.32 - 0.5 * open, 1.7, 0.4), wRing * (1.0 - sign));
    aR = mix(aR, vec3(0.32 - 0.5 * open, 1.7, 0.4), wRing * (1.0 - sign));
    // lights up: a phone light held high, swaying slowly
    float wLight = uLights * step(0.2, fract(iSeed.y * 11.3)) * (dancer + vip);
    float lsw = sin(uTime * 1.3 + iSeed.x * 6.283) * 0.28;
    aR = mix(aR, vec3(0.25 + lsw, 2.35, 0.35), wLight);
    aL = mix(aL, vec3(0.2 - lsw * 0.5, 0.5, 1.2), wLight * 0.6);
    // sitting down for the build: hands on knees
    float wSit = uSit * (dancer + conga);
    aL = mix(aL, vec3(0.1, 0.75, 0.9), wSit);
    aR = mix(aR, vec3(0.1, 0.75, 0.9), wSit);
    // the conga: hands on the shoulders of the one in front
    aL = mix(aL, vec3(0.06, 1.42, 0.45), conga * (1.0 - wSit));
    aR = mix(aR, vec3(0.06, 1.42, 0.45), conga * (1.0 - wSit));
    // the soloist: arms out, spinning
    aL = mix(aL, vec3(1.45 + 0.4 * hit, 0.3, 0.2), solo);
    aR = mix(aR, vec3(1.45 + 0.4 * (1.0 - hit), 0.3, 0.2), solo);
    // phones: the filmers, plus (cold) people scrolling at chest height
    float wFilm = iInfo.y * smoothstep(0.3, 0.4, vnoise(uTime * 0.05 + iSeed.w * 11.0) + uCheer * 0.3) * (1.0 - wClap) * (1.0 - wLight) * (1.0 - wSit);
    // the filmer never puts it down; the VIP crew hold phone lights up through the breakdowns
    wFilm = max(wFilm, filmer);
    wFilm = max(wFilm, vip * smoothstep(0.2, 0.5, uClap) * step(0.35, fract(iSeed.z * 13.1)));
    float wScroll = uCold * step(0.55, fract(iSeed.y * 7.3)) * (1.0 - iInfo.y) * dancer * (1.0 - marathon) * (1.0 - filmer);
    aR = mix(aR, vec3(0.1, 0.25, 1.35), wScroll);
    aR = mix(aR, vec3(0.12, 1.95, 0.6), wFilm);
    float wDrink = iInfo.w * (1.0 - wClap) * (1.0 - wUp) * (1.0 - wCheer);
    aL = mix(aL, vec3(0.12, 0.45 + 0.08 * hit, 1.75), wDrink);
    // a sign held up; waved about when their request's been played
    float wv = sin(uTime * 7.0 + iSeed.x * 6.283) * 0.35 * uWild;
    aL = mix(aL, vec3(-0.2 + wv, 2.75, 0.35), sign);
    aR = mix(aR, vec3(-0.2 - wv, 2.75, 0.35), sign);
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
    // the genre's style: swaying music bounces less, drum & bass bounces twice a beat
    bounce *= 1.0 - 0.45 * uStyle.w * mover;
    float hit2 = pow(1.0 - fract(uBeat * 2.0 + iSeed.x * 0.1), 2.0);
    float k = min(0.7, bounce * 5.0 * mix(hit, hit2, uStyle.z * mover) + uKick * 0.07 * dancer + 0.04);
    k += uStyle.z * mover * hit2 * 0.12 * (0.4 + uHands);
    // the sit-down: right down on the haunches; the soloist low to the floor
    k = mix(k, 1.45, wSit);
    k = mix(k, 0.9, solo);
    // sitting on shoulders: knees bent right up, shins hanging
    k = mix(k, 1.45, rider);
    // the weight goes from leg to leg, a beat each (a step-touch): one knee bends, the other foot comes up
    float stepW = sin(uBeat * 3.14159 + iSeed.z * 6.283) * min(0.16, bounce * 1.8 + 0.03 * E) * mover;
    // techno: a stomp, one foot then the other, harder
    stepW *= 1.0 + uStyle.y * 1.6 * mover;
    stepW = mix(stepW, sin(uBeat * 3.14159) * 0.22, conga);
    float kL = max(0.0, k + stepW);
    float kR = max(0.0, k - stepW);
    // and the body leans into the beat
    float beatLean = (0.04 + 0.08 * E) * hit * dancer;
    // house: the jack, the whole torso pumping forward and back on every beat
    beatLean += uStyle.x * mover * (0.1 + 0.08 * E) * (hit - 0.35);
    beatLean += wSit * 0.35;
    float sway = sin(uBeat * 1.5708 + iSeed.x * 6.283) * (0.04 + 0.06 * vip + 0.03 * E);
    // deep and slow music: a wide, easy sway
    sway *= 1.0 + uStyle.w * 1.8 * mover;
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
    jump += uStyle.z * mover * max(0.0, sin(fract(uBeat * 2.0 + iSeed.x * 0.1) * 6.283)) * 0.03 * (0.3 + uHands);
    jump += uWild * sign * max(0.0, sin(fract(uBeat + iSeed.x * 0.2) * 6.283)) * 0.14;
    jump += wCheer * max(0.0, sin(fract(uBeat + iSeed.x * 0.2) * 6.283)) * 0.12 * dancer;
    jump += marathon * max(0.0, sin(fract(uBeat * 0.5) * 6.283)) * 0.05;
    vec3 P = vec3(0.0, 0.95, 0.0);
    // the bar-leaner's lean over the counter
    mat3 Ru = rotY(twist + solo * uTime * 5.0) * rotZ(sway) * rotX(0.28 * leaning + beatLean);
    vec3 S = vec3(shiftX, 0.0, 0.0);
    float b = aBone;
    // how much of its own joint's turn this vertex takes (1 on the bone, less towards its parent: crowdbody.ts)
    float fw = aW;
    mat3 R = mat3(1.0);
    vec3 T = vec3(0.0);
    if (b < 0.5) {
      R = Ru;
      T = P + S - Ru * P;
    } else if (b < 2.5) {
      float sd = b < 1.5 ? -1.0 : 1.0;
      vec3 hip = jHip(sd);
      mat3 Rt = rotX(-(b < 1.5 ? kL : kR));
      // the top of the thigh blends into the hips, which go with the body
      R = Ru * (1.0 - fw) + Rt * fw;
      T = (P + S - Ru * P) * (1.0 - fw) + (hip - Rt * hip) * fw;
    } else if (b < 4.5) {
      float sd = b < 3.5 ? -1.0 : 1.0;
      float kk = sd < 0.0 ? kL : kR;
      vec3 hip = jHip(sd);
      vec3 knee = jKnee(sd);
      vec3 knee2 = hip + rotX(-kk) * (knee - hip);
      // round the knee the shin takes part of the bend
      R = rotX(mix(-kk, kk * (1.0 - rider), fw));
      T = knee2 - R * knee;
    } else if (b < 8.5) {
      float sd = b < 6.5 ? -1.0 : 1.0;
      vec3 ap = sd < 0.0 ? aL : aR;
      vec3 Sh = jShoulder(sd);
      bool upper = b < 5.5 || (b > 6.5 && b < 7.5);
      // round the shoulder the arm's turn fades into the body's
      float fa = upper ? fw : 1.0;
      mat3 Ra = rotZ(sd * ap.x * fa) * rotX(-ap.y * fa);
      if (upper) {
        R = Ru * Ra;
        T = Ru * (Sh - Ra * Sh - P) + P + S;
      } else {
        vec3 E0 = jElbow(sd);
        mat3 Re = rotX(-ap.z * fw);
        R = Ru * Ra * Re;
        T = Ru * (Sh + Ra * (E0 - Sh) - Ra * Re * E0 - P) + P + S;
      }
    } else if (b < 9.5) {
      vec3 N = jNeck();
      // the nod and turn run down the neck
      mat3 Rh = rotY(turn * fw) * rotX(nod * fw);
      R = Ru * Rh;
      T = Ru * (N - Rh * N - P) + P + S;
    } else {
      vec3 A = vec3(0.0, 2.0, 0.12);
      mat3 Rs = rotZ(sin(uBeat * 1.5708 + iSeed.x * 6.283) * 0.12);
      R = Ru * Rs;
      T = Ru * (A - Rs * A - P) + P + S;
    }
    // the body sits down as far as the straighter leg allows, so that foot stays on the floor
    T.y += jump - mix(${(JOINTS.hip[1] - JOINTS.ankle[1]).toFixed(4)}, ${(JOINTS_FEMALE.hip[1] - JOINTS_FEMALE.ankle[1]).toFixed(4)}, iBody.x) * (1.0 - cos(min(kL, kR))) * (1.0 - rider);
    // the rider sits up on a friend's shoulders, there only for the peak
    float up = smoothstep(0.35, 0.6, uRiders);
    T.y += rider * (1.25 + 0.04 * hit);
    // props only when they're in use
    float vis = 1.0;
    float capOn = step(0.9, fract(iSeed.z * 5.91)) * (1.0 - staff) * (1.0 - dj);
    // the hair: a style for the person (personLook), the parts it needs
    float style = vLook.x;
    if (aMat > 32.5) vis = style > 8.5 ? 1.0 : 0.0;
    else if (aMat > 28.5 && aMat < 29.5) vis = style > 7.5 && style < 8.5 ? 1.0 : 0.0;
    else if (aMat > 27.5 && aMat < 28.5) vis = style > 4.5 && style < 5.5 ? 1.0 - capOn : 0.0;
    else if (aMat > 17.5) vis = 1.0;
    else if (aMat > 16.5) vis = style > 3.5 && style < 4.5 ? 1.0 - capOn : 0.0;
    else if (aMat > 15.5) vis = capOn;
    else if (aMat > 14.5) vis = 1.0;
    else if (aMat > 13.5) vis = (style > 5.5 && style < 7.5 ? 1.0 : 0.0) * (1.0 - guard);
    else if (aMat > 12.5) vis = towel;
    else if (aMat > 10.5) vis = sign;
    else if (aMat > 7.5) vis = step(0.5, max(wFilm, wLight));
    else if (aMat > 6.5) vis = step(0.5, wDrink);
    else if (aMat > 2.5 && aMat < 3.5) vis = style < 0.5 ? 0.0 : 1.0;
    #ifdef CROWD_FRONT
    /*FRONT_VIS*/
    #endif
    if (rider > 0.5 && up < 0.5) vis = 0.0;
    // the dance circle: the ring turns to face the soloist and steps back; the conga pushes through
    vec2 push = vec2(0.0);
    if (ring > 0.001 && rC > 0.0001) push += toC / rC * max(0.0, uCircle.z - rC) * ring;
    if (uCongaOn > 0.5 && conga < 0.5) {
      for (int i = 0; i < ${CONGA}; i++) {
        vec2 dd = here + push - uConga[i];
        float l = length(dd);
        if (l < 0.6 && l > 0.0001) push += dd / l * (0.6 - l) * uCongaOn;
      }
    }
    if (ring > 0.001) {
      float want = atan(-toC.x, -toC.y);
      float dTurn = mod(want - faceNow + 3.14159, 6.28318) - 3.14159;
      mat3 Rt = rotY(dTurn * ring);
      R = Rt * R;
      T = Rt * T;
    }
    if (dot(push, push) > 0.0) {
      vec3 lp = transpose(IM) * vec3(push.x, 0.0, push.y);
      lp /= vec3(dot(IM[0], IM[0]), dot(IM[1], IM[1]), dot(IM[2], IM[2]));
      T += lp;
    }
    if (vis < 0.5) {
      R = mat3(0.0);
      T = vec3(0.0, -50.0, 0.0);
    }
    poseR = R;
    poseT = T;
  }
`;

/* the hair's thickness by style (uv.x carries the shell's thickness: crowdbody.ts); clothes hang a little off the body */
const HAIR_VOLUME = /* glsl */ `
  // loose trousers and tops: pushed out from the skin by where the garment is (from the rest position and bone only, so the
  // copies of a vertex at a seam between two materials move together)
  if ((aMat < 2.5 || (aMat > 4.5 && aMat < 6.5) || (aMat > 14.5 && aMat < 15.5)) && aBone < 8.5) {
    float sv = fract(iSeed.x * 3.3);
    float sleeveEnd = sv < 0.15 ? 9.0 : sv < 0.62 ? ${(JOINTS.shoulder[1] - 0.15).toFixed(4)} : sv < 0.72 ? ${(JOINTS.elbow[1] - 0.03).toFixed(4)} : ${(JOINTS.wrist[1] + 0.035).toFixed(4)};
    bool shortsOn = fract(iSeed.z * 11.3) < uShorts;
    float woman = step(0.5, iBody.x);
    float legEnd = shortsOn ? (woman > 0.5 && fract(iSeed.y * 9.1) < 0.5 ? 0.7 : 0.6) : 0.0;
    float bv = fract(iSeed.z * 31.7);
    float loose = bv >= 0.4 && bv < 0.7 ? 0.007 : 0.015;
    float y = position.y;
    float push = 0.0;
    if (aBone > 4.5) push = 0.005 * smoothstep(sleeveEnd - 0.02, sleeveEnd + 0.01, y);
    else if (aBone > 0.5 || y < ${WAIST_Y.toFixed(4)}) push = loose * smoothstep(legEnd - 0.01, legEnd + 0.03, y) * (1.0 - 0.6 * smoothstep(0.35, 0.1, y));
    else push = 0.006 * smoothstep(1.3, 1.2, y);
    bodyPos += normal * push;
    // the cloth bridges the fork of the legs: the normals there turn to face out, so no crease shows
    if (aBone < 4.5 && normal.z > 0.0) {
      float fork = (1.0 - smoothstep(0.03, 0.09, abs(position.x))) * (1.0 - smoothstep(0.05, 0.13, abs(position.y - ${(JOINTS.hip[1] - 0.08).toFixed(4)})));
      objectNormal = normalize(mix(objectNormal, vec3(0.0, 0.0, 1.0), 0.8 * fork));
    }
  }
  if (aMat > 2.5 && aMat < 3.5) {
    float st = vLook.x;
    float vol = st < 1.5 ? 0.12 : st < 2.5 ? 0.45 : st < 3.5 ? 0.7 : st < 4.5 ? 0.55 : st < 5.5 ? 0.6 : st > 7.5 ? 0.35 : 0.75;
    bodyPos -= normal * uv.x * (1.0 - vol);
  }
`;

const FRAG_HEAD = /* glsl */ `
  uniform sampler2D uSigns, uCards;
  uniform float uSignGlow, uTime, uPhotos, uShorts, uSweat, uUV, uLights, uHype, uCheer;
  varying float vCard;
  uniform vec3 uRim, uRimFrom;
  float crowdHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  varying float vMat;
  varying vec4 vSeed;
  varying vec2 vUv2;
  varying float vSignRow;
  varying vec3 vRest;
  flat varying float vBone;
  flat varying vec4 vBody;
  flat varying vec4 vLook;
  #ifdef CROWD_FRONT
  varying float vMouth;
  varying float vFilm;
  #endif
`;

/* numbers for the shaders, from the body (crowdbody.ts) */
const gl = (x: number) => x.toFixed(4);
const EYE = LANDMARKS.eye;
const MOUTH = LANDMARKS.mouth;
const NOSE = LANDMARKS.nose;
const CHIN = LANDMARKS.chin;
const NECK_BASE = LANDMARKS.neckBase;
const SH = JOINTS.shoulder;

const FRAG_COLOR = /* glsl */ `
  float tone = fract(vBody.w);
  float cls = floor(vBody.w);
  float woman = step(0.5, vBody.x);
  // skin: fair to deep, a rosier or a more olive undertone; real albedos (a face lit by the show, not a mannequin's)
  float ts = tone * 5.0;
  vec3 skin = ts < 1.0 ? mix(vec3(0.66, 0.45, 0.36), vec3(0.57, 0.37, 0.26), ts)
    : ts < 2.0 ? mix(vec3(0.57, 0.37, 0.26), vec3(0.44, 0.27, 0.16), ts - 1.0)
    : ts < 3.0 ? mix(vec3(0.44, 0.27, 0.16), vec3(0.3, 0.165, 0.09), ts - 2.0)
    : ts < 4.0 ? mix(vec3(0.3, 0.165, 0.09), vec3(0.165, 0.085, 0.05), ts - 3.0)
    : mix(vec3(0.165, 0.085, 0.05), vec3(0.085, 0.045, 0.03), ts - 4.0);
  skin *= mix(vec3(1.03, 0.98, 0.97), vec3(0.98, 1.0, 0.93), fract(vSeed.w * 7.13));
  // hair: black through browns to blonde and red, a few dyed
  float hcv = vLook.y;
  vec3 hair = hcv < 0.3 ? mix(vec3(0.012, 0.01, 0.009), vec3(0.035, 0.022, 0.014), hcv / 0.3)
    : hcv < 0.55 ? mix(vec3(0.035, 0.022, 0.014), vec3(0.11, 0.06, 0.03), (hcv - 0.3) / 0.25)
    : hcv < 0.75 ? mix(vec3(0.11, 0.06, 0.03), vec3(0.28, 0.17, 0.08), (hcv - 0.55) / 0.2)
    : hcv < 0.92 ? mix(vec3(0.28, 0.17, 0.08), vec3(0.6, 0.46, 0.26), (hcv - 0.75) / 0.17)
    : hcv <= 1.0 ? mix(vec3(0.22, 0.06, 0.02), vec3(0.38, 0.11, 0.035), (hcv - 0.92) / 0.08)
    : fract(hcv) < 0.25 ? vec3(0.7, 0.2, 0.42) : fract(hcv) < 0.5 ? vec3(0.08, 0.2, 0.55) : fract(hcv) < 0.75 ? vec3(0.06, 0.45, 0.42) : vec3(0.75, 0.72, 0.7);
  vec3 top = diffuseColor.rgb;
  float bv = fract(vSeed.z * 31.7);
  bool jeans = bv >= 0.4 && bv < 0.7;
  vec3 bottoms = bv < 0.4 ? vec3(0.025) : jeans ? (fract(vSeed.x * 5.3) < 0.35 ? vec3(0.15, 0.22, 0.36) : vec3(0.05, 0.08, 0.16)) : bv < 0.85 ? vec3(0.24, 0.21, 0.15) : vec3(0.11);
  vec3 shoes = fract(vSeed.y * 19.1) < 0.4 ? vec3(0.78) : vec3(0.03);
  vec3 col = top;
  vec3 glow = vec3(0.0);
  float crowdRough = 0.86;
  vec3 p = vRest;
  float ax = abs(p.x);
  // antialiasing width for the painted details (they shrink to nothing at a distance)
  float aa = max(fwidth(p.y) * 1.5, 0.0008);
  float fine = 1.0 - smoothstep(0.0016, 0.004, aa);
  // the cut of their clothes: sleeves (none, short, to the elbow, long), trousers or shorts (more at the warm venues), a cropped top for some
  float sv = fract(vSeed.x * 3.3);
  bool vest = sv < 0.15;
  float sleeveEnd = vest ? 9.0 : sv < 0.62 ? ${gl(SH[1] - 0.15)} : sv < 0.72 ? ${gl(JOINTS.elbow[1] - 0.03)} : ${gl(JOINTS.wrist[1] + 0.035)};
  bool shortsOn = fract(vSeed.z * 11.3) < uShorts;
  #ifdef CROWD_FRONT
  if (vPick.y > 0.5) shortsOn = true;
  #endif
  float legEnd = shortsOn ? (woman > 0.5 && fract(vSeed.y * 9.1) < 0.5 ? 0.7 : 0.6) : ${gl(JOINTS.ankle[1] + 0.035)};
  float topEnd = woman > 0.5 && fract(vSeed.w * 13.7) < 0.22 ? ${gl(WAIST_Y + 0.11)} : ${gl(WAIST_Y)};
  float m = vMat;
  // the body's regions become garments, cut per pixel: the top, the sleeves, the trousers, bare skin
  if (m < 1.5 || (m > 4.5 && m < 6.5) || (m > 14.5 && m < 15.5)) {
    bool arm = m > 4.5 && m < 6.5;
    // the armhole: the cap of the shoulder goes with the sleeve, the side of the chest with the top
    float hole = ${gl(SH[0] - 0.036)} + 0.022 * smoothstep(1.27, 1.42, p.y) - (vest ? 0.03 + 0.03 * woman : 0.0);
    if (p.y > 1.27 && (m < 0.5 || arm)) arm = ax > hole;
    if (arm) m = p.y > sleeveEnd ? 5.0 : 2.0;
    else if (p.y > topEnd) m = 0.0;
    else if (p.y > ${gl(WAIST_Y)}) m = 2.0;
    else m = p.y > legEnd ? 1.0 : 2.0;
  }
  // the neckline: a crew neck, a V or a scoop (cut across the skin of the neck's base too, so the line is the shader's, not the mesh's)
  float nk = fract(vSeed.y * 5.31);
  if (m > 1.5 && m < 2.5 && p.y < ${gl(NECK_BASE + 0.03)} && p.y > 1.3 && ax < 0.13) m = 0.0;
  if (m < 0.5) {
    // round the neck: the line dips at the front by the neckline's depth, and climbs away beyond its opening so the shoulders stay covered
    float frontness = smoothstep(0.0, 0.05, p.z - ${gl(JOINTS.neck[2])});
    bool scoop = nk >= 0.2 && nk < 0.2 + 0.25 * woman;
    float depth = nk < 0.2 ? 0.075 * max(0.0, 1.0 - ax / 0.055) : scoop ? 0.05 * max(0.0, 1.0 - ax * ax / 0.0081) : 0.018 * max(0.0, 1.0 - ax * ax / 0.0045);
    float nr = length(vec2(p.x, (p.z - ${gl(JOINTS.neck[2])}) * 1.2));
    float opening = scoop ? 0.095 : 0.068;
    float neckLine = mix(${gl(JOINTS.neck[1] - 0.03)}, ${gl(JOINTS.neck[1] - 0.062)}, frontness) - depth * frontness + max(0.0, nr - opening) * 2.5;
    if (p.y > neckLine) m = 2.0;
    else if (p.y > neckLine - 0.01) col = top * 0.72;
  }
  if (m < 0.5) {
    float style = fract(vSeed.y * 5.31 + 0.37);
    float front = step(0.0, p.z);
    if (p.y < topEnd + 0.03) col = top * 0.82;
    else if (style > 0.35 && style < 0.45 && p.y > topEnd + 0.03 && p.y < 1.4) {
      // stripes, mostly tonal (a lighter or darker band of the same colour), white on a few
      vec3 band = fract(vSeed.x * 4.3) < 0.3 ? vec3(0.85) : fract(vSeed.x * 4.3) < 0.65 ? top * 0.45 : top * 0.55 + vec3(0.18);
      col = mix(top, band, smoothstep(0.5 - aa * 9.0, 0.5 + aa * 9.0, fract(p.y * 9.0)) * 0.8);
    }
    else if (style > 0.55 && style < 0.67 && front > 0.5 && p.z > ${gl(LANDMARKS.chestZ - 0.04)}) {
      // an abstract print on the chest: a ring, a dot or a chevron, in a contrasting colour
      vec2 c = vec2(p.x, p.y - 1.27);
      vec3 ink = fract(vSeed.w * 3.9) < 0.5 ? vec3(0.88) : vec3(1.0) - top * 0.8;
      float kind = fract(vSeed.z * 2.7);
      float r = length(c);
      float mark = kind < 0.33 ? smoothstep(0.005 + aa, 0.005, abs(r - 0.03)) : kind < 0.66 ? smoothstep(0.024 + aa, 0.024, r) : smoothstep(0.006 + aa, 0.006, abs(c.y + abs(c.x) * 0.7 - 0.01)) * step(abs(c.x), 0.038);
      col = mix(col, ink, mark * 0.75);
    }
    else if (style > 0.78 && style < 0.9 && p.y < 1.16) col = top * 0.55 + vec3(0.03);
    // the fabric's folds: a soft shade under the chest and round the waist
    col *= 1.0 - 0.08 * smoothstep(1.2, 1.1, p.y) * smoothstep(0.98, 1.08, p.y) * (0.5 + 0.5 * sin(p.x * 70.0 + p.y * 30.0));
    crowdRough = 0.88;
  }
  else if (m > 0.5 && m < 1.5) {
    col = bottoms;
    crowdRough = jeans ? 0.84 : 0.8;
    // the hem of shorts, turned up
    if (shortsOn && p.y < legEnd + 0.018) col = bottoms * 0.75;
    // a belt for some, a buckle at the front
    if (p.y > ${gl(WAIST_Y - 0.032)} && p.y < ${gl(WAIST_Y - 0.004)} && fract(vSeed.w * 9.1) > 0.4) {
      col = vec3(0.03);
      crowdRough = 0.5;
      if (ax < 0.016 && p.z > 0.06) col = vec3(0.5, 0.47, 0.42);
    }
    // creases behind the knees and at the hips
    col *= 1.0 - 0.1 * smoothstep(0.03, 0.0, abs(p.y - ${gl(JOINTS.knee[1])})) * step(p.z, 0.0);
    if (jeans) {
      // denim: a fine twill, the side seam, worn knees and thighs
      float tw = fract((p.x * 0.7 + p.y) * 320.0);
      col *= 0.93 + 0.12 * smoothstep(0.3, 0.7, tw) * fine;
      float lx = sign(p.x) * ${gl(JOINTS.hip[0])};
      if (abs(p.z) < 0.004 && (p.x - lx) * sign(p.x) > 0.03 && p.y < 0.95) col *= 1.35;
      if (p.z > 0.02 && p.y > 0.42 && p.y < 0.85) col *= 1.0 + 0.22 * (1.0 - smoothstep(0.0, 0.09, abs(p.y - ${gl(JOINTS.knee[1])}))) + 0.12 * smoothstep(0.62, 0.8, p.y);
    }
  }
  else if (m > 1.5 && m < 2.5) {
    col = skin;
    crowdRough = mix(0.55, 0.3, uSweat);
    // a little life in the skin: warmer over the knuckles, knees and elbows, a soft mottle
    col *= 0.975 + 0.05 * sin(p.x * 91.0 + p.y * 57.0) * sin(p.y * 73.0 - p.z * 61.0) * fine;
    if (vBone > 8.5 && p.y > ${gl(NECK_BASE + 0.03)}) {
      // the face (real eyes are modelled: these are the brows, the lips, the colour of the cheeks and nose, facial hair)
      vec3 hairDark = hair * 0.7 + vec3(0.004);
      // brows: thicker and straighter on men, arched and finer on women
      float bx = (ax - ${gl(EYE[0] + 0.002)}) / 0.024;
      float by = ${gl(EYE[1] + 0.02)} + mix(0.003, 0.006, woman) * (1.0 - bx * bx) - 0.002 * bx;
      float bth = mix(0.0036, 0.0024, woman) * (1.0 - 0.55 * smoothstep(-0.2, 1.0, bx));
      float brow = (1.0 - smoothstep(0.75, 1.05, abs(bx))) * (1.0 - smoothstep(bth * 0.6, bth + aa, abs(p.y - by))) * step(0.08, p.z);
      // drawn in hairs, denser at the start than the tail
      brow *= 1.0 - 0.3 * crowdHash(floor(vec2(p.x * 2500.0, p.y * 700.0))) * fine;
      col = mix(col, hairDark, brow * mix(0.8, 0.55, smoothstep(-0.5, 1.0, bx)));
      // the eyes' surround: a soft shade in the socket and the crease, the lash line at the lid's edge
      vec2 ed = vec2(ax - ${gl(EYE[0])}, p.y - ${gl(EYE[1])});
      float er = length(ed / vec2(0.0165, 0.0095));
      col *= 1.0 - 0.1 * (1.0 - smoothstep(0.9, 1.9, er));
      float lash = (1.0 - smoothstep(0.08, 0.2 + aa * 60.0, abs(er - 1.02))) * step(-0.001, ed.y) * step(0.1, p.z);
      col = mix(col, vec3(0.02, 0.015, 0.012), lash * mix(0.55, 0.85, woman));
      // makeup on some: eyeliner and a shadow on the lid
      float mk = fract(vSeed.z * 17.3);
      if (woman > 0.5 && mk < 0.45) col = mix(col, mix(col * 0.6, vec3(0.25, 0.12, 0.2), 0.3), (1.0 - smoothstep(1.1, 1.7, er)) * step(0.0, ed.y) * 0.5);
      // lips: the upper's bow and the fuller lower lip, darker and rosier than the skin; lipstick on some
      vec2 ld = vec2(p.x / 0.024, p.y - ${gl(MOUTH[1])});
      float lw = max(0.0, 1.0 - ld.x * ld.x);
      float up = 0.0075 * sqrt(lw) * (1.0 - 0.25 * exp(-ld.x * ld.x * 40.0));
      float lo = 0.0095 * sqrt(lw);
      float lips = (1.0 - smoothstep(-aa, aa, ld.y - up)) * smoothstep(-aa, aa, ld.y + lo) * step(${gl(MOUTH[2] - 0.03)}, p.z);
      vec3 lipCol = mix(skin * vec3(0.86, 0.6, 0.6), skin * vec3(0.72, 0.58, 0.62), smoothstep(0.5, 0.9, tone));
      if (woman > 0.5 && mk > 0.6) lipCol = mk > 0.85 ? vec3(0.35, 0.03, 0.05) : mk > 0.72 ? vec3(0.42, 0.12, 0.15) : skin * vec3(0.9, 0.62, 0.6);
      col = mix(col, lipCol, lips * 0.9);
      col *= 1.0 - 0.45 * (1.0 - smoothstep(0.0006, 0.0014 + aa, abs(ld.y))) * step(abs(ld.x), 1.0) * step(${gl(MOUTH[2] - 0.02)}, p.z);
      // colour in the cheeks, nose and ears (shows more on fair skin)
      float rosy = (1.0 - smoothstep(0.35, 0.8, tone)) * 0.5;
      vec2 cq = vec2(ax - 0.045, p.y - ${gl(EYE[1] - 0.04)});
      col = mix(col, col * vec3(1.12, 0.9, 0.88), rosy * exp(-dot(cq, cq) / 0.0005) * step(0.06, p.z));
      vec2 nq = vec2(p.x, p.y - ${gl(NOSE[1])});
      col = mix(col, col * vec3(1.1, 0.92, 0.9), rosy * exp(-dot(nq, nq) / 0.0002) * step(0.14, p.z));
      if (ax > 0.07 && p.z < 0.06) col *= mix(vec3(1.0), vec3(1.06, 0.93, 0.92), rosy);
      // facial hair: stubble or a beard, from the cheekbones down round the jaw, the upper lip
      if (vLook.z > 0.5) {
        float side = smoothstep(0.015, 0.05, ax);
        float topY = mix(${gl(NOSE[1] - 0.02)}, ${gl(EYE[1] - 0.045)}, side);
        float bot = ${gl(CHIN[1] - 0.03)} + 0.02 * smoothstep(0.03, 0.07, ax);
        float zMin = mix(0.1, 0.0, side);
        float bm = smoothstep(topY, topY - 0.008, p.y) * smoothstep(bot - 0.01, bot + 0.01, p.y) * smoothstep(zMin - 0.01, zMin + 0.01, p.z) * (1.0 - lips);
        float grain = crowdHash(floor(p.xy * 900.0) + floor(p.z * 900.0));
        if (vLook.z > 1.5) {
          col = mix(col, hairDark * (0.75 + 0.5 * grain * fine), bm * 0.92);
          crowdRough = mix(crowdRough, 0.85, bm);
        } else col = mix(col, mix(col * 0.72, hairDark, 0.25), bm * (0.55 + 0.3 * grain * fine));
      }
    }
  }
  else if (m > 2.5 && m < 3.5) {
    // the hair over the scalp: its line by style, thinning to the skin at its edge
    float st = vLook.x;
    float a = abs(atan(p.x, p.z - 0.035)) / 3.14159;
    float recede = woman < 0.5 ? smoothstep(0.6, 1.0, fract(vSeed.x * 7.3)) : 0.0;
    float front = ${gl(EYE[1] + 0.062)} + 0.012 * recede * smoothstep(0.03, 0.14, a);
    if (st > 2.5 && st < 3.5) front = ${gl(EYE[1] + 0.036)} + 0.025 * smoothstep(0.06, 0.2, a) + 0.005 * abs(sin(p.x * 160.0 + vSeed.x * 9.0));
    if (st > 3.5 && st < 4.5) front += 0.006;
    float temple = ${gl(EYE[1] + 0.03)};
    float sideY = st < 2.5 ? ${gl(EYE[1] + 0.026)} : ${gl(EYE[1] + 0.014)};
    float back = st < 2.5 ? ${gl(EYE[1] - 0.07)} : ${gl(EYE[1] - 0.105)};
    float line = a < 0.22 ? mix(front, temple, smoothstep(0.1, 0.22, a)) : a < 0.5 ? mix(temple, sideY, smoothstep(0.22, 0.5, a)) : mix(sideY, back, smoothstep(0.5, 0.85, a));
    if (p.y < line) discard;
    // a soft edge: wider where it's cut short (a fade at the sides and back)
    float edge = smoothstep(line, line + mix(0.012, 0.035, step(a, 0.9) * step(0.25, a) * step(st, 2.5)), p.y);
    float bare = st < 1.5 ? 0.55 : st < 2.5 ? 0.2 : 0.0;
    col = mix(mix(skin * 0.9, hair, 0.5), hair, edge * (1.0 - bare));
    crowdRough = mix(0.5, 0.7, bare);
  }
  else if (m > 3.5 && m < 4.5) {
    col = shoes;
    crowdRough = 0.55;
    float sx = ax - ${gl(SHOE.x)};
    float t = (p.z - ${gl(SHOE.z0)}) / ${gl(SHOE.z1 - SHOE.z0)};
    // a white or black sole and toe bumper, laces over the top, a stripe down the side of some, a padded collar
    float soleCol = fract(vSeed.x * 23.1) < 0.7 ? 0.86 : 0.04;
    if (p.y < 0.016 || (t > 0.9 && p.y < 0.035)) { col = vec3(soleCol); crowdRough = 0.8; }
    else if (p.y > 0.098) col *= 0.4;
    else if (t > 0.45 && t < 0.82 && abs(sx) < 0.017 && p.y > 0.045) col = mix(col, vec3(0.9), step(0.5, fract(p.z * 110.0)) * 0.8);
    else if (abs(sx) > 0.03 && p.y > 0.024 && p.y < 0.05 && t > 0.3 && t < 0.75 && fract(vSeed.z * 7.7) > 0.5) col = mix(top, vec3(0.9), step(0.5, fract(p.y * 95.0)));
  }
  else if (m > 4.5 && m < 5.5) {
    // a sleeve: the top's colour, a hem
    col = top * (p.y < sleeveEnd + 0.014 ? 0.8 : 1.0);
    crowdRough = 0.88;
  }
  else if (m > 6.5 && m < 7.5) { col = fract(vSeed.w * 5.1) < 0.5 ? vec3(0.6, 0.05, 0.04) : vec3(0.72, 0.74, 0.78); crowdRough = 0.4; }
  else if (m > 7.5 && m < 8.5) { col = vec3(0.02); crowdRough = 0.35; }
  else if (m > 8.5 && m < 9.5) { col = vec3(0.0); glow = vec3(0.55, 0.64, 0.85) * 1.05; }
  else if (m > 9.5 && m < 10.5) {
    col = vec3(0.02);
    glow = vec3(2.2) * step(0.6, fract(vSeed.y * 7.0));
    // lights up: every phone's torch on, warm
    glow = max(glow, vec3(3.2, 2.9, 2.4) * uLights);
    // taking photos after the drop: each phone fires its flash now and then
    if (uPhotos > 0.001) glow += vec3(16.0) * step(1.0 - 0.06 * uPhotos, crowdHash(vec2(vSeed.x * 113.0, floor(uTime * 9.0 + vSeed.z * 9.0))));
  }
  else if (m > 10.5 && m < 11.5) col = vCard > 0.5 ? vec3(0.42, 0.3, 0.18) : vec3(0.02);
  else if (m > 12.5 && m < 13.5) col = fract(vSeed.y * 3.7) < 0.5 ? vec3(0.85, 0.85, 0.82) : top * 1.2;
  else if (m > 13.5 && m < 14.5) {
    // long hair: cut to length (a bob at the jaw, longer to the shoulder blades), the ends uneven
    float st = vLook.x;
    float cut = st > 6.5 && st < 7.5 ? ${gl(CHIN[1] - 0.005)} : ${gl(EYE[1] - 0.3)} - 0.08 * fract(vSeed.w * 11.1);
    cut += 0.012 * sin(atan(p.x, p.z) * 9.0 + vSeed.x * 6.0);
    if (p.y < cut) discard;
    col = hair;
    crowdRough = 0.45;
  }
  else if (m > 14.5 && m < 15.5) { col = bottoms; crowdRough = 0.84; }
  else if (m > 15.5 && m < 16.5) { float cv = fract(vSeed.x * 9.7); col = cv < 0.45 ? vec3(0.025) : cv < 0.8 ? top * 0.85 : vec3(0.5, 0.46, 0.38); crowdRough = 0.7; }
  else if (m > 16.5 && m < 17.5) { col = hair; crowdRough = 0.48; }
  else if (m > 17.5 && m < 18.5) {
    // the eye: a wet white, shaded under the lids; the iris (brown for most, hazel, green, blue or grey on fairer skin) with a darker rim; the pupil; a catch light
    vec3 ec = vec3(${gl(EYE[0])} * sign(p.x), ${gl(EYE[1])}, ${gl(EYE[2])});
    vec3 d = p - ec;
    float r = length(d.xy);
    float iv = vLook.w + step(0.3, tone) * 2.0;
    vec3 irisC = iv < 0.5 || iv > 1.0 ? vec3(0.09, 0.04, 0.015) : iv < 0.68 ? vec3(0.16, 0.09, 0.03) : iv < 0.8 ? vec3(0.1, 0.16, 0.08) : iv < 0.93 ? vec3(0.1, 0.2, 0.32) : vec3(0.2, 0.22, 0.24);
    col = vec3(0.7, 0.66, 0.62);
    col *= 1.0 - 0.5 * smoothstep(0.004, 0.0095, abs(d.y)) - 0.25 * smoothstep(0.0, 0.006, d.y);
    if (d.z > 0.0) {
      col = mix(col, irisC * 0.5, 1.0 - smoothstep(0.0063 - aa, 0.0063 + aa, r));
      col = mix(col, irisC * (0.8 + 0.4 * sin(atan(d.y, d.x) * 13.0) * fine), 1.0 - smoothstep(0.0055 - aa, 0.0055 + aa, r));
      col = mix(col, vec3(0.005), 1.0 - smoothstep(0.0024 - aa, 0.0024 + aa, r));
      col = mix(col, vec3(1.1), (1.0 - smoothstep(0.0011, 0.0011 + aa, length(d.xy - vec2(-0.0022, 0.0022)))) * fine);
    }
    crowdRough = 0.08;
  }
  else if (m > 27.5 && m < 29.5 || m > 32.5) {
    // curls or an afro, a bun, a ponytail
    if (m < 28.5) {
      // the afro's line at the forehead and round the ears
      float a = abs(atan(p.x, p.z - 0.035)) / 3.14159;
      if (p.y < mix(${gl(EYE[1] + 0.058)}, ${gl(EYE[1] - 0.09)}, smoothstep(0.2, 0.7, a))) discard;
      col = hair * (0.75 + 0.45 * crowdHash(floor(p.xz * 300.0) + floor(p.y * 300.0)) * fine);
    } else col = hair;
    crowdRough = 0.55;
  }
  else if (m > 11.5 && vCard > 0.5) {
    // a cardboard sign, marker pen on brown board: lit by the room, with a touch of its own so it reads in the dark
    vec3 t = texture2D(uCards, vec2(vUv2.x, (vSignRow + vUv2.y) / 8.0)).rgb;
    col = t;
    crowdRough = 0.95;
    glow = t * 0.16;
  }
  else if (m > 11.5 && m < 12.5) {
    vec3 t = texture2D(uSigns, vec2(vUv2.x, (vSignRow + vUv2.y) / 8.0)).rgb;
    vec2 cell = fract(vUv2 * vec2(80.0, 20.0)) - 0.5;
    float led = smoothstep(0.5, 0.22, length(cell));
    col = vec3(0.0);
    glow = t * (0.25 + led * 1.6) * uSignGlow;
  }
  // hair: strands that flow back over the crown and down the length, a sheen across them
  if ((m > 2.5 && m < 3.5) || (m > 13.5 && m < 14.5) || (m > 16.5 && m < 17.5) || (m > 28.5 && m < 29.5) || m > 32.5) {
    float ang = atan(p.x, p.z - 0.035);
    float strand = sin(ang * 70.0 + p.y * 30.0 + vSeed.x * 20.0) * 0.6 + sin(ang * 31.0 - p.y * 90.0) * 0.4;
    col *= 0.9 + 0.14 * strand * fine;
    float sh = (p.y - ${gl(LANDMARKS.headTop - 0.035)}) / 0.016;
    col *= 1.0 + 0.3 * exp(-sh * sh) * step(0.0, p.z - 0.02);
  }
  #ifdef CROWD_FRONT
  /*FRONT_FRAG*/
  #endif
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
  /** dancers in the detailed front row of a big enough crowd (frontrow.ts); set by the quality setting */
  static frontRow = 24;
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
    uStyle: { value: new THREE.Vector4(0.25, 0.25, 0.25, 0.25) },
    uCircle: { value: new THREE.Vector4(0, 0, 2.2, 0) },
    uCopy: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSit: { value: 0 },
    uLights: { value: 0 },
    uWild: { value: 0 },
    uCongaOn: { value: 0 },
    uBooth: { value: new THREE.Vector2(0, 0) },
    uConga: { value: Array.from({ length: CONGA }, () => new THREE.Vector2(999, 999)) },
    uCards: { value: null as THREE.Texture | null },
    uRim: { value: new THREE.Color(0, 0, 0) },
    uRimFrom: { value: new THREE.Vector3(0, 3.5, 1.5) },
    uOutfit: { value: 0 },
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
    // cardboard signs: a few people in the front rows (not the LED sign holders)
    const cardIdx = new Set<number>();
    const wantCards = o.cards ?? (n >= 24 ? Math.min(6, Math.round(n / 15)) : 0);
    if (wantCards > 0) {
      const front = spots
        .map((s, i) => ({ i, d: Math.hypot(s.x - booth.x, s.z - booth.z) }))
        .filter(({ i }) => !signIdx.has(i) && (spots[i].role ?? o.role ?? 'dancer') === 'dancer')
        .sort((a, b) => a.d - b.d)
        .slice(0, Math.max(wantCards * 3, 12));
      while (cardIdx.size < Math.min(wantCards, front.length)) cardIdx.add(front[Math.floor(r() * front.length)].i);
    }
    // the regulars: picked from the dancers in the front half, the same faces at every venue
    const regular = new Map<number, CrowdRole>();
    const dancers = spots
      .map((s, i) => ({ i, d: Math.hypot(s.x - booth.x, s.z - booth.z) }))
      .filter(({ i }) => !signIdx.has(i) && !cardIdx.has(i) && (spots[i].role ?? o.role ?? 'dancer') === 'dancer')
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
    // the cardboard signs nearest the booth are the regulars' (rows 0-2, in their shirts)
    const cardOrder = [...cardIdx].sort((a, b) => Math.hypot(spots[a].x - booth.x, spots[a].z - booth.z) - Math.hypot(spots[b].x - booth.x, spots[b].z - booth.z));
    const cardRowOf = new Map<number, number>();
    const shirt = new Map<number, THREE.Color>();
    cardOrder.forEach((i, k) => {
      cardRowOf.set(i, k % 8);
      const fan = crowdShow.front[k];
      if (k < 3 && fan) shirt.set(i, new THREE.Color(fan));
    });
    spots.forEach((s, i) => {
      const role: CrowdRole = signIdx.has(i) ? 'sign' : cardIdx.has(i) ? 'card' : (regular.get(i) ?? s.role ?? o.role ?? 'dancer');
      const code = ROLE_CODE[role];
      const drinks = o.drinks ?? (role === 'vip' ? 0.75 : 0.1);
      const phones = role === 'vip' ? Math.max(0.3, o.phones ?? 0) : (o.phones ?? 0);
      info[i * 4] = code;
      const hands = role !== 'dj' && role !== 'sign' && role !== 'security' && role !== 'bartender' && role !== 'rider' && role !== 'towel';
      info[i * 4 + 1] = role === 'filmer' || (hands && role !== 'marathon' && r() < phones) ? 1 : 0;
      info[i * 4 + 2] = role === 'sign' ? signRow++ % SIGNS.length : role === 'card' ? (cardRowOf.get(i) ?? 0) : 0;
      info[i * 4 + 3] = role === 'barlean' || (hands && role !== 'marathon' && role !== 'filmer' && r() < drinks) ? 1 : 0;
    });

    n = spots.length;
    this.u.uSigns.value = signIdx.size ? signAtlas() : null;
    this.u.uCards.value = cardIdx.size ? cardAtlas() : null;
    this.hasCards = cardIdx.size > 0;
    this.u.uBooth.value.set(booth.x, booth.z);
    this.spots = spots;
    this.infoRole = info.filter((_, k) => k % 4 === 0);
    this.u.uOutfit.value = LOOK_CODE[o.look ?? 'club'];
    // one material for the crowd, one for the front row: the same shader, the front row's parts switched in
    const makeMat = (front: boolean) => {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
      if (front) m.defines = { CROWD_FRONT: '' };
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.u);
        const common = front ? FRONT_COMMON : '';
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>\n${common}${front ? VERT_HEAD.replace('/*FRONT_VIS*/', FRONT_VIS) : VERT_HEAD}`)
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\ncomputePose();\nbodyPos = position;\n${HAIR_VOLUME}\nmorphBody(bodyPos, objectNormal);\nobjectNormal = poseR * objectNormal;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed = poseR * bodyPos + poseT;\nvMat = aMat;\nvSeed = iSeed;\nvUv2 = uv;\nvSignRow = iInfo.z;\nvRest = position;\nvBone = aBone;${front ? '\nvMouth = poseMouth;\nvFilm = poseFilm;' : ''}`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\n${FRAG_HEAD}${common}`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n${front ? FRAG_COLOR.replace('/*FRONT_FRAG*/', frontFrag()) : FRAG_COLOR}`)
          // sweat: skin goes glossy over a long peak
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = crowdRough;`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_RIM}${front ? FRONT_LIGHT : ''}`);
      };
      m.customProgramCacheKey = () => (front ? 'crowd-front' : 'crowd');
      if (o.lightMap) useLightMap(m, o.lightMap, 0.9);
      return m;
    };
    const mat = makeMat(false);

    // per-person placement (facing, scale, clothes), then grouped into chunks
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const body: number[] = [];
    spots.forEach((s, i) => {
      let face = s.face ?? Math.atan2(booth.x - s.x, booth.z - s.z);
      // some dancers turn to their friends instead of the booth
      if (s.face === undefined && info[i * 4] === 0 && r() < 0.1) face += (r() < 0.5 ? -1 : 1) * (1.1 + r() * 0.6);
      // who they are: a woman or a man, their build, ancestry and skin tone (from the person's seed, so the picks above don't shift)
      const who = crowdPerson(seeds.slice(i * 4, i * 4 + 4));
      body.push(...who.body);
      // their height (a rider is a little smaller)
      const tall = r();
      const sc = s.scale ?? (s.role === 'rider' ? 0.85 : who.height(tall) / 1.75);
      q.setFromAxisAngle(yAxis, face);
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y ?? 0, s.z), q, new THREE.Vector3(sc, sc, sc)));
      const c = clothes[Math.floor(r() * clothes.length)];
      cols.push(shirt.get(i) ?? c);
    });
    // the front row: the dancers nearest the booth (the barrier counts for more than the sides), drawn in detail
    const isDancer = (i: number) => [0, 1, 4, 5, 6, 12].includes(info[i * 4]);
    const nDancers = spots.reduce((k, _, i) => k + (isDancer(i) ? 1 : 0), 0);
    const wantFront = Math.min(o.frontRow ?? (nDancers >= 30 ? Crowd.frontRow : 0), nDancers);
    const front = new Set(
      spots
        .map((s, i) => ({ i, d: Math.hypot((s.x - booth.x) * 0.6, s.z - booth.z) }))
        .filter(({ i }) => isDancer(i))
        .sort((a, b) => a.d - b.d)
        .slice(0, wantFront)
        .map(({ i }) => i),
    );
    const cells = new Map<string, number[]>();
    spots.forEach((s, i) => {
      const key = front.has(i) ? 'front' : `${Math.floor(s.x / CHUNK)},${Math.floor(s.z / CHUNK)},${Math.round((s.y ?? 0) / 2)}`;
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      list.push(i);
    });
    const hi = personGeometry(0);
    const lo = personGeometry(1);
    const frontMat = front.size ? makeMat(true) : null;
    for (const [key, idx] of cells) {
      const isFront = key === 'front';
      const k = idx.length;
      const cs = new Float32Array(k * 4);
      const ci = new Float32Array(k * 4);
      const cb = new Float32Array(k * 4);
      idx.forEach((i, j) => {
        cs.set(seeds.slice(i * 4, i * 4 + 4), j * 4);
        ci.set(info.slice(i * 4, i * 4 + 4), j * 4);
        cb.set(body.slice(i * 4, i * 4 + 4), j * 4);
      });
      const inst = { iSeed: new THREE.InstancedBufferAttribute(cs, 4), iInfo: new THREE.InstancedBufferAttribute(ci, 4), iBody: new THREE.InstancedBufferAttribute(cb, 4) };
      // the front row: the detailed model up close, the crowd's low-detail one from far away
      const geos: [THREE.BufferGeometry, THREE.BufferGeometry] = [chunkGeometry(isFront ? frontGeometry() : hi, inst), chunkGeometry(lo, inst)];
      const mesh = new THREE.InstancedMesh(geos[0], isFront ? frontMat! : mat, k);
      idx.forEach((i, j) => {
        mesh.setMatrixAt(j, mats[i]);
        mesh.setColorAt(j, cols[i]);
        this.where[i] = { chunk: this.chunks.length, j, info: inst.iInfo };
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
      this.shadowMesh = sh;
    }
    this.steamGain = o.steam ?? (n >= 40 ? 1 : 0);
    if (this.steamGain > 0 && n) {
      this.steam = new CrowdSteam(spots.filter((s) => (s.role ?? o.role ?? 'dancer') !== 'dj'), Math.min(260, Math.round(n * 0.8)), (o.seed ?? 11) + 5);
      this.object.add(this.steam.object);
    }
  }

  /* crowd moments */
  private spots: CrowdSpot[] = [];
  private infoRole: number[] = [];
  private where: { chunk: number; j: number; info: THREE.InstancedBufferAttribute }[] = [];
  private shadowMesh: THREE.InstancedMesh | null = null;
  private hasCards = false;
  private circleOn = false;
  private conga: { idx: number[]; home: THREE.Matrix4[]; s: number; path: THREE.Vector2[]; lens: number[]; total: number } | null = null;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();

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

  /** the genre's dance style, the crowd moments, your moves copied, the cardboard signs (crowdShow) */
  private moments(dt: number): void {
    const u = this.u;
    const cs = crowdShow;
    u.uStyle.value.set(cs.style[0], cs.style[1], cs.style[2], cs.style[3]);
    u.uSit.value += (cs.sitK() - u.uSit.value) * Math.min(1, dt * 3);
    u.uLights.value = cs.momentK('lighters');
    // up from the sit-down on the drop: everyone jumping together
    const sj = cs.sitJumpK();
    if (sj > 0) {
      this.jump = Math.max(this.jump, sj);
      u.uJump.value = this.jump;
      u.uSync.value = Math.max(u.uSync.value, sj);
    }
    // your moves, copied
    const cw = cs.copyWeights();
    if (cw.hands > 0) u.uCheer.value = Math.max(u.uCheer.value, cw.hands * 0.9);
    if (cw.clap > 0) u.uClap.value = Math.max(u.uClap.value, cw.clap);
    if (cw.jump > 0) {
      u.uJump.value = Math.max(u.uJump.value, cw.jump * 0.8);
      u.uSync.value = Math.max(u.uSync.value, cw.jump);
    }
    u.uCopy.value.set(cw.point, cw.pump, cs.copy?.all ? 1 : 0, 0);
    u.uWild.value = cs.wild;
    if (this.hasCards) drawCards();
    // the dance circle
    const ck = this.spots.length >= 30 ? cs.momentK('circle') : 0;
    if (ck > 0 && !this.circleOn) this.circleOn = this.pickCircle();
    if (ck === 0) this.circleOn = false;
    u.uCircle.value.w = this.circleOn ? ck : 0;
    // the conga line
    const gk = this.spots.length >= 30 ? cs.momentK('conga') : 0;
    if (gk > 0 && !this.conga) this.startConga();
    if (this.conga) {
      if (gk > 0) this.stepConga(dt, gk);
      else this.endConga();
    }
    u.uCongaOn.value = this.conga ? gk : 0;
  }

  /** the dancers' middle: where the floor's centre is */
  private dancerCentre(): THREE.Vector2 {
    const c = new THREE.Vector2();
    let n = 0;
    this.spots.forEach((sp, i) => {
      if (this.infoRole[i] !== 0) return;
      c.x += sp.x;
      c.y += sp.z;
      n++;
    });
    return n ? c.divideScalar(n) : c;
  }

  /** the soloist: the dancer nearest a spot a few metres out from the booth */
  private pickCircle(): boolean {
    const b = this.u.uBooth.value;
    const c = this.dancerCentre();
    const dir = c.clone().sub(b);
    const len = dir.length();
    if (len < 0.5) return false;
    const want = b.clone().add(dir.multiplyScalar(Math.min(4.5, len * 0.8) / len));
    let best = -1;
    let bd = 1e9;
    this.spots.forEach((sp, i) => {
      if (this.infoRole[i] !== 0) return;
      const d = Math.hypot(sp.x - want.x, sp.z - want.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) return false;
    this.u.uCircle.value.set(this.spots[best].x, this.spots[best].z, 2.0, 0);
    return true;
  }

  /** ten dancers from near the front set off round the floor, an ellipse round the middle of the crowd */
  private startConga(): void {
    const c = this.dancerCentre();
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    this.spots.forEach((sp, i) => {
      if (this.infoRole[i] !== 0) return;
      x0 = Math.min(x0, sp.x);
      x1 = Math.max(x1, sp.x);
      z0 = Math.min(z0, sp.z);
      z1 = Math.max(z1, sp.z);
    });
    const rx = Math.min(6, Math.max(1.5, (x1 - x0) / 2 - 1));
    const rz = Math.min(4.5, Math.max(1.2, (z1 - z0) / 2 - 1));
    const path: THREE.Vector2[] = [];
    for (let k = 0; k <= 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      path.push(new THREE.Vector2(c.x + Math.cos(a) * rx, c.y + Math.sin(a) * rz));
    }
    const lens = [0];
    for (let k = 1; k < path.length; k++) lens.push(lens[k - 1] + path[k].distanceTo(path[k - 1]));
    // the dancers nearest the path's start join first
    const start = path[0];
    const gone = new Set(this.leave ? this.leave.order.slice(0, this.leave.left) : []);
    const idx = this.spots
      .map((sp, i) => ({ i, d: Math.hypot(sp.x - start.x, sp.z - start.y) }))
      .filter(({ i }) => this.infoRole[i] === 0 && !gone.has(i))
      .sort((a, b) => a.d - b.d)
      .slice(0, CONGA)
      .map(({ i }) => i);
    if (idx.length < 4) return;
    const home = idx.map((i) => {
      const w = this.where[i];
      const m = new THREE.Matrix4();
      this.chunks[w.chunk].mesh.getMatrixAt(w.j, m);
      return m;
    });
    for (const i of idx) this.setRole(i, ROLE_CODE.conga);
    this.conga = { idx, home, s: 0, path, lens, total: lens[lens.length - 1] };
  }

  /** a festival clash: people drift off to the other stage (the back first) and come back */
  private leave: { order: number[]; home: THREE.Matrix4[]; left: number } | null = null;
  private thin(): void {
    const share = crowdShow.share;
    if (this.conga || !this.where.length) return;
    if (!this.leave) {
      if (share >= 0.999) return;
      const b = this.u.uBooth.value;
      const m = new THREE.Matrix4();
      const v = new THREE.Vector3();
      const r = rng(4242);
      const cand: { i: number; d: number; m: THREE.Matrix4 }[] = [];
      this.where.forEach((w, i) => {
        if (this.infoRole[i] !== 0) return;
        this.chunks[w.chunk].mesh.getMatrixAt(w.j, m);
        v.setFromMatrixPosition(m);
        cand.push({ i, d: Math.hypot(v.x - b.x, v.z - b.y) + r() * 6, m: m.clone() });
      });
      cand.sort((a, c) => c.d - a.d);
      this.leave = { order: cand.map((c) => c.i), home: cand.map((c) => c.m), left: 0 };
    }
    const L = this.leave;
    const want = Math.round((1 - Math.max(0, Math.min(1, share))) * L.order.length);
    if (want === L.left || (Math.abs(want - L.left) < Math.max(2, L.order.length * 0.015) && want !== 0)) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const touched = new Set<number>();
    const set = (k: number, mm: THREE.Matrix4) => {
      const i = L.order[k];
      const w = this.where[i];
      this.chunks[w.chunk].mesh.setMatrixAt(w.j, mm);
      touched.add(w.chunk);
      this.shadowMesh?.setMatrixAt(i, mm);
    };
    if (want > L.left) for (let k = L.left; k < want; k++) set(k, zero);
    else for (let k = want; k < L.left; k++) set(k, L.home[k]);
    L.left = want;
    for (const c of touched) this.chunks[c].mesh.instanceMatrix.needsUpdate = true;
    if (this.shadowMesh) this.shadowMesh.instanceMatrix.needsUpdate = true;
  }

  private setRole(i: number, code: number): void {
    const w = this.where[i];
    w.info.setX(w.j, code);
    w.info.needsUpdate = true;
    const mesh = this.chunks[w.chunk].mesh;
    // people walk out of their chunk's bounds: never cull a chunk with a conga dancer in it
    mesh.frustumCulled = code !== ROLE_CODE.conga ? mesh.frustumCulled : false;
  }

  private pointOn(sAt: number, out: THREE.Vector2): THREE.Vector2 {
    const g = this.conga!;
    const t = ((sAt % g.total) + g.total) % g.total;
    let k = 1;
    while (k < g.lens.length - 1 && g.lens[k] < t) k++;
    const f = (t - g.lens[k - 1]) / Math.max(1e-6, g.lens[k] - g.lens[k - 1]);
    return out.copy(g.path[k - 1]).lerp(g.path[k], f);
  }

  private stepConga(dt: number, k: number): void {
    const g = this.conga!;
    g.s += dt * 0.85;
    const p = new THREE.Vector2();
    const ahead = new THREE.Vector2();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const touched = new Set<number>();
    g.idx.forEach((i, n) => {
      const at = g.s - n * 0.78;
      this.pointOn(at, p);
      this.pointOn(at + 0.2, ahead);
      const face = Math.atan2(ahead.x - p.x, ahead.y - p.y);
      g.home[n].decompose(this.tmpV, this.tmpQ, this.tmpS);
      // walk out from where they were dancing, and back at the end
      const hx = this.tmpV.x;
      const hz = this.tmpV.z;
      const x = hx + (p.x - hx) * k;
      const z = hz + (p.y - hz) * k;
      const homeFace = new THREE.Euler().setFromQuaternion(this.tmpQ, 'YXZ').y;
      let dFace = face - homeFace;
      dFace = ((dFace + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.tmpQ.setFromAxisAngle(yAxis, homeFace + dFace * k);
      this.tmpV.set(x, this.tmpV.y, z);
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
      const w = this.where[i];
      this.chunks[w.chunk].mesh.setMatrixAt(w.j, this.tmpM);
      touched.add(w.chunk);
      this.shadowMesh?.setMatrixAt(i, this.tmpM);
      (this.u.uConga.value[n] as THREE.Vector2).set(x, z);
    });
    for (const c of touched) this.chunks[c].mesh.instanceMatrix.needsUpdate = true;
    if (this.shadowMesh) this.shadowMesh.instanceMatrix.needsUpdate = true;
  }

  private endConga(): void {
    const g = this.conga!;
    g.idx.forEach((i, n) => {
      const w = this.where[i];
      const mesh = this.chunks[w.chunk].mesh;
      mesh.setMatrixAt(w.j, g.home[n]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = true;
      this.shadowMesh?.setMatrixAt(i, g.home[n]);
      this.setRole(i, this.infoRole[i]);
      (this.u.uConga.value[n] as THREE.Vector2).set(999, 999);
    });
    if (this.shadowMesh) this.shadowMesh.instanceMatrix.needsUpdate = true;
    this.conga = null;
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
    this.moments(dt);
    this.thin();
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
