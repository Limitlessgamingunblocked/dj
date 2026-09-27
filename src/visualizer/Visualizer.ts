/*
 * Visual player (10 modes): renders the active mode through its own post chain
 *   RenderPass → lyrics pass (kinetic typography: wave / glitch / RGB split)
 *   → UnrealBloomPass → final pass (chromatic aberration, palette shift,
 *   vignette, grain) → output texture.
 * The texture feeds the LED wall / projection screens in the club scene and
 * the full-screen Visuals view.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { LyricFrame } from '../lyrics/LyricsEngine';
import type { Features } from './AudioFeatures';
import { LyricsLayer, type LyricStyle } from './LyricsLayer';
import { MODE_FACTORIES, MODE_INFO, type VisMode } from './modes';
import { MORE_INFO, MORE_MODES } from './modes2';

const FACTORIES = [...MODE_FACTORIES, ...MORE_MODES];
const DEFAULT_COLORS = [new THREE.Color('#2ec4f1'), new THREE.Color('#ff5fcf'), new THREE.Color('#7b5cff')];
const INFO = [...MODE_INFO, ...MORE_INFO];

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

/* The lyric canvas over the picture, before bloom so the type glows. */
const TextShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tText: { value: null as THREE.Texture | null },
    uOn: { value: 0 },
    uWave: { value: 0 },
    uGlitch: { value: 0 },
    uTime: { value: 0 },
    uFit: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: FinalShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tText;
    uniform float uOn, uWave, uGlitch, uTime;
    uniform vec2 uFit;
    varying vec2 vUv;
    float h1(float n) { return fract(sin(n * 127.1 + 31.7) * 43758.5453); }
    vec4 tex(vec2 uv) {
      vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
      return texture2D(tText, uv) * inside.x * inside.y;
    }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uOn < 0.002) { gl_FragColor = base; return; }
      vec2 uv = (vUv - 0.5) * uFit + 0.5;
      // kinetic wave: the line ripples with the vocal
      uv.x += sin(uv.y * 16.0 + uTime * 5.0) * 0.007 * uWave;
      uv.y += sin(uv.x * 7.0 - uTime * 3.2) * 0.02 * uWave;
      // glitch: displaced horizontal slices and an RGB split
      float slice = floor(uv.y * 22.0);
      float tick = floor(uTime * 24.0);
      float on = step(1.0 - uGlitch * 0.55, h1(slice + tick * 1.7));
      uv.x += (h1(slice * 3.1 + tick) - 0.5) * 0.09 * on * uGlitch;
      float split = 0.002 + uGlitch * 0.014;
      vec4 t = tex(uv);
      vec4 tr = tex(uv + vec2(split, 0.0));
      vec4 tb = tex(uv - vec2(split, 0.0));
      vec3 col = vec3(tr.r, t.g, tb.b);
      float a = max(t.a, max(tr.a, tb.a) * 0.85);
      // a soft scrim behind the lines keeps them readable over busy modes
      float band = smoothstep(0.42, 0.05, abs(vUv.y - 0.5));
      vec3 c = base.rgb * (1.0 - 0.35 * uOn * band);
      c = c * (1.0 - a * 0.9) + col * 1.15;
      gl_FragColor = vec4(c, base.a);
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
  /** lyrics as kinetic typography on the screens */
  lyrics: boolean;
  lyricStyle: LyricStyle;
  /** hook lines and key phrases fire strobes, blinders and haze */
  lyricHooks: boolean;
  /** the current line as a subtitle over the booth view */
  lyricHud: boolean;
}

export interface LyricInput {
  frame: LyricFrame | null;
  colors: THREE.Color[];
}

export class Visualizer {
  private modes: VisMode[] = [];
  private current: VisMode;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;
  private text: ShaderPass;
  readonly lyrics = new LyricsLayer();
  private w = 960;
  private h = 540;
  private beatsSinceSwitch = 0;
  private lastBeat = 0;
  readonly settings: VisSettings;

  constructor(
    private renderer: THREE.WebGLRenderer,
    settings: Partial<VisSettings>,
  ) {
    this.settings = { mode: 'warp', intensity: 1, bloom: true, aberration: true, shake: true, palette: true, autoCycle: false, lyrics: true, lyricStyle: 'auto', lyricHooks: true, lyricHud: true, ...settings };
    this.modes = FACTORIES.map((f) => f());
    this.current = this.modes.find((m) => m.id === this.settings.mode) ?? this.modes[0];
    const rt = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.renderToScreen = false;
    this.renderPass = new RenderPass(this.current.scene, this.current.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.w, this.h), 0.6, 0.5, 0.32);
    this.final = new ShaderPass(FinalShader);
    this.text = new ShaderPass(TextShader);
    this.text.uniforms.tText.value = this.lyrics.texture;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.text);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    this.setSize(this.w, this.h);
  }

  static modeInfo() {
    return INFO;
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
  render(f: Features, dt: number, lyric?: LyricInput): void {
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
    const fx = this.lyrics.draw(s.lyrics ? (lyric?.frame ?? null) : null, f, lyric?.colors ?? DEFAULT_COLORS, s.lyricStyle, dt, f.time);
    const tu = this.text.uniforms;
    tu.uOn.value = fx.on;
    tu.uWave.value = fx.wave;
    tu.uGlitch.value = fx.glitch;
    tu.uTime.value = f.time;
    // keep the 16:9 type undistorted on any screen shape
    const aspect = this.w / this.h;
    const ref = 16 / 9;
    (tu.uFit.value as THREE.Vector2).set(aspect > ref ? aspect / ref : 1, aspect > ref ? 1 : ref / aspect);
    this.text.enabled = fx.on > 0.002;
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
    this.lyrics.texture.dispose();
    this.composer.dispose();
  }
}
