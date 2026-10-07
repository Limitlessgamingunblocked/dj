/*
 * Show fixtures shared by the venues. Everything is instanced so a venue can
 * hang dozens of lights for a handful of draw calls:
 *   MovingHeads  beam fixtures with volumetric cones (pan/tilt patterns)
 *   Lasers       projectors emitting fans, tunnels, sheets and chases
 *   Strobes, Blinders, Globes (pendant lamps), LedStrings (dotted light lines)
 *   Co2Jets      CO2 cannon plumes, HazeLayer (drifting haze in the light)
 *   Crowd        (crowd.ts) jointed dancers, sign holders, VIP guests
 * plus scenery helpers (truss, speakers, booth, mirror ball).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShowState } from './show';
import { grilleTexture, mirrorBallTexture, rng, smokeTexture, softDotTexture, trussTexture } from './tex';

export const TABLE_Y = 0.9;

export interface Fixture {
  readonly object: THREE.Object3D;
  update(s: ShowState, dt: number, camera: THREE.Camera): void;
  /** free anything the venue's generic disposal can't see (shared buffers, side geometries) */
  dispose?(): void;
}

const WHITE = new THREE.Color(1, 1, 1);

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Laser/LED colours are pure: normalise to full saturation and boost. */
function hdr(c: THREE.Color, gain: number, out: THREE.Color): THREE.Color {
  const m = Math.max(c.r, c.g, c.b, 1e-3);
  return out.setRGB((c.r / m) * gain, (c.g / m) * gain, (c.b / m) * gain);
}

/* ------------------------------------------------------------------ */
/* moving heads                                                         */
/* ------------------------------------------------------------------ */

const BEAM_VERT = /* glsl */ `
  varying float vT;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vColor;
  varying vec3 vW;
  varying float vNear;
  void main() {
    vT = uv.y;
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vec4 mv = viewMatrix * w;
    // a camera flying through a beam would see its whole inside wall: fade near surfaces
    vNear = smoothstep(0.4, 2.5, length(mv.xyz));
    vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vView = normalize(-mv.xyz);
    vColor = instanceColor;
    gl_Position = projectionMatrix * mv;
  }`;
