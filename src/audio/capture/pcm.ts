/*
 * Lossless PCM for recordings and the replay buffer (Sections 11.2, 12.6).
 *
 * Everything is kept as 24-bit stereo, interleaved, little-endian: the same
 * samples a WAV file holds, so a mix saved from the replay buffer is
 * bit-identical to the same stretch recorded by hand.
 *
 *   PcmRing   the last N minutes, in 10-second segments allocated as the set
 *             goes on; once full, the oldest segment is reused, so memory
 *             stays fixed however long the set runs
 *   PcmTape   a manual recording: chunks gathered into Blob parts (which the
 *             browser can keep on disk), with a WAV header added at the end
 */

export const BYTES_PER_FRAME = 6; // 2 channels × 3 bytes
const FULL = 8388607; // 2^23 - 1

/** pack float stereo into 24-bit interleaved bytes at `out[at..]` */
export function pack24(l: Float32Array, r: Float32Array, out: Uint8Array, at = 0, from = 0, frames = l.length - from): void {
  let o = at;
  for (let i = from; i < from + frames; i++) {
    for (let c = 0; c < 2; c++) {
      let x = c === 0 ? l[i] : r[i];
      // NaN and out-of-range samples clamp (the limiter keeps the master under 0 dBFS anyway)
      x = x > 1 ? 1 : x < -1 ? -1 : x === x ? x : 0;
      const v = Math.round(x * FULL);
      out[o++] = v & 0xff;
      out[o++] = (v >> 8) & 0xff;
      out[o++] = (v >> 16) & 0xff;
    }
  }
}

/** one 24-bit sample (signed) at byte offset `o` */
export function read24(b: Uint8Array, o: number): number {
  const v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  return v & 0x800000 ? v - 0x1000000 : v;
}

export function write24(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
  b[o + 2] = (v >> 16) & 0xff;
}

/** 24-bit interleaved → float channels (for previews and encoders) */
export function unpack24(b: Uint8Array, frames = Math.floor(b.length / BYTES_PER_FRAME)): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let i = 0, o = 0; i < frames; i++, o += 6) {
    l[i] = read24(b, o) / FULL;
    r[i] = read24(b, o + 3) / FULL;
  }
  return [l, r];
}

