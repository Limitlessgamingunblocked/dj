import { describe, expect, it } from 'vitest';
import { makeKey } from '../src/analysis/keys';
import type { LibraryTrack, TrackAnalysis } from '../src/core/types';
import { rng } from '../src/core/util';
import { ARCS, arcEnergy } from '../src/setbuilder/arcs';
import { filePath, toCsv, toM3U, toRekordboxXml, toTraktorNml } from '../src/setbuilder/export';
import { alternativesFor, buildPool, describeSet, fieldMatches, generateSet, parseAnchors, type SetOptions } from '../src/setbuilder/generate';
import { keyRelation, keyShiftFix, tempoMatch } from '../src/setbuilder/harmony';
import { profileTrack, type TrackProfile } from '../src/setbuilder/profile';
import { styleForAnchor } from '../src/setbuilder/styles';
import { DEMO_TRACKS } from '../src/audio/synth';

const ARTISTS: [string, string, string][] = [
  ['Carl Cox', 'Intec', 'techno'],
  ['Boris Brejcha', 'Fckng Serious', 'minimal techno'],
  ['Peggy Gou', 'Gudu', 'house'],
  ['Adam Beyer', 'Drumcode', 'techno'],
  ['Amelie Lens', 'Lenske', 'techno'],
  ['Kerri Chandler', 'Madhouse', 'deep house'],
  ['Floating Points', 'Ninja Tune', 'ambient'],
  ['Unknown Crew', 'Drumcode', 'techno'],
];

function library(n: number, seed = 5): TrackProfile[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const [artist, label, genre] = ARTISTS[i % ARTISTS.length];
    const bpm = genre === 'ambient' ? 100 + r() * 10 : genre.includes('house') ? 120 + r() * 6 : 126 + r() * 8;
    const duration = 300 + r() * 180;
    return {
      id: `t${i}`,
      title: `Track ${i}`,
      artist,
      album: '',
      genre,
      label,
      fileName: `track ${i}.mp3`,
      format: 'MP3',
      bpm,
      key: makeKey(Math.floor(r() * 12), r() < 0.6),
      duration,
      firstBeat: 0.1,
      energy: genre === 'ambient' ? 0.2 + r() * 0.2 : 0.4 + r() * 0.55,
      introEnd: 0.1 + 32 * (240 / bpm),
      outroStart: duration - 32 * (240 / bpm),
      plays: i % 5,
      basis: 'analysis' as const,
    };
  });
}

const base: SetOptions = { anchors: [], target: { kind: 'tracks', count: 12 }, arc: 'peak', style: 'blend', discovery: 0.25, seed: 1 };

describe('harmony', () => {
  it('rates Camelot moves', () => {
    const am = makeKey(9, true); // 8A
    expect(keyRelation(am, am).kind).toBe('same');
    expect(keyRelation(am, makeKey(4, true)).kind).toBe('adjacent'); // 9A
    expect(keyRelation(am, makeKey(2, true)).kind).toBe('adjacent'); // 7A
    expect(keyRelation(am, makeKey(0, false)).kind).toBe('relative'); // 8B
    expect(keyRelation(am, makeKey(7, false)).kind).toBe('diagonal'); // 9B
    expect(keyRelation(am, makeKey(10, true)).kind).toBe('boost'); // +1 semitone = 3A
    expect(keyRelation(am, makeKey(3, true)).kind).toBe('clash'); // 2A
    expect(keyRelation(am, null).kind).toBe('unknown');
  });
  it('suggests key shifts for clashes', () => {
    const fix = keyShiftFix(makeKey(9, true), makeKey(3, true));
    expect(fix).not.toBeNull();
    expect(keyRelation(makeKey(9, true), fix!.key).score).toBeGreaterThanOrEqual(0.88);
    expect(keyShiftFix(makeKey(9, true), makeKey(9, true))).toBeNull();
  });
  it('matches tempos in half and double time', () => {
    expect(tempoMatch(126, 124).mode).toBe('direct');
    expect(tempoMatch(126, 124).pct).toBeCloseTo(1.61, 1);
    expect(tempoMatch(174, 87).mode).toBe('double');
    expect(tempoMatch(87, 174).mode).toBe('half');
  });
});

