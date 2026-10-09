/*
 * Gigs in the app: the vibe meter every frame (a free-play meter in the
 * studio, the gig's own meter in a set), the HUD, the Bedroom's stream chat
 * and tutorial, the assist levels, what the crew in the booth says, and the
 * results and rewards at the end.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import { dressCodeBonus } from '../character/look';
import { ASSISTS, Gig, type Assist, type GigConfig, type GigEvent } from '../game/Gig';
import { Snapshot } from '../game/snapshot';
import { nextSection } from '../game/tracks';
import { Tutorial, TUTORIAL } from '../game/tutorial';
import { eventText, moodFor, SLOTS, VibeMeter, type VibeEvent } from '../game/vibe';
import type { Career } from '../game/Career';
import type { Library } from '../library/Library';
import type { Features } from '../visualizer/AudioFeatures';
import { h } from '../ui/dom';
import { GigHud } from '../ui/GigHud';
import { openGigSetup, type GigVenue } from '../ui/GigSetup';
import { showResults } from '../ui/Results';
import { StreamChat } from '../ui/StreamChat';
import { toast } from '../ui/toast';

export interface Callout {
  text: string;
  tone: 'good' | 'bad' | 'hype';
}

export interface GigHost {
  engine: AudioEngine;
  career: Career;
  library: Library;
  stageEl: HTMLElement;
  callout(c: Callout): void;
  venue(): string;
  setVenue(id: string): void;
  venueName(id: string): string;
  /** the venues a gig can be played in, with their lock state */
  gigVenues(): GigVenue[];
  showCrate(id: string | null): void;
  currentCrate(): string | null;
  openCreator(): void;
  recording(): boolean;
  djName(): string;
  autoDJOff(): void;
  press(id: string): void;
  /** the venue's own signature moment hooks (the raid's rainbow strip) */
  signature(what: string): void;
  /** a crowd reaction for the room to play (cheer, groan, boo) */
  crowd(what: 'cheer' | 'groan' | 'boo' | 'whoa' | 'chant'): void;
}

export class GigDirector {
  /** the studio's meter: the crowd still reacts when you're just playing */
  private free = new VibeMeter(SLOTS.peak);
  private freeT = 0;
  gig: Gig | null = null;
  private snap: Snapshot;
  private hud: GigHud | null = null;
  private chat: StreamChat | null = null;
  private tutorial: Tutorial | null = null;
  private toolsWatch: ResizeObserver | null = null;
  private tutEl: HTMLElement | null = null;
  private lastCfg: GigConfig | null = null;
  private tipAt = -1e9;
  private crew = { security: false, bar: false, barFor: 0, cleanSaid: -1e9, chantFor: 0, chantAt: -1e9 };
  private building = false;
  private keyMatched = new Set<string>();

  constructor(private host: GigHost) {
    this.snap = new Snapshot(host.engine);
  }

  /** the meter the room follows right now */
  get meter(): VibeMeter {
    return this.gig?.meter ?? this.free;
  }

  /** sync is off-limits in Pro */
  get allowSync(): boolean {
    return !this.gig || this.gig.phase === 'over' || this.gig.assist !== 'pro';
  }

  get assist(): Assist {
    return this.gig?.assist ?? 'club';
  }

  /* -------------------------------------------------------------- */
  /* starting and ending                                            */
  /* -------------------------------------------------------------- */

  openSetup(): void {
    const c = this.host.career;
    openGigSetup({
      venues: this.host.gigVenues(),
      looks: c.looks.items.length ? c.looks.items : [c.look],
      currentLook: c.look.id,
      crates: this.host.library.crates,
      currentCrate: this.host.currentCrate(),
      progress: c.progress,
      assist: this.lastCfg?.assist ?? 'club',
      start: (cfg, o) => this.start(cfg, o.look, o.crate),
      dressingRoom: () => this.host.openCreator(),
    });
  }

