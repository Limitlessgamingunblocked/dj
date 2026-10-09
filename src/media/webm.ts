/*
 * A small WebM (Matroska) writer for encoded video and audio chunks
 * (VP8/VP9 + Opus from WebCodecs). Blocks are kept in timestamp order across
 * tracks, a new cluster starts on every video keyframe, and the file gets a
 * seek head, a duration and cues, so players can seek in it.
 *
 * Data piles up as Blob parts (the browser may keep big ones on disk); the
 * header is written last, once every size is known.
 */

export interface MuxVideo {
  codec: 'V_VP8' | 'V_VP9' | 'V_MPEG4/ISO/AVC';
  width: number;
  height: number;
  /** codec private data (avcC for H.264) */
  description?: Uint8Array;
}

export interface MuxAudio {
  codec: 'A_OPUS';
  rate: number;
  channels: number;
  /** OpusHead; built when the encoder gives none */
  description?: Uint8Array;
}

export interface MuxChunk {
  track: 'video' | 'audio';
  /** microseconds from the start */
  time: number;
  key: boolean;
  data: Uint8Array;
}

/* ---------------------------- EBML basics ---------------------------- */

const ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  SeekPreRoll: 0x56bb,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
} as const;

function idBytes(id: number): number[] {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return out;
}

/** an EBML size: 8 bytes always (simple, and big enough for anything) */
function size8(n: number): number[] {
  const out = [0x01];
  for (let i = 6; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 0xff);
  return out;
}

/** the shortest size field for small elements */
function sizeVar(n: number): number[] {
  if (n < 0x7f) return [0x80 | n];
  if (n < 0x3fff) return [0x40 | (n >> 8), n & 0xff];
  if (n < 0x1fffff) return [0x20 | (n >> 16), (n >> 8) & 0xff, n & 0xff];
  return size8(n);
}

function uintBytes(v: number): number[] {
  const out: number[] = [];
  let x = Math.max(0, Math.floor(v));
  do {
    out.unshift(x & 0xff);
    x = Math.floor(x / 256);
  } while (x > 0);
  return out;
}

type El = number[];
const el = (id: number, body: number[] | Uint8Array): El => [...idBytes(id), ...sizeVar(body.length), ...body];
const uint = (id: number, v: number) => el(id, uintBytes(v));
const str = (id: number, s: string) => el(id, [...s].map((c) => c.charCodeAt(0) & 0x7f));
function float(id: number, v: number): El {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return el(id, [...b]);
}
const master = (id: number, ...kids: El[]) => el(id, kids.flat());

/** OpusHead (RFC 7845) for the codec private data */
export function opusHead(channels: number, rate: number, preSkip = 312): Uint8Array {
  const b = new Uint8Array(19);
  const v = new DataView(b.buffer);
  b.set([..."OpusHead"].map((c) => c.charCodeAt(0)));
  b[8] = 1;
  b[9] = channels;
  v.setUint16(10, preSkip, true);
  v.setUint32(12, rate, true);
  v.setInt16(16, 0, true);
  b[18] = 0;
  return b;
}

/* ------------------------------ writer ------------------------------ */

export class WebmWriter {
  private parts: BlobPart[] = [];
  /** bytes of cluster data written so far */
  private bytes = 0;
  private cues: { time: number; pos: number }[] = [];
  private queue: { video: MuxChunk[]; audio: MuxChunk[] } = { video: [], audio: [] };
  private cluster: { time: number; blocks: Uint8Array[]; size: number } | null = null;
  private lastTime = 0;

  constructor(
    private video: MuxVideo | null,
    private audio: MuxAudio | null,
  ) {}

  add(c: MuxChunk): void {
    const q = this.queue[c.track];
    q.push(c);
    this.drain(false);
  }

  /** write out blocks in time order, as far as both tracks have got */
  private drain(all: boolean): void {
    const v = this.queue.video;
    const a = this.queue.audio;
    for (;;) {
      const nv = v[0];
      const na = a[0];
      if (!nv && !na) return;
      if (!all) {
        // wait until the other track has caught up (if there is one)
        if (this.video && this.audio && (!nv || !na)) return;
      }
      const take = !na || (nv && nv.time <= na.time) ? v.shift()! : a.shift()!;
      this.block(take);
    }
  }

