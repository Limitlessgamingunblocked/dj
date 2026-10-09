/*
 * Making files from saved material (Section 12):
 *   muxBuffer   the replay buffer's video, already encoded, plus its audio
 *               encoded from the lossless PCM: one playable file, quickly
 *   renderClip  a stretch of a set re-made in any aspect with the overlays
 *               and fades: decoded frame by frame (or, with no video, the
 *               set's stills behind your name and a moving waveform),
 *               composited, and encoded again
 */
import { BYTES_PER_FRAME, fade24, read24, unpack24 } from '../audio/capture/pcm';
import type { TracklistEntry } from '../core/models';
import { nameService } from '../name/NameService';
import { Compositor, type OverlayOpts, type OverlayState } from './Compositor';
import { CodecWriter, frameSize, planVideo, type ResolutionId, type VideoPlan } from './MediaWriter';
import { Mp4Writer } from './mp4';
import { WebmWriter, type MuxChunk } from './webm';
import type { ReplayVideo } from './Replay';
import type { DemuxedVideo } from './demux';

const toBytes = (d: AllowSharedBufferSource | undefined): Uint8Array | undefined =>
  d ? (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength))) : undefined;

/** encode 24-bit PCM with the browser's audio encoder, offline */
export async function encodeAudio(pcm: Uint8Array, rate: number, cfg: AudioEncoderConfig): Promise<{ chunks: MuxChunk[]; description?: Uint8Array }> {
  const chunks: MuxChunk[] = [];
  let description: Uint8Array | undefined;
  let failed: Error | null = null;
  const enc = new AudioEncoder({
    output: (c, meta) => {
      const d = toBytes(meta?.decoderConfig?.description);
      if (d) description = d;
      const data = new Uint8Array(c.byteLength);
      c.copyTo(data);
      chunks.push({ track: 'audio', time: c.timestamp, key: true, data });
    },
    error: (e) => (failed = new Error(e.message)),
  });
  enc.configure(cfg);
  const frames = Math.floor(pcm.length / BYTES_PER_FRAME);
  const step = 4096;
  for (let f = 0; f < frames; f += step) {
    const n = Math.min(step, frames - f);
    const [l, r] = unpack24(pcm.subarray(f * BYTES_PER_FRAME, (f + n) * BYTES_PER_FRAME), n);
    const data = new Float32Array(n * 2);
    data.set(l, 0);
    data.set(r, n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((f / rate) * 1e6), data });
    enc.encode(ad);
    ad.close();
    while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
  return { chunks, description };
}

/** The replay buffer's video with its audio, as one file (no re-encoding of the picture). */
export async function muxBuffer(video: ReplayVideo, pcm: Uint8Array, rate: number): Promise<Blob> {
  const plan = video.plan;
  const audio = await encodeAudio(pcm, rate, plan.audio);
  const t0 = video.chunks[0].t;
  const vp9 = plan.video.codec.startsWith('vp09');
  const desc = toBytes(video.config.description);
  const w =
    plan.container === 'mp4'
      ? new Mp4Writer({ codec: vp9 ? 'vp09' : 'avc1', width: plan.width, height: plan.height, description: desc }, { codec: plan.audio.codec === 'opus' ? 'Opus' : 'mp4a', rate: 48000, channels: 2, description: plan.audio.codec === 'opus' ? undefined : audio.description, bitrate: plan.audio.bitrate })
      : new WebmWriter({ codec: vp9 ? 'V_VP9' : 'V_VP8', width: plan.width, height: plan.height }, { codec: 'A_OPUS', rate: 48000, channels: 2, description: audio.description });
  for (const c of video.chunks) w.add({ track: 'video', time: Math.round((c.t - t0) * 1e6), key: c.key, data: c.data });
  for (const c of audio.chunks) w.add(c);
  return w.finish((pcm.length / BYTES_PER_FRAME / rate) * 1e6);
}

/* ------------------------------ clips ------------------------------ */

