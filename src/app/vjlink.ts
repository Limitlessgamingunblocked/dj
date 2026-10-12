/*
 * VJ mode's link between the deck (the app you mix in) and the VJ's controls,
 * either in another window of the same browser (a BroadcastChannel: open it
 * on a second screen) or on another device on the same network (a WebRTC
 * data channel, paired by swapping two codes by hand; no server, and no
 * outside service: it only finds devices on the local network).
 *
 * Messages are small JSON objects:
 *   VJ → deck:  hello, press/release (a control id), mode (a visual mode), hold (keep the VJ's modes), palette, moment
 *   deck → VJ:  state (the modes, the pads and what's lit, the palette, the track, the vibe)
 */

export type VjMsg =
  | { t: 'hello' }
  | { t: 'press'; id: string }
  | { t: 'release'; id: string }
  | { t: 'mode'; id: string }
  | { t: 'hold'; on: boolean }
  | { t: 'palette'; id: string }
  | { t: 'moment'; id: string }
  | { t: 'state'; s: VjState };

export interface VjState {
  modes: { id: string; name: string; energy: string }[];
  mode: string;
  hold: boolean;
  pads: { id: string; label: string; lit: string | false }[];
  palettes: { id: string; name: string }[];
  palette: string;
  moments: { id: string; label: string; on: boolean }[];
  track: string;
  bpm: number;
  vibe: number;
  venue: string;
}

const CHANNEL = 'deckhouse-vj';

/** a link: send messages, hear them */
export interface VjLink {
  send(m: VjMsg): void;
  onMessage(fn: (m: VjMsg) => void): void;
  close(): void;
  readonly kind: 'window' | 'device';
}

export function windowLink(): VjLink | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const ch = new BroadcastChannel(CHANNEL);
  const fns: ((m: VjMsg) => void)[] = [];
  ch.onmessage = (e) => {
    if (isMsg(e.data)) for (const fn of fns) fn(e.data);
  };
  return {
    kind: 'window',
    send: (m) => ch.postMessage(m),
    onMessage: (fn) => void fns.push(fn),
    close: () => ch.close(),
  };
}

export function isMsg(x: unknown): x is VjMsg {
  return typeof x === 'object' && x !== null && typeof (x as { t?: unknown }).t === 'string';
}

/* ---------------- pairing another device (WebRTC, codes swapped by hand) ---------------- */

function encode(desc: RTCSessionDescriptionInit): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify({ t: desc.type, s: desc.sdp })))).replace(/=+$/, '');
}

function decode(code: string): RTCSessionDescriptionInit | null {
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(code.trim().replace(/\s+/g, ''))))) as { t: RTCSdpType; s: string };
    return o && (o.t === 'offer' || o.t === 'answer') && typeof o.s === 'string' ? { type: o.t, sdp: o.s } : null;
  } catch {
    return null;
  }
}

/** wait until the connection has gathered its local addresses (no trickle: the code carries them all) */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', done);
        res();
      }
    };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(res, 3000);
  });
}

function channelLink(dc: RTCDataChannel, pc: RTCPeerConnection): VjLink {
  const fns: ((m: VjMsg) => void)[] = [];
  dc.onmessage = (e) => {
    try {
      const m = JSON.parse(String(e.data));
      if (isMsg(m)) for (const fn of fns) fn(m);
    } catch {
      /* not ours */
    }
  };
  return {
    kind: 'device',
    send: (m) => dc.readyState === 'open' && dc.send(JSON.stringify(m)),
    onMessage: (fn) => void fns.push(fn),
    close: () => {
      dc.close();
      pc.close();
    },
  };
}

/** the deck's side: make a code for the VJ device, then take its answer */
export async function hostPairing(onOpen: (link: VjLink) => void): Promise<{ code: string; answer(code: string): Promise<boolean>; cancel(): void }> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('vj');
  dc.onopen = () => onOpen(channelLink(dc, pc));
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  return {
    code: encode(pc.localDescription!),
    async answer(code: string) {
      const d = decode(code);
      if (!d || d.type !== 'answer') return false;
      await pc.setRemoteDescription(d);
      return true;
    },
    cancel: () => pc.close(),
  };
}

/** the VJ device's side: take the deck's code and give back an answer */
export async function joinPairing(code: string, onOpen: (link: VjLink) => void): Promise<string | null> {
  const d = decode(code);
  if (!d || d.type !== 'offer') return null;
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.ondatachannel = (e) => {
    const dc = e.channel;
    dc.onopen = () => onOpen(channelLink(dc, pc));
  };
  await pc.setRemoteDescription(d);
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return encode(pc.localDescription!);
}
