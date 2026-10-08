/*
 * Keeping the lights on the beat you hear. The analyser and the beat grid read
 * the audio as it leaves the mixer; the speakers play it some time later (the
 * audio device's latency: a few ms wired, 100–250 ms over Bluetooth). Every
 * visual reads the features through this delay line, so a strobe lands with
 * the kick in the room rather than ahead of it.
 */
import type { Features } from './AudioFeatures';

/** How far the speakers run behind the analyser, in seconds: the device's latency plus the user's offset, kept to 0..0.5 s. */
export function avDelay(ctx: { baseLatency?: number; outputLatency?: number }, offsetMs: number): number {
  const fin = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const d = fin(ctx.baseLatency) + fin(ctx.outputLatency) + (Number.isFinite(offsetMs) ? offsetMs : 0) / 1000;
  return Math.min(0.5, Math.max(0, d));
}

const HITS = ['kickHit', 'snareHit', 'dropHit'] as const;
const MAX_FRAMES = 160;

function copyInto(dst: Features, src: Features): Features {
  const spectrum = dst.spectrum;
  const waveform = dst.waveform;
  Object.assign(dst, src);
  spectrum.set(src.spectrum);
  waveform.set(src.waveform);
  dst.spectrum = spectrum;
  dst.waveform = waveform;
  return dst;
}

function blank(src: Features): Features {
  return { ...src, spectrum: new Float32Array(src.spectrum.length), waveform: new Float32Array(src.waveform.length) };
}

/**
 * A short delay line for feature frames. push() stores the live frame and
 * returns the newest one at least `delay` seconds old. Hits (kick, snare, the
 * drop) in frames it skips over are carried into the one it hands out, and
 * each hit is handed out once, however the frame times fall.
 */
export class FeatureDelay {
  private ring: { t: number; f: Features }[] = [];
  private pool: Features[] = [];
  private out: Features | null = null;

  push(t: number, f: Features, delay: number): Features {
    if (!(delay > 0)) {
      this.clear();
      return f;
    }
    const slot = copyInto(this.pool.pop() ?? blank(f), f);
    this.ring.push({ t, f: slot });
    // never more than a fixed number of frames: the oldest go, their hits move on to the next
    while (this.ring.length > MAX_FRAMES) this.release(1);
    let i = -1;
    for (let k = this.ring.length - 1; k >= 0; k--)
      if (this.ring[k].t <= t - delay + 1e-9) {
        i = k;
        break;
      }
    if (i < 0) {
      // just started (or the delay just grew): show the oldest frame there is, but its hits aren't due yet
      const early = copyInto((this.out ??= blank(f)), this.ring[0].f);
      for (const h of HITS) early[h] = false;
      return early;
    }
    this.release(i);
    const cur = this.ring[0].f;
    const out = copyInto((this.out ??= blank(f)), cur);
    // handed out now: it mustn't fire again if the next frame hands it out a second time
    for (const h of HITS) cur[h] = false;
    return out;
  }

  /** drop the first n frames, carrying their hits into the frame after them */
  private release(n: number): void {
    if (n <= 0) return;
    const next = this.ring[n].f;
    for (let k = 0; k < n; k++) {
      const f = this.ring[k].f;
      for (const h of HITS) if (f[h]) next[h] = true;
      this.pool.push(f);
    }
    this.ring.splice(0, n);
  }

  clear(): void {
    for (const r of this.ring) this.pool.push(r.f);
    this.ring.length = 0;
  }
}
