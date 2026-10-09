/*
 * The board's logic (Sections 13.9–13.11), in one window with four tabs:
 *   Wiring    a node editor: inputs (a part, any control, the beat clock,
 *             the vibe, the kick, the drop) through modifiers (scale, invert,
 *             curve, delay, randomiser, beat-sync, smoothing, threshold) to
 *             outputs (a control, the lights, a show cue, the crowd, hype,
 *             the camera). Drag from a node's right dot to another's left dot
 *             to connect; click a cable to cut it.
 *   Macros    record a run of moves while you play, give it a name, and put
 *             it on a button (it appears in every "Controls" list)
 *   Triggers  when the vibe passes a level, on a drop, every bar or phrase,
 *             at a build, a breakdown or the peak: press a control, play a
 *             macro or fire a show cue
 *   MIDI      this board's own mapping: pick a part, press Learn, move the
 *             knob on your controller
 */
import type { ControlRegistry } from '../../core/controls';
import { clear, h } from '../../ui/dom';
import { openModal } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { defOf } from '../catalog';
import { TRIGGER_WHEN, type BoardComponent, type Macro, type MacroStep, type Trigger, type WireNode } from '../format';
import type { ShowCue } from '../hooks';
import { NODE_TYPES, nodeType, walkComponents } from '../logic';
import type { BoardEditor } from './Editor';
import * as ops from './ops';
import { controlSelect, nameOf } from './panels';

export interface MidiLearn {
  /** a controller is connected and allowed */
  ready(): boolean;
  /** the next message's key ('cc:1:7', 'note:1:36'), once; returns a cancel */
  next(fn: (key: string) => void): () => void;
}

export interface LogicDeps {
  ed: BoardEditor;
  reg: ControlRegistry;
  midi: MidiLearn | null;
}

