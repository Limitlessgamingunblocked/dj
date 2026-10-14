/*
 * The Dome's eye: when it looks, blinks and opens, and when the ceiling
 * shows it instead of the visual player. Plain numbers from the beat clock
 * and the show; dome.ts feeds them to the ceiling's shader (domeScreen.ts).
 *
 *   saccade  a new place to look every 2 beats, one side of the room then
 *            the other, reached in a quick flick (an eighth of the slot,
 *            about 120 ms at 124 bpm) and held, with a slow drift
 *   blink    every 4 bars: the lids shut on the last off-beat of the fourth
 *            bar and are open again for the downbeat
 *   squint   the lids narrow as a build tightens
 *   wide     the drop throws them wide open, staring straight out at the
 *            room, for a bar, then they ease back over two
 *   pupil    pumps with every kick, opens in the dark of a build, and
 *            tightens to a pinpoint in the light of the drop
 *
 * The show's running order, what the ceiling shows when:
 *   no music         the eye, half asleep, looking round the empty room
 *   groove           the visual player, with the eye looking in for the last
 *                    4 bars of every 32-bar phrase
 *   breakdown/build  the eye opens over the picture and watches the room
 *   drop             the eye, wide, for the drop's first 4 bars
 *   peak             then it closes and the visual player takes the dome
 * Fades take a bar (counted in beats, so they follow the tempo): going to
 * the eye, the picture dims first and the lids open out of the dark;
 * leaving it, the lids close, then the picture comes up.
 */

/** beats between saccades */
export const SACCADE_BEATS = 2;
/** beats between blinks (4 bars) */
export const BLINK_BEATS = 16;
/** bars the eye stays up after a drop */
export const DROP_BARS = 4;
/** the groove's phrase, and how many bars at the end of it the eye looks in for */
export const PHRASE_BARS = 32;
export const VISIT_BARS = 4;
/** beats a crossfade between the eye and the visual player takes */
export const FADE_BEATS = 4;
/** beats a second of the idle clock (no music): a slow, sleepy eye */
const IDLE_RATE = 0.9;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const fract = (x: number) => x - Math.floor(x);
const mod = (x: number, m: number) => ((x % m) + m) % m;
function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
const hash = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

/**
 * How shut the lids are for the blink at this beat, 0 open .. 1 shut. Every 4
 * bars: they start to close a little after the fourth beat of the fourth bar,
 * are shut a tenth of a beat later (about 70 ms at 124 bpm), and open again
 * by the downbeat, slower than they closed, as eyes do.
 */
export function blinkAt(beat: number): number {
  const s = mod(beat, BLINK_BEATS) - (BLINK_BEATS - 0.55);
  if (s < 0) return 0;
  if (s < 0.15) return smooth(0, 0.15, s);
  if (s < 0.25) return 1;
  return 1 - smooth(0.25, 0.55, s);
}

/**
 * Where the eye looks in saccade slot `k`, in half-widths of the eye: x up to
 * ±0.34, y up to ±0.15. It scans the room, one side then the other, so every
 * flick moves far enough to see (a tiny one reads as a twitch).
 */
export function lookFor(k: number): [number, number] {
  const side = mod(k, 2) < 1 ? -1 : 1;
  return [side * (0.06 + 0.28 * hash(k)), (hash(k + 17.3) - 0.5) * 0.3];
}

