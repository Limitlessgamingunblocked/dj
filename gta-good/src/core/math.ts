export interface Vec2 {
  x: number;
  z: number;
}

export const v2 = (x: number, z: number): Vec2 => ({ x, z });
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/** Frame-rate independent smoothing: move `a` towards `b` with rate `k` per second. */
export const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function dampAngle(a: number, b: number, k: number, dt: number): number {
  return a + wrapAngle(b - a) * (1 - Math.exp(-k * dt));
}

/** Forward unit vector for a heading (radians), matching three.js rotation.y with +z as the model's front. */
export const forward = (h: number): Vec2 => ({ x: Math.sin(h), z: Math.cos(h) });
/** Right-hand side of a direction on the ground plane (x east, z south). */
export const rightOf = (d: Vec2): Vec2 => ({ x: -d.z, z: d.x });
export const headingOf = (d: Vec2) => Math.atan2(d.x, d.z);

export function fmtTime(s: number): string {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Closest point on an axis-aligned box to p. */
export function closestOnBox(p: Vec2, x0: number, z0: number, x1: number, z1: number): Vec2 {
  return { x: clamp(p.x, x0, x1), z: clamp(p.z, z0, z1) };
}
