/*
 * Every component the Board Builder offers (Sections 13.5–13.6): its
 * category, its defaults, the settings the inspector shows for it, what it
 * costs to draw (the performance meter), how it unlocks in the career, and
 * how it's built. Add-ons, show controls and decorations live in their own
 * files and are merged in here.
 */
import * as THREE from 'three';
import type { Part, PartCtx } from '../three/parts';
import { PlatterPart, TonearmPart } from '../three/parts';
import type { BoardComponent, CommonProps, TypeInfo } from './format';
import { commonDefaults } from './format';
import { BButton, BFader, BJog, BKnob, BMeter, BPads, BPanel, BScreen, type BoardEnv, type BPart } from './parts';

export type Category = 'structure' | 'decks' | 'mixer' | 'controls' | 'display' | 'fx' | 'addons' | 'show' | 'gear' | 'decor';

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'structure', label: 'Panels & shapes' },
  { id: 'decks', label: 'Decks' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'controls', label: 'Faders, knobs, buttons' },
  { id: 'display', label: 'Screens & meters' },
  { id: 'fx', label: 'FX' },
  { id: 'addons', label: 'Wild add-ons' },
  { id: 'show', label: 'Show controls' },
  { id: 'gear', label: 'Booth gear' },
  { id: 'decor', label: 'Decorations' },
];

export interface OptionSpec {
  key: string;
  label: string;
  kind: 'number' | 'select' | 'bool' | 'text' | 'control' | 'color';
  min?: number;
  /** the largest number, or a text's longest length */
  max?: number;
  step?: number;
  choices?: { id: string | number; label: string }[];
}

export interface Built {
  object: THREE.Object3D;
  parts: Part[];
  /** a per-frame update beyond the parts' own */
  tick?(c: PartCtx): void;
  dispose?(): void;
}

export interface CompDef {
  type: string;
  category: Category;
  label: string;
  blurb: string;
  /** a character for the palette */
  icon: string;
  /** type-specific settings, plus any common ones that differ from the usual */
  defaults(): Record<string, unknown>;
  shapes?: string[];
  options?: OptionSpec[];
  /** roughly, draw calls (the performance meter) */
  cost: number;
  /** career unlock: a fame tier, or a milestone; sandbox opens everything */
  unlock?: { tier?: number; milestone?: string; text: string };
  build(c: BoardComponent, env: BoardEnv): Built;
}

const single = (P: new (c: BoardComponent, e: BoardEnv) => BPart) => (c: BoardComponent, env: BoardEnv): Built => {
  const p = new P(c, env);
  return { object: p.object, parts: [p] };
};

/** a child component made on the fly for a composite (mixer channels, transport buttons) */
function child(parent: BoardComponent, key: string, type: string, x: number, z: number, props: Partial<CommonProps> & Record<string, unknown>): BoardComponent {
  return {
    id: `${parent.id}-${key}`,
    type,
    pos: [x, 0, z],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    props: { ...parent.props, label: { text: '', font: 'label', place: 'none' }, anim: 'none', ...props } as CommonProps,
    children: [],
  };
}

const DECKS = [1, 2, 3, 4].map((n) => ({ id: n, label: `Deck ${n}` }));
const CONTROL: OptionSpec = { key: 'fn', label: 'Controls', kind: 'control' };

/* ------------------------------ composites ------------------------------ */

