/*
 * The Board Builder's panels (Section 13.3–13.4, 13.7, 13.13): the parts
 * palette, the inspector (every property of a part), the layers list, the
 * booth, and the performance meter.
 */
import type { ControlRegistry } from '../../core/controls';
import type { Progress } from '../../core/models';
import { h, clear, setText } from '../../ui/dom';
import { allDefs, CATEGORIES, defOf, type CompDef, type OptionSpec } from '../catalog';
import { ANIMS, CABLES, FEEL_CURVES, FONTS, FRONTS, LABEL_PLACES, MONITORS, SOUNDS, TABLE_SHAPES, type BoardComponent, type Booth, type Vec3 } from '../format';
import { unlocked, type BoardLibrary } from '../library';
import { MATERIALS } from '../materials';
import { measure } from '../perf';
import type { BoardEditor } from './Editor';
import * as ops from './ops';

const DEG = 180 / Math.PI;
const fmt = (x: number, d = 1) => String(Math.round(x * 10 ** d) / 10 ** d);
const opt = (v: string, label: string, sel: boolean) => h('option', { value: v, selected: sel }, label);
const NICE: Record<string, string> = { none: 'None', L: 'L-shape', rect: 'Rectangle', round: 'Round', curved: 'Curved', plain: 'Plain', name: 'Your name', led: 'LED strip', mesh: 'Speaker mesh', wood: 'Wood', mirror: 'Mirror', small: 'Small monitors', large: 'Large monitors', stack: 'A stack', hidden: 'Hidden', colored: 'Coloured', coiled: 'Coiled', linear: 'Linear', log: 'Log (fast start)', exp: 'Exp (slow start)', s: 'S-curve', click: 'Click', soft: 'Soft', mechanical: 'Mechanical', whoosh: 'Whoosh', silent: 'Silent', spin: 'Spin', bob: 'Bob', pulse: 'Pulse', label: 'Label', mono: 'Mono', marker: 'Marker', script: 'Script', above: 'Above', below: 'Below', on: 'On it' };
const nice = (s: string) => NICE[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

/** a component's name in lists */
export function nameOf(c: BoardComponent): string {
  return (c.props.name as string | undefined) || c.props.label.text || defOf(c.type)?.label || c.type;
}

function row(label: string, ...inputs: (HTMLElement | string)[]): HTMLElement {
  return h('label', { class: 'bb-row' }, h('span', { class: 'bb-k' }, label), h('span', { class: 'bb-v' }, ...inputs));
}

function select(values: readonly string[], cur: string, on: (v: string) => void, label?: (v: string) => string): HTMLSelectElement {
  const s = h('select', {}, values.map((v) => opt(v, label ? label(v) : nice(v), v === cur))) as HTMLSelectElement;
  s.addEventListener('change', () => on(s.value));
  return s;
}

function num(v: number, on: (v: number) => void, o: { min?: number; max?: number; step?: number; slider?: boolean; label?: string } = {}): HTMLElement {
  const n = h('input', { type: 'number', value: fmt(v, 3), step: o.step ?? 'any', min: o.min ?? '', max: o.max ?? '', 'aria-label': o.label ?? '' }) as HTMLInputElement;
  n.addEventListener('change', () => {
    const x = parseFloat(n.value);
    if (Number.isFinite(x)) on(o.min !== undefined || o.max !== undefined ? Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, x)) : x);
  });
  if (!o.slider || o.min === undefined || o.max === undefined) return n;
  const r = h('input', { type: 'range', min: o.min, max: o.max, step: o.step ?? (o.max - o.min) / 100, value: v, 'aria-label': o.label ?? '' }) as HTMLInputElement;
  r.addEventListener('input', () => (n.value = r.value));
  r.addEventListener('change', () => on(parseFloat(r.value)));
  n.addEventListener('change', () => (r.value = n.value));
  return h('span', { class: 'bb-slider' }, r, n);
}

function check(v: boolean, on: (v: boolean) => void, label: string): HTMLElement {
  const c = h('input', { type: 'checkbox', checked: v }) as HTMLInputElement;
  c.addEventListener('change', () => on(c.checked));
  return h('label', { class: 'bb-check' }, c, h('span', {}, label));
}

