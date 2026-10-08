/*
 * Confetti cannons: a burst of paper over the crowd on a big drop (or from the
 * lighting desk's pad), in the show's colours plus gold and silver foil.
 *
 * All on the GPU, nothing per piece on the CPU: each piece's flight is
 * worked out in the vertex shader from its launch and the time since the
 * burst. It's fired up and out of a cone, with heavy drag (paper), sinking
 * at a slow flutter and swaying as it falls, tumbling all the way. When it
 * reaches the floor it stops where it touched down (found by bisecting
 * between the top of its arc and now) and lies flat. Lit from above by the
 * rig, foil glints when it catches the light, and everything fades out after
 * 40 seconds.
 */
import * as THREE from 'three';
import { fxTier } from '../fx';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';

export interface Cannon {
  pos: THREE.Vector3;
  /** where it points (doesn't need to be unit length) */
  dir: THREE.Vector3;
}

/**
 * The flight in TypeScript, the same maths as the shader (for tests): height
 * after t seconds for a piece launched upward at vy with drag k, sinking at
 * `sink` m/s once the drag has taken its speed.
 */
export function paperHeight(y0: number, vy: number, k: number, sink: number, t: number): number {
  return y0 - sink * t + (vy + sink) * ((1 - Math.exp(-k * t)) / k);
}

/** When it reaches floorY: bisected between the top of its arc and t, as the shader does. */
export function paperLanding(y0: number, vy: number, k: number, sink: number, floorY: number, t: number): number {
  let lo = 0;
  let hi = t;
  if (vy + sink > sink) lo = Math.min(t, Math.log((vy + sink) / sink) / k);
  for (let i = 0; i < 10; i++) {
    const m = 0.5 * (lo + hi);
    if (paperHeight(y0, vy, k, sink, m) > floorY) lo = m;
    else hi = m;
  }
  return hi;
}

