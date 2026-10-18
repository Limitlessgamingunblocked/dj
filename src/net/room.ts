/*
 * Rooms: play with friends anywhere, by room code. The shared layer the
 * online modes (Join the crowd, Silent disco, Pass the aux, Hype man) sit on.
 *
 *   const room = await hostRoom({ mode: 'crowd', name: 'DJ KAI' });
 *   room.code                          // 'K7QMP': read it out, or share roomLink(room.code)
 *   const room = await joinRoom('K7QMP', { mode: 'crowd', name: 'Sam', info: look });
 *
 * The host is a star's centre and the authority: guests talk to the host,
 * the host talks to everyone or to one guest. Guests don't see each other's
 * messages unless the host passes them on (host-authoritative, like the VJ
 * link: the deck stays in charge). The roster (who's in, their name and
 * `info`) is kept in step for everyone by the room itself.
 *
 * Messages are small JSON objects with a string `t` (the VJ link's
 * convention), at most 64 KB. They arrive in order. Anything else is dropped,
 * and each mode should still check what it receives: it came off the network.
 *
 * Audio: one route each way between the host and each guest. The host can
 * send its mix to every guest (and to anyone who joins later), a guest can
 * send their mic to the host. See playStream() for hearing it.
 *
 * Clock: hostNow() is the host's performance.now(), estimated on guests from
 * pings (the lowest round trip of the last few wins), for lining things up
 * with the host's beat clock.
 */
import { Emitter } from '../core/emitter';
import { newRoomCode, normalizeRoomCode, roomPeerId } from './codes';
import { DialError, memoryNet, memoryNetTaken, rtcNet, type Link, type Net } from './link';
import { DEFAULT_ICE, PEERJS_CLOUD, Signal, SignalError, type SignalServer } from './signal';

/** bumped when the wire format changes in a way old builds can't follow */
export const ROOM_PROTOCOL = 1;

export interface Player {
  /** stable for the session: the device's id on the network */
  id: string;
  name: string;
  host: boolean;
  /** whatever this player shares about themselves (a look, a colour…), set by the mode */
  info?: unknown;
}

export interface RoomMessage {
  t: string;
  [k: string]: unknown;
}

export type CloseReason = 'left' | 'host-left' | 'kicked' | 'lost';
export type JoinFailure = 'bad-code' | 'not-found' | 'full' | 'wrong-mode' | 'locked' | 'old-version' | 'timeout' | 'offline' | 'failed';

export class JoinError extends Error {
  constructor(readonly reason: JoinFailure) {
    super(reason);
  }
}

/** what to tell the player when a join fails */
export const JOIN_FAILURE_TEXT: Record<JoinFailure, string> = {
  'bad-code': 'Room codes are five letters and numbers.',
  'not-found': "There's no room with that code. Check it, or ask your friend for a new one.",
  full: 'That room is full.',
  'wrong-mode': "That room is playing a different mode.",
  locked: "That room isn't letting anyone else in.",
  'old-version': 'You and the host are on different versions of the game. Update and try again.',
  timeout: "The room didn't answer. One of you may be on a network that blocks it.",
  offline: "Couldn't reach the room service. Check your internet connection.",
  failed: "Couldn't connect to the room.",
};

export interface RoomOptions {
  /** which mode this room plays ('crowd', 'disco', 'aux', 'hype'…); a guest must ask for the same one */
  mode: string;
  /** your display name (trimmed to 24 characters) */
  name: string;
  info?: unknown;
  /** host only: the most players, the host included (default 8, at most 32) */
  maxPlayers?: number;
  /** 'online' (default) goes through the broker; 'memory' links rooms in the same page (tests, side-by-side tryouts) */
  transport?: 'online' | 'memory';
  server?: SignalServer;
  iceServers?: RTCIceServer[];
}

type RoomEvents<M> = {
  /** a message from someone (guests only ever hear the host) */
  message: { m: M; from: Player };
  /** the roster changed */
  players: Player[];
  join: Player;
  leave: Player;
  /** the room is over for you */
  close: CloseReason;
  /** someone started (stream) or stopped (null) sending you audio */
  audio: { stream: MediaStream | null; from: Player };
  /** host: the broker dropped (false; no new joins until it's back) or came back (true) */
  broker: boolean;
};

/* the wire: room business ('k') or a mode's message ('m') */
type Sys =
  | { k: 'hello'; v: number; mode: string; name: string; info?: unknown }
  | { k: 'welcome'; you: Player; players: Player[]; code: string }
  | { k: 'deny'; why: JoinFailure }
  | { k: 'players'; players: Player[] }
  | { k: 'ping'; t: number; r: number }
  | { k: 'pong'; t: number; h: number }
  | { k: 'audio'; on: boolean }
  | { k: 'info'; info: unknown }
  | { k: 'bye'; why: CloseReason };

