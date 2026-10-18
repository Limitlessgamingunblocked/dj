import { afterEach, describe, expect, it } from 'vitest';
import { makeKey } from '../src/analysis/keys';
import { AuxNight, HANDOFF_AUTO, SCORED_SECS, type AuxDeckView } from '../src/app/passAux';
import { auxJoinUrl, guestMsg, joinAux, openAuxHost, publicState, type AuxGuestLink, type AuxHostLink, type AuxPublic } from '../src/app/auxLink';
import { awards, cleanNames, NO_CALLS, scoreTurn, shareText, standings, tempoJump, turnOrder, votable, type AuxConfig, type AuxTrack } from '../src/game/passAux';

const T: Record<string, AuxTrack> = {
  a: { id: 'a', title: 'Night Drive', artist: 'X', bpm: 124, key: makeKey(9, true) }, // 8A
  b: { id: 'b', title: 'Sunrise', artist: 'Y', bpm: 125, key: makeKey(4, true) }, // 9A: harmonic
  c: { id: 'c', title: 'Clash', artist: 'Z', bpm: 140, key: makeKey(3, false) },
  d: { id: 'd', title: 'Deep', artist: 'W', bpm: 124, key: makeKey(9, true) },
};

const cfg = (rounds = 1, turnSecs = 60): AuxConfig => ({
  players: [
    { id: 'sam', name: 'Sam', color: '#f00' },
    { id: 'jo', name: 'Jo', color: '#0f0' },
    { id: 'kai', name: 'Kai', color: '#00f' },
  ],
  rounds,
  turnSecs,
});

describe('scoring a mix', () => {
  it('rewards a perfect, in-key, same-tempo mix that got in fast', () => {
    const t = scoreTurn({ player: 'sam', round: 1, from: T.a, to: T.b, inAfter: 10, turnSecs: 60, calls: { ...NO_CALLS, band: 'perfect', move: 'Clean bass swap', drop: true } });
    expect(t.score).toBeGreaterThanOrEqual(90);
    expect(t.keyMatch).toBe('harmonic');
    expect(t.notes[0]).toBe('Clean bass swap · Perfect beatmatch');
    expect(t.notes).toContain('In key');
    expect(t.notes).toContain('Big drop');
  });

  it('marks down a trainwreck across clashing keys and a tempo jump', () => {
    const t = scoreTurn({ player: 'sam', round: 1, from: T.a, to: T.c, inAfter: 50, turnSecs: 60, calls: { ...NO_CALLS, trainwreck: true } });
    expect(t.score).toBeLessThan(10);
    expect(t.clean).toBe(0);
    expect(t.keyMatch).toBe('clash');
    expect(t.notes).toContain('Trainwreck');
    expect(t.notes.some((n) => n.startsWith('Tempo jump'))).toBe(true);
  });

  it('gives nothing for running out of time, and scores the opener on the pick and speed', () => {
    expect(scoreTurn({ player: 'sam', round: 1, from: T.a, to: null, inAfter: null, turnSecs: 60, calls: NO_CALLS }).score).toBe(0);
    const open = scoreTurn({ player: 'sam', round: 1, from: null, to: T.a, inAfter: 6, turnSecs: 60, calls: NO_CALLS });
    expect(open.clean).toBeNull();
    expect(open.score).toBeGreaterThan(60);
  });

  it('folds double and half time into the tempo jump', () => {
    expect(tempoJump(124, 124)).toBe(0);
    expect(tempoJump(70, 140)).toBe(0);
    expect(tempoJump(124, 130)).toBeCloseTo(0.048, 2);
  });
});

