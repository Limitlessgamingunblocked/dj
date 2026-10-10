/*
 * The in-gig HUD (Section 10.3): one glass card so the club stays the focus.
 * The set timer, the vibe meter (with the slot's target marked on it), the
 * crowd's mood and your score with its streak; the crowd's request with the
 * time left to answer it; in Chill and Club, the coach's pick for the next
 * track; Save mix, Clip and End set. The assist level and a clean view for
 * recording sit in a small menu. What the crew in the booth says shows under
 * the card; transition pop-ups use the stage's call-outs.
 */
import type { Assist } from '../game/Gig';
import { ASSISTS } from '../game/Gig';
import { MOOD_LABEL, moodFor } from '../game/vibe';
import { h, setClass, setText, setVar } from './dom';
import { contextMenu, type MenuItem } from './modal';

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
  /** points so far (with the assist multiplier) */
  score: number;
  /** clean moments in a row, and what the next one is worth */
  streak: { count: number; next: number };
  /** the crowd's request: what they want and how much of the time is left, 0..1 */
  request: { text: string; left: number } | null;
  /** the coach's pick for the next track (Chill and Club) */
  coach: { title: string; artist: string; why: string } | null;
}

export interface HudHooks {
  setAssist(a: Assist): void;
  end(): void;
  clean(on: boolean): void;
  /** SAVE THAT MIX and CLIP IT (the replay buffer) */
  saveMix(): void;
  clip(): void;
  /** load the coach's pick on the free deck */
  loadCoach(): void;
}

