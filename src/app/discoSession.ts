/*
 * A silent disco showdown over a room (src/net): the host plays blue and runs
 * the showdown (game/silentDisco.ts); the first friend in as a DJ plays red;
 * anyone else is watching (and listening), and flips between the channels.
 * Practice is the same with no room: a stand-in DJ on red.
 *
 *   guest → host:  pull (a DJ's pull, what they're playing and its tempo), flip (a watcher's channel)
 *   host → guests: state (the room, ten times a second)
 *
 * Audio, when the devices have it: red sends their mix to the host; the host
 * sends each watcher the channel they're on (its own mix, or red's passed
 * on) and sends red its mix, so either DJ can listen in on the other.
 */
import type { Player, Room, RoomMessage } from '../net';
import { CHANNELS, PracticeRival, Showdown, winnerOf, type Channel, type ShowdownNote } from '../game/silentDisco';
import { discoUniforms, pulseDiscoPhones } from '../three/venues/silentDisco';

export interface DiscoWire {
  phase: 'lobby' | 'live' | 'over';
  minutes: number;
  /** seconds left */
  left: number;
  /** blue's share of the room (everyone), and of the dancers */
  share: number;
  crowd: number;
  names: Record<Channel, string>;
  /** what each DJ's playing, and its tempo */
  now: Record<Channel, string>;
  bpm: Record<Channel, number>;
  watching: Record<Channel, number>;
  /** the red DJ's player id (null while the seat's empty, or in practice) */
  red: string | null;
  winner: Channel | 'tie' | null;
  /** blue's share every 5 seconds (only once it's over) */
  history?: number[];
}

export type DiscoMsg =
  | { t: 'pull'; v: number; now: string; bpm: number }
  | { t: 'flip'; ch: Channel }
  | { t: 'state'; s: DiscoWire }
  /** the host's calls (who's ahead, a swing, the last minute), for everyone's screen */
  | { t: 'note'; n: Exclude<ShowdownNote, { kind: 'over' }> };

export type DiscoRole = 'host' | 'practice' | 'red' | 'watch';

/** what a player asks to be when they join (their room info) */
export interface DiscoInfo {
  role: 'dj' | 'watch';
}