describe('arcs', () => {
  it('stay within 0–1 and hit their end points', () => {
    for (const a of ARCS) {
      for (let t = 0; t <= 1; t += 0.05) {
        const e = arcEnergy(a, t);
        expect(e).toBeGreaterThanOrEqual(0);
        expect(e).toBeLessThanOrEqual(1);
      }
      expect(arcEnergy(a, 0)).toBeCloseTo(a.points[0][1]);
      expect(arcEnergy(a, 1)).toBeCloseTo(a.points[a.points.length - 1][1]);
    }
    const warm = ARCS.find((a) => a.id === 'warmup')!;
    expect(arcEnergy(warm, 1)).toBeGreaterThan(arcEnergy(warm, 0));
  });
});

describe('anchors', () => {
  it('parses and matches on whole words', () => {
    expect(parseAnchors('Carl Cox, Boris Brejcha;peggy gou, carl cox')).toEqual(['Carl Cox', 'Boris Brejcha', 'peggy gou']);
    expect(fieldMatches('Carl Cox & Friends', 'carl cox')).toBe(true);
    expect(fieldMatches('Beyoncé', 'beyonce')).toBe(true);
    expect(fieldMatches('Carlcoxx', 'carl cox')).toBe(false);
    expect(fieldMatches('Minimal Techno', 'techno')).toBe(true);
  });
  it('assigns roles by artist, label and genre', () => {
    const lib = library(80);
    const pool = buildPool(lib, { anchors: ['Carl Cox', 'Drumcode', 'house', 'Nobody Here'], discovery: 0.3 });
    const role = (artist: string) => pool.candidates.find((c) => c.profile.artist === artist)!.role;
    expect(role('Carl Cox')).toBe('anchor');
    expect(role('Unknown Crew')).toBe('anchor'); // Drumcode label
    expect(role('Peggy Gou')).toBe('style'); // house genre
    expect(role('Floating Points')).not.toBe('anchor');
    expect(pool.unmatchedAnchors).toEqual(['Nobody Here']);
    expect(pool.warnings.join(' ')).toContain('Nobody Here');
  });
  it('falls back to the whole library when nothing matches', () => {
    const pool = buildPool(library(20), { anchors: ['Nobody Here'], discovery: 0.3 });
    expect(pool.candidates.every((c) => c.role === 'library')).toBe(true);
    expect(pool.warnings[0]).toMatch(/whole library/);
  });
});

