import { afterEach, describe, expect, it } from 'vitest';
import { DiscoSession, readDisco, type DiscoHooks } from '../src/app/discoSession';
import { CROWD_PEOPLE, PracticeRival, Pull, roomShare, Showdown, targetShare, winnerOf } from '../src/game/silentDisco';
import type { VibeEvent } from '../src/game/vibe';
import { hostRoom, joinRoom, type Room } from '../src/net';
import { VERT_HEAD } from '../src/three/venues/crowd';
import { discoUniforms, headphoneShapes } from '../src/three/venues/silentDisco';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('a DJ’s pull on the room', () => {
  it('follows the vibe meter, kicked up by a clean mix or a built drop and knocked by a trainwreck', () => {
    const p = new Pull();
    expect(p.update(0.1, 0.5, true)).toBeCloseTo(0.5, 2);
    p.event({ kind: 'transition', name: 'long_blend', points: 100, t: 0, band: 'perfect', keyBonus: false } as VibeEvent);
    const after = p.update(0.1, 0.5, true);
    expect(after).toBeGreaterThan(0.75);
    // it fades over a few seconds
    for (let i = 0; i < 300; i++) p.update(0.1, 0.5, true);
    expect(p.value).toBeCloseTo(0.5, 1);
    p.event({ kind: 'mistake', name: 'trainwreck', t: 0 } as VibeEvent);
    expect(p.update(0.1, 0.5, true)).toBeLessThan(0.3);
  });

  it('pulls nobody in silence', () => {
    const p = new Pull();
    p.event({ kind: 'drop', built: true, points: 50, t: 0 } as VibeEvent);
    expect(p.update(0.1, 0.9, false)).toBe(0);
  });
});

describe('the room', () => {
  it('leans to the stronger pull but never goes all the way', () => {
    expect(targetShare(0.6, 0.6)).toBeCloseTo(0.5);
    expect(targetShare(0.9, 0.3)).toBeGreaterThan(0.8);
    expect(targetShare(1.3, 0)).toBeLessThan(0.93);
    expect(targetShare(0, 1.3)).toBeGreaterThan(0.07);
    expect(targetShare(0.4, 0.7)).toBeLessThan(0.5);
  });

  it('counts the friends watching on each channel alongside the dancers', () => {
    expect(roomShare(0.5, { blue: 0, red: 0 })).toBeCloseTo(0.5);
    expect(roomShare(0.5, { blue: 4, red: 0 })).toBeCloseTo((0.5 * CROWD_PEOPLE + 4) / (CROWD_PEOPLE + 4));
    expect(roomShare(0.5, { blue: 0, red: 4 })).toBeLessThan(0.5);
  });

  it('calls a winner only when it’s clear', () => {
    expect(winnerOf(0.6)).toBe('blue');
    expect(winnerOf(0.4)).toBe('red');
    expect(winnerOf(0.501)).toBe('tie');
  });
});

describe('the showdown', () => {
  it('drifts the room to the better mix a little at a time, calls the lead, the last minute and the winner', () => {
    const g = new Showdown(5);
    const notes: string[] = [];
    g.setPull('blue', 0.4);
    g.setPull('red', 0.85);
    g.update(1);
    // a second can't swing the whole room
    expect(g.crowd).toBeGreaterThan(0.45);
    for (let t = 1; t < 300 && g.phase === 'live'; t++) for (const n of g.update(1)) notes.push(n.kind === 'lead' || n.kind === 'swing' ? `${n.kind}:${n.to}` : n.kind);
    expect(g.phase).toBe('over');
    expect(g.share).toBeLessThan(0.25);
    expect(notes).toContain('lead:red');
    expect(notes).toContain('final');
    expect(notes.at(-1)).toBe('over');
    expect(g.history.length).toBeGreaterThan(50);
  });

  it('lets friends watching flip channels, and forgets them when they leave', () => {
    const g = new Showdown(10);
    g.flip('a', 'red');
    g.flip('b', 'red');
    g.flip('c', 'blue');
    expect(g.watching).toEqual({ blue: 1, red: 2 });
    g.flip('c', 'red');
    expect(g.watching).toEqual({ blue: 0, red: 3 });
    expect(g.share).toBeLessThan(0.5);
    g.leave('a');
    expect(g.watching.red).toBe(2);
  });

  it('a stand-in rival’s pull stays in range and pays off a mix now and then', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const r = new PracticeRival(0.6, rand);
    const seen: number[] = [];
    for (let i = 0; i < 600; i++) seen.push(r.update(0.5));
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1.3);
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.1);
  });
});

describe('messages off the network', () => {
  it('takes only what each side may send, cleaned', () => {
    expect(readDisco({ t: 'pull', v: 9, now: 'x'.repeat(500), bpm: 128 }, false)).toEqual({ t: 'pull', v: 1.3, now: 'x'.repeat(80), bpm: 128 });
    // a guest can't send the room's state, the host doesn't send pulls
    expect(readDisco({ t: 'state', s: {} }, false)).toBeNull();
    expect(readDisco({ t: 'pull', v: 1 }, true)).toBeNull();
    expect(readDisco({ t: 'flip', ch: 'green' }, false)).toBeNull();
    const s = readDisco({ t: 'state', s: { phase: 'live', share: 4, names: { blue: 'A', red: 7 }, watching: { blue: -3 } } }, true);
    expect(s?.t === 'state' && s.s.share).toBe(1);
    expect(s?.t === 'state' && s.s.names).toEqual({ blue: 'A', red: '' });
    expect(s?.t === 'state' && s.s.watching.blue).toBe(0);
    expect(readDisco({ t: 'note', n: { kind: 'lead', to: 'red' } }, true)).toEqual({ t: 'note', n: { kind: 'lead', to: 'red' } });
    expect(readDisco({ t: 'note', n: { kind: 'over' } }, true)).toBeNull();
  });
});

