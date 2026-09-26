/*
 * Software widgets bound to registry controls: knob, fader, LED button, pad,
 * VU meter. They read state every frame, so hardware (MIDI), keyboard and the
 * 3D board always stay in sync with the on-screen software.
 */
import { ledColor, type ControlRegistry } from '../core/controls';
import { clamp } from '../core/util';
import { drag, h, setClass, setVar } from './dom';

export interface Widget {
  el: HTMLElement;
  update(): void;
}

const ARC = 135;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (Math.abs(a1 - a0) < 0.5) return '';
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function knob(reg: ControlRegistry, id: string, label: string, opts: { size?: number; color?: string } = {}): Widget {
  const size = opts.size ?? 38;
  const c = size / 2;
  const r = c - 3;
  const root = h('div', { class: 'knob', 'data-control': id, tabindex: 0, role: 'slider', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 });
  const s = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  const track = svg('path', { d: arcPath(c, c, r, -ARC, ARC), stroke: '#262f3c', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' });
  const val = svg('path', { d: '', stroke: opts.color ?? 'var(--deck, #4cc9f0)', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' });
  const body = svg('circle', { class: 'body', cx: c, cy: c, r: r - 5, fill: '#1a2029', stroke: '#303a48', 'stroke-width': 1 });
  const ptr = svg('line', { x1: c, y1: c - r + 7, x2: c, y2: c - r * 0.25, stroke: '#e7ecf3', 'stroke-width': 2, 'stroke-linecap': 'round' });
  const g = svg('g', {});
  g.append(ptr);
  s.append(track, val, body, g);
  root.append(s, h('span', { class: 'kl' }, label));
  let last = -1;
  const get = () => reg.value(id);
  const ctl = () => reg.get(id);
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    root.focus();
    const v0 = get();
    drag(e, (_dx, dy, ev) => reg.setValue(id, v0 - dy / (ev.shiftKey ? 900 : 170), 'ui'));
  });
  root.addEventListener('dblclick', () => {
    const cc = ctl();
    if (cc && cc.kind === 'continuous') reg.setValue(id, cc.def, 'ui');
  });
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      reg.nudgeValue(id, (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.005 : 0.025), 'ui');
    },
    { passive: false },
  );
  root.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') reg.nudgeValue(id, step, 'ui');
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') reg.nudgeValue(id, -step, 'ui');
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  return {
    el: root,
    update() {
      const cc = ctl();
      if (!cc || cc.kind !== 'continuous') return;
      const v = cc.get();
      setClass(root, 'flash', reg.flashing(id));
      if (Math.abs(v - last) < 1e-4) return;
      last = v;
      const deg = -ARC + v * ARC * 2;
      g.setAttribute('transform', `rotate(${deg.toFixed(1)} ${c} ${c})`);
      val.setAttribute('d', cc.center ? arcPath(c, c, r, Math.min(0, deg), Math.max(0, deg)) : arcPath(c, c, r, -ARC, deg));
      root.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      root.title = `${cc.label}: ${cc.format ? cc.format(v) : Math.round(v * 100) + '%'}`;
    },
  };
}

export function fader(
  reg: ControlRegistry,
  id: string,
  opts: { orientation: 'v' | 'h'; length: number; invert?: boolean; label?: string; center?: boolean },
): Widget {
  const vert = opts.orientation === 'v';
  const root = h('div', { class: `fader ${opts.orientation}`, 'data-control': id, tabindex: 0, role: 'slider', 'aria-label': opts.label ?? id, style: vert ? { height: `${opts.length}px` } : { width: `${opts.length}px` } });
  const track = h('div', { class: 'track' });
  const cap = h('div', { class: 'cap' });
  root.append(track, cap);
  if (opts.center) {
    const tick = h('div', { style: vert ? { position: 'absolute', left: '8px', right: '8px', top: '50%', height: '1px', background: '#3ddc97' } : { position: 'absolute', top: '8px', bottom: '8px', left: '50%', width: '1px', background: '#3ddc97' } });
    root.insertBefore(tick, cap);
  }
  const pad = 8;
  // value → position fraction along the element (0 = top/left)
  const toFrac = (v: number) => (vert ? (opts.invert ? v : 1 - v) : opts.invert ? 1 - v : v);
  const fromFrac = (f: number) => (vert ? (opts.invert ? f : 1 - f) : opts.invert ? 1 - f : f);
  const span = () => (vert ? root.clientHeight : root.clientWidth) - pad * 2;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    root.focus();
    const rect = root.getBoundingClientRect();
    const onCap = e.target === cap;
    const startV = reg.value(id);
    if (!onCap) {
      const f = vert ? (e.clientY - rect.top - pad) / span() : (e.clientX - rect.left - pad) / span();
      reg.setValue(id, fromFrac(clamp(f, 0, 1)), 'ui');
    }
    const base = onCap ? startV : reg.value(id);
    drag(e, (dx, dy, ev) => {
      const d = (vert ? dy : dx) / span() / (ev.shiftKey ? 5 : 1);
      const f = clamp(toFrac(base) + d, 0, 1);
      reg.setValue(id, fromFrac(f), 'ui');
    });
  });
  root.addEventListener('dblclick', () => {
    const cc = reg.get(id);
    if (cc && cc.kind === 'continuous') reg.setValue(id, cc.def, 'ui');
  });
  root.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const up = e.key === 'ArrowUp' || e.key === 'ArrowRight';
    const down = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
    if (!up && !down) return;
    const dir = (up ? 1 : -1) * (vert && opts.invert ? -1 : 1);
    reg.nudgeValue(id, dir * step, 'ui');
    e.preventDefault();
    e.stopPropagation();
  });
  let last = -1;
  return {
    el: root,
    update() {
      const v = reg.value(id);
      setClass(root, 'flash', reg.flashing(id));
      if (Math.abs(v - last) < 1e-4) return;
      last = v;
      const pos = pad + toFrac(v) * span();
      if (vert) cap.style.top = `${pos}px`;
      else cap.style.left = `${pos}px`;
      const cc = reg.get(id);
      if (cc && cc.kind === 'continuous') root.title = `${cc.label}: ${cc.format ? cc.format(v) : Math.round(v * 100) + '%'}`;
    },
  };
}

