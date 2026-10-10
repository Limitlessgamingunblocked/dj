/*
 * Open-air pieces for the venues outside (Section 5.2): a sky that runs
 * through the time of day as the set goes on (golden hour → night on the
 * Rooftop, sunset over the sea at the Beach Club, the sunrise on the closing
 * set), the sun and the light it throws, water with the sun's path on it, a
 * city skyline whose windows can switch on block by block, palm trees and
 * the sun loungers.
 *
 * TODO: procedural stand-ins for Blender sets (Section 14).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, rng, windowsTexture } from './tex';

/* ------------------------------------------------------------------ */
/* time of day                                                          */
/* ------------------------------------------------------------------ */

/** one moment of the day, as hex colours and numbers */
export interface SkyKey {
  /** where in the set (0..1) */
  k: number;
  zenith: string;
  horizon: string;
  /** below the horizon (sea or land far off) */
  ground: string;
  /** the sun's height in degrees (negative: below the horizon) */
  sun: number;
  sunColor: string;
  /** direct sunlight intensity */
  light: number;
  /** sky and ground fill (the hemisphere light) */
  ambSky: string;
  ambGround: string;
  amb: number;
  /** 0..1 stars out */
  stars: number;
  /** how much the city / site lights are on, 0..1 */
  night: number;
}

export interface SkyLook {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sun: number;
  sunColor: THREE.Color;
  light: number;
  ambSky: THREE.Color;
  ambGround: THREE.Color;
  amb: number;
  stars: number;
  night: number;
}

export function newLook(): SkyLook {
  return { zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sun: 0, sunColor: new THREE.Color(), light: 0, ambSky: new THREE.Color(), ambGround: new THREE.Color(), amb: 0, stars: 0, night: 0 };
}

const ca = new THREE.Color();
const cb = new THREE.Color();

/** the sky at `k`, between the keys either side (smoothly) */
export function sampleSky(keys: SkyKey[], k: number, out: SkyLook = newLook()): SkyLook {
  const x = Math.max(0, Math.min(1, k));
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].k < x) i++;
  const a = keys[i];
  const b = keys[Math.min(keys.length - 1, i + 1)];
  const span = b.k - a.k;
  const t0 = span > 0 ? Math.max(0, Math.min(1, (x - a.k) / span)) : 0;
  const t = t0 * t0 * (3 - 2 * t0);
  const col = (o: THREE.Color, p: string, q: string) => o.copy(ca.set(p)).lerp(cb.set(q), t);
  const num = (p: number, q: number) => p + (q - p) * t;
  col(out.zenith, a.zenith, b.zenith);
  col(out.horizon, a.horizon, b.horizon);
  col(out.ground, a.ground, b.ground);
  col(out.sunColor, a.sunColor, b.sunColor);
  col(out.ambSky, a.ambSky, b.ambSky);
  col(out.ambGround, a.ambGround, b.ambGround);
  out.sun = num(a.sun, b.sun);
  out.light = num(a.light, b.light);
  out.amb = num(a.amb, b.amb);
  out.stars = num(a.stars, b.stars);
  out.night = num(a.night, b.night);
  return out;
}

/** a direction for the sun: `elev` degrees up, at bearing `yaw` (0 = straight down +Z behind the booth) */
export function sunDirection(elev: number, yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(elev);
  return out.set(Math.sin(yaw) * Math.cos(e), Math.sin(e), Math.cos(yaw) * Math.cos(e)).normalize();
}

