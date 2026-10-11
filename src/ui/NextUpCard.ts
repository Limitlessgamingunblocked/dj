/*
 * "Up next" on the stage: the coach's pick for the next track in free play
 * and Auto DJ (a gig's HUD shows its own). Load puts it on the free deck,
 * ↻ asks for another, × puts the card away until the pick changes. With
 * nothing loaded yet it suggests an opener.
 */
import { prefs } from '../core/prefs';
import type { NextUp } from '../app/nextup';
import { h, setText } from './dom';

export class NextUpCard {
  readonly el: HTMLElement;
  private label: HTMLElement;
  private title: HTMLElement;
  private artist: HTMLElement;
  private why: HTMLElement;
  private loadBtn: HTMLButtonElement;
  private dismissed: string | null = null;
  private on = false;

  constructor(
    private nu: NextUp,
    private o: { inGig(): boolean },
  ) {
    this.label = h('span', { class: 'nu-label' });
    this.title = h('b', { class: 'nu-title' });
    this.artist = h('span', { class: 'nu-artist' });
    this.why = h('span', { class: 'nu-why mono' });
    this.loadBtn = h('button', { class: 'btn primary small', type: 'button' }) as HTMLButtonElement;
    this.loadBtn.addEventListener('click', () => this.nu.load());
    const another = h('button', { class: 'btn small icon', type: 'button', title: 'Suggest another', 'aria-label': 'Suggest another track' }, '↻');
    another.addEventListener('click', () => this.nu.another());
    const close = h('button', { class: 'btn small icon nu-close', type: 'button', title: 'Hide until the next pick', 'aria-label': 'Hide the suggestion' }, '×');
    close.addEventListener('click', () => {
      this.dismissed = this.nu.top()?.id ?? null;
      this.update();
    });
    this.el = h(
      'div',
      { class: 'next-up', role: 'region', 'aria-label': 'Suggested next track', hidden: true },
      h('div', { class: 'nu-head' }, this.label, close),
      this.title,
      this.artist,
      this.why,
      h('div', { class: 'nu-acts' }, this.loadBtn, another),
    );
  }

  update(): void {
    const pick = this.nu.top();
    const deck = this.nu.freeDeck();
    const show = prefs.nextUp && !this.o.inGig() && !!pick && deck !== null && pick.id !== this.dismissed;
    if (show !== this.on) {
      this.on = show;
      this.el.hidden = !show;
    }
    if (!show || !pick) return;
    setText(this.label, this.nu.opening() ? 'Start with' : 'Up next');
    setText(this.title, pick.title);
    setText(this.artist, pick.artist);
    setText(this.why, pick.why);
    setText(this.loadBtn, `Load on ${deck}`);
    this.loadBtn.title = `Load “${pick.title}” on deck ${deck}`;
  }
}
