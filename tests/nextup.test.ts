import { describe, expect, it } from 'vitest';
import { makeKey } from '../src/analysis/keys';
import { NextUp, type NextUpHost } from '../src/app/nextup';
import { freeWant, rankNext, type CoachTrack } from '../src/game/coach';
import type { KeyInfo, LibraryTrack } from '../src/core/types';
import { prefs, sanitizePrefs } from '../src/core/prefs';

const c = (id: string, bpm: number, camelot: [number, boolean], energy: number, genre?: string): CoachTrack => ({ id, title: id, artist: '', bpm, key: makeKey(...camelot), energy, genre });

describe('ranking the next track', () => {
  // 9 minor is 8A; 4 minor is 9A (harmonic); 3 major is a clash
  const pool = [c('clash', 124, [3, false], 6), c('fast', 140, [9, true], 6), c('good', 125, [4, true], 6), c('flat', 124, [9, true], 2)];

  it('ranks in-key, close-tempo tracks at the wanted energy first, and says why', () => {
    const r = rankNext({ playing: { bpm: 124, key: makeKey(9, true), energy: 0.5 }, want: 0.6, tracks: pool, exclude: new Set() });
    expect(r.map((s) => s.id)[0]).toBe('good');
    expect(r.length).toBe(3);
    expect(r[0].why).toContain('in key');
    expect(r[0].why).toContain('lifts it');
    expect(r.map((s) => s.id)).not.toContain('fast');
  });

  it('says when a pick keeps the energy or brings it down', () => {
    const r = rankNext({ playing: { bpm: 124, key: makeKey(9, true), energy: 0.6 }, want: 0.2, tracks: pool, exclude: new Set(), n: 4 });
    expect(r.find((s) => s.id === 'flat')!.why).toContain('brings it down');
    expect(r.find((s) => s.id === 'good')!.why).toContain('keeps it');
  });

  it('prefers the same genre when everything else is equal', () => {
    const twins = [c('techno', 124, [4, true], 6, 'Techno'), c('house', 124, [4, true], 6, 'House')];
    const r = rankNext({ playing: { bpm: 124, key: makeKey(9, true), genre: 'House' }, want: 0.6, tracks: twins, exclude: new Set() });
    expect(r[0].id).toBe('house');
  });

  it('opens with a warm-up track when nothing is playing', () => {
    const r = rankNext({ playing: null, want: freeWant(null), tracks: [c('peak', 128, [4, true], 9), c('warm', 122, [4, true], 4)], exclude: new Set() });
    expect(r[0].id).toBe('warm');
    expect(r[0].why).toContain('opener');
  });

  it('keeps the night building outside a gig', () => {
    expect(freeWant(null)).toBeCloseTo(0.45);
    expect(freeWant(0.5)).toBeGreaterThan(0.5);
    expect(freeWant(1)).toBeLessThanOrEqual(0.95);
  });
});

/* the app-wide service, with a fake engine and library */
interface FakeDeck {
  id: number;
  playing: boolean;
  loaded: boolean;
  loading: boolean;
  track: LibraryTrack | null;
  bpm: number;
  key: KeyInfo | null;
  currentKey(): KeyInfo | null;
  on(e: string, fn: () => void): void;
}

const track = (id: string, bpm: number, camelot: [number, boolean], loudness: number): LibraryTrack => ({
  id,
  fileName: `${id}.mp3`,
  size: 1,
  addedAt: 0,
  meta: { title: id, artist: 'x', album: '', genre: '', year: '', format: 'mp3' } as LibraryTrack['meta'],
  analysis: { version: 1, duration: 300, bpm, firstBeat: 0, key: makeKey(...camelot), loudness, peak: 0, waveform: new Uint8Array(0), waveRate: 50 },
  cues: { cue: null, hot: [] },
  source: 'file',
  plays: 0,
  status: 'ready',
});

function rig(tracks: LibraryTrack[]) {
  const loaded: [number, string][] = [];
  const deck = (id: number): FakeDeck => {
    const d: FakeDeck = { id, playing: false, loaded: false, loading: false, track: null, bpm: 0, key: null, currentKey: () => d.key, on: () => {} };
    return d;
  };
  const decks = [deck(1), deck(2)];
  const engine = {
    decks,
    channels: decks.map(() => ({ state: { fader: 1 }, xfGain: 1 })),
    masterDeck: null as FakeDeck | null,
    deck: (id: number) => decks.find((d) => d.id === id)!,
  };
  const library = { on: () => () => {}, list: () => tracks, get: (id: string) => tracks.find((t) => t.id === id), crate: () => undefined };
  const host = { engine, library, currentCrate: () => null, loadTrack: async (d: number, id: string) => void loaded.push([d, id]), sideDeck: (s: 'L' | 'R') => (s === 'L' ? 1 : 2) } as unknown as NextUpHost;
  return { nu: new NextUp(host), decks, engine, loaded };
}

describe('up next, in every mode', () => {
  const lib = [track('a', 124, [9, true], -9), track('b', 125, [4, true], -9), track('c', 124, [3, false], -9), track('d', 150, [9, true], -9)];

  it('suggests an opener before anything is loaded, and loads it on the free deck', () => {
    const { nu, loaded } = rig(lib);
    nu.update(0.016);
    expect(nu.opening()).toBe(true);
    expect(nu.list().length).toBe(3);
    expect(nu.freeDeck()).toBe(1);
    expect(nu.load()).toBe(true);
    expect(loaded[0][0]).toBe(1);
  });

  it('follows what is playing, never suggests it, and remembers what the room has heard', () => {
    const { nu, decks, engine } = rig(lib);
    Object.assign(decks[0], { playing: true, loaded: true, track: lib[0], bpm: 124, key: makeKey(9, true) });
    engine.masterDeck = decks[0];
    nu.update(0.016);
    expect(nu.list().map((s) => s.id)).not.toContain('a');
    expect(nu.top()!.id).toBe('b');
    expect(nu.freeDeck()).toBe(2);
    // deck 1 stops and empties: "a" was heard, so it stays out
    Object.assign(decks[0], { playing: false, loaded: false, track: null });
    engine.masterDeck = null;
    nu.touch();
    nu.update(0.016);
    expect(nu.list().map((s) => s.id)).not.toContain('a');
  });

  it('skips a pick on request until the track out front changes', () => {
    const { nu, decks, engine } = rig(lib);
    Object.assign(decks[0], { playing: true, loaded: true, track: lib[0], bpm: 124, key: makeKey(9, true) });
    engine.masterDeck = decks[0];
    nu.update(0.016);
    const first = nu.top()!.id;
    nu.another();
    nu.update(0.016);
    expect(nu.top()!.id).not.toBe(first);
  });

  it('has nowhere to load when both decks are playing', () => {
    const { nu, decks } = rig(lib);
    for (const [i, d] of decks.entries()) Object.assign(d, { playing: true, loaded: true, track: lib[i], bpm: 124 });
    nu.update(0.016);
    expect(nu.freeDeck()).toBeNull();
    expect(nu.load()).toBe(false);
  });

  it('takes a gig’s slot energy and its heard list while a gig runs', () => {
    const { nu } = rig(lib);
    nu.gig = { want: 0.9, heard: new Set(['b']) };
    nu.touch();
    nu.update(0.016);
    expect(nu.list().map((s) => s.id)).not.toContain('b');
  });

  it('is on by default and can be turned off in Settings', () => {
    expect(prefs.nextUp).toBe(true);
    expect(sanitizePrefs({ nextUp: false }).nextUp).toBe(false);
    expect(sanitizePrefs({ nextUp: 'yes' }).nextUp).toBe(true);
  });
});
