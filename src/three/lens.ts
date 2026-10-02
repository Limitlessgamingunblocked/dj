/*
 * The club camera's final pass: lens effects, tone mapping, colour grade and
 * sRGB output in one full-screen draw (it replaces a separate lens pass plus
 * three's OutputPass). Input is the linear HDR frame after bloom.
 *   – anamorphic streaks: bright sources (beam lenses, lasers, strobes,
 *     flames) smear into long horizontal blue-tinted flares
 *   – ghosts: faint mirrored copies of the brightest spots across the centre
 *   – FPV drone lens: barrel distortion, chromatic fringing and a zoom blur
 *     that grows with flying speed
 *   – tone mapping (the renderer's setting), then a per-venue grade (tint,
 *     contrast, saturation, black level), vignette and film grain
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

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uRes;
  uniform float uTime, uStreak, uTaps, uGhost, uDistort, uBlur, uCA, uGrain, uVignette, uThreshold;
  uniform vec3 uTint;
  uniform float uContrast, uSaturation, uLift;
  varying vec2 vUv;

  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 bright(vec2 uv) {
    vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
    return max(c - uThreshold, 0.0);
  }
  void main() {
    float aspect = uRes.x / uRes.y;
    vec2 d = vUv - 0.5;
    // radius normalised so the corners are 1
    vec2 dn = d * vec2(aspect, 1.0) / (0.5 * sqrt(aspect * aspect + 1.0));
    float r2 = dot(dn, dn);
    // barrel distortion (corners stay put, the centre bulges)
    vec2 uv = 0.5 + d * (1.0 + uDistort * r2) / (1.0 + uDistort);
    vec3 c;
    float n = hash(vUv * uRes + fract(uTime) * 91.0);
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
    c *= mix(1.0, smoothstep(1.35, 0.2, r2), uVignette);
    c = max(c, 0.0);

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
    c = mix(vec3(luma), c, uSaturation);
    c *= 1.0 + (n - 0.5) * uGrain;

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

export class LensOutputPass extends Pass {
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
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
  };
  private material: THREE.RawShaderMaterial;
  private quad: FullScreenQuad;
  private outputColorSpace: string | null = null;
  private toneMapping: THREE.ToneMapping | null = null;

  constructor() {
    super();
    this.material = new THREE.RawShaderMaterial({ name: 'LensOutput', uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG });
    this.quad = new FullScreenQuad(this.material);
  }

  setGrade(g: Grade): void {
    this.uniforms.uTint.value.set(g.tint);
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