describe('the night', () => {
  it('plays everyone once a round, in the same order', () => {
    expect(turnOrder(cfg().players, 2).map((t) => `${t.player}${t.round}`)).toEqual(['sam1', 'jo1', 'kai1', 'sam2', 'jo2', 'kai2']);
  });

  it('cleans the names typed in', () => {
    expect(cleanNames([' Sam ', '', 'sam', 'Jo', 'A very long name indeed and more'])).toEqual(['Sam', 'Jo', 'A very long name i']);
  });

  /** decks: [track, playing, audible] */
  const decks = (...d: [string | null, boolean, number][]): AuxDeckView[] => d.map(([trackId, playing, audible]) => ({ trackId, playing, audible }));
  const run = (n: AuxNight, secs: number, d: AuxDeckView[]) => {
    for (let t = 0; t < secs; t += 0.1) n.update(0.1, d);
  };

  it('goes round: an opener, a mix in and out, a miss, then the vote and the awards', () => {
    const n = new AuxNight(cfg(), (id) => T[id] ?? null);
    expect(n.phase).toBe('handoff');
    expect(n.current?.name).toBe('Sam');
    expect(n.upNext?.name).toBe('Jo');

    // Sam opens: ready, a track playing and up for a few seconds
    n.ready(decks([null, false, 1], [null, false, 1]));
    run(n, 2, decks(['a', true, 1], [null, false, 1]));
    expect(n.phase).toBe('mixing');
    run(n, 3, decks(['a', true, 1], [null, false, 1]));
    expect(n.phase).toBe('scored');
    expect(n.last?.to?.id).toBe('a');
    expect(n.last?.from).toBeNull();
    run(n, SCORED_SECS + 0.2, decks(['a', true, 1], [null, false, 1]));

    // Jo mixes into Sam's track: in on deck 2, a clean call from the meter, deck 1 out
    expect(n.phase).toBe('handoff');
    expect(n.current?.name).toBe('Jo');
    expect(n.from?.id).toBe('a');
    n.ready(decks(['a', true, 1], [null, false, 0]));
    run(n, 5, decks(['a', true, 1], ['b', true, 0.1]));
    expect(n.isIn).toBe(false);
    expect(n.timeLeft).toBeCloseTo(55, 0);
    run(n, 1, decks(['a', true, 1], ['b', true, 0.8]));
    expect(n.isIn).toBe(true);
    n.vibe({ kind: 'transition', name: 'bass_swap', points: 120, t: 0, band: 'perfect', keyBonus: true });
    run(n, 1, decks(['a', true, 0.5], ['b', true, 1]));
    expect(n.phase).toBe('mixing');
    run(n, 2, decks(['a', true, 0], ['b', true, 1]));
    expect(n.phase).toBe('scored');
    expect(n.last?.player).toBe('jo');
    expect(n.last?.keyMatch).toBe('harmonic');
    expect(n.last?.score).toBeGreaterThan(85);
    run(n, SCORED_SECS + 0.2, decks(['a', false, 0], ['b', true, 1]));

    // Kai doesn't press Ready: the clock starts by itself, then runs out
    expect(n.current?.name).toBe('Kai');
    expect(n.from?.id).toBe('b');
    run(n, HANDOFF_AUTO + 0.2, decks(['a', false, 0], ['b', true, 1]));
    expect(n.phase).toBe('mixing');
    run(n, 61, decks(['a', false, 0], ['b', true, 1]));
    expect(n.phase).toBe('scored');
    expect(n.last?.score).toBe(0);
    expect(n.last?.notes).toEqual(['Out of time']);
    run(n, SCORED_SECS + 0.2, decks(['a', false, 0], ['b', true, 1]));

    // the vote: Jo's mix is the only one anyone else can vote for (the opener and the miss don't count)
    expect(n.phase).toBe('voting');
    expect(n.ballot('sam')).toEqual([1]);
    expect(n.ballot('jo')).toEqual([]);
    expect(n.vote('jo', 1)).toBe(false);
    expect(n.vote('sam', 0)).toBe(false);
    expect(n.vote('sam', 1)).toBe(true);
    expect(n.phase).toBe('voting');
    expect(n.vote('kai', 1)).toBe(true);
    expect(n.phase).toBe('awards');

    const aw = awards(n.cfg.players, n.turns, n.votes);
    const by = (id: string) => aw.find((a) => a.id === id);
    expect(by('champion')?.player).toBe('jo');
    expect(by('crowd')?.player).toBe('jo');
    expect(by('smoothest')?.player).toBe('jo');
    expect(by('trainwreck')?.player).toBe('kai');
    expect(by('trainwreck')?.why).toBe('Never got in over Sunrise');
    expect(standings(n.cfg.players, n.turns, n.votes)[0]).toMatchObject({ player: 'jo', votes: 2 });
    expect(shareText(n.cfg.players, n.turns, n.votes)).toContain('Trainwreck of the night: Kai');

    const pub = n.public({ phoneA: 'sam' });
    expect(pub.phase).toBe('awards');
    expect(pub.players.find((p) => p.id === 'jo')?.votes).toBe(2);
    expect(pub.awards.length).toBeGreaterThan(2);
    expect(publicState(JSON.parse(JSON.stringify(pub)))).toEqual(pub);
  });

  it('notices dead air: the last track ran out before the next one came in', () => {
    const n = new AuxNight(cfg(), (id) => T[id] ?? null);
    n.ready(decks([null, false, 1], [null, false, 1]));
    run(n, 5, decks(['a', true, 1], [null, false, 1]));
    run(n, SCORED_SECS + 0.2, decks(['a', true, 1], [null, false, 1]));
    n.ready(decks(['a', true, 1], [null, false, 1]));
    run(n, 4, decks(['a', false, 1], [null, false, 1]));
    run(n, 3, decks(['a', false, 1], ['d', true, 1]));
    expect(n.phase).toBe('scored');
    expect(n.last?.calls.deadAir).toBe(true);
    expect(n.last?.notes).toContain('Dead air');
    expect(n.last!.score).toBeLessThan(50);
  });

  it('skips a player who passes, and their turn is out of the vote', () => {
    const n = new AuxNight(cfg(), (id) => T[id] ?? null);
    n.skip();
    expect(n.phase).toBe('scored');
    expect(n.last?.skipped).toBe(true);
    expect(votable(n.turns, 'jo')).toEqual([]);
  });
});