type Wire<M> = Sys | { m: M };

const HELLO_MS = 10000;
const SILENT_MS = 15000;
const MAX_NAME = 24;
const MAX_PLAYERS = 32;

export function cleanName(s: unknown): string {
  const n = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME);
  return n || 'Guest';
}

export function isRoomMessage(x: unknown): x is RoomMessage {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && typeof (x as { t?: unknown }).t === 'string';
}

function parse<M>(text: string): Wire<M> | null {
  try {
    const w = JSON.parse(text) as unknown;
    if (typeof w !== 'object' || w === null) return null;
    if ('m' in w) return isRoomMessage((w as { m: unknown }).m) ? (w as Wire<M>) : null;
    return typeof (w as { k?: unknown }).k === 'string' ? (w as Wire<M>) : null;
  } catch {
    return null;
  }
}

const now = () => performance.now();

interface Member {
  player: Player;
  link: Link;
  heard: number;
  rtt: number;
}

export class Room<M extends RoomMessage = RoomMessage> extends Emitter<RoomEvents<M>> {
  /** host: everyone else; guest: just the host */
  private members = new Map<string, Member>();
  private roster: Player[] = [];
  private sharedAll: MediaStreamTrack | null = null;
  private locked = false;
  private closed = false;
  private offset = 0;
  private samples: { rtt: number; offset: number }[] = [];
  private timers: number[] = [];
  private ticks = 0;

  /** @internal use hostRoom() / joinRoom() */
  constructor(
    readonly code: string,
    readonly mode: string,
    readonly isHost: boolean,
    public me: Player,
    private net: Net,
    private maxPlayers: number,
  ) {
    super();
    this.roster = [me];
    this.timers.push(setInterval(() => this.tick(), 1000) as unknown as number);
    net.onBroker((down) => this.emit('broker', !down));
  }

  /** everyone in the room, the host first */
  players(): Player[] {
    return this.roster.slice();
  }

  player(id: string): Player | undefined {
    return this.roster.find((p) => p.id === id);
  }

  get host(): Player {
    return this.roster.find((p) => p.host) ?? this.me;
  }

  get open(): boolean {
    return !this.closed;
  }

  /**
   * Host: to everyone, or to one or some guests by id. Guest: to the host
   * (`to` is ignored). False if it couldn't go (too big, or nobody to send to).
   */
  send(m: M, to?: string | string[]): boolean {
    if (this.closed || !isRoomMessage(m)) return false;
    const text = JSON.stringify({ m } satisfies Wire<M>);
    const ids = !this.isHost || to === undefined ? [...this.members.keys()] : Array.isArray(to) ? to : [to];
    let sent = false;
    for (const id of ids) sent = this.raw(id, text) || sent;
    return sent;
  }

  /**
   * Send audio (a MediaStream's first audio track, or a track; null stops).
   * Host: to every guest, now and as they join, or to one guest with `to`.
   * Guest: to the host.
   */
  async shareAudio(source: MediaStream | MediaStreamTrack | null, to?: string): Promise<void> {
    const track = source === null ? null : 'kind' in source ? source : (source.getAudioTracks()[0] ?? null);
    if (this.isHost && to === undefined) this.sharedAll = track;
    const ids = this.isHost && to !== undefined ? [to] : [...this.members.keys()];
    await Promise.all(ids.map((id) => this.audioTo(id, track)));
  }

  private async audioTo(id: string, track: MediaStreamTrack | null): Promise<void> {
    const mem = this.members.get(id);
    if (!mem) return;
    await mem.link.sendAudio(track);
    this.sys(id, { k: 'audio', on: !!track });
  }

  /** the host's performance.now(), here */
  hostNow(): number {
    return now() + (this.isHost ? 0 : this.offset);
  }

  /** round trip to the host (guest), or to a guest (host), in ms; 0 until measured */
  rtt(id?: string): number {
    const mem = id ? this.members.get(id) : this.isHost ? undefined : [...this.members.values()][0];
    return mem?.rtt ?? 0;
  }

  /** change what you share about yourself; everyone's roster updates */
  setInfo(info: unknown): void {
    this.me = { ...this.me, info };
    if (this.isHost) this.replaceInRoster(this.me);
    else for (const id of this.members.keys()) this.sys(id, { k: 'info', info });
  }

  /** host: stop new players joining (or let them in again) */
  lock(on = true): void {
    this.locked = on;
  }

  /** host: send a guest away */
  kick(id: string): void {
    if (!this.isHost) return;
    this.sys(id, { k: 'bye', why: 'kicked' });
    setTimeout(() => this.drop(id), 200);
  }

