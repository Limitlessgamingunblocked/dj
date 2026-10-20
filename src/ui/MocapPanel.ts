/*
 * Body tracking's window on the stage: your webcam, mirrored, with the body,
 * face and hands it sees drawn over it, switches for each part, and what
 * your DJ is copying right now.
 */
import type { MocapFrame } from '../character/mocapFrame';
import { HAND_BONES, POSE_BONES, type MocapIn } from '../app/mocap/landmarks';
import type { MocapOpts } from '../app/mocap/retarget';
import type { TrackerStatus } from '../app/mocap/tracker';
import { MOVES } from './MocapIntro';
import { h, setText } from './dom';

const STATUS: Record<TrackerStatus, string> = {
  off: 'Off',
  camera: 'Starting the camera…',
  loading: 'Loading body tracking…',
  running: '',
  error: '',
};

/** the switches on the window, by what they change */
const SWITCHES: { key: keyof MocapOpts; label: string; title: string }[] = [
  { key: 'body', label: 'Body', title: 'Copy your arms, chest and legs' },
  { key: 'face', label: 'Face', title: 'Copy your face and the turn of your head' },
  { key: 'hands', label: 'Fingers', title: 'Copy each hand’s turn and your fingers' },
  { key: 'mirror', label: 'Mirror', title: 'Like a mirror: your right arm is the one on the right of the screen' },
];

export interface MocapPanelHooks {
  close(): void;
  guide(): void;
  recenter(): void;
  /** a switch flipped */
  set(key: keyof MocapOpts, on: boolean): void;
}

export class MocapPanel {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private status: HTMLElement;
  private copying: HTMLElement;
  private note: HTMLElement;
  private help: HTMLElement;
  private flash: HTMLElement;
  private switches = new Map<keyof MocapOpts, HTMLButtonElement>();
  private colors: { body: string; L: string; R: string } | null = null;

