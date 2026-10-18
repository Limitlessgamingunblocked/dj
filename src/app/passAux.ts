/*
 * Pass the aux in the app (game/passAux.ts has the rules). The night is a
 * loop of turns:
 *   handoff  pass the laptop to the next player; the clock starts when they
 *            press Ready (on the laptop or their phone), or by itself
 *   mixing   the clock runs: get your track playing and up in the mix before
 *            it runs out, then take the last one out. The vibe meter's calls
 *            while you mix (the beatmatch, a trainwreck, dead air, a drop)
 *            and the key and tempo you mixed across make the score
 *   scored   the card for that mix, then the next player
 * then everyone votes for the mix of the night (on the laptop, passed round,
 * or secretly on their phones), and the awards go out.
 *
 * AuxNight is the loop on its own (it's handed the decks every frame, so the
 * tests can drive it); PassAuxMode puts it in the app: the decks, the HUD,
 * and the room the phones join.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { LibraryTrack } from '../core/types';
import { AUX_COLORS, awards, MIN_PLAYERS, NO_CALLS, OPENER_HOLD, BLEND_GRACE, scoreTurn, standings, turnOrder, validVote, votable, type AuxConfig, type AuxPlayer, type AuxTrack, type AuxTurn, type MixCalls } from '../game/passAux';
import type { VibeEvent } from '../game/vibe';
import { TRANSITION_LABEL } from '../game/vibe';
import { AuxHud, openAuxSetup } from '../ui/PassAux';
import { toast } from '../ui/toast';
import { openAuxHost, type AuxGuestMsg, type AuxHostLink, type AuxPhase, type AuxPublic, type AuxTransportKind } from './auxLink';

/** a deck as the game needs it */
export interface AuxDeckView {
  trackId: string | null;
  playing: boolean;
  /** how loud it is in the room, 0..1 */
  audible: number;
}

/** the clock starts by itself this long after the handover */
export const HANDOFF_AUTO = 20;
/** the score card shows this long */
export const SCORED_SECS = 6;
/** a track this loud is in the mix */
const IN_LEVEL = 0.25;
/** a track this quiet is out */
const OUT_LEVEL = 0.05;

export class AuxNight {
  phase: AuxPhase = 'handoff';
  readonly order: { player: string; round: number }[];
  idx = 0;
  readonly turns: AuxTurn[] = [];
  readonly votes: Record<string, number> = {};
  /** seconds in this phase */
  t = 0;
  /** what the current player has to mix into */
  from: AuxTrack | null = null;
  last: AuxTurn | null = null;
  /** something a phone needs to hear about changed */
  changed = true;
  private before = new Set<string>();
  private inAt: number | null = null;
  private to: AuxTrack | null = null;
  private held = 0;
  private outFor = 0;
  private quietFor = 0;
  private calls: MixCalls = { ...NO_CALLS };

  constructor(
    readonly cfg: AuxConfig,
    private track: (id: string) => AuxTrack | null,
  ) {
    this.order = turnOrder(cfg.players, cfg.rounds);
  }

  player(id: string | null | undefined): AuxPlayer | null {
    return this.cfg.players.find((p) => p.id === id) ?? null;
  }

  get current(): AuxPlayer | null {
    return this.phase === 'voting' || this.phase === 'awards' ? null : this.player(this.order[this.idx]?.player);
  }

  get upNext(): AuxPlayer | null {
    return this.player(this.order[this.idx + 1]?.player);
  }

  get round(): number {
    return this.order[Math.min(this.idx, this.order.length - 1)]?.round ?? 1;
  }

  /** seconds left to get the track in (null: the clock isn't running) */
  get timeLeft(): number | null {
    if (this.phase === 'handoff') return this.cfg.turnSecs;
    if (this.phase !== 'mixing') return null;
    return this.inAt !== null ? 0 : Math.max(0, this.cfg.turnSecs - this.t);
  }

  /** the handover's own clock: when the turn starts by itself */
  get autoIn(): number {
    return Math.max(0, HANDOFF_AUTO - this.t);
  }

  /** the current player's track is in; now take the last one out */
  get isIn(): boolean {
    return this.phase === 'mixing' && this.inAt !== null;
  }

