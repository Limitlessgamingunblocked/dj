import { afterEach, describe, expect, it } from 'vitest';
import { analyzePcm } from '../src/analysis/analyze';
import { detectSections } from '../src/game/sections';
import { sectionAt, sectionsFor, trackInfo } from '../src/game/tracks';
import type { DemoSpec, LibraryTrack } from '../src/core/types';
import { renderDemoTrack } from './fixtures/synth';

/** synthesised tracks with a known arrangement stand in for your music */
const SPECS: DemoSpec[] = [
  { seed: 301, bpm: 122, root: 9, minor: true, style: 'minimal', bars: 128 },
  { seed: 312, bpm: 126, root: 2, minor: true, style: 'rave', bars: 128 },
  { seed: 320, bpm: 125, root: 5, minor: false, style: 'techhouse', bars: 128 },
  { seed: 42, bpm: 128, root: 5, minor: false, style: 'garage', bars: 64 },
];

describe('finding the arrangement of your own tracks', () => {
  afterEach(() => new Promise<void>((r) => setTimeout(r, 0)));
  for (const spec of SPECS) {
    it(`finds the breakdown, the drop and the outro (${spec.style}, ${spec.bars} bars)`, () => {
      const r = renderDemoTrack(spec, 22050);
      const a = analyzePcm([r.left, r.right], r.sampleRate);
      const found = detectSections(a)!;
      const truth = sectionsFor(spec);
      const barOf = (list: { kind: string; bar: number }[], k: string) => list.find((s) => s.kind === k)?.bar ?? -999;
      console.log(spec.style, found.map((s) => `${s.kind}@${s.bar}`).join(' '), '| truth', truth.map((s) => `${s.kind}@${s.bar}`).join(' '));
      expect(found[0].kind).toBe('intro');
      // the drop is what matters most for the game: on the bar, or within a phrase
      expect(Math.abs(barOf(found, 'drop') - barOf(truth, 'drop'))).toBeLessThanOrEqual(4);
      expect(Math.abs(barOf(found, 'breakdown') - barOf(truth, 'breakdown'))).toBeLessThanOrEqual(8);
      expect(barOf(found, 'build')).toBeLessThan(barOf(found, 'drop'));
      expect(barOf(found, 'build')).toBeGreaterThanOrEqual(barOf(found, 'breakdown'));
      expect(Math.abs(barOf(found, 'outro') - barOf(truth, 'outro'))).toBeLessThanOrEqual(8);
      expect(Math.abs(barOf(found, 'groove') - barOf(truth, 'groove'))).toBeLessThanOrEqual(8);
      // in order, on the grid
      for (let i = 1; i < found.length; i++) expect(found[i].bar).toBeGreaterThan(found[i - 1].bar);
      const bar = (60 / a.bpm) * 4;
      expect(found[2].t).toBeCloseTo(a.firstBeat + found[2].bar * bar, 6);
    }, 60000);
  }

  it('gives an imported track markers once analysed, cached per analysis', () => {
    const spec = SPECS[0];
    const r = renderDemoTrack(spec, 22050);
    const a = analyzePcm([r.left, r.right], r.sampleRate);
    const t = { id: 'x', fileName: 'x.wav', size: 1, addedAt: 0, meta: { title: 'x', artist: '', album: '', genre: '', year: '', format: 'WAV' }, cues: { cue: null, hot: [] }, source: 'file', plays: 0, status: 'ready', analysis: a } as LibraryTrack;
    const info = trackInfo(t);
    expect(info.imported).toBe(true);
    expect(info.sections).not.toBeNull();
    expect(sectionAt(info.sections, info.sections!.find((s) => s.kind === 'drop')!.t + 1)!.kind).toBe('drop');
    expect(detectSections(a)).toBe(detectSections(a));
  }, 60000);

  it('says nothing for clips too short to have an arrangement', () => {
    const a = { version: 5, duration: 20, bpm: 124, firstBeat: 0, key: null, loudness: -10, peak: 0, waveform: new Uint8Array(20 * 150 * 4), waveRate: 150 };
    expect(detectSections(a)).toBeNull();
  });
});