  constructor(video: HTMLVideoElement, opts: MocapOpts, o: MocapPanelHooks) {
    video.className = 'mocap-video';
    this.canvas = h('canvas', { class: 'mocap-canvas', width: 320, height: 240 });
    this.ctx = this.canvas.getContext('2d')!;
    this.status = h('div', { class: 'mocap-status', role: 'status' });
    this.flash = h('div', { class: 'mocap-flash', hidden: true }, 'HANDS UP!');
    this.copying = h('div', { class: 'mocap-copying', 'aria-live': 'polite' });
    this.note = h('div', { class: 'mocap-note', hidden: true }, 'This outfit is a scan of a real person, so it turns its head but can’t pull your faces. Change any piece in Character for a DJ that copies your expressions.');
    this.help = h(
      'ul',
      { class: 'mocap-help', hidden: true },
      MOVES.map((g) => h('li', {}, h('b', {}, `${g.icon} ${g.name.split(':')[0]}`), ' ', g.does)),
      h('li', {}, h('button', { type: 'button', class: 'btn small', onclick: () => o.guide() }, 'Full guide')),
    );
    const helpBtn = h('button', { class: 'btn small icon', type: 'button', title: 'What it copies', 'aria-label': 'Show what it copies', 'aria-expanded': 'false' }, '?');
    helpBtn.addEventListener('click', () => {
      this.help.hidden = !this.help.hidden;
      helpBtn.setAttribute('aria-expanded', String(!this.help.hidden));
    });
    const close = h('button', { class: 'btn small icon', type: 'button', title: 'Turn body tracking off (⇧H)', 'aria-label': 'Turn body tracking off' }, '×');
    close.addEventListener('click', () => o.close());
    const toggles = SWITCHES.map((s) => {
      const b = h('button', { type: 'button', class: 'mocap-switch', title: s.title, 'aria-pressed': String(opts[s.key]) }, s.label);
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        o.set(s.key, on);
      });
      this.switches.set(s.key, b);
      return b;
    });
    const recenter = h('button', { type: 'button', class: 'mocap-switch', title: 'Take your resting pose again: sit how you’ll play and press' }, 'Recenter');
    recenter.addEventListener('click', () => o.recenter());
    this.el = h(
      'div',
      { class: 'mocap', role: 'region', 'aria-label': 'Body tracking webcam' },
      h('div', { class: 'mocap-head' }, h('span', { class: 'mocap-label' }, 'Body tracking'), h('span', { class: 'mocap-acts' }, helpBtn, close)),
      h('div', { class: 'mocap-view' }, video, this.canvas, this.status, this.flash),
      h('div', { class: 'mocap-switches' }, toggles, recenter),
      this.copying,
      this.note,
      this.help,
    );
  }

  showHelp(on: boolean): void {
    this.help.hidden = !on;
  }

  /** read the colours again (they change in Settings) */
  recolor(): void {
    this.colors = null;
  }

  setStatus(s: TrackerStatus, message = ''): void {
    const text = message || STATUS[s];
    setText(this.status, text);
    this.status.hidden = !text;
    this.el.classList.toggle('mocap-error', s === 'error');
  }

  /** what the camera saw, drawn over the picture (mirrored), and what the DJ's copying (`faceless`: the character can't pull faces) */
  draw(seen: MocapIn | null, frame: MocapFrame | null, handsUp: boolean, crowd: number | null, waiting: boolean, faceless = false): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const ht = canvas.height;
    ctx.clearRect(0, 0, w, ht);
    if (!this.colors) {
      const css = getComputedStyle(this.el);
      this.colors = { body: css.getPropertyValue('--venue').trim() || '#ffd23f', L: css.getPropertyValue('--deck1').trim() || '#4cc9f0', R: css.getPropertyValue('--deck2').trim() || '#ff9f1c' };
    }
    const X = (x: number) => (1 - x) * w;
    const pose = seen?.pose;
    if (pose) {
      ctx.strokeStyle = this.colors.body;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const [a, b] of POSE_BONES) {
        const p = pose.lm[a];
        const q = pose.lm[b];
        if ((p.visibility ?? 1) < 0.5 || (q.visibility ?? 1) < 0.5) continue;
        ctx.moveTo(X(p.x), p.y * ht);
        ctx.lineTo(X(q.x), q.y * ht);
      }
      ctx.stroke();
    }
    const face = seen?.face;
    if (face) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < face.dots.length; i += 2) ctx.fillRect(X(face.dots[i]) - 0.75, face.dots[i + 1] * ht - 0.75, 1.5, 1.5);
    }
    for (const hand of seen?.hands ?? []) {
      // (the player's right hand is on the left of the unmirrored picture)
      ctx.strokeStyle = hand.lm[0].x < 0.5 ? this.colors.R : this.colors.L;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [a, b] of HAND_BONES) {
        ctx.moveTo(X(hand.lm[a].x), hand.lm[a].y * ht);
        ctx.lineTo(X(hand.lm[b].x), hand.lm[b].y * ht);
      }
      ctx.stroke();
    }
    if (crowd !== null) {
      // crowd control: a bar along the top with your lean on it
      const y = 14;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(w * 0.2, y - 9, w * 0.6, 18);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(w * 0.5 + crowd * w * 0.28 - 5, y - 7, 10, 14);
      ctx.globalAlpha = 1;
    }
    setText(this.flash, crowd !== null && !handsUp ? 'CROWD CONTROL' : 'HANDS UP!');
    this.flash.hidden = !handsUp && crowd === null;
    this.flash.classList.toggle('mocap-flash-crowd', crowd !== null && !handsUp);
    setText(this.copying, copyingLine(frame, !!pose, waiting, faceless));
    this.note.hidden = !faceless || !face;
  }
}

/** what the DJ's copying, in words */
function copyingLine(f: MocapFrame | null, someone: boolean, waiting: boolean, faceless: boolean): string {
  if (!someone && !f) return 'Step into the picture';
  if (waiting) return 'Hold still a moment…';
  if (!f) return 'Your DJ’s own moves';
  const on = (k: keyof MocapFrame['w']) => f.w[k] > 0.5;
  const parts = [
    on('armL') && on('armR') ? 'arms' : on('armL') || on('armR') ? 'an arm' : '',
    on('handL') || on('handR') ? 'fingers' : '',
    on('torso') ? 'chest' : '',
    on('legs') ? 'legs' : '',
    on('head') ? 'head' : '',
    on('face') && !faceless ? 'face' : '',
  ].filter(Boolean);
  return parts.length ? `Copying your ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}` : 'Your DJ’s own moves';
}
