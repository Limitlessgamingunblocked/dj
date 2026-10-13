/*
 * Karaoke over the stage: the line being sung, big, with each word filling
 * in colour as it's sung (a sweep through the word over the time it's held),
 * the next line waiting underneath, and a count-in of beat dots after a long
 * gap so you know when to come in.
 *
 * One lane per deck the room can hear: with two singing decks in a blend,
 * both show, the louder one big and the other smaller and fading with its
 * fader and the crossfader. Each lane wears its deck's colour.
 *
 * Runs every frame (the sweep has to be smooth); it only touches the DOM when
 * a value really changes.
 */
import type { LyricFrame } from '../lyrics/LyricsEngine';
import type { LyricLine } from '../lyrics/lyrics';
import { DECK_COLORS, type DeckId } from '../core/types';
import { h } from './dom';

/** how far a word's fill has got at `pos` (0 before, 1 once sung) */
export function wordFill(w: { t: number; end: number }, pos: number): number {
  const len = Math.max(0.12, w.end - w.t);
  return Math.min(1, Math.max(0, (pos - w.t) / len));
}

/**
 * What a lane shows at `pos`: the line being sung, or, in a gap, the next one
 * once it's close (`lead` seconds); `count` is the beats left before it starts
 * when it follows a long gap (0 when no count-in shows).
 */
export function laneView(fr: Pick<LyricFrame, 'lines' | 'index' | 'line' | 'next' | 'pos' | 'beatLen'>): { show: LyricLine | null; upcoming: LyricLine | null; count: number } {
  if (fr.line) return { show: fr.line, upcoming: fr.next, count: 0 };
  const next = fr.next;
  if (!next) return { show: null, upcoming: null, count: 0 };
  const beat = fr.beatLen > 0.2 && fr.beatLen < 1.5 ? fr.beatLen : 0.5;
  const lead = Math.max(2.5, beat * 4);
  const until = next.t - fr.pos;
  if (until > lead) return { show: null, upcoming: next, count: 0 };
  const prev = fr.index >= 0 ? fr.lines[fr.index] : null;
  const gap = next.t - (prev ? prev.end : 0);
  const count = gap >= 3.5 && until > 0 ? Math.min(4, Math.ceil(until / beat)) : 0;
  const after = fr.lines[fr.lines.indexOf(next) + 1] ?? null;
  return { show: next, upcoming: after, count };
}

/** reduced motion asked for: lines swap in place, no floating or growing */
const calm = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Shown {
  line: LyricLine;
  el: HTMLElement;
  words: HTMLElement[];
  fills: number[];
}

class Lane {
  readonly el: HTMLElement;
  private tagNum: HTMLElement;
  private tagTitle: HTMLElement;
  private tagAi: HTMLElement;
  private box: HTMLElement;
  private dots: HTMLElement[];
  private cur: Shown | null = null;
  private next: Shown | null = null;
  private count = -1;
  private lastTitle = '';
  private lastAi = '';
  gone = false;

  constructor(readonly deck: number) {
    this.tagNum = h('b', {}, String(deck));
    this.tagTitle = h('span');
    this.tagAi = h('em', { hidden: true });
    this.box = h('div', { class: 'kara-lines' });
    this.dots = [0, 1, 2, 3].map(() => h('i'));
    this.el = h(
      'div',
      { class: 'kara-lane' },
      h('div', { class: 'kara-tag' }, this.tagNum, this.tagTitle, this.tagAi),
      h('div', { class: 'kara-count', 'aria-hidden': 'true' }, ...this.dots),
      this.box,
    );
    this.el.style.setProperty('--deck', DECK_COLORS[deck as DeckId] ?? '#fff');
  }

  private build(line: LyricLine, cls: string): Shown {
    const words = (line.words.length ? line.words : [{ t: line.t, end: line.end, text: line.text }]).map((w) => h('span', { class: 'kw' }, w.text));
    const el = h('div', { class: `kl ${cls}${line.hook ? ' hook' : ''}` }, ...words);
    return { line, el, words, fills: words.map(() => -1) };
  }

