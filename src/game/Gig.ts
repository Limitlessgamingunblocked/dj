/*
 * A gig (Sections 5.3 and 6.9): a venue, a slot, a set length and an assist
 * level. The set clock runs once the first track is playing; the vibe meter
 * scores it against the slot's curve. When time's up, a room that's still
 * high chants for one more tune: the encore, played for a bonus. Then the
 * results: a grade, the vibe graph against what the slot wanted, the best
 * transition, the crowd's peak and what you earned.
 *
 * Pure logic (no DOM, no audio): the app feeds it a snapshot every frame
 * and draws what it says.
 */
import type { Progress } from '../core/models';
import { SLOTS, VibeMeter, type DeckSnap, type Grade, type SlotId, type VibeEvent } from './vibe';

export type Assist = 'chill' | 'club' | 'pro';

export const ASSISTS: { id: Assist; label: string; blurb: string; mult: number }[] = [
  { id: 'chill', label: 'Chill', blurb: 'Auto-sync, key matching and tips. Just have fun.', mult: 1 },
  { id: 'club', label: 'Club', blurb: 'Sync button and key hints.', mult: 1 },
  { id: 'pro', label: 'Pro', blurb: 'No sync, no hints. Beatmatch by ear. Scores ×1.5.', mult: 1.5 },
];

export const SET_LENGTHS = [10, 20, 30, 60] as const;

export interface GigConfig {
  venue: string;
  slot: SlotId;
  /** set length in minutes */
  minutes: number;
  assist: Assist;
}

/** what a venue pays and how much it counts (Section 9.1); the brief's venues, plus the real rooms in free play */
const VENUE_PAY: Record<string, { fame: number; cash: number; followers: number; label: string }> = {
  bedroom: { fame: 0.5, cash: 0.2, followers: 1.4, label: 'Bedroom stream' },
  basement: { fame: 1, cash: 1, followers: 1, label: 'Basement Club' },
};
const DEFAULT_PAY = { fame: 1.5, cash: 1.5, followers: 1.5, label: '' };

const GRADE_FAME: Record<Grade, number> = { S: 70, A: 48, B: 30, C: 15, D: 5 };

/** fame needed for each tier (index = tier - 1); TODO: Stage 6's ProgressionSystem owns these */
export const TIER_FAME = [0, 150, 500, 1200, 2500, 5000, 9000];

export function tierFor(fame: number): number {
  let t = 1;
  for (let i = 1; i < TIER_FAME.length; i++) if (fame >= TIER_FAME[i]) t = i + 1;
  return t;
}

export interface Rewards {
  fame: number;
  cash: number;
  followers: number;
}

export function rewardsFor(grade: Grade, venue: string, minutes: number, encore: boolean): Rewards {
  const p = VENUE_PAY[venue] ?? DEFAULT_PAY;
  const len = Math.pow(Math.max(1, minutes) / 10, 0.6);
  const bonus = encore ? 1.25 : 1;
  const g = GRADE_FAME[grade];
  return {
    fame: Math.round(g * p.fame * len * bonus),
    cash: Math.round((20 + g * 1.5) * p.cash * len * bonus),
    followers: Math.round(g * 2.4 * p.followers * len * bonus),
  };
}

export interface GigResults {
  config: GigConfig;
  grade: Grade;
  average: number;
  points: number;
  /** points × the assist multiplier (time-weighted if it changed mid-set) */
  score: number;
  timeline: VibeMeter['timeline'];
  best: VibeMeter['best'];
  peak: VibeMeter['peak'];
  transitions: number;
  mistakes: number;
  encore: boolean;
  rewards: Rewards;
  /** milestones reached in this set */
  milestones: string[];
  /** a new fame tier */
  tierUp: number | null;
}

export type GigEvent = VibeEvent | { kind: 'gig'; what: 'start' | 'halfway' | 'last_minute' | 'time' | 'encore' | 'over'; t: number };

export class Gig {
  readonly meter: VibeMeter;
  /** set seconds (the clock starts with the first track) */
  t = 0;
  phase: 'waiting' | 'live' | 'encore' | 'over' = 'waiting';
  assist: Assist;
  encore = false;
  private assistTime: Record<Assist, number> = { chill: 0, club: 0, pro: 0 };
  private encoreT = 0;
  private encoreTrack: string | null = null;
  private encoreHeard = 0;
  private said = new Set<string>();
  private fullMinute = 0;
  private bestFull = 0;

  constructor(readonly config: GigConfig) {
    this.meter = new VibeMeter(SLOTS[config.slot]);
    this.assist = config.assist;
  }

  get length(): number {
    return this.config.minutes * 60;
  }

  get remaining(): number {
    return Math.max(0, this.length - this.t);
  }

  get progress(): number {
    return Math.min(1, this.t / this.length);
  }

