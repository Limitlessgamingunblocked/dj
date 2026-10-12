import { beforeEach, describe, expect, it } from 'vitest';
import { PROGRESS, type Progress } from '../src/core/models';
import { applySet, venueLock, type SetSummary } from '../src/game/progression';
import { CRAZY_ROOM_IDS, isCrazyRoom, ROOM_CHALLENGES, roomLock, roomsOpenedBy } from '../src/game/rooms';
import { pressScore, RoomBattle, TURN_BARS } from '../src/game/roomBattle';
import { cleanLook, loadScenes, pickMoment, roomShow, routeStems, saveScene, SCENE_SLOTS, type RoomMoment } from '../src/three/venues/rooms/kit';
import { scaleNote, splitBeam } from '../src/three/venues/rooms/lasergrid';
import { CRAZY_ROOMS } from '../src/three/venues/rooms';
import { VENUES } from '../src/three/venues';

function set(o: Partial<SetSummary> = {}): SetSummary {
  return {
    venue: 'basement',
    slot: 'peak',
    minutes: 20,
    grade: 'B',
    average: 0.62,
    encore: false,
    full: true,
    transitions: 3,
    bassSwaps: 1,
    longBlends: 1,
    filterFades: 1,
    echoOuts: 0,
    perfect: 1,
    keyMixes: 3,
    drops: 4,
    mistakes: 2,
    slotMatch: 0.7,
    avgEnergy: 0.6,
    fullMinute: false,
    peakVibe: 0.85,
    board: 'starter2',
    ...o,
  };
}

const MOMENTS: RoomMoment[] = [
  { id: 'fold', label: 'Fold', energy: 'big' },
  { id: 'ripple', label: 'Ripple', energy: 'big' },
  { id: 'spin', label: 'Spin', energy: 'deep' },
];

describe('the crazy rooms as venues', () => {
  it('there are twelve, each a venue with its own id and a challenge to open it', () => {
    expect(CRAZY_ROOMS).toHaveLength(12);
    expect(CRAZY_ROOM_IDS).toHaveLength(12);
    for (const r of CRAZY_ROOMS) {
      expect(isCrazyRoom(r.id)).toBe(true);
      expect(VENUES.some((v) => v.id === r.id)).toBe(true);
      expect(ROOM_CHALLENGES.some((c) => c.id === r.id)).toBe(true);
    }
    expect(new Set(CRAZY_ROOM_IDS).size).toBe(12);
    expect(isCrazyRoom('basement')).toBe(false);
  });

  it('a room is locked behind its challenge until a set opens it, and the sandbox opens them all', () => {
    const p: Progress = PROGRESS.defaults();
    expect(roomLock('mirror', p)).toMatch(/^Secret room: finish a set with an A/);
    expect(venueLock('mirror', p)).toBe(roomLock('mirror', p));
    expect(roomLock('mirror', { ...p, sandbox: true })).toBeNull();
    expect(roomLock('mirror', { ...p, unlocked: ['room:mirror'] })).toBeNull();
  });

  it('a set opens the rooms whose challenges it meets, once', () => {
    const p: Progress = PROGRESS.defaults();
    const s = set({ grade: 'A', venue: 'beach', mistakes: 0, encore: true });
    const opened = roomsOpenedBy(s, { ...p, setsPlayed: 1, venuesPlayed: ['beach'] });
    expect(opened.keys).toEqual(expect.arrayContaining(['room:mirror', 'room:water', 'room:glitch', 'room:upsidedown']));
    expect(opened.keys).not.toContain('room:kaleido');
    expect(opened.names).toContain('Infinity Mirror Room');
    // already open: not again
    expect(roomsOpenedBy(s, { ...p, setsPlayed: 1, venuesPlayed: [], unlocked: ['room:mirror'] }).keys).not.toContain('room:mirror');
  });

  it('applying a set adds the room unlocks and news', () => {
    const p: Progress = PROGRESS.defaults();
    const out = applySet(p, set({ venue: 'basement' }));
    expect(out.patch.unlocked).toContain('room:uv');
    expect(out.unlocked.some((u) => u.label.includes('UV Blacklight Room'))).toBe(true);
  });
});

