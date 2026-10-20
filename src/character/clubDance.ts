/*
 * How people on a club floor dance: a handful of simple, smooth moves, each
 * locked to the beat, made of what bodies really do (the knees taking the
 * bounce, the weight going side to side, the hips and shoulders turning
 * against each other, the head nodding), never a sudden snap: every part
 * moves on a smooth curve through the beat, and one move eases into the next.
 *
 * The men's moves: the fist pump, two hands up, the two-step, the nod with a
 * hand easy at the chest. The women's: the hip sway with one hand up, arms up with the
 * hips rolling, the shoulder shimmy, two hands up. Both: pointing up at the
 * booth on the beat, and an easy groove with the arms loose. Everyone claps
 * through a build and jumps on the drop. The feet stay planted (applyPose),
 * the arms and head trail the body a moment, and each person sits on the beat
 * their own way and looks about now and then (ClubDancer).
 *
 * Poses are Euler turns on the game's bones from rest (as Avatar's own moves
 * are): an upper arm's z lifts it out to the side (about 2.6 is straight up),
 * its x swings it forward (negative) or back; the forearm's x bends the elbow
 * (negative). Left-side turns about y and z mirror on the right.
 */
import * as THREE from 'three';

export type ClubMove = 'pump' | 'hands_up' | 'two_step' | 'nod' | 'sway' | 'roll' | 'shimmy' | 'point' | 'groove';

export const MEN_MOVES: ClubMove[] = ['pump', 'hands_up', 'two_step', 'nod', 'point', 'groove'];
export const WOMEN_MOVES: ClubMove[] = ['sway', 'roll', 'shimmy', 'hands_up', 'groove', 'point'];

/** the bones a move turns, and the hips' offset from where they rest */
const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulder_l', 'shoulder_r', 'upper_arm_l', 'upper_arm_r', 'forearm_l', 'forearm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r'] as const;
type Bone = (typeof BONES)[number];
const N = BONES.length;
const IX = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<Bone, number>;

/** a pose: every bone's x, y, z turn, the hips' offset, and how curled each hand is */
export interface Pose {
  rot: Float32Array;
  hips: [number, number, number];
  curl: [number, number];
}
export const newPose = (): Pose => ({ rot: new Float32Array(N * 3), hips: [0, 0, 0], curl: [0.35, 0.35] });

export interface ClubInput {
  /** the beat (fractional), counting up */
  beat: number;
  /** 0..1: how far into a build the music is (claps past 0.5) */
  build: number;
  /** seconds since the last drop hit */
  sinceDrop: number;
  /** seconds a beat lasts */
  beatLen: number;
}

/** a smooth push on the beat: 1 on it, easing to 0 halfway between beats, never a jump */
const onBeat = (ph: number) => {
  const c = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2);
  return c * c;
};

function set(p: Pose, b: Bone, x: number, y = 0, z = 0): void {
  const i = IX[b] * 3;
  p.rot[i] = x;
  p.rot[i + 1] = y;
  p.rot[i + 2] = z;
}
function add(p: Pose, b: Bone, x: number, y = 0, z = 0): void {
  const i = IX[b] * 3;
  p.rot[i] += x;
  p.rot[i + 1] += y;
  p.rot[i + 2] += z;
}
/**
 * An arm: lift out (z), swing forward (x, negative), turn (y: negative rolls it in, so a bent elbow
 * brings the hand in front of the body), and the elbow's bend. `twist` turns the upper arm about its
 * own length and `wrist` the hand about the forearm's (the forearm sharing it): the hand hangs palm
 * back, so an arm raised overhead needs both to show the palm forward, as people's do.
 */
