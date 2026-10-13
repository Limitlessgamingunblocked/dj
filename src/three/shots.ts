/*
 * The director's own camera moves: the shots a crew films a DJ set with, on
 * top of the angles in the camera menu. Worked out from how big sets are
 * filmed (festival mainstage streams, club streams, location sets):
 *
 *   hands     tight on the decks and the mixer, from the front of the booth
 *   ots       over the DJ's shoulder, out at the crowd and the lights
 *   hero      low from the front, looking up at the DJ with the rig above
 *   profile   side-on with a long lens, the DJ against the room
 *   tele      the long lens from out at the mixing desk, tight on the DJ
 *   pushin    a slow dolly in on the DJ (through a build)
 *   pullback  from close on the DJ, up and back to the whole room (the drop)
 *   jib       a jib sweeping sideways over the crowd's heads
 *   reverse   from the front of the booth, out over the crowd (their reaction)
 *   orbit     a slow arc round the DJ
 *   aerial    a drone high over an open-air stage, slowly circling
 *
 * Each is a pose at progress u (0..1, eased over the planned length of the
 * shot), relative to the board and the DJ, sized by the venue's reach. The
 * venue's landmarks (VenueViews.director) are absolute poses. Pure maths, no
 * scene: the stage checks the poses against walls (guard) before playing one.
 */
import * as THREE from 'three';
import type { Landmark, Pose, VenueViews } from './venues/base';

export type ShotId = 'hands' | 'ots' | 'hero' | 'profile' | 'tele' | 'pushin' | 'pullback' | 'jib' | 'reverse' | 'orbit' | 'aerial';

export interface ShotPose extends Pose {
  fov?: number;
  /** or: a lens that frames this many metres of height at the camera's distance (kept after a guard pulls it in) */
  frameH?: number;
}

export interface ShotCtx {
  /** the board's bounds */
  box: THREE.Box3;
  /** how far the venue's cameras reach, metres */
  scale: number;
  /** the normal lens, degrees */
  fov: number;
}

