/*
 * Your own visual modes (the Visual editor): three slots, each a stack of up
 * to four layers over a background, all in one shader. The layers:
 *   tunnel      rings rushing at you on the beat
 *   shapes      a ring of polygons (3 to 8 sides) spinning and pulsing
 *   spectrum    the spectrum as bars round a circle
 *   stars       a starfield flying past, faster with the kick
 *   grid        a neon grid floor running to the horizon
 *   name        your DJ name, pulsing on the beat
 *   waves       the waveform as glowing lines
 * plus a kaleidoscope over the whole thing (off, 4, 6 or 8 slices), each
 * layer with its own colour, amount and speed. Saved in settings
 * ("myVisuals"); edits show live.
 */
import * as THREE from 'three';
import { loadSetting, saveSetting } from '../core/settings';
import { nameService } from '../name/NameService';
import { shaderMode, type ModeInfo } from './kit';
import type { VisMode } from './modes';

export const LAYER_KINDS = ['tunnel', 'shapes', 'spectrum', 'stars', 'grid', 'name', 'waves'] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];
export const BACKGROUNDS = ['black', 'gradient', 'smoke'] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const LAYER_LABEL: Record<LayerKind, string> = { tunnel: 'Tunnel', shapes: 'Shapes', spectrum: 'Spectrum ring', stars: 'Starfield', grid: 'Grid floor', name: 'Your name', waves: 'Waveform' };

export interface VisLayer {
  on: boolean;
  kind: LayerKind;
  color: string;
  /** how strong, 0..1 */
  amount: number;
  /** how fast, 0..1 */
  speed: number;
  /** the shapes' sides */
  sides: number;
}

export interface MyVisual {
  name: string;
  background: Background;
  bgColor: string;
  kaleido: 0 | 4 | 6 | 8;
  layers: VisLayer[];
}

export const MY_SLOTS = 3;

const layer = (kind: LayerKind, color: string, on = true, amount = 0.7, speed = 0.5): VisLayer => ({ on, kind, color, amount, speed, sides: 6 });

const DEFAULTS: MyVisual[] = [
  { name: 'My tunnel', background: 'gradient', bgColor: '#120424', kaleido: 0, layers: [layer('tunnel', '#ff2e88'), layer('shapes', '#3dd6ff', true, 0.5), layer('name', '#ffffff', true, 0.6), layer('stars', '#ffffff', false)] },
  { name: 'My kaleidoscope', background: 'smoke', bgColor: '#05101c', kaleido: 6, layers: [layer('shapes', '#ffd23f', true, 0.8, 0.6), layer('spectrum', '#ff2e88'), layer('waves', '#3dd6ff', true, 0.5), layer('grid', '#7a3cff', false)] },
  { name: 'My horizon', background: 'gradient', bgColor: '#1a0630', kaleido: 0, layers: [layer('grid', '#ff2e88'), layer('stars', '#ffffff', true, 0.6), layer('name', '#ffd23f', true, 0.7), layer('spectrum', '#3dd6ff', false)] },
];

const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

/** a saved visual: always complete */
export function cleanVisual(raw: unknown, slot: number): MyVisual {
  const d = DEFAULTS[slot % DEFAULTS.length];
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const layers = Array.isArray(r.layers) ? r.layers : [];
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 24) : d.name,
    background: BACKGROUNDS.includes(r.background as Background) ? (r.background as Background) : d.background,
    bgColor: hex(r.bgColor, d.bgColor),
    kaleido: ([0, 4, 6, 8] as const).includes(r.kaleido as 0) ? (r.kaleido as 0 | 4 | 6 | 8) : d.kaleido,
    layers: d.layers.map((dl, i) => {
      const l = (typeof layers[i] === 'object' && layers[i] !== null ? layers[i] : {}) as Record<string, unknown>;
      return {
        on: typeof l.on === 'boolean' ? l.on : dl.on,
        kind: LAYER_KINDS.includes(l.kind as LayerKind) ? (l.kind as LayerKind) : dl.kind,
        color: hex(l.color, dl.color),
        amount: num(l.amount, dl.amount),
        speed: num(l.speed, dl.speed),
        sides: typeof l.sides === 'number' ? Math.max(3, Math.min(8, Math.round(l.sides))) : dl.sides,
      };
    }),
  };
}

