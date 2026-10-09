/*
 * Reading back the videos we wrote (media/webm.ts, media/mp4.ts), so a saved
 * set can be cut and re-encoded (clips, the trim editor): the video track's
 * encoded frames with their times and keyframes, and what a decoder needs.
 * Files from the MediaRecorder fallback (unknown sizes) aren't supported:
 * those return null and the trim editor exports audio only.
 */

export interface DemuxedVideo {
  codec: string;
  width: number;
  height: number;
  /** avcC for H.264 */
  description?: Uint8Array;
  chunks: { t: number; key: boolean; data: Uint8Array }[];
}

/* ------------------------------ WebM ------------------------------ */

function vint(b: Uint8Array, o: number, keepMarker: boolean): [number, number] {
  const first = b[o];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8) throw new Error('bad EBML');
  let v = keepMarker ? first : first & (0xff >> len);
  let allOnes = (v & ((1 << (8 - len)) - 1)) === (1 << (8 - len)) - 1;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[o + i];
    if (b[o + i] !== 0xff) allOnes = false;
  }
  if (!keepMarker && allOnes) throw new Error('unknown-size element');
  return [v, len];
}

interface El {
  id: number;
  body: number;
  end: number;
}

function* els(b: Uint8Array, from: number, to: number): Generator<El> {
  let o = from;
  while (o < to) {
    const [id, il] = vint(b, o, true);
    const [size, sl] = vint(b, o + il, false);
    const body = o + il + sl;
    yield { id, body, end: body + size };
    o = body + size;
  }
}

const uintOf = (b: Uint8Array, e: El) => {
  let v = 0;
  for (let i = e.body; i < e.end; i++) v = v * 256 + b[i];
  return v;
};
const strOf = (b: Uint8Array, e: El) => String.fromCharCode(...b.subarray(e.body, e.end));

export function demuxWebm(b: Uint8Array): DemuxedVideo | null {
  try {
    const top = [...els(b, 0, b.length)];
    const seg = top.find((e) => e.id === 0x18538067);
    if (!seg) return null;
    let videoTrack = -1;
    let codec = '';
    let width = 0;
    let height = 0;
    let scale = 1_000_000;
    const chunks: DemuxedVideo['chunks'] = [];
    for (const e of els(b, seg.body, seg.end)) {
      if (e.id === 0x1549a966) for (const k of els(b, e.body, e.end)) if (k.id === 0x2ad7b1) scale = uintOf(b, k);
      if (e.id === 0x1654ae6b) {
        for (const te of els(b, e.body, e.end)) {
          if (te.id !== 0xae) continue;
          let num = 0;
          let type = 0;
          let cid = '';
          let w = 0;
          let h = 0;
          for (const k of els(b, te.body, te.end)) {
            if (k.id === 0xd7) num = uintOf(b, k);
            if (k.id === 0x83) type = uintOf(b, k);
            if (k.id === 0x86) cid = strOf(b, k);
            if (k.id === 0xe0) for (const v of els(b, k.body, k.end)) (v.id === 0xb0 ? (w = uintOf(b, v)) : v.id === 0xba ? (h = uintOf(b, v)) : 0);
          }
          if (type === 1 && videoTrack < 0) {
            videoTrack = num;
            codec = cid === 'V_VP9' ? 'vp09.00.41.08' : cid === 'V_VP8' ? 'vp8' : '';
            width = w;
            height = h;
          }
        }
      }
      if (e.id === 0x1f43b675) {
        let tc = 0;
        for (const k of els(b, e.body, e.end)) {
          if (k.id === 0xe7) tc = uintOf(b, k);
          if (k.id === 0xa3) {
            const [track, tl] = vint(b, k.body, false);
            if (track !== videoTrack) continue;
            let rel = (b[k.body + tl] << 8) | b[k.body + tl + 1];
            if (rel & 0x8000) rel -= 0x10000;
            const flags = b[k.body + tl + 2];
            chunks.push({ t: ((tc + rel) * scale) / 1e9, key: !!(flags & 0x80), data: b.slice(k.body + tl + 3, k.end) });
          }
        }
      }
    }
    if (!codec || !chunks.length) return null;
    return { codec, width, height, chunks };
  } catch {
    return null;
  }
}

/* ------------------------------ MP4 ------------------------------ */

interface Box {
  type: string;
  body: number;
  end: number;
}

function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = from;
  while (o + 8 <= to) {
    let size = v.getUint32(o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    let head = 8;
    if (size === 1) {
      size = v.getUint32(o + 8) * 2 ** 32 + v.getUint32(o + 12);
      head = 16;
    } else if (size === 0) size = to - o;
    if (size < head) return;
    yield { type, body: o + head, end: o + size };
    o += size;
  }
}

