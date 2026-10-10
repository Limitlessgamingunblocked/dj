import { describe, expect, it } from 'vitest';
import { Director, MIN_BARS, PHRASE, type DirectorInput } from '../src/visualizer/director';
import type { ModeInfo } from '../src/visualizer/kit';

const MODES: ModeInfo[] = [
  { id: 'c1', name: '', blurb: '', energy: 'calm' },
  { id: 'c2', name: '', blurb: '', energy: 'calm' },
  { id: 'm1', name: '', blurb: '', energy: 'mid' },
  { id: 'm2', name: '', blurb: '', energy: 'mid' },
  { id: 'm3', name: '', blurb: '', energy: 'mid' },
  { id: 'p1', name: '', blurb: '', energy: 'peak' },
  { id: 'p2', name: '', blurb: '', energy: 'peak' },
];
const at = (beat: number, o: Partial<DirectorInput> = {}): DirectorInput => ({ beatCount: beat, playing: true, breakdown: 0, drop: 0, dropHit: false, energy: 0.5, ...o });
const energy = (id: string) => MODES.find((m) => m.id === id)!.energy;

describe('the auto VJ', () => {
  it('changes on a bar line once a phrase has played, never mid-bar', () => {
    const d = new Director(MODES, () => 0.99);
    const cuts: { beat: number; id: string }[] = [];
    let cur = 'm1';
    for (let b = 0; b < 4 * PHRASE * 2 + 4; b += 0.25) {
      const c = d.tick(cur, at(b));
      if (c) {
        cuts.push({ beat: b, id: c.id });
        cur = c.id;
      }
    }
    expect(cuts.length).toBe(2);
    for (const c of cuts) expect(c.beat % 4).toBe(0);
    expect(cuts[0].beat).toBe(4 * PHRASE);
    expect(cuts[0].id).not.toBe('m1');
    expect(cuts[1].id).not.toBe(cuts[0].id);
  });

  it('goes to a peak mode on the drop, and a calm one in the breakdown', () => {
    const d = new Director(MODES, () => 0.3);
    expect(d.tick('m1', at(0))).toBeNull();
    const drop = d.tick('m1', at(1, { dropHit: true, drop: 1 }));
    expect(drop && energy(drop.id)).toBe('peak');
    expect(drop?.kind).toBe('zoom');
    // a breakdown after a few bars: calm, with a slow fade
    let cut = null;
    for (let b = 2; b < 4 * (MIN_BARS + 2) && !cut; b += 0.5) cut = d.tick(drop!.id, at(b, { breakdown: 0.8 }));
    expect(cut && energy(cut.id)).toBe('calm');
    expect(cut?.kind).toBe('fade');
  });

  it('holds while paused and doesn’t repeat what it just played', () => {
    const d = new Director(MODES, () => 0);
    for (let b = 0; b < 4 * PHRASE * 3; b++) expect(d.tick('m1', at(b, { playing: false }))).toBeNull();
    const seen: string[] = [];
    let cur = 'm1';
    for (let b = 0; b < 4 * PHRASE * 3 + 1; b++) {
      const c = d.tick(cur, at(b, { energy: 0.5 }));
      if (c) {
        seen.push(c.id);
        cur = c.id;
      }
    }
    // with three groove modes it cycles through them all before coming back
    expect(new Set(seen).size).toBe(Math.min(seen.length, 3));
    expect(seen.every((id) => energy(id) === 'mid')).toBe(true);
  });

  it('doesn’t throw over a fresh peak mode for every drop', () => {
    const d = new Director(MODES, () => 0);
    d.played('p1');
    expect(d.tick('p1', at(0, { dropHit: true, drop: 1 }))).toBeNull();
  });
});
