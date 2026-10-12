/*
 * Scratch and juggle challenges (opt-in, scored; not a tutorial): a rhythm
 * pattern to play on the jog wheel, the fader or the two decks, against a
 * click. Pure logic here (the patterns, turning jog movement into strokes,
 * judging each hit); the screen is ui/ScratchChallenge.ts.
 */
import { loadSetting, saveSetting } from '../core/settings';

/** a stroke on the record: forward (+1) or back (-1); a fader cut; a deck dropped in */
export type HitKind = 'stroke' | 'cut' | 'drop';

export interface Hit {
  /** beats from the start of the pattern */
  beat: number;
  kind: HitKind;
  /** a stroke's direction (0: either), a drop's deck */
  dir: 1 | -1 | 0;
  deck?: 1 | 2;
}

export interface ScratchPattern {
  id: string;
  name: string;
  /** how to do it */
  how: string;
  bpm: number;
  /** the pattern's length in beats (it repeats) */
  beats: number;
  hits: Hit[];
  input: 'jog' | 'fader' | 'decks';
  level: 1 | 2 | 3;
}

const strokes = (list: [number, 1 | -1][]): Hit[] => list.map(([beat, dir]) => ({ beat, kind: 'stroke', dir }));

export const PATTERNS: ScratchPattern[] = [
  {
    id: 'baby',
    name: 'Baby scratch',
    how: 'Push the record forward and pull it back, on every eighth note. No fader.',
    bpm: 86,
    beats: 4,
    hits: strokes([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b, i) => [b, i % 2 ? -1 : 1])),
    input: 'jog',
    level: 1,
  },
  {
    id: 'forward',
    name: 'Forward scratch',
    how: 'A sharp push forward on every beat. Bring it back any way you like between.',
    bpm: 92,
    beats: 4,
    hits: strokes([[0, 1], [1, 1], [2, 1], [3, 1]]),
    input: 'jog',
    level: 1,
  },
  {
    id: 'stabs',
    name: 'Stabs',
    how: 'Short, sharp strokes in a broken rhythm: listen for the gaps.',
    bpm: 94,
    beats: 4,
    hits: strokes([[0, 1], [0.5, -1], [1.5, 1], [2, -1], [2.5, 1], [3, -1], [3.25, 1], [3.5, -1]]),
    input: 'jog',
    level: 2,
  },
  {
    id: 'triplet',
    name: 'Triplets',
    how: 'Three strokes to a beat: forward, back, forward, then back, forward, back.',
    bpm: 80,
    beats: 4,
    hits: strokes(Array.from({ length: 12 }, (_, i) => [i / 3, i % 2 ? -1 : 1] as [number, 1 | -1])),
    input: 'jog',
    level: 3,
  },
  {
    id: 'transformer',
    name: 'Transformer',
    how: 'Hold the record moving and tap the fader open on every sixteenth, for a beat at a time.',
    bpm: 88,
    beats: 4,
    hits: [0, 0.25, 0.5, 0.75, 2, 2.25, 2.5, 2.75].map((beat) => ({ beat, kind: 'cut' as const, dir: 0 as const })),
    input: 'fader',
    level: 2,
  },
  {
    id: 'juggle',
    name: 'Beat juggle',
    how: 'Set hot cue 1 on both decks on the same beat. Drop deck 1 on the one, deck 2 on the three: hot cue, or cue and play.',
    bpm: 96,
    beats: 4,
    hits: [
      { beat: 0, kind: 'drop', dir: 0, deck: 1 },
      { beat: 2, kind: 'drop', dir: 0, deck: 2 },
      { beat: 3, kind: 'drop', dir: 0, deck: 1 },
    ],
    input: 'decks',
    level: 3,
  },
];

/** the hits to play over `bars` repeats, in seconds from the first downbeat */
export function schedule(p: ScratchPattern, repeats: number): { t: number; hit: Hit }[] {
  const beat = 60 / p.bpm;
  const out: { t: number; hit: Hit }[] = [];
  for (let r = 0; r < repeats; r++) for (const hit of p.hits) out.push({ t: (r * p.beats + hit.beat) * beat, hit });
  return out;
}

/**
 * Jog movement into strokes: a stroke starts when the record gets moving
 * (or changes direction) fast enough.
 */
export class StrokeDetector {
  private v = 0;
  private dir: 1 | -1 | 0 = 0;
  private lastT = -1;
  private still = 0;
  /** revolutions per second that count as a stroke, and as still */
  constructor(
    private on = 0.45,
    private off = 0.12,
  ) {}

