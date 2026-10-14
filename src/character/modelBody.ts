/*
 * The modelled body (Section 14.2): character_dj_body_01, made in Blender
 * from the MakeHuman base mesh (CC0) through the MPFB add-on, rigged with the
 * game's bone names and carrying the body sliders as shape keys
 * (assets_source/blender/characters/character_dj_body_01.blend).
 *
 * The code-built skeleton in Avatar.ts still does all the moving: this module
 * copies it onto the model's bones every frame.
 *   rotations  each model bone turns with its game bone, keeping the angle it
 *              had at rest (both skeletons stand arms down, palms forward)
 *   positions  the limbs' joints sit where the game's are (so a hand lands on
 *              the control the arm reached for) and the limb bones stretch to
 *              the game's lengths; the spine, neck, shoulders and fingers keep
 *              the model's own proportions
 *   fingers    three joints each to the game's two: the tip curls with the
 *              middle joint
 *   palms      the model stands palms forward, the game's hand palms back
 *              (its fingers curl towards −Z): the model's hand and fingers
 *              are turned half a turn about the arm to match, and each
 *              forearm takes half the twist between its elbow and its hand
 *              (there's no twist bone), so neither joint wrings more than
 *              about a quarter turn
 *   regions    the mesh comes in skin regions (chest, neck, upper_arm_l…, as
 *              the game names the skin's parts). A region shows unless clothes
 *              cover it or it carries tattoos (tattoos are drawn for the
 *              code-built parts' UVs, so those parts stay code-built); a
 *              robot head hides the neck and chest, robot hands the hands
 * The head, hair and clothes are still code-built, except the robot DJ's
 * padded jacket and trousers, which are cut from the model itself (Suit).
 */
import * as THREE from 'three';
import type { Look } from '../core/models';
import { hasModel, loadModel } from '../three/assets';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ROBOT_HANDS, ROBOT_HEADS } from './catalog';
import { slider } from './look';

export const BODY_MODEL = 'character_dj_body_01';

/** the model's skin regions (its material names without the `skin_`) */
export const BODY_REGIONS = ['chest', 'neck', 'upper_arm_l', 'upper_arm_r', 'forearm_l', 'forearm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'] as const;
export type BodyRegion = (typeof BODY_REGIONS)[number];

type Sleeves = 'none' | 'short' | 'elbow' | 'long';

/** what a top or outer layer covers, from its sleeve length and whether it's cropped */
export interface Cover {
  sleeves: Sleeves;
  crop?: boolean;
}

/**
 * The regions the model shows for a look: everything long sleeves, trousers
 * and shoes don't cover and that carries no tattoos. The torso shows under
 * every top (tucked in a little, so the shell fits round it), which keeps the
 * neck, shoulders and armholes seamless; short sleeves and shorts leave the
 * model's arm and thigh showing under the shell.
 */
export function modelRegions(look: Look, top: Cover | null, outer: Cover | null): Set<BodyRegion> {
  const show = new Set<BodyRegion>(BODY_REGIONS);
  const hide = (r: BodyRegion) => show.delete(r);
  const sleeves = [top?.sleeves, outer?.sleeves];
  for (const s of ['l', 'r'] as const) {
    if (sleeves.some((x) => x === 'long' || x === 'elbow')) hide(`upper_arm_${s}`);
    if (sleeves.includes('long')) hide(`forearm_${s}`);
    const bottom = look.items.bottom;
    if (bottom && !bottom.startsWith('skirt')) {
      if (!bottom.startsWith('shorts')) hide(`thigh_${s}`);
      if (!bottom.startsWith('shorts')) hide(`calf_${s}`);
    }
    const shoe = look.items.shoes;
    if (shoe === 'gogo_boots') hide(`calf_${s}`);
    if (shoe && shoe !== 'slides') hide(`foot_${s}`);
  }
  // a robot head brings its own neck (and the code-built torso under it, so no
  // skin shows round the rubber neck); robot hands are code-built metal
  if (ROBOT_HEADS.has(look.items.head ?? '')) {
    hide('neck');
    hide('chest');
  }
  if (ROBOT_HANDS.has(look.items.wrists ?? '')) for (const s of ['l', 'r'] as const) hide(`hand_${s}`);
  // tattoos are painted for the code-built parts' UVs
  for (const t of look.tattoos) {
    const place = t.place;
    if ((BODY_REGIONS as readonly string[]).includes(place)) hide(place as BodyRegion);
  }
  return show;
}

/**
 * How far the body tucks in under clothes (the model's shape keys): the whole
 * torso under a top, just the chest under a crop top (the midriff shows), the
 * thighs' upper part under shorts.
 */
export function modelTuck(look: Look, top: Cover | null, outer: Cover | null): Tuck {
  const covered = !!outer || (!!top && !top.crop);
  return { tuck_torso: covered ? 1 : 0, tuck_chest: !covered && top ? 1 : 0, tuck_thighs: look.items.bottom?.startsWith('shorts') ? 1 : 0 };
}