function color(v: string, on: (v: string) => void, label = 'Colour'): HTMLInputElement {
  const c = h('input', { type: 'color', value: v, 'aria-label': label }) as HTMLInputElement;
  c.addEventListener('change', () => on(c.value));
  return c;
}

function text(v: string, on: (v: string) => void, o: { max?: number; placeholder?: string; label?: string } = {}): HTMLInputElement {
  const t = h('input', { type: 'text', value: v, maxlength: o.max ?? 40, placeholder: o.placeholder ?? '', 'aria-label': o.label ?? '' }) as HTMLInputElement;
  t.addEventListener('change', () => on(t.value));
  return t;
}

/** the macros of the board being edited (the control lists offer them) */
let currentMacros: { id: string; name: string }[] = [];
export function setMacros(list: { id: string; name: string }[]): void {
  currentMacros = list;
}

/** every control a part can drive, grouped (its own control first, for the wiring) */
export function controlSelect(reg: ControlRegistry, cur: string, on: (v: string) => void, own = 'Its own (for wiring)', macros: { id: string; name: string }[] = currentMacros): HTMLSelectElement {
  const groups = new Map<string, { id: string; label: string }[]>();
  const groupOf = (id: string) => {
    const m = /^(deck|ch)\.(\d)\./.exec(id);
    if (m) return `${m[1] === 'deck' ? 'Deck' : 'Channel'} ${m[2]}`;
    const p = id.split('.')[0];
    return ({ mixer: 'Mixer', fx: 'FX', sampler: 'Sampler', cam: 'Camera', lights: 'Lights', show: 'Show', master: 'Master' } as Record<string, string>)[p] ?? 'Other';
  };
  for (const c of reg.all()) {
    if (c.id.startsWith('board.')) continue;
    const g = groupOf(c.id);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push({ id: c.id, label: c.label });
  }
  const s = h('select', {}, opt('', own, !cur)) as HTMLSelectElement;
  if (macros.length) s.append(h('optgroup', { label: 'Macros on this board' }, macros.map((m) => opt(`board.macro.${m.id}`, `Macro: ${m.name}`, `board.macro.${m.id}` === cur))));
  for (const [g, list] of groups) s.append(h('optgroup', { label: g }, list.map((c) => opt(c.id, c.label, c.id === cur))));
  if (cur && ![...s.options].some((o) => o.value === cur)) s.append(opt(cur, cur, true));
  s.addEventListener('change', () => on(s.value));
  return s;
}

/* ------------------------------------------------------------------ */
/* palette                                                              */
/* ------------------------------------------------------------------ */

export interface PaletteHooks {
  ed: BoardEditor;
  library: BoardLibrary;
  progress(): Progress;
  note(text: string): void;
}

/** what most boards are made of: shown first, open */
const ESSENTIALS = ['media_player', 'club_mixer', 'dd_turntable', 'rotary_mixer', 'jog', 'mixer', 'fader', 'knob', 'button', 'pads', 'screen', 'panel'];

