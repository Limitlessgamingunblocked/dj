/* Per-deck stem levels (vocal / drums / bass / melody). */
import type { AppContext } from '../app/context';
import { DECK_COLORS, type DeckId } from '../core/types';
import { h } from './dom';
import { hwButton, knob, type Widget } from './widgets';

const STEMS = ['vocal', 'drums', 'bass', 'melody'] as const;

export class StemsPanel {
  readonly el: HTMLElement;
  private widgets: Widget[] = [];
  private cards: HTMLElement[] = [];

  constructor(private app: AppContext) {
    const reg = app.reg;
    const w = (x: Widget) => {
      this.widgets.push(x);
      return x.el;
    };
    const grid = h('div', { class: 'stems-grid' });
    for (let d = 1; d <= 4; d++) {
      const deck = app.engine.deck(d);
      const preset = (label: string, v: [number, number, number, number]) => {
        const b = h('button', { class: 'btn small' }, label);
        b.addEventListener('click', () => deck.setStems({ vocal: v[0], drums: v[1], bass: v[2], melody: v[3] }));
        return b;
      };
      const card = h(
        'div',
        { class: 'card', style: { display: 'grid', gap: '10px' } },
        h('h3', { style: { color: DECK_COLORS[d as DeckId] } }, `Deck ${d} stems`),
        h(
          'div',
          { class: 'knob-row', style: { justifyContent: 'space-between' } },
          ...STEMS.map((s) => h('div', { class: 'ctrl-block', style: { alignItems: 'center' } }, w(knob(reg, `deck.${d}.stem.${s}`, s, { size: 44, color: DECK_COLORS[d as DeckId] })), w(hwButton(reg, `deck.${d}.stem.${s}.mute`, 'Mute')))),
        ),
        h('div', { class: 'ctrl-row' }, preset('Full mix', [1, 1, 1, 1]), preset('Acapella', [1, 0, 0, 0]), preset('Instrumental', [0, 1, 1, 1]), preset('Drums only', [0, 1, 0, 0]), preset('No bass', [1, 1, 0, 1])),
      );
      this.cards.push(card);
      grid.append(card);
    }
    const note = app.engine.wasmAvailable
      ? 'Real-time separation runs in WebAssembly: harmonic/percussive median filtering splits drums from tonal parts, then spectral band and stereo-centre masks separate bass, vocals and melody. It is a DSP approximation, not a neural model, so expect some bleed between stems.'
      : 'Stem separation needs WebAssembly, which this browser or page policy blocks.';
    this.el = h('div', {}, h('div', { class: 'pane', style: { paddingBottom: '0' } }, h('p', { class: 'note' }, note)), grid);
  }

  update(): void {
    const n = this.app.deckCount();
    this.cards.forEach((c, i) => (c.hidden = i >= n));
    for (const w of this.widgets) w.update();
  }
}
