/*
 * The sky as light through air (Section 5.2's open-air venues): single
 * scattering through a planet's atmosphere, Rayleigh (the blue of the sky,
 * the reddening of a low sun), Mie (the white glare round the sun, haze and
 * dust) and ozone (the deep blue overhead at twilight). The same model runs
 * twice:
 *   – on the CPU, a handful of directions a frame: the sun's colour where
 *     it reaches the ground and the clouds, and the sky's light on the scene
 *     (the hemisphere fill), so the venue is lit by the sky you see
 *   – on the GPU, into a small sky-view table (azimuth × elevation, packed
 *     towards the horizon) that the dome reads, re-drawn when the sun or the
 *     moon moves
 * The moon is a second, dimmer source in the same air, so a moonlit night
 * has a deep blue sky rather than black. It's far brighter than a real moon
 * (day for night, as on film), or the night would be invisible on a screen.
 * Distances are in km.
 */
import * as THREE from 'three';

export const EARTH_R = 6360;
export const ATMOS_R = 6420;
const RAYLEIGH: [number, number, number] = [5.802e-3, 13.558e-3, 33.1e-3];
const RAYLEIGH_H = 8;
const MIE = 3.996e-3;
const MIE_EXT = MIE / 0.9;
const MIE_H = 1.2;
const MIE_G = 0.8;
const OZONE: [number, number, number] = [0.65e-3, 1.881e-3, 0.085e-3];

/** how the air looks at a venue */
export interface AirSpec {
  /** haze and dust: 1 is a clear day at sea, 3 a dusty desert */
  turbidity: number;
  /** the brightest the sky gets: sky radiance per unit of sunlight */
  scale?: number;
}

/** sky radiance per unit sun (calibrated so a clear midday zenith reads about like the old keyed skies) */
export const SKY_SCALE = 2.4;
/** the moon, as a fraction of the sun (day for night) */
export const MOON_I = 0.012;
/** the night sky's own glow (airglow, starlight), so a moonless night isn't black */
export const AIRGLOW: [number, number, number] = [0.0006, 0.0009, 0.0018];

function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, r: number): [number, number] | null {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

/** density of each kind of air at a height (km): rayleigh, mie, ozone */
function densities(h: number): [number, number, number] {
  return [Math.exp(-h / RAYLEIGH_H), Math.exp(-h / MIE_H), Math.max(0, 1 - Math.abs(h - 25) / 15)];
}

/** optical depth along a ray from a point (planet-centred, km) out of the atmosphere; null if the planet is in the way */
function depthToSpace(px: number, py: number, pz: number, dx: number, dy: number, dz: number, steps: number): [number, number, number] | null {
  const g = raySphere(px, py, pz, dx, dy, dz, EARTH_R);
  if (g && g[0] > 0) return null;
  const a = raySphere(px, py, pz, dx, dy, dz, ATMOS_R);
  if (!a) return [0, 0, 0];
  const len = a[1];
  const ds = len / steps;
  let r = 0;
  let m = 0;
  let o = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const x = px + dx * t;
    const y = py + dy * t;
    const z = pz + dz * t;
    const h = Math.sqrt(x * x + y * y + z * z) - EARTH_R;
    const d = densities(h);
    r += d[0] * ds;
    m += d[1] * ds;
    o += d[2] * ds;
  }
  return [r, m, o];
}

function extinction(depth: [number, number, number], turbidity: number, out: [number, number, number]): [number, number, number] {
  for (let c = 0; c < 3; c++) out[c] = Math.exp(-(RAYLEIGH[c] * depth[0] + MIE_EXT * turbidity * depth[1] + OZONE[c] * depth[2]));
  return out;
}

/**
 * How much of the sun's light gets through the air from a height (km) towards
 * a direction: the sun's colour there (white overhead, orange and red low).
 * Zero once the planet is in the way.
 */
export function transmittance(dir: THREE.Vector3, air: AirSpec, height = 0.01, out = new THREE.Color()): THREE.Color {
  const d = depthToSpace(0, EARTH_R + height, 0, dir.x, dir.y, dir.z, 24);
  if (!d) return out.setRGB(0, 0, 0);
  const t: [number, number, number] = [0, 0, 0];
  extinction(d, air.turbidity, t);
  return out.setRGB(t[0], t[1], t[2]);
}

const tmp3: [number, number, number] = [0, 0, 0];
const tmp3b: [number, number, number] = [0, 0, 0];

/**
 * The sky's radiance looking along `dir` (y up), lit by a source in `src`
 * of strength `intensity` (1 = the sun), for a viewer just above the ground.
 * Single scattering, `n` steps along the view and `m` towards the source.
 */
