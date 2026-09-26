import { clamp, damp, forward, rightOf } from './math';

export type VehicleId = 'van' | 'suv' | 'airride' | 'interceptor';

export interface VehicleSpec {
  id: VehicleId;
  name: string;
  blurb: string;
  cost: number;
  /** m/s */
  maxSpeed: number;
  accel: number;
  brake: number;
  grip: number;
  wheelbase: number;
  /** Multiplier on ride damage to patients (lower is gentler). */
  comfort: number;
  /** Patients or evacuees it can carry. */
  capacity: number;
  length: number;
  width: number;
  height: number;
  body: number;
  stripe: number;
}

export const VEHICLES: VehicleSpec[] = [
  {
    id: 'van',
    name: 'Type II Ambulance',
    blurb: 'Dependable city ambulance. Two stretchers, soft enough on the corners.',
    cost: 0,
    maxSpeed: 36,
    accel: 11,
    brake: 20,
    grip: 7.5,
    wheelbase: 3.6,
    comfort: 1,
    capacity: 2,
    length: 6,
    width: 2.4,
    height: 2.7,
    body: 0xf4f4f0,
    stripe: 0xd8262e,
  },
  {
    id: 'suv',
    name: 'Rapid Response SUV',
    blurb: 'Fast first-on-scene unit. Quick and nimble, but only one seat for a patient and a firm ride.',
    cost: 600,
    maxSpeed: 46,
    accel: 13,
    brake: 24,
    grip: 9,
    wheelbase: 2.9,
    comfort: 1.35,
    capacity: 1,
    length: 4.9,
    width: 2.1,
    height: 1.9,
    body: 0xf5d31c,
    stripe: 0x1f5fd6,
  },
  {
    id: 'airride',
    name: 'Air-Ride Mobile ICU',
    blurb: 'Air suspension and a critical-care cabin. Gentlest on patients and carries four.',
    cost: 1200,
    maxSpeed: 38,
    accel: 10.5,
    brake: 21,
    grip: 8,
    wheelbase: 3.9,
    comfort: 0.55,
    capacity: 4,
    length: 7,
    width: 2.5,
    height: 3,
    body: 0xf6f7f8,
    stripe: 0x14a36b,
  },
  {
    id: 'interceptor',
    name: 'ALS Interceptor',
    blurb: 'Top-tier advanced life support unit: fast, stable, two stretchers.',
    cost: 2400,
    maxSpeed: 50,
    accel: 14,
    brake: 26,
    grip: 10,
    wheelbase: 3.3,
    comfort: 0.7,
    capacity: 2,
    length: 5.6,
    width: 2.3,
    height: 2.3,
    body: 0x1d2733,
    stripe: 0xffb81c,
  },
];

export const vehicleById = (id: VehicleId) => VEHICLES.find((v) => v.id === id)!;

export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

export interface VehicleState {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  steer: number;
  /** Signed forward speed (m/s). */
  speed: number;
  /** Smoothed accelerations felt in the cabin (g). */
  gLat: number;
  gLong: number;
}

export function newVehicleState(x: number, z: number, heading: number): VehicleState {
  return { x, z, heading, vx: 0, vz: 0, steer: 0, speed: 0, gLat: 0, gLong: 0 };
}

const G = 9.81;

/** Arcade bicycle-model step. Integrates position; collisions are resolved by the caller. */
export function stepVehicle(s: VehicleState, spec: VehicleSpec, input: DriveInput, dt: number): void {
  const f = forward(s.heading);
  const ovx = s.vx;
  const ovz = s.vz;
  const vf0 = s.vx * f.x + s.vz * f.z;
  // Limit steering so cornering force stays within what the tyres can give (more when drifting).
  const aMax = spec.grip * 1.3 * (input.handbrake ? 1.7 : 1);
  const maxSteer = Math.min(0.62, Math.atan((aMax * spec.wheelbase) / Math.max(1, vf0 * vf0)));
  s.steer = damp(s.steer, clamp(input.steer, -1, 1) * maxSteer, 10, dt);
  s.heading += ((vf0 * Math.tan(s.steer)) / spec.wheelbase) * dt;

  // Velocity seen from the new heading: the sideways part is slip that the tyres scrub off.
  const nf = forward(s.heading);
  const nr = rightOf(nf);
  let vf = s.vx * nf.x + s.vz * nf.z;
  let vr = s.vx * nr.x + s.vz * nr.z;

  if (input.throttle > 0) {
    const room = Math.max(0, 1 - vf / spec.maxSpeed);
    vf += spec.accel * input.throttle * Math.sqrt(room) * dt;
  }
  if (input.brake > 0) {
    if (vf > 0.4) vf = Math.max(0, vf - spec.brake * input.brake * dt);
    else vf = Math.max(-9, vf - spec.accel * 0.6 * input.brake * dt);
  }
  if (input.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 7 * dt);
  // Rolling resistance and air drag.
  vf -= vf * (0.05 + 0.002 * Math.abs(vf)) * dt;
  if (input.throttle === 0 && input.brake === 0 && Math.abs(vf) < 0.3) vf = 0;

  const grip = input.handbrake ? 1.6 : spec.grip;
  vr *= Math.exp(-grip * dt);

  s.vx = nf.x * vf + nr.x * vr;
  s.vz = nf.z * vf + nr.z * vr;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.speed = vf;

  // Cabin accelerations: longitudinal change plus centripetal from the turn.
  const ax = (s.vx - ovx) / dt;
  const az = (s.vz - ovz) / dt;
  const along = (ax * nf.x + az * nf.z) / G;
  const lat = (ax * nr.x + az * nr.z) / G;
  s.gLong = damp(s.gLong, clamp(along, -3, 3), 8, dt);
  s.gLat = damp(s.gLat, clamp(lat, -3, 3), 8, dt);
}

/** Two circles along the body, used for collisions. */
export function bodyCircles(s: VehicleState, spec: VehicleSpec): { x: number; z: number; r: number }[] {
  const f = forward(s.heading);
  const off = spec.length / 2 - spec.width / 2;
  const r = spec.width / 2 + 0.1;
  return [
    { x: s.x + f.x * off, z: s.z + f.z * off, r },
    { x: s.x - f.x * off, z: s.z - f.z * off, r },
  ];
}
