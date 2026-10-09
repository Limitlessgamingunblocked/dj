/*
 * The crowd chanting the DJ's name (Section 3.4): when the room has been at
 * its peak for a few seconds, "NAME!" bubbles rise over the crowd on the
 * beat. Driven by the beat clock; quiet until the player has a name. (Stage 3
 * swaps the crowd meter for the vibe meter.)
 */
import type { BeatClock } from '../core/BeatClock';
import { nameService } from '../name/NameService';
import { h } from './dom';

const PEAK = 0.9;
const HOLD = 3;

export class NameChant {
  readonly el = h('div', { class: 'name-chant', 'aria-hidden': 'true' });
  private atPeak = 0;
  private flip = false;

  constructor(clock: BeatClock) {
    clock.onBeat((e) => {
      if (this.atPeak < HOLD || !nameService.named) return;
      // on the two and the four, alternating sides
      if (e.beatInBar % 2 === 0) return;
      this.flip = !this.flip;
      this.bubble();
    });
  }

  /** every frame, with the crowd meter (0..1) */
  update(dt: number, hype: number, playing: boolean): void {
    this.atPeak = playing && hype >= PEAK ? this.atPeak + dt : 0;
  }

  private bubble(): void {
    if (this.el.childElementCount > 6 || document.hidden) return;
    const b = h('span', { class: 'chant-bubble' }, `${nameService.text}!`);
    const x = this.flip ? 12 + Math.random() * 30 : 58 + Math.random() * 30;
    b.style.left = `${x}%`;
    b.style.bottom = `${18 + Math.random() * 22}%`;
    b.style.setProperty('--tilt', `${(Math.random() - 0.5) * 14}deg`);
    this.el.append(b);
    b.addEventListener('animationend', () => b.remove());
  }
}
