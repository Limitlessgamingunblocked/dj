import * as THREE from 'three';
import { isOnRoad, type City } from '../core/city';
import { damp, forward } from '../core/math';
import { bodyCircles, newVehicleState, stepVehicle, type DriveInput, type VehicleSpec, type VehicleState } from '../core/vehicle';
import { canvasTexture } from './geo';
import { CURB } from './cityMesh';
import { circlePushes, circleVsCircle, type Box2 } from './collide';
import type { Car, Traffic } from './Traffic';

export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
  mass: number;
}

export interface StepResult {
  /** Largest speed change from an impact this step (m/s). */
  jolt: number;
  hitCar: Car | null;
}

let starTex: THREE.Texture | null = null;
function starOfLife(): THREE.Texture {
  if (starTex) return starTex;
  starTex = canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.clearRect(0, 0, 256, 256);
      ctx.translate(128, 128);
      ctx.fillStyle = '#1d5fbf';
      for (let k = 0; k < 3; k++) {
        ctx.save();
        ctx.rotate((k * Math.PI) / 3);
        ctx.fillRect(-22, -104, 44, 208);
        ctx.restore();
      }
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(0, 80);
      ctx.lineTo(0, -80);
      ctx.stroke();
      ctx.beginPath();
      for (let y = -60; y <= 60; y += 2) ctx.lineTo(Math.sin(y / 11) * 14, y);
      ctx.stroke();
    },
    false,
  );
  return starTex;
}

function livery(text: string, stripe: number): THREE.Texture {
  return canvasTexture(
    512,
    128,
    (ctx) => {
      ctx.clearRect(0, 0, 512, 128);
      const c = `#${stripe.toString(16).padStart(6, '0')}`;
      ctx.fillStyle = c;
      for (let x = 0; x < 512; x += 64) {
        ctx.fillRect(x, 70, 32, 26);
        ctx.fillStyle = ctx.fillStyle === c ? '#f2c21b' : c;
      }
      ctx.fillStyle = c;
      ctx.font = '700 58px "Barlow Condensed", Arial Narrow, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, 256, 56);
    },
    false,
  );
}

export class PlayerVehicle {
  spec: VehicleSpec;
  state: VehicleState;
  readonly group = new THREE.Group();
  siren = false;
  sirenMode: 'wail' | 'yelp' = 'wail';
  private body = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private red: THREE.MeshStandardMaterial[] = [];
  private blue: THREE.MeshStandardMaterial[] = [];
  private brakeMat!: THREE.MeshStandardMaterial;
  private redLight = new THREE.PointLight(0xff2030, 0, 26, 1.6);
  private blueLight = new THREE.PointLight(0x2050ff, 0, 26, 1.6);
  private wheelSpin = 0;
  private y = 0;

  constructor(spec: VehicleSpec, x: number, z: number, heading: number) {
    this.spec = spec;
    this.state = newVehicleState(x, z, heading);
    this.group.add(this.body);
    this.buildMesh();
  }

  setSpec(spec: VehicleSpec) {
    this.spec = spec;
    this.buildMesh();
  }

