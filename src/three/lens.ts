/*
 * The club camera's final pass: lens effects, tone mapping, colour grade and
 * sRGB output in one full-screen draw (it replaces a separate lens pass plus
 * three's OutputPass). Input is the linear HDR frame after bloom.
 *   – anamorphic streaks: bright sources (beam lenses, lasers, strobes,
 *     flames) smear into long horizontal blue-tinted flares
 *   – ghosts: faint mirrored copies of the brightest spots across the centre
 *   – lens dirt: smudges, dust and bokeh on the front element that light up
 *     when a wall of light hits the lens (lit by the wide bloom), and a
 *     six-point starburst on the brightest point lights (the aperture blades)
 *   – FPV drone lens: barrel distortion, chromatic fringing and a zoom blur
 *     that grows with flying speed
 *   – tone mapping (the renderer's setting), then a per-venue grade (tint,
 *     contrast, saturation, black level) that follows the music (softer in a
 *     breakdown, harder and richer at the peak), vignette and film grain
 *   – lens looks (looks.ts): a true fisheye remap, tape (line jitter, a
 *     tracking band, colour shift), tilt-shift blur, letterbox bars, teal and
 *     orange split toning, black and white / night vision, thermal, scanlines
 */
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/**
 * Keep only real, in-range values: NaN fails every comparison, so it (and ±Inf)
 * becomes 0. One NaN pixel in the HDR buffer would otherwise be blurred by the
 * bloom across the whole frame and turn it black (pow() of a negative number,
 * normalize() of a zero vector and 0/0 all give NaN on many GPUs).
 */