  status(): string {
    const p = this.current;
    switch (this.phase) {
      case 'handoff':
        return `Pass it to ${p?.name ?? '?'}`;
      case 'mixing':
        if (!this.from) return this.inAt === null ? `${p?.name} opens the night: get a track playing` : 'In!';
        return this.inAt === null ? `${p?.name}: mix into ${this.from.title}` : `In! Now take ${this.from.title} out`;
      case 'scored':
        return `${this.player(this.last?.player)?.name ?? ''} scored ${this.last?.score ?? 0}`;
      case 'voting':
        return 'Vote for the mix of the night';
      default:
        return 'The awards';
    }
  }

  private loudest(decks: AuxDeckView[]): AuxTrack | null {
    const d = decks.filter((x) => x.playing && x.trackId && x.audible > OUT_LEVEL).sort((a, b) => b.audible - a.audible)[0];
    return d?.trackId ? this.track(d.trackId) : null;
  }

  /** the player has the laptop: start the clock */
  ready(decks?: AuxDeckView[]): void {
    if (this.phase !== 'handoff') return;
    if (decks) {
      this.from = this.loudest(decks) ?? this.from;
      this.before = new Set(decks.filter((d) => d.playing && d.trackId).map((d) => d.trackId!));
    }
    // nothing playing after the first turn: they mix into silence (the last track ran out)
    if (!this.from && this.idx > 0) this.from = this.last?.to ?? this.turns[this.turns.length - 1]?.to ?? null;
    this.phase = 'mixing';
    this.t = 0;
    this.inAt = null;
    this.to = null;
    this.held = 0;
    this.outFor = 0;
    this.quietFor = 0;
    this.calls = { ...NO_CALLS };
    this.changed = true;
  }

  /** the vibe meter's calls while they mix */
  vibe(ev: VibeEvent): void {
    if (this.phase !== 'mixing') return;
    const c = this.calls;
    if (ev.kind === 'transition') {
      const rank = { perfect: 3, good: 2, loose: 1, trainwreck: 0 };
      if (!c.band || rank[ev.band] > rank[c.band]) {
        c.band = ev.band;
        c.move = TRANSITION_LABEL[ev.name];
      }
    }
    if (ev.kind === 'mistake' && ev.name === 'trainwreck') c.trainwreck = true;
    if (ev.kind === 'mistake' && ev.name === 'key_clash') c.keyClash = true;
    if (ev.kind === 'mistake' && ev.name === 'dead_air' && this.idx > 0) c.deadAir = true;
    if (ev.kind === 'drop' && ev.built) c.drop = true;
  }

  /** skip the current player (they passed, or left) */
  skip(): void {
    if (this.phase !== 'handoff' && this.phase !== 'mixing') return;
    const o = this.order[this.idx];
    const turn = scoreTurn({ player: o.player, round: o.round, from: this.from, to: null, inAfter: null, turnSecs: this.cfg.turnSecs, calls: NO_CALLS });
    turn.skipped = true;
    turn.notes = ['Skipped'];
    this.record(turn);
  }

  private finish(): void {
    const o = this.order[this.idx];
    this.record(scoreTurn({ player: o.player, round: o.round, from: this.from, to: this.to, inAfter: this.inAt, turnSecs: this.cfg.turnSecs, calls: this.calls }));
  }

  private record(turn: AuxTurn): void {
    this.turns.push(turn);
    this.last = turn;
    this.phase = 'scored';
    this.t = 0;
    this.changed = true;
  }

  private advance(): void {
    this.idx++;
    this.t = 0;
    this.changed = true;
    // the next player mixes into what's playing then (often the last player's track)
    this.from = this.last?.to ?? this.from;
    if (this.idx < this.order.length) {
      this.phase = 'handoff';
      return;
    }
    this.phase = 'voting';
    if (this.voteDone()) this.phase = 'awards';
  }

