/*
 * The auto director: cuts between camera angles with the music, the way the
 * people who cut festival livestreams, Boiler Room and Cercle do
 * (docs/director-research.md):
 *   - every shot has a size (wide, medium, close) and the next one is a
 *     different size, so the picture goes wide → close → medium instead of
 *     wide → wide;
 *   - the groove cuts on the 8-bar lines, a breakdown holds long, soft shots
 *     of the room;
 *   - a build cuts faster as it climbs (4 bars, then 2, then every bar) and the
 *     last bars before the drop are tight close-ups: the hands, the booth;
 *   - the drop cuts hard, on the hit, to the payoff (the whole room, the
 *     hero shot over the DJ's shoulder at the crowd, the drone) and holds it;
 *   - a blend between two tracks goes to the hands on the mixer, and a new
 *     track gets an establishing shot of the venue;
 *   - cuts are hard and on the downbeat; only the breakdown and the quiet
 *     between tracks dip through black.
 * Never the same shot twice in a row, and not one of the last few either.
 */
import type { ViewId } from './CameraRig';

export type Section = 'idle' | 'groove' | 'breakdown' | 'build' | 'peak';
/** what a cut is for: the part of the track, or a moment in it */
export type Moment = Section | 'drop' | 'tension' | 'mix' | 'track';
export type ShotSize = 'wide' | 'medium' | 'close';
/** a hard cut on the beat, or a quick dip through black */
export type CutStyle = 'cut' | 'dip';

export interface DirectorInput {
  /** show clock, seconds */
  t: number;
  playing: boolean;
  bar: number;
  /** 0..1 depth of a breakdown / build-up */
  build: number;
  /** 0..1 the peak after a drop */
  peak: number;
  /** the drop lands this frame */
  dropHit: boolean;
  /** two tracks are audible together (a blend in progress) */
  mixing?: boolean;
  /** the track out front (a change is a new track) */
  track?: string | null;
}

export interface Cut {
  view: ViewId;
  style: CutStyle;
  /** what the cut was for */
  moment: Moment;
}

/** how much of the frame the subject fills on each angle */
export const SHOT_SIZE: Record<ViewId, ShotSize> = {
  top: 'close',
  booth: 'close',
  hands: 'close',
  fisheye: 'close',
  perf: 'medium',
  hero: 'medium',
  crowd: 'medium',
  camcorder: 'medium',
  vertigo: 'medium',
  wide: 'wide',
  crane: 'wide',
  rig: 'wide',
  cctv: 'wide',
  drone: 'wide',
};

/** the angles for each moment, with how often each comes up (a weight) */
export const SHOTS: Record<Moment, Partial<Record<ViewId, number>>> = {
  idle: { perf: 2, wide: 2, hero: 1, cctv: 1, top: 1 },
  // the groove: the DJ, the crowd and the room in turn
  groove: { hero: 3, perf: 2, crowd: 2, camcorder: 2, wide: 2, crane: 2, hands: 1, booth: 1, rig: 1, fisheye: 1 },
  // the breakdown: long, soft shots that show off the venue
  breakdown: { wide: 3, crane: 3, hero: 2, rig: 2, cctv: 1, drone: 1 },
  // the build: moves that wind up
  build: { crane: 2, vertigo: 2, fisheye: 2, hands: 2, rig: 1, crowd: 1, booth: 1 },
  // the last bars before the drop: tight, one a bar
  tension: { hands: 3, booth: 2, fisheye: 2, top: 1, crowd: 1, vertigo: 1 },
  // the drop: the payoff, the whole room or the DJ facing it
  drop: { wide: 3, hero: 3, drone: 2, crowd: 2 },
  peak: { crowd: 3, hero: 2, drone: 2, camcorder: 2, wide: 2, crane: 1, fisheye: 1, hands: 1 },
  // a blend: the hands on the mixer
  mix: { hands: 3, top: 2, booth: 1 },
  // a new track: where we are
  track: { wide: 3, crane: 1, drone: 1, rig: 1 },
};

export function sectionOf(s: Pick<DirectorInput, 'playing' | 'build' | 'peak'>): Section {
  if (!s.playing) return 'idle';
  if (s.peak > 0.5) return 'peak';
  if (s.build > 0.6) return 'build';
  if (s.build > 0.25) return 'breakdown';
  return 'groove';
}

/** bars between cuts: the build speeds up as it climbs */
export function cutEvery(section: Section, build: number): number {
  if (section === 'build') return build >= 0.9 ? 1 : build >= 0.75 ? 2 : 4;
  return section === 'peak' ? 4 : 8;
}

/**
 * A shot for this moment that isn't the one on screen or one of the last few,
 * and (when the pool allows) a different size from the one on screen.
 */