export type Tuck = Record<'tuck_torso' | 'tuck_chest' | 'tuck_thighs', number>;

/* ------------------------------------------------------------------ */
/* the robot suit: clothes cut from the body itself                     */
/* ------------------------------------------------------------------ */

/**
 * The robot DJ's padded jacket and trousers aren't code-built shells: each
 * is the modelled body's own surface pushed out along its normals, so it has
 * the body's rounded shoulders, chest and arms like a sculpted game model: a
 * thick layer for the jacket, padded over the shoulders, creased at the
 * elbows and round the waist, a ribbed lip at the hem and the cuffs. Under
 * the hem the jacket sinks back inside the trousers (and above the waistband
 * the trousers inside the jacket), so the two layers meet without a gap.
 */
export interface Suit {
  jacket: THREE.Material | null;
  trousers: THREE.Material | null;
  trims: SuitTrims;
}

/** what the suit's trims are made of */
export interface SuitTrims {
  piping: THREE.Material;
  zip: THREE.Material;
  metal: THREE.Material;
}

/** where the jacket ends, above the hips (the model's rest heights, metres) */
const HEM = 0.93;
/** where the trousers end under the jacket */
const WAISTBAND = 1.02;
/** the body slider shape keys the suit wears: bulky in the shoulders and arms */
const SUIT_SHAPE: Record<string, number> = { body_weight: 0.8, muscle_definition: 0, chest: 0.4, shoulder_width: 1, arm_thickness: 1.4 };

const sm = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** the model's shoulder, elbow and wrist at rest (body space), for measuring along an arm */
const SHOULDER = (k: number) => new THREE.Vector3(k * 0.17, 1.33, 0.02);
const ELBOW = (k: number) => new THREE.Vector3(k * 0.17, 1.084, 0.02);
const WRIST = (k: number) => new THREE.Vector3(k * 0.17, 0.845, 0.02);
const _d = new THREE.Vector3();

/** how far out from the skin the jacket sits at a point on a region */
function jacketThickness(region: BodyRegion, p: THREE.Vector3): number {
  if (region === 'chest') {
    // padded over the shoulders and across the chest
    const sh = Math.exp(-_d.copy(p).sub(SHOULDER(Math.sign(p.x) || 1)).lengthSq() / (2 * 0.06 * 0.06));
    let t = 0.024 + 0.016 * sh + 0.004 * sm(1.05, 1.3, p.y);
    // cut straight and loose from the chest to the hem, not in at the waist
    t += 0.016 * Math.exp(-((p.y - 1.06) ** 2) / (2 * 0.07 * 0.07));
    // soft creases round the waist, where the jacket bunches above the hem
    const round = Math.atan2(p.x, p.z);
    t += 0.0035 * sm(1.1, 0.98, p.y) * Math.sin(p.y * 260 + Math.sin(round * 3) * 2.5);
    // the hem: a ribbed lip, then the jacket tucks away inside the trousers
    t += 0.005 * sm(HEM + 0.035, HEM + 0.015, p.y) * (1 + 0.4 * Math.sin(round * 40));
    return p.y > HEM ? t : -0.006 + (t + 0.006) * sm(HEM - 0.012, HEM, p.y);
  }
  // the sleeves: along the arm from the shoulder (0) to the wrist (1)
  const k = region.endsWith('_l') ? 1 : -1;
  const upper = region.startsWith('upper');
  const a = upper ? SHOULDER(k) : ELBOW(k);
  const b = upper ? ELBOW(k) : WRIST(k);
  const ab = b.clone().sub(a);
  const u = Math.max(0, Math.min(1, _d.copy(p).sub(a).dot(ab) / ab.lengthSq()));
  const along = upper ? u * 0.5 : 0.5 + u * 0.5;
  const sh = Math.exp(-_d.copy(p).sub(SHOULDER(k)).lengthSq() / (2 * 0.06 * 0.06));
  let t = 0.026 - 0.008 * along + 0.016 * sh;
  // creases where the sleeve bunches: rings round the arm, crowded at the elbow
  const len = along * 0.52;
  const atElbow = Math.exp(-((along - 0.5) ** 2) / (2 * 0.12 * 0.12));
  t += (0.0022 + 0.0042 * atElbow) * Math.sin(len * 190 + Math.sin(len * 40) * 2) * sm(0.08, 0.2, along);
  // the ribbed cuff at the wrist
  if (along > 0.92) {
    const w = WRIST(k);
    t = 0.014 + 0.002 * Math.sin(Math.atan2(p.x - w.x, p.z - w.z) * 14);
  }
  return t;
}

/** how far out the trousers sit */
function trouserThickness(region: BodyRegion, p: THREE.Vector3): number {
  if (region === 'chest') return p.y < WAISTBAND ? 0.02 : -0.008 + 0.028 * sm(WAISTBAND + 0.02, WAISTBAND, p.y);
  // a fold or two at the back of the knee, a little fuller over the boots
  const knee = Math.exp(-((p.y - 0.5) ** 2) / (2 * 0.04 * 0.04));
  // straight-legged trousers: fuller lower down, where the leg narrows
  return 0.02 + 0.012 * sm(0.55, 0.2, p.y) + 0.003 * knee * Math.sin(p.y * 220);
}

