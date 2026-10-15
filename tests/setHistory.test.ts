import { describe, expect, it } from 'vitest';
import { filmNotch, negativeAt, NOTCH_EASE } from '../src/visualizer/modes5';
import {
  ARC,
  BRAID_BEATS,
  BRAID_R,
  braidOffset,
  CAP,
  density,
  halve,
  pickRibbonColor,
  place,
  QUIET_CLOSE,
  rung,
  SetHistory,
  setLabel,
  spiral,
  spiralAngle,
  STEP,
  type DeckFeed,
  type RGB,
} from '../src/visualizer/setHistory';

const BPM = 120;
const DT = 1 / 60;

/** play `beats` beats with these decks up, at 120 BPM and 60 frames a second */
function play(h: SetHistory, beats: number, decks: DeckFeed[], audio: { level?: number; kick?: (b: number) => number; sub?: number } = {}): void {
  const frames = Math.round((beats * 60) / BPM / DT);
  for (let i = 0; i < frames; i++) {
    const b = h.beat;
    h.record({ dt: DT, bpm: BPM, level: audio.level ?? 0.7, kick: audio.kick ? audio.kick(b) : Math.exp(-(b % 1) * 6), sub: audio.sub ?? 0.5, decks });
  }
}
const deck = (track: string | null, gain = 1, peak = 0.8): DeckFeed => ({ track, gain, peak });

