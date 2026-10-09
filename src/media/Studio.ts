/*
 * The recording studio (Section 11): one tap records the set.
 *   audio   the clean master as lossless 24-bit PCM (exported as WAV or MP3)
 *   video   the stage (venue, lights, crowd, you) composited with the
 *           overlays and encoded live (audio included)
 *   booth   video with the camera on your hands (the app locks the angle)
 * An optional count-in lands the start on a downbeat.
 *
 * Times: the audio clock (AudioContext seconds). Audio blocks are stamped
 * by the capture tap; a frame's time is when its audio is heard (the app's
 * picture clock, which runs behind by the output latency), so picture and
 * sound line up in the file.
 */
import type { Capture } from '../audio/capture/Capture';
import { PcmTape } from '../audio/capture/pcm';
import type { Marker, TracklistEntry } from '../core/models';
import { Compositor, DEFAULT_OVERLAYS, type OverlayOpts, type OverlayState } from './Compositor';
import { CodecWriter, frameSize, planVideo, StreamWriter, videoBitrate, type ResolutionId, type Writer } from './MediaWriter';
import type { MarkerLog, TracklistLog } from './logs';

export type RecordMode = 'audio' | 'video' | 'booth';
export type DirectorMode = 'auto' | 'locked' | 'live';
export type Aspect = '16:9' | '9:16' | '1:1';

export interface RecordSettings {
  mode: RecordMode;
  resolution: ResolutionId;
  fps: 30 | 60;
  aspect: Aspect;
  countdown: boolean;
  director: DirectorMode;
  overlays: OverlayOpts;
}

export const DEFAULT_RECORD: RecordSettings = { mode: 'video', resolution: '1080p', fps: 30, aspect: '16:9', countdown: true, director: 'auto', overlays: DEFAULT_OVERLAYS };

export interface StudioHost {
  capture: Capture;
  frameHooks: Set<(c: HTMLCanvasElement) => void>;
  setRecordSize(s: { w: number; h: number } | null): void;
  /** the audio clock now (what's being rendered) */
  audioTime(): number;
  /** the audio clock of the picture on screen (what's being heard) */
  pictureTime(): number;
  /** the overlays' facts: your name, the venue and its name style */
  overlay(): Omit<OverlayState, 't' | 'tracklist' | 'date'>;
  tracklist: TracklistLog;
  markers: MarkerLog;
  /** the master's beat: the next downbeat (audio clock) and the beat length, or null when nothing's playing */
  beat(): { downbeat: number; period: number } | null;
  /** the master as a MediaStream, for the MediaRecorder fallback */
  masterStream(): MediaStream | null;
}

export interface Take {
  mode: RecordMode;
  /** audio clock at the start */
  start: number;
  seconds: number;
  date: Date;
  /** raw 24-bit stereo (audio mode) */
  pcm?: Blob;
  rate: number;
  video?: Blob;
  aspect: Aspect;
  tracklist: TracklistEntry[];
  markers: Marker[];
  /** a still from the set (JPEG) */
  thumb?: Blob;
  /** frames dropped because the encoder fell behind */
  dropped: number;
}

export type StudioState = 'idle' | 'countdown' | 'recording' | 'finishing';

export class Studio {
  state: StudioState = 'idle';
  settings: RecordSettings = structuredClone(DEFAULT_RECORD);
  /** the count-in: 3, 2, 1 (null when not counting) */
  count: number | null = null;
  private startAt = 0;
  private date = new Date();
  private tape: PcmTape | null = null;
  private writer: Writer | null = null;
  private comp: Compositor | null = null;
  private lastFrame = -1e9;
  private offChunk: (() => void) | null = null;
  private hook: ((c: HTMLCanvasElement) => void) | null = null;
  private thumb: Blob | null = null;
  private thumbAt = 8;
  private countTimer = 0;
  private beats: number[] = [];

  constructor(private host: StudioHost) {}

  get elapsed(): number {
    return this.state === 'recording' ? Math.max(0, this.host.audioTime() - this.startAt) : 0;
  }

  get video(): boolean {
    return this.settings.mode !== 'audio';
  }

