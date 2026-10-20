import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deck } from '../src/audio/Deck';
import { downbeatAt, GridEditor, gridOffset, JOG_BEATS_PER_REV, nearestBeat, slideGrid, snapOffset, stretchGrid, type Grid } from '../src/app/gridEdit';
import { Emitter } from '../src/core/emitter';
import { detectSections } from '../src/game/sections';
import type { LibraryTrack, TrackAnalysis } from '../src/core/types';

const g120: Grid = { bpm: 120, firstBeat: 0.3 };

describe('grid edit maths', () => {
  it('slides every beat by the same amount', () => {
    expect(slideGrid(g120, 0.012)).toEqual({ bpm: 120, firstBeat: 0.312 });
    expect(nearestBeat(slideGrid(g120, -0.02), 60.31)).toBeCloseTo(60.28);
  });

  it('stretches the tempo around the playhead: the beat there stays put', () => {
    const at = 90.31;
    const before = nearestBeat(g120, at);
    const g = stretchGrid(g120, 120.5, at);
    expect(g.bpm).toBe(120.5);
    expect(nearestBeat(g, at)).toBeCloseTo(before, 9);
    // beats far from the playhead move
    expect(nearestBeat(g, 1)).not.toBeCloseTo(nearestBeat(g120, 1), 3);
  });

  it('bar 1 here keeps the first downbeat near where it was', () => {
    const g = downbeatAt(g120, 61.3);
    expect(g.bpm).toBe(120);
    // 61.3 is now a downbeat: a whole number of bars from firstBeat
    expect(((61.3 - g.firstBeat) / 2) % 1).toBeCloseTo(0, 9);
    expect(Math.abs(g.firstBeat - g120.firstBeat)).toBeLessThanOrEqual(1);
    // one beat later than the old downbeats
    expect(downbeatAt(g120, 60.8).firstBeat).toBeCloseTo(0.8);
  });

  it('measures how far the grid moved at the playhead', () => {
    expect(gridOffset(slideGrid(g120, 0.015), g120, 40)).toBeCloseTo(0.015);
    expect(gridOffset(slideGrid(g120, -0.04), g120, 40)).toBeCloseTo(-0.04);
  });
});

/** a waveform with a kick (low band and full peak) on every beat of a 120 BPM track starting at `kick0` */
function kicks(kick0: number, seconds = 120, rate = 150): Pick<TrackAnalysis, 'waveform' | 'waveRate'> {
  const n = seconds * rate;
  const wf = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    wf[i * 4] = 20;
    wf[i * 4 + 1] = 40;
    wf[i * 4 + 2] = 30;
    wf[i * 4 + 3] = 45;
  }
  for (let t = kick0; t < seconds; t += 0.5) {
    const i = Math.round(t * rate);
    for (let k = 0; k < 4 && i + k < n; k++) {
      wf[(i + k) * 4] = 230 - k * 40;
      wf[(i + k) * 4 + 3] = 240 - k * 40;
    }
  }
  return { waveform: wf, waveRate: rate };
}

describe('snap to the beats', () => {
  it('finds how far off the grid is from the kicks', () => {
    const a = kicks(0.34);
    const off = snapOffset(a, g120, 60);
    expect(Math.abs(0.3 + off - 0.34)).toBeLessThan(0.006);
    const late = snapOffset(a, { bpm: 120, firstBeat: 0.39 }, 60);
    expect(Math.abs(0.39 + late - 0.34)).toBeLessThan(0.006);
  });

  it('leaves a grid that already fits alone, and gives up on silence', () => {
    expect(Math.abs(snapOffset(kicks(0.3), g120, 60))).toBeLessThan(0.004);
    const silent = { waveform: new Uint8Array(150 * 60 * 4), waveRate: 150 };
    expect(snapOffset(silent, g120, 30)).toBe(0);
  });
});

class FakeDeck extends Emitter<{ loaded: Deck; change: Deck }> {
  id = 1;
  loaded = true;
  pos = 30.3;
  gridJog: ((revs: number) => void) | null = null;
  track: LibraryTrack;
  analysis: TrackAnalysis;
  constructor() {
    super();
    this.analysis = { bpm: 120, firstBeat: 0.3, ...kicks(0.32, 60) } as TrackAnalysis;
    this.track = { id: 't1', analysis: this.analysis } as LibraryTrack;
  }
  get beatLen() {
    return 60 / this.analysis.bpm;
  }
  displayPosition() {
    return this.pos;
  }
  jogTouch() {}
}

describe('grid editor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const d = new FakeDeck();
    const save = vi.fn();
    const ed = new GridEditor([d as unknown as Deck], save);
    return { d, deck: d as unknown as Deck, save, ed };
  };

  it('takes over the jog while on: a turn slides the grid, not the music', () => {
    const { d, deck, ed } = setup();
    expect(ed.start(deck)).toBe(true);
    expect(ed.active(deck)).toBe(true);
    d.gridJog!(0.1);
    expect(d.analysis.firstBeat).toBeCloseTo(0.3 + 0.1 * JOG_BEATS_PER_REV * 0.5);
    ed.stop(deck);
    expect(d.gridJog).toBeNull();
  });

  it('saves once the edits settle, and on leaving', () => {
    const { deck, save, ed } = setup();
    ed.start(deck);
    for (let i = 0; i < 10; i++) ed.nudge(deck, 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].firstBeat).toBeCloseTo(0.35);
    ed.nudge(deck, -1);
    ed.stop(deck);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1].firstBeat).toBeCloseTo(0.345);
  });

  it('reset goes back to the grid from when grid edit started', () => {
    const { d, deck, ed } = setup();
    ed.start(deck);
    ed.tempo(deck, 1, true);
    ed.halfBeat(deck);
    expect(d.analysis.bpm).toBeCloseTo(120.1);
    ed.reset(deck);
    expect(d.analysis).toMatchObject({ bpm: 120, firstBeat: 0.3 });
    expect(ed.offset(deck)).toBeCloseTo(0);
  });

  it('snap lines the grid up with the kicks and reports the move', () => {
    const { d, deck, ed } = setup();
    expect(ed.snap(deck)).toBe(true);
    expect(d.analysis.firstBeat).toBeCloseTo(0.32, 2);
    expect(ed.offset(deck) * 1000).toBeCloseTo(20, -1);
  });

  it('loading another track ends grid edit and saves the old track', () => {
    const { d, deck, save, ed } = setup();
    ed.start(deck);
    ed.nudge(deck, 1);
    const old = d.track;
    d.track = { id: 't2', analysis: { ...d.analysis } } as LibraryTrack;
    d.emit('loaded', deck);
    expect(ed.active(deck)).toBe(false);
    expect(save).toHaveBeenCalledWith(old, expect.objectContaining({ firstBeat: expect.closeTo(0.305, 6) }));
  });

  it('song sections move with the grid', () => {
    const { d, deck, ed } = setup();
    d.analysis.duration = 60;
    const before = detectSections(d.analysis)!;
    expect(before.length).toBeGreaterThan(1);
    ed.slide(deck, 0.1);
    const after = detectSections(d.analysis)!;
    expect(after[1].t - before[1].t).toBeCloseTo(0.1);
  });
});