  /** the old line floats up and fades */
  private retire(s: Shown | null): void {
    if (!s) return;
    const el = s.el;
    if (calm() || !el.isConnected) {
      el.remove();
      return;
    }
    el.style.top = `${el.offsetTop}px`;
    el.style.left = `${el.offsetLeft}px`;
    el.style.width = `${el.offsetWidth}px`;
    el.classList.add('out');
    el.animate?.([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-55%) scale(0.92)', opacity: 0 }], { duration: 360, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    // gone either way (an animation in a hidden tab may never finish)
    setTimeout(() => el.remove(), 380);
  }

  /** the next line moves up into place and grows (FLIP: measure, change, animate the difference) */
  private promote(s: Shown): void {
    const flip = !calm();
    const before = flip ? s.el.getBoundingClientRect() : null;
    s.el.classList.remove('next');
    s.el.classList.add('cur');
    if (!before) return;
    const after = s.el.getBoundingClientRect();
    if (before.width && after.width) {
      const dx = before.left + before.width / 2 - (after.left + after.width / 2);
      const dy = before.top - after.top;
      const k = before.width / after.width;
      s.el.animate?.([{ transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  private enter(s: Shown): void {
    this.box.append(s.el);
    if (!calm()) s.el.animate?.([{ transform: 'translateY(10px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'ease-out' });
  }

  update(fr: LyricFrame, main: boolean): void {
    this.el.classList.toggle('lead', main);
    this.el.style.opacity = main ? '1' : (0.35 + 0.5 * Math.min(1, fr.weight)).toFixed(2);
    if (fr.title !== this.lastTitle) {
      this.lastTitle = fr.title;
      this.tagTitle.textContent = fr.title;
    }
    const ai = fr.listening ? 'AI · listening…' : fr.source === 'ai' ? 'AI lyrics' : '';
    if (ai !== this.lastAi) {
      this.lastAi = ai;
      this.tagAi.textContent = ai;
      this.tagAi.hidden = !ai;
      this.tagAi.classList.toggle('live', fr.listening);
    }

    const v = laneView(fr);
    // the line being shown changed
    if (v.show !== (this.cur?.line ?? null)) {
      const old = this.cur;
      if (v.show && this.next && this.next.line === v.show) {
        this.cur = this.next;
        this.next = null;
        this.promote(this.cur);
      } else {
        this.cur = v.show ? this.build(v.show, 'cur') : null;
        if (this.cur) this.enter(this.cur);
      }
      this.retire(old);
    }
    if (v.upcoming !== (this.next?.line ?? null)) {
      this.retire(this.next);
      this.next = v.upcoming ? this.build(v.upcoming, 'next') : null;
      if (this.next) this.enter(this.next);
    }
    // the sung line always sits above the next one, however the lines changed
    if (this.cur && this.next && this.cur.el.nextElementSibling !== this.next.el) this.box.insertBefore(this.cur.el, this.next.el);
    this.el.classList.toggle('waiting', !this.cur);

    // the sweep through each word
    if (this.cur) {
      const s = this.cur;
      const ws = s.line.words.length ? s.line.words : [{ t: s.line.t, end: s.line.end, text: s.line.text }];
      for (let i = 0; i < ws.length; i++) {
        const p = Math.round(wordFill(ws[i], fr.pos) * 200) / 200;
        if (p === s.fills[i]) continue;
        const el = s.words[i];
        if (!el) continue;
        el.style.setProperty('--p', String(p));
        el.classList.toggle('now', p > 0 && p < 1);
        el.classList.toggle('sung', p >= 1);
        s.fills[i] = p;
      }
    }

    if (v.count !== this.count) {
      this.count = v.count;
      this.el.classList.toggle('counting', v.count > 0);
      this.dots.forEach((d, i) => d.classList.toggle('on', i < v.count));
    }
  }

  leave(): void {
    if (this.gone) return;
    this.gone = true;
    this.el.classList.add('leaving');
    setTimeout(() => this.el.remove(), 420);
  }
}

export class Karaoke {
  readonly el: HTMLElement;
  private lanes = new Map<number, Lane>();
  private on = false;

  constructor() {
    this.el = h('div', { class: 'karaoke lyric-hud', 'aria-hidden': 'true' });
  }

  /** `frames` loudest first; `visible` false hides it all (setting off, visuals-only view) */
  update(frames: LyricFrame[], visible: boolean): void {
    const show = visible ? frames.slice(0, 2) : [];
    const on = show.length > 0;
    if (on !== this.on) {
      this.on = on;
      this.el.classList.toggle('on', on);
    }
    const keep = new Set(show.map((f) => f.deck));
    for (const [id, lane] of this.lanes) {
      if (keep.has(id)) continue;
      lane.leave();
      this.lanes.delete(id);
    }
    // stable order: the lower deck number on top, so lanes don't swap places as the faders move
    const ordered = [...show].sort((a, b) => a.deck - b.deck);
    for (const fr of ordered) {
      let lane = this.lanes.get(fr.deck);
      if (!lane) {
        lane = new Lane(fr.deck);
        this.lanes.set(fr.deck, lane);
        // in deck order among the lanes still shown
        const after = [...this.lanes.values()].filter((l) => l !== lane && !l.gone && l.deck > fr.deck).sort((a, b) => a.deck - b.deck)[0];
        if (after) this.el.insertBefore(lane.el, after.el);
        else this.el.append(lane.el);
      }
      lane.update(fr, fr === show[0]);
    }
    this.el.classList.toggle('two', show.length > 1);
  }
}
