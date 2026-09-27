/*
 * Application shell: creates the audio engine, library, control registry,
 * 3D stage + visual player and the software UI, and runs the frame loop.
 */
import { AudioEngine } from '../audio/AudioEngine';
import type { FaderCurve } from '../audio/Channel';
import { SAMPLE_NAMES } from '../audio/synth';
import { AnalysisPool } from '../analysis/AnalysisPool';
import { ControlRegistry } from '../core/controls';
import { Emitter } from '../core/emitter';
import { loadSetting, saveSetting } from '../core/settings';
import type { LibraryTrack, PcmData } from '../core/types';
import { clamp } from '../core/util';
import { isAudioFile, Library } from '../library/Library';
import type { LyricLine } from '../lyrics/lyrics';
import { LyricsEngine } from '../lyrics/LyricsEngine';
import { MidiManager } from '../midi/MidiManager';
import { boardById, isTurntable, type BoardDef } from '../three/boards';
import { venueById } from '../three/venues';
import type { ShowControls } from '../three/venues/show';
import { LightsPanel } from '../ui/LightsPanel';
import { openVenuePicker } from '../ui/VenuePicker';
import { Hype, type Callout } from './Hype';
import { registerLightControls } from './lightControls';
import { VIEW_LABELS, type ViewId } from '../three/CameraRig';
import { Stage, type Quality, type StageView } from '../three/Stage';
import { AudioFeatures } from '../visualizer/AudioFeatures';
import type { VisSettings } from '../visualizer/Visualizer';
import { openBoardPicker } from '../ui/BoardPicker';
import { DeckPanel } from '../ui/DeckPanel';
import { h, setText } from '../ui/dom';
import { FxPanel } from '../ui/FxPanel';
import { openHelp } from '../ui/help';
import { LibraryPanel } from '../ui/LibraryPanel';
import { MidiPanel } from '../ui/MidiPanel';
import { MixerPanel } from '../ui/MixerPanel';
import { contextMenu, openModal } from '../ui/modal';
import { SamplerPanel } from '../ui/SamplerPanel';
import { SetBuilderPanel } from '../ui/SetBuilderPanel';
import { SetupPanel } from '../ui/SetupPanel';
import { toast } from '../ui/toast';
import { TopBar } from '../ui/TopBar';
import { VisualsPanel } from '../ui/VisualsPanel';
import { WaveStrip } from '../ui/WaveStrip';
import type { AppContext, AppEvents } from './context';
import { registerControls } from './controlDefs';
import { bindKeyboard } from './keyboard';

interface Settings {
  board: string;
  finish: string;
  venue: string;
  view: StageView;
  camera: ViewId;
  quality: Quality;
  autoGain: boolean;
  faderCurve: FaderCurve;
  dockHeight: number;
  tab: string;
  vis: Partial<VisSettings>;
  focus: boolean;
  reactiveLights: boolean;
  autoZoom: boolean;
  stickers: boolean;
  lights: Partial<ShowControls>;
}

const DEFAULTS: Settings = {
  board: 'club4',
  finish: 'booth',
  venue: 'dc10',
  view: 'booth',
  camera: 'perf',
  quality: 'medium',
  autoGain: true,
  faderCurve: 'log',
  dockHeight: 0,
  tab: 'library',
  vis: {},
  focus: false,
  reactiveLights: true,
  autoZoom: true,
  stickers: true,
  lights: {},
};

const LIGHT_KEYS = ['auto', 'intensity', 'palette', 'lasers', 'laserPattern', 'dropFx', 'smoke'] as const;

type TabId = 'library' | 'sets' | 'mixer' | 'lights' | 'sampler' | 'visuals' | 'settings';

