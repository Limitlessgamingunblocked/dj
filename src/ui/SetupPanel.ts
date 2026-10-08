/*
 * Settings: everything you can change, in one place, with a search box.
 * Appearance, decks, audio, board & camera, show, performance, keyboard and
 * your settings file (export / import / reset). MIDI follows in its own pane.
 */
import type { AppContext } from '../app/context';
import type { FaderCurve } from '../audio/Channel';
import { formatKey, makeKey } from '../analysis/keys';
import { clearAllSettings, makeBackup, parseBackup, readAllSettings, restoreSettings } from '../core/backup';
import { BEAT_CHOICES, DEFAULT_DECK_COLORS, KEY_NOTATIONS, onPrefs, prefs, setPrefs, TEMPO_RANGE_CHOICES, WAVE_SCHEMES, type Prefs } from '../core/prefs';
import { beatLabel } from '../audio/Deck';
import { LENS_LOOKS } from '../three/looks';
import type { Quality, Stage } from '../three/Stage';
import { clear, h } from './dom';
import { KeysEditor } from './keysTable';
import { openModal } from './modal';
import { toast } from './toast';

export { shortcutsTable } from './keysTable';

export interface SetupHooks {
  settings: { quality: Quality; autoQuality: boolean; autoGain: boolean; faderCurve: FaderCurve; uiMode: 'simple' | 'pro'; autoZoom: boolean };
  save(): void;
  pickBoard(): void;
  pickVenue(): void;
  stickers(): boolean;
  setStickers(v: boolean): void;
  setUiMode(m: 'simple' | 'pro'): void;
  setAutoZoom(v: boolean): void;
  /** the light show's settings changed (reduce flashing) */
  saveLights(): void;
  clearLibrary(): Promise<void>;
}

let uid = 0;

export class SetupPanel {
  readonly el: HTMLElement;
  private anchorsEl: HTMLElement;
  private audioInfo: HTMLElement;
  private cards: HTMLElement[] = [];
  /** controls that show a preference, refreshed when preferences change elsewhere (import, reset, the keyboard) */
  private syncs: (() => void)[] = [];
  private search: HTMLInputElement;
  /** other panes on the Settings tab the search also shows or hides as a whole (MIDI) */
  private extra: { el: HTMLElement; k: string }[] = [];