/** 24-bit → 16-bit with triangular dither (for the MP3 encoder) */
export function to16(b: Uint8Array, frames: number, rand: () => number = Math.random): [Int16Array, Int16Array] {
  const l = new Int16Array(frames);
  const r = new Int16Array(frames);
  for (let i = 0, o = 0; i < frames; i++, o += 6) {
    for (let c = 0; c < 2; c++) {
      const v = Math.round(read24(b, o + c * 3) / 256 + rand() - rand());
      (c === 0 ? l : r)[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
  }
  return [l, r];
}

/** The 44-byte header of a PCM WAV file. */
export function wavHeader(frames: number, rate: number, channels = 2, bits = 24): Uint8Array {
  const block = (channels * bits) / 8;
  const data = frames * block;
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * block, true);
  v.setUint16(32, block, true);
  v.setUint16(34, bits, true);
  tag(36, 'data');
  v.setUint32(40, data, true);
  return new Uint8Array(buf);
}

/** Fade the start and end of 24-bit stereo in place (equal-power curves). */
export function fade24(b: Uint8Array, frames: number, inFrames: number, outFrames: number): void {
  const apply = (i: number, g: number) => {
    const o = i * 6;
    write24(b, o, Math.round(read24(b, o) * g));
    write24(b, o + 3, Math.round(read24(b, o + 3) * g));
  };
  const fin = Math.min(frames, Math.max(0, Math.floor(inFrames)));
  for (let i = 0; i < fin; i++) apply(i, Math.sin(((i / fin) * Math.PI) / 2));
  const fout = Math.min(frames, Math.max(0, Math.floor(outFrames)));
  for (let i = 0; i < fout; i++) apply(frames - 1 - i, Math.sin(((i / fout) * Math.PI) / 2));
}

/** min/max pairs, `n` columns across the audio (a waveform overview) */
export function peaks24(b: Uint8Array, frames: number, n: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(n * 2);
  const per = frames / n;
  for (let c = 0; c < n; c++) {
    const a = Math.floor(c * per);
    const e = Math.max(a + 1, Math.floor((c + 1) * per));
    // look at up to 256 frames per column: plenty for a picture, quick for an hour
    const step = Math.max(1, Math.floor((e - a) / 256));
    let lo = 0;
    let hi = 0;
    for (let i = a; i < e && i < frames; i += step) {
      const s = (read24(b, i * 6) + read24(b, i * 6 + 3)) / (2 * FULL);
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    out[c * 2] = lo;
    out[c * 2 + 1] = hi;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* the replay buffer                                                    */
/* ------------------------------------------------------------------ */

export const RING_SEGMENT_SECONDS = 10;

export class PcmRing {
  readonly capacity: number;
  private readonly segFrames: number;
  private readonly segs: (Uint8Array | undefined)[];
  /** frames written since the start (or the last clear) */
  written = 0;
  /** capture clock (seconds) at the end of the last chunk */
  endTime = 0;

  constructor(
    seconds: number,
    readonly rate: number,
  ) {
    this.capacity = Math.max(1, Math.round(seconds * rate));
    this.segFrames = Math.round(RING_SEGMENT_SECONDS * rate);
    this.segs = new Array(Math.ceil(this.capacity / this.segFrames) + 1);
  }

  /** bytes the buffer holds once it's full */
  static bytesFor(seconds: number, rate: number): number {
    return (Math.ceil((seconds * rate) / Math.round(RING_SEGMENT_SECONDS * rate)) + 1) * Math.round(RING_SEGMENT_SECONDS * rate) * BYTES_PER_FRAME;
  }

  get bytesAllocated(): number {
    return this.segs.reduce((n, s) => n + (s?.length ?? 0), 0);
  }

  /** seconds of audio held right now */
  get seconds(): number {
    return Math.min(this.written, this.capacity) / this.rate;
  }

  /** capture-clock time of the oldest frame held */
  get startTime(): number {
    return this.endTime - this.seconds;
  }

  push(l: Float32Array, r: Float32Array, endTime: number): void {
    let from = 0;
    const n = l.length;
    while (from < n) {
      const abs = this.written;
      const si = Math.floor(abs / this.segFrames) % this.segs.length;
      const off = abs % this.segFrames;
      const take = Math.min(n - from, this.segFrames - off);
      let seg = this.segs[si];
      if (!seg) seg = this.segs[si] = new Uint8Array(this.segFrames * BYTES_PER_FRAME);
      pack24(l, r, seg, off * BYTES_PER_FRAME, from, take);
      this.written += take;
      from += take;
    }
    this.endTime = endTime;
  }

  /** The last `seconds` (default: everything held), oldest first, ending `endBack` seconds ago. */
  read(seconds = Infinity, endBack = 0): { bytes: Uint8Array; frames: number; startTime: number } {
    const have = Math.min(this.written, this.capacity);
    const back = Math.max(0, Math.min(have, Math.round(endBack * this.rate)));
    const frames = Math.max(0, Math.min(have - back, Math.round(seconds * this.rate)));
    const out = new Uint8Array(frames * BYTES_PER_FRAME);
    let abs = this.written - back - frames;
    let o = 0;
    while (o < out.length) {
      const si = Math.floor(abs / this.segFrames) % this.segs.length;
      const off = abs % this.segFrames;
      const take = Math.min((out.length - o) / BYTES_PER_FRAME, this.segFrames - off);
      out.set(this.segs[si]!.subarray(off * BYTES_PER_FRAME, (off + take) * BYTES_PER_FRAME), o);
      o += take * BYTES_PER_FRAME;
      abs += take;
    }
    return { bytes: out, frames, startTime: this.endTime - (back + frames) / this.rate };
  }

  clear(): void {
    this.written = 0;
  }
}

/* ------------------------------------------------------------------ */
/* a manual recording                                                   */
/* ------------------------------------------------------------------ */

const PART_BYTES = 4 << 20;

export class PcmTape {
  frames = 0;
  private parts: Blob[] = [];
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  /** capture clock at the first frame */
  startTime = Number.NaN;

  constructor(readonly rate: number) {}

  push(l: Float32Array, r: Float32Array, endTime: number): void {
    if (Number.isNaN(this.startTime)) this.startTime = endTime - l.length / this.rate;
    const b = new Uint8Array(l.length * BYTES_PER_FRAME);
    pack24(l, r, b);
    this.pending.push(b);
    this.pendingBytes += b.length;
    this.frames += l.length;
    // hand big runs to a Blob, which the browser may keep on disk instead of in memory
    if (this.pendingBytes >= PART_BYTES) this.seal();
  }

  /** append already-packed 24-bit frames (from the replay buffer) */
  pushPacked(b: Uint8Array): void {
    this.pending.push(b);
    this.pendingBytes += b.length;
    this.frames += Math.floor(b.length / BYTES_PER_FRAME);
    if (this.pendingBytes >= PART_BYTES) this.seal();
  }

  private seal(): void {
    if (!this.pending.length) return;
    this.parts.push(new Blob(this.pending as BlobPart[]));
    this.pending = [];
    this.pendingBytes = 0;
  }

  get seconds(): number {
    return this.frames / this.rate;
  }

  /** the raw 24-bit data (no header) */
  data(): Blob {
    this.seal();
    return new Blob(this.parts);
  }

  /** the finished WAV file */
  wav(): Blob {
    this.seal();
    return new Blob([wavHeader(this.frames, this.rate) as BlobPart, ...this.parts], { type: 'audio/wav' });
  }
}
