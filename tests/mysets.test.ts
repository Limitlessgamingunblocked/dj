import { describe, expect, it } from 'vitest';
import { RECORDINGS, type Recording } from '../src/core/models';
import { cleanupPlan, safeName, sortSets } from '../src/media/sets';
import { replayBytes } from '../src/media/Replay';
import { tracklistText } from '../src/media/cover';
import { clipTracklist } from '../src/ui/TrimEditor';

const rec = (id: string, o: Partial<Recording>): Recording =>
  RECORDINGS.validate({ items: [{ id, date: '2026-10-01T22:00:00Z', kind: 'audio', seconds: 600, bytes: 100 << 20, ...o }] }).items[0];

describe('My Sets', () => {
  const items = [
    rec('a', { date: '2026-10-01T22:00:00Z', seconds: 1800, grade: 'B', title: 'Basement · Peak time', venue: 'basement', bytes: 300 << 20 }),
    rec('b', { date: '2026-10-05T22:00:00Z', seconds: 600, grade: 'S', title: 'Bedroom · Warm-up', venue: 'bedroom', favorite: true, bytes: 200 << 20 }),
    rec('c', { date: '2026-10-08T22:00:00Z', seconds: 30, grade: null, title: 'Clip', venue: 'basement', source: 'clip', bytes: 20 << 20 }),
    rec('d', { date: '2026-09-20T22:00:00Z', seconds: 900, grade: 'A', title: 'Another', venue: 'bedroom', bytes: 500 << 20 }),
  ];

  it('sorts with favourites first, then by the key', () => {
    expect(sortSets(items, 'date').map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(sortSets(items, 'length').map((r) => r.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(sortSets(items, 'grade', false).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortSets(items, 'venue', false).map((r) => r.venue)).toEqual(['basement', 'basement', 'bedroom', 'bedroom']);
  });

  it('clears the oldest first, never a favourite, until enough is free', () => {
    expect(cleanupPlan(items, 400 << 20).map((r) => r.id)).toEqual(['d']);
    expect(cleanupPlan(items, 600 << 20).map((r) => r.id)).toEqual(['d', 'a']);
    expect(cleanupPlan(items, Infinity).map((r) => r.id)).toEqual(['d', 'a', 'c']);
  });

  it('makes safe file names', () => {
    expect(safeName('Night Owl Basement Club')).toBe('Night-Owl-Basement-Club');
    expect(safeName('DJ <script>/..')).toBe('DJ-script..');
    expect(safeName('***')).toBe('set');
  });
});

describe('replay buffer memory', () => {
  it('estimates audio (24-bit) and video use', () => {
    const tenAudio = replayBytes(10, false);
    expect(tenAudio).toBeGreaterThan(170e6);
    expect(tenAudio).toBeLessThan(180e6);
    expect(replayBytes(10, true) - tenAudio).toBeCloseTo((2e6 / 8) * 604, -4);
    expect(replayBytes(0, true)).toBe(0);
  });
});

describe('tracklists', () => {
  it('writes a text file with timestamps', () => {
    const t = tracklistText({ name: 'Night Owl', venue: 'Basement Club', date: new Date('2026-10-09T23:00:00Z'), seconds: 1500, title: 'Basement Club · Peak time', tracklist: [{ at: 0, title: 'Low Ceiling Theory', artist: 'Cold Tap' }, { at: 312, title: 'Sticky Floor', artist: 'Wet Paint' }] });
    expect(t.split('\n').slice(0, 5)).toEqual(['Night Owl — Basement Club · Peak time', 'Basement Club, 9 October 2026 · 25:00', '', '00:00  Low Ceiling Theory — Cold Tap', '05:12  Sticky Floor — Wet Paint']);
  });

  it('cuts a clip’s tracklist, carrying in the track already playing', () => {
    const list = [
      { at: 0, title: 'A', artist: 'x' },
      { at: 100, title: 'B', artist: 'y' },
      { at: 200, title: 'C', artist: 'z' },
    ];
    expect(clipTracklist(list, 150, 260)).toEqual([
      { at: 0, title: 'B', artist: 'y' },
      { at: 50, title: 'C', artist: 'z' },
    ]);
    expect(clipTracklist(list, 0, 50)).toEqual([{ at: 0, title: 'A', artist: 'x' }]);
  });
});