export function palettePanel(o: PaletteHooks): { el: HTMLElement; refresh(): void } {
  const search = h('input', { type: 'search', placeholder: 'Search parts…', 'aria-label': 'Search parts', class: 'bb-search' }) as HTMLInputElement;
  const list = h('div', { class: 'bb-palette-list' });
  const el = h('div', { class: 'bb-palette' }, search, list);
  const card = (d: CompDef) => {
    const open = unlocked(d, o.progress());
    const fav = o.library.data.favParts.includes(d.type);
    const star = h('button', { class: `bb-star${fav ? ' on' : ''}`, type: 'button', title: fav ? 'Take out of favourites' : 'Add to favourites', 'aria-label': `${fav ? 'Unstar' : 'Star'} ${d.label}`, 'aria-pressed': String(fav) }, fav ? '★' : '☆');
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      o.library.toggleFavPart(d.type);
      refresh();
    });
    const b = h(
      'button',
      { class: `bb-part${open ? '' : ' locked'}`, type: 'button', draggable: open ? 'true' : 'false', title: open ? d.blurb : `Unlocks at ${d.unlock?.text ?? 'a later point'}`, 'aria-label': `Add ${d.label}${open ? '' : ' (locked)'}` },
      h('span', { class: 'bb-ic', 'aria-hidden': 'true' }, open ? d.icon : '🔒'),
      h('span', { class: 'bb-nm' }, d.label),
      open ? star : null,
    );
    b.addEventListener('click', () => {
      if (!open) return o.note(`${d.label} unlocks at ${d.unlock?.text?.toLowerCase() ?? 'a later point in your career'}.`);
      o.ed.add(d.type);
    });
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('application/x-deckhouse-part', d.type);
      e.dataTransfer?.setData('text/plain', d.type);
    });
    return b;
  };
  const refresh = () => {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const defs = allDefs().filter((d) => d.type !== 'group');
    const p = o.progress();
    if (q) {
      // searching: everything that matches, the ones you can use first
      const hits = defs.filter((d) => d.label.toLowerCase().includes(q) || d.blurb.toLowerCase().includes(q) || d.type.includes(q)).sort((a, b) => Number(unlocked(b, p)) - Number(unlocked(a, p)));
      list.append(hits.length ? h('div', { class: 'bb-grid' }, hits.map(card)) : h('p', { class: 'bb-empty' }, 'Nothing by that name.'));
      return;
    }
    const open = defs.filter((d) => unlocked(d, p));
    const favs = open.filter((d) => o.library.data.favParts.includes(d.type));
    if (favs.length) list.append(h('section', { class: 'bb-cat' }, h('h4', {}, '★ Favourites'), h('div', { class: 'bb-grid' }, favs.map(card))));
    const ess = ESSENTIALS.map((t) => open.find((d) => d.type === t)).filter((d): d is CompDef => !!d);
    list.append(h('section', { class: 'bb-cat' }, h('h4', {}, 'Essentials'), h('div', { class: 'bb-grid' }, ess.map(card))));
    for (const cat of CATEGORIES) {
      const ds = open.filter((d) => d.category === cat.id && !ESSENTIALS.includes(d.type));
      if (!ds.length) continue;
      list.append(h('details', { class: 'bb-cat' }, h('summary', {}, cat.label, h('span', { class: 'bb-n' }, String(ds.length))), h('div', { class: 'bb-grid' }, ds.map(card))));
    }
    const locked = defs.filter((d) => !unlocked(d, p));
    if (locked.length)
      list.append(
        h(
          'details',
          { class: 'bb-cat bb-locked' },
          h('summary', {}, `🔒 ${locked.length} more unlock as your career grows`),
          h('ul', { class: 'bb-unlock-list' }, locked.map((d) => h('li', {}, h('span', {}, d.label), h('small', {}, d.unlock?.text ?? '')))),
        ),
      );
  };
  search.addEventListener('input', refresh);
  refresh();
  return { el, refresh };
}

/* ------------------------------------------------------------------ */
/* inspector                                                            */
/* ------------------------------------------------------------------ */

/** a picture of each material for its button */
const SWATCH: Record<string, string> = {
  matte: '#3a3d44',
  gloss: 'linear-gradient(135deg,#6b7180,#22252c 55%,#9aa0b0)',
  chrome: 'linear-gradient(135deg,#f4f6f8,#8d939b 45%,#e8ebee 55%,#6f747b)',
  gold: 'linear-gradient(135deg,#f6dd8a,#b8862e 50%,#f2d57a)',
  brushed: 'repeating-linear-gradient(90deg,#9aa0a8 0 2px,#b6bcc4 2px 4px)',
  oak: 'repeating-linear-gradient(100deg,#c29a62 0 4px,#b08650 4px 7px)',
  walnut: 'repeating-linear-gradient(100deg,#6a4a33 0 4px,#5a3d2a 4px 7px)',
  maple: 'repeating-linear-gradient(100deg,#e6cda2 0 4px,#d9bd8e 4px 7px)',
  ebony: '#1f1a17',
  marble: 'linear-gradient(135deg,#f2f2ef,#d0d0ca 40%,#f7f7f5 60%,#c4c4bf)',
  carbon: 'repeating-linear-gradient(45deg,#1a1b1e 0 3px,#2e3035 3px 6px)',
  acrylic: 'linear-gradient(135deg,rgba(200,230,255,0.6),rgba(255,255,255,0.12))',
  frosted: 'linear-gradient(135deg,#dfe7ef,#aeb9c4)',
  liquid: 'radial-gradient(circle at 30% 30%,#ffffff,#9aa3ad 40%,#3c4249)',
  holo: 'linear-gradient(135deg,#ff7ad9,#7af3ff,#c8ff7a,#ffd27a)',
  lava: 'radial-gradient(circle at 40% 60%,#ffd23f,#ff5a1f 45%,#5a0d05)',
  ice: 'linear-gradient(135deg,#e8fbff,#8fd8f0)',
  galaxy: 'radial-gradient(circle at 30% 30%,#c9b6ff,#3b1d7a 50%,#0a0518)',
  rubber: '#262626',
  leather: 'linear-gradient(135deg,#6b4532,#4a2e20)',
  image: 'repeating-conic-gradient(#888 0 25%,#ccc 0 50%) 0 0/8px 8px',
};
const PRESET_COLOURS = ['#1b1d22', '#e8ebf0', '#ff2e88', '#3ad7ff', '#ffb547', '#b6ff3b', '#c77dff', '#ff3b3b'];

