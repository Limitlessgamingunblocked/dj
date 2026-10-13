/*
 * Air DJ's eyes: the webcam and MediaPipe's hand landmarker, run in the
 * browser on the GPU where it can. Nothing leaves the device: the camera
 * picture goes straight to the model, and only the landmarks come out.
 *
 * The model and its runtime (about 10 MB) load from a CDN the first time
 * Air DJ starts, so the app itself stays the same size and works offline
 * without it.
 */
import type { Pt } from './gestures';

const VERSION = '1.0.1';
const BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/* the slice of the tasks-vision API used here */
interface Landmarker {
  detectForVideo(video: HTMLVideoElement, timestamp: number): { landmarks: { x: number; y: number }[][] };
  close(): void;
}
interface Vision {
  FilesetResolver: { forVisionTasks(base: string): Promise<unknown> };
  HandLandmarker: {
    createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<Landmarker>;
  };
}

export type TrackerStatus = 'off' | 'camera' | 'loading' | 'running' | 'error';

/** a reason a start failed, in words for the player */
export function startError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The camera is blocked. Allow it for this site in the address bar, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No webcam found.';
  if (name === 'NotReadableError') return 'The webcam is busy in another app.';
  if (!navigator.onLine) return 'Hand tracking downloads its model the first time. Connect to the internet and try again.';
  return 'Hand tracking could not start in this browser.';
}

let visionLoad: Promise<Vision> | null = null;

export class HandTracker {
  readonly video: HTMLVideoElement;
  status: TrackerStatus = 'off';
  /** called for every camera frame the model looked at: hands with x mirrored (0 at the viewer's left) */
  onHands: ((hands: Pt[][], dt: number) => void) | null = null;
  onStatus: ((s: TrackerStatus) => void) | null = null;
  /** frames the model looked at per second */
  fps = 0;
  private stream: MediaStream | null = null;
  private model: Landmarker | null = null;
  private raf = 0;
  private lastT = 0;
  private lastVideoT = -1;
  private run = 0;

  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
  }

  private set(s: TrackerStatus): void {
    this.status = s;
    this.onStatus?.(s);
  }

  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'camera' || this.status === 'loading') return;
    const run = ++this.run;
    try {
      this.set('camera');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 }, facingMode: 'user' }, audio: false });
      if (run !== this.run) return this.dropStream();
      this.video.srcObject = this.stream;
      await this.video.play();
      this.set('loading');
      const model = await this.loadModel();
      if (run !== this.run) return model.close();
      this.model = model;
      this.set('running');
      this.lastT = performance.now();
      this.loop(run);
    } catch (e) {
      if (run !== this.run) return;
      this.stop();
      this.set('error');
      throw e;
    }
  }

  stop(): void {
    this.run++;
    cancelAnimationFrame(this.raf);
    this.model?.close();
    this.model = null;
    this.dropStream();
    this.video.srcObject = null;
    this.lastVideoT = -1;
    this.fps = 0;
    if (this.status !== 'off') this.set('off');
  }

  private dropStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private async loadModel(): Promise<Landmarker> {
    visionLoad ??= import(/* @vite-ignore */ BUNDLE) as Promise<Vision>;
    let vision: Vision;
    try {
      vision = await visionLoad;
    } catch (e) {
      visionLoad = null;
      throw e;
    }
    const files = await vision.FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      return await vision.HandLandmarker.createFromOptions(files, opts('GPU'));
    } catch {
      return vision.HandLandmarker.createFromOptions(files, opts('CPU'));
    }
  }

  private loop(run: number): void {
    const tick = () => {
      if (run !== this.run || !this.model) return;
      this.raf = requestAnimationFrame(tick);
      const v = this.video;
      // only new camera frames (the screen often refreshes faster than the camera)
      if (v.readyState < 2 || v.currentTime === this.lastVideoT) return;
      this.lastVideoT = v.currentTime;
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastT) / 1000);
      this.lastT = now;
      if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;
      let hands: Pt[][] = [];
      try {
        const res = this.model.detectForVideo(v, now);
        // mirror, so the picture works like a mirror: your right hand on the right
        hands = res.landmarks.map((lm) => lm.map((p) => ({ x: 1 - p.x, y: p.y })));
      } catch {
        return;
      }
      this.onHands?.(hands, dt);
    };
    this.raf = requestAnimationFrame(tick);
  }
}