export function nextShot(moment: Moment, current: ViewId | 'custom' | null, recent: ViewId[], rand: number): ViewId {
  const pool = Object.entries(SHOTS[moment]) as [ViewId, number][];
  const size = current && current !== 'custom' ? SHOT_SIZE[current] : null;
  const tries: ((v: ViewId) => boolean)[] = [
    (v) => v !== current && !recent.includes(v) && SHOT_SIZE[v] !== size,
    (v) => v !== current && !recent.includes(v),
    (v) => v !== current,
    () => true,
  ];
  for (const ok of tries) {
    const pick = pool.filter(([v]) => ok(v));
    if (!pick.length) continue;
    let r = rand * pick.reduce((n, [, w]) => n + w, 0);
    for (const [v, w] of pick) if ((r -= w) < 0) return v;
    return pick[pick.length - 1][0];
  }
  return pool[0][0];
}

export class Director {
  /** the last few shots, most recent last */
  readonly recent: ViewId[] = [];
  private cutAt = -1e9;
  private cutBar = Number.NaN;
  private lastT = Number.NaN;
  private lastBar = Number.NaN;
  private lastSection: Section | null = null;
  private lastWasDrop = false;
  /** the drop's shot holds until this bar */
  private holdUntil = -Infinity;
  private mixing = false;
  private track: string | null | undefined = undefined;
  /** a moment waiting for the next bar line */
  private pending: 'mix' | 'track' | null = null;
  private pendingBar = 0;

  constructor(private rand: () => number = Math.random) {}

  /** Start fresh (when it's switched on): the next update cuts straight away. */
  reset(): void {
    this.cutAt = -1e9;
    this.cutBar = Number.NaN;
    this.lastSection = null;
    this.holdUntil = -Infinity;
    this.pending = null;
  }

  /** Call every frame; returns the cut to make now, or null to stay. */
  update(s: DirectorInput, current: ViewId | 'custom'): Cut | null {
    // the show only moves when the club is drawn: one decision per show frame
    if (s.t === this.lastT) return null;
    this.lastT = s.t;
    const section = sectionOf(s);
    const since = s.t - this.cutAt;
    const changed = section !== this.lastSection;
    this.lastSection = section;
    const newBar = s.bar !== this.lastBar;
    this.lastBar = s.bar;
    // moments that wait for the next bar: a blend starting, a new track out front
    const mixing = !!s.mixing && s.playing;
    if (mixing && !this.mixing) this.wait('mix', s.bar);
    this.mixing = mixing;
    if (s.track !== undefined) {
      if (this.track !== undefined && s.track && s.track !== this.track) this.wait('track', s.bar);
      this.track = s.track;
    }
    if (since > 1e8) return this.cut(section, current, s, 'dip');
    // the drop always gets its shot, even right after a phrase cut
    if (s.dropHit && (since > 0.8 || !this.lastWasDrop)) {
      this.holdUntil = s.bar + 4;
      return this.cut('drop', current, s, 'cut');
    }
    if (section === 'idle') return since > 14 ? this.cut(section, current, s, 'dip') : null;
    if (s.bar < this.holdUntil) return null;
    const style: CutStyle = section === 'breakdown' ? 'dip' : 'cut';
    if (this.pending && newBar && s.bar > this.pendingBar && s.bar !== this.cutBar && since > 3) {
      const m = this.pending;
      this.pending = null;
      // the build's own cuts matter more than the hands or the room
      if (section !== 'build') return this.cut(m, current, s, m === 'track' ? 'dip' : 'cut');
    }
    // on the bar lines: every 8 bars in the groove, every 4 at the peak, faster through the build
    const every = cutEvery(section, s.build);
    const hold = every === 1 ? 1.2 : 3;
    if (s.bar !== this.cutBar && ((s.bar % every) + every) % every === 0 && since > hold) {
      if (section === 'build' && s.build >= 0.9) return this.cut('tension', current, s, 'cut');
      // through a blend, every other cut goes back to the hands
      if (this.mixing && current !== 'custom' && SHOT_SIZE[current] !== 'close') return this.cut('mix', current, s, 'cut');
      return this.cut(section, current, s, style);
    }
    // into a breakdown or a build mid-phrase: cut if the shot has been up a while
    if (changed && since > 6) return this.cut(section, current, s, style);
    return null;
  }

  /** a moment for the next bar line (a new track wins over a blend) */
  private wait(m: 'mix' | 'track', bar: number): void {
    if (this.pending === 'track' && m === 'mix') return;
    this.pending = m;
    this.pendingBar = bar;
  }

  private cut(moment: Moment, current: ViewId | 'custom', s: DirectorInput, style: CutStyle): Cut {
    const view = nextShot(moment, current, this.recent, this.rand());
    this.recent.push(view);
    if (this.recent.length > 3) this.recent.shift();
    this.cutAt = s.t;
    this.cutBar = s.bar;
    this.lastWasDrop = moment === 'drop';
    // a blend that got its shot on a phrase line doesn't need another on the next bar
    if (moment === this.pending) this.pending = null;
    return { view, style, moment };
  }
}
