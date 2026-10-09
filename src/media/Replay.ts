/*
 * The replay buffer, "Save That Mix" (Section 12): the last few minutes
 * kept all the time, so a mix you didn't record can still be saved.
 *   audio   the capture tap's ring: lossless 24-bit, fixed memory
 *   video   (optional, heavier) the stage encoded at 720p into a ring of
 *           chunks; old chunks go, but always from a keyframe, so what's
 *           left can be decoded
 *   stills  a small picture every two seconds (the trim editor's
 *           thumbnails, and the picture for clips when video is off)
 */
import type { Capture } from '../audio/capture/Capture';
import { PcmRing } from '../audio/capture/pcm';
import { Compositor, DEFAULT_OVERLAYS } from './Compositor';
import { planVideo, type VideoPlan } from './MediaWriter';

export interface VChunk {
  /** audio clock, seconds */
  t: number;
  key: boolean;
  data: Uint8Array;
}

export interface Still {
  t: number;
  blob: Blob;
}

export interface ReplayVideo {
  plan: VideoPlan;
  /** what a decoder needs (with the avcC for H.264) */
  config: VideoDecoderConfig;
  chunks: VChunk[];
}

/** a copy of the buffer at one moment: PCM and (if kept) video from the same start */
export interface ReplaySnap {
  pcm: Uint8Array;
  rate: number;
  /** audio clock of the first and last frame of `pcm` */
  from: number;
  to: number;
  video: ReplayVideo | null;
  stills: Still[];
}

export const BUFFER_VIDEO = { w: 1280, h: 720, fps: 30, bitrate: 2_000_000 } as const;
const STILL_EVERY = 2;
const STILL_KEEP = 60 * 60;

/** memory the buffer uses once it's full */
export function replayBytes(minutes: number, video: boolean, rate = 48000): number {
  if (minutes <= 0) return 0;
  const audio = PcmRing.bytesFor(minutes * 60, rate);
  return audio + (video ? (BUFFER_VIDEO.bitrate / 8) * (minutes * 60 + 4) : 0);
}

/** what the buffer starts as on this device: video only where there's memory to spare */
export function defaultReplay(): { minutes: number; video: boolean } {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency || 4;
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700;
  if (phone || (mem !== undefined && mem <= 2)) return { minutes: 2, video: false };
  if (mem !== undefined && mem < 4) return { minutes: 5, video: false };
  return { minutes: 10, video: (mem === undefined || mem >= 8) && cores >= 8 };
}

export class Replay {
  minutes = 0;
  video = false;
  private enc: VideoEncoder | null = null;
  private plan: VideoPlan | null = null;
  private config: VideoDecoderConfig | null = null;
  private chunks: VChunk[] = [];
  private chunkBytes = 0;
  private comp: Compositor | null = null;
  private stills: Still[] = [];
  private stillCanvas: HTMLCanvasElement;
  private lastStill = -1e9;
  private lastFrame = -1e9;
  private lastKey = -1e9;
  private hook = (c: HTMLCanvasElement) => this.onFrame(c);
  /** frame times waiting on the encoder, by timestamp (µs) → audio clock */
  private pending = new Map<number, number>();

  constructor(
    private capture: Capture,
    private frameHooks: Set<(c: HTMLCanvasElement) => void>,
    private pictureTime: () => number,
  ) {
    this.stillCanvas = document.createElement('canvas');
    this.stillCanvas.width = 192;
    this.stillCanvas.height = 108;
    frameHooks.add(this.hook);
  }

  get on(): boolean {
    return this.minutes > 0 && !!this.capture.ring;
  }

  /** seconds of audio held now */
  get seconds(): number {
    return this.capture.ring?.seconds ?? 0;
  }

  get bytes(): number {
    return (this.capture.ring?.bytesAllocated ?? 0) + this.chunkBytes;
  }

