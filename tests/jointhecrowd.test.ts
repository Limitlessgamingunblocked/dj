import { describe, expect, it } from 'vitest';
import { defaultLook } from '../src/character/look';
import { cleanName, cleanSign, Cooldowns, DROP_WINDOW, friendLift, groove, GuestHype, MAX_SIGN, parseGuestMsg, spotPlace } from '../src/game/crowdGuests';

/** taps every `gap` ms from `start`, with an optional wobble per tap */
const taps = (n: number, gap: number, wobble: (i: number) => number = () => 0, start = 1000) => Array.from({ length: n }, (_, i) => start + i * gap + wobble(i));

describe('keeping time', () => {
  it('scores steady taps at the tempo as in the groove, whatever their offset from the beat', () => {
    expect(groove(taps(9, 500), 120)).toBeCloseTo(1, 5);
    // the same taps a quarter of a second late (the stream's delay) are just as good
    expect(groove(taps(9, 500, () => 0, 1250), 120)).toBeCloseTo(1, 5);
  });

  it('counts tapping every other beat, or on the half beat', () => {
    expect(groove(taps(9, 1000), 120)).toBeGreaterThan(0.95);
    expect(groove(taps(9, 250), 120)).toBeGreaterThan(0.95);
  });

  it('marks down taps off the tempo, and random tapping scores nothing much', () => {
    expect(groove(taps(9, 430), 120)).toBeLessThan(0.3);
    const rand = [0, 310, 980, 1150, 1900, 2050, 2800, 3500, 3610];
    expect(groove(rand, 120)).toBeLessThan(0.45);
  });

  it('forgives a little wobble', () => {
    expect(groove(taps(9, 500, (i) => (i % 2 ? 15 : -15)), 120)).toBeGreaterThan(0.8);
  });

  it('needs a few taps, and a tempo', () => {
    expect(groove([1000, 1500], 120)).toBe(0);
    expect(groove(taps(9, 500), 0)).toBe(0);
    // a short run counts for less
    expect(groove(taps(4, 500), 120)).toBeLessThan(groove(taps(8, 500), 120));
  });
});

describe('a friend’s hype', () => {
  const dance = (hy: GuestHype, seconds: number, bpm = 124) => {
    const gap = 60000 / bpm;
    let at = 0;
    for (let t = 0; t < seconds; t += 0.05) {
      if (t * 1000 >= at) {
        hy.tap(at + 5000);
        at += gap;
      }
      hy.update(0.05, bpm);
    }
  };

  it('builds while they keep time, and fades when they stop', () => {
    const hy = new GuestHype();
    dance(hy, 20);
    expect(hy.groove).toBeGreaterThan(0.9);
    expect(hy.hype).toBeGreaterThan(0.6);
    expect(hy.active).toBe(true);
    const peak = hy.hype;
    for (let t = 0; t < 30; t += 0.1) hy.update(0.1, 124);
    expect(hy.hype).toBeLessThan(peak - 0.3);
    expect(hy.active).toBe(false);
  });

  it('ignores taps too close together (mashing the pad)', () => {
    const hy = new GuestHype();
    expect(hy.tap(1000)).toBe(true);
    expect(hy.tap(1050)).toBe(false);
  });

  it('catches a drop with a jump soon after it, once', () => {
    const hy = new GuestHype();
    hy.drop();
    hy.update(1, 124);
    expect(hy.move('jump')).toBe(true);
    expect(hy.move('jump')).toBe(false);
    expect(hy.drops).toBe(1);
    expect(hy.hype).toBeGreaterThan(0.3);
  });

  it('misses a drop jumped for too late, or jumping without one', () => {
    const hy = new GuestHype();
    expect(hy.move('jump')).toBe(false);
    hy.drop();
    hy.update(DROP_WINDOW + 0.5, 124);
    expect(hy.move('jump')).toBe(false);
  });
});

describe('the friends lifting the room', () => {
  it('lifts with more of them hyped, up to a ceiling', () => {
    expect(friendLift([])).toBe(0);
    expect(friendLift([0.1, 0.2])).toBe(0);
    expect(friendLift([0.9])).toBeGreaterThan(0);
    expect(friendLift([0.9, 0.9])).toBeGreaterThan(friendLift([0.9]));
    expect(friendLift(Array(20).fill(1))).toBeCloseTo(friendLift(Array(4).fill(1)), 6);
  });
});

