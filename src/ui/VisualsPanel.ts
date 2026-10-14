/* Visual player settings: modes, post-processing, intensity, lyrics, karaoke and AI lyrics. */
import { openVisualEditor } from './VisualEditor';
import { onMyVisuals } from '../visualizer/myvisual';
import type { Stage, StageView } from '../three/Stage';
import { LYRIC_STYLES } from '../visualizer/LyricsLayer';
import { Visualizer } from '../visualizer/Visualizer';
import type { Energy } from '../visualizer/kit';
import { describeLook } from '../visualizer/songLook';
import { clear, h, setClass } from './dom';
import type { LyricsAI } from '../lyrics/LyricsAI';
import { LISTEN_LANGUAGES, LISTEN_MODELS, type ListenQuality } from '../lyrics/aiModels';
import { openLyricsAiGuide, withAiLyrics } from './LyricsAiGuide';

const GROUPS: [Energy, string, string][] = [
  ['calm', 'Calm', 'Breakdowns and warm-ups'],
  ['mid', 'Groove', 'The body of the set'],
  ['peak', 'Peak', 'Drops and the big moments'],
];

export class VisualsPanel {
  readonly el: HTMLElement;
  private modeBtns = new Map<string, HTMLElement>();
  private viewBtns = new Map<StageView, HTMLElement>();
  private styleBtns = new Map<string, HTMLElement>();
  private lookLine: HTMLElement;
  private lookId = '';
  private hudInput: HTMLInputElement | null = null;
  private aiInputs: { auto: HTMLInputElement; quality: Map<ListenQuality, HTMLElement>; lang: HTMLSelectElement } | null = null;

  constructor(
    private stage: Stage,
    private onChange: () => void,
    private setView: (v: StageView, fullscreen?: boolean) => void,
    private ai?: LyricsAI,
  ) {
    const vis = stage.visualizer;
    // the modes in three groups by how hard they hit: the auto VJ uses the same groups
    const modes = h('div', { class: 'vis-groups' });
    for (const [energy, title, note] of GROUPS) {
      const grid = h('div', { class: 'vis-modes' });
      for (const m of Visualizer.modeInfo().filter((x) => x.energy === energy)) {
        const b = h('button', { class: 'vis-mode', type: 'button' }, h('b', {}, m.name), h('span', {}, m.blurb));
        b.addEventListener('click', () => {
          vis.setMode(m.id);
          this.onChange();
        });
        this.modeBtns.set(m.id, b);
        grid.append(b);
      }
      modes.append(h('section', { class: 'vis-group', 'data-energy': energy }, h('h4', {}, title, h('span', {}, note)), grid));
    }
    // your own visuals: make or edit them
    const make = h('button', { class: 'btn ghost', type: 'button', title: 'Build your own visual from layers' }, 'Make your own visual…');
    make.addEventListener('click', () => openVisualEditor({ show: (id) => (vis.setMode(id), this.onChange()) }));
    modes.prepend(h('div', { class: 'toggle-row' }, make));
    onMyVisuals(() => {
      for (const m of Visualizer.modeInfo()) {
        const b = this.modeBtns.get(m.id);
        const t = b?.querySelector('b');
        if (t && t.textContent !== m.name) t.textContent = m.name;
      }
    });
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
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void, id: string, title?: string) => {
      const inp = h('input', { type: 'checkbox', id }) as HTMLInputElement;
      inp.checked = get();
      inp.addEventListener('change', () => {
        set(inp.checked);
        this.onChange();
      });
      return h('label', { for: id, class: 'btn', style: { gap: '6px' }, title }, inp, label);
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
    // each song's look, and the music's layers over the picture
    this.lookLine = h('div', { class: 'vis-look note' }, 'Play a track and its look shows here.');
    const songBox = h(
      'div',
      { class: 'vis-song' },
      h('h3', {}, 'Follow the music'),
      h('p', { class: 'note' }, 'Every song gets its own colours and its own set of modes, picked from its key and genre. Over any mode, the drums, the melody and the vocal each light up the picture their own way.'),
      h(
        'div',
        { class: 'toggle-row' },
        toggle('Follow each song', () => s.songLooks, (v) => (s.songLooks = v), 'vis-song', 'Each song’s colours flow into every mode, and the auto VJ plays the modes that suit it'),
        toggle('Drums', () => s.layerDrums, (v) => (s.layerDrums = v), 'vis-l-drums', 'Kicks, snares and hats: punches, rings, light bars or a shatter, with sparkles on the hats'),
        toggle('Melody', () => s.layerMelody, (v) => (s.layerMelody = v), 'vis-l-melody', 'A ribbon, an aurora or an orbit that follows the notes, in the colour of the note'),
        toggle('Vocals', () => s.layerVocals, (v) => (s.layerVocals = v), 'vis-l-vocals', 'A halo, a wave or light rays while someone sings'),
      ),
      this.lookLine,
    );
    const lyricsBox = h(
      'div',
      { class: 'vis-lyrics' },
      h('h3', {}, 'Lyrics and karaoke'),
      h('p', { class: 'note' }, 'Timed lyrics show word by word on the LED walls, and as karaoke over the stage: the line being sung, each word filling with the deck’s colour as it’s sung, with both decks in a blend. Add lyrics from a deck’s ⋯ menu, or let the AI hear them.'),
      h('div', { class: 'toggle-row' }, h('span', { class: 'label' }, 'Style'), styleRow),
      h(
        'div',
        { class: 'toggle-row' },
        toggle('Show lyrics', () => s.lyrics, (v) => (s.lyrics = v), 'vis-lyr'),
        toggle('Hook lines fire strobes & haze', () => s.lyricHooks, (v) => (s.lyricHooks = v), 'vis-lyr-hooks'),
        toggle('Karaoke over the stage', () => s.lyricHud, (v) => (s.lyricHud = v), 'vis-lyr-hud', 'Shift+K'),
      ),
      this.aiBox(),
    );
    this.hudInput = lyricsBox.querySelector<HTMLInputElement>('#vis-lyr-hud');

    this.el = h(
      'div',
      { class: 'pane', style: { display: 'grid', gap: '14px' } },
      h(
        'div',
        {},
        h('h3', {}, 'Visual player'),
        h('p', { class: 'note' }, 'Plays on the venue screens, locked to the beat, always rotating through modes that fit the song: at its own pace, quicker after a drop, calm in a breakdown, drifting slowly between tracks. Pick a mode to put it up now; the rotation carries on from it.'),
      ),
      modes,
      h('div', { class: 'toggle-row' }, viewRow, full),
      h(
        'div',
        { class: 'toggle-row' },
        toggle('Bloom', () => s.bloom, (v) => (s.bloom = v), 'vis-bloom'),
        toggle('Chromatic aberration', () => s.aberration, (v) => (s.aberration = v), 'vis-ab'),
        toggle('Camera shake', () => s.shake, (v) => (s.shake = v), 'vis-shake'),
        toggle('Palette shift on drops', () => s.palette, (v) => (s.palette = v), 'vis-pal'),
        toggle('Reactive club lights', () => stage.reactiveLights, (v) => (stage.reactiveLights = v), 'vis-lights'),
      ),
      h('label', { class: 'field', for: 'vis-intensity', style: { maxWidth: '360px' } }, 'Reaction intensity', intensity),
      songBox,
      lyricsBox,
    );
  }

