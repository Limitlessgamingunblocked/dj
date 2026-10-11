/*
 * Open water (the Beach Club's bay, the Boat Party's river):
 *   – waves: a few Gerstner swells move the surface itself near the camera
 *     (on a grid of rings, fine underfoot and coarse at the horizon), and two
 *     drifting layers of ripples break up the light on top
 *   – reflections: the real sky (the same scattering table and clouds the
 *     dome draws), the sun's glitter path and the moon's; rows of lamps along
 *     a shore or a bank smeared into shimmering columns by the waves; the
 *     show's lights (the stage, the deck's LEDs) as glitter under each one
 *   – the water itself: dark and deep, lighter where a crest turns to the
 *     light, with Fresnel deciding how much is reflection
 *   – foam: surf running up a shore and washing back; a boat's wake (the
 *     churn behind the stern, the two arms of the V, the wash along the hull)
 */
import * as THREE from 'three';
import { SKYVIEW_GLSL } from './atmosphere';
import type { SkyLook } from './outdoor';
import type { PhysicalSky } from './sky';
import { tilingNoise } from './sky';

export interface Swell {
  /** direction of travel (xz) */
  dir: [number, number];
  /** wavelength (m) */
  length: number;
  /** height (m, half the crest-to-trough) */
  amp: number;
  /** how sharp the crests are, 0..1 */
  steep?: number;
}

/** a row of lamps on a vertical plane: dot(p.xz, n) = d, between heights y0 and y1 */
export interface LampRow {
  n: [number, number];
  d: number;
  y0: number;
  y1: number;
  color: THREE.Color;
  /** distance between lamps along the row (0: one continuous glow) */
  spacing: number;
  /** how far the lamps have moved along the row (a boat going past them) */
  offset?: number;
}

export interface WaterSpec {
  swells: Swell[];
  /** the water's own colour, deep */
  deep: string;
  /** where light gets into a crest */
  shallow?: string;
  /** ripples: size (m) and strength */
  ripple?: number;
  rippleScale?: number;
  /** drift of the whole surface (m/s), e.g. the river flowing past */
  flow?: [number, number];
  /** a shore: the line dot(p.xz, n) = d where the surf breaks (n points out to sea) */
  shore?: { n: [number, number]; d: number };
  /** a boat at the origin heading −z: its stern, half its beam, the hull's length */
  wake?: { stern: number; beam: number; length: number };
}

const MAX_SWELLS = 4;
const MAX_LIGHTS = 8;
const MAX_ROWS = 3;