describe('the room engine', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    roomShow.owned = null;
    roomShow.queue.length = 0;
    roomShow.held.clear();
  });

  it('stems drive the floor, walls and ceiling, swapped or all drums on request', () => {
    const parts = { drums: 0.9, melody: 0.4 };
    const s = { kick: 0, level: 0, vocal: 0.2, high: 0 };
    expect(routeStems(parts, s, 'stems')).toEqual({ floor: 0.9, walls: 0.4, ceil: 0.2 });
    expect(routeStems(parts, s, 'swap')).toEqual({ floor: 0.4, walls: 0.2, ceil: 0.9 });
    expect(routeStems(parts, s, 'drums')).toEqual({ floor: 0.9, walls: 0.9, ceil: 0.9 });
    // no stems yet: falls back to the kick and the highs
    const d = routeStems(undefined, { kick: 1, level: 0.5, vocal: 0, high: 0.5 }, 'stems');
    expect(d.floor).toBeGreaterThan(0.9);
    expect(d.walls).toBeCloseTo(0.5);
  });

  it('a chosen drop moment scores only when it suits the drop; Auto picks one that suits it', () => {
    expect(pickMoment(MOMENTS, 'fold', 0.9)).toMatchObject({ chosen: true, matched: true });
    expect(pickMoment(MOMENTS, 'fold', 0.3)).toMatchObject({ chosen: true, matched: false });
    expect(pickMoment(MOMENTS, 'spin', 0.3)).toMatchObject({ chosen: true, matched: true });
    const auto = pickMoment(MOMENTS, 'auto', 0.3)!;
    expect(auto.moment.id).toBe('spin');
    expect(auto.matched).toBe(false);
    expect(pickMoment(MOMENTS, 'auto', 0.9, 1)!.moment.id).toBe('ripple');
    expect(pickMoment([], 'auto', 1)).toBeNull();
  });

  it('a look is always complete and in range', () => {
    expect(cleanLook(null, 4)).toEqual({ mode: 0, hue: 0, level: 1, toggles: [] });
    expect(cleanLook({ mode: 9, hue: 2, level: 9, toggles: ['a', 3, 'b'] }, 4)).toEqual({ mode: 3, hue: 1, level: 1.5, toggles: ['a', 'b'] });
    expect(cleanLook({ mode: Number.NaN, level: 0 }, 4)).toMatchObject({ mode: 0, level: 0.2 });
  });

  it('scenes save to four slots per room and load back clean', () => {
    expect(loadScenes('mirror', 4)).toEqual(new Array(SCENE_SLOTS).fill(null));
    saveScene('mirror', 2, { mode: 2, hue: 0.5, level: 1.2, toggles: ['spin'] }, 4);
    const sc = loadScenes('mirror', 4);
    expect(sc[2]).toEqual({ mode: 2, hue: 0.5, level: 1.2, toggles: ['spin'] });
    expect(sc[0]).toBeNull();
    expect(loadScenes('fog', 4)[2]).toBeNull();
    saveScene('mirror', 2, null, 4);
    expect(loadScenes('mirror', 4)[2]).toBeNull();
  });

  it('in a Room Battle you can only press your own pads; the rival presses theirs', () => {
    const heard: string[] = [];
    const off = roomShow.onPress((id, from) => heard.push(`${from}:${id}`));
    roomShow.owned = ['spin', 'tilt'];
    expect(roomShow.press('fold')).toBe(false);
    expect(roomShow.press('spin')).toBe(true);
    expect(roomShow.press('fold', 'rival')).toBe(true);
    expect(heard).toEqual(['you:spin', 'rival:fold']);
    expect(roomShow.queue).toEqual(['spin', 'fold']);
    roomShow.release('spin');
    expect(roomShow.held.has('spin')).toBe(false);
    off();
  });
});

