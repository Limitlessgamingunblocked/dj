/*
 * The MC's card: what the hype man looks at while they're on the mic. The
 * words being sung (so they don't talk over them, or so they can sing the
 * hook with the room), a nudge for what the set's doing, the beat, their
 * call pads and voice effects, and what the room did with the last one.
 *
 * The same card serves a mic on this computer (on the stage, with the booth's
 * mic settings underneath) and a friend online (on their screen); it only
 * sees McState and sends McAction (app/hypeman/link.ts).
 */
import { CALLS, type CallId } from '../game/hypeman';
import type { McAction, McState } from '../app/hypeman/link';
import { clear, h, setClass, setText } from './dom';

/** the booth's own mic settings, shown under the card when the mic is here */
export interface McBooth {
  duckDb: { get(): number; set(v: number): void };
  sensitivity: { get(): number; set(v: number): void };
  gain: { get(): number; set(v: number): void };
  /** where the voice comes from ("Your mic", "Sam, online") */
  source(): string;
  close(): void;
}

function slider(label: string, min: number, max: number, step: number, v: { get(): number; set(x: number): void }, fmt: (x: number) => string): HTMLElement {
  const out = h('output', {}, fmt(v.get()));
  const input = h('input', { type: 'range', min, max, step, value: v.get(), 'aria-label': label }) as HTMLInputElement;
  input.addEventListener('input', () => {
    v.set(Number(input.value));
    setText(out, fmt(Number(input.value)));
  });
  return h('label', { class: 'mc-slider' }, h('span', {}, label), input, out);
}

export class McCard {
  readonly el: HTMLElement;
  private acts: ((a: McAction) => void)[] = [];
  private who: HTMLElement;
  private meter: HTMLElement;
  private air: HTMLElement;
  private line: HTMLElement;
  private next: HTMLElement;
  private hint: HTMLElement;
  private dots: HTMLElement[];
  private pads = new Map<CallId, HTMLButtonElement>();
  private echo: HTMLButtonElement;
  private radio: HTMLButtonElement;
  private last: HTMLElement;
  private score: HTMLElement;
  private status: HTMLElement;
  private inviteBox: HTMLElement;
  private state: McState | null = null;

  constructor(booth?: McBooth) {
    this.who = h('span', { class: 'mc-who' });
    this.meter = h('i');
    this.air = h('b', { class: 'mc-air' }, 'ON AIR');
    this.line = h('div', { class: 'mc-line' });
    this.next = h('div', { class: 'mc-next' });
    this.hint = h('div', { class: 'mc-hint' });
    this.dots = [0, 1, 2, 3].map(() => h('i'));
    this.status = h('div', { class: 'mc-status', hidden: true });
    this.inviteBox = h('div', { class: 'mc-invite', hidden: true });
    const padRow = h('div', { class: 'mc-pads' });
    for (const c of CALLS) {
      const b = h('button', { type: 'button', class: 'mc-pad', title: `Arm it, then shout “${c.say}” on the beat` }, c.label) as HTMLButtonElement;
      b.addEventListener('click', () => this.emit({ t: 'call', call: c.id }));
      this.pads.set(c.id, b);
      padRow.append(b);
    }
    this.echo = h('button', { type: 'button', class: 'btn mc-fx', 'aria-pressed': 'false', title: 'An echo on your voice, in time with the music' }, 'Echo') as HTMLButtonElement;
    this.radio = h('button', { type: 'button', class: 'btn mc-fx', 'aria-pressed': 'false', title: 'A megaphone sound on your voice' }, 'Radio') as HTMLButtonElement;
    this.echo.addEventListener('click', () => this.emit({ t: 'fx', fx: { echo: !this.state?.fx.echo } }));
    this.radio.addEventListener('click', () => this.emit({ t: 'fx', fx: { radio: !this.state?.fx.radio } }));
    this.last = h('div', { class: 'mc-last' });
    this.score = h('span', { class: 'mc-score' });
    const close = booth ? h('button', { type: 'button', class: 'btn', title: 'Mic off', onclick: () => booth.close() }, '✕') : null;
    this.el = h(
      'div',
      { class: 'mc-card', role: 'region', 'aria-label': 'Hype man on the mic' },
      h('div', { class: 'mc-head' }, h('span', { class: 'mc-label' }, 'Hype man'), this.who, this.score, close),
      h('div', { class: 'mc-level' }, h('span', { class: 'mc-meter' }, this.meter), this.air, h('span', { class: 'mc-dots', 'aria-hidden': 'true' }, ...this.dots)),
      this.status,
      this.inviteBox,
      h('div', { class: 'mc-words' }, this.line, this.next),
      this.hint,
      padRow,
      h('div', { class: 'mc-fxrow' }, this.echo, this.radio),
      this.last,
      booth
        ? h(
            'details',
            { class: 'mc-booth' },
            h('summary', {}, 'Mic settings'),
            slider('Duck the music', 0, 18, 1, booth.duckDb, (x) => (x ? `−${x} dB` : 'off')),
            slider('Mic sensitivity', -10, 10, 1, booth.sensitivity, (x) => (x > 0 ? `+${x}` : String(x))),
            slider('Mic level', 0, 1.5, 0.05, booth.gain, (x) => `${Math.round(x * 100)}%`),
            h('p', { class: 'mc-tip' }, 'Headphones stop the speakers feeding back into the mic.'),
          )
        : null,
    );
    if (booth) setText(this.who, booth.source());
  }