/** a mixer: 1–4 channels, 2/3/4-band EQ, kill switches, faders, a crossfader */
function buildMixer(c: BoardComponent, env: BoardEnv): Built {
  const p = c.props;
  const n = Math.max(1, Math.min(4, (p.channels as number) || 2));
  const bands = [2, 3, 4].includes(p.bands as number) ? (p.bands as number) : 3;
  const kills = !!p.kills;
  const strip = 0.034;
  const group = new THREE.Group();
  const parts: Part[] = [];
  const W = n * strip + 0.02;
  const D = 0.26 + (bands - 3) * 0.03;
  const body = new BPanel({ ...c, id: `${c.id}-body`, props: { ...p, w: W, d: D, h: 0.03, shape: 'rect', label: { text: '', font: 'label', place: 'none' } } as CommonProps, children: [] }, env);
  group.add(body.object);
  parts.push(body);
  const top = 0.03;
  const eq = bands === 2 ? ['hi', 'low'] : bands === 3 ? ['hi', 'mid', 'low'] : ['hi', 'mid', 'mid', 'low'];
  for (let i = 0; i < n; i++) {
    const ch = i + 1;
    const x = -W / 2 + 0.01 + strip / 2 + i * strip;
    let z = -D / 2 + 0.022;
    const add = (key: string, type: string, zz: number, props: Record<string, unknown>, xx = x) => {
      const comp = child(c, key, type, xx, zz, props as Partial<CommonProps>);
      const b = type === 'knob' ? new BKnob(comp, env) : type === 'fader' ? new BFader(comp, env) : new BButton(comp, env);
      b.object.position.set(xx, top, zz);
      group.add(b.object);
      parts.push(b);
    };
    add(`trim${ch}`, 'knob', z, { fn: `ch.${ch}.trim`, size: 0.008, shape: 'round' });
    z += 0.03;
    eq.forEach((band, k) => {
      add(`eq${ch}${k}`, 'knob', z, { fn: `ch.${ch}.${band}`, size: 0.0085, ring: false });
      if (kills) add(`kill${ch}${k}`, 'button', z, { fn: `board.${c.id}.kill.${ch}.${band}`, w: 0.007, shape: 'round' }, x + strip * 0.36);
      z += 0.028;
    });
    add(`flt${ch}`, 'knob', z, { fn: `ch.${ch}.filter`, size: 0.0095, shape: 'pointer' });
    z += 0.027;
    add(`cue${ch}`, 'button', z, { fn: `ch.${ch}.cue`, w: 0.014, shape: 'rect' });
    add(`fad${ch}`, 'fader', z + 0.012 + 0.035, { fn: `ch.${ch}.fader`, length: 0.06, orient: 'vertical', shape: 'square' });
  }
  if (p.xfader !== false) {
    const comp = child(c, 'xf', 'fader', 0, 0, { fn: 'mixer.xfader', length: Math.min(0.08, W - 0.03), orient: 'horizontal', shape: 'tbar' });
    const xf = new BFader(comp, env);
    xf.object.position.set(0, top, D / 2 - 0.022);
    group.add(xf.object);
    parts.push(xf);
  }
  return { object: group, parts };
}

/** transport for one deck: play, cue, sync and a tempo fader */
function buildTransport(c: BoardComponent, env: BoardEnv): Built {
  const deck = Math.max(1, Math.min(4, (c.props.deck as number) || 1));
  const group = new THREE.Group();
  const parts: Part[] = [];
  const mk = (key: string, comp: BoardComponent, P: new (c: BoardComponent, e: BoardEnv) => BPart) => {
    const b = new P(comp, env);
    b.object.position.set(...comp.pos);
    group.add(b.object);
    parts.push(b);
    void key;
  };
  mk('play', child(c, 'play', 'button', -0.02, 0.02, { fn: `deck.${deck}.play`, shape: 'round', w: 0.022, colors: [c.props.colors[0], '#103a24', '#3ddc97'] }), BButton);
  mk('cue', child(c, 'cue', 'button', -0.02, -0.012, { fn: `deck.${deck}.cue`, shape: 'round', w: 0.022, colors: [c.props.colors[0], '#3a2410', '#ff9f1c'] }), BButton);
  mk('sync', child(c, 'sync', 'button', 0.018, -0.032, { fn: `deck.${deck}.sync`, shape: 'rect', w: 0.016, colors: [c.props.colors[0], '#10303a', '#2ec4f1'] }), BButton);
  mk('tempo', child(c, 'tempo', 'fader', 0.018, 0.02, { fn: `deck.${deck}.tempo`, length: 0.07, orient: 'vertical', shape: 'square' }), BFader);
  return { object: group, parts };
}

/** an FX unit: a button per effect slot (any order, as many as you like), on, depth and parameter */
function buildFx(c: BoardComponent, env: BoardEnv): Built {
  const slots = (Array.isArray(c.props.slots) ? (c.props.slots as string[]) : ['echo', 'reverb', 'flanger', 'roll']).slice(0, 24);
  const group = new THREE.Group();
  const parts: Part[] = [];
  const W = Math.max(0.1, slots.length * 0.022 + 0.06);
  const body = new BPanel({ ...c, id: `${c.id}-body`, props: { ...c.props, w: W, d: 0.07, h: 0.02, shape: 'rect', label: c.props.label } as CommonProps, children: [] }, env);
  group.add(body.object);
  parts.push(body);
  slots.forEach((s, i) => {
    const b = new BButton(child(c, `slot${i}`, 'button', 0, 0, { fn: `board.${c.id}.slot.${s}`, w: 0.016, shape: 'square', label: { text: s, font: 'label', place: 'below' } }), env);
    b.object.position.set(-W / 2 + 0.02 + i * 0.022, 0.02, -0.012);
    group.add(b.object);
    parts.push(b);
  });
  const k = (key: string, fn: string, x: number) => {
    const kn = new BKnob(child(c, key, 'knob', 0, 0, { fn, size: 0.01 }), env);
    kn.object.position.set(x, 0.02, 0.016);
    group.add(kn.object);
    parts.push(kn);
  };
  k('depth', 'fx.depth', -W / 2 + 0.025);
  k('param', 'fx.param', -W / 2 + 0.055);
  const on = new BButton(child(c, 'on', 'button', 0, 0, { fn: 'fx.on', w: 0.02, shape: 'rect', colors: [c.props.colors[0], '#3a1020', '#ff2e88'] }), env);
  on.object.position.set(W / 2 - 0.022, 0.02, 0.016);
  group.add(on.object);
  parts.push(on);
  return { object: group, parts };
}

