import { describe, expect, it } from 'vitest';
import { Mp3Encoder } from '@breezystack/lamejs';
import { fade24, pack24, PcmRing, PcmTape, peaks24, read24, to16, unpack24, wavHeader } from '../src/audio/capture/pcm';
import { id3 } from '../src/audio/capture/tags';
import { RECORDINGS } from '../src/core/models';
import { memoryStore, SaveSystem } from '../src/core/SaveSystem';

const RATE = 48000;

/** a test signal: a slow sweep with a little noise, `n` frames, from frame `at` */
function signal(at: number, n: number): [Float32Array, Float32Array] {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (at + i) / RATE;
    l[i] = 0.7 * Math.sin(2 * Math.PI * (110 + 40 * t) * t);
    r[i] = 0.5 * Math.sin(2 * Math.PI * 220 * t + 1) + 0.01 * Math.sin(i * 12.9898);
  }
  return [l, r];
}

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
/** byte-for-byte equal */
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

describe('24-bit PCM', () => {
  it('packs and unpacks within one 24-bit step, and clamps', () => {
    const [l, r] = signal(0, 1000);
    l[3] = 1.7;
    r[4] = Number.NaN;
    const b = new Uint8Array(6000);
    pack24(l, r, b);
    const [l2, r2] = unpack24(b);
    for (let i = 0; i < 1000; i++) {
      if (i === 3 || i === 4) continue;
      expect(Math.abs(l2[i] - l[i])).toBeLessThan(1 / 8388607);
      expect(Math.abs(r2[i] - r[i])).toBeLessThan(1 / 8388607);
    }
    expect(read24(b, 3 * 6)).toBe(8388607);
    expect(r2[4]).toBe(0);
  });

  it('writes a valid 24-bit WAV header', () => {
    const h = wavHeader(48000, RATE);
    const v = new DataView(h.buffer);
    expect(String.fromCharCode(...h.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...h.slice(8, 16))).toBe('WAVEfmt ');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.getUint32(40, true)).toBe(48000 * 6);
    expect(v.getUint32(4, true)).toBe(36 + 48000 * 6);
  });

  it('fades in and out from silence to full', () => {
    const n = 4800;
    const l = new Float32Array(n).fill(0.5);
    const b = new Uint8Array(n * 6);
    pack24(l, l, b);
    fade24(b, n, 480, 480);
    expect(read24(b, 0)).toBe(0);
    expect(Math.abs(read24(b, 2400 * 6) - Math.round(0.5 * 8388607))).toBeLessThan(2);
    expect(Math.abs(read24(b, (n - 1) * 6))).toBeLessThan(Math.round(0.5 * 8388607) * 0.01);
  });

  it('dithers to 16-bit within a step', () => {
    const [l, r] = signal(0, 500);
    const b = new Uint8Array(3000);
    pack24(l, r, b);
    const [a] = to16(b, 500);
    for (let i = 0; i < 500; i++) expect(Math.abs(a[i] / 32768 - l[i])).toBeLessThan(3 / 32768);
  });

  it('draws a waveform overview', () => {
    const [l, r] = signal(0, 48000);
    const b = new Uint8Array(48000 * 6);
    pack24(l, r, b);
    const p = peaks24(b, 48000, 100);
    expect(p.length).toBe(200);
    expect(Math.max(...p)).toBeGreaterThan(0.4);
    expect(Math.min(...p)).toBeLessThan(-0.4);
  });
});