  private block(c: MuxChunk): void {
    const ms = Math.round(c.time / 1000);
    const startNew = !this.cluster || (c.track === 'video' && c.key) || ms - this.cluster.time > 30_000 || (!this.video && ms - this.cluster.time > 5_000);
    if (startNew) {
      this.closeCluster();
      this.cluster = { time: ms, blocks: [], size: 0 };
      if (c.track === 'video' && c.key) this.cues.push({ time: ms, pos: this.bytes });
      else if (!this.video) this.cues.push({ time: ms, pos: this.bytes });
    }
    const cl = this.cluster!;
    const rel = Math.max(-32768, Math.min(32767, ms - cl.time));
    const trackNo = c.track === 'video' || !this.video ? 1 : 2;
    const head = [0x80 | trackNo, (rel >> 8) & 0xff, rel & 0xff, c.key ? 0x80 : 0];
    const body = new Uint8Array(head.length + c.data.length);
    body.set(head);
    body.set(c.data, head.length);
    const blk = new Uint8Array([...idBytes(ID.SimpleBlock), ...size8(body.length)]);
    cl.blocks.push(blk, body);
    cl.size += blk.length + body.length;
    this.lastTime = Math.max(this.lastTime, c.time);
  }

  private closeCluster(): void {
    const cl = this.cluster;
    if (!cl) return;
    const tc = new Uint8Array(uint(ID.Timecode, cl.time));
    const head = new Uint8Array([...idBytes(ID.Cluster), ...size8(tc.length + cl.size)]);
    this.parts.push(head, tc, ...(cl.blocks as BlobPart[]));
    this.bytes += head.length + tc.length + cl.size;
    this.cluster = null;
  }

  /** the finished file; `duration` in microseconds (defaults to the last block) */
  finish(duration = this.lastTime): Blob {
    this.drain(true);
    this.closeCluster();
    const tracks: El[] = [];
    if (this.video) {
      const v = this.video;
      tracks.push(
        master(
          ID.TrackEntry,
          uint(ID.TrackNumber, 1),
          uint(ID.TrackUID, 1),
          uint(ID.TrackType, 1),
          str(ID.CodecID, v.codec),
          ...(v.description ? [el(ID.CodecPrivate, v.description)] : []),
          master(ID.Video, uint(ID.PixelWidth, v.width), uint(ID.PixelHeight, v.height)),
        ),
      );
    }
    if (this.audio) {
      const a = this.audio;
      tracks.push(
        master(
          ID.TrackEntry,
          uint(ID.TrackNumber, this.video ? 2 : 1),
          uint(ID.TrackUID, 2),
          uint(ID.TrackType, 2),
          str(ID.CodecID, a.codec),
          el(ID.CodecPrivate, a.description ?? opusHead(a.channels, a.rate)),
          uint(ID.CodecDelay, 6_500_000),
          uint(ID.SeekPreRoll, 80_000_000),
          master(ID.Audio, float(ID.SamplingFrequency, a.rate), uint(ID.Channels, a.channels)),
        ),
      );
    }
    const info = master(ID.Info, uint(ID.TimecodeScale, 1_000_000), float(ID.Duration, duration / 1000), str(ID.MuxingApp, 'DeckHouse'), str(ID.WritingApp, 'DeckHouse DJ'));
    const tracksEl = master(ID.Tracks, ...tracks);
    // the seek head has a fixed size (positions are 8-byte numbers), so it can point past itself
    const seekEntry = (id: number, pos: number) => master(ID.Seek, el(ID.SeekID, idBytes(id)), el(ID.SeekPosition, [...size8(pos)].slice(1)));
    const seekLen = master(ID.SeekHead, seekEntry(ID.Info, 0), seekEntry(ID.Tracks, 0), seekEntry(ID.Cues, 0)).length;
    const infoPos = seekLen;
    const tracksPos = infoPos + info.length;
    const clustersPos = tracksPos + tracksEl.length;
    const cuesPos = clustersPos + this.bytes;
    const seek = master(ID.SeekHead, seekEntry(ID.Info, infoPos), seekEntry(ID.Tracks, tracksPos), seekEntry(ID.Cues, cuesPos));
    const cues = master(ID.Cues, ...this.cues.map((c) => master(ID.CuePoint, uint(ID.CueTime, c.time), master(ID.CueTrackPositions, uint(ID.CueTrack, 1), uint(ID.CueClusterPosition, clustersPos + c.pos)))));
    const ebml = master(
      ID.EBML,
      uint(ID.EBMLVersion, 1),
      uint(ID.EBMLReadVersion, 1),
      uint(ID.EBMLMaxIDLength, 4),
      uint(ID.EBMLMaxSizeLength, 8),
      str(ID.DocType, 'webm'),
      uint(ID.DocTypeVersion, 4),
      uint(ID.DocTypeReadVersion, 2),
    );
    const segBody = seek.length + info.length + tracksEl.length + this.bytes + cues.length;
    const segHead = [...idBytes(ID.Segment), ...size8(segBody)];
    const head = new Uint8Array([...ebml, ...segHead, ...seek, ...info, ...tracksEl]);
    return new Blob([head, ...this.parts, new Uint8Array(cues)], { type: this.video ? 'video/webm' : 'audio/webm' });
  }
}
