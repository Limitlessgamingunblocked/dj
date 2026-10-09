import { describe, expect, it } from 'vitest';
import { Mp4Writer, aacConfig } from '../src/media/mp4';
import { WebmWriter, type MuxChunk } from '../src/media/webm';

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/* ------------------------- a tiny EBML reader ------------------------- */

function vint(b: Uint8Array, o: number, keepMarker: boolean): [number, number] {
  const first = b[o];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  let v = keepMarker ? first : first & (0xff >> len);
  for (let i = 1; i < len; i++) v = v * 256 + b[o + i];
  return [v, len];
}

interface Ebml {
  id: number;
  start: number;
  size: number;
  body: number;
}

function children(b: Uint8Array, from: number, to: number): Ebml[] {
  const out: Ebml[] = [];
  let o = from;
  while (o < to) {
    const [id, il] = vint(b, o, true);
    const [size, sl] = vint(b, o + il, false);
    out.push({ id, start: o, size, body: o + il + sl });
    o += il + sl + size;
  }
  return out;
}

const uintAt = (b: Uint8Array, e: Ebml) => {
  let v = 0;
  for (let i = 0; i < e.size; i++) v = v * 256 + b[e.body + i];
  return v;
};

/* --------------------------- an MP4 reader --------------------------- */

interface Box {
  type: string;
  start: number;
  size: number;
  body: number;
}

function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  const v = new DataView(b.buffer, b.byteOffset);
  let o = from;
  while (o + 8 <= to) {
    let size = v.getUint32(o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    let head = 8;
    if (size === 1) {
      size = v.getUint32(o + 8) * 2 ** 32 + v.getUint32(o + 12);
      head = 16;
    }
    out.push({ type, start: o, size, body: o + head });
    o += size;
  }
  return out;
}

const find = (b: Uint8Array, parent: Box, path: string[]): Box => {
  let cur = parent;
  for (const t of path) {
    // sample entries and full boxes have headers before their children
    const skip = t === 'avcC' || t === 'vpcC' ? 78 : t === 'esds' || t === 'dOps' ? 28 : ['stsd'].includes(cur.type) ? 8 : ['dref'].includes(cur.type) ? 8 : 0;
    const kid = boxes(b, cur.body + skip, cur.start + cur.size).find((x) => x.type === t);
    if (!kid) throw new Error(`no ${t} in ${cur.type}`);
    cur = kid;
  }
  return cur;
};

/* ------------------------------ tests ------------------------------ */

function chunks(): MuxChunk[] {
  const out: MuxChunk[] = [];
  // 6 s of video at 30 fps (a keyframe every 2 s) and audio in 20 ms packets, arriving interleaved but not sorted
  for (let i = 0; i < 180; i++) out.push({ track: 'video', time: Math.round((i * 1e6) / 30), key: i % 60 === 0, data: new Uint8Array(100 + (i % 7)).fill(i & 0xff) });
  for (let i = 0; i < 300; i++) out.push({ track: 'audio', time: i * 20_000, key: true, data: new Uint8Array(40).fill(7) });
  return out.sort((a, b) => a.time - b.time + (a.track === 'audio' ? 3000 : 0) - (b.track === 'audio' ? 3000 : 0));
}

