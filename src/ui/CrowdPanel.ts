/*
 * The Show tab's Crowd column: your DJ moves (pads, keys and MIDI as
 * dj.move.1–6), your signature move for the big drops, crowd moments to
 * start by hand (or let them come by themselves), the dance style the
 * crowd's picked up from the genre, and the regulars and how much they like
 * you.
 */
import { DJ_MOVES } from '../character/Avatar';
import type { ControlRegistry } from '../core/controls';
import { CROWD_MOMENTS, crowdShow, styleName } from '../three/venues/crowdShow';
import { h, setClass, setText } from './dom';
import { hwButton, type Widget } from './widgets';

export interface CrowdPanelHooks {
  signatureMove(): string;
  setSignatureMove(id: string): void;
  regulars(): { name: string; style: string; color: string; loyalty: number; front: boolean; here: boolean }[];
}

const SIGNATURES: [string, string][] = [
  ['hands_up', 'Hands up'],
  ['point', 'Point at the crowd'],
  ['fist_pump', 'Fist pump'],
  ['jump', 'Jump'],
  ['headphones_up', 'Headphones in the air'],
];

export class CrowdPanel {
  readonly el: HTMLElement;
  private widgets: Widget[] = [];
  private momentBtns = new Map<string, HTMLElement>();
  private style = h('span', { class: 'crowd-style mono' });
  private fans = h('ul', { class: 'crowd-fans' });
  private auto: HTMLInputElement;
  private sig: HTMLSelectElement;
  private fansT = 0;

  constructor(
    reg: ControlRegistry,
    private hooks: CrowdPanelHooks,
  ) {
    const pads = h('div', { class: 'light-pads crowd-pads' });
    DJ_MOVES.forEach((m, i) => {
      const w = hwButton(reg, `dj.move.${i + 1}`, m.label, { cls: 'light-pad move-pad' });
      this.widgets.push(w);
      pads.append(w.el);
    });
    this.sig = h('select', { 'aria-label': 'Signature move' }, ...SIGNATURES.map(([id, label]) => h('option', { value: id }, label))) as HTMLSelectElement;
    this.sig.value = hooks.signatureMove();
    this.sig.addEventListener('change', () => hooks.setSignatureMove(this.sig.value));
    const moments = h('div', { class: 'toggle-row crowd-moments' });
    for (const m of CROWD_MOMENTS) {
      const b = h('button', { class: 'btn', type: 'button', title: m.blurb }, m.label);
      b.addEventListener('click', () => (crowdShow.moment?.id === m.id ? crowdShow.stop() : crowdShow.start(m.id)));
      this.momentBtns.set(m.id, b);
      moments.append(b);
    }
    this.auto = h('input', { type: 'checkbox', checked: crowdShow.auto }) as HTMLInputElement;
    this.auto.addEventListener('change', () => (crowdShow.auto = this.auto.checked));
    this.el = h(
      'div',
      { class: 'lights-col crowd-col' },
      h('h3', {}, 'You and the crowd'),
      pads,
      h('p', { class: 'note' }, 'Your moves on the decks. The front rows copy them, and a well-timed one lifts the room in a gig.'),
      h('label', { class: 'field' }, 'Signature move (on the big drops, and the whole room copies it)', this.sig),
      h('div', { class: 'field' }, 'Crowd moments', moments),
      h('label', { class: 'toggle-row' }, this.auto, 'Let the crowd start them when the room is right'),
      h('div', { class: 'field' }, 'Dancing', this.style),
      h('div', { class: 'field' }, 'Regulars', this.fans),
    );
    this.drawFans();
  }

  private drawFans(): void {
    const list = this.hooks.regulars();
    this.fans.replaceChildren(
      ...list.map((f) =>
        h(
          'li',
          { class: `crowd-fan${f.here ? '' : ' away'}`, style: `--fan:${f.color}`, title: `${f.name} loves ${f.style}. ${f.front ? 'At the front with a sign.' : f.here ? 'Comes to your sets.' : 'Not coming yet: play their music and play well.'}` },
          h('b', {}, f.name),
          h('span', { class: 'fan-style' }, f.style),
          h('span', { class: 'fan-bar', role: 'meter', 'aria-label': `${f.name}'s loyalty`, 'aria-valuenow': String(Math.round(f.loyalty * 100)) }, h('i', { style: `width:${Math.round(f.loyalty * 100)}%` })),
          f.front ? h('span', { class: 'fan-tag' }, 'Front row') : null,
        ),
      ),
    );
  }

  update(): void {
    for (const w of this.widgets) w.update();
    for (const [id, b] of this.momentBtns) setClass(b, 'active', crowdShow.moment?.id === id);
    if (this.auto.checked !== crowdShow.auto) this.auto.checked = crowdShow.auto;
    const g = crowdShow.genre;
    setText(this.style, `${styleName(crowdShow.style)}${g ? ` to ${g}` : ''}`);
    if (document.activeElement !== this.sig && this.sig.value !== this.hooks.signatureMove()) this.sig.value = this.hooks.signatureMove();
    // loyalty only changes after a set: a redraw every few seconds is plenty
    this.fansT++;
    if (this.fansT % 120 === 0) this.drawFans();
  }
}
