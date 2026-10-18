/*
 * Body tracking's eyes: the webcam, and the models in tracker.worker.ts.
 * Nothing leaves the device: each camera frame goes straight to the worker
 * as a picture and only the points come back.
 *
 * One frame is with the models at a time; while they're busy, newer camera
 * frames are skipped, so a slow computer tracks a little less often rather
 * than falling behind (and the game itself never waits for them).
 */
import TrackerWorker from './tracker.worker?worker&inline';
import type { MocapIn } from './landmarks';
import type { TrackerIn, TrackerOut, TrackParts } from './tracker.worker';

const VERSION = '1.0.1';
const LIB = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODELS = 'https://storage.googleapis.com/mediapipe-models';
const MODEL = {
  pose: `${MODELS}/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  face: `${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  hand: `${MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
};

export type TrackerStatus = 'off' | 'camera' | 'loading' | 'running' | 'error';

/** a reason a start failed, in words for the player */
export function startError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The camera is blocked. Allow it for this site in the address bar, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No webcam found.';
  if (name === 'NotReadableError') return 'The webcam is busy in another app.';
  if (!navigator.onLine) return 'Body tracking downloads its models the first time. Connect to the internet and try again.';
  return 'Body tracking could not start in this browser.';
}

/** the graphics card didn't come back with a frame once this session: the processor from then on */
let gpuStuck = false;
/** how long the first frame on the graphics card can take before trying the processor (ms) */
const FIRST_FRAME = 10000;

export class BodyTracker {
  readonly video: HTMLVideoElement;
  status: TrackerStatus = 'off';
  /** each frame the models looked at, and the seconds since the last */
  onSeen: ((seen: MocapIn, dt: number) => void) | null = null;
  onStatus: ((s: TrackerStatus, message?: string) => void) | null = null;
  /** what to look for besides the body */
  parts: TrackParts = { face: true, hands: true };
  /** frames the models looked at per second, and how long each took (ms) */
  fps = 0;
  ms = 0;
  delegate: 'GPU' | 'CPU' | '' = '';
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private ready = false;
  private busy = false;
  private lastVideoT = -1;
  private lastSeen = 0;
  /** when the first frame went to the models, and whether one has come back */
  private firstSent = 0;
  private answered = false;
  private run = 0;
  private raf = 0;

  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
  }

  private set(s: TrackerStatus, message?: string): void {
    this.status = s;
    this.onStatus?.(s, message);
  }

  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'camera' || this.status === 'loading') return;
    const run = ++this.run;
    try {
      this.set('camera');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' }, audio: false });
      if (run !== this.run) return this.dropStream();
      this.video.srcObject = this.stream;
      await this.video.play();
      this.set('loading');
      await this.startWorker(run, gpuStuck ? 'CPU' : 'GPU');
      if (run !== this.run) return;
      this.set('running');
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
    this.worker?.postMessage({ type: 'stop' } satisfies TrackerIn);
    this.worker?.terminate();
    this.worker = null;
    this.ready = this.busy = this.answered = false;
    this.firstSent = 0;
    this.dropStream();
    this.video.srcObject = null;
    this.lastVideoT = -1;
    this.fps = this.ms = 0;
    if (this.status !== 'off') this.set('off');
  }

  private dropStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /** the worker, with its models loaded */
  private startWorker(run: number, delegate: 'GPU' | 'CPU'): Promise<void> {
    this.worker?.terminate();
    this.ready = this.busy = this.answered = false;
    this.firstSent = 0;
    const w = new TrackerWorker();
    this.worker = w;
    return new Promise((resolve, reject) => {
      w.onmessage = (e: MessageEvent<TrackerOut>) => {
        if (run !== this.run) return;
        const m = e.data;
        if (m.type === 'ready') {
          this.ready = true;
          this.delegate = m.delegate;
          resolve();
        } else if (m.type === 'error') {
          this.busy = false;
          if (!this.ready) reject(new Error(m.message));
        } else if (m.type === 'skip') this.busy = false;
        else if (m.type === 'result') {
          this.busy = false;
          this.answered = true;
          const now = performance.now();
          const dt = this.lastSeen ? Math.min(0.25, (now - this.lastSeen) / 1000) : 1 / 30;
          this.lastSeen = now;
          if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;
          this.ms += (m.ms - this.ms) * 0.1;
          this.onSeen?.(m.seen, dt);
        }
      };
      w.onerror = (e) => {
        e.preventDefault();
        if (!this.ready) reject(new Error(e.message || 'The body tracking worker failed.'));
      };
      w.postMessage({ type: 'start', lib: LIB, wasm: WASM, models: MODEL, delegate } satisfies TrackerIn);
    });
  }

  private loop(run: number): void {
    const tick = () => {
      if (run !== this.run) return;
      this.raf = requestAnimationFrame(tick);
      const v = this.video;
      // some graphics drivers never finish a frame in a worker: start again on the processor
      if (this.delegate === 'GPU' && !this.answered && this.firstSent && performance.now() - this.firstSent > FIRST_FRAME) {
        gpuStuck = true;
        this.set('loading');
        this.startWorker(run, 'CPU').then(
          () => run === this.run && this.set('running'),
          (e) => {
            if (run !== this.run) return;
            this.stop();
            this.set('error', startError(e));
          },
        );
        return;
      }
      // only new camera frames, and one at a time to the models
      if (!this.ready || this.busy || v.readyState < 2 || v.currentTime === this.lastVideoT) return;
      this.lastVideoT = v.currentTime;
      this.busy = true;
      this.firstSent ||= performance.now();
      createImageBitmap(v).then(
        (frame) => {
          if (run !== this.run || !this.worker) return frame.close();
          this.worker.postMessage({ type: 'frame', frame, t: performance.now(), parts: { ...this.parts } } satisfies TrackerIn, [frame]);
        },
        () => (this.busy = false),
      );
    };
    this.raf = requestAnimationFrame(tick);
  }
}
