import { maskBounds } from './segment';
import type { Frame, Mask, TurntableGeometry } from './types';

const THUMB = 64;

/** Small normalised greyscale copy of the area above the floor line, for comparing frames. */
function thumbnail(frame: Frame, floorY: number): Float32Array {
  const { width, height, data } = frame;
  const bottom = Math.max(1, Math.min(height, Math.floor(floorY)));
  const out = new Float32Array(THUMB * THUMB);
  for (let ty = 0; ty < THUMB; ty++) {
    const y0 = Math.floor((ty * bottom) / THUMB);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * bottom) / THUMB));
    for (let tx = 0; tx < THUMB; tx++) {
      const x0 = Math.floor((tx * width) / THUMB);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / THUMB));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const o = (y * width + x) * 4;
          sum += data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
          n++;
        }
      }
      out[ty * THUMB + tx] = sum / n;
    }
  }
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length;
  let sd = 0;
  for (const v of out) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / sd;
  return out;
}

export interface RevolutionResult {
  /** Number of frames that make up exactly one full turn (frame `turnFrames` looks like frame 0). */
  turnFrames: number;
  /** False when the item looks the same from every side, or the video seems shorter than a turn. */
  confident: boolean;
}

/**
 * Finds where the item has turned a full 360° by looking for the first frame that matches the
 * opening frame again after it has looked different.
 */
export function detectRevolution(frames: Frame[], floorY: number): RevolutionResult {
  const n = frames.length;
  if (n < 8) return { turnFrames: n, confident: false };
  const thumbs = frames.map((f) => thumbnail(f, floorY));
  const d = thumbs.map((t) => {
    let s = 0;
    for (let i = 0; i < t.length; i++) s += Math.abs(t[i] - thumbs[0][i]);
    return s / t.length;
  });
  const start = Math.max(4, Math.floor(n * 0.25));
  let dmax = 0;
  for (let k = 1; k < n; k++) dmax = Math.max(dmax, d[k]);
  let dmin = Infinity;
  for (let k = start; k < n; k++) dmin = Math.min(dmin, d[k]);
  if (dmax < 0.05) return { turnFrames: n, confident: false };
  const accept = dmin + 0.08 * (dmax - dmin);
  for (let k = start; k < n; k++) {
    if (d[k] > accept) continue;
    // Walk to the bottom of this dip.
    let best = k;
    while (best + 1 < n && d[best + 1] <= d[best]) best++;
    const clearlyReturned = d[best] < 0.5 * dmax;
    // The dip must come after the item has visibly turned away from the start.
    let peak = 0;
    for (let j = 1; j < best; j++) peak = Math.max(peak, d[j]);
    const ok = clearlyReturned && peak > d[best] * 1.8;
    if (ok && best === n - 1) {
      // The best match is the very last frame: the clip is (about) one turn, possibly a bit short.
      return { turnFrames: n, confident: true };
    }
    if (ok) return { turnFrames: best, confident: true };
    break;
  }
  return { turnFrames: n, confident: false };
}

function grey(frame: Frame, x: number, y: number): number {
  const o = (y * frame.width + x) * 4;
  return frame.data[o] * 0.299 + frame.data[o + 1] * 0.587 + frame.data[o + 2] * 0.114;
}

export interface DirectionResult {
  /** +1: the side facing the camera moves to the right. −1: it moves to the left. */
  direction: 1 | -1;
  confident: boolean;
}

/**
 * Works out which way the turntable spins by tracking the texture on the side of the item facing
 * the camera, which moves fastest and is always visible.
 */