function materialChips(cur: string, on: (id: string) => void): HTMLElement {
  return h(
    'div',
    { class: 'bb-chips', role: 'radiogroup', 'aria-label': 'Material' },
    MATERIALS.map((m) => {
      const b = h('button', { class: `bb-mat${m.id === cur ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(m.id === cur), title: m.label, 'aria-label': m.label, style: { background: SWATCH[m.id] ?? '#444' } });
      b.addEventListener('click', () => on(m.id));
      return b;
    }),
  );
}

function colourChips(cur: string, on: (c: string) => void, label: string): HTMLElement {
  const custom = color(cur, on, `${label}: any colour`);
  return h(
    'div',
    { class: 'bb-chips', role: 'radiogroup', 'aria-label': label },
    PRESET_COLOURS.map((c) => {
      const b = h('button', { class: `bb-col${c === cur.toLowerCase() ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(c === cur.toLowerCase()), 'aria-label': c, style: { background: c } });
      b.addEventListener('click', () => on(c));
      return b;
    }),
    custom,
  );
}

function field(label: string, ...inputs: (HTMLElement | null)[]): HTMLElement {
  return h('div', { class: 'bb-field' }, h('span', { class: 'bb-flabel' }, label), ...inputs);
}

export function inspectorPanel(ed: BoardEditor, reg: ControlRegistry): { el: HTMLElement; refresh(): void; live(): void } {
  const el = h('div', { class: 'bb-inspector' });
  let transform: { pos: HTMLInputElement[]; rot: HTMLInputElement[]; scale: HTMLInputElement[] } | null = null;
  /** "More settings" stays open once you've opened it */
  let moreOpen = false;

  const set = (path: string, v: unknown) => ed.setProp(path, v);

  const transformBlock = (c: BoardComponent) => {
    const mk = (vals: number[], k: number, on: (v: Vec3) => void, label: string) =>
      vals.map((v, i) => {
        const n = h('input', { type: 'number', step: 'any', value: fmt(v * k, 1), 'aria-label': `${label} ${'XYZ'[i]}` }) as HTMLInputElement;
        n.addEventListener('change', () => {
          const x = parseFloat(n.value);
          if (!Number.isFinite(x)) return;
          const f = ops.find(ed.doc, c.id);
          if (!f) return;
          const cur = (label === 'Position' ? f.c.pos : label === 'Turn' ? f.c.rot : f.c.scale).slice() as Vec3;
          cur[i] = x / k;
          on(cur);
        });
        return n;
      });
    const pos = mk(c.pos, 1000, (v) => ed.setTransform(c.id, { pos: v }), 'Position');
    const rot = mk(c.rot, DEG, (v) => ed.setTransform(c.id, { rot: v }), 'Turn');
    const scale = mk(c.scale, 1, (v) => ed.setTransform(c.id, { scale: v }), 'Size');
    transform = { pos, rot, scale };
    return h('fieldset', { class: 'bb-fs' }, h('legend', {}, 'Exact place'), row('Across, up, back (mm)', ...pos), row('Tilt, turn, roll (°)', ...rot), row('Stretch (×)', ...scale));
  };

  const option = (c: BoardComponent, s: OptionSpec) => {
    const v = c.props[s.key];
    switch (s.kind) {
      case 'number':
        return field(s.label, num(Number(v ?? 0), (x) => set(s.key, x), { min: s.min, max: s.max, step: s.step, slider: true, label: s.label }));
      case 'select': {
        const ch = s.choices ?? [];
        const sel = h('select', { 'aria-label': s.label }, ch.map((x) => opt(String(x.id), x.label.charAt(0).toUpperCase() + x.label.slice(1), String(x.id) === String(v)))) as HTMLSelectElement;
        sel.addEventListener('change', () => {
          const pick = ch.find((x) => String(x.id) === sel.value);
          if (pick) set(s.key, pick.id);
        });
        return field(s.label, sel);
      }
      case 'bool':
        return check(!!v, (x) => set(s.key, x), s.label);
      case 'color':
        return field(s.label, color(String(v ?? '#ffffff'), (x) => set(s.key, x), s.label));
      case 'control':
        return field(s.label, controlSelect(reg, String(v ?? ''), (x) => set(s.key, x)));
      default:
        // a list (an FX unit's effects) is edited as comma-separated text and kept as a list
        if (Array.isArray(v)) return field(s.label, text(v.join(', '), (x) => set(s.key, x.split(',').map((t) => t.trim()).filter(Boolean)), { max: 200, label: s.label }));
        return field(s.label, text(String(v ?? ''), (x) => set(s.key, x), { max: s.max ?? 80, label: s.label }));
    }
  };

  const sizeAndTurn = (ids: string[], scale: number) => {
    const size = num(scale, (k) => ed.setSize(k, ids), { min: 0.5, max: 3, step: 0.05, slider: true, label: 'Size' });
    return h(
      'div',
      { class: 'bb-twocol' },
      field('Size', size),
      field('Turn', h('div', { class: 'bb-flags' }, h('button', { class: 'btn', type: 'button', title: 'Turn left 15° ([)', onclick: () => ed.turn(-15) }, '↺ 15°'), h('button', { class: 'btn', type: 'button', title: 'Turn right 15° (])', onclick: () => ed.turn(15) }, '↻ 15°'))),
    );
  };

  const one = (c: BoardComponent): (HTMLElement | null)[] => {
    const def = defOf(c.type);
    if (!def) return [h('p', {}, 'Unknown part.')];
    const p = c.props;
    const opts = def.options ?? [];
    const fnSpec = opts.find((s) => s.key === 'fn');
    const fn2Spec = opts.find((s) => s.key === 'fn2');
    const isGroup = c.children.length > 0;
    const name = h('input', { class: 'bb-title', type: 'text', value: String(p.name ?? ''), placeholder: def.label, maxlength: 40, 'aria-label': 'Name' }) as HTMLInputElement;
    name.addEventListener('change', () => set('name', name.value.trim() || undefined));
    const image = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Choose a picture' }) as HTMLInputElement;
    image.addEventListener('change', async () => {
      const f = image.files?.[0];
      if (f) set('image', await shrinkImage(f));
    });
    // the few things most people change, then everything else folded away
    const more = h(
      'details',
      { class: 'bb-more', open: moreOpen },
      h('summary', {}, 'More settings'),
      ed.precise ? transformBlock(c) : null,
      fn2Spec ? field(fn2Spec.label, controlSelect(reg, p.fn2, (v) => set('fn2', v), 'Nothing')) : null,
      field('Second colour', colourChips(p.colors[1], (v) => set('colors', [p.colors[0], v, p.colors[2]]), 'Second colour')),
      field('Glow', h('div', { class: 'bb-flags' }, color(p.glow.color, (v) => set('glow.color', v), 'Glow colour'), num(p.glow.intensity, (v) => set('glow.intensity', v), { min: 0, max: 1, step: 0.05, slider: true, label: 'Glow strength' }))),
      check(p.glow.beat, (v) => set('glow.beat', v), 'Glow pulses on the beat'),
      field('Label', text(p.label.text, (v) => set('label.text', v), { placeholder: 'Text printed by it', label: 'Label text' })),
      p.label.text ? h('div', { class: 'bb-flags' }, select(FONTS, p.label.font, (v) => set('label.font', v)), select(LABEL_PLACES, p.label.place, (v) => set('label.place', v), (v) => (v === 'none' ? 'Hidden' : nice(v)))) : null,
      def.shapes?.length ? field('Shape', select(def.shapes, String(p.shape ?? def.shapes[0]), (v) => set('shape', v))) : null,
      fnSpec
        ? h(
            'div',
            { class: 'bb-group' },
            field('Feel', select(FEEL_CURVES, p.feel.curve, (v) => set('feel.curve', v))),
            field('Sensitivity', num(p.feel.sensitivity, (v) => set('feel.sensitivity', v), { min: 0.1, max: 4, step: 0.05, slider: true, label: 'Sensitivity' })),
            field('Notches', num(p.feel.detents, (v) => set('feel.detents', Math.round(v)), { min: 0, max: 64, step: 1, label: 'Notches' })),
            field('Stiffness', num(p.feel.resistance, (v) => set('feel.resistance', v), { min: 0, max: 1, step: 0.05, slider: true, label: 'Stiffness' })),
            field('Sound when touched', select(SOUNDS, p.sound, (v) => set('sound', v))),
          )
        : null,
      field('Animation', select(ANIMS, p.anim, (v) => set('anim', v))),
      h('div', { class: 'bb-flags' }, check(p.hidden, (v) => ed.hide([c.id], v), 'Hidden'), check(p.locked, (v) => ed.lock([c.id], v), 'Locked (can’t be clicked on the bench)')),
      def.category !== 'decor' ? h('button', { class: 'btn ghost', type: 'button', onclick: () => ed.selectType(c.type) }, `Select every ${def.label.toLowerCase()}`) : null,
    );
    more.addEventListener('toggle', () => (moreOpen = more.open));
    return [
      h('div', { class: 'bb-head' }, h('span', { class: 'bb-ic', 'aria-hidden': 'true' }, def.icon), h('div', {}, name, h('small', {}, `${def.label}${isGroup ? ` · ${c.children.length} parts inside` : ''}`))),
      isGroup ? h('button', { class: 'btn', type: 'button', onclick: () => ed.enter(c.id) }, 'Edit the parts inside') : null,
      fnSpec ? field('What it does', controlSelect(reg, p.fn, (v) => set('fn', v), 'Nothing yet (use it in Logic)')) : null,
      ...opts.filter((s) => s.key !== 'fn' && s.key !== 'fn2').map((s) => option(c, s)),
      field('Material', materialChips(p.material, (v) => set('material', v))),
      p.material === 'image' ? field('Picture', image) : null,
      field('Colour', colourChips(p.colors[0], (v) => set('colors', [v, p.colors[1], p.colors[2]]), 'Colour')),
      field('Light colour', colourChips(p.colors[2], (v) => set('colors', [p.colors[0], p.colors[1], v]), 'Light colour')),
      sizeAndTurn([c.id], c.scale[0]),
      more,
    ];
  };

  const many = (cs: BoardComponent[]): (HTMLElement | null)[] => {
    const first = cs[0].props;
    const ids = cs.map((c) => c.id);
    const types = [...new Set(cs.map((c) => c.type))];
    return [
      h('div', { class: 'bb-head' }, h('div', {}, h('b', {}, `${cs.length} parts selected`), h('small', {}, types.length === 1 ? (defOf(types[0])?.label ?? '') : `${types.length} kinds of part`))),
      h('p', { class: 'bb-hint' }, 'Changes here apply to all of them.'),
      field('Material', materialChips(first.material, (v) => ed.setProp('material', v, ids))),
      field('Colour', colourChips(first.colors[0], (v) => cs.forEach((c) => ed.setProp('colors', [v, c.props.colors[1], c.props.colors[2]], [c.id])), 'Colour')),
      field('Light colour', colourChips(first.colors[2], (v) => cs.forEach((c) => ed.setProp('colors', [c.props.colors[0], c.props.colors[1], v], [c.id])), 'Light colour')),
      sizeAndTurn(ids, cs[0].scale[0]),
    ];
  };

  const none = (): (HTMLElement | null)[] => {
    const r = measure(ed.doc);
    return [
      h('div', { class: 'bb-head' }, h('div', {}, h('b', {}, ed.doc.name), h('small', {}, `${ed.partCount()} parts · ${r.level === 'light' ? 'runs smoothly' : r.level === 'busy' ? 'getting busy' : 'heavy'}`))),
      h(
        'ol',
        { class: 'bb-steps' },
        h('li', {}, h('b', {}, 'Add parts'), ' from the list on the left: click one, or drag it onto the bench.'),
        h('li', {}, h('b', {}, 'Click a part'), ' to change what it does, its material and colour. Drag it to move it.'),
        h('li', {}, h('b', {}, 'Press ▶ Try it'), ' to play your board for real.'),
      ),
      ed.context ? h('button', { class: 'btn', type: 'button', onclick: () => ed.exit() }, '← Back out of this group') : null,
    ];
  };

  const refresh = () => {
    transform = null;
    clear(el);
    const cs = ed.selection.map((id) => ops.find(ed.doc, id)?.c).filter((c): c is BoardComponent => !!c);
    el.append(...(cs.length === 0 ? none() : cs.length === 1 ? one(cs[0]) : many(cs)).filter((x): x is HTMLElement => !!x));
  };

  /** while a part is being dragged: the numbers follow without rebuilding the panel */
  const live = () => {
    const t = transform;
    const id = ed.primary;
    if (!t || !id) return;
    const f = ops.find(ed.doc, id);
    if (!f) return;
    t.pos.forEach((n, i) => document.activeElement !== n && (n.value = fmt(f.c.pos[i] * 1000, 1)));
  };
  refresh();
  return { el, refresh, live };
}

/** a picture for the image material, cut down to fit a board (and a share code) */
async function shrinkImage(f: File, max = 256): Promise<string> {
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.82);
}

