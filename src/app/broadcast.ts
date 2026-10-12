/*
 * Broadcast mode: the stage alone, full window, for streaming the game or
 * leaving it on a screen. Everything around the stage goes, the auto
 * director cuts the camera with the music, and each new track's name slides
 * in at the bottom (even with the now-playing card turned off). The pointer
 * hides when it's still. Esc, Shift+O or the Leave button (it shows when the
 * pointer moves or the screen is tapped) bring the interface back.
 *
 * The screensaver (Settings → Show & venue) turns it on by itself after a few
 * minutes without a touch while music plays; then any touch (mouse, keys,
 * a controller) brings the interface straight back.
 */
import type { ControlRegistry } from '../core/controls';
import { prefs } from '../core/prefs';

export interface BroadcastHost {
  /** the app's outer element (built after the stage, so asked for when needed) */
  shell(): HTMLElement;
  stageEl: HTMLElement;
  reg: ControlRegistry;
  director(): boolean;
  setDirector(on: boolean): void;
  /** put the current track's name up now */
  announce(): void;
  playing(): boolean;
}

/** how long the pointer has to be still before it hides (ms) */
const CURSOR_HIDE = 2200;

/** whether the screensaver should start: on, music playing, and idle for long enough */
export function idleDue(idleSeconds: number, minutes: number, playing: boolean): boolean {
  return minutes > 0 && playing && idleSeconds >= minutes * 60;
}

export class Broadcast {
  on = false;
  /** it came on by itself (the screensaver): any touch ends it */
  auto = false;
  private directorBefore = false;
  private idle = 0;
  private hint: HTMLElement | null = null;
  /** a way out for touch screens: shows with the pointer, hides with it */
  private exit: HTMLButtonElement | null = null;
  private cursorTimer = 0;

  constructor(private host: BroadcastHost) {
    const touched = (e: Event) => this.touched(e);
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, touched, { capture: true, passive: true });
    host.reg.on('activity', ({ source }) => source === 'midi' && this.touched(null));
  }

  /** count the idle time (call every frame) */
  update(dt: number): void {
    if (this.on) return;
    this.idle += dt;
    if (idleDue(this.idle, prefs.screensaver, this.host.playing())) this.set(true, true);
  }

  set(on: boolean, auto = false): void {
    if (on === this.on) return;
    const h = this.host;
    this.on = on;
    this.auto = on && auto;
    h.shell().classList.toggle('broadcast', on);
    if (on) {
      this.directorBefore = h.director();
      if (!this.directorBefore) h.setDirector(true);
      h.announce();
      if (!auto) {
        this.showHint();
        const exit = document.createElement('button');
        exit.type = 'button';
        exit.className = 'btn broadcast-exit';
        exit.textContent = 'Leave broadcast mode';
        exit.addEventListener('click', () => this.set(false));
        h.stageEl.append(exit);
        this.exit = exit;
      }
      this.cursorIdle();
    } else {
      if (!this.directorBefore && h.director()) h.setDirector(false);
      h.shell().classList.remove('broadcast-still');
      clearTimeout(this.cursorTimer);
      this.hint?.remove();
      this.hint = null;
      this.exit?.remove();
      this.exit = null;
      this.idle = 0;
    }
  }

  private touched(e: Event | null): void {
    this.idle = 0;
    if (!this.on) return;
    if (this.auto) {
      this.set(false);
      return;
    }
    if (e?.type === 'keydown' && (e as KeyboardEvent).key === 'Escape') {
      this.set(false);
      return;
    }
    if (e?.type === 'pointermove' || e?.type === 'pointerdown') this.cursorIdle();
  }

  /** show the pointer, then hide it once it's been still a moment */
  private cursorIdle(): void {
    this.host.shell().classList.remove('broadcast-still');
    clearTimeout(this.cursorTimer);
    this.cursorTimer = window.setTimeout(() => this.on && this.host.shell().classList.add('broadcast-still'), CURSOR_HIDE);
  }

  private showHint(): void {
    this.hint?.remove();
    const el = document.createElement('div');
    el.className = 'broadcast-hint';
    el.textContent = 'Broadcast mode · Esc or ⇧O to leave';
    this.host.stageEl.append(el);
    this.hint = el;
    window.setTimeout(() => {
      if (this.hint === el) this.hint = null;
      el.remove();
    }, 3200);
  }
}
