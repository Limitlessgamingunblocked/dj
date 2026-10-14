/*
 * Gigs in the app: the bookings calendar and the pre-gig screen, the vibe
 * meter every frame (a free-play meter in the studio, the gig's own meter in
 * a set), the HUD, the Bedroom's stream chat, the assist levels, what the
 * crew in the booth says, and the results and rewards at the end.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import { dressCodeBonus } from '../character/look';
import type { Booking } from '../core/models';
import { goalMet, played, PROMOTERS, seeded } from '../game/bookings';
import type { CareerVenue } from '../game/progression';
import { addPosts, postsForSet } from '../game/social';
import { ASSISTS, Gig, isVibeEvent, type Assist, type GigConfig, type GigEvent } from '../game/Gig';
import { nextGoal } from '../game/progression';
import { announceEarned } from '../ui/AchievementsPanel';
import { cleanDaily, dailyFor, dailyMet, liveStreak, recordDaily, shareText, vibeSquares, type DailyRecord, type DailySave, type DailySpec } from '../game/daily';
import { loadSetting, saveSetting } from '../core/settings';
import { CHEMISTRY_UNLOCK, INTROS, RIVALS, rivalOf, type RivalId } from '../game/rivals';
import type { ControlRegistry } from '../core/controls';
import { B2B } from './b2b';
import { RoomBattle } from '../game/roomBattle';
import { isCrazyRoom } from '../game/rooms';
import { isCustomRoom } from '../three/venues/rooms/custom';
import { roomShow } from '../three/venues/rooms/kit';
import { crowdShow } from '../three/venues/crowdShow';
import { afterSet, attending, loadLoyalty, saveLoyalty, type Regular } from '../game/regulars';
import { genreOf } from '../library/genres';
import type { DjMove } from '../character/Avatar';
import { ghostAt, keepIfBest, loadGhost, type Ghost, type GhostPoint } from '../game/ghost';
import { openHighlight } from '../ui/HighlightCard';
import { skyCue } from '../three/venues/skyshow';
import { CircuitGig, type CircuitNote } from './circuitGig';
import { CITIES, circuitSpecial, nextTourCity, relAfter, relStatus, residencyAfter, tourCity, tourReward, travelFor } from '../game/circuit';
import { openTourMap } from '../ui/TourMap';
import { labelName, loadLabel, playedBy, playPost, rivalNights, saveLabel } from '../game/label';

/** the venues with a fireworks finale */
const FINALE_VENUES = ['festival', 'beach', 'boat'];
import { Snapshot } from '../game/snapshot';
import { moments, setClock, tickFreeClock } from '../three/venues/moments';
import { nextSection } from '../game/tracks';
import type { Suggestion } from '../game/coach';
import type { NextUp } from './nextup';
import { eventText, moodFor, SLOTS, TRANSITION_LABEL, VibeMeter, type VibeEvent } from '../game/vibe';
import type { Career } from '../game/Career';
import type { Library } from '../library/Library';
import type { Features } from '../visualizer/AudioFeatures';
import { flyerInfo, openBookings } from '../ui/BookingsPanel';
import { drawFlyer } from '../ui/flyer';
import { GigHud } from '../ui/GigHud';
import { openGigSetup, type GigVenue } from '../ui/GigSetup';
import { showResults } from '../ui/Results';
import { StreamChat } from '../ui/StreamChat';
import { h } from '../ui/dom';
import { openModal } from '../ui/modal';

