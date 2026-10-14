/*
 * The launch cutscene. It starts before anything else (a black screen, then
 * the cab ride across town), covers the game loading behind it, and hands
 * over to the real 3D room when the club's door opens: through the crowd,
 * hands on the decks, the DJ from below, a pull back through the break, and
 * the name slams in on the drop. The groove keeps going under the title
 * screen until you press start.
 *
 *   first launch   the full cut (about 35 s, longer only if loading is slow)
 *   after that     the door, then the break and the drop (about 8 s)
 *   any time       Esc, Enter, Space or Skip goes straight to the title
 *
 * plan.ts is the clock, score.ts the music, film.ts the first act's pictures
 * (in a worker where it can be). This file runs the show: the audio, the
 * words over the pictures, the cuts inside, the skip.
 */
import * as THREE from 'three';
import { prefs } from '../core/prefs';
import { loadSetting, saveSetting } from '../core/settings';
import type { ActiveShot } from '../three/CameraRig';
import type { Stage } from '../three/Stage';
import type { ShotPose } from '../three/shots';
import { h } from '../ui/dom';
import { Film, type FilmState } from './film';
import FilmWorker from './film.worker?worker&inline';
import { BAR, BARS, BEAT, BPM, BREAK_BAR, type Cut, doorStart, openTime, type Part, shotAt, type Timeline, timeline } from './plan';
import { type Kit, renderDrop, renderKit, renderPart } from './score';

const SEEN_KEY = 'introSeen';

/** Which cut to play this launch, or none (automated test browsers, ?nointro). */
export function introCut(): Cut | null {
  const q = location.search;
  if (/[?&]nointro\b/.test(q)) return null;
  const force = /[?&]intro(=(full|short))?(&|$)/.exec(q);
  if (force) {
    // asked for once (Settings → Watch it): a reload goes back to normal
    const u = new URL(location.href);
    u.searchParams.delete('intro');
    history.replaceState(history.state, '', u.toString());
    return (force[2] as Cut | undefined) ?? 'full';
  }
  if (navigator.webdriver || /[?&](naming|dressing|notitle)\b/.test(q)) return null;
  if (prefs.intro === 'off') return null;
  if (prefs.intro === 'full' || prefs.intro === 'short') return prefs.intro;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return loadSetting(SEEN_KEY, false) || calm ? 'short' : 'full';
}

/** What the cutscene needs from the game once it's built. */
export interface IntroHost {
  stage: Stage;
  /** the app's shell (full screen stage while the cutscene runs) */
  shell: HTMLElement;
  /** the venue's name and where it is (a credit over the room) */
  venue: { name: string; place: string };
  /** feed the music to the lights and the crowd (the visual analyser) */
  tap(node: AudioNode): void;
  /** the drop: the whole room goes */
  drop(): void;
  /** put the title screen up (its name slams in) */
  title(): void;
}

interface Seg {
  part: Part | 'drop';
  /** intro seconds it starts at */
  at: number;
  /** seconds into the buffer it starts from */
  offset: number;
  loop: boolean;
  /** intro seconds it stops at */
  until: number;
  src: AudioBufferSourceNode | null;
}

/** debugging the cut: ?introclock=start,rate starts it part way in and runs it slow (for screenshots) */
const debugClock = (() => {
  const m = /[?&]introclock=([\d.]+)(?:,([\d.]+))?/.exec(typeof location !== 'undefined' ? location.search : '');
  return m ? { start: Number(m[1]), rate: Number(m[2] ?? 1) } : { start: 0, rate: 1 };
})();
const wall = () => (performance.timeOrigin + performance.now()) / 1000;
const t0 = wall();
/** the cutscene's clock, in seconds (the wall clock, unless it's being debugged) */
const now = () => t0 + (wall() - t0) * debugClock.rate + debugClock.start;
/** a camera move that sets off briskly and glides to a stop */
const easeOut = (u: number) => 1 - (1 - Math.min(1, Math.max(0, u))) ** 2;

export class Intro {
  readonly ctx: AudioContext;
  private cut: Cut;
  private readonly calm: boolean;
  private epoch = t0;
  private el: HTMLElement;
  private filmEl: HTMLCanvasElement;
  private statusEl: HTMLElement;
  private barEl: HTMLElement;
  private soundEl: HTMLButtonElement;
  private creditEl: HTMLElement;
  private worker: Worker | null = null;
  private film: Film | null = null;
  private filmState: FilmState;
  private raf = 0;
  private music: GainNode;
  private outro: BiquadFilterNode;
  private kit: Promise<Kit>;
  private buffers: Partial<Record<Part | 'drop', AudioBuffer>> = {};
  private segs: Seg[] = [];
  private host: IntroHost | null = null;
  private tl: Timeline | null = null;
  private shotIndex = -1;
  private credited = new Set<string>();
  private skipped = false;
  private titled = false;
  private released = false;
  private off: (() => void)[] = [];
  private shotSide = 1;
  /** when the game was ready (intro seconds) */
  private readyAt: number | null = null;
  /** while the room's on screen: the crowd's energy (the app's hype meter steps aside) */
  hype: number | null = null;