  /** Set the length (0 = off) and whether video is kept. */
  async configure(minutes: number, video: boolean): Promise<void> {
    this.minutes = minutes;
    this.capture.setBuffer(minutes * 60);
    const wantVideo = minutes > 0 && video;
    if (wantVideo === this.video && (this.enc || !wantVideo)) return;
    this.video = wantVideo;
    this.stopVideo();
    if (!wantVideo) return;
    const plan = await planVideo(BUFFER_VIDEO.w, BUFFER_VIDEO.h, BUFFER_VIDEO.fps);
    if (!plan || !this.video) {
      this.video = false;
      return;
    }
    plan.video = { ...plan.video, bitrate: BUFFER_VIDEO.bitrate };
    this.plan = plan;
    this.comp = new Compositor(BUFFER_VIDEO.w, BUFFER_VIDEO.h);
    this.enc = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig) this.config = { ...meta.decoderConfig, codec: meta.decoderConfig.codec || plan.video.codec };
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const t = this.pending.get(chunk.timestamp) ?? chunk.timestamp / 1e6;
        this.pending.delete(chunk.timestamp);
        this.chunks.push({ t, key: chunk.type === 'key', data });
        this.chunkBytes += data.length;
        this.trim();
      },
      error: () => this.stopVideo(),
    });
    this.enc.configure(plan.video);
  }

  private stopVideo(): void {
    try {
      this.enc?.close();
    } catch {
      /* closed */
    }
    this.enc = null;
    this.chunks = [];
    this.chunkBytes = 0;
    this.config = null;
    this.pending.clear();
  }

  /** drop video older than the buffer, keeping a keyframe to start from */
  private trim(): void {
    const ring = this.capture.ring;
    if (!ring) return;
    const cutoff = ring.startTime;
    let k = -1;
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i].t > cutoff) break;
      if (this.chunks[i].key) k = i;
    }
    if (k > 0) {
      for (let i = 0; i < k; i++) this.chunkBytes -= this.chunks[i].data.length;
      this.chunks.splice(0, k);
    }
  }

  /** stills are wanted while a recording runs, even with the buffer off */
  wantStills = false;

  private onFrame(canvas: HTMLCanvasElement): void {
    if (!this.on && !this.wantStills) return;
    const pt = this.pictureTime();
    if (pt - this.lastStill >= STILL_EVERY) {
      this.lastStill = pt;
      const c = this.stillCanvas;
      const g = c.getContext('2d')!;
      const sw = canvas.width;
      const sh = canvas.height;
      const cw = Math.min(sw, (sh * 16) / 9);
      const ch = Math.min(sh, (sw * 9) / 16);
      g.drawImage(canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, c.width, c.height);
      c.toBlob(
        (b) => {
          if (!b) return;
          this.stills.push({ t: pt, blob: b });
          while (this.stills.length && this.stills[0].t < pt - STILL_KEEP) this.stills.shift();
        },
        'image/jpeg',
        0.72,
      );
    }
    const enc = this.enc;
    if (!this.on || !enc || enc.state !== 'configured' || !this.comp) return;
    if (pt - this.lastFrame < 1 / BUFFER_VIDEO.fps - 0.004) return;
    // never let the buffer slow the game: skip frames while the encoder is busy
    if (enc.encodeQueueSize > 2) return;
    this.lastFrame = pt;
    this.comp.draw(canvas, { ...DEFAULT_OVERLAYS, watermark: false, venueDate: false, nowPlaying: false }, { name: '', venueStyle: 'chrome_led', venue: '', date: new Date(), t: 0, tracklist: [] });
    const ts = Math.round(pt * 1e6);
    let f: VideoFrame;
    try {
      f = new VideoFrame(this.comp.canvas, { timestamp: ts });
    } catch {
      return;
    }
    const key = pt - this.lastKey >= 2;
    if (key) this.lastKey = pt;
    this.pending.set(ts, pt);
    enc.encode(f, { keyFrame: key });
    f.close();
  }

  /** A copy of the last `seconds` (default all), ending `endBack` seconds ago. Instant: no encoding here. */
  snapshot(seconds = Infinity, endBack = 0): ReplaySnap | null {
    const ring = this.capture.ring;
    if (!ring || ring.seconds < 1) return null;
    const a = ring.read(seconds, endBack);
    let from = a.startTime;
    const to = from + a.frames / ring.rate;
    let pcm = a.bytes;
    let video: ReplayVideo | null = null;
    if (this.chunks.length && this.config && this.plan) {
      // video from its first keyframe inside the window; the audio is cut to match
      const first = this.chunks.findIndex((c) => c.key && c.t >= from - 0.001 && c.t < to - 1);
      const lastKeyBefore = this.chunks.reduce((k, c, i) => (c.key && c.t <= from ? i : k), -1);
      const start = lastKeyBefore >= 0 && from - this.chunks[lastKeyBefore].t < 0.5 ? lastKeyBefore : first;
      if (start >= 0) {
        const chunks = this.chunks.slice(start).filter((c) => c.t <= to);
        const vStart = chunks[0].t;
        if (vStart > from) {
          const cut = Math.round((vStart - from) * ring.rate) * 6;
          pcm = pcm.slice(cut);
          from = vStart;
        }
        video = { plan: this.plan, config: { ...this.config }, chunks };
      }
    }
    const stills = this.stills.filter((s) => s.t >= from - STILL_EVERY && s.t <= to);
    return { pcm, rate: ring.rate, from, to, video, stills };
  }

  /** the stills between two times (for a recording's film strip) */
  stillsBetween(from: number, to: number): Still[] {
    return this.stills.filter((s) => s.t >= from - STILL_EVERY && s.t <= to);
  }

  /** after a set ends and it's been saved (or not): start the buffer afresh */
  clear(): void {
    this.capture.ring?.clear();
    this.chunks = [];
    this.chunkBytes = 0;
  }

  dispose(): void {
    this.frameHooks.delete(this.hook);
    this.stopVideo();
  }
}
