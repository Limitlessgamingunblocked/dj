/*
 * Hype man on the mic: the scoring. A friend (or you) talks over the set on a
 * microphone; this listens to when they're talking, against the beat, the
 * section and the vocal of what's playing, and says what the room makes of it.
 *
 * - A call ("Say HO!", "Hands in the air!") is armed on the MC's pads and
 *   fires on their next short shout. The crowd answers on the next beat; how
 *   loud depends on how into it they are, whether the shout landed on the
 *   beat, the section (a breakdown or build is where calls land best) and how
 *   often they've heard that call tonight.
 * - Hyping a build or a breakdown on the mic lifts the room a little.
 * - Talking over the vocal, or never letting the music breathe, costs vibe.
 *
 * Pure logic over a per-frame input, so it's tested without audio.
 */

export type CallId = 'ho' | 'hands' | 'noise' | 'clap' | 'name';

export const CALLS: { id: CallId; label: string; say: string }[] = [
  { id: 'ho', label: 'Say HO!', say: 'Say HO!' },
  { id: 'hands', label: 'Hands up', say: 'Hands in the air!' },
  { id: 'noise', label: 'Make some noise', say: 'Make some noise!' },
  { id: 'clap', label: 'Clap', say: 'Clap your hands!' },
  { id: 'name', label: 'Your name', say: 'Say my DJ’s name!' },
];

export type Timing = 'on_beat' | 'close' | 'off';

export type MicEvent =
  | { kind: 'call'; call: CallId; t: number; timing: Timing; strength: number; points: number; dv: number; answerIn: number }
  | { kind: 'hype'; t: number; points: number; dv: number }
  | { kind: 'over_vocal'; t: number; dv: number }
  | { kind: 'too_much'; t: number; dv: number }
  | { kind: 'missed'; call: CallId; t: number };

export interface MicInput {
  /** seconds */
  t: number;
  dt: number;
  /** the MC's voice is on right now */
  talking: boolean;
  /** music is playing */
  playing: boolean;
  bpm: number;
  /** continuous beat position (beat 0 = the first downbeat) */
  beat: number;
  /** the beat clock's section: 'idle' | 'groove' | 'build' | 'breakdown' | 'drop' */
  section: string;
  /** the track's vocal is being sung (a lyric line is on) */
  vocal: boolean;
  /** the room's vibe, 0..1 */
  vibe: number;
}

/** a shout this long counts as a call (seconds) */
const CALL_MIN = 0.15;
const CALL_MAX = 3;
/** an armed call waits this long for the shout */
const ARM_WAIT = 8;
/** the same call again within this window gets a tired answer */
const REPEAT_WINDOW = 45;
/** the share of the last half-minute on the mic that reads as too much */
const TOO_MUCH = 0.45;

const SECTION_K: Record<string, number> = { build: 1.2, breakdown: 1.15, groove: 1, drop: 0.85 };

export function timingFor(beat: number): Timing {
  const d = Math.abs(beat - Math.round(beat));
  return d < 0.15 ? 'on_beat' : d < 0.3 ? 'close' : 'off';
}

const TIMING_K: Record<Timing, number> = { on_beat: 1, close: 0.75, off: 0.45 };

/** seconds from a shout ending at `beat` until the crowd answers: the next beat at least a quarter-beat on */
export function answerDelay(beat: number, bpm: number, playing: boolean): number {
  if (!playing || bpm <= 0) return 0.35;
  const next = Math.ceil(beat + 0.25);
  return (next - beat) * (60 / bpm);
}

export class MicJudge {
  armed: { call: CallId; t: number } | null = null;
  /** calls answered tonight */
  calls = 0;
  /** the best answer tonight, 0..1 */
  best = 0;
  /** points the mic has earned tonight */
  points = 0;
  /** share of the last half-minute spent talking, 0..1 */
  talkShare = 0;
  private burst: { start: number; startBeat: number; vocal: number; len: number; hypeable: boolean } | null = null;
  private history: { call: CallId; t: number }[] = [];
  private said = new Map<string, number>();
  private lastT = 0;

  arm(call: CallId, t: number): void {
    this.armed = { call, t };
  }

  private once(key: string, t: number, gap: number): boolean {
    if (t - (this.said.get(key) ?? -1e9) < gap) return false;
    this.said.set(key, t);
    return true;
  }