describe('the set so far', () => {
  it('draws one ribbon for one track, four samples a beat, from its audio', () => {
    const h = new SetHistory();
    play(h, 32, [deck('a'), deck(null)]);
    expect(h.ribbons).toHaveLength(1);
    const r = h.ribbons[0];
    expect(r.n).toBe(1);
    expect(r.s.length).toBeGreaterThanOrEqual(32 / STEP - 2);
    expect(r.s.length).toBeLessThanOrEqual(32 / STEP + 1);
    expect(density(r)).toBeCloseTo(1 / STEP, 1);
    // the kick lands on the beat: the samples at the top of a beat carry it, the ones after don't
    const onBeat = r.s.map((s, i) => [s, r.kick[i]] as const).filter(([s]) => s % 1 === 0.25);
    const offBeat = r.s.map((s, i) => [s, r.kick[i]] as const).filter(([s]) => s % 1 === 0.75);
    const mean = (xs: (readonly [number, number])[]) => xs.reduce((a, [, k]) => a + k, 0) / xs.length;
    expect(mean(onBeat)).toBeGreaterThan(mean(offBeat) + 0.3);
    expect(r.level.every((v) => v > 0.6 && v <= 1)).toBe(true);
    expect(r.mix.every((v) => v === 0)).toBe(true);
  });

  it('stops the clock in silence and ignores a deck with its fader down (in the headphones)', () => {
    const h = new SetHistory();
    play(h, 8, [deck(null), deck(null)]);
    expect(h.beat).toBe(0);
    play(h, 8, [deck('cue', 0.01), deck(null)]);
    expect(h.beat).toBe(0);
    expect(h.ribbons).toHaveLength(0);
    play(h, 8, [deck('a'), deck('cue', 0.01)]);
    expect(h.beat).toBeCloseTo(8, 0);
    expect(h.ribbons.map((r) => r.track)).toEqual(['a']);
  });

  it('braids a mix: both ribbons at once, on opposite strands, opening and closing again', () => {
    const h = new SetHistory();
    play(h, 32, [deck('a'), deck(null)]);
    play(h, 32, [deck('a'), deck('b')]);
    const [a, b] = h.ribbons;
    expect(b.n).toBe(2);
    expect(a.side).not.toBe(b.side);
    expect(setLabel(h.open.map((r) => r.n), h.ribbons.length, false)).toBe('Mixing 1 into 2');
    // well into the mix the braid is open on both
    expect(a.mix[a.mix.length - 1]).toBeGreaterThan(0.95);
    expect(b.mix[b.mix.length - 1]).toBeGreaterThan(0.95);
    // the same moment on both strands: opposite sides of the path
    const s = b.s[b.s.length - 1];
    const ka = a.s.indexOf(s);
    expect(ka).toBeGreaterThan(0);
    const oa = braidOffset(s, a.side, a.mix[ka]);
    const ob = braidOffset(s, b.side, b.mix[b.s.length - 1]);
    expect(oa[0] + ob[0]).toBeCloseTo(0, 3);
    expect(oa[1] + ob[1]).toBeCloseTo(0, 3);
    expect(Math.hypot(...oa)).toBeCloseTo(BRAID_R, 1);
    const pa: RGB = [0, 0, 0];
    const pb: RGB = [0, 0, 0];
    const d: RGB = [0, 0, 0];
    place(s, a.side, 1, pa, d);
    place(s, b.side, 1, pb, d);
    expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])).toBeCloseTo(2 * BRAID_R, 2);
    // the strands wind round each other: a quarter twist later they've moved round
    const q = braidOffset(s + BRAID_BEATS / 4, a.side, 1);
    expect(Math.abs(q[0] - oa[0]) + Math.abs(q[1] - oa[1])).toBeGreaterThan(BRAID_R * 0.5);
    // the outgoing track's fader comes down: its ribbon ends after a moment, the other closes its braid
    play(h, 4, [deck('a', 0), deck('b')]);
    expect(a.open).toBe(true);
    play(h, ((QUIET_CLOSE + 1) * BPM) / 60, [deck('a', 0), deck('b')]);
    expect(a.open).toBe(false);
    expect(b.mix[b.mix.length - 1]).toBeLessThan(0.02);
    expect(setLabel(h.open.map((r) => r.n), h.ribbons.length, false)).toBe('Track 2');
  });

  it('gives each strand its share of the sound by how loud its deck is', () => {
    const h = new SetHistory();
    play(h, 16, [deck('a', 1, 0.8), deck('b', 1, 0.2)]);
    const [a, b] = h.ribbons;
    const avg = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    expect(avg(a.level)).toBeGreaterThan(avg(b.level) * 3);
  });

  it('numbers tracks in the order they were played, and starts a new ribbon when a deck changes track', () => {
    const h = new SetHistory();
    play(h, 16, [deck('a'), deck(null)]);
    play(h, 16, [deck('b'), deck(null)]);
    play(h, 16, [deck('b'), deck('c')]);
    expect(h.ribbons.map((r) => `${r.n}:${r.track}`)).toEqual(['1:a', '2:b', '3:c']);
    // consecutive tracks alternate strands, so the next mix braids opposite the playing one
    expect(h.ribbons[1].side).not.toBe(h.ribbons[2].side);
  });

  it('stays inside its budget over a long night: old tracks get coarser, new ones keep their detail', () => {
    const cap = 3000;
    const h = new SetHistory(cap);
    const tracks = 24;
    // the decks take turns: each track plays alone, then mixes into the next on the other deck
    const on = (t: number) => (t % 2 ? [deck(null), deck(`t${t}`)] : [deck(`t${t}`), deck(null)]);
    for (let t = 0; t < tracks; t++) {
      play(h, 120, on(t));
      play(h, 24, t % 2 ? [deck(`t${t + 1}`), deck(`t${t}`)] : [deck(`t${t}`), deck(`t${t + 1}`)]);
    }
    expect(h.ribbons).toHaveLength(tracks + 1);
    expect(h.samples).toBeLessThanOrEqual(cap + 2);
    expect(h.ribbons.reduce((n, r) => n + r.s.length, 0)).toBe(h.samples);
    const done = h.ribbons.filter((r) => !r.open);
    // (merging pairs of an odd count leaves a ribbon a touch finer than exactly half)
    for (let i = 1; i < done.length; i++) expect(density(done[i])).toBeGreaterThanOrEqual(density(done[i - 1]) * 0.9);
    // the tracks playing now keep all their detail
    for (const r of h.open) expect(density(r)).toBeCloseTo(1 / STEP, 1);
    expect(density(done[0])).toBeLessThan(density(done[done.length - 1]));
    // every ribbon still spans its stretch of the set, in order (the last has only just come in)
    for (const r of h.ribbons) {
      for (let i = 1; i < r.s.length; i++) expect(r.s[i]).toBeGreaterThan(r.s[i - 1]);
      if (r.n <= tracks) expect(r.s[r.s.length - 1] - r.s[0]).toBeGreaterThan(130);
    }
    expect(CAP).toBeGreaterThan(cap);
  });

  it('halves a ribbon by merging neighbours: level averaged, the kick kept', () => {
    const h = new SetHistory();
    play(h, 4, [deck('a')]);
    const r = h.ribbons[0];
    r.s.splice(0, r.s.length, 0, 1, 2, 3, 4);
    r.level.splice(0, r.level.length, 0.2, 0.4, 0.6, 0.8, 1);
    r.kick.splice(0, r.kick.length, 1, 0, 0, 0.5, 0);
    r.sub.splice(0, r.sub.length, 0, 0, 0, 0, 0);
    r.mix.splice(0, r.mix.length, 0, 0, 0, 0, 0);
    expect(halve(r)).toBe(2);
    expect(r.s).toEqual([0.5, 2.5, 4]);
    expect(r.level.map((v) => +v.toFixed(3))).toEqual([0.3, 0.7, 1]);
    expect(r.kick).toEqual([1, 0.5, 0]);
    // the tip of a playing ribbon is never merged
    expect(halve(r, 3)).toBe(0);
  });

  it('takes each song’s colour, keeping neighbours apart', () => {
    const h = new SetHistory();
    play(h, 8, [deck('a')]);
    const before = h.ribbons[0].color;
    h.setLook('a', ['#ff0000', '#00ff00', '#0000ff']);
    expect(h.ribbons[0].color).not.toEqual(before);
    expect(h.ribbons[0].color).toEqual([1, 0, 0]);
    // the next song's main colour is nearly the same red: it takes one of its others
    const pick = pickRibbonColor(
      [
        [0.95, 0.05, 0.05],
        [0.1, 0.4, 1],
        [0.9, 0.9, 0.9],
      ],
      [1, 0, 0],
    );
    expect(pick).toEqual([0.1, 0.4, 1]);
    // a look that arrives before the ribbon starts is used straight away
    h.setLook('b', ['#22ccff']);
    play(h, 8, [deck('a'), deck('b')]);
    expect(h.ribbons[1].color.map((v) => Math.round(v * 255))).toEqual([0x22, 0xcc, 0xff]);
  });
});

