/*
 * The board file (Section 13.12): a documented, versioned JSON format, so
 * boards keep loading as the game changes. See docs/board-format.md.
 *
 *   { format: "deckhouse-board", version: 1, id, name, created,
 *     booth, components: [ … ], wiring: { nodes, cables }, macros, triggers, midi }
 *
 * Every loaded board is checked: unknown component types are skipped (so a
 * board from a newer game still opens), numbers are clamped, strings cut to
 * length, and anything that isn't plain data is dropped.
 * Share codes are the same JSON, deflated and written in URL-safe base64.
 */
import { MATERIAL_IDS, type Glow, type MaterialId } from './materials';

export const BOARD_FORMAT = 'deckhouse-board';
export const BOARD_VERSION = 1;

export type Vec3 = [number, number, number];

export const FEEL_CURVES = ['linear', 'log', 'exp', 's'] as const;
export const SOUNDS = ['click', 'soft', 'mechanical', 'whoosh', 'silent'] as const;
export const ANIMS = ['none', 'spin', 'bob', 'pulse'] as const;
export const FONTS = ['label', 'mono', 'marker', 'script'] as const;
export const LABEL_PLACES = ['above', 'below', 'on', 'none'] as const;

/** what every component has (Section 13.4); type-specific settings sit alongside */
export interface CommonProps {
  name?: string;
  shape?: string;
  material: MaterialId;
  /** up to three colour zones */
  colors: [string, string, string];
  glow: Glow;
  label: { text: string; font: (typeof FONTS)[number]; place: (typeof LABEL_PLACES)[number] };
  /** what it controls: a control id ('deck.1.play'), or an add-on function */
  fn: string;
  /** a second axis (XY pad, globe, theremin) */
  fn2: string;
  feel: { curve: (typeof FEEL_CURVES)[number]; sensitivity: number; detents: number; resistance: number };
  sound: (typeof SOUNDS)[number];
  anim: (typeof ANIMS)[number];
  hidden: boolean;
  locked: boolean;
  [k: string]: unknown;
}

export interface BoardComponent {
  id: string;
  type: string;
  pos: Vec3;
  /** radians */
  rot: Vec3;
  scale: Vec3;
  props: CommonProps;
  /** a group's members (groups nest) */
  children: BoardComponent[];
}

export const TABLE_SHAPES = ['rect', 'round', 'curved', 'L', 'none'] as const;
export const FRONTS = ['plain', 'name', 'led', 'mesh', 'wood', 'mirror'] as const;
export const MONITORS = ['none', 'small', 'large', 'stack'] as const;
export const CABLES = ['hidden', 'colored', 'coiled'] as const;

export interface Booth {
  table: (typeof TABLE_SHAPES)[number];
  width: number;
  depth: number;
  height: number;
  front: (typeof FRONTS)[number];
  material: MaterialId;
  color: string;
  monitors: (typeof MONITORS)[number];
  cables: (typeof CABLES)[number];
  cableColor: string;
  /** riser height, metres */
  riser: number;
  glassFloor: boolean;
  sideScreens: boolean;
}

export interface WireNode {
  id: string;
  /** 'in.component', 'in.clock', 'in.vibe', 'mod.scale', 'out.control', 'out.light'… */
  type: string;
  params: Record<string, string | number | boolean>;
  x: number;
  y: number;
}

export interface Cable {
  from: string;
  to: string;
}

export interface MacroStep {
  /** ms from the start */
  at: number;
  control: string;
  /** a value for continuous controls; absent = a press */
  value?: number;
}

export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
}

export const TRIGGER_WHEN = ['vibe', 'drop', 'bar', 'phrase', 'build', 'breakdown', 'peak'] as const;
export interface Trigger {
  id: string;
  when: (typeof TRIGGER_WHEN)[number];
  /** for 'vibe': fires when the meter goes above this (0..1) */
  above: number;
  /** 'control:<id>' presses a control, 'macro:<id>' plays a macro, 'show:<what>' fires the show */
  action: string;
  on: boolean;
}

export interface BoardFile {
  format: typeof BOARD_FORMAT;
  version: number;
  id: string;
  name: string;
  created: string;
  booth: Booth;
  components: BoardComponent[];
  wiring: { nodes: WireNode[]; cables: Cable[] };
  macros: Macro[];
  triggers: Trigger[];
  /** hardware: a MIDI message key ('cc:1:7', 'note:1:36') → a component id */
  midi: Record<string, string>;
}

