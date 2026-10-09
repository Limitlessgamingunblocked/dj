import { describe, expect, it } from 'vitest';
import { closeLoop, loopInPoint, MAX_MANUAL_BEATS } from '../src/audio/loops';

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
