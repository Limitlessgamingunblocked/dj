/*
 * The broker: a PeerJS signalling server, over its WebSocket protocol. It only
 * introduces two devices (passes their WebRTC offer, answer and network
 * addresses along); the game's messages and audio then go device to device.
 * The default is PeerJS's free public broker, so there's still no server of
 * our own. We speak its wire protocol directly rather than ship the peerjs
 * library: the payloads are ours (only Deckhouse talks to Deckhouse), so the
 * client is the socket, a heartbeat and a reconnect.
 *
 *   client → broker: { type: 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'HEARTBEAT', dst, payload }
 *   broker → client: OPEN (registered), ID-TAKEN, ERROR, EXPIRE (a message to
 *                    `src` couldn't be delivered: nobody has that id), and the
 *                    relayed OFFER / ANSWER / CANDIDATE with `src` set by the broker
 */
import { Emitter } from '../core/emitter';

export interface SignalServer {
  host: string;
  port: number;
  /** ends with a slash */
  path: string;
  secure: boolean;
  key: string;
}

/** PeerJS's free public broker */
export const PEERJS_CLOUD: SignalServer = { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' };

/** the network routes WebRTC tries: Google's public STUN, then PeerJS's free TURN relays for networks that block direct links */
export const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

export type RelayType = 'OFFER' | 'ANSWER' | 'CANDIDATE';

export interface Relayed {
  type: RelayType;
  src: string;
  payload: unknown;
}

type SignalEvents = {
  message: Relayed;
  /** a message to this id couldn't be delivered: nobody's registered as it */
  expire: string;
  /** the broker connection dropped and is being retried (false) or is back (true) */
  online: boolean;
};

export class SignalError extends Error {
  constructor(readonly kind: 'taken' | 'unreachable' | 'refused', msg: string) {
    super(msg);
  }
}

const HEARTBEAT_MS = 5000;
const OPEN_TIMEOUT_MS = 12000;

function randomToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function urlFor(server: SignalServer, id: string, token: string): string {
  const q = new URLSearchParams({ key: server.key, id, token, version: '1.5.5' });
  return `${server.secure ? 'wss' : 'ws'}://${server.host}:${server.port}${server.path}peerjs?${q}`;
}

export class Signal extends Emitter<SignalEvents> {
  private ws: WebSocket | null = null;
  private beat = 0;
  private retry = 0;
  private closed = false;
  private readonly token = randomToken();

  private constructor(
    readonly id: string,
    private readonly server: SignalServer,
  ) {
    super();
  }

  /** register `id` with the broker; rejects with a SignalError ('taken' if someone has the id) */
  static async open(id: string, server: SignalServer = PEERJS_CLOUD): Promise<Signal> {
    const s = new Signal(id, server);
    await s.connect();
    return s;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(urlFor(this.server, this.id, this.token));
      } catch (e) {
        reject(new SignalError('unreachable', String(e)));
        return;
      }
      let opened = false;
      const timer = setTimeout(() => {
        if (opened) return;
        ws.close();
        reject(new SignalError('unreachable', 'the broker did not answer'));
      }, OPEN_TIMEOUT_MS);
      ws.onmessage = (e) => {
        let m: { type?: string; src?: string; payload?: unknown };
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        switch (m.type) {
          case 'OPEN':
            opened = true;
            clearTimeout(timer);
            this.ws = ws;
            this.startBeat();
            resolve();
            return;
          case 'ID-TAKEN':
            clearTimeout(timer);
            reject(new SignalError('taken', 'that id is taken'));
            return;
          case 'ERROR':
            if (!opened) {
              clearTimeout(timer);
              reject(new SignalError('refused', String((m.payload as { msg?: string } | undefined)?.msg ?? 'refused')));
            }
            return;
          case 'EXPIRE':
            if (typeof m.src === 'string') this.emit('expire', m.src);
            return;
          case 'OFFER':
          case 'ANSWER':
          case 'CANDIDATE':
            if (typeof m.src === 'string') this.emit('message', { type: m.type, src: m.src, payload: m.payload });
            return;
        }
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!opened) {
          reject(new SignalError('unreachable', 'could not reach the broker'));
          return;
        }
        if (this.ws === ws) this.lost();
      };
      ws.onerror = () => {
        /* onclose follows */
      };
    });
  }

  private startBeat(): void {
    clearInterval(this.beat);
    this.beat = setInterval(() => this.raw({ type: 'HEARTBEAT' }), HEARTBEAT_MS) as unknown as number;
  }

  /** the socket dropped: keep the id (same token) and come back, 1 s, 2 s, 4 s… up to 30 s apart */
  private lost(): void {
    clearInterval(this.beat);
    this.ws = null;
    if (this.closed) return;
    this.emit('online', false);
    const wait = Math.min(30000, 1000 * 2 ** this.retry++);
    setTimeout(() => {
      if (this.closed) return;
      this.connect().then(
        () => {
          this.retry = 0;
          this.emit('online', true);
        },
        () => this.lost(),
      );
    }, wait);
  }

  get online(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private raw(m: object): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  send(type: RelayType, dst: string, payload: unknown): boolean {
    return this.raw({ type, dst, payload });
  }

  close(): void {
    this.closed = true;
    clearInterval(this.beat);
    this.ws?.close();
    this.ws = null;
  }
}
