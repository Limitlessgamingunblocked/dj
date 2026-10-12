import { describe, expect, it } from 'vitest';
import { cleanGhost, ghostAt, type Ghost } from '../src/game/ghost';
import { cleanSetCode, decodeSetCode, encodeSetCode, matchTracks } from '../src/game/setcode';
import { cleanVisual, LAYER_KINDS } from '../src/visualizer/myvisual';
import { formation, FORMATIONS } from '../src/three/venues/skyshow';

describe('ghost replays', () => {
  const g: Ghost = { key: '2026-10-12', score: 900, grade: 'A', pts: [[0, 0.3, 0], [10, 0.5, 400], [20, 0.9, 900]] };

  it('reads the ghost between its samples', () => {
    expect(ghostAt(g, 5)).toEqual({ vibe: 0.4, score: 200 });
    expect(ghostAt(g, 30)).toEqual({ vibe: 0.9, score: 900 });
    expect(ghostAt(g, -1)).toBeNull();
  });

  it('cleans a broken save', () => {
    expect(cleanGhost({ key: 'x', pts: [[1, 2]] })).toBeNull();
    const c = cleanGhost({ key: 'x', pts: [[1, 5, 3.6], [2, -1, 4]] })!;
    expect(c.pts).toEqual([[1, 1, 4], [2, 0, 4]]);
  });
});

describe('set codes', () => {
  it('round-trips a set through a code', async () => {
    const set = { v: 1 as const, dj: 'NOVA', venue: 'warehouse', tracks: [{ title: 'Night Drive', artist: 'Someone', bpm: 124.04 }, { title: 'Second', artist: 'Else', bpm: 126 }] };
    const code = await encodeSetCode(set);
    expect(code).toMatch(/^DH[01]\./);
    const back = await decodeSetCode(code);
    expect(back?.dj).toBe('NOVA');
    expect(back?.tracks.map((t) => t.title)).toEqual(['Night Drive', 'Second']);
    expect(back?.tracks[0].bpm).toBe(124);
  });

  it('rejects junk and trims what it keeps', async () => {
    expect(await decodeSetCode('hello')).toBeNull();
    expect(await decodeSetCode('DH0.!!!')).toBeNull();
    const c = cleanSetCode({ v: 1, venue: 'x', dj: 'a'.repeat(99), tracks: Array.from({ length: 60 }, (_, i) => ({ title: `t${i}`, artist: '', bpm: 120 })) })!;
    expect(c.dj.length).toBe(24);
    expect(c.tracks.length).toBe(40);
  });

  it('matches tracks by title and artist, then title', () => {
    const have = [
      { id: '1', title: 'Night Drive (Original Mix)', artist: 'Someone' },
      { id: '2', title: 'Second', artist: 'Other' },
    ];
    const m = matchTracks([{ title: 'Night Drive', artist: 'Someone', bpm: 0 }, { title: 'Second', artist: 'Else', bpm: 0 }, { title: 'Missing', artist: '', bpm: 0 }], have);
    expect(m.found.map((t) => t.id)).toEqual(['1', '2']);
    expect(m.missing.map((t) => t.title)).toEqual(['Missing']);
  });
});

describe('visual editor', () => {
  it('cleans a saved visual into something playable', () => {
    const v = cleanVisual({ name: 'x'.repeat(80), layers: [{ kind: 'nope' }, { kind: 'tunnel', opacity: 9 }] }, 0);
    expect(v.name.length).toBeLessThanOrEqual(40);
    for (const l of v.layers) expect(LAYER_KINDS).toContain(l.kind);
    const d = cleanVisual(null, 1);
    expect(d.layers.length).toBeGreaterThan(0);
  });
});

describe('drone show', () => {
  it('every formation places every drone inside its box', () => {
    for (const f of FORMATIONS) {
      const pts = formation(f, 120, 3, 0.5, 'NOVA');
      expect(pts).toHaveLength(120);
      for (const p of pts) {
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1.3);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1.3);
      }
    }
  });
});