function arm(p: Pose, s: 'l' | 'r', ux: number, uz: number, fx: number, uy = 0, twist = 0, wrist = 0): void {
  const k = s === 'l' ? 1 : -1;
  if (twist) {
    _q.setFromEuler(_e.set(ux, uy * k, uz * k)).multiply(_t.setFromAxisAngle(UP, twist * k));
    _e.setFromQuaternion(_q);
    // (the turn as Euler angles nearest the untwisted arm's, so they move smoothly with it, never wrapping round)
    const ref = [ux, uy * k, uz * k];
    const near = (a: number, r: number) => a + Math.round((r - a) / (Math.PI * 2)) * Math.PI * 2;
    const pick = (x: number, y: number, z: number) => [near(x, ref[0]), near(y, ref[1]), near(z, ref[2])];
    const a = pick(_e.x, _e.y, _e.z);
    const b = pick(_e.x + Math.PI, Math.PI - _e.y, _e.z + Math.PI);
    const off = (v: number[]) => v.reduce((t, x, i) => t + Math.abs(x - ref[i]), 0);
    const [x, y, z] = off(a) <= off(b) ? a : b;
    set(p, `upper_arm_${s}`, x, y, z);
  } else set(p, `upper_arm_${s}`, ux, uy * k, uz * k);
  set(p, `forearm_${s}`, fx);
  add(p, `hand_${s}`, 0, wrist * k);
}
const _q = new THREE.Quaternion();
const _t = new THREE.Quaternion();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
/*
 * Arms go overhead forward and up (the upper arm's x), the way people
 * raise them, not out to the side and over (its z): that tore loose shirts
 * open under the arm, and brings the palm round to the front by itself.
 */

/**
 * The legs under a bounce: the hips `drop` metres down, the knees bending so
 * the feet stay flat where they stand (thigh and shin turning equal and
 * opposite), and a little more bend in the leg the weight's off (`lift` 0..1
 * per side).
 */
function legs(p: Pose, drop: number, legLen: number, lift: [number, number] = [0, 0]): void {
  p.hips[1] -= drop;
  const a = Math.acos(Math.max(0.5, 1 - drop / legLen));
  (['l', 'r'] as const).forEach((s, i) => {
    const e = a + lift[i] * 0.22;
    set(p, `thigh_${s}`, -e);
    set(p, `shin_${s}`, 2 * e);
    set(p, `foot_${s}`, -e);
  });
}

/** the weight going side to side: hips over one foot then the other, the chest balancing against them */
function weight(p: Pose, side: number, amount: number): void {
  p.hips[0] += 0.04 * side * amount;
  add(p, 'hips', 0, 0, -0.1 * side * amount);
  add(p, 'spine', 0, 0, 0.07 * side * amount);
  add(p, 'chest', 0, 0, 0.04 * side * amount);
}

