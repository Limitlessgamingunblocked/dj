/*
 * The open-air sky (atmosphere.ts does the physics):
 *   – the air: a sky-view table of single scattering (sun and moon), drawn
 *     on the GPU when either moves, read by the dome
 *   – the sun: a disc the colour of the light that reaches you, glare round it
 *   – the moon: a lit sphere, its phase from where the sun really is (full
 *     opposite the sunset, a crescent near the dawn), with seas on its face,
 *     earthshine on the dark side and a halo in the air
 *   – clouds: a low layer of heaped cloud and a high layer of thin streaks,
 *     each lit by the sun as it is up there (so high cloud stays pink after
 *     the sun has set), shadowed where it's thick, silver at the edges
 *     towards the sun, grey-blue by moonlight, glowing underneath with the
 *     light of the site below; drifting on the wind
 *   – stars behind it all, gone where the cloud is
 *   – a small cube render of the sky, filtered for reflections, so metal and
 *     glass outside reflect this sky
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ATMOS_GLSL, SKY_SCALE, SKYVIEW_GLSL, type AirSpec } from './atmosphere';
import { rng } from './tex';

export interface CloudSpec {
  /** heaped low cloud, 0 (clear) .. 1 (overcast) */
  cover: number;
  /** thin high streaks, 0..1 */
  cirrus: number;
  /** wind (km per minute), towards +x, +z */
  wind?: [number, number];
}

/* ------------------------------------------------------------------ */
/* cloud noise: tiling value-noise octaves                              */
/* ------------------------------------------------------------------ */

