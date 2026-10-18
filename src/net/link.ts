/*
 * Device-to-device links. A `Net` is this device on the network: it dials
 * other devices by id and hears devices dialling it. A `Link` is one open
 * connection: a reliable, ordered text channel plus one audio route each way.
 *
 * `rtcNet` is the real one: WebRTC, introduced by the broker (signal.ts),
 * trickling network addresses as they're found. Every link is opened with an
 * audio transceiver already negotiated in both directions, so sending audio
 * later (the host's mix, a guest's mic) is a `replaceTrack` with no second
 * round of offers. The Opus settings in the SDP ask for stereo at a music
 * bitrate (the default is mono speech).
 *
 * `memoryNet` connects Nets in the same page with no network at all: for
 * tests, and for trying a mode's UI with two "devices" side by side.
 */
import { DEFAULT_ICE, Signal, type Relayed } from './signal';

/** the most a single message may be, as text (a data channel's safe size) */
export const MAX_MESSAGE = 64 * 1024;

export interface Link {
  /** the other device's id */
  readonly peer: string;
  send(text: string): boolean;
  onData(fn: (text: string) => void): void;
  onClose(fn: () => void): void;
  /** send audio down this link (null stops) */
  sendAudio(track: MediaStreamTrack | null): Promise<void>;
  /** what the other device sends down its audio route (silent until it sends) */
  readonly remoteAudio: MediaStream | null;
  close(): void;
}

export interface Net {
  readonly id: string;
  /** another device dialled us */
  onLink(fn: (link: Link) => void): void;
  dial(peer: string, timeoutMs?: number): Promise<Link>;
  /** the broker connection went away (true) or came back (false); open links carry on either way */
  onBroker(fn: (online: boolean) => void): void;
  close(): void;
}

export class DialError extends Error {
  constructor(readonly kind: 'not-found' | 'timeout' | 'failed') {
    super(kind);
  }
}

/* ---------------- the real thing: WebRTC ---------------- */

interface Wire {
  /** connection id, so two dials between the same pair don't cross */
  c: string;
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
}

/** ask Opus for stereo at a music bitrate */
export function musicSdp(sdp: string): string {
  const pt = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (_, params: string) => {
    const keep = params
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p && !/^(stereo|sprop-stereo|maxaveragebitrate|cbr|usedtx)=/i.test(p));
    return `a=fmtp:${pt} ${[...keep, 'stereo=1', 'sprop-stereo=1', 'maxaveragebitrate=192000', 'usedtx=0'].join(';')}`;
  });
}

function withMusic(d: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  return { type: d.type, sdp: d.sdp ? musicSdp(d.sdp) : d.sdp };
}

class RtcLink implements Link {
  private dataFns: ((t: string) => void)[] = [];
  private closeFns: (() => void)[] = [];
  private ended = false;
  remoteAudio: MediaStream | null = null;

  constructor(
    readonly peer: string,
    private pc: RTCPeerConnection,
    private dc: RTCDataChannel,
  ) {
    dc.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE) return;
      for (const fn of this.dataFns) fn(e.data);
    };
    dc.onclose = () => this.end();
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.end();
    });
    const t = pc.getTransceivers().find((x) => x.receiver.track.kind === 'audio');
    if (t) this.remoteAudio = new MediaStream([t.receiver.track]);
  }

  send(text: string): boolean {
    if (this.dc.readyState !== 'open' || text.length > MAX_MESSAGE) return false;
    this.dc.send(text);
    return true;
  }

  onData(fn: (t: string) => void): void {
    this.dataFns.push(fn);
  }

  onClose(fn: () => void): void {
    if (this.ended) fn();
    else this.closeFns.push(fn);
  }

  async sendAudio(track: MediaStreamTrack | null): Promise<void> {
    const t = this.pc.getTransceivers().find((x) => x.receiver.track.kind === 'audio');
    if (!t) return;
    await t.sender.replaceTrack(track);
    if (!track) return;
    try {
      const p = t.sender.getParameters();
      if (p.encodings?.length) {
        p.encodings[0].maxBitrate = 192000;
        await t.sender.setParameters(p);
      }
    } catch {
      /* the SDP's bitrate still applies */
    }
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const fn of this.closeFns.splice(0)) fn();
  }

  close(): void {
    try {
      this.dc.close();
    } catch {
      /* already closed */
    }
    this.pc.close();
    this.end();
  }
}

