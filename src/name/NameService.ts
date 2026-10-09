/*
 * NameService (Section 3.6): the one place the DJ name is drawn. Every
 * surface that shows the name asks for it here with a style ID; the service
 *   – lays the name out to fit the surface (layout.ts: scaled down, wrapped
 *     onto two lines if needed, never cut), optionally with the tagline
 *   – draws it once per style and size into a cached canvas texture shared
 *     by every surface that needs the same thing (nothing is drawn per frame)
 *   – redraws everything when the name changes, so a rename shows up
 *     everywhere at once, with no restart
 *   – drives one shared set of shader values from the beat clock (kick
 *     pulse, letter chase in builds, drop strobe + glitch, breakdown
 *     breathing), so the name moves with the music on every glowing surface
 * Until the player names themselves, surfaces show the house name.
 */
import * as THREE from 'three';
import { layoutName, type Laid } from './layout';
import { NameReactor, type ReactorInput } from './reactor';
import { STYLES, type DrawOpts, type NameStyle } from './styles';

export type { NameStyle } from './styles';

export interface NameProfile {
  name: string;
  tagline: string;
  uppercase: boolean;
}

export interface SurfaceOpts {
  /** add the tagline under the name */
  tagline?: boolean;
  /** a solid panel behind a glowing style */
  bg?: string | null;
  /** brightness of a glowing style (HDR: above 1 blooms) */
  gain?: number;
  /** only show while the name is up on the screens (LED wall overlays) */
  screen?: boolean;
  /** texture width in px (height follows the surface's shape) */
  px?: number;
  accent?: string;
}

const FALLBACK = 'DECKHOUSE';
const MAX_BOXES = 20;