  start(cfg: GigConfig, look?: string, crate?: string | null): void {
    if (this.gig) this.teardown();
    const e = this.host.engine;
    this.host.autoDJOff();
    // a fresh start: decks stopped, the set clock waits for the first track
    for (const d of e.decks) if (d.playing) d.pause();
    if (look) this.host.career.wearLook(look);
    this.host.setVenue(cfg.venue);
    if (crate !== undefined) this.host.showCrate(crate);
    this.lastCfg = cfg;
    this.gig = new Gig(cfg);
    this.crew = { security: false, bar: false, barFor: 0, cleanSaid: -1e9, chantFor: 0, chantAt: -1e9 };
    this.keyMatched.clear();
    this.hud = new GigHud({
      setAssist: (a) => this.setAssist(a),
      end: () => this.end(),
      clean: (on) => document.body.classList.toggle('gig-clean', on),
    });
    this.host.stageEl.append(this.hud.el);
    // the HUD sits left of the camera buttons, whose width changes (the framing chip comes and goes),
    // and the tutorial card sits under the HUD, whose height changes with the line it's showing
    const tools = this.host.stageEl.querySelector<HTMLElement>('.stage-tools');
    const hudEl = this.hud.el;
    this.toolsWatch = new ResizeObserver(() => {
      const st = this.host.stageEl.style;
      const top = this.host.stageEl.getBoundingClientRect().top;
      if (tools) {
        st.setProperty('--tools-w', `${tools.offsetWidth}px`);
        st.setProperty('--tools-h', `${Math.round(tools.getBoundingClientRect().bottom - top)}px`);
      }
      st.setProperty('--hud-b', `${Math.round(hudEl.getBoundingClientRect().bottom - top)}px`);
    });
    if (tools) this.toolsWatch.observe(tools);
    this.toolsWatch.observe(hudEl);
    document.body.classList.add('gig-on');
    if (cfg.venue === 'bedroom') {
      this.chat = new StreamChat(() => this.host.djName() || 'DJ', () => this.host.signature('raid'));
      this.host.stageEl.append(this.chat.el);
    }
    if (cfg.tutorial) {
      this.tutorial = new Tutorial();
      this.tutEl = h('div', { class: 'tutorial-card', role: 'status' });
      this.host.stageEl.append(this.tutEl);
      this.drawTutorial();
    }
    this.applyAssist();
    const slot = SLOTS[cfg.slot];
    this.hud.say('Promoter:', cfg.tutorial ? 'Your first stream. Take it slow, follow the steps.' : `${slot.label}, ${cfg.minutes} minutes. ${slot.brief}`);
    // dressed for the room: the crowd starts a little warmer (Section 4.9)
    const dc = dressCodeBonus(this.host.career.look, cfg.venue);
    if (dc.bonus > 0) {
      this.gig.meter.vibe += dc.bonus;
      setTimeout(() => this.hud?.say('Door:', `Dressed for the room. The crowd starts warmer (+${Math.round(dc.bonus * 100)}%).`), 4800);
    }
  }

  private teardown(): void {
    this.toolsWatch?.disconnect();
    this.toolsWatch = null;
    this.hud?.el.remove();
    this.chat?.el.remove();
    this.tutEl?.remove();
    this.hud = null;
    this.chat = null;
    this.tutorial = null;
    this.tutEl = null;
    document.body.classList.remove('gig-on', 'gig-clean', 'assist-pro');
  }

  /** End set: the results come up */
  end(): void {
    if (!this.gig) return;
    this.gig.finish();
    this.complete();
  }

