/*
 * Video files (Section 11): frames and audio go through the browser's
 * encoders (WebCodecs) into our own muxers, so we control resolution, frame
 * rate and bitrate, and the file is ready the moment recording stops.
 *
 *   MP4  H.264 + AAC        when the browser can encode both (plays anywhere)
 *   WebM VP9 (or VP8) + Opus otherwise
 *   MediaRecorder            when WebCodecs is missing: the browser's own
 *                            recorder on the composited canvas
 *
 * If the encoder falls behind, frames are dropped rather than queued, so a
 * slow machine records a lower frame rate instead of stalling the game.
 */
import { Mp4Writer } from './mp4';
import { WebmWriter } from './webm';

export interface VideoPlan {
  container: 'mp4' | 'webm';
  ext: 'mp4' | 'webm';
  mime: string;
  width: number;
  height: number;
  fps: number;
  video: VideoEncoderConfig;
  audio: AudioEncoderConfig;
}

export interface Writer {
  readonly mime: string;
  readonly ext: string;
  /** frames handed in, and how many of them were dropped */
  readonly stats: { frames: number; dropped: number };
  /** returns false when the frame was dropped */
  frame(src: CanvasImageSource, timeUs: number): boolean;
  audio(l: Float32Array, r: Float32Array, timeUs: number): void;
  finish(durationUs: number): Promise<Blob>;
  abort(): void;
}

export const RESOLUTIONS = [
  { id: '720p', w: 1280, h: 720 },
  { id: '1080p', w: 1920, h: 1080 },
  { id: '1440p', w: 2560, h: 1440 },
  { id: '4k', w: 3840, h: 2160 },
] as const;
export type ResolutionId = (typeof RESOLUTIONS)[number]['id'];

/** frame size for a resolution and aspect: the short side is the resolution's height (even numbers for the encoders) */
export function frameSize(res: ResolutionId, aspect: '16:9' | '9:16' | '1:1'): { w: number; h: number } {
  const r = RESOLUTIONS.find((x) => x.id === res) ?? RESOLUTIONS[1];
  const even = (n: number) => Math.round(n / 2) * 2;
  if (aspect === '16:9') return { w: r.w, h: r.h };
  if (aspect === '9:16') return { w: r.h, h: r.w };
  return { w: even(r.h), h: even(r.h) };
}

/** a sensible bitrate: about 0.1 bits per pixel per frame, 2–40 Mbps */
export function videoBitrate(w: number, h: number, fps: number): number {
  return Math.round(Math.min(40e6, Math.max(2e6, w * h * fps * 0.1)));
}

export const AUDIO_KBPS = { mp4: 256, webm: 192 } as const;

/** MB per minute, video and audio together */
export function mbPerMinute(w: number, h: number, fps: number): number {
  return ((videoBitrate(w, h, fps) + AUDIO_KBPS.mp4 * 1000) * 60) / 8 / 1e6;
}

export function webCodecsAvailable(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof AudioData !== 'undefined';
}

function avcCodec(w: number, h: number, fps: number): string {
  const px = w * h * fps;
  // High profile; the level by frame size and rate
  if (px <= 1920 * 1088 * 30) return 'avc1.640028';
  if (px <= 1920 * 1088 * 60) return 'avc1.64002a';
  if (px <= 2560 * 1440 * 60) return 'avc1.640032';
  return 'avc1.640033';
}

/** The best format this browser can encode at this size, or null. */
export async function planVideo(w: number, h: number, fps: number): Promise<VideoPlan | null> {
  if (!webCodecsAvailable()) return null;
  const bitrate = videoBitrate(w, h, fps);
  const base = { width: w, height: h, bitrate, framerate: fps, latencyMode: 'realtime' as const };
  const tries: { container: 'mp4' | 'webm'; video: VideoEncoderConfig; audio: AudioEncoderConfig }[] = [
    {
      container: 'mp4',
      video: { ...base, codec: avcCodec(w, h, fps), avc: { format: 'avc' } } as VideoEncoderConfig,
      audio: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: AUDIO_KBPS.mp4 * 1000 },
    },
    {
      container: 'webm',
      video: { ...base, codec: w * h > 2560 * 1440 ? 'vp09.00.51.08' : 'vp09.00.41.08' },
      audio: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: AUDIO_KBPS.webm * 1000 },
    },
    {
      container: 'webm',
      video: { ...base, codec: 'vp8' },
      audio: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: AUDIO_KBPS.webm * 1000 },
    },
  ];
  for (const t of tries) {
    try {
      const [v, a] = await Promise.all([VideoEncoder.isConfigSupported(t.video), AudioEncoder.isConfigSupported(t.audio)]);
      if (v.supported && a.supported) return { container: t.container, ext: t.container, mime: t.container === 'mp4' ? 'video/mp4' : 'video/webm', width: w, height: h, fps, video: t.video, audio: t.audio };
    } catch {
      /* try the next */
    }
  }
  return null;
}

const bytesOf = (d: AllowSharedBufferSource | undefined): Uint8Array | undefined =>
  d ? (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength))) : undefined;

/** WebCodecs into our muxers */
export class CodecWriter implements Writer {
  readonly mime: string;
  readonly ext: string;
  readonly stats = { frames: 0, dropped: 0 };
  private ve: VideoEncoder;
  private ae: AudioEncoder;
  private mux: WebmWriter | Mp4Writer;
  private lastKey = -1e12;
  private failed: Error | null = null;
  private vDesc: { description?: Uint8Array; [k: string]: unknown };
  private aDesc: { description?: Uint8Array; [k: string]: unknown };

