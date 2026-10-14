/*
 * The tour globe's geometry: the world's rough outlines, where a city sits on
 * the sphere, the arcs a route flies, and the turn that brings a city round
 * to face you. No map data: the outlines are hand-placed points (they were
 * the flat tour map's), enough to read as the world.
 */
import type { City } from '../game/circuit';

/** rough outlines, [lat, lon] (no map data: hand-placed points, enough to read as the world) */
export const LAND: [number, number][][] = [
  // North America
  [[70, -165], [72, -140], [70, -100], [75, -80], [62, -62], [47, -53], [44, -66], [35, -76], [25, -80], [30, -90], [26, -97], [20, -97], [15, -92], [8, -78], [10, -84], [15, -95], [20, -105], [30, -115], [40, -124], [50, -127], [58, -137], [60, -147], [55, -163], [65, -168]],
  // Greenland
  [[83, -35], [80, -15], [70, -20], [60, -43], [66, -55], [77, -70], [82, -60]],
  // South America
  [[12, -72], [10, -62], [5, -52], [-5, -35], [-23, -41], [-34, -53], [-40, -62], [-55, -68], [-52, -75], [-40, -73], [-18, -70], [-5, -81], [2, -80], [8, -77]],
  // Europe and Asia
  [[36, -9], [43, -9], [48, -5], [51, 2], [54, 8], [57, 8], [58, 11], [63, 5], [71, 25], [69, 40], [73, 55], [77, 105], [72, 130], [70, 160], [66, 180], [60, 165], [52, 157], [59, 143], [53, 141], [43, 132], [38, 122], [30, 122], [22, 114], [10, 106], [1, 104], [8, 98], [17, 95], [22, 90], [16, 82], [8, 77], [20, 72], [25, 62], [25, 57], [30, 48], [30, 35], [35, 36], [37, 27], [40, 26], [36, 22], [40, 19], [45, 13], [40, 15], [38, 16], [44, 8], [43, 3], [37, -1]],
  // Arabia
  [[30, 35], [28, 48], [24, 57], [17, 55], [12, 45], [20, 40]],
  // Britain and Ireland
  [[50, -5], [51, 1.5], [53, 0.3], [56, -2], [58.5, -3], [58, -6], [55, -5], [53, -4.5], [51.5, -5]],
  [[51.5, -10], [54.5, -10], [55, -7], [52, -6]],
  // Africa
  [[35, -6], [37, 10], [32, 32], [30, 33], [12, 44], [11, 51], [-2, 41], [-12, 40], [-26, 33], [-34, 26], [-35, 19], [-29, 16], [-17, 12], [-6, 12], [4, 9], [4, -8], [6, -10], [15, -17], [21, -17], [28, -13]],
  [[-12, 49], [-16, 50], [-25, 47], [-22, 43], [-16, 44]],
  // Australia and New Zealand
  [[-11, 131], [-12, 137], [-17, 141], [-11, 142], [-25, 153], [-37, 150], [-39, 146], [-32, 134], [-35, 117], [-22, 114], [-14, 127]],
  [[-35, 173], [-41, 176], [-46, 170], [-41, 172]],
  // Japan, the islands of South East Asia
  [[31, 130], [34, 135], [35, 140], [41, 141], [45, 142], [43, 145], [40, 140], [36, 136], [34, 131]],
  [[5, 95], [-1, 101], [-6, 106], [-4, 103], [2, 98]],
  [[7, 117], [1, 109], [-3, 111], [-3, 116], [1, 119]],
  [[-2, 131], [-6, 139], [-9, 141], [-10, 148], [-6, 147], [-3, 141]],
];


/** where each city's name sits beside its pin (px), so the close ones in Europe don't overlap */
export const LABEL: Record<string, [number, number, 'left' | 'right' | 'center']> = {
  london: [-10, 4, 'right'],
  amsterdam: [0, -12, 'center'],
  berlin: [10, 4, 'left'],
  ibiza: [0, 18, 'center'],
  detroit: [-10, -6, 'right'],
  newyork: [10, 10, 'left'],
};

/** a tour-map city's latitude and longitude (the map runs 80° N to 60° S, 180° W to 180° E) */
export function cityLatLon(c: Pick<City, 'x' | 'y'>): [number, number] {
  return [80 - c.y * 140, c.x * 360 - 180];
}

/** a point on a sphere of radius `r` (y up; 90° W faces +z, the camera, before any turn) */
export function latLonToXYZ(lat: number, lon: number, r = 1): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

/**
 * The globe's turn that brings (lat, lon) to the front: `yaw` about the
 * globe's own axis (applied first), then `tilt` about the screen's x axis.
 */
export function faceTurn(lat: number, lon: number): { yaw: number; tilt: number } {
  const L = (lon * Math.PI) / 180;
  return { yaw: -Math.atan2(Math.cos(L), -Math.sin(L)), tilt: (lat * Math.PI) / 180 };
}

/** the nearest equivalent of angle `to` from `from` (so a turn goes the short way round) */
export function nearestAngle(from: number, to: number): number {
  const full = Math.PI * 2;
  let d = (to - from) % full;
  if (d > Math.PI) d -= full;
  if (d < -Math.PI) d += full;
  return from + d;
}

/**
 * A great-circle arc from a to b (unit vectors), lifted off the surface in
 * the middle: `lift` × the arc's angle, so longer hops fly higher. `n` + 1 points.
 */
export function arcPoints(a: [number, number, number], b: [number, number, number], lift: number, n = 48, r = 1): [number, number, number][] {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const ang = Math.acos(dot);
  const s = Math.sin(ang);
  const out: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wa = s < 1e-6 ? 1 - t : Math.sin((1 - t) * ang) / s;
    const wb = s < 1e-6 ? t : Math.sin(t * ang) / s;
    const h = r * (1 + lift * ang * Math.sin(Math.PI * t));
    out.push([(a[0] * wa + b[0] * wb) * h, (a[1] * wa + b[1] * wb) * h, (a[2] * wa + b[2] * wb) * h]);
  }
  return out;
}

/** evenly spread points on a unit sphere (a Fibonacci lattice): [lat, lon] in degrees */
export function spherePoints(n: number): [number, number][] {
  const out: [number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const lat = (Math.asin(y) * 180) / Math.PI;
    let lon = ((i * golden * 180) / Math.PI) % 360;
    if (lon > 180) lon -= 360;
    out.push([lat, lon]);
  }
  return out;
}

/** is (lat, lon) inside the polygon (a ray cast in lat/lon: fine for outlines this rough) */
export function inPolygon(lat: number, lon: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ai, oi] = poly[i];
    const [aj, oj] = poly[j];
    if (ai > lat !== aj > lat && lon < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) inside = !inside;
  }
  return inside;
}

/** is (lat, lon) on land, by the outlines */
export function onLand(lat: number, lon: number): boolean {
  return LAND.some((p) => inPolygon(lat, lon, p));
}
