import * as THREE from 'three';
import { LANE, P, RW } from '../core/city';
import type { Vec2 } from '../core/math';
import type { Node } from '../core/route';
import { CURB } from './cityMesh';
import type { Box2 } from './collide';
import type { Body } from './PlayerVehicle';

const beaconGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
const ringGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);

function beaconMaterial(color: number) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, strength: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 color; uniform float time; uniform float strength; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.6) * (0.7 + 0.3 * sin(time * 4.0)) * 0.6 * strength; gl_FragColor = vec4(color * 1.4, a); }',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export interface Beacon {
  group: THREE.Group;
  pos: Vec2;
  radius: number;
  color: number;
  setColor(c: number): void;
  setPos(p: Vec2): void;
  visible: boolean;
}

export interface Debris extends Body {
  mesh: THREE.Object3D;
  home: Vec2;
}

export class Markers {
  readonly group = new THREE.Group();
  private beacons: { b: Beacon; mat: THREE.ShaderMaterial; ring: THREE.Mesh }[] = [];
  readonly boxes: Box2[] = [];
  private roadblocks: { meshes: THREE.Object3D[]; boxes: Box2[] }[] = [];
  readonly debris: Debris[] = [];
  private fires: { group: THREE.Group; flames: THREE.Mesh[]; smoke: THREE.Sprite[] }[] = [];
  private smokeTex: THREE.Texture;

  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    this.smokeTex = new THREE.CanvasTexture(c);
  }

  beacon(pos: Vec2, color: number, radius = 6, height = 70): Beacon {
    const group = new THREE.Group();
    const mat = beaconMaterial(color);
    const pillar = new THREE.Mesh(beaconGeo, mat);
    pillar.scale.set(radius * 0.25, height, radius * 0.25);
    pillar.renderOrder = 5;
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.scale.setScalar(radius);
    ring.position.y = CURB + 0.08;
    group.add(pillar, ring);
    group.position.set(pos.x, 0, pos.z);
    this.group.add(group);
    const b: Beacon = {
      group,
      pos: { ...pos },
      radius,
      color,
      setColor: (c: number) => {
        b.color = c;
        mat.uniforms.color.value.set(c);
        ringMat.color.set(c);
      },
      setPos: (p: Vec2) => {
        b.pos = { ...p };
        group.position.set(p.x, 0, p.z);
      },
      get visible() {
        return group.visible;
      },
      set visible(v: boolean) {
        group.visible = v;
      },
    };
    this.beacons.push({ b, mat, ring });
    return b;
  }

  beaconsList(): Beacon[] {
    return this.beacons.map((e) => e.b);
  }

  removeBeacon(b: Beacon) {
    const i = this.beacons.findIndex((e) => e.b === b);
    if (i < 0) return;
    this.group.remove(b.group);
    this.beacons[i].mat.dispose();
    this.beacons.splice(i, 1);
  }

  /** Barriers and cones across a street segment. */
  roadblock(a: Node, b: Node): void {
    const meshes: THREE.Object3D[] = [];
    const boxes: Box2[] = [];
    const mx = ((a[0] + b[0]) / 2) * P;
    const mz = ((a[1] + b[1]) / 2) * P;
    const alongX = a[1] === b[1];
    const stripeTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 32;
      const ctx = c.getContext('2d')!;
      for (let k = 0; k < 8; k++) {
        ctx.fillStyle = k % 2 ? '#ffffff' : '#e3262f';
        ctx.beginPath();
        ctx.moveTo(k * 16, 0);
        ctx.lineTo(k * 16 + 16, 0);
        ctx.lineTo(k * 16, 32);
        ctx.lineTo(k * 16 - 16, 32);
        ctx.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const mat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6 });
    for (const off of [-20, 20]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(RW - 1, 1.1, 0.5), mat);
      bar.position.set(alongX ? mx + off : mx, 0.9, alongX ? mz : mz + off);
      if (alongX) bar.rotation.y = Math.PI / 2;
      bar.castShadow = true;
      this.group.add(bar);
      meshes.push(bar);
      const h = (RW - 1) / 2;
      boxes.push(alongX ? { x0: bar.position.x - 0.4, z0: mz - h, x1: bar.position.x + 0.4, z1: mz + h } : { x0: mx - h, z0: bar.position.z - 0.4, x1: mx + h, z1: bar.position.z + 0.4 });
      for (const leg of [-h + 0.5, h - 0.5]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0x333333 }));
        l.position.set(alongX ? bar.position.x : mx + leg, 0.45, alongX ? mz + leg : bar.position.z);
        this.group.add(l);
        meshes.push(l);
      }
    }
    this.boxes.push(...boxes);
    this.roadblocks.push({ meshes, boxes });
  }

  clearRoadblocks() {
    for (const rb of this.roadblocks) for (const m of rb.meshes) this.group.remove(m);
    this.roadblocks = [];
    this.boxes.length = 0;
  }

  /** A loose pile of crates that can be shoved out of the lane. */
  addDebris(pos: Vec2): Debris {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a6b3c, roughness: 0.9 });
    for (const [x, y, z, s] of [[0, 0.5, 0, 1], [0.9, 0.4, 0.4, 0.8], [-0.7, 0.35, 0.6, 0.7], [0.2, 1.3, 0.1, 0.7]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), wood);
      m.position.set(x, y, z);
      m.rotation.y = x;
      m.castShadow = true;
      g.add(m);
    }
    this.group.add(g);
    const d: Debris = { x: pos.x, z: pos.z, vx: 0, vz: 0, r: 1.5, mass: 250, mesh: g, home: { ...pos } };
    this.debris.push(d);
    return d;
  }

  clearDebris() {
    for (const d of this.debris) this.group.remove(d.mesh);
    this.debris.length = 0;
  }

  fire(pos: Vec2) {
    const group = new THREE.Group();
    group.position.set(pos.x, 0, pos.z);
    const flames: THREE.Mesh[] = [];
    for (let k = 0; k < 7; k++) {
      const f = new THREE.Mesh(
        new THREE.ConeGeometry(1.4, 4, 8).translate(0, 2, 0),
        new THREE.MeshBasicMaterial({ color: k % 2 ? 0xff7a1a : 0xffc43a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      f.position.set(Math.cos(k * 1.7) * 5, CURB, Math.sin(k * 2.3) * 5);
      group.add(f);
      flames.push(f);
    }
    const smoke: THREE.Sprite[] = [];
    for (let k = 0; k < 26; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x3a3a3a, transparent: true, opacity: 0.5, depthWrite: false }));
      s.userData.t = k / 26;
      group.add(s);
      smoke.push(s);
    }
    const light = new THREE.PointLight(0xff7a2a, 60, 50, 1.5);
    light.position.set(0, 6, 0);
    group.add(light);
    this.group.add(group);
    this.fires.push({ group, flames, smoke });
  }

  clearFires() {
    for (const f of this.fires) this.group.remove(f.group);
    this.fires = [];
  }

  update(dt: number, time: number) {
    for (const { mat, ring } of this.beacons) {
      mat.uniforms.time.value = time;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.25 * Math.sin(time * 5);
    }
    for (const d of this.debris) {
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      const k = Math.exp(-2.2 * dt);
      d.vx *= k;
      d.vz *= k;
      d.mesh.position.set(d.x, 0, d.z);
      d.mesh.rotation.y += Math.hypot(d.vx, d.vz) * dt * 0.3;
    }
    for (const f of this.fires) {
      f.flames.forEach((m, k) => {
        const s = 0.8 + 0.35 * Math.sin(time * 9 + k * 1.3) + 0.15 * Math.sin(time * 23 + k);
        m.scale.set(1, s * 1.6, 1);
      });
      for (const s of f.smoke) {
        const t = (s.userData.t + time * 0.08) % 1;
        s.position.set(Math.sin(t * 7 + s.id) * (2 + t * 10), 5 + t * 45, Math.cos(t * 5 + s.id) * (2 + t * 10));
        s.scale.setScalar(4 + t * 22);
        s.material.opacity = 0.55 * (1 - t);
      }
    }
  }
}

/** Point in the travel lane of a street segment, `t` of the way from a to b. */
export function lanePoint(a: Node, b: Node, t: number): Vec2 {
  const dx = Math.sign(b[0] - a[0]);
  const dz = Math.sign(b[1] - a[1]);
  return { x: a[0] * P + dx * P * t - dz * LANE, z: a[1] * P + dz * P * t + dx * LANE };
}
