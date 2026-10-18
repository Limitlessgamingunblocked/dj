/*
 * Body tracking's models, off the main thread so the game keeps its frame
 * rate: Google's MediaPipe pose, face and hand landmarkers, on the graphics
 * card where the browser lets a worker use it, otherwise the processor.
 *
 * Each camera frame comes in as a picture (an ImageBitmap) and goes back as
 * points; nothing else leaves. The runtime and models (about 20 MB) load
 * from public CDNs the first time and stay in the browser's cache.
 */
import type { FaceIn, HandIn, MocapIn, P3, PoseIn } from './landmarks';

export interface TrackParts {
  face: boolean;
  hands: boolean;
}

export type TrackerIn =
  | { type: 'start'; lib: string; wasm: string; models: { pose: string; face: string; hand: string }; delegate: 'GPU' | 'CPU' }
  | { type: 'frame'; frame: ImageBitmap; t: number; parts: TrackParts }
  | { type: 'stop' };

export type TrackerOut =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'result'; t: number; ms: number; seen: MocapIn }
  /** a frame the models didn't look at (not loaded yet, or out of order) */
  | { type: 'skip' }
  | { type: 'error'; message: string };

/* the slice of the tasks-vision API used here */
interface Pt {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}
interface Task {
  close(): void;
}
interface PoseTask extends Task {
  detectForVideo(img: ImageBitmap, t: number): { landmarks: Pt[][]; worldLandmarks: Pt[][] };
}
interface FaceTask extends Task {
  detectForVideo(img: ImageBitmap, t: number): { faceLandmarks: Pt[][]; faceBlendshapes: { categories: { categoryName: string; score: number }[] }[]; facialTransformationMatrixes: { data: number[] }[] };
}
interface HandTask extends Task {
  detectForVideo(img: ImageBitmap, t: number): { landmarks: Pt[][]; worldLandmarks: Pt[][] };
}
interface Maker<T> {
  createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<T>;
}
interface Vision {
  FilesetResolver: { forVisionTasks(base: string, useModule?: boolean): Promise<unknown> };
  PoseLandmarker: Maker<PoseTask>;
  FaceLandmarker: Maker<FaceTask>;
  HandLandmarker: Maker<HandTask>;
}

const ctx = self as unknown as { postMessage(m: TrackerOut): void; onmessage: ((e: MessageEvent<TrackerIn>) => void) | null };
const post = (m: TrackerOut) => ctx.postMessage(m);

let models: { pose: PoseTask; face: FaceTask; hand: HandTask } | null = null;
let starting: Promise<void> | null = null;
let lastT = -1;

/**
 * A module worker (the dev server's) can't importScripts, so the runtime has
 * to load as a module there; the built game's worker is a classic one.
 */
function moduleWorker(): boolean {
  try {
    (self as unknown as { importScripts(): void }).importScripts();
    return false;
  } catch {
    return true;
  }
}

const pt = (p: Pt): P3 => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility });

async function start(m: Extract<TrackerIn, { type: 'start' }>): Promise<void> {
  const vision = (await import(/* @vite-ignore */ m.lib)) as Vision;
  const files = await vision.FilesetResolver.forVisionTasks(m.wasm, moduleWorker());
  const make = async (delegate: 'GPU' | 'CPU') => {
    const base = (path: string) => ({ baseOptions: { modelAssetPath: path, delegate }, runningMode: 'VIDEO' });
    const [pose, face, hand] = await Promise.all([
      vision.PoseLandmarker.createFromOptions(files, { ...base(m.models.pose), numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 }),
      vision.FaceLandmarker.createFromOptions(files, { ...base(m.models.face), numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true }),
      vision.HandLandmarker.createFromOptions(files, { ...base(m.models.hand), numHands: 2, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }),
    ]);
    return { pose, face, hand };
  };
  let delegate = m.delegate;
  try {
    models = await make(delegate);
  } catch (e) {
    if (delegate === 'CPU') throw e;
    delegate = 'CPU';
    models = await make('CPU');
  }
  post({ type: 'ready', delegate });
}

function track(img: ImageBitmap, t: number, parts: TrackParts): MocapIn {
  const m = models!;
  const p = m.pose.detectForVideo(img, t);
  const pose: PoseIn | null = p.landmarks[0]?.length ? { lm: p.landmarks[0].map(pt), world: p.worldLandmarks[0].map(pt) } : null;
  let face: FaceIn | null = null;
  if (parts.face) {
    const f = m.face.detectForVideo(img, t);
    const lm = f.faceLandmarks[0];
    if (lm?.length) {
      const blend: Record<string, number> = {};
      for (const c of f.faceBlendshapes[0]?.categories ?? []) blend[c.categoryName] = c.score;
      const dots: number[] = [];
      for (let i = 0; i < lm.length; i += 5) dots.push(lm[i].x, lm[i].y);
      face = { blend, matrix: Array.from(f.facialTransformationMatrixes[0]?.data ?? []), dots };
    }
  }
  let hands: HandIn[] = [];
  if (parts.hands) {
    const h = m.hand.detectForVideo(img, t);
    hands = h.landmarks.map((lm, i) => ({ lm: lm.map(pt), world: (h.worldLandmarks[i] ?? []).map(pt) }));
  }
  return { pose, face, hands };
}

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'start') {
    starting ??= start(m).catch((err) => {
      starting = null;
      post({ type: 'error', message: String((err as Error)?.message ?? err) });
    });
  } else if (m.type === 'frame') {
    const img = m.frame;
    try {
      // (the models want each frame's time to move on)
      if (!models || m.t <= lastT) return post({ type: 'skip' });
      lastT = m.t;
      const t0 = performance.now();
      const seen = track(img, m.t, m.parts);
      post({ type: 'result', t: m.t, ms: performance.now() - t0, seen });
    } catch (err) {
      post({ type: 'error', message: String((err as Error)?.message ?? err) });
    } finally {
      img.close();
    }
  } else if (m.type === 'stop') {
    models?.pose.close();
    models?.face.close();
    models?.hand.close();
    models = null;
    starting = null;
    lastT = -1;
  }
};
