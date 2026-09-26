import type { Frame } from './types';

export interface FrameSet {
  frames: Frame[];
  duration: number;
  width: number;
  height: number;
  /** Suggested floor line, if the source knows it (the demo does). */
  floorY?: number;
  /** Real height of the item in mm, if known (the demo does). */
  knownHeightMm?: number;
  label: string;
}

function once(target: EventTarget, ok: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('error'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(ok, onOk);
      target.removeEventListener('error', onErr);
    };
    target.addEventListener(ok, onOk);
    target.addEventListener('error', onErr);
  });
}

/**
 * Pulls `count` evenly spaced frames out of a video file, scaled so the longer side is at most
 * `maxSize` pixels. Runs entirely in the browser; the video never leaves the device.
 */
export async function extractFrames(
  file: Blob,
  count: number,
  maxSize: number,
  onProgress?: (fraction: number) => void,
): Promise<FrameSet> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    try {
      await once(video, 'loadeddata', 20000);
    } catch {
      throw new Error('This browser can’t read that video. Try an MP4 (H.264) file — most phones can export one.');
    }
    let duration = video.duration;
    if (!Number.isFinite(duration)) {
      // Some recorded WebM files don't report a duration until you seek to the end.
      video.currentTime = 1e7;
      await once(video, 'seeked', 10000).catch(() => undefined);
      duration = video.duration;
      if (!Number.isFinite(duration)) duration = video.currentTime;
    }
    if (!(duration > 0.5)) throw new Error('That video is too short. Film at least one full turn of the turntable.');
    const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(16, Math.round(video.videoWidth * scale));
    const height = Math.max(16, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const frames: Frame[] = [];
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) * duration) / count;
      const seeked = once(video, 'seeked', 8000);
      video.currentTime = t;
      await seeked;
      ctx.drawImage(video, 0, 0, width, height);
      const img = ctx.getImageData(0, 0, width, height);
      frames.push({ width, height, data: img.data, time: t });
      onProgress?.((i + 1) / count);
    }
    return { frames, duration, width, height, label: (file as File).name ?? 'video' };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