/** the three slots, live: the modes read them every frame, the editor writes them */
export const myVisuals: MyVisual[] = Array.from({ length: MY_SLOTS }, (_, i) => cleanVisual(null, i));

export function loadMyVisuals(): void {
  const raw = loadSetting<unknown[]>('myVisuals', []);
  for (let i = 0; i < MY_SLOTS; i++) myVisuals[i] = cleanVisual(Array.isArray(raw) ? raw[i] : null, i);
  for (const fn of listeners) fn();
}

export function saveMyVisuals(): void {
  saveSetting('myVisuals', myVisuals);
  for (const fn of listeners) fn();
}

const listeners = new Set<() => void>();
/** the visuals changed (names in the mode picker) */
export function onMyVisuals(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const myVisualId = (i: number) => `my${i + 1}`;

const BODY = /* glsl */ `
  uniform vec4 uL[4];
  uniform vec3 uLC[4];
  uniform float uSides[4];
  uniform float uBg, uKal;
  uniform vec3 uBgC;
  uniform sampler2D uName;
  vec3 layerCol(int i, vec2 p, vec4 L, vec3 C, float sides) {
    float kind = L.x;
    float amt = L.y;
    float sp = 0.3 + L.z * 2.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    vec3 c = vec3(0.0);
    if (kind < 0.5) {
      // tunnel: rings flying at you, a flash on the beat
      float z = 0.35 / max(r, 0.02) + uTravel * sp;
      float ring = pow(abs(sin(z * 3.14159)), 24.0);
      float spokes = pow(abs(sin(a * 6.0 + z * 0.3)), 40.0) * 0.4;
      c = C * (ring + spokes) * smoothstep(0.0, 0.25, r) * (1.0 + uPulse * 1.5);
    } else if (kind < 1.5) {
      // shapes: a ring of polygons
      float n = sides;
      float rot = uTime * sp * 0.5;
      vec2 q = rot(rot) * p;
      float seg = 6.2831853 / n;
      float ang = mod(atan(q.y, q.x) + seg * 0.5, seg) - seg * 0.5;
      float poly = length(q) * cos(ang) / cos(seg * 0.5);
      float size = 0.28 + 0.06 * uKick + 0.04 * sin(uTime * sp);
      float edge = exp(-pow((poly - size) * 60.0, 2.0)) + exp(-pow((poly - size * 1.6) * 50.0, 2.0)) * 0.6;
      c = C * edge * (0.8 + uPulse);
    } else if (kind < 2.5) {
      // spectrum round a circle
      float x = fract(a / 6.2831853 + 0.5);
      float s = spec(abs(x - 0.5) * 1.8);
      float bar = step(r, 0.22 + s * 0.35) * step(0.2, r);
      float lane = step(0.35, fract(x * 64.0));
      c = C * bar * lane * (0.6 + s);
    } else if (kind < 3.5) {
      // stars flying past
      for (int k = 0; k < 3; k++) {
        float depth = fract(uTravel * 0.12 * sp + float(k) / 3.0);
        vec2 g = p / max(0.05, depth) * 4.0;
        vec2 cell = floor(g);
        vec2 off = hash2(cell + float(k) * 13.0) - 0.5;
        float d = length(fract(g) - 0.5 - off * 0.6);
        c += C * smoothstep(0.08, 0.0, d) * depth * step(0.6, hash(cell + float(k)));
      }
    } else if (kind < 4.5) {
      // a grid floor to the horizon
      if (p.y < -0.02) {
        float z = 0.25 / -p.y;
        vec2 g = vec2(p.x * z, z + uTravel * sp);
        vec2 f = abs(fract(g) - 0.5);
        float line = smoothstep(0.47, 0.5, max(f.x, f.y));
        c = C * line * smoothstep(8.0, 1.0, z) * (1.0 + uKick);
      }
      c += C * 0.25 * exp(-abs(p.y) * 30.0);
    } else if (kind < 5.5) {
      // your name, pulsing
      vec2 uv = vec2(p.x * 0.55 + 0.5, p.y * 2.2 + 0.5);
      float m = (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ? texture2D(uName, uv).r : 0.0;
      c = C * m * (0.8 + uPulse * 1.2);
    } else {
      // the waveform as glowing lines
      for (int k = 0; k < 3; k++) {
        float y = wave(fract(p.x * 0.5 + 0.5 + float(k) * 0.13)) * 0.25 * (1.0 + uLevel) + (float(k) - 1.0) * 0.12;
        c += C * exp(-abs(p.y - y) * 90.0) * (1.0 - float(k) * 0.25);
      }
    }
    return c * amt * 1.6;
  }
  void main() {
    vec2 p = screen();
    // the kaleidoscope folds the picture into slices
    if (uKal > 0.5) {
      float seg = 6.2831853 / uKal;
      float a = atan(p.y, p.x) + uTime * 0.05;
      a = mod(a, seg);
      a = abs(a - seg * 0.5);
      p = vec2(cos(a), sin(a)) * length(p);
    }
    vec3 col = uBgC * 0.15;
    if (uBg > 0.5 && uBg < 1.5) col = mix(uBgC, uBgC * 0.2, clamp(length(screen()) * 1.2, 0.0, 1.0)) * 0.9;
    else if (uBg > 1.5) col = uBgC * (0.3 + 0.9 * fbm(p * 2.0 + vec2(uTime * 0.05, -uTime * 0.03)));
    for (int i = 0; i < 4; i++) {
      if (uL[i].w < 0.5) continue;
      col += layerCol(i, p, uL[i], uLC[i], uSides[i]);
    }
    gl_FragColor = vec4(clamp(tonemap(col * 1.2), 0.0, 1.0), 1.0);
  }
`;

/** your name, white on black, for the shader */
function nameTexture(): { tex: THREE.CanvasTexture; draw(): void } {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  let last = '';
  const draw = () => {
    const name = (nameService.text || 'DECKHOUSE').toUpperCase();
    if (name === last) return;
    last = name;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 100;
    g.font = `900 ${size}px "Barlow Condensed", sans-serif`;
    const w = g.measureText(name).width;
    if (w > 480) {
      size *= 480 / w;
      g.font = `900 ${size}px "Barlow Condensed", sans-serif`;
    }
    g.fillText(name, 256, 68);
    tex.needsUpdate = true;
  };
  return { tex, draw };
}

function myMode(slot: number): VisMode {
  const nt = typeof document !== 'undefined' ? nameTexture() : null;
  const kindIndex = (k: LayerKind) => LAYER_KINDS.indexOf(k);
  const uniforms: Record<string, THREE.IUniform> = {
    uL: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    uLC: { value: [0, 1, 2, 3].map(() => new THREE.Color()) },
    uSides: { value: [6, 6, 6, 6] },
    uBg: { value: 1 },
    uKal: { value: 0 },
    uBgC: { value: new THREE.Color() },
    uName: { value: nt?.tex ?? null },
  };
  const id = myVisualId(slot);
  return shaderMode(id, `My visual ${slot + 1}`, 'Your own visual, made in the Visual editor', BODY, 1, {
    uniforms,
    update(u) {
      const v = myVisuals[slot];
      nt?.draw();
      v.layers.forEach((l, i) => {
        (u.uL.value[i] as THREE.Vector4).set(kindIndex(l.kind), l.amount, l.speed, l.on ? 1 : 0);
        (u.uLC.value[i] as THREE.Color).set(l.color);
        u.uSides.value[i] = l.sides;
      });
      u.uBg.value = BACKGROUNDS.indexOf(v.background);
      u.uKal.value = v.kaleido;
      (u.uBgC.value as THREE.Color).set(v.bgColor);
    },
  });
}

export const MY_MODES: (() => VisMode)[] = Array.from({ length: MY_SLOTS }, (_, i) => () => myMode(i));
/** listed with the calm-to-mid modes; the names follow what you call them */
export const MY_INFO: ModeInfo[] = Array.from({ length: MY_SLOTS }, (_, i) => ({ id: myVisualId(i), name: myVisuals[i].name, blurb: 'Your own visual, made in the Visual editor', energy: 'mid' }));
onMyVisuals(() => MY_INFO.forEach((m, i) => (m.name = myVisuals[i].name)));
