/*
 * The naming scene (Section 3.1): the player's first real moment. A dark
 * room, one spotlight on a blank LED sign; as they type, each letter strikes
 * up on the sign with a buzz and a hum. Below, the name in four styles (chrome,
 * neon, pixel LED, hand-painted) so they see it come alive. On "Light it up"
 * the sign flickers fully on, the bass hits, and the camera pulls back over a
 * small crowd that goes up for them.
 *
 * Opens by itself on first launch (until named, unless they chose "Later"),
 * and from Settings → Profile to rename.
 */
import { bass, buzz, cheer } from '../audio/sfx';
import { cleanName, cleanTagline, NAME_MAX, TAGLINE_MAX } from '../core/models';
import type { Career } from '../game/Career';
import { isBlocked } from '../name/filter';
import { nameService } from '../name/NameService';
import { PREVIEW_STYLES, STYLES } from '../name/styles';
import type { ViewId } from '../three/CameraRig';
import type { Stage } from '../three/Stage';
import { namingRoom, type NamingRoomScene } from '../three/venues/namingroom';
import { h, setText } from './dom';

export interface NamingHost {
  stage: Stage;
  ctx: AudioContext;
  career: Career;
  /** the venue to go back to */
  venue(): string;
  restoreVenue(id: string): void;
  /** the room goes up: a drop through the whole game */
  fireDrop(): void;
  /** "Later" on first launch */
  later(): void;
  /** the scene is open (the app holds its auto camera) */
  busy(on: boolean): void;
  /** closed after naming (`first`: the very first name) */
  named?(first: boolean): void;
}

type Phase = 'typing' | 'flicker' | 'reveal' | 'closed';

/** a letter's brightness in its first moments: it stutters on like a tube striking */
function strike(age: number, i: number): number {
  if (age >= 0.38) return 1;
  const slot = Math.floor(age * 28);
  const r = Math.abs(Math.sin((slot + 1) * 12.9898 + i * 78.233) * 43758.5453) % 1;
  return r > 0.45 - age ? 0.35 + age * 1.6 : 0.04;
}

export class NamingScene {
  private el: HTMLElement | null = null;
  private phase: Phase = 'closed';
  private born: number[] = [];
  private last = '';
  private t = 0;
  private phaseT = 0;
  private dirty = true;
  private prevVenue = '';
  private prevView: ViewId = 'perf';
  private room: NamingRoomScene | null = null;
  private input!: HTMLInputElement;
  private tagline!: HTMLInputElement;
  private caps!: HTMLInputElement;
  private message!: HTMLElement;
  private previews: HTMLCanvasElement[] = [];
  private buzzAt = -1;
  private first = false;

  constructor(private host: NamingHost) {}

  get open(): boolean {
    return this.phase !== 'closed';
  }

  show(o: { first: boolean }): void {
    if (this.open) return;
    this.first = o.first;
    const st = this.host.stage;
    this.prevVenue = this.host.venue();
    const v = st.rig.view;
    this.prevView = v === 'drone' || v === 'custom' ? 'perf' : v;
    st.setVenue(namingRoom);
    this.room = st.venue as unknown as NamingRoomScene;
    this.room.glow = 1.3;
    st.rig.goTo('wide', true);
    this.host.busy(true);
    document.body.classList.add('naming-open');
    requestAnimationFrame(() => st.resize());

    const p = this.host.career.profile;
    this.input = h('input', { class: 'naming-input', type: 'text', maxlength: NAME_MAX, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Your DJ name', placeholder: 'YOUR NAME' }) as HTMLInputElement;
    this.input.value = p.name;
    this.tagline = h('input', { class: 'naming-tag', type: 'text', maxlength: TAGLINE_MAX, autocomplete: 'off', 'aria-label': 'Tagline (optional)', placeholder: 'Tagline (optional) — ALL NIGHT LONG' }) as HTMLInputElement;
    this.tagline.value = p.tagline;
    this.caps = h('input', { type: 'checkbox' }) as HTMLInputElement;
    this.caps.checked = p.uppercase;
    this.message = h('p', { class: 'naming-msg', role: 'status' });
    this.previews = PREVIEW_STYLES.map(() => {
      const c = h('canvas', { width: 360, height: 112 }) as HTMLCanvasElement;
      return c;
    });
    const go = h('button', { class: 'btn primary naming-go', type: 'button' }, 'Light it up');
    const later = h('button', { class: 'btn ghost', type: 'button' }, o.first ? 'Later' : 'Cancel');
    go.addEventListener('click', () => this.confirm());
    later.addEventListener('click', () => {
      if (o.first) this.host.later();
      this.close();
    });
    this.input.addEventListener('input', () => this.onType());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirm();
    });
    this.tagline.addEventListener('input', () => {
      const c = cleanTagline(this.tagline.value);
      if (c !== this.tagline.value.trim()) this.tagline.value = c;
      this.dirty = true;
    });
    this.caps.addEventListener('change', () => {
      this.dirty = true;
      this.onType();
    });

    this.el = h(
      'div',
      { class: 'naming', role: 'dialog', 'aria-label': 'Name yourself' },
      h('div', { class: 'naming-top' }, h('span', { class: 'naming-kicker' }, 'Every DJ starts somewhere'), h('h2', {}, 'What do they call you?')),
      h(
        'div',
        { class: 'naming-panel' },
        this.input,
        h('div', { class: 'naming-row' }, this.tagline, h('label', { class: 'naming-caps' }, this.caps, 'CAPITALS')),
        h('div', { class: 'naming-previews', 'aria-label': 'How your name looks' }, ...this.previews.map((c, i) => h('figure', {}, c, h('figcaption', {}, STYLES[PREVIEW_STYLES[i]].label)))),
        this.message,
        h('div', { class: 'naming-actions' }, later, go),
      ),
    );
    st.el.append(this.el);
    this.born = [];
    this.last = '';
    this.phase = 'typing';
    this.phaseT = 0;
    this.onType(true);
    setTimeout(() => this.input.focus(), 50);
  }

