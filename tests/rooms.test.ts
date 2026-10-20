import { afterEach, describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, newRoomCode, normalizeRoomCode, roomFromUrl, roomLink } from '../src/net/codes';
import { musicSdp } from '../src/net/link';
import { cleanName, hostRoom, JoinError, joinRoom, type Player, type Room, type RoomMessage } from '../src/net/room';

const open: Room[] = [];
const track = <T extends Room>(r: T): T => (open.push(r), r);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  for (const r of open.splice(0)) r.leave();
  await tick(200);
});

const host = (extra: object = {}) => hostRoom({ mode: 'crowd', name: 'DJ KAI', transport: 'memory', ...extra }).then(track);
const join = (code: string, name: string, extra: object = {}) => joinRoom(code, { mode: 'crowd', name, transport: 'memory', ...extra }).then(track);

describe('room codes', () => {
  it('are five characters from the alphabet without look-alikes', () => {
    for (let i = 0; i < 200; i++) {
      const c = newRoomCode();
      expect(c).toHaveLength(CODE_LENGTH);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01IO]/);
  });

  it('read what people type: case, spaces and dashes ignored, anything else turned down', () => {
    expect(normalizeRoomCode(' k7q-mp ')).toBe('K7QMP');
    expect(normalizeRoomCode('K7QM')).toBeNull();
    expect(normalizeRoomCode('K7QM0')).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
  });

  it('go in and out of a link', () => {
    const link = roomLink('K7QMP', 'https://example.com/play/?debug#x');
    expect(link).toBe('https://example.com/play/?debug=&room=K7QMP');
    expect(roomFromUrl(link)).toBe('K7QMP');
    expect(roomFromUrl('https://example.com/?room=nope!')).toBeNull();
    expect(roomFromUrl('not a url')).toBeNull();
  });
});

describe('rooms', () => {
  it('a guest joins by code and everyone sees the same roster', async () => {
    const h = await host({ info: { look: 'a' } });
    const seen: Player[][] = [];
    h.on('players', (p) => seen.push(p));
    const a = await join(h.code.toLowerCase(), '  Sam  ', { info: { look: 'b' } });
    const b = await join(h.code, 'Jo');
    await tick(10);
    for (const r of [h, a, b]) expect(r.players().map((p) => p.name)).toEqual(['DJ KAI', 'Sam', 'Jo']);
    expect(a.me.name).toBe('Sam');
    expect(a.host.name).toBe('DJ KAI');
    expect(b.players()[1].info).toEqual({ look: 'b' });
    expect(seen.at(-1)).toHaveLength(3);
  });

  it('guests talk to the host, the host to everyone or to one', async () => {
    const h = await host();
    const a = await join(h.code, 'Sam');
    const b = await join(h.code, 'Jo');
    const atHost: string[] = [];
    const atA: string[] = [];
    const atB: string[] = [];
    h.on('message', ({ m, from }) => atHost.push(`${from.name}:${m.t}`));
    a.on('message', ({ m, from }) => atA.push(`${from.name}:${m.t}`));
    b.on('message', ({ m }) => atB.push(m.t));
    a.send({ t: 'sign', text: 'HI MUM' });
    h.send({ t: 'drop' });
    h.send({ t: 'only-jo' }, b.me.id);
    await tick(10);
    expect(atHost).toEqual(['Sam:sign']);
    expect(atA).toEqual(['DJ KAI:drop']);
    expect(atB).toEqual(['drop', 'only-jo']);
  });

  it('drops anything that isn’t a message with a string t', async () => {
    const h = await host();
    const a = await join(h.code, 'Sam');
    let n = 0;
    h.on('message', () => n++);
    expect(a.send({ nope: 1 } as unknown as RoomMessage)).toBe(false);
    expect(a.send({ t: 'x', big: 'y'.repeat(70000) })).toBe(false);
    await tick(10);
    expect(n).toBe(0);
  });

  it('turns guests away for the wrong mode, a full room, a locked room, or no room', async () => {
    const h = await host({ maxPlayers: 2 });
    await expect(join(h.code, 'X', { mode: 'disco' })).rejects.toMatchObject({ reason: 'wrong-mode' });
    await join(h.code, 'Sam');
    await expect(join(h.code, 'Jo')).rejects.toMatchObject({ reason: 'full' });
    const h2 = await host();
    h2.lock();
    await expect(join(h2.code, 'Jo')).rejects.toMatchObject({ reason: 'locked' });
    await expect(join('ZZZZZ', 'Jo')).rejects.toBeInstanceOf(JoinError);
    await expect(join('nope', 'Jo')).rejects.toMatchObject({ reason: 'bad-code' });
  });

  it('a guest leaving updates everyone; the host leaving closes the room', async () => {
    const h = await host();
    const a = await join(h.code, 'Sam');
    const b = await join(h.code, 'Jo');
    const left: string[] = [];
    h.on('leave', (p) => left.push(p.name));
    a.leave();
    await tick(250);
    expect(left).toEqual(['Sam']);
    expect(b.players().map((p) => p.name)).toEqual(['DJ KAI', 'Jo']);
    let why = '';
    b.on('close', (r) => (why = r));
    h.leave();
    await tick(250);
    expect(why).toBe('host-left');
    expect(b.open).toBe(false);
  });

  it('the host can kick a guest', async () => {
    const h = await host();
    const a = await join(h.code, 'Sam');
    let why = '';
    a.on('close', (r) => (why = r));
    h.kick(a.me.id);
    await tick(300);
    expect(why).toBe('kicked');
    expect(h.players()).toHaveLength(1);
  });

  it('info changes reach everyone', async () => {
    const h = await host();
    const a = await join(h.code, 'Sam');
    const b = await join(h.code, 'Jo');
    a.setInfo({ colour: 'red' });
    await tick(10);
    expect(b.player(a.me.id)?.info).toEqual({ colour: 'red' });
    h.setInfo({ colour: 'blue' });
    await tick(10);
    expect(a.host.info).toEqual({ colour: 'blue' });
  });

  it('guests learn the host’s clock', async () => {
    const h = await host();
    const a = await join(h.code, 'Sam');
    await tick(1300);
    expect(Math.abs(a.hostNow() - h.hostNow())).toBeLessThan(20);
    expect(a.rtt()).toBeGreaterThanOrEqual(0);
  });
});

describe('the wire', () => {
  it('names are trimmed, cleaned and never empty', () => {
    expect(cleanName('  a\u0007b  ')).toBe('ab');
    expect(cleanName('x'.repeat(40))).toHaveLength(24);
    expect(cleanName('')).toBe('Guest');
    expect(cleanName(undefined)).toBe('Guest');
  });

  it('asks Opus for stereo at a music bitrate', () => {
    const sdp = 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1;stereo=0\r\n';
    const out = musicSdp(sdp);
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=192000;usedtx=0\r\n');
    expect(musicSdp('m=video 9')).toBe('m=video 9');
  });
});
