/*
 * Application shell: creates the audio engine, library, control registry,
 * 3D stage + visual player and the software UI, and runs the frame loop.
 */
import { saveFile } from '../core/download';
import { AudioEngine } from '../audio/AudioEngine';
import type { Ambience } from '../audio/crowd';
import { SAMPLE_NAMES } from '../audio/synth';
import { AnalysisPool } from '../analysis/AnalysisPool';
import { ControlRegistry } from '../core/controls';
import { Emitter } from '../core/emitter';
import { onPrefs, prefs, setPrefs, type Prefs } from '../core/prefs';
import { LENS_LOOKS } from '../three/looks';
import { loadSetting, saveSetting } from '../core/settings';
import { formatKey, setKeyNotation } from '../analysis/keys';
import { setCrowdScale } from '../three/venues/crowd';
import { setWaveScheme } from '../ui/waveform';
import { DECK_COLORS, type DeckId, type KeyInfo, type LibraryTrack, type PcmData } from '../core/types';
import { clamp, formatBpm, formatTime } from '../core/util';
import { isAudioFile, Library } from '../library/Library';
import { isPlaylistFile, parsePlaylistFile, type Playlist } from '../library/playlists';
import type { LyricLine } from '../lyrics/lyrics';
import { LyricsEngine } from '../lyrics/LyricsEngine';
import { MidiManager } from '../midi/MidiManager';
import { boardById, isTurntable, type BoardDef } from '../three/boards';
import { venueById, VENUES } from '../three/venues';
import { Career } from '../game/Career';
import { DebugMenu } from '../ui/DebugMenu';
import { nameService } from '../name/NameService';
import { CharacterCreator } from '../ui/CharacterCreator';
import { NameChant } from '../ui/NameChant';
import { NamingScene } from '../ui/NamingScene';
import type { ShowControls } from '../three/venues/show';
import { LightsPanel } from '../ui/LightsPanel';
import { openVenuePicker } from '../ui/VenuePicker';
import { GigDirector, type Callout } from './gigs';
import { roomFor } from '../audio/room';
import { venueLock } from '../game/progression';
import { Director, sectionOf } from '../three/director';
import { RecordingDesk } from './recording';
import { MySetsPanel } from '../ui/MySetsPanel';
import { AutoDJ } from './autodj';
import { registerCameraControls } from './cameraControls';
import { registerLightControls, registerPartyControls } from './lightControls';
import { Party } from './party';
import { VIEW_LABELS, type ViewId } from '../three/CameraRig';
import { Stage, type StageView } from '../three/Stage';
import { AudioFeatures } from '../visualizer/AudioFeatures';
import { avDelay, FeatureDelay } from '../visualizer/avsync';
import { BeatClock } from '../core/BeatClock';
import { openBoardPicker } from '../ui/BoardPicker';
import { DeckPanel } from '../ui/DeckPanel';
import { h, setClass, setText } from '../ui/dom';
import { FxPanel } from '../ui/FxPanel';
import { openHelp } from '../ui/help';
import { deviceScreen } from '../three/deviceScreen';
import { LibraryPanel } from '../ui/LibraryPanel';
import { MidiPanel } from '../ui/MidiPanel';
import { MixerPanel } from '../ui/MixerPanel';
import { contextMenu, openModal, type MenuItem } from '../ui/modal';
import { SamplerPanel } from '../ui/SamplerPanel';
import { SetBuilderPanel } from '../ui/SetBuilderPanel';
import { SetupPanel } from '../ui/SetupPanel';
import { toast } from '../ui/toast';
import { TopBar } from '../ui/TopBar';
import { VisualsPanel } from '../ui/VisualsPanel';
import { WaveStrip } from '../ui/WaveStrip';
import { hwButton, type Widget } from '../ui/widgets';
import type { AppContext, AppEvents } from './context';
import { registerControls } from './controlDefs';
import { bindKeyboard } from './keyboard';
import { moments, setClock } from '../three/venues/moments';
import { addPosts, clipPost } from '../game/social';
import { HubView } from '../ui/Hub';
import { openFeed } from '../ui/SocialFeed';
import type { Recording } from '../core/models';
import { seeded } from '../game/bookings';
import { getCrewTier, setCrewTier } from '../three/venues/crew';
import { cleanSettings, type Settings } from './settingsModel';

const LIGHT_KEYS = ['auto', 'intensity', 'palette', 'custom', 'lasers', 'laserPattern', 'dropFx', 'pyro', 'confetti', 'smoke', 'reduceFlash', 'dancers', 'hellyeah'] as const;
/** the venues a gig can be booked into (Stage 3: the bedroom and the basement; Stage 6 adds the rest) */
const GIG_VENUES = ['bedroom', 'basement', 'rooftop', 'warehouse', 'beach', 'boat', 'festival', 'sunrise'];
/** how loud each room's crowd sounds (the bedroom's crowd is the stream chat) */
/** what each venue sounds like round the music */
const AMBIENCE: Record<string, Ambience> = { rooftop: 'glasses', beach: 'waves', boat: 'water', festival: 'field', sunrise: 'dawn' };
const CROWD_SIZE: Record<string, number> = { bedroom: 0, basement: 0.6, rooftop: 0.7, boat: 0.8, festival: 1.3, sunrise: 1.1, dressing: 0, naming: 0 };

type TabId = 'library' | 'sets' | 'mysets' | 'mixer' | 'show' | 'settings';
/** tabs merged in the 2026 overhaul: old saved tab ids map onto the new ones */
const OLD_TABS: Record<string, TabId> = { lights: 'show', visuals: 'show', sampler: 'mixer' };
/** labels for narrow screens */
const TAB_SHORT: Partial<Record<TabId, string>> = { sets: 'Builder', mysets: 'My Sets', mixer: 'Mixer' };