  leave(): void {
    if (this.closed) return;
    for (const id of this.members.keys()) this.sys(id, { k: 'bye', why: this.isHost ? 'host-left' : 'left' });
    // let the goodbyes go before the links close
    setTimeout(() => this.shut('left'), 150);
  }

  /* ---------------- inside ---------------- */

  private raw(id: string, text: string): boolean {
    return this.members.get(id)?.link.send(text) ?? false;
  }

  private sys(id: string, s: Sys): boolean {
    return this.raw(id, JSON.stringify(s));
  }

  private shut(why: CloseReason): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    for (const m of this.members.values()) m.link.close();
    this.members.clear();
    this.net.close();
    this.emit('close', why);
  }

  private tick(): void {
    const t = now();
    for (const [id, mem] of this.members) {
      if (t - mem.heard > SILENT_MS) {
        if (this.isHost) this.drop(id);
        else this.shut('lost');
        return;
      }
    }
    // guests ping the host: every second for the first few, then every 4 s
    if (!this.isHost && (this.samples.length < 6 || ++this.ticks % 4 === 0)) {
      for (const id of this.members.keys()) this.sys(id, { k: 'ping', t, r: this.rtt() });
    }
  }

  private replaceInRoster(p: Player): void {
    this.roster = this.roster.map((x) => (x.id === p.id ? p : x));
    this.broadcastRoster();
  }

  private broadcastRoster(): void {
    for (const id of this.members.keys()) this.sys(id, { k: 'players', players: this.roster });
    this.emit('players', this.players());
  }

  /** host: a guest has gone */
  private drop(id: string): void {
    const mem = this.members.get(id);
    if (!mem) return;
    this.members.delete(id);
    mem.link.close();
    this.roster = this.roster.filter((p) => p.id !== id);
    this.emit('leave', mem.player);
    this.broadcastRoster();
  }

  /** host: someone has dialled in; they get HELLO_MS to say hello */
  admit(link: Link): void {
    let settled = false;
    const deny = (why: JoinFailure) => {
      settled = true;
      link.send(JSON.stringify({ k: 'deny', why } satisfies Sys));
      setTimeout(() => link.close(), 300);
    };
    const timer = setTimeout(() => !settled && ((settled = true), link.close()), HELLO_MS);
    link.onData((text) => {
      if (settled) return;
      const w = parse<M>(text);
      if (!w || !('k' in w) || w.k !== 'hello') return;
      clearTimeout(timer);
      if (this.closed) return deny('not-found');
      if (w.v !== ROOM_PROTOCOL) return deny('old-version');
      if (w.mode !== this.mode) return deny('wrong-mode');
      if (this.locked) return deny('locked');
      if (this.roster.length >= this.maxPlayers) return deny('full');
      settled = true;
      const player: Player = { id: link.peer, name: cleanName(w.name), host: false, info: w.info };
      this.members.get(player.id)?.link.close();
      this.members.set(player.id, { player, link, heard: now(), rtt: 0 });
      this.roster = [...this.roster.filter((p) => p.id !== player.id), player];
      this.listen(player.id, link);
      link.onClose(() => this.members.get(player.id)?.link === link && this.drop(player.id));
      this.sys(player.id, { k: 'welcome', you: player, players: this.roster, code: this.code });
      this.emit('join', player);
      this.broadcastRoster();
      if (this.sharedAll) void this.audioTo(player.id, this.sharedAll);
    });
  }

  /** guest: in, with the host on the end of `link` */
  attach(host: Player, link: Link, players: Player[]): void {
    this.roster = players;
    this.members.set(host.id, { player: host, link, heard: now(), rtt: 0 });
    this.listen(host.id, link);
    link.onClose(() => this.shut('lost'));
  }

  private listen(id: string, link: Link): void {
    link.onData((text) => {
      const mem = this.members.get(id);
      if (!mem || mem.link !== link) return;
      mem.heard = now();
      const w = parse<M>(text);
      if (!w) return;
      if ('m' in w) {
        this.emit('message', { m: w.m, from: mem.player });
        return;
      }
      this.onSys(mem, w);
    });
  }

  private onSys(mem: Member, s: Sys): void {
    const from = mem.player;
    switch (s.k) {
      case 'ping':
        if (this.isHost && typeof s.t === 'number') {
          mem.rtt = typeof s.r === 'number' && s.r >= 0 ? s.r : mem.rtt;
          this.sys(from.id, { k: 'pong', t: s.t, h: now() });
        }
        return;
      case 'pong': {
        if (this.isHost || typeof s.t !== 'number' || typeof s.h !== 'number') return;
        const t = now();
        const rtt = t - s.t;
        if (rtt < 0 || rtt > 10000) return;
        this.samples.push({ rtt, offset: s.h + rtt / 2 - t });
        if (this.samples.length > 8) this.samples.shift();
        const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.offset = best.offset;
        mem.rtt = rtt;
        return;
      }
      case 'audio':
        this.emit('audio', { stream: s.on ? mem.link.remoteAudio : null, from });
        return;
      case 'info':
        if (!this.isHost) return;
        mem.player = { ...mem.player, info: s.info };
        this.replaceInRoster(mem.player);
        return;
      case 'players':
        if (this.isHost || !Array.isArray(s.players)) return;
        this.roster = s.players.filter((p): p is Player => typeof p?.id === 'string');
        this.me = this.roster.find((p) => p.id === this.me.id) ?? this.me;
        this.emit('players', this.players());
        return;
      case 'bye':
        if (this.isHost) this.drop(from.id);
        else this.shut(s.why === 'kicked' ? 'kicked' : 'host-left');
        return;
    }
  }
}

