import { describe, expect, it } from 'vitest';
import { countdown, countdownText, deckPhrase, mixPoints, phraseLabel, phraseOffset, phraseState } from '../src/game/mixtools';
import type { Section } from '../src/game/tracks';

// 120 BPM: a beat is 0.5 s, a bar 2 s
const sections: Section[] = [
  { kind: 'intro', bar: 0, t: 0.1 },
  { kind: 'groove', bar: 16, t: 32.1 },
  { kind: 'breakdown', bar: 48, t: 96.1 },
  { kind: 'build', bar: 56, t: 112.1 },
  { kind: 'drop', bar: 64, t: 128.1 },
  { kind: 'outro', bar: 96, t: 192.1 },
];

describe('drop countdown', () => {
  it('counts down the last 16 bars to the drop, then the last bar in beats', () => {
    expect(countdown(sections, 90, 0.5)).toBeNull();
    const c = countdown(sections, 112.1, 0.5)!;
    expect(c.kind).toBe('drop');
    expect(countdownText(c)).toBe('8 BARS');
    expect(countdownText(countdown(sections, 125.1, 0.5)!)).toBe('2 BARS');
    expect(countdownText(countdown(sections, 126.6, 0.5)!)).toBe('3');
    expect(countdownText(countdown(sections, 127.7, 0.5)!)).toBe('1');
    expect(countdownText(countdown(sections, 128.1, 0.5)!)).toBe('NOW');
  });

  it('after the drop it counts down to the outro, where you mix out', () => {
    expect(countdown(sections, 140, 0.5)).toBeNull();
    const c = countdown(sections, 176.1, 0.5)!;
    expect(c.kind).toBe('outro');
    expect(countdownText(c)).toBe('8 BARS');
    expect(countdown(sections, 200, 0.5)).toBeNull();
    expect(countdown(null, 10, 0.5)).toBeNull();
  });

  it('marks where to be mixed in and where to mix out', () => {
    expect(mixPoints(sections)).toEqual({ mixIn: 32.1, mixOut: 192.1 });
    expect(mixPoints(null)).toEqual({ mixIn: null, mixOut: null });
  });
});

describe('phrase match', () => {
  it('is in phrase when both decks start a phrase together, whatever phrase number', () => {
    expect(phraseOffset(64, 0)).toBe(0);
    expect(phraseState(phraseOffset(64.05, 128))).toEqual({ kind: 'in' });
  });

  it('says how many bars or beats off it is', () => {
    expect(phraseState(phraseOffset(8, 0))).toEqual({ kind: 'bars', bars: 2 });
    expect(phraseState(phraseOffset(0, 8))).toEqual({ kind: 'bars', bars: -2 });
    expect(phraseState(phraseOffset(1, 0))).toEqual({ kind: 'beats', beats: 1 });
    expect(phraseState(phraseOffset(0.5, 0))).toEqual({ kind: 'offbeat' });
    // wrapped: 7 bars ahead is 1 bar behind
    expect(phraseState(phraseOffset(28, 0))).toEqual({ kind: 'bars', bars: -1 });
    expect(phraseLabel({ kind: 'in' }).text).toBe('IN PHRASE');
    expect(phraseLabel({ kind: 'bars', bars: -1 }).text).toBe('PHRASE −1 BAR');
  });

  it('only compares two playing decks at the same tempo', () => {
    const deck = (beat: number, bpm = 124, playing = true) => ({ loaded: true, playing, bpm, analysis: {}, beatPosition: () => beat, displayPosition: () => 0 });
    const m = deck(40);
    expect(deckPhrase(deck(72), m)).toEqual({ kind: 'in' });
    expect(deckPhrase(deck(72, 130), m)).toBeNull();
    expect(deckPhrase(deck(72, 124, false), m)).toBeNull();
    expect(deckPhrase(m, m)).toBeNull();
    expect(deckPhrase(deck(72), null)).toBeNull();
  });
});
