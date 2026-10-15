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
 *            a between-mix habit every 32 bars, blinking, sweat building up;
 *            a hand goes to whatever control you touch (two-bone reach) and
 *            holds it the way that control is held: a knob pinched and the
 *            wrist turning with it, fingertips riding a fader, the palm flat
 *            on a platter going round with the record, a finger tapping a pad;
 *            cueing, a hand holds the cup to the ear for two bars in four
 *   face     expressions blended from the show: a stank face on the drop,
 *            eyes shut and chin up in the breakdown, wide eyes at the top of
 *            the build, mouthing along to a vocal, a grin when the room peaks,
 *            a frown of focus on a control, a brow flash for a clean blend
 *            and a wince at a mistake (brows, lids, cheeks, lip corners, jaw)
 *   robot    the robot DJ: a helmet or cartoon robot head in place of the
 *            face and hair (its LEDs, eyes and mouth follow the expressions,
 *            see robot.ts), segmented chrome or gold hands, a glossy black
 *            jacket and trousers with white piping
 *   hype     the dancers by the booth: a new move every two bars (sway, wave,
 *            hair flip, point at the DJ, body roll, clap in the build), and a
 *            jump on the drop
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Look } from '../core/models';
import { FACE_SHAPE_BASE, ROBOT_HANDS, ROBOT_HEADS, type FaceShape, type Slot } from './catalog';
import { option, slider, slotMaterial, slotPattern, zoneColors } from './look';
import { fabricCanvas, irisCanvas, leatherCanvases, weaveCanvases, meshAlphaCanvas, skinCanvas, skinTone, toTexture } from './textures';
import { applyPose, type ClubDancer } from './clubDance';
import { bodyReady, cutCovers, ModelBody, modelRegions, modelTuck, preloadBody, preloadScan, scanFrame, scanReady, type BodyRegion, type ClothCut, type Cover } from './modelBody';
import { hasModel } from '../three/assets';
import { buildRobotHead, buildRobotNeck, metalMat, pearlMat, robotFace, rubberMat, type RobotHead, type RobotKit } from './robot';

export type BoneName = 'hips' | 'spine' | 'chest' | 'neck' | 'head' | 'shoulder_l' | 'upper_arm_l' | 'forearm_l' | 'hand_l' | 'shoulder_r' | 'upper_arm_r' | 'forearm_r' | 'hand_r' | 'thigh_l' | 'shin_l' | 'foot_l' | 'thigh_r' | 'shin_r' | 'foot_r';

/** moves from the pads (DJ moves): each plays for a few beats, then you're back on the decks */
export type DjMove = 'hands_up' | 'jump' | 'point' | 'clap' | 'fist_pump' | 'climb';
export const DJ_MOVES: { id: DjMove; label: string; beats: number }[] = [
  { id: 'hands_up', label: 'Hands up', beats: 8 },
  { id: 'jump', label: 'Jump', beats: 4 },
  { id: 'point', label: 'Point', beats: 4 },
  { id: 'clap', label: 'Clap', beats: 8 },
  { id: 'fist_pump', label: 'Fist pump', beats: 8 },
  { id: 'climb', label: 'On the booth', beats: 16 },
];

/** what the avatar reads each frame (a subset of the show state) */
export interface AvatarInput {
  beat: number;
  playing: boolean;
  dropHit: boolean;
  peak: number;
  build: number;
  kick: number;
  /** how much a vocal carries the track (0..1): the mouth goes with it */
  vocal?: number;
  /** the crowd's energy (0..1): a grin when it's up */
  hype?: number;
  /** a hook line landing (0..1 envelope): sung a little harder */
  accent?: number;
}

/** how a hand holds a control: pinch a knob, ride a fader, flat on a jog, press a button, or just a grip */
export type HandHold = 'knob' | 'fader' | 'jog' | 'press' | 'grip';

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
  /** how far out the hip joints sit (from the hips' width unless a scanned person says) */
  hipX?: number;
}

function dims(l: Look): Dims {
  const H = 1 + 0.07 * slider(l, 'height');
  const L = 1 + 0.08 * slider(l, 'leg_length');
  const W = 1 + 0.2 * slider(l, 'body_weight');
  const M = 1 + 0.14 * slider(l, 'muscle_definition');
  const thigh = 0.43 * H * L;
  const shin = 0.42 * H * L;
  // the robot suit is padded: broad in the shoulders and the chest, the arms set wider to clear it
  // (only the code-built suit: the modelled one is padded round the model's own shoulders)
  const suit = l.items.outer === 'jacket_robot' && !bodyReady() ? 1 : 0;
  return {
    H,
    shoulder: (0.18 + 0.03 * slider(l, 'shoulder_width')) * (0.96 + 0.04 * M) * Math.sqrt(H) * (1 + 0.2 * suit),
    chestR: (0.15 + 0.022 * slider(l, 'chest')) * W * (0.97 + 0.03 * M) * (1 + 0.1 * suit),
    waistR: (0.125 + 0.025 * slider(l, 'waist')) * W * (1 + 0.08 * suit),
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
    // a scanned person keeps their own proportions: the skeleton takes their limbs' lengths
    // (the model's limbs would otherwise be stretched to the game's)
    ...scanBuild(l),
  };
}

/** the skeleton's lengths from the scanned person the look wears, when it's loaded */
function scanBuild(l: Look): Partial<Dims> {
  const scan = l.options.scan;
  const f = typeof scan === 'string' && scanReady(scan) ? scanFrame(scan) : null;
  if (!f) return {};
  // the hips high enough for the feet to stand where the model's do (the thighs hang 3 cm under the hips)
  return { upperArm: f.upperArm, foreArm: f.foreArm, thigh: f.thigh, shin: f.shin, shoulder: f.shoulder, hipX: f.hipX, hipY: f.footY + f.thigh + f.shin + 0.03 };
}

/** how a shell is cut: sleeves, collar, opening, hood, puffiness, length, cropped */
interface ShellStyle {
  sleeves: 'none' | 'short' | 'elbow' | 'long';
  open?: number;
  collar?: 'crew' | 'high' | 'shirt' | 'none';
  hood?: boolean;
  puffy?: boolean;
  length?: number;
  crop?: boolean;
  push?: number;
  /** the zone the collar, cuffs and hem take (2 unless said) */
  trim?: 1 | 2 | 3;
  /** white piping down the sleeves and over the shoulders (zone 2), the cuffs and collar ribbed */
  piping?: boolean;
  /** padded: the sleeves this many times as thick */
  padded?: number;
}

/** a sleeve's radius round the shoulder cap, at the elbow and at the cuff */
function sleeveRadii(d: Dims, o: ShellStyle, push: number): { cap: number; elbow: number; cuff: number } {
  const pad = o.padded ?? 1;
  return {
    cap: (d.armR * 1.18 + push * (o.puffy ? 0.9 : 0.55)) * pad,
    elbow: (d.armR * 1.02 + push * 0.5) * pad,
    cuff: (d.armR * 0.85 + push * 0.45) * pad,
  };
}

/** the robot DJ's patent-shiny pieces */
const ROBOT_LEATHER = new Set(['jacket_robot', 'pants_robot', 'boots_robot']);
/** how much bigger the robot hands are than a person's */
const ROBOT_HAND_SCALE = 1.32;