export class App implements AppContext {
  engine!: AudioEngine;
  readonly reg = new ControlRegistry();
  library!: Library;
  readonly events = new Emitter<AppEvents>();
  private pool!: AnalysisPool;
  private stage!: Stage;
  private features!: AudioFeatures;
  private midi!: MidiManager;
  private settings: Settings = { ...DEFAULTS, ...loadSetting<Partial<Settings>>('settings', {}) };
  private boardDef: BoardDef = boardById(this.settings.board);
  private selected: LibraryTrack | null = null;
  private shell!: HTMLElement;
  private topbar!: TopBar;
  private wave!: WaveStrip;
  private decksUi: DeckPanel[] = [];
  private tabs = new Map<TabId, { btn: HTMLButtonElement; body: HTMLElement; update?: (dt: number) => void; count?: HTMLElement }>();
  private tab: TabId = 'library';
  private libPanel!: LibraryPanel;
  private setupPanel!: SetupPanel;
  private meters = { ch: [[0, 0], [0, 0], [0, 0], [0, 0]] as [number, number][], master: [0, 0] as [number, number] };
  private audioBanner!: HTMLElement;
  private hype!: Hype;
  private callouts!: HTMLElement;
  private lyrics!: LyricsEngine;
  private lyricHud!: HTMLElement;
  private lyricShown: { line: LyricLine | null; words: HTMLElement[] } = { line: null, words: [] };
  private viewers = 900;
  private last = 0;
  private frame = 0;

  constructor(private root: HTMLElement) {}

  /* ------------------------------------------------------------------ */
  /* AppContext                                                           */
  /* ------------------------------------------------------------------ */

  deckCount(): number {
    return this.boardDef.decks;
  }

  sideDeck(side: 'L' | 'R'): number {
    return this.reg.layers[side];
  }

  venueId(): string {
    return this.settings.venue;
  }

  setVenue(id: string, initial = false): void {
    const def = venueById(id);
    const changed = def.id !== this.stage.venueDef?.id;
    this.settings.venue = def.id;
    if (changed || initial) this.stage.setVenue(def);
    document.documentElement.style.setProperty('--venue', def.ui);
    if (changed && !initial && def.note) toast(def.note);
    this.events.emit('venue', def.id);
    this.save();
  }

  selectedTrack(): LibraryTrack | null {
    return this.selected;
  }

  select(t: LibraryTrack | null): void {
    this.selected = t;
    this.events.emit('selection', t);
  }