const VERT = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aCannon;
  uniform float uT;
  uniform vec3 uPos[4];
  uniform vec3 uDir[4];
  uniform float uSpeed;
  uniform float uFloor;
  uniform vec3 uCol[3];
  uniform float uLight;
  uniform float uFlash;
  uniform vec3 uWind;
  varying vec3 vCol;

  vec3 traj(vec3 p0, vec3 v0, float t, float k, vec3 vt) {
    return p0 + vt * t + (v0 - vt) * ((1.0 - exp(-k * t)) / k);
  }
  mat3 rotAxis(vec3 a, float ang) {
    float c = cos(ang), s = sin(ang), ic = 1.0 - c;
    return mat3(c + a.x * a.x * ic, a.y * a.x * ic + a.z * s, a.z * a.x * ic - a.y * s,
                a.x * a.y * ic - a.z * s, c + a.y * a.y * ic, a.z * a.y * ic + a.x * s,
                a.x * a.z * ic + a.y * s, a.y * a.z * ic - a.x * s, c + a.z * a.z * ic);
  }
  void main() {
    int ci = int(aCannon + 0.5);
    vec3 p0 = uPos[0];
    vec3 dir = uDir[0];
    for (int i = 1; i < 4; i++) if (i == ci) { p0 = uPos[i]; dir = uDir[i]; }
    float t = uT - aSeed.x * 0.45;
    if (t < 0.0 || uT > 44.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
    dir = normalize(dir);
    vec3 ref = abs(dir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 side = normalize(cross(dir, ref));
    vec3 up = cross(side, dir);
    float a = aSeed.y * 6.2832;
    float r = sqrt(aSeed.z) * 0.34;
    vec3 v0 = normalize(dir + (side * cos(a) + up * sin(a)) * r) * uSpeed * (0.6 + 0.55 * aSeed.w);
    // paper: heavy drag, and it sinks at a slow flutter
    float k = 1.3 + aSeed.w * 0.9;
    vec3 vt = vec3(0.0, -0.35 - aSeed.z * 0.3, 0.0);
    vec3 p = traj(p0, v0, t, k, vt);
    float ts = t;
    bool landed = false;
    if (p.y < uFloor) {
      // where it touched down: bisect between the top of its arc and now
      float lo = 0.0;
      float hi = t;
      float up0 = v0.y - vt.y;
      if (up0 > -vt.y) lo = min(t, log(up0 / -vt.y) / k);
      for (int i = 0; i < 10; i++) {
        float m = 0.5 * (lo + hi);
        if (traj(p0, v0, m, k, vt).y > uFloor) lo = m; else hi = m;
      }
      ts = hi;
      p = traj(p0, v0, hi, k, vt);
      landed = true;
    }
    // swaying as it falls (not in the first rush out of the barrel)
    float sw = smoothstep(0.4, 2.2, ts);
    p += vec3(sin(ts * (2.0 + aSeed.y * 2.2) + aSeed.z * 6.28), 0.0, cos(ts * (1.6 + aSeed.x * 2.0) + aSeed.w * 6.28)) * 0.38 * sw;
    // outdoors the breeze carries it (each piece a little differently)
    p += uWind * (0.6 + 0.8 * aSeed.z) * max(0.0, ts - 0.4);
    if (landed) p.y = uFloor + 0.004 + aSeed.x * 0.006;
    // tumbling in the air, flat on the floor
    vec3 axis = normalize(vec3(aSeed.y - 0.5, aSeed.z - 0.45, aSeed.w - 0.5));
    mat3 R = landed ? rotAxis(vec3(0.0, 1.0, 0.0), aSeed.y * 6.28) * mat3(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0)
                    : rotAxis(axis, ts * (6.0 + aSeed.x * 10.0) + aSeed.w * 6.28);
    float life = 1.0 - smoothstep(36.0, 44.0, uT);
    vec3 wp = p + R * position * life;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    // gold and silver foil, the rest in the show's colours
    bool foil = aSeed.x < 0.32;
    vec3 base = aSeed.x < 0.18 ? vec3(1.0, 0.76, 0.32) : foil ? vec3(0.86, 0.9, 0.96) : (aSeed.y < 0.33 ? uCol[0] : aSeed.y < 0.66 ? uCol[1] : uCol[2]);
    // lit from the rig above: brighter turned up to it, a glint as it catches the light
    vec3 n = R * vec3(0.0, 0.0, 1.0);
    vec3 L = normalize(vec3(0.2, 1.0, 0.35));
    vec3 V = normalize(cameraPosition - wp);
    float diff = 0.25 + 0.75 * abs(dot(n, L));
    float h = abs(dot(n, normalize(L + V)));
    float h2 = h * h;
    float h8 = h2 * h2 * h2 * h2;
    float spec = h8 * h8 * h8;
    vCol = base * diff * uLight + vec3(spec) * (foil ? 2.6 : 0.35) * (uLight + uFlash);
  }`;

const FRAG = /* glsl */ `
  varying vec3 vCol;
  void main() {
    gl_FragColor = vec4(vCol, 1.0);
  }`;

export class Confetti implements Fixture {
  readonly object: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private burstAt = -1e9;
  private n: number;
  private onDrops: boolean;

  /**
   * floorY: where the paper lands; speed: launch speed in m/s (keep it under
   * the ceiling: the highest pieces rise about 0.8 × speed metres); onDrops:
   * false for clubs that don't do confetti (it still fires from the desk);
   * wind: outdoors, the breeze in m/s
   */
  constructor(
    cannons: Cannon[],
    o: { floorY: number; speed?: number; count?: number; onDrops?: boolean; wind?: THREE.Vector3 },
  ) {
    this.onDrops = o.onDrops ?? true;
    const n = (this.n = o.count ?? 2400);
    const plane = new THREE.PlaneGeometry(0.055, 0.034);
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    const seeds = new Float32Array(n * 4);
    const cannon = new Float32Array(n);
    let x = 9871;
    const rnd = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) seeds[i * 4 + k] = rnd();
      cannon[i] = i % cannons.length;
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.setAttribute('aCannon', new THREE.InstancedBufferAttribute(cannon, 1));
    geo.instanceCount = 0;
    // the shader takes four cannons; fewer repeat the last
    const four = <T>(f: (c: Cannon) => T): T[] => Array.from({ length: 4 }, (_, i) => f(cannons[Math.min(i, cannons.length - 1)]));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uT: { value: 1e9 },
        uPos: { value: four((c) => c.pos.clone()) },
        uDir: { value: four((c) => c.dir.clone()) },
        uSpeed: { value: o.speed ?? 13 },
        uFloor: { value: o.floorY },
        uCol: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
        uLight: { value: 0.5 },
        uFlash: { value: 0 },
        uWind: { value: o.wind?.clone() ?? new THREE.Vector3() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(geo, this.mat);
    this.object.frustumCulled = false;
    // the cannons themselves: short black tubes on the floor
    const tube = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.08, 0.5, 12).translate(0, 0.25, 0), new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.6, roughness: 0.4 }), cannons.length);
    const q = new THREE.Quaternion();
    cannons.forEach((c, i) => {
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.dir.clone().normalize());
      tube.setMatrixAt(i, new THREE.Matrix4().compose(c.pos, q, new THREE.Vector3(1, 1, 1)));
    });
    this.object.add(tube);
  }

  update(s: ShowState): void {
    if (s.confetti && (this.onDrops || s.confettiByHand)) this.burstAt = s.t;
    const u = this.mat.uniforms;
    const since = s.t - this.burstAt;
    u.uT.value = since;
    // how many pieces by effects tier; nothing to draw between bursts
    const tier = fxTier();
    this.geo.instanceCount = since < 0 || since > 44 ? 0 : Math.round(this.n * (tier === 'high' ? 1 : tier === 'medium' ? 0.55 : 0.2));
    if (!this.geo.instanceCount) return;
    for (let i = 0; i < 3; i++) (u.uCol.value as THREE.Color[])[i].copy(s.colors[i]);
    u.uLight.value = s.master * (0.22 + 0.45 * s.wash + 0.25 * s.peak);
    u.uFlash.value = s.flash;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
