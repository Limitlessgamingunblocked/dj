import type { Mesh, VoxelGrid } from './types';

/** Separable [1 2 1]/4 blur along each axis of a voxel field. */
export function blurField(field: Float32Array, grid: VoxelGrid): Float32Array {
  const { nx, ny, nz } = grid;
  let a = Float32Array.from(field);
  let b = new Float32Array(a.length);
  const strides = [1, nx, nx * ny];
  const sizes = [nx, ny, nz];
  for (let axis = 0; axis < 3; axis++) {
    const st = strides[axis];
    const n = sizes[axis];
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = i + nx * (j + ny * k);
          const pos = axis === 0 ? i : axis === 1 ? j : k;
          const prev = pos > 0 ? a[idx - st] : 0;
          const next = pos < n - 1 ? a[idx + st] : 0;
          b[idx] = (prev + 2 * a[idx] + next) * 0.25;
        }
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

const CORNERS: [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

/**
 * Naive surface nets: one vertex per cell the surface passes through (the mean of the edge
 * crossings), one quad per grid edge the surface crosses. On a field that is zero at the border
 * this always yields a closed surface.
 */
export function surfaceNets(field: Float32Array, grid: VoxelGrid, iso = 0.5): Mesh {
  const { nx, ny, nz, voxelSize: vs, origin } = grid;
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1);
  const positions: number[] = [];
  const corner = new Float32Array(8);
  const offsets = CORNERS.map(([a, b, c]) => a + nx * (b + ny * c));

  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const base = i + nx * (j + ny * k);
        let mask = 0;
        for (let q = 0; q < 8; q++) {
          corner[q] = field[base + offsets[q]];
          if (corner[q] > iso) mask |= 1 << q;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [q0, q1] of EDGES) {
          const in0 = (mask >> q0) & 1;
          const in1 = (mask >> q1) & 1;
          if (in0 === in1) continue;
          const t = (iso - corner[q0]) / (corner[q1] - corner[q0]);
          const p0 = CORNERS[q0];
          const p1 = CORNERS[q1];
          sx += p0[0] + t * (p1[0] - p0[0]);
          sy += p0[1] + t * (p1[1] - p0[1]);
          sz += p0[2] + t * (p1[2] - p0[2]);
          n++;
        }
        cellVertex[i + cx * (j + cy * k)] = positions.length / 3;
        positions.push(
          origin[0] + (i + sx / n) * vs,
          origin[1] + (j + sy / n) * vs,
          origin[2] + (k + sz / n) * vs,
        );
      }
    }
  }

  const indices: number[] = [];
  const cell = (i: number, j: number, k: number) => cellVertex[i + cx * (j + cy * k)];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (flip) [b, d] = [d, b];
    // Split along the shorter diagonal for better-shaped triangles.
    const d1 = dist2(positions, a, c);
    const d2 = dist2(positions, b, d);
    if (d1 <= d2) indices.push(a, b, c, a, c, d);
    else indices.push(a, b, d, b, c, d);
  };

  for (let k = 1; k < cz; k++) {
    for (let j = 1; j < cy; j++) {
      for (let i = 1; i < cx; i++) {
        const idx = i + nx * (j + ny * k);
        const inside = field[idx] > iso;
        // Edge along +x. Quad ordered counter-clockwise around +x (y then z).
        if ((field[idx + 1] > iso) !== inside) {
          quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), !inside);
        }
        // Edge along +y. Counter-clockwise around +y (z then x).
        if ((field[idx + nx] > iso) !== inside) {
          quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), !inside);
        }
        // Edge along +z. Counter-clockwise around +z (x then y).
        if ((field[idx + nx * ny] > iso) !== inside) {
          quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), !inside);
        }
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

function dist2(p: number[], a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3];
  const dy = p[a * 3 + 1] - p[b * 3 + 1];
  const dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Taubin λ|μ smoothing: alternating shrink and inflate steps remove voxel stair-steps without
 * the overall shrinking plain Laplacian smoothing causes. Vertices marked in `pinned` stay put.
 */
