/*
 * The auto director: cuts the camera with the music the way the crews who
 * stream big DJ sets do. The grammar (see DECISIONS 236):
 *
 *  - Cut on the downbeat of a phrase, never mid-bar: shots last 4, 8 or 16
 *    bars, by how the set is going and the style.
 *  - Open on the place (a landmark, the aerial, the venue), then go to the DJ.
 *  - Mix near and far: the next shot is usually a different size from this one.
 *  - Two decks playing at once is the mix: go to the hands on the decks.
 *  - A build gets a slow push in on the DJ, then the cuts speed up as it
 *    climbs (every 4 bars, then 2, then every bar on close-ups at the top,
 *    at a festival; the calmer styles just tighten).
 *  - A new track out front: back to the place for a bar line.
 *  - The drop gets its shot on the beat (a pull back to the whole room, the
 *    crowd's reaction), then, at a festival, a few quick one-bar cuts.
 *  - Breakdowns are for the place: landmarks, the aerial, the wide.
 *  - The peak cuts every four bars, now and then every two.
 *
 * Three styles: Festival (a mainstage stream: many cameras, phrase cuts, a
 * drop montage), Stream (a club stream: few cuts, hand-held close-ups, the
 * fixed stream camera) and Cinematic (a location set: long slow moves,
 * aerials and landmarks, letterboxed). Auto picks the venue's own.
 *
 * Pure logic: App feeds it the clock and the show, it answers with a take.
 */
import type { ViewId } from './CameraRig';
import type { ShotId } from './shots';

export type Section = 'idle' | 'groove' | 'breakdown' | 'build' | 'peak';
export type DirectorStyle = 'festival' | 'stream' | 'cinematic';
export type DirectorPick = DirectorStyle | 'auto';
/** what a take can be: a camera-menu angle, a director move, or one of the venue's landmarks */
export type CamId = ViewId | ShotId | 'landmark';

export interface DirectorInput {
  t: number;
  playing: boolean;
  bar: number;
  build: number;
  peak: number;
  dropHit: boolean;
  /** two decks are audible at once: a mix is happening */
  mixing?: boolean;
  /** the track out front (a change is a new track) */
  track?: string | null;
}

/** what this venue offers the director */
export interface DirectorMenu {
  style: DirectorStyle;
  /** open sky: aerials allowed */
  open: boolean;
  /** how many landmark shots the venue has */
  landmarks: number;
  /** less motion asked for: no quick drop montage */
  calm?: boolean;
  /** takes that don't work in this venue */
  skip?: CamId[];
}

export interface Take {
  id: CamId;
  /** which landmark (id 'landmark') */
  landmark: number;
  /** which way round a move goes (1 or −1) */
  side: number;
  /** how long it's planned to run, seconds (the moves are paced to it) */
  seconds: number;
  /** a hard cut on the beat, or a dip through black (the cinematic style between calm shots) */
  cut: 'hard' | 'dip';
}

export type Moment = Section | 'drop' | 'burst' | 'mix' | 'open' | 'tension';

/** how big the subject is in each take: the director mixes near and far */
export const SIZE: Record<CamId, 'close' | 'mid' | 'far'> = {
  top: 'close',
  perf: 'close',
  booth: 'close',
  hands: 'close',
  fisheye: 'close',
  profile: 'mid',
  hero: 'mid',
  ots: 'mid',
  tele: 'mid',
  pushin: 'mid',
  camcorder: 'mid',
  vertigo: 'mid',
  crowd: 'mid',
  reverse: 'far',
  orbit: 'mid',
  pullback: 'far',
  jib: 'far',
  crane: 'far',
  rig: 'far',
  cctv: 'far',
  wide: 'far',
  drone: 'far',
  aerial: 'far',
  landmark: 'far',
};

