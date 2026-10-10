/*
 * Top bar: board, venue, crowd meter, master tempo, recorder, the Simple / Pro
 * switch and a ⋯ menu (view, full screen, MIDI, help). A MIDI pill appears
 * only while a controller is connected.
 */
import { nameService } from '../name/NameService';
import type { AppContext } from '../app/context';
import { formatBpm, formatTime } from '../core/util';
import { h, setClass, setText } from './dom';

export interface TopBarActions {
  pickBoard(): void;
  pickVenue(): void;
  venueName(): string;
  venueShort(): string;
  /** crowd energy 0..1 */
  hype(): number;
  /** beat pulse 0..1 */
  beat(): number;
  /** livestream viewer count, or null when not streaming */
  live(): string | null;
  record(): void;
  /** the recording studio's settings */
  recordMenu(): void;
  /** open the pre-gig screen */
  gig(): void;
  /** home: the hub apartment */
  home(): void;
  midi(): void;
  /** open the ⋯ menu at a screen position */
  menu(x: number, y: number): void;
  uiMode(): 'simple' | 'pro';
  setUiMode(m: 'simple' | 'pro'): void;
  boardName(): string;
  midiConnected(): boolean;
  recording(): { on: boolean; elapsed: number; counting?: boolean; buffer?: boolean };
}

export class TopBar {
  private djName: HTMLElement;
  readonly el: HTMLElement;
  private boardBtn: HTMLElement;
  private venueBtn: HTMLElement;
  private boardLabel = h('span', { class: 'ellipsis' });
  private venueLabel = h('span', { class: 'ellipsis lbl-full' });
  private venueShort = h('span', { class: 'ellipsis lbl-short' });
  private hypeCells: HTMLElement[];
  private hypeEl: HTMLElement;
  private beatLed: HTMLElement;
  private liveEl: HTMLElement;
  private liveCount: HTMLElement;
  private modeBtns = new Map<'simple' | 'pro', HTMLElement>();
  private midiBtn: HTMLElement;
  private master: HTMLElement;
  private masterDeck: HTMLElement;
  private rec: HTMLElement;
  private recGroup: HTMLElement;
  private bufDot: HTMLElement;
  private recTime: HTMLElement;
  private midiDot: HTMLElement;

