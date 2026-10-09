/*
 * The in-gig HUD (Section 10.3): minimal so the club stays the focus.
 * Always there: the vibe meter (with the slot's target marked on it), the set
 * timer and the REC dot. Around it: the crowd's mood, the assist level
 * (switchable mid-set), what the crew in the booth says (sound engineer,
 * security, the bar), a clean view that hides everything for recording, and
 * End set. Transition pop-ups use the stage's call-outs.
 */
import type { Assist } from '../game/Gig';
import { ASSISTS } from '../game/Gig';
import { MOOD_LABEL, moodFor } from '../game/vibe';
import { h, setClass, setText, setVar } from './dom';

export interface HudState {
  vibe: number;
  target: number;
  /** seconds left (negative in the encore) */
  remaining: number;
  phase: 'waiting' | 'live' | 'encore' | 'over';
  recording: boolean;
  assist: Assist;
  slot: string;
  venue: string;
  /** master redline, 0..1: the meter flashes red when you're clipping */
  redline: number;
  /** the replay buffer is running (Section 12.2: a subtle dot) */
  buffer: boolean;
}

export interface HudHooks {
  setAssist(a: Assist): void;
  end(): void;
  clean(on: boolean): void;
  /** SAVE THAT MIX and CLIP IT (the replay buffer) */
  saveMix(): void;
  clip(): void;
}

const mmss = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export class GigHud {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private mood: HTMLElement;
  private timer: HTMLElement;
  private rec: HTMLElement;
  private buf: HTMLElement;
  private bufBtns: HTMLElement;
  private where: HTMLElement;
  private msg: HTMLElement;
  private assistBtns = new Map<Assist, HTMLButtonElement>();
  private cleanBtn: HTMLButtonElement;
  private showBtn: HTMLButtonElement;
  private msgTimer = 0;

  constructor(private hooks: HudHooks) {
    this.bar = h('div', { class: 'gh-fill' });
    const meter = h('div', { class: 'gh-meter', role: 'meter', 'aria-label': 'Vibe', 'aria-valuemin': 0, 'aria-valuemax': 100 }, this.bar, h('i', { class: 'gh-target', title: 'What the crowd wants right now' }));
    this.mood = h('span', { class: 'gh-mood' });
    this.timer = h('span', { class: 'gh-time', 'aria-label': 'Time left in the set' });
    this.rec = h('span', { class: 'gh-rec', title: 'Recording' }, 'REC');
    this.buf = h('span', { class: 'gh-buf', title: 'Replay buffer on: the last few minutes are kept' });
    const saveMix = h('button', { type: 'button', class: 'gh-btn', title: 'SAVE THAT MIX (Shift+S): keep the replay buffer' }, '⟲ Save mix');
    saveMix.addEventListener('click', () => this.hooks.saveMix());
    const clip = h('button', { type: 'button', class: 'gh-btn', title: 'CLIP IT (Shift+C): the last 30 seconds, vertical' }, '✂ Clip');
    clip.addEventListener('click', () => this.hooks.clip());
    this.bufBtns = h('span', { class: 'gh-bufbtns' }, saveMix, clip);
    this.where = h('span', { class: 'gh-where' });
    const assists = h('div', { class: 'gh-assist', role: 'radiogroup', 'aria-label': 'Assist level' });
    for (const a of ASSISTS) {
      const b = h('button', { type: 'button', role: 'radio', title: a.blurb }, a.label) as HTMLButtonElement;
      b.addEventListener('click', () => this.hooks.setAssist(a.id));
      this.assistBtns.set(a.id, b);
      assists.append(b);
    }
    this.cleanBtn = h('button', { type: 'button', class: 'gh-btn', title: 'Hide the HUD (for recording)' }, 'Clean view') as HTMLButtonElement;
    this.cleanBtn.addEventListener('click', () => this.setClean(true));
    const end = h('button', { type: 'button', class: 'gh-btn', title: 'Finish the set now' }, 'End set');
    end.addEventListener('click', () => this.hooks.end());
    this.showBtn = h('button', { type: 'button', class: 'gh-show', title: 'Show the HUD' }, 'HUD') as HTMLButtonElement;
    this.showBtn.addEventListener('click', () => this.setClean(false));
    this.msg = h('div', { class: 'gh-msg', role: 'status', 'aria-live': 'polite' });
    this.el = h(
      'div',
      { class: 'gig-hud' },
      h('div', { class: 'gh-main' }, h('div', { class: 'gh-row' }, this.where, this.mood, this.timer, this.rec, this.buf), meter, h('div', { class: 'gh-row gh-tools' }, assists, this.bufBtns, this.cleanBtn, end)),
      this.msg,
      this.showBtn,
    );
  }

  setClean(on: boolean): void {
    setClass(this.el, 'clean', on);
    this.hooks.clean(on);
  }

  /** a line from someone in the booth */
  say(who: string, text: string): void {
    this.msg.replaceChildren(h('b', {}, who), ' ', text);
    setClass(this.msg, 'on', true);
    clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => setClass(this.msg, 'on', false), 4500);
  }

  update(s: HudState): void {
    setVar(this.bar, '--v', s.vibe.toFixed(3));
    setVar(this.el, '--t', s.target.toFixed(3));
    this.bar.parentElement!.setAttribute('aria-valuenow', String(Math.round(s.vibe * 100)));
    const m = moodFor(s.vibe);
    setText(this.mood, MOOD_LABEL[m]);
    this.mood.dataset.mood = m;
    setText(this.timer, s.phase === 'waiting' ? 'Press play' : s.phase === 'encore' ? 'Encore' : mmss(s.remaining));
    setClass(this.timer, 'low', s.phase === 'live' && s.remaining < 60);
    setClass(this.rec, 'on', s.recording);
    this.buf.hidden = !s.buffer;
    this.bufBtns.hidden = !s.buffer;
    setClass(this.el, 'red', s.redline > 0.5);
    setText(this.where, `${s.venue} · ${s.slot}`);
    for (const [id, b] of this.assistBtns) {
      setClass(b, 'active', id === s.assist);
      b.setAttribute('aria-checked', String(id === s.assist));
    }
  }
}
