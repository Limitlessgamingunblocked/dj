/*
 * Who's on stage with you (Section 8.4–8.5).
 *   The VIP crew: friends and dancers who gather behind the booth as your
 *   fame grows, a couple at first, a full crew by the warehouse, a stage
 *   party at the festival. They dance with the music, film you, cheer on the
 *   drops and hold phone lights up in the breakdowns (the crowd's 'vip' role).
 *   The staff: security at the front of the stage, the lighting tech at the
 *   desk, the bar staff.
 * Venues give the places; the career's tier (set before a venue is built)
 * says how many of the crew turn up.
 */
import * as THREE from 'three';
import { Crowd, type CrowdSpot } from './crowd';

let tier = 1;

/** the fame tier the next venue is built for */
export function setCrewTier(t: number): void {
  tier = Math.max(1, Math.min(7, Math.round(t)));
}

export function getCrewTier(): number {
  return tier;
}

/** how many of the crew come to a set at this tier (at most `max`, the places the stage has) */
export function crewSize(t: number, max: number): number {
  const want = [0, 1, 3, 5, 7, 9, 12, 14][Math.max(1, Math.min(7, t))];
  return Math.min(max, want);
}

/** the crew for the current tier, standing in the first of `spots` (closest first) */
export function vipCrew(spots: CrowdSpot[], seed: number, clothes: string[], booth = new THREE.Vector3(0, 0, 0.2)): Crowd | null {
  const n = crewSize(tier, spots.length);
  if (!n) return null;
  return new Crowd(
    spots.slice(0, n).map((s) => ({ ...s, role: 'vip' as const })),
    { seed, clothes, phones: 0.45, drinks: 0.6, booth, regulars: false },
  );
}

/** spots in two loose arcs behind and beside the booth: (x, z) on a stage at height y */
export function crewArc(y: number, r0: number, r1: number, z0: number, spread = 2.4): CrowdSpot[] {
  const out: CrowdSpot[] = [];
  const rows = [
    { r: r0, n: 7 },
    { r: r1, n: 9 },
  ];
  // nearest first: the inner arc fills before the outer
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const t = (i / (row.n - 1) - 0.5) * spread;
      out.push({ x: Math.sin(t) * row.r, z: z0 + Math.cos(t) * row.r * 0.55, y });
    }
  }
  // closest to the DJ first, alternating sides
  return out.sort((a, b) => Math.abs(a.x) + a.z * 0.3 - (Math.abs(b.x) + b.z * 0.3));
}

/** security at the front of the stage, facing the crowd, arms folded */
export function security(spots: { x: number; z: number; y?: number }[], seed: number): Crowd {
  return new Crowd(
    spots.map((p) => ({ ...p, face: Math.PI, role: 'security' as const })),
    { seed, clothes: ['#0b0b0c', '#111214'], regulars: false, shadows: true },
  );
}

/**
 * People at a bar (a barCounter group, placed and turned): staff behind the
 * counter facing out, and a few regulars leaning on it with a drink, who only
 * start dancing when the room's really going (Section 8.2's bar-leaner).
 */
export function atBar(bar: THREE.Object3D, len: number, seed: number, o: { staff?: number; leaners?: number; clothes?: string[] } = {}): Crowd {
  const yaw = bar.rotation.y;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (x: number, z: number) => ({ x: bar.position.x + x * c + z * s, z: bar.position.z - x * s + z * c, y: bar.position.y });
  const spots: CrowdSpot[] = [];
  const staff = o.staff ?? 1;
  const leaners = o.leaners ?? 2;
  for (let i = 0; i < staff; i++) spots.push({ ...at(((i + 0.5) / staff - 0.5) * len * 0.7, -0.62), face: yaw, role: 'bartender' });
  for (let i = 0; i < leaners; i++) spots.push({ ...at(((i + 0.5) / leaners - 0.5) * len * 0.8 + 0.3, 0.62), face: yaw + Math.PI, role: 'barlean' });
  return new Crowd(spots, { seed, clothes: o.clothes ?? ['#111214', '#f2efe8', '#1b1d22', '#2a3a5a', '#5a1e22'], regulars: false, drinks: 1 });
}

/** the lighting tech at a desk beside the stage: hands on the desk (the 'dj' pose) */
export function lightingTech(at: { x: number; z: number; y?: number; face: number }, seed: number): Crowd {
  return new Crowd([{ ...at, role: 'dj' }], { seed, clothes: ['#0e0e10'], regulars: false });
}
