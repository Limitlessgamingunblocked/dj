/*
 * Audio exports (Section 11.2): WAV (24-bit, lossless) straight from the
 * recorded data, and MP3 (320 kbps) through the encoder worker, tagged with
 * the set's title, your name, the venue, the date and the cover art.
 */
import Mp3Worker from './mp3.worker?worker&inline';
import { BYTES_PER_FRAME, wavHeader } from './pcm';
import { id3, type AudioTags } from './tags';

export type { AudioTags };

/** a WAV file from raw 24-bit stereo data */
export function wavFrom(data: Blob, rate: number): Blob {
  return new Blob([wavHeader(Math.floor(data.size / BYTES_PER_FRAME), rate) as BlobPart, data], { type: 'audio/wav' });
}

/** Encode raw 24-bit stereo to MP3 in a worker. */
export function mp3From(data: Blob, rate: number, tags: AudioTags | null, onProgress?: (k: number) => void, kbps = 320): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const w = new Mp3Worker();
    w.onmessage = (e: MessageEvent<{ type: string; k?: number; blob?: Blob; message?: string }>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress?.(m.k ?? 0);
      else if (m.type === 'done') {
        w.terminate();
        resolve(m.blob!);
      } else if (m.type === 'error') {
        w.terminate();
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'MP3 encoder failed'));
    };
    w.postMessage({ data, rate, kbps, tag: tags ? id3(tags) : undefined });
  });
}