describe('WebM writer', () => {
  it('writes a well-formed file: header, info, tracks, clusters on keyframes, cues', async () => {
    const w = new WebmWriter({ codec: 'V_VP9', width: 1280, height: 720 }, { codec: 'A_OPUS', rate: 48000, channels: 2 });
    for (const c of chunks()) w.add(c);
    const b = await bytes(w.finish(6e6));
    const top = children(b, 0, b.length);
    expect(top.map((e) => e.id)).toEqual([0x1a45dfa3, 0x18538067]);
    const seg = top[1];
    expect(seg.body + seg.size).toBe(b.length);
    const kids = children(b, seg.body, seg.body + seg.size);
    const ids = kids.map((e) => e.id);
    expect(ids[0]).toBe(0x114d9b74);
    expect(ids[1]).toBe(0x1549a966);
    expect(ids[2]).toBe(0x1654ae6b);
    expect(ids.at(-1)).toBe(0x1c53bb6b);
    const clusters = kids.filter((e) => e.id === 0x1f43b675);
    expect(clusters).toHaveLength(3);
    // blocks inside each cluster are in time order; every block carries track 1 (video) or 2 (audio)
    let blocks = 0;
    for (const cl of clusters) {
      const ks = children(b, cl.body, cl.body + cl.size);
      expect(ks[0].id).toBe(0xe7);
      let last = -1;
      for (const k of ks.slice(1)) {
        expect(k.id).toBe(0xa3);
        const track = b[k.body] & 0x7f;
        expect([1, 2]).toContain(track);
        const rel = (b[k.body + 1] << 8) | b[k.body + 2];
        expect(rel).toBeGreaterThanOrEqual(last);
        last = rel;
        blocks++;
      }
    }
    expect(blocks).toBe(480);
    // the seek head points at the right places, and so do the cues
    const seeks = children(b, kids[0].body, kids[0].body + kids[0].size);
    for (const s of seeks) {
      const [sid, pos] = children(b, s.body, s.body + s.size);
      const target = kids.find((k) => k.start - seg.body === uintAt(b, pos));
      expect(target).toBeTruthy();
      let want = 0;
      for (let i = 0; i < sid.size; i++) want = want * 256 + b[sid.body + i];
      expect(target!.id).toBe(want);
    }
    const cues = children(b, kids.at(-1)!.body, kids.at(-1)!.body + kids.at(-1)!.size);
    expect(cues).toHaveLength(3);
    const pos = children(b, cues[1].body, cues[1].body + cues[1].size)[1];
    const clusterPos = children(b, pos.body, pos.body + pos.size)[1];
    expect(clusters[1].start - seg.body).toBe(uintAt(b, clusterPos));
  });
});

describe('MP4 writer', () => {
  it('writes ftyp, mdat and a moov whose sample tables point at the data', async () => {
    const w = new Mp4Writer({ codec: 'vp09', width: 1280, height: 720 }, { codec: 'Opus', rate: 48000, channels: 2 });
    const list = chunks();
    for (const c of list) w.add(c);
    const b = await bytes(w.finish(6e6));
    const top = boxes(b, 0, b.length);
    expect(top.map((x) => x.type)).toEqual(['ftyp', 'mdat', 'moov']);
    expect(top.reduce((s, x) => s + x.size, 0)).toBe(b.length);
    const moov = top[2];
    const traks = boxes(b, moov.body, moov.start + moov.size).filter((x) => x.type === 'trak');
    expect(traks).toHaveLength(2);
    const v = new DataView(b.buffer);
    for (const [i, trak] of traks.entries()) {
      const stbl = find(b, trak, ['mdia', 'minf', 'stbl']);
      const stsz = find(b, stbl, ['stsz']);
      const count = v.getUint32(stsz.body + 8);
      expect(count).toBe(i === 0 ? 180 : 300);
      // the first sample's offset lands on its data: video frames are filled with their index
      const stco = find(b, stbl, ['stco']);
      const first = v.getUint32(stco.body + 8);
      if (i === 0) expect(b[first]).toBe(0);
      else expect(b[first]).toBe(7);
      // sample sizes add up across chunks: walk stsc + stco and check every video frame's first byte
      if (i === 0) {
        const nChunks = v.getUint32(stco.body + 4);
        const stsc = find(b, stbl, ['stsc']);
        const entries = v.getUint32(stsc.body + 4);
        const per: number[] = [];
        for (let e = 0; e < entries; e++) {
          const fc = v.getUint32(stsc.body + 8 + e * 12);
          const spc = v.getUint32(stsc.body + 12 + e * 12);
          const next = e + 1 < entries ? v.getUint32(stsc.body + 8 + (e + 1) * 12) : nChunks + 1;
          for (let c = fc; c < next; c++) per.push(spc);
        }
        let sample = 0;
        for (let c = 0; c < nChunks; c++) {
          let o = v.getUint32(stco.body + 8 + c * 4);
          for (let k = 0; k < per[c]; k++) {
            expect(b[o]).toBe(sample & 0xff);
            o += v.getUint32(stsz.body + 12 + sample * 4);
            sample++;
          }
        }
        expect(sample).toBe(180);
        // keyframes every 60 frames
        const stss = find(b, stbl, ['stss']);
        expect(v.getUint32(stss.body + 4)).toBe(3);
        expect(v.getUint32(stss.body + 12)).toBe(61);
      }
    }
    // H.264 + AAC sample entries carry their configs
    const w2 = new Mp4Writer({ codec: 'avc1', width: 640, height: 360, description: new Uint8Array([1, 0x64, 0, 0x1f, 0xff]) }, { codec: 'mp4a', rate: 48000, channels: 2 });
    w2.add({ track: 'video', time: 0, key: true, data: new Uint8Array(10) });
    w2.add({ track: 'audio', time: 0, key: true, data: new Uint8Array(10) });
    const b2 = await bytes(w2.finish(1e6));
    const moov2 = boxes(b2, 0, b2.length)[2];
    const traks2 = boxes(b2, moov2.body, moov2.start + moov2.size).filter((x) => x.type === 'trak');
    const avcC = find(b2, traks2[0], ['mdia', 'minf', 'stbl', 'stsd', 'avc1', 'avcC']);
    expect([...b2.slice(avcC.body, avcC.body + 5)]).toEqual([1, 0x64, 0, 0x1f, 0xff]);
    const esds = find(b2, traks2[1], ['mdia', 'minf', 'stbl', 'stsd', 'mp4a', 'esds']);
    const asc = aacConfig(48000, 2);
    const raw = [...b2.slice(esds.body, esds.start + esds.size)];
    const at = raw.findIndex((x, i) => x === 0x05 && raw[i + 1] === 2);
    expect(raw.slice(at + 2, at + 4)).toEqual([...asc]);
  });

  it('builds the AAC-LC config for 48 kHz stereo', () => {
    expect([...aacConfig(48000, 2)]).toEqual([0x11, 0x90]);
  });
});