describe('on the phones', () => {
  const links: { close?: () => void; leave?: () => void }[] = [];
  afterEach(async () => {
    for (const l of links.splice(0)) (l.close ?? l.leave)?.();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('checks what comes off the network', () => {
    expect(guestMsg({ t: 'vote', turn: 2 })).toEqual({ t: 'vote', turn: 2 });
    expect(guestMsg({ t: 'vote', turn: -1 })).toBeNull();
    expect(guestMsg({ t: 'vote', turn: '2' })).toBeNull();
    expect(guestMsg({ t: 'listen', on: 'yes' })).toBeNull();
    expect(guestMsg({ t: 'ready', extra: 1 })).toEqual({ t: 'ready' });
    expect(guestMsg({ t: 'state' })).toBeNull();
    expect(publicState({ phase: 'party', players: [], turns: [], devices: {} })).toBeNull();
    expect(publicState({ phase: 'lobby', players: [{ id: 1 }], turns: [], devices: {} })).toBeNull();
    expect(auxJoinUrl('K7QMP', 'https://x.test/play/')).toBe('https://x.test/play/?room=K7QMP#aux');
  });

  it('a phone joins the room, says hello and ready, and hears the state', async () => {
    const host: AuxHostLink = await openAuxHost({ transport: 'memory' });
    links.push(host);
    const heard: { m: unknown; from: string }[] = [];
    host.onMessage((m, from) => heard.push({ m, from }));
    const phone: AuxGuestLink = await joinAux(host.code, 'Sam', { transport: 'memory' });
    links.push(phone);
    await new Promise((r) => setTimeout(r, 50));
    expect(host.phones()).toEqual([{ id: phone.me, name: 'Sam' }]);

    const got: AuxPublic[] = [];
    phone.onState((s) => got.push(s));
    phone.send({ t: 'hello' });
    phone.send({ t: 'ready' });
    await new Promise((r) => setTimeout(r, 50));
    expect(heard.map((x) => x.m)).toEqual([{ t: 'hello' }, { t: 'ready' }]);
    expect(heard[0].from).toBe(phone.me);

    const n = new AuxNight({ ...cfg(), players: [{ id: phone.me, name: 'Sam', color: '#f00', device: true }, ...cfg().players.slice(1)] }, (id) => T[id] ?? null);
    host.send(n.public({ [phone.me]: phone.me }));
    await new Promise((r) => setTimeout(r, 50));
    expect(got.at(-1)?.current).toBe(phone.me);
    expect(got.at(-1)?.devices[phone.me]).toBe(phone.me);
  });

  it('turns away a phone joining a room playing another mode', async () => {
    await expect(joinAux('ZZZZZ', 'Sam', { transport: 'memory' })).rejects.toThrow(/no room with that code/i);
  });
});
