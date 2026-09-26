import { buildingsNear, EDGE, SIZE, type Building, type City } from '../core/city';

export interface Box2 {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Push {
  nx: number;
  nz: number;
  depth: number;
}

const scratch: Building[] = [];

/** Deepest penetration of a circle into a box, or null. */
export function circleVsBox(x: number, z: number, r: number, b: Box2): Push | null {
  const cx = Math.max(b.x0, Math.min(x, b.x1));
  const cz = Math.max(b.z0, Math.min(z, b.z1));
  let dx = x - cx;
  let dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, depth: r - d };
  }
  // Centre inside the box: push out through the nearest face.
  const faces = [x - b.x0, b.x1 - x, z - b.z0, b.z1 - z];
  const m = Math.min(...faces);
  const k = faces.indexOf(m);
  dx = k === 0 ? -1 : k === 1 ? 1 : 0;
  dz = k === 2 ? -1 : k === 3 ? 1 : 0;
  return { nx: dx, nz: dz, depth: m + r };
}

/** All pushes needed to get a circle out of buildings, extra boxes and the world edge. */
export function circlePushes(city: City, x: number, z: number, r: number, extra: Box2[] = []): Push[] {
  const out: Push[] = [];
  for (const b of buildingsNear(city, x, z, scratch)) {
    const p = circleVsBox(x, z, r, b);
    if (p) out.push(p);
  }
  for (const b of extra) {
    if (Math.abs((b.x0 + b.x1) / 2 - x) > 30 || Math.abs((b.z0 + b.z1) / 2 - z) > 30) continue;
    const p = circleVsBox(x, z, r, b);
    if (p) out.push(p);
  }
  const lo = -EDGE;
  const hi = SIZE + EDGE;
  if (x - r < lo) out.push({ nx: 1, nz: 0, depth: lo - (x - r) });
  if (x + r > hi) out.push({ nx: -1, nz: 0, depth: x + r - hi });
  if (z - r < lo) out.push({ nx: 0, nz: 1, depth: lo - (z - r) });
  if (z + r > hi) out.push({ nx: 0, nz: -1, depth: z + r - hi });
  return out;
}

export function circleVsCircle(ax: number, az: number, ar: number, bx: number, bz: number, br: number): Push | null {
  const dx = ax - bx;
  const dz = az - bz;
  const d2 = dx * dx + dz * dz;
  const rr = ar + br;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2) || 1e-3;
  return { nx: dx / d, nz: dz / d, depth: rr - d };
}