  /** the text as the sign shows it */
  private display(): string {
    const n = cleanName(this.input.value);
    return this.caps.checked ? n.toUpperCase() : n;
  }

  private onType(initial = false): void {
    const raw = this.input.value;
    // only allowed characters, kept to the limit (the caret stays at the end, which is where people type)
    const kept = [...raw].filter((ch) => /[\p{L}\p{N} .&'-]/u.test(ch)).join('').slice(0, NAME_MAX);
    if (kept !== raw) this.input.value = kept;
    const text = this.display().replace(/ /g, '');
    // letters that are new since the last keystroke strike up
    const prev = this.last;
    const born: number[] = [];
    for (let i = 0; i < text.length; i++) born.push(prev[i] === text[i] ? (this.born[i] ?? -1e9) : initial ? -1e9 : this.t);
    const added = text.length > prev.length || [...text].some((c, i) => c !== prev[i] && i < prev.length);
    this.born = born;
    this.last = text;
    this.dirty = true;
    if (added && !initial && this.t - this.buzzAt > 0.04) {
      this.buzzAt = this.t;
      void this.host.ctx.resume();
      buzz(this.host.ctx);
    }
    setText(this.message, '');
  }

  private confirm(): void {
    if (this.phase !== 'typing') return;
    const name = cleanName(this.input.value);
    if (!name) {
      setText(this.message, 'Give us a name.');
      this.input.focus();
      return;
    }
    if (isBlocked(name) || isBlocked(this.tagline.value)) {
      setText(this.message, 'Pick another name.');
      this.input.focus();
      return;
    }
    void this.host.ctx.resume();
    this.phase = 'flicker';
    this.phaseT = 0;
    this.el?.classList.add('confirming');
  }

  private reveal(): void {
    const name = cleanName(this.input.value);
    this.host.career.setProfile({ name, tagline: cleanTagline(this.tagline.value), uppercase: this.caps.checked, createdAt: this.host.career.profile.createdAt ?? new Date().toISOString() });
    bass(this.host.ctx);
    cheer(this.host.ctx);
    this.host.fireDrop();
    this.host.stage.rig.goTo('crowd');
    this.phase = 'reveal';
    this.phaseT = 0;
    if (!this.el) return;
    const cont = h('button', { class: 'btn primary', type: 'button' }, "Let's go");
    cont.addEventListener('click', () => this.close());
    const done = h('div', { class: 'naming-done' }, h('h2', { class: 'naming-name' }, nameService.text), h('p', {}, nameService.tagline || "That's you. Now go make them remember it."), cont);
    this.el.querySelector('.naming-panel')?.replaceWith(done);
    this.el.querySelector('.naming-top')?.remove();
    setTimeout(() => cont.focus(), 600);
  }

  close(): void {
    if (!this.open) return;
    const named = this.phase === 'reveal';
    this.phase = 'closed';
    this.el?.remove();
    this.el = null;
    this.room = null;
    document.body.classList.remove('naming-open');
    this.host.restoreVenue(this.prevVenue);
    this.host.stage.rig.goTo(this.prevView, true);
    this.host.busy(false);
    requestAnimationFrame(() => this.host.stage.resize());
    if (named) this.host.named?.(this.first);
  }

  /** every frame while open */
  update(dt: number): void {
    if (!this.open || !this.room) return;
    this.t += dt;
    this.phaseT += dt;
    const text = this.display();
    const n = text.replace(/ /g, '').length;
    let lit: number[];
    if (this.phase === 'flicker') {
      // the whole sign stutters, then slams on
      lit = Array.from({ length: n }, (_, i) => strike(Math.min(0.38, this.phaseT * 0.6), i + Math.floor(this.phaseT * 9)));
      this.room.glow = 1.1 + this.phaseT * 0.6;
      if (this.phaseT > 0.7) {
        lit = lit.map(() => 1);
        this.reveal();
      }
      this.dirty = true;
    } else {
      lit = this.born.map((b, i) => strike(this.t - b, i));
      if (this.born.some((b) => this.t - b < 0.4)) this.dirty = true;
      if (this.phase === 'reveal') this.room.glow = 1.5;
    }
    if (this.dirty) {
      this.dirty = false;
      nameService.draw(this.room.signCanvas, 'led_sign', text, { lit, tagline: this.tagline?.value.trim() ? (this.caps.checked ? this.tagline.value.toUpperCase() : this.tagline.value) : undefined });
      this.room.signTexture.needsUpdate = true;
      if (this.phase === 'typing') this.previews.forEach((c, i) => nameService.draw(c, PREVIEW_STYLES[i], text || 'YOUR NAME'));
    }
  }
}