/** a turntable: the vinyl platter and tonearm parts the presets use, for any deck */
function buildTurntable(c: BoardComponent, env: BoardEnv): Built {
  void env;
  const deck = Math.max(1, Math.min(4, (c.props.deck as number) || 1));
  const group = new THREE.Group();
  const plinth = new BPanel({ ...c, id: `${c.id}-plinth`, props: { ...c.props, w: 0.45, d: 0.35, h: 0.05, shape: 'rect' } as CommonProps, children: [] }, env);
  group.add(plinth.object);
  const platter = new PlatterPart(`deck.${deck}.jog`, `Deck ${deck} platter`, deck, c.props.colors[2]);
  platter.object.position.set(-0.04, 0.05, 0);
  group.add(platter.object);
  const arm = new TonearmPart(`deck.${deck}.needle`, 'Tonearm', new THREE.Vector2(0.15, -0.12), new THREE.Vector2(-0.04, 0), deck);
  arm.object.position.set(0, 0.05, 0);
  group.add(arm.object);
  return { object: group, parts: [plinth, platter, arm] };
}

/* ------------------------------ the standard set ------------------------------ */

const STANDARD: CompDef[] = [
  {
    type: 'panel',
    category: 'structure',
    label: 'Panel',
    blurb: 'A plate to build on: rectangle, disc, hexagon, L-shape, ring, curve or two tiers.',
    icon: '▭',
    shapes: ['rect', 'round', 'hex', 'L', 'ring', 'curve', 'tier'],
    defaults: () => ({ shape: 'rect', w: 0.5, d: 0.3, h: 0.03, colors: ['#1b1d22', '#e8ebf0', '#ff2e88'] }),
    options: [
      { key: 'w', label: 'Width (m)', kind: 'number', min: 0.02, max: 6, step: 0.01 },
      { key: 'd', label: 'Depth (m)', kind: 'number', min: 0.02, max: 3, step: 0.01 },
      { key: 'h', label: 'Thickness (m)', kind: 'number', min: 0.004, max: 0.6, step: 0.002 },
    ],
    cost: 1,
    build: single(BPanel),
  },
  {
    type: 'group',
    category: 'structure',
    label: 'Group',
    blurb: 'Holds other parts so they move together. Groups can hold groups.',
    icon: '⧉',
    defaults: () => ({}),
    cost: 0,
    build: () => ({ object: new THREE.Group(), parts: [] }),
  },
  {
    type: 'jog',
    category: 'decks',
    label: 'Jog wheel',
    blurb: 'Any size, any platter: vinyl, metal, LED ring, glass, liquid or holographic, with art, the waveform or your name in the middle.',
    icon: '◎',
    defaults: () => ({ deck: 1, size: 0.075, platter: 'metal', display: 'art', colors: ['#1b1d22', '#c9ced6', '#2ec4f1'], feel: { ...commonDefaults().feel, sensitivity: 1 } }),
    options: [
      { key: 'deck', label: 'Deck', kind: 'select', choices: DECKS },
      { key: 'size', label: 'Radius (m)', kind: 'number', min: 0.02, max: 0.4, step: 0.005 },
      { key: 'platter', label: 'Platter', kind: 'select', choices: ['vinyl', 'metal', 'led', 'glass', 'liquid', 'holo'].map((x) => ({ id: x, label: x })) },
      { key: 'display', label: 'Centre display', kind: 'select', choices: ['art', 'wave', 'name', 'none'].map((x) => ({ id: x, label: x })) },
    ],
    cost: 6,
    build: single(BJog),
  },
  {
    type: 'transport',
    category: 'decks',
    label: 'Transport',
    blurb: 'Play, cue, sync and a tempo fader for one deck.',
    icon: '⏯',
    defaults: () => ({ deck: 1 }),
    options: [{ key: 'deck', label: 'Deck', kind: 'select', choices: DECKS }],
    cost: 8,
    build: buildTransport,
  },
  {
    type: 'turntable',
    category: 'decks',
    label: 'Turntable',
    blurb: 'A direct-drive turntable with a tonearm, for one deck.',
    icon: '💿',
    defaults: () => ({ deck: 1, colors: ['#9aa0a8', '#1a1b1e', '#ff3b3b'], material: 'brushed' }),
    options: [{ key: 'deck', label: 'Deck', kind: 'select', choices: DECKS }],
    cost: 10,
    unlock: { tier: 2, text: 'Fame tier 2' },
    build: buildTurntable,
  },
  {
    type: 'mixer',
    category: 'mixer',
    label: 'Mixer',
    blurb: '1 to 4 channels, 2, 3 or 4-band EQ, kill switches, channel faders and a crossfader.',
    icon: '🎚',
    defaults: () => ({ channels: 2, bands: 3, kills: false, xfader: true }),
    options: [
      { key: 'channels', label: 'Channels', kind: 'select', choices: [1, 2, 3, 4].map((n) => ({ id: n, label: String(n) })) },
      { key: 'bands', label: 'EQ bands', kind: 'select', choices: [2, 3, 4].map((n) => ({ id: n, label: `${n}-band` })) },
      { key: 'kills', label: 'Kill switches', kind: 'bool' },
      { key: 'xfader', label: 'Crossfader', kind: 'bool' },
    ],
    cost: 30,
    build: buildMixer,
  },
  {
    type: 'fader',
    category: 'controls',
    label: 'Fader',
    blurb: 'Any length, any cap, up and down or side to side.',
    icon: '┃',
    shapes: ['square', 'round', 'tall', 'tbar'],
    defaults: () => ({ fn: 'ch.1.fader', length: 0.045, orient: 'vertical', shape: 'square', colors: ['#1d2025', '#2b2e34', '#ffffff'] }),
    options: [CONTROL, { key: 'length', label: 'Length (m)', kind: 'number', min: 0.02, max: 0.5, step: 0.005 }, { key: 'orient', label: 'Direction', kind: 'select', choices: [{ id: 'vertical', label: 'Up and down' }, { id: 'horizontal', label: 'Side to side' }] }],
    cost: 3,
    build: single(BFader),
  },
  {
    type: 'knob',
    category: 'controls',
    label: 'Knob',
    blurb: 'Any size and cap: round, hex, pointer, chicken-head or flat, with an LED ring if you like.',
    icon: '◉',
    shapes: ['round', 'hex', 'pointer', 'chicken', 'cap'],
    defaults: () => ({ fn: 'ch.1.filter', size: 0.0085, shape: 'round', ring: false, colors: ['#1b1d22', '#2a2d33', '#ffffff'] }),
    options: [CONTROL, { key: 'size', label: 'Radius (m)', kind: 'number', min: 0.004, max: 0.15, step: 0.001 }, { key: 'ring', label: 'LED ring', kind: 'bool' }],
    cost: 3,
    build: single(BKnob),
  },
  {
    type: 'button',
    category: 'controls',
    label: 'Button',
    blurb: 'Any shape, colour, glow, label and function.',
    icon: '⏺',
    shapes: ['square', 'round', 'big', 'pill', 'rect'],
    defaults: () => ({ fn: 'deck.1.play', w: 0.016, shape: 'square', colors: ['#1b1d22', '#2a2d33', '#3ddc97'] }),
    options: [CONTROL, { key: 'w', label: 'Size (m)', kind: 'number', min: 0.004, max: 0.3, step: 0.001 }],
    cost: 2,
    build: single(BButton),
  },
  {
    type: 'pads',
    category: 'controls',
    label: 'Pad grid',
    blurb: 'From 2×2 to 16×16: hot cues, sampler slots or performance pads.',
    icon: '▦',
    defaults: () => ({ rows: 2, cols: 4, size: 0.02, base: 'deck.1.pad.{n}', colors: ['#1b1d22', '#22252b', '#ff2e88'] }),
    options: [
      { key: 'rows', label: 'Rows', kind: 'number', min: 1, max: 16, step: 1 },
      { key: 'cols', label: 'Columns', kind: 'number', min: 1, max: 16, step: 1 },
      { key: 'size', label: 'Pad size (m)', kind: 'number', min: 0.006, max: 0.06, step: 0.001 },
      {
        key: 'base',
        label: 'Pads play',
        kind: 'select',
        choices: [1, 2, 3, 4].flatMap((d) => [
          { id: `deck.${d}.pad.{n}`, label: `Deck ${d} pads` },
          { id: `deck.${d}.hotcue.{n}`, label: `Deck ${d} hot cues` },
        ]).concat([{ id: 'sampler.pad.{n}', label: 'Sampler slots' }]),
      },
    ],
    cost: 8,
    build: single(BPads),
  },
  {
    type: 'screen',
    category: 'display',
    label: 'Screen',
    blurb: 'The waveform, track info, a crowd cam feed, a clock, or your name.',
    icon: '🖥',
    defaults: () => ({ kind: 'wave', deck: 1, w: 0.12, d: 0.07, tilt: -0.5, colors: ['#15171b', '#e8ebf0', '#2ec4f1'] }),
    options: [
      { key: 'kind', label: 'Shows', kind: 'select', choices: [{ id: 'wave', label: 'Waveform' }, { id: 'track', label: 'Track info' }, { id: 'crowd', label: 'Crowd cam' }, { id: 'name', label: 'Your name' }, { id: 'clock', label: 'Clock' }] },
      { key: 'deck', label: 'Deck', kind: 'select', choices: DECKS },
      { key: 'w', label: 'Width (m)', kind: 'number', min: 0.03, max: 1.5, step: 0.005 },
      { key: 'd', label: 'Height (m)', kind: 'number', min: 0.02, max: 1, step: 0.005 },
    ],
    cost: 4,
    build: single(BScreen),
  },
  {
    type: 'meter',
    category: 'display',
    label: 'Meter',
    blurb: 'A needle VU, LED bars, a spectrum analyser or an oscilloscope.',
    icon: '📶',
    defaults: () => ({ kind: 'led', source: 0, length: 0.06, colors: ['#15171b', '#e8ebf0', '#27e07d'] }),
    options: [
      { key: 'kind', label: 'Kind', kind: 'select', choices: [{ id: 'needle', label: 'Needle VU' }, { id: 'led', label: 'LED bars' }, { id: 'spectrum', label: 'Spectrum' }, { id: 'scope', label: 'Oscilloscope' }] },
      { key: 'source', label: 'Listens to', kind: 'select', choices: [{ id: 0, label: 'Master' }, ...[1, 2, 3, 4].map((n) => ({ id: n, label: `Channel ${n}` }))] },
      { key: 'length', label: 'Size (m)', kind: 'number', min: 0.02, max: 0.5, step: 0.005 },
    ],
    cost: 3,
    build: single(BMeter),
  },
  {
    type: 'fx',
    category: 'fx',
    label: 'FX unit',
    blurb: 'Effects in any order, as many slots as you like, with on, depth and a parameter.',
    icon: '✨',
    defaults: () => ({ slots: ['echo', 'reverb', 'flanger', 'roll'] }),
    options: [{ key: 'slots', label: 'Effects (comma separated)', kind: 'text' }],
    cost: 12,
    build: buildFx,
  },
];