export interface ClipJob {
  /** seconds within the source (0 = its start) */
  from: number;
  to: number;
  /** the picture: decoded video, or stills (times from the source's start) */
  video: DemuxedVideo | null;
  stills: { t: number; img: CanvasImageSource & { width: number; height: number } }[];
  /** the source's audio, from its start */
  pcm: Uint8Array;
  rate: number;
  aspect: '16:9' | '9:16' | '1:1';
  resolution: ResolutionId;
  fps: number;
  overlays: OverlayOpts;
  overlay: Omit<OverlayState, 't' | 'tracklist'>;
  /** the source's tracklist (times from its start) */
  tracklist: TracklistEntry[];
  fadeIn: number;
  fadeOut: number;
  onProgress?(k: number): void;
}

export interface ClipResult {
  video: Blob;
  /** the clip's own audio, faded, 24-bit */
  pcm: Uint8Array;
  plan: VideoPlan;
}

/** brightness for a fade at time t of a clip lasting `len` */
const fadeK = (t: number, len: number, fin: number, fout: number) => Math.min(1, fin > 0 ? t / fin : 1, fout > 0 ? (len - t) / fout : 1);

export async function renderClip(j: ClipJob): Promise<ClipResult> {
  const len = Math.max(0.5, j.to - j.from);
  const { w, h } = frameSize(j.resolution, j.aspect);
  const plan = await planVideo(w, h, j.fps);
  if (!plan) throw new Error('This browser can’t encode video');
  const writer = new CodecWriter(plan);
  const comp = new Compositor(w, h);
  const g = comp.canvas.getContext('2d')!;
  const state = (t: number): OverlayState => ({ ...j.overlay, t, tracklist: j.tracklist.filter((e) => e.at <= j.from + t).map((e) => ({ ...e, at: Math.max(0, e.at - j.from) })) });

  // the audio first (it's quick): cut, faded, fed in blocks
  const a0 = Math.max(0, Math.round(j.from * j.rate)) * BYTES_PER_FRAME;
  const a1 = Math.min(j.pcm.length, Math.round(j.to * j.rate) * BYTES_PER_FRAME);
  const pcm = j.pcm.slice(a0, a1);
  const frames = Math.floor(pcm.length / BYTES_PER_FRAME);
  fade24(pcm, frames, j.fadeIn * j.rate, j.fadeOut * j.rate);
  for (let f = 0; f < frames; f += 4096) {
    const n = Math.min(4096, frames - f);
    const [l, r] = unpack24(pcm.subarray(f * BYTES_PER_FRAME, (f + n) * BYTES_PER_FRAME), n);
    writer.audio(l, r, (f / j.rate) * 1e6);
  }

  const dim = (t: number) => {
    const k = fadeK(t, len, j.fadeIn, j.fadeOut);
    if (k < 1) {
      g.save();
      g.globalAlpha = 1 - Math.max(0, k);
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.restore();
    }
  };

  if (j.video) {
    const v = j.video;
    const frameQueue: VideoFrame[] = [];
    let failed: Error | null = null;
    const dec = new VideoDecoder({ output: (f) => frameQueue.push(f), error: (e) => (failed = new Error(e.message)) });
    dec.configure({ codec: v.codec, codedWidth: v.width, codedHeight: v.height, description: v.description });
    let start = 0;
    for (let i = 0; i < v.chunks.length; i++) if (v.chunks[i].key && v.chunks[i].t <= j.from + 0.001) start = i;
    let lastOut = -1e9;
    const drain = async () => {
      while (frameQueue.length) {
        const f = frameQueue.shift()!;
        const t = f.timestamp / 1e6 - j.from;
        if (t >= -0.5 / j.fps && t <= len && t - lastOut >= 1 / j.fps - 0.004) {
          lastOut = t;
          comp.draw(f as unknown as CanvasImageSource & { width: number; height: number }, j.overlays, state(Math.max(0, t)), f.displayWidth, f.displayHeight);
          dim(Math.max(0, t));
          await writer.frameWhenReady(comp.canvas, Math.max(0, t) * 1e6);
          j.onProgress?.(Math.min(1, t / len));
        }
        f.close();
      }
    };
    for (let i = start; i < v.chunks.length; i++) {
      const c = v.chunks[i];
      if (c.t > j.to + 0.5) break;
      dec.decode(new EncodedVideoChunk({ type: c.key ? 'key' : 'delta', timestamp: Math.round(c.t * 1e6), data: c.data }));
      while (dec.decodeQueueSize > 3) await new Promise((r) => setTimeout(r, 2));
      await drain();
      if (failed) break;
    }
    await dec.flush().catch(() => undefined);
    await drain();
    dec.close();
    if (failed) throw failed;
  } else {
    await renderStills(j, comp, writer, len, state, dim);
  }
  const video = await writer.finish(len * 1e6);
  return { video, pcm, plan };
}