  constructor(
    private app: AppContext,
    private stage: Stage,
    private hooks: SetupHooks,
  ) {
    this.anchorsEl = h('div', { class: 'toggle-row' });
    this.audioInfo = h('p', { class: 'note set-row' });
    this.search = h('input', { type: 'search', class: 'search', placeholder: 'Search settings (e.g. key, colour, crowd, loop)', 'aria-label': 'Search settings' }) as HTMLInputElement;
    this.search.addEventListener('input', () => this.filter());
    this.search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && this.search.value) {
        this.search.value = '';
        this.filter();
      }
    });

    const grid = h('div', { class: 'cards settings-cards' }, this.appearance(), this.decks(), this.audio(), this.boardCamera(), this.show(), this.performance(), this.data(), this.keyboard());
    this.el = h('div', { class: 'pane settings-pane' }, h('div', { class: 'settings-search' }, this.search), grid);
    onPrefs(() => this.syncs.forEach((f) => f()));
    this.renderAnchors();
  }

  /* ------------------------------------------------------------------ */
  /* building blocks                                                      */
  /* ------------------------------------------------------------------ */

  private card(title: string, keywords: string, ...rows: (HTMLElement | null)[]): HTMLElement {
    const c = h('div', { class: 'card settings-card', 'data-k': `${title} ${keywords}`.toLowerCase() }, h('h3', {}, title), ...rows.filter((r): r is HTMLElement => !!r));
    this.cards.push(c);
    return c;
  }

  /** a labelled control on its own row; `k` adds search words */
  private row(label: string, control: HTMLElement, k = '', hint = ''): HTMLElement {
    // the label points at the input itself (a slider row wraps it with its readout)
    const target = control.matches('input, select, textarea') ? control : control.querySelector('input, select, textarea');
    const id = target ? target.id || `set-${++uid}` : '';
    if (target) target.id = id;
    return h('div', { class: 'set-row field', 'data-k': `${label} ${k} ${hint}`.toLowerCase() }, h('label', { for: id || undefined }, label), control, hint ? h('span', { class: 'hint' }, hint) : '');
  }

  private check(label: string, get: () => boolean, set: (v: boolean) => void, k = '', hint = ''): HTMLElement {
    const id = `set-${++uid}`;
    const inp = h('input', { type: 'checkbox', id }) as HTMLInputElement;
    inp.checked = get();
    inp.addEventListener('change', () => set(inp.checked));
    this.syncs.push(() => (inp.checked = get()));
    return h('div', { class: 'set-row', 'data-k': `${label} ${k} ${hint}`.toLowerCase() }, h('label', { class: 'check-row', for: id }, inp, h('span', {}, label)), hint ? h('span', { class: 'hint' }, hint) : '');
  }

  private select<T extends string | number>(options: [T, string][], get: () => T, set: (v: T) => void): HTMLSelectElement {
    const sel = h('select', {}, ...options.map(([v, label]) => h('option', { value: String(v) }, label))) as HTMLSelectElement;
    const sync = () => (sel.value = String(get()));
    sync();
    sel.addEventListener('change', () => {
      const o = options.find(([v]) => String(v) === sel.value);
      if (o) set(o[0]);
    });
    this.syncs.push(sync);
    return sel;
  }

  private prefSelect<K extends keyof Prefs>(key: K, options: [Prefs[K] & (string | number), string][]): HTMLSelectElement {
    return this.select(options, () => prefs[key] as Prefs[K] & (string | number), (v) => setPrefs({ [key]: v } as Partial<Prefs>));
  }

  private prefCheck<K extends keyof Prefs>(key: K, label: string, k = '', hint = ''): HTMLElement {
    return this.check(label, () => prefs[key] as boolean, (v) => setPrefs({ [key]: v } as Partial<Prefs>), k, hint);
  }

  /** a slider that shows its value and applies when let go */
  private slider(get: () => number, set: (v: number) => void, o: { min: number; max: number; step: number; fmt: (v: number) => string }): HTMLElement {
    const inp = h('input', { type: 'range', min: o.min, max: o.max, step: o.step }) as HTMLInputElement;
    const out = h('output', { class: 'mono' });
    const show = () => (out.textContent = o.fmt(parseFloat(inp.value)));
    const sync = () => {
      inp.value = String(get());
      show();
    };
    sync();
    inp.addEventListener('input', show);
    inp.addEventListener('change', () => set(parseFloat(inp.value)));
    this.syncs.push(sync);
    return h('div', { class: 'slider-row' }, inp, out);
  }

  private colour(get: () => string, set: (v: string) => void, label: string): HTMLInputElement {
    const inp = h('input', { type: 'color', 'aria-label': label, title: label }) as HTMLInputElement;
    inp.value = get();
    inp.addEventListener('change', () => set(inp.value));
    this.syncs.push(() => {
      if (document.activeElement !== inp) inp.value = get();
    });
    return inp;
  }

  /* ------------------------------------------------------------------ */
  /* sections                                                             */
  /* ------------------------------------------------------------------ */

  private appearance(): HTMLElement {
    const s = this.hooks.settings;
    const size = this.slider(() => prefs.uiScale, (v) => setPrefs({ uiScale: v }), { min: 0.8, max: 1.3, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` });
    const layout = this.select<'simple' | 'pro'>(
      [
        ['simple', 'Simple — the essentials on the deck panels'],
        ['pro', 'Pro — pads, loops, key and stems too'],
      ],
      () => s.uiMode,
      (m) => this.hooks.setUiMode(m),
    );
    const follow = this.check('Follow the venue', () => !prefs.accent, (v) => setPrefs({ accent: v ? '' : getComputedStyle(document.documentElement).getPropertyValue('--venue').trim() || '#ff5a2a' }), 'accent colour');
    const accent = this.colour(() => prefs.accent || getComputedStyle(document.documentElement).getPropertyValue('--venue').trim() || '#ff5a2a', (v) => setPrefs({ accent: v }), 'Accent colour');
    const deckCols = h('div', { class: 'toggle-row' }, ...[0, 1, 2, 3].map((i) => h('span', { class: 'toggle-row deck-col' }, h('span', { class: 'label' }, String(i + 1)), this.colour(() => prefs.deckColors[i], (v) => setPrefs({ deckColors: prefs.deckColors.map((c, j) => (j === i ? v : c)) as Prefs['deckColors'] }), `Deck ${i + 1} colour`))));
    const resetCols = h('button', { class: 'btn small ghost', type: 'button' }, 'Default colours');
    resetCols.addEventListener('click', () => setPrefs({ deckColors: [...DEFAULT_DECK_COLORS], accent: '' }));
    deckCols.append(resetCols);
    const am = makeKey(9, true);
    const notation = this.prefSelect(
      'keyNotation',
      KEY_NOTATIONS.map((n) => [n.id, `${n.name} (${formatKey(am, n.id)})`]),
    );
    const wave = this.prefSelect(
      'waveScheme',
      WAVE_SCHEMES.map((w) => [w.id, w.name]),
    );
    return this.card(
      'Appearance',
      'look theme colours color size zoom scale text',
      this.row('Interface size', size, 'text bigger smaller zoom scale', 'The panels around the stage; the 3D board keeps its own size.'),
      this.row('Layout', layout, 'simple pro'),
      h('div', { class: 'set-row field', 'data-k': 'accent colour color highlight venue' }, h('span', {}, 'Accent colour'), h('div', { class: 'toggle-row' }, accent, follow)),
      h('div', { class: 'set-row field', 'data-k': 'deck colours colors' }, h('span', {}, 'Deck colours'), deckCols),
      this.row('Key notation', notation, 'camelot open key musical harmonic', 'Library, decks, Set Builder and the board screens.'),
      this.row('Waveform colours', wave, 'waveform rgb 3-band blue colour color'),
    );
  }

  private decks(): HTMLElement {
    const pct = (r: number) => `±${Math.round(r * 100)}%`;
    return this.card(
      'Decks',
      'deck defaults behaviour player cdj',
      this.row('Tempo range', this.prefSelect('tempoRange', TEMPO_RANGE_CHOICES.map((r) => [r, r === 1 ? '±100% (wide)' : pct(r)])), 'pitch fader range'),
      this.row(
        'Jog wheels',
        this.prefSelect('jogMode', [
          ['vinyl', 'Vinyl — the top scratches'],
          ['cdj', 'CDJ — the top bends the pitch'],
        ]),
        'jog vinyl scratch cdj bend',
      ),
      this.row('Loop size', this.prefSelect('loopBeats', BEAT_CHOICES.map((b) => [b, `${beatLabel(b)} beat${b === 1 ? '' : 's'}`])), 'auto loop beats'),
      this.row('Beat jump', this.prefSelect('jumpBeats', BEAT_CHOICES.map((b) => [b, `${beatLabel(b)} beat${b === 1 ? '' : 's'}`])), 'jump beats'),
      this.prefCheck('keylock', 'Key lock (master tempo): tempo changes keep the key', 'keylock master tempo pitch'),
      this.prefCheck('quantize', 'Quantize: cues, loops and jumps land on the beat', 'quantize snap grid'),
      this.row(
        'End-of-track warning',
        this.prefSelect('endWarning', [
          [0, 'Off'],
          [15, 'Last 15 seconds'],
          [30, 'Last 30 seconds'],
          [45, 'Last 45 seconds'],
          [60, 'Last minute'],
          [90, 'Last 90 seconds'],
        ]),
        'ending remaining time blink',
        'The time and overview blink red, on screen and on the board.',
      ),
      this.prefCheck('loadLock', 'Don’t load onto a deck that is playing', 'load lock playing safety'),
      h('p', { class: 'note set-row', 'data-k': 'decks defaults' }, 'These apply to every deck straight away; the buttons on a deck still change it for the moment.'),
    );
  }

  private audio(): HTMLElement {
    const s = this.hooks.settings;
    const engine = this.app.engine;
    const curve = this.select<FaderCurve>(
      [
        ['log', 'Logarithmic (smooth)'],
        ['linear', 'Linear'],
        ['fast', 'Fast (scratch)'],
      ],
      () => s.faderCurve,
      (v) => {
        s.faderCurve = v;
        for (const ch of engine.channels) {
          ch.faderCurve = v;
          ch.setFader(ch.state.fader);
        }
        this.hooks.save();
      },
    );
    const phonesSel = h('select', { 'aria-label': 'Headphone output device' }, h('option', { value: '' }, 'Same as main output')) as HTMLSelectElement;
    const findDevices = h('button', { class: 'btn small', type: 'button' }, 'Find outputs');
    findDevices.addEventListener('click', async () => {
      try {
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
        clear(phonesSel);
        phonesSel.append(h('option', { value: '' }, 'Same as main output'));
        devs.forEach((d, i) => phonesSel.append(h('option', { value: d.deviceId }, d.label || `Output ${i + 1}`)));
        toast(devs.length ? `${devs.length} output device(s) found` : 'No extra outputs are exposed by this browser');
      } catch {
        toast('This browser does not list audio outputs here', 'error');
      }
    });
    phonesSel.addEventListener('change', async () => {
      const ok = await engine.mixer.setPhonesDevice(phonesSel.value || null);
      if (!ok) toast('Could not route headphones to that device. Use split cue with a splitter cable instead.', 'error');
    });
    const phones = h('div', { class: 'toggle-row' }, phonesSel, findDevices);
    return this.card(
      'Audio',
      'sound output latency headphones cue gain',
      this.audioInfo,
      this.check(
        'Auto gain: match track loudness on load',
        () => s.autoGain,
        (v) => {
          s.autoGain = v;
          engine.autoGain = v;
          this.hooks.save();
        },
        'loudness level',
      ),
      this.row('Channel fader curve', curve, 'fader curve'),
      this.check('Split cue: master left, headphone cue right', () => engine.mixer.split, (v) => engine.mixer.setSplit(v), 'headphones mono'),
      this.row('Headphone output (Chrome/Edge)', phones, 'headphones device output cue'),
    );
  }

  private boardCamera(): HTMLElement {
    const s = this.hooks.settings;
    const board = h('button', { class: 'btn primary', type: 'button' }, 'Choose board & finish');
    board.addEventListener('click', () => this.hooks.pickBoard());
    const anchorName = h('input', { class: 'search', placeholder: 'Name this camera view', style: { maxWidth: '220px' }, 'aria-label': 'Camera view name' }) as HTMLInputElement;
    anchorName.addEventListener('keydown', (e) => e.stopPropagation());
    const saveAnchor = h('button', { class: 'btn', type: 'button' }, 'Save current view');
    saveAnchor.addEventListener('click', () => {
      const name = anchorName.value.trim() || `View ${this.stage.rig.anchors().length + 1}`;
      this.stage.rig.saveAnchor(name);
      anchorName.value = '';
      toast(`Saved camera view “${name}”`);
      this.renderAnchors();
    });
    return this.card(
      'Board & camera',
      'hardware controller cdj mixer turntable view camera',
      h('div', { class: 'set-row', 'data-k': 'board finish controller hardware' }, board),
      this.check('Old stickers and gaffer tape on the hardware', () => this.hooks.stickers(), (v) => this.hooks.setStickers(v), 'stickers worn'),
      this.check(
        'Zoom in on the part of the board under the pointer',
        () => s.autoZoom,
        (v) => this.hooks.setAutoZoom(v),
        'hover zoom auto',
      ),
      this.prefCheck('cameraMotion', 'Camera moves with the music (idle sway, beat shake)', 'motion sway shake', 'Always off when your system asks for reduced motion.'),
      this.row('Lens effect', this.prefSelect('lens', [['auto', 'Auto — each angle brings its own'], ...LENS_LOOKS.map((l): [Prefs['lens'], string] => [l.id, l.name])]), 'lens fisheye vhs camcorder security cctv tilt-shift miniature cinematic thermal night vision effect filter', 'The fisheye, camcorder and security-camera angles bring their own look on Auto.'),
      h('div', { class: 'set-row field', 'data-k': 'saved camera views anchors' }, h('span', {}, 'Saved camera views'), h('div', { class: 'toggle-row' }, anchorName, saveAnchor), this.anchorsEl),
      h('p', { class: 'note set-row', 'data-k': 'orbit pan zoom drag' }, 'Switch views from the camera menu on the stage. Drag empty space to orbit, right-drag or two fingers to pan, scroll or pinch to zoom.'),
    );
  }

  private show(): HTMLElement {
    const c = this.stage.show.controls;
    const crowd = this.slider(() => prefs.crowd, (v) => setPrefs({ crowd: v }), { min: 0, max: 1.5, step: 0.05, fmt: (v) => (v === 0 ? 'Empty' : `${Math.round(v * 100)}%`) });
    const venue = h('button', { class: 'btn', type: 'button' }, 'Choose venue…');
    venue.addEventListener('click', () => this.hooks.pickVenue());
    return this.card(
      'Show & venue',
      'lights club crowd people',
      h('div', { class: 'set-row', 'data-k': 'venue club' }, venue),
      this.row('Crowd size', crowd, 'people audience dancers busy packed empty', 'Fewer people is also lighter on slow computers.'),
      this.check(
        'Reduce flashing (under 3 flashes a second, softer)',
        () => c.reduceFlash,
        (v) => {
          c.reduceFlash = v;
          this.hooks.saveLights();
        },
        'strobe epilepsy photosensitive flash',
      ),
      h('p', { class: 'note set-row', 'data-k': 'palette colours lights' }, 'Light colours (including your own Custom palette), lasers and haze are on the Show tab.'),
    );
  }

  private performance(): HTMLElement {
    const s = this.hooks.settings;
    const quality = this.select<Quality>(
      [
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High'],
      ],
      () => s.quality,
      (q) => {
        s.quality = q;
        this.stage.setQuality(q);
        this.hooks.save();
      },
    );
    return this.card(
      'Performance',
      'graphics speed fps smooth slow',
      this.row('Graphics quality', quality, 'graphics resolution shadows bloom'),
      this.check(
        'Adjust automatically to keep it smooth',
        () => s.autoQuality,
        (v) => {
          s.autoQuality = v;
          this.stage.adaptive.enabled = v;
          this.stage.setQuality(s.quality);
          this.hooks.save();
        },
        'adaptive auto quality',
      ),
      h('p', { class: 'note set-row', 'data-k': 'quality low medium high' }, 'The quality you pick is the ceiling. With automatic adjustment on, resolution, crowd detail and effects step down when frames run long and come back when there is headroom. Low turns off shadows, bloom, multisampling and lens effects — use it on older laptops and phones.'),
    );
  }

  private data(): HTMLElement {
    const exp = h('button', { class: 'btn', type: 'button' }, 'Export settings…');
    exp.addEventListener('click', () => this.exportSettings());
    const imp = h('button', { class: 'btn', type: 'button' }, 'Import settings…');
    imp.addEventListener('click', () => this.importSettings());
    const reset = h('button', { class: 'btn danger', type: 'button' }, 'Reset settings…');
    reset.addEventListener('click', () =>
      this.confirm('Reset all settings?', 'Layout, preferences, keyboard shortcuts, MIDI mappings and saved camera views go back to the defaults, and the page reloads. Your music library stays.', 'Reset and reload', () => {
        clearAllSettings();
        location.reload();
      }),
    );
    const clearLib = h('button', { class: 'btn danger', type: 'button' }, 'Remove imported tracks…');
    clearLib.addEventListener('click', () =>
      this.confirm('Remove imported tracks?', 'Imported audio, analysis and cue points stored in this browser will be deleted. Demo tracks stay.', 'Remove all imported tracks', async () => {
        await this.hooks.clearLibrary();
        toast('Imported tracks removed');
      }),
    );
    return this.card(
      'Your settings',
      'backup export import reset restore file library storage',
      h('div', { class: 'set-row toggle-row', 'data-k': 'export import backup file' }, exp, imp),
      h('p', { class: 'note set-row', 'data-k': 'export import backup' }, 'Save everything you set here — keyboard shortcuts and MIDI mappings included — to a file, and load it in another browser.'),
      h('div', { class: 'set-row toggle-row', 'data-k': 'reset defaults remove clear library tracks' }, reset, clearLib),
    );
  }

  private keyboard(): HTMLElement {
    const ed = new KeysEditor();
    const c = this.card('Keyboard shortcuts', 'keys keyboard shortcut hotkey remap bind', ed.el);
    c.classList.add('wide');
    return c;
  }

  /* ------------------------------------------------------------------ */
  /* search, backup                                                       */
  /* ------------------------------------------------------------------ */

  private filter(): void {
    const words = this.search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (el: Element) => {
      const text = `${el.getAttribute('data-k') ?? ''} ${el.textContent ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    };
    for (const card of this.cards) {
      const rows = [...card.querySelectorAll<HTMLElement>('.set-row')];
      // the matching rows; a section whose name matches but no row does shows whole
      const hits = new Set(rows.filter((r) => !words.length || hit(r)));
      const whole = !hits.size && words.length > 0 && words.every((w) => (card.getAttribute('data-k') ?? '').includes(w));
      for (const r of rows) r.hidden = !(whole || hits.has(r));
      card.hidden = !whole && !hits.size;
    }
    for (const x of this.extra) x.el.hidden = words.length > 0 && !words.every((w) => `${x.k} ${x.el.textContent ?? ''}`.toLowerCase().includes(w));
  }

  /** include another pane in the search */
  searchAlso(el: HTMLElement, keywords: string): void {
    this.extra.push({ el, k: keywords.toLowerCase() });
  }

  private confirm(title: string, text: string, yesLabel: string, yes: () => void | Promise<void>): void {
    const ok = h('button', { class: 'btn danger', type: 'button' }, yesLabel);
    const no = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    const m = openModal(title, h('div', {}, h('p', { class: 'note' }, text), h('div', { style: { display: 'flex', gap: '8px' } }, ok, no)));
    ok.addEventListener('click', async () => {
      await yes();
      m.close();
    });
    no.addEventListener('click', () => m.close());
  }

  private exportSettings(): void {
    const text = JSON.stringify(makeBackup(readAllSettings()), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const name = `deckhouse-settings-${new Date().toISOString().slice(0, 10)}.json`;
    const link = h('a', { class: 'btn primary', href: url, download: name }, 'Save settings file');
    const copy = h('button', { class: 'btn', type: 'button' }, 'Copy as text');
    copy.addEventListener('click', () =>
      navigator.clipboard?.writeText(text).then(
        () => toast('Settings copied'),
        () => toast('Copying isn’t allowed here. Use the file instead.', 'error'),
      ),
    );
    const m = openModal('Export settings', h('div', { style: { display: 'grid', gap: '10px' } }, h('p', { class: 'note' }, 'Layout, preferences, keyboard shortcuts, MIDI mappings, saved camera views and Set Builder options. Your music isn’t included.'), h('div', { class: 'toggle-row' }, link, copy), h('p', { class: 'note' }, 'If the save button does nothing (some embedded viewers block downloads), copy the text and paste it into Import settings on the other side.')));
    link.addEventListener('click', () => setTimeout(() => m.close(), 300));
  }

  private importSettings(): void {
    const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Settings file' }) as HTMLInputElement;
    const paste = h('textarea', { rows: 5, placeholder: '…or paste the settings text here', 'aria-label': 'Settings text', style: { width: '100%', fontFamily: 'var(--font-mono)', fontSize: '12px' } }) as HTMLTextAreaElement;
    paste.addEventListener('keydown', (e) => e.stopPropagation());
    const go = h('button', { class: 'btn primary', type: 'button' }, 'Import and reload');
    const m = openModal('Import settings', h('div', { style: { display: 'grid', gap: '10px' } }, h('p', { class: 'note' }, 'This replaces your current settings (not your music) with the ones in the file, then reloads the page.'), file, paste, h('div', {}, go)));
    const apply = (text: string) => {
      try {
        const entries = parseBackup(text);
        if (!restoreSettings(entries)) throw new Error('This browser isn’t letting the page save settings (private mode?).');
        m.close();
        toast('Settings imported — reloading…');
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
      }
    };
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) apply(await f.text());
    });
    go.addEventListener('click', () => (paste.value.trim() ? apply(paste.value) : toast('Choose a settings file or paste its text first.')));
  }

  private renderAnchors(): void {
    clear(this.anchorsEl);
    for (const a of this.stage.rig.anchors()) {
      const go = h('button', { class: 'btn small', type: 'button' }, `★ ${a.name}`);
      go.addEventListener('click', () => this.stage.rig.goToAnchor(a));
      const del = h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Delete ${a.name}` }, '×');
      del.addEventListener('click', () => {
        this.stage.rig.deleteAnchor(a.name);
        this.renderAnchors();
      });
      this.anchorsEl.append(h('span', { class: 'toggle-row' }, go, del));
    }
  }

  refresh(): void {
    this.renderAnchors();
    this.syncs.forEach((f) => f());
  }

  update(): void {
    const e = this.app.engine;
    const ctx = e.ctx;
    const lat = ((ctx.baseLatency || 0) + ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0)) * 1000;
    const text = `${ctx.sampleRate} Hz · output latency ≈ ${lat.toFixed(0)} ms · DSP: ${e.wasmAvailable ? 'WebAssembly (key lock, stems, pitch FX)' : 'JavaScript only (key lock and stems off)'} · ${ctx.state}`;
    if (this.audioInfo.textContent !== text) this.audioInfo.textContent = text;
  }
}