interface Pending {
  pc: RTCPeerConnection;
  peer: string;
  /** candidates that came before the description they belong to */
  early: RTCIceCandidateInit[];
}

function makePc(ice: RTCIceServer[], signal: Signal, peer: string, c: string): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ice });
  pc.onicecandidate = (e) => {
    if (e.candidate) signal.send('CANDIDATE', peer, { c, ice: e.candidate.toJSON() } satisfies Wire);
  };
  return pc;
}

async function addIce(p: Pending, ice: RTCIceCandidateInit): Promise<void> {
  if (!p.pc.remoteDescription) {
    p.early.push(ice);
    return;
  }
  try {
    await p.pc.addIceCandidate(ice);
  } catch {
    /* a stale or unusable route */
  }
}

async function flushIce(p: Pending): Promise<void> {
  for (const ice of p.early.splice(0)) await addIce(p, ice);
}

/** this device on the network as `signal.id`, introduced by the broker */
export function rtcNet(signal: Signal, ice: RTCIceServer[] = DEFAULT_ICE): Net {
  const conns = new Map<string, Pending>();
  const linkFns: ((l: Link) => void)[] = [];
  const dials = new Map<string, { fail(e: DialError): void }>();

  signal.on('message', async (m: Relayed) => {
    const w = m.payload as Wire | undefined;
    if (!w || typeof w.c !== 'string') return;
    if (m.type === 'OFFER' && w.sdp?.type === 'offer' && !conns.has(w.c)) {
      // someone dialled us
      const pc = makePc(ice, signal, m.src, w.c);
      const p: Pending = { pc, peer: m.src, early: [] };
      conns.set(w.c, p);
      pc.ondatachannel = (e) => {
        const dc = e.channel;
        const ready = () => {
          const link = new RtcLink(m.src, pc, dc);
          link.onClose(() => conns.delete(w.c));
          for (const fn of linkFns) fn(link);
        };
        if (dc.readyState === 'open') ready();
        else dc.onopen = ready;
      };
      try {
        await pc.setRemoteDescription(w.sdp);
        for (const t of pc.getTransceivers()) if (t.receiver.track.kind === 'audio') t.direction = 'sendrecv';
        await pc.setLocalDescription(await pc.createAnswer());
        signal.send('ANSWER', m.src, { c: w.c, sdp: withMusic(pc.localDescription!.toJSON()) } satisfies Wire);
        await flushIce(p);
      } catch {
        pc.close();
        conns.delete(w.c);
      }
      // nobody opened a channel: give up on it
      setTimeout(() => {
        if (conns.get(w.c) === p && pc.connectionState !== 'connected') {
          pc.close();
          conns.delete(w.c);
        }
      }, 30000);
      return;
    }
    const p = conns.get(w.c);
    if (!p || p.peer !== m.src) return;
    if (m.type === 'ANSWER' && w.sdp?.type === 'answer' && !p.pc.remoteDescription) {
      try {
        await p.pc.setRemoteDescription(w.sdp);
        await flushIce(p);
      } catch {
        dials.get(w.c)?.fail(new DialError('failed'));
      }
    } else if (m.type === 'CANDIDATE' && w.ice) {
      await addIce(p, w.ice);
    }
  });

  signal.on('expire', (dst) => {
    for (const [c, p] of conns) if (p.peer === dst) dials.get(c)?.fail(new DialError('not-found'));
  });

  return {
    id: signal.id,
    onLink: (fn) => void linkFns.push(fn),
    onBroker: (fn) => void signal.on('online', (on) => fn(!on)),
    dial(peer, timeoutMs = 20000) {
      const c = Math.random().toString(36).slice(2, 12);
      const pc = makePc(ice, signal, peer, c);
      const p: Pending = { pc, peer, early: [] };
      conns.set(c, p);
      const dc = pc.createDataChannel('deckhouse', { ordered: true });
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      return new Promise<Link>((resolve, reject) => {
        let done = false;
        const fail = (e: DialError) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          dials.delete(c);
          conns.delete(c);
          pc.close();
          reject(e);
        };
        const timer = setTimeout(() => fail(new DialError('timeout')), timeoutMs);
        dials.set(c, { fail });
        pc.addEventListener('connectionstatechange', () => {
          if (pc.connectionState === 'failed') fail(new DialError('failed'));
        });
        dc.onopen = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          dials.delete(c);
          const link = new RtcLink(peer, pc, dc);
          link.onClose(() => conns.delete(c));
          resolve(link);
        };
        pc.createOffer()
          .then((o) => pc.setLocalDescription(o))
          .then(() => {
            if (!signal.send('OFFER', peer, { c, sdp: withMusic(pc.localDescription!.toJSON()) } satisfies Wire)) fail(new DialError('failed'));
          })
          .catch(() => fail(new DialError('failed')));
      });
    },
    close() {
      for (const p of conns.values()) p.pc.close();
      conns.clear();
      signal.close();
    },
  };
}

