/*
 * The replay buffer's stills (Replay.ts), shrunk and turned into JPEGs off the
 * main thread. Reading a picture back from the GPU waits for the GPU to finish
 * the frame it belongs to; done on the main thread, that was a hitch in the
 * game every two seconds. Here only this worker waits.
 */

export interface StillJob {
  id: number;
  bitmap: ImageBitmap;
  /** the part of the frame to keep (16:9 from the middle) */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  w: number;
  h: number;
}

export interface StillDone {
  id: number;
  blob: Blob | null;
}

const post = (m: StillDone) => (self as unknown as Worker).postMessage(m);
let canvas: OffscreenCanvas | null = null;

self.onmessage = async (e: MessageEvent<StillJob>) => {
  const { id, bitmap, sx, sy, sw, sh, w, h } = e.data;
  try {
    if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no 2d context');
    g.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    post({ id, blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 }) });
  } catch {
    post({ id, blob: null });
  } finally {
    bitmap.close();
  }
};