/* ------------------------------ defaults ------------------------------ */

export function defaultBooth(): Booth {
  return { table: 'rect', width: 1.6, depth: 0.75, height: 0.95, front: 'name', material: 'matte', color: '#14161a', monitors: 'small', cables: 'hidden', cableColor: '#ff2e88', riser: 0, glassFloor: false, sideScreens: false };
}

export function commonDefaults(): CommonProps {
  return {
    material: 'matte',
    colors: ['#1b1d22', '#e8ebf0', '#ff2e88'],
    glow: { color: '#ff2e88', intensity: 0, beat: false },
    label: { text: '', font: 'label', place: 'none' },
    fn: '',
    fn2: '',
    feel: { curve: 'linear', sensitivity: 1, detents: 0, resistance: 0.5 },
    sound: 'click',
    anim: 'none',
    hidden: false,
    locked: false,
  };
}

export function emptyBoard(id: string, name = 'My board'): BoardFile {
  return { format: BOARD_FORMAT, version: BOARD_VERSION, id, name, created: new Date().toISOString(), booth: defaultBooth(), components: [], wiring: { nodes: [], cables: [] }, macros: [], triggers: [], midi: {} };
}

/* ------------------------------ checking ------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown) => (isObj(v) ? v : {});
const num = (v: unknown, lo: number, hi: number, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
const str = (v: unknown, max: number, fb = '') => (typeof v === 'string' ? v.slice(0, max) : fb);
const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
const oneOf = <T>(v: unknown, list: readonly T[], fb: T): T => (list.includes(v as T) ? (v as T) : fb);
const ID = /^[\w-]{1,64}$/;
const id = (v: unknown) => (typeof v === 'string' && ID.test(v) ? v : null);
const TYPE = /^[a-z][a-z0-9_]{0,31}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const color = (v: unknown, fb: string) => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : fb);
const CONTROL = /^[\w.:-]{0,80}$/;
const vec = (v: unknown, fb: Vec3, lo: number, hi: number): Vec3 => (Array.isArray(v) && v.length === 3 ? (v.map((x, i) => num(x, lo, hi, fb[i])) as Vec3) : fb);

/** plain JSON values only (numbers, strings, booleans, small arrays and objects) */
function plain(v: unknown, depth = 0): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.slice(0, 20_000);
  if (typeof v === 'boolean') return v;
  if (depth > 4) return undefined;
  if (Array.isArray(v)) return v.slice(0, 256).map((x) => plain(x, depth + 1)).filter((x) => x !== undefined);
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v).slice(0, 64)) {
      const p = plain(x, depth + 1);
      if (p !== undefined && /^[\w.-]{1,40}$/.test(k)) out[k] = p;
    }
    return out;
  }
  return undefined;
}

export function checkProps(raw: unknown, typeDefaults: Record<string, unknown> = {}): CommonProps {
  const r = obj(raw);
  const d = { ...commonDefaults(), ...typeDefaults } as CommonProps;
  const g = obj(r.glow);
  const l = obj(r.label);
  const f = obj(r.feel);
  const cols = Array.isArray(r.colors) ? r.colors : [];
  const out: CommonProps = {
    // type-specific settings: kept as plain data, defaults filled in
    ...(plain(typeDefaults) as Record<string, unknown>),
    ...Object.fromEntries(Object.entries(obj(plain(r))).filter(([k]) => k in typeDefaults && typeof (typeDefaults as Record<string, unknown>)[k] === typeof (r as Record<string, unknown>)[k])),
    name: str(r.name, 40) || undefined,
    shape: typeof r.shape === 'string' ? str(r.shape, 24) : (d.shape as string | undefined),
    material: oneOf(r.material, MATERIAL_IDS, d.material),
    colors: [color(cols[0], d.colors[0]), color(cols[1], d.colors[1]), color(cols[2], d.colors[2])],
    glow: { color: color(g.color, d.glow.color), intensity: num(g.intensity, 0, 1, d.glow.intensity), beat: bool(g.beat, d.glow.beat) },
    label: { text: str(l.text, 40, d.label.text), font: oneOf(l.font, FONTS, d.label.font), place: oneOf(l.place, LABEL_PLACES, d.label.place) },
    fn: typeof r.fn === 'string' && CONTROL.test(r.fn) ? r.fn : d.fn,
    fn2: typeof r.fn2 === 'string' && CONTROL.test(r.fn2) ? r.fn2 : d.fn2,
    feel: { curve: oneOf(f.curve, FEEL_CURVES, d.feel.curve), sensitivity: num(f.sensitivity, 0.1, 4, d.feel.sensitivity), detents: Math.round(num(f.detents, 0, 64, d.feel.detents)), resistance: num(f.resistance, 0, 1, d.feel.resistance) },
    sound: oneOf(r.sound, SOUNDS, d.sound),
    anim: oneOf(r.anim, ANIMS, d.anim),
    hidden: bool(r.hidden, false),
    locked: bool(r.locked, false),
  };
  if (out.name === undefined) delete out.name;
  if (out.shape === undefined) delete out.shape;
  return out;
}

