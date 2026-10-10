/*
 * Gigs in the app: the bookings calendar and the pre-gig screen, the vibe
 * meter every frame (a free-play meter in the studio, the gig's own meter in
 * a set), the HUD, the Bedroom's stream chat, the assist levels, what the
 * crew in the booth says, and the results and rewards at the end.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import { dressCodeBonus } from '../character/look';
import type { Booking } from '../core/models';
import { goalMet, played, seeded } from '../game/bookings';
import { addPosts, postsForSet } from '../game/social';
import { ASSISTS, Gig, type Assist, type GigConfig, type GigEvent } from '../game/Gig';
import { nextGoal } from '../game/progression';
import { CHEMISTRY_UNLOCK, INTROS, RIVALS, rivalOf, type RivalId } from '../game/rivals';
import type { ControlRegistry } from '../core/controls';
import { B2B } from './b2b';
import { Snapshot } from '../game/snapshot';
import { moments, setClock, tickFreeClock } from '../three/venues/moments';
import { nextSection } from '../game/tracks';
import { eventText, moodFor, SLOTS, TRANSITION_LABEL, VibeMeter, type VibeEvent } from '../game/vibe';
import type { Career } from '../game/Career';
import type { Library } from '../library/Library';
import type { Features } from '../visualizer/AudioFeatures';
import { openBookings } from '../ui/BookingsPanel';
import { GigHud } from '../ui/GigHud';
import { openGigSetup, type GigVenue } from '../ui/GigSetup';
import { showResults } from '../ui/Results';
import { StreamChat } from '../ui/StreamChat';

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
  /** a moment worth keeping, for the replay buffer's smart markers (Section 12.5) */
  mark(kind: 'vibe' | 'transition' | 'signature' | 'peak' | 'chant', label: string): void;
  /** a gig finished with this grade */
  finished(grade: 'S' | 'A' | 'B' | 'C' | 'D'): void;
  /** the replay buffer, for the results screen: null when it's off */
  replay(): { save(): Promise<boolean>; moment(label: string): void; clear(): void } | null;
  /** a crowd reaction for the room to play (cheer, groan, boo) */
  crowd(what: 'cheer' | 'groan' | 'boo' | 'whoa' | 'chant'): void;
  /** the board on the stage (for "play five boards") */
  boardId(): string;
  /** a venue's picture, for the bookings */
  venueThumb(id: string, g: CanvasRenderingContext2D, w: number, h: number): void;
  /** for the B2B rival: the controls (to hear you grab a fader) and loading their tracks */
  reg: ControlRegistry;
  loadTrack(deck: number, id: string): Promise<void>;
}

/** what the lighting tech says when you take the lights */
const TECH_LINES: [string, string][] = [
  ['strobe', 'Strobes! Love it.'],
  ['blinder', 'Blinders up, they felt that.'],
  ['laser', 'Lasers, here we go.'],
  ['blackout', 'Killing it… and back. Nice.'],
  ['co2', 'CO2, good timing.'],
  ['pyro', 'Fire! Stand back.'],
  ['confetti', 'Confetti away!'],
  ['auto', 'Fine, I\'ll drive. You mix.'],
  ['dropfx', 'I\'ve got the drops covered.'],
];

/** the promoter at the start of a booking, warmer as you get bigger (Section 8.5) */
export function promoterHello(tier: number, expectation: string): string {
  const greet = tier >= 6 ? 'Sold out in minutes. They\'re all here for you.' : tier >= 4 ? 'Big crowd tonight, they know your name.' : tier >= 2 ? 'Good to have you back.' : 'Thanks for stepping in.';
  return `${greet} ${expectation}.`;
}