/** one move's pose at a beat (into `p`, cleared first); `hand` is the side the person favours */
export function clubPose(move: ClubMove, beat: number, legLen: number, hand: 'l' | 'r', p: Pose): void {
  p.rot.fill(0);
  p.hips[0] = p.hips[1] = p.hips[2] = 0;
  p.curl[0] = p.curl[1] = 0.35;
  const other: 'l' | 'r' = hand === 'l' ? 'r' : 'l';
  const hi = hand === 'l' ? 0 : 1;
  const ph = ((beat % 1) + 1) % 1;
  const push = onBeat(ph);
  // side to side over two beats, and round once every four
  const side = Math.sin(beat * Math.PI);
  const slow = Math.sin(beat * Math.PI * 0.5);
  const lift: [number, number] = [Math.max(0, -side), Math.max(0, side)];
  switch (move) {
    case 'pump': {
      // the fist punched up on every beat, the other hand loose at the waist, head nodding with it
      legs(p, 0.025 + 0.03 * push, legLen);
      arm(p, hand, -2.15 - 0.45 * push, 0.35, -1.05 + 0.75 * push);
      arm(p, other, -0.2, 0.14, -0.95, -0.4, 0, 1.1);
      add(p, 'chest', 0.04 * push, (hand === 'l' ? 0.12 : -0.12) * (0.6 + 0.4 * push));
      set(p, 'neck', 0.06 + 0.16 * push);
      p.curl[hi] = 1.5;
      p.curl[1 - hi] = 0.45;
      break;
    }
    case 'hands_up': {
      // both hands up and open, swaying slowly over two beats, chin up
      legs(p, 0.015 + 0.02 * push, legLen, lift);
      weight(p, side, 0.8);
      arm(p, 'l', -2.65, 0.45 + 0.1 * side, -0.35 - 0.12 * push);
      arm(p, 'r', -2.65, 0.45 - 0.1 * side, -0.35 - 0.12 * push);
      add(p, 'hand_l', 0, 0, 0.15 * side);
      add(p, 'hand_r', 0, 0, 0.15 * side);
      set(p, 'neck', -0.18 + 0.05 * push, 0, 0.06 * side);
      p.curl[0] = p.curl[1] = 0.25;
      break;
    }
    case 'two_step': {
      // stepping side to side, elbows bent and swinging with the step, shoulders bouncing
      legs(p, 0.02 + 0.025 * push, legLen, lift);
      weight(p, side, 1.2);
      add(p, 'hips', 0, 0.14 * slow);
      add(p, 'chest', 0, -0.1 * slow);
      arm(p, 'l', -0.2 + 0.22 * side, 0.2, -1.3, -0.25);
      arm(p, 'r', -0.2 - 0.22 * side, 0.2, -1.3, -0.25);
      set(p, 'shoulder_l', 0, 0, 0.05 * push);
      set(p, 'shoulder_r', 0, 0, -0.05 * push);
      set(p, 'neck', 0.05 + 0.12 * push);
      p.curl[0] = p.curl[1] = 0.45;
      break;
    }
    case 'nod': {
      // one hand easy at the chest, the other hanging, the head and shoulders doing the work
      legs(p, 0.015 + 0.02 * push, legLen, lift);
      weight(p, side, 0.5);
      arm(p, hand, -0.45, 0.1, -1.9, -0.5);
      arm(p, other, 0.08 * side, 0.1, -0.35, -0.25);
      add(p, 'chest', 0.05 * push, 0.06 * slow);
      set(p, 'neck', 0.04 + 0.2 * push);
      p.curl[hi] = 0.55;
      break;
    }
    case 'sway': {
      // the hips swinging from side to side, one hand up swaying with them, the other loose
      legs(p, 0.012 + 0.012 * push, legLen, lift);
      weight(p, side, 1.8);
      add(p, 'hips', 0, 0.16 * slow);
      add(p, 'chest', 0, -0.08 * slow, 0.03 * side);
      arm(p, hand, -2.55, 0.4 + 0.1 * side, -0.6 - 0.1 * push);
      arm(p, other, 0.1 * side, 0.1, -0.55 - 0.15 * push, -0.35);
      set(p, 'neck', -0.04, 0.05 * slow, 0.12 * side);
      p.curl[hi] = 0.5;
      p.curl[1 - hi] = 0.25;
      break;
    }
    case 'roll': {
      // arms up, wrists crossing over the head, the body rolling through on every beat
      const roll = Math.sin(beat * Math.PI * 2);
      legs(p, 0.015 + 0.015 * push, legLen, lift);
      weight(p, side, 1.2);
      add(p, 'hips', -0.1 * roll, 0.12 * Math.cos(beat * Math.PI));
      add(p, 'spine', 0.06 * roll);
      add(p, 'chest', 0.07 * roll);
      arm(p, 'l', -2.6, 0.35 + 0.08 * side, -1.4, -1.0);
      arm(p, 'r', -2.6, 0.35 - 0.08 * side, -1.4, -1.0);
      set(p, 'neck', -0.1 - 0.06 * roll, 0, 0.1 * side);
      p.curl[0] = p.curl[1] = 0.3;
      break;
    }
    case 'point': {
      // reaching out to the booth on every beat (this one!), the elbow straightening into it, the other hand loose
      legs(p, 0.02 + 0.03 * push, legLen, lift);
      weight(p, side, 0.6);
      arm(p, hand, -1.75 - 0.22 * push, 0.18, -0.6 + 0.5 * push, -0.12);
      arm(p, other, -0.2 + 0.06 * side, 0.14, -0.95, -0.4, 0, 1.1);
      add(p, 'chest', 0.03 * push, (hand === 'l' ? 0.1 : -0.1) * (0.7 + 0.3 * push));
      set(p, 'neck', -0.06 + 0.12 * push);
      p.curl[hi] = 0.45;
      p.curl[1 - hi] = 0.45;
      break;
    }
    case 'groove': {
      // easy: a soft bounce, the weight rocking over the feet, the arms loose and swinging against the hips
      legs(p, 0.018 + 0.022 * push, legLen, lift);
      weight(p, side, 1.0);
      add(p, 'hips', 0, 0.1 * side);
      add(p, 'chest', 0.02 * push, -0.08 * side);
      arm(p, 'l', -0.25 - 0.18 * side, 0.14, -1.0 - 0.2 * push, -0.2);
      arm(p, 'r', -0.25 + 0.18 * side, 0.14, -1.0 - 0.2 * push, -0.2);
      set(p, 'shoulder_l', 0, 0, 0.04 * push);
      set(p, 'shoulder_r', 0, 0, -0.04 * push);
      set(p, 'neck', 0.03 + 0.1 * push, 0.08 * slow, 0.05 * side);
      p.curl[0] = p.curl[1] = 0.5;
      break;
    }
    case 'shimmy': {
      // the shoulders working forward and back against each other, elbows bent, hands loose at the waist
      const sh = Math.sin(beat * Math.PI * 2);
      legs(p, 0.015 + 0.02 * push, legLen, lift);
      weight(p, side, 0.9);
      add(p, 'chest', 0, 0.16 * sh);
      add(p, 'spine', 0, -0.05 * sh);
      arm(p, 'l', 0.15 * sh, 0.12, -1.35, -0.5);
      arm(p, 'r', -0.15 * sh, 0.12, -1.35, -0.5);
      set(p, 'neck', 0.02, -0.1 * sh, 0.08 * side);
      p.curl[0] = p.curl[1] = 0.45;
      break;
    }
  }
}

