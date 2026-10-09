/*
 * A small MP4 writer for encoded chunks from WebCodecs: H.264 or VP9 video,
 * AAC or Opus audio. Samples go into one `mdat` in the order they arrive
 * (kept in time order across tracks); the `moov` with the sample tables is
 * written after it, once everything is known. 64-bit offsets kick in past
 * 4 GB. No B-frames are expected (the encoders run in real-time mode).
 */
import type { MuxChunk } from './webm';

export interface Mp4Video {
  codec: 'avc1' | 'vp09';
  width: number;
  height: number;
  /** avcC (H.264) from the encoder's decoder config */
  description?: Uint8Array;
}

export interface Mp4Audio {
  codec: 'mp4a' | 'Opus';
  rate: number;
  channels: number;
  /** AudioSpecificConfig (AAC) from the encoder */
  description?: Uint8Array;
  bitrate?: number;
}

const VIDEO_SCALE = 90_000;

/* ------------------------------ boxes ------------------------------ */

type Bytes = number[] | Uint8Array;

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u64(n: number): number[] {
  return [...u32(Math.floor(n / 2 ** 32)), ...u32(n >>> 0)];
}
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u8 = (n: number) => [n & 0xff];
const fourcc = (s: string) => [...s].map((c) => c.charCodeAt(0));

