/*
 * Software deck panel (left or right side). Follows the active deck layer, so
 * on four-deck boards it shows deck 1/3 (left) or 2/4 (right).
 */
import type { AppContext } from '../app/context';
import { beatLabel, PAD_MODE_LABELS, PAD_MODES, type Deck } from '../audio/Deck';
import { camelotColor, compatibility } from '../analysis/keys';
import { DECK_COLORS, HOTCUE_COLORS, type DeckId } from '../core/types';
import { formatBpm, formatTime } from '../core/util';
import { h, setClass, setText, setVar } from './dom';
import { contextMenu, openModal } from './modal';
import { toast } from './toast';
import { drawOverview, fitCanvas } from './waveform';
import { fader, hwButton, knob, padButton, type Widget } from './widgets';
import { loadSetting, saveSetting } from '../core/settings';

export class DeckPanel {
  readonly el: HTMLElement;
  private widgets: Widget[] = [];
  private art: HTMLElement;
  private disc: HTMLElement;
  private discLabel: HTMLElement;
  private discAngle = 1e9;
  private num: HTMLElement;
  private title: HTMLElement;
  private artist: HTMLElement;
  private bpm: HTMLElement;
  private bpmOrig: HTMLElement;
  private time: HTMLElement;
  private keyChip: HTMLElement;
  private tempoChip: HTMLElement;
  private rangeChip: HTMLElement;
  private overview: HTMLCanvasElement;
  private ov: CanvasRenderingContext2D;
  private phase: HTMLElement[];
  private loopSize: HTMLElement;
  private jumpSize: HTMLElement;
  private keyShift: HTMLElement;
  private layerBtn: HTMLButtonElement;
  private showRemain = true;