/** a daily challenge's result, for the results screen */
export interface DailyOut {
  number: number;
  goals: { text: string; met: boolean }[];
  /** the day's first finish (later ones are practice) */
  official: boolean;
  streak: number;
  /** the result as text to paste anywhere */
  share: string;
}

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
  /** go to the gig's venue and walk in with the night's flyer (also into the room you're already in) */
  walkInto(id: string, flyer: HTMLCanvasElement | null): void;
  /** before the night: the walk from backstage out to the booth, then `done` (straight away when it doesn't play) */
  walkOut?(o: { venue: string; flyer: HTMLCanvasElement | null; slot: string; minutes: number }, done: () => void): void;
  venueName(id: string): string;
  /** the venues a gig can be played in, with their lock state */
  gigVenues(): GigVenue[];
  showCrate(id: string | null): void;
  currentCrate(): string | null;
  /** the Library tab, to add music */
  openLibrary(): void;
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
  replay(): { save(): Promise<boolean>; moment(label: string): void; clear(): void; stills(secondsAgo: number): Blob[] } | null;
  /** your character's face: a brow flash for a good transition, a wince at a mistake */
  react?(what: 'nice' | 'oops'): void;
  /** a crowd reaction for the room to play (cheer, groan, boo) */
  crowd(what: 'cheer' | 'groan' | 'boo' | 'whoa' | 'chant'): void;
  /** the board on the stage (for "play five boards") */
  boardId(): string;
  /** a venue's picture, for the bookings */
  venueThumb(id: string, g: CanvasRenderingContext2D, w: number, h: number): void;
  /** for the B2B rival: the controls (to hear you grab a fader) and loading their tracks */
  reg: ControlRegistry;
  loadTrack(deck: number, id: string): Promise<void>;
  /** the next-track coach the whole app shares: a gig hands it its slot's energy and the tracks heard tonight */
  nextUp: NextUp;
  /** the regulars' loyalty changed (the crowd's front row follows) */
  regularsChanged?(): void;
  /** the stage as a picture (the highlight card's moment) */
  snapshot?(): Promise<Blob | null>;
  /** share these tracks (played in order) as a set code */
  shareSet?(trackIds: string[]): void;
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
  /** the coach's pick for the next track, and the tracks the room has heard tonight */
  private coach: Suggestion | null = null;
  private coachAt = -1e9;
  private heard = new Set<string>();
  /** the running set is today's daily challenge */
  private daily: DailySpec | null = null;
  /** a Room Battle in a crazy room: the rival, and the room its pads were split for */
  private battle: { game: RoomBattle; id: RivalId; room: string } | null = null;
  /** room moments that matched the drop this set */
  private roomMoments = 0;
  /** the beat as of the last frame (a pad press scores by its timing) */
  private beatNow = { phase: 0, inBar: 0 };
  /** the regulars in tonight, the genres the room heard (seconds), whose music they've cheered */
  private fans: { fan: Regular; front: boolean }[] = [];
  private genreSecs: Record<string, number> = {};
  private fanCheered = new Set<string>();
  private moveAt = -1e9;
  private dropAt = -1e9;
  /** the daily's ghost (your best run today) and this run's samples */
  private ghost: Ghost | null = null;
  private ghostRun: GhostPoint[] = [];
  private ghostT = -1e9;
  /** the tracks played this set, in order, and the picture of the crowd's peak */
  private played: string[] = [];
  private peakShot: Blob | null = null;
  private peakSeen = 0;
  private peakShotAt = -1e9;
  /** the finale's fireworks have gone up this set (or this night, in free play) */
  private finale = false;
  /** the circuit in this set: residency, tour leg, clash, night event */
  private circuit: CircuitGig | null = null;

  constructor(private host: GigHost) {
    this.snap = new Snapshot(host.engine);
    moments.on((m) => {
      if (this.gig && m.label && m.venue === this.gig.config.venue) this.moment ??= m.label;
    });
    // a crazy room's drop moment: one you chose that suits the drop scores
    roomShow.onMoment((e) => {
      const gig = this.gig;
      if (!gig || (gig.phase !== 'live' && gig.phase !== 'encore')) return;
      this.moment ??= e.label;
      if (e.matched) {
        gig.meter.points += 250;
        this.roomMoments++;
        this.host.callout({ text: `${e.label}: right for the drop +250`, tone: 'hype' });
      } else if (e.chosen) this.host.callout({ text: `${e.label}: not the drop for it`, tone: 'bad' });
    });
    // a Room Battle: your pads score on your turn, by their timing
    roomShow.onPress((_id, from) => {
      const gig = this.gig;
      if (from !== 'you' || !gig || !this.battle || gig.phase === 'waiting' || gig.phase === 'over') return;
      const pts = this.battle.game.press(performance.now() / 1000, this.beatNow.phase, this.beatNow.inBar);
      if (pts) gig.meter.points += pts;
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
      tour: () => openTourMap({ career: this.host.career, venueName: (id) => this.host.venueName(id), booked: () => this.openSetup() }),
      daily: (() => {
        const d = this.dailyToday();
        return { number: d.spec.number, venueName: this.host.venueName(d.spec.venue), slotLabel: SLOTS[d.spec.slot].label, twist: d.spec.twist.label, goals: d.spec.goals.map((g) => g.text), streak: d.streak, played: d.played ? `${d.played.grade} · ${d.played.met}/3 · ${d.played.score.toLocaleString()} pts` : null, play: () => this.openDaily() };
      })(),
    });
  }

  /** today's daily challenge, what's saved, today's result if it's been played, the streak */
  dailyToday(): { spec: DailySpec; save: DailySave; played: DailyRecord | null; streak: number } {
    const spec = dailyFor(new Date());
    const save = cleanDaily(loadSetting<unknown>('daily', null));
    return { spec, save, played: save.history.find((x) => x.key === spec.key) ?? null, streak: liveStreak(save, spec.key) };
  }

  /** the daily challenge's pre-gig screen: today's venue, slot and objectives, fixed */
  openDaily(): void {
    if (!this.hasMusic()) return;
    const { spec, played } = this.dailyToday();
    const c = this.host.career;
    openGigSetup({
      venues: this.host.gigVenues(),
      looks: c.looks.items.length ? c.looks.items : [c.look],
      currentLook: c.look.id,
      crates: this.host.library.crates,
      currentCrate: this.host.currentCrate(),
      progress: c.progress,
      assist: this.lastCfg?.assist ?? 'club',
      booking: {
        venue: spec.venue,
        venueName: this.host.venueName(spec.venue),
        slot: spec.slot,
        minutes: spec.minutes,
        pay: 0,
        promoter: '',
        expectation: '',
        objective: '',
        daily: { number: spec.number, twist: spec.twist.label, goals: spec.goals.map((g) => g.text), note: played ? `You played today's: ${played.grade}, ${played.met}/3 objectives. This one's practice.` : 'The same set for everyone today, on any stage, locked or not. Your first finished set counts.' },
      },
      start: (cfg, o) => this.walkOutThen(cfg, o.look, null, () => this.start(cfg, o.look, o.crate, null, spec)),
      dressingRoom: () => this.host.openCreator(),
    });
  }

  /** a set needs music to mix: at least two of your tracks */
  private hasMusic(): boolean {
    if (this.host.library.list().filter((t) => t.status !== 'error').length >= 2) return true;
    const go = h('button', { class: 'btn primary', type: 'button' }, 'Open the library');
    const m = openModal('Add music first', h('div', { class: 'gig-setup' }, h('p', {}, 'A set needs at least two tracks. Import your music or a playlist, then come back.'), h('div', { class: 'gs-actions' }, go)));
    go.addEventListener('click', () => {
      m.close();
      this.host.openLibrary();
    });
    return false;
  }

  /** the pre-gig screen: a booking's terms, or a free choice */
  openPreGig(b: Booking | null): void {
    if (!this.hasMusic()) return;
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
      booking: b ? { venue: b.venue, venueName: this.host.venueName(b.venue), slot: b.slot, minutes: b.minutes, pay: b.pay, promoter: b.promoter, expectation: b.expectation, objective: b.objective, extra: rival ? `Back to back with ${rival.name}: ${rival.style}` : b.special === 'boat' ? 'The Boat Party: play it and the boat is yours to book again.' : circuitSpecial(b.special, c.circuit)?.badge } : null,
      start: (cfg, o) => this.walkOutThen(cfg, o.look, b, () => this.start(cfg, o.look, o.crate, b)),
      dressingRoom: () => this.host.openCreator(),
    });
  }

  /** backstage first, in the look you picked: the walk out to the booth, then the night */
  private walkOutThen(cfg: GigConfig, look: string | undefined, b: Booking | null, go: () => void): void {
    if (!this.host.walkOut) return go();
    if (look) this.host.career.wearLook(look);
    this.host.walkOut({ venue: cfg.venue, flyer: this.flyerFor(cfg, b), slot: SLOTS[cfg.slot].label, minutes: cfg.minutes }, go);
  }

  /** the flyer for the night: the booking's, or one from the venue's own promoter for a set you picked */
  private flyerFor(cfg: GigConfig, b: Booking | null): HTMLCanvasElement | null {
    const promoters = PROMOTERS[cfg.venue as CareerVenue];
    if (!b && !promoters) return null;
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 400;
    const venueName = this.host.venueName(cfg.venue);
    drawFlyer(
      c,
      b
        ? flyerInfo(b, this.host.djName(), venueName, this.host.career.circuit)
        : { venue: cfg.venue, venueName, promoter: promoters[0], dj: this.host.djName(), slotLabel: SLOTS[cfg.slot].label, minutes: cfg.minutes, night: this.host.career.bookings.night, special: null },
    );
    return c;
  }

  start(cfg: GigConfig, look?: string, crate?: string | null, booking: Booking | null = null, daily: DailySpec | null = null): void {
    if (this.gig) this.teardown();
    const e = this.host.engine;
    this.host.autoDJOff();
    // a fresh start: decks stopped, the set clock waits for the first track
    for (const d of e.decks) if (d.playing) d.pause();
    if (look) this.host.career.wearLook(look);
    this.host.walkInto(cfg.venue, this.flyerFor(cfg, booking));
    if (crate !== undefined) this.host.showCrate(crate);
    this.lastCfg = cfg;
    this.booking = booking;
    this.daily = daily;
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
        label: () => loadLabel().releases.map((x) => x.trackId),
        labelPlayed: (id) => saveLabel(playedBy(loadLabel(), id, rival.id)),
      });
    }
    this.endBattle();
    this.roomMoments = 0;
    this.fans = attending(loadLoyalty());
    this.ghost = daily ? loadGhost(daily.key) : null;
    this.ghostRun = [];
    this.ghostT = -1e9;
    this.played = [];
    this.peakShot = null;
    this.peakSeen = 0;
    this.peakShotAt = -1e9;
    this.finale = false;
    this.genreSecs = {};
    this.fanCheered.clear();
    this.moveAt = -1e9;
    if (cfg.battle && (isCrazyRoom(cfg.venue) || isCustomRoom(cfg.venue))) {
      const ids = Object.keys(RIVALS) as RivalId[];
      const id = ids[Math.floor(Math.random() * ids.length)];
      const tier = this.host.career.progress.tier;
      this.battle = { game: new RoomBattle(RIVALS[id].name, Math.min(0.85, 0.35 + tier * 0.07)), id, room: '' };
    }
    setClock.progress = 0;
    this.gig = new Gig(cfg);
    this.crew = { security: false, bar: false, barFor: 0, cleanSaid: -1e9, chantFor: 0, chantAt: -1e9, sigFor: 0 };
    this.keyMatched.clear();
    this.heard.clear();
    this.coach = null;
    this.coachAt = -1e9;
    this.hud = new GigHud({
      setAssist: (a) => this.setAssist(a),
      end: () => this.end(),
      clean: (on) => document.body.classList.toggle('gig-clean', on),
      saveMix: () => this.host.press('replay.save'),
      clip: () => this.host.press('replay.clip'),
      loadCoach: () => this.loadCoach(),
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
    this.circuit?.dispose();
    this.circuit = new CircuitGig(
      {
        engine: e,
        say: (who, text) => this.hud?.say(who, text),
        callout: (x) => this.host.callout(x),
        crowd: (w) => this.host.crowd(w),
        panel: (o) => this.hud?.b2b(o),
        alert: (o) => this.hud?.alert(o),
        genreOf: (id) => {
          const t = this.host.library.get(id);
          return t ? genreOf(t).genre || null : null;
        },
        dead: this.snap.dead,
      },
      this.gig,
      booking,
      this.host.career.circuit,
      { events: !daily && !this.b2b && !this.battle },
    );
    this.circuit.start();
    const slot = SLOTS[cfg.slot];
    if (this.b2b) {
      const dj = this.host.djName() || 'DJ';
      const b2b = this.b2b;
      this.hud.say(`${b2b.name}:`, INTROS[b2b.rival].replace('{name}', dj).replace('{NAME}', dj.toUpperCase()));
      setTimeout(() => this.b2b === b2b && this.hud?.say('Promoter:', `Back to back with ${b2b.name}. You open: play a track, they answer, then it’s you again.`), 4200);
    } else if (this.battle) {
      const name = this.battle.game.rivalName;
      this.hud.say('Room Battle:', `You and ${name} take turns on the room, 16 bars each. You go first, on the bright pads.`);
      setTimeout(() => this.battle && this.hud?.say(`${name}:`, 'Let’s see what you do with the room.'), 4200);
    } else if (daily) {
      this.hud.say(`Daily #${daily.number}:`, `${slot.label}, ${cfg.minutes} minutes. ${daily.twist.label}.`);
      setTimeout(() => this.gig && this.daily === daily && this.hud?.say('Objectives:', daily.goals.map((g) => g.text).join(' · ')), 3200);
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
    // the daily's twist: a cold room or a hometown crowd
    if (daily) this.gig.meter.vibe = Math.min(1, Math.max(0, this.gig.meter.vibe + daily.twist.vibe));
    // the regulars who've come out tonight
    const front = this.fans.filter((f) => f.front).map((f) => f.fan.name);
    const back = this.fans.filter((f) => !f.front).map((f) => f.fan.name);
    if (this.fans.length) {
      const g = this.gig;
      setTimeout(() => this.gig === g && this.hud?.say('Regulars:', front.length ? `${listOf(front)} ${front.length > 1 ? 'are' : 'is'} at the front with a sign${back.length ? `, and ${listOf(back)} came too` : ''}.` : `${listOf(back)} came out tonight. Play their music and they'll move up front.`), 7200);
    }
  }

  /** the Room Battle's over: all the pads are yours again */
  private endBattle(): void {
    if (!this.battle) return;
    this.battle = null;
    roomShow.owned = null;
    roomShow.held.clear();
    roomShow.changed();
  }

  /** every frame of a Room Battle: split the pads once the room is up, play the rival's turn, the crowd's votes */
  private updateBattle(dt: number, f: Features, gig: Gig, playing: boolean): void {
    const b = this.battle;
    const room = roomShow.current;
    if (!b || !room || room.roomId !== gig.config.venue) return;
    const acts = room.actions.slice(0, 6);
    const half = Math.ceil(acts.length / 2);
    if (b.room !== room.roomId) {
      b.room = room.roomId;
      roomShow.owned = acts.slice(0, half).map((a) => a.id);
      roomShow.changed();
    }
    const rivalActs = acts.slice(half);
    const g = b.game;
    const u = g.update({ dt, bar: Math.floor(f.beatCount / 4), beat: f.beatCount, beatInBar: f.beatInBar, playing: playing && gig.phase !== 'waiting', dropHit: f.dropHit, vibe: gig.meter.vibe, rivalActions: rivalActs.length });
    if (u.rivalPress !== null) {
      const a = rivalActs[u.rivalPress];
      if (a && roomShow.press(a.id, 'rival')) setTimeout(() => roomShow.release(a.id), a.kind === 'hold' ? 900 : 250);
    }
    if (u.turnChanged) this.hud?.say('Room Battle:', u.turnChanged === 'you' ? 'Your turn: 16 bars on your pads.' : `${g.rivalName}’s turn on the room.`);
    if (u.round) {
      const won = u.round.winner === 'you';
      this.hud?.say('The crowd:', won ? `Went with you. ${u.round.you}–${u.round.rival}` : `Went with ${g.rivalName}. ${u.round.you}–${u.round.rival}`);
      this.host.crowd(won ? 'cheer' : 'groan');
      if (won) gig.meter.points += 500;
    }
    const rv = RIVALS[b.id];
    this.hud?.b2b({ name: rv.name, color: rv.color, chemistry: g.share(), turn: g.turn, label: 'Room Battle', meter: 'Your share of the battle' });
  }

  private teardown(): void {
    this.host.nextUp.gig = null;
    this.circuit?.dispose();
    this.circuit = null;
    this.endBattle();
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
    // the regulars remember the set
    const fanOut = afterSet(loadLoyalty(), { grade: r.grade, genres: this.genreSecs, full: r.summary.full });
    saveLoyalty(fanOut.loyalty);
    this.host.regularsChanged?.();
    const regulars = fanOut.changes.slice(0, 3).map((c) => ({ name: c.fan.name, style: c.fan.style, delta: c.delta }));
    // the daily's ghost: keep this run if it's today's best
    let ghostOut: { pts: GhostPoint[]; score: number; beat: boolean; first: boolean } | null = null;
    if (this.daily && this.ghostRun.length > 3) {
      const before = this.ghost;
      const beat = keepIfBest({ key: this.daily.key, score: r.score, grade: r.grade, pts: this.ghostRun });
      ghostOut = { pts: before?.pts ?? this.ghostRun, score: before?.score ?? r.score, beat: beat && !!before, first: !before };
    }
    const shot = this.peakShot;
    const trackOrder = this.played.slice();
    const battle = this.battle ? { name: this.battle.game.rivalName, you: this.battle.game.you, rival: this.battle.game.rival } : null;
    const roomMoments = this.roomMoments;
    // the circuit: the promoter remembers, the residency grows or shrinks, the tour moves on
    const circuitNotes = this.circuitAfter(b, r.grade, met, trackOrder, r.outcome.patch);
    c.setProgress(r.outcome.patch);
    // the calendar moves on a night; the booking keeps how it went
    c.setBookings(played(c.bookings, b?.id ?? null, b ? { grade: r.grade, met } : null));
    // the fans post about it
    const dj = this.host.djName() || 'DJ';
    const posts = postsForSet({ summary: r.summary, dj, venueName: this.host.venueName(gig.config.venue), venue: gig.config.venue, followers: c.progress.followers, story: r.outcome.story?.replace(/\{name\}/g, dj) ?? null, moment: this.moment }, seeded(c.progress.setsPlayed * 31 + 7));
    // your label: the rivals have been playing your releases
    const lab = rivalNights(loadLabel(), c.bookings.night, seeded(c.bookings.night * 131 + 5));
    if (lab.plays.length) {
      saveLabel(lab.label);
      const ln = labelName(lab.label, dj);
      for (const pl of lab.plays) posts.push({ kind: 'rival', ...playPost(pl.rival, pl.title, dj, ln), likes: 40 + Math.floor(Math.random() * 400), comments: [], clip: null, venue: null });
    }
    c.setFeed(addPosts(c.feed, posts, new Date()));
    // the daily challenge: the first finish of the day is the result; the streak moves on
    const daily = this.daily;
    let dailyOut: DailyOut | null = null;
    if (daily) {
      const met = dailyMet(daily, r.summary);
      const res = { grade: r.grade, score: r.score, met, squares: vibeSquares(r.timeline, gig.config.minutes * 60) };
      const rec = recordDaily(cleanDaily(loadSetting<unknown>('daily', null)), daily, res);
      if (rec.official) saveSetting('daily', rec.save);
      const streak = liveStreak(rec.save, daily.key);
      // the best streak counts towards Daily Habit
      if (streak > (c.progress.stats.daily_streak ?? 0)) {
        c.setProgress({ stats: { ...c.progress.stats, daily_streak: streak } });
        announceEarned(c.checkAchievements());
      }
      dailyOut = { number: daily.number, goals: daily.goals.map((g, i) => ({ text: g.text, met: met[i] })), official: rec.official, streak, share: shareText(daily, res, streak) };
    }
    this.teardown();
    this.gig = null;
    this.booking = null;
    this.daily = null;
    this.free.vibe = gig.meter.vibe;
    this.host.finished(r.grade);
    const rp = this.host.replay();
    showResults(r, this.host.venueName(gig.config.venue), {
      dj: this.host.djName() || 'DJ',
      next: nextGoal(c.progress),
      objective: b ? { text: b.objective, met } : null,
      chemistry,
      battle,
      roomMoments,
      regulars,
      circuit: circuitNotes,
      ghost: ghostOut,
      highlight: () => void openHighlight({ dj, grade: r.grade, venue: this.host.venueName(gig.config.venue), slot: SLOTS[gig.config.slot].label, score: r.score, peak: r.peak.vibe, peakAt: r.peak.t, best: r.best ? TRANSITION_LABEL[r.best.name] : null, date: new Date() }, shot ?? (rp ? (rp.stills(Math.max(0, gig.t - r.peak.t))[0] ?? null) : null)),
      shareCode: trackOrder.length && this.host.shareSet ? () => this.host.shareSet!(trackOrder) : undefined,
      daily: dailyOut,
      saveHighlights: rp ? () => rp.save() : undefined,
      replay: rp ? (label) => rp.moment(label) : undefined,
      // the set clock runs from the first track to the end, so the peak was this long ago
      peakStills: rp && r.peak.vibe > 0 ? rp.stills(Math.max(0, gig.t - r.peak.t)) : [],
      closed: () => rp?.clear(),
      // after a booking, "play again" goes back to the calendar for the next one
      again: () => (daily ? this.openDaily() : b ? this.openSetup() : this.lastCfg && this.start(this.lastCfg)),
      studio: () => undefined,
    });
  }

  /** after a booking: how the promoter feels now, the residency's room, the tour's next city, the clash */
  private circuitAfter(b: Booking | null, grade: string, met: boolean, played: string[], patch: { followers?: number; fame?: number }): CircuitNote[] {
    const c = this.host.career;
    const out = this.circuit?.summary();
    const notes: CircuitNote[] = out?.notes.slice() ?? [];
    if (!b) return notes;
    let cs = c.circuit;
    const was = cs.rel[b.promoter] ?? 0;
    const rel = relAfter(cs.rel, b.promoter, grade, met);
    cs = { ...cs, rel };
    const before = relStatus(was).label;
    const after = relStatus(rel[b.promoter]).label;
    if (after !== before) notes.push({ text: `${b.promoter}: ${after.toLowerCase()}`, good: rel[b.promoter] > was });
    if (b.special === 'residency' && cs.residency) {
      const ra = residencyAfter(cs.residency, played, grade);
      cs = { ...cs, residency: ra.res };
      notes.push({ text: `Residency week ${ra.res.weeks}: the room is ${Math.round(ra.res.crowd * 100)}% full (${ra.delta >= 0 ? '+' : '−'}${Math.round(Math.abs(ra.delta) * 100)}%), ${Math.round(ra.fresh * 100)}% fresh tracks`, good: ra.delta >= 0 });
    }
    const city = tourCity(b.special);
    const t = cs.tour;
    if (city && t) {
      const results = [...t.results.filter((x) => x.city !== city.id), { city: city.id, grade }];
      const leg = results.length;
      if (t.cities.every((x) => results.some((r) => r.city === x))) {
        const rw = tourReward(results);
        patch.followers = (patch.followers ?? c.progress.followers) + rw.followers;
        patch.fame = (patch.fame ?? c.progress.fame) + rw.fame;
        cs = { ...cs, tour: null, toured: [...new Set([...cs.toured, ...t.cities])] };
        notes.push({ text: `World Tour done: ${t.cities.length} cities, +${rw.followers.toLocaleString()} followers, +${rw.fame} fame`, good: true });
      } else {
        const nt = { ...t, leg, results };
        const next = CITIES.find((x) => x.id === nextTourCity(nt));
        cs = { ...cs, tour: nt };
        notes.push({ text: `${city.name} done. Next stop ${next?.name ?? ''}, by ${travelFor(c.progress.tier).label.toLowerCase()}`, good: true });
      }
    }
    if (out?.clash) {
      const won = out.clash.share >= 0.5;
      if (won) patch.fame = (patch.fame ?? c.progress.fame) + 20;
      notes.push({ text: `Clash with ${out.clash.rival}: ${Math.round(out.clash.share * 100)}% of the field ${won ? 'stayed with you (+20 fame)' : 'went to their stage'}`, good: won });
    }
    c.setCircuit(cs);
    return notes;
  }

  /** the last track at the festival, the beach and the boat: fireworks */
  private finaleWatch(gig: Gig | null): void {
    const venue = gig ? gig.config.venue : this.host.venue();
    if (!FINALE_VENUES.includes(venue)) return;
    const last = gig ? gig.phase === 'encore' || (gig.phase === 'live' && gig.progress > 0.88) : setClock.progress > 0.92;
    if (!gig && setClock.progress < 0.5) this.finale = false;
    if (!last || this.finale) return;
    this.finale = true;
    skyCue.fireworksFor = gig ? Math.max(40, gig.remaining + 30) : 70;
    this.host.callout({ text: 'Fireworks for the last track!', tone: 'hype' });
    this.host.crowd('whoa');
  }

  /** the daily's ghost against you now */
  private ghostNow(gig: Gig): { vibe: number; diff: number } | null {
    if (!this.ghost || gig.phase === 'waiting') return null;
    const g = ghostAt(this.ghost, gig.t);
    if (!g) return null;
    return { vibe: g.vibe, diff: Math.round(gig.meter.points * gig.multiplier) - g.score };
  }

  /** the daily's run, sampled for its ghost; a picture of the crowd at each new peak (for the highlight card) */
  private sharingWatch(gig: Gig): void {
    if (gig.phase === 'waiting') return;
    if (this.daily && gig.t - this.ghostT >= 2) {
      this.ghostT = gig.t;
      this.ghostRun.push([Math.round(gig.t * 10) / 10, Math.round(gig.meter.vibe * 1000) / 1000, Math.round(gig.meter.points * gig.multiplier)]);
    }
    const v = gig.meter.vibe;
    if (v > this.peakSeen + 0.03 && gig.t - this.peakShotAt > 12 && this.host.snapshot) {
      this.peakSeen = v;
      this.peakShotAt = gig.t;
      void this.host.snapshot().then((b) => {
        if (b) this.peakShot = b;
      });
    }
  }

  /** the genres the room's hearing, and a regular's cheer when their music comes on */
  private fanWatch(dt: number, decks: { trackId: string | null; playing: boolean; audible: number }[], gig: Gig): void {
    const loud = decks.filter((d) => d.trackId && d.playing && d.audible > 0.12).sort((a, b) => b.audible - a.audible)[0];
    if (!loud?.trackId || gig.phase === 'waiting') return;
    const t = this.host.library.get(loud.trackId);
    if (!t) return;
    const genre = genreOf(t).genre;
    if (!genre) return;
    this.genreSecs[genre] = (this.genreSecs[genre] ?? 0) + dt;
    if (this.fanCheered.has(loud.trackId) || (this.genreSecs[genre] ?? 0) < 20) return;
    const f = this.fans.find((x) => x.fan.genres.includes(genre));
    if (!f) return;
    this.fanCheered.add(loud.trackId);
    this.hud?.say(`${f.fan.name}:`, f.fan.cheer);
  }

  /** a DJ move from the pads: well timed (not spammed, the room with you) it lifts the room a little */
  djMove(m: DjMove): void {
    const gig = this.gig;
    if (!gig || (gig.phase !== 'live' && gig.phase !== 'encore')) return;
    if (gig.t - this.moveAt < 6) return;
    this.moveAt = gig.t;
    if (gig.meter.vibe < 0.3) return;
    const onDrop = gig.t - this.dropAt < 4;
    gig.meter.vibe = Math.min(1, gig.meter.vibe + (onDrop ? 0.02 : 0.01));
    const pts = onDrop ? 60 : 25;
    gig.meter.points += pts;
    if (m === 'climb' || onDrop) {
      this.host.crowd('cheer');
      this.host.callout({ text: `${m === 'climb' ? 'Up on the booth!' : 'The room copies you'} +${pts}`, tone: 'hype' });
    }
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
  /* the next-track coach                                           */
  /* -------------------------------------------------------------- */

  /** Chill and Club: the shared coach's pick for the next track, while a deck is free */
  private updateCoach(gig: Gig): void {
    const nu = this.host.nextUp;
    nu.gig = { want: SLOTS[gig.config.slot].target(Math.min(1, gig.progress + 0.1)), heard: this.heard };
    if (gig.t - this.coachAt < 2) return;
    this.coachAt = gig.t;
    this.coach = gig.assist === 'pro' || gig.phase === 'over' || nu.freeDeck() === null || this.b2b ? null : nu.top();
  }

  private loadCoach(): void {
    const pick = this.coach;
    if (!pick || !this.host.nextUp.load(pick.id)) return;
    this.coach = null;
    this.coachAt = this.gig?.t ?? 0;
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
    if (f.dropHit && gig) this.dropAt = gig.t;
    this.finaleWatch(gig);
    this.beatNow.phase = f.beatPhase;
    this.beatNow.inBar = f.beatInBar;
    if (gig) {
      events = gig.update(dt, decks, level, e.redline, f.dropHit);
      if (this.battle) this.updateBattle(dt, f, gig, decks.some((d) => d.playing));
      if (this.b2b) {
        this.b2b.update(dt);
        const rv = RIVALS[this.b2b.rival as RivalId];
        this.hud?.b2b({ name: rv.name, color: rv.color, chemistry: this.b2b.chemistry, turn: this.b2b.turn });
      }
      if (gig.assist === 'chill') this.chill(gig.t);
      const target = SLOTS[gig.config.slot].target(gig.progress);
      for (const d of decks) if (d.trackId && d.playing && d.audible > 0.12) this.heard.add(d.trackId);
      for (const d of decks) if (d.trackId && d.playing && d.audible > 0.3 && this.played[this.played.length - 1] !== d.trackId && !this.played.includes(d.trackId)) this.played.push(d.trackId);
      this.sharingWatch(gig);
      this.fanWatch(dt, decks, gig);
      this.circuit?.update(dt, decks, f.dropHit, this.played);
      this.updateCoach(gig);
      const req = gig.requests.current;
      this.hud?.update({
        vibe: gig.meter.vibe,
        target,
        remaining: gig.remaining,
        phase: gig.phase,
        recording: this.host.recording(),
        buffer: !!this.host.replay(),
        assist: gig.assist,
        slot: SLOTS[gig.config.slot].label,
        venue: this.host.venueName(gig.config.venue),
        redline: e.redline,
        score: Math.round(gig.meter.points * gig.multiplier),
        streak: { count: gig.streak.count, next: gig.streak.next },
        request: req ? { text: req.text, left: Math.max(0, (req.until - gig.t) / Math.max(1, req.until - req.at)) } : null,
        coach: this.coach ? { title: this.coach.title, artist: this.coach.artist, why: this.coach.why } : null,
        ghost: this.ghostNow(gig),
      });
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
    if (ev.kind === 'streak') {
      if (ev.count >= 2) this.hud?.streak(ev.count, ev.mult, ev.bonus);
      return;
    }
    if (ev.kind === 'request') {
      const r = ev.req;
      // the HUD's request card says it; the Bedroom's chat says it too
      if (ev.what === 'ask') this.chat?.say(r.text);
      else if (ev.what === 'met') {
        this.host.callout({ text: `Request met +${r.points}`, tone: 'hype' });
        this.host.crowd('cheer');
        // the people with the sign go wild
        crowdShow.wild = 1;
      }
      return;
    }
    if (isVibeEvent(ev)) this.b2b?.onEvent(ev);
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
    // a crazy room that keeps score (the arcade) hears about it
    if (ev.kind === 'transition') roomShow.pop(TRANSITION_LABEL[ev.name], ev.points);
    else if (ev.kind === 'drop' || ev.kind === 'comeback') roomShow.pop(ev.kind === 'drop' ? 'Drop' : 'Comeback', ev.points);
    else if (ev.kind === 'mistake') roomShow.pop('Miss', 0, true);
    if (ev.kind === 'comeback') this.host.mark('vibe', 'Comeback');
    if (ev.kind === 'transition' || ev.kind === 'comeback') this.host.react?.('nice');
    else if (ev.kind === 'mistake') this.host.react?.('oops');
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
      this.hud?.say('Sound engineer:', 'Clean.');
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

/** "Jess", "Jess and Marco", "Jess, Marco and Priya" */
function listOf(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