/** a move for everyone: clapping overhead through a build */
function clap(beat: number, legLen: number, p: Pose): void {
  p.rot.fill(0);
  p.hips[0] = p.hips[1] = p.hips[2] = 0;
  const ph = ((beat % 1) + 1) % 1;
  const push = onBeat(ph);
  legs(p, 0.02 + 0.02 * push, legLen);
  // hands apart between beats, meeting on the beat
  const open = 1 - push;
  arm(p, 'l', -2.5, -0.25 + 0.5 * open, -0.5, 0, 0, 1.5);
  arm(p, 'r', -2.5, -0.25 + 0.5 * open, -0.5, 0, 0, 1.5);
  set(p, 'neck', -0.12);
  p.curl[0] = p.curl[1] = 0.1;
}

/** the drop: both hands up and jumping on the beat (the hips lifting off as the legs push) */
function jump(beat: number, legLen: number, p: Pose): void {
  p.rot.fill(0);
  p.hips[0] = p.hips[1] = p.hips[2] = 0;
  const ph = ((beat % 1) + 1) % 1;
  // crouched on the beat, up through the middle of it
  const air = Math.max(0, Math.sin(ph * Math.PI));
  const crouch = onBeat(ph);
  legs(p, 0.07 * crouch, legLen);
  p.hips[1] += 0.12 * air * air;
  arm(p, 'l', -2.65, 0.5, -0.3);
  arm(p, 'r', -2.65, 0.5, -0.3);
  set(p, 'neck', -0.15);
  p.curl[0] = p.curl[1] = 0.12;
}

