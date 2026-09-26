import { N, P, RW } from './city';
import type { Vec2 } from './math';

export type Node = [number, number];

const M = N + 1; // road lines per axis

export const edgeKey = (a: Node, b: Node): string => {
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a];
  return `${p[0]},${p[1]}|${q[0]},${q[1]}`;
};

export function neighbours(n: Node): Node[] {
  const out: Node[] = [];
  const [i, j] = n;
  if (i > 0) out.push([i - 1, j]);
  if (i < M - 1) out.push([i + 1, j]);
  if (j > 0) out.push([i, j - 1]);
  if (j < M - 1) out.push([i, j + 1]);
  return out;
}

/** A* over the street grid, avoiding closed edges. Returns the node list including both ends, or null. */
export function findPath(from: Node, to: Node, closed: ReadonlySet<string> = new Set()): Node[] | null {
  const id = (n: Node) => n[0] * M + n[1];
  const h = (n: Node) => (Math.abs(n[0] - to[0]) + Math.abs(n[1] - to[1])) * P;
  const g = new Map<number, number>([[id(from), 0]]);
  const came = new Map<number, Node>();
  const open: { n: Node; f: number }[] = [{ n: from, f: h(from) }];
  const done = new Set<number>();
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
    const { n } = open.splice(bi, 1)[0];
    const nid = id(n);
    if (done.has(nid)) continue;
    if (n[0] === to[0] && n[1] === to[1]) {
      const path: Node[] = [n];
      let cur = came.get(nid);
      while (cur) {
        path.unshift(cur);
        cur = came.get(id(cur));
      }
      return path;
    }
    done.add(nid);
    for (const m of neighbours(n)) {
      if (closed.has(edgeKey(n, m))) continue;
      const mid = id(m);
      const cost = (g.get(nid) ?? 0) + P;
      if (cost < (g.get(mid) ?? Infinity)) {
        g.set(mid, cost);
        came.set(mid, n);
        open.push({ n: m, f: cost + h(m) });
      }
    }
  }
  return null;
}

/** The street segment a point lies on (its two end nodes), or the nearest node when off-road. */
export function anchorNodes(p: Vec2): Node[] {
  const clampI = (v: number) => Math.max(0, Math.min(M - 1, v));
  const ri = Math.round(p.x / P);
  const rj = Math.round(p.z / P);
  const onX = Math.abs(p.z - rj * P) <= RW / 2 + 2; // on an east-west street
  const onZ = Math.abs(p.x - ri * P) <= RW / 2 + 2; // on a north-south street
  const j = clampI(rj);
  const i = clampI(ri);
  if (onX && !onZ) {
    const a = clampI(Math.floor(p.x / P));
    return a === clampI(a + 1) ? [[a, j]] : [[a, j], [clampI(a + 1), j]];
  }
  if (onZ && !onX) {
    const a = clampI(Math.floor(p.z / P));
    return a === clampI(a + 1) ? [[i, a]] : [[i, a], [i, clampI(a + 1)]];
  }
  return [[i, j]];
}

const nodeXZ = (n: Node): Vec2 => ({ x: n[0] * P, z: n[1] * P });

export function polylineLength(pts: Vec2[]): number {
  let s = 0;
  for (let k = 1; k < pts.length; k++) s += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
  return s;
}

/** GPS route between two world points along open streets. Returns a polyline from `from` to `to`. */
export function route(from: Vec2, to: Vec2, closed: ReadonlySet<string> = new Set()): Vec2[] {
  const starts = anchorNodes(from);
  const ends = anchorNodes(to);
  // Same segment: drive straight there.
  if (starts.length === 2 && ends.length === 2 && edgeKey(starts[0], starts[1]) === edgeKey(ends[0], ends[1])) {
    return [from, to];
  }
  let best: Vec2[] | null = null;
  let bestLen = Infinity;
  for (const s of starts) {
    for (const e of ends) {
      const path = findPath(s, e, closed);
      if (!path) continue;
      const pts = [from, ...path.map(nodeXZ), to];
      const len = polylineLength(pts);
      if (len < bestLen) {
        bestLen = len;
        best = pts;
      }
    }
  }
  return best ?? [from, to];
}
