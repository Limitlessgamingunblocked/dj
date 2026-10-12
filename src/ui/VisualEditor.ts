/*
 * The Visual editor: build your own visual mode from layers (a tunnel,
 * shapes, a spectrum ring, stars, a grid floor, your name, the waveform) over
 * a background, with a kaleidoscope on top. Three slots; changes show live
 * on the visual player, and Save keeps them (visualizer/myvisual.ts).
 */
import { BACKGROUNDS, LAYER_KINDS, LAYER_LABEL, MY_SLOTS, loadMyVisuals, myVisualId, myVisuals, saveMyVisuals, type Background, type LayerKind } from '../visualizer/myvisual';
import { h, setClass } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

export interface VisualEditorHooks {
  /** show a mode on the visual player */
  show(id: string): void;
}

export function openVisualEditor(hooks: VisualEditorHooks, slot = 0): void {
  let saved = false;
  const body = h('div', { class: 'vis-editor' });
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Slot' });
  const tabBtns: HTMLElement[] = [];
  for (let i = 0; i < MY_SLOTS; i++) {
    const b = h('button', { class: 'btn', type: 'button', role: 'tab' }, `Slot ${i + 1}`);
    b.addEventListener('click', () => {
      slot = i;
      draw();
      hooks.show(myVisualId(slot));
    });
    tabBtns.push(b);
    tabs.append(b);
  }
  const draw = () => {
    tabBtns.forEach((b, i) => setClass(b, 'active', i === slot));
    const v = myVisuals[slot];
    const name = h('input', { type: 'text', value: v.name, maxlength: 24, 'aria-label': 'Name' }) as HTMLInputElement;
    name.addEventListener('input', () => (v.name = name.value || `My visual ${slot + 1}`));
    const bg = h('select', { 'aria-label': 'Background' }, ...BACKGROUNDS.map((b) => h('option', { value: b, selected: b === v.background }, b === 'black' ? 'Black' : b === 'gradient' ? 'Glow' : 'Smoke'))) as HTMLSelectElement;
    bg.addEventListener('change', () => (v.background = bg.value as Background));
    const bgc = h('input', { type: 'color', value: v.bgColor, 'aria-label': 'Background colour' }) as HTMLInputElement;
    bgc.addEventListener('input', () => (v.bgColor = bgc.value));
    const kal = h('select', { 'aria-label': 'Kaleidoscope' }, ...[0, 4, 6, 8].map((k) => h('option', { value: String(k), selected: k === v.kaleido }, k ? `${k} slices` : 'Off'))) as HTMLSelectElement;
    kal.addEventListener('change', () => (v.kaleido = Number(kal.value) as 0 | 4 | 6 | 8));
    const rows = v.layers.map((l, i) => {
      const on = h('input', { type: 'checkbox', checked: l.on, 'aria-label': `Layer ${i + 1} on` }) as HTMLInputElement;
      on.addEventListener('change', () => (l.on = on.checked));
      const kind = h('select', { 'aria-label': `Layer ${i + 1}` }, ...LAYER_KINDS.map((k) => h('option', { value: k, selected: k === l.kind }, LAYER_LABEL[k]))) as HTMLSelectElement;
      const col = h('input', { type: 'color', value: l.color, 'aria-label': `Layer ${i + 1} colour` }) as HTMLInputElement;
      col.addEventListener('input', () => (l.color = col.value));
      const slider = (label: string, get: () => number, set: (x: number) => void, min = 0, max = 1, step = 0.01) => {
        const s = h('input', { type: 'range', min, max, step, value: get(), 'aria-label': `Layer ${i + 1} ${label}` }) as HTMLInputElement;
        s.addEventListener('input', () => set(Number(s.value)));
        return h('label', { class: 'field' }, label, s);
      };
      const sides = slider('Sides', () => l.sides, (x) => (l.sides = x), 3, 8, 1);
      sides.hidden = l.kind !== 'shapes';
      kind.addEventListener('change', () => {
        l.kind = kind.value as LayerKind;
        sides.hidden = l.kind !== 'shapes';
      });
      return h('div', { class: 'vis-layer' }, h('span', { class: 'vis-layer-n' }, `${i + 1}`), on, kind, col, slider('Amount', () => l.amount, (x) => (l.amount = x)), slider('Speed', () => l.speed, (x) => (l.speed = x)), sides);
    });
    body.replaceChildren(
      h('label', { class: 'field' }, 'Name', name),
      h('div', { class: 'toggle-row' }, h('label', { class: 'field' }, 'Background', bg), h('label', { class: 'field' }, 'Colour', bgc), h('label', { class: 'field' }, 'Kaleidoscope', kal)),
      h('div', { class: 'field' }, 'Layers (bottom to top)', ...rows),
    );
  };
  draw();
  const showBtn = h('button', { type: 'button', class: 'btn' }, 'Show it on the screens');
  showBtn.addEventListener('click', () => hooks.show(myVisualId(slot)));
  const saveBtn = h('button', { type: 'button', class: 'btn primary' }, 'Save');
  saveBtn.addEventListener('click', () => {
    saved = true;
    saveMyVisuals();
    toast(`${myVisuals[slot].name} saved`);
    m.close();
  });
  const m = openModal('Visual editor', h('div', { class: 'gig-setup' }, h('p', { class: 'note' }, 'Changes show live on the visual player. Your visuals are in the mode list and the auto VJ can pick them too.'), tabs, body, h('div', { class: 'gs-actions' }, showBtn, saveBtn)), { wide: true });
  hooks.show(myVisualId(slot));
  // closed without saving: put back what was saved
  const close = m.close;
  m.close = () => {
    if (!saved) loadMyVisuals();
    close();
  };
}