/**
 * A region's surface welded by position (glTF splits vertices along UV
 * seams) with its neighbours, and its open edges (where it meets the next
 * region), which stay put so the regions still meet.
 */
function welded(geo: THREE.BufferGeometry) {
  const index = geo.index!;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const weld = new Map<string, number>();
  const id = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const k = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
    if (!weld.has(k)) weld.set(k, weld.size);
    id[i] = weld.get(k)!;
  }
  const N = weld.size;
  const nbr: Set<number>[] = Array.from({ length: N }, () => new Set());
  const edges = new Map<number, number>();
  const faces: number[] = [];
  for (let f = 0; f < index.count; f += 3) {
    const t = [id[index.getX(f)], id[index.getX(f + 1)], id[index.getX(f + 2)]];
    faces.push(...t);
    for (let e = 0; e < 3; e++) {
      const a = t[e];
      const b = t[(e + 1) % 3];
      nbr[a].add(b);
      nbr[b].add(a);
      const ek = a < b ? a * N + b : b * N + a;
      edges.set(ek, (edges.get(ek) ?? 0) + 1);
    }
  }
  const fixed = new Uint8Array(N);
  for (const [ek, c] of edges) if (c === 1) fixed[Math.floor(ek / N)] = fixed[ek % N] = 1;
  const P = new Float32Array(N * 3);
  const n0 = new Float32Array(N * 3);
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < count; i++) {
    P.set([pos.getX(i), pos.getY(i), pos.getZ(i)], id[i] * 3);
    n0.set([nor.getX(i), nor.getY(i), nor.getZ(i)], id[i] * 3);
  }
  return { N, id, nbr, fixed, faces, P, n0 };
}

/** smooth the inside of a welded surface (Taubin: no shrinking), `n` pairs of passes */
function taubin(w: ReturnType<typeof welded>, n: number): void {
  const { N, nbr, fixed, P } = w;
  const Q = new Float32Array(N * 3);
  for (let pass = 0; pass < n * 2; pass++) {
    const f = pass % 2 ? -0.53 : 0.5;
    for (let v = 0; v < N; v++) {
      Q[v * 3] = P[v * 3];
      Q[v * 3 + 1] = P[v * 3 + 1];
      Q[v * 3 + 2] = P[v * 3 + 2];
      if (fixed[v] || !nbr[v].size) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const u of nbr[v]) {
        x += P[u * 3];
        y += P[u * 3 + 1];
        z += P[u * 3 + 2];
      }
      const k = 1 / nbr[v].size;
      Q[v * 3] += f * (x * k - P[v * 3]);
      Q[v * 3 + 1] += f * (y * k - P[v * 3 + 1]);
      Q[v * 3 + 2] += f * (z * k - P[v * 3 + 2]);
    }
    P.set(Q);
  }
}

/** smooth normals of a welded surface (the open edges keep the body's own, which the next region shares) */
function weldedNormals(w: ReturnType<typeof welded>): Float32Array {
  const { N, faces, P, fixed, n0 } = w;
  const out = new Float32Array(N * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let f = 0; f < faces.length; f += 3) {
    a.fromArray(P, faces[f] * 3);
    b.fromArray(P, faces[f + 1] * 3);
    c.fromArray(P, faces[f + 2] * 3);
    c.sub(b).cross(a.sub(b));
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) out[faces[f + k] * 3 + j] += [c.x, c.y, c.z][j];
  }
  for (let v = 0; v < N; v++) {
    if (fixed[v]) {
      out.set(n0.subarray(v * 3, v * 3 + 3), v * 3);
      continue;
    }
    a.fromArray(out, v * 3).normalize();
    out.set([a.x, a.y, a.z], v * 3);
  }
  return out;
}

/**
 * A copy of a region's skin on the same skeleton: smoothed (the cloth hides
 * the body's anatomy), then pushed out by `thick` along its normals.
 */
function garment(src: THREE.SkinnedMesh, region: BodyRegion, thick: (r: BodyRegion, p: THREE.Vector3) => number, mat: THREE.Material): THREE.SkinnedMesh {
  const geo = src.geometry.clone();
  // the suit's own build, baked in (the look's body sliders don't reach it)
  const pos0 = geo.attributes.position as THREE.BufferAttribute;
  for (const [key, i] of Object.entries(src.morphTargetDictionary ?? {})) {
    const delta = geo.morphAttributes.position?.[i];
    const k = SUIT_SHAPE[key] ?? 0;
    if (delta && k) for (let v = 0; v < pos0.count; v++) pos0.setXYZ(v, pos0.getX(v) + delta.getX(v) * k, pos0.getY(v) + delta.getY(v) * k, pos0.getZ(v) + delta.getZ(v) * k);
  }
  geo.morphAttributes = {};
  const w = welded(geo);
  taubin(w, region === 'chest' ? 30 : 10);
  const nrm = weldedNormals(w);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const out = new Float32Array(w.N * 3);
  for (let v = 0; v < w.N; v++) {
    p.fromArray(w.P, v * 3);
    n.fromArray(nrm, v * 3);
    p.addScaledVector(n, thick(region, p));
    out.set([p.x, p.y, p.z], v * 3);
  }
  w.P.set(out);
  const shade = weldedNormals(w);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const v = w.id[i] * 3;
    pos.setXYZ(i, out[v], out[v + 1], out[v + 2]);
    nor.setXYZ(i, shade[v], shade[v + 1], shade[v + 2]);
  }
  const m = new THREE.SkinnedMesh(geo, mat);
  m.name = `suit_${region}`;
  m.position.copy(src.position);
  m.quaternion.copy(src.quaternion);
  m.scale.copy(src.scale);
  m.bind(src.skeleton, src.bindMatrix);
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  src.parent?.add(m);
  return m;
}