describe('reading our files back', () => {
  it('WebM: every video frame comes back with its time and keyframe flag', async () => {
    const { demuxWebm } = await import('../src/media/demux');
    const w = new WebmWriter({ codec: 'V_VP9', width: 1280, height: 720 }, { codec: 'A_OPUS', rate: 48000, channels: 2 });
    const list = chunks();
    for (const c of list) w.add(c);
    const d = demuxWebm(await bytes(w.finish(6e6)))!;
    expect(d.codec).toBe('vp09.00.41.08');
    expect([d.width, d.height]).toEqual([1280, 720]);
    expect(d.chunks).toHaveLength(180);
    const vids = list.filter((c) => c.track === 'video').sort((a, b) => a.time - b.time);
    d.chunks.forEach((c, i) => {
      expect(c.t).toBeCloseTo(Math.round(vids[i].time / 1000) / 1000, 6);
      expect(c.key).toBe(vids[i].key);
      expect(c.data[0]).toBe(i & 0xff);
      expect(c.data.length).toBe(vids[i].data.length);
    });
  });

  it('MP4: H.264 frames come back with the avcC and a codec string from it', async () => {
    const { demuxMp4 } = await import('../src/media/demux');
    const avcC = new Uint8Array([1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, 0]);
    const w = new Mp4Writer({ codec: 'avc1', width: 1280, height: 720, description: avcC }, { codec: 'mp4a', rate: 48000, channels: 2 });
    const list = chunks();
    for (const c of list) w.add(c);
    const d = demuxMp4(await bytes(w.finish(6e6)))!;
    expect(d.codec).toBe('avc1.640028');
    expect([...d.description!]).toEqual([...avcC]);
    expect(d.chunks).toHaveLength(180);
    expect(d.chunks.filter((c) => c.key)).toHaveLength(3);
    d.chunks.forEach((c, i) => {
      expect(c.data[0]).toBe(i & 0xff);
      expect(c.t).toBeCloseTo(i / 30, 3);
    });
  });
});