  /** a jog movement at time t (seconds): the new stroke, if one started */
  feed(t: number, revs: number): { t: number; dir: 1 | -1 } | null {
    const dt = this.lastT < 0 ? 1 / 60 : Math.max(1 / 240, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    const inst = revs / dt;
    // smooth a little: controllers send movement in bursts
    this.v += (inst - this.v) * 0.6;
    const sp = Math.abs(this.v);
    if (sp < this.off) {
      this.still += dt;
      if (this.still > 0.05) this.dir = 0;
      return null;
    }
    this.still = 0;
    const d: 1 | -1 = this.v > 0 ? 1 : -1;
    if (sp >= this.on && d !== this.dir) {
      this.dir = d;
      return { t, dir: d };
    }
    return null;
  }

  /** time passing with no movement (the record stopped under your hand) */
  idle(t: number): void {
    if (this.lastT >= 0 && t - this.lastT > 0.06) {
      this.v = 0;
      this.dir = 0;
    }
  }
}

export type Band = 'perfect' | 'good' | 'ok' | 'miss';

export const WINDOW = { perfect: 0.05, good: 0.1, ok: 0.15 };

export const BAND_POINTS: Record<Band, number> = { perfect: 100, good: 60, ok: 30, miss: 0 };

/** judging the hits as they come */
export class Judge {
  readonly results: (Band | null)[];
  extra = 0;
  private next = 0;

  constructor(readonly expected: { t: number; hit: Hit }[]) {
    this.results = expected.map(() => null);
  }

  /** something you did at time t: which hit it was, and how close */
  input(t: number, kind: HitKind, dir: 1 | -1 | 0, deck?: 1 | 2): { i: number; band: Band } | null {
    let best = -1;
    let bd = Infinity;
    for (let i = this.next; i < this.expected.length; i++) {
      const e = this.expected[i];
      if (e.t - t > WINDOW.ok) break;
      if (this.results[i] || e.hit.kind !== kind) continue;
      if (kind === 'stroke' && e.hit.dir !== 0 && dir !== 0 && e.hit.dir !== dir) continue;
      if (kind === 'drop' && e.hit.deck && deck && e.hit.deck !== deck) continue;
      const d = Math.abs(e.t - t);
      if (d <= WINDOW.ok && d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) {
      // a forward scratch's way back isn't scored
      const freeBack = kind === 'stroke' && dir === -1 && this.expected.every((e) => e.hit.kind !== 'stroke' || e.hit.dir === 1);
      if (!freeBack) this.extra++;
      return null;
    }
    const band: Band = bd <= WINDOW.perfect ? 'perfect' : bd <= WINDOW.good ? 'good' : 'ok';
    this.results[best] = band;
    return { i: best, band };
  }

  /** hits whose moment has passed unplayed */
  tick(t: number): number[] {
    const missed: number[] = [];
    while (this.next < this.expected.length && this.expected[this.next].t + WINDOW.ok < t) {
      if (!this.results[this.next]) {
        this.results[this.next] = 'miss';
        missed.push(this.next);
      }
      this.next++;
    }
    return missed;
  }

  get done(): boolean {
    return this.results.every((r) => r !== null);
  }

  score(): { points: number; accuracy: number; stars: 0 | 1 | 2 | 3; counts: Record<Band, number> } {
    const counts: Record<Band, number> = { perfect: 0, good: 0, ok: 0, miss: 0 };
    for (const r of this.results) counts[r ?? 'miss']++;
    const max = this.expected.length * BAND_POINTS.perfect;
    const raw = this.results.reduce((n, r) => n + BAND_POINTS[r ?? 'miss'], 0);
    const points = Math.max(0, raw - this.extra * 15);
    const accuracy = max ? points / max : 0;
    const stars = accuracy >= 0.88 ? 3 : accuracy >= 0.68 ? 2 : accuracy >= 0.42 ? 1 : 0;
    return { points, accuracy, stars, counts };
  }
}

/** your best at each challenge (settings "scratch") */
export type ScratchBests = Record<string, { points: number; stars: number }>;

export function loadBests(): ScratchBests {
  const raw = loadSetting<unknown>('scratch', null);
  const out: ScratchBests = {};
  if (typeof raw === 'object' && raw !== null)
    for (const [k, v] of Object.entries(raw)) {
      const o = v as { points?: unknown; stars?: unknown };
      if (PATTERNS.some((p) => p.id === k) && typeof o?.points === 'number' && typeof o?.stars === 'number') out[k] = { points: Math.max(0, Math.round(o.points)), stars: Math.max(0, Math.min(3, Math.round(o.stars))) };
    }
  return out;
}

/** keep a run if it's your best; true when it is */
export function keepBest(id: string, points: number, stars: number): boolean {
  const b = loadBests();
  if ((b[id]?.points ?? -1) >= points) return false;
  b[id] = { points, stars };
  saveSetting('scratch', b);
  return true;
}