describe('the sculpture’s shape', () => {
  it('rises and widens as the set goes on, a fixed length a beat', () => {
    let prevY = -Infinity;
    let prevR = 0;
    for (let s = 0; s <= 20000; s += 500) {
      const [x, y, z] = spiral(s);
      expect(y).toBeGreaterThanOrEqual(prevY);
      expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(prevR);
      prevY = y;
      prevR = Math.hypot(x, z);
    }
    // about the planned length a beat, early and late in the night
    for (const s of [10, 8000]) {
      const a = spiral(s);
      const b = spiral(s + 1);
      expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeCloseTo(ARC, 2);
    }
    // a two-hour set is a few turns of a wide funnel, not a needle
    const turns = spiralAngle(15000) / (Math.PI * 2);
    expect(turns).toBeGreaterThan(6);
    expect(turns).toBeLessThan(20);
    const [x, y, z] = spiral(15000);
    expect(Math.hypot(x, z)).toBeGreaterThan(y * 0.5);
  });

  it('turns never touch: the gap between turns is wider than two braided strands and their rungs', () => {
    const reach = Math.max(...rung(1, 1, 1));
    for (const s of [0, 1000, 5000]) {
      const th = spiralAngle(s);
      // the same angle one turn on
      let s2 = s;
      while (spiralAngle(s2) < th + Math.PI * 2) s2 += 1;
      const a = spiral(s);
      const b = spiral(s2);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(2 * (BRAID_R + reach));
    }
  });

  it('labels what’s happening', () => {
    expect(setLabel([], 0, false)).toBe('Your set starts here');
    expect(setLabel([3], 3, false)).toBe('Track 3');
    expect(setLabel([4, 3], 4, false)).toBe('Mixing 3 into 4');
    expect(setLabel([4], 4, true)).toBe('The whole set · 4 tracks');
    expect(setLabel([], 1, false)).toBe('The set so far · 1 track');
  });
});

describe('black-and-white 16mm', () => {
  it('turns one notch a beat, all of it in the first fifth of the beat', () => {
    expect(filmNotch(7)).toBe(7);
    expect(filmNotch(7 + NOTCH_EASE)).toBe(8);
    expect(filmNotch(7.6)).toBe(8);
    expect(filmNotch(7.999)).toBe(8);
    expect(filmNotch(7 + NOTCH_EASE / 2)).toBeGreaterThan(7.5);
    expect(filmNotch(7 + NOTCH_EASE / 2)).toBeLessThan(8);
    // it only ever moves forward
    let prev = -Infinity;
    for (let b = 0; b < 4; b += 0.01) {
      expect(filmNotch(b)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = filmNotch(b);
    }
  });

  it('flips to a negative for a beat on the drop; with flashing reduced, a slow soft fade instead', () => {
    expect(negativeAt(Number.NaN, false)).toBe(0);
    expect(negativeAt(-1, false)).toBe(0);
    expect(negativeAt(0, false)).toBe(1);
    expect(negativeAt(0.99, false)).toBe(1);
    expect(negativeAt(1, false)).toBe(0);
    // reduced: never all the way, no jump, and stretched over more than two beats
    let prev = 0;
    let peak = 0;
    let last = 0;
    for (let b = 0; b <= 4; b += 0.02) {
      const v = negativeAt(b, true);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
      peak = Math.max(peak, v);
      if (v > 0.01) last = b;
    }
    expect(peak).toBeLessThan(0.85);
    expect(peak).toBeGreaterThan(0.6);
    expect(last).toBeGreaterThan(2);
    expect(negativeAt(3, true)).toBe(0);
  });
});
