/*
 * The player's character in 3D, built from a Look (Section 4).
 *
 * TODO: procedural stand-in for the Blender character (Section 14.2). The
 * bones are named like a humanoid rig (hips, spine, chest, neck, head,
 * upper_arm_l…), the sliders are the shape keys' names, and the outfit
 * slots, colour zones and materials are the same data, so a modelled GLB
 * can replace these meshes without changing anything that drives them.
 *
 *   body     a torso shaped by chest / waist / hips / shoulders, limbs sized
 *            by arms, legs, muscle and weight, all scaled by height
 *   head     a sphere reshaped by the face sliders (forehead, cheekbones,
 *            cheeks, jaw width and angle, chin) with nose, lips, ears, eyes
 *            (lids, lashes, irises incl. the fantasy ones), brows, facial hair
 *   hair     43 styles from caps, volumes, sheets, buns, tails, braids, locs,
 *            twists, afros; colour solid / gradient / tips / streaks; matte,
 *            glossy or wet; long hair swings on springs
 *   clothes  shells over the body for every slot, in their material (cotton,
 *            satin, mesh, denim, leather, sequin, reflective, holographic,
 *            velvet) and pattern, recoloured by the 3 zones
 *   moves    grooves locked to the beat (head nod, shoulder bounce, two-step,
 *            full body, still), hands on the decks, the signature drop move,
 *            a between-mix habit every 32 bars, blinking, sweat building up
 *   hype     the dancers by the booth: a new move every two bars (sway, wave,
 *            hair flip, point at the DJ, body roll, clap in the build), a jump
 *            on the drop, and a sparkler bottle held high on a HELL YEAH
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Look } from '../core/models';
import { FACE_SHAPE_BASE, type FaceShape, type Slot } from './catalog';
import { option, slider, slotMaterial, slotPattern, zoneColors } from './look';
import { fabricCanvas, irisCanvas, meshAlphaCanvas, skinCanvas, skinTone, toTexture } from './textures';

export type BoneName = 'hips' | 'spine' | 'chest' | 'neck' | 'head' | 'shoulder_l' | 'upper_arm_l' | 'forearm_l' | 'hand_l' | 'shoulder_r' | 'upper_arm_r' | 'forearm_r' | 'hand_r' | 'thigh_l' | 'shin_l' | 'foot_l' | 'thigh_r' | 'shin_r' | 'foot_r';

/** what the avatar reads each frame (a subset of the show state) */
export interface AvatarInput {
  beat: number;
  playing: boolean;
  dropHit: boolean;
  peak: number;
  build: number;
  kick: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Dims {
  H: number;
  shoulder: number;
  chestR: number;
  waistR: number;
  hipsR: number;
  depth: number;
  armR: number;
  legR: number;
  upperArm: number;
  foreArm: number;
  thigh: number;
  shin: number;
  hipY: number;
  headR: number;
}

function dims(l: Look): Dims {
  const H = 1 + 0.07 * slider(l, 'height');
  const L = 1 + 0.08 * slider(l, 'leg_length');
  const W = 1 + 0.2 * slider(l, 'body_weight');
  const M = 1 + 0.14 * slider(l, 'muscle_definition');
  const thigh = 0.43 * H * L;
  const shin = 0.42 * H * L;
  return {
    H,
    shoulder: (0.18 + 0.03 * slider(l, 'shoulder_width')) * (0.96 + 0.04 * M) * Math.sqrt(H),
    chestR: (0.15 + 0.022 * slider(l, 'chest')) * W * (0.97 + 0.03 * M),
    waistR: (0.125 + 0.025 * slider(l, 'waist')) * W,
    hipsR: (0.145 + 0.025 * slider(l, 'hips')) * W,
    depth: 0.64 + 0.04 * slider(l, 'chest'),
    armR: (0.04 + 0.009 * slider(l, 'arm_thickness')) * (0.6 + 0.4 * W) * M,
    legR: 0.062 * (0.65 + 0.35 * W) * (0.97 + 0.03 * M),
    upperArm: 0.29 * H,
    foreArm: 0.26 * H,
    thigh,
    shin,
    hipY: thigh + shin + 0.075,
    headR: 0.112 * Math.pow(H, 0.3),
  };
}

/** a capsule hanging down from its joint */
function limb(r: number, len: number, r2 = r): THREE.BufferGeometry {
  if (Math.abs(r - r2) < 1e-4) return new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 16).translate(0, -len / 2, 0);
  // tapered: a cylinder with rounded ends
  const g = new THREE.CylinderGeometry(r, r2, len, 16, 1, false).translate(0, -len / 2, 0);
  const top = new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const bot = new THREE.SphereGeometry(r2, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -len, 0);
  return mergeGeometries([g.toNonIndexed(), top.toNonIndexed(), bot.toNonIndexed()])!;
}

/** a torso piece: a lathe through (radius, height) points, flattened front to back */
function lathe(pts: [number, number][], depth: number, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), 32, phiStart, phiLength);
  g.scale(1, 1, depth);
  return g;
}

/** a relaxed hand hanging from the wrist: a palm, four slightly curled fingers and a thumb (k: 1 left, -1 right) */
function handGeometry(armR: number, k: number): THREE.BufferGeometry {
  const w = armR * 1.55;
  const parts: THREE.BufferGeometry[] = [new THREE.CapsuleGeometry(armR * 0.62, 0.035, 4, 12).scale(w / (armR * 1.24), 1, 0.55).translate(0, -0.035, 0)];
  for (let i = 0; i < 4; i++) {
    const len = [0.042, 0.05, 0.048, 0.038][i];
    const f = new THREE.CapsuleGeometry(0.0072, len, 3, 8).translate(0, -len / 2, 0);
    f.rotateX(0.35);
    parts.push(f.translate((i - 1.5) * (w / 4) * 0.95, -0.068, 0.004));
  }
  parts.push(new THREE.CapsuleGeometry(0.0085, 0.032, 3, 8).translate(0, -0.016, 0).rotateZ(k * 0.55).rotateY(k * -0.5).translate(k * w * 0.45, -0.022, 0.01));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
}

export class Avatar {
  readonly object = new THREE.Group();
  readonly bones = {} as Record<BoneName, THREE.Object3D>;
  /** 'dj' stands at the decks; 'idle' stands and grooves (the dressing room); 'hype' dances by the booth; 'surf' rides the crowd */
  mode: 'dj' | 'idle' | 'hype' | 'surf' = 'dj';
  /** a hype dancer's own pick of moves, and which side of the DJ she's on (-1 left, 1 right) */
  seed = 0;
  side = 1;
  /** 0..1, builds up through a long set; reset between gigs */
  sweat = 0;
  /** how strong the blacklight is (UV paint, irises and bright fabric glow) */
  uv = 0;
  private look: Look;
  private d: Dims;
  private body = new THREE.Group();
  private owned: { dispose(): void }[] = [];
  private skinMats: THREE.MeshPhysicalMaterial[] = [];
  private glowMats: { mat: THREE.MeshStandardMaterial; k: number }[] = [];
  private springs: { obj: THREE.Object3D; ox: number; oz: number; vx: number; vz: number; k: number }[] = [];
  private lids: THREE.Object3D[] = [];
  private headphones: THREE.Object3D | null = null;
  private headphonesHome: { parent: THREE.Object3D; pos: THREE.Vector3; rot: THREE.Euler } | null = null;
  private prop: THREE.Object3D | null = null;
  private t = 0;
  private dropT = 1e9;
  private cheerT = 1e9;
  private sparkler: { group: THREE.Group; sparks: THREE.Points; vel: Float32Array; life: Float32Array } | null = null;
  private habitAt = -1;
  private lastHead = new THREE.Vector3();
  private blinkAt = 2;
  private djName: string;

  constructor(look: Look, o: { djName?: string } = {}) {
    this.look = look;
    this.d = dims(look);
    this.djName = o.djName ?? '';
    this.object.add(this.body);
    this.build();
  }

  setLook(look: Look, djName = this.djName): void {
    this.look = look;
    this.djName = djName;
    this.d = dims(look);
    this.clear();
    this.build();
  }

  /* ---------------------------------------------------------------- */
  /* building                                                          */
  /* ---------------------------------------------------------------- */

