import { beforeEach, describe, expect, it } from 'vitest';
import { autoMoment, crowdShow, styleFor, styleName } from '../src/three/venues/crowdShow';
import { afterSet, attending, cleanLoyalty, fanOf, REGULARS, signFor } from '../src/game/regulars';
import { cleanRoomConfig, customVenue, customVenueId, isCustomRoom, loadCustomRooms, MAX_CUSTOM_ROOMS, saveCustomRooms } from '../src/three/venues/rooms/custom';
import { DJ_MOVES } from '../src/character/Avatar';
import { armAngle } from '../src/three/venues/rooms/vinyl';
import { coneFlex, coneY } from '../src/three/venues/rooms/speaker';

const quiet = { playing: true, hype: 0.6, build: 0, peak: 0, progress: 0.3, closing: false, since: 999, roll: 0.05 };

describe('the crowd dances to the genre', () => {
  it('jacks to house, stomps to techno, bounces to drum & bass, sways to deep music', () => {
    expect(styleName(styleFor('House'))).toBe('Jacking');
    expect(styleName(styleFor('Techno'))).toBe('Stomping');
    expect(styleName(styleFor('Drum & Bass'))).toBe('Bouncing');
    expect(styleName(styleFor('Deep House'))).toBe('Swaying');
    expect(styleName(styleFor(''))).toBe('Mixed');
    for (const w of [styleFor('House'), styleFor('Unknown')]) expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe('crowd moments', () => {
  beforeEach(() => {
    crowdShow.stop();
    crowdShow.since = 999;
    crowdShow.copy = null;
  });

  it('come when the room is right, and not too often', () => {
    expect(autoMoment({ ...quiet, since: 10 })).toBeNull();
    expect(autoMoment({ ...quiet, playing: false })).toBeNull();
    expect(autoMoment({ ...quiet, closing: true, progress: 0.9, hype: 0.6 })).toBe('lighters');
    expect(autoMoment({ ...quiet, build: 1, hype: 0.7, roll: 0.2 })).toBe('sitjump');
    expect(autoMoment({ ...quiet, hype: 0.9, peak: 1, roll: 0.1 })).toBe('circle');
    expect(autoMoment({ ...quiet, roll: 0.05 })).toBe('conga');
    expect(autoMoment({ ...quiet, roll: 0.9 })).toBeNull();
  });

  it('the sit-down holds until the drop, then everyone jumps for a few seconds', () => {
    crowdShow.start('sitjump');
    crowdShow.update(3, false);
    expect(crowdShow.sitK()).toBe(1);
    expect(crowdShow.sitJumpK()).toBe(0);
    crowdShow.update(0.1, true);
    expect(crowdShow.sitK()).toBe(0);
    expect(crowdShow.sitJumpK()).toBeGreaterThan(0.9);
    crowdShow.update(7, false);
    expect(crowdShow.moment).toBeNull();
    expect(crowdShow.since).toBe(0);
  });

  it('a moment eases in and out, and ends by itself', () => {
    crowdShow.start('conga');
    crowdShow.update(0.75, false);
    expect(crowdShow.momentK('conga')).toBeCloseTo(0.5);
    expect(crowdShow.momentK('circle')).toBe(0);
    crowdShow.update(40, false);
    expect(crowdShow.moment).toBeNull();
  });

  it('fans copy your moves', () => {
    crowdShow.copyMove('point', 2);
    crowdShow.update(1, false);
    expect(crowdShow.copyWeights().point).toBe(1);
    crowdShow.copyMove('jump', 2, true);
    crowdShow.update(1, false);
    const w = crowdShow.copyWeights();
    expect(w.jump).toBe(1);
    expect(w.hands).toBeGreaterThan(0);
    crowdShow.update(2, false);
    expect(crowdShow.copy).toBeNull();
  });

  it('cardboard signs redraw only when their messages change', () => {
    const v = crowdShow.cardsVersion;
    crowdShow.setCards(['A', 'B']);
    expect(crowdShow.cardsVersion).toBe(v + 1);
    crowdShow.setCards(['A', 'B']);
    expect(crowdShow.cardsVersion).toBe(v + 1);
  });

  it('every DJ move lasts a few beats', () => {
    expect(DJ_MOVES.map((m) => m.id)).toEqual(['hands_up', 'jump', 'point', 'clap', 'fist_pump', 'climb']);
    for (const m of DJ_MOVES) expect(m.beats).toBeGreaterThanOrEqual(4);
  });
});

describe('the regulars', () => {
  it('start lukewarm, come to your sets and move up front as they like you more', () => {
    const l = cleanLoyalty(null);
    expect(Object.keys(l)).toHaveLength(REGULARS.length);
    expect(attending(l)).toHaveLength(0);
    const fond = { ...l, jess: 0.7, marco: 0.4 };
    const a = attending(fond);
    expect(a.map((x) => x.fan.id)).toEqual(['jess', 'marco']);
    expect(a[0].front).toBe(true);
    expect(a[1].front).toBe(false);
  });

  it('a good set with their music wins them over; a poor one without it loses them', () => {
    const l = cleanLoyalty({ jess: 0.5, marco: 0.5 });
    const good = afterSet(l, { grade: 'A', genres: { House: 600 }, full: true });
    expect(good.loyalty.jess).toBeGreaterThan(0.7);
    expect(good.loyalty.marco).toBeLessThan(0.53);
    expect(good.changes[0].fan.id).toBe('jess');
    const poor = afterSet(l, { grade: 'D', genres: { Techno: 300 }, full: true });
    expect(poor.loyalty.jess).toBeLessThan(0.5);
    expect(poor.loyalty.marco).toBeGreaterThan(0.5);
  });

  it('have a sign with your name and a favourite genre', () => {
    const jess = REGULARS.find((f) => f.id === 'jess')!;
    expect(signFor(jess, 'nova')).toBe('JESS ♥ NOVA');
    expect(fanOf('Techno')?.id).toBe('marco');
    expect(fanOf('Polka')).toBeNull();
    expect(cleanLoyalty({ jess: 7, marco: 'x' })).toMatchObject({ jess: 1, marco: 0.2 });
  });
});

describe('rooms you build', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  });

  it('a room config is always complete and valid', () => {
    const c = cleanRoomConfig({ id: 'abc', name: '  ', walls: 'lava', floor: 'water', extras: ['rain', 'rain', 'nope'], colors: ['#FF0000', 'red'] });
    expect(c).toMatchObject({ id: 'abc', name: 'My room', walls: 'mirror', floor: 'water', extras: ['rain'], size: 'medium' });
    expect(c.colors).toEqual(['#ff0000', '#3dd6ff', '#ffd23f']);
    expect(cleanRoomConfig({ id: 'BAD ID!' }, 'r1').id).toBe('r1');
  });

  it('saves up to eight and becomes a venue', () => {
    saveCustomRooms(Array.from({ length: 10 }, (_, i) => cleanRoomConfig({ id: `r${i}`, name: `Room ${i}` })));
    const list = loadCustomRooms();
    expect(list).toHaveLength(MAX_CUSTOM_ROOMS);
    const v = customVenue(list[0]);
    expect(v.id).toBe(customVenueId(list[0]));
    expect(isCustomRoom(v.id)).toBe(true);
    expect(isCustomRoom('mirror')).toBe(false);
    expect(v.blurb).toContain('Mirrors walls');
  });
});

describe('room geometry', () => {
  it('the vinyl floor’s tonearm reaches every radius of the record', () => {
    for (const r of [8.4, 5, 3.2]) {
      const a = armAngle(r);
      expect(a).toBeGreaterThanOrEqual(Math.PI);
      expect(a).toBeLessThanOrEqual(Math.PI * 2);
    }
    expect(armAngle(8.4)).not.toBeCloseTo(armAngle(3.2), 2);
  });

  it('the speaker cone rises from the cap to the rim and flexes most near the middle', () => {
    expect(coneY(1)).toBe(0);
    expect(coneY(14)).toBeCloseTo(5.2);
    expect(coneY(8)).toBeGreaterThan(coneY(5));
    expect(coneFlex(2)).toBe(1);
    expect(coneFlex(14)).toBe(0);
    expect(coneFlex(8)).toBeLessThan(coneFlex(4));
  });
});

describe('crowd control', () => {
  it('eases the crowd’s arms up and after yours, the back of the room a little later, and back down', () => {
    crowdShow.setSway(null);
    for (let i = 0; i < 120; i++) crowdShow.updateSway(1 / 30);
    expect(crowdShow.swayK).toBe(0);
    crowdShow.setSway(1);
    for (let i = 0; i < 6; i++) crowdShow.updateSway(1 / 30);
    // the front's already most of the way over; the back's still catching up
    expect(crowdShow.swayNow).toBeGreaterThan(0.75);
    expect(crowdShow.swayLate).toBeLessThan(crowdShow.swayNow);
    expect(crowdShow.swayLate).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) crowdShow.updateSway(1 / 30);
    expect(crowdShow.swayK).toBeGreaterThan(0.95);
    expect(crowdShow.swayLate).toBeGreaterThan(0.9);
    // out of range is held to the ends
    crowdShow.setSway(-3);
    expect(crowdShow.lean).toBe(-1);
    crowdShow.setSway(null);
    for (let i = 0; i < 120; i++) crowdShow.updateSway(1 / 30);
    expect(crowdShow.swayK).toBe(0);
  });
});