export const FINITE_GLSL = /* glsl */ `
  vec3 finite3(vec3 c) {
    return vec3(c.r >= 0.0 && c.r <= 65504.0 ? c.r : 0.0, c.g >= 0.0 && c.g <= 65504.0 ? c.g : 0.0, c.b >= 0.0 && c.b <= 65504.0 ? c.b : 0.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform sampler2D tGlow;
  uniform sampler2D tDirt;
  uniform float uDirt, uStar, uStarThr, uStarDirs;
  uniform vec2 uRes;
  uniform float uTime, uStreak, uTaps, uGhost, uDistort, uBlur, uCA, uGrain, uVignette, uThreshold;
  uniform vec3 uTint;
  uniform float uContrast, uSaturation, uLift;
  // lens looks
  uniform float uFade;
  uniform float uFish, uFocal, uFishF, uMono, uMonoGain, uScan, uVhs, uTilt, uBars, uSplit, uThermal, uSatBoost;
  uniform vec2 uCenter;
  uniform vec3 uMonoTint;
  varying vec2 vUv;

  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  ${FINITE_GLSL}
  vec3 bright(vec2 uv) {
    vec3 c = finite3(texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb);
    return max(c - uThreshold, 0.0);
  }
  vec3 starSrc(vec2 uv) {
    vec3 c = finite3(texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb);
    return max(c - uStarThr, 0.0);
  }
  // equidistant fisheye: the angle off the axis grows with the radius, read from the
  // (wide) perspective render at tan(angle); outside it there is nothing: black
  vec2 fisheyeUv(vec2 uv, out float inside) {
    vec2 p = (uv - uCenter) * uRes;
    float r = length(p);
    float th = r / uFishF;
    float rs = th < 1.5 ? uFocal * tan(th) : 1e5;
    vec2 q = uCenter + (r > 1e-3 ? p * (rs / r) : vec2(0.0)) / uRes;
    vec2 e = smoothstep(vec2(0.0), vec2(0.006), q) * smoothstep(vec2(0.0), vec2(0.006), 1.0 - q);
    inside = e.x * e.y;
    return q;
  }
  vec3 heat(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 a = vec3(0.02, 0.0, 0.12), b = vec3(0.38, 0.0, 0.6), c = vec3(0.92, 0.12, 0.28), d = vec3(1.0, 0.66, 0.0), e = vec3(1.0, 1.0, 0.86);
    if (t < 0.25) return mix(a, b, t * 4.0);
    if (t < 0.5) return mix(b, c, t * 4.0 - 1.0);
    if (t < 0.75) return mix(c, d, t * 4.0 - 2.0);
    return mix(d, e, t * 4.0 - 3.0);
  }
  void main() {
    float aspect = uRes.x / uRes.y;
    vec2 base = vUv;
    float inside = 1.0;
    if (uFish > 0.001) {
      float ins;
      vec2 q = fisheyeUv(vUv, ins);
      base = mix(vUv, q, uFish);
      inside = mix(1.0, ins, uFish);
    }
    float n0 = hash(vUv * uRes + fract(uTime) * 91.0);
    if (uVhs > 0.001) {
      // tape: every few lines slip sideways a little, and a tracking band rolls up the frame
      float line = floor(vUv.y * uRes.y / 3.0);
      float jit = (hash(vec2(line, floor(uTime * 30.0))) - 0.5) * 0.003;
      float bd = (fract(vUv.y * 0.8 - uTime * 0.06) - 0.5) * 24.0;
      float band = exp(-bd * bd);
      base.x += (jit + band * (hash(vec2(line, uTime)) - 0.5) * 0.03) * uVhs;
    }
    vec2 d = base - 0.5;
    // radius normalised so the corners are 1
    vec2 dn = d * vec2(aspect, 1.0) / (0.5 * sqrt(aspect * aspect + 1.0));
    float r2 = dot(dn, dn);
    // barrel distortion (corners stay put, the centre bulges)
    vec2 uv = 0.5 + d * (1.0 + uDistort * r2) / (1.0 + uDistort);
    vec3 c;
    float n = n0;
    if (uBlur > 0.001 || uCA > 0.0001) {
      // zoom blur towards the centre with a colour fringe at the edges
      c = vec3(0.0);
      vec2 du = uv - 0.5;
      float ca = uCA * r2;
      for (int i = 0; i < 7; i++) {
        float k = (float(i) + n) / 7.0;
        float s = 1.0 - uBlur * k * 0.07;
        c.r += texture2D(tDiffuse, 0.5 + du * s * (1.0 + ca)).r;
        c.g += texture2D(tDiffuse, 0.5 + du * s).g;
        c.b += texture2D(tDiffuse, 0.5 + du * s * (1.0 - ca)).b;
      }
      c /= 7.0;
    } else {
      c = texture2D(tDiffuse, uv).rgb;
    }
    if (uTilt > 0.001) {
      // tilt-shift: sharp in a band just below the middle, blurred above and below it
      float amt = smoothstep(0.06, 0.4, abs(uv.y - 0.42)) * uTilt;
      if (amt > 0.01) {
        vec3 acc = c;
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 2.39996 + n * 6.2832;
          float rr = sqrt((float(i) + 0.5) / 12.0) * amt * 0.028;
          acc += texture2D(tDiffuse, uv + vec2(cos(a) / aspect, sin(a)) * rr).rgb;
        }
        c = acc / 13.0;
      }
    }
    if (uVhs > 0.001) {
      // the colour signal sits off the brightness on tape: red one way, blue the other
      vec2 sh = vec2(0.0035 * uVhs, 0.0);
      c.r = mix(c.r, texture2D(tDiffuse, uv + sh).r, uVhs);
      c.b = mix(c.b, texture2D(tDiffuse, uv - sh * 1.4).b, uVhs);
    }
    // anamorphic streaks: exponentially spaced taps, jittered per pixel
    if (uStreak > 0.001 && uTaps > 0.5) {
      vec3 st = vec3(0.0);
      float wsum = 0.0;
      for (int i = 1; i <= 12; i++) {
        if (float(i) > uTaps) break;
        float o = (0.0035 * pow(1.55, float(i)) + n * 0.004) / aspect;
        float w = 1.0 / (1.0 + float(i) * 0.6);
        st += (bright(uv + vec2(o, 0.0)) + bright(uv - vec2(o, 0.0))) * w;
        wsum += w;
      }
      st /= wsum;
      float l = dot(st, vec3(0.3, 0.5, 0.2));
      c += mix(st, vec3(0.35, 0.6, 1.0) * l, 0.6) * uStreak;
    }
    // ghosts mirrored through the centre
    if (uGhost > 0.001) {
      vec2 g = 0.5 - (uv - 0.5);
      vec3 gh = bright(0.5 + (g - 0.5) * 0.55) * vec3(0.9, 0.6, 1.0) + bright(0.5 + (g - 0.5) * 1.35) * vec3(0.5, 1.0, 0.8) * 0.6;
      c += gh * uGhost * smoothstep(0.9, 0.1, length(g - 0.5));
    }
    // dirt on the front element, lit by the wide glow of whatever is bright in frame, and a
    // faint veil of the same glow over everything
    if (uDirt > 0.001) {
      vec3 gw = finite3(texture2D(tGlow, uv).rgb);
      float dirt = texture2D(tDirt, uv).r;
      c += gw * (0.05 + dirt * 1.5) * uDirt;
    }
    // starburst: the aperture blades turn the brightest points into stars (6 points on high, 4 on medium)
    if (uStar > 0.001 && uStarDirs > 0.5) {
      vec3 sb = vec3(0.0);
      for (int k = 0; k < 3; k++) {
        if (float(k) >= uStarDirs) break;
        float ang = uStarDirs > 2.5 ? 1.5708 + float(k) * 1.0472 : 0.7854 + float(k) * 1.5708;
        vec2 sdir = vec2(cos(ang) / aspect, sin(ang));
        for (int i = 0; i < 5; i++) {
          float x = (float(i) + n) / 5.0;
          float o = 0.003 + x * 0.05;
          float w = (1.0 - x) * (1.0 - x);
          sb += (starSrc(uv + sdir * o) + starSrc(uv - sdir * o)) * w;
        }
      }
      c += sb * uStar;
    }
    c *= mix(1.0, smoothstep(1.35, 0.2, r2), uVignette);
    // a NaN or infinite pixel from any scene shader shows as black, alone, instead of
    // poisoning the whole frame
    c = finite3(c);

    // tone mapping
    #if defined( LINEAR_TONE_MAPPING )
      c = LinearToneMapping(c);
    #elif defined( REINHARD_TONE_MAPPING )
      c = ReinhardToneMapping(c);
    #elif defined( CINEON_TONE_MAPPING )
      c = CineonToneMapping(c);
    #elif defined( ACES_FILMIC_TONE_MAPPING )
      c = ACESFilmicToneMapping(c);
    #elif defined( AGX_TONE_MAPPING )
      c = AgXToneMapping(c);
    #elif defined( NEUTRAL_TONE_MAPPING )
      c = NeutralToneMapping(c);
    #endif

    // grade (display-referred, 0..1): tint, then black level and contrast in
    // display gamma around 0.4 (a club frame sits mostly below mid-grey; a
    // linear-light pivot would crush every dark tone), then saturation
    c = clamp(c * uTint, 0.0, 1.0);
    vec3 g = pow(c, vec3(1.0 / 2.2));
    g = uLift + g * (1.0 - uLift);
    g = clamp((g - 0.4) * uContrast + 0.4, 0.0, 1.0);
    c = pow(g, vec3(2.2));
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, uSaturation * (1.0 + uSatBoost));
    if (uSplit > 0.001) {
      // teal shadows, orange highlights
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, c * mix(vec3(0.82, 1.0, 1.12), vec3(1.14, 1.0, 0.8), smoothstep(0.05, 0.6, l)), uSplit);
    }
    if (uThermal > 0.001) {
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, heat(l * sqrt(l) * 1.3), uThermal);
    }
    if (uMono > 0.001) {
      // black and white with an exposure curve: night vision lifts the dark a long way
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, uMonoTint * (1.0 - exp(-l * uMonoGain)), uMono);
    }
    if (uVhs > 0.001) {
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, mix(vec3(l), c, 0.78) * vec3(1.06, 1.0, 0.9) + 0.025, uVhs);
    }
    if (uScan > 0.001) {
      c *= 1.0 - uScan * 0.22 * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.5708));
      c *= 1.0 - uScan * 0.07 * (0.5 + 0.5 * sin(vUv.y * 5.0 - uTime * 1.7));
    }
    c *= 1.0 + (n - 0.5) * uGrain;
    if (uBars > 0.001) {
      float bar = 0.5 - 0.5 * min(1.0, aspect / 2.39);
      c *= 1.0 - uBars * (step(vUv.y, bar) + step(1.0 - bar, vUv.y));
    }
    c *= inside * uFade;

    vec4 outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    #ifdef SRGB_TRANSFER
      outColor = sRGBTransferOETF(outColor);
    #endif
    gl_FragColor = outColor;
  }`;