  update(dt: number, decks: AuxDeckView[]): void {
    this.t += dt;
    if (this.phase === 'handoff') {
      const now = this.loudest(decks);
      if (now && now.id !== this.from?.id) {
        this.from = now;
        this.changed = true;
      }
      if (this.t >= HANDOFF_AUTO) this.ready(decks);
      return;
    }
    if (this.phase === 'scored') {
      if (this.t >= SCORED_SECS) this.advance();
      return;
    }
    if (this.phase !== 'mixing') return;
    if (this.inAt === null) {
      const theirs = decks.filter((d) => d.playing && d.trackId && !this.before.has(d.trackId) && d.audible > IN_LEVEL).sort((a, b) => b.audible - a.audible)[0];
      this.held = theirs ? this.held + dt : 0;
      if (theirs && this.held >= (this.from ? 0.6 : OPENER_HOLD)) {
        this.to = this.track(theirs.trackId!);
        if (this.to) {
          this.inAt = this.t - this.held;
          this.changed = true;
          if (!this.from) return this.finish();
        }
      }
      // the last track ran out with nothing to follow it
      const any = decks.some((d) => d.playing && d.audible > OUT_LEVEL);
      this.quietFor = any ? 0 : this.quietFor + dt;
      if (this.from && this.quietFor > 2) this.calls.deadAir = true;
      if (this.inAt === null && this.t >= this.cfg.turnSecs) this.finish();
      return;
    }
    const fromOn = !!this.from && decks.some((d) => d.playing && d.trackId === this.from!.id && d.audible > OUT_LEVEL);
    this.outFor = fromOn ? 0 : this.outFor + dt;
    if (this.outFor >= 1.5 || this.t - this.inAt >= BLEND_GRACE) this.finish();
  }

  /* ---------------- the vote ---------------- */

  ballot(voter: string): number[] {
    return votable(this.turns, voter);
  }

  vote(voter: string, turn: number): boolean {
    if (this.phase !== 'voting' || !this.player(voter) || !validVote(this.turns, voter, turn)) return false;
    this.votes[voter] = turn;
    this.changed = true;
    if (this.voteDone()) this.phase = 'awards';
    return true;
  }

  /** everyone who can vote has */
  voteDone(): boolean {
    return this.cfg.players.every((p) => p.id in this.votes || !this.ballot(p.id).length);
  }

  /** close the vote (someone's phone died) */
  closeVote(): void {
    if (this.phase !== 'voting') return;
    this.phase = 'awards';
    this.changed = true;
  }

  /** who still has to vote on the laptop (the players without a phone in) */
  localVoters(): AuxPlayer[] {
    return this.cfg.players.filter((p) => !p.device && !(p.id in this.votes) && this.ballot(p.id).length);
  }

  public(devices: Record<string, string>): AuxPublic {
    const st = standings(this.cfg.players, this.turns, this.votes);
    const tr = (t: AuxTrack | null) => (t ? { title: t.title, artist: t.artist, bpm: Math.round(t.bpm), key: t.key?.camelot ?? null } : null);
    const ballot: Record<string, number[]> = {};
    if (this.phase === 'voting') for (const p of this.cfg.players) ballot[p.id] = this.ballot(p.id).filter(() => !(p.id in this.votes));
    return {
      phase: this.phase,
      round: this.round,
      rounds: this.cfg.rounds,
      turnSecs: this.cfg.turnSecs,
      timeLeft: this.timeLeft === null ? null : Math.ceil(this.timeLeft),
      players: this.cfg.players.map((p) => {
        const s = st.find((x) => x.player === p.id);
        return { id: p.id, name: p.name, color: p.color, device: !!p.device, total: s?.total ?? 0, votes: s?.votes ?? 0 };
      }),
      devices,
      current: this.current?.id ?? null,
      next: this.phase === 'voting' || this.phase === 'awards' ? null : (this.phase === 'scored' ? this.player(this.order[this.idx + 1]?.player) : this.upNext)?.id ?? null,
      from: this.phase === 'handoff' || this.phase === 'mixing' ? tr(this.from) : null,
      status: this.status(),
      last: this.last ? { player: this.last.player, score: this.last.score, notes: this.last.notes } : null,
      turns: this.turns.map((t) => ({ player: t.player, from: t.from?.title ?? null, to: t.to?.title ?? null, score: t.score })),
      ballot,
      voted: Object.keys(this.votes),
      awards: this.phase === 'awards' ? awards(this.cfg.players, this.turns, this.votes).map((a) => ({ title: a.title, player: a.player, why: a.why })) : [],
    };
  }
}

/* ------------------------------------------------------------------ */
/* in the app                                                           */
/* ------------------------------------------------------------------ */

