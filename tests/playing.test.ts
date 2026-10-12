import { describe, expect, it } from 'vitest';
import { makeKey } from '../src/analysis/keys';
import { harmonicPicks, keyAt, wheelGlow, wheelSpot } from '../src/game/harmonic';
import { cleanLabel, labelName, playedBy, playPost, release, rivalNights } from '../src/game/label';
import { bestSection, matchRate, planEdit, planMashup, planSeconds, type MashSource } from '../src/game/mashup';
import { Judge, PATTERNS, schedule, StrokeDetector } from '../src/game/scratch';
import { seeded } from '../src/game/bookings';
import type { LibraryTrack } from '../src/core/types';

describe('scratch challenges', () => {
  it('every pattern has hits inside its length', () => {
    for (const p of PATTERNS) {
      expect(p.hits.length).toBeGreaterThan(0);
      for (const h of p.hits) {
        expect(h.beat).toBeGreaterThanOrEqual(0);
        expect(h.beat).toBeLessThan(p.beats);
      }
    }
    const s = schedule(PATTERNS[0], 2);
    expect(s).toHaveLength(16);
    expect(s[8].t).toBeCloseTo((60 / PATTERNS[0].bpm) * 4);
  });

  it('turns jog movement into strokes on each change of direction', () => {
    const d = new StrokeDetector();
    const strokes: number[] = [];
    let t = 0;
    // forward for 0.2 s, back for 0.2 s, forward again (60 updates a second, 0.02 rev each = 1.2 rev/s)
    for (const dir of [1, -1, 1]) {
      for (let i = 0; i < 12; i++) {
        t += 1 / 60;
        const s = d.feed(t, dir * 0.02);
        if (s) strokes.push(s.dir);
      }
    }
    expect(strokes).toEqual([1, -1, 1]);
    // slow drift isn't a stroke
    const slow = new StrokeDetector();
    let n = 0;
    for (let i = 0; i < 60; i++) if (slow.feed(i / 60, 0.001)) n++;
    expect(n).toBe(0);
  });

  it('judges timing and direction, and counts misses and extras', () => {
    const p = PATTERNS.find((x) => x.id === 'baby')!;
    const exp = schedule(p, 1);
    const j = new Judge(exp);
    expect(j.input(exp[0].t + 0.02, 'stroke', 1)?.band).toBe('perfect');
    expect(j.input(exp[1].t - 0.08, 'stroke', -1)?.band).toBe('good');
    // wrong direction doesn't count
    expect(j.input(exp[2].t, 'stroke', -1)).toBeNull();
    expect(j.extra).toBe(1);
    const missed = j.tick(exp[3].t + 0.2);
    expect(missed).toEqual([2, 3]);
    const sc = j.score();
    expect(sc.counts.perfect).toBe(1);
    expect(sc.counts.good).toBe(1);
    expect(sc.points).toBe(100 + 60 - 15);
  });

  it('a forward scratch’s way back is free', () => {
    const p = PATTERNS.find((x) => x.id === 'forward')!;
    const j = new Judge(schedule(p, 1));
    j.input(0.3, 'stroke', -1);
    expect(j.extra).toBe(0);
  });
});

const src = (o: Partial<MashSource>): MashSource => ({ id: 'a', title: 'A', bpm: 124, firstBeat: 0.1, duration: 300, key: makeKey(9, true), sections: null, ...o });