/* ------------------------------------------------------------------ */
/* the sky dome                                                         */
/* ------------------------------------------------------------------ */

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uGlow;
  uniform float uSunSize;
  uniform float uStars;
  uniform float uTime;
  uniform float uHalo;
  varying vec3 vDir;
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, max(h, 0.0)));
    // the glow along the horizon (city light, the sun's afterglow)
    col += uGlow * exp(-abs(h) * 12.0);
    // below the horizon: the sea or the land far off
    col = mix(col, uGround, 1.0 - smoothstep(-0.06, 0.0, h));
    vec3 s = normalize(uSunDir);
    float sd = clamp(dot(d, s), -1.0, 1.0);
    float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.8), sd);
    float halo = exp((sd - 1.0) * 14.0) * 0.5 + exp((sd - 1.0) * 160.0) * 0.9;
    // the horizon cuts the disc (the sea, the hills)
    float above = smoothstep(-0.004, 0.004, h);
    col += uSunColor * (disc * 5.0 * above + halo * uHalo);
    // stars, twinkling, gone near the horizon
    vec3 cell = floor(d * 240.0);
    float n = hash3(cell);
    float star = step(0.9968, n) * smoothstep(0.03, 0.25, h) * uStars;
    star *= 0.55 + 0.45 * sin(uTime * (0.8 + n * 3.0) + n * 40.0);
    col += vec3(star * 1.2);
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly sunDir = new THREE.Vector3(0, 0.2, 1);
  private u: Record<string, THREE.IUniform>;

  constructor(radius = 700) {
    this.u = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir },
      uSunColor: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color(0, 0, 0) },
      uSunSize: { value: 0.022 },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uHalo: { value: 1 },
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  /** the look of the sky now; the sun at `yaw` (0: behind the booth, +Z) */
  apply(l: SkyLook, yaw: number, t: number, glow?: THREE.Color): void {
    (this.u.uZenith.value as THREE.Color).copy(l.zenith);
    (this.u.uHorizon.value as THREE.Color).copy(l.horizon);
    (this.u.uGround.value as THREE.Color).copy(l.ground);
    (this.u.uSunColor.value as THREE.Color).copy(l.sunColor);
    if (glow) (this.u.uGlow.value as THREE.Color).copy(glow);
    sunDirection(l.sun, yaw, this.sunDir);
    // the halo fades once the sun is well down
    this.u.uHalo.value = THREE.MathUtils.clamp((l.sun + 8) / 10, 0, 1);
    this.u.uStars.value = l.stars;
    this.u.uTime.value = t;
  }
}

/* ------------------------------------------------------------------ */
/* water                                                                */
/* ------------------------------------------------------------------ */