/** The gaze at a beat: it flicks to each slot's spot over the first eighth of the slot and holds it. */
export function saccade(beat: number): [number, number] {
  const k = Math.floor(beat / SACCADE_BEATS);
  const f = smooth(0, 0.125, fract(beat / SACCADE_BEATS));
  const a = lookFor(k - 1);
  const b = lookFor(k);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** How far a build has narrowed the eye, 0..1: nothing early in a breakdown, a full squint at the top of the build. */
export function squintFor(build: number): number {
  return smooth(0.45, 0.95, build);
}

/** The drop's wide-open stare, 0..1, by beats since the drop: held for a bar, eased off over the next two. */
export function wideAfter(beatsSinceDrop: number): number {
  if (!(beatsSinceDrop >= 0)) return 0;
  return 1 - smooth(4, 12, beatsSinceDrop);
}

/**
 * How open the lids are: 0 shut, 1 relaxed, about 1.3 wide. The relaxed
 * opening is narrowed by a squint and by drowsiness (no music), widened by
 * the drop, and closed by a blink.
 */
export function lidOpen(squint: number, wide: number, blink: number, drowsy = 0): number {
  const o = 1 - 0.58 * squint + 0.32 * wide - 0.42 * drowsy;
  return Math.max(0, o) * (1 - clamp01(blink));
}

/** The pupil's radius as a share of the iris: pumps with the kick, opens up in a build, a pinpoint on the drop. */
export function pupilFor(kick: number, build: number, wide: number): number {
  const r = 0.33 + 0.15 * clamp01(kick) + 0.11 * clamp01(build) - 0.13 * clamp01(wide);
  return Math.min(0.62, Math.max(0.16, r));
}

/** What the eye needs from the show (a ShowState has all of it). */
export interface EyeShow {
  t: number;
  beat: number;
  bar: number;
  bpm: number;
  playing: boolean;
  /** 0..1 how deep into a breakdown / build-up */
  build: number;
  /** 0..1 the peak after a drop */
  peak: number;
  kick: number;
  dropHit: boolean;
}

/**
 * Whether the show wants the eye on the ceiling (true) or the visual player.
 * `barsSinceDrop` is negative before the first drop; `showing` says whether
 * the eye is already up, which holds it through the tail of a build.
 */
export function wantEye(s: { playing: boolean; build: number; peak: number; bar: number }, barsSinceDrop: number, showing: boolean): boolean {
  if (!s.playing) return true;
  if (barsSinceDrop >= 0 && barsSinceDrop < DROP_BARS) return true;
  if (s.build > 0.3 || (showing && s.build > 0.12)) return true;
  if (s.peak > 0.5) return false;
  return mod(s.bar, PHRASE_BARS) >= PHRASE_BARS - VISIT_BARS;
}

/** The eye's state, frame by frame. */
export class DomeEye {
  /** the crossfade, 0 the visual player .. 1 the eye (linear: the fades below are read off it) */
  ramp = 1;
  /** how far the picture has dimmed to the eye's dark sky, 0..1 */
  screen = 1;
  /** how far the lids have opened out of the dark (the crossfade's second half), 0..1 */
  lids = 1;
  /** the lid opening on the ceiling, with the crossfade (0 shut, 1 relaxed, ~1.3 wide) */
  open = 0.6;
  /** where it's looking, in half-widths of the eye from its middle (x right, y up) */
  readonly gaze: [number, number] = [0, 0];
  pupil = 0.33;
  wide = 0;
  squint = 0;
  blink = 0;
  /** the beat clock the eye runs on (the music's, or a slow one of its own with no music) */
  beat = 0;
  private dropBeat = Number.NaN;
  private idle = 0;

  update(s: EyeShow, dt: number): this {
    dt = Math.max(0, Math.min(dt, 0.25));
    // with no music the eye keeps its own slow time, so it still looks round and blinks
    if (s.playing) this.beat = s.beat;
    else this.beat = this.idle += dt * IDLE_RATE;
    if (s.dropHit) this.dropBeat = s.beat;
    // a seek back past the drop (or a new track) forgets it
    if (!s.playing || s.beat < this.dropBeat) this.dropBeat = Number.NaN;
    const since = s.beat - this.dropBeat;
    const barsSinceDrop = since >= 0 ? Math.floor(since / 4) : -1;

    // the running order, faded over a bar at the music's tempo
    const showing = this.ramp > 0.5;
    const want = wantEye(s, barsSinceDrop, showing) ? 1 : 0;
    const beatsPerSec = s.playing && s.bpm > 0 ? s.bpm / 60 : 2;
    const step = (dt * beatsPerSec) / FADE_BEATS;
    this.ramp = want > this.ramp ? Math.min(want, this.ramp + step) : Math.max(want, this.ramp - step);
    this.screen = smooth(0, 0.55, this.ramp);
    this.lids = smooth(0.45, 1, this.ramp);

    this.wide = s.playing ? wideAfter(since) : 0;
    this.squint = s.playing ? squintFor(s.build) * (1 - this.wide) : 0;
    // a blink would land on the drop's downbeat: the stare doesn't blink
    this.blink = blinkAt(this.beat) * (1 - this.wide);
    this.open = lidOpen(this.squint, this.wide, this.blink, s.playing ? 0 : 1) * this.lids;
    this.pupil = pupilFor(s.playing ? s.kick : 0, s.playing ? s.build : 0.4, this.wide);

    // saccades, a slow drift while it holds, and the drop's stare straight out at the room
    const [gx, gy] = saccade(this.beat);
    const drift = s.t * 0.7;
    const sx = gx + Math.sin(drift) * 0.012;
    const sy = gy + Math.sin(drift * 1.3 + 1) * 0.008;
    this.gaze[0] = sx * (1 - this.wide);
    this.gaze[1] = sy * (1 - this.wide) - 0.03 * this.wide;
    return this;
  }
}