let rippleTex: THREE.DataTexture | null = null;
function rippleTexture(): THREE.DataTexture {
  if (rippleTex) return rippleTex;
  const n = 256;
  const a = tilingNoise(n, 91, [8, 16, 32, 64]);
  const b = tilingNoise(n, 92, [6, 12, 24, 48], [1.6, 0.6]);
  const foam = tilingNoise(n, 93, [16, 32, 64, 128]);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = Math.round(a[i] * 255);
    data[i * 4 + 1] = Math.round(b[i] * 255);
    data[i * 4 + 2] = Math.round(foam[i] * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.userData.shared = true;
  t.needsUpdate = true;
  rippleTex = t;
  return t;
}

/** rings out from the centre: `rings` of them from r0 to r1, spaced geometrically, `seg` round */
export function ringGrid(r0: number, r1: number, rings: number, seg: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  const k = Math.pow(r1 / r0, 1 / (rings - 1));
  for (let i = 0; i < rings; i++) {
    const r = r0 * Math.pow(k, i);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
    }
  }
  // the centre fan
  for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = 1 + i * seg + j;
      const b = 1 + i * seg + ((j + 1) % seg);
      const c = a + seg;
      const d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const GERSTNER = /* glsl */ `
  uniform vec4 uSwell[${MAX_SWELLS}]; // dir.xy, k (2π/λ), amp
  uniform float uSteep[${MAX_SWELLS}];
  uniform float uTime;
  uniform vec2 uFlow;
  // displacement and the surface's slope at p
  vec3 gerstner(vec2 p, float fade, out vec2 slope) {
    vec3 o = vec3(0.0);
    slope = vec2(0.0);
    for (int i = 0; i < ${MAX_SWELLS}; i++) {
      vec4 s = uSwell[i];
      if (s.w <= 0.0) continue;
      float k = s.z;
      float w = sqrt(9.81 * k);
      float ph = k * dot(s.xy, p) - w * uTime;
      float a = s.w * fade;
      float q = uSteep[i] / (k * max(s.w, 1e-3) * ${MAX_SWELLS}.0);
      o.xz += s.xy * (q * a * cos(ph));
      o.y += a * sin(ph);
      slope += s.xy * (k * a * cos(ph));
    }
    return o;
  }
`;

const VERT = /* glsl */ `
  ${GERSTNER}
  varying vec3 vWorld;
  varying float vHeight;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec2 p = w.xz + uFlow * uTime;
    // the swells move the surface near the camera; further out they're only in the shading
    float fade = 1.0 - smoothstep(60.0, 160.0, length(w.xz - cameraPosition.xz));
    vec2 slope;
    vec3 d = gerstner(p, fade, slope);
    w.xyz += d;
    vWorld = w.xyz;
    vHeight = d.y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FRAG = /* glsl */ `
  ${GERSTNER}
  ${SKYVIEW_GLSL}
  uniform sampler2D uSkyLut, uClouds, uRipples;
  uniform vec2 uWind;
  uniform float uCover, uRipple, uRippleScale, uSkyOn;
  uniform vec3 uSunDir, uSunDisc, uMoonDir, uMoonLight, uCloudSun, uCloudAmb, uSkyFallback;
  uniform vec3 uDeep, uShallow, uFill;
  uniform vec4 uLightPos[${MAX_LIGHTS}];
  uniform vec3 uLightCol[${MAX_LIGHTS}];
  uniform vec4 uRowPlane[${MAX_ROWS}]; // n.xy, d, spacing
  uniform vec4 uRowSpan[${MAX_ROWS}]; // y0, y1, offset, on
  uniform vec3 uRowCol[${MAX_ROWS}];
  uniform vec4 uShore; // n.xy, d, on
  uniform vec4 uWake; // stern z, beam, hull length, on
  uniform vec3 uFogCol;
  uniform float uFogDensity;
  varying vec3 vWorld;
  varying float vHeight;
  float ggx(float nh, float a) {
    float a2 = a * a;
    float d = nh * nh * (a2 - 1.0) + 1.0;
    return a2 / (3.14159 * d * d);
  }
  vec2 rippleSlope(vec2 p, float scale, float ch) {
    float e = 1.0 / 256.0;
    vec2 uv = p / scale;
    float h0 = ch < 0.5 ? texture2D(uRipples, uv).r : texture2D(uRipples, uv).g;
    float hx = ch < 0.5 ? texture2D(uRipples, uv + vec2(e, 0.0)).r : texture2D(uRipples, uv + vec2(e, 0.0)).g;
    float hz = ch < 0.5 ? texture2D(uRipples, uv + vec2(0.0, e)).r : texture2D(uRipples, uv + vec2(0.0, e)).g;
    return vec2(hx - h0, hz - h0) * (256.0 / scale);
  }
  vec3 skyIn(vec3 r) {
    r.y = max(r.y, 0.01);
    r = normalize(r);
    vec3 s = uSkyOn > 0.5 ? texture2D(uSkyLut, skyUv(r)).rgb : uSkyFallback;
    // the clouds in it: one look at the heaped layer
    float R = 6360.0;
    float b = (R + 0.01) * r.y;
    float c = (R + 0.01) * (R + 0.01) - (R + 2.0) * (R + 2.0);
    float t = -b + sqrt(max(0.0, b * b - c));
    vec2 cp = r.xz * t;
    float n = texture2D(uClouds, cp * 0.045 + uWind * 0.045).r * 0.74 + texture2D(uClouds, cp * 0.21 + uWind * 0.06).g * 0.26;
    float th = 0.674 - uCover * 0.31;
    float dens = smoothstep(th, th + 0.06, n) * smoothstep(0.0, 0.1, r.y);
    return mix(s, uCloudSun * 0.9 + uCloudAmb, dens * 0.85);
  }
  void main() {
    vec3 V = cameraPosition - vWorld;
    float dist = length(V);
    V /= dist;
    vec2 p = vWorld.xz + uFlow * uTime;
    vec2 slope;
    gerstner(p, 1.0, slope);
    // ripples: two drifting layers, fading out where they'd only shimmer
    float rf = 1.0 - smoothstep(40.0, 400.0, dist);
    vec2 rs = rippleSlope(p + vec2(uTime * 0.31, uTime * 0.17), uRippleScale, 0.0) + rippleSlope(p * 1.7 - vec2(uTime * 0.23, -uTime * 0.29), uRippleScale, 1.0) * 0.6;
    slope += rs * uRipple * rf;
    vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
    float nv = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
    vec3 R = reflect(-V, N);
    // rougher further away, where a pixel spans many waves
    float rough = mix(0.06, 0.3, smoothstep(30.0, 600.0, dist));
    vec3 col = skyIn(R) * F;
    // the sun's path and the moon's
    vec3 S = normalize(uSunDir);
    vec3 H = normalize(S + V);
    col += uSunDisc * ggx(max(dot(N, H), 0.0), rough) * F * 0.25 * step(0.0, S.y);
    vec3 M = normalize(uMoonDir);
    vec3 Hm = normalize(M + V);
    col += uMoonLight * ggx(max(dot(N, Hm), 0.0), rough * 1.4) * F * 0.012 * step(0.0, M.y);
    // the show's lights: glitter under each one
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      vec4 lp = uLightPos[i];
      if (lp.w <= 0.0) continue;
      vec3 Lv = lp.xyz - vWorld;
      float ld = length(Lv);
      vec3 L = Lv / ld;
      vec3 Hl = normalize(L + V);
      float att = lp.w * lp.w / (lp.w * lp.w + ld * ld);
      col += uLightCol[i] * ggx(max(dot(N, Hl), 0.0), rough * 1.3) * F * att * 0.6;
    }
    // rows of lamps (a shore, a bank): where the reflected ray meets their plane, at their height
    for (int i = 0; i < ${MAX_ROWS}; i++) {
      vec4 pl = uRowPlane[i];
      vec4 sp = uRowSpan[i];
      if (sp.w <= 0.0) continue;
      float den = dot(R.xz, pl.xy);
      if (den <= 0.02) continue;
      float t = (pl.z - dot(vWorld.xz, pl.xy)) / den;
      if (t <= 0.0) continue;
      vec3 hit = vWorld + R * t;
      float inRow = smoothstep(sp.x - 1.0, sp.x, hit.y) * (1.0 - smoothstep(sp.y, sp.y + 1.0, hit.y));
      vec2 tang = vec2(-pl.y, pl.x);
      float along = dot(hit.xz, tang) + sp.z;
      float lamp = pl.w > 0.0 ? pow(0.5 + 0.5 * cos(6.28318 * along / pl.w), 12.0) * 2.5 : 1.0;
      col += uRowCol[i] * inRow * lamp * F * 3.0 * exp(-t / 900.0);
    }
    // the water itself: deep, lighter where a crest turns to the light
    float crest = clamp(vHeight * 2.5, 0.0, 1.0);
    vec3 body = uDeep * (uFill * 0.6 + uSunDisc * max(S.y, 0.0) * 0.25);
    body += uShallow * crest * (uFill * 0.5 + uSunDisc * max(dot(normalize(vec3(-S.x, 0.2, -S.z)), V), 0.0) * 0.6);
    col += body * (1.0 - F);
    // surf: lines of foam running in to the shore and washing back
    float foam = 0.0;
    if (uShore.w > 0.5) {
      float sd = dot(vWorld.xz, uShore.xy) - uShore.z;
      float wash = sin(uTime * 0.55) * 1.6;
      float run = fract(sd / 9.0 + uTime * 0.09);
      float lines = smoothstep(0.86, 1.0, run) * (1.0 - smoothstep(0.0, 70.0, sd));
      float edge = smoothstep(4.0, 0.0, abs(sd - wash)) * smoothstep(-6.0, 0.0, sd);
      float br = texture2D(uRipples, p / 14.0 + uTime * 0.01).b;
      foam = max(lines * smoothstep(0.35, 0.7, br), edge * smoothstep(0.25, 0.6, br));
    }
    // a boat's wake: the churn behind the stern, the arms of the V, the wash along the hull
    if (uWake.w > 0.5) {
      float ax = abs(vWorld.x);
      float dz = vWorld.z - uWake.x;
      float br = texture2D(uRipples, vec2(vWorld.x, vWorld.z + uFlow.y * uTime * -1.0) / 10.0).b;
      if (dz > 0.0) {
        float churn = (1.0 - smoothstep(uWake.y * 0.5, uWake.y * 1.1 + dz * 0.06, ax)) * exp(-dz / 70.0);
        float arm = uWake.y + dz * 0.354;
        float arms = smoothstep(1.2 + dz * 0.05, 0.0, abs(ax - arm)) * exp(-dz / 140.0);
        foam = max(foam, max(churn, arms * 0.8) * smoothstep(0.3, 0.65, br + 0.15));
      }
      float along = smoothstep(uWake.y + 1.6, uWake.y + 0.1, ax) * step(uWake.x - uWake.z, vWorld.z) * step(vWorld.z, uWake.x);
      foam = max(foam, along * smoothstep(0.4, 0.7, br) * 0.7);
    }
    vec3 foamCol = uFill * 1.2 + uSunDisc * max(S.y, 0.0) * 0.8 + uMoonLight * 0.01;
    col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.85);
    float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogCol, clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }`;

export interface WaterLight {
  pos: THREE.Vector3;
  color: THREE.Color;
  /** how far its glitter carries (m) */
  reach: number;
}

export class Water {
  readonly mesh: THREE.Mesh;
  readonly u: Record<string, THREE.IUniform>;

  constructor(radius: number, readonly spec: WaterSpec) {
    const swell = Array.from({ length: MAX_SWELLS }, (_, i) => {
      const s = spec.swells[i];
      if (!s) return new THREE.Vector4(1, 0, 1, 0);
      const d = new THREE.Vector2(...s.dir).normalize();
      return new THREE.Vector4(d.x, d.y, (Math.PI * 2) / s.length, s.amp);
    });
    this.u = {
      uSwell: { value: swell },
      uSteep: { value: Array.from({ length: MAX_SWELLS }, (_, i) => spec.swells[i]?.steep ?? 0.5) },
      uTime: { value: 0 },
      uFlow: { value: new THREE.Vector2(...(spec.flow ?? [0, 0])) },
      uSkyLut: { value: null },
      uClouds: { value: null },
      uWind: { value: new THREE.Vector2() },
      uCover: { value: 0 },
      uSkyOn: { value: 0 },
      uSkyFallback: { value: new THREE.Color() },
      uRipples: { value: rippleTexture() },
      uRipple: { value: spec.ripple ?? 0.06 },
      uRippleScale: { value: spec.rippleScale ?? 6 },
      uSunDir: { value: new THREE.Vector3(0, 0.2, 1) },
      uSunDisc: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(0, 0.3, -1) },
      uMoonLight: { value: new THREE.Color() },
      uCloudSun: { value: new THREE.Color() },
      uCloudAmb: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color(spec.deep) },
      uShallow: { value: new THREE.Color(spec.shallow ?? '#1f7a72') },
      uFill: { value: new THREE.Color() },
      uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color()) },
      uRowPlane: { value: Array.from({ length: MAX_ROWS }, () => new THREE.Vector4()) },
      uRowSpan: { value: Array.from({ length: MAX_ROWS }, () => new THREE.Vector4()) },
      uRowCol: { value: Array.from({ length: MAX_ROWS }, () => new THREE.Color()) },
      uShore: { value: spec.shore ? new THREE.Vector4(...new THREE.Vector2(...spec.shore.n).normalize().toArray(), spec.shore.d, 1) : new THREE.Vector4() },
      uWake: { value: spec.wake ? new THREE.Vector4(spec.wake.stern, spec.wake.beam, spec.wake.length, 1) : new THREE.Vector4() },
      uFogCol: { value: new THREE.Color() },
      uFogDensity: { value: 0.002 },
    };
    this.mesh = new THREE.Mesh(ringGrid(0.6, radius, 120, 128), new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, fog: false }));
    // the swells lift the surface above its flat bounds
    this.mesh.geometry.boundingSphere!.radius += 2;
  }

  /** reflect this sky (its scattering table and clouds) */
  useSky(sky: PhysicalSky): void {
    const u = this.u;
    u.uSkyLut.value = sky.lutTexture;
    u.uClouds.value = sky.u.uClouds.value;
    u.uWind.value = sky.u.uWind.value;
    u.uCover.value = sky.u.uCover.value;
    u.uSunDisc.value = sky.u.uSunDisc.value;
    u.uMoonLight.value = sky.u.uMoonLight.value;
    u.uCloudSun.value = sky.u.uCloudSun.value;
    u.uCloudAmb.value = sky.u.uCloudAmb.value;
    u.uSunDir.value = sky.sunDir;
    u.uMoonDir.value = sky.moonDir;
    u.uSkyOn.value = 1;
  }

  /** the show's lights over the water this frame (up to 8) */
  setLights(lights: WaterLight[]): void {
    const pos = this.u.uLightPos.value as THREE.Vector4[];
    const col = this.u.uLightCol.value as THREE.Color[];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = lights[i];
      if (!l) {
        pos[i].w = 0;
        continue;
      }
      pos[i].set(l.pos.x, l.pos.y, l.pos.z, l.reach);
      col[i].copy(l.color);
    }
  }

  /** rows of lamps reflected (up to 3) */
  setRows(rows: LampRow[]): void {
    const pl = this.u.uRowPlane.value as THREE.Vector4[];
    const sp = this.u.uRowSpan.value as THREE.Vector4[];
    const col = this.u.uRowCol.value as THREE.Color[];
    for (let i = 0; i < MAX_ROWS; i++) {
      const r = rows[i];
      if (!r) {
        sp[i].w = 0;
        continue;
      }
      const n = new THREE.Vector2(...r.n).normalize();
      pl[i].set(n.x, n.y, r.d, r.spacing);
      sp[i].set(r.y0, r.y1, r.offset ?? 0, 1);
      col[i].copy(r.color);
    }
  }

  update(t: number, l: SkyLook, fog: THREE.FogExp2, fill: THREE.Color): void {
    this.u.uTime.value = t;
    (this.u.uSkyFallback.value as THREE.Color).copy(l.horizon).lerp(l.zenith, 0.35);
    (this.u.uFill.value as THREE.Color).copy(fill);
    (this.u.uFogCol.value as THREE.Color).copy(fog.color);
    this.u.uFogDensity.value = fog.density;
  }
}