export class App implements AppContext {
  engine!: AudioEngine;
  readonly reg = new ControlRegistry();
  library!: Library;
  readonly events = new Emitter<AppEvents>();
  private pool!: AnalysisPool;
  private stage!: Stage;
  private features!: AudioFeatures;
  private avSync = new FeatureDelay();
  /** musical time for everything that moves with the music (see core/BeatClock.ts) */
  readonly clock = new BeatClock();
  private clockDrop = false;
  /** the career saves (profile, progress…); see game/Career.ts */
  readonly career = new Career();
  /** how far through the set (the open-air venues' time of day): for the debug menu and tests */
  readonly setClock = setClock;
  private debug: DebugMenu | null = null;
  private chant: NameChant | null = null;
  private naming: NamingScene | null = null;
  private namingBusy = false;
  private creator: CharacterCreator | null = null;
  private home: HubView | null = null;
  /** the kick envelope this frame (the dressing room grooves to it when the decks play) */
  private kick = 0;
  private debugDrop = false;
  private midi!: MidiManager;
  private settings: Settings = cleanSettings(loadSetting<unknown>('settings', {}));
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
  /** gigs and the vibe meter */
  gigs!: GigDirector;
  /** HELL YEAH and the air horn */
  party!: Party;
  private callouts!: HTMLElement;
  private lyrics!: LyricsEngine;
  private lyricHud!: HTMLElement;
  private lyricShown: { line: LyricLine | null; words: HTMLElement[] } = { line: null, words: [] };
  private viewers = 900;
  private stageDt = 0;
  private uiDt = 0;
  private last = 0;
  private frame = 0;
  private director = new Director();
  private desk!: RecordingDesk;
  private mySets!: MySetsPanel;
  /** when the drop punch-in fires (performance.now), 0 for none */
  private punchAt = 0;
  private slowT = 0;
  private autodj!: AutoDJ;
  private setsPanel!: SetBuilderPanel;
  /** top-bar chip while Auto DJ runs */
  private autoChip!: HTMLElement;
  /** the title card on the stage when a new track takes over */
  private nowCard!: { el: HTMLElement; title: HTMLElement; artist: HTMLElement; meta: HTMLElement; announced: string; timer: number };
  /** frame-rate meter: frames and seconds since its last update */
  private fps = { el: null as HTMLElement | null, n: 0, t: 0 };

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
    // the VIP crew on stage follows your fame
    const p = this.career.progress;
    setCrewTier(p.sandbox ? 7 : p.tier);
    this.settings.venue = def.id;
    if (changed || initial) this.stage.setVenue(def);
    // how the room sounds, and how big its crowd is
    this.engine.mixer.room.set(roomFor(def.id));
    this.engine.crowd.size = CROWD_SIZE[def.id] ?? 1;
    this.engine.crowd.ambience(AMBIENCE[def.id] ?? 'none');
    document.documentElement.style.setProperty('--venue', prefs.accent || def.ui);
    if (changed && !initial && def.note) toast(def.note);
    this.events.emit('venue', def.id);
    this.save();
  }

  /** a clip you saved goes up on your feed (and counts towards "save 10 clips") */
  private postClip(r: Recording): void {
    if (r.source !== 'clip' && r.source !== 'trim') return;
    const c = this.career;
    c.setProgress({ stats: { ...c.progress.stats, clips: (c.progress.stats.clips ?? 0) + 1 } });
    const post = clipPost({ dj: nameService.text, venueName: venueById(r.venue).name, venue: r.venue, followers: c.progress.followers, clip: r.id }, seeded(c.feed.seq * 13 + 1));
    c.setFeed(addPosts(c.feed, [post], new Date()));
    toast('Clip posted to your feed');
  }

  /** track search ◀◀ ▶▶: the track before or after this deck's one in the library list */
  private loadAdjacent(deckId: number, delta: number): void {
    const list = this.libPanel.visible();
    if (!list.length) return;
    const on = this.engine.deck(deckId).track?.id;
    const cur = on ?? this.selected?.id;
    const at = cur ? list.findIndex((t) => t.id === cur) : -1;
    const i = Math.max(0, Math.min(list.length - 1, at < 0 ? (delta > 0 ? 0 : list.length - 1) : at + delta));
    const t = list[i];
    if (!t || t.id === on) return;
    this.select(t);
    void this.loadTrack(deckId, t.id);
  }

  /** pushing the browse encoder on the all-in-one: open the track list, and from it load the track picked */
  private browsePress(): void {
    if (this.boardDef.id !== 'aio2') return;
    const s = deviceScreen;
    if (s.page !== 'browse') return s.open('browse');
    const t = this.selected;
    if (!t) return;
    const one = this.engine.deck(1);
    const two = this.engine.deck(2);
    void this.loadTrack(s.target || (one.playing && !two.playing ? 2 : 1), t.id);
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
    if (deck.playing && prefs.loadLock) {
      toast(`Deck ${deckId} is playing. Pause it first.`);
      return;
    }
    if (t.status === 'error') {
      toast(t.error ?? 'This track cannot be played.', 'error');
      return;
    }
    // the deck panel shows "Loading…" meanwhile
    deck.loading = true;
    try {
      const pcm = await this.library.getPcm(t);
      const analysis = await this.library.ensureAnalysis(t, pcm);
      if (deck.playing && prefs.loadLock) {
        toast(`Deck ${deckId} started playing, so the load was cancelled.`);
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
    // playlist files that came along (a .txt is a lyrics sidecar, not a playlist, when dropped with audio)
    const lists = files.filter((f) => isPlaylistFile(f.name) && !isAudioFile(f) && !(audio.length && /\.(txt|lrc)$/i.test(f.name)));
    if (!audio.length && !lists.length) {
      toast('No audio files there. Deckhouse plays MP3, WAV, AIFF, FLAC, OGG and M4A.', 'error');
      return [];
    }
    if (!audio.length) {
      await this.importPlaylistFiles(lists);
      return [];
    }
    toast(`Importing ${audio.length} file${audio.length > 1 ? 's' : ''}…`);
    this.showTab('library');
    const lyricFiles = files.filter((f) => /\.(lrc|txt)$/i.test(f.name));
    const created = await this.library.importFiles(audio, crateId ?? null, lyricFiles);
    const ok = created.filter((t) => t.status === 'ready');
    if (ok.length) toast(`Imported ${ok.length} track${ok.length > 1 ? 's' : ''}`);
    if (lists.length) await this.importPlaylistFiles(lists);
    if (loadTo && ok[0]) await this.loadTrack(loadTo, ok[0].id);
    return created;
  }

  /** playlist files dropped in: each playlist becomes a crate */
  private async importPlaylistFiles(files: File[]): Promise<void> {
    const pls: Playlist[] = [];
    for (const f of files) {
      try {
        pls.push(...parsePlaylistFile(f.name, await f.text()));
      } catch {
        /* not a playlist we can read */
      }
    }
    if (!pls.length) {
      toast('No tracks found in that playlist.', 'error');
      return;
    }
    const res = this.library.importPlaylists(pls);
    const found = res.reduce((n, r) => n + r.found, 0);
    const missing = res.reduce((n, r) => n + r.missing.length, 0);
    this.showTab('library');
    if (res[0]) this.libPanel.showCrate(res[0].id);
    toast(`${res.length === 1 ? `“${res[0].name}”` : `${res.length} playlists`}: ${found} found${missing ? `, ${missing} to add` : ''}`);
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
    this.applyPrefs(null);
    onPrefs((_, changed) => this.applyPrefs(changed));
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
      syncBlocked: () => (this.gigs && !this.gigs.allowSync ? 'No sync in Pro. Beatmatch by ear.' : null),
      denied: (why) => toast(why),
      adjacent: (deck, delta) => this.loadAdjacent(deck, delta),
      screenBack: () => deviceScreen.back(),
      browsePress: () => this.browsePress(),
      tagSelected: () => {
        const t = this.selected;
        if (t) this.library.setFavorite(t, !t.fav);
      },
    });
    for (const d of this.engine.decks) {
      d.on('cues', (deck) => deck.track && this.library.updateCues(deck.track, deck.track.cues));
      d.on('ended', (deck) => deck.track && toast(`Deck ${deck.id}: “${deck.track.meta.title}” ended`));
      // remembered, so a reload puts the same tracks back on the decks
      d.on('loaded', (deck) => {
        if (!deck.track) return;
        this.settings.lastTracks = { ...this.settings.lastTracks, [deck.id]: deck.track.id };
        this.save();
      });
    }
    await this.library.init();
    this.autodj = new AutoDJ(this.engine, this.reg, {
      loadTrack: (d, id) => this.loadTrack(d, id),
      nextFromSet: () => this.setsPanel?.takeNext() ?? null,
      candidates: () => this.library.list(),
      mixBars: () => prefs.autoMixBars,
      note: (kind, deck, other) => {
        if (kind === 'start' && other?.track) toast(`Auto DJ: mixing in “${other.track.meta.title}” on deck ${other.id}`);
        else if (kind === 'done') this.announce(deck, true);
        else if (kind === 'off') toast('Auto DJ off: you took over the mix');
        else if (kind === 'empty') toast('Auto DJ stopped: no track to mix in next. Load one, or build a set.');
      },
    });
    this.midi = new MidiManager(this.reg);
    this.features = new AudioFeatures(this.engine.visAnalyser, this.engine);
    this.clock.onDrop(() => {
      this.clockDrop = true;
      this.desk?.mark('drop', 'Drop');
    });
    // the DJ name on every surface follows the profile
    nameService.set(this.career.profile);
    this.career.changed.on('profile', (p) => nameService.set(p));

    this.stage = new Stage(this.reg, this.engine, {
      levels: (ch) => this.meters.ch[ch - 1] ?? [0, 0],
      master: () => this.meters.master,
      learning: () => this.midi.learning,
      learnPick: (id) => this.midi.pick(id),
      cameraTouched: () => {
        if (this.settings.director) this.setDirector(false);
      },
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
    this.stage.visualizer.setMode(this.stage.visualizer.settings.mode, { kind: 'cut' });
    this.stage.reactiveLights = this.settings.reactiveLights;
    for (const k of LIGHT_KEYS) if (this.settings.lights[k] !== undefined) (this.stage.show.controls as unknown as Record<string, unknown>)[k] = this.settings.lights[k];
    registerLightControls(this.reg, this.stage.show, () => this.saveLights());
    this.party = new Party({
      engine: this.engine,
      stage: this.stage,
      vibe: () => this.gigs?.meter.vibe ?? 0.6,
      bpm: () => this.clock.bpm || 124,
      crew: (text) => this.gigs?.crewLine(text),
    });
    registerPartyControls(this.reg, this.party);
    registerCameraControls(this.reg, this.stage.rig, {
      next: () => this.nextAngle(),
      reset: () => this.resetAngle(),
      lens: () => this.nextLens(),
      auto: () => this.setDirector(!this.settings.director),
      autoOn: () => this.settings.director,
      photo: () => void this.takePhoto(),
    });
    this.stage.directing = this.settings.director;
    this.stage.lensPick = prefs.lens;
    this.desk = new RecordingDesk({
      engine: this.engine,
      stage: this.stage,
      career: this.career,
      reg: this.reg,
      venue: () => {
        const v = venueById(this.settings.venue);
        return { id: v.id, name: v.name };
      },
      venueName: (id) => venueById(id).name,
      pictureTime: () => this.engine.ctx.currentTime - avDelay(this.engine.ctx, prefs.avOffset),
      setLabel: () => this.gigs.slotLabel() ?? 'Free play',
      record: { get: () => this.settings.record, save: (r) => ((this.settings.record = r as unknown as Record<string, unknown>), this.save()) },
      replay: { get: () => this.settings.replay, save: (r) => ((this.settings.replay = r as unknown as Record<string, unknown>), this.save()) },
      director: { on: () => this.settings.director, set: (on) => this.setDirector(on, true), goTo: (v) => this.stage.goTo(v) },
      onBar: (fn) => this.clock.onBar(fn),
      trim: (r, at) => void this.desk.trim(r, at),
      saved: (r) => this.postClip(r),
    });
    this.gigs = new GigDirector({
      engine: this.engine,
      career: this.career,
      library: this.library,
      stageEl: this.stage.el,
      callout: (c) => this.callout(c),
      venue: () => this.settings.venue,
      setVenue: (id) => this.setVenue(id),
      venueName: (id) => venueById(id).name,
      gigVenues: () => {
        const p = this.career.progress;
        return GIG_VENUES.map((id) => {
          const v = venueById(id);
          return { id, name: v.name, blurb: v.blurb, capacity: v.capacity, locked: venueLock(id, p), draw: (g, w, h) => v.thumb(g, w, h) };
        });
      },
      showCrate: (id) => this.libPanel.showCrate(id),
      openLibrary: () => {
        this.showTab('library');
        this.libPanel.showCrate(null);
      },
      currentCrate: () => this.libPanel.currentCrate(),
      openCreator: () => this.creator?.show(),
      recording: () => this.desk.recording.on,
      mark: (kind, label) => this.desk.mark(kind, label),
      finished: (grade) => this.desk.gigFinished(grade),
      replay: () => (this.desk.replay.on ? { save: async () => !!(await this.desk.saveMix()), moment: (label) => void this.desk.replayMoment(label), clear: () => this.desk.replay.clear() } : null),
      djName: () => nameService.text,
      autoDJOff: () => this.setAutoDJ(false),
      press: (id) => this.reg.press(id, 'ui'),
      signature: (what) => (this.stage.venue as { signature?(w: string): void } | null)?.signature?.(what),
      crowd: (what) => this.engine.crowd.play(what, this.gigs.meter.vibe, this.clock.bpm || 124),
      moment: (what) => this.party.moment(what),
      boardId: () => this.boardDef.id,
      venueThumb: (id, g, w, h) => venueById(id).thumb(g, w, h),
      reg: this.reg,
      loadTrack: (d, id) => this.loadTrack(d, id),
    });
    // a tier up brings more of the crew: rebuild the room between sets
    this.career.changed.on('progress', (p) => {
      const t = p.sandbox ? 7 : p.tier;
      if (t === getCrewTier()) return;
      setCrewTier(t);
      if (!this.gigs.gig) this.stage.setVenue(venueById(this.settings.venue));
    });
    // the lighting tech answers when you use the lights in a set
    this.reg.on('activity', ({ id, source }) => {
      if (source !== undefined && id.startsWith('light.')) this.gigs.lightsUsed(id);
    });
    // a venue's signature moment: mark it for the replay, the crowd goes up, the room's sound changes
    moments.on((m) => {
      if (m.venue !== this.settings.venue) return;
      if (m.label) {
        this.desk.mark('signature', m.label);
        this.callout({ text: m.label, tone: 'hype' });
      }
      if (m.crowd) this.engine.crowd.play(m.crowd, Math.max(0.6, this.stage.hype), this.clock.bpm || 124);
      if (m.echo) this.engine.mixer.room.echo(m.echo);
    });
    this.lyrics = new LyricsEngine(this.engine, (id) => {
      const t = this.engine.deck(id).track;
      return t?.lyrics ? { lyrics: t.lyrics, title: t.meta.title } : null;
    });

    this.buildLayout();
    this.debug = new DebugMenu({
      clock: this.clock,
      career: this.career,
      venues: VENUES.map((v) => ({ id: v.id, name: v.name })),
      venue: () => this.settings.venue,
      setVenue: (id) => this.setVenue(id),
      crowd: () => prefs.crowd,
      setCrowd: (k) => setPrefs({ crowd: k }),
      fire: (what) => {
        const show = this.stage.show;
        if (what === 'drop') this.debugDrop = true;
        else if (what === 'confetti') show.fireConfetti();
        else if (what === 'co2') show.fireCo2();
        else if (what === 'pyro') show.firePyro();
        else {
          show.controls.strobeHold = true;
          setTimeout(() => (show.controls.strobeHold = false), 1000);
        }
      },
      redline: () => this.engine.redline,
    });
    document.body.append(this.debug.el);
    this.chant = new NameChant(this.clock);
    this.stage.el.append(this.chant.el);
    this.naming = new NamingScene({
      stage: this.stage,
      ctx: this.engine.ctx,
      career: this.career,
      venue: () => this.settings.venue,
      restoreVenue: (id) => this.setVenue(id, true),
      fireDrop: () => (this.debugDrop = true),
      later: () => {
        this.settings.namingLater = true;
        this.save();
      },
      busy: (on) => (this.namingBusy = on),
      // a first name: straight on to the dressing room
      named: (first) => {
        if (first) this.creator?.show();
      },
    });
    this.creator = new CharacterCreator({
      stage: this.stage,
      ctx: this.engine.ctx,
      career: this.career,
      venue: () => this.settings.venue,
      restoreVenue: (id) => this.setVenue(id, true),
      busy: (on) => (this.namingBusy = on),
      music: () => ({ playing: this.clock.playing, beat: this.clock.position, kick: this.kick }),
    });
    // home: the hub apartment and its stations
    this.home = new HubView({
      stage: this.stage,
      career: this.career,
      venue: () => this.settings.venue,
      restoreVenue: (id) => this.setVenue(id, true),
      venueName: (id) => venueById(id).name,
      music: () => ({ playing: this.clock.playing, beat: this.clock.position, kick: this.kick }),
      bookings: () => this.gigs.openSetup(),
      wardrobe: () => this.creator?.show(),
      crates: () => this.showTab('library'),
      mySets: () => this.showTab('mysets'),
      phone: () => openFeed({ feed: this.career.feed, dj: nameService.text, followers: this.career.progress.followers, watch: () => this.showTab('mysets') }),
      busy: (on) => (this.namingBusy = on),
    });
    // you, as you look (the creator shows its own changes while it's open)
    this.stage.setLook(this.career.look, nameService.text);
    this.career.changed.on('look', (l) => {
      if (!this.creator?.open) this.stage.setLook(l, nameService.text);
    });
    nameService.onChange(() => {
      const l = this.career.look;
      if (l.tattoos.some((t) => t.design === 'script_name')) this.stage.setLook(l, nameService.text);
    });
    // career saves land before the tab goes away
    addEventListener('pagehide', () => this.career.saves.flush());
    loading.remove();
    this.setVenue(this.settings.venue, true);
    this.stage.adaptive.enabled = this.settings.autoQuality;
    this.stage.setQuality(this.settings.quality);
    this.applyBoard(this.settings.board, this.settings.finish, true);
    this.stage.rig.goTo(this.settings.camera, true);
    this.setView(this.settings.view);
    // the first real moment: name yourself (until named, unless they chose Later; automated test browsers skip it)
    const askName = /[?&]naming\b/.test(location.search) || (!this.career.profile.name && !this.settings.namingLater && !navigator.webdriver);
    if (askName) this.naming?.show({ first: !this.career.profile.name });
    else if (/[?&]dressing\b/.test(location.search)) this.creator.show();

    bindKeyboard(this.reg, {
      'xfader-left': () => this.reg.nudgeValue('mixer.xfader', -0.05, 'key'),
      'xfader-right': () => this.reg.nudgeValue('mixer.xfader', 0.05, 'key'),
      'xfader-center': () => this.reg.setValue('mixer.xfader', 0.5, 'key'),
      'browse-up': () => this.libPanel.moveSelection(-1),
      'browse-down': () => this.libPanel.moveSelection(1),
      'cycle-view': () => this.setView(this.stage.view === 'booth' ? 'split' : this.stage.view === 'split' ? 'visual' : 'booth'),
      'board-full': () => this.boardFull(!this.boardMode),
      autodj: () => this.setAutoDJ(!this.autodj.on),
      help: () => openHelp(),
      search: () => {
        this.showTab('library');
        this.libPanel.focusSearch();
      },
    });
    this.bindGlobalDrop();
    this.bindAudioUnlock();
    this.bindBackground();
    this.bindBoardFull();
    this.library.on('error', (e) => toast(e.message, 'error'));

    requestAnimationFrame((t) => {
      this.last = t;
      this.tick(t);
    });
    void this.restoreDecks().then(() => {
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
    // the HELL YEAH horn, apart from the slots (so it works whatever you've loaded into them)
    try {
      this.engine.sampler.setExtra('horn', await this.pool.sample('Air Horn', this.engine.ctx.sampleRate));
    } catch (err) {
      console.warn('horn render failed', err);
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

  /** Opens where you left off: the tracks that were on the decks last time (an empty library starts on the Library tab). */
  private async restoreDecks(): Promise<void> {
    const last = this.settings.lastTracks;
    const plan: [number, string][] = [];
    for (let d = 1; d <= this.deckCount(); d++) if (last[d] && this.library.get(last[d])) plan.push([d, last[d]]);
    if (!this.library.list().length) this.showTab('library');
    await Promise.all(plan.map(([deck, id]) => (!this.engine.deck(deck).loaded ? this.loadTrack(deck, id) : Promise.resolve())));
  }

  /* ------------------------------------------------------------------ */
  /* layout                                                               */
  /* ------------------------------------------------------------------ */

  private buildLayout(): void {
    this.audioBanner = h('div', { class: 'audio-banner', role: 'status' }, 'Your browser keeps audio paused until you interact.', h('button', { class: 'btn primary small' }, 'Enable audio'));
    this.audioBanner.querySelector('button')!.addEventListener('click', () => void this.engine.resume());
    this.topbar = new TopBar(this, {
      pickBoard: () => this.pickBoard(),
      pickVenue: () => openVenuePicker(() => this.settings.venue, (id) => this.setVenue(id), (id) => venueLock(id, this.career.progress)),
      venueName: () => venueById(this.settings.venue).name,
      venueShort: () => {
        const v = venueById(this.settings.venue);
        return v.short ?? v.name;
      },
      hype: () => this.gigs.meter.vibe,
      gig: () => this.gigs.openSetup(),
      home: () => this.home?.show(),
      beat: () => this.features.f.beatPulse,
      live: () => (this.settings.venue === 'boilerroom' ? (this.viewers >= 1000 ? `${(this.viewers / 1000).toFixed(1)}k` : String(Math.round(this.viewers))) : null),
      record: () => void this.desk.toggle(),
      recordMenu: () => this.desk.openSettings(),
      midi: () => this.showTab('settings'),
      menu: (x, y) => this.moreMenu(x, y),
      uiMode: () => this.settings.uiMode,
      setUiMode: (m) => this.setUiMode(m),
      boardName: () => this.boardDef.name,
      midiConnected: () => !!this.midi.access && this.midi.devices().length > 0,
      recording: () => this.desk.recording,
    });
    this.wave = new WaveStrip(this);
    this.decksUi = [new DeckPanel(this, 'L'), new DeckPanel(this, 'R')];
    this.stage.el.append(this.buildStageHud());
    this.autoChip = h('button', { class: 'btn autodj-chip', type: 'button', title: 'Auto DJ is mixing: click to stop', hidden: true }, 'Auto DJ');
    this.autoChip.addEventListener('click', () => this.setAutoDJ(false));
    const readout = this.topbar.el.querySelector('.master-readout');
    this.topbar.el.insertBefore(this.autoChip, readout?.nextSibling ?? null);
    {
      const title = h('div', { class: 'np-title' });
      const artist = h('div', { class: 'np-artist' });
      const meta = h('div', { class: 'np-meta mono' });
      const el = h('div', { class: 'now-playing', 'aria-live': 'polite' }, h('div', { class: 'np-label' }, 'Now playing'), title, artist, meta);
      this.stage.el.append(el);
      this.nowCard = { el, title, artist, meta, announced: '', timer: 0 };
    }
    const hint = h('div', { class: 'stage-hint' }, 'Hover over part of the board to zoom in · drag knobs, faders and jogs · drag empty space to turn the view');
    this.stage.el.append(hint);
    setTimeout(() => (hint.style.opacity = '0'), 10000);
    const main = h('div', { class: 'main' }, this.decksUi[0].el, this.stage.el, this.decksUi[1].el);

    // dock
    const tabBar = h('div', { class: 'tabs', role: 'tablist' });
    const body = h('div', { class: 'tab-body' });
    this.libPanel = new LibraryPanel(this);
    // the all-in-one's touch screen browses the same list as the Library panel
    this.stage.setBrowser({
      sources: () => this.libPanel.sources(),
      sourceId: () => this.libPanel.sourceId(),
      setSource: (id) => this.libPanel.setSource(id),
      tracks: () => this.libPanel.visible(),
      selected: () => this.selected,
      select: (t) => this.select(t),
      load: (deck, t) => {
        this.select(t);
        void this.loadTrack(deck, t.id);
      },
      sorting: () => this.libPanel.sorting(),
      sortBy: (k) => this.libPanel.sortBy(k),
      toggleFav: (t) => this.library.setFavorite(t, !t.fav),
    });
    const sets = new SetBuilderPanel(this);
    this.setsPanel = sets;
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
      pickVenue: () => openVenuePicker(() => this.settings.venue, (id) => this.setVenue(id), (id) => venueLock(id, this.career.progress)),
      setUiMode: (m) => this.setUiMode(m),
      setAutoZoom: (v) => {
        this.settings.autoZoom = v;
        this.stage.setAutoZoom(v);
        this.save();
      },
      saveLights: () => this.saveLights(),
      setFpsMeter: (v) => this.setFpsMeter(v),
      career: this.career,
      openNaming: () => this.naming?.show({ first: false }),
      openCreator: () => this.creator?.show(),
      stickers: () => this.settings.stickers,
      setStickers: (v) => {
        this.settings.stickers = v;
        this.applyBoard(this.boardDef.id, this.settings.finish);
      },
      clearLibrary: async () => {
        for (const t of this.library.list()) if (t.source === 'file') await this.library.deleteTrack(t.id);
      },
    });
    this.mySets = new MySetsPanel({ sets: this.desk.sets, open: (r) => this.desk.view(r), trim: (r) => void this.desk.trim(r), venueName: (id) => venueById(id).name });
    // six tabs: the sampler lives with the mixer, lights / venue / visuals / lyrics are "Show"
    const mixerTab = h('div', { class: 'mixer-tab' }, mixer.el, fx.el, sampler.el);
    const showTab = h('div', { class: 'show-tab' }, lights.el, visuals.el);
    const settingsTab = h('div', { class: 'settings-tab' }, this.setupPanel.el, midi.el);
    this.setupPanel.searchAlso(midi.el, 'midi controller hardware learn mapping usb');
    const defs: [TabId, string, HTMLElement, ((dt: number) => void) | undefined][] = [
      ['library', 'Library', this.libPanel.el, undefined],
      ['sets', 'Set Builder', sets.el, undefined],
      ['mysets', 'My Sets', this.mySets.el, undefined],
      ['mixer', 'Mixer & FX', mixerTab, (dt) => {
        mixer.update(dt, this.meters);
        fx.update();
        sampler.update();
      }],
      ['show', 'Show', showTab, () => {
        lights.update();
        visuals.update();
      }],
      ['settings', 'Settings', settingsTab, () => this.setupPanel.update()],
    ];
    for (const [id, label, el, update] of defs) {
      const count = id === 'library' ? h('span', { class: 'count' }) : undefined;
      const short = TAB_SHORT[id];
      const btn = h('button', { class: 'tab', role: 'tab', type: 'button' }, short ? h('span', { class: 'lbl-full' }, label) : label, short ? h('span', { class: 'lbl-short' }, short) : '', count ?? '') as HTMLButtonElement;
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
    this.shell.classList.toggle('ui-simple', this.settings.uiMode === 'simple');
    this.stage.setAutoZoom(this.settings.autoZoom);
    if (this.settings.fpsMeter) this.setFpsMeter(true);
    this.root.append(this.audioBanner, this.shell);
    this.showTab((OLD_TABS[this.settings.tab] ?? this.settings.tab ?? 'library') as TabId);
  }

  private setUiMode(m: 'simple' | 'pro'): void {
    this.settings.uiMode = m;
    this.shell.classList.toggle('ui-simple', m === 'simple');
    this.save();
    this.stage.resize();
  }

  /** the top bar's ⋯ menu: view, full screen, MIDI, help */
  private moreMenu(x: number, y: number): void {
    const v = this.stage.view;
    const view = (id: StageView, label: string): MenuItem => ({ label, checked: v === id, action: () => this.setView(id) });
    contextMenu(x, y, [
      { header: 'Show' },
      view('booth', 'Booth'),
      view('split', 'Booth + visuals'),
      view('visual', 'Visuals only'),
      'sep',
      { label: 'Auto DJ', checked: this.autodj.on, hint: '⇧A', action: () => this.setAutoDJ(!this.autodj.on) },
      { label: 'Board full screen', checked: this.boardMode, hint: '⇧B', action: () => this.boardFull(!this.boardMode) },
      { label: 'Full screen', checked: !!document.fullscreenElement && !this.boardMode, action: () => this.fullscreen() },
      'sep',
      { label: 'MIDI controllers', action: () => this.showTab('settings') },
      { label: 'Help and shortcuts', hint: '?', action: () => openHelp() },
    ]);
  }

  private hud!: { camBtn: HTMLElement; zoomChip: HTMLElement; expandBtn: HTMLElement; fullBtn: HTMLElement; framing: HTMLElement; pad: HTMLElement; padWidgets: Widget[] };
  /** board full screen: the 3D board fills the whole screen */
  private boardMode = false;
  /** what to put back when leaving it */
  private beforeBoard: { camera: ViewId; view: StageView } | null = null;

  /** Camera and zoom controls that float over the 3D stage. */
  private buildStageHud(): HTMLElement {
    const camBtn = h('button', { class: 'btn cam-btn', title: 'Camera view' });
    camBtn.addEventListener('click', (e) => this.cameraMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY));
    const expandBtn = h('button', { class: 'btn icon hide-sm', title: 'Hide or show the deck panels', 'aria-label': 'Hide or show the deck panels' }, '⤢');
    expandBtn.addEventListener('click', () => {
      this.settings.focus = !this.settings.focus;
      this.shell.classList.toggle('stage-focus', this.settings.focus);
      this.save();
    });
    const zoomChip = h('button', { class: 'zoom-chip', title: 'Zoom back out' });
    zoomChip.addEventListener('click', () => this.stage.focusZone(null));
    // board full screen, and (in it) the framing switch
    const fullBtn = h('button', { class: 'btn icon board-full-btn', title: 'Board full screen (Shift+B)', 'aria-label': 'Board full screen' }, '⛶');
    fullBtn.addEventListener('click', () => this.boardFull(!this.boardMode));
    const framing = h('div', { class: 'seg board-framing', role: 'group', 'aria-label': 'Board framing' });
    for (const [v, label] of [
      ['top', 'Top-down'],
      ['perf', 'Angled'],
    ] as ['top' | 'perf', string][]) {
      const b = h('button', { class: 'btn', type: 'button', 'data-view': v }, label);
      b.addEventListener('click', () => this.frameBoard(v));
      framing.append(b);
    }
    const pad = this.buildCameraPad();
    this.hud = { camBtn, zoomChip, expandBtn, fullBtn, framing, pad: pad.el, padWidgets: pad.widgets };
    this.callouts = h('div', { class: 'callouts', 'aria-live': 'polite' });
    this.lyricHud = h('div', { class: 'lyric-hud', 'aria-hidden': 'true' });
    this.stage.el.append(this.callouts, this.lyricHud, pad.el);
    return h('div', { class: 'stage-hud' }, zoomChip, h('div', { class: 'stage-tools' }, framing, camBtn, expandBtn, fullBtn));
  }

  /**
   * Board full screen's camera pad: hold the arrows to orbit round the board and
   * tilt, + / − to zoom, the middle button to go back to the main angle. The
   * same moves are on the keyboard (Shift + arrows, = and −) and MIDI-learnable.
   */
  private buildCameraPad(): { el: HTMLElement; widgets: Widget[] } {
    const widgets: Widget[] = [];
    const b = (id: string, icon: string, label: string, cls: string) => {
      const w = hwButton(this.reg, id, icon, { cls: `btn cam-pad-btn ${cls}` });
      w.el.setAttribute('aria-label', label);
      widgets.push(w);
      return w.el;
    };
    const fold = h('button', { class: 'btn cam-pad-fold', type: 'button', title: 'Hide the camera pad', 'aria-label': 'Hide the camera pad' }, '–');
    const open = h('button', { class: 'btn cam-pad-open', type: 'button', title: 'Camera pad: change the camera angle', 'aria-label': 'Show the camera pad' }, 'Camera');
    const group = (...kids: HTMLElement[]) => h('span', { class: 'cam-pad-group' }, ...kids);
    const el = h(
      'div',
      { class: `cam-pad${this.settings.camPad ? '' : ' folded'}`, role: 'group', 'aria-label': 'Camera' },
      open,
      h(
        'div',
        { class: 'cam-pad-body' },
        h('span', { class: 'label' }, 'Camera'),
        group(b('cam.left', '↶', 'Orbit left (hold)', ''), b('cam.right', '↷', 'Orbit right (hold)', '')),
        group(b('cam.raise', '▲', 'Look more from above (hold)', ''), b('cam.lower', '▼', 'Look from lower down (hold)', '')),
        group(b('cam.out', '−', 'Zoom out (hold)', ''), b('cam.in', '+', 'Zoom in (hold)', '')),
        group(b('cam.reset', '⌂', 'Back to the board view', ''), b('cam.next', '⇢', 'Next camera angle', ''), b('cam.lens', '◎', 'Next lens look (fisheye, camcorder…)', '')),
        group(b('cam.auto', 'Auto', 'Auto director: the camera cuts with the music', 'auto'), b('cam.photo', 'Photo', 'Take a photo', '')),
        fold,
      ),
    );
    const setOpen = (v: boolean) => {
      this.settings.camPad = v;
      el.classList.toggle('folded', !v);
      this.save();
      this.fitUnderPad();
    };
    fold.addEventListener('click', () => setOpen(false));
    open.addEventListener('click', () => setOpen(true));
    return { el, widgets };
  }

  /** In board full screen the camera frames the board above the open camera bar. */
  private fitUnderPad(resize = true): void {
    const body = this.hud.pad.querySelector('.cam-pad-body') as HTMLElement;
    const open = this.boardMode && this.settings.camPad;
    const r = open ? body.getBoundingClientRect() : null;
    const inset = r && r.height ? Math.round(this.stage.el.getBoundingClientRect().bottom - r.top + 6) : 0;
    if (inset === this.stage.bottomInset) return;
    this.stage.bottomInset = inset;
    if (resize) this.stage.resize();
  }

  /** the angles the camera steps through ("next angle"), in menu order */
  private nextAngle(): void {
    const order = Object.keys(VIEW_LABELS) as ViewId[];
    const cur = this.stage.rig.view;
    const v = order[(order.indexOf(cur as ViewId) + 1) % order.length];
    this.pickAngle(v);
    toast(`Camera: ${this.stage.rig.label(v)}`);
  }

  /** ⌂: in board full screen back to the board (Top-down or Angled); otherwise to the chosen camera view */
  private lensName(): string {
    return prefs.lens === 'auto' ? 'Auto' : (LENS_LOOKS.find((l) => l.id === prefs.lens)?.name ?? 'Clean');
  }

  /** step through the lens looks: Auto (each angle's own), then every look */
  private nextLens(): void {
    const order = ['auto', ...LENS_LOOKS.map((l) => l.id)] as Prefs['lens'][];
    setPrefs({ lens: order[(order.indexOf(prefs.lens) + 1) % order.length] });
    toast(`Lens: ${this.lensName()}`);
  }

  /** The auto director: the camera cuts between angles with the music; any hand on the camera stops it. */
  private setDirector(on: boolean, quiet = false): void {
    if (on === this.settings.director) return;
    this.settings.director = on;
    this.stage.directing = on;
    if (on) this.director.reset();
    else this.stage.rig.orbit = 0;
    if (!quiet) toast(on ? 'Auto director on: the camera cuts with the music. Move the camera to take over.' : 'Auto director off');
    this.save();
  }

  /** a still of the stage as it looks now (lens look included), to look at and save */
  private async takePhoto(): Promise<void> {
    const flash = h('div', { class: 'photo-flash' });
    this.stage.el.append(flash);
    setTimeout(() => flash.remove(), 450);
    const blob = await this.stage.snapshot();
    if (!blob) {
      toast('Couldn’t take a photo here.', 'error');
      return;
    }
    const url = URL.createObjectURL(blob);
    const venue = venueById(this.settings.venue);
    const name = `deckhouse-${venue.id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    const link = h('button', { class: 'btn primary', type: 'button' }, 'Save photo');
    link.addEventListener('click', () => void saveFile(blob, name));
    openModal(
      'Photo',
      h('div', { style: { display: 'grid', gap: '10px' } }, h('img', { src: url, alt: `The stage at ${venue.name}`, style: { width: '100%', borderRadius: '6px', display: 'block' } }), h('div', { class: 'toggle-row' }, link), h('p', { class: 'note' }, 'If the save button does nothing (some embedded viewers block downloads), right-click or long-press the picture to save it, or open the page on its own.')),
      { wide: true },
    );
  }

  private resetAngle(): void {
    if (this.boardMode) this.frameBoard(this.settings.boardHome ?? 'top');
    else this.stage.goTo(this.settings.camera);
  }

  /** go to a camera angle and remember it (for board full screen separately from the normal layout); picking one by hand stops the auto director */
  private pickAngle(v: ViewId, user = true): void {
    if (user && this.settings.director) this.setDirector(false);
    this.stage.goTo(v);
    if (this.boardMode) this.settings.boardFraming = v;
    else this.settings.camera = v;
    this.save();
  }

  private updateHud(): void {
    const { camBtn, zoomChip, framing } = this.hud;
    if (this.boardMode && !this.hud.pad.classList.contains('folded')) for (const w of this.hud.padWidgets) w.update();
    const v = this.stage.rig.view;
    setText(camBtn, `${this.settings.director ? 'Auto · ' : ''}${v === 'custom' ? 'Custom view' : this.stage.rig.label(v)} ▾`);
    if (this.boardMode) for (const b of framing.children) setClass(b as HTMLElement, 'active', (b as HTMLElement).dataset.view === v);
    const z = this.stage.zoomedLabel;
    zoomChip.hidden = !z || this.stage.view === 'visual';
    if (z) setText(zoomChip, `${z} · zoom out`);
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
        d.vinyl = prefs.jogMode === 'vinyl';
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

  /**
   * Board full screen: everything but the 3D board goes away and the board fills the screen
   * (browser full screen where it's allowed; the whole window otherwise, e.g. inside an
   * embedded viewer or on iPhone). Top-down or angled framing; Esc, Shift+B or ✕ leaves.
   */
  private boardFull(on: boolean): void {
    if (on === this.boardMode) return;
    this.boardMode = on;
    this.shell.classList.toggle('board-full', on);
    setText(this.hud.fullBtn, on ? '✕' : '⛶');
    this.hud.fullBtn.title = on ? 'Leave board full screen (Esc)' : 'Board full screen (Shift+B)';
    this.hud.fullBtn.setAttribute('aria-label', on ? 'Leave board full screen' : 'Board full screen');
    if (on) {
      void this.engine.resume();
      this.beforeBoard = { camera: this.stage.rig.view === 'custom' ? this.settings.camera : (this.stage.rig.view as ViewId), view: this.stage.view };
      if (this.stage.view !== 'booth') this.stage.setView('booth');
      const phone = matchMedia('(pointer: coarse)').matches;
      const fs = document.fullscreenElement ? Promise.resolve() : document.documentElement.requestFullscreen?.();
      // on a phone the board is wide and the screen tall: turn to landscape where the browser allows it
      fs?.then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => {})
        .finally(() =>
          // give a rotation a moment to land before suggesting it
          setTimeout(() => {
            if (phone && this.boardMode && window.innerHeight > window.innerWidth) toast('Turn your phone sideways for a bigger board.');
          }, 800),
        );
      if (!fs && phone && window.innerHeight > window.innerWidth) toast('Turn your phone sideways for a bigger board.');
    } else {
      (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      const b = this.beforeBoard;
      this.beforeBoard = null;
      if (b) {
        this.stage.setView(b.view);
        this.stage.goTo(b.camera);
      }
    }
    // frame the board once the layout has settled at its new size
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.fitUnderPad(false);
        this.stage.resize();
        if (on && !this.settings.director) this.pickAngle(this.settings.boardFraming ?? this.settings.boardHome ?? 'top', false);
      }),
    );
  }

  /** the Top-down / Angled buttons in board full screen */
  private frameBoard(v: 'top' | 'perf'): void {
    this.settings.boardHome = v;
    this.pickAngle(v);
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
    const angle = (v: ViewId): MenuItem => ({ label: rig.label(v), checked: rig.view === v, action: () => this.pickAngle(v) });
    const items: MenuItem[] = [
      { header: 'Board' },
      ...(['top', 'perf', 'booth'] as ViewId[]).map(angle),
      { header: 'Room' },
      ...(['wide', 'crowd'] as ViewId[]).map(angle),
      { header: 'Moving' },
      ...(['fisheye', 'crane', 'rig', 'cctv', 'camcorder', 'vertigo', 'drone'] as ViewId[]).map(angle),
    ];
    const saved = rig.anchors();
    if (saved.length) items.push({ header: 'Saved' }, ...saved.map((a): MenuItem => ({ label: a.name, checked: false, action: () => rig.goToAnchor(a) })));
    items.push(
      'sep',
      { label: 'Auto director', checked: this.settings.director, action: () => this.setDirector(!this.settings.director) },
      {
        label: 'Zoom to the pointer',
        checked: this.stage.autoZoom,
        action: () => {
          this.settings.autoZoom = !this.settings.autoZoom;
          this.stage.setAutoZoom(this.settings.autoZoom);
          this.save();
        },
      },
      {
        label: `Lens: ${this.lensName()}`,
        checked: false,
        hint: '▸',
        action: () =>
          contextMenu(x, y, [
            { header: 'Lens' },
            { label: 'Auto (per angle)', checked: prefs.lens === 'auto', action: () => setPrefs({ lens: 'auto' }) },
            'sep',
            ...LENS_LOOKS.map((l): MenuItem => ({ label: l.name, checked: prefs.lens === l.id, action: () => setPrefs({ lens: l.id }) })),
          ]),
      },
      'sep',
      { label: 'Take a photo', checked: false, action: () => void this.takePhoto() },
      {
        label: 'Save this view',
        checked: false,
        action: () => {
          const n = rig.anchors().length + 1;
          rig.saveAnchor(`View ${n}`);
          toast(`Saved as View ${n}`);
        },
      },
    );
    contextMenu(x, y, items);
  }

  private bindGlobalDrop(): void {
    let overlay: HTMLElement | null = null;
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      if (!overlay) {
        overlay = h('div', { class: 'drop-overlay', style: { position: 'fixed' } }, 'Drop music or playlists to import');
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

  /**
   * Put the preferences into effect: everything on start (changed = null),
   * then only what changed. Deck defaults go to every deck.
   */
  private applyPrefs(changed: Set<keyof Prefs> | null): void {
    const has = (...k: (keyof Prefs)[]) => !changed || k.some((x) => changed.has(x));
    const root = document.documentElement.style;
    if (has('keyNotation')) setKeyNotation(prefs.keyNotation);
    if (has('waveScheme')) setWaveScheme(prefs.waveScheme);
    if (has('uiScale')) {
      root.setProperty('--ui-zoom', String(prefs.uiScale));
      if (changed) requestAnimationFrame(() => this.stage.resize());
    }
    if (has('deckColors'))
      prefs.deckColors.forEach((c, i) => {
        DECK_COLORS[(i + 1) as DeckId] = c;
        root.setProperty(`--deck${i + 1}`, c);
      });
    if (has('accent') && changed) root.setProperty('--venue', prefs.accent || venueById(this.settings.venue).ui);
    if (has('tempoRange', 'keylock', 'quantize', 'jogMode', 'loopBeats', 'jumpBeats'))
      for (const d of this.engine.decks) {
        if (has('tempoRange')) d.setRange(prefs.tempoRange);
        if (has('keylock') && d.keylock !== prefs.keylock) d.setKeylock(prefs.keylock);
        if (has('quantize')) d.quantize = prefs.quantize;
        if (has('jogMode')) d.vinyl = prefs.jogMode === 'vinyl';
        if (has('loopBeats') && !d.loop.active) d.loopBeats = prefs.loopBeats;
        if (has('jumpBeats')) d.jumpBeats = prefs.jumpBeats;
      }
    if (has('lens') && this.stage) this.stage.lensPick = prefs.lens;
    if (has('crowd')) {
      setCrowdScale(prefs.crowd);
      // the crowd is part of the venue build: build it again
      if (changed && this.stage?.venueDef) this.stage.setVenue(this.stage.venueDef);
    }
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

  /** leave board full screen with Esc, or when the browser leaves full screen (its own Esc) */
  private bindBoardFull(): void {
    let fsOn = false;
    document.addEventListener('fullscreenchange', () => {
      const now = !!document.fullscreenElement;
      if (fsOn && !now && this.boardMode) this.boardFull(false);
      fsOn = now;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.boardMode || document.querySelector('.modal-back, .context-menu')) return;
      e.preventDefault();
      this.boardFull(false);
    });
  }

  private setAutoDJ(on: boolean): void {
    if (on === this.autodj.on) return;
    if (on && this.gigs.gig) {
      toast('Auto DJ sits this one out: the gig is yours.');
      return;
    }
    if (!on) {
      this.autodj.stop();
      return;
    }
    void this.engine.resume();
    if (!this.autodj.start()) {
      toast('Load a track on deck 1 or 2 first, then turn on Auto DJ.');
      return;
    }
    toast(`Auto DJ on: it mixes the next track in over ${prefs.autoMixBars} bars, from your set or the best match in the library. Touch the crossfader, a fader or play to take over.`);
    this.updateAutoChip();
  }

  private updateAutoChip(): void {
    const a = this.autodj;
    this.autoChip.hidden = !a.on;
    if (!a.on) return;
    const p = a.progress();
    const next = a.next()?.track;
    const eta = a.eta();
    const text = p !== null ? `Auto DJ · ${Math.round(p * 100)}%` : a.phase === 'ready' && eta !== null ? `Auto DJ · ${formatTime(eta)}` : 'Auto DJ';
    setText(this.autoChip, text);
    const what = p !== null ? `Mixing in “${next?.meta.title ?? ''}”` : a.phase === 'ready' && next ? `Next: “${next.meta.title}”${eta !== null ? ` in ${formatTime(eta)}` : ''}` : a.phase === 'loading' ? 'Getting the next track ready' : 'Waiting for the right moment';
    this.autoChip.title = `${what}. Click to stop Auto DJ`;
    this.autoChip.setAttribute('aria-label', `Auto DJ: ${what}. Click to stop`);
    setClass(this.autoChip, 'mixing', p !== null);
  }

  /** a new track has taken over (the master deck changed to one playing something new): show its title card */
  private watchNowPlaying(): void {
    const m = this.engine.masterDeck;
    if (!m?.playing || !m.track || m.track.id === this.nowCard.announced) return;
    // a manual mix: wait until the incoming track is the one out front
    if (this.autodj.on && this.autodj.phase === 'mixing') return;
    this.announce(m, false);
  }

  private announce(d: { track: LibraryTrack | null; bpm: number; currentKey(): KeyInfo | null }, force: boolean): void {
    const t = d.track;
    const c = this.nowCard;
    if (!t || (!force && t.id === c.announced)) return;
    c.announced = t.id;
    if (!prefs.nowPlaying) return;
    setText(c.title, t.meta.title);
    setText(c.artist, t.meta.artist || t.fileName);
    const key = d.currentKey();
    setText(c.meta, `${formatBpm(d.bpm)} BPM${key ? ` · ${formatKey(key)}` : ''}`);
    c.el.classList.remove('on');
    void c.el.offsetWidth;
    c.el.classList.add('on');
    clearTimeout(c.timer);
    c.timer = window.setTimeout(() => c.el.classList.remove('on'), 6500);
  }

  /** the auto director's call for this frame: cut, or stay */
  private direct(): void {
    const s = this.stage.show.state;
    // cuts land on the clock's bars and drops; the show supplies how built-up / peaking it is
    const drop = this.clockDrop;
    const v = this.director.update({ t: s.t, playing: this.clock.playing, bar: this.clock.bar, build: s.build, peak: s.peak, dropHit: drop }, this.stage.rig.view);
    this.clockDrop = false;
    if (v) {
      this.stage.cutTo(v);
      // the drop punch-in lands once the cut has (Section 2.5)
      if (drop) this.punchAt = performance.now() + 220;
    }
    if (this.punchAt && performance.now() >= this.punchAt) {
      this.punchAt = 0;
      this.stage.rig.punch(this.stage.visualizer.settings.shake);
    }
    // the breakdown orbit: still shots drift round the booth while the track breathes
    const sec = sectionOf({ playing: this.clock.playing, build: s.build, peak: s.peak });
    const want = sec === 'breakdown' || sec === 'build' ? Math.min(1, s.build * 1.3) : 0;
    this.stage.rig.orbit += (want - this.stage.rig.orbit) * 0.04;
  }

  private setFpsMeter(on: boolean): void {
    this.settings.fpsMeter = on;
    this.save();
    if (on && !this.fps.el) {
      this.fps.el = h('div', { class: 'fps-meter mono', 'aria-hidden': 'true' }, '…');
      this.stage.el.append(this.fps.el);
    } else if (!on && this.fps.el) {
      this.fps.el.remove();
      this.fps.el = null;
    }
  }

  /** frames a second, the frame time and the render resolution, twice a second */
  private updateFps(raw: number): void {
    const m = this.fps;
    m.n++;
    m.t += Math.max(0, raw);
    if (m.t < 0.5 || !m.el) return;
    const res = Math.round(this.stage.adaptive.step.renderScale * 100);
    setText(m.el, `${Math.round(m.n / m.t)} fps · ${((m.t / m.n) * 1000).toFixed(1)} ms · ${res}% res`);
    m.n = 0;
    m.t = 0;
  }

  /** keep the audio engine (sync, loops, deck events) running while the tab is hidden and rAF is paused */
  private bindBackground(): void {
    let timer = 0;
    let last = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        last = performance.now();
        timer = window.setInterval(() => {
          const now = performance.now();
          this.engine.update(clamp((now - last) / 1000, 0, 0.25));
          last = now;
        }, 50);
      } else {
        clearInterval(timer);
        this.last = performance.now();
      }
    });
  }

  private tick(t: number): void {
    const raw = (t - this.last) / 1000;
    const dt = clamp(raw, 0, 0.1);
    this.last = t;
    this.frame++;
    try {
      this.engine.update(dt);
      this.autodj.update();
      const n = this.deckCount();
      for (let i = 0; i < 4; i++) this.meters.ch[i] = i < n ? this.engine.channels[i].levels() : [0, 0];
      this.meters.master = this.engine.mixer.masterLevels();
      // the visuals read the audio as the speakers play it, not as it leaves the mixer
      const f = this.avSync.push(t / 1000, this.features.update(dt), avDelay(this.engine.ctx, prefs.avOffset));
      if (this.debugDrop) {
        // the debug menu's drop: the whole game sees it, as if the track dropped
        f.dropHit = true;
        f.drop = 1;
        this.debugDrop = false;
      }
      this.clock.update(f, dt);
      this.debug?.update(dt);
      this.naming?.update(dt);
      this.kick = f.kickPulse;
      this.creator?.update(dt);
      nameService.update({ playing: this.clock.playing, section: this.clock.section, beat: this.clock.position, bar: this.clock.bar, kick: f.kickPulse, depth: f.breakdown, dropHit: f.dropHit, reduceFlash: this.stage.show.controls.reduceFlash }, dt);
      this.stage.hype = this.gigs.update(dt, f);
      this.desk.update(dt, this.stage.hype);
      this.engine.crowd.dawn = this.settings.venue === 'sunrise' ? Math.max(0, (setClock.progress - 0.55) / 0.45) : 0;
      this.engine.crowd.update(dt, this.stage.hype, this.clock.playing);
      this.chant?.update(dt, this.stage.hype, this.clock.playing);
      this.viewers += (900 + this.stage.hype * this.stage.hype * 38000 - this.viewers) * Math.min(1, dt * 0.08);
      this.stage.lyric = this.lyrics.frame();
      // a dialog over the stage: the club only needs a third of the frames
      this.stageDt += dt;
      const covered = document.body.classList.contains('modal-open');
      if (!covered || this.frame % 3 === 0) {
        this.stage.render(this.stageDt, f, this.stage.visualizer.settings, covered);
        this.stageDt = 0;
        if (this.settings.director && this.stage.view !== 'visual' && !this.namingBusy) this.direct();
        // a drop the director didn't take (it's off, or the view is the visual player) doesn't wait for later
        this.clockDrop = false;
      }
      if (this.fps.el) this.updateFps(raw);
      // four times a second, however slow the frames are
      this.slowT += raw;
      if (this.slowT >= 0.25) {
        this.slowT = 0;
        this.updateAutoChip();
        this.watchNowPlaying();
      }
      this.wave.update();
      // panels refresh at 30 Hz, alternating so each frame does half the work
      this.uiDt += dt;
      if (this.frame % 2 === 0) {
        for (const d of this.decksUi) d.update();
        this.updateLyricHud();
      } else {
        this.topbar.update();
        this.updateHud();
        const tab = this.tabs.get(this.tab);
        tab?.update?.(this.uiDt);
        this.uiDt = 0;
      }
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