const WATER_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uChop;
  uniform vec2 uFlow;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSun;
  uniform vec3 uGlints;
  uniform float uGlintAmt;
  uniform vec3 uFogCol;
  uniform float uFogDensity;
  varying vec3 vWorld;
  void main() {
    vec2 p = vWorld.xz + uFlow * uTime;
    float t = uTime;
    // a few crossing swells: the slope of their sum is the normal
    vec2 g = vec2(0.0);
    g += vec2(0.31, 0.12) * cos(dot(p, vec2(0.31, 0.12)) + t * 0.9) * 0.6;
    g += vec2(-0.17, 0.42) * cos(dot(p, vec2(-0.17, 0.42)) + t * 1.3) * 0.4;
    g += vec2(0.83, -0.51) * cos(dot(p, vec2(0.83, -0.51)) + t * 2.1) * 0.12;
    g += vec2(1.9, 1.3) * cos(dot(p, vec2(1.9, 1.3)) + t * 3.3) * 0.035;
    vec3 n = normalize(vec3(-g.x * uChop, 1.0, -g.y * uChop));
    vec3 v = normalize(cameraPosition - vWorld);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 r = reflect(-v, n);
    vec3 col = mix(uDeep, uSky, fres);
    float sr = clamp(dot(r, normalize(uSunDir)), 0.0, 1.0);
    col += uSunColor * uSun * (pow(sr, 400.0) * 10.0 + pow(sr, 30.0) * 0.35);
    // lights on the shore and the boat smeared in long streaks
    float streak = pow(clamp(1.0 - abs(r.y) * 3.0, 0.0, 1.0), 6.0);
    col += uGlints * uGlintAmt * streak * (0.5 + 0.5 * sin(p.x * 3.1 + t * 2.0) * sin(p.y * 0.7 - t));
    float dist = length(cameraPosition - vWorld);
    float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogCol, clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }`;

export class Water {
  readonly mesh: THREE.Mesh;
  readonly u: Record<string, THREE.IUniform>;

  constructor(size = 1600, o: { chop?: number; deep?: string; flow?: [number, number] } = {}) {
    this.u = {
      uTime: { value: 0 },
      uChop: { value: o.chop ?? 0.6 },
      uFlow: { value: new THREE.Vector2(...(o.flow ?? [0, 0])) },
      uDeep: { value: new THREE.Color(o.deep ?? '#06222c') },
      uSky: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 0.2, 1) },
      uSunColor: { value: new THREE.Color() },
      uSun: { value: 1 },
      uGlints: { value: new THREE.Color(1, 0.7, 0.4) },
      uGlintAmt: { value: 0 },
      uFogCol: { value: new THREE.Color() },
      uFogDensity: { value: 0.002 },
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: false }));
  }

  update(t: number, l: SkyLook, sunDir: THREE.Vector3, fog: THREE.FogExp2): void {
    this.u.uTime.value = t;
    (this.u.uSky.value as THREE.Color).copy(l.horizon).lerp(l.zenith, 0.35);
    (this.u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (this.u.uSunColor.value as THREE.Color).copy(l.sunColor);
    this.u.uSun.value = THREE.MathUtils.clamp((l.sun + 1.5) / 4, 0, 1);
    (this.u.uFogCol.value as THREE.Color).copy(fog.color);
    this.u.uFogDensity.value = fog.density;
  }
}

/* ------------------------------------------------------------------ */
/* a city skyline                                                       */
/* ------------------------------------------------------------------ */

export interface SkylineBlock {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  /** its angle round the skyline (radians), for sweeps */
  angle: number;
}

/**
 * A ring of buildings round `center`, between `inner` and `outer` metres,
 * across the arc `from`..`to` (radians, 0 = +Z, going towards +X). Split into
 * `blocks` sectors, each its own material, so their windows can come on one
 * block at a time. Window light is emissive, set per block (0..1).
 */
export function skyline(o: { seed: number; inner: number; outer: number; from: number; to: number; blocks: number; minH: number; maxH: number; y?: number; lit?: string; body?: string; center?: THREE.Vector3; density?: number }): { group: THREE.Group; blocks: SkylineBlock[]; beacons: THREE.Vector3[] } {
  const r = rng(o.seed);
  const group = new THREE.Group();
  const blocks: SkylineBlock[] = [];
  const beacons: THREE.Vector3[] = [];
  const c = o.center ?? new THREE.Vector3();
  const y0 = o.y ?? 0;
  const win = windowsTexture(`skyline:${o.seed}`, o.lit ?? '#ffd9a0', o.density ?? 0.6);
  for (let b = 0; b < o.blocks; b++) {
    const a0 = o.from + ((o.to - o.from) * b) / o.blocks;
    const a1 = o.from + ((o.to - o.from) * (b + 1)) / o.blocks;
    const geos: THREE.BufferGeometry[] = [];
    const span = Math.abs(a1 - a0);
    // rows of buildings, nearer ones lower
    for (let row = 0; row < 3; row++) {
      const rad = o.inner + ((o.outer - o.inner) * (row + r() * 0.5)) / 3;
      let a = Math.min(a0, a1);
      while (a < Math.max(a0, a1)) {
        const w = 10 + r() * 22;
        const d = 10 + r() * 18;
        const tall = r() < 0.12;
        const h = (o.minH + (o.maxH - o.minH) * Math.pow(r(), 1.6)) * (tall ? 1.7 : 1) * (0.7 + row * 0.25);
        const g = new THREE.BoxGeometry(w, h, d);
        // windows: one texture tile per ~4 × 12 m
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) {
          const face = Math.floor(i / 4);
          const fw = face < 2 ? d : w;
          uv.setXY(i, uv.getX(i) * (fw / 16), uv.getY(i) * (h / 36));
        }
        const x = c.x + Math.sin(a) * rad;
        const z = c.z + Math.cos(a) * rad;
        g.rotateY(a + (r() - 0.5) * 0.3);
        g.translate(x, y0 + h / 2, z);
        geos.push(g.toNonIndexed());
        if (tall) beacons.push(new THREE.Vector3(x, y0 + h + 1, z));
        a += (w * 1.15) / rad + r() * 0.01;
        if (span <= 0) break;
      }
    }
    if (!geos.length) continue;
    const mat = new THREE.MeshStandardMaterial({ color: o.body ?? '#2b303a', roughness: 0.85, metalness: 0.1, emissive: new THREE.Color(1, 1, 1), emissiveMap: win, emissiveIntensity: 0.2 });
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
    group.add(mesh);
    blocks.push({ mesh, mat, angle: (a0 + a1) / 2 });
  }
  return { group, blocks, beacons };
}

/** red aircraft lights on the tall towers: one Points object, slow blink */
export function beaconLights(points: THREE.Vector3[]): { object: THREE.Points; update(t: number, night: number): void } {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.PointsMaterial({ color: new THREE.Color(3, 0.15, 0.1), size: 4, sizeAttenuation: true, transparent: true, depthWrite: false, toneMapped: false, fog: false });
  const object = new THREE.Points(geo, mat);
  return {
    object,
    update(t, night) {
      // once a second, half on (well under the flash limit)
      mat.opacity = night * (Math.sin(t * Math.PI) > 0 ? 1 : 0.15);
    },
  };
}

/* ------------------------------------------------------------------ */
/* palms, loungers                                                      */
/* ------------------------------------------------------------------ */

function frondTexture(): THREE.CanvasTexture {
  return canvasTexture('palm-frond', 128, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // the midrib, and leaflets angled out along it
    g.strokeStyle = '#3d5a22';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(w / 2, h);
    g.lineTo(w / 2, 0);
    g.stroke();
    for (let y = h - 20; y > 6; y -= 9) {
      const len = (w / 2 - 4) * Math.sin((Math.PI * (h - y)) / h) * 0.95 + 6;
      for (const s of [-1, 1]) {
        g.strokeStyle = `hsl(${88 + Math.sin(y) * 8}, 45%, ${24 + ((y * 7) % 10)}%)`;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(w / 2, y);
        g.quadraticCurveTo(w / 2 + s * len * 0.6, y - 10, w / 2 + s * len, y - 26);
        g.stroke();
      }
    }
  });
}

/** a palm: a leaning, tapering trunk and a crown of drooping fronds */
export function palmTree(seed: number, height = 7): { group: THREE.Group; trunk: THREE.MeshStandardMaterial; crownTop: THREE.Vector3 } {
  const r = rng(seed);
  const group = new THREE.Group();
  const lean = new THREE.Vector3((r() - 0.5) * 0.6, 1, (r() - 0.5) * 0.6).normalize();
  const bend = (r() - 0.5) * 0.25;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector3(lean.x * height * t + bend * height * t * t, height * t, lean.z * height * t));
  }
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = a.distanceTo(b);
    const r0 = 0.22 - i * 0.012;
    const seg = new THREE.CylinderGeometry(r0 - 0.012, r0, len * 1.02, 10, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
    seg.applyQuaternion(q);
    seg.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    geos.push(seg.toNonIndexed());
  }
  const trunk = new THREE.MeshStandardMaterial({
    color: 0x6e5a44,
    roughness: 0.95,
    emissive: new THREE.Color(0, 0, 0),
    map: canvasTexture('palm-bark', 64, 256, (g, w, h) => {
      g.fillStyle = '#7a6650';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 10) {
        g.fillStyle = 'rgba(40,28,18,0.55)';
        g.fillRect(0, y, w, 3);
      }
    }),
  });
  const tm = new THREE.Mesh(mergeGeometries(geos)!, trunk);
  group.add(tm);
  // the crown
  const top = pts[pts.length - 1];
  const leaf = new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, color: 0xc8d8a8 });
  const fronds: THREE.BufferGeometry[] = [];
  const n = 9 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const L = 2.6 + r() * 1.2;
    const g = new THREE.PlaneGeometry(0.9, L, 1, 8);
    // droop: bend the leaf down along its length
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + L / 2;
      const t = y / L;
      p.setXYZ(k, p.getX(k) * (1 - t * 0.4), y * Math.cos(t * 1.2), -y * Math.sin(t * 1.2) * 0.9 - t * t * 0.6);
    }
    g.rotateX(-Math.PI / 2 + 0.5 + r() * 0.3);
    g.rotateY((i / n) * Math.PI * 2 + r() * 0.3);
    g.translate(top.x, top.y, top.z);
    fronds.push(g);
  }
  group.add(new THREE.Mesh(mergeGeometries(fronds)!, leaf));
  return { group, trunk, crownTop: top.clone() };
}

/** a white sun lounger, about 2 m long, back raised */
export function lounger(): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 });
  const pad = new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 1.35), pad);
  base.position.set(0, 0.36, -0.2);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.7), pad);
  back.position.set(0, 0.55, 0.72);
  back.rotation.x = -0.6;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.22, 1.9), white);
  frame.position.set(0, 0.2, 0.05);
  g.add(frame, base, back);
  return g;
}