/* ------------------------------------------------------------------ */
/* loading                                                              */
/* ------------------------------------------------------------------ */

let ready: { scene: THREE.Object3D } | null = null;
let loading: Promise<void> | null = null;

/** start loading the model (once); `then` runs when it's ready */
export function preloadBody(then?: () => void): void {
  if (!hasModel(BODY_MODEL)) return;
  if (ready) return;
  loading ??= loadModel(BODY_MODEL)
    .then((m) => void (ready = m))
    .catch((e) => console.warn('body model failed to load', e));
  if (then) void loading.then(() => ready && then());
}

/** true once the model can be used without waiting */
export function bodyReady(): boolean {
  return !!ready;
}

/* the suit's trims: raised piping, the zip, studs, laid on the cloth at rest and skinned to it */

/** a rest-pose copy of some garments, to lay trims on, and their skin to borrow */
class Cloth {
  private meshes: THREE.Mesh[];
  private ray = new THREE.Raycaster();
  private pos: Float32Array;
  private skinI: THREE.BufferAttribute[] = [];
  private skinW: THREE.BufferAttribute[] = [];
  private offsets: number[] = [];
  constructor(readonly parts: THREE.SkinnedMesh[]) {
    const geos = parts.map((m) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', m.geometry.attributes.position);
      g.setIndex(m.geometry.index);
      return g;
    });
    let n = 0;
    for (const m of parts) {
      this.offsets.push(n);
      n += m.geometry.attributes.position.count;
      this.skinI.push(m.geometry.attributes.skinIndex as THREE.BufferAttribute);
      this.skinW.push(m.geometry.attributes.skinWeight as THREE.BufferAttribute);
    }
    this.pos = new Float32Array(n * 3);
    parts.forEach((m, k) => this.pos.set((m.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array, this.offsets[k] * 3));
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.meshes = geos.map((g, k) => {
      const m = new THREE.Mesh(g, mat);
      m.name = parts[k].name;
      m.updateMatrixWorld(true);
      return m;
    });
  }

  /** where a ray from `from` heading `dir` first meets the cloth, and the cloth's normal there */
  hit(from: THREE.Vector3, dir: THREE.Vector3, on: RegExp): { p: THREE.Vector3; n: THREE.Vector3 } | null {
    this.ray.set(from, dir.clone().normalize());
    const h = this.ray.intersectObjects(this.meshes.filter((m) => on.test(m.name)), false)[0];
    if (!h || !h.face) return null;
    const n = h.face.normal.clone();
    if (n.dot(dir) > 0) n.negate();
    return { p: h.point, n };
  }

  /** skin a trim to the bones the nearest bit of cloth follows */
  skin(geo: THREE.BufferGeometry, on: RegExp): void {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const si = new Uint16Array(pos.count * 4);
    const sw = new Float32Array(pos.count * 4);
    const total = this.pos.length / 3;
    // only the cloth the trim was laid on (a hem passes close by the hanging hands)
    const use = new Uint8Array(total);
    this.parts.forEach((m, k) => {
      if (on.test(m.name)) use.fill(1, this.offsets[k], this.offsets[k] + m.geometry.attributes.position.count);
    });
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let best = 0;
      let bd = Infinity;
      for (let v = 0; v < total; v++) {
        if (!use[v]) continue;
        const dx = this.pos[v * 3] - x;
        const dy = this.pos[v * 3 + 1] - y;
        const dz = this.pos[v * 3 + 2] - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = v;
        }
      }
      let k = this.offsets.length - 1;
      while (this.offsets[k] > best) k--;
      const local = best - this.offsets[k];
      for (let j = 0; j < 4; j++) {
        si[i * 4 + j] = this.skinI[k].getComponent(local, j);
        sw[i * 4 + j] = this.skinW[k].getComponent(local, j);
      }
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }

  /** a trim, skinned and on the garments' skeleton */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, on: RegExp): THREE.SkinnedMesh {
    this.skin(geo, on);
    const src = this.parts[0];
    const m = new THREE.SkinnedMesh(geo, mat);
    m.position.copy(src.position);
    m.quaternion.copy(src.quaternion);
    m.scale.copy(src.scale);
    m.bind(src.skeleton, src.bindMatrix);
    m.castShadow = true;
    m.frustumCulled = false;
    src.parent?.add(m);
    return m;
  }

  /** a line along the cloth: each (point, inward direction) cast onto it, lifted by `lift` */
  line(path: [THREE.Vector3, THREE.Vector3][], lift: number, on: RegExp, closed = false): THREE.CatmullRomCurve3 | null {
    const pts: THREE.Vector3[] = [];
    for (const [at, inward] of path) {
      const h = this.hit(at.clone().addScaledVector(inward, -0.4), inward, on);
      if (h) pts.push(h.p.addScaledVector(h.n, lift));
    }
    // ease out the wobble the creases put in it (a little proud, so it doesn't sink into them)
    for (let pass = 0; pass < 2 && pts.length > 4; pass++) {
      const prev = pts.map((q) => q.clone());
      for (let i = 0; i < pts.length; i++) {
        if (!closed && (i === 0 || i === pts.length - 1)) continue;
        const a = prev[(i - 1 + pts.length) % pts.length];
        const b = prev[(i + 1) % pts.length];
        pts[i].copy(prev[i]).multiplyScalar(0.5).addScaledVector(a, 0.25).addScaledVector(b, 0.25);
      }
    }
    return pts.length > 1 ? new THREE.CatmullRomCurve3(pts, closed) : null;
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    (this.meshes[0]?.material as THREE.Material | undefined)?.dispose();
  }
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  const idx: number[] = [];
  const pos: number[] = [];
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + n);
    n += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

