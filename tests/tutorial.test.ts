import { describe, expect, it } from 'vitest';
import { Tutorial, TUTORIAL, type TutorialInput } from '../src/game/tutorial';
import type { DeckSnap } from '../src/game/vibe';

const deck = (id: number, o: Partial<DeckSnap> = {}): DeckSnap => ({
  id,
  trackId: `t${id}`,
  artist: `artist ${id}`,
  playing: false,
  audible: 0.8,
  bpm: 124,
  beat: 0,
  key: null,
  energy: 0.6,
  section: 'groove',
  low: 0.5,
  filter: 0.5,
  echo: false,
  roll: false,
  ...o,
});

const input = (a: Partial<DeckSnap>, b: Partial<DeckSnap>, sync = [false, false], pro = false): TutorialInput => ({ decks: [deck(0, a), deck(1, b)], sync, pro });

describe('tutorial', () => {
  it('walks through a first mix in order, one step at a time', () => {
    const t = new Tutorial();
    // two tracks preloaded, nothing playing
    expect(t.update(input({}, { trackId: 'preloaded' }))).toBe(false);
    expect(t.current?.id).toBe('play1');
    expect(t.update(input({ playing: true }, { trackId: 'preloaded' }))).toBe(true);
    expect(t.current?.id).toBe('load2');
    // the track already sitting on deck 2 doesn't count: the player has to load one
    expect(t.update(input({ playing: true }, { trackId: 'preloaded' }))).toBe(false);
    expect(t.update(input({ playing: true }, { trackId: 't0' }))).toBe(false); // the same track as deck 1
    expect(t.update(input({ playing: true }, { trackId: 'fresh' }))).toBe(true);
    expect(t.current?.id).toBe('tempo');
    expect(t.update(input({ playing: true }, { trackId: 'fresh' }, [false, true]))).toBe(true);
    expect(t.current?.id).toBe('prep');
    expect(t.update(input({ playing: true }, { trackId: 'fresh', audible: 0, low: 0 }))).toBe(true);
    expect(t.update(input({ playing: true }, { trackId: 'fresh', audible: 0, low: 0, playing: true }))).toBe(true);
    expect(t.current?.id).toBe('fadein');
    expect(t.update(input({ playing: true }, { trackId: 'fresh', audible: 0.8, low: 0, playing: true }))).toBe(true);
    expect(t.current?.id).toBe('swap');
    expect(t.update(input({ playing: true, low: 0 }, { trackId: 'fresh', audible: 0.8, low: 0.5, playing: true }))).toBe(true);
    expect(t.current?.id).toBe('fadeout');
    expect(t.update(input({ playing: true, low: 0, audible: 0 }, { trackId: 'fresh', audible: 0.8, low: 0.5, playing: true }))).toBe(true);
    expect(t.done).toBe(true);
    expect(t.current).toBeNull();
    expect(t.step).toBe(TUTORIAL.length);
  });

  it('an empty deck 2 is filled by loading anything', () => {
    const t = new Tutorial();
    t.update(input({ playing: true }, { trackId: null }));
    expect(t.current?.id).toBe('load2');
    expect(t.update(input({ playing: true }, { trackId: null }))).toBe(false);
    expect(t.update(input({ playing: true }, { trackId: 'any' }))).toBe(true);
  });

  it('in Pro the tempo step is matched by ear, not by sync', () => {
    const t = new Tutorial();
    t.step = TUTORIAL.findIndex((s) => s.id === 'tempo');
    expect(t.update(input({ playing: true }, { bpm: 128 }, [false, true], true))).toBe(false);
    expect(t.update(input({ playing: true }, { bpm: 124.05 }, [false, false], true))).toBe(true);
  });

  it('a track loaded on deck 2 before deck 1 starts still counts', () => {
    const t = new Tutorial();
    t.update(input({}, { trackId: 'preloaded' }));
    t.update(input({}, { trackId: 'fresh' }));
    expect(t.update(input({ playing: true }, { trackId: 'fresh' }))).toBe(true);
    expect(t.update(input({ playing: true }, { trackId: 'fresh' }))).toBe(true);
    expect(t.current?.id).toBe('tempo');
  });
});