export function detectDirection(frames: Frame[], masks: Mask[], geom: TurntableGeometry, turnFrames: number): DirectionResult {
  const maxShift = 10;
  const pairs = Math.min(24, turnFrames - 1);
  let votes = 0;
  let total = 0;
  for (let p = 0; p < pairs; p++) {
    const i = Math.floor((p * (turnFrames - 1)) / pairs);
    const a = frames[i];
    const b = frames[i + 1];
    const ma = masks[i];
    const mb = masks[i + 1];
    const w = a.width;
    const h = a.height;
    const x0 = Math.max(maxShift + 1, Math.floor(geom.axisX - geom.radius * 0.5));
    const x1 = Math.min(w - maxShift - 1, Math.ceil(geom.axisX + geom.radius * 0.5));
    const y1 = Math.min(h - 1, Math.floor(geom.floorY));
    const y0 = Math.max(1, Math.floor(geom.floorY - geom.height));
    const errors = new Float64Array(maxShift * 2 + 1);
    const counts = new Float64Array(maxShift * 2 + 1);
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        if (!ma.data[y * w + x]) continue;
        const g = grey(a, x, y);
        // Only textured pixels carry motion information.
        const gx = Math.abs(grey(a, x + 1, y) - grey(a, x - 1, y));
        if (gx < 6) continue;
        for (let s = -maxShift; s <= maxShift; s++) {
          if (!mb.data[y * w + x + s]) continue;
          errors[s + maxShift] += Math.abs(grey(b, x + s, y) - g);
          counts[s + maxShift]++;
        }
      }
    }
    let bestShift = 0;
    let bestErr = Infinity;
    let worstErr = 0;
    for (let s = -maxShift; s <= maxShift; s++) {
      const c = counts[s + maxShift];
      if (c < 30) continue;
      const e = errors[s + maxShift] / c;
      if (e < bestErr) {
        bestErr = e;
        bestShift = s;
      }
      worstErr = Math.max(worstErr, e);
    }
    if (bestShift !== 0 && worstErr > bestErr * 1.3) {
      votes += Math.sign(bestShift);
      total++;
    }
  }
  if (total === 0) return { direction: 1, confident: false };
  return { direction: votes >= 0 ? 1 : -1, confident: Math.abs(votes) >= Math.max(3, total * 0.5) };
}

/**
 * Locates the turntable axis and the item's size from the silhouettes of one full turn. Over a
 * full turn the widest point sweeps equally far left and right of the axis, so the axis sits
 * halfway between the extreme left and right edges.
 */
export function measureGeometry(masks: Mask[], floorY: number): TurntableGeometry | null {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  for (const m of masks) {
    const b = maskBounds(m);
    if (!b) continue;
    left = Math.min(left, b.left);
    right = Math.max(right, b.right);
    top = Math.min(top, b.top);
  }
  if (!Number.isFinite(left)) return null;
  const axisX = (left + right) / 2;
  return {
    axisX,
    floorY,
    radius: Math.max(axisX - left, right - axisX),
    height: Math.max(1, floorY - top),
  };
}

/**
 * First guess at the floor line from a mask of the whole frame (item plus turntable). The
 * turntable shows up as a thin band at the bottom whose width stays constant; the floor is the
 * top of that band. Without a clear band, the bottom of the silhouette is used.
 */
export function guessFloorLine(mask: Mask): number {
  const { width: w, height: h, data } = mask;
  const widths = new Int32Array(h);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left >= 0) {
      widths[y] = right - left + 1;
      if (top < 0) top = y;
      bottom = y;
    }
  }
  if (bottom < 0) return Math.round(h * 0.85);
  const total = bottom - top + 1;
  // Width of the band, measured a little above the very bottom edge (which is often ragged).
  const ref = widths[Math.max(top, bottom - 2)];
  let y = bottom - 2;
  while (y > top && Math.abs(widths[y] - ref) <= ref * 0.08) y--;
  const bandTop = y + 1;
  const bandHeight = bottom - bandTop + 1;
  const above = widths[Math.max(top, bandTop - 3)];
  if (bandHeight >= 2 && bandHeight < total * 0.2 && Math.abs(above - ref) > ref * 0.12) return bandTop;
  return bottom + 1;
}