  constructor(plan: VideoPlan) {
    this.mime = plan.mime;
    this.ext = plan.ext;
    const vp9 = plan.video.codec.startsWith('vp09');
    if (plan.container === 'mp4') {
      // H.264 + AAC normally; VP9 + Opus in MP4 works too (the tests use it: it plays in every engine)
      const v = { codec: vp9 ? ('vp09' as const) : ('avc1' as const), width: plan.width, height: plan.height };
      const a = { codec: plan.audio.codec === 'opus' ? ('Opus' as const) : ('mp4a' as const), rate: 48000, channels: 2, bitrate: plan.audio.bitrate };
      this.mux = new Mp4Writer(v, a);
      this.vDesc = v;
      this.aDesc = a;
    } else {
      const v = { codec: vp9 ? ('V_VP9' as const) : ('V_VP8' as const), width: plan.width, height: plan.height };
      const a = { codec: 'A_OPUS' as const, rate: 48000, channels: 2 };
      this.mux = new WebmWriter(v, a);
      this.vDesc = {};
      this.aDesc = a;
    }
    const fail = (e: DOMException) => (this.failed = new Error(e.message));
    this.ve = new VideoEncoder({
      output: (chunk, meta) => {
        const d = bytesOf(meta?.decoderConfig?.description);
        if (d && plan.container === 'mp4') this.vDesc.description = d;
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.mux.add({ track: 'video', time: chunk.timestamp, key: chunk.type === 'key', data });
      },
      error: fail,
    });
    this.ve.configure(plan.video);
    this.ae = new AudioEncoder({
      output: (chunk, meta) => {
        const d = bytesOf(meta?.decoderConfig?.description);
        // Opus in MP4 takes its settings from dOps, not the encoder's OpusHead
        if (d && !(plan.container === 'mp4' && plan.audio.codec === 'opus')) this.aDesc.description = d;
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.mux.add({ track: 'audio', time: chunk.timestamp, key: true, data });
      },
      error: fail,
    });
    this.ae.configure(plan.audio);
  }

  frame(src: CanvasImageSource, timeUs: number): boolean {
    if (this.failed || this.ve.state !== 'configured') return false;
    this.stats.frames++;
    // the encoder is behind: skip this one
    if (this.ve.encodeQueueSize > 4) {
      this.stats.dropped++;
      return false;
    }
    let f: VideoFrame;
    try {
      f = new VideoFrame(src, { timestamp: Math.max(0, Math.round(timeUs)) });
    } catch {
      this.stats.dropped++;
      return false;
    }
    const key = timeUs - this.lastKey >= 2e6;
    if (key) this.lastKey = timeUs;
    this.ve.encode(f, { keyFrame: key });
    f.close();
    return true;
  }

  /** For exports that aren't live (the trim editor): wait for room in the encoder instead of dropping. */
  async frameWhenReady(src: CanvasImageSource, timeUs: number): Promise<void> {
    while (!this.failed && this.ve.state === 'configured' && this.ve.encodeQueueSize > 2) await new Promise((r) => setTimeout(r, 4));
    this.frame(src, timeUs);
  }

  audio(l: Float32Array, r: Float32Array, timeUs: number): void {
    if (this.failed || this.ae.state !== 'configured') return;
    // the block that straddles the start: keep only the part after it
    let from = 0;
    if (timeUs < 0) {
      from = Math.min(l.length, Math.ceil((-timeUs / 1e6) * 48000));
      timeUs = 0;
    }
    const n = l.length - from;
    if (n <= 0) return;
    const data = new Float32Array(n * 2);
    data.set(l.subarray(from), 0);
    data.set(r.subarray(from), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(timeUs), data });
    this.ae.encode(ad);
    ad.close();
  }

  async finish(durationUs: number): Promise<Blob> {
    await Promise.all([this.ve.flush().catch(() => undefined), this.ae.flush().catch(() => undefined)]);
    this.ve.close();
    this.ae.close();
    if (this.failed) throw this.failed;
    return this.mux.finish(durationUs);
  }

  abort(): void {
    try {
      this.ve.close();
      this.ae.close();
    } catch {
      /* closed already */
    }
  }
}

/** the fallback: the browser's MediaRecorder on the composited canvas and the master's audio */
export class StreamWriter implements Writer {
  readonly mime: string;
  readonly ext: string;
  readonly stats = { frames: 0, dropped: 0 };
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private track: CanvasCaptureMediaStreamTrack | null;

  constructor(canvas: HTMLCanvasElement, audio: MediaStream, fps: number, bitrate: number) {
    const stream = canvas.captureStream(0);
    this.track = (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack) ?? null;
    for (const t of audio.getAudioTracks()) stream.addTrack(t);
    const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const type = types.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
    this.rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: bitrate, audioBitsPerSecond: 256_000 });
    this.mime = (type || 'video/webm').split(';')[0];
    this.ext = this.mime.includes('mp4') ? 'mp4' : 'webm';
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    void fps;
  }

  frame(): boolean {
    this.stats.frames++;
    this.track?.requestFrame();
    return true;
  }

  audio(): void {
    /* the stream carries the audio */
  }

  finish(): Promise<Blob> {
    return new Promise((resolve) => {
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: this.mime }));
      this.rec.stop();
    });
  }

  abort(): void {
    if (this.rec.state !== 'inactive') this.rec.stop();
  }
}
