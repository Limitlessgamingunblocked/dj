import { describe, expect, it } from 'vitest';
import { FEED, PROGRESS } from '../src/core/models';
import type { KeyInfo } from '../src/core/types';
import { CHEMISTRY_UNLOCK, chemistryAfter, INTROS, judgeTransition, RIVAL_IDS, RIVALS, rivalOf, rivalPick, TASTE, type B2BTrack } from '../src/game/rivals';
import { addPosts, clipPost, handleFor, likesFor, postsForSet } from '../src/game/social';
import { goldRecords, homeLevel, HOME_TIERS } from '../src/three/venues/hub';
import { seeded } from '../src/game/bookings';
import { ITEMS } from '../src/character/catalog';
import { owned } from '../src/character/look';
import type { SetSummary } from '../src/game/progression';

const key = (camelot: number, letter: 'A' | 'B'): KeyInfo => ({ camelot: `${camelot}${letter}`, name: '', root: 0, minor: letter === 'A', confidence: 1 }) as unknown as KeyInfo;
const tr = (id: string, bpm: number, energy: number, tags: B2BTrack['tags'], k: KeyInfo | null = key(8, 'A')): B2BTrack => ({ id, bpm, energy, tags, key: k });

describe('the rivals (Section 6.10)', () => {
  it('are four distinct, fictional personalities who mention you by name', () => {
    expect(RIVAL_IDS).toHaveLength(4);
    for (const id of RIVAL_IDS) {
      expect(RIVALS[id].name).toMatch(/^[A-Z ]+$/);
      expect(INTROS[id]).toMatch(/\{name\}|\{NAME\}/);
    }
    expect(TASTE.marlowe.mixBars).toBeGreaterThan(TASTE.kiki_volt.mixBars);
    expect(rivalOf('b2b:nox')?.name).toBe('NOX');
    expect(rivalOf('boat')).toBeNull();
  });

  it('pick in their own taste, answering what you played', () => {
    const cur = tr('cur', 126, 6, ['groovy']);
    const pool = [tr('deep', 125, 4, ['deep', 'rolling']), tr('rave', 128, 9, ['rave', 'piano', 'peak']), tr('vocal', 126, 7, ['vocal', 'groovy']), tr('after', 124, 3, ['afterhours', 'deep'])];
    const r = () => 0;
    expect(rivalPick('marlowe', cur, pool, new Set(), r)?.id).toBe('deep');
    expect(rivalPick('kiki_volt', cur, pool, new Set(), r)?.id).toBe('rave');
    expect(rivalPick('double_dutch', cur, pool, new Set(), r)?.id).toBe('vocal');
    expect(rivalPick('nox', cur, pool, new Set(), r)?.id).toBe('after');
    // not what's already been played
    expect(rivalPick('kiki_volt', cur, pool, new Set(['rave']), r)?.id).not.toBe('rave');
  });

  it('judge your mixes: clean, in key, their kind of thing builds chemistry; a trainwreck costs it', () => {
    const theirs = tr('t', 126, 5, ['deep']);
    const good = judgeTransition('marlowe', { from: theirs, to: tr('y', 126, 5, ['deep', 'rolling']), clean: 1 }, () => 0.99);
    const bad = judgeTransition('marlowe', { from: theirs, to: tr('y2', 138, 9, ['rave', 'peak'], key(2, 'B')), clean: 0 }, () => 0.99);
    expect(good.delta).toBeGreaterThan(0.1);
    expect(bad.delta).toBeLessThan(-0.1);
    // MARLOWE judges you for big drops
    const drop = judgeTransition('marlowe', { from: theirs, to: tr('y3', 126, 5, ['deep']), clean: 1, bigDrop: true }, () => 0.99);
    expect(drop.delta).toBeLessThan(good.delta);
    expect(drop.line).toMatch(/drop/i);
    // KIKI VOLT likes it when you push the tempo
    const k1 = judgeTransition('kiki_volt', { from: tr('a', 126, 8, ['rave']), to: tr('b', 128, 9, ['rave']), clean: 0.75 }, () => 0.99);
    const k2 = judgeTransition('kiki_volt', { from: tr('a', 126, 8, ['rave']), to: tr('b', 126, 9, ['rave']), clean: 0.75 }, () => 0.99);
    expect(k1.delta).toBeGreaterThan(k2.delta);
    expect(chemistryAfter(0.95, 0.2)).toBe(1);
    expect(chemistryAfter(0.05, -0.2)).toBe(0);
  });

  it('great chemistry opens their pieces in the wardrobe', () => {
    expect(CHEMISTRY_UNLOCK).toBeGreaterThan(0.5);
    for (const id of RIVAL_IDS) {
      const pieces = ITEMS.filter((i) => i.unlock === `rival:${id}`);
      expect(pieces.length, id).toBeGreaterThanOrEqual(2);
      const p = { ...PROGRESS.defaults(), setsPlayed: 0 };
      expect(owned(pieces[0].unlock, p)).toBe(false);
      expect(owned(pieces[0].unlock, { ...p, unlocked: [`rival:${id}`] })).toBe(true);
    }
  });
});

