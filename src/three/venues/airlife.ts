/*
 * Life in the air:
 *   – dust in the beams: specks drifting through the whole room, seen only
 *     where a moving head's beam passes through them (lit in its colour,
 *     brightest looking into the light, the way dust shows in a projector's
 *     beam), turning and glinting as they fall
 *   – steam off the crowd: a packed room at the peak puts up a haze of body
 *     heat that rises off the heads and drifts up into the rig; it builds
 *     over a few minutes of a hard peak and clears in a breakdown, and only
 *     shows where the stage's light catches it
 */
import * as THREE from 'three';
import { blobTexture } from './details';
import { rng } from './tex';

/** the beams a dust cloud is lit by */
export interface BeamState {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  color: THREE.Color;
}

export const MAX_DUST_BEAMS = 24;

/** is a point inside a beam's cone (lens at pos, axis dir, half-angle tan, length len)? 0..1, soft at the edge */
export function inBeam(p: THREE.Vector3, pos: THREE.Vector3, dir: THREE.Vector3, tanA: number, len: number): number {
  const vx = p.x - pos.x;
  const vy = p.y - pos.y;
  const vz = p.z - pos.z;
  const along = vx * dir.x + vy * dir.y + vz * dir.z;
  if (along <= 0.15 || along >= len) return 0;
  const rx = vx - dir.x * along;
  const ry = vy - dir.y * along;
  const rz = vz - dir.z * along;
  const radial = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const r = 0.05 + along * tanA;
  const edge = THREE.MathUtils.clamp((r - radial) / (r * 0.45), 0, 1);
  return edge * edge * (3 - 2 * edge) * Math.sqrt(1 - along / len);
}

const DUST_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime, uTanA, uLen, uLevel;
  uniform vec3 uBoxMin, uBoxSize;
  uniform vec3 uPos[${MAX_DUST_BEAMS}];
  uniform vec3 uDir[${MAX_DUST_BEAMS}];
  uniform vec3 uCol[${MAX_DUST_BEAMS}];
  uniform int uCount;
  varying vec3 vCol;
  void main() {
    // a slow fall with a lazy drift, wrapping round the box
    vec3 p = position;
    p.y -= uTime * (0.015 + aSeed * 0.025);
    p.x += sin(uTime * 0.21 + aSeed * 40.0) * 0.35 + uTime * 0.02;
    p.z += cos(uTime * 0.17 + aSeed * 31.0) * 0.35;
    p = uBoxMin + mod(p - uBoxMin, uBoxSize);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vec3 view = normalize(wp.xyz - cameraPosition);
    vec3 light = vec3(0.0);
    for (int i = 0; i < ${MAX_DUST_BEAMS}; i++) {
      if (i >= uCount) break;
      vec3 v = wp.xyz - uPos[i];
      float along = dot(v, uDir[i]);
      if (along <= 0.15 || along >= uLen) continue;
      float radial = length(v - uDir[i] * along);
      float r = 0.05 + along * uTanA;
      float inside = smoothstep(r, r * 0.55, radial) * sqrt(1.0 - along / uLen);
      // dust throws its light forwards: brightest looking back up the beam
      float fwd = 0.35 + 2.2 * pow(max(0.0, -dot(view, uDir[i])), 6.0);
      light += uCol[i] * inside * fwd;
    }
    // flakes turning: a glint now and then
    float glint = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (1.3 + aSeed * 2.0) + aSeed * 70.0), 6.0);
    vCol = light * glint * uLevel;
    vec4 mv = viewMatrix * wp;
    float d = -mv.z;
    float lit = max(vCol.r, max(vCol.g, vCol.b));
    gl_PointSize = lit > 0.004 ? clamp(26.0 / max(d, 0.5), 1.2, 5.0) : 0.0;
    gl_Position = projectionMatrix * mv;
  }`;

const DUST_FRAG = /* glsl */ `
  varying vec3 vCol;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(vCol * smoothstep(0.5, 0.05, r), 1.0);
  }`;

export class BeamDust {
  readonly object: THREE.Points;
  private u: Record<string, THREE.IUniform>;

  /** `count` specks through `box`, lit by beams of half-angle tan `tanA` and length `len` */
  constructor(box: THREE.Box3, count: number, tanA: number, len: number, seed = 9) {
    const r = rng(seed);
    const size = box.getSize(new THREE.Vector3());
    const pos = new Float32Array(count * 3);
    const sd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = box.min.x + r() * size.x;
      pos[i * 3 + 1] = box.min.y + r() * size.y;
      pos[i * 3 + 2] = box.min.z + r() * size.z;
      sd[i] = r();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    geo.boundingSphere = new THREE.Sphere(box.getCenter(new THREE.Vector3()), size.length() / 2 + 1);
    this.u = {
      uTime: { value: 0 },
      uTanA: { value: tanA },
      uLen: { value: len },
      uLevel: { value: 1 },
      uBoxMin: { value: box.min.clone() },
      uBoxSize: { value: size },
      uPos: { value: Array.from({ length: MAX_DUST_BEAMS }, () => new THREE.Vector3()) },
      uDir: { value: Array.from({ length: MAX_DUST_BEAMS }, () => new THREE.Vector3(0, -1, 0)) },
      uCol: { value: Array.from({ length: MAX_DUST_BEAMS }, () => new THREE.Color()) },
      uCount: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.object = new THREE.Points(geo, mat);
  }

  /** this frame's beams (the first 24, or every other one of a bigger rig) */
  update(beams: BeamState[], dt: number, level: number): void {
    this.u.uTime.value += dt;
    this.u.uLevel.value = level;
    const step = Math.max(1, Math.ceil(beams.length / MAX_DUST_BEAMS));
    const P = this.u.uPos.value as THREE.Vector3[];
    const D = this.u.uDir.value as THREE.Vector3[];
    const C = this.u.uCol.value as THREE.Color[];
    let n = 0;
    for (let i = 0; i < beams.length && n < MAX_DUST_BEAMS; i += step) {
      P[n].copy(beams[i].pos);
      D[n].copy(beams[i].dir);
      C[n].copy(beams[i].color).multiplyScalar(step);
      n++;
    }
    this.u.uCount.value = n;
    this.object.visible = level > 0.001 && n > 0;
  }
}

/* ------------------------------------------------------------------ */
/* steam off the crowd                                                  */
/* ------------------------------------------------------------------ */

const STEAM_VERT = /* glsl */ `
  attribute vec3 aSeed; // life offset, rise speed, size
  uniform float uTime, uAmount;
  uniform vec3 uLightFrom;
  varying float vA;
  varying float vFwd;
  void main() {
    float life = 14.0;
    float t = fract((uTime + aSeed.x * life) / life);
    vec3 p = position;
    // rises off the heads, spreading and drifting
    p.y += t * (2.6 + aSeed.y * 2.4);
    p.x += sin(uTime * 0.13 + aSeed.x * 20.0) * (0.4 + t * 1.2);
    p.z += cos(uTime * 0.11 + aSeed.y * 17.0) * (0.4 + t * 1.2);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    // in, then thinning out as it rises
    vA = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.45, 1.0, t)) * uAmount;
    // lit from the rig: brightest looking towards the light through it
    vec3 toL = normalize(uLightFrom - wp.xyz);
    vec3 toCam = normalize(cameraPosition - wp.xyz);
    vFwd = 0.25 + 1.6 * pow(max(0.0, -dot(toL, toCam)), 3.0);
    vec4 mv = viewMatrix * wp;
    gl_PointSize = clamp((140.0 + aSeed.z * 160.0) * (0.7 + t) / max(-mv.z, 1.0), 2.0, 260.0);
    gl_Position = projectionMatrix * mv;
  }`;

const STEAM_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uLight;
  varying float vA;
  varying float vFwd;
  void main() {
    float m = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(uLight * m * vA * vFwd * 0.05, 1.0);
  }`;