export function taubinSmooth(mesh: Mesh, iterations: number, pinned?: Uint8Array): void {
  const { positions: p, indices } = mesh;
  const nv = p.length / 3;
  // Unique neighbour lists in CSR form.
  const sets: Set<number>[] = Array.from({ length: nv }, () => new Set<number>());
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    sets[a].add(b).add(c);
    sets[b].add(a).add(c);
    sets[c].add(a).add(b);
  }
  const start = new Uint32Array(nv + 1);
  for (let v = 0; v < nv; v++) start[v + 1] = start[v] + sets[v].size;
  const adj = new Uint32Array(start[nv]);
  for (let v = 0; v < nv; v++) {
    let o = start[v];
    for (const n of sets[v]) adj[o++] = n;
  }
  const delta = new Float32Array(p.length);
  const step = (factor: number) => {
    for (let v = 0; v < nv; v++) {
      const s = start[v];
      const e = start[v + 1];
      if (e === s || pinned?.[v]) {
        delta[v * 3] = delta[v * 3 + 1] = delta[v * 3 + 2] = 0;
        continue;
      }
      let x = 0;
      let y = 0;
      let z = 0;
      for (let o = s; o < e; o++) {
        const n = adj[o] * 3;
        x += p[n];
        y += p[n + 1];
        z += p[n + 2];
      }
      const inv = 1 / (e - s);
      delta[v * 3] = (x * inv - p[v * 3]) * factor;
      delta[v * 3 + 1] = (y * inv - p[v * 3 + 1]) * factor;
      delta[v * 3 + 2] = (z * inv - p[v * 3 + 2]) * factor;
    }
    for (let i = 0; i < p.length; i++) p[i] += delta[i];
  };
  for (let it = 0; it < iterations; it++) {
    step(0.5);
    step(-0.53);
  }
}

/**
 * Snaps the bottom of the model to a perfectly flat base at y = 0 so it sits on the print bed.
 * Returns which vertices were snapped, so smoothing can leave them alone.
 */
export function flattenBase(mesh: Mesh, tolerance: number): Uint8Array {
  const p = mesh.positions;
  const nv = p.length / 3;
  let minY = Infinity;
  for (let v = 0; v < nv; v++) minY = Math.min(minY, p[v * 3 + 1]);
  const pinned = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) {
    if (p[v * 3 + 1] <= minY + tolerance) {
      p[v * 3 + 1] = 0;
      pinned[v] = 1;
    } else {
      p[v * 3 + 1] -= minY;
    }
  }
  return pinned;
}

/** Axis-aligned bounds of a mesh. */
export function bounds(mesh: Mesh): { min: [number, number, number]; max: [number, number, number] } {
  const p = mesh.positions;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (p[i + a] < min[a]) min[a] = p[i + a];
      if (p[i + a] > max[a]) max[a] = p[i + a];
    }
  }
  return { min, max };
}

/** Enclosed volume via the divergence theorem (positive for outward-facing triangles). */
export function signedVolume(mesh: Mesh): number {
  const { positions: p, indices: ix } = mesh;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3;
    const b = ix[t + 1] * 3;
    const c = ix[t + 2] * 3;
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

export function surfaceArea(mesh: Mesh): number {
  const { positions: p, indices: ix } = mesh;
  let area = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3;
    const b = ix[t + 1] * 3;
    const c = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return area;
}

/** Area of downward-facing surfaces steeper than `maxAngleDeg` from vertical (excluding the base). */
export function overhangArea(mesh: Mesh, maxAngleDeg = 45): number {
  const { positions: p, indices: ix } = mesh;
  const limit = -Math.sin((maxAngleDeg * Math.PI) / 180);
  let minY = Infinity;
  for (let i = 1; i < p.length; i += 3) minY = Math.min(minY, p[i]);
  let area = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3;
    const b = ix[t + 1] * 3;
    const c = ix[t + 2] * 3;
    if (Math.max(p[a + 1], p[b + 1], p[c + 1]) <= minY + 1e-6) continue;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len === 0) continue;
    if (ny / len < limit) area += len / 2;
  }
  return area;
}

/** Returns a scaled copy of the mesh, recentred so X/Z are centred on 0 and the base is at y = 0. */
export function scaleMesh(mesh: Mesh, scale: number): Mesh {
  const { min, max } = bounds(mesh);
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const src = mesh.positions;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = (src[i] - cx) * scale;
    out[i + 1] = (src[i + 1] - min[1]) * scale;
    out[i + 2] = (src[i + 2] - cz) * scale;
  }
  return { positions: out, indices: mesh.indices };
}
