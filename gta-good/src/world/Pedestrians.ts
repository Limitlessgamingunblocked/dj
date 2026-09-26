import * as THREE from 'three';
import { SW, sidewalkRing, type Block, type City } from '../core/city';
import { mulberry32, pick, range } from '../core/rng';
import type { Vec2 } from '../core/math';
import { CURB } from './cityMesh';

export interface Ped {
  block: Block;
  ring: Vec2[];
  per: number;
  u: number;
  dir: number;
  speed: number;
  /** Sideways offset from the sidewalk centre line (positive = towards the road). */
  side: number;
  sideTarget: number;
  dodgeT: number;
  downT: number;
  x: number;
  z: number;
  heading: number;
  clothes: number;
  skin: number;
  phase: number;
}

const CLOTHES = [0x2d4f7c, 0x8b2f3c, 0x3c6e47, 0xd9a441, 0x5a5a66, 0xe0e0e0, 0x6b4e9b, 0x1f1f24, 0xc76b2b, 0x3a8ca8];
const SKIN = [0xf1c9a5, 0xe0ac7e, 0xc68642, 0x8d5524, 0x5c3a21, 0xffdbac];

function ringPoint(ring: Vec2[], u: number): { p: Vec2; d: Vec2 } {
  let rest = u;
  for (let k = 0; k < 4; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (rest <= len || k === 3) {
      const t = Math.min(1, rest / len);
      return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, d: { x: (b.x - a.x) / len, z: (b.z - a.z) / len } };
    }
    rest -= len;
  }
  return { p: ring[0], d: { x: 1, z: 0 } };
}

export class Pedestrians {
  readonly peds: Ped[] = [];
  readonly group = new THREE.Group();
  private bodies: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private col = new THREE.Color();

  constructor(city: City, count = 130) {
    const r = mulberry32(city.seed + 5);
    const blocks = city.blocks.flat().filter((b) => b.zone !== 'rural');
    for (let k = 0; k < count; k++) {
      // Busier sidewalks downtown.
      let block = pick(r, blocks);
      if (block.zone !== 'downtown' && r() < 0.35) block = pick(r, blocks.filter((b) => b.zone === 'downtown'));
      const ring = sidewalkRing(block);
      const per = 2 * (ring[1].x - ring[0].x) + 2 * (ring[3].z - ring[0].z);
      this.peds.push({
        block,
        ring,
        per,
        u: range(r, 0, per),
        dir: r() < 0.5 ? 1 : -1,
        speed: range(r, 1.1, 1.7),
        side: range(r, -1.2, 1.2),
        sideTarget: 0,
        dodgeT: 0,
        downT: 0,
        x: 0,
        z: 0,
        heading: 0,
        clothes: pick(r, CLOTHES),
        skin: pick(r, SKIN),
        phase: range(r, 0, 10),
      });
      this.peds[k].sideTarget = this.peds[k].side;
    }
    this.bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.26, 0.85, 4, 8).translate(0, 0.7, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), count);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.19, 10, 8).translate(0, 1.55, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), count);
    for (const m of [this.bodies, this.heads]) {
      m.castShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.peds.forEach((p, k) => {
      this.bodies.setColorAt(k, this.col.set(p.clothes));
      this.heads.setColorAt(k, this.col.set(p.skin));
    });
  }

  /** `threat` is the player's vehicle position and velocity when driving. */
  update(dt: number, threat: { x: number; z: number; vx: number; vz: number } | null) {
    for (const p of this.peds) {
      if (p.downT > 0) {
        p.downT -= dt;
        continue;
      }
      p.u = (p.u + p.dir * p.speed * dt + p.per) % p.per;
      const { p: pos, d } = ringPoint(p.ring, p.u);
      // Outward normal of the ring (NW → NE → SE → SW, x east, z south) points to the road.
      const nx = d.z;
      const nz = -d.x;
      if (threat) {
        const sp = Math.hypot(threat.vx, threat.vz);
        const dx = p.x - threat.x;
        const dz = p.z - threat.z;
        const dd = Math.hypot(dx, dz);
        if (sp > 4 && dd < 12 && (dx * threat.vx + dz * threat.vz) / (sp * dd + 1e-6) > 0.3 && p.dodgeT <= 0) {
          // Step back towards the buildings, away from the car.
          p.dodgeT = 2.5;
          p.sideTarget = -SW / 2 - 1.5;
        }
      }
      if (p.dodgeT > 0) {
        p.dodgeT -= dt;
        if (p.dodgeT <= 0) p.sideTarget = 0;
      }
      p.side += (p.sideTarget - p.side) * Math.min(1, dt * (p.dodgeT > 0 ? 8 : 1.5));
      p.x = pos.x + nx * p.side;
      p.z = pos.z + nz * p.side;
      p.heading = Math.atan2(d.x * p.dir, d.z * p.dir);
      p.phase += dt * p.speed * 4;
    }
  }

  knockDown(p: Ped) {
    p.downT = 4;
    p.dodgeT = 0;
    p.sideTarget = -SW / 2;
  }

  render() {
    const { m4, q, e, v, one } = this;
    this.peds.forEach((p, k) => {
      if (p.downT > 0) {
        e.set(Math.PI / 2, p.heading, 0, 'YXZ');
        q.setFromEuler(e);
        v.set(p.x, CURB + 0.3, p.z);
      } else {
        const bob = Math.abs(Math.sin(p.phase)) * 0.06;
        e.set(0, p.heading, Math.sin(p.phase) * 0.04, 'YXZ');
        q.setFromEuler(e);
        v.set(p.x, CURB + bob, p.z);
      }
      m4.compose(v, q, one);
      this.bodies.setMatrixAt(k, m4);
      this.heads.setMatrixAt(k, m4);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}
