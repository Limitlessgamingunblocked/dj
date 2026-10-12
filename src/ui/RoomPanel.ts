/*
 * The Show tab's Room panel, shown in the crazy rooms: you're the room's
 * lighting designer. The pads play the room (also on keys and MIDI as
 * room.pad.1–8), the look (mode, colour, level) saves to four scene slots
 * that recall on a pad or on the next drop, you choose what the room does on
 * the drop, and which stems drive the floor, walls and ceiling.
 */
import type { ControlRegistry } from '../core/controls';
import { loadScenes, roomShow, saveScene, SCENE_SLOTS, type Routing } from '../three/venues/rooms/kit';
import { recallScene } from '../app/roomControls';
import { h, setClass } from './dom';
import { hwButton, type Widget } from './widgets';
import { toast } from './toast';

const ROUTINGS: [Routing, string, string][] = [
  ['stems', 'Stems', 'Drums drive the floor, the melody the walls, the vocals the ceiling'],
  ['swap', 'Swapped', 'The melody drives the floor, the vocals the walls, the drums the ceiling'],
  ['drums', 'All drums', 'The drums drive the whole room'],
];

export class RoomPanel {
  readonly el = h('div', { class: 'lights-col room-col', hidden: true });
  private widgets: Widget[] = [];
  private modeBtns: HTMLElement[] = [];
  private shown = '';

  constructor(private reg: ControlRegistry) {
    roomShow.onChange(() => this.build());
    this.build();
  }

  private build(): void {
    const r = roomShow.current;
    this.el.hidden = !r;
    this.widgets = [];
    this.modeBtns = [];
    if (!r) {
      this.el.replaceChildren();
      this.shown = '';
      return;
    }
    this.shown = r.roomId;
    // the pads: the room's actions, then the two scene recalls
    const pads = h('div', { class: 'light-pads room-pads' });
    r.actions.slice(0, 6).forEach((a, i) => {
      const w = hwButton(this.reg, `room.pad.${i + 1}`, a.label, { cls: `light-pad room-pad ${a.kind}` });
      w.el.title = a.kind === 'hold' ? `${a.label} (hold)` : a.kind === 'toggle' ? `${a.label} (on / off)` : a.label;
      const mine = !roomShow.owned || roomShow.owned.includes(a.id);
      if (!mine) w.el.classList.add('rival');
      this.widgets.push(w);
      pads.append(w.el);
    });
    for (const [i, slot] of [
      [7, 'A'],
      [8, 'B'],
    ] as [number, string][]) {
      const w = hwButton(this.reg, `room.pad.${i}`, `Scene ${slot}`, { cls: 'light-pad room-pad scene' });
      this.widgets.push(w);
      pads.append(w.el);
    }
    // the look
    const modes = h('div', { class: 'seg', role: 'group', 'aria-label': 'Room mode' });
    r.modes.forEach((m, i) => {
      const b = h('button', { class: 'btn', type: 'button' }, m);
      b.addEventListener('click', () => r.setLook({ ...r.look, mode: i }));
      this.modeBtns.push(b);
      modes.append(b);
    });
    const range = (label: string, min: number, max: number, get: () => number, set: (v: number) => void) => {
      const inp = h('input', { type: 'range', min, max, step: 0.01, value: get(), 'aria-label': label }) as HTMLInputElement;
      inp.addEventListener('input', () => set(parseFloat(inp.value)));
      return h('label', { class: 'field' }, label, inp);
    };
    const sliders = h(
      'div',
      { class: 'toggle-row sliders' },
      range('Colour', 0, 1, () => r.look.hue, (v) => r.setLook({ ...r.look, hue: v })),
      range('Level', 0.2, 1.5, () => r.look.level, (v) => r.setLook({ ...r.look, level: v })),
    );
    // scene slots: save the look, recall it, or arm it for the next drop
    const scenes = loadScenes(r.roomId, r.modes.length);
    const slots = h('div', { class: 'room-scenes' });
    for (let i = 0; i < SCENE_SLOTS; i++) {
      const name = 'ABCD'[i];
      const has = !!scenes[i];
      const recall = h('button', { class: 'btn', type: 'button', disabled: !has, title: has ? `Recall scene ${name}` : 'Empty: save a look here first' }, `${name}`);
      recall.addEventListener('click', () => recallScene(i));
      const save = h('button', { class: 'btn ghost small', type: 'button', title: `Save the room's look as scene ${name}` }, 'Save');
      save.addEventListener('click', () => {
        saveScene(r.roomId, i, r.look, r.modes.length);
        toast(`Scene ${name} saved`);
        this.build();
      });
      const arm = h('button', { class: `btn ghost small${roomShow.armed === i ? ' active' : ''}`, type: 'button', disabled: !has, title: `Recall scene ${name} on the next drop` }, 'On drop');
      arm.addEventListener('click', () => {
        roomShow.armed = roomShow.armed === i ? -1 : i;
        this.build();
      });
      slots.append(h('div', { class: 'room-slot' }, recall, save, arm));
    }
    // the drop's moment
    const drop = h('select', { 'aria-label': 'On the drop' }) as HTMLSelectElement;
    drop.append(h('option', { value: 'auto' }, 'Auto: picked to suit the drop'));
    for (const m of r.moments) drop.append(h('option', { value: m.id }, `${m.label} (${m.energy === 'big' ? 'for a big drop' : 'for a softer drop'})`));
    drop.value = r.moments.some((m) => m.id === roomShow.dropMoment) ? roomShow.dropMoment : 'auto';
    drop.addEventListener('change', () => (roomShow.dropMoment = drop.value));
    // which stems drive what
    const routing = h('div', { class: 'seg', role: 'group', 'aria-label': 'What drives the room' });
    for (const [id, label, title] of ROUTINGS) {
      const b = h('button', { class: `btn${roomShow.routing === id ? ' active' : ''}`, type: 'button', title }, label);
      b.addEventListener('click', () => {
        roomShow.routing = id;
        this.build();
      });
      routing.append(b);
    }
    const sounds = h('input', { type: 'checkbox', checked: roomShow.sounds }) as HTMLInputElement;
    sounds.addEventListener('change', () => (roomShow.sounds = sounds.checked));
    this.el.replaceChildren(
      h('h3', {}, r.roomName),
      pads,
      h('p', { class: 'note' }, roomShow.owned ? 'Room Battle: the dimmed pads are your rival’s.' : 'The pads play the room. Put them on keys in Settings → Keyboard, or MIDI-learn them.'),
      h('div', { class: 'field' }, 'Mode', modes),
      sliders,
      h('div', { class: 'field' }, 'Scenes', slots),
      h('label', { class: 'field' }, 'On the drop', drop),
      h('p', { class: 'note' }, 'Choose a moment that suits the drop and it scores in a gig.'),
      h('div', { class: 'field' }, 'What drives the room', routing),
      h('label', { class: 'toggle-row' }, sounds, 'Room sounds (notes when the beams are broken)'),
    );
  }

  update(): void {
    const r = roomShow.current;
    if ((r?.roomId ?? '') !== this.shown) this.build();
    if (!r) return;
    for (const w of this.widgets) w.update();
    this.modeBtns.forEach((b, i) => setClass(b, 'active', i === r.look.mode));
  }
}
