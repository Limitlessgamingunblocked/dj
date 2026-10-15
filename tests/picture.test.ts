import { describe, expect, it } from 'vitest';
import {
  asciiCell,
  byteRange,
  cameraJumped,
  LIDAR_MAX,
  rangeByte,
  sweepAt,
  sweepRange,
  coverage,
  glyphAtlas,
  lidarCell,
  lidarFlood,
  RAMP,
  SCRAMBLE,
  scrambleAmount,
  SweepClock,
  sweepBeats,
  SYNTH_MAX_LIFT,
  SYNTH_LINES,
  SYNTH_REACH,
  synthJitter,
  synthLift,
  trailDecay,
  type CamPose,
} from '../src/three/picture';
import { approachLook, copyLook, LENS_LOOKS, LOOKS, replaced } from '../src/three/looks';
import { LONG_TAKES, LookDirector, SPECIAL, type Moment, type Take } from '../src/three/director';

describe('LiDAR scan: the sweep', () => {
  it('sweeps once a bar in the groove, faster as a build climbs', () => {
    expect(sweepBeats(0)).toBe(4);
    expect(sweepBeats(0.4)).toBe(4);
    expect(sweepBeats(0.7)).toBe(2);
    expect(sweepBeats(0.95)).toBe(1);
  });

  it('leaves the camera on the downbeat and reaches the far end at the bar line', () => {
    const c = new SweepClock();
    expect(c.update(8, 0, true, 0)).toBeCloseTo(0, 6);
    expect(c.update(10, 0, true, 0)).toBeCloseTo(0.5, 6);
    expect(c.update(11.96, 0, true, 0)).toBeGreaterThan(0.98);
    expect(c.update(12.01, 0, true, 0)).toBeLessThan(0.01);
  });

  it('sweeps twice a bar in a build, and changes speed only on the bar line (the plane never jumps)', () => {
    const c = new SweepClock();
    let prev = c.update(0, 0, true, 0);
    let wraps = 0;
    // the build comes in halfway through bar 0: the speed holds until bar 1
    for (let i = 1; i <= 800; i++) {
      const beat = i * 0.01;
      const p = c.update(beat, beat > 2 ? 0.7 : 0, true, 0);
      if (beat < 4) expect(c.beats).toBe(4);
      else expect(c.beats).toBe(2);
      if (p < prev) wraps++;
      // between frames it only moves forward a little, or starts again from the camera
      else expect(p - prev).toBeLessThan(0.02);
      prev = p;
    }
    // bar 0: one sweep (wraps at beat 4); bar 1: two (beat 6 and 8)
    expect(wraps).toBe(3);
  });

  it('keeps sweeping on its own clock with nothing playing', () => {
    const c = new SweepClock();
    const a = c.update(0, 0, false, 0.5);
    const b = c.update(0, 0, false, 0.5);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });

  it('floods the room on the drop, and with reduce flashing only swells softly', () => {
    expect(lidarFlood(0, false)).toBeCloseTo(1, 6);
    expect(lidarFlood(1.2, false)).toBeLessThan(0.05);
    expect(lidarFlood(1e9, false)).toBe(0);
    // reduce flashing: no hard flash, starts from nothing and stays low
    expect(lidarFlood(0, true)).toBe(0);
    let peak = 0;
    let prev = 0;
    let maxStep = 0;
    for (let t = 0; t < 3; t += 1 / 60) {
      const v = lidarFlood(t, true);
      peak = Math.max(peak, v);
      maxStep = Math.max(maxStep, v - prev);
      prev = v;
    }
    expect(peak).toBeLessThan(0.35);
    expect(peak).toBeGreaterThan(0.15);
    // never more than a small step brighter in one frame
    expect(maxStep).toBeLessThan(0.05);
  });

  it('crosses the shot from its nearest things to its far ones in even steps', () => {
    expect(sweepAt(2, 2, 14)).toBe(0);
    expect(sweepAt(14, 2, 14)).toBe(1);
    expect(sweepAt(0.5, 2, 14)).toBe(0);
    expect(sweepAt(99, 2, 14)).toBe(1);
    let prev = -1;
    for (let d = 2; d <= 14; d += 0.5) {
      const z = sweepAt(d, 2, 14);
      expect(z).toBeGreaterThan(prev);
      prev = z;
    }
    // log: the near metres take more of the sweep than the far ones
    expect(sweepAt(5, 2, 14) - sweepAt(2, 2, 14)).toBeGreaterThan(sweepAt(14, 2, 14) - sweepAt(11, 2, 14));
  });

  it('measures the shot’s range from its nearest and farthest returns, ignoring the sky', () => {
    const cells = 16 * 9;
    const bytes = new Uint8Array(cells * 4);
    for (let i = 0; i < cells; i++) {
      // the top third of the frame is sky: no return
      if (i < 48) continue;
      bytes[i * 4] = rangeByte(3 + (i % 10));
      bytes[i * 4 + 1] = rangeByte(6 + (i % 10));
      bytes[i * 4 + 2] = 255;
    }
    const r = sweepRange(bytes, cells)!;
    expect(r.near).toBeGreaterThan(2.5);
    expect(r.near).toBeLessThan(5);
    expect(r.far).toBeGreaterThan(12);
    expect(r.far).toBeLessThan(17);
    // byte encoding round-trips closely enough
    expect(byteRange(rangeByte(10))).toBeCloseTo(10, 0);
    // all sky: nothing to go on
    expect(sweepRange(new Uint8Array(cells * 4), cells)).toBe(null);
    // never past the scanner's reach, and never a sweep of nothing
    bytes.fill(0);
    for (let i = 0; i < cells; i++) {
      bytes[i * 4] = rangeByte(30);
      bytes[i * 4 + 1] = rangeByte(150);
      bytes[i * 4 + 2] = 255;
    }
    const far = sweepRange(bytes, cells)!;
    expect(far.far).toBeLessThanOrEqual(LIDAR_MAX);
    expect(far.far - far.near).toBeGreaterThanOrEqual(3);
  });

  it('puts about 96 rows of dots on any frame', () => {
    for (const h of [360, 720, 1080, 2160]) {
      const rows = h / lidarCell(h);
      expect(rows).toBeGreaterThan(80);
      expect(rows).toBeLessThan(120);
    }
  });
});

