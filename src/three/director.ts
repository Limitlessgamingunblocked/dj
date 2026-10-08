/*
 * The auto director: cuts between camera angles with the music, the way a
 * livestream director would. Calm, wide shots in a breakdown; quicker cuts
 * through a build (the crane, the dolly zoom); a cut on the drop to something
 * close and loud (the booth fisheye, the drone, the crowd); every 4 bars
 * through the peak, every 8 otherwise, always on a phrase line; never the same
 * shot twice in a row, and not one of the last few either.
 */
import type { ViewId } from './CameraRig';

export type Section = 'idle' | 'groove' | 'breakdown' | 'build' | 'peak';

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
}

export const SHOTS: Record<Section | 'drop', ViewId[]> = {
  idle: ['perf', 'wide', 'cctv', 'top'],
  groove: ['perf', 'crowd', 'camcorder', 'booth', 'wide', 'fisheye', 'rig'],
  breakdown: ['wide', 'rig', 'cctv', 'crane', 'top'],
  build: ['crane', 'vertigo', 'rig', 'fisheye'],
  drop: ['fisheye', 'drone', 'crowd', 'camcorder'],
  peak: ['drone', 'crowd', 'fisheye', 'camcorder', 'wide', 'crane'],
};

export function sectionOf(s: Pick<DirectorInput, 'playing' | 'build' | 'peak'>): Section {
  if (!s.playing) return 'idle';
  if (s.peak > 0.5) return 'peak';
  if (s.build > 0.6) return 'build';
  if (s.build > 0.25) return 'breakdown';
  return 'groove';
}

/** A shot for this part of the track that isn't the one on screen or one of the last few. */
export function nextShot(section: Section | 'drop', current: ViewId | 'custom' | null, recent: ViewId[], rand: number): ViewId {
  const pool = SHOTS[section];
  let pick = pool.filter((v) => v !== current && !recent.includes(v));
  if (!pick.length) pick = pool.filter((v) => v !== current);
  if (!pick.length) pick = pool;
  return pick[Math.min(pick.length - 1, Math.floor(rand * pick.length))];
}

export class Director {
  /** the last few shots, most recent last */
  readonly recent: ViewId[] = [];
  private cutAt = -1e9;
  private cutBar = Number.NaN;
  private lastT = Number.NaN;
  private lastSection: Section | null = null;
  private lastWasDrop = false;

  constructor(private rand: () => number = Math.random) {}

  /** Start fresh (when it's switched on): the next update cuts straight away. */
  reset(): void {
    this.cutAt = -1e9;
    this.cutBar = Number.NaN;
    this.lastSection = null;
  }

  /** Call every frame; returns the angle to cut to now, or null to stay. */
  update(s: DirectorInput, current: ViewId | 'custom'): ViewId | null {
    // the show only moves when the club is drawn: one decision per show frame
    if (s.t === this.lastT) return null;
    this.lastT = s.t;
    const section = sectionOf(s);
    const since = s.t - this.cutAt;
    const changed = section !== this.lastSection;
    this.lastSection = section;
    if (since > 1e8) return this.cut(section, current, s);
    // the drop always gets its shot, even right after a phrase cut (the fade is still running then)
    if (s.dropHit && (since > 0.8 || !this.lastWasDrop)) return this.cut('drop', current, s);
    if (section === 'idle') return since > 14 ? this.cut(section, current, s) : null;
    // on the phrase lines: every 4 bars through a build and the peak, every 8 otherwise
    const every = section === 'build' || section === 'peak' ? 4 : 8;
    if (s.bar !== this.cutBar && ((s.bar % every) + every) % every === 0 && since > 3) return this.cut(section, current, s);
    // into a breakdown or a build mid-phrase: cut if the shot has been up a while
    if (changed && since > 6) return this.cut(section, current, s);
    return null;
  }

  private cut(section: Section | 'drop', current: ViewId | 'custom', s: DirectorInput): ViewId {
    const v = nextShot(section, current, this.recent, this.rand());
    this.recent.push(v);
    if (this.recent.length > 3) this.recent.shift();
    this.cutAt = s.t;
    this.cutBar = s.bar;
    this.lastWasDrop = section === 'drop';
    return v;
  }
}