/* ------------------------------ the registry ------------------------------ */

const DEFS = new Map<string, CompDef>();

export function registerDefs(list: CompDef[]): void {
  for (const d of list) DEFS.set(d.type, d);
}

registerDefs(STANDARD);

export function defOf(type: string): CompDef | undefined {
  return DEFS.get(type);
}

export function allDefs(): CompDef[] {
  return [...DEFS.values()];
}

/** what the board file checker needs: the type's defaults, or undefined for unknown types */
export const typeInfo = (t: string): TypeInfo | undefined => {
  const d = DEFS.get(t);
  return d ? { defaults: () => ({ ...d.defaults() }) } : undefined;
};

/** Build one component (and its group's children) into an object and its parts. */
export function buildComponent(c: BoardComponent, env: BoardEnv, parts: Part[], ticks: ((c: PartCtx) => void)[]): THREE.Object3D | null {
  const def = DEFS.get(c.type);
  if (!def || c.props.hidden) return null;
  let built: Built;
  try {
    built = def.build(c, env);
  } catch (e) {
    console.warn(`Board part ${c.type} failed to build:`, e);
    return null;
  }
  const o = built.object;
  o.position.set(...c.pos);
  o.rotation.set(...c.rot);
  o.scale.set(...c.scale);
  o.userData.componentId = c.id;
  // the component's own object (its hit meshes carry the id too)
  o.userData.compRoot = true;
  for (const p of built.parts) {
    parts.push(p);
    for (const h of p.hit) h.userData.componentId = c.id;
  }
  if (built.tick) ticks.push(built.tick);
  for (const ch of c.children) {
    const co = buildComponent(ch, env, parts, ticks);
    if (co) o.add(co);
  }
  return o;
}