const ASSIST_HINT: Record<Assist, string> = { chill: 'auto-sync', club: 'sync + hints', pro: 'score ×1.5' };

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
  private assist: Assist = 'club';
  private showBtn: HTMLButtonElement;
  private msgTimer = 0;
  private duo: HTMLElement;
  private scoreEl: HTMLElement;
  private shown = 0;
  private streakEl: HTMLElement;
  private reqEl: HTMLElement;
  private reqText: HTMLElement;
  private reqBar: HTMLElement;
  private coachEl: HTMLElement;
  private coachText: HTMLElement;
  private coachWhy: HTMLElement;

  constructor(private hooks: HudHooks) {
    this.bar = h('div', { class: 'gh-fill' });
    const meter = h('div', { class: 'gh-meter', role: 'meter', 'aria-label': 'Vibe', 'aria-valuemin': 0, 'aria-valuemax': 100 }, this.bar, h('i', { class: 'gh-target', title: 'What the crowd wants right now' }));
    this.mood = h('span', { class: 'gh-mood' });
    this.timer = h('span', { class: 'gh-time', 'aria-label': 'Time left in the set' });
    this.rec = h('span', { class: 'gh-rec', title: 'Recording' }, 'REC');
    this.buf = h('span', { class: 'gh-buf', title: 'Replay buffer on: the last few minutes are kept' });
    const saveMix = h('button', { type: 'button', class: 'gh-btn', title: 'Keep the last few minutes (⇧S)' }, 'Save mix');
    saveMix.addEventListener('click', () => this.hooks.saveMix());
    const clip = h('button', { type: 'button', class: 'gh-btn', title: 'A vertical clip of the last 30 seconds (⇧C)' }, 'Clip');
    clip.addEventListener('click', () => this.hooks.clip());
    this.bufBtns = h('span', { class: 'gh-bufbtns' }, saveMix, clip);
    this.where = h('span', { class: 'gh-where' });
    // the assist level and the clean view live in a small menu: rarely touched mid-set
    const more = h('button', { type: 'button', class: 'gh-btn gh-more', title: 'Assist and view', 'aria-label': 'Assist and view', 'aria-haspopup': 'menu' }, '⋯');
    more.addEventListener('click', () => {
      const r = more.getBoundingClientRect();
      contextMenu(r.left, r.bottom + 4, [
        { header: 'Assist' },
        ...ASSISTS.map((a): MenuItem => ({ label: a.label, hint: ASSIST_HINT[a.id], checked: a.id === this.assist, action: () => this.hooks.setAssist(a.id) })),
        'sep',
        { label: 'Hide the HUD', checked: false, action: () => this.setClean(true) },
      ]);
    });
    const end = h('button', { type: 'button', class: 'gh-btn gh-end', title: 'Finish the set now' }, 'End set');
    end.addEventListener('click', () => this.hooks.end());
    this.showBtn = h('button', { type: 'button', class: 'gh-show', title: 'Show the HUD' }, 'HUD') as HTMLButtonElement;
    this.showBtn.addEventListener('click', () => this.setClean(false));
    this.msg = h('div', { class: 'gh-msg', role: 'status', 'aria-live': 'polite' });
    this.duo = h('div', { class: 'gh-b2b', hidden: true });
    this.scoreEl = h('span', { class: 'gh-score', 'aria-label': 'Score' }, '0');
    this.streakEl = h('span', { class: 'gh-streak', title: 'Clean moments in a row multiply their points', hidden: true });
    this.reqText = h('span', { class: 'gh-req-text' });
    this.reqBar = h('i');
    this.reqEl = h('div', { class: 'gh-req', role: 'status', hidden: true }, h('span', { class: 'gh-req-k' }, 'Crowd'), this.reqText, h('span', { class: 'gh-req-bar', 'aria-hidden': 'true' }, this.reqBar));
    this.coachText = h('b');
    this.coachWhy = h('span');
    const load = h('button', { type: 'button', class: 'gh-btn gh-load', title: 'Load it on the free deck' }, 'Load');
    load.addEventListener('click', () => this.hooks.loadCoach());
    this.coachEl = h('div', { class: 'gh-coach', hidden: true }, h('span', { class: 'gh-coach-k' }, 'Next'), h('span', { class: 'gh-coach-t' }, this.coachText, this.coachWhy), load);
    this.el = h(
      'div',
      { class: 'gig-hud' },
      h(
        'div',
        { class: 'gh-main' },
        h('div', { class: 'gh-row gh-top' }, this.where, this.rec, this.buf, this.timer),
        meter,
        h('div', { class: 'gh-row gh-mid' }, this.mood, h('span', { class: 'spacer' }), this.streakEl, this.scoreEl),
        this.duo,
        this.reqEl,
        this.coachEl,
        h('div', { class: 'gh-row gh-tools' }, this.bufBtns, h('span', { class: 'spacer' }), more, end),
      ),
      this.msg,
      this.showBtn,
    );
  }

  /** a clean moment that extended the streak: the badge pops */
  streak(count: number, mult: number, bonus: number): void {
    this.streakEl.classList.remove('pop');
    void this.streakEl.offsetWidth;
    this.streakEl.classList.add('pop');
    this.streakEl.title = `${count} in a row: ×${mult.toFixed(2).replace(/0$/, '')} (+${bonus})`;
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

  /** a B2B: who you're playing with, whose turn it is, the chemistry meter (Section 6.10) */
  b2b(o: { name: string; color: string; chemistry: number; turn: 'you' | 'rival' } | null): void {
    this.duo.hidden = !o;
    if (!o) return;
    this.duo.style.setProperty('--rc', o.color);
    this.duo.replaceChildren(
      h('span', { class: 'gh-b2b-who' }, `B2B · ${o.name}`),
      h('span', { class: 'gh-chem', role: 'meter', 'aria-label': 'Chemistry', 'aria-valuenow': String(Math.round(o.chemistry * 100)), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${(o.chemistry * 100).toFixed(0)}%` })),
      h('span', { class: 'gh-turn' }, o.turn === 'you' ? 'Your turn' : `${o.name}’s turn`),
    );
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
    this.assist = s.assist;
    // the score counts up to its value
    this.shown += (s.score - this.shown) * 0.18;
    if (Math.abs(s.score - this.shown) < 1) this.shown = s.score;
    setText(this.scoreEl, Math.round(this.shown).toLocaleString());
    const on = s.streak.count >= 2;
    if (this.streakEl.hidden === on) this.streakEl.hidden = !on;
    if (on) setText(this.streakEl, `×${(Math.min(2, 1 + 0.25 * (s.streak.count - 1))).toFixed(2).replace(/\.?0+$/, '')}`);
    const r = s.request;
    if (this.reqEl.hidden !== !r) this.reqEl.hidden = !r;
    if (r) {
      setText(this.reqText, r.text);
      setVar(this.reqBar, '--left', r.left.toFixed(3));
      setClass(this.reqEl, 'late', r.left < 0.25);
    }
    const c = s.coach;
    if (this.coachEl.hidden !== !c) this.coachEl.hidden = !c;
    if (c) {
      setText(this.coachText, c.artist ? `${c.artist} – ${c.title}` : c.title);
      setText(this.coachWhy, c.why);
    }
  }
}