export interface TypeInfo {
  defaults(): Record<string, unknown>;
}

/** Check one component; unknown types (not in `types`) come back null and are skipped. */
export function checkComponent(raw: unknown, types: (t: string) => TypeInfo | undefined, depth = 0): BoardComponent | null {
  const r = obj(raw);
  const cid = id(r.id);
  const type = typeof r.type === 'string' && TYPE.test(r.type) ? r.type : null;
  if (!cid || !type || depth > 16) return null;
  const info = types(type);
  if (!info) return null;
  return {
    id: cid,
    type,
    pos: vec(r.pos, [0, 0, 0], -100, 100),
    rot: vec(r.rot, [0, 0, 0], -50, 50),
    scale: vec(r.scale, [1, 1, 1], 0.01, 100),
    props: checkProps(r.props, info.defaults()),
    children: (Array.isArray(r.children) ? r.children : []).slice(0, 5000).map((c) => checkComponent(c, types, depth + 1)).filter((c): c is BoardComponent => !!c),
  };
}

export function checkBooth(raw: unknown): Booth {
  const r = obj(raw);
  const d = defaultBooth();
  return {
    table: oneOf(r.table, TABLE_SHAPES, d.table),
    width: num(r.width, 0.4, 12, d.width),
    depth: num(r.depth, 0.3, 4, d.depth),
    height: num(r.height, 0.5, 1.4, d.height),
    front: oneOf(r.front, FRONTS, d.front),
    material: oneOf(r.material, MATERIAL_IDS, d.material),
    color: color(r.color, d.color),
    monitors: oneOf(r.monitors, MONITORS, d.monitors),
    cables: oneOf(r.cables, CABLES, d.cables),
    cableColor: color(r.cableColor, d.cableColor),
    riser: num(r.riser, 0, 1.2, d.riser),
    glassFloor: bool(r.glassFloor, d.glassFloor),
    sideScreens: bool(r.sideScreens, d.sideScreens),
  };
}