describe('checking what a friend sends', () => {
  it('keeps names and signs short, on one line, without control characters', () => {
    expect(cleanName('  Sam‮\n  the   dancer ')).toBe('Sam the dancer');
    expect(cleanName('')).toBe('Friend');
    expect(cleanName(42)).toBe('Friend');
    expect(cleanSign('  play\nsome  techno ')).toBe('PLAY SOME TECHNO');
    expect([...cleanSign('x'.repeat(100))!].length).toBe(MAX_SIGN);
    expect(cleanSign('   ')).toBeNull();
    expect(cleanSign(null)).toBeNull();
  });

  it('takes the messages it knows and drops everything else', () => {
    expect(parseGuestMsg({ t: 'tap', at: 12.5 })).toEqual({ t: 'tap', at: 12.5 });
    expect(parseGuestMsg({ t: 'tap', at: 'soon' })).toBeNull();
    expect(parseGuestMsg({ t: 'move', id: 'jump' })).toEqual({ t: 'move', id: 'jump' });
    expect(parseGuestMsg({ t: 'move', id: 'climb' })).toBeNull();
    expect(parseGuestMsg({ t: 'spot', id: 'back' })).toEqual({ t: 'spot', id: 'back' });
    expect(parseGuestMsg({ t: 'spot', id: 'booth' })).toBeNull();
    expect(parseGuestMsg({ t: 'sign', text: 'hi' })).toEqual({ t: 'sign', text: 'HI' });
    expect(parseGuestMsg({ t: 'request', trackId: 'abc' })).toEqual({ t: 'request', trackId: 'abc' });
    expect(parseGuestMsg({ t: 'request', trackId: 'x'.repeat(500) })).toBeNull();
    expect(parseGuestMsg({ t: 'horn', extra: 1 })).toEqual({ t: 'horn' });
    expect(parseGuestMsg({ t: 'hack' })).toBeNull();
    expect(parseGuestMsg('tap')).toBeNull();
    expect(parseGuestMsg(null)).toBeNull();
  });

  it('checks the look a friend arrives in, and puts them at the front when they name no spot', () => {
    const hello = parseGuestMsg({ t: 'hello', name: 'Kai', look: defaultLook(), spot: 'nowhere' });
    expect(hello).toMatchObject({ t: 'hello', name: 'Kai', spot: 'front' });
    expect(hello && hello.t === 'hello' && hello.look?.id).toBe('look_1');
    const junk = parseGuestMsg({ t: 'hello', name: 'Kai', look: { sliders: 'no' } });
    expect(junk && junk.t === 'hello' && junk.look).toBeNull();
  });
});

describe('cooldowns', () => {
  it('lets each friend do it again after the wait, separately', () => {
    const c = new Cooldowns({ horn: 6 });
    expect(c.take('horn', 'a', 0)).toBe(true);
    expect(c.take('horn', 'a', 3)).toBe(false);
    expect(c.left('horn', 'a', 3)).toBe(3);
    expect(c.take('horn', 'b', 3)).toBe(true);
    expect(c.take('horn', 'a', 6)).toBe(true);
  });
});

describe('where friends stand', () => {
  it('puts each spot at its own place, further back by row', () => {
    const front = spotPlace('front', 0, 2.5);
    const back = spotPlace('back', 0, 2.5);
    expect(front.angle).toBe(0);
    expect(back.radius).toBeGreaterThan(front.radius + 2);
    expect(spotPlace('front-left', 0, 2.5).angle).toBeLessThan(0);
    expect(spotPlace('front-right', 0, 2.5).angle).toBeGreaterThan(0);
  });

  it('gathers friends at the same spot round it, not on top of each other', () => {
    const places = Array.from({ length: 9 }, (_, i) => spotPlace('middle', i, 2.5));
    const xy = places.map((p) => [Math.sin(p.angle) * p.radius, Math.cos(p.angle) * p.radius]);
    for (let i = 0; i < xy.length; i++) for (let j = i + 1; j < xy.length; j++) expect(Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1])).toBeGreaterThan(0.3);
  });
});