/** the shot pools: what each style shoots at each moment (repeats weight a shot up) */
export const POOLS: Record<DirectorStyle, Record<Moment, CamId[]>> = {
  festival: {
    open: ['landmark', 'aerial', 'wide', 'landmark'],
    idle: ['wide', 'landmark', 'perf', 'aerial', 'cctv', 'orbit'],
    groove: ['hero', 'tele', 'ots', 'profile', 'crowd', 'jib', 'wide', 'camcorder', 'perf', 'hands', 'landmark', 'crane'],
    breakdown: ['landmark', 'landmark', 'aerial', 'jib', 'wide', 'rig', 'profile', 'orbit', 'tele'],
    build: ['pushin', 'hero', 'hands', 'vertigo', 'crane', 'tele'],
    drop: ['pullback', 'reverse', 'pullback', 'wide', 'drone', 'aerial'],
    burst: ['reverse', 'hero', 'wide', 'crowd', 'ots', 'jib', 'tele', 'fisheye'],
    peak: ['reverse', 'ots', 'crowd', 'jib', 'hero', 'tele', 'drone', 'crane', 'fisheye', 'wide', 'camcorder', 'landmark'],
    mix: ['hands', 'top', 'hands', 'profile', 'booth'],
    tension: ['hands', 'fisheye', 'booth', 'hands', 'crowd', 'top', 'vertigo'],
  },
  stream: {
    open: ['wide', 'landmark'],
    idle: ['wide', 'perf', 'cctv', 'landmark'],
    groove: ['wide', 'wide', 'hands', 'profile', 'crowd', 'camcorder', 'ots', 'hero'],
    breakdown: ['wide', 'profile', 'hands', 'landmark', 'cctv', 'booth'],
    build: ['hands', 'hero', 'pushin', 'fisheye'],
    drop: ['fisheye', 'crowd', 'reverse', 'wide'],
    burst: ['crowd', 'fisheye', 'reverse'],
    peak: ['wide', 'crowd', 'camcorder', 'fisheye', 'hands', 'ots', 'profile'],
    mix: ['hands', 'hands', 'top', 'profile'],
    tension: ['hands', 'fisheye', 'hero'],
  },
  cinematic: {
    open: ['aerial', 'landmark', 'landmark', 'wide'],
    idle: ['landmark', 'aerial', 'orbit', 'wide'],
    groove: ['orbit', 'tele', 'profile', 'landmark', 'wide', 'ots', 'aerial', 'hero'],
    breakdown: ['aerial', 'landmark', 'landmark', 'orbit', 'wide', 'tele'],
    build: ['pushin', 'pushin', 'orbit', 'hero'],
    drop: ['pullback', 'aerial', 'pullback', 'reverse'],
    burst: ['reverse', 'ots'],
    peak: ['orbit', 'ots', 'aerial', 'reverse', 'landmark', 'tele', 'hero', 'wide'],
    mix: ['hands', 'profile', 'hands'],
    tension: ['pushin', 'hands', 'ots'],
  },
};

/** bars a shot lasts, by style and moment */
export const BARS: Record<DirectorStyle, Record<Moment, number>> = {
  festival: { open: 8, idle: 8, groove: 8, breakdown: 8, build: 4, drop: 4, burst: 1, peak: 4, mix: 8, tension: 1 },
  stream: { open: 8, idle: 16, groove: 16, breakdown: 16, build: 8, drop: 8, burst: 2, peak: 8, mix: 8, tension: 4 },
  cinematic: { open: 16, idle: 16, groove: 16, breakdown: 16, build: 8, drop: 8, burst: 4, peak: 8, mix: 8, tension: 8 },
};

/** how deep the build is when the cuts speed up (festival: 4 bars → 2), and when the top's close-ups start */
export const BUILD_FAST = 0.75;
export const BUILD_TOP = 0.9;

/** the quick cuts after a drop: how many (festival), each a bar */
export const BURST = { festival: 3, stream: 0, cinematic: 0 } as const;

/** when nothing plays: a new shot this often, seconds */
export const IDLE_SECONDS = 14;
/** a shot is held at least this long, seconds (the drop and its montage aside) */
export const MIN_HOLD = 3;

export function sectionOf(s: Pick<DirectorInput, 'playing' | 'build' | 'peak'>): Section {
  if (!s.playing) return 'idle';
  if (s.peak > 0.5) return 'peak';
  if (s.build > 0.6) return 'build';
  if (s.build > 0.25) return 'breakdown';
  return 'groove';
}