  private complete(): void {
    const gig = this.gig;
    if (!gig) return;
    const c = this.host.career;
    const r = gig.results(c.progress);
    const p = c.progress;
    c.setProgress({
      fame: p.fame + r.rewards.fame,
      cash: p.cash + r.rewards.cash,
      followers: p.followers + r.rewards.followers,
      setsPlayed: p.setsPlayed + 1,
      tier: r.tierUp ?? p.tier,
      milestones: [...p.milestones, ...r.milestones],
      tutorialDone: p.tutorialDone || !!this.tutorial?.done,
    });
    this.teardown();
    this.gig = null;
    this.free.vibe = gig.meter.vibe;
    showResults(r, this.host.venueName(gig.config.venue), {
      dj: this.host.djName() || 'DJ',
      again: () => this.lastCfg && this.start({ ...this.lastCfg, tutorial: this.lastCfg.venue === 'bedroom' && !this.host.career.progress.tutorialDone }),
      studio: () => undefined,
    });
  }

  /* -------------------------------------------------------------- */
  /* assists                                                        */
  /* -------------------------------------------------------------- */

  setAssist(a: Assist): void {
    if (!this.gig) return;
    this.gig.assist = a;
    this.applyAssist();
    this.hud?.say('', ASSISTS.find((x) => x.id === a)!.blurb);
  }

  private applyAssist(): void {
    if (!this.gig) return;
    // Pro hides the crate's key hints too
    document.body.classList.toggle('assist-pro', this.gig.assist === 'pro');
    // Pro: no sync, beatmatch by ear
    if (this.gig.assist === 'pro') for (const d of this.host.engine.decks) if (d.sync) d.setSync(false);
  }