const TORSO = /chest/;
const ARMS = /chest|arm/;
const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);
const lerpV = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);

/** the jacket's trims: piping over the shoulders, down the sleeves, the chest panels and above the hem; the zip; ribbed cuffs */
function jacketTrims(cloth: Cloth, t: SuitTrims, out: THREE.Object3D[]): void {
  const R = 0.0032;
  const tube = (c: THREE.CatmullRomCurve3 | null, r: number, mat: THREE.Material, on: RegExp, closed = false) => {
    if (c) out.push(cloth.add(new THREE.TubeGeometry(c, Math.max(24, c.points.length * 3), r, 6, closed), mat, on));
  };
  for (const k of [1, -1]) {
    // over the shoulder from beside the collar, round the cap and down the outside of the sleeve to the cuff
    const path: [THREE.Vector3, THREE.Vector3][] = [];
    const collar = new THREE.Vector3(k * 0.075, 1.43, 0.0);
    const cap = SHOULDER(k).add(new THREE.Vector3(k * 0.02, 0.03, 0));
    for (const u of steps(10)) path.push([lerpV(collar, cap, u), new THREE.Vector3(0, -1, 0)]);
    const side = new THREE.Vector3(k, 0, 0.45).normalize();
    for (const u of steps(6).slice(1)) {
      const dir = new THREE.Vector3(0, -1, 0).lerp(side.clone().negate(), u).normalize();
      path.push([SHOULDER(k).add(new THREE.Vector3(0, -0.02 * u, 0)), dir]);
    }
    for (const u of steps(16).slice(1)) {
      const a = u < 0.5 ? lerpV(SHOULDER(k), ELBOW(k), u * 2) : lerpV(ELBOW(k), WRIST(k), (u - 0.5) * 2);
      if (u > 0.9) break;
      path.push([a, side.clone().negate()]);
    }
    tube(cloth.line(path, R * 0.6, ARMS), R, t.piping, ARMS);
    // the chest panel: from the shoulder seam beside the collar, curving down the front to the hem
    const front: [THREE.Vector3, THREE.Vector3][] = steps(18).map((u) => [new THREE.Vector3(k * (0.1 + 0.03 * Math.sin(u * Math.PI) - 0.02 * u), 1.425 - (1.425 - HEM - 0.05) * u, 0), new THREE.Vector3(0, 0, -1)]);
    tube(cloth.line(front, R * 0.6, TORSO), R, t.piping, TORSO);
    // the cuff: piping round the sleeve above a ribbed band
    const w = WRIST(k);
    const e = ELBOW(k);
    const at = lerpV(e, w, 0.8);
    const axis = w.clone().sub(e).normalize();
    const ring: [THREE.Vector3, THREE.Vector3][] = steps(20).slice(0, 20).map((u) => {
      const a = u * Math.PI * 2;
      const d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      d.addScaledVector(axis, -d.dot(axis)).normalize();
      return [at.clone(), d.negate()];
    });
    const fa = k > 0 ? /forearm_l/ : /forearm_r/;
    tube(cloth.line(ring, R * 0.6, fa, true), R, t.piping, fa, true);
  }
  // piping right round the jacket above the hem
  const hem: [THREE.Vector3, THREE.Vector3][] = steps(40).slice(0, 40).map((u) => {
    const a = u * Math.PI * 2;
    return [new THREE.Vector3(0, HEM + 0.04, 0.01), new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a))];
  });
  tube(cloth.line(hem, R * 0.6, TORSO, true), R, t.piping, TORSO, true);
  // the zip: a dark track down the front, metal teeth either side, the pull at the top
  const zipPath: [THREE.Vector3, THREE.Vector3][] = steps(24).map((u) => [new THREE.Vector3(0, 1.43 - (1.43 - HEM + 0.005) * u, 0), new THREE.Vector3(0, 0, -1)]);
  const zip = cloth.line(zipPath, 0.0015, TORSO);
  tube(zip, 0.0026, t.zip, TORSO);
  if (zip) {
    const teeth: THREE.BufferGeometry[] = [];
    const L = zip.getLength();
    const n = Math.floor(L / 0.0085);
    for (let i = 0; i < n; i++) {
      const p = zip.getPointAt(i / n);
      teeth.push(new THREE.BoxGeometry(0.0045, 0.0032, 0.002).translate(p.x + (i % 2 ? 0.0024 : -0.0024), p.y, p.z + 0.0012));
    }
    out.push(cloth.add(mergeAll(teeth.map((g) => indexed(g.toNonIndexed()))), t.metal, TORSO));
    const top = zip.getPointAt(0.02);
    out.push(cloth.add(new THREE.BoxGeometry(0.009, 0.011, 0.005).translate(top.x, top.y, top.z + 0.002), t.metal, TORSO));
    out.push(cloth.add(new THREE.CapsuleGeometry(0.0042, 0.026, 3, 8).scale(1, 1, 0.45).translate(top.x, top.y - 0.02, top.z + 0.005), t.metal, TORSO));
  }
}