/** Can this take be used here? (no aerials under a roof, no landmarks where there are none) */
export function available(id: CamId, menu: DirectorMenu): boolean {
  if (menu.skip?.includes(id)) return false;
  if (id === 'aerial') return menu.open;
  if (id === 'landmark') return menu.landmarks > 0;
  return true;
}

/**
 * The next take from a pool: never the shot on screen or the last few, a
 * different size from the one on screen when the pool allows (near after
 * far), and landmarks only so often. `r` is 0..1.
 */
export function nextShot(pool: CamId[], current: CamId | 'custom', recent: CamId[], r: number, menu: DirectorMenu): CamId {
  const ok = pool.filter((v) => available(v, menu));
  const base = ok.length ? ok : ['wide' as CamId];
  // a landmark can come back while there are others to show; any other shot waits out the history
  const fresh = base.filter((v) => v !== current && (v === 'landmark' ? menu.landmarks > 1 || !recent.includes(v) : !recent.includes(v)));
  let list = fresh.length ? fresh : base.filter((v) => v !== current);
  if (!list.length) list = base;
  const size = current === 'custom' ? null : SIZE[current];
  const varied = size ? list.filter((v) => SIZE[v] !== size) : list;
  // mostly a change of size; sometimes (a third of the time) any of the fresh ones
  const pick = varied.length && r < 0.67 ? varied : list;
  const k = r < 0.67 ? r / 0.67 : (r - 0.67) / 0.33;
  return pick[Math.min(pick.length - 1, Math.floor(k * pick.length))];
}

export class Director {
  readonly recent: CamId[] = [];
  /** what's on screen (the director's own idea of it; anything else is 'custom') */
  current: CamId | 'custom' = 'custom';
  private cutAt = -1e9;
  private cutBar = -1e9;
  private len = 8;
  private lastT = -1;
  private lastBar = -1;
  private barSec = 2;
  private barSeenAt = -1;
  private lastSection: Section = 'idle';
  private moment: Moment = 'open';
  private burstLeft = 0;
  private opened = false;
  private mixingSince = -1;
  private quietSince = -1e9;
  private landmarkN = 0;
  private side = 1;
  private pending = false;
  private track: string | null | undefined = undefined;
  /** a new track came in: back to the place on the next bar line */
  private newTrack = false;

  constructor(private rand: () => number = Math.random) {}

  reset(): void {
    this.cutAt = -1e9;
    this.cutBar = -1e9;
    this.recent.length = 0;
    this.current = 'custom';
    this.burstLeft = 0;
    this.opened = false;
    this.pending = false;
    this.mixingSince = -1;
  }

  /** the bar length the director has measured, seconds */
  get barSeconds(): number {
    return this.barSec;
  }

  /** what the director is shooting right now (for tests and the HUD) */
  get state(): Moment {
    return this.moment;
  }