export interface Grade {
  tint: THREE.ColorRepresentation;
  contrast: number;
  saturation: number;
  /** raises the black level (0 = none) */
  lift: number;
}

export const NEUTRAL_GRADE: Grade = { tint: 0xffffff, contrast: 1, saturation: 1, lift: 0 };

/**
 * The grade follows the track: a breakdown sits softer (a little less
 * contrast and colour, the blacks lifted as if by the haze), the drop and the
 * peak harder and richer. `build` and `peak` are the show's 0..1 envelopes.
 */
export function sectionGrade(base: Grade, build: number, peak: number): { contrast: number; saturation: number; lift: number } {
  const b = Math.min(1, Math.max(0, build || 0));
  const p = Math.min(1, Math.max(0, peak || 0)) * (1 - b);
  return {
    contrast: base.contrast * (1 + 0.1 * p - 0.07 * b),
    saturation: base.saturation * (1 + 0.12 * p - 0.15 * b),
    lift: base.lift + 0.02 * b,
  };
}

let dirt: THREE.Texture | null = null;
/** smudges, dust and a few bokeh blobs on the front element (made once, grey) */
function lensDirt(): THREE.Texture | null {
  if (dirt || typeof document === 'undefined') return dirt;
  const W = 512;
  const H = 288;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return null;
  let x = 4241;
  const r = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  // big soft smudges, more towards the edges
  for (let i = 0; i < 46; i++) {
    const cx = r() * W;
    const cy = r() * H;
    const edge = Math.hypot(cx / W - 0.5, cy / H - 0.5) * 2;
    const rad = 18 + r() * 90;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gr.addColorStop(0, `rgba(255,255,255,${(0.04 + r() * 0.12) * (0.5 + edge)})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  // a couple of wiped arcs
  g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.04 + r() * 0.05})`;
    g.lineWidth = 8 + r() * 18;
    g.beginPath();
    g.arc(r() * W, r() * H, 60 + r() * 140, r() * 6.28, r() * 6.28 + 0.6 + r());
    g.stroke();
  }
  // bokeh: soft hexagons with a brighter rim
  for (let i = 0; i < 16; i++) {
    const cx = r() * W;
    const cy = r() * H;
    const rad = 5 + r() * 16;
    g.beginPath();
    for (let k = 0; k < 6; k++) g.lineTo(cx + Math.cos((k / 6) * 6.283 + 0.3) * rad, cy + Math.sin((k / 6) * 6.283 + 0.3) * rad);
    g.closePath();
    g.fillStyle = `rgba(255,255,255,${0.06 + r() * 0.1})`;
    g.fill();
    g.strokeStyle = `rgba(255,255,255,${0.12 + r() * 0.15})`;
    g.lineWidth = 1.2;
    g.stroke();
  }
  // dust specks
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.6})`;
    g.beginPath();
    g.arc(r() * W, r() * H, 0.5 + r() * 1.6, 0, 6.283);
    g.fill();
  }
  dirt = new THREE.CanvasTexture(cv);
  dirt.colorSpace = THREE.NoColorSpace;
  return dirt;
}

export class LensOutputPass extends Pass {
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
    tGlow: { value: null as THREE.Texture | null },
    tDirt: { value: null as THREE.Texture | null },
    uDirt: { value: 0 },
    uStar: { value: 0 },
    uStarThr: { value: 4 },
    uStarDirs: { value: 0 },
    toneMappingExposure: { value: 1 },
    uRes: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uStreak: { value: 0.3 },
    uTaps: { value: 8 },
    uGhost: { value: 0.25 },
    uDistort: { value: 0 },
    uBlur: { value: 0 },
    uCA: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.3 },
    uThreshold: { value: 1.6 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uLift: { value: 0 },
    uFade: { value: 1 },
    uFish: { value: 0 },
    uFocal: { value: 1 },
    uFishF: { value: 1 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uMono: { value: 0 },
    uMonoTint: { value: new THREE.Color(1, 1, 1) },
    uMonoGain: { value: 1 },
    uScan: { value: 0 },
    uVhs: { value: 0 },
    uTilt: { value: 0 },
    uBars: { value: 0 },
    uSplit: { value: 0 },
    uThermal: { value: 0 },
    uSatBoost: { value: 0 },
  };
  private material: THREE.RawShaderMaterial;
  private quad: FullScreenQuad;
  private outputColorSpace: string | null = null;
  private toneMapping: THREE.ToneMapping | null = null;
  private base: Grade = NEUTRAL_GRADE;

  constructor() {
    super();
    this.uniforms.tDirt.value = lensDirt();
    this.material = new THREE.RawShaderMaterial({ name: 'LensOutput', uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG });
    this.quad = new FullScreenQuad(this.material);
  }

  setGrade(g: Grade): void {
    this.base = g;
    this.uniforms.uTint.value.set(g.tint);
    this.uniforms.uContrast.value = g.contrast;
    this.uniforms.uSaturation.value = g.saturation;
    this.uniforms.uLift.value = g.lift;
  }

  /** move the grade with the show's sections (see sectionGrade) */
  followShow(build: number, peak: number): void {
    const g = sectionGrade(this.base, build, peak);
    this.uniforms.uContrast.value = g.contrast;
    this.uniforms.uSaturation.value = g.saturation;
    this.uniforms.uLift.value = g.lift;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    if (this.outputColorSpace !== renderer.outputColorSpace || this.toneMapping !== renderer.toneMapping) {
      this.outputColorSpace = renderer.outputColorSpace;
      this.toneMapping = renderer.toneMapping;
      const defines: Record<string, string> = {};
      if (THREE.ColorManagement.getTransfer(this.outputColorSpace as THREE.ColorSpace) === THREE.SRGBTransfer) defines.SRGB_TRANSFER = '';
      const tm: Partial<Record<THREE.ToneMapping, string>> = {
        [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING',
        [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
        [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING',
        [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
        [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
        [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
      };
      const key = tm[this.toneMapping];
      if (key) defines[key] = '';
      this.material.defines = defines;
      this.material.needsUpdate = true;
    }
    if (this.renderToScreen) renderer.setRenderTarget(null);
    else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    }
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