/** the trousers' piping, down the outside of each leg */
function trouserTrims(cloth: Cloth, t: SuitTrims, out: THREE.Object3D[]): void {
  for (const k of [1, -1]) {
    const path: [THREE.Vector3, THREE.Vector3][] = steps(20).map((u) => [new THREE.Vector3(k * (0.1 - 0.0 * u), 0.95 - 0.8 * u, 0.0), new THREE.Vector3(-k, 0, 0)]);
    const leg = k > 0 ? /chest|_l$/ : /chest|_r$/;
    const c = cloth.line(path, 0.002, leg);
    if (c) out.push(cloth.add(new THREE.TubeGeometry(c, 60, 0.003, 6, false), t.piping, leg));
  }
}

/** a geometry given a plain index (for merging) */
function indexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

/* ------------------------------------------------------------------ */
/* the body                                                             */
/* ------------------------------------------------------------------ */

/** the game's fingers, as Avatar's hand rig has them */
export interface GameHand {
  fingers: { knuckle: THREE.Object3D; mid: THREE.Object3D }[];
  thumb: THREE.Object3D;
  thumbRest: THREE.Euler;
}

interface Link {
  bone: THREE.Bone;
  game: THREE.Object3D;
  /** model rest rotation relative to the game bone's rest rotation */
  r0: THREE.Quaternion;
  /** 'game': the joint sits on the game's; 'rigid': kept at its rest offset from its model parent */
  at: 'game' | 'rigid' | 'hips';
  parent: Link | null;
  /** rest position in the model parent's frame (rigid) or the hips' offset from the game's (hips) */
  rest: THREE.Vector3;
  /** stretch: the game bone whose joint ends this limb, the model's rest length and the bone's long axis */
  to?: THREE.Object3D;
  len?: number;
  axis?: 0 | 1 | 2;
  /** fingertips: also turn by this game joint's own rotation */
  extra?: THREE.Object3D;
  /** forearms: twist about the long axis by half the way to the hand */
  twist?: { hand: THREE.Object3D; base: number; fa: THREE.Quaternion; hand0: THREE.Quaternion };
  // this frame
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

/** how far each body slider moves its shape key */
const MORPH_GAIN: Record<string, number> = { body_weight: 1.6, muscle_definition: 1.3, chest: 1, waist: 1, hips: 1, shoulder_width: 1, arm_thickness: 1.2 };

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _p2 = new THREE.Vector3();
const _qe = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);
const _s = new THREE.Vector3();
const ID = new THREE.Quaternion();

export class ModelBody {
  readonly object: THREE.Object3D;
  private links: Link[] = [];
  private meshes: THREE.SkinnedMesh[] = [];
  /** the robot suit's layers and trims (their build baked in, not the look's sliders) */
  private suit: THREE.Object3D[] = [];
  /** body-space transforms of the game's bones this frame */
  private gameP = new Map<THREE.Object3D, THREE.Vector3>();
  private gameQ = new Map<THREE.Object3D, THREE.Quaternion>();