const child = (b: Uint8Array, p: Box, type: string, skip = 0) => {
  for (const x of boxes(b, p.body + skip, p.end)) if (x.type === type) return x;
  return null;
};

export function demuxMp4(b: Uint8Array): DemuxedVideo | null {
  try {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const moov = [...boxes(b, 0, b.length)].find((x) => x.type === 'moov');
    if (!moov) return null;
    for (const trak of boxes(b, moov.body, moov.end)) {
      if (trak.type !== 'trak') continue;
      const mdia = child(b, trak, 'mdia');
      const hdlr = mdia && child(b, mdia, 'hdlr');
      if (!mdia || !hdlr || String.fromCharCode(...b.subarray(hdlr.body + 8, hdlr.body + 12)) !== 'vide') continue;
      const mdhd = child(b, mdia, 'mdhd')!;
      const scale = v.getUint32(mdhd.body + (b[mdhd.body] === 1 ? 20 : 12));
      const stbl = child(b, child(b, mdia, 'minf')!, 'stbl')!;
      const stsd = child(b, stbl, 'stsd')!;
      const entry = [...boxes(b, stsd.body + 8, stsd.end)][0];
      const width = v.getUint16(entry.body + 24);
      const height = v.getUint16(entry.body + 26);
      let codec = '';
      let description: Uint8Array | undefined;
      if (entry.type === 'avc1' || entry.type === 'avc3') {
        const avcC = child(b, entry, 'avcC', 78);
        if (!avcC) return null;
        description = b.slice(avcC.body, avcC.end);
        const hex = (n: number) => n.toString(16).padStart(2, '0');
        codec = `avc1.${hex(description[1])}${hex(description[2])}${hex(description[3])}`;
      } else if (entry.type === 'vp09') codec = 'vp09.00.41.08';
      else return null;
      // sample tables
      const stsz = child(b, stbl, 'stsz')!;
      const fixed = v.getUint32(stsz.body + 4);
      const n = v.getUint32(stsz.body + 8);
      const sizes = Array.from({ length: n }, (_, i) => (fixed || v.getUint32(stsz.body + 12 + i * 4)));
      const stts = child(b, stbl, 'stts')!;
      const times: number[] = [];
      let t = 0;
      for (let e = 0, ec = v.getUint32(stts.body + 4); e < ec; e++) {
        const cnt = v.getUint32(stts.body + 8 + e * 8);
        const d = v.getUint32(stts.body + 12 + e * 8);
        for (let i = 0; i < cnt; i++, t += d) times.push(t / scale);
      }
      const stss = child(b, stbl, 'stss');
      const keys = new Set<number>();
      if (stss) for (let i = 0, c = v.getUint32(stss.body + 4); i < c; i++) keys.add(v.getUint32(stss.body + 8 + i * 4) - 1);
      const co = child(b, stbl, 'stco') ?? child(b, stbl, 'co64')!;
      const big = co.type === 'co64';
      const nChunks = v.getUint32(co.body + 4);
      const offs = Array.from({ length: nChunks }, (_, i) => (big ? v.getUint32(co.body + 8 + i * 8) * 2 ** 32 + v.getUint32(co.body + 12 + i * 8) : v.getUint32(co.body + 8 + i * 4)));
      const stsc = child(b, stbl, 'stsc')!;
      const ents = v.getUint32(stsc.body + 4);
      const per: number[] = [];
      for (let e = 0; e < ents; e++) {
        const first = v.getUint32(stsc.body + 8 + e * 12);
        const spc = v.getUint32(stsc.body + 12 + e * 12);
        const next = e + 1 < ents ? v.getUint32(stsc.body + 8 + (e + 1) * 12) : nChunks + 1;
        for (let c = first; c < next; c++) per[c - 1] = spc;
      }
      const chunks: DemuxedVideo['chunks'] = [];
      let s = 0;
      for (let c = 0; c < nChunks && s < n; c++) {
        let o = offs[c];
        for (let k = 0; k < (per[c] ?? 1) && s < n; k++, s++) {
          chunks.push({ t: times[s] ?? 0, key: stss ? keys.has(s) : true, data: b.slice(o, o + sizes[s]) });
          o += sizes[s];
        }
      }
      return { codec, width, height, description, chunks };
    }
    return null;
  } catch {
    return null;
  }
}

export async function demux(blob: Blob): Promise<DemuxedVideo | null> {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (b.length > 8 && String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') return demuxMp4(b);
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return demuxWebm(b);
  return null;
}
