/*
 * Achievements: long-run goals on top of the milestones. Each one counts
 * something the career already keeps (sets, perfect transitions, bass swaps,
 * fame, the daily streak, cash spent in the shop…) and has three levels,
 * bronze, silver and gold, each paying a little cash the first time.
 *
 * A level reached is a key in `progress.unlocked` (`ach:<id>:<level>`), so it's
 * saved with the career, paid once, and the wall can tell what's new. Plain
 * data in, plain data out: `awardAchievements()` returns the patch to save.
 */
import type { Progress } from '../core/models';

export const LEVELS = ['Bronze', 'Silver', 'Gold'] as const;
/** what each level pays, the first time */
const PAY = [50, 200, 750] as const;

export interface Achievement {
  id: string;
  label: string;
  /** what it counts, with {n} for the goal ({s} pluralises) */
  blurb: string;
  goals: [number, number, number];
  value(p: Progress): number;
}

type P = Progress;
const stat = (k: string) => (p: P) => p.stats[k] ?? 0;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'sets', label: 'Night Shift', blurb: 'Play {n} sets', goals: [5, 25, 100], value: (p) => p.setsPlayed },
  { id: 'hours', label: 'Booth Hours', blurb: 'Spend {n} minutes in the booth', goals: [60, 600, 3000], value: stat('minutes') },
  { id: 'perfect', label: 'Locked In', blurb: 'Land {n} perfect transitions', goals: [10, 100, 500], value: stat('perfect') },
  { id: 'bass', label: 'Low End', blurb: 'Make {n} bass swaps', goals: [25, 100, 500], value: stat('bass_swaps') },
  { id: 'blends', label: 'The Long Blend', blurb: 'Ride {n} long blends', goals: [10, 50, 200], value: stat('long_blends') },
  { id: 'keys', label: 'In Key', blurb: 'Mix {n} times in key', goals: [10, 100, 400], value: stat('key_mixes') },
  { id: 'drops', label: 'Drop Merchant', blurb: 'Land {n} drops', goals: [25, 150, 600], value: stat('drops') },
  { id: 'flawless', label: 'Flawless', blurb: 'Get {n} S grade{s}', goals: [1, 5, 25], value: stat('grade:S') },
  { id: 'encores', label: 'One More Tune', blurb: 'Get called back for {n} encore{s}', goals: [1, 10, 40], value: stat('encores') },
  { id: 'sold_out', label: 'House Full', blurb: 'Sell out {n} show{s}', goals: [1, 10, 50], value: stat('sold_out') },
  { id: 'objectives', label: 'Promoter’s Pick', blurb: 'Hit {n} booking objectives', goals: [3, 20, 75], value: stat('objectives_met') },
  { id: 'venues', label: 'On The Road', blurb: 'Play {n} career venues', goals: [3, 6, 8], value: (p) => p.venuesPlayed.length },
  { id: 'boards', label: 'Gear Head', blurb: 'Play sets on {n} different boards', goals: [2, 4, 6], value: (p) => p.boardsPlayed.length },
  { id: 'fame', label: 'Rising Star', blurb: 'Reach {n} fame', goals: [300, 1400, 4500], value: (p) => p.fame },
  { id: 'followers', label: 'Following', blurb: 'Reach {n} followers', goals: [1000, 10000, 100000], value: (p) => p.followers },
  { id: 'earned', label: 'Paid In Full', blurb: 'Earn ${n} from sets', goals: [1000, 10000, 50000], value: stat('cash_earned') },
  { id: 'spent', label: 'Big Spender', blurb: 'Spend ${n} in the shop', goals: [300, 3000, 15000], value: stat('shop_spent') },
  { id: 'clips', label: 'Content Machine', blurb: 'Save {n} clips', goals: [3, 10, 50], value: stat('clips') },
  { id: 'daily', label: 'Daily Habit', blurb: 'Keep a {n}-day daily streak', goals: [3, 7, 30], value: stat('daily_streak') },
  { id: 'milestones', label: 'Milestone Hunter', blurb: 'Reach {n} milestones', goals: [3, 8, 12], value: (p) => p.milestones.length },
];
export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export const achKey = (id: string, level: number) => `ach:${id}:${level}`;

/** levels the numbers have reached, 0..3 */
export function reached(a: Achievement, p: Progress): number {
  const v = a.value(p);
  return a.goals.filter((g) => v >= g).length;
}

/** levels already awarded (saved), 0..3 */
export function awarded(a: Achievement, unlocked: string[]): number {
  let n = 0;
  while (n < 3 && unlocked.includes(achKey(a.id, n + 1))) n++;
  return n;
}

export const goalText = (a: Achievement, level: number) => a.blurb.replace('{n}', a.goals[level].toLocaleString()).replace('{s}', a.goals[level] === 1 ? '' : 's');

export interface Earned {
  id: string;
  label: string;
  /** 1 bronze, 2 silver, 3 gold */
  level: number;
  cash: number;
}

/** every level reached but not yet awarded: their keys and cash, as a patch (null: nothing new) */
export function awardAchievements(p: Progress): { patch: Partial<Progress> | null; got: Earned[] } {
  const got: Earned[] = [];
  for (const a of ACHIEVEMENTS) {
    const r = reached(a, p);
    for (let l = awarded(a, p.unlocked) + 1; l <= r; l++) got.push({ id: a.id, label: a.label, level: l, cash: PAY[l - 1] });
  }
  if (!got.length) return { patch: null, got };
  return {
    patch: {
      unlocked: [...new Set([...p.unlocked, ...got.map((g) => achKey(g.id, g.level))])],
      cash: p.cash + got.reduce((s, g) => s + g.cash, 0),
    },
    got,
  };
}

/** "Locked In · Silver" */
export const earnedLabel = (g: Earned) => `${g.label} · ${LEVELS[g.level - 1]}`;

export interface AchievementRow {
  a: Achievement;
  value: number;
  level: number;
  /** the next level's goal in words (null: gold) */
  next: string | null;
  /** how far to the next level, 0..1 */
  k: number;
  /** what the next level pays */
  pay: number | null;
}

/** the wall: each achievement, its level and how far to the next */
export function achievementRows(p: Progress): AchievementRow[] {
  return ACHIEVEMENTS.map((a) => {
    const value = a.value(p);
    const level = Math.max(awarded(a, p.unlocked), reached(a, p));
    const lo = level ? a.goals[level - 1] : 0;
    const hi = level < 3 ? a.goals[level] : lo;
    return { a, value, level, next: level < 3 ? goalText(a, level) : null, k: level < 3 ? Math.max(0, Math.min(1, (value - lo) / (hi - lo))) : 1, pay: level < 3 ? PAY[level] : null };
  });
}

/** levels earned out of all of them */
export function achievementScore(p: Progress): { got: number; of: number } {
  return { got: achievementRows(p).reduce((s, r) => s + r.level, 0), of: ACHIEVEMENTS.length * 3 };
}
