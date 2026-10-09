/*
 * The vibe meter (Section 6.7): the core score of a set, and how the room
 * feels right now. Pure logic over a snapshot of the decks each frame
 * (game/snapshot.ts builds it from the audio engine), so it's tested without
 * any audio.
 *
 * It goes up with tight beatmatching (6.4: Perfect under 10 ms, Good under
 * 30 ms, a Trainwreck over 50 ms), clean named transitions (6.6), compatible
 * keys (6.5), energy that matches the slot's curve (5.3), drops after a
 * proper build, and new tracks. It goes down with trainwrecks, key clashes,
 * dead air, the same energy for too long, drops with no breathing room,
 * redlining the master, and going too hard in a warm-up. Nothing ends a set
 * (6.11); a big recovery after a mistake pays a Comeback bonus.
 */
import { compatibility } from '../analysis/keys';
import type { KeyInfo } from '../core/types';
import type { SectionKind } from './tracks';

/* ------------------------------------------------------------------ */
/* slots                                                                */
/* ------------------------------------------------------------------ */

export type SlotId = 'warmup' | 'peak' | 'closing' | 'afterhours';

export interface SlotDef {
  id: SlotId;
  label: string;
  /** what the promoter says the crowd wants */
  brief: string;
  /** the room energy the crowd wants at set progress p (0..1), 0..1 */
  target(p: number): number;
}

const ease = (p: number) => p * p * (3 - 2 * p);

export const SLOTS: Record<SlotId, SlotDef> = {
  warmup: { id: 'warmup', label: 'Warm-up', brief: "Deep and groovy. Don't go too hard.", target: (p) => 0.32 + 0.2 * ease(p) },
  peak: { id: 'peak', label: 'Peak time', brief: 'High energy. They want big drops.', target: (p) => 0.62 + 0.22 * ease(Math.min(1, p * 1.6)) + 0.05 * Math.sin(p * Math.PI * 4) },
  closing: { id: 'closing', label: 'Closing', brief: 'Emotional, euphoric, one last lift.', target: (p) => (p < 0.75 ? 0.7 + 0.1 * ease(p / 0.75) : 0.8 + 0.15 * ease((p - 0.75) / 0.25)) },
  afterhours: { id: 'afterhours', label: 'Afterhours', brief: 'Weird, hypnotic, minimal. Long blends.', target: () => 0.42 },
};

/* ------------------------------------------------------------------ */
/* input                                                                */
/* ------------------------------------------------------------------ */

/** one deck, as the room hears it this frame */
export interface DeckSnap {
  id: number;
  trackId: string | null;
  artist: string;
  playing: boolean;
  /** how loud it is in the room, 0..1 (channel fader × crossfader; 0 when muted) */
  audible: number;
  /** effective BPM */
  bpm: number;
  /** continuous beat position of what's audible (beat 0 = the first downbeat) */
  beat: number;
  key: KeyInfo | null;
  /** the energy it brings right now, 0..1 */
  energy: number;
  section: SectionKind | null;
  /** EQ and filter, 0..1 (0.5 = flat / off) */
  low: number;
  filter: number;
  /** an echo or delay is on and catching this channel */
  echo: boolean;
  /** a loop roll is running */
  roll: boolean;
}

export interface VibeInput {
  /** game seconds (only advances while the set runs) */
  t: number;
  dt: number;
  decks: DeckSnap[];
  /** master output level, 0..1 (silence is dead air) */
  level: number;
  /** master redline, 0..1 */
  redline: number;
  /** how far through the set, 0..1 */
  progress: number;
  /** the audio features caught a drop (for music without markers) */
  dropHit: boolean;
}

/* ------------------------------------------------------------------ */
/* events                                                               */
/* ------------------------------------------------------------------ */

export type TransitionName = 'long_blend' | 'bass_swap' | 'filter_fade' | 'echo_out' | 'loop_roll' | 'quick_cut' | 'double_drop' | 'clean_mix';
export type Band = 'perfect' | 'good' | 'loose' | 'trainwreck';
export type MistakeName = 'trainwreck' | 'key_clash' | 'dead_air' | 'redline' | 'fatigue' | 'drop_spam' | 'too_hard' | 'repeat';

