/*
 * Wiring and logic (Section 13.9).
 *   Simple mode: each control's function (its `fn`) picked from a list.
 *   Node editor: cables from inputs (a part, any control, the beat clock, the
 *   vibe meter, the kick, drops) through modifiers (scale, invert, curve,
 *   delay, randomiser, beat-sync, smoothing, threshold) to outputs (any
 *   control, the lights, the crowd, the camera, the show, the hype). One
 *   input can feed many outputs.
 *   Macros: a recorded run of moves, played back from one button.
 *   Triggers: "when the vibe hits 100 %, fire the confetti", "on every drop,
 *   flash my name".
 *
 * Every part without a function of its own gets a control `board.<id>` the
 * wiring (and MIDI learn) can use.
 */
import type { ControlRegistry, ControlSource } from '../core/controls';
import type { BoardComponent, BoardFile, Macro, MacroStep, WireNode } from './format';
import { applyCurve } from './feel';
import type { BoardHooks, ShowCue } from './hooks';

export interface NodeType {
  type: string;
  kind: 'input' | 'modifier' | 'output';
  label: string;
  params: { key: string; label: string; kind: 'number' | 'text' | 'select' | 'control' | 'component'; choices?: string[]; def: string | number }[];
}

const SHOW_CUES: ShowCue[] = ['strobe', 'blinder', 'blackout', 'lasers', 'laserColor', 'laserPattern', 'laserName', 'co2', 'pyro', 'confetti', 'streamers', 'sparklers', 'fog', 'flashName', 'nextVisual', 'hazeUp'];

export const NODE_TYPES: NodeType[] = [
  { type: 'in.component', kind: 'input', label: 'A part on the board', params: [{ key: 'component', label: 'Part', kind: 'component', def: '' }] },
  { type: 'in.control', kind: 'input', label: 'Any control', params: [{ key: 'control', label: 'Control', kind: 'control', def: 'ch.1.fader' }] },
  { type: 'in.clock', kind: 'input', label: 'Beat clock', params: [{ key: 'rate', label: 'Ramps every', kind: 'select', choices: ['beat', 'bar', 'phrase'], def: 'bar' }] },
  { type: 'in.vibe', kind: 'input', label: 'Vibe meter', params: [] },
  { type: 'in.kick', kind: 'input', label: 'Kick', params: [] },
  { type: 'in.drop', kind: 'input', label: 'Drop', params: [] },
  { type: 'mod.scale', kind: 'modifier', label: 'Scale', params: [{ key: 'min', label: 'From', kind: 'number', def: 0 }, { key: 'max', label: 'To', kind: 'number', def: 1 }] },
  { type: 'mod.invert', kind: 'modifier', label: 'Invert', params: [] },
  { type: 'mod.curve', kind: 'modifier', label: 'Curve', params: [{ key: 'curve', label: 'Curve', kind: 'select', choices: ['linear', 'log', 'exp', 's'], def: 's' }] },
  { type: 'mod.delay', kind: 'modifier', label: 'Delay', params: [{ key: 'ms', label: 'Milliseconds', kind: 'number', def: 250 }] },
  { type: 'mod.random', kind: 'modifier', label: 'Randomiser', params: [{ key: 'amount', label: 'Amount', kind: 'number', def: 0.2 }] },
  { type: 'mod.sync', kind: 'modifier', label: 'Beat-sync', params: [{ key: 'every', label: 'Every', kind: 'select', choices: ['1/4', '1/2', '1', 'bar'], def: '1' }] },
  { type: 'mod.smooth', kind: 'modifier', label: 'Smoothing', params: [{ key: 'time', label: 'Seconds', kind: 'number', def: 0.3 }] },
  { type: 'mod.threshold', kind: 'modifier', label: 'Threshold', params: [{ key: 'level', label: 'Above', kind: 'number', def: 0.5 }] },
  { type: 'out.control', kind: 'output', label: 'A control', params: [{ key: 'control', label: 'Control', kind: 'control', def: 'ch.1.filter' }] },
  { type: 'out.light', kind: 'output', label: 'Lights', params: [{ key: 'cue', label: 'Light', kind: 'select', choices: ['strobe', 'blinder', 'blackout', 'lasers'], def: 'strobe' }] },
  { type: 'out.show', kind: 'output', label: 'Show cue', params: [{ key: 'cue', label: 'Cue', kind: 'select', choices: SHOW_CUES, def: 'confetti' }] },
  { type: 'out.crowd', kind: 'output', label: 'The crowd', params: [] },
  { type: 'out.hype', kind: 'output', label: 'Hype (lights + crowd + FX)', params: [] },
  { type: 'out.camera', kind: 'output', label: 'Camera', params: [{ key: 'view', label: 'Angle', kind: 'select', choices: ['perf', 'wide', 'crowd', 'booth', 'fisheye', 'crane', 'drone', 'camcorder'], def: 'crowd' }] },
];

