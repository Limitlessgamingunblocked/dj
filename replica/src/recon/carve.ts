import type { CarveParams, Mask, VoxelGrid } from './types';

/** Empty voxels kept around the item so the surface always closes. */
export const PAD = 2;

/**
 * Anti-aliased copy of a silhouette (0..255). Two 3×3 box blurs soften the edge over a couple
 * of pixels while keeping the halfway level on the original outline, so bilinear sampling can
 * place the surface between pixels instead of snapping to them.
 */
export function softenMask(mask: Mask): Uint8Array {
  const { width: w, height: h } = mask;
  let src = new Float32Array(mask.data.length);
  for (let i = 0; i < src.length; i++) src[i] = mask.data[i];
  let dst = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += src[yy * w + xx];
            n++;
          }
        }
        dst[y * w + x] = sum / n;
      }
    }
    [src, dst] = [dst, src];
  }
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.round(src[i] * 255);
  return out;
}

/**
 * Shape-from-silhouette ("space carving"). Every voxel is projected into every frame of one
 * turn; a voxel belongs to the item only if it lands inside the item's outline in all of them
 * (all but `tolerance − 1`, to forgive the odd bad frame). The camera is treated as orthographic
 * (film from a distance and zoom in), looking at the turntable from `elevationDeg` above level.
 *
 * Object space is in image pixels: X to the right and Z toward the camera in the first frame,
 * Y up from the turntable surface. `angles[i]` is how far the item has turned in frame i;
 * positive angles move the side facing the camera to the right.
 */
export function carve(
  masks: Mask[],
  angles: number[],
  p: CarveParams,
  onProgress?: (fraction: number) => void,
): VoxelGrid {
  const e = (p.elevationDeg * Math.PI) / 180;
  const ce = Math.cos(e);
  const se = Math.sin(e);
  const gridHeight = p.height / Math.max(0.2, ce);
  const vs = Math.max(2 * p.radius, gridHeight) / p.resolution;
  const nx = Math.ceil((2 * p.radius) / vs) + 2 * PAD;
  const ny = Math.ceil(gridHeight / vs) + 2 * PAD;
  const nz = nx;
  const x0 = -(nx * vs) / 2 + vs / 2;
  const y0 = -PAD * vs + vs / 2;
  const z0 = x0;
  const count = nx * ny * nz;
  const tol = Math.max(1, Math.min(8, Math.round(p.tolerance)));
  // The `tol` lowest silhouette samples seen so far for each voxel, ascending.
  const lows = new Uint8Array(count * tol).fill(255);
  const last = tol - 1;

  for (let f = 0; f < masks.length; f++) {
    const mask = masks[f];
    const w = mask.width;
    const h = mask.height;
    const soft = softenMask(mask);
    // Sample positions are shifted by half a pixel so integer coordinates hit pixel centres.
    const maxU = w - 1;
    const maxV = Math.min(h, p.floorY) - 1;
    const c = Math.cos(angles[f]);
    const s = Math.sin(angles[f]);
    const du = vs * c;
    const dv = -vs * s * se;
    for (let k = PAD; k < nz - PAD; k++) {
      const z = z0 + k * vs;
      for (let j = PAD; j < ny - PAD; j++) {
        const y = y0 + j * vs;
        if (y < 0) continue;
        const xStart = x0 + PAD * vs;
        let u = p.axisX + xStart * c + z * s - 0.5;
        let v = p.floorY - y * ce + (-xStart * s + z * c) * se - 0.5;
        let idx = PAD + nx * (j + ny * k);
        for (let i = PAD; i < nx - PAD; i++, idx++, u += du, v += dv) {
          const base = idx * tol;
          if (lows[base + last] === 0) continue; // already certainly outside
          // Off-screen or in the ignored area below the floor line: no evidence either way.
          if (u < 0 || v < 0 || u > maxU || v > maxV) continue;
          const ui = u | 0;
          const vi = v | 0;
          const fu = u - ui;
          const fv = v - vi;
          const o = vi * w + ui;
          const u1 = ui < maxU ? 1 : 0;
          const v1 = vi < maxV ? w : 0;
          const top = soft[o] + (soft[o + u1] - soft[o]) * fu;
          const bot = soft[o + v1] + (soft[o + v1 + u1] - soft[o + v1]) * fu;
          const val = (top + (bot - top) * fv + 0.5) | 0;
          if (val >= lows[base + last]) continue;
          // Insert into the ascending list of lowest values.
          let q = last;
          while (q > 0 && lows[base + q - 1] > val) {
            lows[base + q] = lows[base + q - 1];
            q--;
          }
          lows[base + q] = val;
        }
      }
    }
    onProgress?.((f + 1) / masks.length);
  }

  const data = new Uint8Array(count);
  const field = new Float32Array(count);
  for (let k = PAD; k < nz - PAD; k++) {
    for (let j = PAD; j < ny - PAD; j++) {
      if (y0 + j * vs < 0) continue;
      for (let i = PAD; i < nx - PAD; i++) {
        const idx = i + nx * (j + ny * k);
        const value = lows[idx * tol + last] / 255;
        field[idx] = value;
        if (value > 0.5) data[idx] = 1;
      }
    }
  }
  const grid: VoxelGrid = { nx, ny, nz, voxelSize: vs, origin: [x0, y0, z0], data, field };
  keepLargestComponent(grid);
  return grid;
}

/** Removes floating specks left by segmentation noise, keeping the biggest 6-connected solid. */
export function keepLargestComponent(grid: VoxelGrid): void {
  const { nx, ny, data, field } = grid;
  const nxy = nx * ny;
  const labels = new Int32Array(data.length);
  const stack = new Int32Array(data.length);
  let bestLabel = 0;
  let bestSize = 0;
  let next = 1;
  for (let start = 0; start < data.length; start++) {
    if (!data[start] || labels[start]) continue;
    const id = next++;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const i = stack[--top];
      size++;
      // PAD guarantees neighbours of solid voxels stay inside the array.
      const ns = [i - 1, i + 1, i - nx, i + nx, i - nxy, i + nxy];
      for (const j of ns) {
        if (data[j] && !labels[j]) {
          labels[j] = id;
          stack[top++] = j;
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = id;
    }
  }
  for (let i = 0; i < data.length; i++) {
    if (data[i] && labels[i] !== bestLabel) {
      data[i] = 0;
      field[i] = 0;
    }
  }
}

export function countSolid(grid: VoxelGrid): number {
  let n = 0;
  for (const v of grid.data) n += v;
  return n;
}