  /** this frame's call: a new take, or null to stay on the shot */
  update(s: DirectorInput, menu: DirectorMenu, onScreen: CamId | 'custom' = this.current): Take | null {
    if (s.t === this.lastT) return null;
    this.lastT = s.t;
    // someone else moved the camera (a recording's locked angle, the photo mode): start again from what's there
    if (onScreen !== this.current) this.current = onScreen;
    const style = menu.style;
    const section = sectionOf(s);
    const newBar = s.bar !== this.lastBar;
    const prevBar = this.lastBar;
    if (newBar && s.playing) {
      if (this.barSeenAt >= 0 && s.bar === this.lastBar + 1) {
        const d = s.t - this.barSeenAt;
        if (d > 0.8 && d < 6) this.barSec += (d - this.barSec) * 0.3;
      }
      this.barSeenAt = s.t;
    }
    this.lastBar = s.bar;
    const since = s.t - this.cutAt;
    const bars = s.bar - this.cutBar;

    // the mix: both decks up for a moment (not a blip on the crossfader)
    if (s.mixing && s.playing) {
      if (this.mixingSince < 0) this.mixingSince = s.t;
    } else if (this.mixingSince >= 0) {
      this.mixingSince = -1;
      this.quietSince = s.t;
    }
    const mixing = this.mixingSince >= 0 && s.t - this.mixingSince > this.barSec * 0.9;
    if (s.track !== undefined) {
      if (this.track !== undefined && s.track && s.track !== this.track) this.newTrack = true;
      this.track = s.track;
    }

    // the drop: its shot right away, on the beat, even just after a phrase cut
    if (s.dropHit && s.playing && (since > 0.8 || this.moment !== 'drop')) {
      this.burstLeft = menu.calm ? 0 : BURST[style];
      this.lastSection = section;
      return this.cut('drop', s, menu, 'hard');
    }

    // switched on: open on the place
    if (!this.opened) {
      this.opened = true;
      this.lastSection = section;
      return this.cut(s.playing ? 'open' : 'idle', s, menu, 'hard');
    }

    if (!s.playing) {
      this.lastSection = 'idle';
      this.burstLeft = 0;
      return since > IDLE_SECONDS ? this.cut('idle', s, menu, 'dip') : null;
    }

    // the montage after a drop: a cut on each of the next few bars
    if (this.burstLeft > 0) {
      if (newBar && bars >= BARS[style].burst && since > 1.2) {
        this.burstLeft--;
        return this.cut('burst', s, menu, 'hard');
      }
      return null;
    }

    // the music changed gear (into a build, a breakdown): cut on the next bar line
    if (section !== this.lastSection) {
      const from = this.lastSection;
      this.lastSection = section;
      // into the peak by way of a drop is the drop's own business
      if (!(section === 'peak' && from === 'build')) this.pending = true;
    }
    // a mix starting: to the hands on the next bar (after a quiet spell, not at every wobble)
    const mixStart = mixing && this.moment !== 'mix' && s.t - this.quietSince > this.barSec * 2 && section !== 'peak';
    if (!newBar) return null;
    const top = section === 'build' && s.build >= BUILD_TOP;
    const want: Moment = top ? 'tension' : mixing && section !== 'peak' ? 'mix' : section;
    // a new track out front (once its blend is done): show where we are, unless the music is building or peaking
    if (this.newTrack && !mixing && since > MIN_HOLD && bars >= 1) {
      this.newTrack = false;
      if (section === 'groove' || section === 'breakdown') return this.cut('open', s, menu, style === 'cinematic' ? 'dip' : 'hard');
    }
    if ((this.pending || mixStart) && since > MIN_HOLD && bars >= 1) {
      this.pending = false;
      return this.cut(want, s, menu, want === 'mix' || style !== 'cinematic' ? 'hard' : 'dip');
    }
    // a phrase line: the shot's run is up and a line of the phrase grid has just gone by
    // (crossed, not landed on: a slow frame can skip the bar itself)
    const grid = Math.min(this.len, 4);
    const crossed = Math.floor(s.bar / grid) !== Math.floor(prevBar / grid);
    if (bars >= this.len && crossed && since > (this.len <= 1 ? 1.2 : MIN_HOLD)) {
      return this.cut(want, s, menu, style === 'cinematic' && want !== 'peak' ? 'dip' : 'hard');
    }
    return null;
  }

  private cut(moment: Moment, s: DirectorInput, menu: DirectorMenu, cut: Take['cut']): Take {
    const style = menu.style;
    this.moment = moment;
    let id = nextShot(POOLS[style][moment], this.current, this.recent, this.rand(), menu);
    // a build opens on the push in, if the style has one
    if (moment === 'build' && available('pushin', menu) && this.current !== 'pushin') id = 'pushin';
    // the mix opens on the hands
    if (moment === 'mix' && available('hands', menu) && this.current !== 'hands') id = 'hands';
    let len = BARS[style][moment];
    // the peak: now and then a quick two-bar shot so the cutting doesn't go square
    if (moment === 'peak' && style === 'festival' && this.rand() < 0.3) len = 2;
    // the build speeds up as it climbs
    if (moment === 'build' && s.build >= BUILD_FAST) len = Math.max(1, len / 2);
    // the drop's shot hands over to the montage after a bar; the montage's last shot runs like a peak shot
    if (moment === 'burst' && this.burstLeft === 0) len = BARS[style].peak;
    this.len = moment === 'drop' && this.burstLeft > 0 ? 1 : len;
    this.side = this.rand() < 0.5 ? -this.side : this.side;
    let landmark = 0;
    if (id === 'landmark') {
      landmark = this.landmarkN % Math.max(1, menu.landmarks);
      this.landmarkN++;
    }
    this.current = id;
    this.recent.push(id);
    if (this.recent.length > 4) this.recent.shift();
    this.cutAt = s.t;
    this.cutBar = s.playing ? s.bar : this.cutBar;
    // moves are paced to the planned run (a drop's shot before the montage still gets its few bars of move)
    const seconds = Math.max(2.5, (moment === 'drop' ? Math.max(len, 2) : this.len) * this.barSec);
    return { id, landmark, side: this.side, seconds: s.playing ? seconds : IDLE_SECONDS, cut };
  }
}