describe('the light grid', () => {
  it('a broken beam plays a note in the track’s key', () => {
    expect(scaleNote(0, false, 0)).toBe(60);
    expect(scaleNote(0, false, 2)).toBe(64);
    expect(scaleNote(9, true, 1)).toBe(72);
    expect(scaleNote(0, true, 5)).toBe(72);
    expect(scaleNote(0, true, -1)).toBe(58);
  });

  it('people break a beam into lit pieces, with a hit on each side of them', () => {
    expect(splitBeam(-2, 2, 0, [])).toEqual({ segs: [[-2, 2]], hits: [] });
    const one = splitBeam(-2, 2, 0, [{ x: 0, z: 0.1 }], 0.2);
    expect(one.segs).toEqual([
      [-2, -0.2],
      [0.2, 2],
    ]);
    expect(one.hits).toEqual([-0.2, 0.2]);
    // someone off the beam's line doesn't break it
    expect(splitBeam(-2, 2, 0, [{ x: 0, z: 1 }], 0.2).segs).toHaveLength(1);
  });
});

describe('Room Battle', () => {
  it('a press scores by timing: on the beat best, the downbeat better, just after a drop double', () => {
    expect(pressScore(0, 1, 99)).toBe(10);
    expect(pressScore(0.5, 1, 99)).toBeLessThan(5);
    expect(pressScore(0.02, 0, 99)).toBeGreaterThan(pressScore(0.02, 1, 99));
    expect(pressScore(0, 1, 0.5)).toBe(20);
  });

  it('turns change every 16 bars and the crowd votes after both', () => {
    const b = new RoomBattle('NOX', 0.5, () => 0.99);
    const frame = (bar: number, extra: Partial<Parameters<RoomBattle['update']>[0]> = {}) => b.update({ dt: 0.5, bar, beat: bar * 4, beatInBar: 0, playing: true, dropHit: false, vibe: 0.5, rivalActions: 3, ...extra });
    const run = (from: number, to: number) => {
      let last = frame(from);
      for (let bar = from + 1; bar <= to; bar++) last = frame(bar);
      return last;
    };
    expect(frame(0).turnChanged).toBeNull();
    expect(b.press(10, 0, 0)).toBeGreaterThan(0);
    // mashing scores nothing
    expect(b.press(10.1, 0, 0)).toBe(0);
    // a jump in the beat grid (a new track, a seek) doesn't count as bars played
    expect(frame(300).turnChanged).toBeNull();
    expect(run(301, 300 + TURN_BARS - 1).turnChanged).toBeNull();
    expect(frame(300 + TURN_BARS).turnChanged).toBe('rival');
    // not your turn: your presses don't count
    expect(b.press(20, 0, 0)).toBe(0);
    const out = run(301 + TURN_BARS, 300 + TURN_BARS * 2);
    expect(out.turnChanged).toBe('you');
    // the rival never pressed (rand 0.99), so you take the round
    expect(out.round).toEqual({ winner: 'you', you: 1, rival: 0 });
    expect(b.share()).toBe(1);
  });

  it('the rival plays on its own turn, on the beat', () => {
    const b = new RoomBattle('NOX', 1, () => 0.1);
    for (let bar = 0; bar <= TURN_BARS; bar++) b.update({ dt: 0.1, bar, beat: bar * 4, beatInBar: 0, playing: true, dropHit: false, vibe: 0, rivalActions: 3 });
    expect(b.turn).toBe('rival');
    const u = b.update({ dt: 0.1, bar: TURN_BARS, beat: TURN_BARS * 4 + 1, beatInBar: 1, playing: true, dropHit: false, vibe: 0, rivalActions: 3 });
    expect(u.rivalPress).toBe(0);
    // same beat: no second press
    expect(b.update({ dt: 0.1, bar: TURN_BARS, beat: TURN_BARS * 4 + 1.5, beatInBar: 1, playing: true, dropHit: false, vibe: 0, rivalActions: 3 }).rivalPress).toBeNull();
    expect(b.share()).toBe(0);
  });
});
