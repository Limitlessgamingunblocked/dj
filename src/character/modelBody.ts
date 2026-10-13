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
 *   regions    the mesh comes in skin regions (chest, neck, upper_arm_l…, as
 *              the game names the skin's parts). A region shows unless clothes
 *              cover it or it carries tattoos (tattoos are drawn for the
 *              code-built parts' UVs, so those parts stay code-built)
 * The head, hair and clothes are still code-built.
 */
import * as THREE from 'three';
import type { Look } from '../core/models';
import { hasModel, loadModel } from '../three/assets';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
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
const _s = new THREE.Vector3();
const ID = new THREE.Quaternion();

export class ModelBody {
  readonly object: THREE.Object3D;
  private links: Link[] = [];
  private meshes: THREE.SkinnedMesh[] = [];
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
  ) {
    if (!ready) throw new Error('body model not loaded');
    // a copy of the loaded scene (skinned meshes keep their own skeleton)
    this.object = SkeletonUtils.clone(ready.scene);
    this.object.updateMatrixWorld(true);

    const modelBones = new Map<string, THREE.Bone>();
    this.object.traverse((o) => {
      if ((o as THREE.Bone).isBone) modelBones.set(o.name, o as THREE.Bone);
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        const region = String((m.material as THREE.Material).name).replace(/^skin_/, '') as BodyRegion;
        m.visible = show.has(region);
        m.material = skin;
        m.castShadow = true;
        m.frustumCulled = false;
        this.meshes.push(m);
      }
    });

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
      link(`forearm_${s}`, bones[`forearm_${s}`], 'game', { to: bones[`hand_${s}`], toName: `hand_${s}` });
      link(`hand_${s}`, bones[`hand_${s}`], 'game');
      const h = hands[s];
      if (h) {
        // the game's fingers run from the little finger (x−) to the index (x+) on
        // the left hand, the other way on the right: order them index first
        const xs = h.fingers.map((f) => f.knuckle.position.x * (s === 'l' ? 1 : -1));
        const order = h.fingers.map((_, i) => i).sort((a, b) => xs[b] - xs[a]);
        ['index', 'middle', 'ring', 'pinky'].forEach((name, k) => {
          const f = h.fingers[order[k]];
          if (!f) return;
          link(`${name}_01_${s}`, f.knuckle, 'rigid');
          link(`${name}_02_${s}`, f.mid, 'rigid');
          link(`${name}_03_${s}`, f.mid, 'rigid', { extra: f.mid });
        });
        const tr = new THREE.Quaternion().setFromEuler(h.thumbRest);
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
  }
}
