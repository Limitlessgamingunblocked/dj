/*
 * How the MC reaches the booth. The hype man works the same whether the mic
 * is plugged into this computer or a friend is on theirs somewhere else: the
 * booth (HypeMan) and the MC's screen (McCard) only talk through a MicLink.
 *
 * - localMicLink: the mic on this computer, and the MC card on this screen.
 * - hostMicRoom / joinAsMc: a friend online, over the game's rooms (src/net):
 *   the booth hosts a 'hype' room, the friend joins with its code (or the
 *   ?mc= link), sends their mic and hears the booth's mix back.
 */
import { CALLS, type CallId } from '../../game/hypeman';
import { hostRoom, joinRoom, normalizeRoomCode, playStream, type RoomMessage } from '../../net';
import type { VoiceFx } from './voice';

/** what the booth tells the MC's screen, a few times a second */
export type McState = {
  t: 'state';
  /** the line being sung now, and the next one */
  line: string | null;
  next: string | null;
  /** a nudge for the MC: "Build coming: hype them up", "Vocal's in: let it breathe" */
  hint: string;
  section: string;
  bpm: number;
  /** 0..3 the beat in the bar, for the MC's beat dots */
  beatInBar: number;
  vibe: number;
  armed: CallId | null;
  /** seconds left on the armed call */
  armedLeft: number;
  /** the MC's voice is getting through, 0..1 */
  level: number;
  talking: boolean;
  points: number;
  calls: number;
  fx: VoiceFx;
  djName: string;
  /** the last thing the room did ("The room roars back +120") */
  last: string;
};

/** what the MC's screen sends the booth */
export type McAction = { t: 'call'; call: CallId } | { t: 'fx'; fx: Partial<VoiceFx> } | { t: 'hello'; name: string } | { t: 'bye' };

export interface MicLink {
  readonly kind: 'local' | 'remote';
  /** the MC's name, once known */
  readonly name: string;
  /** the MC's voice (a remote one arrives later: listen with onVoice) */
  onVoice(fn: (stream: MediaStream, remote: boolean) => void): void;
  /** the booth's state to the MC's screen */
  send(state: McState): void;
  /** the MC's pads and switches */
  onAction(fn: (a: McAction) => void): void;
  /** the mix for a remote MC's headphones (no-op locally) */
  sendMix?(stream: MediaStream): void;
  close(): void;
}

/**
 * The mic on this computer, and the MC card on this stage. `screen` is the
 * card: it gets the state and sends its pads back through `act`.
 */
export function localMicLink(screen: { show(s: McState): void; onAct(fn: (a: McAction) => void): void }): MicLink & { open(): Promise<string | null> } {
  let voiceFn: ((s: MediaStream, remote: boolean) => void) | null = null;
  let stream: MediaStream | null = null;
  return {
    kind: 'local',
    name: 'You',
    async open(): Promise<string | null> {
      if (!navigator.mediaDevices?.getUserMedia) return 'This browser can’t use a microphone.';
      try {
        // echo cancellation keeps the speakers out of the mic (headphones are still best)
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
      } catch {
        return 'The microphone was blocked. Allow it in the browser’s site settings and try again.';
      }
      voiceFn?.(stream, false);
      return null;
    },
    onVoice(fn) {
      voiceFn = fn;
      if (stream) fn(stream, false);
    },
    send(s) {
      screen.show(s);
    },
    onAction(fn) {
      screen.onAct(fn);
    },
    close() {
      for (const t of stream?.getTracks() ?? []) t.stop();
      stream = null;
    },
  };
}

const MAX_NAME = 24;

function isAction(x: unknown): x is McAction {
  if (!x || typeof x !== 'object') return false;
  const a = x as Record<string, unknown>;
  if (a.t === 'call') return CALLS.some((c) => c.id === a.call);
  if (a.t === 'fx') return !!a.fx && typeof a.fx === 'object';
  if (a.t === 'hello') return typeof a.name === 'string';
  return a.t === 'bye';
}

function isState(x: unknown): x is McState {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  return s.t === 'state' && typeof s.hint === 'string' && typeof s.level === 'number' && !!s.fx && typeof s.fx === 'object';
}

