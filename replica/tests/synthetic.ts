import type { Frame, Mask } from '../src/recon/types';

/** A vertical prism: convex cross-section polygon in object XZ (pixels), from y = 0 to `height`. */
export interface Prism {
  polygon: [number, number][];
  height: number;
}

/**
 * Orthographic, level-camera silhouette of a prism after the turntable has turned `angle`
 * (positive moves the side facing the camera to the right). Matches carve()'s convention.
 */
export function prismMask(prism: Prism, angle: number, w: number, h: number, axisX: number, floorY: number): Mask {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, z] of prism.polygon) {
    const u = axisX + x * c + z * s;
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
  }
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const up = floorY - (y + 0.5);
    if (up < 0 || up > prism.height) continue;
    for (let x = 0; x < w; x++) {
      const u = x + 0.5;
      if (u >= lo && u <= hi) data[y * w + x] = 1;
    }
  }
  return { width: w, height: h, data };
}

export function sphereMask(r: number, cy: number, w: number, h: number, axisX: number, floorY: number): Mask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - axisX;
      const dy = floorY - (y + 0.5) - cy;
      if (dx * dx + dy * dy <= r * r) data[y * w + x] = 1;
    }
  }
  return { width: w, height: h, data };
}

/** Paints a mask as a colour frame on a backdrop, with mild noise and optional stripes on the item. */
export function maskToFrame(mask: Mask, opts: { bg?: [number, number, number]; fg?: [number, number, number]; noise?: number; stripes?: (x: number, y: number) => number } = {}): Frame {
  const bg = opts.bg ?? [235, 236, 240];
  const fg = opts.fg ?? [200, 60, 40];
  const noise = opts.noise ?? 4;
  const data = new Uint8ClampedArray(mask.width * mask.height * 4);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const i = y * mask.width + x;
      const on = mask.data[i];
      const shade = on && opts.stripes ? opts.stripes(x, y) : 1;
      const col = on ? fg : bg;
      for (let ch = 0; ch < 3; ch++) data[i * 4 + ch] = col[ch] * shade + rand() * noise * 2;
      data[i * 4 + 3] = 255;
    }
  }
  return { width: mask.width, height: mask.height, data, time: 0 };
}