export interface ShotDef {
  label: string;
  /** a close shot: the picture stays clean (less bloom and lens dirt), like the board angles */
  close?: boolean;
  /** how much hand-held drift it has (0 = locked off) */
  hand: number;
  pose(c: ShotCtx, u: number, side: number): ShotPose;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** where the DJ's head is (they stand at z 0.68 behind the board, facing −Z) */
export const DJ_HEAD = V(0, 1.62, 0.68);
const lerp = THREE.MathUtils.lerp;

/** a lens that frames `h` metres of height at distance `d` */
export function fovFor(h: number, d: number): number {
  return THREE.MathUtils.radToDeg(2 * Math.atan(h / 2 / Math.max(0.1, d)));
}

function frame(c: ShotCtx) {
  const ctr = c.box.getCenter(new THREE.Vector3());
  return { ctr, top: c.box.max.y, front: c.box.min.z, S: c.scale };
}

export const SHOTS: Record<ShotId, ShotDef> = {
  hands: {
    label: 'Hands on the decks',
    close: true,
    hand: 0.6,
    pose(c, u, side) {
      const { ctr, top, front } = frame(c);
      // a slow slide along the front of the booth, the mixer and hands sharp, the DJ above
      return { pos: V(ctr.x + side * lerp(0.62, 0.3, u), top + 0.36, front - 0.42), target: V(ctr.x + side * lerp(0.12, -0.02, u), top + 0.1, ctr.z + 0.12), fov: 38 };
    },
  },
  ots: {
    label: 'Over the shoulder',
    hand: 0.5,
    pose(c, u, side) {
      const { front, S } = frame(c);
      return { pos: V(side * 0.42, 1.88, DJ_HEAD.z + lerp(0.85, 0.62, u)), target: V(-side * lerp(0.9, 0.5, u), 1.75, front - 3 * S), fov: 52 };
    },
  },
  hero: {
    label: 'Low angle',
    hand: 0.35,
    pose(c, u, side) {
      const { top, front } = frame(c);
      return { pos: V(side * lerp(1.35, 0.85, u), top - 0.06, front - lerp(1.6, 1.35, u)), target: V(0, 1.95, 0.55), fov: 44 };
    },
  },
  profile: {
    label: 'Side on',
    hand: 0.4,
    pose(c, u, side) {
      const { top } = frame(c);
      return { pos: V(side * 2.2, 1.55, lerp(1.25, 0.95, u)), target: V(0, top + 0.42, 0.05), frameH: 1.5 };
    },
  },
  tele: {
    label: 'Long lens from the desk',
    hand: 0.15,
    pose(c, u, side) {
      const { front, S } = frame(c);
      return { pos: V(side * lerp(1.8, 1.2, u), 2.9 + 0.2 * S, front - 2.3 * S - 3), target: V(0, 1.55, 0.55), frameH: 2.4 };
    },
  },
  pushin: {
    label: 'Push in',
    hand: 0.2,
    pose(c, u, side) {
      const { front, S } = frame(c);
      return { pos: V(side * lerp(0.95, 0.22, u), lerp(2.15, 1.8, u), front - lerp(0.7 + 0.6 * S, 0.85, u)), target: V(0, lerp(1.45, 1.6, u), 0.55), fov: 42 };
    },
  },
  pullback: {
    label: 'Pull back',
    hand: 0.15,
    pose(c, u, side) {
      const { front, S } = frame(c);
      // fast away to start with, settling as the room opens up
      const k = 1 - (1 - u) * (1 - u);
      return { pos: V(side * lerp(0.3, 0.55 * S, k), lerp(1.8, 1.3 + 0.9 * S, k), front - lerp(0.9, 1.9 * S, k)), target: V(0, lerp(1.6, 1.4, k), 0.45), fov: 46 };
    },
  },
  jib: {
    label: 'Jib over the crowd',
    hand: 0.1,
    pose(c, u, side) {
      const { front, S } = frame(c);
      return { pos: V(side * lerp(-0.8, 0.8, u) * S, 2.2 + 0.25 * S + 0.3 * S * Math.sin(u * Math.PI), front - 1.5 * S), target: V(0, 1.5, 0.3), fov: 46 };
    },
  },
  reverse: {
    label: 'Out over the crowd',
    hand: 0.45,
    pose(c, u, side) {
      const { front, S } = frame(c);
      // just in front of the decks, the DJ behind the camera, panning across the crowd
      return { pos: V(side * 0.5, 2.1, front - 0.35), target: V(side * lerp(-0.5, 0.5, u) * S, 1.2, front - 1.2 * S - 4), fov: 62 };
    },
  },
  orbit: {
    label: 'Round the booth',
    hand: 0.1,
    pose(c, u, side) {
      const { S } = frame(c);
      const a = side * lerp(-0.75, 0.35, u);
      const r = 2.4 + 0.12 * S;
      return { pos: V(Math.sin(a) * r, 2 + 0.08 * S, 0.5 - Math.cos(a) * r), target: V(0, 1.45, 0.5), fov: 44 };
    },
  },
  aerial: {
    label: 'Aerial',
    hand: 0.05,
    pose(c, u, side) {
      const { S } = frame(c);
      const a = side * lerp(-0.55, 0.05, u);
      const R = 3 * S + 4;
      return { pos: V(Math.sin(a) * R, 1.5 * S + 4, 0.6 - Math.cos(a) * R), target: V(0, 1.2, 0.6 + S * 0.3), fov: 50 };
    },
  },
};

export const SHOT_IDS = Object.keys(SHOTS) as ShotId[];

/** A landmark at progress u: its held pose, or the move from `from` to `to`. */
export function landmarkPose(l: Landmark, u: number): ShotPose {
  if (!l.to) return { pos: l.from.pos.clone(), target: l.from.target.clone(), fov: l.fov };
  return { pos: l.from.pos.clone().lerp(l.to.pos, u), target: l.from.target.clone().lerp(l.to.target, u), fov: l.fov };
}

/** how far the cameras reach in this venue */
export function venueScale(v: VenueViews | null): number {
  return v?.director?.scale ?? v?.extra?.crane?.radius ?? 3.4;
}

/** ease in and out: moves start and settle gently, like a dolly */
export function easeShot(x: number): number {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** a point in the air over the decks every camera should be able to see back to */
export const SHOT_ANCHOR = V(0, 1.95, 0.35);

/**
 * Bring a shot in out of the walls: for each sampled pose, how far the camera
 * can be from the air over the booth before something solid is in the way
 * (`reach(from, to)` → clear distance, or Infinity), and the fraction of the
 * planned distance that fits. One fraction for the whole move, so it doesn't
 * jump.
 */
export function guardScale(poses: Pose[], reach: (from: THREE.Vector3, to: THREE.Vector3) => number, anchor = SHOT_ANCHOR): number {
  let k = 1;
  for (const p of poses) {
    const d = p.pos.distanceTo(anchor);
    if (d < 0.05) continue;
    const clear = reach(anchor, p.pos);
    if (clear < d + 0.25) k = Math.min(k, Math.max(0.1, (clear - 0.25) / d));
  }
  return k;
}

/** A shot pulled in towards the booth by `k` (guardScale), with its lens worked out. */
export function scalePose(p: ShotPose, k: number, anchor = SHOT_ANCHOR): ShotPose {
  if (k < 1) p.pos.sub(anchor).multiplyScalar(k).add(anchor);
  if (p.frameH) p.fov = fovFor(p.frameH, p.pos.distanceTo(p.target));
  return p;
}