/** each top's cut */
const TOP_STYLE: Record<string, ShellStyle> = {
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

/** each outer layer's cut */
const OUTER_STYLE: Record<string, ShellStyle> = {
  utility_vest: { sleeves: 'none', collar: 'high', open: 0.35, push: 0.034 },
  jacket_sequin: { sleeves: 'long', collar: 'shirt', open: 0.55, push: 0.03 },
  shellsuit_top: { sleeves: 'long', collar: 'high', push: 0.032 },
  puffer_metallic: { sleeves: 'long', collar: 'high', puffy: true, push: 0.055 },
  bomber: { sleeves: 'long', collar: 'crew', open: 0.3, push: 0.034 },
  denim_jacket: { sleeves: 'long', collar: 'shirt', open: 0.45, push: 0.03 },
  velvet_blazer: { sleeves: 'long', collar: 'shirt', open: 0.6, push: 0.028, length: 0.06 },
  jacket_robot: { sleeves: 'long', collar: 'high', push: 0.034, trim: 3, piping: true, padded: 1.3 },
};

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

/**
 * Two-bone reach for a limb hanging along −Y from its joint, bending at the
 * elbow about its own X axis (towards +Z): the joint's rotation and the elbow
 * bend that put the end on `t` (in the joint's parent space, relative to the
 * joint), with the elbow out towards `pole`. Out of reach, the arm points
 * straight at it.
 */
export function twoBoneIK(t: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, outQ = new THREE.Quaternion()): { q: THREE.Quaternion; bend: number } {
  const D = THREE.MathUtils.clamp(t.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const dh = t.lengthSq() > 1e-10 ? t.clone().normalize() : new THREE.Vector3(0, -1, 0);
  // the angle at the shoulder between the upper arm and the line to the target, and the elbow's inside angle
  const alpha = Math.acos(THREE.MathUtils.clamp((a * a + D * D - b * b) / (2 * a * D), -1, 1));
  const inner = Math.acos(THREE.MathUtils.clamp((a * a + b * b - D * D) / (2 * a * b), -1, 1));
  // swing the upper arm off the line, towards the pole
  const pp = pole.clone().addScaledVector(dh, -pole.dot(dh));
  if (pp.lengthSq() < 1e-8) pp.set(1, 0, 0).addScaledVector(dh, -dh.x);
  pp.normalize();
  const u = dh.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(pp, Math.sin(alpha));
  // the forearm's direction, and the bone's frame: −Y down the upper arm, +Z where the forearm bends to
  const f = dh.clone().multiplyScalar(D).addScaledVector(u, -a).normalize();
  const Y = u.clone().negate();
  const Z = f.clone().addScaledVector(u, -f.dot(u));
  if (Z.lengthSq() < 1e-8) Z.copy(pp).negate();
  Z.normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  outQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  return { q: outQ, bend: Math.PI - inner };
}

/** a hand on its way to a control, or holding it */
interface Reach {
  get: () => THREE.Vector3 | null;
  /** seconds since the control last moved */
  age: number;
  /** how far the hand has come (0 at its own pose, 1 on the control) */
  w: number;
  /** how it's held, and how far the control has turned (for the wrist to follow) */
  hold: HandHold;
  turn: (() => number) | null;
  /** a knob: its angle when the fingers took it; a platter: its angle last frame */
  turn0: number;
  /** the wrist's twist on a knob, or how far the record has carried the palm (radians) */
  twist: number;
  /** a button: seconds into the tap (-1 waiting for the hand to arrive) */
  tap: number;
  /** this frame: where the wrist goes and how the hand turns (in the avatar's space), and whether the control is there */
  wrist: THREE.Vector3;
  q: THREE.Quaternion;
  ok: boolean;
}

/** how long a hand stays on a control after it last moved */
const REACH_HOLD = 0.75;

/** a hand's fingers: index to little, each with a knuckle and a middle joint, and a thumb */
interface HandRig {
  fingers: { knuckle: THREE.Object3D; mid: THREE.Object3D }[];
  thumb: THREE.Object3D;
  thumbRest: THREE.Euler;
  /** 0 open, ~0.35 relaxed, ~0.9 a grip, 1.5 a fist */
  curl: number;
  /** a shape laid over the curl (a pinch, a pointing finger…), and how far in it is */
  pose: HandPose;
  poseW: number;
}

/**
 * Hand shapes for holding things. Per finger (index to little): the curl at
 * the knuckle and the middle joint, and the fan (spread apart); the thumb's
 * curl in across the palm, and how far it stands out from the hand (1 as built).
 */
type HandPose = 'pinch' | 'ride' | 'spread' | 'point' | 'cup';
const HAND_POSES: Record<HandPose, { k: number[]; m: number[]; fan: number; thumb: number; out: number }> = {
  // a knob between the thumb and the first two fingers, the others tucked away
  pinch: { k: [0.6, 0.7, 1.35, 1.45], m: [0.45, 0.5, 1.4, 1.5], fan: 0, thumb: 0.15, out: 0.35 },
  // two fingertips on a fader cap, the others curled under
  ride: { k: [0.5, 0.5, 1.15, 1.3], m: [0.3, 0.3, 1.2, 1.3], fan: 0.02, thumb: 0.45, out: 0.75 },
  // the palm flat on a platter, fingers spread round it
  spread: { k: [0.12, 0.1, 0.12, 0.16], m: [0.08, 0.06, 0.08, 0.1], fan: 0.16, thumb: 0, out: 1.35 },
  // the index out to press a button, the rest in a loose fist
  point: { k: [0.12, 1.25, 1.4, 1.45], m: [0.06, 1.35, 1.45, 1.5], fan: 0, thumb: 0.6, out: 0.4 },
  // cupped round a headphone cup
  cup: { k: [0.45, 0.5, 0.55, 0.6], m: [0.35, 0.4, 0.45, 0.5], fan: 0.06, thumb: 0.3, out: 0.9 },
};
const HOLD_POSE: Record<HandHold, HandPose | null> = { knob: 'pinch', fader: 'ride', jog: 'spread', press: 'point', grip: null };

/**
 * How the hand sits on each kind of control, in the avatar's own space (+Z
 * towards the decks, +X its left; `k` mirrors for the left/right hand):
 * the way the fingers point, the way the palm faces, and the point of the
 * hand (in the hand's space) that touches the control.
 */
const HOLD_FRAME: Record<Exclude<HandHold, 'grip'>, { fingers: [number, number, number]; palm: [number, number, number]; touch: [number, number, number] }> = {
  // from above, fingers down the side of the knob, palm towards the board
  knob: { fingers: [-0.15, -1, 0.35], palm: [-0.3, -0.25, 1], touch: [-0.008, -0.088, -0.026] },
  // fingers along the fader towards the board, palm down
  fader: { fingers: [0, -0.7, 1], palm: [0, -1, -0.35], touch: [-0.008, -0.108, -0.016] },
  // flat on the platter, fingers fanned forward and in
  jog: { fingers: [-0.3, -0.12, 1], palm: [0, -1, 0.05], touch: [0, -0.06, -0.018] },
  // the index straight down onto the button
  press: { fingers: [-0.1, -1, 0.5], palm: [-0.2, -0.3, 1], touch: [-0.022, -0.116, -0.004] },
};

/*
 * The face's moving parts, each a channel the expressions push on:
 *   brow     brows up (+) or down (-)
 *   frown    brows in and down at the middle (+), or up at the middle, worried (-)
 *   lids     upper lids closed (1) or wide open (-0.5)
 *   squint   lower lids and cheeks up
 *   jaw      mouth open
 *   smile    mouth corners up (+) or down (-)
 *   wide     mouth stretched wide
 *   sneer    upper lip curled up on one side, nose wrinkled
 *   pucker   lips pushed into an "oo"
 *   pitch    head tipped back (-) or down (+)
 *   roll     head tilted to the side
 *   gaze     eyes down to the board
 */
const FACE_CH = ['brow', 'frown', 'lids', 'squint', 'jaw', 'smile', 'wide', 'sneer', 'pucker', 'pitch', 'roll', 'gaze'] as const;
type FaceCh = (typeof FACE_CH)[number];
const CH = Object.fromEntries(FACE_CH.map((c, i) => [c, i])) as Record<FaceCh, number>;
const faceOf = (o: Partial<Record<FaceCh, number>>) => Float32Array.from(FACE_CH, (c) => o[c] ?? 0);

/** the expressions, each a full set of channels; the face is a weighted sum of them */
const EXPRESSIONS = {
  // the drop: "that's filthy": brows crushed down, nose screwed up, lip curled, mouth open
  stank: faceOf({ brow: -0.7, frown: 1, lids: 0.35, squint: 1, jaw: 0.4, smile: -0.35, wide: 0.15, sneer: 1, pitch: -0.1, roll: 0.1 }),
  // the breakdown: eyes shut, chin up, lost in it
  lost: faceOf({ brow: 0.45, frown: -0.5, lids: 1, jaw: 0.15, smile: 0.3, pitch: -0.55, roll: -0.14 }),
  // the top of the build: eyes wide, brows up, "ooh"
  rise: faceOf({ brow: 1, frown: -0.3, lids: -0.45, jaw: 0.3, pucker: 0.7, pitch: -0.12 }),
  // the room at its peak: a big grin
  grin: faceOf({ brow: 0.45, lids: 0.15, squint: 0.75, jaw: 0.35, smile: 1, wide: 0.8, pitch: -0.08 }),
  // a hand on a control: a frown of concentration, eyes on it
  focus: faceOf({ brow: -0.2, frown: 0.45, lids: 0.2, squint: 0.2, pucker: 0.15, pitch: 0.06, gaze: 1 }),
  // a clean transition: a quick flash of the brows and half a smile
  nice: faceOf({ brow: 1.1, lids: -0.3, smile: 0.6, wide: 0.2, jaw: 0.08, roll: 0.06 }),
  // a mistake: a wince, teeth showing
  oops: faceOf({ brow: 0.5, frown: -0.9, lids: 0.35, squint: 0.6, jaw: 0.18, smile: -0.7, wide: 0.6, roll: 0.1 }),
};
type Expression = keyof typeof EXPRESSIONS;
const EXPRESSION_IDS = Object.keys(EXPRESSIONS) as Expression[];
const STANK = EXPRESSION_IDS.indexOf('stank');
const LOST = EXPRESSION_IDS.indexOf('lost');
const GRIN = EXPRESSION_IDS.indexOf('grin');
const cl = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** the parts of the face that move */
interface FaceRig {
  /** a brow per side on a pivot at its middle (s: 1 the left), where it sits at rest */
  brows: { pivot: THREE.Object3D; s: number; x: number; y: number }[];
  /** the lips: upper and lower, each in two halves hinged at the middle of the mouth */
  upper: THREE.Object3D | null;
  lower: THREE.Object3D | null;
  upperY: number;
  lowerY: number;
  halves: { obj: THREE.Object3D; s: number; upper: boolean }[];
  /** the dark inside of the mouth, and the top teeth */
  inside: THREE.Object3D | null;
  insideY: number;
  eyes: THREE.Object3D[];
  lowerLids: THREE.Object3D[];
  /** the head (and a beard) with the cheek and jaw shape keys (FACE_MORPHS) */
  morphs: THREE.Mesh[];
  /** the wings of the nose, for the wrinkle */
  nose: { obj: THREE.Object3D; y: number }[];
}
const noFace = (): FaceRig => ({ brows: [], upper: null, lower: null, upperY: 0, lowerY: 0, halves: [], inside: null, insideY: 0, eyes: [], lowerLids: [], morphs: [], nose: [] });

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** a pseudo-random 0..1 for an integer (syllables, so they don't repeat every bar) */
const hash01 = (n: number) => {
  const x = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * The face's shape keys, on the head (and a beard over it): the cheeks
 * rounding up (a smile, a squint) and the chin dropping with the jaw. `dirs`
 * is each vertex's direction from the middle of the head (x right, y up,
 * z front), as headPoint takes it.
 */
export const FACE_MORPHS = ['cheeks', 'jaw'] as const;
function faceMorphs(g: THREE.BufferGeometry, dirs: Float32Array): void {
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const out: THREE.BufferAttribute[] = [];
  const normals: THREE.BufferAttribute[] = [];
  for (const key of FACE_MORPHS) {
    const d = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = dirs[i * 3];
      const y = dirs[i * 3 + 1];
      const z = dirs[i * 3 + 2];
      if (key === 'cheeks') {
        // the apples of the cheeks, under the eyes either side of the nose: out and up
        const w = Math.exp(-((Math.abs(x) - 0.5) ** 2 + (y + 0.2) ** 2 + (z - 0.84) ** 2) / 0.035);
        const len = Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) || 1;
        d[i * 3] = (p.getX(i) / len) * 0.0035 * w;
        d[i * 3 + 1] = (p.getY(i) / len) * 0.0035 * w + 0.003 * w;
        d[i * 3 + 2] = (p.getZ(i) / len) * 0.0035 * w;
      } else {
        // the chin and the front of the jaw, below the mouth: down, as far as the lower lip goes
        const w = smooth(-0.47, -0.62, y) * smooth(-0.2, 0.45, z) * (1 - smooth(0.4, 0.85, Math.abs(x)));
        d[i * 3 + 1] = -0.012 * w;
        d[i * 3 + 2] = -0.002 * w;
      }
    }
    // the normals of the moved shape, as a difference too, so the light follows the cheeks
    const moved = g.clone();
    const mp = moved.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < d.length; i++) (mp.array as Float32Array)[i] += d[i];
    moved.computeVertexNormals();
    const mn = (moved.attributes.normal as THREE.BufferAttribute).array as Float32Array;
    const dn = new Float32Array(mn.length);
    for (let i = 0; i < dn.length; i++) dn[i] = mn[i] - (n.array as Float32Array)[i];
    moved.dispose();
    out.push(new THREE.BufferAttribute(d, 3));
    normals.push(new THREE.BufferAttribute(dn, 3));
  }
  g.morphAttributes.position = out;
  g.morphAttributes.normal = normals;
  g.morphTargetsRelative = true;
}

/**
 * A hand's orientation from where its fingers point and which way its palm
 * faces (the hand's −Y down the fingers, −Z out of the palm).
 */
function handFrame(fx: number, fy: number, fz: number, px: number, py: number, pz: number, out: THREE.Quaternion): THREE.Quaternion {
  const Y = tmpA.set(-fx, -fy, -fz).normalize();
  const Z = tmpB.set(-px, -py, -pz);
  Z.addScaledVector(Y, -Z.dot(Y)).normalize();
  const X = tmpC.crossVectors(Y, Z);
  return out.setFromRotationMatrix(tmpM.makeBasis(X, Y, Z));
}

export class Avatar {
  readonly object = new THREE.Group();
  readonly bones = {} as Record<BoneName, THREE.Object3D>;
  /** 'dj' stands at the decks; 'idle' stands and grooves (the dressing room); 'hype' dances by the booth */
  mode: 'dj' | 'idle' | 'hype' = 'dj';
  /** a hype dancer's own pick of moves, and which side of the DJ she's on (-1 left, 1 right) */
  seed = 0;
  side = 1;
  /** a clubber's own moves to dance in 'hype' mode while the music plays (the regulars) */
  club: ClubDancer | null = null;
  /** 0..1, builds up through a long set; reset between gigs */
  sweat = 0;
  /** how strong the blacklight is (UV paint, irises and bright fabric glow) */
  uv = 0;
  private look: Look;
  private d: Dims;
  private body = new THREE.Group();
  private owned: { dispose(): void }[] = [];
  private skinMats: THREE.MeshPhysicalMaterial[] = [];
  private glowMats: { mat: THREE.MeshStandardMaterial; k: number; base?: number }[] = [];
  /** things that swing: hair (moved by the head), clothes (moved by the body) */
  private springs: { obj: THREE.Object3D; ox: number; oz: number; vx: number; vz: number; k: number; body?: boolean; rest?: THREE.Euler }[] = [];
  private lids: THREE.Object3D[] = [];
  private headphones: THREE.Object3D | null = null;
  private headphonesHome: { parent: THREE.Object3D; pos: THREE.Vector3; rot: THREE.Euler } | null = null;
  private prop: THREE.Object3D | null = null;
  private t = 0;
  private dropT = 1e9;
  private habitAt = -1;
  private lastHead = new THREE.Vector3();
  private blinkAt = 2;
  private djName: string;
  private reaching: { l: Reach | null; r: Reach | null } = { l: null, r: null };
  /** the fingers, so they can curl round a control or into a fist */
  private hands: { l: HandRig | null; r: HandRig | null } = { l: null, r: null };
  /** the parts of the face that move: brows, lids, cheeks, nose, lips, jaw, eyes */
  private faceRig: FaceRig = noFace();
  /** how much of each expression is on the face now, and the channels they add up to */
  private exprW = new Float32Array(EXPRESSION_IDS.length);
  private faceNow = new Float32Array(FACE_CH.length);
  /** seconds since the last good transition (a brow flash) and mistake (a wince) */
  private niceT = 1e9;
  private oopsT = 1e9;
  /** which side the lip curls on (a habit: each DJ has a side) */
  private sneerSide = 1;
  /** listening in the headphones (a channel cued): the cup to the ear */
  cueing = false;
  /** a move from the pads, playing now */
  private perf: { id: DjMove; t: number; len: number } | null = null;
  private cueW = 0;
  private pressW = 0;
  /** the upper lids, from the face (closed 1, wide open -0.5): blinking closes them on top of it */
  private lidClose = 0;
  private lastChest = new THREE.Vector3();
  private ikQ = new THREE.Quaternion();
  private ikT = new THREE.Vector3();
  private handQ = new THREE.Quaternion();
  /** the modelled body, when it's loaded, and the skin regions it shows (the code builds the rest) */
  private model: ModelBody | null = null;
  private modelShows = new Set<BodyRegion>();
  /** the clothes cut from the modelled body (once it's loaded) in place of turned shells */
  private cuts: ClothCut[] = [];
  /** the robot suit's layers that come from the modelled body this build */
  private suit: { jacket: boolean; trousers: boolean } | null = null;
  /** a robot head in place of the face, and what its face does this frame */
  private robot: RobotHead | null = null;
  private robotIn = robotFace();