/* ------------------------------------------------------------------ */
/* layers                                                               */
/* ------------------------------------------------------------------ */

export function layersPanel(ed: BoardEditor): { el: HTMLElement; refresh(): void } {
  const el = h('div', { class: 'bb-layers', role: 'tree', 'aria-label': 'Parts on the board' });
  let dragId: string | null = null;
  const refresh = () => {
    clear(el);
    const rows = ed.flat();
    if (!rows.length) {
      el.append(h('p', { class: 'bb-empty' }, 'No parts yet. Add some from the palette.'));
      return;
    }
    for (const { c, depth } of rows) {
      const def = defOf(c.type);
      const sel = ed.selection.includes(c.id);
      const eye = h('button', { class: `bb-eye${c.props.hidden ? ' off' : ''}`, type: 'button', title: c.props.hidden ? 'Show' : 'Hide', 'aria-label': `${c.props.hidden ? 'Show' : 'Hide'} ${nameOf(c)}`, 'aria-pressed': String(!c.props.hidden) }, c.props.hidden ? '◌' : '◉');
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        ed.hide([c.id], !c.props.hidden);
      });
      const lock = h('button', { class: `bb-lock${c.props.locked ? ' on' : ''}`, type: 'button', title: c.props.locked ? 'Unlock' : 'Lock (can’t be clicked on the bench)', 'aria-label': `${c.props.locked ? 'Unlock' : 'Lock'} ${nameOf(c)}`, 'aria-pressed': String(c.props.locked) }, c.props.locked ? '🔒' : '🔓');
      lock.addEventListener('click', (e) => {
        e.stopPropagation();
        ed.lock([c.id], !c.props.locked);
      });
      const upB = h('button', { class: 'bb-mv', type: 'button', title: 'Up the list', 'aria-label': `Move ${nameOf(c)} up` }, '▲');
      upB.addEventListener('click', (e) => {
        e.stopPropagation();
        ed.reorder(c.id, -1);
      });
      const dnB = h('button', { class: 'bb-mv', type: 'button', title: 'Down the list', 'aria-label': `Move ${nameOf(c)} down` }, '▼');
      dnB.addEventListener('click', (e) => {
        e.stopPropagation();
        ed.reorder(c.id, 1);
      });
      const r = h(
        'div',
        { class: `bb-layer${sel ? ' sel' : ''}${c.props.hidden ? ' hidden' : ''}`, role: 'treeitem', 'aria-selected': String(sel), tabindex: 0, draggable: 'true', style: { paddingLeft: `${6 + depth * 14}px` } },
        h('span', { class: 'bb-ic', 'aria-hidden': 'true' }, c.children.length ? '▤' : def?.icon ?? '?'),
        h('span', { class: 'bb-nm' }, nameOf(c)),
        upB,
        dnB,
        eye,
        lock,
      );
      r.addEventListener('click', (e) => (e.shiftKey || e.ctrlKey || e.metaKey ? ed.toggle(c.id) : ed.select([c.id])));
      r.addEventListener('dblclick', () => (c.children.length ? ed.enter(c.id) : ed.frame('selection')));
      r.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          ed.select([c.id]);
        }
      });
      r.addEventListener('dragstart', (e) => {
        dragId = c.id;
        e.dataTransfer?.setData('text/plain', c.id);
      });
      r.addEventListener('dragover', (e) => {
        if (!dragId || dragId === c.id) return;
        e.preventDefault();
        const into = c.children.length > 0 && e.offsetX > r.clientWidth * 0.6;
        r.classList.toggle('drop-into', into);
        r.classList.toggle('drop-before', !into);
      });
      r.addEventListener('dragleave', () => r.classList.remove('drop-into', 'drop-before'));
      r.addEventListener('drop', (e) => {
        e.preventDefault();
        const into = r.classList.contains('drop-into');
        r.classList.remove('drop-into', 'drop-before');
        if (dragId && dragId !== c.id) ed.moveTo(dragId, into ? { parent: c.id } : { before: c.id });
        dragId = null;
      });
      el.append(r);
    }
  };
  refresh();
  return { el, refresh };
}