describe('replay buffer', () => {
  it('keeps exactly the last N seconds with fixed memory, and matches a manual recording bit for bit', async () => {
    const ring = new PcmRing(25, RATE);
    const tape = new PcmTape(RATE);
    const block = 4096;
    let at = 0;
    let peakAlloc = 0;
    // 70 seconds of audio through a 25-second buffer
    while (at < 70 * RATE) {
      const [l, r] = signal(at, block);
      at += block;
      ring.push(l, r, at / RATE);
      tape.push(l, r, at / RATE);
      peakAlloc = Math.max(peakAlloc, ring.bytesAllocated);
    }
    expect(ring.seconds).toBeCloseTo(25, 3);
    expect(peakAlloc).toBe(PcmRing.bytesFor(25, RATE));
    const got = ring.read();
    expect(got.frames).toBe(25 * RATE);
    expect(got.startTime).toBeCloseTo(at / RATE - 25, 6);
    // the same stretch, cut from the manual recording
    const all = await bytesOf(tape.data());
    expect(all.length).toBe(at * 6);
    const tail = all.subarray((at - 25 * RATE) * 6);
    expect(same(tail, got.bytes)).toBe(true);
    // and a window that ends a while ago (a clip around a marker)
    const mid = ring.read(5, 10);
    expect(mid.frames).toBe(5 * RATE);
    expect(same(all.subarray((at - 15 * RATE) * 6, (at - 10 * RATE) * 6), mid.bytes)).toBe(true);
  });

  it('gives what it has before it fills up', () => {
    const ring = new PcmRing(60, RATE);
    const [l, r] = signal(0, RATE * 3);
    ring.push(l, r, 3);
    expect(ring.read().frames).toBe(RATE * 3);
    expect(ring.read(1).frames).toBe(RATE);
    expect(ring.bytesAllocated).toBe(10 * RATE * 6);
  });

  it('a recording becomes a WAV file', async () => {
    const tape = new PcmTape(RATE);
    const [l, r] = signal(0, 9000);
    tape.push(l, r, 1);
    const wav = await bytesOf(tape.wav());
    expect(wav.length).toBe(44 + 9000 * 6);
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(9000 * 6);
  });
});

describe('MP3 export', () => {
  it('encodes 320 kbps MPEG-1 Layer III at 48 kHz', () => {
    const n = RATE;
    const [l, r] = signal(0, n);
    const b = new Uint8Array(n * 6);
    pack24(l, r, b);
    const [a, c] = to16(b, n);
    const enc = new Mp3Encoder(2, RATE, 320);
    const parts = [enc.encodeBuffer(a, c), enc.flush()];
    const mp3 = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) mp3.set(p, (o += p.length) - p.length);
    // frame sync, MPEG-1 Layer III, bitrate index 14 (320 kbps), 48 kHz
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1] & 0xfe).toBe(0xfa);
    expect(mp3[2] >> 4).toBe(14);
    expect((mp3[2] >> 2) & 3).toBe(1);
    expect(mp3.length * 8).toBeGreaterThan(300_000 * 0.9);
  });

  it('tags it: title, artist, venue, year and the cover', () => {
    const cover = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const t = id3({ title: 'Basement Club set', artist: 'Night Owl', album: 'Basement Club', date: '2026-10-09', cover });
    expect(String.fromCharCode(t[0], t[1], t[2])).toBe('ID3');
    expect(t[3]).toBe(3);
    const size = (t[6] << 21) | (t[7] << 14) | (t[8] << 7) | t[9];
    expect(size).toBe(t.length - 10);
    const ids: string[] = [];
    for (let o = 10; o < t.length; ) {
      const fid = String.fromCharCode(...t.slice(o, o + 4));
      const n = (t[o + 4] << 24) | (t[o + 5] << 16) | (t[o + 6] << 8) | t[o + 7];
      ids.push(fid);
      o += 10 + n;
    }
    expect(ids).toEqual(['TIT2', 'TPE1', 'TALB', 'TYER', 'APIC']);
    // the cover's bytes end the tag
    expect([...t.slice(t.length - cover.length)]).toEqual([...cover]);
  });
});

describe('recordings save', () => {
  it('moves a v1 save (with clips) to v2', () => {
    const kv = memoryStore();
    const saves = new SaveSystem(kv);
    kv.data.set('deckhouse-save:recordings', JSON.stringify({ format: 'deckhouse-save', kind: 'recordings', version: 1, savedAt: '2026-10-09T00:00:00Z', data: { items: [], clips: [{ id: 'c1', date: '2026-10-09T01:00:00Z', seconds: 30, aspect: '9:16' }] } }));
    const r = saves.load(RECORDINGS);
    expect(r.problem).toBeUndefined();
    expect(r.data.items).toHaveLength(1);
    expect(r.data.items[0]).toMatchObject({ id: 'c1', source: 'clip', kind: 'video', aspect: '9:16', seconds: 30, rate: 48000, files: {} });
  });
});