export function hwButton(reg: ControlRegistry, id: string, label: string, opts: { cls?: string; color?: string; title?: string } = {}): Widget {
  const b = h('button', { class: `hw ${opts.cls ?? ''}`, 'data-control': id, type: 'button', title: opts.title ?? reg.get(id)?.label ?? label }, label);
  let pointerDown = false;
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pointerDown = true;
    try {
      b.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    b.classList.add('down');
    reg.press(id, 'ui');
  });
  const up = () => {
    if (!pointerDown) return;
    pointerDown = false;
    b.classList.remove('down');
    reg.release(id, 'ui');
  };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
  b.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      reg.press(id, 'ui');
    }
  });
  b.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      reg.release(id, 'ui');
    }
  });
  let lastKey = '';
  return {
    el: b,
    update() {
      const st = ledColor(reg.lit(id), opts.color ?? '#e7ecf3');
      const key = `${st.on}|${st.color}|${st.level > 0.6}`;
      setClass(b, 'flash', reg.flashing(id));
      if (key === lastKey) return;
      lastKey = key;
      setClass(b, 'lit', st.on && st.level > 0.05);
      setClass(b, 'dim', st.on && st.level <= 0.6);
      setVar(b, '--led', st.color);
    },
  };
}

export function padButton(reg: ControlRegistry, id: string, labelFn: () => string): Widget {
  const b = h('button', { class: 'pad', 'data-control': id, type: 'button' });
  let isDown = false;
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDown = true;
    try {
      b.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    b.classList.add('down');
    reg.press(id, 'ui');
  });
  const up = () => {
    if (!isDown) return;
    isDown = false;
    b.classList.remove('down');
    reg.release(id, 'ui');
  };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
  let last = '';
  return {
    el: b,
    update() {
      const st = reg.lit(id);
      let color = '#444';
      let lvl = 0;
      if (st && typeof st === 'object') {
        color = st.color;
        lvl = st.level ?? 1;
      } else if (typeof st === 'string') {
        color = st;
        lvl = 1;
      } else if (st === true) {
        color = '#fff';
        lvl = 1;
      }
      const label = labelFn();
      const key = `${color}|${lvl.toFixed(2)}|${label}`;
      if (key === last) return;
      last = key;
      setVar(b, '--led', color);
      setVar(b, '--lvl', lvl.toFixed(2));
      b.textContent = label;
    },
  };
}

export class VuMeter {
  readonly el: HTMLElement;
  private segs: HTMLElement[][] = [];
  private peaks = [0, 0];
  private holds = [0, 0];
  private holdT = [0, 0];
  constructor(
    private n = 15,
    channels = 2,
  ) {
    this.el = h('div', { class: 'vu' });
    for (let c = 0; c < channels; c++) {
      const col = h('div', { class: 'col' });
      const segs: HTMLElement[] = [];
      for (let i = 0; i < n; i++) {
        const cls = i >= n - 2 ? 'r' : i >= n - 5 ? 'y' : 'g';
        const s = h('div', { class: `seg ${cls}` });
        col.append(s);
        segs.push(s);
      }
      this.segs.push(segs);
      this.el.append(col);
    }
  }

  /** levels are linear peak values */
  set(levels: number[], dt: number): void {
    for (let c = 0; c < this.segs.length; c++) {
      const db = 20 * Math.log10(Math.max(1e-6, levels[c] ?? 0));
      const f = clamp((db + 36) / 39, 0, 1); // -36 dB .. +3 dB
      this.peaks[c] = Math.max(f, this.peaks[c] - dt * 1.6);
      if (f >= this.holds[c]) {
        this.holds[c] = f;
        this.holdT[c] = 1.2;
      } else {
        this.holdT[c] -= dt;
        if (this.holdT[c] <= 0) this.holds[c] = Math.max(f, this.holds[c] - dt * 0.8);
      }
      const lit = Math.round(this.peaks[c] * this.n);
      const hold = Math.min(this.n - 1, Math.round(this.holds[c] * this.n) - 1);
      const segs = this.segs[c];
      for (let i = 0; i < this.n; i++) {
        setClass(segs[i], 'on', i < lit);
        setClass(segs[i], 'peak', i === hold && hold >= lit);
      }
    }
  }
}