/* ---------------- getting in ---------------- */

let memoryGuests = 0;

async function openNet(id: string, opts: RoomOptions): Promise<Net> {
  if (opts.transport === 'memory') {
    if (memoryNetTaken(id)) throw new SignalError('taken', 'taken');
    return memoryNet(id);
  }
  const signal = await Signal.open(id, opts.server ?? PEERJS_CLOUD);
  return rtcNet(signal, opts.iceServers ?? DEFAULT_ICE);
}

/** open a room and wait for friends; rejects with JoinError('offline') if the room service can't be reached */
export async function hostRoom<M extends RoomMessage = RoomMessage>(opts: RoomOptions): Promise<Room<M>> {
  for (let tries = 0; tries < 6; tries++) {
    const code = newRoomCode();
    let net: Net;
    try {
      net = await openNet(roomPeerId(code), opts);
    } catch (e) {
      if (e instanceof SignalError && e.kind === 'taken') continue;
      throw new JoinError('offline');
    }
    const me: Player = { id: net.id, name: cleanName(opts.name), host: true, info: opts.info };
    const room = new Room<M>(code, opts.mode, true, me, net, Math.max(2, Math.min(MAX_PLAYERS, opts.maxPlayers ?? 8)));
    net.onLink((link) => room.admit(link));
    return room;
  }
  throw new JoinError('failed');
}

/** join a friend's room by its code */
export async function joinRoom<M extends RoomMessage = RoomMessage>(code: string, opts: RoomOptions): Promise<Room<M>> {
  const c = normalizeRoomCode(code);
  if (!c) throw new JoinError('bad-code');
  const myId = opts.transport === 'memory' ? `guest-${++memoryGuests}` : `deckhouse-p-${Math.random().toString(36).slice(2, 12)}`;
  let net: Net;
  try {
    net = await openNet(myId, opts);
  } catch {
    throw new JoinError('offline');
  }
  let link: Link;
  try {
    link = await net.dial(roomPeerId(c));
  } catch (e) {
    net.close();
    throw new JoinError(e instanceof DialError ? (e.kind === 'not-found' ? 'not-found' : e.kind === 'timeout' ? 'timeout' : 'failed') : 'failed');
  }
  const reply = await new Promise<Sys | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), HELLO_MS);
    link.onData((text) => {
      const w = parse<M>(text);
      if (w && 'k' in w && (w.k === 'welcome' || w.k === 'deny')) {
        clearTimeout(timer);
        resolve(w);
      }
    });
    link.onClose(() => {
      clearTimeout(timer);
      resolve(null);
    });
    link.send(JSON.stringify({ k: 'hello', v: ROOM_PROTOCOL, mode: opts.mode, name: cleanName(opts.name), info: opts.info } satisfies Sys));
  });
  if (!reply || reply.k !== 'welcome') {
    link.close();
    net.close();
    throw new JoinError(reply?.k === 'deny' ? reply.why : 'timeout');
  }
  const players = reply.players.filter((p): p is Player => typeof p?.id === 'string');
  const host = players.find((p) => p.host) ?? { id: link.peer, name: 'Host', host: true };
  const room = new Room<M>(c, opts.mode, false, reply.you, net, MAX_PLAYERS);
  room.attach(host, link, players);
  return room;
}

/**
 * Hear audio from the room. Chrome only plays a WebRTC stream that's on a
 * media element (a Web Audio source alone stays silent), so this puts it on
 * one. Returns the element; `el.pause()` and `el.srcObject = null` to stop.
 */
export function playStream(stream: MediaStream, volume = 1): HTMLAudioElement {
  const el = new Audio();
  el.autoplay = true;
  el.srcObject = stream;
  el.volume = volume;
  void el.play().catch(() => {
    /* needs a tap first; the caller's join button is one */
  });
  return el;
}