describe('ASCII club', () => {
  it('draws about a hundred columns at any resolution', () => {
    for (const w of [640, 800, 1024, 1280, 1366, 1920, 2560, 3840, 4096]) {
      const cols = w / asciiCell(w);
      expect(cols).toBeGreaterThanOrEqual(80);
      expect(cols).toBeLessThanOrEqual(120);
    }
  });

  it('scrambles nothing in the groove, more as the build climbs, and snaps back clean on the drop', () => {
    expect(scrambleAmount(0, 100)).toBe(0);
    expect(scrambleAmount(0.25, 100)).toBe(0);
    let prev = 0;
    for (let b = 0.3; b <= 1; b += 0.05) {
      const s = scrambleAmount(b, 100);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    // most of the frame at the top of the build, never all of it
    expect(scrambleAmount(1, 100)).toBeGreaterThan(0.6);
    expect(scrambleAmount(1, 100)).toBeLessThan(1);
    // the drop: clean straight away, even if the build hasn't let go yet
    expect(scrambleAmount(1, 0)).toBe(0);
    expect(scrambleAmount(1, 1)).toBe(0);
  });

  it('has glyphs that get brighter along the ramp, all 5 x 5', () => {
    for (const g of [...RAMP, ...SCRAMBLE]) {
      expect(g).toHaveLength(5);
      for (const row of g) expect(row).toMatch(/^[.#]{5}$/);
    }
    expect(coverage(RAMP[0])).toBe(0);
    for (let i = 1; i < RAMP.length; i++) expect(coverage(RAMP[i])).toBeGreaterThanOrEqual(coverage(RAMP[i - 1]));
    expect(coverage(RAMP[RAMP.length - 1])).toBeGreaterThan(18);
    // the scrambled glyphs read as characters, not as blanks
    for (const g of SCRAMBLE) expect(coverage(g)).toBeGreaterThan(4);
  });

  it('packs the glyphs into one strip, top row first', () => {
    const a = glyphAtlas();
    expect(a.width).toBe((RAMP.length + SCRAMBLE.length) * 5);
    expect(a.height).toBe(5);
    expect(a.data.length).toBe(a.width * 5 * 4);
    // '.' (ramp 1): only the middle of the bottom row is lit
    const lit = (glyph: number, row: number, col: number) => a.data[(row * a.width + glyph * 5 + col) * 4] > 0;
    expect(lit(1, 4, 2)).toBe(true);
    expect(lit(1, 0, 2)).toBe(false);
    expect(lit(0, 2, 2)).toBe(false);
  });
});

describe('scanline club (video synth)', () => {
  it('lifts harder on the drop than on a kick, and never further than the shader looks', () => {
    const rest = synthLift(0, 0);
    const kick = synthLift(1, 0);
    const drop = synthLift(1, 1);
    expect(kick).toBeGreaterThan(rest);
    expect(drop - kick).toBeGreaterThan(kick - rest);
    expect(drop).toBeLessThanOrEqual(SYNTH_MAX_LIFT);
    expect(SYNTH_MAX_LIFT * SYNTH_LINES).toBeLessThanOrEqual(SYNTH_REACH - 1);
    expect(synthLift(5, 5)).toBeLessThanOrEqual(SYNTH_MAX_LIFT);
  });

  it('jitters sideways only in a build', () => {
    expect(synthJitter(0)).toBe(0);
    expect(synthJitter(0.35)).toBe(0);
    expect(synthJitter(0.8)).toBeGreaterThan(0);
    expect(synthJitter(1)).toBeGreaterThan(synthJitter(0.8));
    expect(synthJitter(1)).toBeLessThan(0.06);
  });
});

describe('long exposure', () => {
  const pose = (x: number, yaw: number, fov = 40): CamPose => ({ pos: [x, 1.6, 4], dir: [Math.sin(yaw), 0, -Math.cos(yaw)], fov });

  it('fades a trail over a second or two, the same at any frame rate', () => {
    expect(trailDecay(0)).toBe(1);
    // a lamp's trail (about 5 at exposure 1) is under the trail threshold within two seconds
    expect(5 * trailDecay(2)).toBeLessThan(0.5);
    expect(5 * trailDecay(0.5)).toBeGreaterThan(1.5);
    let k60 = 1;
    for (let i = 0; i < 60; i++) k60 *= trailDecay(1 / 60);
    let k20 = 1;
    for (let i = 0; i < 20; i++) k20 *= trailDecay(1 / 20);
    expect(k60).toBeCloseTo(k20, 6);
  });

  it('starts again on a cut or a jump, not on a camera move', () => {
    const dt = 1 / 60;
    // a dolly at 3 m/s, a pan at 60°/s, the drop's punch-in: smooth moves
    expect(cameraJumped(pose(0, 0), pose(3 * dt, 0), dt)).toBe(false);
    expect(cameraJumped(pose(0, 0), pose(0, (Math.PI / 3) * dt), dt)).toBe(false);
    expect(cameraJumped(pose(0, 0, 40), pose(0, 0, 39), dt)).toBe(false);
    // a slow frame of the same moves is still a move
    expect(cameraJumped(pose(0, 0), pose(0.3, 0.1), 0.1)).toBe(false);
    // cuts: across the room, to another side of the booth, to a long lens
    expect(cameraJumped(pose(0, 0), pose(6, 0), dt)).toBe(true);
    expect(cameraJumped(pose(0, 0), pose(0.1, 1.2), dt)).toBe(true);
    expect(cameraJumped(pose(0, 0, 40), pose(0, 0, 18), dt)).toBe(true);
    // nonsense in, start again
    expect(cameraJumped(pose(0, 0), pose(Number.NaN, 0), dt)).toBe(true);
  });
});

describe('the four looks in the camera menu', () => {
  it('are listed, and each draws only its own thing', () => {
    const ids = LENS_LOOKS.map((l) => l.id);
    for (const id of ['lidar', 'scanline', 'ascii', 'longexposure'] as const) expect(ids).toContain(id);
    expect(LOOKS.lidar.lidar).toBe(1);
    expect(LOOKS.scanline.synth).toBe(1);
    expect(LOOKS.ascii.ascii).toBe(1);
    expect(LOOKS.longexposure.trails).toBe(1);
    expect(replaced(LOOKS.longexposure)).toBe(0);
    expect(replaced(LOOKS.ascii)).toBe(1);
    for (const l of LENS_LOOKS) if (!['lidar', 'scanline', 'ascii', 'longexposure'].includes(l.id)) expect([LOOKS[l.id].lidar, LOOKS[l.id].synth, LOOKS[l.id].ascii, LOOKS[l.id].trails]).toEqual([0, 0, 0, 0]);
  });

  it('blend in and out like the others', () => {
    const cur = copyLook(LOOKS.none);
    approachLook(cur, LOOKS.lidar, 0.5);
    expect(cur.lidar).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 60; i++) approachLook(cur, LOOKS.ascii, 0.3);
    expect(cur.lidar).toBeLessThan(1e-4);
    expect(cur.ascii).toBeCloseTo(1, 4);
  });
});

describe('the director’s special looks', () => {
  const seeded = (seed = 11) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const take = (id: Take['id']): Take => ({ id, landmark: 0, side: 1, seconds: 16, cut: 'hard' });

  it('cuts some drops to LiDAR or ASCII, never two drops running, never within a few minutes', () => {
    const d = new LookDirector(seeded());
    let looks = 0;
    let prevHad = false;
    let lastAt = -1e9;
    // a drop every 100 s for a long night
    for (let i = 0; i < 60; i++) {
      const t = i * 100;
      const bar = i * 50;
      d.onTake(take('pullback'), 'drop', t, bar);
      const l = d.update(true, bar);
      if (l) {
        expect(['lidar', 'ascii']).toContain(l);
        expect(prevHad).toBe(false);
        expect(t - lastAt).toBeGreaterThanOrEqual(SPECIAL.gap);
        lastAt = t;
        looks++;
      }
      prevHad = !!l;
      // it's over after its few bars
      expect(d.update(true, bar + SPECIAL.dropBars)).toBe(null);
    }
    // some drops, not every one, and not one in two
    expect(looks).toBeGreaterThan(5);
    expect(looks).toBeLessThan(25);
  });

  it('holds a drop’s look through the montage’s cuts, for its bars', () => {
    const d = new LookDirector(() => 0);
    d.onTake(take('pullback'), 'drop', 1000, 100);
    const l = d.update(true, 100);
    expect(l).not.toBe(null);
    d.onTake(take('reverse'), 'burst', 1002, 101);
    expect(d.update(true, 101)).toBe(l);
    d.onTake(take('crowd'), 'burst', 1004, 102);
    expect(d.update(true, 103)).toBe(l);
    expect(d.update(true, 104)).toBe(null);
    // stopping the music ends it too
    const e = new LookDirector(() => 0);
    e.onTake(take('pullback'), 'drop', 1000, 100);
    expect(e.update(false, 100)).toBe(null);
  });

  it('runs a long exposure only on a slow wide shot in a groove, until the next cut', () => {
    const d = new LookDirector(() => 0);
    const moments: Moment[] = ['build', 'peak', 'mix', 'breakdown', 'tension'];
    for (const m of moments) {
      d.onTake(take('wide'), m, 1000, 10);
      expect(d.update(true, 10)).toBe(null);
    }
    d.onTake(take('hands'), 'groove', 1000, 10);
    expect(d.update(true, 10)).toBe(null);
    expect(LONG_TAKES).toContain('wide');
    d.onTake(take('wide'), 'groove', 1000, 10);
    expect(d.update(true, 12)).toBe('longexposure');
    // the next cut ends it, and the next one waits out the gap
    d.onTake(take('aerial'), 'groove', 1010, 18);
    expect(d.update(true, 18)).toBe(null);
    d.onTake(take('aerial'), 'groove', 1000 + SPECIAL.gap - 1, 60);
    expect(d.update(true, 60)).toBe(null);
    d.onTake(take('aerial'), 'groove', 1000 + SPECIAL.gap + 1, 80);
    expect(d.update(true, 80)).toBe('longexposure');
  });

  it('leaves most groove shots alone', () => {
    const d = new LookDirector(seeded(5));
    let on = 0;
    let n = 0;
    for (let i = 0; i < 400; i++) {
      d.onTake(take(LONG_TAKES[i % LONG_TAKES.length]), 'groove', i * 32, i * 16);
      if (d.update(true, i * 16)) on++;
      n++;
    }
    expect(on / n).toBeLessThan(0.2);
    expect(on).toBeGreaterThan(0);
  });
});