export const TRANSITION_LABEL: Record<TransitionName, string> = {
  long_blend: 'Long blend',
  bass_swap: 'Clean bass swap',
  filter_fade: 'Filter fade',
  echo_out: 'Echo out',
  loop_roll: 'Loop roll build',
  quick_cut: 'Quick cut on the one',
  double_drop: 'Double drop',
  clean_mix: 'Clean mix',
};

const TRANSITION_POINTS: Record<TransitionName, number> = { long_blend: 150, bass_swap: 120, filter_fade: 90, echo_out: 90, loop_roll: 110, quick_cut: 100, double_drop: 200, clean_mix: 50 };

export type VibeEvent =
  | { kind: 'transition'; name: TransitionName; points: number; t: number; band: Band; keyBonus: boolean }
  | { kind: 'mistake'; name: MistakeName; t: number }
  | { kind: 'drop'; built: boolean; points: number; t: number }
  | { kind: 'comeback'; points: number; t: number }
  | { kind: 'band'; band: Band; ms: number; t: number };

/** what the room hears about it (Section 2.6: short, confident, never cringe) */
export function eventText(e: VibeEvent): string | null {
  switch (e.kind) {
    case 'transition':
      return `${TRANSITION_LABEL[e.name]} +${e.points}`;
    case 'drop':
      return e.built ? `Big drop +${e.points}` : 'Drop';
    case 'comeback':
      return `Comeback +${e.points}`;
    case 'mistake':
      return {
        trainwreck: 'Trainwreck. Pull it back in.',
        key_clash: "Keys are clashing. Find the right key.",
        dead_air: 'Dead air!',
        redline: "You're in the red. Ease off.",
        fatigue: "Crowd's getting restless. Change it up.",
        drop_spam: 'Too many drops. Let them breathe.',
        too_hard: "You're playing peak-time at 10pm.",
        repeat: "They've heard this one tonight.",
      }[e.name];
    case 'band':
      return e.band === 'perfect' ? 'Perfect beatmatch' : null;
  }
}

/* ------------------------------------------------------------------ */
/* the meter                                                            */
/* ------------------------------------------------------------------ */

/** phase error between two decks in milliseconds (beats folded to ±½, tempo-aware) */
export function phaseErrorMs(a: Pick<DeckSnap, 'beat' | 'bpm'>, b: Pick<DeckSnap, 'beat' | 'bpm'>): number {
  const d = (((a.beat - b.beat) % 1) + 1.5) % 1 - 0.5;
  return Math.abs(d) * (60 / Math.max(1, (a.bpm + b.bpm) / 2)) * 1000;
}

export function bandFor(ms: number): Band {
  return ms < 10 ? 'perfect' : ms < 30 ? 'good' : ms <= 50 ? 'loose' : 'trainwreck';
}