const isChannel = (x: unknown): x is Channel => x === 'blue' || x === 'red';
const num = (x: unknown, lo: number, hi: number, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
const str = (x: unknown, n = 80) => (typeof x === 'string' ? x.slice(0, n) : '');
const pair = <T>(o: unknown, f: (x: unknown) => T): Record<Channel, T> => {
  const r = (typeof o === 'object' && o !== null ? o : {}) as Record<string, unknown>;
  return { blue: f(r.blue), red: f(r.red) };
};

/** a message off the network, checked and cleaned (null if it isn't one of ours) */
export function readDisco(x: unknown, fromHost: boolean): DiscoMsg | null {
  if (typeof x !== 'object' || x === null) return null;
  const m = x as Record<string, unknown>;
  if (!fromHost && m.t === 'pull') return { t: 'pull', v: num(m.v, 0, 1.3), now: str(m.now), bpm: num(m.bpm, 0, 300) };
  if (!fromHost && m.t === 'flip' && isChannel(m.ch)) return { t: 'flip', ch: m.ch };
  if (fromHost && m.t === 'note' && typeof m.n === 'object' && m.n !== null) {
    const n = m.n as Record<string, unknown>;
    if ((n.kind === 'lead' || n.kind === 'swing') && isChannel(n.to)) return { t: 'note', n: { kind: n.kind, to: n.to } };
    if (n.kind === 'final') return { t: 'note', n: { kind: 'final' } };
    return null;
  }
  if (fromHost && m.t === 'state' && typeof m.s === 'object' && m.s !== null) {
    const s = m.s as Record<string, unknown>;
    const phase = s.phase === 'lobby' || s.phase === 'live' || s.phase === 'over' ? s.phase : 'lobby';
    return {
      t: 'state',
      s: {
        phase,
        minutes: num(s.minutes, 1, 60, 10),
        left: num(s.left, 0, 3600),
        share: num(s.share, 0, 1, 0.5),
        crowd: num(s.crowd, 0, 1, 0.5),
        names: pair(s.names, (v) => str(v, 24)),
        now: pair(s.now, (v) => str(v)),
        bpm: pair(s.bpm, (v) => num(v, 0, 300)),
        watching: pair(s.watching, (v) => Math.round(num(v, 0, 64))),
        red: typeof s.red === 'string' ? s.red : null,
        winner: isChannel(s.winner) || s.winner === 'tie' ? s.winner : null,
        history: Array.isArray(s.history) ? s.history.slice(0, 800).map((v) => num(v, 0, 1, 0.5)) : undefined,
      },
    };
  }
  return null;
}

/** you, each frame: your pull on the room, what you're playing, where you are in the beat */
export interface DiscoMine {
  pull: number;
  now: string;
  bpm: number;
  /** 0..1 through the beat */
  phase: number;
}

export interface DiscoView {
  role: DiscoRole;
  /** you're one of the two DJs */
  dj: boolean;
  /** your channel (a DJ's own, or the one a watcher's listening to) */
  ch: Channel;
  code: string | null;
  wire: DiscoWire;
  /** listening in on the other DJ's channel */
  peek: boolean;
}

export interface DiscoAudio {
  /** your mix as a stream (to send) */
  mix(): MediaStream | null;
  /** play a stream from the room; returns a handle to set its volume or stop it */
  play(stream: MediaStream): { volume(v: number): void; stop(): void };
}

export interface DiscoHooks {
  mine(dt: number): DiscoMine;
  note(text: string, tone: 'good' | 'bad' | 'hype'): void;
  /** the room's over for you (the host left, you lost the connection) */
  ended?(why: string): void;
  audio?: DiscoAudio;
}

const SEND_EVERY = 0.1;
const PULL_EVERY = 0.25;
/** a DJ who hasn't been heard for this long pulls nobody */
const QUIET = 6;

const pulse = (phase: number) => Math.pow(0.5 + 0.5 * Math.cos(phase * Math.PI * 2), 3);

export class DiscoSession {
  wire: DiscoWire;
  /** a watcher's channel (a DJ's is fixed) */
  listening: Channel = 'blue';
  peek = false;
  private game: Showdown | null = null;
  private practice: PracticeRival | null = null;
  private sendT = 0;
  private redHeard = 0;
  private t = 0;
  private beats = { blue: 0, red: 0 };
  private offs: (() => void)[] = [];
  private streams = new Map<string, { volume(v: number): void; stop(): void }>();
  private redStream: MediaStream | null = null;
  private sentTo = new Map<string, MediaStreamTrack | null>();
  private over = false;
  private flipped = false;
  /** host: the watchers' channels */
  private watchers = new Map<string, Channel>();

  private constructor(
    readonly role: DiscoRole,
    private room: Room<RoomMessage> | null,
    private hooks: DiscoHooks,
    names: Record<Channel, string>,
    minutes: number,
  ) {
    this.wire = { phase: 'lobby', minutes, left: minutes * 60, share: 0.5, crowd: 0.5, names, now: { blue: '', red: '' }, bpm: { blue: 0, red: 0 }, watching: { blue: 0, red: 0 }, red: null, winner: null };
    discoUniforms.uDisco.value = 1;
    discoUniforms.uDiscoBlue.value = 0.5;
    if (room) this.listen(room);
  }

  /** host a showdown in a room (you're blue) */
  static host(room: Room<RoomMessage>, hooks: DiscoHooks, name: string, minutes: number): DiscoSession {
    const s = new DiscoSession('host', room, hooks, { blue: name, red: '' }, minutes);
    s.shareMix();
    return s;
  }

  /** practise against a stand-in DJ on red */
  static practice(hooks: DiscoHooks, name: string, rival: string, minutes: number, skill = 0.5): DiscoSession {
    const s = new DiscoSession('practice', null, hooks, { blue: name, red: rival }, minutes);
    s.practice = new PracticeRival(skill);
    return s;
  }

  /** join a friend's showdown: as red if the DJ seat's free and you asked for it, otherwise watching */
  static guest(room: Room<RoomMessage>, hooks: DiscoHooks, asDj: boolean): DiscoSession {
    const s = new DiscoSession(asDj ? 'red' : 'watch', room, hooks, { blue: room.host.name, red: '' }, 10);
    if (!asDj) {
      s.listening = Math.random() < 0.5 ? 'blue' : 'red';
      s.flipped = true;
      s.send({ t: 'flip', ch: s.listening });
    }
    return s;
  }

  get isHost(): boolean {
    return this.role === 'host' || this.role === 'practice';
  }

  /** you're one of the two DJs (a DJ who came in once the seat was taken is watching) */
  get isDj(): boolean {
    return this.isHost || (this.role === 'red' && !!this.room && this.wire.red === this.room.me.id);
  }

  /** your channel: a DJ's own, a watcher's choice */
  get channel(): Channel {
    if (this.isHost) return 'blue';
    if (this.isDj) return 'red';
    return this.listening;
  }

  get code(): string | null {
    return this.room?.code ?? null;
  }

  /** host: someone's in the red seat (or it's practice), so it can start */
  get ready(): boolean {
    return this.role === 'practice' || !!this.wire.red;
  }

  view(): DiscoView {
    return { role: this.role, dj: this.isDj, ch: this.channel, code: this.code, wire: this.wire, peek: this.peek };
  }

  /** host: the lights go down, the clock starts */
  start(): boolean {
    if (!this.isHost || this.wire.phase !== 'lobby' || !this.ready) return false;
    this.game = new Showdown(this.wire.minutes);
    for (const [id, ch] of this.watchers) this.game.flip(id, ch);
    this.wire.phase = 'live';
    this.hooks.note('Silent disco: the room’s split down the middle. Pull them over!', 'hype');
    this.broadcast();
    return true;
  }

  /** host: run it back with the same people */
  rematch(): void {
    if (!this.isHost || this.wire.phase !== 'over') return;
    const w = this.wire;
    w.phase = 'lobby';
    w.winner = null;
    w.left = w.minutes * 60;
    w.share = w.crowd = 0.5;
    delete w.history;
    this.game = null;
    if (this.practice) this.practice = new PracticeRival(this.practice.skill);
    this.start();
  }

  /** a watcher flips channel */
  flip(ch: Channel): void {
    if (this.isDj || ch === this.listening) return;
    this.listening = ch;
    this.flipped = true;
    this.send({ t: 'flip', ch });
  }

  /** a DJ listens in on the other channel (or stops) */
  setPeek(on: boolean): void {
    this.peek = on;
    this.mixLevels();
  }

  update(dt: number): void {
    this.t += dt;
    const mine = this.hooks.mine(dt);
    const ch = this.channel;
    // each channel's beat: yours from the beat clock, the other from its tempo
    for (const c of CHANNELS) {
      if (c === ch && this.isDj) this.beats[c] = mine.phase;
      else this.beats[c] = (this.beats[c] + (dt * (this.wire.bpm[c] || 0)) / 60) % 1;
    }
    discoUniforms.uDiscoPulse.value.set(pulse(this.beats.blue), pulse(this.beats.red));
    pulseDiscoPhones();
    discoUniforms.uDiscoBlue.value += (this.wire.crowd - discoUniforms.uDiscoBlue.value) * Math.min(1, dt * 4);
    discoUniforms.uDisco.value = 1;
    if (this.isHost) this.hostUpdate(dt, mine);
    else if (this.isDj) {
      this.sendT += dt;
      if (this.sendT >= PULL_EVERY) {
        this.sendT = 0;
        this.send({ t: 'pull', v: mine.pull, now: mine.now, bpm: mine.bpm });
      }
    }
  }

  private hostUpdate(dt: number, mine: DiscoMine): void {
    const w = this.wire;
    w.now.blue = mine.now;
    w.bpm.blue = mine.bpm;
    if (this.practice) {
      w.now.red = 'Practice set';
      w.bpm.red = mine.bpm || 124;
    }
    const g = this.game;
    if (g) {
      g.setPull('blue', mine.pull);
      if (this.practice) g.setPull('red', this.practice.update(dt));
      else if (this.t - this.redHeard > QUIET) g.setPull('red', 0);
      for (const n of g.update(dt)) this.said(n);
      w.left = g.remaining;
      w.crowd = g.crowd;
      w.share = g.share;
      w.watching = g.watching;
      if (g.phase === 'over' && w.phase !== 'over') {
        w.phase = 'over';
        w.winner = winnerOf(g.share);
        w.history = g.history.slice();
        this.broadcast();
      }
    }
    this.sendT += dt;
    if (this.sendT >= SEND_EVERY) {
      this.sendT = 0;
      this.broadcast();
    }
  }

  private said(n: ShowdownNote): void {
    const name = (c: Channel) => this.wire.names[c] || (c === 'blue' ? 'Blue' : 'Red');
    if (n.kind === 'lead') this.hooks.note(`${name(n.to)} has the room`, 'hype');
    if (n.kind === 'swing') this.hooks.note(`The room’s drifting to ${name(n.to)}`, 'good');
    if (n.kind === 'final') this.hooks.note('One minute left!', 'hype');
    if (this.isHost && n.kind !== 'over') this.send({ t: 'note', n });
  }

  private send(m: DiscoMsg): void {
    this.room?.send(m);
  }

  private broadcast(): void {
    if (!this.room) return;
    const s = { ...this.wire };
    if (s.phase !== 'over') delete s.history;
    this.send({ t: 'state', s });
  }

  private listen(room: Room<RoomMessage>): void {
    this.offs.push(
      room.on('message', ({ m, from }) => this.onMessage(m, from)),
      room.on('players', (ps) => this.onPlayers(ps)),
      room.on('audio', ({ stream, from }) => this.onAudio(stream, from)),
      room.on('close', (why) => {
        if (this.over) return;
        this.hooks.ended?.(why === 'host-left' ? 'The host ended the showdown.' : why === 'kicked' ? 'The host sent you out of the room.' : why === 'lost' ? 'Lost the connection to the room.' : 'You left the showdown.');
      }),
    );
  }

  private onMessage(raw: RoomMessage, from: Player): void {
    const m = readDisco(raw, from.host);
    if (!m) return;
    if (m.t === 'note') {
      if (!this.isHost) this.said(m.n);
      return;
    }
    if (this.isHost) {
      if (m.t === 'pull' && from.id === this.wire.red) {
        this.redHeard = this.t;
        this.game?.setPull('red', m.v);
        this.wire.now.red = m.now;
        this.wire.bpm.red = m.bpm;
      }
      if (m.t === 'flip' && from.id !== this.wire.red) {
        this.game?.flip(from.id, m.ch);
        this.watchers.set(from.id, m.ch);
        this.routeAudio();
      }
      return;
    }
    if (m.t === 'state') {
      const was = this.wire.phase;
      const hadRed = this.wire.red;
      this.wire = m.s;
      if (was === 'lobby' && m.s.phase === 'live') this.hooks.note('Silent disco: the room’s split down the middle.' + (this.channel === 'red' ? ' Pull them over!' : ''), 'hype');
      if (this.role === 'red' && m.s.red !== hadRed && this.room && m.s.red === this.room.me.id) {
        this.hooks.note('You’re on the red channel.', 'good');
        this.shareMix();
        this.mixLevels();
      }
      // came in as a DJ with the seat taken: watching, so the host needs your channel
      if (this.role === 'red' && m.s.red && !this.isDj && !this.flipped) {
        this.flipped = true;
        this.send({ t: 'flip', ch: this.listening });
        this.mixLevels();
      }
    }
  }

  /** host: who's who */
  private onPlayers(ps: Player[]): void {
    if (!this.isHost || !this.room) return;
    const here = new Set(ps.map((p) => p.id));
    for (const id of [...this.watchers.keys()]) {
      if (!here.has(id)) {
        this.watchers.delete(id);
        this.game?.leave(id);
      }
    }
    for (const id of [...this.sentTo.keys()]) if (!here.has(id)) this.sentTo.delete(id);
    if (this.wire.red && !here.has(this.wire.red)) {
      this.hooks.note(`${this.wire.names.red || 'Red'} left the showdown`, 'bad');
      this.wire.red = null;
      this.redStream = null;
      this.game?.setPull('red', 0);
    }
    // the first DJ in takes the red seat (only before it starts)
    if (!this.wire.red && this.wire.phase === 'lobby') {
      const dj = ps.find((p) => !p.host && (p.info as DiscoInfo | undefined)?.role === 'dj');
      if (dj) {
        this.wire.red = dj.id;
        this.wire.names.red = dj.name;
        this.redHeard = this.t;
        this.watchers.delete(dj.id);
        this.hooks.note(`${dj.name} is on red`, 'good');
      }
    }
    this.routeAudio();
    this.broadcast();
  }

  private onAudio(stream: MediaStream | null, from: Player): void {
    if (this.isHost) {
      if (from.id === this.wire.red) {
        this.redStream = stream;
        this.streamFrom(from.id, stream);
        this.routeAudio();
      }
      return;
    }
    // a guest only hears the host: a watcher their channel, red the blue mix (to listen in)
    this.streamFrom(from.id, stream);
  }

  private streamFrom(id: string, stream: MediaStream | null): void {
    this.streams.get(id)?.stop();
    this.streams.delete(id);
    const a = this.hooks.audio;
    if (stream && a) this.streams.set(id, a.play(stream));
    this.mixLevels();
  }

  /** what's audible: a watcher hears their channel; a DJ hears the other only while listening in */
  private mixLevels(): void {
    const v = !this.isDj ? 1 : this.peek ? 0.85 : 0;
    for (const s of this.streams.values()) s.volume(v);
  }

  private shareMix(): void {
    const mix = this.hooks.audio?.mix();
    if (!mix || !this.room) return;
    if (this.role === 'red') void this.room.shareAudio(mix);
    else this.routeAudio();
  }

  /** host: each guest gets the channel they're on (red gets blue, to listen in) */
  private routeAudio(): void {
    const room = this.room;
    const mix = this.hooks.audio?.mix()?.getAudioTracks()[0] ?? null;
    if (!room || this.role !== 'host' || !mix) return;
    const red = this.redStream?.getAudioTracks()[0] ?? null;
    for (const p of room.players()) {
      if (p.host) continue;
      const want = p.id === this.wire.red ? mix : this.watchers.get(p.id) === 'red' ? red : mix;
      if (this.sentTo.get(p.id) === want) continue;
      this.sentTo.set(p.id, want);
      void room.shareAudio(want, p.id);
    }
  }

  /** the showdown's over (or you're leaving): the headphones come off */
  leave(): void {
    if (this.over) return;
    this.over = true;
    for (const off of this.offs) off();
    for (const s of this.streams.values()) s.stop();
    this.streams.clear();
    this.room?.leave();
    discoUniforms.uDisco.value = 0;
  }
}