  /**
   * `body` is Avatar's body group (the bones hang off it), `bones` the game's
   * skeleton, `rest` each game bone's rest position in body space, `hands`
   * the finger rigs. Call before the avatar has moved.
   */
  constructor(
    private body: THREE.Object3D,
    bones: Record<string, THREE.Object3D>,
    rest: Record<string, THREE.Vector3>,
    hands: { l: GameHand | null; r: GameHand | null },
    show: Set<BodyRegion>,
    skin: THREE.Material,
    look: Look,
    private tuck: Tuck,
    suit: Suit | null = null,
  ) {
    if (!ready) throw new Error('body model not loaded');
    // a copy of the loaded scene (skinned meshes keep their own skeleton)
    this.object = SkeletonUtils.clone(ready.scene);
    this.object.updateMatrixWorld(true);

    const modelBones = new Map<string, THREE.Bone>();
    const regionOf = new Map<THREE.SkinnedMesh, BodyRegion>();
    this.object.traverse((o) => {
      if ((o as THREE.Bone).isBone) modelBones.set(o.name, o as THREE.Bone);
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        const region = String((m.material as THREE.Material).name).replace(/^skin_/, '') as BodyRegion;
        regionOf.set(m, region);
        m.visible = show.has(region);
        m.material = skin;
        m.castShadow = true;
        m.frustumCulled = false;
        this.meshes.push(m);
      }
    });
    // the robot suit, cut from the regions it covers
    if (suit) {
      const jacket: THREE.SkinnedMesh[] = [];
      const trousers: THREE.SkinnedMesh[] = [];
      for (const m of this.meshes) {
        const region = regionOf.get(m)!;
        const sleeve = region.startsWith('upper_arm') || region.startsWith('forearm');
        const leg = region.startsWith('thigh') || region.startsWith('calf');
        if (suit.jacket && (region === 'chest' || sleeve)) jacket.push(garment(m, region, jacketThickness, suit.jacket));
        if (suit.trousers && (region === 'chest' || leg)) trousers.push(garment(m, region, trouserThickness, suit.trousers));
      }
      this.suit.push(...jacket, ...trousers);
      for (const [parts, trim] of [[jacket, jacketTrims], [trousers, trouserTrims]] as const) {
        if (!parts.length) continue;
        const cloth = new Cloth(parts);
        trim(cloth, suit.trims, this.suit);
        cloth.dispose();
      }
    }