export class CrowdSteam {
  readonly object: THREE.Points;
  private u: Record<string, THREE.IUniform>;
  /** how much has built up, 0..1 */
  amount = 0;

  /** puffs over the heads of the people at `spots` (a sample of them) */
  constructor(spots: { x: number; z: number; y?: number }[], count: number, seed = 13) {
    const r = rng(seed);
    const n = Math.min(count, spots.length * 2);
    const pos = new Float32Array(n * 3);
    const sd = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = spots[Math.floor(r() * spots.length)];
      pos[i * 3] = s.x + (r() - 0.5) * 0.6;
      pos[i * 3 + 1] = (s.y ?? 0) + 1.85;
      pos[i * 3 + 2] = s.z + (r() - 0.5) * 0.6;
      sd[i * 3] = r();
      sd[i * 3 + 1] = r();
      sd[i * 3 + 2] = r();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 3));
    geo.computeBoundingSphere();
    geo.boundingSphere!.radius += 6;
    this.u = { uTime: { value: 0 }, uAmount: { value: 0 }, uLightFrom: { value: new THREE.Vector3(0, 4, 2) }, uLight: { value: new THREE.Color() }, uMap: { value: blobTexture() } };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: STEAM_VERT, fragmentShader: STEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.object = new THREE.Points(geo, mat);
    this.object.visible = false;
  }

  /**
   * Builds over a hard peak (a minute or two to fill the room) and clears in
   * a breakdown; lit by `light` coming from `from`.
   */
  update(dt: number, hype: number, peak: number, playing: boolean, light: THREE.Color, from: THREE.Vector3): void {
    this.amount = steamStep(this.amount, dt, hype, peak, playing);
    this.u.uTime.value += dt;
    this.u.uAmount.value = this.amount;
    (this.u.uLight.value as THREE.Color).copy(light);
    (this.u.uLightFrom.value as THREE.Vector3).copy(from);
    this.object.visible = this.amount > 0.01;
  }
}

/** the room's steam after dt: up at the peak of a hot room, down otherwise */
export function steamStep(cur: number, dt: number, hype: number, peak: number, playing: boolean): number {
  const heat = playing ? Math.max(0, hype - 0.62) * 2.6 * (0.5 + peak) : 0;
  const target = Math.min(1, heat);
  const rate = target > cur ? 0.012 : 0.03;
  return cur + (target - cur) * Math.min(1, dt * rate * 6);
}

/** sweat: builds over a sustained peak, dries off slowly */
export function sweatStep(cur: number, dt: number, hype: number, peak: number, playing: boolean): number {
  const work = playing ? Math.max(0, hype - 0.55) * 2 * (0.6 + peak * 0.8) : 0;
  const next = work > 0.05 ? cur + dt * work * 0.012 : cur - dt * 0.004;
  return THREE.MathUtils.clamp(next, 0, 1);
}