  private emit(a: McAction): void {
    for (const fn of this.acts) fn(a);
  }

  onAct(fn: (a: McAction) => void): void {
    this.acts.push(fn);
  }

  /** a problem to show instead of the words (mic blocked, not connected) */
  error(text: string | null): void {
    this.status.hidden = !text;
    setText(this.status, text ?? '');
  }

  /** the room code and link to send your MC (null once they're in) */
  invite(code: string | null, link: string | null): void {
    clear(this.inviteBox);
    this.inviteBox.hidden = !code;
    if (!code || !link) return;
    const copy = h('button', { type: 'button', class: 'btn' }, 'Copy link') as HTMLButtonElement;
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(link).then(() => setText(copy, 'Copied'), () => setText(copy, link));
    });
    this.inviteBox.append(
      h('span', {}, 'Send your MC this code:'),
      h('b', { class: 'mc-code' }, code),
      copy,
      h('span', { class: 'mc-tip' }, 'They open Deckhouse, then ⋯ → Join a friend as their MC, or open the link.'),
    );
  }

  setWho(text: string): void {
    setText(this.who, text);
  }

  show(s: McState): void {
    this.state = s;
    this.meter.style.width = `${Math.round(s.level * 100)}%`;
    setClass(this.air, 'on', s.talking);
    setText(this.line, s.line ?? (s.next ? '' : '♪'));
    setText(this.next, s.next ?? '');
    setText(this.hint, s.hint);
    this.dots.forEach((d, i) => setClass(d, 'on', s.bpm > 0 && i === s.beatInBar));
    for (const [id, b] of this.pads) {
      const armed = s.armed === id;
      setClass(b, 'armed', armed);
      b.style.setProperty('--left', armed ? String(s.armedLeft / 8) : '0');
      const c = CALLS.find((x) => x.id === id)!;
      setText(b, armed ? `${id === 'name' ? `Say ${s.djName}!` : c.say} 🎤` : c.label);
    }
    this.echo.setAttribute('aria-pressed', String(s.fx.echo));
    this.radio.setAttribute('aria-pressed', String(s.fx.radio));
    setText(this.last, s.last);
    setText(this.score, s.calls ? `${s.points} pts · ${s.calls} call${s.calls === 1 ? '' : 's'}` : s.points ? `${s.points} pts` : '');
  }
}