export function skyRadiance(dir: THREE.Vector3, src: THREE.Vector3, intensity: number, air: AirSpec, out = new THREE.Color(), n = 12, m = 6): THREE.Color {
  out.setRGB(0, 0, 0);
  if (intensity <= 0) return out;
  const oy = EARTH_R + 0.01;
  const a = raySphere(0, oy, 0, dir.x, dir.y, dir.z, ATMOS_R);
  if (!a) return out;
  const g = raySphere(0, oy, 0, dir.x, dir.y, dir.z, EARTH_R);
  const len = g && g[0] > 0 ? g[0] : a[1];
  const ds = len / n;
  const mu = dir.x * src.x + dir.y * src.y + dir.z * src.z;
  const pr = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g2 = MIE_G * MIE_G;
  const pm = ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * Math.pow(1 + g2 - 2 * MIE_G * mu, 1.5));
  let vr = 0;
  let vm = 0;
  let vo = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const turb = air.turbidity;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * ds;
    const x = dir.x * t;
    const y = oy + dir.y * t;
    const z = dir.z * t;
    const h = Math.sqrt(x * x + y * y + z * z) - EARTH_R;
    const d = densities(h);
    vr += d[0] * ds;
    vm += d[1] * ds;
    vo += d[2] * ds;
    const toSun = depthToSpace(x, y, z, src.x, src.y, src.z, m);
    if (!toSun) continue;
    tmp3b[0] = vr + toSun[0];
    tmp3b[1] = vm + toSun[1];
    tmp3b[2] = vo + toSun[2];
    extinction(tmp3b, turb, tmp3);
    const kr = d[0] * pr * ds;
    const km = d[1] * pm * ds * MIE * turb;
    sr += tmp3[0] * (RAYLEIGH[0] * kr + km);
    sg += tmp3[1] * (RAYLEIGH[1] * kr + km);
    sb += tmp3[2] * (RAYLEIGH[2] * kr + km);
  }
  const k = intensity * (air.scale ?? SKY_SCALE) * 10;
  return out.setRGB(sr * k, sg * k, sb * k);
}

/* the directions the sky's fill is averaged over: overhead, and rings at 40° and 10° */
const FILL_DIRS: { d: THREE.Vector3; w: number }[] = (() => {
  const out: { d: THREE.Vector3; w: number }[] = [{ d: new THREE.Vector3(0, 1, 0), w: 1 }];
  for (const [elev, n, w] of [
    [40, 6, 0.8],
    [10, 8, 0.45],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const e = THREE.MathUtils.degToRad(elev);
      out.push({ d: new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)), w: (w * 6) / n });
    }
  }
  const total = out.reduce((s, x) => s + x.w, 0);
  for (const x of out) x.w /= total;
  return out;
})();

export interface SkyLight {
  /** sky radiance overhead and at the horizon (towards the sun's side and away) */
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** the mean of the upper sky: what lights the scene from above */
  fill: THREE.Color;
  /** sunlight at the ground (colour × strength, 1 = overhead sun in clear air) */
  sun: THREE.Color;
  /** sunlight up at the cloud base */
  cloudSun: THREE.Color;
  /** moonlight at the ground, same units */
  moon: THREE.Color;
}

export function newSkyLight(): SkyLight {
  return { zenith: new THREE.Color(), horizon: new THREE.Color(), fill: new THREE.Color(), sun: new THREE.Color(), cloudSun: new THREE.Color(), moon: new THREE.Color() };
}

const c1 = new THREE.Color();
const c3 = new THREE.Color();
const glow = new THREE.Color();
const vh = new THREE.Vector3();

/**
 * Single scattering leaves twilight too dark (the light that bounces twice is
 * most of it then), and a camera opens up as it gets dark: the sun's share of
 * the sky is lifted as it goes down, up to 3.5× once it's well set.
 */
export function twilightGain(sunElevDeg: number): number {
  const t = THREE.MathUtils.clamp((1 - sunElevDeg) / 8, 0, 1);
  return 1 + 2.5 * t * t * (3 - 2 * t);
}

/**
 * The sky's light now, for a sun and a moon (`moonI` already includes its
 * phase; `gain` lifts the sun's share, see twilightGain).
 */
export function evaluateSky(sun: THREE.Vector3, moon: THREE.Vector3, moonI: number, air: AirSpec, out: SkyLight = newSkyLight(), cloudHeight = 2, gain = 1): SkyLight {
  const both = (d: THREE.Vector3, o: THREE.Color) => {
    skyRadiance(d, sun, gain, air, o, 10, 5);
    if (moonI > 0) o.add(skyRadiance(d, moon, moonI, air, c3, 8, 4));
    return o.add(glow.setRGB(...AIRGLOW));
  };
  out.fill.setRGB(0, 0, 0);
  for (const f of FILL_DIRS) {
    both(f.d, c1.setRGB(0, 0, 0));
    out.fill.r += c1.r * f.w;
    out.fill.g += c1.g * f.w;
    out.fill.b += c1.b * f.w;
  }
  both(FILL_DIRS[0].d, out.zenith);
  // the horizon a little up, a quarter of the way round from the sun: the colour the haze takes
  vh.set(-sun.z, 0.04, sun.x);
  if (vh.lengthSq() < 1e-6) vh.set(1, 0.04, 0);
  both(vh.normalize(), out.horizon);
  transmittance(sun, air, 0.01, out.sun);
  transmittance(sun, air, cloudHeight, out.cloudSun);
  transmittance(moon, air, 0.01, out.moon).multiplyScalar(moonI);
  return out;
}

