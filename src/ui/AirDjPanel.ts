/*
 * Air DJ's window on the stage: your webcam, mirrored, with the hands it
 * sees drawn over it, what each hand is doing, and the gestures to try.
 */
import type { HandView, Side } from '../app/airdj/gestures';
import type { TrackerStatus } from '../app/airdj/tracker';
import { h, setText } from './dom';

/* the lines between MediaPipe's 21 hand landmarks */
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const SIDE_COLOR: Record<Side, string> = { L: 'var(--deck1)', R: 'var(--deck2)' };

export const GESTURES: [string, string][] = [
  ['🤏 Pinch', 'grab the record: move left and right to scratch'],
  ['✋ Open palm', 'filter: raise for high-pass, lower for low-pass'],
  ['✌️ Peace sign', 'beat FX on that deck while held, higher for more'],
  ['☝️ Point', 'crossfader: slide your finger left and right'],
  ['🙌 Both palms up high', 'hands up: the crowd copies you'],
  ['✊ Fist', 'rest: does nothing'],
];

const STATUS: Record<TrackerStatus, string> = {
  off: 'Off',
  camera: 'Starting the camera…',
  loading: 'Loading hand tracking…',
  running: '',
  error: '',
};

export class AirDjPanel {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private status: HTMLElement;
  private chips: Record<Side, HTMLElement>;
  private help: HTMLElement;
  private flash: HTMLElement;
  private colors: Record<Side, string> | null = null;

  constructor(video: HTMLVideoElement, o: { close(): void }) {
    video.className = 'air-video';
    this.canvas = h('canvas', { class: 'air-canvas', width: 320, height: 240 });
    this.ctx = this.canvas.getContext('2d')!;
    this.status = h('div', { class: 'air-status', role: 'status' });
    this.flash = h('div', { class: 'air-flash', hidden: true }, 'HANDS UP!');
    this.chips = { L: h('span', { class: 'air-chip' }), R: h('span', { class: 'air-chip' }) };
    this.chips.L.style.setProperty('--c', SIDE_COLOR.L);
    this.chips.R.style.setProperty('--c', SIDE_COLOR.R);
    this.help = h(
      'ul',
      { class: 'air-help', hidden: true },
      GESTURES.map(([g, what]) => h('li', {}, h('b', {}, g), ' ', what)),
      h('li', { class: 'air-note' }, 'Each hand works the deck on its side. Scratching needs the jog set to vinyl (Settings → Decks).'),
    );
    const helpBtn = h('button', { class: 'btn small icon', type: 'button', title: 'Gestures', 'aria-label': 'Show the gestures', 'aria-expanded': 'false' }, '?');
    helpBtn.addEventListener('click', () => {
      this.help.hidden = !this.help.hidden;
      helpBtn.setAttribute('aria-expanded', String(!this.help.hidden));
    });
    const close = h('button', { class: 'btn small icon', type: 'button', title: 'Turn Air DJ off (⇧H)', 'aria-label': 'Turn Air DJ off' }, '×');
    close.addEventListener('click', () => o.close());
    this.el = h(
      'div',
      { class: 'air-dj', role: 'region', 'aria-label': 'Air DJ webcam control' },
      h('div', { class: 'air-head' }, h('span', { class: 'air-label' }, 'Air DJ'), h('span', { class: 'air-acts' }, helpBtn, close)),
      h('div', { class: 'air-view' }, video, this.canvas, this.status, this.flash),
      h('div', { class: 'air-chips' }, this.chips.L, this.chips.R),
      this.help,
    );
  }

  showHelp(on: boolean): void {
    this.help.hidden = !on;
  }

  /** read the deck colours again (they change in Settings) */
  recolor(): void {
    this.colors = null;
  }

  setStatus(s: TrackerStatus, message = ''): void {
    const text = message || STATUS[s];
    setText(this.status, text);
    this.status.hidden = !text;
    this.el.classList.toggle('air-error', s === 'error');
  }

  /** draw the hands over the picture and say what they're doing */
  draw(hands: HandView[], handsUp: boolean): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const ht = canvas.height;
    ctx.clearRect(0, 0, w, ht);
    if (!this.colors) {
      // the deck colours (they can be changed in Settings, so read once the panel is on screen)
      const css = getComputedStyle(this.el);
      this.colors = { L: css.getPropertyValue('--deck1').trim() || '#4cc9f0', R: css.getPropertyValue('--deck2').trim() || '#ff9f1c' };
    }
    const seen: Partial<Record<Side, HandView>> = {};
    for (const hand of hands) {
      seen[hand.side] = hand;
      const col = this.colors[hand.side];
      const busy = !!hand.action;
      ctx.strokeStyle = col;
      ctx.lineWidth = busy ? 3 : 2;
      ctx.globalAlpha = busy ? 1 : 0.7;
      ctx.beginPath();
      for (const [a, b] of BONES) {
        ctx.moveTo(hand.lm[a].x * w, hand.lm[a].y * ht);
        ctx.lineTo(hand.lm[b].x * w, hand.lm[b].y * ht);
      }
      ctx.stroke();
      ctx.fillStyle = '#fff';
      for (const p of hand.lm) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * ht, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (busy) {
        ctx.globalAlpha = 1;
        ctx.font = '700 13px system-ui, sans-serif';
        ctx.fillStyle = col;
        ctx.textAlign = 'center';
        ctx.fillText(hand.action, hand.lm[0].x * w, Math.min(ht - 6, hand.lm[0].y * ht + 18));
      }
    }
    ctx.globalAlpha = 1;
    for (const side of ['L', 'R'] as Side[]) {
      const hand = seen[side];
      setText(this.chips[side], `${side === 'L' ? 'Left' : 'Right'} deck · ${hand ? hand.action || poseWord(hand.pose) : 'no hand'}`);
      this.chips[side].classList.toggle('on', !!hand?.action);
    }
    this.flash.hidden = !handsUp;
  }
}

function poseWord(p: HandView['pose']): string {
  return p === 'fist' ? 'resting' : p === 'none' ? 'ready' : p;
}