  /** AI lyrics: on or off for every track, the model, the language, the guide */
  private aiBox(): HTMLElement | null {
    const ai = this.ai;
    if (!ai) return null;
    const st = ai.settings;
    const auto = h('input', { type: 'checkbox', id: 'vis-ai-auto' }) as HTMLInputElement;
    auto.addEventListener('change', () => {
      if (auto.checked && !st.agreed) {
        auto.checked = false;
        // the guide explains the download first; turning it on there switches this on
        withAiLyrics(ai, () => {
          st.auto = true;
          ai.save();
        });
        return;
      }
      st.auto = auto.checked;
      ai.save();
    });
    const quality = new Map<ListenQuality, HTMLElement>();
    const qRow = h('div', { class: 'seg', role: 'group', 'aria-label': 'AI model' });
    for (const q of Object.values(LISTEN_MODELS)) {
      const b = h('button', { class: 'btn', type: 'button', title: `${q.note} (download ${q.size}, once)` }, q.name);
      b.addEventListener('click', () => {
        st.quality = q.id;
        ai.save();
      });
      quality.set(q.id, b);
      qRow.append(b);
    }
    const lang = h('select', { id: 'vis-ai-lang', 'aria-label': 'Language of the lyrics' }, ...LISTEN_LANGUAGES.map(([code, name]) => h('option', { value: code }, name))) as HTMLSelectElement;
    lang.addEventListener('change', () => {
      st.language = lang.value;
      ai.save();
    });
    this.aiInputs = { auto, quality, lang };
    const guide = h('button', { class: 'btn small', type: 'button' }, 'How AI lyrics works');
    guide.addEventListener('click', () => openLyricsAiGuide(ai));
    return h(
      'div',
      { class: 'vis-ai' },
      h('h3', {}, 'AI lyrics'),
      h('p', { class: 'note' }, 'The AI listens to songs with vocals, writes down the words and times each one, for the karaoke and the screens. It runs on this device: your music never leaves it.'),
      h('div', { class: 'toggle-row' }, h('label', { for: 'vis-ai-auto', class: 'btn', style: { gap: '6px' } }, auto, 'Listen to every track I load that has no lyrics'), guide),
      h('div', { class: 'toggle-row' }, h('span', { class: 'label' }, 'Model'), qRow, h('label', { class: 'label', for: 'vis-ai-lang' }, 'Language'), lang),
    );
  }

  update(): void {
    if (this.hudInput) {
      const s = this.stage.visualizer.settings;
      if (this.hudInput.checked !== s.lyricHud) this.hudInput.checked = s.lyricHud;
    }
    if (this.aiInputs && this.ai) {
      const st = this.ai.settings;
      const on = st.auto && st.agreed;
      if (this.aiInputs.auto.checked !== on) this.aiInputs.auto.checked = on;
      for (const [id, b] of this.aiInputs.quality) setClass(b, 'active', id === st.quality);
      if (this.aiInputs.lang.value !== st.language && document.activeElement !== this.aiInputs.lang) this.aiInputs.lang.value = st.language;
    }
    for (const [id, b] of this.modeBtns) setClass(b, 'active', id === this.stage.visualizer.modeId);
    for (const [v, b] of this.viewBtns) setClass(b, 'active', v === this.stage.view);
    for (const [id, b] of this.styleBtns) setClass(b, 'active', id === this.stage.visualizer.settings.lyricStyle);
    const look = this.stage.visualizer.look;
    if (look && look.id !== this.lookId) {
      this.lookId = look.id;
      clear(this.lookLine);
      this.lookLine.append(...look.colors.map((c) => h('i', { class: 'vis-swatch', style: { background: c } })), h('span', {}, describeLook(look)));
    }
  }
}