const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uHaze;
  varying float vT;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vColor;
  varying vec3 vW;
  varying float vNear;
  void main() {
    float edge = pow(abs(dot(normalize(vN), normalize(vView))), 1.6) * vNear;
    float along = pow(vT, 1.25);
    float n = 0.7 + 0.3 * sin(vW.x * 1.3 + uTime * 0.7) * sin(vW.y * 1.9 - uTime * 0.5) * sin(vW.z * 1.1 + uTime * 0.4);
    gl_FragColor = vec4(vColor * edge * along * n * uHaze, 1.0);
  }`;

export interface HeadSpec {
  pos: THREE.Vector3;
  /** stands on the floor and points up (default hangs and points down) */
  up?: boolean;
  /** heading of "forward" (positive tilt): 0 = towards the room (−Z) */
  yaw?: number;
}

export class MovingHeads implements Fixture {
  readonly object = new THREE.Group();
  private beams: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private lenses: THREE.InstancedMesh;
  private home: THREE.Quaternion[] = [];
  private pan: number[] = [];
  private tilt: number[] = [];
  private beamMat: THREE.ShaderMaterial;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private c = new THREE.Color();
  private one = new THREE.Vector3(1, 1, 1);
  private gain: number;
  /** pools of light where the beams hit the floor */
  private pools: THREE.InstancedMesh | null = null;
  private floorY = 0;
  private len: number;
  private rad: number;
  private dir = new THREE.Vector3();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private yq = new THREE.Quaternion();
  private down = new THREE.Vector3(0, -1, 0);
  private yAxis = new THREE.Vector3(0, 1, 0);

  constructor(
    private specs: HeadSpec[],
    o: { length?: number; radius?: number; gain?: number; body?: number; floorY?: number } = {},
  ) {
    const n = specs.length;
    const len = o.length ?? 12;
    const rad = o.radius ?? 0.9;
    this.len = len;
    this.rad = rad;
    this.gain = o.gain ?? 1.2;
    const beamGeo = new THREE.CylinderGeometry(0.05, rad, len, 28, 1, true);
    beamGeo.translate(0, -len / 2 - 0.16, 0);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHaze: { value: 1 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beams = new THREE.InstancedMesh(beamGeo, this.beamMat, n);
    this.beams.frustumCulled = false;
    const headGeo = mergeGeometries([new THREE.CylinderGeometry(0.12, 0.14, 0.3, 14).translate(0, -0.02, 0), new THREE.BoxGeometry(0.34, 0.06, 0.1).translate(0, 0.16, 0)]);
    this.heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: o.body ?? 0x15161a, roughness: 0.45, metalness: 0.6 }), n);
    this.lenses = new THREE.InstancedMesh(new THREE.CircleGeometry(0.1, 18).rotateX(Math.PI / 2).translate(0, -0.172, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
    const base = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: o.body ?? 0x15161a, roughness: 0.5, metalness: 0.5 }), n);
    specs.forEach((sp, i) => {
      const yaw = sp.yaw ?? 0;
      const home = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      if (sp.up) home.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
      this.home.push(home);
      this.pan.push(0);
      this.tilt.push(0.4);
      this.m4.makeTranslation(sp.pos.x, sp.pos.y + (sp.up ? -0.2 : 0.22), sp.pos.z);
      base.setMatrixAt(i, this.m4);
      this.beams.setColorAt(i, this.c.setRGB(0, 0, 0));
      this.lenses.setColorAt(i, this.c);
    });
    this.object.add(base, this.heads, this.lenses, this.beams);
    if (o.floorY !== undefined) {
      this.floorY = o.floorY + 0.012;
      const mat = new THREE.MeshBasicMaterial({ map: softDotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, n);
      this.pools.frustumCulled = false;
      for (let i = 0; i < n; i++) this.pools.setColorAt(i, this.c.setRGB(0, 0, 0));
      this.object.add(this.pools);
    }
  }

  update(s: ShowState, dt: number): void {
    const n = this.specs.length;
    const b = s.beat;
    const t = s.t;
    const k = Math.min(1, dt * (s.moverPattern === 4 ? 9 : 5));
    this.beamMat.uniforms.uTime.value = t;
    this.beamMat.uniforms.uHaze.value = 0.55 + s.smoke * 0.75;
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) - 0.5 : 0;
      let pan = 0;
      let tilt = 0.5;
      switch (s.moverPattern) {
        case 0:
          pan = Math.sin((b * Math.PI) / 8 + i * 0.7) * 0.7;
          tilt = 0.55 + Math.sin((b * Math.PI) / 4 + i) * 0.22;
          break;
        case 1:
          pan = u * 1.4 * (0.55 + 0.45 * Math.sin((b * Math.PI) / 8));
          tilt = 0.5 + 0.12 * Math.sin((b * Math.PI) / 2);
          break;
        case 2:
          pan = i % 2 ? 0.38 : -0.38;
          tilt = (Math.floor(b) + i) % 2 ? 0.22 : 0.78;
          break;
        case 3:
          pan = Math.sin((b * Math.PI) / 2 + i * 0.9) * 0.45;
          tilt = 0.5 + Math.cos((b * Math.PI) / 2 + i * 0.9) * 0.3;
          break;
        case 4:
          pan = Math.sin(t * 2.1 + i * 1.3) * 0.95;
          tilt = 0.55 + Math.sin(t * 3.3 + i) * 0.38;
          break;
        default:
          pan = Math.sin(t * 0.3 + i) * 0.15;
          tilt = 0.1 + 0.08 * Math.sin(t * 0.5 + i);
      }
      this.pan[i] += (pan - this.pan[i]) * k;
      this.tilt[i] += (tilt - this.tilt[i]) * k;
      this.e.set(this.tilt[i], this.pan[i], 0);
      this.q.setFromEuler(this.e).premultiply(this.home[i]);
      this.m4.compose(this.specs[i].pos, this.q, this.one);
      this.beams.setMatrixAt(i, this.m4);
      this.heads.setMatrixAt(i, this.m4);
      this.lenses.setMatrixAt(i, this.m4);
      let level = s.movers * s.master * s.intensity;
      if (s.moverPattern === 2) level *= (Math.floor(b) + i) % 2 ? 1 : 0.35;
      level *= 0.7 + s.kick * 0.5 * (0.4 + s.peak);
      const col = s.colors[(i + (s.moverPattern === 4 ? Math.floor(b) : 0)) % 3 === 2 ? 2 : (i + (s.peak > 0.5 ? Math.floor(b) : 0)) % 2];
      this.beams.setColorAt(i, this.c.copy(col).multiplyScalar(level * this.gain));
      this.lenses.setColorAt(i, this.c.copy(col).multiplyScalar(0.3 + level * 4));
      if (this.pools) {
        const pos = this.specs[i].pos;
        const dir = this.dir.copy(this.down).applyQuaternion(this.q);
        const t = dir.y < -0.08 ? (this.floorY - pos.y) / dir.y : -1;
        if (t > 0 && t < this.len * 1.05) {
          const r = 0.05 + (this.rad - 0.05) * Math.min(1, t / this.len);
          const stretch = Math.min(3, 1 / -dir.y);
          this.yq.setFromAxisAngle(this.yAxis, Math.atan2(dir.x, dir.z));
          this.p.copy(pos).addScaledVector(dir, t);
          this.p.y = this.floorY;
          this.m4.compose(this.p, this.yq, this.s.set(r * 2.4, 1, r * 2.4 * stretch));
          this.pools.setColorAt(i, this.c.copy(col).multiplyScalar(level * 0.55 * (1 - 0.5 * Math.min(1, t / this.len))));
        } else {
          this.m4.makeScale(0, 0, 0);
          this.pools.setColorAt(i, this.c.setRGB(0, 0, 0));
        }
        this.pools.setMatrixAt(i, this.m4);
      }
    }
    if (this.pools) {
      this.pools.instanceMatrix.needsUpdate = true;
      this.pools.instanceColor!.needsUpdate = true;
    }
    this.beams.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.lenses.instanceMatrix.needsUpdate = true;
    this.beams.instanceColor!.needsUpdate = true;
    this.lenses.instanceColor!.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* lasers                                                               */
/* ------------------------------------------------------------------ */

export interface LaserSpec {
  pos: THREE.Vector3;
  /** forward direction of the projector */
  dir: THREE.Vector3;
  beams?: number;
  /** which side of the room it sits on (for crossfire) */
  side?: number;
  length?: number;
  /** use the second palette colour */
  alt?: boolean;
  /** house colour used while the venue palette is active */
  color?: string;
}

const LASER_VERT = /* glsl */ `
  attribute float aAlong;
  attribute float aSide;
  attribute vec3 iOrigin;
  attribute vec3 iDir;
  attribute vec3 iColor;
  attribute float iLen;
  uniform float uK;
  varying float vSide;
  varying float vAlong;
  varying vec3 vColor;
  void main() {
    vec3 p = iOrigin + iDir * (aAlong * iLen);
    vec3 toCam = cameraPosition - p;
    float dist = length(toCam);
    vec3 side = normalize(cross(iDir, toCam));
    p += side * aSide * uK * max(dist, 0.3);
    vSide = aSide;
    vAlong = aAlong;
    vColor = iColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const LASER_FRAG = /* glsl */ `
  varying float vSide;
  varying float vAlong;
  varying vec3 vColor;
  void main() {
    float x = abs(vSide);
    float core = max(0.0, 1.0 - x * 3.2);
    core *= core;
    float glow = exp(-x * 3.5) * 0.2;
    float fade = smoothstep(0.0, 0.012, vAlong) * (1.0 - smoothstep(0.5, 1.0, vAlong));
    gl_FragColor = vec4(vColor * (core * 1.8 + glow) * fade, 1.0);
  }`;

export class Lasers implements Fixture {
  readonly object = new THREE.Group();
  private geo: THREE.InstancedBufferGeometry;
  private origin: THREE.InstancedBufferAttribute;
  private dir: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private len: THREE.InstancedBufferAttribute;
  private frames: { F: THREE.Vector3; R: THREE.Vector3; U: THREE.Vector3 }[] = [];
  private apertures: THREE.InstancedMesh;
  private total = 0;
  private v = new THREE.Vector3();
  private c = new THREE.Color();
  private ac = new THREE.Color();
  private sheet: number[] = [];

  private house: THREE.Color[];

  constructor(private specs: LaserSpec[]) {
    this.house = specs.map((s) => new THREE.Color(s.color ?? '#ffffff'));
    const counts = specs.map((s) => s.beams ?? 14);
    this.total = counts.reduce((a, b) => a + b, 0);
    const SEG = 8;
    const along: number[] = [];
    const side: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      along.push(i / SEG, i / SEG);
      side.push(-1, 1);
      if (i < SEG) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(along.length * 3), 3));
    this.geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    this.geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    this.geo.setIndex(index);
    this.origin = new THREE.InstancedBufferAttribute(new Float32Array(this.total * 3), 3);
    this.dir = new THREE.InstancedBufferAttribute(new Float32Array(this.total * 3), 3);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(this.total * 3), 3);
    this.len = new THREE.InstancedBufferAttribute(new Float32Array(this.total), 1);
    for (const a of [this.origin, this.dir, this.color, this.len]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iOrigin', this.origin);
    this.geo.setAttribute('iDir', this.dir);
    this.geo.setAttribute('iColor', this.color);
    this.geo.setAttribute('iLen', this.len);
    this.geo.instanceCount = this.total;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uK: { value: 0.0055 } },
      vertexShader: LASER_VERT,
      fragmentShader: LASER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    this.object.add(mesh);
    const up = new THREE.Vector3(0, 1, 0);
    specs.forEach((s) => {
      const F = s.dir.clone().normalize();
      const R = new THREE.Vector3().crossVectors(F, Math.abs(F.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : up).normalize();
      const U = new THREE.Vector3().crossVectors(R, F).normalize();
      this.frames.push({ F, R, U });
      this.sheet.push(-0.06);
    });
    // projector housings with a glowing aperture
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.16, 0.34), new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.5, metalness: 0.6 }), specs.length);
    this.apertures = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), specs.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    specs.forEach((s, i) => {
      q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.frames[i].F);
      m4.compose(s.pos.clone().addScaledVector(this.frames[i].F, -0.18), q, new THREE.Vector3(1, 1, 1));
      body.setMatrixAt(i, m4);
      m4.makeTranslation(s.pos.x, s.pos.y, s.pos.z);
      this.apertures.setMatrixAt(i, m4);
      this.apertures.setColorAt(i, this.c.setRGB(0, 0, 0));
    });
    this.object.add(body, this.apertures);
  }

  private aim(p: number, yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
    const { F, R, U } = this.frames[p];
    const cp = Math.cos(pitch);
    return out
      .copy(F)
      .multiplyScalar(Math.cos(yaw) * cp)
      .addScaledVector(R, Math.sin(yaw) * cp)
      .addScaledVector(U, Math.sin(pitch))
      .normalize();
  }

  update(s: ShowState, dt: number): void {
    const b = s.beat;
    const t = s.t;
    const pat = s.laserPattern;
    let k = 0;
    const level = s.lasers * s.master * Math.min(1.3, s.intensity);
    this.specs.forEach((sp, p) => {
      const B = sp.beams ?? 14;
      const sgn = sp.side ?? (p % 2 ? 1 : -1);
      const base = sp.color && s.venueLook ? this.house[p] : s.colors[sp.alt ? 1 : 0];
      hdr(base, 2.4, this.c);
      const targetSheet = -0.03 - 0.07 * (0.5 + 0.5 * Math.sin(t * 0.35 + p));
      this.sheet[p] += (targetSheet - this.sheet[p]) * Math.min(1, dt * 2);
      for (let i = 0; i < B; i++, k++) {
        const u = B > 1 ? i / (B - 1) - 0.5 : 0;
        let on = 1;
        switch (pat) {
          case 'fan':
            this.aim(p, u * (1.0 + 0.25 * Math.sin((b * Math.PI) / 8)), -0.05 + 0.1 * Math.sin((b * Math.PI) / 4 + p * 1.3), this.v);
            if (s.peak > 0.5) on = Math.floor(b * 2) % 2 ? 1 : 0.3;
            break;
          case 'tunnel': {
            const a = (i / B) * Math.PI * 2 + t * 1.2 * (p % 2 ? 1 : -1);
            const hA = 0.14 + 0.05 * Math.sin((b * Math.PI) / 2);
            const { F, R, U } = this.frames[p];
            this.v.copy(F).multiplyScalar(Math.cos(hA)).addScaledVector(R, Math.cos(a) * Math.sin(hA)).addScaledVector(U, Math.sin(a) * Math.sin(hA)).normalize();
            break;
          }
          case 'sheet':
            this.aim(p, u * 1.5, this.sheet[p], this.v);
            break;
          case 'chase': {
            const step = Math.floor(b * 2);
            on = i < 4 ? 1 : 0;
            this.aim(p, (hash(step * 7 + i + p * 31) - 0.5) * 1.4, (hash(step * 13 + i * 3 + p) - 0.5) * 0.3, this.v);
            break;
          }
          default:
            this.aim(p, sgn * (0.25 + 0.3 * Math.sin((b * Math.PI) / 2)) + u * 0.3, -0.04 + 0.08 * Math.sin((b * Math.PI) / 4), this.v);
        }
        this.origin.setXYZ(k, sp.pos.x, sp.pos.y, sp.pos.z);
        this.dir.setXYZ(k, this.v.x, this.v.y, this.v.z);
        this.len.setX(k, sp.length ?? 30);
        const g = level * on * (0.8 + 0.25 * s.kick);
        this.color.setXYZ(k, this.c.r * g, this.c.g * g, this.c.b * g);
      }
      this.apertures.setColorAt(p, this.ac.copy(this.c).multiplyScalar(level));
    });
    this.origin.needsUpdate = true;
    this.dir.needsUpdate = true;
    this.color.needsUpdate = true;
    this.len.needsUpdate = true;
    this.apertures.instanceColor!.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* strobes, blinders                                                    */
/* ------------------------------------------------------------------ */

export class Strobes implements Fixture {
  readonly object = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private c = new THREE.Color();

  constructor(
    private spots: { pos: THREE.Vector3; yaw?: number; tilt?: number }[],
    size: [number, number, number] = [0.55, 0.16, 0.08],
  ) {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m4.makeRotationFromEuler(new THREE.Euler(s.tilt ?? 0, s.yaw ?? 0, 0, 'YXZ')).setPosition(s.pos);
      this.mesh.setMatrixAt(i, m4);
      this.mesh.setColorAt(i, this.c.setRGB(0.05, 0.05, 0.05));
    });
    this.object.add(this.mesh);
  }

  update(s: ShowState): void {
    const v = 0.04 + s.strobe * s.master * 9;
    for (let i = 0; i < this.spots.length; i++) this.mesh.setColorAt(i, this.c.setRGB(v, v, v * 1.05));
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

export class Blinders implements Fixture {
  readonly object = new THREE.Group();
  private lamps: THREE.InstancedMesh;
  private c = new THREE.Color();
  private n: number;

  /** each spot is a 2-lamp blinder facing `yaw` (0 = facing −Z, the room) */
  constructor(spots: { pos: THREE.Vector3; yaw?: number; tilt?: number }[]) {
    this.n = spots.length * 2;
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.26, 0.14), new THREE.MeshStandardMaterial({ color: 0x131417, roughness: 0.5, metalness: 0.5 }), spots.length);
    this.lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(0.1, 20).rotateY(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), this.n);
    const m4 = new THREE.Matrix4();
    const off = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m4.makeRotationFromEuler(new THREE.Euler(s.tilt ?? 0, s.yaw ?? 0, 0, 'YXZ')).setPosition(s.pos);
      body.setMatrixAt(i, m4);
      for (let j = 0; j < 2; j++) {
        off.makeTranslation(j ? 0.12 : -0.12, 0, -0.072);
        this.lamps.setMatrixAt(i * 2 + j, m4.clone().multiply(off));
        this.lamps.setColorAt(i * 2 + j, this.c.setRGB(0.05, 0.03, 0.01));
      }
    });
    this.object.add(body, this.lamps);
  }

  update(s: ShowState): void {
    const v = 0.03 + s.blinder * s.master * 5;
    for (let i = 0; i < this.n; i++) this.lamps.setColorAt(i, this.c.setRGB(v, v * 0.62, v * 0.28));
    this.lamps.instanceColor!.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* dotted LED strings                                                   */
/* ------------------------------------------------------------------ */

export class LedStrings implements Fixture {
  readonly object: THREE.Points;
  private u = {
    uBeat: { value: 0 },
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uMaster: { value: 1 },
    uSize: { value: 0.09 },
    uA: { value: new THREE.Color() },
    uB: { value: new THREE.Color() },
    uWarm: { value: 0 },
  };
  private pos: number[] = [];
  private at: number[] = [];
  private sid: number[] = [];
  private strings = 0;

  constructor(
    private o: { size?: number; warm?: string | null; spacing?: number } = {},
  ) {
    this.object = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: /* glsl */ `
          attribute float aT;
          attribute float aS;
          uniform float uBeat, uTime, uLevel, uMaster, uSize, uWarm;
          uniform vec3 uA, uB;
          varying vec3 vC;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float chase = pow(0.5 + 0.5 * sin((aT * 14.0 - uBeat * 2.0 + aS * 0.7) * 3.14159), 6.0);
            float twinkle = 0.5 + 0.5 * sin(uTime * 3.0 + aS * 13.0 + aT * 97.0);
            float b = 0.3 + 0.2 * twinkle + uLevel * chase * 1.8;
            vec3 col = mix(uA, uB, step(0.5, fract(aS * 0.5)));
            vC = col * b * uMaster;
            gl_PointSize = uSize * 700.0 / max(0.5, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vC;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vC * a * a * 2.2, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.object.frustumCulled = false;
    this.u.uSize.value = o.size ?? 0.09;
  }

  /** a straight run of lamps */
  line(a: THREE.Vector3, b: THREE.Vector3): this {
    return this.path([a, b]);
  }

  /** lamps along a polyline */
  path(points: THREE.Vector3[]): this {
    const spacing = this.o.spacing ?? 0.22;
    let total = 0;
    for (let i = 1; i < points.length; i++) total += points[i].distanceTo(points[i - 1]);
    const v = new THREE.Vector3();
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
      const seg = points[i].distanceTo(points[i - 1]);
      const n = Math.max(1, Math.floor(seg / spacing));
      for (let j = 0; j < n; j++) {
        v.lerpVectors(points[i - 1], points[i], j / n);
        this.pos.push(v.x, v.y, v.z);
        this.at.push((acc + (j / n) * seg) / total);
        this.sid.push(this.strings);
      }
      acc += seg;
    }
    this.strings++;
    return this;
  }

  done(): this {
    const g = this.object.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.at, 1));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.sid, 1));
    return this;
  }

  update(s: ShowState, dt: number): void {
    this.u.uBeat.value = s.beat;
    this.u.uTime.value += dt;
    this.u.uLevel.value = s.playing ? 0.4 + s.energy * 0.6 + s.peak * 0.6 : 0.15;
    this.u.uMaster.value = s.master * Math.min(1.3, s.intensity);
    if (this.o.warm) {
      this.u.uA.value.set(this.o.warm).multiplyScalar(1.4);
      this.u.uB.value.copy(s.colors[0]).lerp(this.u.uA.value, 0.5).multiplyScalar(1.2);
    } else {
      hdr(s.colors[0], 1.3, this.u.uA.value);
      hdr(s.colors[1], 1.3, this.u.uB.value);
    }
  }
}

/* ------------------------------------------------------------------ */
/* pendant globes                                                       */
/* ------------------------------------------------------------------ */

export class Globes implements Fixture {
  readonly object = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private c = new THREE.Color();
  private base: THREE.Color;

  constructor(
    private spots: { pos: THREE.Vector3; r: number }[],
    color: string,
    ceilingY: number,
  ) {
    this.base = new THREE.Color(color);
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vV = normalize(-mv.xyz);
          vC = instanceColor;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vC;
        void main() {
          float f = abs(dot(normalize(vN), normalize(vV)));
          gl_FragColor = vec4(vC * (0.25 + 1.1 * pow(f, 1.8)), 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), mat, spots.length);
    const m4 = new THREE.Matrix4();
    const wires: number[] = [];
    spots.forEach((s, i) => {
      m4.makeScale(s.r, s.r, s.r).setPosition(s.pos);
      this.mesh.setMatrixAt(i, m4);
      this.mesh.setColorAt(i, this.base);
      wires.push(s.pos.x, s.pos.y + s.r, s.pos.z, s.pos.x, ceilingY, s.pos.z);
    });
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    this.object.add(this.mesh, new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1a1512 })));
  }

  update(s: ShowState): void {
    this.spots.forEach((sp, i) => {
      const d = Math.hypot(sp.pos.x, sp.pos.z);
      const wave = s.playing ? Math.pow(Math.max(0, Math.cos((d * 0.35 - (s.beat % 1) * Math.PI * 2) * 0.5)), 8) : 0;
      const tw = s.peak > 0.4 ? (hash(i * 3.1 + Math.floor(s.beat * 2)) > 0.6 ? 1.5 : 0.4) : 1;
      const v = (1.1 + wave * 1.6 * (0.3 + s.energy)) * tw * (0.25 + 0.75 * s.master);
      this.mesh.setColorAt(i, this.c.copy(this.base).multiplyScalar(v));
    });
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* CO2 cannons                                                          */
/* ------------------------------------------------------------------ */

export class Co2Jets implements Fixture {
  readonly object = new THREE.Group();
  private pts: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private alpha: THREE.BufferAttribute;
  private size: THREE.BufferAttribute;
  private per = 90;
  private tint = { value: new THREE.Color(1, 1, 1) };
  private rnd = rng(7);

  constructor(
    private nozzles: THREE.Vector3[],
    private power = 11,
  ) {
    const n = nozzles.length * this.per;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n).fill(99);
    this.max = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.alpha = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.size = new THREE.BufferAttribute(new Float32Array(n), 1);
    g.setAttribute('aAlpha', this.alpha);
    g.setAttribute('aSize', this.size);
    this.pts = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: smokeTexture() }, uTint: this.tint },
        vertexShader: /* glsl */ `
          attribute float aAlpha;
          attribute float aSize;
          varying float vA;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            // flying through the plume must not white out the frame
            vA = aAlpha * smoothstep(0.8, 3.0, -mv.z);
            gl_PointSize = min(aSize * 700.0 / max(0.5, -mv.z), 260.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uTint;
          varying float vA;
          void main() {
            vec4 t = texture2D(uMap, gl_PointCoord);
            gl_FragColor = vec4(uTint, t.a * vA);
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.pts.frustumCulled = false;
    const nozzle = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0x1b1c20, metalness: 0.7, roughness: 0.4 }), nozzles.length);
    nozzles.forEach((p, i) => nozzle.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y - 0.15, p.z)));
    this.object.add(nozzle, this.pts);
  }

  fire(): void {
    const r = this.rnd;
    this.nozzles.forEach((nz, j) => {
      for (let i = 0; i < this.per; i++) {
        const k = j * this.per + i;
        this.pos[k * 3] = nz.x;
        this.pos[k * 3 + 1] = nz.y;
        this.pos[k * 3 + 2] = nz.z;
        const sp = 0.9;
        this.vel[k * 3] = (r() - 0.5) * sp;
        this.vel[k * 3 + 1] = this.power * (0.55 + r() * 0.6);
        this.vel[k * 3 + 2] = (r() - 0.5) * sp;
        this.life[k] = -r() * 0.7; // staggered release over the blast
        this.max[k] = 1.3 + r() * 1.1;
      }
    });
  }

  update(s: ShowState, dt: number): void {
    if (s.co2) this.fire();
    this.tint.value.copy(s.colors[0]).lerp(WHITE, 0.75).multiplyScalar(0.55 + s.wash * 0.4);
    const drag = Math.exp(-dt * 2.2);
    for (let k = 0; k < this.life.length; k++) {
      const l = (this.life[k] += dt);
      if (l < 0 || l > this.max[k]) {
        this.alpha.setX(k, 0);
        if (l < 0) {
          const j = Math.floor(k / this.per);
          this.pos[k * 3] = this.nozzles[j].x;
          this.pos[k * 3 + 1] = this.nozzles[j].y;
          this.pos[k * 3 + 2] = this.nozzles[j].z;
        }
        continue;
      }
      this.vel[k * 3] *= drag;
      this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * drag - dt * 0.6;
      this.vel[k * 3 + 2] *= drag;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      const u = l / this.max[k];
      this.alpha.setX(k, Math.min(1, u * 8) * (1 - u) * 0.42);
      this.size.setX(k, 0.3 + u * 1.5);
    }
    (this.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.size.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* haze                                                                  */
/* ------------------------------------------------------------------ */

export class HazeLayer implements Fixture {
  readonly object = new THREE.Group();
  private u = { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uDensity: { value: 0.5 } };

  /** `gain` scales the density (big rooms look through far more haze) */
  constructor(box: THREE.Box3, sheets = 6, private gain = 1) {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uDensity;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vW;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          vec2 p = vW.xz * 0.18 + vec2(vW.y * 0.1, 0.0);
          float v = n(p + uTime * 0.05) * 0.6 + n(p * 2.3 - uTime * 0.07) * 0.4;
          float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
          // hide the sheet structure: fade near the camera, and only where a sheet
          // is seen almost exactly edge-on (a wider fade empties the distant haze)
          vec3 toCam = cameraPosition - vW;
          float dist = length(toCam);
          float near = smoothstep(0.6, 3.5, dist);
          float graze = smoothstep(0.008, 0.07, abs(toCam.y) / max(dist, 1e-3));
          gl_FragColor = vec4(uColor * v * edge * uDensity * near * graze, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    for (let i = 0; i < sheets; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.z), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(c.x, box.min.y + (size.y * (i + 0.5)) / sheets, c.z);
      this.object.add(m);
    }
  }

  update(s: ShowState, dt: number): void {
    this.u.uTime.value += dt;
    this.u.uColor.value.copy(s.colors[0]).lerp(s.colors[1], 0.5 + 0.5 * Math.sin(s.t * 0.2));
    this.u.uDensity.value = (0.025 + s.smoke * 0.05) * (0.4 + s.wash + s.flash) * s.master * this.gain;
  }
}

export { Crowd, crowdArea, type CrowdRole, type CrowdSpot } from './crowd';

/* ------------------------------------------------------------------ */
/* scenery helpers                                                      */
/* ------------------------------------------------------------------ */

let trussMat: THREE.MeshStandardMaterial | null = null;
/** Square box truss between two points. */
export function truss(a: THREE.Vector3, b: THREE.Vector3, size = 0.3): THREE.Mesh {
  trussMat ??= new THREE.MeshStandardMaterial({ map: trussTexture(), alphaTest: 0.5, metalness: 0.85, roughness: 0.35, color: 0xb9bdc5, side: THREE.DoubleSide });
  const len = a.distanceTo(b);
  const geo = new THREE.BoxGeometry(size, len, size);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / size / 4));
  const m = new THREE.Mesh(geo, trussMat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

const speakerBody = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.75, metalness: 0.1 });
/** Speaker cabinet with its front (+Z) showing the grille. */
export function speaker(w: number, h: number, d: number, layout: 'mid' | 'sub' | 'monitor' | 'top', bodyColor?: number): THREE.Mesh {
  const body = bodyColor !== undefined ? new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6, metalness: 0.1 }) : speakerBody;
  const front = new THREE.MeshStandardMaterial({ map: grilleTexture(layout), roughness: 0.85 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [body, body, body, body, front, body]);
  m.castShadow = false;
  return m;
}