    // each model bone's rest transform in body space (the scene sits at the body's origin)
    const restP = new Map<THREE.Bone, THREE.Vector3>();
    const restQ = new Map<THREE.Bone, THREE.Quaternion>();
    for (const b of modelBones.values()) {
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      b.matrixWorld.decompose(p, q, _s);
      restP.set(b, p);
      restQ.set(b, q);
    }
    const byBone = new Map<THREE.Bone, Link>();
    const link = (name: string, game: THREE.Object3D, at: Link['at'], o: { gameRest?: THREE.Quaternion; to?: THREE.Object3D; toName?: string; extra?: THREE.Object3D; restGame?: THREE.Vector3 } = {}) => {
      const bone = modelBones.get(name);
      if (!bone) return;
      const parentBone = bone.parent && (bone.parent as THREE.Bone).isBone ? (bone.parent as THREE.Bone) : null;
      const parent = parentBone ? (byBone.get(parentBone) ?? null) : null;
      const r0 = (o.gameRest ?? ID).clone().invert().multiply(restQ.get(bone)!);
      let restV = new THREE.Vector3();
      if (at === 'rigid' && parentBone) {
        // rest offset in the parent's rotated frame
        restV = restP.get(bone)!.clone().sub(restP.get(parentBone)!).applyQuaternion(restQ.get(parentBone)!.clone().invert());
      } else if (at === 'hips' && o.restGame) restV = restP.get(bone)!.clone().sub(o.restGame);
      const l: Link = { bone, game, r0, at, parent, rest: restV, extra: o.extra, p: new THREE.Vector3(), q: new THREE.Quaternion() };
      if (o.to && o.toName) {
        const child = modelBones.get(o.toName);
        if (child) {
          l.to = o.to;
          l.len = restP.get(child)!.distanceTo(restP.get(bone)!);
          // the bone's long axis: its child's rest offset in the bone's own frame
          const local = restP.get(child)!.clone().sub(restP.get(bone)!).applyQuaternion(restQ.get(bone)!.clone().invert());
          const a = [Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)];
          l.axis = a.indexOf(Math.max(...a)) as 0 | 1 | 2;
        }
      }
      this.links.push(l);
      byBone.set(bone, l);
    };

    // parents before children
    link('hips', bones.hips, 'hips', { restGame: rest.hips });
    link('spine', bones.spine, 'rigid');
    link('chest', bones.chest, 'rigid');
    link('neck', bones.neck, 'rigid');
    link('head', bones.head, 'rigid');
    for (const s of ['l', 'r'] as const) {
      link(`shoulder_${s}`, bones[`shoulder_${s}`], 'rigid');
      link(`upper_arm_${s}`, bones[`upper_arm_${s}`], 'game', { to: bones[`forearm_${s}`], toName: `forearm_${s}` });
      // palms: the model's hand half a turn about the arm (pronated, as the
      // game's is); the forearm a quarter turn at rest, then half the twist to the hand
      const k = s === 'l' ? 1 : -1;
      const turn = new THREE.Quaternion().setFromAxisAngle(Y, -k * Math.PI);
      const back = turn.clone().invert();
      link(`forearm_${s}`, bones[`forearm_${s}`], 'game', { to: bones[`hand_${s}`], toName: `hand_${s}` });
      const fa = this.links[this.links.length - 1];
      if (fa?.game === bones[`forearm_${s}`]) fa.twist = { hand: bones[`hand_${s}`], base: (-k * Math.PI) / 2, fa: new THREE.Quaternion().setFromAxisAngle(Y, (-k * Math.PI) / 2), hand0: turn };
      link(`hand_${s}`, bones[`hand_${s}`], 'game', { gameRest: back });
      const h = hands[s];
      if (h) {
        // the game's fingers run index (next to the thumb) to little, as the model's do
        ['index', 'middle', 'ring', 'pinky'].forEach((name, k) => {
          const f = h.fingers[k];
          if (!f) return;
          link(`${name}_01_${s}`, f.knuckle, 'rigid', { gameRest: back });
          link(`${name}_02_${s}`, f.mid, 'rigid', { gameRest: back });
          link(`${name}_03_${s}`, f.mid, 'rigid', { gameRest: back, extra: f.mid });
        });
        const tr = back.clone().multiply(new THREE.Quaternion().setFromEuler(h.thumbRest));
        link(`thumb_01_${s}`, h.thumb, 'rigid', { gameRest: tr });
        link(`thumb_02_${s}`, h.thumb, 'rigid', { gameRest: tr });
        link(`thumb_03_${s}`, h.thumb, 'rigid', { gameRest: tr });
      }
      link(`thigh_${s}`, bones[`thigh_${s}`], 'game', { to: bones[`shin_${s}`], toName: `shin_${s}` });
      link(`shin_${s}`, bones[`shin_${s}`], 'game', { to: bones[`foot_${s}`], toName: `foot_${s}` });
      link(`foot_${s}`, bones[`foot_${s}`], 'game');
    }

    // flatten: every model bone hangs straight off the scene root, so each one's
    // transform is set in body space with no inherited stretch or shear
    for (const l of this.links) this.object.add(l.bone);

    this.setLook(look);
    body.add(this.object);
  }

  /** the body sliders and the tucks under clothes onto the shape keys */
  setLook(look: Look): void {
    for (const m of this.meshes) {
      const dict = m.morphTargetDictionary;
      const inf = m.morphTargetInfluences;
      if (!dict || !inf) continue;
      for (const [key, i] of Object.entries(dict)) {
        inf[i] = key in this.tuck ? this.tuck[key as keyof Tuck] : slider(look, key) * (MORPH_GAIN[key] ?? 1);
      }
    }
  }

  /** copy the game skeleton's pose onto the model (after the avatar's update) */
  sync(): void {
    this.body.updateMatrixWorld(true);
    _inv.copy(this.body.matrixWorld).invert();
    const gp = (o: THREE.Object3D): THREE.Vector3 => {
      let p = this.gameP.get(o);
      if (!p) {
        p = new THREE.Vector3();
        this.gameP.set(o, p);
        this.gameQ.set(o, new THREE.Quaternion());
      }
      _m.multiplyMatrices(_inv, o.matrixWorld);
      _m.decompose(p, this.gameQ.get(o)!, _s);
      return p;
    };
    for (const l of this.links) {
      const P = gp(l.game);
      const Q = this.gameQ.get(l.game)!;
      l.q.copy(Q).multiply(l.r0);
      if (l.extra) {
        // the tip curls a little less than the middle joint
        _qe.copy(ID).slerp(l.extra.quaternion, 0.8);
        l.q.copy(Q).multiply(_qe).multiply(l.r0);
      }
      if (l.twist) {
        // the hand's twist past the forearm's quarter turn, about the forearm's long axis (y)
        gp(l.twist.hand);
        _qt.copy(Q).multiply(l.twist.fa).invert().multiply(this.gameQ.get(l.twist.hand)!).multiply(l.twist.hand0);
        const past = 2 * Math.atan2(_qt.y, _qt.w);
        const a = Math.atan2(Math.sin(past), Math.cos(past));
        _qe.setFromAxisAngle(Y, (l.twist.base + a) / 2);
        l.q.copy(Q).multiply(_qe).multiply(l.r0);
      }
      if (l.at === 'game') l.p.copy(P);
      else if (l.at === 'hips') l.p.copy(l.rest).applyQuaternion(Q).add(P);
      else if (l.parent) l.p.copy(l.rest).applyQuaternion(l.parent.q).add(l.parent.p);
      else l.p.copy(P);
      const b = l.bone;
      b.position.copy(l.p);
      b.quaternion.copy(l.q);
      b.scale.set(1, 1, 1);
      if (l.to && l.len && l.axis !== undefined) {
        _p2.copy(gp(l.to));
        const k = Math.max(0.6, Math.min(1.6, _p2.distanceTo(P) / l.len));
        b.scale.setComponent(l.axis, k);
      }
    }
  }

  dispose(): void {
    this.object.removeFromParent();
    // the suit's geometry is this body's own (its materials are the avatar's)
    for (const m of this.suit) (m as THREE.Mesh).geometry?.dispose();
  }
}
