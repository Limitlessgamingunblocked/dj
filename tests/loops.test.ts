import { describe, expect, it } from 'vitest';
import { autoLoopStart, closeLoop, HOLD_FOR_LOOP, loopInPoint, MAX_MANUAL_BEATS, wrapInLoop } from '../src/audio/loops';

const grid = { firstBeat: 0.2, beatLen: 0.5 };

describe('manual loops', () => {
  it('with quantize, IN lands on the nearest beat', () => {
    expect(loopInPoint(10.31, grid, true)).toBeCloseTo(10.2);
    expect(loopInPoint(10.47, grid, true)).toBeCloseTo(10.7);
    expect(loopInPoint(10.31, grid, false)).toBe(10.31);
    expect(loopInPoint(0.01, grid, true)).toBeCloseTo(0.2);
  });

  it('with quantize, OUT makes a whole number of beats, never an off-beat 3.75', () => {
    // IN on a beat, OUT 1.9 s (3.8 beats) later: four beats
    expect(closeLoop(10.2, 12.1, grid, true)).toEqual({ start: 10.2, end: 12.2 });
    // a quick IN/OUT is still at least a beat
    const short = closeLoop(10.2, 10.25, grid, true)!;
    expect(short.end - short.start).toBeCloseTo(0.5);
    // without quantize it's exactly where you pressed
    expect(closeLoop(10.31, 12.12, grid, false)).toEqual({ start: 10.31, end: 12.12 });
  });

  it('an IN left far behind, or none at all, does not make the loop (OUT then loops from here)', () => {
    expect(closeLoop(null, 20, grid, true)).toBeNull();
    expect(closeLoop(10, 10 + grid.beatLen * (MAX_MANUAL_BEATS + 1), grid, true)).toBeNull();
    // an IN snapped just ahead of the playhead still closes (a beat long)
    const ahead = closeLoop(10.7, 10.55, grid, true)!;
    expect(ahead.start).toBe(10.7);
    expect(ahead.end - ahead.start).toBeCloseTo(0.5);
    // but not one well ahead
    expect(closeLoop(15, 10, grid, true)).toBeNull();
  });
});

describe('auto loops and the playhead', () => {
  it('an auto loop starts on the beat you are on, not back at the bar line', () => {
    // 3.8 beats into a bar (bar starts at 10.2): a 4-beat loop starts on the next beat, not 1.9 s back
    expect(autoLoopStart(12.1, grid, true, 4)).toBeCloseTo(12.2);
    // early in a beat: that beat
    expect(autoLoopStart(11.25, grid, true, 4)).toBeCloseTo(11.2);
    // rolls shorter than a beat start inside their own length, so the playhead is in them
    const roll = autoLoopStart(11.33, grid, true, 0.25);
    expect(roll).toBeLessThanOrEqual(11.33);
    expect(11.33 - roll).toBeLessThan(0.125);
    // no quantize: right here
    expect(autoLoopStart(11.33, grid, false, 4)).toBe(11.33);
  });

  it('IN is held long enough for a 4-beat loop in well under a second', () => {
    expect(HOLD_FOR_LOOP).toBeGreaterThan(0.3);
    expect(HOLD_FOR_LOOP).toBeLessThan(1);
  });

  it('the playhead between reports stays inside the loop it is playing', () => {
    const loop = { active: true, start: 10, end: 12 };
    expect(wrapInLoop(11.95, 12.05, loop, true)).toBeCloseTo(10.05);
    expect(wrapInLoop(11.5, 11.6, loop, true)).toBeCloseTo(11.6);
    // not in the loop (or not looping): left alone
    expect(wrapInLoop(12.5, 12.6, loop, true)).toBeCloseTo(12.6);
    expect(wrapInLoop(11.95, 12.05, { ...loop, active: false }, true)).toBeCloseTo(12.05);
    // a loop just ahead of the playhead: plays into it, wraps at its end
    expect(wrapInLoop(9.9, 9.95, loop, true)).toBeCloseTo(9.95);
  });
});