export interface PassAuxHost {
  engine: AudioEngine;
  stageEl: HTMLElement;
  track(id: string): LibraryTrack | null;
  /** a set is running (Pass the aux is free play) */
  inGig(): boolean;
  crowd(what: 'cheer' | 'groan' | 'whoa'): void;
  /** 'memory' for trying the phones in this page (tests) */
  transport?: AuxTransportKind;
}

export function auxTrack(t: LibraryTrack): AuxTrack {
  return { id: t.id, title: t.meta.title || t.fileName, artist: t.meta.artist ?? '', bpm: t.analysis?.bpm ?? t.demo?.bpm ?? 0, key: t.analysis?.key ?? null };
}

export class PassAuxMode {
  night: AuxNight | null = null;
  private hud: AuxHud | null = null;
  private link: AuxHostLink | null = null;
  private opening: Promise<AuxHostLink | string> | null = null;
  private offs: (() => void)[] = [];
  /** a phone's id → its player */
  private devices: Record<string, string> = {};
  private listening = new Set<string>();
  private mix: MediaStreamAudioDestinationNode | null = null;
  private sentAt = 0;
  private lastPhase: AuxPhase | null = null;

  constructor(private host: PassAuxHost) {}

  get on(): boolean {
    return !!this.night;
  }

  /** the setup: the players, the clock, the rounds, phones or not */
  open(): void {
    if (this.host.inGig()) {
      toast('End your set first: Pass the aux is played in free play.');
      return;
    }
    if (this.night) {
      toast('Pass the aux is on. End the night from its bar first.');
      return;
    }
    openAuxSetup({
      phones: async (on) => {
        if (!on) {
          this.closeRoom();
          return null;
        }
        const r = await this.openRoom();
        return typeof r === 'string' ? r : { code: r.code, url: r.url };
      },
      joined: () => this.link?.phones() ?? [],
      onJoined: (fn) => {
        const off = this.link?.onPhones(fn);
        return () => off?.();
      },
      start: (cfg) => this.start(cfg),
      cancel: () => {
        if (!this.night) this.closeRoom();
      },
    });
  }

  /** open a room for the phones (once; a second call gets the same room) */
  openRoom(): Promise<AuxHostLink | string> {
    if (this.link) return Promise.resolve(this.link);
    this.opening ??= openAuxHost({ transport: this.host.transport }).then(
      (link) => {
        this.link = link;
        this.offs.push(
          link.onMessage((m, from) => this.hear(m, from)),
          link.onLeave((id) => this.left(id)),
          // a phone in or out changes the lobby and the scoreboard's phone marks
          link.onPhones(() => this.send()),
        );
        this.send();
        return link;
      },
      (e: unknown) => {
        this.opening = null;
        return e instanceof Error && e.message !== 'offline' ? 'Couldn’t open a room for the phones. Check your internet connection.' : 'Couldn’t reach the room service. Check your internet connection.';
      },
    );
    return this.opening;
  }

  private closeRoom(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.link?.close();
    this.link = null;
    this.opening = null;
    this.devices = {};
    this.listening.clear();
  }

  /** the player a phone plays as: its own, or (rejoining mid-night) the player with its name */
  private playerFor(from: string): string | null {
    const n = this.night;
    if (!n) return null;
    if (this.devices[from]) return this.devices[from];
    const name = this.link?.phones().find((p) => p.id === from)?.name.toLowerCase();
    const p = name ? n.cfg.players.find((x) => x.name.toLowerCase() === name && !Object.values(this.devices).includes(x.id)) : null;
    if (!p) return null;
    this.devices[from] = p.id;
    p.device = true;
    n.changed = true;
    return p.id;
  }

  private hear(m: AuxGuestMsg, from: string): void {
    if (m.t === 'hello') {
      this.playerFor(from);
      return this.send();
    }
    if (m.t === 'listen') return this.listen(from, m.on);
    const n = this.night;
    const pid = this.playerFor(from);
    if (!n || !pid) return;
    if (m.t === 'ready' && pid === n.current?.id) n.ready(this.decks());
    if (m.t === 'vote') n.vote(pid, m.turn);
  }