function set(o: Partial<SetSummary> = {}): SetSummary {
  return { venue: 'warehouse', slot: 'peak', minutes: 20, grade: 'A', average: 0.8, encore: true, full: true, transitions: 6, bassSwaps: 4, longBlends: 1, filterFades: 1, echoOuts: 0, perfect: 2, keyMixes: 3, drops: 4, mistakes: 1, slotMatch: 0.8, avgEnergy: 0.7, fullMinute: false, peakVibe: 0.95, board: 'x', ...o };
}

describe('the social feed (Section 9.6)', () => {
  it('fans post about your set with your name; a better set gets more posts and more likes', () => {
    const great = postsForSet({ summary: set({ grade: 'S' }), dj: 'NIGHT OWL', venueName: 'Warehouse Rave', venue: 'warehouse', followers: 5000, moment: 'The roller door goes up' }, seeded(1));
    const rough = postsForSet({ summary: set({ grade: 'D', encore: false, bassSwaps: 0, perfect: 0 }), dj: 'NIGHT OWL', venueName: 'Warehouse Rave', venue: 'warehouse', followers: 5000 }, seeded(1));
    expect(great.length).toBeGreaterThan(rough.length);
    expect(great.some((p) => p.text.includes('NIGHT OWL'))).toBe(true);
    expect(great.some((p) => p.text.includes('roller door'))).toBe(true);
    expect(great.some((p) => p.kind === 'promoter')).toBe(true);
    for (const p of great) expect(p.handle).toMatch(/^@[a-z0-9_]+$/);
    const avg = (ps: typeof great) => ps.reduce((n, p) => n + p.likes, 0) / ps.length;
    expect(avg(great)).toBeGreaterThan(avg(rough));
  });

  it('likes grow with followers; your clips go up from your account', () => {
    const r = seeded(4);
    expect(likesFor(100_000, 0.8, r)).toBeGreaterThan(likesFor(100, 0.8, r));
    const c = clipPost({ dj: 'Night Owl', venueName: 'Rooftop Bar', venue: 'rooftop', followers: 2000, clip: 'rec_1' }, seeded(2));
    expect(c.kind).toBe('clip');
    expect(c.clip).toBe('rec_1');
    expect(c.handle).toBe(handleFor('Night Owl'));
    expect(handleFor('Night Owl')).toBe('@nightowl');
    expect(handleFor('!!!')).toBe('@dj');
  });

  it('keeps the newest first, survives the save, and stays a sensible size', () => {
    let f = FEED.defaults();
    for (let i = 0; i < 30; i++) f = addPosts(f, postsForSet({ summary: set(), dj: 'DJ', venueName: 'V', venue: 'basement', followers: 10 }, seeded(i)), new Date(Date.UTC(2026, 9, 1, i)));
    expect(f.posts.length).toBeLessThanOrEqual(80);
    expect(Date.parse(f.posts[0].date)).toBeGreaterThan(Date.parse(f.posts[f.posts.length - 1].date));
    expect(new Set(f.posts.map((p) => p.id)).size).toBe(f.posts.length);
    expect(FEED.validate(JSON.parse(JSON.stringify(f)))).toEqual(f);
  });
});

describe('the hub (Section 9.7)', () => {
  it('moves from the bedroom to a studio to the penthouse with fame, with more gold on the wall', () => {
    expect(homeLevel(1)).toBe(0);
    expect(homeLevel(HOME_TIERS[1])).toBe(1);
    expect(homeLevel(7)).toBe(2);
    expect(goldRecords(1, 0)).toBe(0);
    expect(goldRecords(5, 50)).toBeGreaterThan(goldRecords(3, 10));
  });
});