/** Check a whole board file (any version we know; newer ones load what they can). */
export function checkBoardFile(raw: unknown, types: (t: string) => TypeInfo | undefined): BoardFile | null {
  const r = obj(raw);
  const bid = id(r.id);
  if (!bid) return null;
  if (r.format !== undefined && r.format !== BOARD_FORMAT) return null;
  const ids = new Set<string>();
  const walk = (c: BoardComponent) => {
    ids.add(c.id);
    c.children.forEach(walk);
  };
  const components = (Array.isArray(r.components) ? r.components : []).slice(0, 20_000).map((c) => checkComponent(c, types)).filter((c): c is BoardComponent => !!c);
  components.forEach(walk);
  const w = obj(r.wiring);
  const nodes = (Array.isArray(w.nodes) ? w.nodes : []).slice(0, 2000).flatMap((x): WireNode[] => {
    const n = obj(x);
    const nid = id(n.id);
    const type = typeof n.type === 'string' && /^[a-z]+\.[a-z_]+$/.test(n.type) ? n.type : null;
    if (!nid || !type) return [];
    const params: WireNode['params'] = {};
    for (const [k, v] of Object.entries(obj(n.params)).slice(0, 24)) if (/^\w{1,24}$/.test(k) && (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 80))) params[k] = v as never;
    return [{ id: nid, type, params, x: num(n.x, -1e5, 1e5, 0), y: num(n.y, -1e5, 1e5, 0) }];
  });
  const nodeIds = new Set(nodes.map((n) => n.id));
  const PORT = /^[\w-]{1,64}(:\w{1,16})?$/;
  const cables = (Array.isArray(w.cables) ? w.cables : []).slice(0, 4000).flatMap((x): Cable[] => {
    const c = obj(x);
    return typeof c.from === 'string' && typeof c.to === 'string' && PORT.test(c.from) && PORT.test(c.to) && nodeIds.has(c.from.split(':')[0]) && nodeIds.has(c.to.split(':')[0]) ? [{ from: c.from, to: c.to }] : [];
  });
  const macros = (Array.isArray(r.macros) ? r.macros : []).slice(0, 200).flatMap((x): Macro[] => {
    const m = obj(x);
    const mid = id(m.id);
    if (!mid) return [];
    const steps = (Array.isArray(m.steps) ? m.steps : []).slice(0, 2000).flatMap((s): MacroStep[] => {
      const o = obj(s);
      return typeof o.control === 'string' && CONTROL.test(o.control) && o.control ? [{ at: num(o.at, 0, 600_000, 0), control: o.control, ...(typeof o.value === 'number' && Number.isFinite(o.value) ? { value: num(o.value, 0, 1, 0) } : {}) }] : [];
    });
    return [{ id: mid, name: str(m.name, 40, 'Macro'), steps }];
  });
  const triggers = (Array.isArray(r.triggers) ? r.triggers : []).slice(0, 200).flatMap((x): Trigger[] => {
    const t = obj(x);
    const tid = id(t.id);
    return tid && typeof t.action === 'string' && /^(control|macro|show):[\w.:-]{1,80}$/.test(t.action) ? [{ id: tid, when: oneOf(t.when, TRIGGER_WHEN, 'drop'), above: num(t.above, 0, 1, 1), action: t.action, on: bool(t.on, true) }] : [];
  });
  const midi: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(r.midi)).slice(0, 1000)) if (/^(cc|note|pb):\d{1,2}:\d{1,3}$/.test(k) && typeof v === 'string' && ids.has(v)) midi[k] = v;
  return {
    format: BOARD_FORMAT,
    version: BOARD_VERSION,
    id: bid,
    name: str(r.name, 60, 'My board') || 'My board',
    created: typeof r.created === 'string' && !Number.isNaN(Date.parse(r.created)) ? r.created : new Date(0).toISOString(),
    booth: checkBooth(r.booth),
    components,
    wiring: { nodes, cables },
    macros,
    triggers,
    midi,
  };
}

/* ------------------------------ share codes ------------------------------ */

/** drop settings equal to the defaults and round numbers, so codes stay short */
export function compact(b: BoardFile, types: (t: string) => TypeInfo | undefined): unknown {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const common = commonDefaults() as unknown as Record<string, unknown>;
  const comp = (c: BoardComponent): unknown => {
    const d = { ...common, ...(types(c.type)?.defaults() ?? {}) };
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c.props)) if (JSON.stringify(v) !== JSON.stringify(d[k])) props[k] = v;
    const out: Record<string, unknown> = { id: c.id, type: c.type, pos: c.pos.map(r3) };
    if (c.rot.some((x) => x !== 0)) out.rot = c.rot.map(r3);
    if (c.scale.some((x) => x !== 1)) out.scale = c.scale.map(r3);
    if (Object.keys(props).length) out.props = props;
    if (c.children.length) out.children = c.children.map(comp);
    return out;
  };
  const booth: Record<string, unknown> = {};
  const db = defaultBooth() as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(b.booth)) if (v !== db[k]) booth[k] = v;
  return { format: b.format, version: b.version, id: b.id, name: b.name, created: b.created, booth, components: b.components.map(comp), wiring: b.wiring, macros: b.macros, triggers: b.triggers, midi: b.midi };
}

const toB64url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** a share code: "DH1." + deflated JSON (or "DH0." + plain JSON where the browser can't compress) */
export async function shareCode(b: BoardFile, types: (t: string) => TypeInfo | undefined): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(compact(b, types)));
  if (typeof CompressionStream !== 'undefined') return `DH1.${toB64url(await pipe(json, new CompressionStream('deflate-raw')))}`;
  return `DH0.${toB64url(json)}`;
}

/** Read a share code back into a checked board (null if it isn't one). */
export async function readShareCode(code: string, types: (t: string) => TypeInfo | undefined): Promise<BoardFile | null> {
  const m = /^DH([01])\.([\w-]+)$/.exec(code.trim().replace(/\s+/g, ''));
  if (!m) return null;
  try {
    let bytes: Uint8Array = fromB64url(m[2]);
    if (m[1] === '1') {
      if (typeof DecompressionStream === 'undefined') return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    return checkBoardFile(JSON.parse(new TextDecoder().decode(bytes)), types);
  } catch {
    return null;
  }
}