function cat(parts: Bytes[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function box(type: string, ...body: Bytes[]): Uint8Array {
  const inner = cat(body);
  return cat([u32(8 + inner.length), fourcc(type), inner]);
}

const full = (type: string, version: number, flags: number, ...body: Bytes[]) => box(type, [version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff], ...body);

const MATRIX = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

/* ------------------------------ writer ------------------------------ */

interface Sample {
  size: number;
  /** in the track's timescale */
  time: number;
  key: boolean;
  offset: number;
}

export class Mp4Writer {
  private parts: BlobPart[] = [];
  /** bytes of sample data so far (the mdat body) */
  private bytes = 0;
  private samples: { video: Sample[]; audio: Sample[] } = { video: [], audio: [] };
  private queue: { video: MuxChunk[]; audio: MuxChunk[] } = { video: [], audio: [] };

  constructor(
    private video: Mp4Video | null,
    private audio: Mp4Audio | null,
  ) {}

  add(c: MuxChunk): void {
    this.queue[c.track].push(c);
    this.drain(false);
  }

  private drain(all: boolean): void {
    const v = this.queue.video;
    const a = this.queue.audio;
    for (;;) {
      const nv = v[0];
      const na = a[0];
      if (!nv && !na) return;
      if (!all && this.video && this.audio && (!nv || !na)) return;
      const c = !na || (nv && nv.time <= na.time) ? v.shift()! : a.shift()!;
      const scale = c.track === 'video' ? VIDEO_SCALE : this.audio!.rate;
      this.samples[c.track].push({ size: c.data.length, time: Math.round((c.time / 1e6) * scale), key: c.key, offset: this.bytes });
      this.parts.push(c.data as BlobPart);
      this.bytes += c.data.length;
    }
  }

  /** the finished file; `duration` in microseconds */
  finish(duration?: number): Blob {
    this.drain(true);
    const ftyp = box('ftyp', fourcc('isom'), u32(512), fourcc('isom'), fourcc('iso2'), fourcc(this.video?.codec === 'avc1' ? 'avc1' : 'iso6'), fourcc('mp41'));
    const big = ftyp.length + 16 + this.bytes > 0xffffffff;
    // mdat header: 16 bytes (64-bit size) when it needs it, else 8
    const mdatHead = big ? cat([u32(1), fourcc('mdat'), u64(16 + this.bytes)]) : cat([u32(8 + this.bytes), fourcc('mdat')]);
    const dataStart = ftyp.length + mdatHead.length;
    const durUs = duration ?? this.lastTime();
    const traks: Uint8Array[] = [];
    let id = 1;
    if (this.video && this.samples.video.length) traks.push(this.trak(id++, 'video', durUs, dataStart, big));
    if (this.audio && this.samples.audio.length) traks.push(this.trak(id++, 'audio', durUs, dataStart, big));
    const ms = Math.round(durUs / 1000);
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, new Array(24).fill(0), u32(id));
    const moov = box('moov', mvhd, ...traks);
    return new Blob([ftyp as BlobPart, mdatHead as BlobPart, ...this.parts, moov as BlobPart], { type: this.video ? 'video/mp4' : 'audio/mp4' });
  }

  private lastTime(): number {
    const v = this.samples.video.at(-1);
    const a = this.samples.audio.at(-1);
    return Math.max(v ? (v.time / VIDEO_SCALE) * 1e6 : 0, a && this.audio ? (a.time / this.audio.rate) * 1e6 : 0);
  }

  private trak(id: number, kind: 'video' | 'audio', durUs: number, dataStart: number, big: boolean): Uint8Array {
    const s = this.samples[kind];
    const scale = kind === 'video' ? VIDEO_SCALE : this.audio!.rate;
    const total = Math.round((durUs / 1e6) * scale);
    // each sample lasts until the next; the last one until the end
    const deltas = s.map((x, i) => Math.max(1, (i + 1 < s.length ? s[i + 1].time : Math.max(total, x.time + 1)) - x.time));
    const stts: number[] = [];
    let runs = 0;
    for (let i = 0; i < deltas.length; ) {
      let j = i;
      while (j < deltas.length && deltas[j] === deltas[i]) j++;
      stts.push(...u32(j - i), ...u32(deltas[i]));
      runs++;
      i = j;
    }
    // chunks: runs of this track's samples that sit next to each other in the mdat
    const chunkOffsets: number[] = [];
    const stsc: number[] = [];
    let lastPer = -1;
    for (let i = 0; i < s.length; ) {
      let j = i + 1;
      while (j < s.length && s[j].offset === s[j - 1].offset + s[j - 1].size) j++;
      chunkOffsets.push(dataStart + s[i].offset);
      if (j - i !== lastPer) {
        stsc.push(...u32(chunkOffsets.length), ...u32(j - i), ...u32(1));
        lastPer = j - i;
      }
      i = j;
    }
    const co = big ? full('co64', 0, 0, u32(chunkOffsets.length), ...chunkOffsets.map(u64)) : full('stco', 0, 0, u32(chunkOffsets.length), ...chunkOffsets.map(u32));
    const stsz = full('stsz', 0, 0, u32(0), u32(s.length), ...s.map((x) => u32(x.size)));
    const parts = [this.stsd(kind), full('stts', 0, 0, u32(runs), stts), full('stsc', 0, 0, u32(stsc.length / 12), stsc), stsz, co];
    if (kind === 'video') {
      const keys = s.flatMap((x, i) => (x.key ? [i + 1] : []));
      if (keys.length < s.length) parts.splice(2, 0, full('stss', 0, 0, u32(keys.length), ...keys.map(u32)));
    }
    const ms = Math.round(durUs / 1000);
    const v = kind === 'video' ? this.video! : null;
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(ms), u32(0), u32(0), u16(0), u16(0), u16(v ? 0 : 0x0100), u16(0), MATRIX, u32((v?.width ?? 0) << 16), u32((v?.height ?? 0) << 16));
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(total), u16(0x55c4), u16(0));
    const hdlr = full('hdlr', 0, 0, u32(0), fourcc(v ? 'vide' : 'soun'), u32(0), u32(0), u32(0), fourcc(v ? 'Video' : 'Sound'), [0]);
    const xmhd = v ? full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)) : full('smhd', 0, 0, u16(0), u16(0));
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    const minf = box('minf', xmhd, dinf, box('stbl', ...parts));
    return box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
  }

  private stsd(kind: 'video' | 'audio'): Uint8Array {
    if (kind === 'video') {
      const v = this.video!;
      const visual = [new Array(6).fill(0), u16(1), new Array(16).fill(0), u16(v.width), u16(v.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), new Array(32).fill(0), u16(0x0018), u16(0xffff)];
      const entry =
        v.codec === 'avc1'
          ? box('avc1', ...visual, box('avcC', v.description ?? new Uint8Array()))
          : // vpcC: profile 0, level 4.0, 8-bit 4:2:0, BT.709, limited range
            box('vp09', ...visual, full('vpcC', 1, 0, u8(0), u8(40), u8((8 << 4) | (1 << 1) | 0), u8(1), u8(1), u8(1), u16(0)));
      return full('stsd', 0, 0, u32(1), entry);
    }
    const a = this.audio!;
    const audio = [new Array(6).fill(0), u16(1), u32(0), u32(0), u16(a.channels), u16(16), u16(0), u16(0), u32(a.rate << 16)];
    let entry: Uint8Array;
    if (a.codec === 'mp4a') {
      const asc = a.description ?? aacConfig(a.rate, a.channels);
      const rate = a.bitrate ?? 256_000;
      const dsi = [0x05, asc.length, ...asc];
      const dcd = [0x04, 13 + dsi.length, 0x40, 0x15, 0, 0, 0, ...u32(rate), ...u32(rate), ...dsi];
      const esd = [0x03, 3 + dcd.length + 3, ...u16(2), 0, ...dcd, 0x06, 1, 0x02];
      entry = box('mp4a', ...audio, full('esds', 0, 0, esd));
    } else {
      // dOps (Opus in ISOBMFF): version 0, channels, pre-skip, input rate, gain, mapping family 0
      entry = box('Opus', ...audio, box('dOps', u8(0), u8(a.channels), u16(312), u32(a.rate), u16(0), u8(0)));
    }
    return full('stsd', 0, 0, u32(1), entry);
  }
}

/** AAC-LC AudioSpecificConfig, for when the encoder doesn't give one */
export function aacConfig(rate: number, channels: number): Uint8Array {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
  const fi = Math.max(0, rates.indexOf(rate));
  return new Uint8Array([(2 << 3) | (fi >> 1), ((fi & 1) << 7) | (channels << 3)]);
}
