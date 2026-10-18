/*
 * From what the camera sees to what the character does: the player's
 * shoulders, arms, hands, legs, head and face (landmarks.ts) turned into
 * the character's directions, turns and face channels (character/
 * mocapFrame.ts). No camera or model in here, so it runs in the tests.
 *
 * - Everything is measured from the player's resting pose, taken in the
 *   first half second they're in view (and again on Recenter), so sitting
 *   a little turned to the camera, or with the camera up on the screen
 *   looking down, doesn't turn or tip the DJ.
 * - Mirrored (the default), it's like a mirror: raise your right arm and
 *   the DJ facing you raises theirs on the same side of the screen.
 * - The points are steadied with a one-euro filter: still when you're
 *   still, quick when you move.
 * - A part only counts while it's in the picture and the model is sure of
 *   it, so an arm out of shot goes back to the decks.
 */
import * as THREE from 'three';
import { newFrame, restFace, type MocapFace, type MocapFrame, type MocapHand } from '../../character/mocapFrame';
import { POSE, seen, type FaceIn, type HandIn, type MocapIn, type P3, type PoseIn } from './landmarks';

export interface MocapOpts {
  /** copy the body (arms, chest, legs) */
  body: boolean;
  /** copy the face and the head's turn */
  face: boolean;
  /** copy the fingers and the turn of each hand */
  hands: boolean;
  /** like a mirror (your right on the right of the screen), or the DJ's own right */
  mirror: boolean;
}

export const DEFAULT_OPTS: MocapOpts = { body: true, face: true, hands: true, mirror: true };

/** frames of the resting pose averaged before copying starts */
const CALIBRATE = 12;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The one-euro filter (Casiez, Roussel and Vogel, 2012) over a run of
 * numbers: a low-pass whose cut-off rises with speed, so slow drift and
 * jitter are smoothed away and quick moves still come through.
 */
export class OneEuro {
  private x: Float64Array | null = null;
  private dx: Float64Array | null = null;
  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff = 1,
  ) {}

  reset(): void {
    this.x = this.dx = null;
  }

  filter(v: ArrayLike<number>, dt: number): Float64Array {
    if (!this.x || this.x.length !== v.length || dt <= 0) {
      this.x = Float64Array.from(v);
      this.dx = new Float64Array(v.length);
      return this.x;
    }
    const a = (cut: number) => 1 / (1 + 1 / (2 * Math.PI * cut * dt));
    const ad = a(this.dCutoff);
    const x = this.x;
    const dx = this.dx!;
    for (let i = 0; i < v.length; i++) {
      dx[i] += ((v[i] - x[i]) / dt - dx[i]) * ad;
      x[i] += (v[i] - x[i]) * a(this.minCutoff + this.beta * Math.abs(dx[i]));
    }
    return x;
  }
}

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tD = new THREE.Vector3();
const tM = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** an orientation from a side-to-side line (its +X) and roughly up (its +Y) */
function basis(x: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const X = tA.copy(x).normalize();
  const Y = tB.copy(up).addScaledVector(X, -up.dot(X));
  if (Y.lengthSq() < 1e-8) Y.copy(UP).addScaledVector(X, -X.y);
  Y.normalize();
  const Z = tC.crossVectors(X, Y);
  return out.setFromRotationMatrix(tM.makeBasis(X, Y, Z));
}

const angle = (a: THREE.Vector3, b: THREE.Vector3) => (a.lengthSq() < 1e-12 || b.lengthSq() < 1e-12 ? 0 : a.angleTo(b));

