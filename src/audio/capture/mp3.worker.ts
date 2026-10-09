/*
 * MP3 export (Section 11.2: 320 kbps), off the main thread. Reads the
 * 24-bit recording in slices, dithers to 16-bit for the encoder (LAME, via
 * the @breezystack/lamejs port, LGPL-3.0: kept in this worker on its own),
 * and reports progress as it goes.
 */
import { Mp3Encoder } from '@breezystack/lamejs';
import { BYTES_PER_FRAME, to16 } from './pcm';

interface Job {
  data: Blob;
  rate: number;
  kbps: number;
  /** an ID3v2 tag to put in front, already built */
  tag?: Uint8Array;
}

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<Job>) => {
  try {
    const { data, rate, kbps, tag } = e.data;
    const enc = new Mp3Encoder(2, rate, kbps);
    const frames = Math.floor(data.size / BYTES_PER_FRAME);
    const step = 1152 * 64;
    const out: BlobPart[] = tag ? [tag as BlobPart] : [];
    for (let f = 0; f < frames; f += step) {
      const n = Math.min(step, frames - f);
      const bytes = new Uint8Array(await data.slice(f * BYTES_PER_FRAME, (f + n) * BYTES_PER_FRAME).arrayBuffer());
      const [l, r] = to16(bytes, n);
      const b = enc.encodeBuffer(l, r);
      if (b.length) out.push(b.slice() as BlobPart);
      post({ type: 'progress', k: (f + n) / frames });
    }
    const last = enc.flush();
    if (last.length) out.push(last.slice() as BlobPart);
    post({ type: 'done', blob: new Blob(out, { type: 'audio/mpeg' }) });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};