const lerpPose = (a: Pose, b: Pose, k: number, out: Pose) => {
  for (let i = 0; i < out.rot.length; i++) out.rot[i] = a.rot[i] + (b.rot[i] - a.rot[i]) * k;
  for (let i = 0; i < 3; i++) out.hips[i] = a.hips[i] + (b.hips[i] - a.hips[i]) * k;
  for (let i = 0; i < 2; i++) out.curl[i] = a.curl[i] + (b.curl[i] - a.curl[i]) * k;
};
const ease = (k: number) => k * k * (3 - 2 * k);

/**
 * Follow-through: how briskly each part catches up with the beat's pose (a
 * spring's stiffness, per second). The hips, spine and legs are on the beat;
 * the head, the arms and last the hands trail it by a moment, so a pump or a
 * nod carries through and settles instead of moving like one stiff piece.
 */
const FOLLOW: Partial<Record<Bone, number>> = {
  neck: 28,
  head: 24,
  shoulder_l: 30,
  shoulder_r: 30,
  upper_arm_l: 26,
  upper_arm_r: 26,
  forearm_l: 20,
  forearm_r: 20,
  hand_l: 14,
  hand_r: 14,
};
const FOLLOW_AT = BONES.flatMap((b, i) => (FOLLOW[b] ? [0, 1, 2].map((c) => ({ at: i * 3 + c, w: FOLLOW[b]! })) : []));

/**
 * A person dancing: their own moves, changing every eight bars (easing from
 * one to the next over a beat), the clap in a build and the jump on a drop
 * blended in and out the same way.
 */
export class ClubDancer {
  private a = newPose();
  private b = newPose();
  private c = newPose();
  readonly pose = newPose();
  /** how far into the build's clap and the drop's jump each is (eased) */
  private clapW = 0;
  private jumpW = 0;
  /** the trailing parts where they are and how fast they're going */
  private at: Float32Array | null = null;
  private vel = new Float32Array(N * 3);
  /** this person's own feel: how far behind the beat they sit (beats), and how deep they bounce */
  private lag: number;
  private bounce: number;

  constructor(
    readonly moves: ClubMove[],
    readonly hand: 'l' | 'r',
    /** bars in before the first change (so neighbours change at different times) */
    readonly offset: number,
    /** 0..1, picks their feel (some right on the beat and bouncing deep, some laid back) */
    style = 0.5,
  ) {
    this.lag = 0.02 + 0.08 * style;
    this.bounce = 0.75 + 0.5 * ((style * 7.31) % 1);
  }

  /** the move for a bar */
  moveAt(bar: number): ClubMove {
    return this.moves[Math.floor((bar + this.offset) / 8) % this.moves.length];
  }

  update(input: ClubInput, legLen: number, dt: number): Pose {
    const i = { ...input, beat: input.beat - this.lag };
    const bar = Math.floor(i.beat / 4);
    const now = this.moveAt(bar);
    clubPose(now, i.beat, legLen, this.hand, this.a);
    // the first beat of a new move: easing in from the last one
    const intoNew = Math.min(1, Math.max(0, (i.beat + this.offset * 4) % 32));
    const prev = this.moveAt(bar - 1);
    if (intoNew < 1 && prev !== now) {
      clubPose(prev, i.beat, legLen, this.hand, this.b);
      lerpPose(this.b, this.a, ease(intoNew), this.a);
    }
    // the build's clap and the drop's jump, eased in and out
    const wantClap = i.build > 0.5 ? 1 : 0;
    const wantJump = i.sinceDrop < i.beatLen * 8 ? 1 : 0;
    this.clapW += (wantClap - this.clapW) * Math.min(1, dt * 4);
    this.jumpW += (wantJump - this.jumpW) * Math.min(1, dt * (wantJump ? 10 : 3));
    if (this.clapW > 0.001) {
      clap(i.beat, legLen, this.c);
      lerpPose(this.a, this.c, ease(this.clapW), this.a);
    }
    if (this.jumpW > 0.001) {
      jump(i.beat, legLen, this.c);
      lerpPose(this.a, this.c, ease(this.jumpW), this.a);
    }
    // their own bounce (the feet stay put; the knees take it)
    this.a.hips[1] = this.a.hips[1] < 0 ? this.a.hips[1] * this.bounce : this.a.hips[1];
    // looking about now and then: at the booth, a friend, the lights
    const look = Math.sin(i.beat * 0.11 + this.lag * 80) + 0.5 * Math.sin(i.beat * 0.047 + this.bounce * 20);
    this.a.rot[IX.head * 3 + 1] += 0.22 * look;
    this.a.rot[IX.head * 3] += -0.05 * Math.max(0, Math.sin(i.beat * 0.07 + this.lag * 50));
    this.follow(dt);
    this.pose.hips = [...this.a.hips];
    this.pose.curl = [...this.a.curl];
    return this.pose;
  }