/** the face channels from MediaPipe's blendshapes (`mirror` swaps the eyes and the way they look) */
export function faceFrom(b: Record<string, number>, mirror: boolean, out: MocapFace = restFace()): MocapFace {
  const v = (k: string) => b[k] ?? 0;
  const both = (k: string) => (v(`${k}Left`) + v(`${k}Right`)) / 2;
  // (most resting faces read a little lowered brow and squint: only past that counts)
  const past = (x: number, rest: number) => Math.max(0, (x - rest) / (1 - rest));
  const down = past(both('browDown'), 0.2);
  out.brow = clamp(v('browInnerUp') * 0.5 + both('browOuterUp') * 0.9 - down * 1.1, -1, 1.2);
  out.frown = clamp(down * 1.5 - v('browInnerUp') * 0.7, -1, 1);
  out.squint = clamp(past(Math.max(both('eyeSquint'), both('cheekSquint')), 0.15) * 1.2, 0, 1);
  out.jaw = clamp(v('jawOpen') * 1.35, 0, 1);
  out.smile = clamp(both('mouthSmile') * 1.3 - both('mouthFrown') * 1.2, -1, 1);
  out.wide = clamp(both('mouthStretch') * 1.6, 0, 1);
  out.sneer = clamp(Math.max(both('noseSneer') * 1.4, both('mouthUpperUp') * 0.6), 0, 1);
  out.pucker = clamp(Math.max(v('mouthPucker'), v('mouthFunnel')) * 1.2, 0, 1);
  out.eyesWide = clamp(both('eyeWide') * 1.4, 0, 1);
  // (a lid that's half shut on someone's resting face still reads open)
  const blink = (k: 'Left' | 'Right') => smooth(0.3, 0.72, v(`eyeBlink${k}`));
  // the player's own left and right eye, and looking to their left
  const left = blink('Left');
  const right = blink('Right');
  const lookLeft = (v('eyeLookOutLeft') - v('eyeLookInLeft') + v('eyeLookInRight') - v('eyeLookOutRight')) / 2;
  out.blinkL = mirror ? right : left;
  out.blinkR = mirror ? left : right;
  out.gazeX = clamp(mirror ? -lookLeft : lookLeft, -1, 1);
  out.gazeY = clamp(both('eyeLookUp') - both('eyeLookDown'), -1, 1);
  return out;
}

/** which side each hand is on: whichever pose wrist it's nearest, or by where it is in the picture */
export function handSides(hands: HandIn[], pose: PoseIn | null): Partial<Record<'L' | 'R', HandIn>> {
  const out: Partial<Record<'L' | 'R', HandIn>> = {};
  const wrists = pose ? { L: pose.lm[POSE.wrist.L], R: pose.lm[POSE.wrist.R] } : null;
  const near = (h: HandIn, w: P3 | undefined) => (w ? Math.hypot(h.lm[0].x - w.x, h.lm[0].y - w.y) : 9);
  const hs = hands.filter((h) => h.lm.length >= 21 && h.world.length >= 21).slice(0, 2);
  if (wrists && hs.length) {
    // the pairing that puts both hands nearest their wrists
    if (hs.length === 2) {
      const keep = near(hs[0], wrists.L) + near(hs[1], wrists.R) <= near(hs[0], wrists.R) + near(hs[1], wrists.L);
      out.L = keep ? hs[0] : hs[1];
      out.R = keep ? hs[1] : hs[0];
    } else out[near(hs[0], wrists.L) <= near(hs[0], wrists.R) ? 'L' : 'R'] = hs[0];
    // (a hand nowhere near either wrist is someone else's)
    for (const s of ['L', 'R'] as const) if (out[s] && near(out[s]!, wrists[s]) > 0.2 && seen(wrists[s], 0.5)) delete out[s];
    return out;
  }
  // no body: the picture isn't mirrored, so the player's right hand is on the left of it
  if (hs.length === 2) {
    const [a, b] = hs[0].lm[0].x <= hs[1].lm[0].x ? hs : [hs[1], hs[0]];
    return { R: a, L: b };
  }
  if (hs.length === 1) out[hs[0].lm[0].x < 0.5 ? 'R' : 'L'] = hs[0];
  return out;
}