/* ------------------------------------------------------------------ */
/* the GPU side                                                         */
/* ------------------------------------------------------------------ */

/** the same scattering in GLSL (km), for the sky-view table */
export const ATMOS_GLSL = /* glsl */ `
  const float EARTH_R = ${EARTH_R.toFixed(1)};
  const float ATMOS_R = ${ATMOS_R.toFixed(1)};
  const vec3 B_RAY = vec3(${RAYLEIGH.map((x) => x.toExponential(4)).join(', ')});
  const vec3 B_OZO = vec3(${OZONE.map((x) => x.toExponential(4)).join(', ')});
  const float B_MIE = ${MIE.toExponential(4)};
  const float B_MIE_EXT = ${MIE_EXT.toExponential(4)};
  const float H_RAY = ${RAYLEIGH_H.toFixed(1)};
  const float H_MIE = ${MIE_H.toFixed(2)};
  const float G_MIE = ${MIE_G.toFixed(2)};
  vec2 raySphere(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float c = dot(o, o) - r * r;
    float disc = b * b - c;
    if (disc < 0.0) return vec2(1e9, -1e9);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
  }
  vec3 densities(float h) {
    return vec3(exp(-h / H_RAY), exp(-h / H_MIE), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
  }
  // optical depth from p out of the atmosphere towards d; x < 0 when the planet is in the way
  vec3 depthToSpace(vec3 p, vec3 d) {
    vec2 g = raySphere(p, d, EARTH_R);
    if (g.x <= g.y && g.x > 0.0) return vec3(-1.0);
    vec2 a = raySphere(p, d, ATMOS_R);
    float ds = a.y / 6.0;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      vec3 q = p + d * ((float(i) + 0.5) * ds);
      acc += densities(length(q) - EARTH_R) * ds;
    }
    return acc;
  }
  vec3 scatter(vec3 dir, vec3 src, float intensity, float turb) {
    if (intensity <= 0.0) return vec3(0.0);
    vec3 o = vec3(0.0, EARTH_R + 0.01, 0.0);
    vec2 a = raySphere(o, dir, ATMOS_R);
    vec2 g = raySphere(o, dir, EARTH_R);
    float len = (g.x <= g.y && g.x > 0.0) ? g.x : a.y;
    float ds = len / 20.0;
    float mu = dot(dir, src);
    float pr = 0.0596831 * (1.0 + mu * mu);
    float g2 = G_MIE * G_MIE;
    float pm = 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(max(1e-4, 1.0 + g2 - 2.0 * G_MIE * mu), 1.5));
    vec3 view = vec3(0.0);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 20; i++) {
      vec3 q = o + dir * ((float(i) + 0.5) * ds);
      vec3 d = densities(length(q) - EARTH_R);
      view += d * ds;
      vec3 ts = depthToSpace(q, src);
      if (ts.x < 0.0) continue;
      vec3 tau = B_RAY * (view.x + ts.x) + B_MIE_EXT * turb * (view.y + ts.y) + B_OZO * (view.z + ts.z);
      sum += exp(-tau) * (B_RAY * d.x * pr + B_MIE * turb * d.y * pm) * ds;
    }
    return sum * intensity * 10.0;
  }
`;

/** the table's packing: u is the azimuth round from +Z towards +X, v is elevation, denser near the horizon */
export const SKYVIEW_GLSL = /* glsl */ `
  const float SKY_MIN_ELEV = -0.12;
  vec2 skyUv(vec3 d) {
    float az = atan(d.x, d.z);
    float el = asin(clamp(d.y, -1.0, 1.0));
    float v = sqrt(clamp((el - SKY_MIN_ELEV) / (1.5707963 - SKY_MIN_ELEV), 0.0, 1.0));
    return vec2(az / 6.2831853 + 0.5, v);
  }
  vec3 skyDir(vec2 uv) {
    float az = (uv.x - 0.5) * 6.2831853;
    float el = SKY_MIN_ELEV + uv.y * uv.y * (1.5707963 - SKY_MIN_ELEV);
    return vec3(sin(az) * cos(el), sin(el), cos(az) * cos(el));
  }
`;

/** CPU twin of the table's packing (tests) */
export function skyUv(d: THREE.Vector3): [number, number] {
  const az = Math.atan2(d.x, d.z);
  const el = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  const v = Math.sqrt(THREE.MathUtils.clamp((el + 0.12) / (Math.PI / 2 + 0.12), 0, 1));
  return [az / (Math.PI * 2) + 0.5, v];
}

export function skyDir(u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
  const az = (u - 0.5) * Math.PI * 2;
  const el = -0.12 + v * v * (Math.PI / 2 + 0.12);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}