  private keep<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }

  private clear(): void {
    for (const x of this.owned) x.dispose();
    this.owned = [];
    this.sparkler = null;
    this.skinMats = [];
    this.glowMats = [];
    this.springs = [];
    this.lids = [];
    this.headphones = null;
    this.headphonesHome = null;
    this.prop = null;
    this.body.clear();
  }

  dispose(): void {
    this.clear();
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, pos?: THREE.Vector3): THREE.Mesh {
    this.keep(geo);
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.copy(pos);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  private std(color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    return this.keep(new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o }));
  }

  /** a skin material for one body part (its own canvas if it carries tattoos) */
  private skin(part: string): THREE.MeshPhysicalMaterial {
    const tattoos = this.look.tattoos.filter((t) => t.place === part);
    const key = tattoos.length ? part : 'body';
    const found = this.skinMats.find((m) => m.name === `skin:${key}`);
    if (found) return found;
    const { color } = skinCanvas(this.look, { tattoos, djName: this.djName, seed: key.length * 17 });
    const map = this.keep(toTexture(color));
    const m = this.keep(new THREE.MeshPhysicalMaterial({ name: `skin:${key}`, map, roughness: 0.62, sheen: 0.15, sheenColor: new THREE.Color(1, 0.85, 0.8) }));
    this.skinMats.push(m);
    return m;
  }

  private build(): void {
    const l = this.look;
    const d = this.d;
    const b = this.bones;
    const bone = (name: BoneName, parent: THREE.Object3D, pos: THREE.Vector3) => {
      const o = new THREE.Object3D();
      o.name = name;
      o.position.copy(pos);
      parent.add(o);
      b[name] = o;
      return o;
    };
    // the skeleton
    const hips = bone('hips', this.body, V(0, d.hipY, 0));
    const spine = bone('spine', hips, V(0, 0.1 * d.H, 0));
    const chest = bone('chest', spine, V(0, 0.13 * d.H, 0));
    const neck = bone('neck', chest, V(0, 0.22 * d.H, 0));
    bone('head', neck, V(0, 0.085 * d.H, 0.005));
    for (const [s, k] of [['l', 1], ['r', -1]] as const) {
      const sh = bone(`shoulder_${s}`, chest, V(k * d.shoulder, 0.185 * d.H, -0.01));
      const ua = bone(`upper_arm_${s}`, sh, V(0, 0, 0));
      const fa = bone(`forearm_${s}`, ua, V(0, -d.upperArm, 0));
      bone(`hand_${s}`, fa, V(0, -d.foreArm, 0));
      const th = bone(`thigh_${s}`, hips, V(k * d.hipsR * 0.55, -0.03, 0));
      const sn = bone(`shin_${s}`, th, V(0, -d.thigh, 0));
      bone(`foot_${s}`, sn, V(0, -d.shin, 0));
    }

    // the body (under the clothes; clothes are shells around it)
    this.mesh(lathe([[d.hipsR * 0.9, -0.09], [d.hipsR, -0.02], [(d.hipsR + d.waistR) / 2, 0.06], [d.waistR, 0.13]], d.depth * 1.05), this.skin('chest'), hips);
    this.mesh(lathe([[d.waistR, -0.02], [d.chestR * 0.96, 0.1 * d.H], [d.chestR, 0.19 * d.H], [d.shoulder * 0.86, 0.3 * d.H], [d.shoulder * 0.55, 0.345 * d.H], [0.055, 0.37 * d.H]], d.depth), this.skin('chest'), spine);
    this.mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.11 * d.H, 16).translate(0, 0.04, 0), this.skin('neck'), neck);
    for (const [s, k] of [['l', 1], ['r', -1]] as const) {
      this.mesh(new THREE.SphereGeometry(d.armR * 1.25, 16, 12), this.skin(`upper_arm_${s}`), b[`shoulder_${s}`]);
      this.mesh(limb(d.armR * 1.1, d.upperArm, d.armR * 0.95), this.skin(`upper_arm_${s}`), b[`upper_arm_${s}`]);
      this.mesh(limb(d.armR * 0.92, d.foreArm, d.armR * 0.7), this.skin(`forearm_${s}`), b[`forearm_${s}`]);
      this.mesh(handGeometry(d.armR, k), this.skin(`hand_${s}`), b[`hand_${s}`]);
      this.mesh(limb(d.legR * 1.15, d.thigh, d.legR * 0.88), this.skin('thigh'), b[`thigh_${s}`]);
      this.mesh(limb(d.legR * 0.86, d.shin, d.legR * 0.6), this.skin(`calf_${s}`), b[`shin_${s}`]);
    }
    this.buildHead();
    this.buildHair();
    this.buildClothes();
    this.buildAccessories();
    void l;
  }

  /* ---------------------------------------------------------------- */
  /* head and face                                                     */
  /* ---------------------------------------------------------------- */

  /** the face sliders with the face-shape preset underneath */
  private face(id: string): number {
    const base = FACE_SHAPE_BASE[option(this.look, 'face_shape') as FaceShape]?.[id] ?? 0;
    return Math.max(-1.4, Math.min(1.4, base + slider(this.look, id)));
  }

  /** a point on the reshaped head, from a direction (x right, y up, z front), in the head mesh's space */
  private headPoint(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const len = Math.hypot(x, y, z) || 1;
    x /= len;
    y /= len;
    z /= len;
    const f = (k: string) => this.face(k);
    const lower = smooth(0.05, -0.8, y);
    const front = smooth(-0.3, 0.6, z);
    let px = x * (1 + f('jaw_width') * 0.14 * lower * front);
    let py = y;
    let pz = z;
    if (y > 0.25) py *= 1 + f('forehead_height') * 0.1 * smooth(0.25, 0.9, y);
    const corner = lower * smooth(0.3, 0.8, Math.abs(x)) * (z > -0.2 ? 1 : 0.4);
    px += Math.sign(x) * f('jaw_angle') * 0.06 * corner;
    py -= f('jaw_angle') * 0.025 * corner;
    const chin = smooth(-0.5, -0.95, y) * smooth(0.2, 0.9, z) * (1 - Math.min(1, Math.abs(x) * 1.6));
    py -= f('chin_length') * 0.12 * chin;
    pz += 0.03 * chin;
    px *= 1 + f('chin_shape') * 0.3 * chin;
    for (const s of [-1, 1]) {
      const cb = Math.exp(-((x - s * 0.72) ** 2 + (y + 0.02) ** 2 + (z - 0.62) ** 2) / 0.05);
      const ch = Math.exp(-((x - s * 0.62) ** 2 + (y + 0.4) ** 2 + (z - 0.62) ** 2) / 0.06);
      const k = 1 + f('cheekbones') * 0.05 * cb + f('cheek_fullness') * 0.07 * ch;
      px *= k;
      pz *= 1 + (k - 1) * 0.6;
    }
    const r = this.d.headR;
    return out.set(px * r * 0.88, py * r * 1.1, pz * r);
  }

  private buildHead(): void {
    const l = this.look;
    const head = this.bones.head;
    const r = this.d.headR;
    const hg = new THREE.SphereGeometry(1, 48, 32);
    const p = hg.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      this.headPoint(p.getX(i), p.getY(i), p.getZ(i), v);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    hg.computeVertexNormals();
    const { color, glow } = skinCanvas(l, { face: true, djName: this.djName, seed: 3 });
    const map = this.keep(toTexture(color, 1));
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    const faceMat = this.keep(new THREE.MeshPhysicalMaterial({ name: 'skin:face', map, roughness: 0.58, sheen: 0.2, sheenColor: new THREE.Color(1, 0.86, 0.8) }));
    if (glow) {
      faceMat.emissiveMap = this.keep(toTexture(glow, 1));
      faceMat.emissive.set(0xffffff);
      faceMat.emissiveIntensity = 0;
      this.glowMats.push({ mat: faceMat, k: 2.4 });
    }
    this.skinMats.push(faceMat);
    const headMesh = this.mesh(hg, faceMat, head, V(0, r * 0.95, 0));
    const at = (x: number, y: number, z: number, push = 0) => {
      const q = this.headPoint(x, y, z);
      if (push) q.add(q.clone().normalize().multiplyScalar(push));
      return q.add(headMesh.position);
    };
    const tone = skinTone(l);
    const skinCol = new THREE.Color(`rgb(${tone.map((c) => Math.round(Math.max(0, Math.min(255, c)))).join(',')})`);
    const plain = this.std(skinCol.clone(), { roughness: 0.6 });
    const f = (k: string) => this.face(k);

    // nose: bridge, tip and the wings of the nostrils
    const nw = 1 + f('nose_width') * 0.35;
    const nl = 1 + f('nose_length') * 0.3;
    const bridge = this.mesh(limb(0.0075 * nw, 0.044 * nl), plain, head, at(0, 0.08, 1, -0.003));
    bridge.rotation.x = -0.36 - f('nose_bridge') * 0.18;
    bridge.scale.set(1.3, 1, 0.8);
    bridge.position.z += 0.002 + f('nose_bridge') * 0.004;
    const tipP = at(0, -0.2 - (nl - 1) * 0.3, 1, 0.009 + f('nose_bridge') * 0.003);
    const tip = this.mesh(new THREE.SphereGeometry(0.0125 * (1 + f('nose_tip') * 0.35), 16, 12), plain, head, tipP);
    tip.scale.set(nw, 0.9, 0.95);
    for (const s of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.0085 * nw, 12, 8), plain, head, tipP.clone().add(V(s * 0.011 * nw, -0.004, -0.006)));

    // lips
    const lipCol = l.colors.lips ? new THREE.Color(l.colors.lips) : skinCol.clone().lerp(new THREE.Color(0.55, 0.18, 0.2), 0.32).multiplyScalar(0.85);
    const lipMat = this.std(lipCol, { roughness: 0.4 });
    const lf = 1 + f('lip_fullness') * 0.5;
    const lw = 1 + f('lip_width') * 0.3;
    const mouth = at(0, -0.46, 1, 0.001);
    const upper = this.mesh(limb(0.0048 * lf, 0.034 * lw).rotateZ(Math.PI / 2).translate(-0.017 * lw, 0, 0), lipMat, head, mouth.clone().add(V(0, 0.004, 0)));
    upper.scale.set(1, 1 + f('lip_shape') * 0.2, 0.9);
    const lower = this.mesh(limb(0.0058 * lf, 0.03 * lw).rotateZ(Math.PI / 2).translate(-0.015 * lw, 0, 0), lipMat, head, mouth.clone().add(V(0, -0.006, -0.001)));
    lower.scale.set(1, 1, 0.9);

    // ears
    const es = 1 + f('ear_size') * 0.25;
    for (const s of [-1, 1]) {
      const ear = this.mesh(new THREE.SphereGeometry(1, 16, 12, 0, Math.PI), plain, head, at(s, 0.02, -0.05, 0.002));
      ear.scale.set(0.013, 0.03 * es * (1 + f('ear_shape') * 0.15), 0.021 * es);
      ear.rotation.y = s * Math.PI / 2;
      ear.rotation.z = -s * f('ear_shape') * 0.15;
    }

    // eyes: eyeball (iris texture), lids, lashes
    const eSize = 1 + slider(l, 'eye_size') * 0.15;
    const er = 0.0125 * eSize;
    const style = option(l, 'iris_style');
    for (const s of [-1, 1]) {
      const pos = at(s * (0.33 + slider(l, 'eye_spacing') * 0.06), 0.13, 0.93, -er * 0.55);
      const tex = this.keep(toTexture(irisCanvas(l.colors[s > 0 ? 'iris_l' : 'iris_r'] ?? '#5a3a1e', style)));
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const eyeMat = this.keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.15, metalness: style === 'mirrored' ? 0.85 : 0 }));
      if (style === 'uv_glow') {
        eyeMat.emissiveMap = tex;
        eyeMat.emissive.set(0x7a3cff);
        this.glowMats.push({ mat: eyeMat, k: 3 });
      }
      const eye = this.mesh(new THREE.SphereGeometry(er, 24, 16), eyeMat, head, pos);
      eye.rotation.y = s * 0.05;
      const tilt = slider(l, 'eye_tilt') * 0.18 * s;
      // lids: a skin shell over the top of the eye (rounder eyes show more), a smaller one under
      const lidPivot = new THREE.Object3D();
      lidPivot.position.copy(pos);
      lidPivot.rotation.z = tilt;
      head.add(lidPivot);
      const open = 0.55 + slider(l, 'eye_shape') * 0.1;
      const upperLid = this.mesh(new THREE.SphereGeometry(er * 1.12, 20, 10, 0, Math.PI * 2, 0, Math.PI * open), plain, lidPivot);
      upperLid.rotation.x = -0.35;
      this.lids.push(upperLid);
      const lowerLid = this.mesh(new THREE.SphereGeometry(er * 1.08, 20, 8, 0, Math.PI * 2, Math.PI * 0.78, Math.PI * 0.22), plain, lidPivot);
      lowerLid.rotation.x = 0.2;
      const lash = 0.6 + slider(l, 'lash_length') * 0.8;
      const lashes = this.mesh(new THREE.TorusGeometry(er * 1.1, 0.0009 * (1 + slider(l, 'lash_volume') * 1.5), 4, 16, Math.PI * 0.9), this.std(0x0c0a09), lidPivot, V(0, er * 0.15, er * 0.15));
      lashes.rotation.set(-0.9, 0, Math.PI * 0.05);
      lashes.scale.set(1, 1, lash);
      void lashes;
    }

    // brows: a shaped tube per side (15 shapes), with an optional slit
    const BROW_PTS: Record<string, [number, number][]> = {
      straight: [[0, 0], [0.33, 0.02], [0.66, 0.02], [1, 0]],
      soft_arch: [[0, -0.1], [0.4, 0.15], [0.7, 0.18], [1, -0.05]],
      high_arch: [[0, -0.15], [0.45, 0.25], [0.65, 0.3], [1, -0.1]],
      angled: [[0, -0.1], [0.55, 0.25], [0.7, 0.25], [1, -0.15]],
      rounded: [[0, -0.15], [0.3, 0.12], [0.7, 0.12], [1, -0.15]],
      flat: [[0, 0], [0.5, 0], [0.8, 0], [1, -0.05]],
      thick_straight: [[0, 0], [0.33, 0.03], [0.66, 0.03], [1, -0.02]],
      thin_arch: [[0, -0.1], [0.5, 0.18], [0.7, 0.18], [1, -0.08]],
      s_curve: [[0, -0.05], [0.3, 0.1], [0.65, 0.12], [1, 0.05]],
      feathered: [[0, -0.05], [0.4, 0.12], [0.7, 0.1], [1, 0]],
      bushy: [[0, 0], [0.4, 0.1], [0.7, 0.1], [1, 0]],
      short: [[0.15, 0], [0.45, 0.1], [0.7, 0.08], [0.85, 0]],
      tapered: [[0, 0.02], [0.4, 0.12], [0.7, 0.1], [1, -0.1]],
      upturned: [[0, -0.15], [0.4, 0], [0.7, 0.12], [1, 0.2]],
      downturned: [[0, 0.1], [0.4, 0.12], [0.7, 0], [1, -0.18]],
    };
    const shape = option(l, 'brows');
    const pts = BROW_PTS[shape] ?? BROW_PTS.soft_arch;
    const thick = (0.0032 + (shape.includes('thick') || shape === 'bushy' ? 0.0014 : shape.includes('thin') ? -0.0012 : 0)) * (1 + slider(l, 'brow_thickness') * 0.6);
    const browMat = this.std(l.colors.brows ?? l.colors.hair ?? '#1d140e', { roughness: 0.9 });
    const slit = option(l, 'brow_slit');
    for (const s of [-1, 1]) {
      const side = s > 0 ? 'left' : 'right';
      const segs: [number, number][][] = slit === 'both' || slit === side ? [pts.filter(([x]) => x < 0.55), pts.filter(([x]) => x > 0.75)] : [pts];
      for (const seg of segs) {
        if (seg.length < 2) continue;
        const curve = new THREE.CatmullRomCurve3(seg.map(([bx, by]) => at(s * (0.14 + bx * 0.36), 0.27 + by * 0.12 + bx * slider(l, 'eye_tilt') * 0.03, 0.88, 0.003)));
        this.mesh(new THREE.TubeGeometry(curve, 12, thick, 6, false), browMat, head);
      }
    }

    // facial hair beyond stubble (stubble is painted on the skin)
    const fh = option(l, 'facial_hair');
    const fhLen = 1 + slider(l, 'facial_hair_length') * 0.8;
    const hairMat = this.std(l.colors.facial_hair ?? '#1d140e', { roughness: 0.95 });
    if (fh.startsWith('mustache')) {
      const ends = fh === 'mustache_handlebar' ? 0.08 : fh === 'mustache_horseshoe' ? -0.25 : -0.05;
      const curve = new THREE.CatmullRomCurve3([at(-0.36, -0.42 + ends, 0.9, 0.006), at(-0.15, -0.34, 1, 0.009), at(0.15, -0.34, 1, 0.009), at(0.36, -0.42 + ends, 0.9, 0.006)]);
      this.mesh(new THREE.TubeGeometry(curve, 16, 0.0055 * fhLen, 6, false), hairMat, head);
    }
    if (fh === 'goatee' || fh === 'mustache_horseshoe') {
      const g = this.mesh(new THREE.SphereGeometry(0.016 * fhLen, 16, 12), hairMat, head, at(0, -0.85, 0.75, 0.004));
      g.scale.set(1.3, 1, 0.8);
    }
    if (fh === 'chin_strap') {
      const curve = new THREE.CatmullRomCurve3([at(-0.95, -0.15, 0.1), at(-0.75, -0.65, 0.4), at(0, -0.95, 0.6), at(0.75, -0.65, 0.4), at(0.95, -0.15, 0.1)]);
      this.mesh(new THREE.TubeGeometry(curve, 24, 0.005 * fhLen, 6, false), hairMat, head);
    }
    if (fh === 'short_beard' || fh === 'full_beard') {
      const bg = new THREE.SphereGeometry(1, 40, 18, Math.PI / 2 - 1.5, 3.0, Math.PI * 0.5, Math.PI * 0.48);
      const bp = bg.attributes.position as THREE.BufferAttribute;
      const push = fh === 'full_beard' ? 0.011 * fhLen : 0.0045 * fhLen;
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i);
        const y = bp.getY(i);
        // the edge: under the lower lip at the front, up to the sideburns at the sides
        const edge = -0.56 + 0.5 * smooth(0.18, 0.75, Math.abs(x));
        const on = smooth(edge + 0.06, edge - 0.06, y);
        const q = this.headPoint(x, y, bp.getZ(i));
        const n = q.clone().normalize();
        // off the beard, the shell sits just under the skin (hidden)
        q.add(n.multiplyScalar(on > 0 ? (push + (y < -0.8 ? push * 0.7 : 0)) * on : -0.002));
        bp.setXYZ(i, q.x, q.y, q.z);
      }
      bg.computeVertexNormals();
      this.mesh(bg, hairMat, head, headMesh.position.clone());
      if (fh === 'full_beard') {
        const curve = new THREE.CatmullRomCurve3([at(-0.4, -0.5, 0.88, 0.006), at(-0.15, -0.35, 1, 0.008), at(0.15, -0.35, 1, 0.008), at(0.4, -0.5, 0.88, 0.006)]);
        this.mesh(new THREE.TubeGeometry(curve, 16, 0.006 * fhLen, 6, false), hairMat, head);
      }
    }
    if (fh === 'sideburns' || fh === 'full_beard' || fh === 'short_beard') for (const s of [-1, 1]) this.mesh(new THREE.BoxGeometry(0.008, 0.035, 0.016), hairMat, head, at(s * 0.95, -0.05, 0.25, 0.002));
  }

  /* ---------------------------------------------------------------- */
  /* hair                                                              */
  /* ---------------------------------------------------------------- */

  private buildHair(): void {
    const l = this.look;
    const style = l.items.hair ?? 'crop';
    if (style === 'bald') return;
    const head = this.bones.head;
    const r = this.d.headR;
    const hatOn = !!l.items.head;
    const grp = new THREE.Group();
    grp.position.set(0, r * 0.95, 0);
    head.add(grp);
    const parts: THREE.BufferGeometry[] = [];
    const dangly: { geo: THREE.BufferGeometry; pivot: THREE.Vector3; k: number }[] = [];
    /**
     * A shell over the scalp. `cover` sets how low it reaches at the nape (0.5:
     * the back of the head, 0.6: past the ears); the hairline sits high on the
     * forehead (higher with `tilt`), lower at the temples. `top` adds volume
     * on the crown, `rough` a texture. Below the hairline the shell tucks
     * under the skin.
     */
    const cap = (cover: number, push = 0.004, tilt = 0.32, top = 0, rough = 0) => {
      const g = new THREE.SphereGeometry(1, 64, 32);
      const p = g.attributes.position as THREE.BufferAttribute;
      const back = Math.cos(cover * Math.PI);
      const front = 0.36 + tilt * 0.25;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const hl = back + (front - back) * smooth(-0.3, 0.85, z) * (1 - 0.25 * smooth(0.5, 0.95, Math.abs(x)));
        const on = smooth(hl - 0.04, hl + 0.06, y);
        const q = this.headPoint(x, y, z);
        const n = q.clone().normalize();
        const tex = rough ? Math.sin(x * 23 + y * 17) * Math.sin(y * 19 - z * 21) * Math.sin(z * 15 + x * 11) * rough : 0;
        const k = on > 0 ? (push + top * smooth(0.2, 0.95, y) + tex) * on : -0.003;
        q.add(n.multiplyScalar(k));
        p.setXYZ(i, q.x, q.y, q.z);
      }
      g.computeVertexNormals();
      parts.push(g);
    };
    const blob = (x: number, y: number, z: number, sx: number, sy: number, sz: number, detail = 24) => parts.push(new THREE.SphereGeometry(1, detail, Math.round(detail * 0.7)).scale(sx, sy, sz).translate(x, y, z));
    const bumpy = (g: THREE.BufferGeometry, amt: number, freq: number) => {
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const n = Math.sin(x * freq * 1.7 + y * freq) * Math.sin(y * freq * 1.3 - z * freq) * Math.sin(z * freq * 1.1 + x * freq * 0.7);
        const len = Math.hypot(x, y, z) || 1;
        const k = 1 + n * amt;
        p.setXYZ(i, (x / len) * len * k, (y / len) * len * k, (z / len) * len * k);
      }
      g.computeVertexNormals();
      return g;
    };
    /** a hanging sheet of long hair behind and round the head */
    const sheet = (len: number, wave = 0, width = 1.15) => {
      const g = new THREE.CylinderGeometry(r * 1.0 * width, r * 1.45 * width, len, 32, 10, true, Math.PI * 0.28, Math.PI * 1.44).translate(0, -len / 2 + r * 0.5, -r * 0.08);
      g.scale(1, 1, 0.85);
      if (wave) {
        const p = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          const a = Math.atan2(p.getZ(i), p.getX(i));
          const k = 1 + Math.sin(y * 40 + a * 3) * 0.06 * wave;
          p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k);
        }
        g.computeVertexNormals();
      }
      dangly.push({ geo: g, pivot: V(0, r * 0.3, -r * 0.1), k: 0.6 });
    };
    const tail = (from: THREE.Vector3, len: number, thick: number, curl = 0) => {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const t = i / 5;
        return from.clone().add(V(Math.sin(t * 6) * curl * 0.03, -t * len, -t * len * 0.25 - r * 0.05));
      });
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, thick, 10, false);
      // taper towards the tip
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const t = Math.max(0, Math.min(1, (from.y - p.getY(i)) / len));
        const c = pts[Math.min(5, Math.round(t * 5))];
        p.setXYZ(i, c.x + (p.getX(i) - c.x) * (1 - t * 0.6), p.getY(i), c.z + (p.getZ(i) - c.z) * (1 - t * 0.6));
      }
      dangly.push({ geo: g, pivot: from.clone(), k: 1 });
    };
    /** many strands round the back and sides: braids, locs, twists */
    const strands = (n: number, len: number, thick: number, kind: 'braid' | 'loc' | 'twist', cuffs = false) => {
      const geos: THREE.BufferGeometry[] = [];
      const cuffGeos: THREE.BufferGeometry[] = [];
      for (let i = 0; i < n; i++) {
        // the angle round the head from the front: 0.36π beside one cheek, round the back to the other
        const a = Math.PI * 0.36 + (i / (n - 1)) * Math.PI * 1.28;
        const ring = this.headPoint(Math.sin(a) * 0.9, 0.05 + (i % 2) * 0.15, Math.cos(a) * 0.9);
        const segs = kind === 'twist' ? 10 : 6;
        const g = new THREE.CylinderGeometry(thick, thick * 0.85, len, 6, segs).translate(ring.x * 1.05, ring.y - len / 2, ring.z * 1.05);
        if (kind !== 'loc') {
          const p = g.attributes.position as THREE.BufferAttribute;
          for (let k = 0; k < p.count; k++) {
            const y = p.getY(k);
            const w = 1 + Math.sin(y * (kind === 'braid' ? 160 : 220)) * 0.25;
            p.setX(k, ring.x * 1.05 + (p.getX(k) - ring.x * 1.05) * w);
            p.setZ(k, ring.z * 1.05 + (p.getZ(k) - ring.z * 1.05) * w);
          }
        }
        geos.push(g.toNonIndexed());
        if (cuffs && i % 3 === 0) cuffGeos.push(new THREE.TorusGeometry(thick * 1.3, thick * 0.35, 6, 12).rotateX(Math.PI / 2).translate(ring.x * 1.05, ring.y - len * 0.55, ring.z * 1.05).toNonIndexed());
      }
      dangly.push({ geo: mergeGeometries(geos)!, pivot: V(0, 0, 0), k: 0.4 });
      if (cuffGeos.length) this.mesh(mergeGeometries(cuffGeos)!, this.std(0xd4a64a, { metalness: 0.9, roughness: 0.3 }), grp);
    };
    const S = r;
    switch (style) {
      case 'buzz':
        cap(0.5, 0.0015, 0.3);
        break;
      case 'crew':
        cap(0.5, 0.003, 0.3, hatOn ? 0 : 0.01, 0.0015);
        break;
      case 'crop':
      case 'bleached_crop':
      case 'french_crop':
        cap(0.52, 0.006, 0.28, hatOn ? 0 : 0.018, 0.003);
        blob(0, S * 0.6, S * 0.72, S * 0.6, S * 0.09, S * 0.2);
        break;
      case 'textured_fringe':
        cap(0.52, 0.006, 0.22, hatOn ? 0 : 0.024, 0.006);
        parts.push(bumpy(new THREE.SphereGeometry(1, 20, 12).scale(S * 0.58, S * 0.17, S * 0.11).rotateX(0.35).translate(0, S * 0.55, S * 0.8), 0.16, 20));
        break;
      case 'fade_lines':
      case 'caesar':
        cap(0.48, 0.003, 0.3);
        if (style === 'caesar') blob(0, S * 0.62, S * 0.75, S * 0.72, S * 0.08, S * 0.2);
        break;
      case 'side_part':
        cap(0.55, 0.006, 0.28, hatOn ? 0 : 0.016);
        if (!hatOn) {
          const w = new THREE.SphereGeometry(1, 24, 14).scale(S * 0.55, S * 0.14, S * 0.5);
          w.rotateZ(-0.25);
          parts.push(w.translate(S * 0.12, S * 0.8, S * 0.35));
        }
        break;
      case 'spiky':
        cap(0.5, 0.004, 0.3);
        if (!hatOn)
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            const rr = i % 2 ? 0.35 : 0.6;
            parts.push(new THREE.ConeGeometry(S * 0.12, S * 0.55, 8).translate(Math.cos(a) * S * rr, S * 1.1, Math.sin(a) * S * rr * 0.9));
          }
        break;
      case 'curtains':
        cap(0.58, 0.007, 0.15, hatOn ? 0 : 0.012);
        for (const s of [-1, 1]) {
          const c = new THREE.SphereGeometry(1, 20, 14).scale(S * 0.36, S * 0.17, S * 0.11);
          c.rotateZ(-s * 0.45);
          parts.push(c.translate(s * S * 0.34, S * 0.5, S * 0.8));
        }
        break;
      case 'mullet':
        cap(0.56, 0.006, 0.28, hatOn ? 0 : 0.016, 0.003);
        sheet(S * 1.4, 0.4, 0.95);
        break;
      case 'shag':
      case 'wolf_cut':
        cap(0.62, 0.014, 0.2, hatOn ? 0 : 0.012, 0.007);
        parts.push(bumpy(new THREE.SphereGeometry(1, 20, 12).scale(S * 0.66, S * 0.2, S * 0.12).rotateX(0.35).translate(0, S * 0.52, S * 0.8), 0.14, 18));
        if (style === 'wolf_cut') sheet(S * 1.2, 0.8, 1.0);
        break;
      case 'curly_top':
        cap(0.5, 0.004, 0.3);
        if (!hatOn) parts.push(bumpy(new THREE.SphereGeometry(1, 40, 28).scale(S * 0.86, S * 0.56, S * 0.9).translate(0, S * 0.7, S * 0.06), 0.11, 34));
        break;
      case 'slick_back':
      case 'undercut':
        cap(style === 'undercut' ? 0.45 : 0.56, 0.007, 0.45, hatOn ? 0 : 0.014);
        break;
      case 'bowl':
        cap(0.6, 0.012, 0);
        break;
      case 'quiff':
      case 'pompadour':
        cap(0.52, 0.005, 0.3);
        if (!hatOn) blob(0, S * (style === 'pompadour' ? 0.88 : 0.8), S * 0.4, S * 0.72, S * (style === 'pompadour' ? 0.4 : 0.3), S * 0.62);
        break;
      case 'long_straight':
      case 'long_waves':
      case 'long_curls':
        cap(0.6, 0.008, 0.1);
        sheet(S * 3.2, style === 'long_waves' ? 1 : style === 'long_curls' ? 2.2 : 0);
        break;
      case 'man_bun':
        cap(0.56, 0.006, 0.4);
        blob(0, S * 0.95, -S * 0.55, S * 0.35, S * 0.3, S * 0.35);
        break;
      case 'half_up':
        cap(0.6, 0.008, 0.15);
        blob(0, S * 0.75, -S * 0.75, S * 0.3, S * 0.26, S * 0.3);
        sheet(S * 2.6, 0.3);
        break;
      case 'ponytail':
      case 'high_ponytail':
        cap(0.58, 0.006, 0.4);
        tail(V(0, S * (style === 'high_ponytail' ? 0.95 : 0.35), -S * 0.95), S * 2.4, S * 0.22, 0.3);
        break;
      case 'space_buns':
        cap(0.58, 0.006, 0.3);
        for (const s of [-1, 1]) blob(s * S * 0.62, S * 0.95, -S * 0.1, S * 0.32, S * 0.3, S * 0.32);
        break;
      case 'pigtails':
        cap(0.58, 0.006, 0.3);
        for (const s of [-1, 1]) tail(V(s * S * 0.85, S * 0.25, -S * 0.2), S * 1.8, S * 0.17, 0.2);
        break;
      case 'afro_small':
      case 'afro_medium':
      case 'afro_large': {
        const k = style === 'afro_small' ? 1.25 : style === 'afro_medium' ? 1.55 : 1.9;
        const kk = hatOn ? Math.min(k, 1.2) : k;
        const af = bumpy(new THREE.SphereGeometry(1, 48, 32).scale(S * kk, S * kk * 0.9, S * kk * 0.92).translate(0, S * (0.3 + kk * 0.28), -S * (0.15 + (kk - 1) * 0.7)), 0.05, 14);
        // the face stays clear: nothing comes forward of the hairline below the brow
        const ap = af.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < ap.count; i++) {
          const y = ap.getY(i);
          const lim = S * (y > S * 0.55 ? 0.95 : 0.5 + Math.max(0, y / S) * 0.6);
          const z = ap.getZ(i);
          if (z > lim) ap.setZ(i, lim + (z - lim) * 0.12);
        }
        af.computeVertexNormals();
        parts.push(af);
        break;
      }
      case 'twists':
        cap(0.55, 0.008, 0.25);
        strands(26, S * 0.9, S * 0.075, 'twist');
        break;
      case 'box_braids':
      case 'box_braids_long':
        cap(0.56, 0.006, 0.25);
        strands(30, S * (style === 'box_braids_long' ? 3.3 : 1.8), S * 0.06, 'braid');
        break;
      case 'cornrows': {
        cap(0.56, 0.003, 0.25);
        for (let i = -3; i <= 3; i++) {
          const pts = [0.9, 0.5, 0, -0.5, -0.9].map((z) => this.headPoint(i * 0.13, 0.75 - Math.abs(z) * 0.45 + 0.2, z * 0.9).multiplyScalar(1.04));
          parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, S * 0.05, 6, false));
        }
        break;
      }
      case 'locs':
      case 'locs_long':
      case 'locs_cuffs':
        cap(0.56, 0.008, 0.25);
        strands(24, S * (style === 'locs_long' ? 3.4 : 2), S * 0.085, 'loc', style === 'locs_cuffs');
        break;
      case 'high_top':
        cap(0.5, 0.004, 0.3);
        if (!hatOn) parts.push(new THREE.CylinderGeometry(S * 0.82, S * 0.9, S * 0.9, 24, 1).translate(0, S * 1.1, 0));
        break;
      case 'bantu_knots':
        cap(0.55, 0.003, 0.25);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const q = this.headPoint(Math.cos(a) * 0.55, 0.75, Math.sin(a) * 0.55).multiplyScalar(1.12);
          blob(q.x, q.y, q.z, S * 0.2, S * 0.18, S * 0.2, 14);
        }
        break;
      case 'puff':
        cap(0.55, 0.004, 0.3);
        parts.push(bumpy(new THREE.SphereGeometry(1, 24, 16).scale(S * 0.6, S * 0.55, S * 0.6).translate(0, S * 1.05, -S * 0.35), 0.12, 14));
        break;
      default:
        cap(0.5, 0.005, 0.3);
    }

    // colour: solid, gradient root → tip, tips only, streaks; finish: matte, glossy, wet
    const mode = option(l, 'hair_color_mode');
    const finish = option(l, 'hair_finish');
    const c1 = new THREE.Color(style === 'bleached_crop' ? '#efe2b8' : (l.colors.hair ?? '#1d140e'));
    const c2 = new THREE.Color(l.colors.hair2 ?? '#6b4528');
    const mat = this.keep(
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        // long hair hangs as open sheets: both faces show
        side: THREE.DoubleSide,
        roughness: finish === 'matte' ? 0.85 : finish === 'glossy' ? 0.38 : 0.18,
        clearcoat: finish === 'matte' ? 0 : finish === 'glossy' ? 0.35 : 1,
        clearcoatRoughness: 0.3,
        sheen: 0.4,
        sheenColor: c1.clone().multiplyScalar(1.8).lerp(new THREE.Color(1, 1, 1), 0.08),
      }),
    );
    if (finish === 'wet') c1.multiplyScalar(0.75);
    const paint = (g: THREE.BufferGeometry, y0: number, y1: number) => {
      const p = g.attributes.position as THREE.BufferAttribute;
      const cols = new Float32Array(p.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const t = 1 - Math.max(0, Math.min(1, (p.getY(i) - y0) / Math.max(1e-4, y1 - y0)));
        let k = 0;
        if (mode === 'gradient') k = t;
        else if (mode === 'tips') k = smooth(0.7, 0.85, t);
        else if (mode === 'streaks') k = Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 9) > 0.6 ? 1 : 0;
        c.copy(c1).lerp(c2, k);
        cols.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    };
    const all = [...parts, ...dangly.map((x) => x.geo)];
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const g of all) {
      g.computeBoundingBox();
      y0 = Math.min(y0, g.boundingBox!.min.y);
      y1 = Math.max(y1, g.boundingBox!.max.y);
    }
    for (const g of all) paint(g, y0, y1);
    if (parts.length) this.mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false) ?? parts[0], mat, grp);
    for (const dg of dangly) {
      const pivot = new THREE.Object3D();
      pivot.position.copy(dg.pivot);
      grp.add(pivot);
      dg.geo.translate(-dg.pivot.x, -dg.pivot.y, -dg.pivot.z);
      this.mesh(dg.geo, mat, pivot);
      this.springs.push({ obj: pivot, ox: 0, oz: 0, vx: 0, vz: 0, k: dg.k });
    }
  }

  /* ---------------------------------------------------------------- */
  /* clothes                                                           */
  /* ---------------------------------------------------------------- */

  /** the fabric of whatever is in a slot: its pattern in its 3 zones, its material's sheen */
  private fabric(slot: Slot, zoneOverride?: 1 | 2 | 3): THREE.MeshPhysicalMaterial {
    const l = this.look;
    const zones = zoneColors(l, slot);
    const material = slotMaterial(l, slot);
    const pattern = zoneOverride ? 'solid' : slotPattern(l, slot);
    const z = zoneOverride ? ([zones[zoneOverride - 1], zones[zoneOverride - 1], zones[zoneOverride - 1]] as [string, string, string]) : zones;
    const map = this.keep(toTexture(fabricCanvas(pattern, z, material, slot.length), pattern === 'smiley' ? 1 : 2));
    const m = this.keep(new THREE.MeshPhysicalMaterial({ map, roughness: 0.85, side: THREE.DoubleSide }));
    switch (material) {
      case 'satin':
        m.roughness = 0.34;
        m.sheen = 0.5;
        m.sheenColor = new THREE.Color(zones[0]).lerp(new THREE.Color(1, 1, 1), 0.25);
        break;
      case 'mesh':
        m.alphaMap = this.keep(toTexture(meshAlphaCanvas(), 10, false));
        m.alphaTest = 0.5;
        m.roughness = 0.7;
        break;
      case 'denim':
        m.roughness = 0.9;
        break;
      case 'leather':
        m.roughness = 0.42;
        m.clearcoat = 0.35;
        break;
      case 'sequin':
        m.metalness = 0.6;
        m.roughness = 0.34;
        m.iridescence = 0.45;
        m.envMapIntensity = 0.55;
        m.color.setScalar(0.8);
        break;
      case 'reflective':
        // chrome that catches the lights without blowing out the frame
        m.metalness = 0.85;
        m.roughness = 0.36;
        m.envMapIntensity = 0.45;
        m.color.setScalar(0.62);
        break;
      case 'holographic':
        m.metalness = 0.5;
        m.roughness = 0.26;
        m.envMapIntensity = 0.6;
        m.iridescence = 1;
        m.iridescenceIOR = 1.6;
        break;
      case 'velvet':
        m.roughness = 0.95;
        m.sheen = 1;
        m.sheenRoughness = 0.55;
        m.sheenColor = new THREE.Color(zones[1]);
        break;
      default:
        break;
    }
    // under blacklight, light and bright fabric glows
    m.emissiveMap = map;
    m.emissive.set(0xffffff);
    m.emissiveIntensity = 0;
    this.glowMats.push({ mat: m, k: 0.35 });
    return m;
  }

  private buildClothes(): void {
    const l = this.look;
    const d = this.d;
    const b = this.bones;
    const item = (slot: Slot) => l.items[slot] ?? null;

    // tops and outer layers share a torso shell builder
    const shell = (slot: Slot, push: number, o: { sleeves: 'none' | 'short' | 'elbow' | 'long'; open?: number; collar?: 'crew' | 'high' | 'shirt' | 'none'; hood?: boolean; puffy?: boolean; length?: number; crop?: boolean }) => {
      const m = this.fabric(slot);
      const trim = this.fabric(slot, 2);
      const gap = o.open ?? 0;
      const ps = gap ? gap / 2 : 0;
      const pl = Math.PI * 2 - gap;
      const lenDrop = o.length ?? 0;
      const bulge = (k: number) => (o.puffy ? 1 + 0.06 * Math.sin(k * Math.PI * 6) ** 2 : 1);
      // a crop stops above the waist and leaves the midriff bare
      if (!o.crop) this.mesh(lathe([[(d.hipsR + push) * 0.98 * bulge(0), -0.11 - lenDrop], [d.hipsR + push, -0.03], [(d.hipsR + d.waistR) / 2 + push, 0.06], [d.waistR + push, 0.135]], d.depth * 1.06, ps, pl), m, b.hips);
      else {
        const hem = this.mesh(new THREE.TorusGeometry(d.chestR * 0.95 + push, 0.005, 6, 28), trim, b.spine, V(0, 0.085 * d.H, 0));
        hem.rotation.x = Math.PI / 2;
        hem.scale.set(1, d.depth * 1.02, 1);
      }
      this.mesh(
        lathe(
          [
            o.crop ? [d.chestR * 0.95 + push, 0.085 * d.H] : [d.waistR + push, -0.03],
            [d.chestR * 0.97 + push * bulge(0.3), 0.1 * d.H],
            [d.chestR + push * bulge(0.6), 0.19 * d.H],
            [d.shoulder * 0.86 + push, 0.3 * d.H],
            [d.shoulder * 0.56 + push, 0.345 * d.H],
            [0.07 + push * 0.5, 0.372 * d.H],
          ],
          d.depth * 1.02,
          ps,
          pl,
        ),
        m,
        b.spine,
      );
      for (const s of ['l', 'r'] as const) {
        if (o.sleeves === 'none') continue;
        const sr = d.armR * 1.18 + push * (o.puffy ? 0.9 : 0.55);
        const capM = this.mesh(new THREE.SphereGeometry(sr, 16, 12), m, b[`shoulder_${s}`], V(0, -0.004, 0));
        capM.scale.set(1, 0.9, 1);
        const len = o.sleeves === 'short' ? d.upperArm * 0.5 : o.sleeves === 'elbow' ? d.upperArm * 0.92 : d.upperArm;
        const loose = o.sleeves === 'long' ? 0.92 : 1.04;
        this.mesh(new THREE.CylinderGeometry(sr, sr * loose, len, 18, 1, o.sleeves !== 'long').translate(0, -len / 2, 0), m, b[`upper_arm_${s}`]);
        if (o.sleeves === 'long') this.mesh(limb(d.armR * 1.02 + push * 0.5, d.foreArm * 0.94, d.armR * 0.85 + push * 0.45), m, b[`forearm_${s}`]);
        if (o.sleeves === 'short' || o.sleeves === 'elbow') {
          const cuff = this.mesh(new THREE.TorusGeometry(sr * 0.98, 0.004, 6, 20), trim, b[`upper_arm_${s}`], V(0, -len + 0.01, 0));
          cuff.rotation.x = Math.PI / 2;
        }
      }
      if (o.collar === 'crew') {
        const c = this.mesh(new THREE.TorusGeometry(0.062 + push * 0.5, 0.006, 6, 24), trim, b.spine, V(0, 0.37 * d.H, 0));
        c.rotation.x = Math.PI / 2;
        c.scale.set(1, d.depth * 1.15, 1);
      } else if (o.collar === 'high') {
        this.mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 20, 1, true), trim, b.neck, V(0, 0.01, 0));
      } else if (o.collar === 'shirt') {
        for (const s of [-1, 1]) {
          const flap = this.mesh(new THREE.BoxGeometry(0.06, 0.004, 0.05), trim, b.spine, V(s * 0.05, 0.36 * d.H, 0.045));
          flap.rotation.set(0.6, 0, s * 0.5);
        }
      }
      if (o.hood) {
        const hood = this.mesh(new THREE.SphereGeometry(d.headR * 1.05, 20, 12, Math.PI * 0.95, Math.PI * 1.1, 0, Math.PI * 0.55), m, b.spine, V(0, 0.36 * d.H, -0.05));
        hood.scale.set(1.1, 0.8, 1);
        hood.rotation.x = 1.2;
      }
    };

    const top = item('top');
    if (top) {
      const map: Record<string, Parameters<typeof shell>[2] & { push?: number }> = {
        tee_vintage: { sleeves: 'elbow', collar: 'crew', push: 0.022, length: 0.03 },
        tee_band: { sleeves: 'short', collar: 'crew' },
        tee_plain: { sleeves: 'short', collar: 'crew' },
        tee_smiley: { sleeves: 'short', collar: 'crew', push: 0.014 },
        shirt_linen: { sleeves: 'elbow', collar: 'shirt', open: 0.5, push: 0.016 },
        shirt_floral: { sleeves: 'short', collar: 'shirt', push: 0.016 },
        shirt_white: { sleeves: 'short', collar: 'shirt' },
        jersey_football: { sleeves: 'short', collar: 'crew', push: 0.014 },
        techwear_top: { sleeves: 'long', collar: 'high', push: 0.012 },
        hoodie: { sleeves: 'long', collar: 'none', hood: true, push: 0.022, length: 0.03 },
        tank_mesh: { sleeves: 'none', collar: 'crew' },
        longsleeve: { sleeves: 'long', collar: 'crew' },
        crop_top: { sleeves: 'none', collar: 'crew', crop: true, push: 0.006 },
        top_sequin: { sleeves: 'none', collar: 'none', crop: true, push: 0.008 },
      };
      const o = map[top] ?? { sleeves: 'short', collar: 'crew' };
      shell('top', o.push ?? 0.01, o);
      // the band tee's faded print and the jersey's number on the chest
      const covered = !!l.items.outer && !['utility_vest', 'jacket_sequin', 'denim_jacket', 'velvet_blazer', 'bomber'].includes(l.items.outer ?? '');
      if ((top === 'tee_band' || top === 'jersey_football') && !covered) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const g = canvas.getContext('2d')!;
        g.fillStyle = zoneColors(l, 'top')[2];
        g.font = `900 ${top === 'jersey_football' ? 150 : 64}px "Barlow Condensed", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.globalAlpha = top === 'tee_band' ? 0.7 : 1;
        g.fillText(top === 'jersey_football' ? '9' : 'LOW END', 128, 128);
        const tex = this.keep(toTexture(canvas));
        const print = this.mesh(new THREE.PlaneGeometry(0.17, 0.17), this.keep(new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9 })), b.spine, V(0, 0.18 * d.H, d.chestR * d.depth * 1.04 + 0.02));
        print.rotation.x = -0.12;
      }
      if (top === 'hoodie' && !l.items.outer) this.mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), this.fabric('top', 2), b.hips, V(0, 0.07, d.waistR * d.depth + 0.03));
    }
    const outer = item('outer');
    if (outer) {
      const map: Record<string, Parameters<typeof shell>[2] & { push?: number }> = {
        utility_vest: { sleeves: 'none', collar: 'high', open: 0.35, push: 0.034 },
        jacket_sequin: { sleeves: 'long', collar: 'shirt', open: 0.55, push: 0.03 },
        shellsuit_top: { sleeves: 'long', collar: 'high', push: 0.032 },
        puffer_metallic: { sleeves: 'long', collar: 'high', puffy: true, push: 0.055 },
        bomber: { sleeves: 'long', collar: 'crew', open: 0.3, push: 0.034 },
        denim_jacket: { sleeves: 'long', collar: 'shirt', open: 0.45, push: 0.03 },
        velvet_blazer: { sleeves: 'long', collar: 'shirt', open: 0.6, push: 0.028, length: 0.06 },
      };
      const o = map[outer] ?? { sleeves: 'long', collar: 'crew', open: 0.4 };
      shell('outer', o.push ?? 0.03, o);
      if (outer === 'utility_vest') for (const s of [-1, 1]) for (const y of [0.1, 0.2]) this.mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), this.fabric('outer', 2), b.spine, V(s * 0.07, y * d.H, d.chestR * d.depth + 0.04));
    }

    // bottoms
    const bottom = item('bottom');
    if (bottom) {
      const m = this.fabric('bottom');
      const baggy = ['cargos_baggy', 'cargos_black', 'cargo_tech', 'joggers'].includes(bottom) ? 0.028 : bottom === 'trousers_flared' ? 0.012 : 0.01;
      const shorts = bottom.startsWith('shorts');
      const skirt = bottom.startsWith('skirt');
      if (skirt) {
        // a short flared skirt from the waist to mid-thigh, legs bare beneath
        this.mesh(lathe([[d.hipsR * 1.32 + 0.03, -0.3], [d.hipsR * 1.12 + 0.012, -0.12], [d.hipsR + 0.012, -0.03], [(d.hipsR + d.waistR) / 2 + 0.008, 0.06], [d.waistR + 0.006, 0.12]], d.depth * 1.1), m, b.hips);
        const band = this.mesh(new THREE.TorusGeometry(d.waistR + 0.008, 0.006, 6, 28), this.fabric('bottom', 2), b.hips, V(0, 0.115, 0));
        band.rotation.x = Math.PI / 2;
        band.scale.set(1, d.depth * 1.1, 1);
      } else this.mesh(lathe([[d.hipsR * 0.92 + baggy, -0.13], [d.hipsR + baggy, -0.03], [(d.hipsR + d.waistR) / 2 + baggy * 0.7, 0.06], [d.waistR + 0.006, 0.12]], d.depth * 1.07), m, b.hips);
      for (const s of ['l', 'r'] as const) {
        if (skirt) continue;
        this.mesh(limb(d.legR * 1.15 + baggy, shorts ? d.thigh * 0.55 : d.thigh, d.legR * 0.95 + baggy), m, b[`thigh_${s}`]);
        if (!shorts) {
          const flare = bottom === 'trousers_flared';
          this.mesh(flare ? new THREE.CylinderGeometry(d.legR * 0.9 + baggy, d.legR * 1.6, d.shin * 0.96, 18, 1, true).translate(0, -d.shin * 0.48, 0) : limb(d.legR * 0.92 + baggy, d.shin * 0.96, d.legR * 0.7 + baggy), m, b[`shin_${s}`]);
        }
        if (bottom.startsWith('cargo')) this.mesh(new THREE.BoxGeometry(0.03, 0.09, 0.07), this.fabric('bottom', 2), b[`thigh_${s}`], V((s === 'l' ? 1 : -1) * (d.legR + baggy + 0.01), -d.thigh * 0.55, 0));
      }
    }
    // socks show above the shoe
    if (item('socks')) for (const s of ['l', 'r'] as const) this.mesh(limb(d.legR * 0.66, 0.13), this.fabric('socks'), b[`shin_${s}`], V(0, -d.shin + 0.13, 0));

    // shoes
    const shoe = item('shoes');
    for (const s of ['l', 'r'] as const) {
      const foot = b[`foot_${s}`];
      if (!shoe) {
        const f = this.mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 12).rotateX(Math.PI / 2), this.skin('thigh'), foot, V(0, -0.045, 0.04));
        f.scale.set(1.1, 0.7, 1);
        continue;
      }
      const upper = this.fabric('shoes');
      const sole = this.fabric('shoes', 2);
      const soleH = { trainers_chunky: 0.04, platforms: 0.08, slides: 0.02, boots_tactical: 0.03, deck_shoes: 0.015, slippers: 0.02, gogo_boots: 0.05 }[shoe] ?? 0.025;
      const so = this.mesh(new THREE.CapsuleGeometry(0.05, 0.16, 4, 16).rotateX(Math.PI / 2), sole, foot, V(0, -0.075 + soleH / 2, 0.045));
      so.scale.set(1.04, soleH / 0.1, 1.02);
      if (shoe === 'slides') {
        this.mesh(new THREE.CapsuleGeometry(0.033, 0.12, 4, 12).rotateX(Math.PI / 2).scale(1.1, 0.65, 1), this.skin('thigh'), foot, V(0, -0.075 + soleH + 0.02, 0.045));
        this.mesh(new THREE.BoxGeometry(0.105, 0.025, 0.07), upper, foot, V(0, -0.075 + soleH + 0.03, 0.08));
        continue;
      }
      const u = this.mesh(new THREE.CapsuleGeometry(0.046, 0.15, 4, 14).rotateX(Math.PI / 2), upper, foot, V(0, -0.075 + soleH + 0.035, 0.045));
      u.scale.set(1.05, shoe === 'slippers' ? 0.95 : 0.78, 1);
      if (shoe === 'gogo_boots') this.mesh(new THREE.CylinderGeometry(d.legR * 0.95 + 0.012, d.legR * 0.66 + 0.01, d.shin * 0.82, 18, 1, true).translate(0, -d.shin * 0.59, 0), upper, b[`shin_${s}`]);
      if (shoe === 'boots_tactical' || shoe === 'high_tops') this.mesh(new THREE.CylinderGeometry(0.056, 0.058, shoe === 'boots_tactical' ? 0.17 : 0.09, 16).translate(0, shoe === 'boots_tactical' ? 0.03 : -0.01, 0), upper, foot);
      if (shoe === 'runners_retro' || shoe === 'trainers_chunky') {
        // a plain stripe down each side (no maker's mark)
        for (const k of [-1, 1]) {
          const stripe = this.mesh(new THREE.BoxGeometry(0.004, 0.012, 0.09), this.fabric('shoes', 3), foot, V(k * 0.049, -0.075 + soleH + 0.03, 0.05));
          stripe.rotation.x = -0.35;
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* accessories                                                       */
  /* ---------------------------------------------------------------- */

  private buildAccessories(): void {
    const l = this.look;
    const d = this.d;
    const b = this.bones;
    const r = d.headR;
    const headTop = V(0, r * 0.95, 0);
    const metal = (c: THREE.ColorRepresentation) => this.std(c, { metalness: 0.95, roughness: 0.22 });

    const hat = l.items.head;
    if (hat) {
      const m = this.fabric('head');
      const m2 = this.fabric('head', 2);
      const crown = (h: number, push = 1.08) => {
        const g = this.mesh(new THREE.SphereGeometry(r * push, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), m, b.head, headTop.clone().add(V(0, r * 0.18, -r * 0.03)));
        g.scale.set(0.94, h, 1);
        return g;
      };
      if (hat === 'cap') {
        crown(0.85);
        const brim = this.mesh(new THREE.CylinderGeometry(r * 0.75, r * 0.75, 0.008, 24, 1, false, -Math.PI / 2, Math.PI), m2, b.head, headTop.clone().add(V(0, r * 0.22, 0)));
        const back = option(l, 'cap_wear') === 'backward';
        brim.position.z += back ? -r * 0.85 : r * 0.85;
        brim.rotation.y = back ? Math.PI : 0;
        brim.rotation.x = back ? -0.12 : 0.12;
      } else if (hat === 'beanie') {
        crown(1.05, 1.1);
        const cuff = this.mesh(new THREE.TorusGeometry(r * 1.02, r * 0.11, 8, 28), m2, b.head, headTop.clone().add(V(0, r * 0.25, -r * 0.03)));
        cuff.rotation.x = Math.PI / 2 - 0.15;
      } else if (hat.startsWith('bucket_hat')) {
        crown(0.8);
        this.mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.5, r * 0.25, 28, 1, true), m, b.head, headTop.clone().add(V(0, r * 0.18, 0)));
      } else if (hat === 'captain_hat') {
        this.mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.0, r * 0.55, 28), m, b.head, headTop.clone().add(V(0, r * 0.5, -r * 0.02)));
        const peak = this.mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.008, 24, 1, false, -Math.PI / 2, Math.PI), this.fabric('head', 2), b.head, headTop.clone().add(V(0, r * 0.25, r * 0.7)));
        peak.rotation.x = 0.25;
        this.mesh(new THREE.SphereGeometry(r * 0.12, 12, 8), this.fabric('head', 3), b.head, headTop.clone().add(V(0, r * 0.5, r * 1.08)));
      } else if (hat === 'hood_tech') {
        // open at the front (±65°) so the face shows
        const hood = this.mesh(new THREE.SphereGeometry(r * 1.32, 28, 18, Math.PI * 0.86, Math.PI * 1.28, 0, Math.PI * 0.7), m, b.head, headTop.clone().add(V(0, r * 0.05, -r * 0.1)));
        hood.scale.set(1, 1.08, 1.05);
      }
    }

    const eyewear = l.items.eyewear;
    if (eyewear) {
      const frame = this.fabric('eyewear', 1);
      const lens = eyewear === 'round_specs' ? this.keep(new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, roughness: 0.05, transparent: true, opacity: 0.25 })) : eyewear === 'shades_tinted' ? this.keep(new THREE.MeshPhysicalMaterial({ color: zoneColors(l, 'eyewear')[0], roughness: 0.05, transparent: true, opacity: 0.6, metalness: 0.2 })) : this.std(eyewear === 'visor_reflective' ? zoneColors(l, 'eyewear')[0] : 0x08080a, { metalness: eyewear === 'visor_reflective' ? 0.95 : 0.4, roughness: 0.08 });
      // in front of the eyes, wherever the face sliders put them
      const eyeAt = this.headPoint(0.33 + slider(l, 'eye_spacing') * 0.06, 0.13, 0.93);
      const eyeY = r * 0.95 + eyeAt.y;
      const z = eyeAt.z + 0.0125 * (1 + slider(l, 'eye_size') * 0.15) * 0.5 + 0.009;
      if (eyewear === 'visor_reflective' || eyewear === 'rave_goggles') {
        const band = this.mesh(new THREE.CylinderGeometry(r * 1.0, r * 1.0, r * (eyewear === 'rave_goggles' ? 0.42 : 0.3), 32, 1, true, -1.1, 2.2), lens, b.head, V(0, eyeY, -r * 0.02));
        band.scale.z = 1.02;
        if (eyewear === 'rave_goggles') {
          const strap = this.mesh(new THREE.TorusGeometry(r * 1.02, 0.006, 6, 32), frame, b.head, V(0, eyeY, -r * 0.02));
          strap.rotation.x = Math.PI / 2;
        }
      } else {
        const size = eyewear === 'shades_oval' ? 0.017 : eyewear === 'cat_eye' ? 0.022 : 0.02;
        for (const s of [-1, 1]) {
          const lx = s * Math.max(r * 0.34, eyeAt.x);
          const lensMesh = this.mesh(new THREE.CircleGeometry(size, 24), lens, b.head, V(lx, eyeY, z));
          lensMesh.scale.set(eyewear === 'shades_oval' ? 1.35 : 1.15, eyewear === 'cat_eye' ? 0.8 : 1, 1);
          lensMesh.rotation.z = eyewear === 'cat_eye' ? s * 0.25 : 0;
          const rim = this.mesh(new THREE.TorusGeometry(size, 0.0018, 6, 24), frame, b.head, V(lx, eyeY, z));
          rim.scale.copy(lensMesh.scale);
          rim.rotation.z = lensMesh.rotation.z;
          const arm = this.mesh(new THREE.BoxGeometry(0.003, 0.003, r * 0.95), frame, b.head, V(s * r * 0.85, eyeY + 0.004, z * 0.5));
          void arm;
        }
        this.mesh(new THREE.BoxGeometry(r * 0.25, 0.003, 0.003), frame, b.head, V(0, eyeY + 0.004, z + 0.002));
      }
    }

    const phones = l.items.headphones;
    if (phones) {
      const g = new THREE.Group();
      const [c1, c2] = zoneColors(l, 'headphones');
      const big = ['hp_bass', 'hp_neon', 'hp_studio', 'hp_gold'].includes(phones) ? 1.25 : phones === 'hp_minimal' || phones === 'hp_wireless' ? 0.85 : 1;
      const cupMat = this.std(c1, { roughness: phones === 'hp_gold' ? 0.2 : 0.45, metalness: phones === 'hp_gold' ? 0.9 : 0.1 });
      const padMat = this.std(c2, { roughness: 0.85 });
      const band = this.mesh(new THREE.TorusGeometry(r * 1.12, 0.008 * big, 8, 32, Math.PI), cupMat, g);
      band.rotation.z = 0;
      for (const s of [-1, 1]) {
        const cup = this.mesh(new THREE.CylinderGeometry(0.035 * big, 0.035 * big, 0.026 * big, 20).rotateZ(Math.PI / 2), cupMat, g, V(s * r * 1.12, -0.005, 0));
        this.mesh(new THREE.CylinderGeometry(0.031 * big, 0.031 * big, 0.012, 20).rotateZ(Math.PI / 2), padMat, cup, V(-s * 0.016 * big, 0, 0));
        if (phones === 'hp_cat_led') this.mesh(new THREE.ConeGeometry(0.02, 0.04, 4), this.std(c2, { emissive: new THREE.Color(c2), emissiveIntensity: 1.6 }), g, V(s * r * 0.6, r * 1.0, 0));
      }
      const wear = option(l, 'phones_wear');
      if (wear === 'neck') {
        // round the neck: band behind, cups resting on the collarbones
        g.position.set(0, 0.0, -0.01);
        g.rotation.x = Math.PI / 2 + 0.25;
        g.scale.setScalar(0.92);
        b.neck.add(g);
      } else {
        g.position.copy(headTop).add(V(0, r * 0.05, -r * 0.02));
        if (wear === 'one_ear') g.rotation.z = 0.35;
        b.head.add(g);
      }
      this.headphones = g;
      this.headphonesHome = { parent: g.parent!, pos: g.position.clone(), rot: g.rotation.clone() };
    }

    const neck = l.items.neck;
    if (neck) {
      if (neck.startsWith('chain')) {
        const c = this.mesh(new THREE.TorusGeometry(0.07, 0.0035, 6, 32), metal(zoneColors(l, 'neck')[0]), b.spine, V(0, 0.35 * d.H, 0.035));
        c.rotation.x = Math.PI / 2 + 0.5;
        c.scale.set(1, 1.25, 1);
      } else if (neck === 'lanyard') {
        const c = this.mesh(new THREE.TorusGeometry(0.075, 0.004, 4, 28), this.fabric('neck'), b.spine, V(0, 0.3 * d.H, 0.04));
        c.rotation.x = Math.PI / 2 + 0.7;
        c.scale.set(1, 1.8, 1);
        this.mesh(new THREE.BoxGeometry(0.05, 0.07, 0.004), this.fabric('neck', 2), b.spine, V(0, 0.2 * d.H, d.chestR * d.depth + 0.03));
      } else if (neck === 'bandana') {
        this.mesh(new THREE.ConeGeometry(0.085, 0.07, 3).rotateX(Math.PI), this.fabric('neck'), b.spine, V(0, 0.34 * d.H, 0.045));
      }
    }

    const wrists = l.items.wrists;
    if (wrists) {
      const hand = b.hand_l;
      if (wrists.startsWith('watch')) {
        this.mesh(new THREE.TorusGeometry(d.armR * 0.78, 0.005, 6, 20).rotateX(Math.PI / 2), this.fabric('wrists', 2), hand, V(0, 0.015, 0));
        this.mesh(new THREE.BoxGeometry(0.028, 0.008, 0.028), metal(zoneColors(l, 'wrists')[0]), hand, V(0, 0.015, d.armR * 0.75));
      } else if (wrists === 'wristbands') {
        const z = zoneColors(l, 'wrists');
        for (const [i, hb] of [b.hand_l, b.hand_r].entries()) for (let k = 0; k < 3; k++) this.mesh(new THREE.TorusGeometry(d.armR * 0.8, 0.003, 4, 18).rotateX(Math.PI / 2), this.std(z[(k + i) % 3]), hb, V(0, 0.01 + k * 0.007, 0));
      } else if (wrists === 'rings') {
        for (const [i, hb] of [b.hand_l, b.hand_r].entries()) for (let k = 0; k < 2; k++) this.mesh(new THREE.TorusGeometry(0.009, 0.0022, 6, 12).rotateX(Math.PI / 2), metal(zoneColors(l, 'wrists')[(k + i) % 2]), hb, V((k - 0.5) * 0.02, -0.08, 0));
      }
    }

    const bag = l.items.bag;
    if (bag === 'record_bag') {
      this.mesh(new THREE.BoxGeometry(0.06, 0.3, 0.32), this.fabric('bag'), b.hips, V(-d.hipsR - 0.05, 0.0, 0));
      const strap = this.mesh(new THREE.TorusGeometry(0.24, 0.008, 4, 32), this.fabric('bag', 2), b.spine, V(0, 0.12, 0));
      strap.rotation.set(Math.PI / 2, 0.75, 0);
      strap.scale.set(1, 0.62, 1);
    } else if (bag === 'towel') {
      const tw = this.mesh(new THREE.BoxGeometry(0.11, 0.012, 0.34), this.fabric('bag'), b.shoulder_l, V(-0.02, 0.05, 0));
      tw.rotation.z = 0.25;
    }

    // piercings
    const at = (x: number, y: number, z: number, push = 0.003) => {
      const q = this.headPoint(x, y, z);
      return q.add(q.clone().normalize().multiplyScalar(push)).add(V(0, r * 0.95, 0));
    };
    const pos: Record<string, THREE.Vector3> = {
      ear_lobe_l: at(1, -0.25, -0.05, 0.006),
      ear_lobe_r: at(-1, -0.25, -0.05, 0.006),
      ear_helix_l: at(0.95, 0.25, -0.15, 0.012),
      ear_helix_r: at(-0.95, 0.25, -0.15, 0.012),
      nose_stud: at(0.12, -0.25, 1, 0.012),
      nose_ring: at(-0.12, -0.28, 1, 0.012),
      septum: at(0, -0.31, 1, 0.006),
      brow_l: at(0.5, 0.3, 0.85),
      brow_r: at(-0.5, 0.3, 0.85),
      lip_l: at(0.2, -0.5, 0.95),
      lip_r: at(-0.2, -0.5, 0.95),
      labret: at(0, -0.62, 0.92),
    };
    const silver = metal(0xd9dde3);
    for (const p of l.piercings) {
      const q = pos[p];
      if (!q) continue;
      if (p.includes('ring') || p === 'septum' || p.startsWith('ear_helix')) this.mesh(new THREE.TorusGeometry(0.005, 0.0012, 6, 12), silver, b.head, q);
      else this.mesh(new THREE.SphereGeometry(0.0025, 8, 6), silver, b.head, q);
    }
  }

  /* ---------------------------------------------------------------- */
  /* moving                                                            */
  /* ---------------------------------------------------------------- */

  /** a bottle in the hand for the sip, a towel for the wipe */
  private holdProp(kind: 'bottle' | 'towel' | null): void {
    if (this.prop) {
      this.prop.removeFromParent();
      this.prop = null;
    }
    if (!kind) return;
    const g = new THREE.Group();
    if (kind === 'bottle') {
      const m = this.keep(new THREE.MeshPhysicalMaterial({ color: 0xbfd8e8, transmission: 0.8, roughness: 0.1, transparent: true, opacity: 0.6 }));
      this.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 14), m, g, V(0, -0.1, 0.03));
    } else this.mesh(new THREE.BoxGeometry(0.12, 0.03, 0.16), this.std(0xf4f4f2, { roughness: 0.95 }), g, V(0, -0.09, 0.03));
    this.bones.hand_r.add(g);
    this.prop = g;
  }

  update(s: AvatarInput, dt: number): void {
    const b = this.bones;
    const l = this.look;
    this.t += dt;
    const beat = s.playing ? s.beat : this.t * 1.0;
    const ph = ((beat % 1) + 1) % 1;
    const hit = (1 - ph) * (1 - ph);
    const knee = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2);
    const groove = option(l, 'groove');
    const amp = s.playing ? 1 : 0.35;
    if (s.dropHit) this.dropT = 0;
    else this.dropT += dt;
    this.cheerT += dt;
    if (s.playing) this.sweat = Math.min(1, this.sweat + dt / 900);

    // rest pose
    for (const o of Object.values(b)) o.rotation.set(0, 0, 0);
    b.hips.position.set(0, this.d.hipY, 0);
    this.body.position.y = 0;
    if (this.mode === 'hype') {
      this.dance(s, beat, ph, hit, knee, dt);
      this.settle(dt);
      return;
    }
    if (this.mode === 'surf') {
      // arms out wide, legs kicking, loving it
      const k = this.t * 3;
      for (const [arm, sgn] of [['l', 1], ['r', -1]] as const) {
        b[`upper_arm_${arm}`].rotation.set(0, 0, sgn * (1.5 + 0.25 * Math.sin(k + sgn)));
        b[`forearm_${arm}`].rotation.set(-0.3, 0, 0);
        b[`thigh_${arm}`].rotation.set(-0.2 - 0.25 * Math.max(0, Math.sin(k * 1.3 + sgn)), 0, sgn * 0.18);
        b[`shin_${arm}`].rotation.x = 0.4 + 0.3 * Math.max(0, Math.sin(k * 1.3 + sgn));
      }
      b.neck.rotation.x = -0.3;
      this.settle(dt);
      return;
    }
    const dj = this.mode === 'dj';

    // the groove, locked to the beat
    let bob = 0;
    let nod = 0;
    let shoulders = 0;
    let sway = 0;
    let twist = 0;
    switch (groove) {
      case 'head_nod':
        nod = 0.16 * hit;
        bob = 0.008 * knee;
        break;
      case 'shoulder_bounce':
        shoulders = 0.025 * hit;
        nod = 0.07 * hit;
        bob = 0.012 * knee;
        break;
      case 'two_step':
        sway = 0.045 * Math.sin(beat * Math.PI);
        bob = 0.016 * knee;
        nod = 0.06 * hit;
        break;
      case 'full_body':
        bob = 0.04 * knee;
        nod = 0.12 * hit;
        twist = 0.12 * Math.sin(beat * Math.PI * 0.5);
        shoulders = 0.02 * hit;
        break;
      default:
        nod = 0.02 * hit;
    }
    bob *= amp;
    nod *= amp;
    b.hips.position.y -= bob;
    b.hips.position.x = sway * amp;
    b.hips.rotation.z = -sway * 0.6 * amp;
    b.spine.rotation.y = twist * amp;
    // knees take the bounce
    const bend = bob * 6;
    for (const side of ['l', 'r'] as const) {
      const step = groove === 'two_step' ? Math.max(0, Math.sin(beat * Math.PI) * (side === 'l' ? 1 : -1)) * 0.25 * amp : 0;
      b[`thigh_${side}`].rotation.x = -bend - step;
      b[`shin_${side}`].rotation.x = bend * 2 + step * 1.6;
      b[`foot_${side}`].rotation.x = -bend - step * 0.6;
    }
    b.neck.rotation.x = nod + (dj ? 0.32 : 0.05);
    b.spine.rotation.x = dj ? 0.12 : 0;
    b.shoulder_l.position.y = 0.185 * this.d.H + shoulders * amp;
    b.shoulder_r.position.y = 0.185 * this.d.H + shoulders * amp;

    // arms: on the decks (hands moving with the mix), or loose at the sides
    const mixL = Math.sin(beat * Math.PI * 0.25) * 0.12;
    const mixR = Math.sin(beat * Math.PI * 0.125 + 1.3) * 0.15;
    const setArm = (side: 'l' | 'r', ux: number, uz: number, fx: number, uy = 0) => {
      const k = side === 'l' ? 1 : -1;
      b[`upper_arm_${side}`].rotation.set(ux, uy * k, uz * k);
      b[`forearm_${side}`].rotation.set(fx, 0, 0);
    };
    if (dj) {
      setArm('l', -0.85 + mixL, 0.32, -0.75 - mixL * 0.5);
      setArm('r', -0.85 + mixR, 0.32, -0.75 - mixR * 0.5);
    } else {
      const swing = groove === 'full_body' ? 0.3 : 0.12;
      setArm('l', Math.sin(beat * Math.PI) * swing * amp, 0.12, -0.2 - hit * 0.15 * amp);
      setArm('r', -Math.sin(beat * Math.PI) * swing * amp, 0.12, -0.2 - hit * 0.15 * amp);
    }

    // the signature drop move, for the first 8 beats of a drop
    const beatLen = 60 / 124;
    let dropping = false;
    if (this.dropT < beatLen * 8) {
      dropping = true;
      const move = option(l, 'drop_move');
      const pump = hit;
      if (move === 'hands_up') {
        setArm('l', -0.4, 2.6 + pump * 0.15, -0.3);
        setArm('r', -0.4, 2.6 + pump * 0.15, -0.3);
      } else if (move === 'point') {
        setArm('r', -2.3 - pump * 0.15, 0.25, -0.05);
      } else if (move === 'fist_pump') {
        setArm('r', -2.1 - pump * 0.6, 0.35, -1.0 + pump * 0.6);
      } else if (move === 'jump') {
        this.body.position.y = Math.max(0, Math.sin(ph * Math.PI)) * 0.14;
        setArm('l', -0.3, 2.4, -0.4);
        setArm('r', -0.3, 2.4, -0.4);
      } else if (move === 'headphones_up') {
        setArm('r', -0.6, 2.7, -0.2);
        if (this.headphones && this.headphones.parent !== b.hand_r) {
          b.hand_r.add(this.headphones);
          this.headphones.position.set(0, -0.12, 0);
          this.headphones.rotation.set(0, 0, Math.PI / 2);
        }
      }
    }
    if (!dropping && this.headphones && this.headphonesHome && this.headphones.parent !== this.headphonesHome.parent) {
      this.headphonesHome.parent.add(this.headphones);
      this.headphones.position.copy(this.headphonesHome.pos);
      this.headphones.rotation.copy(this.headphonesHome.rot);
    }

    // the between-mix habit: two bars every 32, away from the drop and the peak
    const bar = Math.floor(beat / 4);
    const habitOn = s.playing && !dropping && s.peak < 0.4 && bar % 32 >= 28 && bar % 32 < 30;
    const habit = option(l, 'between_habit');
    if (habitOn) {
      const t = ((beat / 8) % 1 + 1) % 1;
      if (habit === 'sip') {
        if (this.habitAt !== bar) this.holdProp('bottle');
        setArm('r', -1.6 - Math.sin(t * Math.PI) * 0.4, 0.45, -1.9);
        b.neck.rotation.x = -0.25 * Math.sin(t * Math.PI);
      } else if (habit === 'wipe') {
        if (this.habitAt !== bar) this.holdProp(l.items.bag === 'towel' ? 'towel' : null);
        setArm('r', -2.0, 0.2 + Math.sin(t * Math.PI * 4) * 0.25, -1.6);
      } else {
        setArm('r', -0.3, 2.5, -0.3 + Math.sin(beat * Math.PI * 2) * 0.35);
      }
      this.habitAt = bar;
    } else if (this.prop) this.holdProp(null);

    this.settle(dt);
  }

  /** a HELL YEAH: a jump and a sparkler bottle held high, for two bars */
  cheer(): void {
    this.cheerT = 0;
  }

  /** your signature drop move, now (a HELL YEAH at the decks) */
  celebrate(): void {
    this.dropT = 0;
  }

  /** the hype dancers' routine, locked to the beat */
  private dance(s: AvatarInput, beat: number, ph: number, hit: number, knee: number, dt: number): void {
    const b = this.bones;
    const amp = s.playing ? 1 : 0.4;
    const beatLen = 60 / 124;
    const setArm = (arm: 'l' | 'r', ux: number, uz: number, fx: number, uy = 0) => {
      const k = arm === 'l' ? 1 : -1;
      b[`upper_arm_${arm}`].rotation.set(ux, uy * k, uz * k);
      b[`forearm_${arm}`].rotation.set(fx, 0, 0);
    };
    const sway = Math.sin(beat * Math.PI);
    // the hips sway a side a beat and the knees take the bounce
    const bob = 0.03 * knee * amp;
    b.hips.position.y -= bob;
    b.hips.position.x = 0.05 * sway * amp;
    b.hips.rotation.z = -0.14 * sway * amp;
    b.hips.rotation.y = 0.16 * Math.sin(beat * Math.PI * 0.5) * amp;
    b.spine.rotation.z = 0.1 * sway * amp;
    for (const leg of ['l', 'r'] as const) {
      const step = Math.max(0, sway * (leg === 'l' ? 1 : -1)) * 0.18 * amp;
      b[`thigh_${leg}`].rotation.x = -bob * 6 - step;
      b[`shin_${leg}`].rotation.x = bob * 12 + step * 1.6;
      b[`foot_${leg}`].rotation.x = -bob * 6 - step * 0.6;
    }
    // the arm nearest the DJ, for pointing at them
    const near: 'l' | 'r' = this.side < 0 ? 'r' : 'l';
    const far: 'l' | 'r' = near === 'l' ? 'r' : 'l';
    const MOVES = ['wave', 'sway', 'point', 'hair', 'roll', 'wave', 'point', 'sway'] as const;
    const bar = Math.floor(beat / 4);
    const move = s.build > 0.5 ? 'clap' : MOVES[(Math.floor(bar / 2) + this.seed) % MOVES.length];
    switch (move) {
      case 'wave':
        setArm('l', -0.3, 2.45 + 0.22 * sway * amp, -0.35);
        setArm('r', -0.3, 2.45 - 0.22 * sway * amp, -0.35);
        break;
      case 'sway':
        setArm(far, -0.3, 2.3 + 0.35 * hit * amp, -0.3);
        setArm(near, 0.25 * sway, 0.3, -0.5);
        break;
      case 'point':
        // "this one!": pointing at the DJ, a jab on every beat
        setArm(near, -0.35, 1.45 + 0.12 * hit * amp, -0.08);
        setArm(far, -0.3, 2.35 + 0.3 * hit * amp, -0.4);
        b.spine.rotation.y = -this.side * 0.35;
        b.neck.rotation.y = -this.side * 0.4;
        break;
      case 'hair':
        setArm('l', -0.25, 2.5, -1.9);
        setArm('r', -0.25, 2.5, -1.9);
        b.neck.rotation.z = 0.3 * sway * amp;
        b.neck.rotation.x = 0.18 * Math.cos(beat * Math.PI * 2) * amp;
        break;
      case 'roll':
        b.spine.rotation.x = 0.22 * Math.sin(beat * Math.PI * 2) * amp;
        b.hips.rotation.x = -0.15 * Math.sin(beat * Math.PI * 2) * amp;
        setArm('l', -0.35, 2.7 + 0.1 * sway * amp, -0.9);
        setArm('r', -0.35, 2.7 - 0.1 * sway * amp, -0.9);
        break;
      case 'clap':
        // the build: clapping overhead, hands meeting on the beat
        setArm('l', -0.3, 2.4 + 0.5 * hit, -0.4);
        setArm('r', -0.3, 2.4 + 0.5 * hit, -0.4);
        break;
    }
    // the drop: jumping, both arms up, for two bars
    if (this.dropT < beatLen * 8) {
      this.body.position.y = Math.max(0, Math.sin(ph * Math.PI)) * 0.16;
      setArm('l', -0.25, 2.65, -0.3);
      setArm('r', -0.25, 2.65, -0.3);
    }
    // HELL YEAH: the sparkler bottle up high, the other fist pumping
    const cheering = this.cheerT < beatLen * 8;
    if (cheering) {
      this.body.position.y = Math.max(0, Math.sin(ph * Math.PI)) * 0.2;
      setArm('r', -0.25, 2.75, -0.2);
      setArm('l', -0.5, 2.1 + 0.45 * hit, -1.3 + 0.5 * hit);
    }
    this.sparkle(cheering, dt);
  }

  /** the sparkler bottle: built once, shown on a cheer, its sparks fall in world space */
  private sparkle(on: boolean, dt: number): void {
    if (!on && !this.sparkler) return;
    if (!this.sparkler) {
      const group = new THREE.Group();
      const glass = this.std(0x0f3a22, { roughness: 0.15, metalness: 0.2 });
      const foil = this.std(0xd4a64a, { roughness: 0.3, metalness: 0.9 });
      this.mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.2, 16), glass, group, V(0, -0.12, 0.03));
      this.mesh(new THREE.CylinderGeometry(0.013, 0.034, 0.09, 16), foil, group, V(0, -0.265, 0.03));
      this.mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 6), this.std(0x8a8580), group, V(0, -0.36, 0.03));
      const N = 60;
      const geo = this.keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const mat = this.keep(new THREE.PointsMaterial({ color: new THREE.Color(2.2, 1.5, 0.7), size: 0.022, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      const sparks = new THREE.Points(geo, mat);
      sparks.frustumCulled = false;
      group.add(sparks);
      this.bones.hand_r.add(group);
      this.sparkler = { group, sparks, vel: new Float32Array(N * 3), life: new Float32Array(N) };
    }
    const sp = this.sparkler;
    sp.group.visible = on;
    if (!on) return;
    const pos = sp.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    // gravity, turned into the hand's frame
    this.object.updateMatrixWorld(true);
    const g = new THREE.Vector3(0, -2.5, 0).applyQuaternion(sp.group.getWorldQuaternion(new THREE.Quaternion()).invert());
    const h = Math.min(dt, 0.05);
    for (let i = 0; i < sp.life.length; i++) {
      sp.life[i] -= h;
      if (sp.life[i] <= 0) {
        sp.life[i] = 0.25 + Math.random() * 0.35;
        arr[i * 3] = 0;
        arr[i * 3 + 1] = -0.41;
        arr[i * 3 + 2] = 0.03;
        const a = Math.random() * Math.PI * 2;
        const r = 0.4 + Math.random() * 0.6;
        sp.vel[i * 3] = Math.cos(a) * r;
        sp.vel[i * 3 + 1] = -0.6 - Math.random() * 0.8;
        sp.vel[i * 3 + 2] = Math.sin(a) * r;
      }
      sp.vel[i * 3] += g.x * h;
      sp.vel[i * 3 + 1] += g.y * h;
      sp.vel[i * 3 + 2] += g.z * h;
      arr[i * 3] += sp.vel[i * 3] * h;
      arr[i * 3 + 1] += sp.vel[i * 3 + 1] * h;
      arr[i * 3 + 2] += sp.vel[i * 3 + 2] * h;
    }
    pos.needsUpdate = true;
  }

  /** blinking, the hair's springs, sweat and blacklight: every mode */
  private settle(dt: number): void {
    const b = this.bones;
    // blinking
    this.blinkAt -= dt;
    const blink = this.blinkAt < 0 ? 1 : 0;
    if (this.blinkAt < -0.12) this.blinkAt = 2.5 + Math.random() * 3.5;
    for (const lid of this.lids) lid.rotation.x = blink ? 0.6 : -0.35;

    // hair swings: springs pushed by how the head moves
    this.object.updateMatrixWorld(true);
    const hp = b.head.getWorldPosition(new THREE.Vector3());
    const dv = hp.clone().sub(this.lastHead);
    this.lastHead.copy(hp);
    if (dt > 0 && dv.lengthSq() < 0.05) {
      const span = Math.min(dt, 0.1);
      const steps = Math.ceil(span / (1 / 120));
      const h = span / steps;
      // the head's velocity kicks the hair once per frame, then the springs settle in small steps
      const kx = -(dv.z / dt) * 0.9 * 60;
      const kz = (dv.x / dt) * 0.9 * 60;
      for (const sp of this.springs) {
        sp.vx += kx * sp.k * span * Math.min(1, 0.016 / Math.max(0.016, dt));
        sp.vz += kz * sp.k * span * Math.min(1, 0.016 / Math.max(0.016, dt));
        for (let i = 0; i < steps; i++) {
          sp.vx += (-sp.ox * 60 - sp.vx * 7) * h;
          sp.vz += (-sp.oz * 60 - sp.vz * 7) * h;
          sp.ox = Math.max(-0.5, Math.min(0.5, sp.ox + sp.vx * h));
          sp.oz = Math.max(-0.5, Math.min(0.5, sp.oz + sp.vz * h));
        }
        sp.obj.rotation.set(sp.ox - b.neck.rotation.x * 0.6 * sp.k, 0, sp.oz);
      }
    }

    // sweat: the skin gets a sheen through a long set; blacklight makes UV paint and fabric glow
    for (const m of this.skinMats) {
      m.roughness = 0.62 - this.sweat * 0.35;
      m.clearcoat = this.sweat * 0.55;
    }
    for (const g of this.glowMats) g.mat.emissiveIntensity = this.uv * g.k;
  }
}