  async loadTrack(deckId: number, trackId: string): Promise<void> {
    const t = this.library.get(trackId);
    const deck = this.engine.deck(deckId);
    if (!t) return;
    if (deckId > this.deckCount()) {
      toast(`This board has ${this.deckCount()} decks.`);
      return;
    }
    if (deck.playing) {
      toast(`Deck ${deckId} is playing. Pause it before loading a new track.`);
      return;
    }
    if (t.status === 'error') {
      toast(t.error ?? 'This track cannot be played.', 'error');
      return;
    }
    deck.loading = true;
    const note = t.source === 'demo' && !this.library.get(trackId)?.analysis ? 'Generating demo track…' : '';
    if (note) toast(note);
    try {
      const pcm = await this.library.getPcm(t);
      const analysis = await this.library.ensureAnalysis(t, pcm);
      if (deck.playing) {
        toast(`Deck ${deckId} started playing — load cancelled.`);
        return;
      }
      deck.load(t, pcm, analysis);
      this.library.markPlayed(t);
    } catch (err) {
      toast(`Couldn't load “${t.meta.title}”: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      deck.loading = false;
    }
  }

  async importFiles(files: File[], loadTo?: number, crateId?: string | null): Promise<LibraryTrack[]> {
    const audio = files.filter(isAudioFile);
    if (!audio.length) {
      toast('No audio files found. Supported: MP3, WAV, AIFF, FLAC, OGG, M4A/AAC.', 'error');
      return [];
    }
    toast(`Importing ${audio.length} file${audio.length > 1 ? 's' : ''}…`);
    this.showTab('library');
    const lyricFiles = files.filter((f) => /\.(lrc|txt)$/i.test(f.name));
    const created = await this.library.importFiles(audio, crateId ?? null, lyricFiles);
    const ok = created.filter((t) => t.status === 'ready');
    if (ok.length) toast(`Imported ${ok.length} track${ok.length > 1 ? 's' : ''}`);
    if (loadTo && ok[0]) await this.loadTrack(loadTo, ok[0].id);
    return created;
  }

  /* ------------------------------------------------------------------ */
  /* startup                                                              */
  /* ------------------------------------------------------------------ */

  async start(): Promise<void> {
    this.root.innerHTML = '';
    const loading = h('div', { class: 'loading-overlay', style: { position: 'fixed' } }, 'Setting up the booth…');
    this.root.append(loading);

    this.engine = await AudioEngine.create();
    this.engine.isShift = () => this.reg.shift;
    this.engine.autoGain = this.settings.autoGain;
    for (const ch of this.engine.channels) ch.faderCurve = this.settings.faderCurve;
    this.pool = new AnalysisPool();
    this.library = new Library(this.pool, (bytes) => this.decode(bytes));
    registerControls(this.reg, this.engine, {
      loadSelected: (d) => {
        if (this.selected) void this.loadTrack(d, this.selected.id);
        else toast('Select a track in the library first (browse with ↑ ↓).');
      },
      browse: (dl) => this.libPanel.moveSelection(dl),
      layerChanged: () => this.events.emit('layout', undefined),
    });
    for (const d of this.engine.decks) {
      d.on('cues', (deck) => deck.track && this.library.updateCues(deck.track, deck.track.cues));
      d.on('ended', (deck) => deck.track && toast(`Deck ${deck.id}: “${deck.track.meta.title}” ended`));
    }
    await this.library.init();
    this.midi = new MidiManager(this.reg);
    this.features = new AudioFeatures(this.engine.visAnalyser, this.engine);

    this.stage = new Stage(this.reg, this.engine, {
      levels: (ch) => this.meters.ch[ch - 1] ?? [0, 0],
      master: () => this.meters.master,
      learning: () => this.midi.learning,
      learnPick: (id) => this.midi.pick(id),
      focusDeck: (n) => {
        // boards with one unit per deck: the software panels follow the deck you touch
        if (!this.boardDef.fixedDecks) return;
        const side = n % 2 ? 'L' : 'R';
        if (this.reg.layers[side] !== n) {
          this.reg.setLayer(side, n);
          this.events.emit('layout', undefined);
        }
      },
    });
    Object.assign(this.stage.visualizer.settings, this.settings.vis);
    this.stage.visualizer.setMode(this.stage.visualizer.settings.mode);
    this.stage.reactiveLights = this.settings.reactiveLights;
    for (const k of LIGHT_KEYS) if (this.settings.lights[k] !== undefined) (this.stage.show.controls as unknown as Record<string, unknown>)[k] = this.settings.lights[k];
    registerLightControls(this.reg, this.stage.show, () => this.saveLights());
    this.hype = new Hype(this.engine);
    this.hype.onCallout((c) => this.callout(c));
    this.lyrics = new LyricsEngine(this.engine, (id) => {
      const t = this.engine.deck(id).track;
      return t?.lyrics ? { lyrics: t.lyrics, title: t.meta.title } : null;
    });

    this.buildLayout();
    loading.remove();
    this.setVenue(this.settings.venue, true);
    this.stage.setQuality(this.settings.quality);
    this.applyBoard(this.settings.board, this.settings.finish, true);
    this.stage.rig.goTo(this.settings.camera, true);
    this.setView(this.settings.view);

    bindKeyboard(this.reg, {
      'xfader-left': () => this.reg.nudgeValue('mixer.xfader', -0.05, 'key'),
      'xfader-right': () => this.reg.nudgeValue('mixer.xfader', 0.05, 'key'),
      'xfader-center': () => this.reg.setValue('mixer.xfader', 0.5, 'key'),
      'browse-up': () => this.libPanel.moveSelection(-1),
      'browse-down': () => this.libPanel.moveSelection(1),
      'cycle-view': () => this.setView(this.stage.view === 'booth' ? 'split' : this.stage.view === 'split' ? 'visual' : 'booth'),
      search: () => {
        this.showTab('library');
        this.libPanel.focusSearch();
      },
    });
    this.bindGlobalDrop();
    this.bindAudioUnlock();
    this.library.on('error', (e) => toast(e.message, 'error'));

    requestAnimationFrame((t) => {
      this.last = t;
      this.tick(t);
    });
    void this.loadDemoDecks().then(() => {
      this.library.analyzeMissing();
      void this.loadDefaultSamples();
    });
  }

  private async decode(bytes: ArrayBuffer): Promise<PcmData> {
    const buf = await this.engine.ctx.decodeAudioData(bytes.slice(0));
    const channels: Float32Array[] = [];
    for (let i = 0; i < Math.min(2, buf.numberOfChannels); i++) channels.push(buf.getChannelData(i));
    return { sampleRate: buf.sampleRate, channels };
  }

  private async loadDefaultSamples(): Promise<void> {
    for (let i = 0; i < 8; i++) {
      try {
        const pcm = await this.pool.sample(SAMPLE_NAMES[i], this.engine.ctx.sampleRate);
        if (!this.engine.sampler.slots[i].custom) this.engine.sampler.setBuffer(i, pcm, SAMPLE_NAMES[i], false);
      } catch (err) {
        console.warn('sample render failed', err);
      }
    }
  }

  private async loadSampleFile(slot: number, file: File): Promise<void> {
    const pcm = await this.decode(await file.arrayBuffer());
    this.engine.sampler.setBuffer(slot, pcm, file.name.replace(/\.[^.]+$/, ''), true);
  }

  private async resetSample(slot: number): Promise<void> {
    const pcm = await this.pool.sample(SAMPLE_NAMES[slot], this.engine.ctx.sampleRate);
    this.engine.sampler.setBuffer(slot, pcm, SAMPLE_NAMES[slot], false);
  }

  /** Opens in a working state: two harmonically compatible demo tracks on decks 1 and 2. */
  private async loadDemoDecks(): Promise<void> {
    const plan: [number, string][] = [
      [1, 'demo-11'],
      [2, 'demo-73'],
    ];
    await Promise.all(plan.map(([deck, id]) => (!this.engine.deck(deck).loaded && this.library.get(id) ? this.loadTrack(deck, id) : Promise.resolve())));
  }

  /* ------------------------------------------------------------------ */
  /* layout                                                               */
  /* ------------------------------------------------------------------ */

  private buildLayout(): void {
    this.audioBanner = h('div', { class: 'audio-banner', role: 'status' }, 'Your browser keeps audio paused until you interact.', h('button', { class: 'btn primary small' }, 'Enable audio'));
    this.audioBanner.querySelector('button')!.addEventListener('click', () => void this.engine.resume());
    this.topbar = new TopBar(this, {
      pickBoard: () => this.pickBoard(),
      pickVenue: () => openVenuePicker(() => this.settings.venue, (id) => this.setVenue(id)),
      venueName: () => venueById(this.settings.venue).name,
      hype: () => this.hype.value,
      beat: () => this.features.f.beatPulse,
      live: () => (this.settings.venue === 'boilerroom' ? (this.viewers >= 1000 ? `${(this.viewers / 1000).toFixed(1)}k` : String(Math.round(this.viewers))) : null),
      view: (v) => this.setView(v),
      fullscreen: () => this.fullscreen(),
      record: () => void this.toggleRecord(),
      midi: () => this.showTab('settings'),
      help: () => openHelp(),
      boardName: () => this.boardDef.name,
      currentView: () => this.stage.view,
      midiConnected: () => !!this.midi.access && this.midi.devices().length > 0,
      recording: () => ({ on: this.engine.recorder.recording, elapsed: this.engine.recorder.elapsed }),
    });
    this.wave = new WaveStrip(this);
    this.decksUi = [new DeckPanel(this, 'L'), new DeckPanel(this, 'R')];
    this.stage.el.append(this.buildStageHud());
    const hint = h('div', { class: 'stage-hint' }, 'Hover over part of the board to zoom in · drag knobs, faders and jogs · drag empty space to turn the view');
    this.stage.el.append(hint);
    setTimeout(() => (hint.style.opacity = '0'), 10000);
    const main = h('div', { class: 'main' }, this.decksUi[0].el, this.stage.el, this.decksUi[1].el);

    // dock
    const tabBar = h('div', { class: 'tabs', role: 'tablist' });
    const body = h('div', { class: 'tab-body' });
    this.libPanel = new LibraryPanel(this);
    const sets = new SetBuilderPanel(this);
    const mixer = new MixerPanel(this);
    const fx = new FxPanel(this);
    const sampler = new SamplerPanel(this, (s, f) => this.loadSampleFile(s, f), (s) => this.resetSample(s));
    const visuals = new VisualsPanel(this.stage, () => this.saveVis(), (v, fs) => {
      this.setView(v);
      if (fs) this.fullscreen();
    });
    const midi = new MidiPanel(this.midi, this.reg);
    const lights = new LightsPanel(this, this.stage, () => this.saveLights());
    this.setupPanel = new SetupPanel(this, this.stage, {
      settings: this.settings,
      save: () => this.save(),
      pickBoard: () => this.pickBoard(),
      stickers: () => this.settings.stickers,
      setStickers: (v) => {
        this.settings.stickers = v;
        this.applyBoard(this.boardDef.id, this.settings.finish);
      },
      clearLibrary: async () => {
        for (const t of this.library.list()) if (t.source === 'file') await this.library.deleteTrack(t.id);
      },
    });
    const mixerTab = h('div', { class: 'mixer-tab' }, mixer.el, fx.el);
    const settingsTab = h('div', { class: 'settings-tab' }, this.setupPanel.el, midi.el);
    const defs: [TabId, string, HTMLElement, ((dt: number) => void) | undefined][] = [
      ['library', 'Library', this.libPanel.el, undefined],
      ['sets', 'Set Builder', sets.el, undefined],
      ['mixer', 'Mixer & FX', mixerTab, (dt) => {
        mixer.update(dt, this.meters);
        fx.update();
      }],
      ['lights', 'Lights & venue', lights.el, () => lights.update()],
      ['sampler', 'Sampler', sampler.el, () => sampler.update()],
      ['visuals', 'Visuals', visuals.el, () => visuals.update()],
      ['settings', 'Settings', settingsTab, () => this.setupPanel.update()],
    ];
    for (const [id, label, el, update] of defs) {
      const count = id === 'library' ? h('span', { class: 'count' }) : undefined;
      const btn = h('button', { class: 'tab', role: 'tab', type: 'button' }, label, count ?? '') as HTMLButtonElement;
      btn.addEventListener('click', () => this.showTab(id));
      tabBar.append(btn);
      el.hidden = true;
      body.append(el);
      this.tabs.set(id, { btn, body: el, update, count });
    }
    const dock = h('section', { class: 'dock', 'aria-label': 'Library and tools' }, tabBar, body);
    const resize = h('div', { class: 'dock-resize', role: 'separator', 'aria-label': 'Resize the library panel', title: 'Drag to resize' });
    resize.addEventListener('pointerdown', (e) => {
      resize.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = dock.getBoundingClientRect().height;
      const move = (ev: PointerEvent) => {
        const hgt = clamp(startH - (ev.clientY - startY), 120, window.innerHeight * 0.7);
        this.shell.style.setProperty('--dock-h', `${hgt}px`);
        this.settings.dockHeight = hgt;
      };
      const up = () => {
        resize.removeEventListener('pointermove', move);
        resize.removeEventListener('pointerup', up);
        this.save();
      };
      resize.addEventListener('pointermove', move);
      resize.addEventListener('pointerup', up);
    });

    this.shell = h('div', { class: 'app' }, this.topbar.el, this.wave.el, main, resize, dock);
    if (this.settings.dockHeight) this.shell.style.setProperty('--dock-h', `${this.settings.dockHeight}px`);
    this.shell.classList.toggle('stage-focus', this.settings.focus);
    this.stage.setAutoZoom(this.settings.autoZoom);
    this.root.append(this.audioBanner, this.shell);
    this.showTab((this.settings.tab as TabId) ?? 'library');
  }

  private hud!: { zoomBtn: HTMLElement; camBtn: HTMLElement; zoomChip: HTMLElement; expandBtn: HTMLElement };

  /** Camera and zoom controls that float over the 3D stage. */
  private buildStageHud(): HTMLElement {
    const zoomBtn = h('button', { class: 'btn', title: 'Zoom in on the part of the board under the pointer (tap an empty spot on touch screens)' }, 'Auto-zoom');
    zoomBtn.addEventListener('click', () => {
      this.settings.autoZoom = !this.settings.autoZoom;
      this.stage.setAutoZoom(this.settings.autoZoom);
      this.save();
    });
    const camBtn = h('button', { class: 'btn', title: 'Camera view' });
    camBtn.addEventListener('click', (e) => this.cameraMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY));
    const expandBtn = h('button', { class: 'btn icon hide-sm', title: 'Hide or show the deck panels', 'aria-label': 'Hide or show the deck panels' }, '⤢');
    expandBtn.addEventListener('click', () => {
      this.settings.focus = !this.settings.focus;
      this.shell.classList.toggle('stage-focus', this.settings.focus);
      this.save();
    });
    const zoomChip = h('button', { class: 'zoom-chip', title: 'Zoom back out' });
    zoomChip.addEventListener('click', () => this.stage.focusZone(null));
    this.hud = { zoomBtn, camBtn, zoomChip, expandBtn };
    this.callouts = h('div', { class: 'callouts', 'aria-live': 'polite' });
    this.lyricHud = h('div', { class: 'lyric-hud', 'aria-hidden': 'true' });
    this.stage.el.append(this.callouts, this.lyricHud);
    return h('div', { class: 'stage-hud' }, zoomChip, h('div', { class: 'stage-tools' }, zoomBtn, camBtn, expandBtn));
  }

  private updateHud(): void {
    const { zoomBtn, camBtn, zoomChip } = this.hud;
    zoomBtn.classList.toggle('active', this.stage.autoZoom);
    zoomBtn.setAttribute('aria-pressed', String(this.stage.autoZoom));
    const v = this.stage.rig.view;
    setText(camBtn, `${v === 'custom' ? 'Custom view' : this.stage.rig.label(v)} ▾`);
    const z = this.stage.zoomedLabel;
    zoomChip.hidden = !z || this.stage.view === 'visual';
    if (z) setText(zoomChip, `🔍 ${z} · move off the board or click here to zoom out`);
  }

  /** the line being sung, as a subtitle over the booth (the screens show it big) */
  private updateLyricHud(): void {
    const s = this.stage.visualizer.settings;
    const fr = this.stage.lyric;
    const line = s.lyrics && s.lyricHud && this.stage.view !== 'visual' ? (fr?.line ?? null) : null;
    const shown = this.lyricShown;
    if (line !== shown.line) {
      shown.line = line;
      if (line) {
        shown.words = (line.words.length ? line.words : [{ t: line.t, end: line.end, text: line.text }]).map((w) => h('span', {}, w.text));
        this.lyricHud.replaceChildren(...shown.words.flatMap((el, i) => (i ? [document.createTextNode(' '), el] : [el])));
      }
      this.lyricHud.classList.toggle('on', !!line);
      this.lyricHud.classList.toggle('hook', !!line?.hook);
    }
    if (line && fr) {
      const words = line.words.length ? line.words : [{ t: line.t, end: line.end, text: line.text }];
      words.forEach((w, i) => {
        const el = shown.words[i];
        if (!el) return;
        el.classList.toggle('sung', fr.pos >= w.t);
        el.classList.toggle('now', fr.pos >= w.t && fr.pos <= w.end + 0.05);
      });
    }
  }

  /** a short message from the crowd, over the stage */
  private callout(c: Callout): void {
    const el = h('div', { class: `callout ${c.tone}` }, c.text);
    this.callouts.append(el);
    while (this.callouts.children.length > 3) this.callouts.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3800);
  }

  private saveLights(): void {
    const c = this.stage.show.controls;
    const out: Record<string, unknown> = {};
    for (const k of LIGHT_KEYS) out[k] = c[k];
    this.settings.lights = out as Partial<ShowControls>;
    this.save();
  }

  private showTab(id: TabId): void {
    if (!this.tabs.has(id)) id = 'library';
    this.tab = id;
    for (const [k, t] of this.tabs) {
      t.body.hidden = k !== id;
      t.btn.classList.toggle('active', k === id);
      t.btn.setAttribute('aria-selected', String(k === id));
    }
    if (id === 'settings') this.setupPanel.refresh();
    this.settings.tab = id;
    this.save();
  }

  private pickBoard(): void {
    openBoardPicker({ board: this.boardDef.id, finish: this.settings.finish }, (b, f) => this.applyBoard(b, f));
  }

  private applyBoard(boardId: string, finishId: string, initial = false): void {
    const def = boardById(boardId);
    const changed = def.id !== this.boardDef.id || initial;
    this.boardDef = def;
    this.settings.board = def.id;
    this.settings.finish = def.finishes.some((f) => f.id === finishId) ? finishId : def.finishes[0].id;
    if (changed) {
      this.reg.setLayer('L', 1);
      this.reg.setLayer('R', 2);
      this.engine.setDeckCount(def.decks);
      for (const d of this.engine.decks) {
        d.setTurntable(isTurntable(def, d.id));
        d.vinyl = true;
      }
      this.engine.mixer.setCurve(def.xcurve);
      for (const ch of this.engine.channels) ch.state.assign = def.noCrossfader ? 'THRU' : ch.index % 2 === 0 ? 'A' : 'B';
      if (def.noCrossfader) this.reg.setValue('mixer.xfader', 0.5, 'ui');
      this.engine.mixer.updateCrossfader();
    }
    this.stage.stickers = this.settings.stickers;
    this.stage.setBoard(def, this.settings.finish);
    this.events.emit('board', def.id);
    this.save();
  }

  private setView(v: StageView): void {
    this.stage.setView(v);
    this.settings.view = v;
    this.shell.classList.toggle('visual-only', v === 'visual' && !!document.fullscreenElement);
    this.save();
  }

  private fullscreen(): void {
    const el = this.stage.view === 'visual' ? this.stage.el : document.documentElement;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    el.requestFullscreen?.().catch(() => toast('Full screen is not available here.'));
  }

  private cameraMenu(x: number, y: number): void {
    const rig = this.stage.rig;
    const items: ({ label: string; action: () => void } | 'sep')[] = (Object.keys(VIEW_LABELS) as ViewId[]).map((v) => ({
      label: `${rig.view === v ? '● ' : ''}${rig.label(v)}`,
      action: () => {
        this.stage.goTo(v);
        this.settings.camera = v;
        this.save();
      },
    }));
    items.push('sep');
    for (const a of rig.anchors()) items.push({ label: `★ ${a.name}`, action: () => rig.goToAnchor(a) });
    items.push({
      label: 'Save current view',
      action: () => {
        const n = rig.anchors().length + 1;
        rig.saveAnchor(`View ${n}`);
        toast(`Saved camera view ${n}. Rename or remove it in Setup.`);
      },
    });
    contextMenu(x, y, items);
  }

  private async toggleRecord(): Promise<void> {
    const rec = this.engine.recorder;
    if (!rec.supported) {
      toast('Recording is not supported in this browser.', 'error');
      return;
    }
    await this.engine.resume();
    if (!rec.recording) {
      if (rec.start()) toast('Recording the master output');
      else toast('Could not start recording.', 'error');
      return;
    }
    const r = await rec.stop();
    if (!r) return;
    const name = `deckhouse-mix-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${r.ext}`;
    const audio = h('audio', { controls: true, src: r.url, style: { width: '100%' } });
    const link = h('a', { class: 'btn primary', href: r.url, download: name }, 'Save recording');
    openModal('Your mix', h('div', { style: { display: 'grid', gap: '10px' } }, audio, h('div', {}, link), h('p', { class: 'note' }, `${(r.blob.size / 1048576).toFixed(1)} MB · ${r.blob.type}. If the save button does nothing (some embedded viewers block downloads), open the page on its own to save the file.`)));
  }

  private bindGlobalDrop(): void {
    let overlay: HTMLElement | null = null;
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      if (!overlay) {
        overlay = h('div', { class: 'drop-overlay', style: { position: 'fixed' } }, 'Drop audio files to import');
        document.body.append(overlay);
      }
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth && overlay) {
        overlay.remove();
        overlay = null;
      }
    });
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      depth = 0;
      overlay?.remove();
      overlay = null;
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      void this.importFiles([...e.dataTransfer.files]);
    });
  }

  private bindAudioUnlock(): void {
    const unlock = () => void this.engine.resume();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  private saveVis(): void {
    this.settings.vis = { ...this.stage.visualizer.settings };
    this.settings.reactiveLights = this.stage.reactiveLights;
    this.save();
  }

  private save(): void {
    saveSetting('settings', this.settings);
  }

  /* ------------------------------------------------------------------ */
  /* frame loop                                                           */
  /* ------------------------------------------------------------------ */

  private tick(t: number): void {
    const dt = clamp((t - this.last) / 1000, 0, 0.1);
    this.last = t;
    this.frame++;
    try {
      this.engine.update(dt);
      const n = this.deckCount();
      for (let i = 0; i < 4; i++) this.meters.ch[i] = i < n ? this.engine.channels[i].levels() : [0, 0];
      this.meters.master = this.engine.mixer.masterLevels();
      const f = this.features.update(dt);
      this.stage.hype = this.hype.update(dt, f);
      this.viewers += (900 + this.stage.hype * this.stage.hype * 38000 - this.viewers) * Math.min(1, dt * 0.08);
      this.stage.lyric = this.lyrics.frame();
      this.stage.render(dt, f, this.stage.visualizer.settings);
      this.wave.update();
      for (const d of this.decksUi) d.update();
      this.topbar.update();
      this.updateHud();
      this.updateLyricHud();
      const tab = this.tabs.get(this.tab);
      tab?.update?.(dt);
      const lib = this.tabs.get('library');
      if (lib?.count && this.frame % 30 === 0) setText(lib.count, String(this.library.tracks.size));
      if (this.frame % 3 === 0) this.midi.updateLeds();
      this.audioBanner.hidden = this.engine.running;
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame((tt) => this.tick(tt));
  }
}
