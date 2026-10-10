import { describe, expect, it } from 'vitest';
import { makeKey } from '../src/analysis/keys';
import { suggestNext, type CoachTrack } from '../src/game/coach';
import { Gig, type GigEvent } from '../src/game/Gig';
import { Requests, type RequestInput } from '../src/game/requests';
import { Streak, STREAK_MAX } from '../src/game/streak';
import type { DeckSnap, VibeEvent } from '../src/game/vibe';

const tr = (points: number, t = 0): VibeEvent => ({ kind: 'transition', name: 'bass_swap', points, t, band: 'good', keyBonus: true });
const oops = (name: 'trainwreck' | 'fatigue', t = 0): VibeEvent => ({ kind: 'mistake', name, t });

describe('the streak', () => {
  it('multiplies clean moments in a row, up to ×2', () => {
    const s = new Streak();
    expect(s.onEvent(tr(100))).toBe(0);
    expect(s.onEvent(tr(100))).toBe(30); // ×1.25, rounded to 10
    expect(s.onEvent(tr(100))).toBe(50);
    for (let i = 0; i < 6; i++) s.onEvent(tr(100));
    expect(s.mult).toBe(STREAK_MAX);
    expect(s.onEvent(tr(100))).toBe(100);
    expect(s.best).toBe(10);
    // an unbuilt drop doesn't count
    expect(s.onEvent({ kind: 'drop', built: false, points: 20, t: 0 })).toBe(0);
  });

  it('breaks on a real mistake, not on a restless crowd', () => {
    const s = new Streak();
    s.onEvent(tr(100));
    s.onEvent(tr(100));
    s.onEvent(oops('fatigue'));
    expect(s.count).toBe(2);
    s.onEvent(oops('trainwreck'));
    expect(s.count).toBe(0);
    expect(s.onEvent(tr(100))).toBe(0);
    expect(s.best).toBe(2);
  });
});

describe('crowd requests', () => {
  const at = (t: number, o: Partial<RequestInput> = {}): RequestInput => ({ t, energy: 0.6, target: 0.62, remaining: 600, live: true, ...o });

  it('asks to get back on the slot’s curve, and knows when you have', () => {
    const r = new Requests('peak', () => 0);
    expect(r.update(at(10), [])).toEqual([]);
    const ask = r.update(at(80, { energy: 0.4, target: 0.7 }), []);
    expect(ask[0].what).toBe('ask');
    expect(ask[0].req.kind).toBe('lift');
    expect(r.update(at(90, { energy: 0.45, target: 0.7 }), [])).toEqual([]);
    const met = r.update(at(100, { energy: 0.52, target: 0.7 }), []);
    expect(met[0].what).toBe('met');
    expect(r.met).toBe(1);
    // too hot: take it down
    const r2 = new Requests('warmup', () => 0);
    expect(r2.update(at(80, { energy: 0.8, target: 0.4 }), [])[0].req.kind).toBe('calm');
  });

  it('asks for a moment when the energy is right, and lets a request run out', () => {
    const r = new Requests('peak', () => 0.99);
    const ask = r.update(at(80), []);
    expect(ask[0].req.kind).toBe('drop');
    const miss = r.update(at(80 + 121), []);
    expect(miss[0].what).toBe('missed');
    // a warm-up never asks for a drop
    const w = new Requests('warmup', () => 0.99);
    expect(w.choose(at(80, { target: 0.6 }))).not.toBe('drop');
    // a drop answers "Drop it!"
    const r3 = new Requests('peak', () => 0.99);
    r3.update(at(80), []);
    expect(r3.update(at(90), [{ kind: 'drop', built: true, points: 80, t: 90 }])[0].what).toBe('met');
  });

  it('stays quiet at the end of the set', () => {
    const r = new Requests('peak', () => 0);
    expect(r.update(at(200, { remaining: 30 }), [])).toEqual([]);
  });
});

describe('the next-track coach', () => {
  const c = (id: string, bpm: number, camelot: [number, boolean], energy: number): CoachTrack => ({ id, title: id, artist: '', bpm, key: makeKey(...camelot), energy });
  // 9 minor is 8A; 4 minor is 9A (harmonic); 3 major is 5B (clash)
  const pool = [c('clash', 124, [3, false], 6), c('fast', 140, [9, true], 6), c('good', 125, [4, true], 6), c('flat', 124, [9, true], 2)];

  it('picks a track in key, close in tempo, at the energy the slot wants', () => {
    const s = suggestNext({ playing: { bpm: 124, key: makeKey(9, true) }, want: 0.6, tracks: pool, exclude: new Set() })!;
    expect(s.id).toBe('good');
    expect(s.why).toContain('in key');
    expect(s.why).toContain('125 BPM');
  });

  it('never suggests what has been played tonight, or anything from an empty crate', () => {
    expect(suggestNext({ playing: { bpm: 124, key: makeKey(9, true) }, want: 0.6, tracks: pool, exclude: new Set(['good']) })!.id).not.toBe('good');
    expect(suggestNext({ playing: null, want: 0.6, tracks: [], exclude: new Set() })).toBeNull();
  });
});

describe('a gig with streaks and requests', () => {
  const BEAT = 60 / 124;
  const deck = (o: Partial<DeckSnap> = {}): DeckSnap => ({ id: 1, trackId: 'a', artist: 'x', playing: true, audible: 1, bpm: 124, beat: 0, key: makeKey(9, true), energy: 0.6, section: 'groove', low: 0.5, filter: 0.5, echo: false, roll: false, ...o });

  it('asks the crowd’s requests during the set and reports them in the results', () => {
    const g = new Gig({ venue: 'basement', slot: 'peak', minutes: 10, assist: 'club' });
    const out: GigEvent[] = [];
    for (let s = 0; s < 200; s += 0.25) out.push(...g.update(0.25, [deck({ beat: g.t / BEAT, energy: 0.3 })], 0.5, 0, false));
    const asks = out.filter((e) => e.kind === 'request' && e.what === 'ask');
    expect(asks.length).toBeGreaterThan(0);
    const r = g.results({ milestones: [], fame: 0, tier: 1 });
    expect(r.requests.asked).toBeGreaterThan(0);
    expect(r.bestStreak).toBe(0);
  });
});