export class GigDirector {
  /** the studio's meter: the crowd still reacts when you're just playing */
  private free = new VibeMeter(SLOTS.peak);
  private freeT = 0;
  gig: Gig | null = null;
  private snap: Snapshot;
  private hud: GigHud | null = null;
  private chat: StreamChat | null = null;
  private toolsWatch: ResizeObserver | null = null;
  private lastCfg: GigConfig | null = null;
  /** the booking the running set is for (null: a free set) */
  private booking: Booking | null = null;
  private tipAt = -1e9;
  private crew = { security: false, bar: false, barFor: 0, cleanSaid: -1e9, chantFor: 0, chantAt: -1e9, sigFor: 0 };
  private building = false;
  private techSaid = -1e9;
  /** a B2B set: the rival on the other deck */
  private b2b: B2B | null = null;
  /** the venue's signature moment in this set, if it happened (the fans post about it) */
  private moment: string | null = null;
  private keyMatched = new Set<string>();

  constructor(private host: GigHost) {
    this.snap = new Snapshot(host.engine);
    moments.on((m) => {
      if (this.gig && m.label && m.venue === this.gig.config.venue) this.moment ??= m.label;
    });
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

  /** Play a gig: the bookings calendar */
  openSetup(): void {
    openBookings({
      career: this.host.career,
      dj: () => this.host.djName() || 'DJ',
      venueName: (id) => this.host.venueName(id),
      thumb: (id, g, w, h) => this.host.venueThumb(id, g, w, h),
      play: (b) => this.openPreGig(b),
      free: () => this.openPreGig(null),
    });
  }

  /** the pre-gig screen: a booking's terms, or a free choice */
  openPreGig(b: Booking | null): void {
    const c = this.host.career;
    const rival = rivalOf(b?.special);
    openGigSetup({
      venues: this.host.gigVenues(),
      looks: c.looks.items.length ? c.looks.items : [c.look],
      currentLook: c.look.id,
      crates: this.host.library.crates,
      currentCrate: this.host.currentCrate(),
      progress: c.progress,
      assist: this.lastCfg?.assist ?? 'club',
      booking: b ? { venue: b.venue, venueName: this.host.venueName(b.venue), slot: b.slot, minutes: b.minutes, pay: b.pay, promoter: b.promoter, expectation: b.expectation, objective: b.objective, extra: rival ? `Back to back with ${rival.name}: ${rival.style}` : b.special === 'boat' ? 'The Boat Party: play it and the boat is yours to book again.' : undefined } : null,
      start: (cfg, o) => this.start(cfg, o.look, o.crate, b),
      dressingRoom: () => this.host.openCreator(),
    });
  }

  start(cfg: GigConfig, look?: string, crate?: string | null, booking: Booking | null = null): void {
    if (this.gig) this.teardown();
    const e = this.host.engine;
    this.host.autoDJOff();
    // a fresh start: decks stopped, the set clock waits for the first track
    for (const d of e.decks) if (d.playing) d.pause();
    if (look) this.host.career.wearLook(look);
    this.host.setVenue(cfg.venue);
    if (crate !== undefined) this.host.showCrate(crate);
    this.lastCfg = cfg;
    this.booking = booking;
    this.moment = null;
    this.b2b?.stop();
    this.b2b = null;
    const rival = rivalOf(booking?.special);
    if (rival) {
      this.b2b = new B2B(rival.id, {
        engine: e,
        reg: this.host.reg,
        tracks: () => this.host.library.list(),
        loadTrack: (d, id) => this.host.loadTrack(d, id),
        say: (who, text) => this.hud?.say(who, text),
      });
    }
    setClock.progress = 0;
    this.gig = new Gig(cfg);
    this.crew = { security: false, bar: false, barFor: 0, cleanSaid: -1e9, chantFor: 0, chantAt: -1e9, sigFor: 0 };
    this.keyMatched.clear();
    this.hud = new GigHud({
      setAssist: (a) => this.setAssist(a),
      end: () => this.end(),
      clean: (on) => document.body.classList.toggle('gig-clean', on),
      saveMix: () => this.host.press('replay.save'),
      clip: () => this.host.press('replay.clip'),
    });
    this.host.stageEl.append(this.hud.el);
    // the HUD sits left of the camera buttons, whose width changes (the framing chip comes and goes),
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
    this.applyAssist();
    const slot = SLOTS[cfg.slot];
    if (this.b2b) {
      const dj = this.host.djName() || 'DJ';
      const b2b = this.b2b;
      this.hud.say(`${b2b.name}:`, INTROS[b2b.rival].replace('{name}', dj).replace('{NAME}', dj.toUpperCase()));
      setTimeout(() => this.b2b === b2b && this.hud?.say('Promoter:', `Back to back with ${b2b.name}. You open: play a track, they answer, then it’s you again.`), 4200);
    } else if (booking) {
      this.hud.say(`${booking.promoter}:`, `${promoterHello(this.host.career.progress.tier, booking.expectation)} ${cfg.minutes} minutes.`);
      setTimeout(() => this.gig && this.booking === booking && this.hud?.say('Bonus:', booking.objective), 3200);
    } else this.hud.say('Promoter:', `${slot.label}, ${cfg.minutes} minutes. ${slot.brief}`);
    // dressed for the room: the crowd starts a little warmer (Section 4.9)
    const dc = dressCodeBonus(this.host.career.look, cfg.venue);
    if (dc.bonus > 0) {
      this.gig.meter.vibe += dc.bonus;
      setTimeout(() => this.hud?.say('Door:', `Dressed for the room. The crowd starts warmer (+${Math.round(dc.bonus * 100)}%).`), 4800);
    }
  }

  private teardown(): void {
    this.b2b?.stop();
    this.hud?.b2b(null);
    this.toolsWatch?.disconnect();
    this.toolsWatch = null;
    this.hud?.el.remove();
    this.chat?.el.remove();
    this.hud = null;
    this.chat = null;
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
    const b = this.booking;
    const board = this.host.boardId();
    const met = b ? goalMet(b.goal, gig.summary(board)) : false;
    const r = gig.results(c.progress, { board, booking: b ? { pay: b.pay, met, special: b.special } : undefined });
    // a B2B: the chemistry you built (the best one is kept); great chemistry gets their pieces
    const duo = this.b2b;
    let chemistry: { name: string; value: number; unlocked: boolean } | null = null;
    if (duo) {
      const v = duo.chemistry;
      const prev = c.progress.chemistry[duo.rival] ?? 0;
      const unlock = `rival:${duo.rival}`;
      const already = (r.outcome.patch.unlocked ?? c.progress.unlocked).includes(unlock);
      const unlocked = v >= CHEMISTRY_UNLOCK && !already;
      r.outcome.patch.chemistry = { ...c.progress.chemistry, [duo.rival]: Math.max(prev, Math.round(v * 100) / 100) };
      if (unlocked) {
        r.outcome.patch.unlocked = [...(r.outcome.patch.unlocked ?? c.progress.unlocked), unlock];
        r.outcome.unlocked.push({ kind: 'item', label: `${duo.name}’s pieces in your wardrobe` });
      }
      chemistry = { name: duo.name, value: v, unlocked };
    }
    c.setProgress(r.outcome.patch);
    // the calendar moves on a night; the booking keeps how it went
    c.setBookings(played(c.bookings, b?.id ?? null, b ? { grade: r.grade, met } : null));
    // the fans post about it
    const dj = this.host.djName() || 'DJ';
    const posts = postsForSet({ summary: r.summary, dj, venueName: this.host.venueName(gig.config.venue), venue: gig.config.venue, followers: c.progress.followers, story: r.outcome.story?.replace(/\{name\}/g, dj) ?? null, moment: this.moment }, seeded(c.progress.setsPlayed * 31 + 7));
    c.setFeed(addPosts(c.feed, posts, new Date()));
    this.teardown();
    this.gig = null;
    this.booking = null;
    this.free.vibe = gig.meter.vibe;
    this.host.finished(r.grade);
    const rp = this.host.replay();
    showResults(r, this.host.venueName(gig.config.venue), {
      dj: this.host.djName() || 'DJ',
      next: nextGoal(c.progress),
      objective: b ? { text: b.objective, met } : null,
      chemistry,
      saveHighlights: rp ? () => rp.save() : undefined,
      replay: rp ? (label) => rp.moment(label) : undefined,
      closed: () => rp?.clear(),
      // after a booking, "play again" goes back to the calendar for the next one
      again: () => (b ? this.openSetup() : this.lastCfg && this.start(this.lastCfg)),
      studio: () => undefined,
    });
  }

  /** the lighting tech (Section 8.5) answers when you work the lights in a set */
  lightsUsed(id: string): void {
    const gig = this.gig;
    if (!gig || gig.t - this.techSaid < 20) return;
    const line = TECH_LINES.find(([k]) => id.includes(k))?.[1] ?? 'On it. Your call.';
    this.techSaid = gig.t;
    this.hud?.say('Lighting tech:', line);
  }

  /** the running gig's slot ("Peak time"), or null in free play */
  slotLabel(): string | null {
    return this.gig ? SLOTS[this.gig.config.slot].label : null;
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
    // the open-air venues light themselves by how far through the set we are
    setClock.gig = !!gig && gig.phase !== 'over';
    if (gig) setClock.progress = gig.progress;
    else tickFreeClock(dt, decks.some((d) => d.playing));
    if (gig) {
      events = gig.update(dt, decks, level, e.redline, f.dropHit);
      if (this.b2b) {
        this.b2b.update(dt);
        const rv = RIVALS[this.b2b.rival as RivalId];
        this.hud?.b2b({ name: rv.name, color: rv.color, chemistry: this.b2b.chemistry, turn: this.b2b.turn });
      }
      if (gig.assist === 'chill') this.chill(gig.t);
      const target = SLOTS[gig.config.slot].target(gig.progress);
      this.hud?.update({ vibe: gig.meter.vibe, target, remaining: gig.remaining, phase: gig.phase, recording: this.host.recording(), buffer: !!this.host.replay(), assist: gig.assist, slot: SLOTS[gig.config.slot].label, venue: this.host.venueName(gig.config.venue), redline: e.redline });
      this.chat?.update(dt, gig.meter.vibe, moodFor(gig.meter.vibe));
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
    if (ev.kind !== 'gig') this.b2b?.onEvent(ev);
    if (ev.kind === 'gig') {
      if (ev.what === 'last_minute') this.hud?.say('Promoter:', 'One minute left. Make it count.');
      if (ev.what === 'encore') {
        this.host.mark('peak', 'Encore');
        this.hud?.say('Crowd:', '"One more tune! One more tune!"');
        this.host.crowd('chant');
        this.host.callout({ text: 'One more tune! Play an encore', tone: 'hype' });
      }
      return;
    }
    const text = eventText(ev);
    if (text) this.host.callout({ text, tone: ev.kind === 'mistake' ? 'bad' : ev.kind === 'drop' || ev.kind === 'comeback' ? 'hype' : 'good' });
    if (ev.kind === 'transition') this.host.mark('transition', TRANSITION_LABEL[ev.name]);
    if (ev.kind === 'comeback') this.host.mark('vibe', 'Comeback');
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
      this.host.mark('chant', 'They chant your name');
    }
    // the room at its peak: hands up, and the venue's signature moment after a while up there
    if (v > 0.92) this.host.mark('peak', 'Hands up');
    this.crew.sigFor = v > 0.86 ? this.crew.sigFor + dt : 0;
    if (this.crew.sigFor > 10 && this.crew.sigFor - dt <= 10) this.host.mark('signature', gig.config.venue === 'bedroom' ? 'Raid' : 'The room goes off');
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
}