  update(i: MicInput): MicEvent[] {
    const out: MicEvent[] = [];
    this.lastT = i.t;
    this.talkShare += ((i.talking ? 1 : 0) - this.talkShare) * Math.min(1, i.dt / 30);
    if (i.talking) {
      if (!this.burst) this.burst = { start: i.t, startBeat: i.beat, vocal: 0, len: 0, hypeable: false };
      this.burst.len += i.dt;
      if (i.vocal) this.burst.vocal += i.dt;
      if (i.playing && (i.section === 'build' || i.section === 'breakdown')) this.burst.hypeable = true;
    } else if (this.burst) {
      this.endBurst(i, out);
      this.burst = null;
    }
    if (this.armed && !this.burst && i.t - this.armed.t > ARM_WAIT) {
      out.push({ kind: 'missed', call: this.armed.call, t: i.t });
      this.armed = null;
    }
    // over the vocal: as soon as it's clear, not when they stop
    const b = this.burst;
    if (b && i.playing && b.vocal > 1.2 && b.vocal > b.len * 0.5 && this.once('over_vocal', i.t, 20)) out.push({ kind: 'over_vocal', t: i.t, dv: -0.015 });
    if (i.playing && i.t > 20 && this.talkShare > TOO_MUCH && this.once('too_much', i.t, 30)) out.push({ kind: 'too_much', t: i.t, dv: -0.02 });
    return out;
  }

  private endBurst(i: MicInput, out: MicEvent[]): void {
    const b = this.burst!;
    const len = b.len;
    if (this.armed && len >= CALL_MIN && len <= CALL_MAX) {
      const call = this.armed.call;
      this.armed = null;
      this.history = this.history.filter((x) => i.t - x.t < REPEAT_WINDOW);
      const repeats = this.history.filter((x) => x.call === call).length;
      this.history.push({ call, t: i.t });
      const decay = [1, 0.6, 0.3][Math.min(2, repeats)];
      const timing: Timing = i.playing ? timingFor(i.beat) : 'off';
      const sectionK = i.playing ? (SECTION_K[i.section] ?? 0.9) : 0.5;
      const strength = Math.max(0.05, Math.min(1, (0.35 + 0.65 * i.vibe) * TIMING_K[timing] * decay * sectionK));
      const points = i.playing ? Math.round((120 * strength) / 10) * 10 : 0;
      const dv = i.playing ? 0.04 * strength - (decay < 0.5 ? 0.01 : 0) : 0;
      this.calls++;
      this.best = Math.max(this.best, strength);
      this.points += points;
      out.push({ kind: 'call', call, t: i.t, timing, strength, points, dv, answerIn: answerDelay(i.beat, i.bpm, i.playing) });
      return;
    }
    // hyping the build or the breakdown (not over the vocal)
    if (b.hypeable && len >= 0.4 && b.vocal < len * 0.5 && this.once('hype', i.t, 8)) {
      this.points += 30;
      out.push({ kind: 'hype', t: i.t, points: 30, dv: 0.01 });
    }
  }

  /** seconds left on the armed call (the pad's countdown) */
  armedLeft(): number {
    return this.armed ? Math.max(0, ARM_WAIT - (this.lastT - this.armed.t)) : 0;
  }
}

/** what the room hears about a mic moment (short, never cringe) */
export function micText(e: MicEvent, djName: string): { text: string; tone: 'good' | 'bad' | 'hype' } | null {
  switch (e.kind) {
    case 'call': {
      if (!e.points) return { text: 'Get a track on first', tone: 'bad' };
      const loud = e.strength > 0.75 ? 'The room roars back' : e.strength > 0.45 ? 'The crowd answers' : 'A few shout back';
      const what = e.call === 'name' ? ` "${djName.toUpperCase()}!"` : '';
      return { text: `${loud}${what} +${e.points}`, tone: e.strength > 0.45 ? 'hype' : 'good' };
    }
    case 'hype':
      return { text: `MC hyping the build +${e.points}`, tone: 'hype' };
    case 'over_vocal':
      return { text: 'MC’s over the vocal. Let it breathe.', tone: 'bad' };
    case 'too_much':
      return { text: 'Too much mic. Let the music play.', tone: 'bad' };
    case 'missed':
      return null;
  }
}