  /** Start (with the count-in if it's on). Resolves once recording has actually begun, or false. */
  async start(settings: RecordSettings = this.settings): Promise<boolean> {
    if (this.state !== 'idle' || !this.host.capture.supported) return false;
    this.settings = structuredClone(settings);
    // prepare the encoder first, so the count-in lands on a ready recorder
    if (this.video) {
      const { w, h } = frameSize(settings.resolution, settings.aspect);
      const plan = await planVideo(w, h, settings.fps);
      this.comp = new Compositor(w, h);
      if (plan) this.writer = new CodecWriter(plan);
      else {
        const ms = this.host.masterStream();
        if (!ms || typeof MediaRecorder === 'undefined') return false;
        this.writer = new StreamWriter(this.comp.canvas, ms, settings.fps, videoBitrate(w, h, settings.fps));
      }
      this.host.setRecordSize({ w, h });
    } else this.tape = new PcmTape(this.host.capture.rate);
    this.date = new Date();
    this.thumb = null;
    this.thumbAt = 8;
    this.lastFrame = -1e9;
    const now = this.host.audioTime();
    if (settings.countdown) {
      // three beats counted in, recording from the downbeat after (or a steady count when nothing plays)
      const b = this.host.beat();
      const period = b ? b.period : 0.5;
      // count 3, 2, 1 on the beats before a downbeat, a whole bar later if that's too soon
      let first = b ? b.downbeat - 3 * period : now + 0.2;
      while (first < now + 0.15) first += b ? 4 * period : period;
      this.beats = [first, first + period, first + period * 2];
      this.startAt = first + period * 3;
      this.state = 'countdown';
    } else {
      this.startAt = now;
      this.state = 'recording';
    }
    this.attach();
    if (this.state === 'countdown') {
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (this.state !== 'countdown') return resolve();
          // the number on screen follows the beats you hear; recording starts on the beat as it's rendered
          const seen = this.host.pictureTime();
          const i = this.beats.findIndex((x) => seen < x);
          this.count = seen < this.beats[0] ? null : i < 0 ? 1 : 3 - i + 1;
          if (this.host.audioTime() >= this.startAt) {
            this.count = null;
            this.state = 'recording';
            return resolve();
          }
          this.countTimer = window.setTimeout(tick, 15);
        };
        tick();
      });
    }
    return this.state === 'recording';
  }

  private attach(): void {
    const rate = this.host.capture.rate;
    this.offChunk = this.host.capture.onChunk((l, r, end) => {
      if (this.state !== 'recording' && this.state !== 'countdown') return;
      const startT = end - l.length / rate;
      if (end <= this.startAt) return;
      // the block that straddles the start: from the start on
      let from = 0;
      if (startT < this.startAt) from = Math.min(l.length, Math.round((this.startAt - startT) * rate));
      const L = from ? l.subarray(from) : l;
      const R = from ? r.subarray(from) : r;
      this.tape?.push(L, R, end);
      this.writer?.audio(L, R, (startT + from / rate - this.startAt) * 1e6);
    });
    // every mode watches the frames: video encodes them, audio takes a still for My Sets
    this.hook = (canvas) => this.onFrame(canvas);
    this.host.frameHooks.add(this.hook);
  }

  private onFrame(canvas: HTMLCanvasElement): void {
    if (this.state !== 'recording') return;
    const pt = this.host.pictureTime();
    const t = pt - this.startAt;
    if (t < 0) return;
    // a still for My Sets, a little way in
    if (!this.thumb && t >= Math.min(this.thumbAt, this.elapsed)) this.snapThumb(canvas, t);
    if (!this.comp || !this.writer) return;
    if (pt - this.lastFrame < 1 / this.settings.fps - 0.004) return;
    this.lastFrame = pt;
    const o = this.host.overlay();
    this.comp.draw(canvas, this.settings.overlays, { ...o, date: this.date, t, tracklist: this.host.tracklist.window(this.startAt, pt) });
    this.writer.frame(this.comp.canvas, t * 1e6);
  }

  private snapThumb(canvas: HTMLCanvasElement, t: number): void {
    this.thumbAt = t + 1e9;
    const src = this.comp?.canvas ?? canvas;
    const w = 480;
    const h = Math.round((w * src.height) / src.width);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(src, 0, 0, w, h);
    c.toBlob((b) => b && (this.thumb = b), 'image/jpeg', 0.82);
  }

  /** Stop and hand back the take (null if nothing was recorded). */
  async stop(): Promise<Take | null> {
    clearTimeout(this.countTimer);
    const was = this.state;
    if (was === 'idle' || was === 'finishing') return null;
    const end = this.host.audioTime();
    this.state = 'finishing';
    this.count = null;
    this.detach();
    const seconds = Math.max(0, end - this.startAt);
    try {
      if (was === 'countdown' || seconds < 0.5) {
        this.writer?.abort();
        return null;
      }
      const video = this.writer ? await this.writer.finish(seconds * 1e6) : undefined;
      // the thumbnail's toBlob may still be running for a very short take
      if (!this.thumb) await new Promise((r) => setTimeout(r, 120));
      return {
        mode: this.settings.mode,
        start: this.startAt,
        seconds,
        date: this.date,
        pcm: this.tape?.data(),
        rate: this.host.capture.rate,
        video,
        aspect: this.video ? this.settings.aspect : '16:9',
        tracklist: this.host.tracklist.window(this.startAt, end),
        markers: this.host.markers.window(this.startAt, end),
        thumb: this.thumb ?? undefined,
        dropped: this.writer?.stats.dropped ?? 0,
      };
    } finally {
      this.writer = null;
      this.tape = null;
      this.comp = null;
      this.host.setRecordSize(null);
      this.state = 'idle';
    }
  }

  /** get out without a file (the page is closing, a venue change failed…) */
  cancel(): void {
    clearTimeout(this.countTimer);
    this.detach();
    this.writer?.abort();
    this.writer = null;
    this.tape = null;
    this.comp = null;
    this.host.setRecordSize(null);
    this.state = 'idle';
    this.count = null;
  }

  private detach(): void {
    this.offChunk?.();
    this.offChunk = null;
    if (this.hook) this.host.frameHooks.delete(this.hook);
    this.hook = null;
  }
}
