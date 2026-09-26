/* Top bar: board picker, camera views, stage view, master tempo, recorder, MIDI, help. */
import type { AppContext } from '../app/context';
import { VIEW_LABELS, type ViewId } from '../three/CameraRig';
import type { StageView } from '../three/Stage';
import { formatBpm, formatTime } from '../core/util';
import { h, setClass, setText } from './dom';
import { contextMenu } from './modal';

export interface TopBarActions {
  pickBoard(): void;
  camera(v: ViewId): void;
  cameraMenu(x: number, y: number): void;
  view(v: StageView): void;
  fullscreen(): void;
  record(): void;
  midi(): void;
  help(): void;
  toggleFocus(): void;
  boardName(): string;
  currentView(): StageView;
  currentCamera(): string;
  midiConnected(): boolean;
  recording(): { on: boolean; elapsed: number };
}

export class TopBar {
  readonly el: HTMLElement;
  private boardBtn: HTMLElement;
  private camBtns = new Map<string, HTMLElement>();
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
    this.boardBtn = h('button', { class: 'btn', title: 'Choose a board' });
    this.boardBtn.addEventListener('click', () => a.pickBoard());
    const cams = h('div', { class: 'seg', role: 'group', 'aria-label': 'Camera view' });
    (Object.keys(VIEW_LABELS) as ViewId[]).forEach((v) => {
      const b = h('button', { class: 'btn', title: `${VIEW_LABELS[v]} camera` }, VIEW_LABELS[v]);
      b.addEventListener('click', () => a.camera(v));
      this.camBtns.set(v, b);
      cams.append(b);
    });
    const anchors = h('button', { class: 'btn', title: 'Saved camera positions' }, '★');
    anchors.addEventListener('click', (e) => a.cameraMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY));
    cams.append(anchors);
    const views = h('div', { class: 'seg', role: 'group', 'aria-label': 'Stage view' });
    ([
      ['booth', 'Booth'],
      ['split', 'Split'],
      ['visual', 'Visuals'],
    ] as [StageView, string][]).forEach(([v, label]) => {
      const b = h('button', { class: 'btn' }, label);
      b.addEventListener('click', () => a.view(v));
      this.viewBtns.set(v, b);
      views.append(b);
    });
    const fs = h('button', { class: 'btn icon', title: 'Full screen' }, '⛶');
    fs.addEventListener('click', () => a.fullscreen());
    const focus = h('button', { class: 'btn icon hide-sm', title: 'Hide / show the side deck panels' }, '⇔');
    focus.addEventListener('click', () => a.toggleFocus());
    this.master = h('span', { class: 'mono' });
    this.masterDeck = h('span', { class: 'label' });
    this.rec = h('button', { class: 'btn rec-btn', title: 'Record your mix' }, h('span', { class: 'dot' }), 'REC');
    this.recTime = h('span', { class: 'mono', style: { fontSize: '12px' } });
    this.rec.append(this.recTime);
    this.rec.addEventListener('click', () => a.record());
    this.midiDot = h('span', { class: 'status-dot' });
    const midi = h('button', { class: 'btn ghost', title: 'MIDI controllers' }, this.midiDot, 'MIDI');
    midi.addEventListener('click', () => a.midi());
    const help = h('button', { class: 'btn ghost icon', title: 'Help and keyboard shortcuts' }, '?');
    help.addEventListener('click', () => a.help());
    this.el = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), 'DECKHOUSE', h('small', { class: 'hide-sm' }, 'DJ STUDIO')),
      this.boardBtn,
      h('span', { class: 'tb-sep hide-sm' }),
      cams,
      views,
      fs,
      focus,
      h('span', { class: 'spacer' }),
      h('div', { class: 'master-readout', title: 'Sync master tempo' }, this.masterDeck, this.master),
      this.rec,
      midi,
      help,
    );
    void contextMenu;
  }

  update(): void {
    setText(this.boardBtn, `▦ ${this.a.boardName()}`);
    const cam = this.a.currentCamera();
    for (const [v, b] of this.camBtns) setClass(b, 'active', v === cam);
    const view = this.a.currentView();
    for (const [v, b] of this.viewBtns) setClass(b, 'active', v === view);
    const m = this.app.engine.masterDeck;
    setText(this.masterDeck, m ? `MASTER ${m.id}` : 'MASTER');
    setText(this.master, m ? formatBpm(m.bpm) : '--.-');
    const r = this.a.recording();
    setClass(this.rec, 'on', r.on);
    setText(this.recTime, r.on ? formatTime(r.elapsed) : '');
    setClass(this.midiDot, 'on', this.a.midiConnected());
  }
}