  /** Chill: sync and key-match the next deck as it's readied; suggest when to bring it in */
  private chill(t: number): void {
    const e = this.host.engine;
    const playing = e.decks.filter((d) => d.playing && d.loaded);
    if (!playing.length) return;
    for (const d of e.decks) {
      if (!d.loaded || d.playing || playing.includes(d)) continue;
      if (!d.sync) d.setSync(true);
      const id = `${d.id}:${d.track?.id}`;
      if (!this.keyMatched.has(id)) {
        this.keyMatched.add(id);
        this.host.press(`deck.${d.id}.key.sync`);
      }
    }
    // when the playing track reaches its outro, say so
    const lead = playing[0];
    if (lead.track && t - this.tipAt > 40) {
      const info = this.snap.infoFor(lead.track);
      const outro = nextSection(info.sections, 'outro', lead.position() - 1);
      const left = outro ? outro.t - lead.position() : lead.remaining - 32 * lead.beatLen * 4;
      const ready = e.decks.some((d) => d !== lead && d.loaded && !d.playing);
      if (left < 8 && left > -20) {
        this.tipAt = t;
        this.hud?.say('Tip:', ready ? 'Outro coming. Start the next track now and blend it in.' : 'Outro coming. Load your next track on the other deck.');
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* every frame                                                    */
  /* -------------------------------------------------------------- */

  /** returns the vibe for the lights and the crowd */
  update(dt: number, f: Features): number {
    const e = this.host.engine;
    const decks = this.snap.decks(f);
    const level = this.snap.level();
    let events: (VibeEvent | GigEvent)[];
    const gig = this.gig;
    if (gig) {
      events = gig.update(dt, decks, level, e.redline, f.dropHit);
      if (gig.assist === 'chill') this.chill(gig.t);
      const target = SLOTS[gig.config.slot].target(gig.progress);
      this.hud?.update({ vibe: gig.meter.vibe, target, remaining: gig.remaining, phase: gig.phase, recording: this.host.recording(), assist: gig.assist, slot: SLOTS[gig.config.slot].label, venue: this.host.venueName(gig.config.venue), redline: e.redline });
      this.chat?.update(dt, gig.meter.vibe, moodFor(gig.meter.vibe));
      if (this.tutorial && !this.tutorial.done && this.tutorial.update({ decks, sync: e.decks.map((d) => d.sync), pro: gig.assist === 'pro' })) {
        this.host.crowd('cheer');
        if (this.tutorial.done) {
          this.host.career.setProgress({ tutorialDone: true });
          this.hud?.say('Promoter:', "That's a mix. The Basement Club wants you. Keep going and finish the set.");
          toast('Tutorial done. The Basement Club is open.');
        }
        this.drawTutorial();
      }
      this.crewTalk(dt, gig);
      // the room sees a build coming: "whoa"
      const loudest = [...decks].filter((d) => d.playing && d.audible > 0.12).sort((a, b) => b.audible - a.audible)[0];
      const building = loudest?.section === 'build';
      if (building && !this.building && gig.meter.vibe > 0.35) this.host.crowd('whoa');
      this.building = building;
    } else {
      this.freeT += dt;
      events = this.free.update({ t: this.freeT, dt, decks, level, redline: e.redline, progress: 0.5, dropHit: f.dropHit });
    }
    for (const ev of events) this.handle(ev);
    if (gig && gig.phase === 'over') this.complete();
    return this.meter.vibe;
  }

  private handle(ev: VibeEvent | GigEvent): void {
    if (ev.kind === 'gig') {
      if (ev.what === 'last_minute') this.hud?.say('Promoter:', 'One minute left. Make it count.');
      if (ev.what === 'encore') {
        this.hud?.say('Crowd:', '"One more tune! One more tune!"');
        this.host.crowd('chant');
        this.host.callout({ text: 'One more tune! Play an encore', tone: 'hype' });
      }
      return;
    }
    const text = eventText(ev);
    if (text) this.host.callout({ text, tone: ev.kind === 'mistake' ? 'bad' : ev.kind === 'drop' || ev.kind === 'comeback' ? 'hype' : 'good' });
    this.chat?.react(ev);
    if (!this.gig) return;
    // the room and the crew react
    if (ev.kind === 'transition' || ev.kind === 'comeback') this.host.crowd('cheer');
    if (ev.kind === 'drop') this.host.crowd(ev.built ? 'cheer' : 'whoa');
    if (ev.kind === 'mistake') {
      if (ev.name === 'trainwreck') this.host.crowd('groan');
      if (ev.name === 'dead_air') {
        this.host.crowd('boo');
        this.hud?.say('Sound engineer:', 'Oi! Get something on!');
      }
      if (ev.name === 'redline') this.hud?.say('Sound engineer:', "Easy on the gain. You're in the red.");
    }
    if (ev.kind === 'transition' && ev.band === 'perfect' && ev.t - this.crew.cleanSaid > 90) {
      this.crew.cleanSaid = ev.t;
      this.hud?.say('Sound engineer:', '👍 Clean.');
    }
  }

  private crewTalk(dt: number, gig: Gig): void {
    const v = gig.meter.vibe;
    // a long run at the top: they chant your name
    this.crew.chantFor = v > 0.9 ? this.crew.chantFor + dt : 0;
    if (this.crew.chantFor > 8 && gig.t - this.crew.chantAt > 45 && gig.config.venue !== 'bedroom') {
      this.crew.chantAt = gig.t;
      this.host.crowd('chant');
    }
    if (!this.crew.security && v > 0.8) {
      this.crew.security = true;
      this.hud?.say('Security:', 'gives you a nod.');
    }
    this.crew.barFor = v > 0.88 ? this.crew.barFor + dt : 0;
    if (!this.crew.bar && this.crew.barFor > 30 && gig.config.venue !== 'bedroom') {
      this.crew.bar = true;
      const name = this.host.djName() || 'DJ';
      this.hud?.say('Bar:', `sent up a "${name} Sour". On the house.`);
    }
  }

  private drawTutorial(): void {
    const t = this.tutorial;
    const el = this.tutEl;
    if (!t || !el) return;
    if (t.done) {
      el.replaceChildren(h('b', {}, 'Tutorial done'), h('p', {}, 'Finish the set your way. The Basement Club is open.'));
      setTimeout(() => el.classList.add('out'), 6000);
      return;
    }
    const s = t.current!;
    el.replaceChildren(h('span', { class: 'tc-step' }, `Step ${t.step + 1} of ${TUTORIAL.length}`), h('b', {}, s.text), h('p', {}, s.hint));
  }
}