/* ------------------------------------------------------------------ */
/* the booth (Section 13.7)                                             */
/* ------------------------------------------------------------------ */

export function boothPanel(ed: BoardEditor, preview: (on: boolean) => void): { el: HTMLElement; refresh(): void } {
  const el = h('div', { class: 'bb-booth' });
  const set = (patch: Partial<Booth>) => ed.setBooth(patch);
  const refresh = () => {
    const b = ed.doc.booth;
    clear(el);
    el.append(
      check(ed.boothPreview, (v) => preview(v), 'Show the booth (instead of the workbench)'),
      row('Table', select(TABLE_SHAPES, b.table, (v) => set({ table: v as Booth['table'] }), (v) => (v === 'none' ? 'No table (on the venue’s)' : nice(v)))),
      row('Width (m)', num(b.width, (v) => set({ width: v }), { min: 0.4, max: 6, step: 0.05, slider: true, label: 'Width' })),
      row('Depth (m)', num(b.depth, (v) => set({ depth: v }), { min: 0.3, max: 2, step: 0.05, slider: true, label: 'Depth' })),
      row('Height (m)', num(b.height, (v) => set({ height: v }), { min: 0.6, max: 1.3, step: 0.01, slider: true, label: 'Height' })),
      row('Front', select(FRONTS, b.front, (v) => set({ front: v as Booth['front'] }))),
      row('Material', select(MATERIALS.map((m) => m.id).filter((m) => m !== 'image'), b.material, (v) => set({ material: v as Booth['material'] }), (v) => MATERIALS.find((m) => m.id === v)?.label ?? v), color(b.color, (v) => set({ color: v }), 'Booth colour')),
      row('Monitors', select(MONITORS, b.monitors, (v) => set({ monitors: v as Booth['monitors'] }))),
      row('Cables', select(CABLES, b.cables, (v) => set({ cables: v as Booth['cables'] })), color(b.cableColor, (v) => set({ cableColor: v }), 'Cable colour')),
      row('Riser (m)', num(b.riser, (v) => set({ riser: v }), { min: 0, max: 1.2, step: 0.05, slider: true, label: 'Riser height' })),
      check(b.glassFloor, (v) => set({ glassFloor: v }), 'LED floor tiles'),
      check(b.sideScreens, (v) => set({ sideScreens: v }), 'Screens either side'),
    );
  };
  refresh();
  return { el, refresh };
}

/* ------------------------------------------------------------------ */
/* the performance meter (Section 13.13)                                */
/* ------------------------------------------------------------------ */

export function perfMeter(ed: BoardEditor): { el: HTMLElement; refresh(): void } {
  const bar = h('div', { class: 'bb-perf-fill' });
  const label = h('span', { class: 'bb-perf-label' });
  const warn = h('ul', { class: 'bb-perf-warn' });
  const el = h('div', { class: 'bb-perf', role: 'status', 'aria-live': 'polite' }, h('div', { class: 'bb-perf-bar' }, bar), label, warn);
  const refresh = () => {
    const r = measure(ed.doc);
    bar.style.width = `${Math.min(100, r.load * 100)}%`;
    el.dataset.level = r.level;
    setText(label, `${r.level === 'light' ? 'Light' : r.level === 'busy' ? 'Busy' : 'Heavy'} · ${r.parts} part${r.parts === 1 ? '' : 's'}`);
    clear(warn);
    for (const w of r.warnings) warn.append(h('li', {}, w));
  };
  refresh();
  return { el, refresh };
}