const SHOW: ShowCue[] = ['strobe', 'blinder', 'blackout', 'lasers', 'laserColor', 'laserPattern', 'co2', 'pyro', 'confetti', 'streamers', 'sparklers', 'fog', 'flashName', 'nextVisual', 'hazeUp'];
const SHOW_LABEL: Record<string, string> = { laserColor: 'Laser colour', laserPattern: 'Laser look', co2: 'CO₂', flashName: 'Your name on the screens', nextVisual: 'Next visual', hazeUp: 'More haze' };
const showLabel = (c: string) => SHOW_LABEL[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
const WHEN_LABEL: Record<string, string> = { vibe: 'The vibe passes', drop: 'A drop hits', bar: 'Every bar', phrase: 'Every phrase', build: 'A build starts', breakdown: 'A breakdown starts', peak: 'The peak' };
const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** parts that make a value the wiring can read */
function valueParts(ed: BoardEditor): BoardComponent[] {
  const out: BoardComponent[] = [];
  walkComponents(ed.doc.components, (c) => {
    const d = defOf(c.type);
    if (d && (d.options ?? []).some((o) => o.kind === 'control') && c.type !== 'mixer' && c.type !== 'transport') out.push(c);
  });
  return out;
}

export function openLogic(o: LogicDeps, start: 'wiring' | 'macros' | 'triggers' | 'midi' = 'wiring'): void {
  const { ed } = o;
  const body = h('div', { class: 'bb-logic' });
  const tabs = h('div', { class: 'bb-tabs', role: 'tablist' });
  const pane = h('div', { class: 'bb-logic-pane' });
  let tab = start;
  let cancelLearn: (() => void) | null = null;
  const show = () => {
    cancelLearn?.();
    cancelLearn = null;
    clear(tabs);
    for (const [id, label] of [
      ['wiring', 'Wiring'],
      ['macros', 'Macros'],
      ['triggers', 'Triggers'],
      ['midi', 'MIDI'],
    ] as const) {
      const b = h('button', { class: `bb-tab${tab === id ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(tab === id) }, label);
      b.addEventListener('click', () => {
        tab = id;
        show();
      });
      tabs.append(b);
    }
    clear(pane);
    pane.append(tab === 'wiring' ? wiring() : tab === 'macros' ? macros() : tab === 'triggers' ? triggers() : midi());
  };

  /* ---------------------------- wiring ---------------------------- */
  const wiring = (): HTMLElement => {
    const area = h('div', { class: 'bb-graph', tabindex: 0, 'aria-label': 'Wiring: drag between the dots to connect nodes' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('bb-cables');
    area.append(svg);
    const nodeEls = new Map<string, HTMLElement>();
    let pending: { from: string; line: SVGPathElement } | null = null;

    const portPos = (id: string, side: 'in' | 'out') => {
      const el = nodeEls.get(id);
      if (!el) return { x: 0, y: 0 };
      return { x: el.offsetLeft + (side === 'out' ? el.offsetWidth : 0), y: el.offsetTop + 16 };
    };
    const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
      return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
    };
    const drawCables = () => {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.setAttribute('width', String(area.scrollWidth));
      svg.setAttribute('height', String(area.scrollHeight));
      ed.doc.wiring.cables.forEach((c, i) => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', curve(portPos(c.from.split(':')[0], 'out'), portPos(c.to.split(':')[0], 'in')));
        p.classList.add('bb-cable');
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        t.textContent = 'Click to cut this cable';
        p.append(t);
        p.addEventListener('click', () => {
          ed.edit('Cut cable', (d) => d.wiring.cables.splice(i, 1), false);
          drawCables();
        });
        svg.append(p);
      });
      if (pending) svg.append(pending.line);
    };

    const nodeCard = (n: WireNode) => {
      const t = nodeType(n.type);
      const kind = t?.kind ?? 'modifier';
      const inDot = kind !== 'input' ? h('span', { class: 'bb-port in', title: 'In', 'data-node': n.id }) : null;
      const outDot = kind !== 'output' ? h('span', { class: 'bb-port out', title: 'Drag to connect', 'data-node': n.id }) : null;
      const del = h('button', { class: 'bb-x', type: 'button', title: 'Delete this node', 'aria-label': `Delete ${t?.label ?? n.type}` }, '✕');
      const params = (t?.params ?? []).map((p) => {
        const v = n.params[p.key] ?? p.def;
        const set = (x: string | number) => ed.edit('Node setting', (d) => {
          const nd = d.wiring.nodes.find((q) => q.id === n.id);
          if (nd) nd.params[p.key] = x;
        }, false);
        let input: HTMLElement;
        if (p.kind === 'select') {
          const s = h('select', { 'aria-label': p.label }, (p.choices ?? []).map((c) => h('option', { value: c, selected: c === v }, p.key === 'cue' ? showLabel(c) : c))) as HTMLSelectElement;
          s.addEventListener('change', () => set(s.value));
          input = s;
        } else if (p.kind === 'control') input = controlSelect(o.reg, String(v), (x) => set(x), 'Choose…');
        else if (p.kind === 'component') {
          const s = h('select', { 'aria-label': p.label }, h('option', { value: '' }, 'Choose a part…'), valueParts(ed).map((c) => h('option', { value: c.id, selected: c.id === v }, nameOf(c)))) as HTMLSelectElement;
          s.addEventListener('change', () => set(s.value));
          input = s;
        } else if (p.kind === 'number') {
          const nI = h('input', { type: 'number', step: 'any', value: String(v), 'aria-label': p.label }) as HTMLInputElement;
          nI.addEventListener('change', () => set(parseFloat(nI.value) || 0));
          input = nI;
        } else {
          const tI = h('input', { type: 'text', value: String(v), 'aria-label': p.label }) as HTMLInputElement;
          tI.addEventListener('change', () => set(tI.value));
          input = tI;
        }
        return h('label', { class: 'bb-row' }, h('span', { class: 'bb-k' }, p.label), input);
      });
      const head = h('div', { class: 'bb-node-head' }, inDot, h('b', {}, t?.label ?? n.type), del, outDot);
      const card = h('div', { class: `bb-node ${kind}`, style: { left: `${n.x}px`, top: `${n.y}px` } }, head, ...params);
      nodeEls.set(n.id, card);
      del.addEventListener('click', () => {
        ed.edit('Delete node', (d) => {
          d.wiring.nodes = d.wiring.nodes.filter((q) => q.id !== n.id);
          d.wiring.cables = d.wiring.cables.filter((c) => c.from.split(':')[0] !== n.id && c.to.split(':')[0] !== n.id);
        }, false);
        render();
      });
      // drag the node by its header
      head.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('.bb-port, .bb-x')) return;
        e.preventDefault();
        const sx = e.clientX;
        const sy = e.clientY;
        const x0 = n.x;
        const y0 = n.y;
        head.setPointerCapture(e.pointerId);
        const mv = (ev: PointerEvent) => {
          card.style.left = `${Math.max(0, x0 + ev.clientX - sx)}px`;
          card.style.top = `${Math.max(0, y0 + ev.clientY - sy)}px`;
          drawCables();
        };
        const up = (ev: PointerEvent) => {
          head.removeEventListener('pointermove', mv);
          head.removeEventListener('pointerup', up);
          const x = Math.round(Math.max(0, x0 + ev.clientX - sx));
          const y = Math.round(Math.max(0, y0 + ev.clientY - sy));
          ed.edit('Move node', (d) => {
            const nd = d.wiring.nodes.find((q) => q.id === n.id);
            if (nd) Object.assign(nd, { x, y });
          }, false);
        };
        head.addEventListener('pointermove', mv);
        head.addEventListener('pointerup', up);
      });
      // drag a cable from the output dot
      outDot?.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.classList.add('bb-cable', 'pending');
        pending = { from: n.id, line };
        const ar = area.getBoundingClientRect();
        const mv = (ev: PointerEvent) => {
          line.setAttribute('d', curve(portPos(n.id, 'out'), { x: ev.clientX - ar.left + area.scrollLeft, y: ev.clientY - ar.top + area.scrollTop }));
          drawCables();
        };
        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
          const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.bb-node')?.querySelector('.bb-port.in') as HTMLElement | null;
          const to = target?.dataset.node;
          pending = null;
          if (to && to !== n.id && !ed.doc.wiring.cables.some((c) => c.from === n.id && c.to === to)) ed.edit('Connect', (d) => d.wiring.cables.push({ from: n.id, to }), false);
          drawCables();
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
      });
      return card;
    };

    const render = () => {
      for (const el of nodeEls.values()) el.remove();
      nodeEls.clear();
      for (const n of ed.doc.wiring.nodes) area.append(nodeCard(n));
      requestAnimationFrame(drawCables);
    };

    const addNode = (type: string) => {
      const t = nodeType(type);
      if (!t) return;
      const col = t.kind === 'input' ? 20 : t.kind === 'modifier' ? 260 : 500;
      const y = 20 + ed.doc.wiring.nodes.filter((n) => nodeType(n.type)?.kind === t.kind).length * 110;
      const n: WireNode = { id: uid('n'), type, params: Object.fromEntries(t.params.map((p) => [p.key, p.def])), x: col, y };
      ed.edit('Add node', (d) => d.wiring.nodes.push(n), false);
      render();
    };
    const add = h('select', { 'aria-label': 'Add a node' }, h('option', { value: '' }, '＋ Add a node…'), (['input', 'modifier', 'output'] as const).map((k) => h('optgroup', { label: k === 'input' ? 'Inputs' : k === 'modifier' ? 'Modifiers' : 'Outputs' }, NODE_TYPES.filter((t) => t.kind === k).map((t) => h('option', { value: t.type }, t.label))))) as HTMLSelectElement;
    add.addEventListener('change', () => {
      if (add.value) addNode(add.value);
      add.value = '';
    });
    const example = h('button', { class: 'btn ghost', type: 'button', title: 'An example: the vibe meter opens the filter on channel 1' }, 'Example');
    example.addEventListener('click', () => {
      const a: WireNode = { id: uid('n'), type: 'in.vibe', params: {}, x: 20, y: 20 };
      const b: WireNode = { id: uid('n'), type: 'mod.smooth', params: { time: 0.5 }, x: 260, y: 20 };
      const c: WireNode = { id: uid('n'), type: 'out.control', params: { control: 'ch.1.filter' }, x: 500, y: 20 };
      ed.edit('Example wiring', (d) => {
        d.wiring.nodes.push(a, b, c);
        d.wiring.cables.push({ from: a.id, to: b.id }, { from: b.id, to: c.id });
      }, false);
      render();
    });
    area.addEventListener('scroll', drawCables);
    render();
    return h('div', {}, h('div', { class: 'bb-flags' }, add, example, h('span', { class: 'bb-hint' }, 'Inputs on the left, outputs on the right. It all runs while you play (try it with Test).')), area);
  };

  /* ---------------------------- macros ---------------------------- */
  const macros = (): HTMLElement => {
    const list = h('div', { class: 'bb-list' });
    const render = () => {
      clear(list);
      if (!ed.doc.macros.length) list.append(h('p', { class: 'bb-empty' }, 'No macros yet. Record one: everything you move while recording is played back, in time, when it’s pressed.'));
      for (const m of ed.doc.macros) {
        const name = h('input', { type: 'text', value: m.name, maxlength: 40, 'aria-label': 'Macro name' }) as HTMLInputElement;
        name.addEventListener('change', () => ed.edit('Rename macro', (d) => {
          const x = d.macros.find((q) => q.id === m.id);
          if (x) x.name = name.value.trim() || 'Macro';
        }, false));
        const len = m.steps.length ? (m.steps[m.steps.length - 1].at / 1000).toFixed(1) : '0';
        const del = h('button', { class: 'btn ghost', type: 'button', 'aria-label': `Delete ${m.name}` }, 'Delete');
        del.addEventListener('click', () => {
          ed.edit('Delete macro', (d) => {
            d.macros = d.macros.filter((q) => q.id !== m.id);
            d.triggers = d.triggers.filter((t) => t.action !== `macro:${m.id}`);
          }, false);
          render();
        });
        list.append(h('div', { class: 'bb-item' }, name, h('span', { class: 'bb-hint' }, `${m.steps.length} moves · ${len} s · on a button: “Macro: ${m.name}”`), del));
      }
    };
    const rec = h('button', { class: 'btn primary', type: 'button' }, '● Record a macro');
    rec.addEventListener('click', () => {
      modal.close();
      recordMacro(o);
    });
    render();
    return h('div', {}, h('div', { class: 'bb-flags' }, rec, h('span', { class: 'bb-hint' }, 'Recording plays your board (Test) and keeps every move until you press Stop.')), list);
  };

  /* ---------------------------- triggers ---------------------------- */
  const triggers = (): HTMLElement => {
    const list = h('div', { class: 'bb-list' });
    const actionPicker = (t: Trigger, on: (a: string) => void) => {
      const [kind, ...rest] = t.action.split(':');
      const what = rest.join(':');
      const kindSel = h('select', { 'aria-label': 'Do what' }, h('option', { value: 'show', selected: kind === 'show' }, 'Fire a show cue'), h('option', { value: 'control', selected: kind === 'control' }, 'Press a control'), h('option', { value: 'macro', selected: kind === 'macro', disabled: !ed.doc.macros.length }, 'Play a macro')) as HTMLSelectElement;
      const target = h('span');
      const fill = () => {
        clear(target);
        if (kindSel.value === 'show') {
          const s = h('select', { 'aria-label': 'Which cue' }, SHOW.map((c) => h('option', { value: c, selected: kind === 'show' && c === what }, showLabel(c)))) as HTMLSelectElement;
          s.addEventListener('change', () => on(`show:${s.value}`));
          target.append(s);
        } else if (kindSel.value === 'control') target.append(controlSelect(o.reg, kind === 'control' ? what : '', (x) => x && on(`control:${x}`), 'Choose…'));
        else {
          const s = h('select', { 'aria-label': 'Which macro' }, ed.doc.macros.map((m) => h('option', { value: m.id, selected: kind === 'macro' && m.id === what }, m.name))) as HTMLSelectElement;
          s.addEventListener('change', () => on(`macro:${s.value}`));
          target.append(s);
        }
      };
      kindSel.addEventListener('change', () => {
        fill();
        const first = kindSel.value === 'show' ? `show:${SHOW[0]}` : kindSel.value === 'macro' && ed.doc.macros[0] ? `macro:${ed.doc.macros[0].id}` : null;
        if (first) on(first);
      });
      fill();
      return h('span', { class: 'bb-flags' }, kindSel, target);
    };
    const render = () => {
      clear(list);
      if (!ed.doc.triggers.length) list.append(h('p', { class: 'bb-empty' }, 'No triggers. Add one: confetti when the vibe passes 90 %, a strobe on every drop…'));
      ed.doc.triggers.forEach((t) => {
        const patch = (p: Partial<Trigger>, label = 'Trigger') => {
          ed.edit(label, (d) => {
            const x = d.triggers.find((q) => q.id === t.id);
            if (x) Object.assign(x, p);
          }, false);
          render();
        };
        const when = h('select', { 'aria-label': 'When' }, TRIGGER_WHEN.map((w) => h('option', { value: w, selected: w === t.when }, WHEN_LABEL[w]))) as HTMLSelectElement;
        when.addEventListener('change', () => patch({ when: when.value as Trigger['when'] }));
        const above = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: t.above, 'aria-label': 'Vibe level' }) as HTMLInputElement;
        const aboveLbl = h('span', { class: 'bb-hint' }, `${Math.round(t.above * 100)} %`);
        above.addEventListener('input', () => (aboveLbl.textContent = `${Math.round(parseFloat(above.value) * 100)} %`));
        above.addEventListener('change', () => patch({ above: parseFloat(above.value) }));
        const on = h('input', { type: 'checkbox', checked: t.on, 'aria-label': 'On' }) as HTMLInputElement;
        on.addEventListener('change', () => patch({ on: on.checked }));
        const del = h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Delete trigger' }, 'Delete');
        del.addEventListener('click', () => {
          ed.edit('Delete trigger', (d) => (d.triggers = d.triggers.filter((q) => q.id !== t.id)), false);
          render();
        });
        list.append(h('div', { class: 'bb-item' }, on, when, t.when === 'vibe' ? h('span', { class: 'bb-flags' }, above, aboveLbl) : null, h('span', { class: 'bb-hint' }, '→'), actionPicker(t, (a) => patch({ action: a })), del));
      });
    };
    const add = h('button', { class: 'btn primary', type: 'button' }, '＋ Add a trigger');
    add.addEventListener('click', () => {
      ed.edit('Add trigger', (d) => d.triggers.push({ id: uid('t'), when: 'vibe', above: 0.9, action: 'show:confetti', on: true }), false);
      render();
    });
    render();
    return h('div', {}, h('div', { class: 'bb-flags' }, add), list);
  };

  /* ---------------------------- MIDI ---------------------------- */
  const midi = (): HTMLElement => {
    const box = h('div', {});
    const render = () => {
      clear(box);
      if (!o.midi || !o.midi.ready()) {
        box.append(h('p', { class: 'bb-empty' }, 'Connect a MIDI controller first (Settings → MIDI → Enable). Then map its knobs to this board’s parts here; the mapping is saved with the board.'));
        return;
      }
      const parts = valueParts(ed).concat(collect(ed, ['button', 'pads', 'drop_button']));
      const pick = h('select', { 'aria-label': 'Part to map' }, parts.map((c) => h('option', { value: c.id }, nameOf(c)))) as HTMLSelectElement;
      const learn = h('button', { class: 'btn primary', type: 'button' }, 'Learn');
      const status = h('span', { class: 'bb-hint' });
      learn.addEventListener('click', () => {
        if (!pick.value) return;
        cancelLearn?.();
        status.textContent = 'Move a knob or press a button on your controller…';
        cancelLearn = o.midi!.next((key) => {
          cancelLearn = null;
          ed.edit('MIDI map', (d) => {
            for (const [k, v] of Object.entries(d.midi)) if (v === pick.value) delete d.midi[k];
            d.midi[key] = pick.value;
          }, false);
          toast(`Mapped ${key} to ${nameOf(ops.find(ed.doc, pick.value)!.c)}.`);
          render();
        });
      });
      const rows = Object.entries(ed.doc.midi).map(([k, id]) => {
        const c = ops.find(ed.doc, id)?.c;
        const del = h('button', { class: 'btn ghost', type: 'button', 'aria-label': `Remove ${k}` }, 'Remove');
        del.addEventListener('click', () => {
          ed.edit('MIDI unmap', (d) => delete d.midi[k], false);
          render();
        });
        return h('div', { class: 'bb-item' }, h('code', {}, k), h('span', {}, '→'), h('b', {}, c ? nameOf(c) : id), del);
      });
      box.append(h('div', { class: 'bb-flags' }, pick, learn, status), rows.length ? h('div', { class: 'bb-list' }, rows) : h('p', { class: 'bb-empty' }, 'Nothing mapped yet.'));
    };
    render();
    return box;
  };

  body.append(tabs, pane);
  const modal = openModal(`Logic · ${ed.doc.name}`, body, { wide: true });
  const close = modal.close;
  modal.close = () => {
    cancelLearn?.();
    close();
  };
  show();
}

function collect(ed: BoardEditor, types: string[]): BoardComponent[] {
  const out: BoardComponent[] = [];
  walkComponents(ed.doc.components, (c) => {
    if (types.includes(c.type)) out.push(c);
  });
  return out;
}

/** record a macro: the board goes live, a strip shows the time and a Stop button */
export function recordMacro(o: LogicDeps): void {
  const { ed, reg } = o;
  ed.test();
  const start = performance.now();
  const steps: MacroStep[] = [];
  const off = reg.on('activity', ({ id }: { id: string }) => {
    if (id.startsWith('board.macro.')) return;
    const ctl = reg.get(id);
    if (!ctl) return;
    steps.push({ at: Math.round(performance.now() - start), control: id, ...(ctl.kind === 'continuous' ? { value: Math.round(ctl.get() * 1000) / 1000 } : {}) });
  });
  const time = h('span', { class: 'mono' }, '0.0 s');
  const stop = h('button', { class: 'btn primary', type: 'button' }, '■ Stop');
  const strip = h('div', { class: 'bb-recstrip', role: 'status' }, h('span', { class: 'bb-recdot', 'aria-hidden': 'true' }), h('b', {}, 'Recording a macro'), time, stop);
  ed.stage.el.append(strip);
  const timer = window.setInterval(() => (time.textContent = `${((performance.now() - start) / 1000).toFixed(1)} s`), 100);
  stop.addEventListener('click', () => {
    off();
    clearInterval(timer);
    strip.remove();
    // moves to the same control within 30 ms are thinned
    const out: MacroStep[] = [];
    for (const s of steps) {
      const last = out[out.length - 1];
      if (last && last.control === s.control && s.value !== undefined && s.at - last.at < 30) out[out.length - 1] = s;
      else out.push(s);
    }
    if (!out.length) {
      toast('Nothing was moved, so there’s no macro.');
      return;
    }
    const m: Macro = { id: uid('m'), name: `Macro ${ed.doc.macros.length + 1}`, steps: out.slice(0, 2000) };
    ed.edit('Record macro', (d) => d.macros.push(m), false);
    toast(`Saved “${m.name}” (${out.length} moves). Put it on a button: its Controls list has it.`);
    // the playing board picks the new macro up
    ed.replay();
  });
}
