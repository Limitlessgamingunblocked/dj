/*
 * Ghost replays for the daily challenge: your best run of today's daily is
 * kept (the room's vibe and your score, every two seconds), and when you play
 * it again the ghost runs alongside: a faint second marker on the vibe meter,
 * how far ahead or behind you are on points, and a faint line on the results
 * graph. Saved in settings ("dailyGhost"), one day at a time.
 */
import { loadSetting, saveSetting } from '../core/settings';

/** [set seconds, vibe 0..1, score] */
export type GhostPoint = [number, number, number];

export interface Ghost {
  /** the daily's date key */
  key: string;
  score: number;
  grade: string;
  pts: GhostPoint[];
}

/** the ghost's vibe and score at a time in the set (between its samples) */
export function ghostAt(g: Ghost, t: number): { vibe: number; score: number } | null {
  const p = g.pts;
  if (!p.length || t < 0) return null;
  if (t >= p[p.length - 1][0]) return { vibe: p[p.length - 1][1], score: p[p.length - 1][2] };
  let i = 1;
  while (i < p.length && p[i][0] < t) i++;
  const a = p[i - 1];
  const b = p[Math.min(i, p.length - 1)];
  const k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  return { vibe: a[1] + (b[1] - a[1]) * k, score: Math.round(a[2] + (b[2] - a[2]) * k) };
}

/** a saved ghost, checked (an old or hand-edited one can't break the HUD) */
export function cleanGhost(raw: unknown): Ghost | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.key !== 'string' || !Array.isArray(r.pts)) return null;
  const pts = r.pts
    .filter((x): x is number[] => Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number' && Number.isFinite(n)))
    .map((x): GhostPoint => [Math.max(0, x[0]), Math.max(0, Math.min(1, x[1])), Math.max(0, Math.round(x[2]))])
    .slice(0, 2000);
  if (!pts.length) return null;
  return { key: r.key, score: typeof r.score === 'number' ? Math.max(0, Math.round(r.score)) : pts[pts.length - 1][2], grade: typeof r.grade === 'string' ? r.grade.slice(0, 1) : '', pts };
}

/** today's ghost, if there's one for this daily */
export function loadGhost(key: string): Ghost | null {
  const g = cleanGhost(loadSetting<unknown>('dailyGhost', null));
  return g && g.key === key ? g : null;
}

/** keep this run if it beat the ghost (or there isn't one for today); true if kept */
export function keepIfBest(run: Ghost): boolean {
  const old = loadGhost(run.key);
  if (old && old.score >= run.score) return false;
  saveSetting('dailyGhost', run);
  return true;
}