/** tempos that drift apart (folding double / half time) */
function tempoError(a: number, b: number): number {
  let r = a / Math.max(1, b);
  if (r > 1.5) r /= 2;
  else if (r < 0.75) r *= 2;
  return Math.abs(r - 1);
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/** the grade for a set: mostly how high the vibe sat, plus how much you pulled off */
export function gradeFor(avgVibe: number, pointsPerMinute: number): Grade {
  const s = avgVibe * 0.85 + Math.min(0.15, pointsPerMinute / 1200);
  return s >= 0.82 ? 'S' : s >= 0.7 ? 'A' : s >= 0.56 ? 'B' : s >= 0.42 ? 'C' : 'D';
}

interface Mix {
  out: number;
  in: number;
  start: number;
  /** seconds both were up and beatmatched (good or better) / loose or worse */
  clean: number;
  messy: number;
  bandSum: number;
  bandN: number;
  inLowCut: number | null;
  inLowUp: number | null;
  outLowWasUp: boolean;
  outLowCut: number | null;
  outFilter: number;
  keyOk: boolean;
  /** the incoming deck's level just before it came in, for quick cuts */
  rise: number;
}

const AUDIBLE = 0.12;

export class VibeMeter {
  /** how the room feels, 0..1 */
  vibe = 0.3;
  /** points from transitions, drops and comebacks */
  points = 0;
  /** every 2 seconds: the vibe, the room energy and what the slot wanted */
  readonly timeline: { t: number; vibe: number; energy: number; target: number }[] = [];
  readonly log: VibeEvent[] = [];
  /** the moment the room peaked */
  peak = { t: 0, vibe: 0, why: '' };
  /** the room energy right now, 0..1 */
  energy = 0;
  /** the band of the current overlap (null with one deck up) */
  band: Band | null = null;
  phaseMs = 0;

  private mix: Mix | null = null;
  private prevAudible = new Map<number, number>();
  private prevSection = new Map<number, SectionKind | null>();
  private buildTime = new Map<number, number>();
  private rollAt = -1e9;
  private lastDrop = -1e9;
  private dropsInRow = 0;
  private dropDeckT = new Map<number, number>();
  private wreck = 0;
  private wreckSaid = false;
  private clash = 0;
  private silence = 0;
  private red = 0;
  private flatSince = 0;
  private flatLevel = 0;
  private hard = 0;
  private hardSaid = false;
  private lowPoint: { t: number; vibe: number } | null = null;
  private played = new Map<string, number>();
  private started = false;
  private lastSample = -1e9;
  private vibeSum = 0;
  private vibeTime = 0;
  private said = new Map<string, number>();

  constructor(readonly slot: SlotDef = SLOTS.peak) {}

  /** the average vibe so far */
  get average(): number {
    return this.vibeTime > 0 ? this.vibeSum / this.vibeTime : this.vibe;
  }

  /** the best transition so far */
  get best(): Extract<VibeEvent, { kind: 'transition' }> | null {
    let b: Extract<VibeEvent, { kind: 'transition' }> | null = null;
    for (const e of this.log) if (e.kind === 'transition' && (!b || e.points > b.points)) b = e;
    return b;
  }

  grade(minutes: number): Grade {
    return gradeFor(this.average, this.points / Math.max(1, minutes));
  }

  private emit(out: VibeEvent[], e: VibeEvent, gap = 0, key: string = e.kind + ('name' in e ? e.name : '')): void {
    if (gap) {
      const last = this.said.get(key) ?? -1e9;
      if (e.t - last < gap) return;
      this.said.set(key, e.t);
    }
    out.push(e);
    this.log.push(e);
  }

  private bump(dv: number): void {
    this.vibe = Math.max(0.02, Math.min(1, this.vibe + dv));
  }

  update(i: VibeInput): VibeEvent[] {
    const out: VibeEvent[] = [];
    const { t, dt } = i;
    const live = i.decks.filter((d) => d.playing && d.audible > AUDIBLE && d.trackId);
    const target = this.slot.target(i.progress);

    // the room energy: the loudest decks' energy, weighted by how loud each is
    let wsum = 0;
    let esum = 0;
    for (const d of live) {
      wsum += d.audible;
      esum += d.energy * d.audible;
    }
    const energy = wsum > 0 ? esum / wsum : 0;
    this.energy += (energy - this.energy) * Math.min(1, dt * 1.5);

    // drift towards how well the energy fits the slot
    if (live.length) {
      const match = Math.max(0, 1 - Math.abs(this.energy - target) * 2.4);
      const rest = 0.22 + 0.56 * match;
      this.vibe += (rest - this.vibe) * Math.min(1, dt / 28);
      // going too hard in a warm-up
      if (this.slot.id === 'warmup' && this.energy > target + 0.22) {
        this.hard += dt;
        if (this.hard > 25 && !this.hardSaid) {
          this.hardSaid = true;
          this.emit(out, { kind: 'mistake', name: 'too_hard', t });
        }
      } else this.hard = Math.max(0, this.hard - dt);
    }

    // dead air (once the first track has started)
    if (live.length && i.level >= 0.012) this.started = true;
    if (this.started && (i.level < 0.012 || !live.length)) {
      this.silence += dt;
      if (this.silence > 2) {
        this.bump(-dt * 0.05);
        this.emit(out, { kind: 'mistake', name: 'dead_air', t }, 20);
      }
    } else this.silence = 0;

    // redlining the master
    if (i.redline > 0.5) {
      this.red += dt;
      if (this.red > 1.5) {
        this.bump(-dt * 0.02);
        this.emit(out, { kind: 'mistake', name: 'redline', t }, 15);
      }
    } else this.red = Math.max(0, this.red - dt * 2);

    // fatigue: the same energy for too long (a breakdown or a drop resets it)
    if (live.length) {
      if (Math.abs(this.energy - this.flatLevel) > 0.14) {
        this.flatLevel = this.energy;
        this.flatSince = t;
      } else if (t - this.flatSince > 360) {
        this.bump(-dt * 0.008);
        this.emit(out, { kind: 'mistake', name: 'fatigue', t }, 60);
      }
    }

    // how long each track has been heard tonight (a repeat costs, see trackMix)
    for (const d of live) if (d.trackId) this.played.set(d.trackId, (this.played.get(d.trackId) ?? 0) + dt);

    // two decks up: beatmatching, keys and the transition between them
    if (live.length >= 2) {
      const [a, b] = [...live].sort((x, y) => y.audible - x.audible);
      const ms = phaseErrorMs(a, b);
      const terr = tempoError(a.bpm, b.bpm);
      this.phaseMs = ms;
      const band = terr > 0.006 ? 'trainwreck' : bandFor(ms);
      if (band !== this.band && band === 'perfect') this.emit(out, { kind: 'band', band, ms, t }, 30, 'perfect');
      this.band = band;
      if (band === 'trainwreck') {
        this.wreck += dt;
        if (this.wreck > 1.2) {
          if (!this.wreckSaid) {
            this.wreckSaid = true;
            this.bump(-0.06);
            this.emit(out, { kind: 'mistake', name: 'trainwreck', t }, 10);
          }
          this.bump(-dt * 0.025);
        }
      } else {
        this.wreck = Math.max(0, this.wreck - dt * 2);
        if (this.wreck === 0) this.wreckSaid = false;
        if (band === 'perfect' || band === 'good') this.bump(dt * 0.006);
      }
      const keyOk = !a.key || !b.key || compatibility(a.key, b.key) !== null;
      if (!keyOk && b.audible > 0.35 && a.audible > 0.35) {
        this.clash += dt;
        if (this.clash > 6) {
          this.bump(-dt * 0.02);
          this.emit(out, { kind: 'mistake', name: 'key_clash', t }, 25);
        }
      } else this.clash = Math.max(0, this.clash - dt);
    } else {
      this.band = null;
      this.wreck = 0;
      this.wreckSaid = false;
      this.clash = 0;
    }

    this.trackMix(i, live, out);
    this.trackDrops(i, live, out);

    // the comeback: from the floor to the roof within three minutes
    if (this.vibe < 0.3 && (!this.lowPoint || this.vibe < this.lowPoint.vibe)) this.lowPoint = { t, vibe: this.vibe };
    if (this.lowPoint && this.vibe > 0.7) {
      if (t - this.lowPoint.t < 180) {
        this.points += 200;
        this.bump(0.04);
        this.emit(out, { kind: 'comeback', points: 200, t });
      }
      this.lowPoint = null;
    }

    // the record of the night
    this.vibeSum += this.vibe * dt;
    this.vibeTime += dt;
    if (this.vibe > this.peak.vibe) {
      const last = [...this.log].reverse().find((e) => e.kind === 'transition' || e.kind === 'drop' || e.kind === 'comeback');
      this.peak = { t, vibe: this.vibe, why: last ? (eventText(last) ?? '').replace(/ \+\d+$/, '') : '' };
    }
    if (t - this.lastSample >= 2) {
      this.lastSample = t;
      this.timeline.push({ t, vibe: this.vibe, energy: this.energy, target });
    }
    for (const d of i.decks) this.prevAudible.set(d.id, d.playing ? d.audible : 0);
    return out;
  }

  /* -------------------------------------------------------------- */
  /* transitions                                                     */
  /* -------------------------------------------------------------- */

  private trackMix(i: VibeInput, live: DeckSnap[], out: VibeEvent[]): void {
    const { t, dt } = i;
    const byId = new Map(i.decks.map((d) => [d.id, d]));
    if (!this.mix && live.length >= 2) {
      // a new deck came up under one that's playing
      const incoming = live.find((d) => (this.prevAudible.get(d.id) ?? 0) <= AUDIBLE);
      const outgoing = live.find((d) => d !== incoming);
      if (incoming && outgoing) {
        this.mix = {
          out: outgoing.id,
          in: incoming.id,
          start: t,
          clean: 0,
          messy: 0,
          bandSum: 0,
          bandN: 0,
          inLowCut: incoming.low < 0.2 ? t : null,
          inLowUp: null,
          outLowWasUp: outgoing.low > 0.35,
          outLowCut: null,
          outFilter: 0,
          keyOk: !outgoing.key || !incoming.key || compatibility(outgoing.key, incoming.key) !== null,
          rise: this.prevAudible.get(incoming.id) ?? 0,
        };
      }
    }
    const m = this.mix;
    if (!m) return;
    const a = byId.get(m.out);
    const b = byId.get(m.in);
    const aUp = !!a && a.playing && a.audible > AUDIBLE;
    const bUp = !!b && b.playing && b.audible > AUDIBLE;
    if (aUp && bUp && a && b) {
      const ms = phaseErrorMs(a, b);
      const band = tempoError(a.bpm, b.bpm) > 0.006 ? 'trainwreck' : bandFor(ms);
      if (band === 'perfect' || band === 'good') m.clean += dt;
      else m.messy += dt;
      m.bandSum += band === 'perfect' ? 0 : band === 'good' ? 1 : band === 'loose' ? 2 : 3;
      m.bandN++;
      // the bass swap: the incoming lows come up as the outgoing lows go
      if (b.low < 0.2 && m.inLowUp === null) m.inLowCut = m.inLowCut ?? t;
      if (m.inLowCut !== null && b.low > 0.35 && m.inLowUp === null) m.inLowUp = t;
      if (a.low > 0.35) m.outLowWasUp = true;
      if (m.outLowWasUp && a.low < 0.2 && m.outLowCut === null) m.outLowCut = t;
      m.outFilter = Math.max(m.outFilter * Math.exp(-dt / 20), Math.abs(a.filter - 0.5) * 2);
      if (a.roll || b.roll) this.rollAt = t;
      return;
    }
    // the mix is over: who's left?
    this.mix = null;
    if (!aUp && !bUp) return;
    const survivor = bUp ? b! : a!;
    const leaver = bUp ? a : b;
    const swapped = bUp;
    const overlap = t - m.start;
    const beat = 60 / Math.max(60, survivor.bpm);
    const bars = overlap / (beat * 4);
    const cleanFrac = m.clean / Math.max(1e-3, m.clean + m.messy);
    const avgBand = m.bandN ? m.bandSum / m.bandN : 3;
    const band: Band = avgBand < 0.5 ? 'perfect' : avgBand < 1.5 ? 'good' : avgBand < 2.5 ? 'loose' : 'trainwreck';
    const names: TransitionName[] = [];
    if (swapped) {
      if (bars >= 16 && cleanFrac >= 0.85) names.push('long_blend');
      if (m.inLowUp !== null && m.outLowCut !== null && Math.abs(m.inLowUp - m.outLowCut) <= beat * 8 && cleanFrac >= 0.6) names.push('bass_swap');
      if (m.outFilter > 0.6) names.push('filter_fade');
      if (leaver?.echo) names.push('echo_out');
      // the cut: the new track slammed in on a downbeat with no overlap to speak of
      const barPhase = (((survivor.beat % 4) + 4) % 4) / 4;
      if (overlap < beat * 2 && m.rise <= AUDIBLE && (barPhase < 0.08 || barPhase > 0.94)) names.push('quick_cut');
      if (!names.length && bars >= 8 && cleanFrac >= 0.75) names.push('clean_mix');
    }
    const mult = (band === 'perfect' ? 1.2 : band === 'good' ? 1 : 0.6) * (m.keyOk ? 1.2 : 0.8);
    for (const name of names) {
      // the cut doesn't need a long beatmatch: it's about timing
      const pts = Math.round((TRANSITION_POINTS[name] * (name === 'quick_cut' ? (m.keyOk ? 1.2 : 0.8) : mult)) / 10) * 10;
      this.points += pts;
      this.bump(name === 'clean_mix' ? 0.03 : 0.06);
      this.emit(out, { kind: 'transition', name, points: pts, t, band, keyBonus: m.keyOk });
    }
    // a track they've already heard tonight
    // (heard for more than the overlap: it was played earlier tonight)
    if (swapped && survivor.trackId && (this.played.get(survivor.trackId) ?? 0) > overlap + 30) {
      this.bump(-0.06);
      this.emit(out, { kind: 'mistake', name: 'repeat', t }, 30);
    }
    // a fresh artist keeps the floor interested
    if (swapped && leaver && survivor.artist && survivor.artist !== leaver.artist) this.bump(0.015);
  }

  /* -------------------------------------------------------------- */
  /* drops                                                           */
  /* -------------------------------------------------------------- */

  private trackDrops(i: VibeInput, live: DeckSnap[], out: VibeEvent[]): void {
    const { t, dt } = i;
    let dropped: DeckSnap | null = null;
    for (const d of i.decks) {
      const prev = this.prevSection.get(d.id) ?? null;
      this.prevSection.set(d.id, d.section);
      const up = live.includes(d);
      if (d.section === 'build' && up) this.buildTime.set(d.id, (this.buildTime.get(d.id) ?? 0) + dt);
      if (d.roll && up) this.rollAt = t;
      if (up && d.section === 'drop' && prev !== 'drop' && prev !== null) {
        dropped = d;
        this.dropDeckT.set(d.id, t);
      }
      if (d.section !== 'build' && d.section !== 'drop') this.buildTime.set(d.id, 0);
    }
    // music with no markers: the detector's drop
    const markerless = live.length > 0 && live.every((d) => d.section === null);
    if (!dropped && markerless && i.dropHit) dropped = live[0];
    if (!dropped) return;
    // a double drop: two beatmatched decks hitting their drops together
    const other = live.find((d) => d !== dropped && Math.abs((this.dropDeckT.get(d.id) ?? -1e9) - t) < 60 / Math.max(60, d.bpm));
    if (other && phaseErrorMs(dropped, other) < 30) {
      const pts = TRANSITION_POINTS.double_drop;
      this.points += pts;
      this.bump(0.1);
      this.emit(out, { kind: 'transition', name: 'double_drop', points: pts, t, band: bandFor(phaseErrorMs(dropped, other)), keyBonus: true });
      return;
    }
    const beat = 60 / Math.max(60, dropped.bpm);
    const built = (this.buildTime.get(dropped.id) ?? 0) >= beat * 16 || markerless;
    // a loop roll into the drop
    if (t - this.rollAt < beat * 32) {
      const pts = TRANSITION_POINTS.loop_roll;
      this.points += pts;
      this.bump(0.05);
      this.emit(out, { kind: 'transition', name: 'loop_roll', points: pts, t, band: 'good', keyBonus: false });
      this.rollAt = -1e9;
    }
    // drops need breathing room: one every 32 bars at most
    const gap = t - this.lastDrop;
    this.lastDrop = t;
    if (gap < beat * 4 * 32) {
      this.dropsInRow++;
      if (this.dropsInRow >= 2) {
        this.bump(-0.06);
        this.emit(out, { kind: 'mistake', name: 'drop_spam', t }, 30);
        return;
      }
    } else this.dropsInRow = 0;
    const pts = built ? 80 : 20;
    this.points += pts;
    this.bump(built ? 0.12 : 0.05);
    // a drop resets the crowd's fatigue
    this.flatSince = t;
    this.emit(out, { kind: 'drop', built, points: pts, t });
  }
}