  private left(id: string): void {
    this.listening.delete(id);
    const pid = this.devices[id];
    delete this.devices[id];
    const p = this.night?.player(pid);
    if (p && !Object.values(this.devices).includes(p.id)) {
      p.device = false;
      this.night!.changed = true;
    }
  }

  /** the mix to a friend's phone (for someone who isn't in the room) */
  private listen(id: string, on: boolean): void {
    if (!this.link) return;
    if (on) {
      if (!this.mix) {
        const e = this.host.engine;
        this.mix = e.ctx.createMediaStreamDestination();
        e.mixer.masterOut.connect(this.mix);
      }
      this.listening.add(id);
      this.link.shareMix(id, this.mix.stream);
    } else if (this.listening.delete(id)) this.link.shareMix(id, null);
  }

  private send(): void {
    if (!this.link) return;
    this.link.send(this.night ? this.night.public(this.devices) : this.lobbyState());
  }

  private lobbyState(): AuxPublic {
    const phones = this.link?.phones() ?? [];
    return {
      phase: 'lobby',
      round: 0,
      rounds: 0,
      turnSecs: 0,
      timeLeft: null,
      players: phones.map((p, i) => ({ id: p.id, name: p.name, color: AUX_COLORS[i % AUX_COLORS.length], device: true, total: 0, votes: 0 })),
      devices: Object.fromEntries(phones.map((p) => [p.id, p.id])),
      current: null,
      next: null,
      from: null,
      status: 'Waiting for the host to start the night',
      last: null,
      turns: [],
      ballot: {},
      voted: [],
      awards: [],
    };
  }

  start(cfg: AuxConfig): void {
    if (cfg.players.length < MIN_PLAYERS) return;
    // the phones in the lobby are their own players
    this.devices = {};
    for (const p of cfg.players) if (p.device) this.devices[p.id] = p.id;
    this.night = new AuxNight(cfg, (id) => {
      const t = this.host.track(id);
      return t ? auxTrack(t) : null;
    });
    this.lastPhase = null;
    this.hud?.dispose();
    this.hud = new AuxHud({
      ready: () => this.night?.ready(this.decks()),
      skip: () => this.night?.skip(),
      vote: (voter, turn) => this.night?.vote(voter, turn),
      closeVote: () => this.night?.closeVote(),
      end: () => this.end(),
      again: () => {
        const c = this.night?.cfg;
        this.end(true);
        if (c) this.start({ ...c, players: c.players.map((p) => ({ ...p })) });
      },
      night: () => this.night,
      room: () => (this.link ? { code: this.link.code, url: this.link.url } : null),
    });
    this.host.stageEl.append(this.hud.el);
    document.body.classList.add('aux-on');
    this.update(0);
  }

  decks(): AuxDeckView[] {
    const e = this.host.engine;
    return e.decks.map((d, i) => {
      const ch = e.channels[i];
      const loaded = d.loaded && !!d.track;
      return { trackId: loaded ? d.track!.id : null, playing: loaded && d.playing, audible: ch ? Math.max(0, Math.min(1, ch.state.fader * ch.xfGain)) : 0 };
    });
  }

  /** the vibe meter's calls (free play's meter runs while you play) */
  vibe(ev: VibeEvent): void {
    this.night?.vibe(ev);
  }

  update(dt: number): void {
    const n = this.night;
    if (!n) return;
    n.update(dt, this.decks());
    if (n.phase !== this.lastPhase) {
      // the room reacts to a mix landing
      if (n.phase === 'scored' && n.last?.from) this.host.crowd(n.last.score >= 70 ? 'cheer' : n.last.score < 30 ? 'groan' : 'whoa');
      if (n.phase === 'awards') this.host.crowd('cheer');
      this.lastPhase = n.phase;
    }
    this.hud?.update(n.changed);
    this.sentAt += dt;
    if (n.changed || this.sentAt > 1) {
      this.send();
      this.sentAt = 0;
    }
    n.changed = false;
  }

  /** the night's over (keepRoom: straight into another with the same phones) */
  end(keepRoom = false): void {
    this.hud?.dispose();
    this.hud = null;
    this.night = null;
    document.body.classList.remove('aux-on');
    if (keepRoom) return;
    if (this.mix) this.host.engine.mixer.masterOut.disconnect(this.mix);
    this.mix = null;
    this.closeRoom();
  }
}
