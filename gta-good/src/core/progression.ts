import { clamp } from './math';
import { VEHICLES, type VehicleId } from './vehicle';

export type CertId = 'evoc' | 'responder' | 'als';

export const CERTS: Record<CertId, { name: string; blurb: string }> = {
  evoc: { name: 'EVOC', blurb: 'Emergency Vehicle Operator Course — lights-and-siren driving.' },
  responder: { name: 'First Responder', blurb: 'Field triage, auto-injectors, inhalers and bleeding control.' },
  als: { name: 'Advanced Life Support', blurb: 'Cardiac arrest care. Unlocks the AED.' },
};

export type UpgradeId = 'steady' | 'siren' | 'ride' | 'triage';

export interface Upgrade {
  id: UpgradeId;
  name: string;
  blurb: string;
  costs: number[];
}

export const UPGRADES: Upgrade[] = [
  { id: 'steady', name: 'Steady Hands', blurb: 'Less reticle sway when placing injectors, pads and masks.', costs: [250, 500, 900] },
  { id: 'siren', name: 'Smart Siren & Beacons', blurb: 'Traffic notices you from further away and yields sooner.', costs: [300, 650, 1100] },
  { id: 'ride', name: 'Ride Stabilizer', blurb: 'Cabin damping and a vacuum mattress: less g-force reaches the patient.', costs: [350, 750] },
  { id: 'triage', name: 'Rapid Triage Kit', blurb: 'Pulse oximeter and penlight: vital checks take less time.', costs: [200, 450] },
];

export interface Profile {
  version: 1;
  merit: number;
  totalMerit: number;
  helped: number;
  certs: CertId[];
  vehicles: VehicleId[];
  vehicle: VehicleId;
  upgrades: Record<UpgradeId, number>;
  /** Best result per mission: merit earned. */
  missions: Record<string, number>;
  volume: number;
}

export function newProfile(): Profile {
  return {
    version: 1,
    merit: 0,
    totalMerit: 0,
    helped: 0,
    certs: [],
    vehicles: ['van'],
    vehicle: 'van',
    upgrades: { steady: 0, siren: 0, ride: 0, triage: 0 },
    missions: {},
    volume: 0.7,
  };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Reads a saved profile, dropping anything unknown or malformed. */
export function parseProfile(raw: unknown): Profile {
  const p = newProfile();
  if (!raw || typeof raw !== 'object') return p;
  const o = raw as Record<string, unknown>;
  p.merit = Math.max(0, Math.floor(num(o.merit, 0)));
  p.totalMerit = Math.max(p.merit, Math.floor(num(o.totalMerit, p.merit)));
  p.helped = Math.max(0, Math.floor(num(o.helped, 0)));
  if (Array.isArray(o.certs)) p.certs = o.certs.filter((c): c is CertId => typeof c === 'string' && c in CERTS);
  if (Array.isArray(o.vehicles)) {
    const ids = VEHICLES.map((v) => v.id as string);
    p.vehicles = Array.from(new Set(['van', ...o.vehicles.filter((v): v is VehicleId => typeof v === 'string' && ids.includes(v))])) as VehicleId[];
  }
  if (typeof o.vehicle === 'string' && p.vehicles.includes(o.vehicle as VehicleId)) p.vehicle = o.vehicle as VehicleId;
  if (o.upgrades && typeof o.upgrades === 'object') {
    const u = o.upgrades as Record<string, unknown>;
    for (const up of UPGRADES) p.upgrades[up.id] = clamp(Math.floor(num(u[up.id], 0)), 0, up.costs.length);
  }
  if (o.missions && typeof o.missions === 'object') {
    for (const [k, v] of Object.entries(o.missions as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) p.missions[k] = v;
  }
  p.volume = clamp(num(o.volume, 0.7), 0, 1);
  return p;
}

export function earn(p: Profile, merit: number): void {
  const m = Math.round(merit);
  p.merit = Math.max(0, p.merit + m);
  if (m > 0) p.totalMerit += m;
}

export function buyVehicle(p: Profile, id: VehicleId): boolean {
  const v = VEHICLES.find((x) => x.id === id);
  if (!v || p.vehicles.includes(id) || p.merit < v.cost) return false;
  p.merit -= v.cost;
  p.vehicles.push(id);
  return true;
}

export function nextUpgradeCost(p: Profile, id: UpgradeId): number | null {
  const up = UPGRADES.find((u) => u.id === id)!;
  return up.costs[p.upgrades[id]] ?? null;
}

export function buyUpgrade(p: Profile, id: UpgradeId): boolean {
  const cost = nextUpgradeCost(p, id);
  if (cost === null || p.merit < cost) return false;
  p.merit -= cost;
  p.upgrades[id] += 1;
  return true;
}

export const hasCerts = (p: Profile, need: readonly CertId[]) => need.every((c) => p.certs.includes(c));

export function grantCert(p: Profile, c: CertId): boolean {
  if (p.certs.includes(c)) return false;
  p.certs.push(c);
  return true;
}

/** Radius (m) within which traffic yields to the siren. */
export const sirenRange = (p: Profile) => 55 + 22 * p.upgrades.siren;
/** Multiplier on ride damage from the stabilizer upgrade. */
export const rideMultiplier = (p: Profile) => 1 - 0.22 * p.upgrades.ride;
/** Seconds per vital check. */
export const checkSeconds = (p: Profile) => 1.4 - 0.4 * p.upgrades.triage;

export function rank(totalMerit: number): string {
  const ranks: [number, string][] = [
    [0, 'Volunteer'],
    [400, 'EMT Trainee'],
    [1200, 'EMT'],
    [2500, 'Paramedic'],
    [4500, 'Senior Paramedic'],
    [7500, 'Field Supervisor'],
    [12000, 'City Guardian'],
  ];
  let r = ranks[0][1];
  for (const [m, name] of ranks) if (totalMerit >= m) r = name;
  return r;
}
