import * as THREE from 'three';
import { isOnRoad, type City } from '../core/city';
import { damp, dampAngle } from '../core/math';
import { CURB } from './cityMesh';
import { circlePushes, circleVsCircle, type Box2 } from './collide';
import type { Traffic } from './Traffic';

/** Builds a simple low-poly person. */
export function personMesh(clothes: number, skin: number, opts: { vest?: boolean; bag?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: clothes, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, name?: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    if (name) m.name = name;
    g.add(m);
    return m;
  };
  add(new THREE.CapsuleGeometry(0.24, 0.5, 4, 10), cloth, 0, 1.12, 0, 'torso');
  add(new THREE.SphereGeometry(0.19, 14, 10), skinMat, 0, 1.64, 0, 'head');
  for (const side of [-1, 1]) {
    const leg = add(new THREE.CapsuleGeometry(0.1, 0.62, 4, 8).translate(0, -0.38, 0), cloth, side * 0.12, 0.82, 0, side < 0 ? 'legL' : 'legR');
    leg.userData.side = side;
    const arm = add(new THREE.CapsuleGeometry(0.075, 0.5, 4, 8).translate(0, -0.3, 0), cloth, side * 0.32, 1.4, 0, side < 0 ? 'armL' : 'armR');
    arm.userData.side = side;
  }
  if (opts.vest) {
    const hi = new THREE.MeshStandardMaterial({ color: 0xd7ff3a, emissive: 0x3a4a00, roughness: 0.5 });
    add(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 12), hi, 0, 1.25, 0);
    add(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 12), hi, 0, 1.0, 0);
  }
  if (opts.bag) {
    add(new THREE.BoxGeometry(0.42, 0.45, 0.2), new THREE.MeshStandardMaterial({ color: 0xc81f2a, roughness: 0.6 }), 0, 1.15, -0.28);
  }
  return g;
}

export function animateWalk(g: THREE.Group, phase: number, amount: number) {
  for (const c of g.children) {
    const side = c.userData.side as number | undefined;
    if (side === undefined) continue;
    const isLeg = c.name.startsWith('leg');
    c.rotation.x = Math.sin(phase) * amount * (isLeg ? 0.7 : -0.6) * side;
  }
}

export class Walker {
  readonly group: THREE.Group;
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  private phase = 0;
  private y = 0;
  readonly r = 0.35;

  constructor() {
    this.group = personMesh(0x2f6b3a, 0xe0ac7e, { vest: true, bag: true });
  }

  place(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
  }

  /** Moves relative to the camera yaw. `mx`/`mz` are strafe and forward input in -1..1. */
  step(dt: number, mx: number, mz: number, sprint: boolean, camYaw: number, city: City, traffic: Traffic, boxes: Box2[], vehicle: { x: number; z: number; r: number }[]) {
    const len = Math.hypot(mx, mz);
    const target = len > 0.1 ? (sprint ? 6.2 : 3.4) : 0;
    this.speed = damp(this.speed, target, 10, dt);
    if (len > 0.1) {
      // Camera looks along (sin yaw, cos yaw); right of that is (-cos, sin).
      const fx = Math.sin(camYaw);
      const fz = Math.cos(camYaw);
      const dx = (fx * mz - fz * mx) / len;
      const dz = (fz * mz + fx * mx) / len;
      this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 14, dt);
    }
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    for (const p of circlePushes(city, this.x, this.z, this.r, boxes)) {
      this.x += p.nx * p.depth;
      this.z += p.nz * p.depth;
    }
    for (const car of traffic.cars) {
      if (Math.abs(car.x - this.x) > 10 || Math.abs(car.z - this.z) > 10) continue;
      for (const b of traffic.circles(car)) {
        const p = circleVsCircle(this.x, this.z, this.r, b.x, b.z, b.r);
        if (p) {
          this.x += p.nx * p.depth;
          this.z += p.nz * p.depth;
        }
      }
    }
    for (const b of vehicle) {
      const p = circleVsCircle(this.x, this.z, this.r, b.x, b.z, b.r);
      if (p) {
        this.x += p.nx * p.depth;
        this.z += p.nz * p.depth;
      }
    }
    this.phase += dt * this.speed * 2.6;
  }

  render(dt: number) {
    this.y = damp(this.y, isOnRoad(this.x, this.z) ? 0 : CURB, 14, dt);
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading;
    animateWalk(this.group, this.phase, Math.min(1, this.speed / 3));
  }
}
