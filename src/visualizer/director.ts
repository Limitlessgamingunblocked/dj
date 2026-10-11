/*
 * The visual player's auto VJ: keeps the big screens rotating through modes
 * that fit the music. It's always on.
 *   - changes only on a bar line, at the song's own pace: every 4, 8 or 16
 *     bars by its feel (songLook.ts: a chill track drifts, bass music cuts
 *     quick), 8 when there's no song look
 *   - a drop gets a peak mode on the hit, and the next 16 bars rotate twice as fast
 *   - a breakdown gets a calm mode at the next bar
 *   - otherwise mostly groove modes, leaning calm or peak with the energy
 *   - never one of the last few it played
 *   - with a song's look, only that song's modes, and on a new song a change
 *     to its opening mode at the next bar, faded over four beats
 *   - between tracks the screens keep drifting through calm and groove modes, slowly
 * Pure: the visual player feeds it the beat grid each frame and does the switching.
 */
import type { Energy, ModeInfo } from './kit';

export type TransitionKind = 'fade' | 'iris' | 'slices' | 'zoom' | 'pixels';
export const TRANSITIONS: TransitionKind[] = ['fade', 'iris', 'slices', 'zoom', 'pixels'];

export interface DirectorInput {
  beatCount: number;
  playing: boolean;
  /** 0..1, how deep into a breakdown */
  breakdown: number;
  /** 0..1, the drop's afterglow */
  drop: number;
  dropHit: boolean;
  /** 0..1, how busy the music is */
  energy: number;
}

export interface Cut {
  id: string;
  kind: TransitionKind;
  /** how long the transition runs, in beats */
  beats: number;
}

/** bars per phrase: the regular change when there's no song to set the pace */
export const PHRASE = 8;
/** the fewest bars a mode plays before the music can turn it over */
export const MIN_BARS = 4;
/** bars after a drop that rotate at double pace */
export const PEAK_RUN = 16;
/** bars between changes while nothing is playing */
export const IDLE_BARS = 16;
const RECENT = 4;

export class Director {
  private lastBar = Number.NaN;
  private bars = 0;
  private recent: string[] = [];
  private pool: Set<string> | null = null;
  private pending: string | null = null;
  /** bars between changes for the playing song */
  private pace = PHRASE;
  /** bars left of the quick rotation after a drop */
  private peakBars = 0;

  constructor(
    private modes: ModeInfo[],
    private rnd: () => number = Math.random,
  ) {}

  /** what the music wants now */
  want(i: DirectorInput): Energy {
    if (i.breakdown > 0.5) return 'calm';
    if (i.drop > 0.3) return 'peak';
    const r = this.rnd();
    if (i.energy > 0.7 && r < 0.4) return 'peak';
    if (i.energy < 0.35 && r < 0.5) return 'calm';
    return 'mid';
  }

  private energyOf(id: string): Energy {
    return this.modes.find((m) => m.id === id)?.energy ?? 'mid';
  }

  /** a new song: the modes to play for it (null: all), the one to open on at the next bar, and its pace in bars */
  song(pool: string[] | null, first: string | null, pace = PHRASE): void {
    this.pool = pool?.length ? new Set(pool) : null;
    this.pending = first;
    this.pace = Math.max(MIN_BARS, Math.min(16, Math.round(pace)));
  }

  /** a mode of this energy that hasn't played lately (from the song's modes, if it has some of that energy) */
  pick(energy: Energy, current: string): string {
    const fresh = (m: ModeInfo) => m.id !== current && !this.recent.includes(m.id);
    const song = this.pool ? this.modes.filter((m) => this.pool!.has(m.id)) : this.modes;
    let pool = song.filter((m) => m.energy === energy && fresh(m));
    if (!pool.length) pool = song.filter((m) => m.energy === energy && m.id !== current);
    if (!pool.length) pool = this.modes.filter((m) => m.energy === energy && fresh(m));
    if (!pool.length) pool = this.modes.filter((m) => m.energy === energy && m.id !== current);
    if (!pool.length) pool = this.modes.filter((m) => m.id !== current);
    if (!pool.length) return current;
    return pool[Math.floor(this.rnd() * pool.length) % pool.length].id;
  }

  /** remember a mode that started playing (also call it for the user's own picks) */
  played(id: string): void {
    this.recent = [id, ...this.recent.filter((r) => r !== id)].slice(0, RECENT);
    this.bars = 0;
  }

  /** every frame: a cut to make now, or null to stay */
  tick(current: string, i: DirectorInput): Cut | null {
    if (!this.recent.length) this.recent = [current];
    // the drop: straight to a peak mode on the hit, and a quicker rotation through the peak
    if (i.dropHit && i.playing) {
      this.peakBars = PEAK_RUN;
      if (this.energyOf(current) === 'peak' && this.bars < MIN_BARS) return null;
      // the bar the drop lands in doesn't count towards the next change
      this.lastBar = Math.floor(i.beatCount / 4);
      return this.cut(this.pick('peak', current), 'zoom', 0.5);
    }
    const bar = Math.floor(i.beatCount / 4);
    if (bar === this.lastBar) return null;
    const first = Number.isNaN(this.lastBar);
    this.lastBar = bar;
    if (first) return null;
    this.bars++;
    // between tracks: drift on through calm and groove modes, slowly
    if (!i.playing) {
      this.peakBars = 0;
      if (this.bars < IDLE_BARS) return null;
      return this.cut(this.pick(this.rnd() < 0.5 ? 'calm' : 'mid', current), 'fade', 4);
    }
    const quick = this.peakBars > 0;
    if (quick) this.peakBars--;
    // a new song: over to its opening mode on this bar line
    if (this.pending) {
      const id = this.pending;
      this.pending = null;
      if (id !== current) return this.cut(id, 'fade', 4);
    }
    const now = this.energyOf(current);
    // the music turned: a breakdown under a loud mode
    if (i.breakdown > 0.5 && now !== 'calm' && this.bars >= MIN_BARS) return this.cut(this.pick('calm', current), 'fade', 2);
    if (this.bars < (quick ? Math.max(MIN_BARS, this.pace / 2) : this.pace)) return null;
    const want = this.want(i);
    const kind = want === 'calm' ? 'fade' : TRANSITIONS[1 + Math.floor(this.rnd() * (TRANSITIONS.length - 1)) % (TRANSITIONS.length - 1)];
    return this.cut(this.pick(want, current), kind, want === 'calm' ? 2 : 1);
  }

  private cut(id: string, kind: TransitionKind, beats: number): Cut {
    this.played(id);
    return { id, kind, beats };
  }
}