/* ---------------- no network: Nets in the same page ---------------- */

const memoryHub = new Map<string, (from: string) => Link>();

class MemoryLink implements Link {
  other!: MemoryLink;
  private dataFns: ((t: string) => void)[] = [];
  private closeFns: (() => void)[] = [];
  private ended = false;
  remoteAudio: MediaStream | null = null;

  constructor(readonly peer: string) {}

  send(text: string): boolean {
    if (this.ended || text.length > MAX_MESSAGE) return false;
    const to = this.other;
    queueMicrotask(() => {
      if (!to.ended) for (const fn of to.dataFns) fn(text);
    });
    return true;
  }

  onData(fn: (t: string) => void): void {
    this.dataFns.push(fn);
  }

  onClose(fn: () => void): void {
    if (this.ended) fn();
    else this.closeFns.push(fn);
  }

  async sendAudio(track: MediaStreamTrack | null): Promise<void> {
    this.other.remoteAudio = track && typeof MediaStream !== 'undefined' ? new MediaStream([track]) : null;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    queueMicrotask(() => {
      for (const fn of this.closeFns.splice(0)) fn();
    });
  }

  close(): void {
    this.end();
    this.other.end();
  }
}

/** a Net that only reaches other memory Nets in this page; `id` must be unique among them */
export function memoryNet(id: string): Net {
  const linkFns: ((l: Link) => void)[] = [];
  const mine: MemoryLink[] = [];
  if (memoryHub.has(id)) throw new DialError('failed');
  memoryHub.set(id, (from) => {
    const here = new MemoryLink(from);
    mine.push(here);
    queueMicrotask(() => {
      for (const fn of linkFns) fn(here);
    });
    return here;
  });
  return {
    id,
    onLink: (fn) => void linkFns.push(fn),
    onBroker: () => {},
    async dial(peer) {
      const answer = memoryHub.get(peer);
      if (!answer) throw new DialError('not-found');
      const there = answer(id) as MemoryLink;
      const here = new MemoryLink(peer);
      here.other = there;
      there.other = here;
      mine.push(here);
      return here;
    },
    close() {
      memoryHub.delete(id);
      for (const l of mine) l.close();
    },
  };
}

/** is anyone registered as this id in the page (memory Nets only) */
export function memoryNetTaken(id: string): boolean {
  return memoryHub.has(id);
}