/** Hanging line array: `n` boxes curving downwards, front facing +Z (rotate the group to aim). */
export function lineArray(n: number, w = 0.9, h = 0.32, d = 0.6): THREE.Group {
  const g = new THREE.Group();
  let y = 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const box = speaker(w, h, d, 'top');
    box.position.set(0, y - h / 2, 0);
    box.rotation.x = a;
    g.add(box);
    y -= h * 0.98;
    a += 0.05 + i * 0.012;
  }
  return g;
}

/** DJ booth table (top at TABLE_Y), front panel facing the room (−Z). */
export function booth(o: { w?: number; d?: number; front?: THREE.Material; top?: number; strip?: string | null; z?: number }): { group: THREE.Group; strip: THREE.MeshBasicMaterial | null } {
  const w = o.w ?? 2.9;
  const d = o.d ?? 1.0;
  const g = new THREE.Group();
  const bodyMat = o.front ?? new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, TABLE_Y - 0.04, d), bodyMat);
  body.position.set(0, (TABLE_Y - 0.04) / 2, o.z ?? 0);
  body.receiveShadow = true;
  g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.04, d + 0.08), new THREE.MeshStandardMaterial({ color: o.top ?? 0x15161a, roughness: 0.42, metalness: 0.15 }));
  top.position.set(0, TABLE_Y - 0.02, o.z ?? 0);
  top.receiveShadow = true;
  g.add(top);
  let strip: THREE.MeshBasicMaterial | null = null;
  if (o.strip !== null) {
    strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.strip ?? '#ffffff'), toneMapped: false });
    const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.025, 0.012), strip);
    s.position.set(0, TABLE_Y - 0.06, (o.z ?? 0) - d / 2 - 0.045);
    g.add(s);
  }
  return { group: g, strip };
}

/** Rotating mirror ball on a short chain. */
export function mirrorBall(r: number): THREE.Mesh {
  const tex = mirrorBallTexture();
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, map: tex, roughnessMap: tex, envMapIntensity: 2.4, flatShading: true }));
  return m;
}

/** Scale a 1×1×1-segment box's UVs so a tiling texture keeps its real-world size. */
export function boxUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, unit: number): THREE.BoxGeometry {
  const uv = geo.attributes.uv;
  const faces: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) uv.setXY(f * 4 + i, (uv.getX(f * 4 + i) * faces[f][0]) / unit, (uv.getY(f * 4 + i) * faces[f][1]) / unit);
  return geo;
}

/** Box with tiled UVs. */
export function block(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], unit = 4): THREE.Mesh {
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, unit), mat);
  m.receiveShadow = true;
  return m;
}

/** Simple flat floor. */
export function floor(size: number, mat: THREE.Material, y = 0): THREE.Mesh {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  f.rotation.x = -Math.PI / 2;
  f.position.y = y;
  f.receiveShadow = true;
  return f;
}

/** Update every fixture in a list. */
export function updateAll(list: Fixture[], s: ShowState, dt: number, camera: THREE.Camera): void {
  for (const f of list) f.update(s, dt, camera);
}
