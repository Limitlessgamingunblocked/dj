/*
 * The debug menu (Section 16.6): Ctrl+Shift+D, or open the page with ?debug.
 * Jump to any venue, set the fame tier and the currencies, unlock everything,
 * change the crowd size, fire a drop or any show effect, and watch the beat
 * clock, its events and the master redline live. Everything it changes goes
 * through the same systems the game uses (Career saves, prefs, the show).
 */
import type { BeatClock } from '../core/BeatClock';
import { MAX_TIER } from '../core/models';
import type { Career } from '../game/Career';
import { h, setText } from './dom';

export interface DebugHost {
  clock: BeatClock;
  career: Career;
  venues: { id: string; name: string }[];
  venue(): string;
  setVenue(id: string): void;
  crowd(): number;
  setCrowd(k: number): void;
  /** fire a drop through the whole game (clock, show, crowd), or one show effect */
  fire(what: 'drop' | 'confetti' | 'co2' | 'pyro' | 'strobe'): void;
  redline(): number;
}

export class DebugMenu {
  readonly el: HTMLElement;
  private clockText: HTMLElement;
  private phase: HTMLElement;
  private redBar: HTMLElement;
  private log: HTMLElement;
  private events: string[] = [];
  private fields: { sync(): void }[] = [];
  private t = 0;

  constructor(private host: DebugHost) {
    const c = host.clock;
    const note = (s: string) => {
      this.events.unshift(s);
      this.events.length = Math.min(this.events.length, 8);
      setText(this.log, this.events.join('\n'));
    };
    c.onPhrase((e) => note(`phrase ${e.length} · bar ${e.bar}`));
    c.onBreakdown((e) => note(`breakdown · bar ${e.bar}`));
    c.onBuildStart((e) => note(`build · bar ${e.bar}`));
    c.onDrop((e) => note(`DROP · bar ${e.bar}`));

    this.clockText = h('div', { class: 'mono' });
    this.phase = h('div', { class: 'dbg-phase' }, ...Array.from({ length: 4 }, () => h('i')));
    this.redBar = h('div', { class: 'dbg-meter' }, h('i'));
    this.log = h('pre', { class: 'dbg-log mono' }, '—');

    const venue = h('select', { 'aria-label': 'Venue' }) as HTMLSelectElement;
    for (const v of host.venues) venue.append(h('option', { value: v.id }, v.name));
    venue.addEventListener('change', () => host.setVenue(venue.value));
    this.fields.push({ sync: () => document.activeElement !== venue && (venue.value = host.venue()) });

    const tier = h('select', { 'aria-label': 'Fame tier' }) as HTMLSelectElement;
    for (let i = 1; i <= MAX_TIER; i++) tier.append(h('option', { value: i }, i === MAX_TIER ? `${i} (max)` : String(i)));
    tier.addEventListener('change', () => host.career.setProgress({ tier: Number(tier.value) }));
    this.fields.push({ sync: () => document.activeElement !== tier && (tier.value = String(host.career.progress.tier)) });

    const number = (key: 'fame' | 'cash' | 'followers') => {
      const inp = h('input', { type: 'number', min: 0, step: 1, 'aria-label': key }) as HTMLInputElement;
      inp.addEventListener('change', () => host.career.setProgress({ [key]: Number(inp.value) }));
      this.fields.push({ sync: () => document.activeElement !== inp && (inp.value = String(host.career.progress[key])) });
      return h('label', {}, key, inp);
    };

    const sandbox = h('input', { type: 'checkbox' }) as HTMLInputElement;
    sandbox.addEventListener('change', () => host.career.setProgress({ sandbox: sandbox.checked }));
    this.fields.push({ sync: () => (sandbox.checked = host.career.progress.sandbox) });

    const crowd = h('input', { type: 'range', min: 0, max: 1.5, step: 0.05, 'aria-label': 'Crowd size' }) as HTMLInputElement;
    const crowdOut = h('output', { class: 'mono' });
    crowd.addEventListener('input', () => setText(crowdOut, `${Math.round(Number(crowd.value) * 100)}%`));
    crowd.addEventListener('change', () => host.setCrowd(Number(crowd.value)));
    this.fields.push({
      sync: () => {
        if (document.activeElement === crowd) return;
        crowd.value = String(host.crowd());
        setText(crowdOut, `${Math.round(host.crowd() * 100)}%`);
      },
    });

    const fire = (what: Parameters<DebugHost['fire']>[0], label: string) => h('button', { class: 'btn', type: 'button', onclick: () => host.fire(what) }, label);
    const erase = h('button', { class: 'btn', type: 'button' }, 'Erase career');
    erase.addEventListener('click', () => {
      if (confirm('Erase the career (name, progress, looks, boards, recordings list)? Settings and the music library stay.')) host.career.erase();
    });
    const close = h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Close the debug menu', onclick: () => this.toggle(false) }, '×');

    this.el = h(
      'aside',
      { class: 'debug-menu', role: 'dialog', 'aria-label': 'Debug menu', hidden: true },
      h('header', {}, h('strong', {}, 'DEBUG'), h('span', { class: 'mono dim' }, 'Ctrl+Shift+D'), close),
      h('section', {}, h('h4', {}, 'Beat clock'), this.clockText, this.phase, this.log),
      h('section', {}, h('h4', {}, 'Venue'), venue),
      h('section', {}, h('h4', {}, 'Career'), h('label', {}, 'tier', tier), number('fame'), number('cash'), number('followers'), h('label', { class: 'row' }, sandbox, 'Unlock everything (sandbox)')),
      h('section', {}, h('h4', {}, 'Crowd'), h('div', { class: 'row' }, crowd, crowdOut)),
      h('section', {}, h('h4', {}, 'Fire'), h('div', { class: 'row wrap' }, fire('drop', 'Drop'), fire('confetti', 'Confetti'), fire('co2', 'CO2'), fire('pyro', 'Pyro'), fire('strobe', 'Strobe'))),
      h('section', {}, h('h4', {}, 'Master redline'), this.redBar),
      h('section', {}, h('h4', {}, 'Saves'), h('p', { class: 'dim' }, host.career.problems.join(' ') || 'Profile and progress loaded.'), erase),
    );
    host.career.changed.on('progress', () => this.sync());
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyD' && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          this.toggle();
        }
      },
      true,
    );
    if (/[?&]debug\b/.test(location.search)) this.toggle(true);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(on = !this.open): void {
    this.el.hidden = !on;
    if (on) this.sync();
  }

  private sync(): void {
    for (const f of this.fields) f.sync();
  }

  /** every frame; refreshes ten times a second while open */
  update(dt: number): void {
    if (!this.open) return;
    this.t += dt;
    if (this.t < 0.1) return;
    this.t = 0;
    const c = this.host.clock;
    setText(this.clockText, c.playing ? `${c.bpm.toFixed(1)} BPM · bar ${c.bar} · beat ${c.beatInBar + 1} · ${c.section} ${c.sectionTime.toFixed(0)}s` : `${c.bpm.toFixed(1)} BPM · stopped`);
    [...this.phase.children].forEach((el, i) => el.classList.toggle('on', c.playing && i <= c.beatInBar));
    const r = this.host.redline();
    (this.redBar.firstElementChild as HTMLElement).style.width = `${Math.round(r * 100)}%`;
    this.redBar.classList.toggle('hot', r > 0.3);
  }
}
