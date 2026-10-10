/* Beat FX unit + per-channel colour FX (resonant filter, bitcrusher). */
import type { AppContext } from '../app/context';
import { FX_BEATS, FX_LABELS, FX_PARAM_LABELS, FX_TYPES } from '../audio/fx/BeatFX';
import { beatLabel } from '../audio/Deck';
import { formatBpm } from '../core/util';
import { h, setText } from './dom';
import { hwButton, knob, type Widget } from './widgets';

export class FxPanel {
  readonly el: HTMLElement;
  private widgets: Widget[] = [];
  private dispName: HTMLElement;
  private dispBeat: HTMLElement;
  private dispBpm: HTMLElement;
  private paramLabel: HTMLElement;
  private chCards: HTMLElement[] = [];
  private targets: HTMLElement[] = [];

  constructor(private app: AppContext) {
    const reg = app.reg;
    const w = (x: Widget) => {
      this.widgets.push(x);
      return x.el;
    };
    this.dispName = h('span', { class: 'big' });
    this.dispBeat = h('span');
    this.dispBpm = h('span');
    const paramKnob = knob(reg, 'fx.param', 'Param', { size: 44, color: '#ff5fcf' });
    this.paramLabel = paramKnob.el.querySelector('.kl') as HTMLElement;
    const beatFx = h(
      'div',
      { class: 'card', style: { display: 'grid', gap: '10px' } },
      h('h3', {}, 'Beat FX'),
      h('div', { class: 'fx-display' }, this.dispName, h('span', {}, this.dispBeat, ' · ', this.dispBpm)),
      h('div', { class: 'fx-types' }, ...FX_TYPES.map((t) => w(hwButton(reg, `fx.type.${t}`, FX_LABELS[t])))),
      h(
        'div',
        { class: 'knob-row' },
        w(hwButton(reg, 'fx.beat.down', '◀ Beat')),
        w(hwButton(reg, 'fx.beat.up', 'Beat ▶')),
        w(knob(reg, 'fx.depth', 'Depth', { size: 44, color: '#ff3b5c' })),
        w(paramKnob),
        w(hwButton(reg, 'fx.on', 'FX On', { cls: 'big', color: '#ff3b5c' })),
      ),
      h('div', { class: 'label' }, 'Apply to'),
      h('div', { class: 'ctrl-row fx-targets' }, ...[1, 2, 3, 4].map((c) => w(hwButton(reg, `fx.target.${c}`, `Ch ${c}`))), w(hwButton(reg, 'fx.target.M', 'Master'))),
    );
    const colour = h('div', { class: 'card', style: { display: 'grid', gap: '10px' } }, h('h3', {}, 'Channel FX'));
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' } });
    for (let c = 1; c <= 4; c++) {
      const card = h(
        'div',
        { class: 'strip', style: { alignItems: 'stretch' } },
        h('div', { class: 'strip-head', style: { color: `var(--deck${c})` } }, `Ch ${c}`),
        h('div', { class: 'knob-row', style: { justifyContent: 'space-around' } }, w(knob(reg, `ch.${c}.filter`, 'Filter')), w(knob(reg, `ch.${c}.res`, 'Reso')), w(knob(reg, `ch.${c}.crush`, 'Crush'))),
      );
      this.chCards.push(card);
      grid.append(card);
    }
    colour.append(grid);
    this.targets = [...beatFx.querySelectorAll<HTMLElement>('.fx-targets > *')].slice(0, 4);
    this.el = h('div', { class: 'fx-grid' }, beatFx, colour);
  }

  update(): void {
    const fx = this.app.engine.fx;
    setText(this.dispName, FX_LABELS[fx.type]);
    setText(this.dispBeat, `${beatLabel(FX_BEATS[fx.beatIndex])} beat`);
    const d = this.app.engine.masterDeck;
    setText(this.dispBpm, d ? `${formatBpm(d.bpm)} BPM` : '120.0 BPM');
    setText(this.paramLabel, FX_PARAM_LABELS[fx.type]);
    const n = this.app.deckCount();
    this.chCards.forEach((c, i) => (c.hidden = i >= n));
    this.targets.forEach((t, i) => (t.hidden = i >= n));
    for (const w of this.widgets) w.update();
  }
}