  constructor(look: Look, o: { djName?: string } = {}) {
    this.look = look;
    this.d = dims(look);
    this.djName = o.djName ?? '';
    this.object.add(this.body);
    this.build();
    // the modelled body loads once; avatars built before it arrived rebuild with it
    if (!bodyReady()) preloadBody(() => this.setLook(this.look));
  }

  /** play a DJ move (hands up, jump, point, clap, fist pump, up on the booth) */
  perform(id: DjMove): void {
    const m = DJ_MOVES.find((x) => x.id === id);
    if (m) this.perf = { id, t: 0, len: m.beats * (60 / 124) };
  }

  /** a face for the moment: a brow flash for a clean transition, a wince at a mistake */
  react(what: 'nice' | 'oops'): void {
    if (what === 'nice') this.niceT = 0;
    else this.oopsT = 0;
  }

  /** the move playing now, if any */
  get performing(): DjMove | null {
    return this.perf?.id ?? null;
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

  /** what robot.ts builds a robot head and neck with */
  private robotKit(): RobotKit {
    return {
      mesh: (geo, mat, parent, pos) => this.mesh(geo, mat, parent, pos),
      keep: (x) => this.keep(x),
      spring: (obj, k) => void this.springs.push({ obj, ox: 0, oz: 0, vx: 0, vz: 0, k }),
    };
  }

  private keep<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }

  private clear(): void {
    for (const x of this.owned) x.dispose();
    this.owned = [];
    this.skinMats = [];
    this.glowMats = [];
    this.springs = [];
    this.lids = [];
    this.hands = { l: null, r: null };
    this.model?.dispose();
    this.model = null;
    this.faceRig = noFace();
    this.robot = null;
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
      const th = bone(`thigh_${s}`, hips, V(k * (d.hipX ?? d.hipsR * 0.55), -0.03, 0));
      const sn = bone(`shin_${s}`, th, V(0, -d.thigh, 0));
      bone(`foot_${s}`, sn, V(0, -d.shin, 0));
    }

    // the game's bones at rest, in the body's space (no rotations yet)
    const restOf = () => {
      const rest = {} as Record<BoneName, THREE.Vector3>;
      for (const name of Object.keys(b) as BoneName[]) {
        const p = new THREE.Vector3();
        for (let o: THREE.Object3D | null = b[name]; o && o !== this.body; o = o.parent) p.add(o.position);
        rest[name] = p;
      }
      return rest;
    };

    // a scanned character is the whole person, clothes and all: only the hands' joints to build under it
    const scan = l.options.scan;
    if (scan && hasModel(scan)) {
      if (scanReady(scan)) {
        for (const [s, k] of [['l', 1], ['r', -1]] as const) this.buildHand(s, k, false);
        this.model = new ModelBody(this.body, b, restOf(), this.hands, new Set(), this.skin('body'), l, modelTuck(l, null, null), null, [], scan);
        return;
      }
      // (built as a modelled look until it arrives)
      preloadScan(scan, () => this.look.options.scan === scan && this.setLook(this.look));
    }

    // the modelled body shows the skin regions clothes and tattoos leave free
    const top = l.items.top;
    const outer = l.items.outer;
    const topCut: Cover | null = top ? (TOP_STYLE[top] ?? { sleeves: 'short' }) : null;
    const outerCut: Cover | null = outer ? (OUTER_STYLE[outer] ?? { sleeves: 'long' }) : null;
    this.modelShows = bodyReady() ? modelRegions(l, topCut, outerCut) : new Set();
    // the robot jacket and trousers are cut from the modelled body, once it's loaded
    const jacket = bodyReady() && outer === 'jacket_robot';
    const trousers = bodyReady() && l.items.bottom === 'pants_robot';
    this.suit = jacket || trousers ? { jacket, trousers } : null;
    this.cuts = bodyReady() ? this.planCuts() : [];
    // (no skin under the modelled robot suit or cut clothes either: it would poke through)
    const suited = (r: BodyRegion) => (!!this.suit?.jacket && /^(chest|upper_arm|forearm)/.test(r)) || (!!this.suit?.trousers && /^(chest|thigh|calf)/.test(r)) || cutCovers(this.cuts, r);
    const code = (r: BodyRegion) => !this.modelShows.has(r) && !suited(r);

