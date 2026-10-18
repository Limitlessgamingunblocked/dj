/*
 * What body tracking sees in one camera frame, as the tracker's worker
 * sends it: MediaPipe's pose (33 points), face (blendshapes and the head's
 * turn) and hands (21 points each). The picture is not mirrored here: x 0
 * is the left of the camera's picture, which is the player's right.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
  /** how sure the model is the point is in view (pose points only) */
  visibility?: number;
}

export interface PoseIn {
  /** in the picture, 0..1 (z: depth, roughly the scale of x) */
  lm: P3[];
  /** in metres round the middle of the hips, y down, z away from the camera */
  world: P3[];
}

export interface FaceIn {
  /** MediaPipe's 52 blendshapes by name, 0..1 */
  blend: Record<string, number>;
  /** the head's 4×4 transform in camera space (x right, y up, z towards the camera), column-major */
  matrix: number[];
  /** a few face points in the picture, x and y pairs, for the camera window */
  dots: number[];
}

export interface HandIn {
  /** in the picture, 0..1 */
  lm: P3[];
  /** in metres round the hand's middle, the same axes as the pose's */
  world: P3[];
}

export interface MocapIn {
  pose: PoseIn | null;
  face: FaceIn | null;
  hands: HandIn[];
}

/** MediaPipe's pose points */
export const POSE = {
  nose: 0,
  shoulder: { L: 11, R: 12 },
  elbow: { L: 13, R: 14 },
  wrist: { L: 15, R: 16 },
  pinky: { L: 17, R: 18 },
  index: { L: 19, R: 20 },
  hip: { L: 23, R: 24 },
  knee: { L: 25, R: 26 },
  ankle: { L: 27, R: 28 },
} as const;

/** the lines between the pose points drawn in the camera window (no face: the face has its own dots) */
export const POSE_BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [15, 17], [15, 19], [17, 19], [16, 18], [16, 20], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

/** the lines between MediaPipe's 21 hand points */
export const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** a point is in view: the model is fairly sure of it and it's inside the picture */
export function seen(p: P3 | undefined, min = 0.5): number {
  if (!p) return 0;
  if (p.x < -0.03 || p.x > 1.03 || p.y < -0.03 || p.y > 1.03) return 0;
  const v = p.visibility ?? 1;
  return v >= min ? v : 0;
}
