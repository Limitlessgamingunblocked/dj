import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_TRACKS, renderDemoTrack } from '../src/audio/synth';
import { analyzePcm } from '../src/analysis/analyze';
import { makeKey, compatibility, parseKeyTag, keySyncShift } from '../src/analysis/keys';

describe('track analysis on generated demo tracks', () => {
  // each render + analysis blocks for seconds: give the worker's event loop a turn between them
  afterEach(() => new Promise<void>((r) => setTimeout(r, 0)));
  for (const demo of DEMO_TRACKS) {
    it(`${demo.title} (${demo.spec.style} ${demo.spec.bpm} BPM)`, () => {
      const t0 = performance.now();
      const r = renderDemoTrack(demo.spec, 44100);
      const t1 = performance.now();
      const a = analyzePcm([r.left, r.right], r.sampleRate);
      const t2 = performance.now();
      const beat = 60 / demo.spec.bpm;
      const phaseErr = Math.abs(((a.firstBeat - 0.05) / beat) % 1);
      const expectedKey = makeKey(demo.spec.root, demo.spec.minor);
      console.log(
        demo.title,
        `render ${(t1 - t0).toFixed(0)}ms analyze ${(t2 - t1).toFixed(0)}ms`,
        `bpm ${a.bpm} first ${a.firstBeat.toFixed(3)} key ${a.key?.name} (${a.key?.camelot}) expected ${expectedKey.name} loud ${a.loudness.toFixed(1)}`,
      );
      expect(Math.abs(a.bpm - demo.spec.bpm)).toBeLessThan(0.05);
      expect(Math.min(phaseErr, 1 - phaseErr) * beat).toBeLessThan(0.02);
      expect(compatibility(a.key, expectedKey)).not.toBeNull();
      expect(a.waveform.length).toBeGreaterThan(1000);
    }, 30000);
  }
});

describe('key helpers', () => {
  it('maps Camelot codes', () => {
    expect(makeKey(9, true).camelot).toBe('8A');
    expect(makeKey(0, false).camelot).toBe('8B');
    expect(makeKey(8, true).camelot).toBe('1A');
    expect(makeKey(11, false).camelot).toBe('1B');
    expect(makeKey(4, false).camelot).toBe('12B');
  });
  it('parses tags', () => {
    expect(parseKeyTag('8A')?.name).toBe('Am');
    expect(parseKeyTag('F#m')?.camelot).toBe('11A');
    expect(parseKeyTag('Dbmaj')?.camelot).toBe('3B');
    expect(parseKeyTag('A minor')?.camelot).toBe('8A');
  });
  it('computes compatibility and key sync shift', () => {
    expect(compatibility(makeKey(9, true), makeKey(0, false))).toBe('harmonic');
    expect(compatibility(makeKey(9, true), makeKey(4, true))).toBe('harmonic');
    expect(compatibility(makeKey(9, true), makeKey(3, true))).toBeNull();
    expect(keySyncShift(makeKey(2, true), makeKey(9, true))).toBe(-5);
    expect(keySyncShift(makeKey(0, false), makeKey(9, true))).toBe(0);
  });
});
