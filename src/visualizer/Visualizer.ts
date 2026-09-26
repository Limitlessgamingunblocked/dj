/*
 * Visual player: renders the active mode through its own post chain
 *   RenderPass → UnrealBloomPass → final pass (chromatic aberration, palette
 *   shift, vignette, grain) → output texture.
 * The texture feeds the LED wall / projection screens in the club scene and
 * the full-screen Visuals view.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Features } from './AudioFeatures';
import { MODE_FACTORIES, MODE_INFO, type VisMode } from './modes';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAberration: { value: 0 },
    uHueShift: { value: 0 },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAberration, uHueShift, uTime, uVignette, uFlash;
    varying vec2 vUv;
    vec3 hueRotate(vec3 c, float a) {
      const vec3 k = vec3(0.57735);
      float ca = cos(a);
      return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
    }
    void main() {
      vec2 d = (vUv - 0.5);
      vec2 off = d * uAberration;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      c = hueRotate(c, uHueShift * 6.28318);
      float v = smoothstep(0.85, 0.2, length(d) * (1.0 + uVignette));
      c *= mix(1.0, v, uVignette * 2.0);
      float n = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.02;
      c += vec3(uFlash);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export interface VisSettings {
  mode: string;
  intensity: number;
  bloom: boolean;
  aberration: boolean;
  shake: boolean;
  palette: boolean;
  autoCycle: boolean;
}

export class Visualizer {
  private modes: VisMode[] = [];
  private current: VisMode;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;
  private w = 960;
  private h = 540;
  private beatsSinceSwitch = 0;
  private lastBeat = 0;
  readonly settings: VisSettings;

  constructor(
    private renderer: THREE.WebGLRenderer,
    settings: Partial<VisSettings>,
  ) {
    this.settings = { mode: 'warp', intensity: 1, bloom: true, aberration: true, shake: true, palette: true, autoCycle: false, ...settings };
    this.modes = MODE_FACTORIES.map((f) => f());
    this.current = this.modes.find((m) => m.id === this.settings.mode) ?? this.modes[0];
    const rt = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.renderToScreen = false;
    this.renderPass = new RenderPass(this.current.scene, this.current.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.w, this.h), 0.6, 0.5, 0.32);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    this.setSize(this.w, this.h);
  }

  static modeInfo() {
    return MODE_INFO;
  }

  get modeId(): string {
    return this.current.id;
  }

  get texture(): THREE.Texture {
    return this.composer.readBuffer.texture;
  }

  setMode(id: string): void {
    const m = this.modes.find((x) => x.id === id);
    if (!m) return;
    this.current = m;
    this.settings.mode = id;
    this.renderPass.scene = m.scene;
    this.renderPass.camera = m.camera;
    m.resize(this.w, this.h);
  }

  nextMode(): void {
    const i = this.modes.indexOf(this.current);
    this.setMode(this.modes[(i + 1) % this.modes.length].id);
  }

  setSize(w: number, h: number): void {
    w = Math.max(64, Math.round(w));
    h = Math.max(36, Math.round(h));
    if (w === this.w && h === this.h && this.composer.readBuffer.width === w) return;
    this.w = w;
    this.h = h;
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    for (const m of this.modes) m.resize(w, h);
  }

  /** Render the current mode into the output texture. */
  render(f: Features, dt: number): void {
    const s = this.settings;
    f.intensity = s.intensity;
    f.shake = s.shake ? 1 : 0;
    if (s.autoCycle) {
      const beatIdx = Math.floor(f.time * (f.bpm / 60));
      if (beatIdx !== this.lastBeat) {
        this.lastBeat = beatIdx;
        this.beatsSinceSwitch++;
      }
      if (f.dropHit || this.beatsSinceSwitch >= 64) {
        this.beatsSinceSwitch = 0;
        this.nextMode();
      }
    }
    this.current.update(f, dt);
    this.bloom.enabled = s.bloom;
    this.bloom.strength = 0.35 + f.level * 0.35 + f.drop * 0.6 * s.intensity;
    const u = this.final.uniforms;
    u.uAberration.value = s.aberration ? (0.004 + f.snarePulse * 0.018 + f.drop * 0.03) * s.intensity : 0;
    u.uHueShift.value = s.palette ? f.drop * 0.15 : 0;
    u.uTime.value = f.time;
    u.uFlash.value = f.dropHit ? 0.6 : Math.max(0, (u.uFlash.value as number) - dt * 3);
    const prevTarget = this.renderer.getRenderTarget();
    this.composer.render(dt);
    this.renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    for (const m of this.modes) m.dispose();
    this.composer.dispose();
  }
}