describe('the headphones', () => {
  it('are on every dancer’s head in the shader, hidden until a showdown runs', () => {
    expect(VERT_HEAD).toContain('uniform float uDisco');
    for (const lo of [false, true]) {
      const verts = headphoneShapes(lo).reduce((a, [g]) => a + g.attributes.position.count, 0);
      expect(verts).toBeLessThan(lo ? 90 : 160);
    }
  });
});

describe('a showdown over a room', () => {
  const rooms: Room[] = [];
  const sessions: DiscoSession[] = [];
  afterEach(async () => {
    for (const s of sessions.splice(0)) s.leave();
    for (const r of rooms.splice(0)) r.leave();
    await tick(200);
    discoUniforms.uDisco.value = 0;
  });

  const hooks = (pull: number, notes: string[] = []): DiscoHooks & { pull: number } => {
    const h = {
      pull,
      mine: () => ({ pull: h.pull, now: 'Track', bpm: 124, phase: 0 }),
      note: (text: string) => void notes.push(text),
    };
    return h;
  };

  it('seats the first DJ on red, lets a friend watch and flip, and the better mix takes the room', async () => {
    const hr = await hostRoom({ mode: 'disco', name: 'KAI', info: { role: 'dj' }, transport: 'memory' });
    rooms.push(hr);
    const hostNotes: string[] = [];
    const hostHooks = hooks(0.35, hostNotes);
    const host = DiscoSession.host(hr, hostHooks, 'KAI', 1);
    sessions.push(host);
    expect(host.ready).toBe(false);
    expect(host.start()).toBe(false);

    const rr = await joinRoom(hr.code, { mode: 'disco', name: 'SAM', info: { role: 'dj' }, transport: 'memory' });
    rooms.push(rr);
    const red = DiscoSession.guest(rr, hooks(0.9), true);
    sessions.push(red);
    const wr = await joinRoom(hr.code, { mode: 'disco', name: 'JO', info: { role: 'watch' }, transport: 'memory' });
    rooms.push(wr);
    const watch = DiscoSession.guest(wr, hooks(0), false);
    sessions.push(watch);
    // a second DJ once the seat's taken watches
    const lr = await joinRoom(hr.code, { mode: 'disco', name: 'LATE', info: { role: 'dj' }, transport: 'memory' });
    rooms.push(lr);
    const late = DiscoSession.guest(lr, hooks(1), true);
    sessions.push(late);
    await tick(10);

    expect(host.wire.red).toBe(rr.me.id);
    expect(host.wire.names.red).toBe('SAM');
    expect(hostNotes).toContain('SAM is on red');
    expect(host.ready).toBe(true);
    // the state reaches the guests
    for (let i = 0; i < 3; i++) {
      for (const s of sessions) s.update(0.1);
      await tick(5);
    }
    expect(red.isDj).toBe(true);
    expect(red.channel).toBe('red');
    expect(late.isDj).toBe(false);
    expect(watch.wire.names).toEqual({ blue: 'KAI', red: 'SAM' });
    expect(discoUniforms.uDisco.value).toBe(1);

    expect(host.start()).toBe(true);
    watch.flip('red');
    for (let i = 0; i < 70 && host.wire.phase === 'live'; i++) {
      for (const s of sessions) s.update(1);
      await tick(2);
    }
    await tick(10);
    expect(host.wire.phase).toBe('over');
    expect(host.wire.winner).toBe('red');
    expect(host.wire.watching.red).toBeGreaterThanOrEqual(1);
    // everyone sees the result and the night's history
    for (const s of [red, watch, late]) {
      expect(s.wire.phase).toBe('over');
      expect(s.wire.winner).toBe('red');
      expect(s.wire.history?.length).toBeGreaterThan(5);
    }
    // and the host can run it back
    host.rematch();
    expect(host.wire.phase).toBe('live');
    expect(host.wire.winner).toBeNull();
  });

  it('frees the red seat when that DJ leaves, before it starts', async () => {
    const hr = await hostRoom({ mode: 'disco', name: 'KAI', transport: 'memory' });
    rooms.push(hr);
    const notes: string[] = [];
    const host = DiscoSession.host(hr, hooks(0.5, notes), 'KAI', 5);
    sessions.push(host);
    const rr = await joinRoom(hr.code, { mode: 'disco', name: 'SAM', info: { role: 'dj' }, transport: 'memory' });
    await tick(10);
    expect(host.wire.red).toBe(rr.me.id);
    rr.leave();
    await tick(250);
    expect(host.wire.red).toBeNull();
    expect(notes).toContain('SAM left the showdown');
  });

  it('practice needs nobody to join', () => {
    const s = DiscoSession.practice(hooks(0.6), 'KAI', 'NOX', 5, 0.7);
    sessions.push(s);
    expect(s.ready).toBe(true);
    expect(s.start()).toBe(true);
    for (let i = 0; i < 30; i++) s.update(1);
    expect(s.wire.names.red).toBe('NOX');
    expect(s.wire.left).toBeCloseTo(270, 0);
    s.leave();
    expect(discoUniforms.uDisco.value).toBe(0);
  });
});