export const nodeType = (t: string) => NODE_TYPES.find((n) => n.type === t);

/** types of parts that drive a value (and get a `board.<id>` control when they have no function) */
const VALUE_TYPES = new Set(['knob', 'fader', 'button', 'ribbon', 'xy', 'theremin', 'globe', 'pendulum', 'fire_fader', 'crowd_fader', 'hype_dial']);

interface NodeState {
  value: number;
  /** delay line, smoothing, sample-and-hold */
  hist: { t: number; v: number }[];
  held: number;
  lastQ: number;
  prevOut: number;
}

export function walkComponents(list: BoardComponent[], fn: (c: BoardComponent) => void): void {
  for (const c of list) {
    fn(c);
    walkComponents(c.children, fn);
  }
}

export class BoardRuntime {
  private values = new Map<string, number>();
  private registered: string[] = [];
  private state = new Map<string, NodeState>();
  private order: WireNode[] = [];
  private inputsOf = new Map<string, string[]>();
  private t = 0;
  private lastBarCount = -1;
  private lastVibe = 0;
  private lastDrop = 0;
  private lastSection = '';
  private recording: { start: number; steps: MacroStep[]; off: () => void } | null = null;
  private timers: number[] = [];

  constructor(
    private doc: BoardFile,
    private reg: ControlRegistry,
    private hooks: BoardHooks,
  ) {
    this.registerControls();
    this.compile();
  }

  /** controls for parts with no function, mixer kills and FX slots */
  private registerControls(): void {
    const reg = this.reg;
    walkComponents(this.doc.components, (c) => {
      if (c.type === 'mixer' && c.props.kills) {
        for (let ch = 1; ch <= 4; ch++)
          for (const band of ['hi', 'mid', 'low']) {
            const id = `board.${c.id}.kill.${ch}.${band}`;
            let saved = 0.5;
            reg.register({
              id,
              label: `Kill ${band} (channel ${ch})`,
              kind: 'button',
              press: () => {
                saved = reg.value(`ch.${ch}.${band}`) || 0.5;
                reg.setValue(`ch.${ch}.${band}`, 0, 'ui');
              },
              release: () => reg.setValue(`ch.${ch}.${band}`, saved, 'ui'),
              lit: () => reg.value(`ch.${ch}.${band}`) < 0.02,
            });
            this.registered.push(id);
          }
      }
      if (c.type === 'fx') {
        const slots = Array.isArray(c.props.slots) ? (c.props.slots as string[]) : [];
        for (const s of slots) {
          const id = `board.${c.id}.slot.${s}`;
          reg.register({
            id,
            label: `FX: ${s}`,
            kind: 'button',
            press: () => {
              reg.press(`fx.type.${s}`, 'ui');
              if (!reg.lit('fx.on')) reg.press('fx.on', 'ui');
            },
            lit: () => !!reg.lit(`fx.type.${s}`),
          });
          this.registered.push(id);
        }
      }
      if (!c.props.fn && VALUE_TYPES.has(c.type)) {
        const id = `board.${c.id}`;
        const label = c.props.label.text || c.props.name || c.type;
        if (c.type === 'button') {
          reg.register({ id, label, kind: 'button', press: () => this.values.set(id, 1), release: () => this.values.set(id, 0), lit: () => (this.values.get(id) ?? 0) > 0.5 });
        } else {
          this.values.set(id, 0.5);
          reg.register({ id, label, kind: 'continuous', get: () => this.values.get(id) ?? 0, set: (v) => this.values.set(id, v), def: 0.5 });
        }
        this.registered.push(id);
      }
    });
  }