export class Retargeter {
  /** the latest pose for the character (weights are how sure each part is, not eased) */
  readonly frame: MocapFrame = newFrame();
  /** the resting pose's chest and head, in camera space, once taken */
  private rest: { torso: THREE.Quaternion; n: number; head: THREE.Quaternion; hn: number } = { torso: new THREE.Quaternion(), n: 0, head: new THREE.Quaternion(), hn: 0 };
  private poseF = new OneEuro(1.6, 2.5);
  private handF = { L: new OneEuro(2, 3), R: new OneEuro(2, 3) };
  private faceF = new OneEuro(3, 4);
  private headF = new OneEuro(2, 3);
  private lostPose = 0;
  private mirror = true;
  private pts: THREE.Vector3[] = Array.from({ length: 33 }, () => new THREE.Vector3());
  private hpts: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());
  private qT = new THREE.Quaternion();
  private qH = new THREE.Quaternion();
  private inv = new THREE.Quaternion();
  private faceNow = restFace();

  /** take the resting pose again (the player has moved, or sat down) */
  recenter(): void {
    this.rest.n = 0;
    this.rest.hn = 0;
  }

  /** whether the resting pose has been taken (copying starts after) */
  get calibrated(): boolean {
    return this.rest.n >= CALIBRATE;
  }

  /** one camera frame (null: nothing came back), `dt` seconds since the last */
  update(input: MocapIn | null, dt: number, o: MocapOpts): MocapFrame {
    const f = this.frame;
    if (o.mirror !== this.mirror) {
      // the other way round is a different resting pose
      this.mirror = o.mirror;
      this.recenter();
    }
    for (const p of Object.keys(f.w) as (keyof MocapFrame['w'])[]) f.w[p] = 0;
    const pose = input?.pose ?? null;
    if (pose && pose.world.length >= 33) {
      this.lostPose = 0;
      this.body(pose, dt, o);
    } else if ((this.lostPose += dt) > 0.4) this.poseF.reset();
    const hands = input ? handSides(input.hands, pose) : {};
    for (const S of ['L', 'R'] as const) {
      // the player's hand on this side drives the character's hand on the same side, or the other when mirrored
      const h = hands[S];
      const side = (S === 'L') !== o.mirror ? 'l' : 'r';
      if (h && o.hands && this.calibrated) this.hand(h, side, S, dt);
      else if (!h) this.handF[S].reset();
    }
    const face = input?.face ?? null;
    if (face && o.face) this.face(face, dt);
    else this.headF.reset();
    return f;
  }

  /** a point in the character's space: y up, z out towards the camera (mirrored: x flipped) */
  private toA(p: P3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.mirror ? -p.x : p.x, -p.y, -p.z);
  }

  private body(pose: PoseIn, dt: number, o: MocapOpts): void {
    const f = this.frame;
    const raw = new Float64Array(33 * 3);
    for (let i = 0; i < 33; i++) {
      raw[i * 3] = pose.world[i].x;
      raw[i * 3 + 1] = pose.world[i].y;
      raw[i * 3 + 2] = pose.world[i].z;
    }
    const s = this.poseF.filter(raw, dt);
    const P = this.pts;
    for (let i = 0; i < 33; i++) this.toA({ x: s[i * 3], y: s[i * 3 + 1], z: s[i * 3 + 2] }, P[i]);
    const vis = (i: number, min = 0.5) => seen(pose.lm[i], min);
    // the character's left side is the player's left, or their right in a mirror
    const src = (side: 'l' | 'r') => ((side === 'l') !== this.mirror ? 'L' : 'R');
    const shL = P[POSE.shoulder[src('l')]];
    const shR = P[POSE.shoulder[src('r')]];
    const shoulders = Math.min(vis(POSE.shoulder.L), vis(POSE.shoulder.R));
    if (!shoulders) return;
    // the chest: across the shoulders, and up the spine as far as the hips are seen (else straight up)
    const hipsSeen = Math.min(vis(POSE.hip.L, 0.3), vis(POSE.hip.R, 0.3));
    const hipMid = tD.copy(P[POSE.hip.L]).add(P[POSE.hip.R]).multiplyScalar(0.5);
    const spine = new THREE.Vector3().copy(shL).add(shR).multiplyScalar(0.5).sub(hipMid).normalize();
    const up = UP.clone().lerp(spine, smooth(0.3, 0.7, hipsSeen)).normalize();
    basis(new THREE.Vector3().subVectors(shL, shR), up, this.qT);
    // the resting pose: the first frames the shoulders are seen, averaged
    const r = this.rest;
    if (r.n < CALIBRATE) {
      if (r.n === 0) r.torso.copy(this.qT);
      else r.torso.slerp(this.qT, 1 / (r.n + 1));
      r.n++;
      if (r.n < CALIBRATE) return;
    }
    if (!o.body) return;
    const inv = this.inv.copy(r.torso).invert();
    f.torso.copy(inv).multiply(this.qT);
    f.w.torso = smooth(0.5, 0.8, shoulders);
    const dir = (a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3) => out.subVectors(b, a).applyQuaternion(inv).normalize();
    for (const side of ['l', 'r'] as const) {
      const S = src(side);
      const sh = POSE.shoulder[S];
      const el = POSE.elbow[S];
      const wr = POSE.wrist[S];
      const arm = f.arm[side];
      const k = Math.min(vis(sh), vis(el), vis(wr));
      if (k > 0) {
        dir(P[sh], P[el], arm.upper);
        dir(P[el], P[wr], arm.lower);
      }
      f.w[side === 'l' ? 'armL' : 'armR'] = smooth(0.5, 0.75, k);
    }
    // the legs, when the whole of both are in view (standing back from the camera)
    const legs = Math.min(...[POSE.hip, POSE.knee, POSE.ankle].flatMap((j) => [vis(j.L, 0.6), vis(j.R, 0.6)]));
    if (legs > 0) {
      for (const side of ['l', 'r'] as const) {
        const S = src(side);
        dir(P[POSE.hip[S]], P[POSE.knee[S]], f.leg[side].upper);
        dir(P[POSE.knee[S]], P[POSE.ankle[S]], f.leg[side].lower);
      }
      // the hips: turned and tilted along the line between them, kept upright
      const across = new THREE.Vector3().subVectors(P[POSE.hip[src('l')]], P[POSE.hip[src('r')]]).applyQuaternion(inv);
      basis(across, UP, f.hips);
    }
    f.w.legs = smooth(0.6, 0.85, legs);
  }

  private hand(h: HandIn, side: 'l' | 'r', S: 'L' | 'R', dt: number): void {
    const raw = new Float64Array(21 * 3);
    for (let i = 0; i < 21; i++) {
      raw[i * 3] = h.world[i].x;
      raw[i * 3 + 1] = h.world[i].y;
      raw[i * 3 + 2] = h.world[i].z;
    }
    const s = this.handF[S].filter(raw, dt);
    const P = this.hpts;
    const inv = this.inv.copy(this.rest.torso).invert();
    for (let i = 0; i < 21; i++) this.toA({ x: s[i * 3], y: s[i * 3 + 1], z: s[i * 3 + 2] }, P[i]).applyQuaternion(inv);
    const out: MocapHand = this.frame.hand[side];
    // down the fingers (wrist to the middle knuckle), across the knuckles (thumb side to little finger), out of the palm
    const F = out.fingers.subVectors(P[9], P[0]).normalize();
    const across = new THREE.Vector3().subVectors(P[17], P[5]);
    const palm = side === 'l' ? out.palm.crossVectors(across, F) : out.palm.crossVectors(F, across);
    palm.addScaledVector(F, -palm.dot(F)).normalize();
    // each finger's bends: at the knuckle, then the two joints further along together
    const seg = (a: number, b: number) => new THREE.Vector3().subVectors(P[b], P[a]);
    for (let i = 0; i < 4; i++) {
      const m = 5 + i * 4;
      out.knuckle[i] = clamp(angle(seg(0, m), seg(m, m + 1)) - 0.12, 0, 1.6);
      out.mid[i] = clamp(angle(seg(m, m + 1), seg(m + 1, m + 2)) + 0.7 * angle(seg(m + 1, m + 2), seg(m + 2, m + 3)), 0, 1.9);
    }
    out.thumb = clamp((angle(seg(1, 2), seg(2, 3)) + angle(seg(2, 3), seg(3, 4)) - 0.25) * 0.6, 0, 0.9);
    this.frame.w[side === 'l' ? 'handL' : 'handR'] = 1;
  }

  private face(face: FaceIn, dt: number): void {
    const f = this.frame;
    if (face.matrix.length >= 16) {
      tM.fromArray(face.matrix);
      tM.decompose(tA, this.qH, tB);
      // in a mirror the turn goes the other way round (a reflection through the side-to-side axis)
      if (this.mirror) this.qH.set(this.qH.x, -this.qH.y, -this.qH.z, this.qH.w);
      const q = this.headF.filter([this.qH.x, this.qH.y, this.qH.z, this.qH.w], dt);
      this.qH.set(q[0], q[1], q[2], q[3]).normalize();
      const r = this.rest;
      if (r.hn < CALIBRATE) {
        if (r.hn === 0) r.head.copy(this.qH);
        else r.head.slerp(this.qH, 1 / (r.hn + 1));
        r.hn++;
      } else {
        // the head's turn from its resting pose, as seen from the resting chest
        const n = r.n >= CALIBRATE ? r.torso : new THREE.Quaternion();
        const ninv = n.clone().invert();
        f.head.copy(ninv).multiply(this.qH).multiply(r.head.clone().invert()).multiply(n);
        f.w.head = 1;
      }
    }
    const want = faceFrom(face.blend, this.mirror, this.faceNow);
    const keys = Object.keys(want) as (keyof MocapFace)[];
    const s = this.faceF.filter(keys.map((k) => want[k]), dt);
    keys.forEach((k, i) => (f.face[k] = s[i]));
    f.w.face = 1;
  }
}