describe('mashups and edits', () => {
  it('matches tempo the shortest way, half and double time included', () => {
    expect(matchRate(124, 124)).toBe(1);
    expect(matchRate(120, 126)).toBeCloseTo(1.05);
    expect(matchRate(70, 140)).toBeCloseTo(1);
    expect(matchRate(174, 87)).toBeCloseTo(1);
  });

  it('lays A’s top over B’s beat, gives each its best part, on bars', () => {
    const A = src({ id: 'a', title: 'Vox', bpm: 120, sections: [{ kind: 'intro', bar: 0, t: 0.1 }, { kind: 'drop', bar: 32, t: 0.1 + 32 * 2 }] });
    const B = src({ id: 'b', title: 'Beat', bpm: 126, firstBeat: 0.2, key: makeKey(9, true), sections: [{ kind: 'intro', bar: 0, t: 0.2 }, { kind: 'drop', bar: 48, t: 0.2 + 48 * (240 / 126) }] });
    const p = planMashup(A, B);
    expect(p.bpm).toBe(126);
    expect(p.rate.A).toBeCloseTo(1.05);
    expect(p.semis).toBeGreaterThan(0.8);
    expect(p.parts.some((x) => x.src === 'A' && x.layer === 'top')).toBe(true);
    expect(p.parts.some((x) => x.src === 'B' && x.layer === 'beat')).toBe(true);
    // a top part always rides a beat part at the same place
    for (const top of p.parts.filter((x) => x.layer === 'top')) expect(p.parts.some((x) => x.layer === 'beat' && x.at === top.at && x.bars === top.bars)).toBe(true);
    // parts start on their track's bars
    for (const part of p.parts) {
      const s = part.src === 'A' ? A : B;
      const bars = (part.from - s.firstBeat) / ((60 / s.bpm) * 4);
      expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
    }
    expect(planSeconds(p)).toBeGreaterThan(60);
    expect(bestSection(B)).toBeCloseTo(0.2 + 48 * (240 / 126));
  });

  it('warns about a big tempo jump and a key clash', () => {
    const p = planMashup(src({ bpm: 100, key: makeKey(0, false) }), src({ bpm: 128, key: makeKey(6, false) }));
    expect(p.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('an edit runs longer than the drop twice', () => {
    const A = src({ sections: [{ kind: 'intro', bar: 0, t: 0.1 }, { kind: 'breakdown', bar: 48, t: 0.1 + 48 * (240 / 124) }, { kind: 'drop', bar: 64, t: 0.1 + 64 * (240 / 124) }] });
    const p = planEdit(A);
    expect(p.parts.filter((x) => x.label.startsWith('Drop'))).toHaveLength(2);
    expect(p.title).toContain('Extended Edit');
    let at = 0;
    for (const part of p.parts) {
      expect(part.at).toBe(at);
      at += part.bars;
    }
  });
});

const track = (id: string, camelot: [number, boolean], bpm: number): LibraryTrack =>
  ({ id, meta: { title: id, artist: 'x' }, status: 'ready', analysis: { bpm, key: keyAt(camelot[0], camelot[1]) } }) as unknown as LibraryTrack;

describe('harmonic wheel', () => {
  it('finds keys round the wheel', () => {
    for (let n = 1; n <= 12; n++)
      for (const minor of [true, false]) {
        const k = keyAt(n, minor);
        expect(wheelSpot(k)).toEqual({ n, minor });
      }
  });

  it('ranks in-key tracks first and leaves clashes out', () => {
    const now = keyAt(8, true);
    const list = [track('same', [8, true], 124), track('step', [9, true], 124), track('rel', [8, false], 126), track('clash', [2, true], 124), track('far', [8, true], 150)];
    const picks = harmonicPicks(now, 124, list);
    expect(picks.map((p) => p.id)).not.toContain('clash');
    expect(picks[0].id).toBe('same');
    expect(picks.findIndex((p) => p.id === 'far')).toBeGreaterThan(picks.findIndex((p) => p.id === 'step'));
    expect(harmonicPicks(now, 124, list, ['same'])[0].id).not.toBe('same');
    const glow = wheelGlow(now);
    expect(glow.get('8A')).toBe(1);
    expect(glow.has('2A')).toBe(false);
  });
});

describe('your label', () => {
  it('releases once, counts plays and who played it', () => {
    let l = cleanLabel(null);
    expect(labelName(l, 'NOVA')).toBe('NOVA Records');
    l = release(l, { trackId: 't1', title: 'A × B', kind: 'mashup', night: 3 });
    l = release(l, { trackId: 't1', title: 'A × B', kind: 'mashup', night: 3 });
    expect(l.releases).toHaveLength(1);
    l = playedBy(l, 't1', 'nox');
    l = playedBy(l, 't1', 'nox');
    expect(l.releases[0].plays).toBe(2);
    expect(l.releases[0].by).toEqual(['nox']);
  });

  it('rivals pick releases up over the nights, and never for nights already counted', () => {
    let l = release(cleanLabel(null), { trackId: 't1', title: 'Edit', kind: 'edit', night: 1 });
    let total = 0;
    for (let n = 2; n < 40; n++) {
      const out = rivalNights(l, n, seeded(n));
      l = out.label;
      total += out.plays.length;
    }
    expect(total).toBeGreaterThan(3);
    expect(rivalNights(l, 39, seeded(1)).plays).toHaveLength(0);
    const post = playPost('kiki_volt', 'Edit', 'NOVA', 'NOVA Records');
    expect(post.text.length).toBeGreaterThan(10);
  });

  it('cleans a damaged save', () => {
    const l = cleanLabel({ name: '  ', releases: [{ trackId: 1 }, { trackId: 'a', title: 'x', by: ['nox', 'nobody'] }] });
    expect(l.name).toBe('');
    expect(l.releases).toHaveLength(1);
    expect(l.releases[0].by).toEqual(['nox']);
  });
});