    // the body (under the clothes; clothes are shells around it)
    if (code('chest')) this.mesh(lathe([[d.hipsR * 0.9, -0.09], [d.hipsR, -0.02], [(d.hipsR + d.waistR) / 2, 0.06], [d.waistR, 0.13]], d.depth * 1.05), this.skin('chest'), hips);
    if (code('chest')) this.mesh(lathe([[d.waistR, -0.02], [d.chestR * 0.96, 0.1 * d.H], [d.chestR, 0.19 * d.H], [d.shoulder * 0.86, 0.3 * d.H], [d.shoulder * 0.55, 0.345 * d.H], [0.055, 0.37 * d.H]], d.depth), this.skin('chest'), spine);
    const robotHead = ROBOT_HEADS.has(l.items.head ?? '');
    if (robotHead) buildRobotNeck(l.items.head ?? '', this.robotKit(), neck, d.H);
    else if (code('neck')) this.mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.11 * d.H, 16).translate(0, 0.04, 0), this.skin('neck'), neck);
    for (const [s, k] of [['l', 1], ['r', -1]] as const) {
      // (the robot jacket covers the arms completely: no skin under it to poke through)
      if (code(`upper_arm_${s}`) && outer !== 'jacket_robot') {
        this.mesh(new THREE.SphereGeometry(d.armR * 1.25, 16, 12), this.skin(`upper_arm_${s}`), b[`shoulder_${s}`]);
        this.mesh(limb(d.armR * 1.1, d.upperArm, d.armR * 0.95), this.skin(`upper_arm_${s}`), b[`upper_arm_${s}`]);
      }
      if (code(`forearm_${s}`)) this.mesh(limb(d.armR * 0.92, d.foreArm, d.armR * 0.7), this.skin(`forearm_${s}`), b[`forearm_${s}`]);
      this.buildHand(s, k, code(`hand_${s}`));
      if (code(`thigh_${s}`)) this.mesh(limb(d.legR * 1.15, d.thigh, d.legR * 0.88), this.skin('thigh'), b[`thigh_${s}`]);
      if (code(`calf_${s}`)) this.mesh(limb(d.legR * 0.86, d.shin, d.legR * 0.6), this.skin(`calf_${s}`), b[`shin_${s}`]);
    }
    // the side the lip curls on, the way the head tilts: each look has its own
    this.sneerSide = [...l.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 2 ? -1 : 1;
    // a robot head covers the face and hair (it's built with the accessories)
    if (!robotHead) {
      this.buildHead();
      this.buildHair();
    }
    this.buildClothes();
    this.buildAccessories();
    if (this.modelShows.size || this.suit || this.cuts.length) {
      const rest = restOf();
      // (the suit's UVs count in tiles of grain already)
      const cut = (slot: Slot) => this.hide(this.fabric(slot), 1);
      const suit = this.suit && {
        jacket: this.suit.jacket ? cut('outer') : null,
        trousers: this.suit.trousers ? cut('bottom') : null,
        trims: { piping: this.fabric(this.suit.jacket ? 'outer' : 'bottom', 2), zip: this.std(0x2a2c31, { metalness: 0.8, roughness: 0.35 }), metal: this.std(0xd9dde3, { metalness: 0.95, roughness: 0.2 }) },
      };
      this.model = new ModelBody(this.body, b, rest, this.hands, this.modelShows, this.skin('body'), l, modelTuck(l, topCut, outerCut), suit, this.cuts);
    }
  }

  /* ---------------------------------------------------------------- */
  /* head and face                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * A hand: the palm, four fingers in two segments on joints, a thumb (k: 1
   * left, -1 right). The fingers curl towards the hand's −Z, so that's the
   * palm: on the decks the palm faces down and the backs of the hands (the
   * knuckles and nails) face up; the thumb sits on the inside, towards the
   * other hand. `meshes` false builds only the joints (the modelled hand shows).
   * Robot hands are the same rig in metal plates, black joints between them.
   */
  private buildHand(side: 'l' | 'r', k: number, meshes = true): void {
    const d = this.d;
    const robot = ROBOT_HANDS.has(this.look.items.wrists ?? '');
    // robot hands are big, chunky things: the whole hand built a size up on its own joint
    // (the bone itself stays as it is, for whatever the hand holds)
    let hb = this.bones[`hand_${side}`];
    if (robot) {
      const big = new THREE.Object3D();
      big.scale.setScalar(ROBOT_HAND_SCALE);
      hb.add(big);
      hb = big;
    }
    const zones = zoneColors(this.look, 'wrists');
    // pearly silver (or polished gold) plates, black between them, a bigger hand than a person's
    const plate = (c: string) => this.keep(this.look.items.wrists === 'gloves_chrome' ? pearlMat(c) : metalMat(c, 0.24));
    const mat = robot ? plate(zones[0]) : this.skin(`hand_${side}`);
    const joint = robot ? this.keep(rubberMat(zones[1])) : mat;
    const w = d.armR * 1.55 * (robot ? 1.12 : 1);
    // the joints always; the meshes only where the modelled hand isn't showing
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, pos?: THREE.Vector3) => (meshes ? this.mesh(geo, m, parent, pos) : geo.dispose());
    add(new THREE.CapsuleGeometry(d.armR * 0.62, 0.035, 4, 12).scale(w / (d.armR * 1.24), 1, robot ? 0.68 : 0.55).translate(0, -0.035, 0), mat, hb);
    // knuckles: a little ridge across the back of the hand
    add(new THREE.CapsuleGeometry(0.0062, w * 0.78, 3, 8).rotateZ(Math.PI / 2).translate(0, -0.063, 0.006), joint, hb);
    if (robot) {
      // the back of the hand: a raised plate on a black seam, a smaller one over the wrist; a black cuff
      const back = d.armR * 0.42;
      add(new RoundedBoxGeometry(w * 0.9, 0.048, 0.006, 2, 0.002).translate(0, -0.036, back), joint, hb);
      add(new RoundedBoxGeometry(w * 0.84, 0.042, 0.008, 2, 0.003).translate(0, -0.036, back + 0.002), plate(zones[2]), hb);
      add(new RoundedBoxGeometry(w * 0.7, 0.012, 0.007, 2, 0.003).translate(0, -0.004, back * 0.9), plate(zones[2]), hb);
      const cuff = new THREE.TorusGeometry(d.armR * 0.86, 0.0065, 6, 20).rotateX(Math.PI / 2).translate(0, 0.004, 0);
      add(cuff, joint, hb);
    }
    const nailMat = this.std(new THREE.Color(0xf0d8cc), { roughness: 0.3 });
    const fingers: HandRig['fingers'] = [];
    // index (next to the thumb) to little
    for (let f = 0; f < 4; f++) {
      const len = [0.046, 0.052, 0.05, 0.04][f];
      const r0 = [0.0074, 0.0076, 0.0073, 0.0066][f];
      const knuckle = new THREE.Object3D();
      knuckle.position.set(k * (f - 1.5) * (w / 4) * 0.95, robot ? -0.07 : -0.066, -0.002);
      hb.add(knuckle);
      const l1 = len * 0.55;
      const l2 = len * 0.48;
      const mid = new THREE.Object3D();
      mid.position.set(0, -l1 - 0.001, 0);
      knuckle.add(mid);
      if (robot) {
        // thick plates a little short of each joint, a black band in the gap
        add(new THREE.CapsuleGeometry(r0 * 1.16, l1 * 0.62, 3, 12).translate(0, -l1 * 0.52, 0), mat, knuckle);
        add(new THREE.SphereGeometry(r0 * 1.06, 12, 8), joint, knuckle);
        add(new THREE.SphereGeometry(r0 * 1.0, 12, 8), joint, mid);
        add(new THREE.CapsuleGeometry(r0 * 1.08, l2 * 0.66, 3, 12).translate(0, -l2 * 0.58, 0), mat, mid);
      } else {
        add(new THREE.CapsuleGeometry(r0, l1, 3, 8).translate(0, -l1 / 2, 0), mat, knuckle);
        add(new THREE.CapsuleGeometry(r0 * 0.9, l2, 3, 8).translate(0, -l2 / 2, 0), mat, mid);
        // the nail, on the back
        add(new THREE.BoxGeometry(r0 * 1.3, l2 * 0.4, 0.0015), nailMat, mid, V(0, -l2 * 0.72, r0 * 0.85));
      }
      fingers.push({ knuckle, mid });
    }
    // the thumb: on the inside of the hand, angled in and a little under the palm
    const thumb = new THREE.Object3D();
    thumb.position.set(-k * w * 0.45, -0.022, -0.008);
    thumb.rotation.set(0.25, -k * 0.5, -k * 0.6);
    hb.add(thumb);
    add(new THREE.CapsuleGeometry(robot ? 0.0098 : 0.0085, 0.034, 3, 8).translate(0, -0.017, 0), mat, thumb);
    if (robot) add(new THREE.SphereGeometry(0.0096, 10, 8).translate(0, -0.016, 0), joint, thumb);
    else add(new THREE.BoxGeometry(0.009, 0.01, 0.0015), nailMat, thumb, V(0, -0.034, 0.0078));
    this.hands[side] = { fingers, thumb, thumbRest: thumb.rotation.clone(), curl: 0.35, pose: 'pinch', poseW: 0 };
  }

  /** curl the fingers towards `want`, or into a shape for holding something (and ease there) */
  private curlHand(side: 'l' | 'r', want: number, dt: number, pose: HandPose | null = null): void {
    const h = this.hands[side];
    if (!h) return;
    const ease = Math.min(1, dt * 12);
    h.curl += (want - h.curl) * ease;
    if (pose) h.pose = pose;
    h.poseW += ((pose ? 1 : 0) - h.poseW) * ease;
    const p = HAND_POSES[h.pose];
    const pw = h.poseW;
    const k = side === 'l' ? 1 : -1;
    for (let f = 0; f < 4; f++) {
      const fg = h.fingers[f];
      // the little finger curls a touch more, the index a touch less
      const c = h.curl * (0.9 + f * 0.06);
      fg.knuckle.rotation.x = c * 0.95 + (p.k[f] - c * 0.95) * pw;
      fg.mid.rotation.x = c * 1.15 + (p.m[f] - c * 1.15) * pw;
      // spread: fanned out from the middle of the hand
      fg.knuckle.rotation.z = k * (f - 1.5) * p.fan * pw;
    }
    const tc = h.curl * 0.35 + (p.thumb - h.curl * 0.35) * pw;
    const out = 1 - Math.min(1, h.curl) * 0.4;
    h.thumb.rotation.set(h.thumbRest.x + tc, h.thumbRest.y, h.thumbRest.z * (out + (p.out - out) * pw));
  }

  /**
   * Turn a hand (eased in by `w`) to `q`, an orientation in the avatar's own
   * space, whatever the arm above it is doing.
   */
  private orientHand(side: 'l' | 'r', q: THREE.Quaternion, w: number): void {
    const b = this.bones;
    // the forearm's orientation in the avatar's space: up through the shoulder, upper arm and forearm
    const fa = b[`forearm_${side}`];
    const parentQ = tmpQ2.identity();
    for (let o: THREE.Object3D | null = fa; o && o !== this.object; o = o.parent) parentQ.premultiply(o.quaternion);
    const local = parentQ.invert().multiply(q);
    b[`hand_${side}`].quaternion.slerp(local, w);
  }

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
    const dirs = Float32Array.from(p.array as Float32Array);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      this.headPoint(p.getX(i), p.getY(i), p.getZ(i), v);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    hg.computeVertexNormals();
    faceMorphs(hg, dirs);
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
    this.faceRig.morphs.push(headMesh);
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
    const fr = this.faceRig;
    for (const s of [-1, 1]) {
      const wing = this.mesh(new THREE.SphereGeometry(0.0085 * nw, 12, 8), plain, head, tipP.clone().add(V(s * 0.011 * nw, -0.004, -0.006)));
      fr.nose.push({ obj: wing, y: wing.position.y });
    }

    // lips: upper and lower, each two halves hinged at the middle, so the corners can turn up or
    // down and the mouth can open into a shape; the inside and the top teeth behind them
    const lipCol = l.colors.lips ? new THREE.Color(l.colors.lips) : skinCol.clone().lerp(new THREE.Color(0.55, 0.18, 0.2), 0.32).multiplyScalar(0.85);
    const lipMat = this.std(lipCol, { roughness: 0.4 });
    const lf = 1 + f('lip_fullness') * 0.5;
    const lw = 1 + f('lip_width') * 0.3;
    const mouth = at(0, -0.46, 1, 0.001);
    for (const isUpper of [true, false]) {
      const lip = new THREE.Object3D();
      lip.position.copy(mouth).add(isUpper ? V(0, 0.004, 0) : V(0, -0.006, -0.001));
      head.add(lip);
      const r0 = (isUpper ? 0.0048 : 0.0058) * lf;
      const half = (isUpper ? 0.017 : 0.015) * lw;
      for (const s of [-1, 1]) {
        // each half from the middle out to the corner, thinner at the corner, swept back round the face
        const hinge = new THREE.Object3D();
        hinge.rotation.y = s * 0.3;
        lip.add(hinge);
        const m = this.mesh(limb(r0, half - r0 * 0.75, r0 * 0.75).rotateZ(s * Math.PI / 2), lipMat, hinge);
        m.scale.set(1, isUpper ? 1 + f('lip_shape') * 0.2 : 1, 0.9);
        fr.halves.push({ obj: hinge, s, upper: isUpper });
      }
      if (isUpper) {
        fr.upper = lip;
        fr.upperY = lip.position.y;
        // the top teeth, just behind the upper lip: they show in a grin, a shout or a wince
        // (an arc, curving back round the face with the lips)
        const R = 0.03;
        const arc = (0.019 * lw) / R;
        const teeth = this.mesh(new THREE.TorusGeometry(R, 0.0032, 6, 16, arc).rotateZ(Math.PI / 2 - arc / 2).rotateX(Math.PI / 2).translate(0, 0, -R), this.std(0xf2eee6, { roughness: 0.35 }), lip, V(0, -0.0022, -0.0014));
        teeth.scale.set(1, 1.15, 1);
      } else {
        fr.lower = lip;
        fr.lowerY = lip.position.y;
      }
    }
    // the mouth's inside, seen when it opens
    const inside = this.mesh(new THREE.SphereGeometry(0.012 * lw, 12, 8).scale(1.4, 0.7, 0.5), this.std(0x2a0d0d, { roughness: 0.9 }), head, mouth.clone().add(V(0, -0.002, -0.006)));
    fr.inside = inside;
    fr.insideY = inside.position.y;

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
      this.faceRig.eyes.push(eye);
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
      fr.lowerLids.push(lowerLid);
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
      // on a pivot at the brow's middle, so it can lift, knit in and tilt
      const pivot = new THREE.Object3D();
      pivot.position.copy(at(s * 0.32, 0.29, 0.88, 0.003));
      head.add(pivot);
      for (const seg of segs) {
        if (seg.length < 2) continue;
        const curve = new THREE.CatmullRomCurve3(seg.map(([bx, by]) => at(s * (0.14 + bx * 0.36), 0.27 + by * 0.12 + bx * slider(l, 'eye_tilt') * 0.03, 0.88, 0.003).sub(pivot.position)));
        this.mesh(new THREE.TubeGeometry(curve, 12, thick, 6, false), browMat, pivot);
      }
      fr.brows.push({ pivot, s, x: pivot.position.x, y: pivot.position.y });
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
      const bdirs = Float32Array.from(bp.array as Float32Array);
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
      // the beard drops with the chin
      faceMorphs(bg, bdirs);
      this.faceRig.morphs.push(this.mesh(bg, hairMat, head, headMesh.position.clone()));
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

  /** leather's grain and finish on a fabric: pebbled and creased, a soft wax sheen rather than a lacquer */
  private hide(m: THREE.MeshPhysicalMaterial, repeat: number): THREE.MeshPhysicalMaterial {
    const { normal, rough } = leatherCanvases();
    m.normalMap = this.keep(toTexture(normal, repeat, false));
    m.normalScale.setScalar(0.7);
    m.roughnessMap = this.keep(toTexture(rough, repeat, false));
    // (cut clothes carry their weave's tiles in a second set of UVs)
    if (repeat === 1) m.normalMap.channel = m.roughnessMap.channel = 1;
    m.roughness = 1;
    m.clearcoat = 0.3;
    m.clearcoatRoughness = 0.38;
    m.sheen = 0.25;
    m.sheenRoughness = 0.6;
    m.sheenColor = new THREE.Color(0.35, 0.33, 0.32);
    m.envMapIntensity = 0.7;
    return m;
  }

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
        // the robot DJ's jacket, trousers and boots: real hide, a pebbled grain and soft creases under a waxed finish
        if (ROBOT_LEATHER.has(l.items[slot] ?? '')) this.hide(m, 6);
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
      case 'chrome':
        // a mirror finish: the room's lights slide across it
        m.metalness = 1;
        m.roughness = 0.1;
        m.envMapIntensity = 0.85;
        m.color.setScalar(0.86);
        break;
      case 'hologram':
        m.metalness = 0.3;
        m.roughness = 0.22;
        m.iridescence = 1;
        m.iridescenceIOR = 1.8;
        m.transparent = true;
        m.opacity = 0.82;
        break;
      case 'glow':
        m.roughness = 0.8;
        break;
      default:
        break;
    }
    // under blacklight, light and bright fabric glows (glow paint the most; the hologram glows by itself)
    m.emissiveMap = map;
    m.emissive.set(material === 'hologram' ? 0x7fefff : 0xffffff);
    m.emissiveIntensity = 0;
    this.glowMats.push({ mat: m, k: material === 'glow' ? 2.6 : 0.35, base: material === 'glow' ? 0.06 : material === 'hologram' ? 0.32 : 0 });
    return m;
  }

  /**
   * The robot jacket's details: white piping over the shoulders, down the
   * chest panels and the outside of each sleeve, a zip down the front, ribbed
   * cuffs, collar and hem (zone 3) with a line of piping above each.
   */
  private piping(slot: Slot, push: number, o: ShellStyle, hipPts: [number, number][], chestPts: [number, number][]): void {
    const d = this.d;
    const b = this.bones;
    const pipe = this.fabric(slot, 2);
    const rib = this.fabric(slot, 3);
    const R = 0.0028;
    const line = (pts: THREE.Vector3[], parent: THREE.Object3D, mat: THREE.Material = pipe, r = R) => this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 4), r, 6, false), mat, parent);
    // a point on a torso shell: `phi` round from straight ahead, at height y, just proud of the cloth
    const on = (pts: [number, number][], depth: number, phi: number, y: number, out = 0.002) => {
      let r = pts[0][0];
      for (let i = 1; i < pts.length; i++) {
        const [r0, y0] = pts[i - 1];
        const [r1, y1] = pts[i];
        if (y >= y0 && y <= y1) r = r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
        else if (y > y1) r = r1;
      }
      r += out;
      return V(r * Math.sin(phi), y, r * Math.cos(phi) * depth);
    };
    const chest = (phi: number, y: number, out?: number) => on(chestPts, d.depth * 1.02, phi, y, out);
    const hip = (phi: number, y: number, out?: number) => on(hipPts, d.depth * 1.06, phi, y, out);
    const steps = (n: number, f: (t: number) => THREE.Vector3) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
    const H = d.H;
    for (const k of [1, -1]) {
      // from beside the collar out over the shoulder
      line(steps(10, (t) => chest(k * (0.45 + 1.1 * t), (0.366 - 0.03 * t) * H, 0.003)), b.spine);
      // the chest panels, either side of the zip, down into the waist
      line(steps(12, (t) => chest(k * (0.62 - 0.18 * t), (0.34 - 0.36 * t) * H, 0.003)), b.spine);
      line(steps(6, (t) => hip(k * 0.44, 0.13 - 0.22 * t, 0.003)), b.hips);
    }
    // the zip: a dark track down the middle and its pull under the collar
    const zipMat = this.std(0x2a2c31, { metalness: 0.8, roughness: 0.35 });
    line(steps(10, (t) => chest(0, (0.37 - 0.39 * t) * H, 0.003)), b.spine, zipMat, 0.0022);
    line(steps(4, (t) => hip(0, 0.13 - 0.22 * t, 0.003)), b.hips, zipMat, 0.0022);
    const silver = this.std(0xd9dde3, { metalness: 0.95, roughness: 0.2 });
    // its teeth, either side of the track, all the way down
    const teeth: THREE.BufferGeometry[] = [];
    for (let y = 0.0, i = 0; y < 0.355; y += 0.0085, i++) {
      const p = chest(0, y * H, 0.004);
      teeth.push(new THREE.BoxGeometry(0.0045, 0.0032, 0.002).translate(p.x + (i % 2 ? 0.0022 : -0.0022), p.y, p.z));
    }
    this.mesh(mergeGeometries(teeth)!, zipMat, b.spine);
    for (const g of teeth) g.dispose();
    // the pull: a long tab hanging from the slider under the collar
    const slider = this.mesh(new THREE.BoxGeometry(0.009, 0.01, 0.005), silver, b.spine, chest(0, 0.345 * H, 0.006));
    void slider;
    const pull = this.mesh(new THREE.CapsuleGeometry(0.0042, 0.026, 3, 8).translate(0, -0.016, 0), silver, b.spine, chest(0, 0.34 * H, 0.009));
    pull.scale.z = 0.45;
    pull.rotation.x = -0.2;
    // the ribbed hem, piping above it
    const hemY = hipPts[0][1] + 0.012;
    for (const [mat, y, tube, grow] of [[rib, hemY, 0.008, 0.004], [pipe, hemY + 0.02, R, 0.003]] as const) {
      const ring = this.mesh(new THREE.TorusGeometry(on(hipPts, 1, Math.PI / 2, y, grow).x, tube, 6, 40), mat, b.hips, V(0, y, 0));
      ring.rotation.x = Math.PI / 2;
      ring.scale.set(1, d.depth * 1.06, 1);
    }
    // a line of piping round the top of the collar
    const top = this.mesh(new THREE.TorusGeometry(0.061, R, 6, 28), pipe, b.neck, V(0, 0.045, 0));
    // snap studs down the front of the collar, either side of the zip
    for (const a of [-0.32, 0.32]) for (const y of [0.0, 0.026]) {
      const stud = this.mesh(new THREE.CylinderGeometry(0.0052, 0.0058, 0.003, 14).rotateX(Math.PI / 2), silver, b.neck, V(Math.sin(a) * 0.067, y, Math.cos(a) * 0.067));
      stud.rotation.y = a;
    }
    top.rotation.x = Math.PI / 2;
    for (const s of ['l', 'r'] as const) {
      const k = s === 'l' ? 1 : -1;
      const { cap: sr, elbow: f0, cuff: f1 } = sleeveRadii(d, o, push);
      // over the cap of the shoulder, then down the outside of the sleeve to the cuff
      line(steps(6, (t) => V(k * Math.sin((t * Math.PI) / 2) * (sr + 0.002), -0.004 + Math.cos((t * Math.PI) / 2) * (sr * 0.9 + 0.002), 0)), b[`shoulder_${s}`]);
      line(steps(6, (t) => V(k * (sr * (1 - 0.08 * t) + 0.0015), -d.upperArm * t, 0)), b[`upper_arm_${s}`]);
      const fl = d.foreArm * 0.94;
      line(steps(6, (t) => V(k * (f0 + (f1 - f0) * t + 0.0015), -fl * 0.92 * t, 0)), b[`forearm_${s}`]);
      // the cuff: ribbed, piping above it
      const cuff = this.mesh(new THREE.CylinderGeometry(f1 + 0.004, f1 + 0.004, 0.022, 20, 1, true), rib, b[`forearm_${s}`], V(0, -fl + 0.012, 0));
      void cuff;
      const ring = this.mesh(new THREE.TorusGeometry(f1 + 0.0035, R, 6, 20), pipe, b[`forearm_${s}`], V(0, -fl + 0.03, 0));
      ring.rotation.x = Math.PI / 2;
    }
  }

  /** the tops, outer layers and trousers cut from the modelled body: their cut, their fabric, a print */
  private planCuts(): ClothCut[] {
    const l = this.look;
    const cuts: ClothCut[] = [];
    const cut = (slot: 'top' | 'outer', o: ShellStyle, push: number) => {
      const c: ClothCut = { slot, mat: this.cloth(slot), trim: this.cloth(slot, o.trim ?? 2), push, sleeves: o.sleeves, crop: o.crop, length: o.length, collar: o.collar, puffy: o.puffy };
      if (o.open) c.open = o.open;
      return c;
    };
    const top = l.items.top;
    if (top) {
      const o = TOP_STYLE[top] ?? { sleeves: 'short', collar: 'crew' };
      const c = cut('top', o, o.push ?? 0.01);
      // the band tee's faded print and the jersey's number on the chest
      if (top === 'tee_band' || top === 'jersey_football') c.print = this.printMat(top);
      cuts.push(c);
    }
    const outer = l.items.outer;
    if (outer && !this.suit?.jacket) {
      const o = OUTER_STYLE[outer] ?? { sleeves: 'long', collar: 'crew', open: 0.4 };
      cuts.push(cut('outer', o, o.push ?? 0.03));
    }
    const bottom = l.items.bottom;
    if (bottom && !this.suit?.trousers && !bottom.startsWith('skirt')) {
      const baggy = ['cargos_baggy', 'cargos_black', 'cargo_tech', 'joggers'].includes(bottom) ? 0.028 : bottom === 'trousers_flared' ? 0.012 : 0.01;
      cuts.push({ slot: 'bottom', mat: this.cloth('bottom'), trim: this.cloth('bottom', 2), push: 0, baggy, shorts: bottom.startsWith('shorts'), flare: bottom === 'trousers_flared', pockets: bottom.startsWith('cargo') });
    }
    return cuts;
  }

  /** a slot's fabric for cut clothes: its pattern round the body, its weave in the second UVs */
  private cloth(slot: Slot, zone?: 1 | 2 | 3): THREE.MeshPhysicalMaterial {
    const m = this.fabric(slot, zone);
    const material = slotMaterial(this.look, slot);
    if (material === 'leather') return m.normalMap ? m : this.hide(m, 1);
    const kind = material === 'denim' ? 'twill' : material === 'cotton' || material === 'velvet' ? 'knit' : material === 'satin' ? 'satin' : null;
    if (!kind) return m;
    const { normal, rough } = weaveCanvases(kind);
    m.normalMap = this.keep(toTexture(normal, 1, false));
    m.normalMap.channel = 1;
    m.normalScale.setScalar(kind === 'satin' ? 0.25 : 0.55);
    // the weave's roughness on top of the fabric's own
    m.roughnessMap = this.keep(toTexture(rough, 1, false));
    m.roughnessMap.channel = 1;
    m.roughness = Math.min(1, m.roughness * 1.15);
    m.side = THREE.FrontSide;
    return m;
  }

  /** the band tee's or the jersey's chest print */
  private printMat(top: string): THREE.Material {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const g = canvas.getContext('2d')!;
    g.fillStyle = zoneColors(this.look, 'top')[2];
    g.font = `900 ${top === 'jersey_football' ? 150 : 64}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.globalAlpha = top === 'tee_band' ? 0.7 : 1;
    g.fillText(top === 'jersey_football' ? '9' : 'LOW END', 128, 128);
    const tex = this.keep(toTexture(canvas));
    return this.keep(new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
  }

  private buildClothes(): void {
    const l = this.look;
    const d = this.d;
    const b = this.bones;
    const item = (slot: Slot) => l.items[slot] ?? null;

    // tops and outer layers share a torso shell builder
    // the modelled torso is fuller than the code-built one: cut tops a little looser round it
    const fitTop = this.modelShows.has('chest') ? 0.012 : 0;
    const shell = (slot: Slot, push: number, o: ShellStyle) => {
      push += fitTop;
      const m = this.fabric(slot);
      const trim = this.fabric(slot, o.trim ?? 2);
      const gap = o.open ?? 0;
      const ps = gap ? gap / 2 : 0;
      const pl = Math.PI * 2 - gap;
      const lenDrop = o.length ?? 0;
      const bulge = (k: number) => (o.puffy ? 1 + 0.06 * Math.sin(k * Math.PI * 6) ** 2 : 1);
      // a crop stops above the waist and leaves the midriff bare
      const hipPts: [number, number][] = [[(d.hipsR + push) * 0.98 * bulge(0), -0.11 - lenDrop], [d.hipsR + push, -0.03], [(d.hipsR + d.waistR) / 2 + push, 0.06], [d.waistR + push, 0.135]];
      // (the modelled robot jacket is the body itself, padded: only its collar is built here)
      const modelled = slot === 'outer' && !!this.suit?.jacket;
      if (modelled) {
        // a high collar, piping round its top, snap studs down its front either side of the zip
        this.mesh(new THREE.CylinderGeometry(0.062, 0.074, 0.075, 24, 1, true), trim, b.neck, V(0, 0.008, 0));
        const top = this.mesh(new THREE.TorusGeometry(0.0625, 0.0032, 6, 28), this.fabric(slot, 2), b.neck, V(0, 0.046, 0));
        top.rotation.x = Math.PI / 2;
        const stud = this.std(0xd9dde3, { metalness: 0.95, roughness: 0.2 });
        for (const a of [-0.32, 0.32]) for (const y of [-0.004, 0.024]) {
          const st = this.mesh(new THREE.CylinderGeometry(0.0052, 0.0058, 0.003, 14).rotateX(Math.PI / 2), stud, b.neck, V(Math.sin(a) * 0.069, y, Math.cos(a) * 0.069));
          st.rotation.y = a;
        }
        return;
      }
      // cut from the modelled body: only the collar's and hood's extras are built here
      const cut = this.cuts.some((c) => c.slot === slot);
      if (cut) {
        if (o.collar === 'high') this.mesh(new THREE.CylinderGeometry(0.062, 0.072, 0.07, 20, 1, true), trim, b.neck, V(0, 0.01, 0));
        else if (o.collar === 'shirt') {
          for (const s of [-1, 1]) {
            const flap = this.mesh(new THREE.BoxGeometry(0.06, 0.004, 0.05), trim, b.neck, V(s * 0.045, -0.025, 0.04));
            flap.rotation.set(0.6, 0, s * 0.5);
          }
        }
        if (o.hood) {
          const hood = this.mesh(new THREE.SphereGeometry(d.headR * 1.05, 20, 12, Math.PI * 0.95, Math.PI * 1.1, 0, Math.PI * 0.55), m, b.spine, V(0, 0.36 * d.H, -0.05));
          hood.scale.set(1.1, 0.8, 1);
          hood.rotation.x = 1.2;
        }
        return;
      }
      if (!o.crop) this.mesh(lathe(hipPts, d.depth * 1.06, ps, pl), m, b.hips);
      else {
        const hem = this.mesh(new THREE.TorusGeometry(d.chestR * 0.95 + push, 0.005, 6, 28), trim, b.spine, V(0, 0.085 * d.H, 0));
        hem.rotation.x = Math.PI / 2;
        hem.scale.set(1, d.depth * 1.02, 1);
      }
      const chestPts: [number, number][] = [
        o.crop ? [d.chestR * 0.95 + push, 0.085 * d.H] : [d.waistR + push, -0.03],
        [d.chestR * 0.97 + push * bulge(0.3), 0.1 * d.H],
        [d.chestR + push * bulge(0.6), 0.19 * d.H],
        [d.shoulder * 0.86 + push, 0.3 * d.H],
        [d.shoulder * 0.56 + push, 0.345 * d.H],
        [0.07 + push * 0.5, 0.372 * d.H],
      ];
      this.mesh(lathe(chestPts, d.depth * 1.02, ps, pl), m, b.spine);
      for (const s of ['l', 'r'] as const) {
        if (o.sleeves === 'none') continue;
        const { cap: sr, elbow, cuff: wrist } = sleeveRadii(d, o, push);
        const capM = this.mesh(new THREE.SphereGeometry(sr, 16, 12), m, b[`shoulder_${s}`], V(0, -0.004, 0));
        capM.scale.set(1, 0.9, 1);
        const len = o.sleeves === 'short' ? d.upperArm * 0.5 : o.sleeves === 'elbow' ? d.upperArm * 0.92 : d.upperArm;
        const loose = o.sleeves === 'long' ? 0.92 : 1.04;
        this.mesh(new THREE.CylinderGeometry(sr, sr * loose, len, 18, 1, o.sleeves !== 'long').translate(0, -len / 2, 0), m, b[`upper_arm_${s}`]);
        if (o.sleeves === 'long') this.mesh(limb(elbow, d.foreArm * 0.94, wrist), m, b[`forearm_${s}`]);
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
      if (o.piping) this.piping(slot, push, o, hipPts, chestPts);
      if (o.hood) {
        const hood = this.mesh(new THREE.SphereGeometry(d.headR * 1.05, 20, 12, Math.PI * 0.95, Math.PI * 1.1, 0, Math.PI * 0.55), m, b.spine, V(0, 0.36 * d.H, -0.05));
        hood.scale.set(1.1, 0.8, 1);
        hood.rotation.x = 1.2;
      }
    };

    const top = item('top');
    if (top) {
      const o = TOP_STYLE[top] ?? { sleeves: 'short', collar: 'crew' };
      shell('top', o.push ?? 0.01, o);
      // the band tee's faded print and the jersey's number on the chest
      const covered = !!l.items.outer && !['utility_vest', 'jacket_sequin', 'denim_jacket', 'velvet_blazer', 'bomber'].includes(l.items.outer ?? '');
      if ((top === 'tee_band' || top === 'jersey_football') && !covered && !this.cuts.some((c) => c.slot === 'top')) {
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
      if (top === 'hoodie' && !l.items.outer) {
        this.mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), this.fabric('top', 2), b.hips, V(0, 0.07, d.waistR * d.depth + 0.03));
        // the drawstrings, swinging
        for (const sx of [-1, 1]) {
          const knot = new THREE.Object3D();
          knot.position.set(sx * 0.032, 0.205 * d.H, d.chestR * d.depth * 0.82 + 0.014);
          b.chest.add(knot);
          this.mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.13, 5).translate(0, -0.065, 0), this.fabric('top', 2), knot);
          this.mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.014, 6).translate(0, -0.135, 0), this.std(0xd8d8d8, { roughness: 0.4, metalness: 0.6 }), knot);
          this.springs.push({ obj: knot, ox: 0, oz: 0, vx: 0, vz: 0, k: 1.4, body: true });
        }
      }
    }
    const outer = item('outer');
    if (outer) {
      const o = OUTER_STYLE[outer] ?? { sleeves: 'long', collar: 'crew', open: 0.4 };
      shell('outer', o.push ?? 0.03, o);
      if (outer === 'utility_vest') for (const s of [-1, 1]) for (const y of [0.1, 0.2]) this.mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), this.fabric('outer', 2), b.spine, V(s * 0.07, y * d.H, d.chestR * d.depth + 0.04));
    }

    // bottoms
    const bottom = item('bottom');
    if (bottom && !this.suit?.trousers && (bottom.startsWith('skirt') || !this.cuts.some((c) => c.slot === 'bottom'))) {
      const m = this.fabric('bottom');
      const baggy = ['cargos_baggy', 'cargos_black', 'cargo_tech', 'joggers'].includes(bottom) ? 0.028 : bottom === 'trousers_flared' ? 0.012 : 0.01;
      const shorts = bottom.startsWith('shorts');
      const skirt = bottom.startsWith('skirt');
      // the modelled thighs are fuller than the code-built ones: cut shorts and skirts a little looser round them
      const fit = this.modelShows.has('thigh_l') ? 0.022 : 0;
      // and keep the waistband outside a top cut looser round the modelled torso
      const waist = this.modelShows.has('chest') ? 0.016 : 0;
      if (skirt) {
        // a short flared skirt from the waist to mid-thigh, legs bare beneath
        // on a spring at the waist: it swings and flips with the hips
        const sk = new THREE.Object3D();
        sk.position.set(0, 0.1, 0);
        b.hips.add(sk);
        this.mesh(lathe([[d.hipsR * 1.32 + 0.03 + fit, -0.3], [d.hipsR * 1.12 + 0.012 + fit, -0.12], [d.hipsR + 0.012 + fit, -0.03], [(d.hipsR + d.waistR) / 2 + 0.008 + fit / 2 + waist, 0.06], [d.waistR + 0.006 + waist, 0.12]], d.depth * 1.1 * (1 + fit * 3)).translate(0, -0.1, 0), m, sk);
        this.springs.push({ obj: sk, ox: 0, oz: 0, vx: 0, vz: 0, k: 0.25, body: true });
        const band = this.mesh(new THREE.TorusGeometry(d.waistR + 0.008 + waist, 0.006, 6, 28), this.fabric('bottom', 2), b.hips, V(0, 0.115, 0));
        band.rotation.x = Math.PI / 2;
        band.scale.set(1, d.depth * 1.1, 1);
      } else this.mesh(lathe([[d.hipsR * 0.92 + baggy + fit + waist, -0.13], [d.hipsR + baggy + fit + waist, -0.03], [(d.hipsR + d.waistR) / 2 + baggy * 0.7 + waist, 0.06], [d.waistR + 0.006 + waist, 0.12]], d.depth * 1.07), m, b.hips);
      for (const s of ['l', 'r'] as const) {
        if (skirt) continue;
        this.mesh(limb(d.legR * 1.15 + baggy + fit, shorts ? d.thigh * 0.55 : d.thigh, d.legR * 0.95 + baggy + fit), m, b[`thigh_${s}`]);
        if (!shorts) {
          const flare = bottom === 'trousers_flared';
          this.mesh(flare ? new THREE.CylinderGeometry(d.legR * 0.9 + baggy, d.legR * 1.6, d.shin * 0.96, 18, 1, true).translate(0, -d.shin * 0.48, 0) : limb(d.legR * 0.92 + baggy, d.shin * 0.96, d.legR * 0.7 + baggy), m, b[`shin_${s}`]);
        }
        if (bottom === 'pants_robot') {
          // white piping down the outside of each leg
          const k = s === 'l' ? 1 : -1;
          const pipe = this.fabric('bottom', 2);
          const t0 = d.legR * 1.15 + baggy + fit;
          const t1 = d.legR * 0.95 + baggy + fit;
          const s0 = d.legR * 0.92 + baggy;
          const s1 = d.legR * 0.7 + baggy;
          for (const [bone, r0, r1, len] of [[b[`thigh_${s}`], t0, t1, d.thigh], [b[`shin_${s}`], s0, s1, d.shin * 0.96]] as const) {
            const pts = Array.from({ length: 7 }, (_, i) => V(k * (r0 + ((r1 - r0) * i) / 6 + 0.0015), (-len * i) / 6, 0));
            this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0028, 6, false), pipe, bone);
          }
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
      const soleH = { trainers_chunky: 0.04, platforms: 0.08, slides: 0.02, boots_tactical: 0.03, boots_robot: 0.035, deck_shoes: 0.015, slippers: 0.02, gogo_boots: 0.05 }[shoe] ?? 0.025;
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
      if (shoe === 'boots_tactical' || shoe === 'high_tops' || shoe === 'boots_robot') this.mesh(new THREE.CylinderGeometry(0.056, 0.058, shoe === 'high_tops' ? 0.09 : 0.17, 16).translate(0, shoe === 'high_tops' ? -0.01 : 0.03, 0), upper, foot);
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
    const robotHead = ROBOT_HEADS.has(hat ?? '');
    if (hat && robotHead) {
      this.robot = buildRobotHead(
        hat,
        this.robotKit(),
        b.head,
        r,
        zoneColors(l, 'head'),
        this.djName,
      );
    } else if (hat) {
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

    // a robot head has no eyes, ears or nose for glasses, headphones or piercings
    const eyewear = robotHead ? null : l.items.eyewear;
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

    const phones = robotHead ? null : l.items.headphones;
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
      } else if (wear === 'one_ear') {
        // the DJ's way: the left cup on the ear, the band across the crown, the right cup pushed up off the other ear
        const pivot = new THREE.Group();
        pivot.position.copy(headTop).add(V(r * 1.12, -0.005, -r * 0.02));
        b.head.add(pivot);
        g.position.set(-r * 1.12, 0, 0);
        pivot.add(g);
        pivot.rotation.set(0, -0.32, 0.46);
        g.userData.oneEar = true;
      } else {
        g.position.copy(headTop).add(V(0, r * 0.05, -r * 0.02));
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
        // the pass swings on its clip
        const clip = new THREE.Object3D();
        clip.position.set(0, 0.2 * d.H + 0.04, d.chestR * d.depth + 0.03);
        b.spine.add(clip);
        this.mesh(new THREE.BoxGeometry(0.05, 0.07, 0.004).translate(0, -0.04, 0), this.fabric('neck', 2), clip);
        this.springs.push({ obj: clip, ox: 0, oz: 0, vx: 0, vz: 0, k: 1.1, body: true });
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
      // over the left shoulder, the ends hanging front and back, swinging as you move
      const tm = this.fabric('bag');
      const tw = this.mesh(new THREE.BoxGeometry(0.11, 0.012, 0.14), tm, b.shoulder_l, V(-0.02, 0.05, 0));
      tw.rotation.z = 0.25;
      for (const zs of [1, -1]) {
        const flap = new THREE.Object3D();
        flap.position.set(-0.02, 0.045, zs * 0.07);
        b.shoulder_l.add(flap);
        this.mesh(new THREE.BoxGeometry(0.11, 0.24, 0.01).translate(0, -0.12, zs * 0.012), tm, flap);
        flap.rotation.x = zs * -0.12;
        this.springs.push({ obj: flap, ox: 0, oz: 0, vx: 0, vz: 0, k: 0.8, body: true, rest: flap.rotation.clone() });
      }
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
    for (const p of robotHead ? [] : l.piercings) {
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

  /**
   * A control just moved (from the mouse, a key, MIDI or the Auto DJ): the
   * hand on that side goes to it and stays while it keeps moving. `get`
   * gives where it is now, in world space.
   */
  touch(get: () => THREE.Vector3 | null, hold: HandHold = 'grip', turn: (() => number) | null = null): void {
    const at = get();
    if (!at) return;
    const side: 'l' | 'r' = this.object.worldToLocal(this.ikT.copy(at)).x >= 0 ? 'l' : 'r';
    const cur = this.reaching[side];
    const t0 = turn ? turn() : 0;
    if (cur) {
      // a different control (somewhere else on the board): take hold of it afresh
      const was = cur.get();
      if (cur.hold !== hold || !was || was.distanceToSquared(at) > 0.02 * 0.02) {
        cur.turn0 = t0;
        cur.twist = 0;
      }
      cur.get = get;
      cur.age = 0;
      cur.hold = hold;
      cur.turn = turn;
      if (hold === 'press') cur.tap = -1;
    } else this.reaching[side] = { get, age: 0, w: 0, hold, turn, turn0: t0, twist: 0, tap: -1, wrist: new THREE.Vector3(), q: new THREE.Quaternion(), ok: false };
  }

  /**
   * The hands that are on controls, laid over the pose. First where each
   * wrist has to be (in the avatar's space), then, if a control is further
   * than an arm goes, a lean over the decks, then the arms reach.
   */
  private applyReach(dt: number): void {
    const b = this.bones;
    let updated = false;
    let lean = 0;
    for (const side of ['l', 'r'] as const) {
      const r = this.reaching[side];
      if (!r) continue;
      r.age += dt;
      const want = r.age < REACH_HOLD ? 1 : 0;
      r.w += (want - r.w) * Math.min(1, dt * (want > r.w ? 9 : 3.5));
      if (want === 0 && r.w < 0.01) {
        this.reaching[side] = null;
        continue;
      }
      const at = r.get();
      r.ok = !!at;
      if (!at) continue;
      if (!updated) {
        this.object.updateMatrixWorld(true);
        updated = true;
      }
      const k = side === 'l' ? 1 : -1;
      const hold = r.hold;
      const p = r.wrist;
      if (hold === 'grip') {
        const local = b[`shoulder_${side}`].worldToLocal(p.copy(at));
        // the wrist a hand's length short of the control, a little above it
        const len = local.length();
        if (len > 1e-4) local.multiplyScalar(Math.max(0.05, len - 0.07) / len);
        local.y += 0.03;
        this.object.worldToLocal(b[`shoulder_${side}`].localToWorld(p));
      } else {
        // the hand's own way of holding this control, and the point of it that touches it
        const fr = HOLD_FRAME[hold];
        const q = handFrame(k * fr.fingers[0], fr.fingers[1], fr.fingers[2], k * fr.palm[0], fr.palm[1], fr.palm[2], r.q);
        this.object.worldToLocal(p.copy(at));
        const turned = r.turn ? r.turn() : 0;
        if (hold === 'knob') {
          // the wrist turns with the knob, as far as a wrist goes (then the fingers slip round it)
          const d = turned - r.turn0;
          if (d > 1.1) r.turn0 = turned - 1.1;
          if (d < -1.1) r.turn0 = turned + 1.1;
          r.twist = turned - r.turn0;
          q.premultiply(tmpQ.setFromAxisAngle(UP, r.twist + k * 0.25));
        } else if (hold === 'jog') {
          // the palm goes round with the record, springing back to the near side between pushes
          let d = turned - r.turn0;
          d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
          r.turn0 = turned;
          r.twist = THREE.MathUtils.clamp(r.twist * Math.exp(-dt * 2.5) + d, -0.7, 0.7);
          // round the platter's middle, about a palm's length further on
          const R = 0.07;
          p.x += -R * Math.sin(r.twist);
          p.z += R - R * Math.cos(r.twist);
          q.premultiply(tmpQ.setFromAxisAngle(UP, r.twist));
        } else if (hold === 'press') {
          // a tap once the hand is there: down onto it and up again, then resting just above
          if (r.tap < 0 && r.w > 0.8) r.tap = 0;
          if (r.tap >= 0) r.tap += dt;
          const dip = r.tap >= 0 && r.tap < 0.26 ? Math.sin((r.tap / 0.26) * Math.PI) : 0;
          p.y += r.tap > 0.26 ? 0.005 : 0.016 * (1 - dip);
        }
        // the wrist: the touching point back along the hand
        p.sub(tmpA.set(k * fr.touch[0], fr.touch[1], fr.touch[2]).applyQuaternion(q));
      }
      // how far past an arm's length it is
      const sh = this.object.worldToLocal(b[`shoulder_${side}`].getWorldPosition(tmpB));
      const over = sh.distanceTo(p) - (this.d.upperArm + this.d.foreArm) * 0.95;
      lean = Math.max(lean, cl(over * 1.8, 0, 0.5) * r.w);
    }
    if (!updated) return;
    // too far to reach standing up: lean in over the decks (the eyes staying on them)
    if (lean > 0) {
      b.spine.rotation.x += lean * 0.6;
      b.chest.rotation.x += lean * 0.4;
      b.neck.rotation.x -= lean * 0.5;
      this.object.updateMatrixWorld(true);
    }
    for (const side of ['l', 'r'] as const) {
      const r = this.reaching[side];
      if (!r || !r.ok) continue;
      const k = side === 'l' ? 1 : -1;
      const local = b[`shoulder_${side}`].worldToLocal(this.object.localToWorld(this.ikT.copy(r.wrist)));
      const { q, bend } = twoBoneIK(local, this.d.upperArm, this.d.foreArm, new THREE.Vector3(k * 0.9, -0.55, -0.45), this.ikQ);
      const ua = b[`upper_arm_${side}`];
      ua.quaternion.slerp(q, r.w);
      const fa = b[`forearm_${side}`];
      fa.rotation.x += (-bend - fa.rotation.x) * r.w;
      // the hand onto it, and a glance down at what the hand's doing
      if (r.hold === 'grip') b[`hand_${side}`].rotation.x += (-0.45 - b[`hand_${side}`].rotation.x) * r.w;
      else this.orientHand(side, r.q, r.w);
      b.neck.rotation.x += 0.08 * r.w;
    }
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
    if (s.playing) this.sweat = Math.min(1, this.sweat + dt / 900);

    // rest pose
    for (const o of Object.values(b)) o.rotation.set(0, 0, 0);
    b.hips.position.set(0, this.d.hipY, 0);
    this.body.position.y = 0;
    if (this.mode === 'hype') {
      // a real dance, locked to the beat, while there's music; the routine otherwise
      if (this.club && s.playing) {
        const p = this.club.update({ beat, build: s.build, sinceDrop: this.dropT, beatLen: 60 / 124 }, this.d.thigh + this.d.shin, dt);
        applyPose(p, b, this.d.hipY);
        this.curlHand('l', p.curl[0], dt);
        this.curlHand('r', p.curl[1], dt);
      } else this.dance(s, beat, ph, hit, knee);
      this.express(s, dt, beat, hit, 0);
      this.settle(dt);
      this.model?.sync();
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
    // a move from the pads takes over the arms (and the legs, for a jump or the climb)
    const perf = this.perf;
    let performing = false;
    if (perf) {
      perf.t += dt;
      if (perf.t >= perf.len) this.perf = null;
      else {
        performing = true;
        dropping = false;
        const pump = hit;
        const sway = Math.sin(beat * Math.PI);
        if (perf.id === 'hands_up') {
          setArm('l', -0.35, 2.55 + 0.18 * sway, -0.3);
          setArm('r', -0.35, 2.55 - 0.18 * sway, -0.3);
          b.neck.rotation.x = -0.15;
        } else if (perf.id === 'jump') {
          this.body.position.y = Math.max(0, Math.sin(ph * Math.PI)) * 0.2;
          for (const side of ['l', 'r'] as const) {
            b[`thigh_${side}`].rotation.x = -0.35 * hit;
            b[`shin_${side}`].rotation.x = 0.7 * hit;
          }
          setArm('l', -0.3, 2.5, -0.35);
          setArm('r', -0.3, 2.5, -0.35);
        } else if (perf.id === 'point') {
          // out over the decks at the crowd, a jab on each beat, sweeping across the room
          setArm('r', -1.55 - pump * 0.12, 0.2 + 0.35 * Math.sin(beat * Math.PI * 0.25), -0.05);
          setArm('l', -0.6, 0.3, -1.2);
          b.spine.rotation.y = 0.2 * Math.sin(beat * Math.PI * 0.25);
          b.neck.rotation.x = -0.05;
        } else if (perf.id === 'clap') {
          const open = 1 - Math.pow(1 - ph, 6);
          setArm('l', -0.3, 2.45 - 0.45 * (1 - open), -0.35, 0);
          setArm('r', -0.3, 2.45 - 0.45 * (1 - open), -0.35, 0);
        } else if (perf.id === 'fist_pump') {
          setArm('r', -2.1 - pump * 0.6, 0.35, -1.0 + pump * 0.6);
          setArm('l', -0.85, 0.32, -0.75);
        } else if (perf.id === 'climb') {
          // up onto the front of the booth, arms up to the room, and back down
          const k = smooth(0, 0.7, perf.t) * (1 - smooth(perf.len - 0.7, perf.len, perf.t));
          this.body.position.y = 0.92 * k + Math.max(0, Math.sin(ph * Math.PI)) * 0.05 * k;
          this.body.position.z = 0.32 * k;
          setArm('l', -0.3 * k, 2.6 * k + 0.32 * (1 - k) + 0.2 * sway * k, -0.3 - 0.45 * (1 - k));
          setArm('r', -0.3 * k, 2.6 * k + 0.32 * (1 - k) - 0.2 * sway * k, -0.3 - 0.45 * (1 - k));
          b.neck.rotation.x = 0.32 - 0.45 * k;
          b.spine.rotation.x = 0.12 * (1 - k);
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
    const habitOn = s.playing && !dropping && !performing && s.peak < 0.4 && bar % 32 >= 28 && bar % 32 < 30;
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

    if (dj && !performing) {
      this.cueGesture(beat, dt);
      this.applyReach(dt);
    }

    // fingers: on the decks, round a control (in that control's shape), open with hands up, a fist for the pump
    const move = dropping ? option(l, 'drop_move') : '';
    for (const side of ['l', 'r'] as const) {
      let want = dj ? 0.55 : 0.35;
      let pose: HandPose | null = null;
      if (move === 'hands_up' || move === 'jump') want = 0.12;
      if (move === 'fist_pump' && side === 'r') want = 1.5;
      if (move === 'point' && side === 'r') want = 1.25;
      if (habitOn && side === 'r' && habit === 'sip') want = 1.1;
      const reach = this.reaching[side];
      if (reach && reach.w > 0.3 && !performing) {
        want = 0.88;
        pose = HOLD_POSE[reach.hold];
      } else if (side === 'l' && this.pressW > 0.3) pose = 'cup';
      if (performing) {
        const id = this.perf?.id;
        want = id === 'fist_pump' && side === 'r' ? 1.5 : id === 'point' && side === 'r' ? 1.25 : id === 'point' || id === 'fist_pump' ? want : 0.12;
        pose = null;
      }
      this.curlHand(side, want, dt, pose);
    }

    // the face, and the eyes: on the decks, up to the room now and then
    const lookUp = dropping || s.peak > 0.5 || (bar % 4 === 3 && ph < 0.75);
    this.express(s, dt, beat, hit, dj ? (lookUp ? -0.06 : 0.3) : 0);
    this.settle(dt);
    this.model?.sync();
  }

  /**
   * The face: how much of each expression the moment calls for (eased in and
   * out), summed into the face's channels, which move its parts. `gaze` is
   * where the eyes would look anyway (down at the decks, up at the room).
   */
  private express(s: AvatarInput, dt: number, beat: number, hit: number, gaze: number): void {
    const beatLen = 60 / 124;
    const playing = s.playing ? 1 : 0;
    this.niceT += dt;
    this.oopsT += dt;
    // what the moment wants, each 0..1
    const stank = smooth(0, 0.08, this.dropT) * (1 - smooth(beatLen * 10, beatLen * 16, this.dropT));
    const rise = smooth(0.84, 0.96, s.build) * playing * (1 - stank);
    const lost = smooth(0.2, 0.5, s.build) * playing * (1 - rise) * (1 - stank);
    const grin = Math.max(smooth(0.6, 0.92, s.hype ?? 0), s.peak * 0.85) * playing * (1 - stank) * (1 - lost) * (1 - rise);
    const reach = Math.max(this.reaching.l?.w ?? 0, this.reaching.r?.w ?? 0);
    const focus = (this.mode === 'dj' ? reach : 0) * (1 - stank) * (1 - lost) * (1 - grin * 0.6);
    const nice = this.niceT < 1.2 ? smooth(0, 0.08, this.niceT) * (1 - smooth(0.6, 1.2, this.niceT)) : 0;
    const oops = this.oopsT < 1.4 ? smooth(0, 0.06, this.oopsT) * (1 - smooth(0.7, 1.4, this.oopsT)) : 0;
    const target = this.exprW;
    for (let i = 0; i < EXPRESSION_IDS.length; i++) {
      const id = EXPRESSION_IDS[i];
      const want = id === 'stank' ? stank : id === 'lost' ? lost : id === 'rise' ? rise : id === 'grin' ? grin : id === 'focus' ? focus : id === 'nice' ? nice : oops;
      // quick to come on, slower to let go (the flashes follow their own envelope)
      const rate = id === 'nice' || id === 'oops' ? 30 : want > target[i] ? 7 : 2.5;
      target[i] += (want - target[i]) * Math.min(1, dt * rate);
    }
    // the channels: the expressions summed
    const F = this.faceNow;
    F.fill(0);
    for (let i = 0; i < EXPRESSION_IDS.length; i++) {
      const w = target[i];
      if (w < 1e-3) continue;
      const e = EXPRESSIONS[EXPRESSION_IDS[i]];
      for (let c = 0; c < F.length; c++) F[c] += e[c] * w;
    }
    const sw = target[STANK];
    // the stank face nods hard into each kick, the mouth going with it
    F[CH.pitch] += sw * 0.14 * hit;
    F[CH.jaw] += sw * 0.3 * hit;
    // mouthing along with a vocal: a syllable on each eighth (some held, some skipped), harder on a hook
    const sing = Math.min(1, (s.vocal ?? 0) * 1.1 + (s.accent ?? 0) * 0.5) * playing * (1 - sw) * (1 - target[LOST] * 0.6);
    if (sing > 0.02) {
      const n = Math.floor(beat * 2);
      const a = hash01(n);
      const syl = a < 0.25 ? 0 : (0.45 + 0.55 * a) * Math.sin((((beat * 2) % 1) + 1) % 1 * Math.PI);
      F[CH.jaw] += sing * 0.55 * syl;
      F[CH.pucker] += sing * (hash01(n + 17) > 0.6 ? 0.7 : 0) * syl;
      F[CH.brow] += sing * 0.25;
    }

    // and move the parts
    const fr = this.faceRig;
    const b = this.bones;
    const brow = cl(F[CH.brow], -1, 1.2);
    const frown = cl(F[CH.frown], -1, 1);
    for (const br of fr.brows) {
      br.pivot.position.y = br.y + brow * 0.0055 - Math.max(0, frown) * 0.0015;
      br.pivot.position.x = br.x - br.s * Math.max(0, frown) * 0.004;
      // the inner end down (a frown) or up (worried)
      br.pivot.rotation.z = br.s * frown * 0.28;
    }
    const squint = cl(F[CH.squint], 0, 1);
    this.lidClose = cl(F[CH.lids], -0.5, 1);
    for (const lid of fr.lowerLids) lid.rotation.x = 0.2 - squint * 0.4;
    const sneer = cl(F[CH.sneer], 0, 1);
    for (const n of fr.nose) {
      n.obj.position.y = n.y + sneer * 0.0025;
      n.obj.scale.setScalar(1 + sneer * 0.18);
    }
    const jaw = cl(F[CH.jaw], 0, 1);
    const smile = cl(F[CH.smile], -1, 1);
    const wide = cl(F[CH.wide], 0, 1);
    const pucker = cl(F[CH.pucker], 0, 1);
    if (fr.upper && fr.lower) {
      fr.upper.position.y = fr.upperY + jaw * 0.003 + sneer * 0.0015;
      fr.lower.position.y = fr.lowerY - jaw * 0.012;
      fr.upper.scale.set(1 - pucker * 0.3 + wide * 0.2, 1, 1 + pucker * 0.4);
      fr.lower.scale.set(1 - pucker * 0.3 + wide * 0.2, 1, 1 + pucker * 0.4);
    }
    for (const h of fr.halves) {
      // corners up or down; opened, the halves angle into a mouth shape (the corners stay together)
      const open = h.upper ? -Math.atan(jaw * 0.2) : Math.atan(jaw * 0.6);
      const curl = h.upper && h.s === this.sneerSide ? sneer * 0.35 : 0;
      h.obj.rotation.z = h.s * (smile * 0.38 + open + curl);
    }
    // the shape keys: the cheeks round up with a smile or a squint, the chin drops with the jaw
    const cheeks = cl(Math.max(squint * 0.8, F[CH.smile] * 0.9 + wide * 0.2), 0, 1);
    for (const m of fr.morphs) {
      const inf = m.morphTargetInfluences;
      if (!inf) continue;
      inf[0] = cheeks;
      inf[1] = jaw;
    }
    if (fr.inside) {
      fr.inside.scale.set(1 + wide * 0.25 - pucker * 0.3, 0.6 + jaw * 2.2, 1);
      fr.inside.position.y = fr.insideY - jaw * 0.006;
    }
    // the head: back in the breakdown, nodding into the drop, tilted
    b.head.rotation.x += cl(F[CH.pitch], -0.8, 0.5);
    b.head.rotation.z += cl(F[CH.roll], -0.3, 0.3) * this.sneerSide;
    // the eyes: down at the board when a hand's on something
    const look = gaze + cl(F[CH.gaze], 0, 1) * 0.2;
    for (const e of fr.eyes) e.rotation.x += (look - e.rotation.x) * Math.min(1, dt * 6);
    // a robot head shows the same face its own way (drawn in settle, once the blink is known)
    if (this.robot) {
      const ri = this.robotIn;
      ri.jaw = jaw;
      ri.smile = smile;
      ri.squint = squint;
      ri.stank = sw;
      ri.lost = target[LOST];
      ri.grin = target[GRIN];
      ri.kick = s.kick;
      ri.beat = beat;
      ri.playing = s.playing;
    }
  }

  /**
   * Cueing in the headphones (a channel cued, the next track lined up): the
   * head tips over to the cup on the left ear and, two bars in every four,
   * the left hand comes up and holds the cup to the ear, palm round it,
   * elbow out. A control to reach for takes the hand back down.
   */
  private cueGesture(beat: number, dt: number): void {
    const b = this.bones;
    const g = this.headphones;
    if (!g || g.parent === b.hand_r || option(this.look, 'phones_wear') === 'neck') return;
    const on = this.cueing ? 1 : 0;
    this.cueW += (on - this.cueW) * Math.min(1, dt * 3);
    if (this.cueW < 0.01) {
      this.pressW = 0;
      return;
    }
    // the head over to the cup on the left ear, that shoulder up to meet it
    b.neck.rotation.z -= 0.2 * this.cueW;
    b.shoulder_l.position.y += 0.014 * this.cueW;
    // eight beats in every sixteen: the left hand holds the cup to the ear
    const hold = this.cueing && ((beat % 16) + 16) % 16 < 8 && (this.reaching.l?.w ?? 0) < 0.2;
    this.pressW += ((hold ? 1 : 0) - this.pressW) * Math.min(1, dt * 5);
    if (this.pressW < 0.01) return;
    // pressing it in, the head leans into the hand
    b.neck.rotation.z -= 0.06 * this.pressW;
    this.object.updateMatrixWorld(true);
    const r = this.d.headR;
    // the palm on the cup, fingers up the side of the head, then the wrist back from there
    const q = handFrame(0.05, 1, -0.35, -1, 0.1, 0.15, this.handQ);
    const cup = this.object.worldToLocal(b.head.localToWorld(this.ikT.set(r * 1.42, r * 0.85, -r * 0.05)));
    cup.sub(tmpA.set(0, -0.05, -0.022).applyQuaternion(q));
    const local = b.shoulder_l.worldToLocal(this.object.localToWorld(cup));
    const { q: armQ, bend } = twoBoneIK(local, this.d.upperArm, this.d.foreArm, new THREE.Vector3(1, -0.4, -0.2), this.ikQ);
    b.upper_arm_l.quaternion.slerp(armQ, this.pressW);
    b.forearm_l.rotation.x += (-bend - b.forearm_l.rotation.x) * this.pressW;
    this.orientHand('l', this.handQ, this.pressW);
  }

  /** the hype dancers' routine, locked to the beat */
  private dance(s: AvatarInput, beat: number, ph: number, hit: number, knee: number): void {
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
  }

  /** blinking, the hair's springs, sweat and blacklight: every mode */
  private settle(dt: number): void {
    const b = this.bones;
    // blinking
    this.blinkAt -= dt;
    const blink = this.blinkAt < 0 ? 1 : 0;
    if (this.blinkAt < -0.12) this.blinkAt = 2.5 + Math.random() * 3.5;
    // the lids where the face has them (shut in the breakdown, wide at the top of a build), a blink over that
    const c = this.lidClose;
    for (const lid of this.lids) lid.rotation.x = blink ? 0.6 : c >= 0 ? -0.35 + c * 0.95 : -0.35 + c * 0.4;
    if (this.robot) {
      this.robotIn.blink = !!blink;
      this.robot.update(this.robotIn, dt);
    }

    // hair and clothes swing: springs pushed by how the head (hair) or the chest (clothes) moves
    this.object.updateMatrixWorld(true);
    const hp = b.head.getWorldPosition(new THREE.Vector3());
    const dv = hp.clone().sub(this.lastHead);
    this.lastHead.copy(hp);
    const cp = b.chest.getWorldPosition(new THREE.Vector3());
    const dc = cp.clone().sub(this.lastChest);
    this.lastChest.copy(cp);
    // (in the body's own frame, so turning the avatar round doesn't flip the swing)
    const inv = new THREE.Quaternion();
    this.object.getWorldQuaternion(inv).invert();
    dv.applyQuaternion(inv);
    dc.applyQuaternion(inv);
    if (dt > 0 && dv.lengthSq() < 0.05 && dc.lengthSq() < 0.05) {
      const span = Math.min(dt, 0.1);
      const steps = Math.ceil(span / (1 / 120));
      const h = span / steps;
      // the velocity kicks the springs once per frame, then they settle in small steps
      const kick = Math.min(1, 0.016 / Math.max(0.016, dt));
      for (const sp of this.springs) {
        const v = sp.body ? dc : dv;
        // bouncing up and down lifts a hanging thing too (and drops it back)
        sp.vx += (-(v.z / dt) * 0.9 * 60 + (sp.body ? -(v.y / dt) * 20 : 0)) * sp.k * span * kick;
        sp.vz += (v.x / dt) * 0.9 * 60 * sp.k * span * kick;
        for (let i = 0; i < steps; i++) {
          sp.vx += (-sp.ox * 60 - sp.vx * 7) * h;
          sp.vz += (-sp.oz * 60 - sp.vz * 7) * h;
          sp.ox = Math.max(-0.5, Math.min(0.5, sp.ox + sp.vx * h));
          sp.oz = Math.max(-0.5, Math.min(0.5, sp.oz + sp.vz * h));
        }
        if (sp.body) sp.obj.rotation.set((sp.rest?.x ?? 0) + sp.ox, sp.rest?.y ?? 0, (sp.rest?.z ?? 0) + sp.oz);
        else sp.obj.rotation.set(sp.ox - b.neck.rotation.x * 0.6 * sp.k, 0, sp.oz);
      }
    }

    // sweat: the skin gets a sheen through a long set; blacklight makes UV paint and fabric glow
    for (const m of this.skinMats) {
      m.roughness = 0.62 - this.sweat * 0.35;
      m.clearcoat = this.sweat * 0.55;
    }
    for (const g of this.glowMats) g.mat.emissiveIntensity = (g.base ?? 0) + this.uv * g.k;
  }
}
