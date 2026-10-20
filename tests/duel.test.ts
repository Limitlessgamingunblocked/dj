import { describe, expect, it } from 'vitest';
import { cleanDuel, decodeDuel, duelGhost, duelLink, duelOutcome, duelShareText, encodeDuel, findDuelCode, resample, type Duel } from '../src/game/duel';
import { ghostAt, type GhostPoint } from '../src/game/ghost';

/** a ten-minute run sampled every 2 s, the way a set records it */
function run(scorePerSec: number, vibe = (t: number) => 0.4 + 0.4 * (t / 600)): GhostPoint[] {
  const pts: GhostPoint[] = [];
  for (let t = 0; t <= 600; t += 2) pts.push([t, Math.round(vibe(t) * 1000) / 1000, Math.round(t * scorePerSec)]);
  return pts;
}

const duel = (over: Partial<Duel> = {}): Duel => ({
  v: 1,
  dj: 'NOVA',
  daily: null,
  venue: 'warehouse',
  slot: 'peak',
  minutes: 10,
  score: 12000,
  grade: 'A',
  pts: run(20),
  tracks: [
    { title: 'Night Drive', artist: 'Someone', bpm: 124 },
    { title: 'Second', artist: 'Else', bpm: 126.5 },
  ],
  ...over,
});

describe('ghost duels', () => {
  it('round-trips a run through a code', async () => {
    const d = duel({ daily: '2026-10-18', answers: 9000 });
    const code = await encodeDuel(d);
    expect(code).toMatch(/^DG[01]\./);
    const back = (await decodeDuel(code))!;
    expect(back).toMatchObject({ dj: 'NOVA', daily: '2026-10-18', venue: 'warehouse', slot: 'peak', minutes: 10, score: 12000, grade: 'A', answers: 9000 });
    expect(back.tracks.map((t) => t.title)).toEqual(['Night Drive', 'Second']);
    // the ghost reads the same through the set, near enough
    for (const t of [0, 61, 300, 599, 600]) {
      const a = ghostAt(duelGhost(d), t)!;
      const b = ghostAt(duelGhost(back), t)!;
      expect(Math.abs(a.vibe - b.vibe)).toBeLessThan(0.011);
      expect(Math.abs(a.score - b.score)).toBeLessThan(60);
    }
    expect(back.pts[back.pts.length - 1][0]).toBe(600);
  });

  it('keeps a long set short enough to paste', async () => {
    const pts: GhostPoint[] = [];
    for (let t = 0; t <= 3600; t += 2) pts.push([t, 0.5 + 0.4 * Math.sin(t / 50), t * 30]);
    const s = resample(pts);
    expect(s.vibe.length).toBeLessThanOrEqual(241);
    const code = await encodeDuel(duel({ minutes: 60, pts, score: 108000 }));
    expect(code.length).toBeLessThan(2400);
    expect((await decodeDuel(code))?.minutes).toBe(60);
  });

  it('finds the code in a link or a pasted message', async () => {
    const code = await encodeDuel(duel());
    const link = duelLink('https://example.com/dj/?x=1#old', code);
    expect(link).toBe(`https://example.com/dj/?x=1#duel=${code}`);
    expect(findDuelCode(`beat this 👻 ${link}`)).toBe(code);
    expect((await decodeDuel(link))?.dj).toBe('NOVA');
    expect(findDuelCode('DH1.abc')).toBeNull();
  });

  it('turns away broken codes', async () => {
    expect(await decodeDuel('DG1.!!!!')).toBeNull();
    expect(await decodeDuel('DG0.bm90IGpzb24')).toBeNull();
    expect(cleanDuel({ v: 1, venue: 'warehouse', minutes: 10, pts: [[0, 0.5, 0]] })).toBeNull();
    expect(cleanDuel({ v: 1, venue: 'warehouse', minutes: 500, pts: run(1) })).toBeNull();
    const c = cleanDuel({ v: 1, venue: 'warehouse', minutes: 10, slot: 'nope', grade: 'Z', daily: 'yesterday', pts: [[4, 9, -3], [2, 0.5, 10.4], [1, 2]] })!;
    expect(c.slot).toBe('peak');
    expect(c.grade).toBe('');
    expect(c.daily).toBeNull();
    expect(c.pts).toEqual([[2, 0.5, 10], [4, 1, 0]]);
  });

  it('says who won and how the race went', () => {
    const them = duel({ score: 12000, pts: run(20) });
    // you were behind early, then pulled ahead
    const you = run(0).map(([t, v]): GhostPoint => [t, v, t < 300 ? t * 10 : 3000 + (t - 300) * 33]);
    const o = duelOutcome({ score: you[you.length - 1][2], pts: you }, them);
    expect(o.result).toBe('won');
    expect(o.margin).toBe(you[you.length - 1][2] - 12000);
    expect(o.worstLead).toBe(-3000);
    expect(o.bestLead).toBe(o.margin);
    expect(duelOutcome({ score: 12000, pts: them.pts }, them).result).toBe('draw');
    expect(duelOutcome({ score: 100, pts: [] }, them)).toMatchObject({ result: 'lost', margin: 11900 });
    const text = duelShareText({ you: 'ME', them: 'NOVA', venueName: 'The Warehouse', yourScore: 12900, theirScore: 12000, outcome: o });
    expect(text).toContain("I beat NOVA's ghost at The Warehouse");
    expect(text).toContain('ME 12,900 · NOVA 12,000');
  });
});
