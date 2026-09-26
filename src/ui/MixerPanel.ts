/* Software mixer: all channel strips, crossfader with curve, master and headphones. */
import type { AppContext } from '../app/context';
import { DECK_COLORS, type DeckId } from '../core/types';
import { h } from './dom';
import { fader, hwButton, knob, VuMeter, type Widget } from './widgets';

export class MixerPanel {
  readonly el: HTMLElement;
  private widgets: Widget[] = [];
  private meters: VuMeter[] = [];
  private masterVu = new VuMeter(18);
  private strips: HTMLElement[] = [];

  constructor(private app: AppContext) {
    const reg = app.reg;
    const w = (x: Widget) => {
      this.widgets.push(x);
      return x.el;
    };
    const wrap = h('div', { class: 'soft-mixer' });
    for (let c = 1; c <= 4; c++) {
      const vu = new VuMeter(15);
      this.meters.push(vu);
      const strip = h(
        'div',
        { class: 'strip' },
        h('div', { class: 'strip-head' }, `CH ${c}`),
        w(knob(reg, `ch.${c}.trim`, 'Trim')),
        w(knob(reg, `ch.${c}.hi`, 'Hi')),
        w(knob(reg, `ch.${c}.mid`, 'Mid')),
        w(knob(reg, `ch.${c}.low`, 'Low')),
        w(knob(reg, `ch.${c}.filter`, 'Filter')),
        w(hwButton(reg, `ch.${c}.cue`, 'Cue', { color: '#ff9f1c' })),
        h('div', { class: 'fader-row' }, vu.el, w(fader(reg, `ch.${c}.fader`, { orientation: 'v', length: 130, label: `Channel ${c} fader` }))),
        w(hwButton(reg, `ch.${c}.assign`, 'A·B', { title: 'Crossfader assign: A / THRU / B' })),
      );
      strip.style.setProperty('--deck', DECK_COLORS[c as DeckId]);
      this.strips.push(strip);
      wrap.append(strip);
    }
    const master = h(
      'div',
      { class: 'master-strip' },
      h('div', { class: 'label' }, 'Master'),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'stretch', height: '120px' } }, this.masterVu.el, h('div', { class: 'ctrl-block' }, w(knob(reg, 'mixer.master', 'Master', { size: 46 })), w(knob(reg, 'mixer.sampler', 'Sampler')))),
      h('div', { class: 'label' }, 'Headphones'),
      h('div', { class: 'knob-row' }, w(knob(reg, 'mixer.cuemix', 'Cue ⇄ Mst')), w(knob(reg, 'mixer.phones', 'Level'))),
      h('div', { class: 'ctrl-row' }, w(hwButton(reg, 'mixer.split', 'Split cue', { title: 'Master on the left channel, cue on the right (for a splitter cable)' }))),
    );
    const xf = h(
      'div',
      { class: 'xfader-box' },
      h('div', { class: 'label' }, 'Crossfader'),
      w(fader(reg, 'mixer.xfader', { orientation: 'h', length: 220, label: 'Crossfader', center: true })),
      h('div', { class: 'knob-row' }, w(knob(reg, 'mixer.xcurve', 'Curve')), w(hwButton(reg, 'mixer.hamster', 'Reverse', { title: 'Hamster (reverse) crossfader' }))),
      h('p', { class: 'note', style: { maxWidth: '220px' } }, 'Curve left = smooth blend, right = sharp scratch cut.'),
    );
    wrap.append(master, xf);
    this.el = wrap;
  }

  update(dt: number, meters: { ch: [number, number][]; master: [number, number] }): void {
    const n = this.app.deckCount();
    this.strips.forEach((s, i) => (s.hidden = i >= n));
    for (let i = 0; i < n; i++) this.meters[i].set(meters.ch[i], dt);
    this.masterVu.set(meters.master, dt);
    for (const w of this.widgets) w.update();
  }
}