/** tiling value noise summed over octaves, 0..1, in a size × size grid */
export function tilingNoise(size: number, seed: number, periods: number[], stretch: [number, number] = [1, 1]): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(size * size);
  let norm = 0;
  periods.forEach((p, o) => {
    const px = Math.max(1, Math.round(p * stretch[0]));
    const py = Math.max(1, Math.round(p * stretch[1]));
    const lattice = new Float32Array(px * py);
    for (let i = 0; i < lattice.length; i++) lattice[i] = r();
    const amp = 1 / (o + 1) ** 1.1;
    norm += amp;
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * py;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * px;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const at = (i: number, j: number) => lattice[(((j % py) + py) % py) * px + (((i % px) + px) % px)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
  });
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

let cloudTex: THREE.DataTexture | null = null;

/** R: the shape of heaped cloud, G: its detail, B: high streaks, A: the moon's face */
function cloudTexture(): THREE.DataTexture {
  if (cloudTex) return cloudTex;
  const n = 256;
  const shape = tilingNoise(n, 71, [4, 8, 16, 32]);
  const detail = tilingNoise(n, 72, [16, 32, 64, 128]);
  const streak = tilingNoise(n, 73, [3, 6, 12, 24, 48], [0.25, 1.6]);
  const moon = tilingNoise(n, 74, [3, 5, 9, 17]);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = Math.round(shape[i] * 255);
    data[i * 4 + 1] = Math.round(detail[i] * 255);
    data[i * 4 + 2] = Math.round(streak[i] * 255);
    data[i * 4 + 3] = Math.round(moon[i] * 255);
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.userData.shared = true;
  t.needsUpdate = true;
  cloudTex = t;
  return t;
}

/* ------------------------------------------------------------------ */
/* shaders                                                              */
/* ------------------------------------------------------------------ */

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const LUT_FRAG = /* glsl */ `
  uniform vec3 uSunDir, uMoonDir;
  uniform float uSunGain, uMoonI, uTurb, uScale;
  varying vec2 vUv;
  ${ATMOS_GLSL}
  ${SKYVIEW_GLSL}
  void main() {
    vec3 d = skyDir(vUv);
    vec3 c = scatter(d, uSunDir, uSunGain, uTurb) + scatter(d, uMoonDir, uMoonI, uTurb);
    gl_FragColor = vec4(c * uScale, 1.0);
  }`;

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const DOME_FRAG = /* glsl */ `
  uniform sampler2D uLut, uClouds;
  uniform vec3 uSunDir, uMoonDir;
  uniform vec3 uSunDisc, uMoonLight, uCloudSun, uCirrusSun, uCloudMoon, uCloudAmb, uCloudGlow;
  uniform vec3 uGround, uGlow, uAirglow;
  uniform float uMoonPhaseLight, uStars, uTime, uCover, uCirrus, uSunSize, uMoonSize;
  uniform vec2 uWind;
  varying vec3 vDir;
  ${SKYVIEW_GLSL}
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  // where a ray from just above the ground meets a shell h km up (curved, so far cloud sinks to the horizon)
  float shell(vec3 d, float h) {
    float R = 6360.0;
    float b = (R + 0.01) * d.y;
    float c = (R + 0.01) * (R + 0.01) - (R + h) * (R + h);
    return -b + sqrt(max(0.0, b * b - c));
  }
  float cumulus(vec2 p, float cover) {
    float s = texture2D(uClouds, p * 0.045 + uWind * 0.045).r;
    float dt = texture2D(uClouds, p * 0.21 + uWind * 0.06).g;
    float n = s * 0.74 + dt * 0.26;
    // the noise sits in a narrow band (median 0.52, 99% under 0.67): cover picks the share above the threshold
    float th = 0.674 - cover * 0.31;
    return smoothstep(th, th + 0.06, n);
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = texture2D(uLut, skyUv(d)).rgb + uAirglow * (0.6 + 0.4 * (1.0 - max(h, 0.0)));
    // the glow along the horizon (city and site light)
    col += uGlow * exp(-abs(h) * 12.0);
    vec3 s = normalize(uSunDir);
    float sd = dot(d, s);
    // the sun: limb-darkened disc and a tight glare, the colour of the light that gets through
    float r = acos(clamp(sd, -1.0, 1.0)) / uSunSize;
    float disc = r < 1.0 ? (1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - r * r)))) : 0.0;
    float above = smoothstep(-0.004, 0.004, h);
    // (bright enough to burn out and flare, not so bright the lens's bloom veils the whole frame)
    vec3 sun = uSunDisc * (disc * 14.0 + exp((sd - 1.0) * 900.0) * 1.5) * above;
    // the moon: a sphere lit from where the sun is
    vec3 m = normalize(uMoonDir);
    vec3 mt = normalize(cross(m, abs(m.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 mb = cross(mt, m);
    vec3 q = d - m * dot(d, m);
    vec2 mq = vec2(dot(q, mt), dot(q, mb)) / uMoonSize;
    float mr = length(mq);
    vec3 moon = vec3(0.0);
    if (dot(d, m) > 0.0 && mr < 1.0) {
      // the surface normal, facing back towards us; lit where it faces the sun (full when opposite it)
      vec3 N = mt * mq.x + mb * mq.y - m * sqrt(1.0 - mr * mr);
      float lit = max(0.0, dot(N, s));
      float face = texture2D(uClouds, mq * 0.18 + 0.5).a;
      float albedo = 0.55 + 0.45 * smoothstep(0.35, 0.65, face);
      moon = uMoonLight * (lit * albedo + 0.012) * smoothstep(1.0, 0.94, mr);
    }
    float md = max(0.0, dot(d, m));
    vec3 moonHalo = uMoonLight * uMoonPhaseLight * (exp((md - 1.0) * 3000.0) * 0.08 + exp((md - 1.0) * 120.0) * 0.006);
    // stars, twinkling, gone near the horizon
    vec3 cell = floor(d * 240.0);
    float n = hash3(cell);
    float star = step(0.9968, n) * smoothstep(0.03, 0.25, h) * uStars;
    star *= 0.55 + 0.45 * sin(uTime * (0.8 + n * 3.0) + n * 40.0);
    vec3 behind = sun + moon + vec3(star * 1.2);
    float veil = 0.0;
    if (h > 0.0) {
      // high streaks, 8 km up
      float th = shell(d, 8.0);
      vec2 ph = d.xz * th;
      float st = texture2D(uClouds, ph * vec2(0.012, 0.03) + uWind * 0.02).b;
      float ci = smoothstep(0.69, 0.79, st) * uCirrus * smoothstep(0.0, 0.2, h);
      vec3 ciCol = uCirrusSun * (0.5 + 1.2 * pow(max(sd, 0.0), 6.0)) + uCloudAmb * 0.9 + uCloudMoon * 0.6;
      col = mix(col, ciCol, ci * 0.55);
      behind *= 1.0 - ci * 0.6;
      // heaped cloud, 2 km up
      float tc = shell(d, 2.0);
      vec2 p = d.xz * tc;
      float dens = cumulus(p, uCover);
      if (dens > 0.001) {
        // thickness towards the light: the sun's side of each heap lit, the far side in shadow
        vec2 toL = normalize(s.xz + vec2(1e-4)) * (0.35 + 0.4 * (1.0 - max(s.y, 0.0)));
        float sh = cumulus(p + toL, uCover) * 0.6 + cumulus(p + toL * 2.5, uCover) * 0.4;
        float lit = exp(-sh * 2.6) * (1.0 - exp(-dens * 4.0) * 0.4);
        float silver = pow(max(sd, 0.0), 10.0) * (1.0 - dens) * 3.0;
        vec2 toM = normalize(m.xz + vec2(1e-4)) * 0.5;
        float shm = cumulus(p + toM, uCover);
        vec3 cc = uCloudSun * (lit * 1.3 + silver) + uCloudAmb * (1.15 - 0.55 * dens) + uCloudMoon * exp(-shm * 2.0) + uCloudGlow * (0.6 + 0.4 * dens);
        // far cloud fades into the haze along the horizon
        float a = clamp(dens * 1.6, 0.0, 1.0) * smoothstep(0.0, 0.1, h) * exp(-tc / 90.0);
        col = mix(col, cc, a);
        veil = a;
        behind *= 1.0 - a;
      }
    }
    col += behind + moonHalo * (1.0 - veil);
    // below the horizon: the sea or the land far off
    col = mix(col, uGround, 1.0 - smoothstep(-0.06, 0.0, h));
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }`;

/* ------------------------------------------------------------------ */
/* the sky                                                              */
/* ------------------------------------------------------------------ */

export class PhysicalSky {
  readonly mesh: THREE.Mesh;
  readonly sunDir = new THREE.Vector3(0, 0.2, 1);
  readonly moonDir = new THREE.Vector3(0, 0.3, -1);
  /** reflections of this sky for the venue's materials (null until the first render) */
  environment: THREE.Texture | null = null;
  readonly u: Record<string, THREE.IUniform>;
  private lut = new THREE.WebGLRenderTarget(128, 64, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
  private lutMat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private lutKey = '';
  private envScene = new THREE.Scene();
  private cube: THREE.WebGLCubeRenderTarget | null = null;
  private cubeCam: THREE.CubeCamera | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envKey = '';
  private envAge = 99;
  private wind = new THREE.Vector2();

  constructor(
    radius: number,
    readonly air: AirSpec,
    readonly clouds: CloudSpec,
  ) {
    this.lutMat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir }, uSunGain: { value: 1 }, uMoonI: { value: 0 }, uTurb: { value: air.turbidity }, uScale: { value: air.scale ?? SKY_SCALE } },
      vertexShader: QUAD_VERT,
      fragmentShader: LUT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.lutMat);
    this.u = {
      uLut: { value: this.lut.texture },
      uClouds: { value: cloudTexture() },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunDisc: { value: new THREE.Color() },
      uMoonLight: { value: new THREE.Color() },
      uMoonPhaseLight: { value: 0 },
      uCloudSun: { value: new THREE.Color() },
      uCirrusSun: { value: new THREE.Color() },
      uCloudMoon: { value: new THREE.Color() },
      uCloudAmb: { value: new THREE.Color() },
      uCloudGlow: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uAirglow: { value: new THREE.Color(0.0006, 0.0009, 0.0018) },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uCover: { value: clouds.cover },
      uCirrus: { value: clouds.cirrus },
      uSunSize: { value: 0.0125 },
      uMoonSize: { value: 0.0115 },
      uWind: { value: this.wind },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
    const geo = new THREE.SphereGeometry(radius, 48, 24);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    // the copy the reflections are rendered from
    const env = new THREE.Mesh(geo, mat);
    env.frustumCulled = false;
    this.envScene.add(env);
  }

  /** the sky-view table (for things that reflect the sky, like water) */
  get lutTexture(): THREE.Texture {
    return this.lut.texture;
  }

  /** the sun's share of the sky (twilight gain) and the moon's strength, for the table */
  lutUniforms(sunGain: number, moonI: number): void {
    this.lutMat.uniforms.uSunGain.value = sunGain;
    this.lutMat.uniforms.uMoonI.value = moonI;
  }

  /** move the clouds on (seconds) */
  tick(dt: number, t: number): void {
    const w = this.clouds.wind ?? [0.25, 0.1];
    this.wind.x += (w[0] / 60) * dt;
    this.wind.y += (w[1] / 60) * dt;
    this.u.uTime.value = t;
  }

  /** the table and the reflections, when the light has moved enough to show */
  prerender(renderer: THREE.WebGLRenderer, dt: number): void {
    const key = `${this.sunDir.toArray().map((x) => x.toFixed(3))}|${this.moonDir.toArray().map((x) => x.toFixed(3))}|${(this.lutMat.uniforms.uSunGain.value as number).toFixed(2)}|${(this.lutMat.uniforms.uMoonI.value as number).toFixed(4)}`;
    const prev = renderer.getRenderTarget();
    if (key !== this.lutKey) {
      this.lutKey = key;
      renderer.setRenderTarget(this.lut);
      this.quad.render(renderer);
      renderer.setRenderTarget(prev);
    }
    // the reflections: a 32 px cube of the sky, re-filtered every few seconds (or at once when the light jumps)
    this.envAge += dt;
    const envKey = `${this.sunDir.y.toFixed(2)}|${this.moonDir.y.toFixed(2)}`;
    if (this.envAge > 4 || (envKey !== this.envKey && this.envAge > 0.5)) {
      this.envAge = 0;
      this.envKey = envKey;
      if (!this.cube) {
        this.cube = new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType });
        this.cubeCam = new THREE.CubeCamera(1, 4000, this.cube);
        this.pmrem = new THREE.PMREMGenerator(renderer);
      }
      const auto = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      this.cubeCam!.update(renderer, this.envScene);
      this.envRT = this.pmrem!.fromCubemap(this.cube.texture, this.envRT);
      renderer.shadowMap.autoUpdate = auto;
      this.environment = this.envRT.texture;
      renderer.setRenderTarget(prev);
    }
  }

  dispose(): void {
    this.lut.dispose();
    this.lutMat.dispose();
    this.quad.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
    this.cube?.dispose();
    this.envRT?.dispose();
    this.pmrem?.dispose();
  }
}
