import type { Frame, Mask, SegmentOptions } from './types';

export interface Background {
  r: number;
  g: number;
  b: number;
  /** Typical per-pixel variation of the backdrop (camera noise, gradients). */
  noise: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/**
 * Estimates the backdrop colour from the top, left and right edges of the frame above the floor
 * line. The item is expected to stay away from those edges.
 */
export function estimateBackground(frame: Frame, floorY: number): Background {
  const { width, height, data } = frame;
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.03));
  const bottom = Math.max(band + 1, Math.min(height, Math.floor(floorY)));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const step = Math.max(1, Math.round(Math.min(width, height) / 160));
  const push = (x: number, y: number) => {
    const o = (y * width + x) * 4;
    rs.push(data[o]);
    gs.push(data[o + 1]);
    bs.push(data[o + 2]);
  };
  for (let y = 0; y < band; y += step) for (let x = 0; x < width; x += step) push(x, y);
  for (let y = band; y < bottom; y += step) {
    for (let x = 0; x < band; x += step) push(x, y);
    for (let x = width - band; x < width; x += step) push(x, y);
  }
  const r = median(rs);
  const g = median(gs);
  const b = median(bs);
  const devs = rs.map((_, i) => Math.abs(rs[i] - r) + Math.abs(gs[i] - g) + Math.abs(bs[i] - b));
  return { r, g, b, noise: median(devs) };
}

/**
 * Colour distance that is less sensitive to shadows: brightness differences count half as much
 * as changes in hue/saturation.
 */
function distance(r: number, g: number, b: number, bg: Background): number {
  const l1 = (r + g + b) / 3;
  const l0 = (bg.r + bg.g + bg.b) / 3;
  const dr = r - l1 - (bg.r - l0);
  const dg = g - l1 - (bg.g - l0);
  const db = b - l1 - (bg.b - l0);
  const chroma = Math.sqrt(dr * dr + dg * dg + db * db);
  return chroma * 1.4 + Math.abs(l1 - l0) * 0.6;
}

function erode(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[i] = src[i] & src[i - 1] & src[i + 1] & src[i - w] & src[i + w];
    }
  }
  return out;
}

function dilate(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] =
        src[i] |
        (x > 0 ? src[i - 1] : 0) |
        (x < w - 1 ? src[i + 1] : 0) |
        (y > 0 ? src[i - w] : 0) |
        (y < h - 1 ? src[i + w] : 0);
    }
  }
  return out;
}

/** Labels 4-connected regions of `value` and returns each pixel's region id and region sizes. */
function label(src: Uint8Array, w: number, h: number, value: number) {
  const labels = new Int32Array(src.length).fill(-1);
  const sizes: number[] = [];
  const touchesBorder: boolean[] = [];
  const stack = new Int32Array(src.length);
  for (let start = 0; start < src.length; start++) {
    if (src[start] !== value || labels[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    let border = false;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      const visit = (j: number) => {
        if (src[j] === value && labels[j] === -1) {
          labels[j] = id;
          stack[top++] = j;
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    sizes.push(size);
    touchesBorder.push(border);
  }
  return { labels, sizes, touchesBorder };
}

/**
 * Separates the item from a plain backdrop. Cleans up speckles, fills small holes (but keeps
 * real openings such as a handle), and keeps only the largest blob.
 */
export function segmentFrame(frame: Frame, bg: Background, opts: SegmentOptions): Mask {
  const { width: w, height: h, data } = frame;
  const floor = Math.max(0, Math.min(h, Math.floor(opts.floorY)));
  const s = Math.min(1, Math.max(0, opts.sensitivity));
  const threshold = Math.max(8 + (1 - s) * 70, bg.noise * (1.2 + (1 - s) * 2.5));
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let y = 0; y < floor; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (distance(data[o], data[o + 1], data[o + 2], bg) > threshold) mask[i] = 1;
    }
  }
  // Open (remove speckles), then close (bridge hairline gaps).
  mask = dilate(erode(mask, w, h), w, h);
  mask = erode(dilate(mask, w, h), w, h);
  // Close can't reach the floor row from above; restore the cut.
  for (let i = floor * w; i < mask.length; i++) mask[i] = 0;

  // Keep the largest object blob.
  const fg = label(mask, w, h, 1);
  if (fg.sizes.length === 0) return { width: w, height: h, data: mask };
  let best = 0;
  for (let i = 1; i < fg.sizes.length; i++) if (fg.sizes[i] > fg.sizes[best]) best = i;
  for (let i = 0; i < mask.length; i++) mask[i] = fg.labels[i] === best ? 1 : 0;

  // Fill enclosed background pockets that are too small to be a real opening.
  const holes = label(mask, w, h, 0);
  const maxHole = Math.max(6, fg.sizes[best] * 0.004);
  for (let i = 0; i < mask.length; i++) {
    const id = holes.labels[i];
    if (id >= 0 && !holes.touchesBorder[id] && holes.sizes[id] <= maxHole) mask[i] = 1;
  }
  return { width: w, height: h, data: mask };
}

/** Horizontal/vertical extent of a mask, or null when it is empty. */
export function maskBounds(mask: Mask): { left: number; right: number; top: number; bottom: number } | null {
  const { width: w, height: h, data } = mask;
  let left = w;
  let right = -1;
  let top = h;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { left, right: right + 1, top, bottom: bottom + 1 };
}