  private buildMesh() {
    this.body.clear();
    this.wheels = [];
    this.red = [];
    this.blue = [];
    const s = this.spec;
    const L = s.length;
    const W = s.width;
    const H = s.height;
    const paint = new THREE.MeshStandardMaterial({ color: s.body, roughness: 0.35, metalness: 0.3 });
    const stripe = new THREE.MeshStandardMaterial({ color: s.stripe, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.1, metalness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.8 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.body.add(m);
      return m;
    };
    const base = 0.45;
    const lower = 0.85;
    add(new THREE.BoxGeometry(W, lower, L), paint, 0, base + lower / 2, 0);
    add(new THREE.BoxGeometry(W + 0.02, 0.22, L * 0.98), stripe, 0, base + lower * 0.62, 0);
    add(new THREE.BoxGeometry(W * 1.02, 0.25, 0.3), dark, 0, base + 0.12, L / 2 - 0.1);
    add(new THREE.BoxGeometry(W * 1.02, 0.25, 0.3), dark, 0, base + 0.12, -L / 2 + 0.1);
    const top = base + lower;
    let roofY: number;
    let barZ: number;
    if (s.id === 'van' || s.id === 'airride') {
      const modLen = L * 0.64;
      const modZ = -L / 2 + modLen / 2;
      add(new THREE.BoxGeometry(W, H - top + 0.3, modLen), paint, 0, top + (H - top) / 2, modZ);
      add(new THREE.BoxGeometry(W + 0.02, 0.3, modLen * 0.98), stripe, 0, H - 0.5, modZ);
      const cabLen = L - modLen;
      add(new THREE.BoxGeometry(W * 0.96, 0.8, cabLen * 0.7), paint, 0, top + 0.4, L / 2 - cabLen * 0.45);
      add(new THREE.BoxGeometry(W * 0.9, 0.66, 0.08), glass, 0, top + 0.42, L / 2 - cabLen * 0.1);
      add(new THREE.BoxGeometry(W * 0.98, 0.5, cabLen * 0.5), glass, 0, top + 0.4, L / 2 - cabLen * 0.5);
      roofY = H + 0.15;
      barZ = modZ + modLen / 2 - 0.4;
      // Corner beacons on the module.
      for (const [x, z, isRed] of [[W / 2 - 0.1, -L / 2 + 0.1, true], [-W / 2 + 0.1, -L / 2 + 0.1, false]] as const) {
        const m = new THREE.MeshStandardMaterial({ color: isRed ? 0x550000 : 0x000855, emissive: isRed ? 0xff1020 : 0x1040ff, emissiveIntensity: 0 });
        (isRed ? this.red : this.blue).push(m);
        add(new THREE.BoxGeometry(0.22, 0.3, 0.22), m, x, H - 0.1, z);
      }
      const star = new THREE.MeshBasicMaterial({ map: starOfLife(), transparent: true });
      for (const side of [1, -1]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), star);
        p.position.set((side * W) / 2 + side * 0.02, top + (H - top) * 0.45, modZ - 0.6);
        p.rotation.y = (side * Math.PI) / 2;
        this.body.add(p);
        const lv = new THREE.Mesh(new THREE.PlaneGeometry(modLen * 0.9, modLen * 0.22), new THREE.MeshBasicMaterial({ map: livery('GOOD RESPONSE', s.stripe), transparent: true }));
        lv.position.set((side * W) / 2 + side * 0.025, top + 0.3, modZ + 0.3);
        lv.rotation.y = (side * Math.PI) / 2;
        this.body.add(lv);
      }
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), star);
      back.position.set(0, top + (H - top) * 0.5, -L / 2 - 0.02);
      back.rotation.y = Math.PI;
      this.body.add(back);
    } else {
      const cabLen = L * 0.56;
      add(new THREE.BoxGeometry(W * 0.94, H - top, cabLen), glass, 0, top + (H - top) / 2, -L * 0.06);
      add(new THREE.BoxGeometry(W * 0.95, 0.08, cabLen * 0.9), paint, 0, H, -L * 0.06);
      roofY = H + 0.1;
      barZ = -L * 0.06 + cabLen * 0.25;
      const lv = new THREE.MeshBasicMaterial({ map: livery('RAPID RESPONSE', s.stripe), transparent: true });
      for (const side of [1, -1]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.7, L * 0.17), lv);
        p.position.set((side * W) / 2 + side * 0.02, base + lower * 0.55, 0);
        p.rotation.y = (side * Math.PI) / 2;
        this.body.add(p);
      }
    }
    // Light bar: red on the left, blue on the right.
    add(new THREE.BoxGeometry(W * 0.84, 0.12, 0.42), dark, 0, roofY - 0.06, barZ);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const isRed = side < 0;
        const m = new THREE.MeshStandardMaterial({ color: isRed ? 0x660008 : 0x000c66, emissive: isRed ? 0xff1020 : 0x1040ff, emissiveIntensity: 0, roughness: 0.3 });
        (isRed ? this.red : this.blue).push(m);
        add(new THREE.BoxGeometry(W * 0.19, 0.16, 0.36), m, side * (W * 0.12 + k * W * 0.2), roofY + 0.06, barZ);
      }
    }
    const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 0.8 });
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x660000, emissive: 0xff1010, emissiveIntensity: 0.2 });
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.4, 0.18, 0.06), head, side * (W / 2 - 0.35), base + lower * 0.7, L / 2 + 0.01);
      add(new THREE.BoxGeometry(0.3, 0.28, 0.06), this.brakeMat, side * (W / 2 - 0.25), base + lower * 0.7, -L / 2 - 0.01);
    }
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 16).rotateZ(Math.PI / 2);
    const tyre = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.7, roughness: 0.3 });
    const wz = s.wheelbase / 2;
    for (const z of [wz, -wz]) {
      for (const side of [-1, 1]) {
        const w = new THREE.Group();
        const t = new THREE.Mesh(wheelGeo, tyre);
        t.castShadow = true;
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.34, 10).rotateZ(Math.PI / 2), rimMat);
        w.add(t, rim);
        w.position.set(side * (W / 2 - 0.12), 0.42, z);
        w.userData.front = z > 0;
        this.body.add(w);
        this.wheels.push(w as unknown as THREE.Mesh);
      }
    }
    this.redLight.position.set(-0.5, roofY + 0.4, barZ);
    this.blueLight.position.set(0.5, roofY + 0.4, barZ);
    this.body.add(this.redLight, this.blueLight);
  }

  get pos() {
    return { x: this.state.x, z: this.state.z };
  }

  circles() {
    return bodyCircles(this.state, this.spec);
  }

  /** Physics step with collisions against buildings, extra boxes, traffic and loose bodies. */
  step(dt: number, input: DriveInput, city: City, traffic: Traffic, boxes: Box2[], loose: Body[]): StepResult {
    const s = this.state;
    stepVehicle(s, this.spec, input, dt);
    let jolt = 0;
    let hitCar: Car | null = null;
    const applyPush = (nx: number, nz: number, depth: number, restitution: number) => {
      s.x += nx * depth;
      s.z += nz * depth;
      const vn = s.vx * nx + s.vz * nz;
      if (vn < 0) {
        const dv = -vn * (1 + restitution);
        s.vx += nx * dv;
        s.vz += nz * dv;
        jolt = Math.max(jolt, dv);
      }
    };
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.circles()) {
        for (const p of circlePushes(city, c.x, c.z, c.r, boxes)) applyPush(p.nx, p.nz, p.depth, 0.15);
      }
    }
    for (const car of traffic.cars) {
      if (Math.abs(car.x - s.x) > 14 || Math.abs(car.z - s.z) > 14) continue;
      for (const a of this.circles()) {
        for (const b of traffic.circles(car)) {
          const p = circleVsCircle(a.x, a.z, a.r, b.x, b.z, b.r);
          if (!p) continue;
          applyPush(p.nx, p.nz, p.depth, 0.1);
          hitCar = car;
        }
      }
    }
    for (const b of loose) {
      for (const a of this.circles()) {
        const p = circleVsCircle(a.x, a.z, a.r, b.x, b.z, b.r);
        if (!p) continue;
        // Light objects get shoved; the vehicle loses a little speed.
        const vrel = (s.vx - b.vx) * -p.nx + (s.vz - b.vz) * -p.nz;
        b.x -= p.nx * p.depth;
        b.z -= p.nz * p.depth;
        if (vrel > 0) {
          const share = 1 / (1 + b.mass / 1500);
          b.vx += -p.nx * vrel * 1.3 * share;
          b.vz += -p.nz * vrel * 1.3 * share;
          s.vx -= -p.nx * vrel * (1 - share) * 0.8;
          s.vz -= -p.nz * vrel * (1 - share) * 0.8;
          jolt = Math.max(jolt, vrel * (1 - share));
        }
      }
    }
    if (jolt > 0) {
      const f = forward(s.heading);
      s.speed = s.vx * f.x + s.vz * f.z;
    }
    return { jolt, hitCar };
  }

  render(dt: number, time: number, braking: boolean) {
    const s = this.state;
    this.y = damp(this.y, isOnRoad(s.x, s.z) ? 0 : CURB, 12, dt);
    this.group.position.set(s.x, this.y, s.z);
    this.group.rotation.y = s.heading;
    this.body.rotation.z = -s.gLat * 0.05;
    this.body.rotation.x = s.gLong * 0.035;
    this.wheelSpin += (s.speed * dt) / 0.42;
    for (const w of this.wheels) {
      w.rotation.set(this.wheelSpin, w.userData.front ? s.steer : 0, 0, 'YXZ');
    }
    this.brakeMat.emissiveIntensity = braking ? 1.6 : 0.25;
    if (this.siren) {
      const rate = this.sirenMode === 'yelp' ? 12 : 7;
      const ph = Math.floor(time * rate) % 4;
      const redOn = ph === 0 || ph === 2 ? 1 : 0;
      const blueOn = ph === 1 || ph === 3 ? 1 : 0;
      for (const m of this.red) m.emissiveIntensity = redOn * 3;
      for (const m of this.blue) m.emissiveIntensity = blueOn * 3;
      this.redLight.intensity = redOn * 40;
      this.blueLight.intensity = blueOn * 40;
    } else {
      for (const m of [...this.red, ...this.blue]) m.emissiveIntensity = 0;
      this.redLight.intensity = 0;
      this.blueLight.intensity = 0;
    }
  }
}
