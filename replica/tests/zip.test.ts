import { describe, expect, it } from 'vitest';
import { crc32, zipFiles } from '../src/zip';

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes an archive whose entry reads back byte for byte', async () => {
    const data = new Uint8Array(20000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 13;
    const zip = new Uint8Array(await (await zipFiles([{ name: 'jug.stl', data }])).arrayBuffer());
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const method = view.getUint16(8, true);
    const size = view.getUint32(18, true);
    const nameLen = view.getUint16(26, true);
    expect(new TextDecoder().decode(zip.subarray(30, 30 + nameLen))).toBe('jug.stl');
    const body = zip.slice(30 + nameLen, 30 + nameLen + size);
    const restored = method === 8 ? await inflateRaw(body) : body;
    expect(restored).toEqual(data);
    expect(view.getUint32(14, true)).toBe(crc32(data));
    // End-of-central-directory record closes the file.
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });
});