  constructor(
    private root: HTMLElement,
    cut: Cut,
  ) {
    this.cut = cut;
    this.calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // one audio context for the whole game: the engine takes this one over
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    } catch {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    this.ctx = ctx;
    this.outro = ctx.createBiquadFilter();
    this.outro.type = 'lowpass';
    this.outro.frequency.value = 20000;
    this.music = ctx.createGain();
    this.music.gain.value = 0.9;
    this.music.connect(this.outro);
    this.outro.connect(ctx.destination);
    this.filmState = { cut, open: null, calm: this.calm };

    this.filmEl = h('canvas', { class: 'intro-film', 'aria-hidden': 'true' });
    this.statusEl = h('span', { class: 'intro-status' }, 'Warming up the sound system');
    this.barEl = h('i', { class: 'intro-progress' });
    this.creditEl = h('div', { class: 'intro-credits', 'aria-live': 'polite' });
    this.soundEl = h('button', { class: 'intro-sound', type: 'button', hidden: true }, '♪ Tap for sound');
    const skip = h('button', { class: 'intro-skip', type: 'button' }, 'Skip', h('kbd', {}, 'Esc'));
    this.el = h(
      'div',
      { class: `intro intro-${cut}`, role: 'dialog', 'aria-label': 'Intro. Press Escape to skip.' },
      this.filmEl,
      h('div', { class: 'intro-bar intro-bar-top' }),
      h('div', { class: 'intro-bar intro-bar-bottom' }, h('div', { class: 'intro-hud' }, this.statusEl, this.soundEl, skip), this.barEl),
      this.creditEl,
    );
    if (cut === 'full') {
      this.credit('presents', 'Deckhouse', 'presents', 0.7, 3.2);
      this.credit('time', 'Saturday', '02:47', 5.2, 6);
    }
    this.root.append(this.el);
    skip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.skip();
    });
    this.startFilm();
    this.bindInput();
    this.kit = renderKit(ctx.sampleRate);
    this.plan();
    void this.renderAll();
    ctx.addEventListener('statechange', () => this.syncAudio());
    this.soundEl.hidden = ctx.state === 'running';
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.update();
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** intro seconds */
  private get t(): number {
    return now() - this.epoch;
  }

  /** the cutscene owns the camera and the room */
  get busy(): boolean {
    return !this.titled && !!this.host;
  }

  /** the music's beat, for the lights while it plays */
  get beat(): { bpm: number; position: number } | null {
    if (this.released || this.ctx.state !== 'running') return null;
    const t = this.t;
    if (!this.host || (this.tl && t < this.tl.inside && !this.titled)) return null;
    return { bpm: BPM, position: t / BEAT };
  }

  /* ---------------------------------------------------------------- */
  /* loading                                                            */
  /* ---------------------------------------------------------------- */

  /** how far loading's got, 0..1, and what it's doing */
  progress(k: number, label: string): void {
    this.barEl.style.transform = `scaleX(${Math.min(1, Math.max(0, k))})`;
    this.statusEl.textContent = label;
  }

  /** The game's built: the door opens as soon as the room's ready to draw. */
  ready(host: IntroHost): void {
    this.host = host;
    host.tap(this.music);
    host.shell.classList.add('titling');
    // red, amber and white in the rig: the colours of a deep house room (the venue's own come back after)
    host.stage.show.setVenuePalette(['#ff4a2e', '#ffb347', '#ece8ff']);
    host.stage.rig.setFlyby(false);
    this.progress(1, 'Sound check');
  }

  /* ---------------------------------------------------------------- */
  /* the timeline                                                       */
  /* ---------------------------------------------------------------- */

  /** the music up to the door (the rest is planned when the door opens) */
  private plan(): void {
    this.stopAll();
    this.segs = [];
    if (this.cut === 'full') this.segs.push({ part: 'street', at: 0, offset: 0, loop: false, until: Infinity, src: null });
    this.segs.push({ part: 'door', at: doorStart(this.cut), offset: 0, loop: true, until: Infinity, src: null });
    this.syncAudio();
  }

  private openDoor(at: number): void {
    const tl = timeline(this.cut, at);
    this.tl = tl;
    for (const s of this.segs) if (s.part === 'door') this.setUntil(s, at);
    this.segs.push(
      { part: 'open', at, offset: 0, loop: false, until: Infinity, src: null },
      { part: 'inside', at: tl.inside, offset: tl.insideFrom, loop: false, until: tl.title + BAR, src: null },
      { part: 'drop', at: tl.title, offset: 0, loop: false, until: Infinity, src: null },
      { part: 'title', at: tl.title, offset: 0, loop: true, until: Infinity, src: null },
    );
    this.syncAudio();
    this.post({ open: at });
    this.filmState.open = at;
  }

  private update(): void {
    const t = this.t;
    if (!this.host) {
      // a skip before the game's ready: hold on the door
      return;
    }
    if (!this.tl) {
      // the room's ready to draw, and its music (unless that's taking far too long: the pictures don't wait forever)
      if (this.host.stage.preparing) return;
      this.readyAt ??= t;
      if ((!this.buffers.open || !this.buffers.inside) && t - this.readyAt < 4) return;
      if (this.skipped) {
        this.toTitle();
        return;
      }
      // the full cut gets its ride across town first
      if (t < doorStart(this.cut) - BAR * 0.5) return;
      // (a debug clock started part way in keeps the planned timeline, so any moment can be looked at)
      this.openDoor(debugClock.start > 0 ? openTime(this.cut, 0, 0) : openTime(this.cut, t, 0.3));
      return;
    }
    const tl = this.tl;
    if (t >= tl.inside - 0.05 && this.shotIndex === -1) this.goInside();
    if (t >= tl.inside && !this.titled) this.inside(t - tl.inside + tl.insideFrom);
    if (t >= tl.title && !this.titled) this.title();
  }

  /** through the door: the film fades out of white onto the room */
  private goInside(): void {
    this.shotIndex = -2;
    this.host!.stage.shotLook = 'cinema';
    // the first shot's in place under the white before it fades
    this.inside(Math.max(0, this.t - this.tl!.inside) + this.tl!.insideFrom);
    this.el.classList.add('inside');
    window.setTimeout(() => this.stopFilm(), 1200);
  }

  /** the shots inside, cut on the bar */
  private inside(it: number): void {
    const host = this.host!;
    const s = shotAt(it);
    // the crowd's energy: up for the groove, held back in the break, then the drop
    const bar = it / BAR;
    this.hype = bar < BREAK_BAR ? 0.78 : 0.5 + 0.4 * ((bar - BREAK_BAR) / (BARS.inside - BREAK_BAR));
    if (s.index === this.shotIndex) return;
    this.shotIndex = s.index;
    const left = s.length * (1 - s.u) + 0.4;
    this.shotSide = -this.shotSide;
    if (s.id === 'crowd') host.stage.playMove(this.crowdShot(left));
    else if (s.id === 'hero') host.stage.playMove(this.heroShot(left));
    else host.stage.cutToShot({ id: s.id, landmark: 0, side: this.shotSide, seconds: left }, 'hard');
    if (this.cut === 'full') {
      if (s.id === 'hands') this.credit('music', 'Music by', 'you', 0.4, s.length - 0.5);
      if (s.id === 'hero') this.credit('venue', host.venue.name, host.venue.place, 0.4, s.length - 0.5);
    }
  }

  /** in among the dancers, at head height, pushing through them towards the booth */
  private crowdShot(seconds: number): ActiveShot {
    const views = this.host!.stage.venue?.views;
    const pos = views?.crowd.pos ?? new THREE.Vector3(1.4, 2.5, -7.6);
    const target = views?.crowd.target ?? new THREE.Vector3(0, 1.1, 0);
    // from the venue's crowd camera, down among the heads (the booth's floor is the reference)
    const from = pos.clone().lerp(target, 0.2);
    from.y = target.y + 0.15;
    const to = pos.clone().lerp(target, 0.42);
    to.y = target.y + 0.32;
    const look = new THREE.Vector3(target.x, target.y + 0.6, target.z + 0.6);
    return {
      label: 'Through the crowd',
      close: false,
      hand: 0.5,
      seconds,
      pose: (u: number): ShotPose => ({ pos: from.clone().lerp(to, easeOut(u)), target: look, fov: 52 }),
    };
  }

  /** from the photographers' pit: low, looking up at the DJ with the rig behind them */
  private heroShot(seconds: number): ActiveShot {
    const box = this.host!.stage.rig.board;
    const side = this.shotSide;
    const head = new THREE.Vector3(0, 1.55, 0.68);
    const from = new THREE.Vector3(side * 1.05, box.max.y - 0.12, box.min.z - 1.35);
    const to = new THREE.Vector3(side * 0.62, box.max.y - 0.05, box.min.z - 1.15);
    return {
      label: 'From the pit',
      close: false,
      hand: 0.35,
      seconds,
      pose: (u: number): ShotPose => ({ pos: from.clone().lerp(to, easeOut(u)), target: head.clone().setY(head.y + 0.1 * u), fov: 40 }),
    };
  }

  /** the drop: the name, the title screen, the room goes */
  private title(): void {
    if (this.titled) return;
    this.titled = true;
    this.hype = 0.95;
    const host = this.host!;
    host.stage.shotLook = 'none';
    this.el.classList.add('leaving');
    window.setTimeout(() => this.el.remove(), 900);
    for (const f of this.off) f();
    this.off = [];
    this.stopFilm();
    host.drop();
    host.title();
    saveSetting(SEEN_KEY, true);
    // the crowd settles into the groove under the title
    window.setTimeout(() => {
      if (!this.released) this.hype = 0.8;
    }, BAR * 2000);
  }

  /** skip straight to the title (now, or the moment the game's ready) */
  skip(): void {
    if (this.titled) return;
    void this.ctx.resume();
    if (!this.host || this.host.stage.preparing) {
      // still loading: hold on the door until it's done
      if (this.skipped) return;
      this.skipped = true;
      this.el.classList.add('skipping');
      if (this.cut === 'full' && this.t < doorStart('full')) {
        this.cut = 'short';
        this.epoch = now();
        this.filmState = { cut: 'short', open: null, calm: this.calm };
        this.post({ cut: 'short', open: null }, this.epoch);
        this.plan();
      }
      this.creditEl.replaceChildren();
      return;
    }
    this.toTitle();
  }

  /** cut to the title on a fresh bar: the drop and the groove from its top */
  private toTitle(): void {
    this.skipped = true;
    this.stopAll();
    this.epoch = now();
    this.segs = [
      { part: 'drop', at: 0, offset: 0, loop: false, until: Infinity, src: null },
      { part: 'title', at: 0, offset: 0, loop: true, until: Infinity, src: null },
    ];
    this.tl = { open: -BAR * 2, inside: -BAR, insideFrom: 0, title: 0 };
    this.syncAudio();
    this.creditEl.replaceChildren();
    this.title();
  }

  /** the title's gone: the groove fades out as you walk in */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.hype = null;
    const def = this.host?.stage.venueDef;
    if (def) this.host!.stage.show.setVenuePalette(def.palette);
    const c = this.ctx;
    const t = c.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setValueAtTime(this.music.gain.value, t);
    this.music.gain.linearRampToValueAtTime(0, t + 3.2);
    this.outro.frequency.setValueAtTime(20000, t);
    this.outro.frequency.exponentialRampToValueAtTime(260, t + 3);
    window.setTimeout(() => this.dispose(), 3500);
  }

  private dispose(): void {
    cancelAnimationFrame(this.raf);
    this.stopAll();
    this.stopFilm();
    for (const f of this.off) f();
    this.off = [];
    this.music.disconnect();
    this.outro.disconnect();
    this.el.remove();
  }

  /* ---------------------------------------------------------------- */
  /* audio                                                              */
  /* ---------------------------------------------------------------- */

  private async renderAll(): Promise<void> {
    const kit = await this.kit;
    const order: (Part | 'drop')[] = this.cut === 'full' ? ['street', 'door', 'open', 'inside', 'drop', 'title'] : ['door', 'open', 'inside', 'drop', 'title'];
    // a skip can ask for the title's music first
    for (const part of order) {
      if (this.buffers[part]) continue;
      try {
        const job = part === 'drop' ? renderDrop(kit, this.ctx.sampleRate) : renderPart(part, kit, this.ctx.sampleRate);
        // a render that never finishes (it happens) doesn't hold up the rest
        const buf = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
        if (buf) this.buffers[part] = buf;
        else void job.then((b) => ((this.buffers[part] = b), this.syncAudio()));
      } catch (err) {
        console.warn('intro music', part, err);
      }
      this.syncAudio();
    }
  }

  /** start every part that's due and ready, at the right place in it */
  private syncAudio(): void {
    this.soundEl.hidden = this.ctx.state === 'running' || this.titled;
    if (this.ctx.state !== 'running') return;
    const c = this.ctx;
    const t = this.t;
    const lat = (c as AudioContext & { outputLatency?: number }).outputLatency || c.baseLatency || 0;
    for (const s of this.segs) {
      const buf = this.buffers[s.part];
      if (s.src || !buf || s.until <= t + 0.02) continue;
      const late = Math.max(0, t - s.at);
      let offset = s.offset + late;
      if (s.loop) offset %= buf.duration;
      else if (offset >= buf.duration) continue;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = s.loop;
      src.connect(this.music);
      const when = c.currentTime + Math.max(0, s.at - t - lat);
      // a part joined late fades in rather than starting mid-note with a click
      if (late > 0.05) {
        const g = c.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(1, when + 0.4);
        src.disconnect();
        src.connect(g);
        g.connect(this.music);
      }
      src.start(when, offset);
      if (Number.isFinite(s.until)) src.stop(c.currentTime + Math.max(0, s.until - t - lat));
      s.src = src;
    }
  }

  private setUntil(s: Seg, until: number): void {
    s.until = until;
    if (s.src) s.src.stop(this.ctx.currentTime + Math.max(0, until - this.t));
  }

  private stopAll(): void {
    for (const s of this.segs) {
      try {
        s.src?.stop();
      } catch {
        /* never started */
      }
      s.src = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* the picture                                                        */
  /* ---------------------------------------------------------------- */

  private size(): { w: number; h: number } {
    const k = Math.min(window.devicePixelRatio || 1, 1.25);
    const w = Math.min(1920, window.innerWidth * k);
    return { w, h: (w * window.innerHeight) / Math.max(1, window.innerWidth) };
  }

  private startFilm(): void {
    const { w, h } = this.size();
    const onResize = () => {
      const s = this.size();
      if (this.worker) this.worker.postMessage({ type: 'size', w: s.w, h: s.h });
      else this.film?.resize(s.w, s.h);
    };
    window.addEventListener('resize', onResize);
    this.off.push(() => window.removeEventListener('resize', onResize));
    if (typeof this.filmEl.transferControlToOffscreen === 'function' && typeof Worker !== 'undefined') {
      try {
        const off = this.filmEl.transferControlToOffscreen();
        const wk = new FilmWorker();
        wk.postMessage({ type: 'init', canvas: off, w, h, epoch: this.epoch, clock: { t0, ...debugClock }, state: this.filmState }, [off]);
        this.worker = wk;
        return;
      } catch (err) {
        console.warn('intro: drawing on the main thread', err);
      }
    }
    this.film = new Film(this.filmEl);
    this.film.resize(w, h);
    const draw = () => {
      if (!this.film) return;
      this.film.draw(this.t, this.filmState);
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  private post(state: Partial<FilmState>, epoch?: number): void {
    if (this.worker) {
      if (epoch !== undefined) this.worker.postMessage({ type: 'epoch', epoch });
      this.worker.postMessage({ type: 'state', state });
    }
  }

  private stopFilm(): void {
    this.worker?.postMessage({ type: 'stop' });
    this.worker = null;
    this.film = null;
  }

  /** a line of credits over the picture */
  private credit(id: string, top: string, bottom: string, delay: number, hold: number): void {
    if (this.credited.has(id)) return;
    this.credited.add(id);
    const el = h('p', { class: `intro-credit intro-credit-${id}`, style: { animationDelay: `${delay}s, ${delay + hold}s` } }, h('span', {}, top), h('b', {}, bottom));
    this.creditEl.append(el);
    window.setTimeout(() => el.remove(), (delay + hold + 1.5) * 1000);
  }

  /* ---------------------------------------------------------------- */
  /* input                                                              */
  /* ---------------------------------------------------------------- */

  private bindInput(): void {
    // keys go no further than the cutscene (Space would start a deck)
    const key = (e: KeyboardEvent) => {
      if (this.titled) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') this.skip();
      else this.unlock();
    };
    const tap = (e: PointerEvent) => {
      if (this.titled) return;
      if ((e.target as HTMLElement).closest('.intro-skip')) return;
      e.preventDefault();
      this.unlock();
    };
    window.addEventListener('keydown', key, { capture: true });
    this.el.addEventListener('pointerdown', tap);
    this.off.push(() => window.removeEventListener('keydown', key, { capture: true }));
  }

  /** the browser's waiting for a touch before it plays sound */
  private unlock(): void {
    this.el.classList.add('touched');
    if (this.ctx.state !== 'running') void this.ctx.resume().then(() => this.syncAudio());
  }
}

/** the first launch's done: later launches get the short cut */
export function introSeen(): boolean {
  return loadSetting(SEEN_KEY, false);
}
