/*
 * The title screen: a slow glide through the venue at night, the tagline and
 * the prompt over it (no big 3D name in the middle of the screen). Any key,
 * click, tap or a button on a controller starts: the words fade and the
 * camera walks you into the venue.
 *
 * Shown at launch (automated test browsers skip it; ?title forces it). At the
 * end of the launch cutscene it comes in on the drop with a white flash.
 */
import type { ControlRegistry } from '../core/controls';
import type { Stage } from '../three/Stage';
import { h } from './dom';

/** seconds the words take to fade when you start */
const LEAVE = 0.7;

export interface TitleHost {
  stage: Stage;
  /** the app's shell (gets the full-screen class while the title is up) */
  shell: HTMLElement;
  reg: ControlRegistry;
  /** the venue's accent colour */
  accent(): string;
  /** the title's gone: carry on into the app */
  start(): void;
}

export class TitleScreen {
  private el: HTMLElement | null = null;
  private leaving = -1;
  private raf = 0;
  private last = 0;
  private off: (() => void)[] = [];

  constructor(private host: TitleHost) {}

  get open(): boolean {
    return !!this.el;
  }

  show(o: { flash?: boolean } = {}): void {
    if (this.el) return;
    const { stage, shell } = this.host;
    const flash = !!o.flash && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    shell.classList.add('titling');
    // the camera's last move is over: the glide takes it
    stage.rig.shot = null;
    this.el = h(
      'div',
      { class: `title-screen${flash ? ' flash' : ''}`, role: 'dialog', 'aria-label': 'Deckhouse DJ' },
      h('p', { class: 'title-tag' }, 'From the bedroom to the main stage'),
      h('p', { class: 'title-prompt' }, matchMedia('(pointer: coarse)').matches ? 'Tap to start' : 'Press any key to start'),
    );
    stage.el.append(this.el);
    stage.rig.setFlyby(true);
    // any key (swallowed, so it doesn't also play a deck), a click or tap, a controller button
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.dismiss();
    };
    const tap = (e: Event) => {
      e.preventDefault();
      this.dismiss();
    };
    window.addEventListener('keydown', key, { capture: true });
    this.el.addEventListener('pointerdown', tap);
    const unsub = this.host.reg.on('activity', ({ source }) => source === 'midi' && this.dismiss());
    this.off = [() => window.removeEventListener('keydown', key, { capture: true }), unsub];
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.animate(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private animate(dt: number): void {
    if (this.leaving < 0) return;
    this.leaving += dt;
    if (this.leaving >= LEAVE) this.finish();
  }

  /** start: the words fade, the camera walks in */
  dismiss(): void {
    if (!this.el || this.leaving >= 0) return;
    this.leaving = 0;
    for (const f of this.off) f();
    this.off = [];
    this.el.classList.add('leaving');
    this.host.shell.classList.remove('titling');
    this.host.stage.rig.setFlyby(false);
    this.host.start();
  }

  private finish(): void {
    cancelAnimationFrame(this.raf);
    this.el?.remove();
    this.el = null;
  }
}