/** only the switches an MC may flip, as booleans */
function cleanFx(fx: Partial<VoiceFx>): Partial<VoiceFx> {
  const out: Partial<VoiceFx> = {};
  if (typeof fx.echo === 'boolean') out.echo = fx.echo;
  if (typeof fx.radio === 'boolean') out.radio = fx.radio;
  return out;
}

/** the booth's side of a hype man room: hosts it, and the friend who joins is the MC */
export async function hostMicRoom(djName: string, transport?: 'online' | 'memory'): Promise<MicLink & { code: string }> {
  const room = await hostRoom({ mode: 'hype', name: djName, maxPlayers: 2, transport });
  let name = 'Your MC';
  let mc: string | null = null;
  const actionFns: ((a: McAction) => void)[] = [];
  let voiceFn: ((s: MediaStream, remote: boolean) => void) | null = null;
  let voice: MediaStream | null = null;
  const tell = (a: McAction) => {
    for (const fn of actionFns) fn(a);
  };
  room.on('join', (p) => {
    mc = p.id;
    name = p.name.slice(0, MAX_NAME) || name;
    // one MC at a time
    room.lock(true);
    tell({ t: 'hello', name });
  });
  room.on('leave', (p) => {
    if (p.id !== mc) return;
    mc = null;
    voice = null;
    room.lock(false);
    tell({ t: 'bye' });
  });
  room.on('message', ({ m, from }) => {
    if (from.id !== mc || !isAction(m) || m.t === 'hello') return;
    tell(m.t === 'fx' ? { t: 'fx', fx: cleanFx(m.fx) } : m);
  });
  room.on('audio', ({ stream, from }) => {
    if (from.id !== mc || !stream) return;
    voice = stream;
    voiceFn?.(stream, true);
  });
  return {
    kind: 'remote',
    code: room.code,
    get name() {
      return name;
    },
    onVoice(fn) {
      voiceFn = fn;
      if (voice) fn(voice, true);
    },
    send(s) {
      if (mc) room.send(s as unknown as RoomMessage, mc);
    },
    onAction(fn) {
      actionFns.push(fn);
    },
    sendMix(stream) {
      void room.shareAudio(stream);
    },
    close() {
      room.leave();
    },
  };
}

/** a link a friend opens to join as the MC */
export function mcLink(code: string, base = location.href): string {
  const u = new URL(base);
  u.hash = '';
  u.search = '';
  u.searchParams.set('mc', code);
  return u.toString();
}

/** the room code in a link opened to join as the MC, if any */
export function mcFromUrl(href = location.href): string | null {
  try {
    return normalizeRoomCode(new URL(href).searchParams.get('mc') ?? '');
  } catch {
    return null;
  }
}

export interface McScreen {
  show(s: McState): void;
  onAct(fn: (a: McAction) => void): void;
  error(text: string | null): void;
}

/**
 * The MC's side: join the booth's room, send it your mic, hear its mix, and
 * drive the card. Resolves to a way to leave, or throws JoinError / a mic error.
 */
export async function joinAsMc(code: string, name: string, screen: McScreen, mic?: MediaStream, transport?: 'online' | 'memory'): Promise<{ leave(): void }> {
  const stream = mic ?? (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } }));
  const room = await joinRoom(code, { mode: 'hype', name, transport });
  let mix: HTMLAudioElement | null = null;
  let left = false;
  room.on('message', ({ m }) => {
    if (isState(m)) screen.show(m);
  });
  room.on('audio', ({ stream: s }) => {
    if (mix) {
      mix.pause();
      mix.srcObject = null;
      mix = null;
    }
    if (s) mix = playStream(s);
  });
  room.on('close', (why) => !left && screen.error(why === 'host-left' ? 'The DJ ended the set.' : why === 'kicked' ? 'The DJ took you off the mic.' : why === 'lost' ? 'Lost the connection to the booth.' : 'You left.'));
  screen.onAct((a) => room.send(a as unknown as RoomMessage));
  await room.shareAudio(stream);
  return {
    leave() {
      left = true;
      room.leave();
      if (!mic) for (const t of stream.getTracks()) t.stop();
      if (mix) {
        mix.pause();
        mix.srcObject = null;
      }
    },
  };
}
