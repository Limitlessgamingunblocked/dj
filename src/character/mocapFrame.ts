/*
 * Body tracking's output, as the character takes it: the player's pose and
 * face from the webcam (app/mocap/), in the character's own space (+X its
 * left, +Y up, +Z forward, out to the room), measured from the player's
 * own resting pose so sitting a little turned to the camera doesn't turn
 * the DJ. No camera or model in here, so it runs in the tests.
 *
 * Every part has its own weight, 0 (the game's own animation) to 1 (the
 * player's), so an arm out of the picture goes back to the decks while the
 * other keeps copying you, and nobody in view hands everything back.
 */
import * as THREE from 'three';

export type MocapPart = 'torso' | 'armL' | 'armR' | 'handL' | 'handR' | 'legs' | 'head' | 'face';
export const MOCAP_PARTS: MocapPart[] = ['torso', 'armL', 'armR', 'handL', 'handR', 'legs', 'head', 'face'];

/** a limb: the way the upper and lower parts point (unit vectors) */
export interface MocapLimb {
  upper: THREE.Vector3;
  lower: THREE.Vector3;
}

export interface MocapHand {
  /** the way the fingers point and the way the palm faces (unit vectors) */
  fingers: THREE.Vector3;
  palm: THREE.Vector3;
  /** per finger, index to little: the bend at the knuckle and further along (radians) */
  knuckle: number[];
  mid: number[];
  /** the thumb's bend in across the palm (radians) */
  thumb: number;
}

/** the face, in the character's own face channels (the same ranges as its expressions) */
export interface MocapFace {
  brow: number;
  frown: number;
  squint: number;
  jaw: number;
  smile: number;
  wide: number;
  sneer: number;
  pucker: number;
  /** eyes wide open (0..1) */
  eyesWide: number;
  /** each eye shut (0..1): the character's left and right */
  blinkL: number;
  blinkR: number;
  /** where the eyes look: + to the character's left, + up (about -1..1) */
  gazeX: number;
  gazeY: number;
}

export interface MocapFrame {
  w: Record<MocapPart, number>;
  /** the chest's turn from the player's resting pose */
  torso: THREE.Quaternion;
  /** the hips' turn (only with the legs in view) */
  hips: THREE.Quaternion;
  /** the head's turn from the player's resting pose */
  head: THREE.Quaternion;
  arm: { l: MocapLimb; r: MocapLimb };
  leg: { l: MocapLimb; r: MocapLimb };
  hand: { l: MocapHand; r: MocapHand };
  face: MocapFace;
}

const limb = (): MocapLimb => ({ upper: new THREE.Vector3(0, -1, 0), lower: new THREE.Vector3(0, -1, 0) });
const hand = (): MocapHand => ({ fingers: new THREE.Vector3(0, -1, 0), palm: new THREE.Vector3(0, 0, -1), knuckle: [0.3, 0.3, 0.3, 0.3], mid: [0.3, 0.3, 0.3, 0.3], thumb: 0.1 });
export const restFace = (): MocapFace => ({ brow: 0, frown: 0, squint: 0, jaw: 0, smile: 0, wide: 0, sneer: 0, pucker: 0, eyesWide: 0, blinkL: 0, blinkR: 0, gazeX: 0, gazeY: 0 });

export function newFrame(): MocapFrame {
  return {
    w: Object.fromEntries(MOCAP_PARTS.map((p) => [p, 0])) as Record<MocapPart, number>,
    torso: new THREE.Quaternion(),
    hips: new THREE.Quaternion(),
    head: new THREE.Quaternion(),
    arm: { l: limb(), r: limb() },
    leg: { l: limb(), r: limb() },
    hand: { l: hand(), r: hand() },
    face: restFace(),
  };
}

/** whether anything of the player shows on the character */
export function frameActive(f: MocapFrame | null): f is MocapFrame {
  return !!f && MOCAP_PARTS.some((p) => f.w[p] > 1e-3);
}

const lerpDir = (out: THREE.Vector3, to: THREE.Vector3, a: number) => {
  out.lerp(to, a);
  if (out.lengthSq() < 1e-8) out.copy(to);
  return out.normalize();
};

/**
 * Move `out` towards `to`: the pose by `a` (0..1 this frame), the weights by
 * `wIn` when a part comes into view and `wOut` when it goes. A part on its
 * way in from nothing jumps to the player's pose (it fades in from the
 * game's own animation, not from wherever the last tracking left it).
 */
export function easeFrame(out: MocapFrame, to: MocapFrame, a: number, wIn: number, wOut: number): void {
  const snap = (p: MocapPart) => (out.w[p] < 1e-3 && to.w[p] > 0 ? 1 : a);
  out.torso.slerp(to.torso, snap('torso'));
  out.hips.slerp(to.hips, snap('legs'));
  out.head.slerp(to.head, snap('head'));
  for (const s of ['l', 'r'] as const) {
    const S = s === 'l' ? 'L' : 'R';
    const ka = snap(`arm${S}`);
    lerpDir(out.arm[s].upper, to.arm[s].upper, ka);
    lerpDir(out.arm[s].lower, to.arm[s].lower, ka);
    const kl = snap('legs');
    lerpDir(out.leg[s].upper, to.leg[s].upper, kl);
    lerpDir(out.leg[s].lower, to.leg[s].lower, kl);
    const kh = snap(`hand${S}`);
    const h = out.hand[s];
    const th = to.hand[s];
    lerpDir(h.fingers, th.fingers, kh);
    lerpDir(h.palm, th.palm, kh);
    for (let i = 0; i < 4; i++) {
      h.knuckle[i] += (th.knuckle[i] - h.knuckle[i]) * kh;
      h.mid[i] += (th.mid[i] - h.mid[i]) * kh;
    }
    h.thumb += (th.thumb - h.thumb) * kh;
  }
  const kf = snap('face');
  for (const k of Object.keys(out.face) as (keyof MocapFace)[]) out.face[k] += (to.face[k] - out.face[k]) * kf;
  for (const p of MOCAP_PARTS) {
    const d = to.w[p] - out.w[p];
    out.w[p] = Math.abs(d) < 1e-4 ? to.w[p] : out.w[p] + d * (d > 0 ? wIn : wOut);
  }
}