  /** order the node graph: inputs first, then whatever they feed */
  private compile(): void {
    const { nodes, cables } = this.doc.wiring;
    this.inputsOf.clear();
    for (const c of cables) {
      const to = c.to.split(':')[0];
      const from = c.from.split(':')[0];
      this.inputsOf.set(to, [...(this.inputsOf.get(to) ?? []), from]);
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const out: WireNode[] = [];
    const visit = (n: WireNode, depth = 0) => {
      if (seen.has(n.id) || depth > 64) return;
      seen.add(n.id);
      for (const i of this.inputsOf.get(n.id) ?? []) {
        const src = byId.get(i);
        if (src) visit(src, depth + 1);
      }
      out.push(n);
    };
    nodes.forEach((n) => visit(n));
    this.order = out;
    for (const n of nodes) if (!this.state.has(n.id)) this.state.set(n.id, { value: 0, hist: [], held: 0, lastQ: -1, prevOut: 0 });
  }

  /** the board changed (the editor): pick up new wiring, macros and triggers */
  reload(doc: BoardFile): void {
    this.dispose();
    this.doc = doc;
    this.registerControls();
    this.compile();
  }

  update(dt: number): void {
    this.t += dt;
    const h = this.hooks;
    const b = h.beat();
    const clock = h.clock?.() ?? { bars: 0, section: '' };
    for (const n of this.order) {
      const s = this.state.get(n.id)!;
      const ins = (this.inputsOf.get(n.id) ?? []).map((i) => this.state.get(i)?.value ?? 0);
      const x = ins.length ? Math.max(...ins) : 0;
      const p = n.params;
      let v = 0;
      switch (n.type) {
        case 'in.component': {
          const id = `board.${p.component}`;
          const c = this.findComponent(String(p.component));
          v = c?.props.fn ? this.reg.value(c.props.fn) : this.reg.value(id);
          if (c?.type === 'button' && !c.props.fn) v = this.values.get(id) ?? 0;
          break;
        }
        case 'in.control':
          v = this.reg.value(String(p.control));
          if (this.reg.get(String(p.control))?.kind === 'button') v = this.reg.lit(String(p.control)) ? 1 : 0;
          break;
        case 'in.clock': {
          const beats = p.rate === 'beat' ? 1 : p.rate === 'phrase' ? 32 : 4;
          const pos = p.rate === 'phrase' ? ((clock.bars % 8) * 4 + b.bar + b.phase) : p.rate === 'bar' ? b.bar + b.phase : b.phase;
          v = (pos % beats) / beats;
          break;
        }
        case 'in.vibe':
          v = h.vibe();
          break;
        case 'in.kick':
          v = h.kick();
          break;
        case 'in.drop':
          v = h.dropPulse();
          break;
        case 'mod.scale':
          v = Number(p.min ?? 0) + x * (Number(p.max ?? 1) - Number(p.min ?? 0));
          break;
        case 'mod.invert':
          v = 1 - x;
          break;
        case 'mod.curve':
          v = applyCurve(x, (p.curve as 'linear' | 'log' | 'exp' | 's') ?? 's');
          break;
        case 'mod.delay': {
          s.hist.push({ t: this.t, v: x });
          const lag = Number(p.ms ?? 250) / 1000;
          while (s.hist.length > 1 && s.hist[1].t <= this.t - lag) s.hist.shift();
          v = s.hist[0].t <= this.t - lag ? s.hist[0].v : 0;
          break;
        }
        case 'mod.random':
          v = Math.min(1, Math.max(0, x + (Math.random() - 0.5) * 2 * Number(p.amount ?? 0.2)));
          break;
        case 'mod.sync': {
          const div = p.every === '1/4' ? 0.25 : p.every === '1/2' ? 0.5 : p.every === 'bar' ? 4 : 1;
          const q = Math.floor((b.bar + b.phase) / div);
          if (q !== s.lastQ) {
            s.lastQ = q;
            s.held = x;
          }
          v = s.held;
          break;
        }
        case 'mod.smooth': {
          const k = 1 - Math.exp(-dt / Math.max(0.01, Number(p.time ?? 0.3)));
          v = s.value + (x - s.value) * k;
          break;
        }
        case 'mod.threshold':
          v = x > Number(p.level ?? 0.5) ? 1 : 0;
          break;
        default:
          v = x;
          this.output(n, x, s);
      }
      s.value = Math.min(1, Math.max(0, v));
    }
    this.triggers(clock);
  }

  private findComponent(id: string): BoardComponent | undefined {
    let found: BoardComponent | undefined;
    walkComponents(this.doc.components, (c) => {
      if (c.id === id) found = c;
    });
    return found;
  }

  private output(n: WireNode, x: number, s: NodeState): void {
    const rising = x > 0.5 && s.prevOut <= 0.5;
    const falling = x <= 0.5 && s.prevOut > 0.5;
    s.prevOut = x;
    const p = n.params;
    const src: ControlSource = 'ui';
    switch (n.type) {
      case 'out.control': {
        const id = String(p.control);
        const ctl = this.reg.get(id);
        if (ctl?.kind === 'continuous') this.reg.setValue(id, x, src);
        else if (rising) this.reg.press(id, src);
        else if (falling) this.reg.release(id, src);
        break;
      }
      case 'out.light':
        if (rising) this.hooks.show(p.cue as ShowCue, true);
        if (falling) this.hooks.show(p.cue as ShowCue, false);
        break;
      case 'out.show':
        if (rising) this.hooks.show(p.cue as ShowCue);
        break;
      case 'out.crowd':
        this.hooks.crowd(x);
        break;
      case 'out.hype':
        this.hooks.hype(x);
        break;
      case 'out.camera':
        if (rising) this.hooks.camera(String(p.view));
        break;
    }
  }

  /* ------------------------------ triggers ------------------------------ */

  private triggers(clock: { bars: number; section: string }): void {
    const vibe = this.hooks.vibe();
    const drop = this.hooks.dropPulse();
    const newBar = clock.bars !== this.lastBarCount;
    for (const t of this.doc.triggers) {
      if (!t.on) continue;
      let fire = false;
      if (t.when === 'vibe') fire = vibe >= t.above && this.lastVibe < t.above;
      else if (t.when === 'drop') fire = drop > 0.9 && this.lastDrop <= 0.9;
      else if (t.when === 'bar') fire = newBar && this.lastBarCount >= 0;
      else if (t.when === 'phrase') fire = newBar && this.lastBarCount >= 0 && clock.bars % 8 === 0;
      else if (t.when === 'build' || t.when === 'breakdown') fire = clock.section === t.when && this.lastSection !== t.when;
      else if (t.when === 'peak') fire = vibe >= 0.92 && this.lastVibe < 0.92;
      if (fire) this.act(t.action);
    }
    this.lastVibe = vibe;
    this.lastDrop = drop;
    this.lastBarCount = clock.bars;
    this.lastSection = clock.section;
  }

  /** run an action: 'control:<id>', 'macro:<id>' or 'show:<cue>' */
  act(action: string): void {
    const [kind, ...rest] = action.split(':');
    const what = rest.join(':');
    if (kind === 'control') {
      const ctl = this.reg.get(what);
      if (ctl?.kind === 'continuous') this.reg.setValue(what, ctl.get() > 0.5 ? 0 : 1, 'ui');
      else {
        this.reg.press(what, 'ui');
        this.timers.push(window.setTimeout(() => this.reg.release(what, 'ui'), 120));
      }
    } else if (kind === 'macro') {
      const m = this.doc.macros.find((x) => x.id === what);
      if (m) this.play(m);
    } else if (kind === 'show') this.hooks.show(what as ShowCue);
  }

  /* ------------------------------ macros ------------------------------ */

  /** play a macro's moves at their recorded times */
  play(m: Macro): void {
    for (const st of m.steps) {
      this.timers.push(
        window.setTimeout(() => {
          if (st.value !== undefined) this.reg.setValue(st.control, st.value, 'ui');
          else {
            this.reg.press(st.control, 'ui');
            this.timers.push(window.setTimeout(() => this.reg.release(st.control, 'ui'), 100));
          }
        }, st.at),
      );
    }
  }

  /** start recording every control you touch */
  recordMacro(): void {
    this.stopRecording();
    const start = performance.now();
    const steps: MacroStep[] = [];
    const off = this.reg.on('activity', ({ id }) => {
      if (id.startsWith('board.') && id.includes('.macro')) return;
      const ctl = this.reg.get(id);
      if (!ctl) return;
      steps.push({ at: Math.round(performance.now() - start), control: id, ...(ctl.kind === 'continuous' ? { value: Math.round(ctl.get() * 1000) / 1000 } : {}) });
    });
    this.recording = { start, steps, off };
  }

  /** stop and hand back what was recorded (moves to the same control within 30 ms are thinned) */
  stopRecording(): MacroStep[] | null {
    const r = this.recording;
    if (!r) return null;
    r.off();
    this.recording = null;
    const out: MacroStep[] = [];
    for (const s of r.steps) {
      const last = out.at(-1);
      if (last && last.control === s.control && s.value !== undefined && s.at - last.at < 30) out[out.length - 1] = s;
      else out.push(s);
    }
    return out.slice(0, 2000);
  }

  get isRecording(): boolean {
    return !!this.recording;
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.recording?.off();
    this.recording = null;
    // the controls stay registered (the registry has no removal); they're inert once the board's gone
    this.registered = [];
  }
}
