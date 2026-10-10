/*
 * The visual player's shader kit: what every full-screen mode shares.
 *   - COMMON: the uniforms every mode gets (beat grid, bands, drop, palette)
 *     and GLSL helpers (noise, fbm, rotation, a safe palette, a strobe gate
 *     that stays under 3 flashes a second when flashing is reduced)
 *   - shaderMode(): a mode that is one fragment shader on a full-screen quad,
 *     optionally with a feedback buffer: the shader reads its own last frame
 *     (uPrev) for trails, smears and fluid looks
 *
 * Shaders keep to the house rules: no pow() of a negative, colours clamped
 * before they leave, so the bloom never sees a NaN.
 */
import * as THREE from 'three';
import type { Features } from './AudioFeatures';
import { fullscreenQuad, PALETTE, spectrumTexture, writeSpectrum, type VisMode } from './modes';

/** how hard a mode hits: the auto-director plays calm ones in breakdowns and peak ones on drops */
export type Energy = 'calm' | 'mid' | 'peak';

export interface ModeInfo {
  id: string;
  name: string;
  blurb: string;
  energy: Energy;
}

export const COMMON = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uBeat, uBar, uPulse, uKick, uSnare, uHigh, uSub, uVocal, uLevel, uDrop, uHue, uBuild, uTravel, uI, uSafe, uBpm;
  uniform vec2 uRes;
  uniform sampler2D uSpec;
  uniform sampler2D uWave;
  ${PALETTE}
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash1(float n) { return fract(sin(n * 127.1 + 31.7) * 43758.5453); }
  vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  vec2 screen() { return (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0); }
  /* a palette colour, never negative */
  vec3 pal(float t) { return clamp(palette(t, uHue), 0.0, 1.0); }
  /* a saturated version for neon: squared, so the weak channels drop away, then brought back to full */
  vec3 neon(float t) { vec3 c = pal(t); c *= c; return c / max(max(c.r, c.g), max(c.b, 0.001)); }
  float spec(float x) { return texture2D(uSpec, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
  float wave(float x) { return texture2D(uWave, vec2(clamp(x, 0.0, 1.0), 0.5)).r * 2.0 - 1.0; }
  /* a strobe gate: perBeat flashes a beat, or once a beat (once every two above 165 BPM) when flashing is reduced */
  float gate(float perBeat, float duty) {
    float r = mix(perBeat, uBpm > 165.0 ? 0.5 : 1.0, uSafe);
    return step(1.0 - duty, fract(uBeat * r));
  }
  /* how hard a flash may be: softer when flashing is reduced */
  float flashAmp() { return mix(1.0, 0.35, uSafe); }
  vec3 tonemap(vec3 c) { return 1.0 - exp(-max(c, 0.0)); }
`;

export function waveTexture(n = 512): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(n * 4), n, 1, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function writeWave(t: THREE.DataTexture, w: Float32Array): void {
  const d = t.image.data as Uint8Array;
  const n = t.image.width;
  for (let i = 0; i < n; i++) {
    const v = Math.round((Math.max(-1, Math.min(1, w[Math.floor((i / n) * w.length)] ?? 0)) * 0.5 + 0.5) * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  t.needsUpdate = true;
}

/** the uniforms every shader mode gets, filled from the audio features each frame */
export function commonUniforms(): Record<string, THREE.IUniform> {
  return {
    uTime: { value: 0 },
    uBeat: { value: 0 },
    uBar: { value: 0 },
    uPulse: { value: 0 },
    uKick: { value: 0 },
    uSnare: { value: 0 },
    uHigh: { value: 0 },
    uSub: { value: 0 },
    uVocal: { value: 0 },
    uLevel: { value: 0 },
    uDrop: { value: 0 },
    uHue: { value: 0 },
    uBuild: { value: 0 },
    uTravel: { value: 0 },
    uI: { value: 1 },
    uSafe: { value: 0 },
    uBpm: { value: 124 },
    uRes: { value: new THREE.Vector2(16, 9) },
    uSpec: { value: null },
    uWave: { value: null },
  };
}

export function feedCommon(u: Record<string, THREE.IUniform>, f: Features, dt: number, travel = 1): void {
  const i = f.intensity;
  u.uTime.value += dt;
  u.uBeat.value = f.beatCount + f.beatPhase;
  u.uBar.value = Math.floor(f.beatCount / 4);
  u.uPulse.value = f.beatPulse * i;
  u.uKick.value = f.kickPulse * i;
  u.uSnare.value = f.snarePulse * i;
  u.uHigh.value = f.high;
  u.uSub.value = f.sub;
  u.uVocal.value = f.vocal;
  u.uLevel.value = f.level;
  u.uDrop.value = f.drop * i;
  u.uHue.value = f.hue;
  u.uBuild.value = f.breakdown;
  u.uI.value = i;
  u.uSafe.value = f.safe ?? 0;
  u.uBpm.value = f.bpm || 124;
  u.uTravel.value += dt * ((f.bpm || 120) / 60) * travel * (f.playing ? 1 : 0.12) * (1 + f.kickPulse * 0.5 * i);
}

export interface ShaderModeOpts {
  /** travel speed, in beats per second of uTravel */
  travel?: number;
  /** read the last frame as uPrev (trails, smears, fluid) */
  feedback?: boolean;
  /** extra uniforms, and a hook to set them each frame */
  uniforms?: Record<string, THREE.IUniform>;
  update?(u: Record<string, THREE.IUniform>, f: Features, dt: number): void;
  dispose?(): void;
}

/**
 * A mode that is one fragment shader. With feedback the shader runs into one
 * of two render targets each frame, reading the other as uPrev, and the screen
 * shows the newest. The targets take the screen's size only while the mode is
 * playing and shrink back when it sleeps.
 */
export function shaderMode(id: string, name: string, blurb: string, body: string, travel = 1, o: ShaderModeOpts = {}): VisMode {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const spec = spectrumTexture();
  const wav = waveTexture();
  const u = { ...commonUniforms(), ...(o.uniforms ?? {}) };
  u.uSpec.value = spec;
  u.uWave.value = wav;
  const header = o.feedback ? COMMON + '\n  uniform sampler2D uPrev;\n' : COMMON;
  let rts: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  let sim: THREE.Scene | null = null;
  let rw = 16;
  let rh = 9;
  const show = { uTex: { value: null as THREE.Texture | null } };
  if (o.feedback) {
    u.uPrev = { value: null };
    const mk = () => new THREE.WebGLRenderTarget(16, 9, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    rts = [mk(), mk()];
    sim = new THREE.Scene();
    sim.add(fullscreenQuad(header + body, u));
    scene.add(fullscreenQuad(/* glsl */ `precision highp float; varying vec2 vUv; uniform sampler2D uTex; void main(){ gl_FragColor = vec4(clamp(texture2D(uTex, vUv).rgb, 0.0, 64.0), 1.0); }`, show));
  } else scene.add(fullscreenQuad(header + body, u));
  return {
    id,
    name,
    blurb,
    scene,
    camera,
    warm: sim ? [sim] : undefined,
    update(f: Features, dt: number) {
      feedCommon(u, f, dt, travel);
      writeSpectrum(spec, f.spectrum);
      writeWave(wav, f.waveform);
      o.update?.(u, f, dt);
    },
    prerender(r: THREE.WebGLRenderer) {
      if (!rts || !sim) return;
      const [read, write] = rts;
      if (write.width !== rw || write.height !== rh) for (const rt of rts) rt.setSize(rw, rh);
      u.uPrev.value = read.texture;
      const prev = r.getRenderTarget();
      r.setRenderTarget(write);
      r.render(sim, camera);
      r.setRenderTarget(prev);
      show.uTex.value = write.texture;
      rts = [write, read];
    },
    sleep() {
      if (rts) for (const rt of rts) rt.setSize(16, 9);
    },
    resize(w: number, h: number) {
      (u.uRes.value as THREE.Vector2).set(w, h);
      rw = Math.max(16, Math.round(w));
      rh = Math.max(9, Math.round(h));
    },
    dispose() {
      spec.dispose();
      wav.dispose();
      if (rts) for (const rt of rts) rt.dispose();
      o.dispose?.();
    },
  };
}