describe('generateSet', () => {
  const lib = library(160);

  it('builds a set of the requested size without repeats', () => {
    const plan = generateSet(lib, { ...base, anchors: ['Carl Cox', 'Boris Brejcha', 'Peggy Gou'] });
    expect(plan.entries).toHaveLength(12);
    expect(new Set(plan.entries.map((e) => e.profile.id)).size).toBe(12);
    expect(plan.transitions).toHaveLength(11);
    for (let i = 1; i < plan.entries.length; i++) expect(plan.entries[i].startAt).toBeGreaterThan(plan.entries[i - 1].startAt);
  });

  it('mixes harmonically better than chance', () => {
    const plan = generateSet(lib, { ...base, anchors: ['techno'] });
    const random = describeSet(buildPool(lib, { anchors: ['techno'], discovery: 0.25 }).candidates.slice(0, 12), base);
    expect(plan.harmonicScore).toBeGreaterThan(random.harmonicScore + 15);
    expect(plan.harmonicScore).toBeGreaterThanOrEqual(80);
    const bigJumps = plan.transitions.filter((t) => Math.abs(t.pitchPct) > 5).length;
    expect(bigJumps).toBeLessThanOrEqual(1);
  });

  it('follows the energy arc', () => {
    const warm = generateSet(lib, { ...base, arc: 'warmup', anchors: [] });
    const first = warm.entries.slice(0, 3).reduce((s, e) => s + e.level, 0) / 3;
    const last = warm.entries.slice(-3).reduce((s, e) => s + e.level, 0) / 3;
    expect(last).toBeGreaterThan(first);
  });

  it('keeps discoveries within the requested share', () => {
    const plan = generateSet(lib, { ...base, anchors: ['Carl Cox'], discovery: 0.25 });
    const disc = plan.entries.filter((e) => e.role === 'discovery').length;
    expect(disc).toBeGreaterThan(0);
    expect(disc).toBeLessThanOrEqual(3);
    const none = generateSet(lib, { ...base, anchors: ['Carl Cox'], discovery: 0 });
    expect(none.entries.some((e) => e.role === 'discovery')).toBe(false);
  });

  it('hits a target length in minutes', () => {
    const plan = generateSet(lib, { ...base, target: { kind: 'minutes', minutes: 60 } });
    expect(plan.duration).toBeGreaterThan(56 * 60);
    expect(plan.duration).toBeLessThan(66 * 60);
  });

  it('honours pinned and excluded tracks', () => {
    const plan = generateSet(lib, { ...base, pinned: ['t7', 't42'], exclude: ['t0', 't1', 't2'] });
    const ids = plan.entries.map((e) => e.profile.id);
    expect(ids).toContain('t7');
    expect(ids).toContain('t42');
    for (const x of ['t0', 't1', 't2']) expect(ids).not.toContain(x);
    expect(plan.entries.find((e) => e.profile.id === 't7')!.pinned).toBe(true);
  });

  it('re-rolls to a different set with another seed', () => {
    const a = generateSet(lib, { ...base, seed: 1 }).entries.map((e) => e.profile.id);
    const b = generateSet(lib, { ...base, seed: 2 }).entries.map((e) => e.profile.id);
    expect(a).not.toEqual(b);
  });

  it('reports a short library instead of failing', () => {
    const plan = generateSet(library(5), { ...base, target: { kind: 'tracks', count: 12 } });
    expect(plan.entries).toHaveLength(5);
    expect(plan.warnings.join(' ')).toMatch(/Only 5/);
    expect(generateSet([], base).entries).toHaveLength(0);
  });

  it('gives transition guidance and alternatives', () => {
    const plan = generateSet(lib, { ...base, anchors: ['techno'] });
    const t = plan.transitions[0];
    expect(t.bars).toBe(16);
    expect(t.outAt).toBe(plan.entries[0].mixOut);
    expect(t.score).toBeGreaterThan(0);
    expect(t.score).toBeLessThanOrEqual(100);
    expect(t.tip.length).toBeGreaterThan(10);
    expect(plan.entries[0].mixOut).toBeLessThan(plan.entries[0].profile.duration);
    const pool = buildPool(lib, { anchors: ['techno'], discovery: 0.25 }).candidates;
    const alts = alternativesFor(plan, pool, 3, 5);
    expect(alts).toHaveLength(5);
    for (const a of alts) expect(plan.entries.map((e) => e.profile.id)).not.toContain(a.candidate.profile.id);
  });

  it('runs fast enough for a large library', () => {
    const big = library(1500, 9);
    const t0 = performance.now();
    generateSet(big, { ...base, target: { kind: 'minutes', minutes: 120 } });
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

describe('profileTrack', () => {
  it('finds the groove between a sparse intro and outro', () => {
    const bpm = 125;
    const rate = 50;
    const bar = 240 / bpm;
    const bars = 96;
    const duration = bars * bar + 1;
    const n = Math.ceil(duration * rate);
    const wave = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const b = Math.floor(i / rate / bar);
      const body = b >= 16 && b < 80;
      wave[i * 4] = 150; // kick all the way through
      wave[i * 4 + 1] = body ? 140 : 70;
      wave[i * 4 + 2] = body ? 60 : 20;
      wave[i * 4 + 3] = body ? 180 : 150;
    }
    const analysis: TrackAnalysis = { version: 4, duration, bpm, firstBeat: 0, key: makeKey(9, true), loudness: -8, peak: 1, waveform: wave, waveRate: rate };
    const t = { id: 'a', fileName: 'a.wav', size: 1, addedAt: 0, meta: { title: 'A', artist: 'B', album: '', genre: 'techno', year: '', format: 'WAV' }, analysis, cues: { cue: null, hot: [] }, source: 'file', plays: 0, status: 'ready' } as LibraryTrack;
    const p = profileTrack(t)!;
    expect(Math.round(p.introEnd / bar)).toBe(16);
    expect(Math.round(p.outroStart / bar)).toBe(80);
    expect(p.energy).toBeGreaterThan(0.3);
    expect(p.energy).toBeLessThan(1);
    expect(profileTrack({ ...t, status: 'error' })).toBeNull();
    expect(profileTrack({ ...t, analysis: undefined })).toBeNull();
  });
});

describe('exports', () => {
  const lib = library(30);
  lib[0].title = 'Rock & "Roll" <Mix>';
  lib[0].fileName = 'rock & roll.mp3';
  const plan = describeSet(buildPool(lib.slice(0, 4), { anchors: [], discovery: 0 }).candidates, base);

  it('writes paths for both platforms', () => {
    expect(filePath('/Users/me/Music/', 'a.mp3')).toBe('/Users/me/Music/a.mp3');
    expect(filePath('D:\\Music', 'a.mp3')).toBe('D:\\Music\\a.mp3');
    expect(filePath('', 'a.mp3')).toBe('a.mp3');
  });

  it('writes an M3U8 playlist', () => {
    const m3u = toM3U(plan, { name: 'Set', folder: '/Music' });
    const lines = m3u.trim().split('\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines.filter((l) => l.startsWith('#EXTINF')).length).toBe(4);
    expect(lines).toContain('/Music/rock & roll.mp3');
  });

  it('writes escaped rekordbox XML with grids and cues', () => {
    const xml = toRekordboxXml(plan, { name: 'My <Set>', folder: '/Users/me/Music' });
    expect(xml).toContain('Name="Rock &amp; &quot;Roll&quot; &lt;Mix&gt;"');
    expect(xml).toContain('Location="file://localhost/Users/me/Music/rock%20%26%20roll.mp3"');
    expect(xml).toContain('Name="My &lt;Set&gt;"');
    expect((xml.match(/<TRACK TrackID=/g) ?? []).length).toBe(4);
    expect((xml.match(/<TEMPO /g) ?? []).length).toBe(4);
    expect((xml.match(/SmartDJ mix out/g) ?? []).length).toBe(3);
    expect(xml).not.toMatch(/="[^"]*[<>][^"]*"/);
  });

  it('writes Traktor NML with volume-relative locations', () => {
    const nml = toTraktorNml(plan, { name: 'Set', folder: 'D:\\Music\\Techno' });
    expect(nml).toContain('DIR="/:Music/:Techno/:" FILE="rock &amp; roll.mp3" VOLUME="D:"');
    expect(nml).toContain('KEY="D:/:Music/:Techno/:rock &amp; roll.mp3"');
    expect((nml.match(/<ENTRY TITLE=/g) ?? []).length).toBe(4);
    const mac = toTraktorNml(plan, { name: 'Set', folder: '/Volumes/USB/Sets' });
    expect(mac).toContain('DIR="/:Sets/:" FILE="rock &amp; roll.mp3" VOLUME="USB"');
  });

  it('writes a CSV cue sheet', () => {
    const csv = toCsv(plan).trim().split('\n');
    expect(csv).toHaveLength(5);
    expect(csv[0].startsWith('#,Starts at,Artist,Title')).toBe(true);
    expect(csv.some((l) => l.includes('"Rock & ""Roll"" <Mix>"'))).toBe(true);
  });
});

describe('artist sound profiles', () => {
  // the built-in demo crate, profiled the way the app does before analysis
  const demos: TrackProfile[] = DEMO_TRACKS.map((d) =>
    profileTrack({
      id: `demo-${d.spec.seed}`,
      fileName: `${d.title}.demo`,
      size: 0,
      addedAt: 0,
      meta: { title: d.title, artist: d.artist, album: 'Deckhouse Demo Tracks', genre: d.genre ?? d.spec.style, label: d.label, year: '2026', format: 'SYNTH' },
      cues: { cue: null, hot: [] },
      source: 'demo',
      demo: d.spec,
      plays: 0,
      status: 'new',
    } as LibraryTrack),
  ).filter((p): p is TrackProfile => !!p);
  const styleOf = (id: string) => DEMO_TRACKS.find((d) => `demo-${d.spec.seed}` === id)!.spec.style;

  it('recognises sound-lane anchors, including spelling variants', () => {
    expect(styleForAnchor('Deep & Groovy')?.id).toBe('deep');
    expect(styleForAnchor('deep and groovy')?.id).toBe('deep');
    expect(styleForAnchor('Rolling Minimal')?.id).toBe('rolling');
    expect(styleForAnchor('bouncy tech house')?.id).toBe('bouncy');
    expect(styleForAnchor('RAVE ENERGY')?.id).toBe('rave');
    expect(styleForAnchor('Kora Vance')).toBeNull();
  });

  it('matches a lane’s sound from the library', () => {
    const pool = buildPool(demos, { anchors: ['Deep & Groovy'], discovery: 0.25 });
    expect(pool.unmatchedAnchors).toEqual([]);
    expect(pool.warnings.join(' ')).not.toMatch(/Not in your library/);
    expect(pool.notes.join(' ')).toMatch(/matched the sound/);
    const sound = pool.candidates.filter((c) => c.role === 'sound').sort((a, b) => b.affinity - a.affinity);
    expect(sound.length).toBeGreaterThanOrEqual(4);
    expect(sound.slice(0, 4).every((c) => styleOf(c.profile.id) === 'minimal')).toBe(true);
    for (const [anchor, style] of [
      ['Rolling Minimal', 'rolling'],
      ['Bouncy Tech House', 'techhouse'],
      ['Rave Energy', 'rave'],
    ]) {
      const top = buildPool(demos, { anchors: [anchor], discovery: 0.25 })
        .candidates.filter((c) => c.role === 'sound')
        .sort((a, b) => b.affinity - a.affinity)
        .slice(0, 4);
      expect(top.every((c) => styleOf(c.profile.id) === style)).toBe(true);
    }
  });

  it('builds a Style Journey from deep grooves to the rave peak', () => {
    const plan = generateSet(demos, { ...base, anchors: ['Deep & Groovy', 'Rolling Minimal', 'Rave Energy', 'Bouncy Tech House'], arc: 'journey', target: { kind: 'tracks', count: 16 } });
    expect(plan.entries).toHaveLength(16);
    expect(plan.journey).toEqual(['Deep & Groovy', 'Rolling Minimal', 'Bouncy Tech House', 'Rave Energy']);
    const order = ['minimal', 'rolling', 'techhouse', 'rave'];
    const meanPos = order.map((st) => {
      const idx = plan.entries.map((e, i) => (styleOf(e.profile.id) === st ? i : -1)).filter((i) => i >= 0);
      return idx.reduce((s, i) => s + i, 0) / Math.max(1, idx.length);
    });
    for (let i = 1; i < meanPos.length; i++) expect(meanPos[i]).toBeGreaterThan(meanPos[i - 1]);
    expect(plan.entries.slice(0, 3).filter((e) => styleOf(e.profile.id) === 'minimal').length).toBeGreaterThanOrEqual(2);
    expect(plan.entries.slice(-3).filter((e) => styleOf(e.profile.id) === 'rave').length).toBeGreaterThanOrEqual(2);
    expect(plan.harmonicScore).toBeGreaterThanOrEqual(60);
    const first = plan.entries.slice(0, 4).reduce((s, e) => s + e.level, 0) / 4;
    const last = plan.entries.slice(-4).reduce((s, e) => s + e.level, 0) / 4;
    expect(last).toBeGreaterThan(first);
  });

  it('can follow the typed order instead', () => {
    const plan = generateSet(demos, { ...base, anchors: ['Rave Energy', 'Deep & Groovy'], arc: 'journey', journeyOrder: 'typed', target: { kind: 'tracks', count: 8 } });
    expect(plan.journey).toEqual(['Rave Energy', 'Deep & Groovy']);
    expect(plan.entries.slice(0, 2).every((e) => styleOf(e.profile.id) === 'rave')).toBe(true);
    expect(plan.entries.slice(-2).every((e) => styleOf(e.profile.id) === 'minimal')).toBe(true);
  });
});