  constructor(
    private app: AppContext,
    private a: TopBarActions,
  ) {
    this.boardBtn = h('button', { class: 'btn board-btn', title: 'Choose a board' }, this.boardLabel, h('span', { 'aria-hidden': 'true' }, '▾'));
    this.boardBtn.addEventListener('click', () => a.pickBoard());
    this.venueBtn = h('button', { class: 'btn venue-btn', title: 'Choose where you play' }, h('span', { 'aria-hidden': 'true' }, '📍'), this.venueLabel, this.venueShort, h('span', { 'aria-hidden': 'true' }, '▾'));
    this.venueBtn.addEventListener('click', () => a.pickVenue());
    this.hypeCells = Array.from({ length: 12 }, () => h('i'));
    this.hypeEl = h('div', { class: 'hype-meter', title: 'The vibe: rises with clean mixes, the right energy and well-built drops; trainwrecks, clashes and dead air cost you' }, h('span', { class: 'label' }, 'Vibe'), h('span', { class: 'cells' }, ...this.hypeCells));
    this.beatLed = h('span', { class: 'beat-led' });
    this.liveCount = h('span', { class: 'mono' });
    this.liveEl = h('span', { class: 'live-badge', title: 'Streaming live' }, h('span', { class: 'dot' }), 'LIVE', this.liveCount);
    const mode = h('div', { class: 'seg mode-seg', role: 'group', 'aria-label': 'Interface' });
    ([
      ['simple', 'Simple', 'Just the essentials: play, cue, sync, tempo and the library'],
      ['pro', 'Pro', 'Everything: pads, loops, key and stems on the deck panels'],
    ] as ['simple' | 'pro', string, string][]).forEach(([m, label, title]) => {
      const b = h('button', { class: 'btn', title, type: 'button' }, label);
      b.addEventListener('click', () => a.setUiMode(m));
      this.modeBtns.set(m, b);
      mode.append(b);
    });
    this.master = h('span', { class: 'mono' });
    this.masterDeck = h('span', { class: 'label' });
    this.rec = h('button', { class: 'btn rec-btn', title: 'Record your mix', 'aria-label': 'Record your mix' }, h('span', { class: 'dot' }), h('span', { class: 'rec-label' }, 'Rec'));
    this.recTime = h('span', { class: 'mono', style: { fontSize: '12px' } });
    this.rec.append(this.recTime);
    this.rec.addEventListener('click', () => a.record());
    const recMenu = h('button', { class: 'btn rec-menu', title: 'Recording studio: mode, quality, camera, overlays, replay buffer', 'aria-label': 'Recording settings', type: 'button' }, '▾');
    recMenu.addEventListener('click', () => a.recordMenu());
    this.bufDot = h('span', { class: 'buf-dot', title: 'Replay buffer on: SAVE THAT MIX (Shift+S) keeps the last few minutes', hidden: true });
    this.recGroup = h('div', { class: 'rec-group' }, this.rec, recMenu, this.bufDot);
    const gig = h('button', { class: 'btn gig-btn', title: 'Play a gig: your bookings, or a free set', type: 'button' }, 'Play a gig');
    gig.addEventListener('click', () => a.gig());
    const home = h('button', { class: 'btn ghost home-btn', title: 'Home: your place, your bookings, wardrobe, crates, sets and phone', 'aria-label': 'Home', type: 'button' }, '⌂', h('span', { class: 'hide-sm' }, ' Home'));
    home.addEventListener('click', () => a.home());
    this.midiDot = h('span', { class: 'status-dot on' });
    this.midiBtn = h('button', { class: 'btn ghost hide-sm', title: 'MIDI controller connected — open MIDI settings', hidden: true }, this.midiDot, 'MIDI');
    this.midiBtn.addEventListener('click', () => a.midi());
    const more = h('button', { class: 'btn ghost icon', title: 'View, full screen, MIDI and help', 'aria-label': 'More', 'aria-haspopup': 'menu' }, '⋯');
    more.addEventListener('click', (e) => {
      const r = more.getBoundingClientRect();
      a.menu((e as MouseEvent).clientX || r.left, r.bottom + 4);
    });
    this.djName = h('span', { class: 'dj-name', title: 'Your DJ name — change it in Settings → Profile' });
    const showName = () => {
      this.djName.hidden = !nameService.named;
      setText(this.djName, nameService.text);
    };
    showName();
    nameService.onChange(showName);
    this.el = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-text' }, 'DECKHOUSE')),
      this.djName,
      this.boardBtn,
      this.venueBtn,
      h('span', { class: 'spacer' }),
      this.liveEl,
      this.hypeEl,
      h('div', { class: 'master-readout', title: 'Tempo of the sync master deck' }, this.beatLed, this.masterDeck, this.master),
      home,
      gig,
      this.recGroup,
      this.midiBtn,
      mode,
      more,
    );
  }

  update(): void {
    setText(this.boardLabel, this.a.boardName());
    setText(this.venueLabel, this.a.venueName());
    setText(this.venueShort, this.a.venueShort());
    const lit = Math.round(this.a.hype() * this.hypeCells.length);
    this.hypeCells.forEach((c, i) => setClass(c, 'on', i < lit));
    this.beatLed.style.opacity = (0.15 + this.a.beat() * 0.85).toFixed(2);
    const live = this.a.live();
    this.liveEl.hidden = live === null;
    if (live !== null) setText(this.liveCount, live);
    const m = this.a.uiMode();
    for (const [k, b] of this.modeBtns) {
      setClass(b, 'active', k === m);
      b.setAttribute('aria-pressed', String(k === m));
    }
    const md = this.app.engine.masterDeck;
    setText(this.masterDeck, md ? `Master ${md.id}` : 'Master');
    setText(this.master, md ? formatBpm(md.bpm) : '--.-');
    const r = this.a.recording();
    setClass(this.rec, 'on', r.on);
    setClass(this.rec, 'counting', !!r.counting);
    setText(this.recTime, r.on ? formatTime(r.elapsed) : r.counting ? '…' : '');
    this.bufDot.hidden = !r.buffer;
    this.midiBtn.hidden = !this.a.midiConnected();
  }
}
