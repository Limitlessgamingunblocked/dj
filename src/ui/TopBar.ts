/* Top bar: board, venue, view, crowd meter, master tempo, recorder, MIDI, help, full screen. */
import type { AppContext } from '../app/context';
import type { StageView } from '../three/Stage';
import { formatBpm, formatTime } from '../core/util';
import { h, setClass, setText } from './dom';

export interface TopBarActions {
  pickBoard(): void;
  pickVenue(): void;
  venueName(): string;
  /** crowd energy 0..1 */
  hype(): number;
  /** beat pulse 0..1 */
  beat(): number;
  /** livestream viewer count, or null when not streaming */
  live(): string | null;
  view(v: StageView): void;
  fullscreen(): void;
  record(): void;
  midi(): void;
  help(): void;
  boardName(): string;
  currentView(): StageView;
  midiConnected(): boolean;
  recording(): { on: boolean; elapsed: number };
}

export class TopBar {
  readonly el: HTMLElement;
  private boardBtn: HTMLElement;
  private venueBtn: HTMLElement;
  private hypeCells: HTMLElement[];
  private hypeEl: HTMLElement;
  private beatLed: HTMLElement;
  private liveEl: HTMLElement;
  private liveCount: HTMLElement;
  private viewBtns = new Map<StageView, HTMLElement>();
  private master: HTMLElement;
  private masterDeck: HTMLElement;
  private rec: HTMLElement;
  private recTime: HTMLElement;
  private midiDot: HTMLElement;

  constructor(
    private app: AppContext,
    private a: TopBarActions,
  ) {
    this.boardBtn = h('button', { class: 'btn board-btn', title: 'Choose a board' });
    this.boardBtn.addEventListener('click', () => a.pickBoard());
    this.venueBtn = h('button', { class: 'btn venue-btn', title: 'Choose where you play' });
    this.venueBtn.addEventListener('click', () => a.pickVenue());
    this.hypeCells = Array.from({ length: 12 }, () => h('i'));
    this.hypeEl = h('div', { class: 'hype-meter', title: 'Crowd energy: rises with the music, clean blends and drops; trainwrecks and key clashes cost you' }, h('span', { class: 'label' }, 'Crowd'), h('span', { class: 'cells' }, ...this.hypeCells));
    this.beatLed = h('span', { class: 'beat-led' });
    this.liveCount = h('span', { class: 'mono' });
    this.liveEl = h('span', { class: 'live-badge', title: 'Streaming live' }, h('span', { class: 'dot' }), 'LIVE', this.liveCount);
    const views = h('div', { class: 'seg', role: 'group', 'aria-label': 'What the stage shows' });
    ([
      ['booth', 'Booth'],
      ['split', 'Split'],
      ['visual', 'Visuals'],
    ] as [StageView, string][]).forEach(([v, label]) => {
      const b = h('button', { class: 'btn', title: v === 'booth' ? '3D booth' : v === 'split' ? '3D booth with the visual player inset' : 'Visual player only' }, label);
      b.addEventListener('click', () => a.view(v));
      this.viewBtns.set(v, b);
      views.append(b);
    });
    this.master = h('span', { class: 'mono' });
    this.masterDeck = h('span', { class: 'label' });
    this.rec = h('button', { class: 'btn rec-btn', title: 'Record your mix' }, h('span', { class: 'dot' }), 'Rec');
    this.recTime = h('span', { class: 'mono', style: { fontSize: '12px' } });
    this.rec.append(this.recTime);
    this.rec.addEventListener('click', () => a.record());
    this.midiDot = h('span', { class: 'status-dot' });
    const midi = h('button', { class: 'btn ghost hide-sm', title: 'MIDI controllers' }, this.midiDot, 'MIDI');
    midi.addEventListener('click', () => a.midi());
    const help = h('button', { class: 'btn ghost icon', title: 'How to use Deckhouse', 'aria-label': 'Help' }, '?');
    help.addEventListener('click', () => a.help());
    const fs = h('button', { class: 'btn ghost icon hide-sm', title: 'Full screen', 'aria-label': 'Full screen' }, '⛶');
    fs.addEventListener('click', () => a.fullscreen());
    this.el = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), 'DECKHOUSE'),
      this.boardBtn,
      this.venueBtn,
      views,
      h('span', { class: 'spacer' }),
      this.liveEl,
      this.hypeEl,
      h('div', { class: 'master-readout', title: 'Tempo of the sync master deck' }, this.beatLed, this.masterDeck, this.master),
      this.rec,
      midi,
      help,
      fs,
    );
  }

  update(): void {
    setText(this.boardBtn, `${this.a.boardName()} ▾`);
    setText(this.venueBtn, `📍 ${this.a.venueName()} ▾`);
    const lit = Math.round(this.a.hype() * this.hypeCells.length);
    this.hypeCells.forEach((c, i) => setClass(c, 'on', i < lit));
    this.beatLed.style.opacity = (0.15 + this.a.beat() * 0.85).toFixed(2);
    const live = this.a.live();
    this.liveEl.hidden = live === null;
    if (live !== null) setText(this.liveCount, live);
    const view = this.a.currentView();
    for (const [v, b] of this.viewBtns) setClass(b, 'active', v === view);
    const m = this.app.engine.masterDeck;
    setText(this.masterDeck, m ? `Master ${m.id}` : 'Master');
    setText(this.master, m ? formatBpm(m.bpm) : '--.-');
    const r = this.a.recording();
    setClass(this.rec, 'on', r.on);
    setText(this.recTime, r.on ? formatTime(r.elapsed) : '');
    setClass(this.midiDot, 'on', this.a.midiConnected());
  }
}
