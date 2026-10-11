/*
 * The daily challenge: one gig a day, the same for everyone who plays it that
 * day. The date picks a venue (any of the career's stages, locked or not: a
 * guest slot), a slot, a twist on the crowd and three objectives from the
 * bookings' list. It's a ten-minute set with your own music.
 *   – the first finished set of the day is your result; play again as much as
 *     you like, it's practice
 *   – a streak counts the days in a row you've played it
 *   – the result shares as a few lines of text: the number, the grade, the
 *     objectives as ticks, the score and the room's vibe as five squares
 *     (one per two minutes), so it pastes anywhere
 *
 * Pure: the app keeps the save and shows the screens.
 */
import type { GoalKind } from '../core/models';
import { GOAL_DEFS, goalMet } from './bookings';
import { CAREER, type CareerVenue, type SetSummary } from './progression';
import type { Grade, SlotId } from './vibe';

/** the first daily (#1) */
const EPOCH = Date.UTC(2026, 0, 1);
const DAY = 86400000;

/** the venues a daily can send you to (not the Bedroom: it's a stream, not a stage) */
export const DAILY_VENUES: CareerVenue[] = ['basement', 'rooftop', 'warehouse', 'beach', 'boat', 'festival', 'sunrise'];
const SLOT_IDS: SlotId[] = ['warmup', 'peak', 'closing', 'afterhours'];

export interface Twist {
  id: string;
  label: string;
  /** what it does to the room's starting vibe */
  vibe: number;
}

export const TWISTS: Twist[] = [
  { id: 'cold', label: 'Cold room: the crowd starts flat', vibe: -0.12 },
  { id: 'hometown', label: 'Hometown crowd: they start warm', vibe: 0.1 },
  { id: 'late', label: 'Doors ran late: a restless room', vibe: -0.05 },
  { id: 'normal', label: 'A normal night', vibe: 0 },
];

export interface DailyGoal {
  kind: GoalKind;
  n: number;
  text: string;
}

export interface DailySpec {
  /** #1 was 1 January 2026 */
  number: number;
  /** the day, YYYY-MM-DD (your local date) */
  key: string;
  venue: CareerVenue;
  slot: SlotId;
  minutes: number;
  twist: Twist;
  goals: DailyGoal[];
}

/** the local date as YYYY-MM-DD */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function keyTime(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** the day before, as a key */
export function dayBefore(key: string): string {
  const t = new Date(keyTime(key) - DAY);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function dailyNumber(key: string): number {
  return Math.round((keyTime(key) - EPOCH) / DAY) + 1;
}

/** a small seeded generator (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** today's challenge (the same for everyone on the same date) */
export function dailyFor(d: Date): DailySpec {
  const key = dayKey(d);
  const number = dailyNumber(key);
  const r = rng(number * 2654435761);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const minutes = 10;
  const venue = pick(DAILY_VENUES);
  const slot = pick(SLOT_IDS);
  const twist = pick(TWISTS);
  const pool = GOAL_DEFS.filter((g) => g.kind !== 'encore');
  const goals: DailyGoal[] = [];
  while (goals.length < 3) {
    const g = pick(pool);
    if (goals.some((x) => x.kind === g.kind)) continue;
    const n = g.n(minutes);
    goals.push({ kind: g.kind, n, text: g.text(n) });
  }
  return { number, key, venue, slot, minutes, twist, goals };
}

/** which objectives a set met */
export function dailyMet(spec: DailySpec, s: SetSummary): boolean[] {
  return spec.goals.map((g) => goalMet(g, s));
}

/** the room's vibe as five squares, one per fifth of the set: 🟩 up, 🟨 middling, 🟥 lost them, ⬛ nothing played */
export function vibeSquares(timeline: { t: number; vibe: number }[], seconds: number): string {
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (seconds * i) / 5;
    const b = (seconds * (i + 1)) / 5;
    const pts = timeline.filter((p) => p.t >= a && p.t < b);
    if (!pts.length) {
      out.push('⬛');
      continue;
    }
    const v = pts.reduce((s, p) => s + p.vibe, 0) / pts.length;
    out.push(v >= 0.7 ? '🟩' : v >= 0.45 ? '🟨' : '🟥');
  }
  return out.join('');
}

export interface DailyResult {
  grade: Grade;
  score: number;
  met: boolean[];
  squares: string;
}

/** the result as text to paste anywhere */
export function shareText(spec: DailySpec, r: DailyResult, streak: number): string {
  const venue = CAREER[spec.venue].name;
  const ticks = r.met.map((m) => (m ? '✅' : '❌')).join('');
  return [
    `Deckhouse Daily #${spec.number} · ${venue}`,
    `${r.grade} · ${ticks} · ${r.score.toLocaleString('en-GB')} pts`,
    r.squares,
    streak > 1 ? `🔥 ${streak}-day streak` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface DailyRecord {
  key: string;
  number: number;
  grade: Grade;
  score: number;
  met: number;
  squares: string;
}

export interface DailySave {
  /** the last day a daily was finished */
  last: string | null;
  streak: number;
  best: number;
  /** the official results, newest first (the last 60) */
  history: DailyRecord[];
}

export const NO_DAILY: DailySave = { last: null, streak: 0, best: 0, history: [] };

/** a saved daily, checked field by field (an old or hand-edited save can't break it) */
export function cleanDaily(raw: unknown): DailySave {
  if (typeof raw !== 'object' || raw === null) return { ...NO_DAILY, history: [] };
  const r = raw as Record<string, unknown>;
  const key = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const history = Array.isArray(r.history)
    ? r.history
        .filter((h): h is Record<string, unknown> => typeof h === 'object' && h !== null && !!key((h as Record<string, unknown>).key))
        .map((h) => ({ key: key(h.key)!, number: num(h.number), grade: (['S', 'A', 'B', 'C', 'D'].includes(h.grade as string) ? h.grade : 'D') as Grade, score: num(h.score), met: Math.min(3, num(h.met)), squares: typeof h.squares === 'string' ? h.squares.slice(0, 20) : '' }))
        .slice(0, 60)
    : [];
  return { last: key(r.last), streak: num(r.streak), best: num(r.best), history };
}

/** the result of today's set: the first one of the day is official and moves the streak; later ones are practice */
export function recordDaily(save: DailySave, spec: DailySpec, r: DailyResult): { save: DailySave; official: boolean } {
  if (save.history.some((h) => h.key === spec.key)) return { save, official: false };
  const streak = save.last === dayBefore(spec.key) ? save.streak + 1 : 1;
  const rec: DailyRecord = { key: spec.key, number: spec.number, grade: r.grade, score: r.score, met: r.met.filter(Boolean).length, squares: r.squares };
  return { save: { last: spec.key, streak, best: Math.max(save.best, streak), history: [rec, ...save.history].slice(0, 60) }, official: true };
}

/** the streak as it stands today (it lapses if yesterday was missed) */
export function liveStreak(save: DailySave, today: string): number {
  return save.last === today || save.last === dayBefore(today) ? save.streak : 0;
}
