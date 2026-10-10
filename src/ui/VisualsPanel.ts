/* Visual player settings: modes, post-processing, intensity. */
import type { Stage, StageView } from '../three/Stage';
import { LYRIC_STYLES } from '../visualizer/LyricsLayer';
import { Visualizer } from '../visualizer/Visualizer';
import { h, setClass } from './dom';

export class VisualsPanel {
  readonly el: HTMLElement;
  private modeBtns = new Map<string, HTMLElement>();
  private viewBtns = new Map<StageView, HTMLElement>();
  private styleBtns = new Map<string, HTMLElement>();

  constructor(
    private stage: Stage,
    private onChange: () => void,
    private setView: (v: StageView, fullscreen?: boolean) => void,
  ) {
    const vis = stage.visualizer;
    const modes = h('div', { class: 'vis-modes' });
    for (const m of Visualizer.modeInfo()) {
      const b = h('button', { class: 'vis-mode', type: 'button' }, h('b', {}, m.name), h('span', {}, m.blurb));
      b.addEventListener('click', () => {
        vis.setMode(m.id);
        this.onChange();
      });
      this.modeBtns.set(m.id, b);
      modes.append(b);
    }
    const views: [StageView, string][] = [
      ['booth', 'Booth (LED wall)'],
      ['split', 'Booth + picture-in-picture'],
      ['visual', 'Visuals only'],
    ];
    const viewRow = h('div', { class: 'seg' });
    for (const [v, label] of views) {
      const b = h('button', { class: 'btn' }, label);
      b.addEventListener('click', () => this.setView(v));
      this.viewBtns.set(v, b);
      viewRow.append(b);
    }
    const full = h('button', { class: 'btn primary' }, 'Full-screen visual player');
    full.addEventListener('click', () => this.setView('visual', true));

    const s = vis.settings;
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void, id: string) => {
      const inp = h('input', { type: 'checkbox', id }) as HTMLInputElement;
      inp.checked = get();
      inp.addEventListener('change', () => {
        set(inp.checked);
        this.onChange();
      });
      return h('label', { for: id, class: 'btn', style: { gap: '6px' } }, inp, label);
    };
    const intensity = h('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: s.intensity, id: 'vis-intensity', 'aria-label': 'Reaction intensity' }) as HTMLInputElement;
    intensity.addEventListener('input', () => {
      s.intensity = parseFloat(intensity.value);
      this.onChange();
    });

    const styleRow = h('div', { class: 'seg', role: 'group', 'aria-label': 'Lyric style' });
    for (const st of LYRIC_STYLES) {
      const b = h('button', { class: 'btn', type: 'button' }, st.name);
      b.addEventListener('click', () => {
        s.lyricStyle = st.id;
        this.onChange();
      });
      this.styleBtns.set(st.id, b);
      styleRow.append(b);
    }
    const lyricsBox = h(
      'div',
      { class: 'vis-lyrics' },
      h('h3', {}, 'Lyrics on the screens'),
      h('p', { class: 'note' }, 'Timed lyrics show word by word on the LED walls. Add lyrics from a deck’s ⋯ menu.'),
      h('div', { class: 'toggle-row' }, h('span', { class: 'label' }, 'Style'), styleRow),
      h(
        'div',
        { class: 'toggle-row' },
        toggle('Show lyrics', () => s.lyrics, (v) => (s.lyrics = v), 'vis-lyr'),
        toggle('Hook lines fire strobes & haze', () => s.lyricHooks, (v) => (s.lyricHooks = v), 'vis-lyr-hooks'),
        toggle('Subtitle over the booth', () => s.lyricHud, (v) => (s.lyricHud = v), 'vis-lyr-hud'),
      ),
    );

    this.el = h(
      'div',
      { class: 'pane', style: { display: 'grid', gap: '14px' } },
      h('div', {}, h('h3', {}, 'Visual player'), h('p', { class: 'note' }, 'Plays on the venue screens, locked to the beat.')),
      modes,
      h('div', { class: 'toggle-row' }, viewRow, full),
      h(
        'div',
        { class: 'toggle-row' },
        toggle('Bloom', () => s.bloom, (v) => (s.bloom = v), 'vis-bloom'),
        toggle('Chromatic aberration', () => s.aberration, (v) => (s.aberration = v), 'vis-ab'),
        toggle('Camera shake', () => s.shake, (v) => (s.shake = v), 'vis-shake'),
        toggle('Palette shift on drops', () => s.palette, (v) => (s.palette = v), 'vis-pal'),
        toggle('Auto-cycle modes', () => s.autoCycle, (v) => (s.autoCycle = v), 'vis-cycle'),
        toggle('Reactive club lights', () => stage.reactiveLights, (v) => (stage.reactiveLights = v), 'vis-lights'),
      ),
      h('label', { class: 'field', for: 'vis-intensity', style: { maxWidth: '360px' } }, 'Reaction intensity', intensity),
      lyricsBox,
    );
  }

  update(): void {
    for (const [id, b] of this.modeBtns) setClass(b, 'active', id === this.stage.visualizer.modeId);
    for (const [v, b] of this.viewBtns) setClass(b, 'active', v === this.stage.view);
    for (const [id, b] of this.styleBtns) setClass(b, 'active', id === this.stage.visualizer.settings.lyricStyle);
  }
}