/** no video kept: the set's stills, blurred behind your name, with a waveform that moves with the music */
async function renderStills(j: ClipJob, comp: Compositor, writer: CodecWriter, len: number, state: (t: number) => OverlayState, dim: (t: number) => void): Promise<void> {
  const w = comp.width;
  const h = comp.height;
  const g = comp.canvas.getContext('2d')!;
  const name = document.createElement('canvas');
  name.width = Math.round(w * 0.86);
  name.height = Math.round(name.width * 0.34);
  nameService.draw(name, j.overlay.venueStyle, j.overlay.name || 'DECKHOUSE', { bg: null });
  const bars = 48;
  // each still is blurred once, small, then just scaled up per frame (a blur every frame is slow everywhere)
  const blurred = new Map<CanvasImageSource, HTMLCanvasElement>();
  const soft = (img: CanvasImageSource & { width: number; height: number }) => {
    let c = blurred.get(img);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = 160;
    c.height = Math.max(1, Math.round((160 * img.height) / img.width));
    const x = c.getContext('2d')!;
    x.filter = 'blur(2px) brightness(0.55) saturate(1.3)';
    x.drawImage(img, 0, 0, c.width, c.height);
    blurred.set(img, c);
    return c;
  };
  for (let i = 0; ; i++) {
    const t = i / j.fps;
    if (t > len) break;
    const st = j.from + t;
    let img = j.stills[0]?.img;
    for (const s of j.stills) if (s.t <= st) img = s.img;
    g.fillStyle = '#07070b';
    g.fillRect(0, 0, w, h);
    if (img) {
      // slow push-in on a blurred, darkened still
      const b = soft(img);
      const z = 1.15 + 0.06 * Math.sin(t * 0.3);
      const cover = Math.max(w / b.width, h / b.height) * z;
      g.imageSmoothingQuality = 'high';
      g.drawImage(b, (w - b.width * cover) / 2, (h - b.height * cover) / 2, b.width * cover, b.height * cover);
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.drawImage(name, (w - name.width) / 2, h * 0.32 - name.height / 2);
    g.restore();
    // the waveform: loudness around this moment, bar by bar
    const rate = j.rate;
    const bw = (w * 0.8) / bars;
    for (let b = 0; b < bars; b++) {
      const at = Math.round((st + (b - bars / 2) * 0.02) * rate) * BYTES_PER_FRAME;
      let peak = 0;
      for (let k = 0; k < 480; k += 24) {
        const o = at + k * BYTES_PER_FRAME;
        if (o >= 0 && o + 6 <= j.pcm.length) peak = Math.max(peak, Math.abs(read24(j.pcm, o)) / 8388607);
      }
      const bh = Math.max(4, peak * h * 0.16);
      g.fillStyle = b === bars / 2 ? '#ffb547' : '#ff2e88';
      g.fillRect(w * 0.1 + b * bw + bw * 0.15, h * 0.6 - bh / 2, bw * 0.7, bh);
    }
    comp.overlays(j.overlays, state(t));
    dim(t);
    await writer.frameWhenReady(comp.canvas, t * 1e6);
    j.onProgress?.(t / len);
    if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}