  /** the pose onto `pose`, the trailing parts catching up with it on their springs */
  private follow(dt: number): void {
    const to = this.a.rot;
    const out = this.pose.rot;
    out.set(to);
    if (!this.at || dt <= 0 || dt > 0.5) {
      // (a first frame, or a long gap: straight there)
      this.at = to.slice();
      this.vel.fill(0);
      return;
    }
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    for (const { at, w } of FOLLOW_AT) {
      let x = this.at[at];
      let v = this.vel[at];
      for (let k = 0; k < steps; k++) {
        // critically damped: no overshoot to speak of, just a moment behind
        v += (w * w * (to[at] - x) - 2 * w * v) * h;
        x += v * h;
      }
      this.at[at] = x;
      this.vel[at] = v;
      out[at] = x;
    }
  }
}

/** lay a pose on the game's bones (from rest), the hips standing at `hipY`, the feet kept where they stand */
export function applyPose(p: Pose, bones: Record<string, THREE.Object3D>, hipY: number): void {
  for (let i = 0; i < N; i++) {
    const b = bones[BONES[i]];
    if (b) b.rotation.set(p.rot[i * 3], p.rot[i * 3 + 1], p.rot[i * 3 + 2]);
  }
  bones.hips?.position.set(p.hips[0], hipY + p.hips[1], p.hips[2]);
  shrug(bones);
  plantFeet(bones, hipY, Math.max(0, p.hips[1]));
}

/**
 * The shoulders lift as an arm goes overhead, as people's do (the collarbone
 * turning up from the breastbone, taking the top of the shoulder with it), so
 * the armpit and the shirt over it aren't torn open by the arm alone. The arm
 * keeps the direction the pose gave it.
 */
function shrug(b: Record<string, THREE.Object3D>): void {
  for (const [s, k] of [['l', 1], ['r', -1]] as const) {
    const sh = b[`shoulder_${s}`];
    const ua = b[`upper_arm_${s}`];
    if (!sh || !ua) continue;
    const rest = (sh.userData.rest ??= sh.position.clone()) as THREE.Vector3;
    // how far the arm's up: its length (hanging down at rest) turned by the shoulder and the arm
    _v1.set(0, -1, 0).applyQuaternion(_qD.copy(sh.quaternion).multiply(ua.quaternion));
    const up = Math.acos(THREE.MathUtils.clamp(-_v1.y, -1, 1));
    const e = SHRUG * THREE.MathUtils.smoothstep(up, 1.3, 2.7);
    // the collarbone: from near the middle of the chest out to the shoulder joint
    const len = Math.max(0.05, Math.abs(rest.x) - 0.02);
    sh.position.set(rest.x + k * len * (Math.cos(e) - 1), rest.y + len * Math.sin(e), rest.z);
    _qD.setFromAxisAngle(_Z, k * e);
    sh.quaternion.multiply(_qD);
    ua.quaternion.premultiply(_qD.invert());
  }
}
/** how far the collarbones turn up with an arm straight overhead (radians) */
const SHRUG = 0.38;

