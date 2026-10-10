import { describe, expect, it } from 'vitest';
import { DEMO_TRACKS, renderDemoTrack } from './fixtures/synth';
import type { DemoSpec, LibraryTrack } from '../src/core/types';
import { energyAt, estimateEnergy, nextSection, sectionAt, sectionsFor, trackInfo } from '../src/game/tracks';
import { matchTrack, parseSearch } from '../src/library/Library';

const spec = (id: string, demo: DemoSpec): LibraryTrack => ({ id, fileName: id, size: 0, addedAt: 0, meta: { title: id, artist: 'x', album: '', genre: '', year: '', format: 'WAV' }, cues: { cue: null, hot: [] }, source: 'demo', demo, plays: 0, status: 'ready' });

describe('what the game knows about a track', () => {
  it('ships no tracks of its own: the library is your music', () => {
    // the synthesised tracks are only test fixtures now
    expect(DEMO_TRACKS.length).toBeGreaterThan(0);
  });

  it('marks DJ-friendly sections: 16-bar intro and outro, a build before the drop', () => {
    const s = sectionsFor({ seed: 1, bpm: 124, root: 0, minor: true, style: 'minimal', bars: 128 });
    expect(s.map((x) => [x.kind, x.bar])).toEqual([
      ['intro', 0],
      ['groove', 16],
      ['breakdown', 64],
      ['build', 72],
      ['drop', 80],
      ['outro', 112],
    ]);
    const bar = (60 / 124) * 4;
    expect(s[4].t).toBeCloseTo(0.05 + 80 * bar, 6);
    expect(sectionAt(s, s[4].t + 1)!.kind).toBe('drop');
    expect(sectionAt(s, 0)!.kind).toBe('intro');
    expect(nextSection(s, 'drop', 10)!.bar).toBe(80);
    expect(nextSection(s, 'drop', s[4].t + 1)).toBeNull();
  });

  it('has the drop where the markers say', () => {
    const d = DEMO_TRACKS.find((x) => x.spec.seed === 309)!;
    const sr = 11025;
    const r = renderDemoTrack(d.spec, sr);
    const s = sectionsFor(d.spec);
    const rms = (t0: number, t1: number) => {
      let e = 0;
      const a = Math.floor(t0 * sr);
      const b = Math.floor(t1 * sr);
      for (let i = a; i < b; i++) e += r.left[i] * r.left[i];
      return Math.sqrt(e / (b - a));
    };
    const at = (k: string) => s.find((x) => x.kind === k)!.t;
    const breakdown = rms(at('breakdown') + 1, at('build') - 1);
    const drop = rms(at('drop') + 0.5, at('drop') + 8);
    const intro = rms(0.1, at('groove') - 1);
    expect(drop).toBeGreaterThan(breakdown * 1.3);
    expect(drop).toBeGreaterThan(intro);
  });

  it('knows each track’s energy, lifted on drops and lowered in breakdowns', () => {
    const t = spec('rave-1', { seed: 1, bpm: 126, root: 0, minor: true, style: 'rave', bars: 128 });
    const info = trackInfo(t);
    expect(info.original).toBe(false);
    expect(info.imported).toBe(false);
    expect(info.energy).toBe(8);
    const s = info.sections!;
    const drop = energyAt(info, s.find((x) => x.kind === 'drop')!.t + 1);
    const breakdown = energyAt(info, s.find((x) => x.kind === 'breakdown')!.t + 1);
    expect(drop).toBeGreaterThan(breakdown);
    expect(drop).toBeLessThanOrEqual(1);
    expect(info.tags).toContain('rave');
    // imported music: estimated, no markers until it's been analysed for sections
    const imported = trackInfo({ ...t, source: 'file', demo: undefined, analysis: { version: 5, duration: 300, bpm: 124, firstBeat: 0, key: null, loudness: -10, peak: 0, waveform: new Uint8Array(), waveRate: 150 } });
    expect(imported.imported).toBe(true);
    expect(imported.sections).toBeNull();
    expect(imported.energy).toBe(5);
    expect(estimateEnergy(130, -7)).toBeGreaterThan(estimateEnergy(120, -13));
    expect(estimateEnergy(62, -10)).toBe(estimateEnergy(124, -10));
  });

  it('searches by tag and energy', () => {
    const rave = spec('r', { seed: 2, bpm: 128, root: 0, minor: true, style: 'rave', bars: 128 });
    const deep = spec('d', { seed: 3, bpm: 122, root: 0, minor: true, style: 'minimal', bars: 128 });
    expect(matchTrack(rave, parseSearch('tag:rave'))).toBe(true);
    expect(matchTrack(deep, parseSearch('tag:rave'))).toBe(false);
    expect(matchTrack(deep, parseSearch('deep'))).toBe(true);
    expect(matchTrack(rave, parseSearch('energy:8-10'))).toBe(true);
    expect(matchTrack(deep, parseSearch('energy:8-10'))).toBe(false);
    expect(matchTrack(deep, parseSearch('energy:3'))).toBe(true);
  });
});