  constructor(
    private app: AppContext,
    readonly side: 'L' | 'R',
  ) {
    const reg = app.reg;
    const P = (s: string) => `deck.${side}.${s}`;
    const w = <T extends Widget>(x: T) => {
      this.widgets.push(x);
      return x.el;
    };

    this.num = h('span', { class: 'num' });
    // a little record that spins with the deck; the track art is its label
    this.discLabel = h('div', { class: 'disc-label' });
    this.disc = h('div', { class: 'disc' }, this.discLabel);
    this.art = h('div', { class: 'deck-art', title: 'Spins with the platter' }, this.disc, this.num);
    this.title = h('div', { class: 't' });
    this.artist = h('div', { class: 'a' });
    this.layerBtn = h('button', { class: 'btn small', title: 'Switch deck layer' }) as HTMLButtonElement;
    this.layerBtn.addEventListener('click', () => reg.press(`layer.${side}`, 'ui'));
    const more = h('button', { class: 'btn small ghost icon', title: 'Deck options', 'aria-label': 'Deck options' }, '⋯');
    more.addEventListener('click', (e) => this.deckMenu(e as MouseEvent));

    this.bpm = h('span');
    this.bpmOrig = h('small');
    const bpmBox = h('div', { class: 'bpm-big' }, this.bpm, this.bpmOrig);
    this.time = h('div', { class: 'time-big', title: 'Click to switch between elapsed and remaining', style: { cursor: 'pointer' } });
    this.time.addEventListener('click', () => (this.showRemain = !this.showRemain));
    this.keyChip = h('span', { class: 'chip key', title: 'Musical key (Camelot)' });
    this.tempoChip = h('span', { class: 'chip', title: 'Tempo change' });
    this.rangeChip = h('button', { class: 'chip', title: 'Tempo range — click to change', type: 'button' });
    this.rangeChip.addEventListener('click', () => reg.press(P('range'), 'ui'));

    this.overview = h('canvas');
    this.ov = this.overview.getContext('2d')!;
    const ovBox = h('div', { class: 'overview', title: 'Click to jump' }, this.overview);
    ovBox.addEventListener('pointerdown', (e) => {
      const d = this.deck();
      if (!d.loaded) return;
      const r = ovBox.getBoundingClientRect();
      const f = (e.clientX - r.left) / r.width;
      if (d.playing) d.jumpTo(f * d.duration);
      else d.seek(f * d.duration);
    });
    this.phase = [0, 1, 2, 3].map(() => h('i'));

    this.loopSize = h('span', { class: 'chip', style: { minWidth: '36px', justifyContent: 'center' } });
    this.jumpSize = h('span', { class: 'chip', style: { minWidth: '30px', justifyContent: 'center' } });
    this.keyShift = h('span', { class: 'chip', style: { minWidth: '34px', justifyContent: 'center' } });

    const pads = h('div', { class: 'pads' });
    for (let i = 0; i < 8; i++) {
      const pw = padButton(reg, P(`pad.${i + 1}`), () => this.deck().padLabel(i));
      pads.append(w(pw));
      pw.el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.cueMenu(i, e);
      });
    }
    const shortMode: Record<string, string> = { hotcue: 'Cue', roll: 'Roll', slicer: 'Slice', jump: 'Jump', pitch: 'Pitch', sampler: 'Sample' };
    const padModes = h('div', { class: 'padmode-seg', role: 'group', 'aria-label': 'Pad mode' }, ...PAD_MODES.map((m) => w(hwButton(reg, P(`padmode.${m}`), shortMode[m], { title: PAD_MODE_LABELS[m] }))));

    // tools: loops, beat jump, key, deck modes and stems — tucked away until needed
    const stemKnobs = (['vocal', 'drums', 'bass', 'melody'] as const).map((st) => w(knob(reg, P(`stem.${st}`), st === 'vocal' ? 'Vocal' : st === 'drums' ? 'Drums' : st === 'bass' ? 'Bass' : 'Melody', { size: 34 })));
    const stemPreset = (label: string, v: [number, number, number, number]) => {
      const b = h('button', { class: 'btn small', type: 'button' }, label);
      b.addEventListener('click', () => this.deck().setStems({ vocal: v[0], drums: v[1], bass: v[2], melody: v[3] }));
      return b;
    };
    const tools = h(
      'details',
      { class: 'deck-more' },
      h('summary', {}, 'Loops, key & stems'),
      h(
        'div',
        { class: 'deck-more-body' },
        h('div', { class: 'label' }, 'Loop'),
        h(
          'div',
          { class: 'tool-grid cols4' },
          w(hwButton(reg, P('loop.half'), '½', { title: 'Halve the loop' })),
          w(hwButton(reg, P('loop.auto'), 'Loop', { title: 'Beat loop on/off' })),
          this.loopSize,
          w(hwButton(reg, P('loop.double'), '×2', { title: 'Double the loop' })),
          w(hwButton(reg, P('loop.in'), 'In')),
          w(hwButton(reg, P('loop.out'), 'Out')),
          w(hwButton(reg, P('loop.exit'), 'Reloop / exit', { cls: 'span2' })),
        ),
        h(
          'div',
          { class: 'tool-grid jump-key' },
          h('div', { class: 'label span3' }, 'Beat jump'),
          h('div', { class: 'label span4' }, 'Key'),
          w(hwButton(reg, P('jump.back'), '◀', { title: 'Jump back' })),
          this.jumpSize,
          w(hwButton(reg, P('jump.fwd'), '▶', { title: 'Jump forward' })),
          w(hwButton(reg, P('key.down'), '♭', { title: 'Key down a semitone' })),
          this.keyShift,
          w(hwButton(reg, P('key.up'), '♯', { title: 'Key up a semitone' })),
          w(hwButton(reg, P('key.sync'), 'Match', { title: 'Key sync: shift to the master deck’s key' })),
        ),
        h('div', { class: 'label' }, 'Deck modes'),
        h(
          'div',
          { class: 'tool-grid cols3' },
          w(hwButton(reg, P('keylock'), 'Key lock')),
          w(hwButton(reg, P('slip'), 'Slip')),
          w(hwButton(reg, P('quantize'), 'Quantize')),
          w(hwButton(reg, P('vinyl'), 'Vinyl')),
          w(hwButton(reg, P('reverse'), 'Rev')),
          w(hwButton(reg, P('censor'), 'Censor', { title: 'Hold: plays backwards, then carries on in time (slip)' })),
        ),
        h('div', { class: 'label' }, 'Stems'),
        h('div', { class: 'knob-row', style: { justifyContent: 'space-between' } }, ...stemKnobs),
        h('div', { class: 'tool-grid cols2' }, stemPreset('Full', [1, 1, 1, 1]), stemPreset('Acapella', [1, 0, 0, 0]), stemPreset('Instrumental', [0, 1, 1, 1]), stemPreset('Drums', [0, 1, 0, 0])),
      ),
    );
    const openKey = `deckTools:${side}`;
    (tools as HTMLDetailsElement).open = loadSetting(openKey, false);
    tools.addEventListener('toggle', () => saveSetting(openKey, (tools as HTMLDetailsElement).open));

    this.el = h(
      'section',
      { class: `deck-panel ${side === 'L' ? 'left' : 'right'}`, 'aria-label': `Deck ${side === 'L' ? 'left' : 'right'}` },
      h('div', { class: 'deck-head' }, this.art, h('div', { class: 'deck-title' }, this.title, this.artist), h('div', { class: 'deck-layer' }, this.keyChip, h('div', { class: 'toggle-row', style: { gap: '2px', justifyContent: 'flex-end' } }, this.layerBtn, more))),
      h('div', { class: 'readouts' }, h('div', { class: 'bpm-line' }, bpmBox, this.tempoChip), this.time),
      h('div', { class: 'overview-wrap' }, ovBox, h('div', { class: 'phase', title: 'Beat within the bar' }, ...this.phase)),
      h(
        'div',
        { class: 'transport' },
        w(hwButton(reg, P('cue'), 'Cue', { cls: 'big', color: '#ff9f1c' })),
        w(hwButton(reg, P('play'), '▶︎❚❚', { cls: 'big', color: '#3ddc97', title: 'Play / Pause' })),
        h('div', { class: 'sync-stack' }, w(hwButton(reg, P('sync'), 'Sync')), w(hwButton(reg, P('master'), 'Master'))),
      ),
      h(
        'div',
        { class: 'tempo-row' },
        w(hwButton(reg, P('bend.down'), '−', { title: 'Pitch bend down (hold)' })),
        h('div', { class: 'tempo-fader', title: 'Tempo — double-click to reset' }, w(fader(reg, P('tempo'), { orientation: 'h', length: 170, invert: false, label: 'Tempo', center: true }))),
        w(hwButton(reg, P('bend.up'), '+', { title: 'Pitch bend up (hold)' })),
        this.rangeChip,
      ),
      padModes,
      pads,
      tools,
    );
    this.jumpSize.title = 'Beat jump size — click to double, right-click to halve';
    const jumpSizeWrap = this.jumpSize;
    jumpSizeWrap.style.cursor = 'pointer';
    jumpSizeWrap.addEventListener('click', () => this.deck().resizeJump(1));
    jumpSizeWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.deck().resizeJump(-1);
    });
    this.keyShift.title = 'Key shift in semitones — click to reset';
    this.keyShift.style.cursor = 'pointer';
    this.keyShift.addEventListener('click', () => this.deck().setKeyShift(0));

    // drop targets: library rows and audio files
    this.el.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.el.classList.add('drop-target');
    });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('drop-target'));
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.el.classList.remove('drop-target');
      const id = e.dataTransfer?.getData('application/x-deckhouse-track');
      const target = this.app.sideDeck(this.side);
      if (id) void this.app.loadTrack(target, id);
      else if (e.dataTransfer?.files.length) void this.app.importFiles([...e.dataTransfer.files], target);
    });
  }

  deck(): Deck {
    return this.app.engine.deck(this.app.sideDeck(this.side));
  }

  private cueMenu(i: number, e: MouseEvent): void {
    const d = this.deck();
    if (d.padMode !== 'hotcue') return;
    const c = d.hotCues[i];
    if (!c) {
      contextMenu(e.clientX, e.clientY, [{ label: `Set hot cue ${String.fromCharCode(65 + i)} here`, action: () => d.setHotCue(i) }]);
      return;
    }
    contextMenu(e.clientX, e.clientY, [
      { label: 'Rename…', action: () => this.renameCue(i) },
      ...HOTCUE_COLORS.map((col, k) => ({ label: `Colour ${k + 1} ${col === c.color ? '✓' : ''}`, action: () => d.updateHotCue(i, { color: col }) })),
      'sep' as const,
      { label: 'Move to playhead', action: () => d.setHotCue(i) },
      { label: 'Delete', danger: true, action: () => d.deleteHotCue(i) },
    ]);
  }

  private renameCue(i: number): void {
    const d = this.deck();
    const c = d.hotCues[i];
    if (!c) return;
    const input = h('input', { class: 'search', value: c.name, placeholder: 'e.g. Drop, Vocal in, Break', maxlength: 24 }) as HTMLInputElement;
    const save = h('button', { class: 'btn primary' }, 'Save name');
    const m = openModal(`Name hot cue ${String.fromCharCode(65 + i)}`, h('div', { style: { display: 'flex', gap: '8px' } }, input, save));
    const done = () => {
      d.updateHotCue(i, { name: input.value.trim() });
      m.close();
    };
    save.addEventListener('click', done);
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') done();
    });
    input.focus();
    input.select();
  }

  private deckMenu(e: MouseEvent): void {
    const d = this.deck();
    const t = d.track;
    const items: ({ label: string; action: () => void; danger?: boolean } | 'sep')[] = [
      { label: d.playing ? 'Eject (pause first)' : 'Eject track', action: () => d.eject() },
    ];
    if (t && d.analysis) {
      const a = d.analysis;
      const set = (patch: { bpm?: number; firstBeat?: number }) => {
        this.app.library.updateGrid(t, patch);
        d.emit('change', d);
      };
      items.push(
        'sep',
        { label: 'Tap tempo…', action: () => this.tap() },
        { label: `Double BPM → ${formatBpm(a.bpm * 2)}`, action: () => set({ bpm: a.bpm * 2 }) },
        { label: `Halve BPM → ${formatBpm(a.bpm / 2)}`, action: () => set({ bpm: a.bpm / 2 }) },
        { label: 'Set downbeat at playhead', action: () => set({ firstBeat: d.position() }) },
        { label: 'Shift grid ½ beat', action: () => set({ firstBeat: a.firstBeat + d.beatLen / 2 }) },
      );
    }
    contextMenu(e.clientX, e.clientY, items);
  }

  private tap(): void {
    const d = this.deck();
    if (!d.track || !d.analysis) return;
    const taps: number[] = [];
    const readout = h('div', { class: 'bpm-big', style: { fontSize: '44px', textAlign: 'center', margin: '8px 0' } }, '--.-');
    const hint = h('p', { class: 'note', style: { textAlign: 'center' } }, 'Tap along with the beat (click the pad or press T). Four taps or more give a tempo.');
    const pad = h('button', { class: 'btn primary', style: { width: '100%', height: '90px', fontSize: '22px' } }, 'Tap');
    const apply = h('button', { class: 'btn', disabled: true }, 'Apply to track');
    let bpm = 0;
    const onTap = () => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
      taps.push(now);
      if (taps.length >= 4) {
        const span = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
        bpm = 60000 / span;
        readout.textContent = formatBpm(bpm);
        apply.removeAttribute('disabled');
      } else readout.textContent = `${taps.length}/4`;
    };
    pad.addEventListener('pointerdown', onTap);
    const m = openModal(`Tap tempo — deck ${d.id}`, h('div', { style: { display: 'grid', gap: '8px', maxWidth: '420px', margin: '0 auto' } }, hint, readout, pad, apply));
    const key = (e: KeyboardEvent) => {
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        e.stopPropagation();
        onTap();
      }
    };
    document.addEventListener('keydown', key, true);
    const close = m.close;
    m.close = () => {
      document.removeEventListener('keydown', key, true);
      close();
    };
    apply.addEventListener('click', () => {
      if (!bpm || !d.track) return;
      const real = bpm / Math.max(0.05, d.baseRate);
      this.app.library.updateGrid(d.track, { bpm: Math.round(real * 100) / 100 });
      d.emit('change', d);
      toast(`Deck ${d.id} tempo set to ${formatBpm(real)} BPM`);
      m.close();
    });
  }

  update(): void {
    const d = this.deck();
    const id = d.id as DeckId;
    const color = DECK_COLORS[id];
    setVar(this.el, '--deck', color);
    setText(this.num, String(id));
    const four = this.app.deckCount() === 4;
    this.layerBtn.hidden = !four;
    setText(this.layerBtn, this.side === 'L' ? (id === 1 ? '⇄ 3' : '⇄ 1') : id === 2 ? '⇄ 4' : '⇄ 2');
    this.layerBtn.title = `Switch to deck ${this.side === 'L' ? (id === 1 ? 3 : 1) : id === 2 ? 4 : 2}`;
    const t = d.track;
    const art = t?.meta.art ? `url("${t.meta.art}")` : '';
    if (this.discLabel.style.backgroundImage !== art) this.discLabel.style.backgroundImage = art;
    const deg = Math.round((-d.recordAngle * 180) / Math.PI);
    if (deg !== this.discAngle) {
      this.discAngle = deg;
      this.disc.style.transform = `rotate(${deg}deg)`;
    }
    setClass(this.art, 'spinning', d.playing);
    setText(this.title, t ? t.meta.title : 'No track loaded');
    setText(this.artist, t ? t.meta.artist || t.fileName : 'Drag a track here, or use Load in the library');
    setText(this.bpm, d.loaded ? formatBpm(d.bpm) : '--.-');
    setText(this.bpmOrig, 'BPM');
    this.bpmOrig.title = d.analysis ? `Track tempo ${formatBpm(d.analysis.bpm)} BPM` : '';
    const tt = this.showRemain ? `-${formatTime(d.remaining, true)}` : formatTime(d.position(), true);
    setText(this.time, d.loaded ? tt : '-:--.-');
    const key = d.currentKey();
    const masterKey = this.app.engine.masterDeck && this.app.engine.masterDeck !== d ? this.app.engine.masterDeck.currentKey() : null;
    const compat = compatibility(key, masterKey);
    setText(this.keyChip, key ? `${key.camelot}${compat === 'same' || compat === 'harmonic' ? ' ✓' : ''}` : '—');
    setVar(this.keyChip, 'background', camelotColor(key));
    this.keyChip.style.background = camelotColor(key);
    this.keyChip.title = key ? `Key ${key.name} (${key.camelot})${masterKey ? ` · master ${masterKey.camelot}: ${compat ?? 'clash'}` : ''}` : 'Key unknown';
    const pct = d.tempoPercent;
    setText(this.tempoChip, `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
    setText(this.rangeChip, `±${Math.round(d.range * 100)}%`);
    setText(this.loopSize, beatLabel(d.loopBeats));
    setText(this.jumpSize, beatLabel(d.jumpBeats));
    setText(this.keyShift, `${d.keyShift > 0 ? '+' : ''}${d.keyShift}`);
    const dpr = fitCanvas(this.overview);
    drawOverview(this.ov, d, this.overview.width, this.overview.height, dpr);
    const beat = d.analysis ? Math.floor(d.beatPosition(d.displayPosition())) : -1;
    const inBar = ((beat % 4) + 4) % 4;
    this.phase.forEach((p, i) => setClass(p, 'on', d.loaded && d.analysis !== null && i === inBar));
    for (const x of this.widgets) x.update();
  }
}