/**
 * Feet on the floor: the hips sway, tilt, turn and drop, but the feet stay
 * planted where they stand at rest, flat, the knees bending to take it (each
 * leg solved as a thigh and a shin reaching its ankle, the knee kept pointing
 * the way the pose bent it). A foot can come up a little (a heel lift on the
 * leg the weight's off), and with the hips (a jump), never down into the floor.
 */
export function plantFeet(b: Record<string, THREE.Object3D>, hipY: number, up = 0): void {
  const hips = b.hips;
  if (!hips) return;
  hips.updateMatrix();
  for (const s of ['l', 'r'] as const) {
    const thigh = b[`thigh_${s}`];
    const shin = b[`shin_${s}`];
    const foot = b[`foot_${s}`];
    if (!thigh || !shin || !foot) continue;
    thigh.updateMatrix();
    shin.updateMatrix();
    foot.updateMatrix();
    // the leg as the pose has it (in the hips' parent's space)
    _mT.multiplyMatrices(hips.matrix, thigh.matrix);
    _mS.multiplyMatrices(_mT, shin.matrix);
    _mF.multiplyMatrices(_mS, foot.matrix);
    _H.setFromMatrixPosition(_mT);
    _K.setFromMatrixPosition(_mS);
    _A.setFromMatrixPosition(_mF);
    // where the ankle stands at rest
    _R.set(0, hipY, 0).add(thigh.position).add(shin.position).add(foot.position);
    const heel = THREE.MathUtils.clamp(_A.y - _R.y, 0, 0.025);
    _T.set(_R.x, _R.y + Math.max(heel, Math.min(_A.y - _R.y, up)), _R.z);
    const a = shin.position.length();
    const c = foot.position.length();
    const toT = _T.clone().sub(_H);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - c) + 1e-3, a + c - 1e-4);
    _dir.copy(toT).normalize();
    // the knee: in the plane of the hip, the ankle and where the pose had the knee
    _pole.copy(_K).sub(_H);
    _pole.addScaledVector(_dir, -_pole.dot(_dir));
    if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
    _pole.normalize();
    const along = (a * a - c * c + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    const knee = _H.clone().addScaledVector(_dir, along).addScaledVector(_pole, h);
    const ankle = _H.clone().addScaledVector(_dir, d);
    // turn the thigh, then the shin, onto them (each the least turn from where the pose had it)
    _qH.copy(hips.quaternion);
    _qT.copy(_qH).multiply(thigh.quaternion);
    _v1.copy(shin.position).normalize().applyQuaternion(_qT);
    _qD.setFromUnitVectors(_v1, _v2.copy(knee).sub(_H).normalize());
    _qT.premultiply(_qD);
    thigh.quaternion.copy(_qH).invert().multiply(_qT);
    _qS.copy(_qT).multiply(shin.quaternion);
    _v1.copy(foot.position).normalize().applyQuaternion(_qS);
    _qD.setFromUnitVectors(_v1, _v2.copy(ankle).sub(knee).normalize());
    _qS.premultiply(_qD);
    shin.quaternion.copy(_qT).invert().multiply(_qS);
    // the foot flat (or up on its toes, the heel lifted), toes turned a little the way the hips face
    _qF.setFromAxisAngle(_Y, _eH.setFromQuaternion(_qH, 'YXZ').y * 0.5).multiply(_qD.setFromAxisAngle(_X, Math.asin(Math.min(0.5, heel / 0.14))));
    foot.quaternion.copy(_qS).invert().multiply(_qF);
  }
}
const _mT = new THREE.Matrix4();
const _mS = new THREE.Matrix4();
const _mF = new THREE.Matrix4();
const _H = new THREE.Vector3();
const _K = new THREE.Vector3();
const _A = new THREE.Vector3();
const _R = new THREE.Vector3();
const _T = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _qH = new THREE.Quaternion();
const _qT = new THREE.Quaternion();
const _qS = new THREE.Quaternion();
const _qD = new THREE.Quaternion();
const _qF = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _eH = new THREE.Euler();