interface Entry {
  key: string;
  style: NameStyle;
  w: number;
  h: number;
  opts: SurfaceOpts;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  laid: Laid;
  /** letter boxes for the chase, packed for the shader */
  boxes: THREE.Vector4[];
  count: { value: number };
  refs: number;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uGain, uKick, uChase, uGlitch, uFlash, uBreath, uScreen, uTime, uScreenMode, uCount;
  uniform vec4 uBoxes[${MAX_BOXES}];
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    // the drop: rows slide apart and blink out, then snap back together
    if (uGlitch > 0.001) {
      float row = floor(uv.y * 12.0);
      float n = fract(sin(row * 91.7 + floor(uTime * 20.0) * 13.13) * 43758.5453);
      uv.x += (n - 0.5) * 0.3 * uGlitch * step(0.4, n);
      if (n > 1.0 - 0.25 * uGlitch) discard;
    }
    vec4 t = texture2D(uMap, uv);
    float lit = 1.0;
    // the build: letters chase on one by one
    if (uChase < 0.999) {
      float k = floor(uChase * uCount + 0.0001);
      for (int i = 0; i < ${MAX_BOXES}; i++) {
        if (float(i) >= uCount) break;
        vec4 b = uBoxes[i];
        if (uv.x >= b.x && uv.x <= b.y && uv.y >= b.z && uv.y <= b.w) lit = float(i) <= k ? 1.0 : 0.1;
      }
    }
    float breathe = mix(1.0, 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 1.2)), uBreath);
    float vis = uScreenMode > 0.5 ? uScreen : 1.0;
    // the drop's strobe: a pop on signs, gentler on the big LED-wall overlays (they cover a lot of frame)
    vec3 col = t.rgb * (uGain * (1.0 + 0.7 * uKick) * breathe * lit + uFlash * (uScreenMode > 0.5 ? 0.6 : 1.6));
    gl_FragColor = vec4(col * vis, t.a * vis);
  }`;

export class NameService {
  private profile: NameProfile = { name: '', tagline: '', uppercase: true };
  private entries = new Map<string, Entry>();
  private listeners = new Set<(text: string) => void>();
  private measureCtx: CanvasRenderingContext2D | null = null;
  readonly reactor = new NameReactor();
  /** the beat-reactive values every glowing name surface shares */
  readonly fx = {
    uKick: { value: 0 },
    uChase: { value: 1 },
    uGlitch: { value: 0 },
    uFlash: { value: 0 },
    uBreath: { value: 0 },
    uScreen: { value: 0 },
    uTime: { value: 0 },
  };

  constructor() {
    // web fonts arrive after the first draw: redraw when they do
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener?.('loadingdone', () => this.redraw());
      void document.fonts.ready.then(() => this.redraw());
    }
  }

  /** the player has named themselves */
  get named(): boolean {
    return !!this.profile.name;
  }

  get tagline(): string {
    const t = this.profile.tagline;
    return this.profile.uppercase ? t.toUpperCase() : t;
  }

  /** the name as surfaces show it (capitals by default, the house name until named) */
  get text(): string {
    const n = this.profile.name || FALLBACK;
    return this.profile.uppercase ? n.toUpperCase() : n;
  }

  set(p: NameProfile): void {
    const same = p.name === this.profile.name && p.tagline === this.profile.tagline && p.uppercase === this.profile.uppercase;
    this.profile = { ...p };
    if (same) return;
    this.redraw();
    for (const fn of this.listeners) fn(this.text);
  }

  /** called with the new display text whenever the name changes */
  onChange(fn: (text: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Lay a name out for a style and size (also used by the naming scene and previews). */
  layout(style: NameStyle, text: string, w: number, h: number): Laid {
    const st = STYLES[style];
    const g = (this.measureCtx ??= document.createElement('canvas').getContext('2d')!);
    g.font = st.font(100);
    const cache = new Map<string, number>();
    const measure = (s: string) => {
      let v = cache.get(s);
      if (v === undefined) cache.set(s, (v = g.measureText(s).width / 100));
      return v;
    };
    return layoutName(text, w, h, measure, { pad: st.pad, lineHeight: st.lineHeight, tracking: st.tracking });
  }

  /** Draw the name (or any text) in a style onto a canvas: previews, the naming scene's sign. */
  draw(canvas: HTMLCanvasElement, style: NameStyle, text = this.text, o: DrawOpts & { tagline?: string } = {}): Laid {
    const g = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    const st = STYLES[style];
    const tag = o.tagline?.trim();
    const nameH = tag ? h * 0.72 : h;
    const laid = this.layout(style, text, w, nameH);
    g.save();
    if (tag) {
      // draw the name into the top part (styles fill their whole canvas, so clip it)
      st.draw(g, w, h, { ...laid, ys: laid.ys }, o);
      const t = this.layout(style, tag, w * 0.9, h - nameH);
      g.font = st.font(t.size);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = st.emissive ? 'rgba(255,255,255,0.85)' : 'rgba(20,20,20,0.85)';
      t.lines.forEach((l, i) => g.fillText(l, w / 2, nameH + t.ys[i]));
      // the letter boxes are relative to the name's part of the canvas
      laid.boxes = laid.boxes.map((b) => ({ ...b, y0: (h - nameH + b.y0 * nameH) / h, y1: (h - nameH + b.y1 * nameH) / h }));
    } else st.draw(g, w, h, laid, o);
    g.restore();
    return laid;
  }

  private render(e: Entry): void {
    e.laid = this.draw(e.canvas, e.style, this.text, { bg: e.opts.bg, accent: e.opts.accent, tagline: e.opts.tagline ? this.tagline : undefined });
    const n = Math.min(MAX_BOXES, e.laid.boxes.length);
    for (let i = 0; i < MAX_BOXES; i++) {
      const b = e.laid.boxes[i];
      e.boxes[i].set(b?.x0 ?? 0, b?.x1 ?? 0, b?.y0 ?? 0, b?.y1 ?? 0);
    }
    e.count.value = n;
    e.texture.needsUpdate = true;
  }

  /** redraw every cached texture (a rename, fonts arriving) */
  redraw(): void {
    for (const e of this.entries.values()) this.render(e);
  }

  private acquire(style: NameStyle, w: number, h: number, opts: SurfaceOpts): Entry {
    const key = `${style}|${w}x${h}|${opts.tagline ? 't' : ''}|${opts.bg ?? ''}|${opts.accent ?? ''}`;
    let e = this.entries.get(key);
    if (!e) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      // venues free their textures when they're torn down; this one is shared
      texture.userData.shared = true;
      e = { key, style, w, h, opts, canvas, texture, laid: { lines: [], size: 0, lineHeight: 0, ys: [], boxes: [] }, boxes: Array.from({ length: MAX_BOXES }, () => new THREE.Vector4()), count: { value: 0 }, refs: 0 };
      this.entries.set(key, e);
      this.render(e);
    }
    e.refs++;
    return e;
  }

  private release(e: Entry): void {
    if (--e.refs > 0) return;
    e.texture.dispose();
    this.entries.delete(e.key);
  }

  /** how many distinct name textures exist (for the debug menu and tests) */
  get textureCount(): number {
    return this.entries.size;
  }

  /**
   * A material that shows the name in a style, sized for a surface of
   * width × height metres. Glowing styles get the beat-reactive shader;
   * printed ones a normal lit material. The texture is released when the
   * material is disposed.
   */
  material(style: NameStyle, width: number, height: number, opts: SurfaceOpts = {}): THREE.Material {
    const pw = Math.round(opts.px ?? 1024);
    const ph = Math.max(32, Math.min(1024, Math.round((pw * height) / Math.max(1e-3, width))));
    const e = this.acquire(style, pw, ph, opts);
    const st = STYLES[style];
    let mat: THREE.Material;
    if (st.emissive) {
      mat = new THREE.ShaderMaterial({
        name: `name:${style}`,
        uniforms: {
          uMap: { value: e.texture },
          uGain: { value: opts.gain ?? 1.6 },
          uScreenMode: { value: opts.screen ? 1 : 0 },
          uBoxes: { value: e.boxes },
          uCount: e.count,
          ...this.fx,
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: opts.bg ? THREE.NormalBlending : THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({ name: `name:${style}`, map: e.texture, roughness: 0.75, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    }
    mat.addEventListener('dispose', () => this.release(e));
    return mat;
  }

  /** A plane (width × height metres, facing +Z) showing the name. */
  surface(style: NameStyle, width: number, height: number, opts: SurfaceOpts = {}): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material(style, width, height, opts));
    m.name = `name_surface:${style}`;
    m.renderOrder = 3;
    return m;
  }

  /** every frame: move the name with the music */
  update(input: ReactorInput, dt: number): void {
    const fx = this.reactor.update(input, dt);
    const u = this.fx;
    u.uKick.value = fx.kick;
    u.uChase.value = fx.chase;
    u.uGlitch.value = fx.glitch;
    u.uFlash.value = fx.flash;
    u.uBreath.value = fx.breath;
    u.uScreen.value = fx.screen;
    u.uTime.value += dt;
  }
}

/** the game's NameService */
export const nameService = new NameService();