  private once(out: GigEvent[], what: Extract<GigEvent, { kind: 'gig' }>['what']): void {
    if (this.said.has(what)) return;
    this.said.add(what);
    out.push({ kind: 'gig', what, t: this.t });
  }

  /** a frame of the set */
  update(dt: number, decks: DeckSnap[], level: number, redline: number, dropHit: boolean): GigEvent[] {
    const out: GigEvent[] = [];
    if (this.phase === 'over') return out;
    const live = decks.some((d) => d.playing && d.audible > 0.12 && d.trackId);
    if (this.phase === 'waiting') {
      if (!live) return out;
      this.phase = 'live';
      this.once(out, 'start');
    }
    this.t += dt;
    this.assistTime[this.assist] += dt;
    out.push(...this.meter.update({ t: this.t, dt, decks, level, redline, progress: this.progress, dropHit }));
    // a full minute at 100 %
    this.fullMinute = this.meter.vibe > 0.97 ? this.fullMinute + dt : 0;
    this.bestFull = Math.max(this.bestFull, this.fullMinute);

    if (this.phase === 'live') {
      if (this.progress >= 0.5) this.once(out, 'halfway');
      if (this.remaining <= 60 && this.length > 120) this.once(out, 'last_minute');
      if (this.remaining <= 0) {
        // time: a room that's still high wants one more tune
        if (this.meter.vibe >= 0.75) {
          this.phase = 'encore';
          this.encore = true;
          this.encoreT = 0;
          this.encoreTrack = decks.filter((d) => d.playing && d.audible > 0.12).map((d) => d.trackId).find(Boolean) ?? null;
          this.once(out, 'encore');
        } else {
          this.phase = 'over';
          this.once(out, 'time');
          this.once(out, 'over');
        }
      }
    } else if (this.phase === 'encore') {
      this.encoreT += dt;
      // the encore is a new track: once it's been the one they hear for a minute (or four minutes pass), that's the night
      const loudest = [...decks].filter((d) => d.playing && d.audible > 0.12).sort((a, b) => b.audible - a.audible)[0];
      if (loudest && loudest.trackId && loudest.trackId !== this.encoreTrack) this.encoreHeard += dt;
      if (this.encoreHeard > 60 || this.encoreT > 240) this.finish(out);
    }
    return out;
  }

  /** end the set now (the End set button, or after the encore) */
  finish(out: GigEvent[] = []): GigEvent[] {
    if (this.phase === 'over') return out;
    if (this.phase === 'encore' && this.encoreHeard > 20) {
      this.meter.points += 300;
    }
    this.phase = 'over';
    this.once(out, 'over');
    return out;
  }

  /** the assist multiplier, weighted by how long each level was on */
  get multiplier(): number {
    const total = this.assistTime.chill + this.assistTime.club + this.assistTime.pro;
    if (total <= 0) return ASSISTS.find((a) => a.id === this.assist)!.mult;
    return ASSISTS.reduce((m, a) => m + (a.mult * this.assistTime[a.id]) / total, 0);
  }

  results(p: Pick<Progress, 'milestones' | 'fame' | 'tier'>): GigResults {
    const m = this.meter;
    const minutes = Math.max(1, this.t / 60);
    const grade = m.grade(minutes);
    const rewards = rewardsFor(grade, this.config.venue, Math.min(minutes, this.config.minutes + 4), this.encore);
    const transitions = m.log.filter((e) => e.kind === 'transition').length;
    const mistakes = m.log.filter((e) => e.kind === 'mistake').length;
    // milestones (Section 9.5) this set can reach
    const got = new Set(p.milestones);
    const ms: string[] = [];
    const reach = (id: string, ok: boolean) => ok && !got.has(id) && ms.push(id);
    reach('first_set', this.t >= this.length * 0.95);
    reach('first_perfect', m.log.some((e) => e.kind === 'transition' && e.band === 'perfect' && e.name !== 'quick_cut'));
    reach('vibe_full_minute', this.bestFull >= 60);
    reach('first_encore', this.encore);
    reach('first_s', grade === 'S');
    const fame = p.fame + rewards.fame;
    const newTier = tierFor(fame);
    return {
      config: this.config,
      grade,
      average: m.average,
      points: m.points,
      score: Math.round(m.points * this.multiplier),
      timeline: m.timeline,
      best: m.best,
      peak: m.peak,
      transitions,
      mistakes,
      encore: this.encore,
      rewards,
      milestones: ms,
      tierUp: newTier > p.tier ? newTier : null,
    };
  }
}

export const MILESTONE_LABEL: Record<string, string> = {
  first_set: 'First full set',
  first_perfect: 'First perfect transition',
  vibe_full_minute: '100% vibe for a full minute',
  first_encore: 'First encore',
  first_s: 'First S grade',
};
