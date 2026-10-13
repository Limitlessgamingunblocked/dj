import { describe, expect, it } from 'vitest';
import { AirDJ, classify, type AirTarget, type Pose, type Pt, type Side } from '../src/app/airdj/gestures';

/** a made-up hand of 21 landmarks: wrist at (cx, cy), about 0.1 of the picture from wrist to knuckles */
function hand(pose: Exclude<Pose, 'none'>, cx = 0.3, cy = 0.6): Pt[] {
  const p = (x: number, y: number): Pt => ({ x: cx + x, y: cy + y });
  const mcps: [number, number][] = [
    [-0.03, -0.09],
    [0, -0.1],
    [0.025, -0.095],
    [0.05, -0.085],
  ];
  const out = { pinch: [false, false, false, false], open: [true, true, true, true], peace: [true, true, false, false], point: [true, false, false, false], fist: [false, false, false, false] }[pose];
  const finger = ([x, y]: [number, number], ext: boolean): Pt[] => (ext ? [p(x, y), p(x, y - 0.04), p(x, y - 0.065), p(x, y - 0.09)] : [p(x, y), p(x, y - 0.03), p(x, y - 0.01), p(x, y + 0.02)]);
  const fingers = mcps.map((m, i) => finger(m, out[i]));
  let thumbTip = p(-0.07, -0.08);
  if (pose === 'pinch') {
    // the index half bent, the thumb tip on it
    fingers[0] = [p(-0.03, -0.09), p(-0.03, -0.13), p(-0.04, -0.145), p(-0.05, -0.15)];
    thumbTip = p(-0.055, -0.145);
  }
  return [p(0, 0), p(-0.03, -0.02), p(-0.05, -0.04), p(-0.06, -0.06), thumbTip, ...fingers.flat()];
}

class Fake implements AirTarget {
  jog: Record<Side, boolean> = { L: false, R: false };
  revs: Record<Side, number> = { L: 0, R: 0 };
  filt: Record<Side, number> = { L: 0.5, R: 0.5 };
  fxOn: Record<Side, boolean> = { L: false, R: false };
  depth = 0.5;
  xf = 0.5;
  ups = 0;
  touchJog(side: Side, on: boolean) {
    this.jog[side] = on;
  }
  turnJog(side: Side, revs: number) {
    this.revs[side] += revs;
  }
  filter(side: Side) {
    return this.filt[side];
  }
  setFilter(side: Side, v: number) {
    this.filt[side] = v;
  }
  fx(side: Side, on: boolean) {
    this.fxOn[side] = on;
  }
  setFxDepth(v: number) {
    this.depth = v;
  }
  crossfader() {
    return this.xf;
  }
  setCrossfader(v: number) {
    this.xf = v;
  }
  handsUp() {
    this.ups++;
  }
}

const DT = 1 / 30;
/** a few frames of the same hands, so a new pose settles */
function hold(air: AirDJ, hands: Pt[][], frames = 4) {
  let v = air.update(hands, DT);
  for (let i = 1; i < frames; i++) v = air.update(hands, DT);
  return v;
}

describe('Air DJ poses', () => {
  it('tells the six hand shapes apart', () => {
    for (const pose of ['pinch', 'open', 'peace', 'point', 'fist'] as const) expect(classify(hand(pose))).toBe(pose);
  });

  it('works on a small (far away) hand as well as a big one', () => {
    const small = hand('open').map((q) => ({ x: 0.5 + (q.x - 0.3) * 0.4, y: 0.5 + (q.y - 0.6) * 0.4 }));
    expect(classify(small)).toBe('open');
  });

  it('keeps a pinch closed until the fingers are clearly apart', () => {
    const lm = hand('pinch');
    // open the pinch a little: past the closing threshold, inside the release one
    lm[4] = { x: lm[8].x - 0.04, y: lm[8].y };
    expect(classify(lm, false)).not.toBe('pinch');
    expect(classify(lm, true)).toBe('pinch');
  });
});

