/*
 * The beat clock: the one source of musical time. Every frame it reads the
 * beat grid of the track the room is hearing (the sync master's grid, through
 * the AV-sync delay line, so it's on the beat you hear) and broadcasts:
 *   beat        every beat
 *   bar         every 4 beats
 *   phrase      every 8 bars (with the longest phrase that ends there: 8, 16 or 32)
 *   buildStart  the track pulls back and starts building
 *   breakdown   the low end drops out
 *   drop        the low end slams back after a build
 * Lights, crowd, camera cuts, name visuals and board toys listen to these
 * instead of keeping their own time.
 *
 * Sections come from the audio features today (how long the low end has
 * been gone, the drop detector). TODO: read the tracks' section markers
 * (Section 7.1) when the game library carries them, and fall back to this.
 */

export type Section = 'idle' | 'groove' | 'breakdown' | 'build' | 'drop';

/** what the clock reads each frame (a subset of the audio features) */
export interface ClockInput {
  playing: boolean;
  bpm: number;
  /** the beat the room is hearing, and how far through it */
  beatCount: number;
  beatPhase: number;
  /** 0..1 how deep into a breakdown / build-up */
  breakdown: number;
  /** the drop lands this frame */
  dropHit: boolean;
}

export interface BeatEvent {
  beat: number;
  bar: number;
  /** 0..3 */
  beatInBar: number;
  bpm: number;
}

export interface PhraseEvent extends BeatEvent {
  /** the longest phrase that ends here: 32, 16 or 8 bars */
  length: 8 | 16 | 32;
}

export interface SectionEvent extends BeatEvent {
  section: Section;
}

export interface ClockEvents {
  beat: BeatEvent;
  bar: BeatEvent;
  phrase: PhraseEvent;
  buildStart: SectionEvent;
  breakdown: SectionEvent;
  drop: SectionEvent;
}

type Handler<K extends keyof ClockEvents> = (e: ClockEvents[K]) => void;

/** breakdown depth thresholds (with hysteresis on the way out) */
const BREAKDOWN_IN = 0.3;
const BUILD_IN = 0.85;
const OUT = 0.12;
/** a drop's section lasts this many bars before the groove takes over again */
const DROP_BARS = 16;
/** at most this many beats are caught up in one frame (a stalled tab skips ahead quietly) */
const MAX_CATCH_UP = 8;

const mod = (n: number, m: number) => ((n % m) + m) % m;

export class BeatClock {
  bpm = 120;
  playing = false;
  /** continuous beat position (beatCount + phase) */
  position = 0;
  beat = 0;
  bar = 0;
  beatInBar = 0;
  phase = 0;
  section: Section = 'idle';
  /** seconds since the current section started */
  sectionTime = 0;
  private lastBeat: number | null = null;
  private dropBar = -1e9;
  private handlers: { [K in keyof ClockEvents]: Set<Handler<K>> } = {
    beat: new Set(),
    bar: new Set(),
    phrase: new Set(),
    buildStart: new Set(),
    breakdown: new Set(),
    drop: new Set(),
  };

  /** listen; returns a function that stops listening */
  on<K extends keyof ClockEvents>(event: K, fn: Handler<K>): () => void {
    this.handlers[event].add(fn);
    return () => this.handlers[event].delete(fn);
  }
  onBeat(fn: Handler<'beat'>): () => void {
    return this.on('beat', fn);
  }
  onBar(fn: Handler<'bar'>): () => void {
    return this.on('bar', fn);
  }
  onPhrase(fn: Handler<'phrase'>): () => void {
    return this.on('phrase', fn);
  }
  onBuildStart(fn: Handler<'buildStart'>): () => void {
    return this.on('buildStart', fn);
  }
  onBreakdown(fn: Handler<'breakdown'>): () => void {
    return this.on('breakdown', fn);
  }
  onDrop(fn: Handler<'drop'>): () => void {
    return this.on('drop', fn);
  }

  /** seconds per beat at the current tempo */
  get beatLength(): number {
    return 60 / Math.max(1, this.bpm);
  }

  update(f: ClockInput, dt: number): void {
    if (Number.isFinite(f.bpm) && f.bpm > 0) this.bpm = f.bpm;
    this.playing = f.playing;
    this.sectionTime += dt;
    if (!f.playing) {
      this.lastBeat = null;
      this.setSection('idle');
      return;
    }
    const beat = Math.floor(f.beatCount);
    this.beat = beat;
    this.phase = Number.isFinite(f.beatPhase) ? Math.min(1, Math.max(0, f.beatPhase)) : 0;
    this.position = beat + this.phase;
    this.bar = Math.floor(beat / 4);
    this.beatInBar = mod(beat, 4);

    // the grid: every beat since the last frame (a jump backwards, a seek or a new track just resyncs)
    const last = this.lastBeat;
    this.lastBeat = beat;
    if (last !== null && beat > last) {
      for (let b = Math.max(last + 1, beat - MAX_CATCH_UP + 1); b <= beat; b++) this.tick(b);
    } else if (last === null) {
      // started playing exactly on a downbeat: count it
      if (this.phase < 0.25) this.tick(beat);
    }

    // sections: the drop wins, then how deep the breakdown is
    if (f.dropHit) {
      this.dropBar = this.bar;
      this.setSection('drop');
      this.emit('drop', { ...this.info(this.beat), section: 'drop' });
    } else if (this.section === 'build' || this.section === 'breakdown') {
      if (f.breakdown < OUT) this.setSection('groove');
      else if (this.section === 'breakdown' && f.breakdown >= BUILD_IN) this.enter('build', 'buildStart');
    } else {
      if (f.breakdown >= BUILD_IN) this.enter('build', 'buildStart');
      else if (f.breakdown >= BREAKDOWN_IN) this.enter('breakdown', 'breakdown');
      else if (this.section === 'drop' && this.bar - this.dropBar >= DROP_BARS) this.setSection('groove');
      else if (this.section === 'idle') this.setSection('groove');
    }
  }

  private tick(b: number): void {
    const e = this.info(b);
    this.emit('beat', e);
    if (e.beatInBar !== 0) return;
    this.emit('bar', e);
    if (mod(e.bar, 8) !== 0) return;
    this.emit('phrase', { ...e, length: mod(e.bar, 32) === 0 ? 32 : mod(e.bar, 16) === 0 ? 16 : 8 });
  }

  private info(b: number): BeatEvent {
    return { beat: b, bar: Math.floor(b / 4), beatInBar: mod(b, 4), bpm: this.bpm };
  }

  private enter(section: Section, event: 'buildStart' | 'breakdown'): void {
    this.setSection(section);
    this.emit(event, { ...this.info(this.beat), section });
  }

  private setSection(s: Section): void {
    if (s === this.section) return;
    this.section = s;
    this.sectionTime = 0;
  }

  private emit<K extends keyof ClockEvents>(event: K, e: ClockEvents[K]): void {
    for (const fn of this.handlers[event]) {
      try {
        fn(e);
      } catch (err) {
        // one broken listener mustn't stop the others (or the frame)
        console.error(`BeatClock ${event} listener`, err);
      }
    }
  }
}
