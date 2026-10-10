/*
 * Visual player (28 modes): renders the active mode through its own post chain
 *   RenderPass → transition pass (the outgoing mode, faded, irised, sliced,
 *   zoomed or pixelled away over a beat) → lyrics pass (kinetic typography:
 *   wave / glitch / RGB split) → UnrealBloomPass → final pass (chromatic
 *   aberration, palette shift, vignette, grain) → output texture.
 * The texture feeds the LED wall / projection screens in the club scene and
 * the full-screen Visuals view. The auto VJ (director.ts) picks modes to fit
 * the music; shaders compile a few at a time in the background so the first
 * switch to a mode never stalls.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { LyricFrame } from '../lyrics/LyricsEngine';
import type { Features } from './AudioFeatures';
import { LyricsLayer, type LyricStyle } from './LyricsLayer';
import { Director, TRANSITIONS, type TransitionKind } from './director';
import type { ModeInfo } from './kit';
import { MODE_FACTORIES, MODE_INFO, type VisMode } from './modes';
import { MORE_INFO, MORE_MODES } from './modes2';
import { INFO3, MODES3 } from './modes3';
import { INFO4, MODES4 } from './modes4';

const FACTORIES = [...MODE_FACTORIES, ...MORE_MODES, ...MODES3, ...MODES4];
const DEFAULT_COLORS = [new THREE.Color('#2ec4f1'), new THREE.Color('#ff5fcf'), new THREE.Color('#7b5cff')];
const INFO: ModeInfo[] = [...MODE_INFO, ...MORE_INFO, ...INFO3, ...INFO4];

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

/* The outgoing mode under the incoming one while they change over. */
const TransitionShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tPrev: { value: null as THREE.Texture | null },
    uP: { value: 0 },
    uKind: { value: 0 },
    uAsp: { value: 16 / 9 },
    uSeed: { value: 0 },
  },
  vertexShader: FinalShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tPrev;
    uniform float uP, uKind, uAsp, uSeed;
    varying vec2 vUv;
    float h1(float n) { return fract(sin(n * 127.1 + uSeed * 17.3) * 43758.5453); }
    float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 9.1) * 43758.5453); }
    void main() {
      vec2 p = (vUv - 0.5) * vec2(uAsp, 1.0);
      vec2 ua = vUv;
      vec2 ub = vUv;
      float m = uP;
      float edge = 0.0;
      if (uKind > 0.5 && uKind < 1.5) {
        // iris: the new picture opens from the middle behind a bright rim
        float R = uP * (0.5 * length(vec2(uAsp, 1.0)) + 0.06);
        float r = length(p);
        m = smoothstep(R, R - 0.04, r);
        edge = smoothstep(0.03, 0.0, abs(r - R)) * (1.0 - uP);
      } else if (uKind > 1.5 && uKind < 2.5) {
        // slices: bands wipe across, every other one the other way
        float b = floor(vUv.y * 14.0);
        float x = mod(b, 2.0) < 0.5 ? vUv.x : 1.0 - vUv.x;
        float t = uP * 1.5 - h1(b) * 0.5;
        m = step(x, t);
        edge = smoothstep(0.015, 0.0, abs(x - t)) * (1.0 - uP);
      } else if (uKind > 2.5 && uKind < 3.5) {
        // zoom: the old picture rushes past, the new one punches in and settles
        ua = (vUv - 0.5) / (1.0 + uP * 1.5) + 0.5;
        ub = (vUv - 0.5) / (1.0 + (1.0 - uP) * 0.5) + 0.5;
        m = smoothstep(0.1, 0.7, uP);
      } else if (uKind > 3.5) {
        // pixels: blocks flip over in a random order
        vec2 cell = floor(vUv * vec2(floor(24.0 * uAsp), 24.0));
        m = step(h2(cell), uP * 1.1);
      }
      vec3 a = texture2D(tPrev, ua).rgb;
      vec3 b = texture2D(tDiffuse, ub).rgb;
      gl_FragColor = vec4(mix(a, b, m) + vec3(edge) * 0.6, 1.0);
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
  /** the auto VJ picks modes to fit the music */
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
  /** the adaptive quality can switch the player's bloom off under load */
  bloomAllowed = true;
  private w = 960;
  private h = 540;
  private trans: ShaderPass;
  /** the outgoing mode while a transition runs, and where it draws */
  private prev: VisMode | null = null;
  private prevRT: THREE.WebGLRenderTarget;
  private fadeT = 0;
  private fadeDur = 0.5;
  private bpm = 124;
  private director = new Director(INFO);
  /** shaders still to compile in the background */
  private toWarm: VisMode[] = [];
  private frames = 0;
  /** flashing is reduced: strobes stay under 3 a second (set by the stage from the lights desk) */
  safe = false;
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
    this.prevRT = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.HalfFloatType, depthBuffer: true });
    this.trans = new ShaderPass(TransitionShader);
    this.trans.uniforms.tPrev.value = this.prevRT.texture;
    this.trans.enabled = false;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.w, this.h), 0.6, 0.5, 0.32);
    this.final = new ShaderPass(FinalShader);
    this.text = new ShaderPass(TextShader);
    this.text.uniforms.tText.value = this.lyrics.texture;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.trans);
    this.composer.addPass(this.text);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    for (const m of this.modes) m.resize(this.w, this.h);
    this.toWarm = this.modes.filter((m) => m !== this.current);
  }

  static modeInfo(): ModeInfo[] {
    return INFO;
  }

  get modeId(): string {
    return this.current.id;
  }

  get texture(): THREE.Texture {
    return this.composer.readBuffer.texture;
  }

  /**
   * Switch modes. By default the old mode hands over through a transition one
   * beat long; `cut` switches at once (loading saved settings).
   */
  setMode(id: string, how: { kind?: TransitionKind | 'cut'; beats?: number } = {}): void {
    const m = this.modes.find((x) => x.id === id);
    if (!m) return;
    this.settings.mode = id;
    if (m === this.current) return;
    const old = this.current;
    if (this.prev && this.prev !== m) this.prev.sleep?.();
    this.prev = null;
    if (how.kind === 'cut') old.sleep?.();
    else {
      const kind = how.kind ?? TRANSITIONS[Math.floor(Math.random() * TRANSITIONS.length)];
      this.prev = old;
      this.fadeT = 0;
      this.fadeDur = Math.min(1.6, Math.max(0.3, (60 / this.bpm) * (how.beats ?? 1)));
      const tu = this.trans.uniforms;
      tu.uKind.value = TRANSITIONS.indexOf(kind);
      tu.uSeed.value = Math.random() * 100;
    }
    this.current = m;
    this.renderPass.scene = m.scene;
    this.renderPass.camera = m.camera;
    m.resize(this.w, this.h);
    this.director.played(id);
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
    this.prevRT.setSize(w, h);
    this.bloom.resolution.set(w, h);
    for (const m of this.modes) m.resize(w, h);
  }

  /** Render the current mode into the output texture. */
  render(f: Features, dt: number, lyric?: LyricInput): void {
    const s = this.settings;
    const r = this.renderer;
    f.intensity = s.intensity;
    f.shake = s.shake ? 1 : 0;
    f.safe = this.safe ? 1 : 0;
    this.bpm = f.bpm || 124;
    if (s.autoCycle) {
      const cut = this.director.tick(this.current.id, f);
      if (cut) this.setMode(cut.id, { kind: cut.kind, beats: cut.beats });
    }
    this.warmUp();
    this.current.update(f, dt);
    // the outgoing mode keeps playing under the transition
    const prevTarget = r.getRenderTarget();
    if (this.prev) {
      this.fadeT += dt;
      const p = this.fadeT / this.fadeDur;
      if (p >= 1) {
        this.prev.sleep?.();
        this.prev = null;
      } else {
        this.prev.update(f, dt);
        this.prev.prerender?.(r);
        r.setRenderTarget(this.prevRT);
        r.clear();
        r.render(this.prev.scene, this.prev.camera);
        r.setRenderTarget(prevTarget);
        const tu = this.trans.uniforms;
        tu.uP.value = p * p * (3 - 2 * p);
        tu.uAsp.value = this.w / this.h;
      }
    }
    this.trans.enabled = !!this.prev;
    this.current.prerender?.(r);
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
    this.bloom.enabled = s.bloom && this.bloomAllowed;
    this.bloom.strength = 0.35 + f.level * 0.35 + f.drop * 0.6 * s.intensity;
    const u = this.final.uniforms;
    u.uAberration.value = s.aberration ? (0.004 + f.snarePulse * 0.018 + f.drop * 0.03) * s.intensity : 0;
    u.uHueShift.value = s.palette ? f.drop * 0.15 : 0;
    u.uTime.value = f.time;
    u.uFlash.value = f.dropHit ? (this.safe ? 0.2 : 0.6) : Math.max(0, (u.uFlash.value as number) - dt * 3);
    this.composer.render(dt);
    r.setRenderTarget(prevTarget);
  }

  /** compile one more mode's shaders every half second or so, ahead of their first use */
  private warmUp(): void {
    if (!this.toWarm.length || ++this.frames % 30 !== 0) return;
    const m = this.toWarm.shift()!;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    // compile for an offscreen target, as the mode will draw: same tone mapping, same programs
    r.setRenderTarget(this.prevRT);
    for (const sc of [m.scene, ...(m.warm ?? [])]) void r.compileAsync(sc, m.camera).catch(() => {});
    r.setRenderTarget(prev);
  }

  dispose(): void {
    for (const m of this.modes) m.dispose();
    this.prevRT.dispose();
    this.lyrics.texture.dispose();
    this.composer.dispose();
  }
}
