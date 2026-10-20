/*
 * Pass the aux on everyone's phones, over the online rooms (src/net). The
 * laptop with the decks hosts the room; each player can join from their own
 * phone (the room's link, or Deckhouse#aux and the code) and follow the
 * night there: whose turn it is, the clock, the track they're mixing into,
 * "I'm ready" when it's theirs, and a secret vote at the end. A friend who
 * isn't in the room can listen to the mix on their phone.
 *
 *   phone → host:  hello (send me the state), ready, vote, listen (the mix on or off)
 *   host → phones: state (everything a phone shows)
 *
 * Everything that comes off the network is checked here before the game
 * sees it.
 */
import { hostRoom, joinRoom, JoinError, JOIN_FAILURE_TEXT, roomLink, type Room } from '../net';

export interface AuxPublicPlayer {
  id: string;
  name: string;
  color: string;
  device: boolean;
  total: number;
  votes: number;
}

export interface AuxPublicTrack {
  title: string;
  artist: string;
  bpm: number;
  key: string | null;
}

export type AuxPhase = 'lobby' | 'handoff' | 'mixing' | 'scored' | 'voting' | 'awards';

/** everything a phone shows (the host sends it on every change, and once a second) */
export interface AuxPublic {
  phase: AuxPhase;
  round: number;
  rounds: number;
  turnSecs: number;
  /** seconds left on the clock (null: it isn't running) */
  timeLeft: number | null;
  players: AuxPublicPlayer[];
  /** a phone's id in the room → the player it's playing as */
  devices: Record<string, string>;
  current: string | null;
  next: string | null;
  /** the track the current player has to mix into */
  from: AuxPublicTrack | null;
  status: string;
  last: { player: string; score: number; notes: string[] } | null;
  turns: { player: string; from: string | null; to: string | null; score: number }[];
  /** the mixes each player can still vote for (turn indexes) */
  ballot: Record<string, number[]>;
  /** who has voted */
  voted: string[];
  awards: { title: string; player: string; why: string }[];
}

export type AuxGuestMsg = { t: 'hello' } | { t: 'ready' } | { t: 'vote'; turn: number } | { t: 'listen'; on: boolean };
type AuxWire = AuxGuestMsg | { t: 'state'; s: AuxPublic };

/** a phone's message, checked (it came off the network) */
export function guestMsg(x: unknown): AuxGuestMsg | null {
  if (typeof x !== 'object' || x === null) return null;
  const m = x as { t?: unknown; turn?: unknown; on?: unknown };
  if (m.t === 'hello' || m.t === 'ready') return { t: m.t };
  if (m.t === 'vote' && Number.isInteger(m.turn) && (m.turn as number) >= 0 && (m.turn as number) < 1000) return { t: 'vote', turn: m.turn as number };
  if (m.t === 'listen' && typeof m.on === 'boolean') return { t: 'listen', on: m.on };
  return null;
}

/** the host's state as a phone receives it, checked enough to draw safely */
export function publicState(x: unknown): AuxPublic | null {
  if (typeof x !== 'object' || x === null) return null;
  const s = x as Partial<AuxPublic>;
  const phases: AuxPhase[] = ['lobby', 'handoff', 'mixing', 'scored', 'voting', 'awards'];
  if (!phases.includes(s.phase as AuxPhase) || !Array.isArray(s.players) || !Array.isArray(s.turns) || typeof s.devices !== 'object' || s.devices === null) return null;
  if (!s.players.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.color === 'string')) return null;
  return {
    ...(s as AuxPublic),
    ballot: typeof s.ballot === 'object' && s.ballot ? s.ballot : {},
    voted: Array.isArray(s.voted) ? s.voted : [],
    awards: Array.isArray(s.awards) ? s.awards : [],
  };
}

/** the link a phone opens to join: the room's own link, into the Pass the aux page */
export function auxJoinUrl(code: string, base?: string): string {
  return `${roomLink(code, base)}#aux`;
}

export type AuxTransportKind = 'online' | 'memory';

/* ---------------- the laptop's side ---------------- */

export interface AuxHostLink {
  readonly code: string;
  readonly url: string;
  /** the phones in the room: their id and name */
  phones(): { id: string; name: string }[];
  onPhones(fn: () => void): () => void;
  onMessage(fn: (m: AuxGuestMsg, from: string) => void): () => void;
  /** a phone left (or dropped) */
  onLeave(fn: (id: string) => void): () => void;
  send(s: AuxPublic): void;
  /** the mix to one phone, or stop it */
  shareMix(to: string, mix: MediaStream | null): void;
  close(): void;
}

export async function openAuxHost(o: { transport?: AuxTransportKind } = {}): Promise<AuxHostLink> {
  const room: Room<AuxWire> = await hostRoom<AuxWire>({ mode: 'aux', name: 'Deckhouse', maxPlayers: 9, transport: o.transport });
  const phones = () =>
    room
      .players()
      .filter((p) => !p.host)
      .map((p) => ({ id: p.id, name: p.name }));
  return {
    code: room.code,
    url: typeof location !== 'undefined' ? auxJoinUrl(room.code) : '',
    phones,
    onPhones: (fn) => room.on('players', () => fn()),
    onMessage: (fn) =>
      room.on('message', ({ m, from }) => {
        const g = guestMsg(m);
        if (g) fn(g, from.id);
      }),
    onLeave: (fn) => room.on('leave', (p) => fn(p.id)),
    send: (s) => void room.send({ t: 'state', s }),
    shareMix: (to, mix) => void room.shareAudio(mix, to).catch(() => {}),
    close: () => room.leave(),
  };
}

/* ---------------- a phone's side ---------------- */

export interface AuxGuestLink {
  /** this phone's id in the room */
  readonly me: string;
  readonly code: string;
  onState(fn: (s: AuxPublic) => void): () => void;
  /** the room closed: what to tell the player */
  onClose(fn: (why: string) => void): () => void;
  /** the mix started (or stopped) coming in */
  onAudio(fn: (stream: MediaStream | null) => void): () => void;
  send(m: AuxGuestMsg): void;
  leave(): void;
}

const CLOSE_TEXT: Record<string, string> = {
  'host-left': 'The host closed the room.',
  kicked: 'The host took you out of the room.',
  lost: 'Lost the connection to the room.',
  left: 'You left the room.',
};

/** join a Pass the aux room; rejects with a sentence to show the player */
export async function joinAux(code: string, name: string, o: { transport?: AuxTransportKind } = {}): Promise<AuxGuestLink> {
  let room: Room<AuxWire>;
  try {
    room = await joinRoom<AuxWire>(code, { mode: 'aux', name, transport: o.transport });
  } catch (e) {
    throw new Error(e instanceof JoinError ? (e.reason === 'wrong-mode' ? 'That room is playing a different mode, not Pass the aux.' : JOIN_FAILURE_TEXT[e.reason]) : 'Couldn’t connect to the room.');
  }
  const link: AuxGuestLink = {
    me: room.me.id,
    code: room.code,
    onState: (fn) =>
      room.on('message', ({ m }) => {
        if (m.t !== 'state') return;
        const s = publicState((m as { s?: unknown }).s);
        if (s) fn(s);
      }),
    onClose: (fn) => room.on('close', (why) => fn(CLOSE_TEXT[why] ?? 'The room closed.')),
    onAudio: (fn) => room.on('audio', ({ stream }) => fn(stream)),
    send: (m) => void room.send(m),
    leave: () => room.leave(),
  };
  return link;
}
