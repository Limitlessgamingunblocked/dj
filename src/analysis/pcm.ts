/* WAV / AIFF / AIFC PCM parsers (run in workers; keep the file's sample rate). */
import type { PcmData } from '../core/types';

function fourcc(v: DataView, o: number): string {
  return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
}

export function sniffPcmFormat(bytes: ArrayBuffer): 'wav' | 'aiff' | null {
  if (bytes.byteLength < 12) return null;
  const v = new DataView(bytes);
  const a = fourcc(v, 0);
  const b = fourcc(v, 8);
  if ((a === 'RIFF' || a === 'RF64') && b === 'WAVE') return 'wav';
  if (a === 'FORM' && (b === 'AIFF' || b === 'AIFC')) return 'aiff';
  return null;
}

function readSamples(
  v: DataView,
  offset: number,
  frames: number,
  channels: number,
  bits: number,
  float: boolean,
  little: boolean,
): Float32Array[] {
  const outCh = Math.min(2, channels);
  const out = Array.from({ length: outCh }, () => new Float32Array(frames));
  const bytesPer = bits / 8;
  const frameBytes = bytesPer * channels;
  for (let i = 0; i < frames; i++) {
    const base = offset + i * frameBytes;
    for (let c = 0; c < outCh; c++) {
      const p = base + c * bytesPer;
      let s = 0;
      if (float) {
        s = bits === 64 ? v.getFloat64(p, little) : v.getFloat32(p, little);
      } else if (bits === 16) {
        s = v.getInt16(p, little) / 32768;
      } else if (bits === 24) {
        const b0 = v.getUint8(p);
        const b1 = v.getUint8(p + 1);
        const b2 = v.getUint8(p + 2);
        let x = little ? b0 | (b1 << 8) | (b2 << 16) : b2 | (b1 << 8) | (b0 << 16);
        if (x & 0x800000) x |= ~0xffffff;
        s = x / 8388608;
      } else if (bits === 32) {
        s = v.getInt32(p, little) / 2147483648;
      } else if (bits === 8) {
        s = little ? (v.getUint8(p) - 128) / 128 : v.getInt8(p) / 128;
      }
      out[c][i] = s;
    }
  }
  return out;
}

export function parseWav(bytes: ArrayBuffer): PcmData {
  const v = new DataView(bytes);
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (o + 8 <= v.byteLength) {
    const id = fourcc(v, o);
    let size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      const channels = v.getUint16(body + 2, true);
      const rate = v.getUint32(body + 4, true);
      const bits = v.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 40) format = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels, rate, bits };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV: data before fmt');
      if (fmt.format !== 1 && fmt.format !== 3) throw new Error(`WAV: unsupported format ${fmt.format}`);
      if (size === 0xffffffff || body + size > v.byteLength) size = v.byteLength - body;
      const frames = Math.floor(size / ((fmt.bits / 8) * fmt.channels));
      return { sampleRate: fmt.rate, channels: readSamples(v, body, frames, fmt.channels, fmt.bits, fmt.format === 3, true) };
    }
    o = body + size + (size & 1);
  }
  throw new Error('WAV: no data chunk');
}

function extended80(v: DataView, o: number): number {
  const exp = v.getUint16(o) & 0x7fff;
  const hi = v.getUint32(o + 2);
  const lo = v.getUint32(o + 6);
  if (exp === 0 && hi === 0 && lo === 0) return 0;
  return (hi * Math.pow(2, 32) + lo) * Math.pow(2, exp - 16383 - 63);
}

export function parseAiff(bytes: ArrayBuffer): PcmData {
  const v = new DataView(bytes);
  const aifc = fourcc(v, 8) === 'AIFC';
  let o = 12;
  let comm: { channels: number; frames: number; bits: number; rate: number; little: boolean; float: boolean } | null = null;
  while (o + 8 <= v.byteLength) {
    const id = fourcc(v, o);
    const size = v.getUint32(o + 4);
    const body = o + 8;
    if (id === 'COMM') {
      const channels = v.getInt16(body);
      const frames = v.getUint32(body + 2);
      const bits = v.getInt16(body + 6);
      const rate = extended80(v, body + 8);
      let little = false;
      let float = false;
      if (aifc && size >= 22) {
        const comp = fourcc(v, body + 18);
        if (comp === 'sowt') little = true;
        else if (comp === 'fl32' || comp === 'FL32' || comp === 'fl64') float = true;
        else if (comp !== 'NONE' && comp !== 'twos') throw new Error(`AIFF: unsupported compression ${comp}`);
      }
      comm = { channels, frames, bits, rate, little, float };
    } else if (id === 'SSND') {
      if (!comm) throw new Error('AIFF: SSND before COMM');
      const offset = v.getUint32(body);
      const start = body + 8 + offset;
      const bytesPer = Math.ceil(comm.bits / 8);
      const frames = Math.min(comm.frames, Math.floor((v.byteLength - start) / (bytesPer * comm.channels)));
      return {
        sampleRate: comm.rate,
        channels: readSamples(v, start, frames, comm.channels, bytesPer * 8, comm.float, comm.little),
      };
    }
    o = body + size + (size & 1);
  }
  throw new Error('AIFF: no sound data');
}

export function parsePcm(bytes: ArrayBuffer): PcmData {
  const f = sniffPcmFormat(bytes);
  if (f === 'wav') return parseWav(bytes);
  if (f === 'aiff') return parseAiff(bytes);
  throw new Error('not a PCM container');
}
