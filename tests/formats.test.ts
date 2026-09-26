import { describe, expect, it } from 'vitest';
import { parseAiff, parseWav, sniffPcmFormat } from '../src/analysis/pcm';
import { readTags } from '../src/library/tags';
import { parseSearch } from '../src/library/Library';
import { xfaderGains } from '../src/audio/Mixer';
import { eqKnobToGain, faderToGain, gainToTrimKnob, trimKnobToGain } from '../src/audio/Channel';

function wav16(samples: number[][], rate: number): ArrayBuffer {
  const ch = samples.length;
  const n = samples[0].length;
  const buf = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) v.setInt16(44 + (i * ch + c) * 2, Math.round(samples[c][i] * 32767), true);
  return buf;
}

function aiff16(samples: number[][], rate: number): ArrayBuffer {
  const ch = samples.length;
  const n = samples[0].length;
  const dataBytes = n * ch * 2;
  const buf = new ArrayBuffer(12 + 26 + 16 + dataBytes);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'FORM');
  v.setUint32(4, buf.byteLength - 8);
  w(8, 'AIFF');
  w(12, 'COMM');
  v.setUint32(16, 18);
  v.setInt16(20, ch);
  v.setUint32(22, n);
  v.setInt16(26, 16);
  // 80-bit extended sample rate
  const e = Math.floor(Math.log2(rate));
  v.setUint16(28, 16383 + e);
  const mant = rate / Math.pow(2, e);
  const hi = Math.floor(mant * Math.pow(2, 31));
  v.setUint32(30, hi);
  v.setUint32(34, 0);
  w(38, 'SSND');
  v.setUint32(42, 8 + dataBytes);
  v.setUint32(46, 0);
  v.setUint32(50, 0);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) v.setInt16(54 + (i * ch + c) * 2, Math.round(samples[c][i] * 32767));
  return buf;
}

describe('PCM containers', () => {
  const L = [0, 0.5, -0.5, 0.25];
  const R = [0.1, -0.1, 0.2, -0.2];
  it('parses 16-bit stereo WAV', () => {
    const b = wav16([L, R], 44100);
    expect(sniffPcmFormat(b)).toBe('wav');
    const p = parseWav(b);
    expect(p.sampleRate).toBe(44100);
    expect(p.channels.length).toBe(2);
    expect(p.channels[0][1]).toBeCloseTo(0.5, 3);
    expect(p.channels[1][3]).toBeCloseTo(-0.2, 3);
  });
  it('parses 16-bit stereo AIFF with an 80-bit sample rate', () => {
    const b = aiff16([L, R], 48000);
    expect(sniffPcmFormat(b)).toBe('aiff');
    const p = parseAiff(b);
    expect(p.sampleRate).toBe(48000);
    expect(p.channels[0][2]).toBeCloseTo(-0.5, 3);
    expect(p.channels[1][0]).toBeCloseTo(0.1, 3);
  });
});

describe('tags', () => {
  it('reads ID3v2.3 text frames and falls back to the file name', () => {
    const frame = (id: string, text: string) => {
      const body = [0, ...[...text].map((c) => c.charCodeAt(0))];
      const size = body.length;
      return [...[...id].map((c) => c.charCodeAt(0)), (size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, 0, 0, ...body];
    };
    const frames = [...frame('TIT2', 'Night Drive'), ...frame('TPE1', 'Some Artist'), ...frame('TBPM', '126'), ...frame('TKEY', '8A')];
    const size = frames.length;
    const header = [0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127];
    const bytes = new Uint8Array([...header, ...frames, 0xff, 0xfb, 0x90, 0x00]);
    const t = readTags(bytes.buffer, 'x.mp3');
    expect(t.format).toBe('MP3');
    expect(t.title).toBe('Night Drive');
    expect(t.artist).toBe('Some Artist');
    expect(t.bpm).toBe(126);
    expect(t.key).toBe('8A');
    const f = readTags(new Uint8Array([0, 1, 2, 3]).buffer, '03 - DJ Name - Track Title.wav');
    expect(f.artist).toBe('DJ Name');
    expect(f.title).toBe('Track Title');
  });
});

describe('search syntax', () => {
  it('parses bpm ranges, keys and fields', () => {
    const q = parseSearch('deep bpm:120-126 key:Am artist:foo');
    expect(q.text).toBe('deep');
    expect(q.bpmMin).toBe(120);
    expect(q.bpmMax).toBe(126);
    expect([...(q.keys ?? [])]).toEqual(['8A']);
    expect(q.fields.artist).toBe('foo');
  });
});

describe('mixer curves', () => {
  it('crossfader: constant power when smooth, full both sides when sharp', () => {
    const [a, b] = xfaderGains(0.5, 0, false);
    expect(a * a + b * b).toBeCloseTo(1, 5);
    const [c, d] = xfaderGains(0.5, 1, false);
    expect(c).toBeCloseTo(1, 5);
    expect(d).toBeCloseTo(1, 5);
    expect(xfaderGains(0, 1, false)[1]).toBe(0);
    expect(xfaderGains(0, 1, true)[0]).toBe(0);
  });
  it('EQ: unity at centre, +6 dB max, full kill at zero', () => {
    expect(eqKnobToGain(0.5)).toBeCloseTo(1, 5);
    expect(20 * Math.log10(eqKnobToGain(1))).toBeCloseTo(6, 3);
    expect(eqKnobToGain(0)).toBe(0);
  });
  it('trim knob round-trips gain', () => {
    for (const g of [0.25, 0.5, 1, 2]) expect(trimKnobToGain(gainToTrimKnob(g))).toBeCloseTo(g, 3);
  });
  it('log fader is quieter than linear in the middle and unity at the top', () => {
    expect(faderToGain(1, 'log')).toBeCloseTo(1, 5);
    expect(faderToGain(0.5, 'log')).toBeLessThan(0.5);
    expect(faderToGain(0, 'log')).toBe(0);
  });
});