describe('Air DJ moves', () => {
  it('scratches: a pinch grabs the record, moving the hand turns it, letting go drops it', () => {
    const t = new Fake();
    const air = new AirDJ(t);
    hold(air, [hand('pinch', 0.3)]);
    expect(t.jog.L).toBe(true);
    for (let i = 1; i <= 10; i++) air.update([hand('pinch', 0.3 + i * 0.01)], DT);
    expect(t.revs.L).toBeGreaterThan(0.03);
    const back = t.revs.L;
    for (let i = 9; i >= 0; i--) air.update([hand('pinch', 0.3 + i * 0.01)], DT);
    expect(t.revs.L).toBeLessThan(back);
    hold(air, [hand('fist', 0.3)]);
    expect(t.jog.L).toBe(false);
    expect(t.jog.R).toBe(false);
  });

  it('sweeps the filter from where it is, and glides it back to off when the palm goes', () => {
    const t = new Fake();
    const air = new AirDJ(t);
    hold(air, [hand('open', 0.7, 0.75)]);
    // no jump when the palm appears, low in the picture
    expect(t.filt.R).toBe(0.5);
    for (let i = 1; i <= 10; i++) air.update([hand('open', 0.7, 0.75 - i * 0.02)], DT);
    expect(t.filt.R).toBeGreaterThan(0.7);
    for (let i = 0; i < 6; i++) air.update([], DT);
    for (let i = 0; i < 20; i++) air.update([], DT);
    expect(t.filt.R).toBe(0.5);
    expect(t.filt.L).toBe(0.5);
  });

  it('holds the beat FX on while the peace sign is up', () => {
    const t = new Fake();
    const air = new AirDJ(t);
    hold(air, [hand('peace', 0.3, 0.5)]);
    expect(t.fxOn.L).toBe(true);
    const low = t.depth;
    hold(air, [hand('peace', 0.3, 0.35)]);
    expect(t.depth).toBeGreaterThan(low);
    hold(air, [hand('fist', 0.3, 0.35)]);
    expect(t.fxOn.L).toBe(false);
  });

  it('slides the crossfader with a pointing finger, one hand at a time', () => {
    const t = new Fake();
    const air = new AirDJ(t);
    hold(air, [hand('point', 0.3), hand('fist', 0.7)]);
    for (let i = 1; i <= 10; i++) air.update([hand('point', 0.3 + i * 0.01), hand('fist', 0.7)], DT);
    expect(t.xf).toBeGreaterThan(0.6);
    const xf = t.xf;
    // the other hand points too: the first keeps the fader
    hold(air, [hand('point', 0.4), hand('point', 0.9)]);
    expect(t.xf).toBeCloseTo(xf, 1);
  });

  it('gives each side its own hand', () => {
    const t = new Fake();
    const air = new AirDJ(t);
    const v = hold(air, [hand('open', 0.8), hand('pinch', 0.2)]);
    expect(t.jog.L).toBe(true);
    expect(t.jog.R).toBe(false);
    expect(v.map((x) => `${x.side}:${x.pose}`).sort()).toEqual(['L:pinch', 'R:open']);
  });

  it('fires "hands up" once for both palms up high, then waits', () => {
    const t = new Fake();
    const air = new AirDJ(t);
    const up = [hand('open', 0.3, 0.25), hand('open', 0.7, 0.25)];
    hold(air, up, 30);
    expect(t.ups).toBe(1);
    // the filters stayed put up there
    expect(t.filt.L).toBe(0.5);
    expect(t.filt.R).toBe(0.5);
  });

  it('lets everything go when the camera stops', () => {
    const t = new Fake();
    const air = new AirDJ(t);
    hold(air, [hand('pinch', 0.3), hand('peace', 0.7)]);
    expect(t.jog.L && t.fxOn.R).toBe(true);
    air.release();
    expect(t.jog.L).toBe(false);
    expect(t.fxOn.R).toBe(false);
  });
});
