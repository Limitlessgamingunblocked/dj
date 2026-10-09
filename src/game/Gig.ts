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
import { PROGRESS, type Progress } from '../core/models';
import { applySet, MILESTONES, summarize, type BookingTerms, type Rewards, type SetOutcome, type SetSummary } from './progression';
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

// rewards and tiers live with the rest of the career (Section 9)
export { rewardsFor, tierFor, TIER_FAME, type Rewards } from './progression';

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
  /** the set summed up (for reputation, bookings' objectives, the feed) */
  summary: SetSummary;
  /** everything the set changes in the career, to save */
  outcome: SetOutcome;
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

  /** the set summed up, for the career */
  summary(board = ''): SetSummary {
    const m = this.meter;
    const minutes = Math.max(1, this.t / 60);
    return summarize({
      venue: this.config.venue,
      slot: this.config.slot,
      minutes: Math.min(minutes, this.config.minutes + 4),
      grade: m.grade(minutes),
      average: m.average,
      encore: this.encore,
      full: this.t >= this.length * 0.95,
      fullMinute: this.bestFull >= 60,
      peakVibe: m.peak.vibe,
      board,
      log: m.log,
      timeline: m.timeline,
    });
  }

  /** the results screen's numbers, and what the set does to the career */
  results(p: Partial<Progress>, o: { board?: string; booking?: BookingTerms } = {}): GigResults {
    const m = this.meter;
    const summary = this.summary(o.board);
    const outcome = applySet({ ...PROGRESS.defaults(), ...p }, summary, o.booking);
    return {
      config: this.config,
      grade: summary.grade,
      average: m.average,
      points: m.points,
      score: Math.round(m.points * this.multiplier),
      timeline: m.timeline,
      best: m.best,
      peak: m.peak,
      transitions: summary.transitions,
      mistakes: summary.mistakes,
      encore: this.encore,
      rewards: outcome.rewards,
      milestones: outcome.milestones,
      tierUp: outcome.tierUp,
      summary,
      outcome,
    };
  }
}

export const MILESTONE_LABEL: Record<string, string> = Object.fromEntries(MILESTONES.map((m) => [m.id, m.label]));
