/*
 * The visual player's auto VJ: picks the next mode to fit the music.
 *   - changes only on a bar line, and only every 8 bars (a phrase) unless the music turns
 *   - a breakdown gets a calm mode at the next bar
 *   - a drop gets a peak mode on the hit
 *   - otherwise mostly groove modes, leaning calm or peak with the energy
 *   - never one of the last few it played
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

/** bars per phrase: the regular change */
export const PHRASE = 8;
/** the fewest bars a mode plays before the music can turn it over */
export const MIN_BARS = 4;
const RECENT = 4;

export class Director {
  private lastBar = Number.NaN;
  private bars = 0;
  private recent: string[] = [];

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

  /** a mode of this energy that hasn't played lately */
  pick(energy: Energy, current: string): string {
    const fresh = (m: ModeInfo) => m.id !== current && !this.recent.includes(m.id);
    let pool = this.modes.filter((m) => m.energy === energy && fresh(m));
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
    // the drop: straight to a peak mode on the hit
    if (i.dropHit && i.playing) {
      if (this.energyOf(current) === 'peak' && this.bars < MIN_BARS) return null;
      return this.cut(this.pick('peak', current), 'zoom', 0.5);
    }
    const bar = Math.floor(i.beatCount / 4);
    if (bar === this.lastBar) return null;
    const first = Number.isNaN(this.lastBar);
    this.lastBar = bar;
    if (first || !i.playing) return null;
    this.bars++;
    const now = this.energyOf(current);
    // the music turned: a breakdown under a loud mode
    if (i.breakdown > 0.5 && now !== 'calm' && this.bars >= MIN_BARS) return this.cut(this.pick('calm', current), 'fade', 2);
    if (this.bars < PHRASE) return null;
    const want = this.want(i);
    const kind = want === 'calm' ? 'fade' : TRANSITIONS[1 + Math.floor(this.rnd() * (TRANSITIONS.length - 1)) % (TRANSITIONS.length - 1)];
    return this.cut(this.pick(want, current), kind, want === 'calm' ? 2 : 1);
  }

  private cut(id: string, kind: TransitionKind, beats: number): Cut {
    this.played(id);
    return { id, kind, beats };
  }
}