/** the venue's own style for Auto */
export function styleFor(pick: DirectorPick, venueStyle: DirectorStyle | undefined): DirectorStyle {
  return pick === 'auto' ? (venueStyle ?? 'festival') : pick;
}

export const STYLE_LABELS: Record<DirectorPick, string> = {
  auto: 'Auto (the venue’s own)',
  festival: 'Festival stream',
  stream: 'Club stream',
  cinematic: 'Cinematic',
};

/*
 * The director's special looks: the whole-picture camera looks (picture.ts),
 * saved for moments so they stay special. Only with the lens on Auto (App
 * checks). Some drops (never two in a row, never within a few minutes of the
 * last special look) cut to LiDAR or ASCII for a few bars, over the drop's
 * shot and its montage. Now and then a slow, wide shot in a groove runs as a
 * long exposure, until the next cut.
 */

export type DirectorLook = 'lidar' | 'ascii' | 'longexposure';

/** how often: seconds between special looks at least, the chance a drop gets one, its bars, the chance for a long exposure */
export const SPECIAL = { gap: 150, dropChance: 0.45, dropBars: 4, longChance: 0.3 } as const;

/** the slow, wide takes a long exposure suits */
export const LONG_TAKES: CamId[] = ['wide', 'aerial', 'landmark', 'crane', 'jib', 'orbit'];

export class LookDirector {
  /** the special look on now (null: the angle's own) */
  look: DirectorLook | null = null;
  /** the bar a drop's look ends on */
  private until = -1;
  /** when the last special look started, seconds */
  private lastAt = -1e9;
  /** the last drop had a look (the next one doesn't) */
  private lastDrop = false;
  private lastPick: DirectorLook = 'ascii';

  constructor(private rand: () => number = Math.random) {}

  reset(): void {
    this.look = null;
    this.until = -1;
    this.lastDrop = false;
  }

  /** the director just cut to `take` for `moment` (at show time t, on `bar`) */
  onTake(take: Take, moment: Moment, t: number, bar: number): void {
    // a long exposure is for its shot only; a drop's look runs on through the montage's cuts
    if (this.look === 'longexposure' || (this.look && moment !== 'burst' && moment !== 'peak')) this.look = null;
    const free = t - this.lastAt >= SPECIAL.gap;
    if (moment === 'drop') {
      const go = free && !this.lastDrop && this.rand() < SPECIAL.dropChance;
      this.lastDrop = go;
      if (!go) return;
      // mostly the other one from last time
      this.lastPick = this.rand() < 0.75 ? (this.lastPick === 'lidar' ? 'ascii' : 'lidar') : this.lastPick;
      this.look = this.lastPick;
      this.until = bar + SPECIAL.dropBars;
      this.lastAt = t;
      return;
    }
    if (moment === 'groove' && !this.look && free && LONG_TAKES.includes(take.id) && this.rand() < SPECIAL.longChance) {
      this.look = 'longexposure';
      this.lastAt = t;
    }
  }

  /** this frame's special look */
  update(playing: boolean, bar: number): DirectorLook | null {
    if (!playing) this.look = null;
    else if (this.look && this.look !== 'longexposure' && bar >= this.until) this.look = null;
    return this.look;
  }
}
