/*
 * Deck: main-thread brain of one player. Owns the AudioWorklet playback node
 * and implements DJ transport behaviour on top of it: CDJ-style cue, hot cues,
 * quantized phase-preserving jumps, loops and loop rolls, slicer, beat jump,
 * pitch play, key shift, tempo ranges, pitch bend, jog nudge/scratch, slip,
 * turntable motor inertia and vinyl wear.
 */
import { autoLoopStart, closeLoop, loopInPoint, wrapInLoop, type Grid } from './loops';
import { Emitter } from '../core/emitter';
import { clamp } from '../core/util';
import { HOTCUE_COLORS, type DeckId, type HotCue, type KeyInfo, type LibraryTrack, type PcmData, type TrackAnalysis } from '../core/types';
import { shiftKey } from '../analysis/keys';

export type PadMode = 'hotcue' | 'roll' | 'slicer' | 'jump' | 'pitch' | 'sampler';
export const PAD_MODES: PadMode[] = ['hotcue', 'roll', 'slicer', 'jump', 'pitch', 'sampler'];
export const PAD_MODE_LABELS: Record<PadMode, string> = {
  hotcue: 'HOT CUE',
  roll: 'ROLL',
  slicer: 'SLICER',
  jump: 'BEAT JUMP',
  pitch: 'PITCH PLAY',
  sampler: 'SAMPLER',
};
export const ROLL_BEATS = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4];
export const JUMP_PADS = [-1, 1, -2, 2, -4, 4, -8, 8];
export const PITCH_PADS = [-3, -2, -1, 0, 1, 2, 3, 4];
export const LOOP_SIZES = [1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32, 64];
export const TEMPO_RANGES = [0.06, 0.08, 0.1, 0.16, 0.25, 0.5, 1];
export const SECONDS_PER_REV = 1.8; // 33 1/3 RPM

export function beatLabel(b: number): string {
  if (b >= 1) return String(b);
  return `1/${Math.round(1 / b)}`;
}

interface DeckEvents extends Record<string, unknown> {
  loaded: Deck;
  ended: Deck;
  cues: Deck;
  change: Deck;
}

export interface StemLevels {
  vocal: number;
  drums: number;
  bass: number;
  melody: number;
}

export interface DeckHost {
  isShift(): boolean;
  samplerPad(pad: number, down: boolean): void;
  samplerLit(pad: number): string | false;
  /** called when a synced deck starts or engages sync, to snap its phase */
  snapPhase(deck: Deck): void;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export class Deck extends Emitter<DeckEvents> {
  readonly node: AudioWorkletNode;
  track: LibraryTrack | null = null;
  analysis: TrackAnalysis | null = null;
  duration = 0;
  srcRate = 44100;
  loading = false;
  wasm = false;
  latency = 0; // seconds of processing latency (stems STFT)

  // last report from the audio thread
  private rPos = 0;
  private rSlip = 0;
  private rV = 0;
  private rT = 0;
  platter = 0;
  stretchActive = false;

  playing = false;
  cuePoint = 0;
  hotCues: (HotCue | null)[] = new Array(8).fill(null);

  tempo = 0; // -1..1 (fader)
  range = 0.08;
  bendDir = 0;
  jogBend = 0;
  private lastTurnT = 0;
  keylock = false;
  keyShift = 0;
  pitchPlay = 0;

  sync = false;
  isMaster = false;
  syncRate = 1;
  phaseCorr = 1;
  quantize = true;
  slip = false;
  vinyl = true;
  reverse = false;

  loop = { active: false, start: 0, end: 0, roll: false };
  loopBeats = 4;
  jumpBeats = 4;
  private loopIn: number | null = null;
  padMode: PadMode = 'hotcue';

  turntable = false;
  motorStart = 0.35;
  motorBrake = 0.6;
  rpm45 = false;
  wear = 0;
  jogScale = 1;
  stems: StemLevels = { vocal: 1, drums: 1, bass: 1, melody: 1 };

  // gesture state
  jogTouched = false;
  jogZone: 'top' | 'ring' | null = null;
  scratching = false;
  recordAngle = 0;
  platterAngle = 0;
  private cueHeld = false;
  private cuePreview = false;
  private playLatched = false;
  private hotHeld = -1;
  private rollPad = -1;
  private slicePad = -1;
  private sliceDomain = 0;
  private padsDown = new Set<number>();
  private sentRate = -1;

  constructor(
    private ctx: AudioContext,
    readonly id: DeckId,
    wasmBytes: ArrayBuffer | null,
    private host: DeckHost,
  ) {
    super();
    this.node = new AudioWorkletNode(ctx, 'deck-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasm: wasmBytes },
    });
    this.node.port.onmessage = (e) => this.onMessage(e.data);
    this.post({ type: 'motor', start: 0, brake: 0 });
  }

  private post(msg: Record<string, unknown>, transfer?: Transferable[]): void {
    this.node.port.postMessage(msg, transfer ?? []);
  }

  private onMessage(m: { type: string; [k: string]: unknown }): void {
    if (m.type === 'pos') {
      this.rPos = (m.pos as number) / this.srcRate;
      this.rSlip = (m.slip as number) / this.srcRate;
      this.rV = ((m.v as number) * this.ctx.sampleRate) / this.srcRate;
      this.rT = m.t as number;
      this.platter = m.platter as number;
      this.stretchActive = !!m.stretch;
    } else if (m.type === 'ended') {
      this.playing = false;
      this.emit('ended', this);
      this.emit('change', this);
    } else if (m.type === 'ready') {
      this.wasm = !!m.wasm;
      this.latency = (m.latency as number) / this.ctx.sampleRate;
    }
  }

  /* ------------------------------------------------------------------ */
  /* derived values                                                       */
  /* ------------------------------------------------------------------ */

  get loaded(): boolean {
    return !!this.track && this.duration > 0;
  }

  get tempoRate(): number {
    if (this.sync && !this.isMaster && this.syncRate > 0) return this.syncRate;
    return 1 + this.tempo * this.range;
  }

  /** speed without momentary bend/phase correction */
  get baseRate(): number {
    return this.tempoRate * (this.rpm45 ? 1.35 : 1);
  }

  get rate(): number {
    const bend = this.bendDir * 0.04 + this.jogBend;
    return Math.max(0, this.baseRate * (1 + bend) * this.phaseCorr);
  }

  get bpm(): number {
    return this.analysis ? this.analysis.bpm * this.baseRate : 0;
  }

  get beatLen(): number {
    return this.analysis && this.analysis.bpm > 0 ? 60 / this.analysis.bpm : 0.5;
  }

  get tempoPercent(): number {
    return (this.tempoRate - 1) * 100;
  }

  /** Current playhead in track seconds (interpolated between audio-thread reports). */
  position(): number {
    const dt = Math.max(0, Math.min(0.1, this.ctx.currentTime - this.rT));
    return clamp(wrapInLoop(this.rPos, this.rPos + dt * this.rV, this.loop, this.rV > 0), 0, this.duration);
  }

  /** Position of what is currently audible (compensates processing latency). */
  displayPosition(): number {
    return clamp(this.position() - this.latency * Math.abs(this.rV), 0, this.duration);
  }

  slipPosition(): number {
    const dt = Math.max(0, Math.min(0.1, this.ctx.currentTime - this.rT));
    return clamp(this.rSlip + dt * this.platter, 0, this.duration);
  }

  get velocity(): number {
    return this.rV;
  }

  beatPosition(t = this.position()): number {
    if (!this.analysis) return 0;
    return (t - this.analysis.firstBeat) / this.beatLen;
  }

  /** Fractional beat phase 0..1 at the audible position */
  beatPhase(): number {
    return mod(this.beatPosition(this.displayPosition()), 1);
  }

  snapToBeat(t: number, sub = 1): number {
    if (!this.analysis) return t;
    const len = this.beatLen * sub;
    return this.analysis.firstBeat + Math.round((t - this.analysis.firstBeat) / len) * len;
  }

  private floorToGrid(t: number, len: number): number {
    if (!this.analysis) return t;
    return this.analysis.firstBeat + Math.floor((t - this.analysis.firstBeat) / len + 1e-6) * len;
  }

  currentKey(): KeyInfo | null {
    const k = this.analysis?.key;
    if (!k) return null;
    let semis = this.keyShift + this.pitchPlay;
    if (!this.keylock) semis += 12 * Math.log2(Math.max(0.01, this.baseRate));
    return Math.abs(semis) < 0.5 ? k : shiftKey(k, semis);
  }

  get remaining(): number {
    return Math.max(0, this.duration - this.position());
  }

  /* ------------------------------------------------------------------ */
  /* loading                                                              */
  /* ------------------------------------------------------------------ */

  load(track: LibraryTrack, pcm: PcmData, analysis: TrackAnalysis): void {
    if (this.playing) this.pause(true);
    const left = pcm.channels[0].slice();
    const right = (pcm.channels[1] ?? pcm.channels[0]).slice();
    this.srcRate = pcm.sampleRate;
    this.duration = left.length / pcm.sampleRate;
    this.track = track;
    this.analysis = analysis;
    this.hotCues = Array.from({ length: 8 }, (_, i) => track.cues.hot[i] ?? null);
    this.cuePoint = track.cues.cue ?? Math.max(0, analysis.firstBeat);
    this.loop = { active: false, start: 0, end: 0, roll: false };
    this.loopIn = null;
    this.pitchPlay = 0;
    this.reverse = false;
    this.post({ type: 'reverse', on: false });
    this.post({ type: 'semis', value: this.keyShift });
    this.post({ type: 'load', left, right, sampleRate: pcm.sampleRate, pos: this.cuePoint * pcm.sampleRate }, [
      left.buffer,
      right.buffer,
    ]);
    this.rPos = this.cuePoint;
    this.rSlip = this.cuePoint;
    this.rV = 0;
    this.rT = this.ctx.currentTime;
    this.emit('loaded', this);
    this.emit('change', this);
  }

  eject(): void {
    if (this.playing) return; // like hardware: can't eject while playing
    this.post({ type: 'unload' });
    this.track = null;
    this.analysis = null;
    this.duration = 0;
    this.rPos = 0;
    this.emit('change', this);
  }

  /* ------------------------------------------------------------------ */
  /* transport                                                            */
  /* ------------------------------------------------------------------ */

  play(): void {
    if (!this.loaded) return;
    this.playing = true;
    this.post({ type: 'play' });
    if (this.sync) this.host.snapPhase(this);
    this.emit('change', this);
  }

  pause(instant = false): void {
    this.playing = false;
    this.post({ type: 'pause', instant: instant || !this.turntable });
    this.emit('change', this);
  }

  togglePlay(): void {
    if (this.cuePreview) {
      this.playLatched = true;
      return;
    }
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number, keepSlip = false): void {
    if (!this.loaded) return;
    t = clamp(t, 0, Math.max(0, this.duration - 0.01));
    this.post({ type: 'seek', pos: t * this.srcRate, slip: keepSlip });
    this.rPos = t;
    if (!keepSlip) this.rSlip = t;
    this.rT = this.ctx.currentTime;
  }

  /** Jump that keeps the beat phase when quantize is on and the deck is playing. */
  jumpTo(target: number, keepSlip = false): void {
    if (this.quantize && this.playing && this.analysis) {
      const bl = this.beatLen;
      const p = this.position();
      let d = mod(p - this.analysis.firstBeat, bl) - mod(target - this.analysis.firstBeat, bl);
      if (d > bl / 2) d -= bl;
      if (d < -bl / 2) d += bl;
      target += d;
    }
    this.seek(target, keepSlip);
  }

  cueDown(): void {
    if (!this.loaded) return;
    this.cueHeld = true;
    if (this.playing && !this.cuePreview) {
      this.seek(this.cuePoint);
      this.pause(true);
      return;
    }
    const p = this.position();
    if (Math.abs(p - this.cuePoint) > 0.02) {
      this.cuePoint = this.quantize ? Math.max(0, this.snapToBeat(p)) : p;
      this.seek(this.cuePoint);
      this.saveCues();
    }
    this.cuePreview = true;
    this.playLatched = false;
    this.play();
  }

  cueUp(): void {
    this.cueHeld = false;
    if (!this.cuePreview) return;
    this.cuePreview = false;
    if (this.playLatched) {
      this.playLatched = false;
      return;
    }
    this.pause(true);
    this.seek(this.cuePoint);
  }

  get cueLit(): boolean {
    if (!this.loaded) return false;
    if (this.cueHeld) return true;
    if (!this.playing) return Math.abs(this.position() - this.cuePoint) < 0.03 || Math.floor(performance.now() / 400) % 2 === 0;
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* hot cues                                                             */
  /* ------------------------------------------------------------------ */

  setHotCue(i: number, pos = this.position()): void {
    if (!this.loaded) return;
    const p = this.quantize && this.analysis ? Math.max(0, this.snapToBeat(pos)) : pos;
    this.hotCues[i] = { pos: p, color: this.hotCues[i]?.color ?? HOTCUE_COLORS[i % 8], name: this.hotCues[i]?.name ?? '' };
    this.saveCues();
  }

  deleteHotCue(i: number): void {
    this.hotCues[i] = null;
    this.saveCues();
  }

  updateHotCue(i: number, patch: Partial<HotCue>): void {
    const c = this.hotCues[i];
    if (!c) return;
    this.hotCues[i] = { ...c, ...patch };
    this.saveCues();
  }

  private hotDown(i: number): void {
    if (!this.loaded) return;
    if (this.host.isShift()) {
      this.deleteHotCue(i);
      return;
    }
    const c = this.hotCues[i];
    if (!c) {
      this.setHotCue(i);
      return;
    }
    if (this.playing) {
      this.hotHeld = i;
      if (this.slip) this.post({ type: 'forcedSlip', on: true });
      this.jumpTo(c.pos, this.slip);
    } else {
      this.seek(c.pos);
      this.play();
    }
  }

  private hotUp(i: number): void {
    if (this.hotHeld !== i) return;
    this.hotHeld = -1;
    if (this.slip) this.post({ type: 'forcedSlip', on: false });
  }

  saveCues(): void {
    if (!this.track) return;
    this.track.cues = { cue: this.cuePoint, hot: this.hotCues.map((c) => (c ? { ...c } : null)) };
    this.emit('cues', this);
  }

  /* ------------------------------------------------------------------ */
  /* loops                                                                */
  /* ------------------------------------------------------------------ */

  private sendLoop(jumpToStart = false, forcedSlip = false): void {
    this.post({
      type: 'loop',
      on: this.loop.active,
      start: this.loop.start * this.srcRate,
      end: this.loop.end * this.srcRate,
      forcedSlip,
      jumpToStart,
    });
    this.emit('change', this);
  }

  setBeatLoop(beats: number, roll = false): void {
    if (!this.loaded) return;
    const len = beats * this.beatLen;
    // on the beat you're on (rolls: inside their own length), so the music carries on into the loop
    const s = autoLoopStart(this.position(), this.grid(), this.quantize, beats);
    this.loop = { active: true, start: Math.max(0, s), end: Math.max(0, s) + len, roll };
    if (!roll) this.loopBeats = beats;
    this.sendLoop(false, roll);
  }

  /** auto loop of the size on the loop-size knob (its push), or out of the loop */
  autoLoop(): void {
    if (this.loop.active && !this.loop.roll) this.exitLoop();
    else this.setBeatLoop(this.loopBeats);
  }

  /** the "4 BEAT" button: always four beats (the size knob doesn't change it), or out of the loop */
  fourBeatLoop(): void {
    if (this.loop.active && !this.loop.roll) this.exitLoop();
    else {
      const size = this.loopBeats;
      this.setBeatLoop(4);
      this.loopBeats = size;
    }
  }

  exitLoop(): void {
    if (!this.loop.active) return;
    this.loop.active = false;
    this.loop.roll = false;
    // the loop's points stay for RELOOP; a half-made one (IN pressed, no OUT) doesn't
    this.loopIn = null;
    this.sendLoop(false, false);
  }

  /** RELOOP / EXIT: leave the loop, or go back into the last one (in time, with quantize) */
  reloop(): void {
    if (this.loop.active) {
      this.exitLoop();
      return;
    }
    if (this.loop.end > this.loop.start) {
      this.loop.active = true;
      this.loopIn = null;
      if (this.quantize && this.playing && this.analysis) {
        this.sendLoop(false, false);
        this.jumpTo(this.loop.start);
      } else this.sendLoop(true, false);
    }
  }

  /** an IN point is waiting for OUT (the IN button blinks) */
  get loopPending(): boolean {
    return this.loopIn !== null && !this.loop.active;
  }

  private grid(): Grid | null {
    return this.analysis ? { firstBeat: this.analysis.firstBeat, beatLen: this.beatLen } : null;
  }

  /** LOOP IN: set where the loop starts; during a loop, move its start here */
  loopInPress(): void {
    if (!this.loaded) return;
    const at = loopInPoint(this.position(), this.grid(), this.quantize);
    if (this.loop.active && !this.loop.roll) {
      // IN adjust: keep a whole number of beats with quantize
      const close = closeLoop(at, this.loop.end, this.grid(), this.quantize);
      if (close) {
        this.loop.start = close.start;
        this.loop.end = close.end;
        this.sendLoop(false, false);
      }
      return;
    }
    this.loopIn = at;
    this.emit('change', this);
  }

  /** IN held down: a 4-beat loop from the IN point (club players do this) */
  loopInHold(): void {
    if (!this.loaded || this.loop.active || this.loopIn === null) return;
    const start = this.loopIn;
    this.loopIn = null;
    this.loop = { active: true, start, end: start + 4 * this.beatLen, roll: false };
    this.sendLoop(false, false);
  }

  /** LOOP OUT: close the loop from IN to here; on its own, a loop of the current size from here; during a loop, leave it */
  loopOutPress(): void {
    if (!this.loaded) return;
    if (this.loop.active && !this.loop.roll) {
      this.exitLoop();
      return;
    }
    const close = closeLoop(this.loopIn, this.position(), this.grid(), this.quantize);
    this.loopIn = null;
    if (!close) {
      this.setBeatLoop(this.loopBeats);
      return;
    }
    // (the auto loop keeps its own size: "4 BEAT" stays four beats after a manual loop)
    this.loop = { active: true, start: close.start, end: close.end, roll: false };
    this.sendLoop(false, false);
  }

  resizeLoop(dir: 1 | -1): void {
    // halve or double the loop that's playing (a manual one may be any length), or the size the next auto loop gets
    const manual = this.loop.active && !this.loop.roll;
    const cur = manual ? (this.loop.end - this.loop.start) / this.beatLen : this.loopBeats;
    const i = LOOP_SIZES.findIndex((b) => Math.abs(b - cur) < 1e-3);
    let idx = i >= 0 ? i + dir : LOOP_SIZES.findIndex((b) => b >= cur);
    idx = clamp(idx, 0, LOOP_SIZES.length - 1);
    const beats = i >= 0 ? LOOP_SIZES[idx] : dir > 0 ? cur * 2 : cur / 2;
    this.loopBeats = clamp(beats, 1 / 64, 64);
    if (this.loop.active && !this.loop.roll) {
      this.loop.end = this.loop.start + this.loopBeats * this.beatLen;
      this.sendLoop(false, false);
    }
    this.emit('change', this);
  }

  beatJump(beats: number): void {
    if (!this.loaded || !this.analysis) return;
    const d = beats * this.beatLen;
    if (this.loop.active && !this.loop.roll) {
      this.loop.start += d;
      this.loop.end += d;
      this.sendLoop(false, false);
    }
    this.seek(this.position() + d);
  }

  resizeJump(dir: 1 | -1): void {
    this.jumpBeats = clamp(dir > 0 ? this.jumpBeats * 2 : this.jumpBeats / 2, 0.5, 64);
    this.emit('change', this);
  }

  /* ------------------------------------------------------------------ */
  /* performance pads                                                     */
  /* ------------------------------------------------------------------ */

  setPadMode(m: PadMode): void {
    this.padMode = m;
    if (m !== 'pitch' && this.pitchPlay !== 0) {
      this.pitchPlay = 0;
      this.post({ type: 'semis', value: this.keyShift });
    }
    this.emit('change', this);
  }

  padDown(i: number): void {
    this.padsDown.add(i);
    switch (this.padMode) {
      case 'hotcue':
        this.hotDown(i);
        break;
      case 'roll':
        if (!this.playing) return;
        this.rollPad = i;
        this.setBeatLoop(ROLL_BEATS[i], true);
        break;
      case 'slicer': {
        if (!this.playing || !this.analysis) return;
        const bl = this.beatLen;
        this.sliceDomain = this.floorToGrid(this.slipPosition(), bl * 8);
        const s = this.sliceDomain + i * bl;
        this.slicePad = i;
        this.loop = { active: true, start: s, end: s + bl, roll: true };
        this.sendLoop(true, true);
        break;
      }
      case 'jump':
        this.beatJump(JUMP_PADS[i] * (this.jumpBeats / 4 >= 1 ? this.jumpBeats / 4 : 1));
        break;
      case 'pitch': {
        this.pitchPlay = PITCH_PADS[i];
        this.post({ type: 'semis', value: this.keyShift + this.pitchPlay });
        const base = this.hotCues.find((c) => c)?.pos ?? this.cuePoint;
        if (this.playing) this.jumpTo(base);
        else {
          this.seek(base);
          this.play();
        }
        break;
      }
      case 'sampler':
        this.host.samplerPad(i, true);
        break;
    }
    this.emit('change', this);
  }

  padUp(i: number): void {
    this.padsDown.delete(i);
    switch (this.padMode) {
      case 'hotcue':
        this.hotUp(i);
        break;
      case 'roll':
        if (this.rollPad === i) {
          this.rollPad = -1;
          this.exitLoop();
        }
        break;
      case 'slicer':
        if (this.slicePad === i) {
          this.slicePad = -1;
          this.exitLoop();
        }
        break;
      case 'sampler':
        this.host.samplerPad(i, false);
        break;
      default:
        break;
    }
    this.emit('change', this);
  }

  /** LED colour for a performance pad (false = unlit). */
  padLit(i: number): { color: string; level: number } | false {
    const down = this.padsDown.has(i);
    switch (this.padMode) {
      case 'hotcue': {
        const c = this.hotCues[i];
        if (!c) return down ? { color: '#ffffff', level: 0.6 } : false;
        return { color: c.color, level: down || this.hotHeld === i ? 1 : 0.55 };
      }
      case 'roll':
        return { color: '#2ec4f1', level: this.rollPad === i ? 1 : 0.18 };
      case 'slicer': {
        if (!this.analysis) return false;
        const cur = Math.floor((this.slipPosition() - this.floorToGrid(this.slipPosition(), this.beatLen * 8)) / this.beatLen);
        return { color: '#b36bff', level: this.slicePad === i ? 1 : cur === i ? 0.7 : 0.15 };
      }
      case 'jump':
        return { color: JUMP_PADS[i] < 0 ? '#ff9f1c' : '#3ddc97', level: down ? 1 : 0.3 };
      case 'pitch':
        return { color: PITCH_PADS[i] === 0 ? '#ffffff' : '#ff5fcf', level: this.pitchPlay === PITCH_PADS[i] ? 1 : 0.2 };
      case 'sampler': {
        const c = this.host.samplerLit(i);
        return c ? { color: c, level: down ? 1 : 0.8 } : { color: '#ffd23f', level: 0.15 };
      }
    }
  }

  padLabel(i: number): string {
    switch (this.padMode) {
      case 'hotcue':
        return this.hotCues[i]?.name || String.fromCharCode(65 + i);
      case 'roll':
        return beatLabel(ROLL_BEATS[i]);
      case 'slicer':
        return String(i + 1);
      case 'jump': {
        const n = JUMP_PADS[i] * (this.jumpBeats / 4 >= 1 ? this.jumpBeats / 4 : 1);
        return `${n > 0 ? '+' : ''}${n}`;
      }
      case 'pitch':
        return `${PITCH_PADS[i] > 0 ? '+' : ''}${PITCH_PADS[i]}`;
      case 'sampler':
        return `S${i + 1}`;
    }
  }

  /* ------------------------------------------------------------------ */
  /* tempo, key, modes                                                    */
  /* ------------------------------------------------------------------ */

  /** Tempo fader. While a follower is synced its tempo is locked to the master. */
  setTempo(t: number): void {
    if (this.sync && !this.isMaster && this.syncRate > 0) return;
    this.tempo = clamp(t, -1, 1);
    if (Math.abs(this.tempo) < 0.004) this.tempo = 0;
  }

  /** Fader position (−1..1) that corresponds to the current tempo, for display. */
  get tempoFader(): number {
    return clamp((this.tempoRate - 1) / this.range, -1, 1);
  }

  cycleRange(): void {
    this.setRange(TEMPO_RANGES[(TEMPO_RANGES.indexOf(this.range) + 1) % TEMPO_RANGES.length]);
  }

  setRange(range: number): void {
    if (range === this.range) return;
    const rate = this.tempoRate;
    this.range = range;
    this.tempo = clamp((rate - 1) / this.range, -1, 1); // keep the current speed where possible
    this.emit('change', this);
  }

  setKeylock(on: boolean): void {
    this.keylock = on;
    this.post({ type: 'keylock', on });
    this.emit('change', this);
  }

  setKeyShift(semis: number): void {
    this.keyShift = clamp(Math.round(semis), -12, 12);
    this.post({ type: 'semis', value: this.keyShift + this.pitchPlay });
    this.emit('change', this);
  }

  setSlip(on: boolean): void {
    this.slip = on;
    this.post({ type: 'slip', on });
    this.emit('change', this);
  }

  setReverse(on: boolean): void {
    this.reverse = on;
    this.post({ type: 'reverse', on });
    this.emit('change', this);
  }

  setSync(on: boolean): void {
    this.sync = on;
    if (on) this.host.snapPhase(this);
    this.emit('change', this);
  }

  setTurntable(on: boolean): void {
    this.turntable = on;
    this.applyMotor();
  }

  applyMotor(): void {
    this.post({ type: 'motor', start: this.turntable ? this.motorStart : 0, brake: this.turntable ? this.motorBrake : 0 });
  }

  setWear(v: number): void {
    this.wear = clamp(v, 0, 1);
    this.post({ type: 'wear', value: this.wear });
  }

  setStems(patch: Partial<StemLevels>): void {
    this.stems = { ...this.stems, ...patch };
    this.post({ type: 'stems', ...this.stems });
  }

  /* ------------------------------------------------------------------ */
  /* jog wheel                                                            */
  /* ------------------------------------------------------------------ */

  jogTouch(zone: 'top' | 'ring' | null): void {
    this.jogTouched = zone !== null;
    this.jogZone = zone;
    if (zone === 'top' && this.loaded && (this.vinyl || !this.playing)) {
      this.scratching = true;
      this.post({ type: 'scratch', on: true });
    } else if (zone === null && this.scratching) {
      this.scratching = false;
      this.post({ type: 'scratch', on: false });
    }
  }

  jogTurn(revs: number): void {
    if (!this.loaded) return;
    if (this.scratching) {
      this.recordAngle -= revs * Math.PI * 2;
      this.post({ type: 'scratchDelta', value: revs * SECONDS_PER_REV * this.jogScale * this.srcRate });
      return;
    }
    if (this.playing) {
      const now = performance.now();
      const dt = Math.max(0.008, Math.min(0.1, (now - this.lastTurnT) / 1000));
      this.lastTurnT = now;
      const target = clamp((revs / dt) * 0.22, -0.6, 0.6);
      this.jogBend += (target - this.jogBend) * 0.6;
    } else {
      this.recordAngle -= revs * Math.PI * 2;
      this.seek(this.position() + revs * SECONDS_PER_REV * this.jogScale * 0.5);
    }
  }

  /* ------------------------------------------------------------------ */
  /* per-frame update                                                     */
  /* ------------------------------------------------------------------ */

  update(dt: number): void {
    // jog pitch bend decays once the hand stops moving
    if (performance.now() - this.lastTurnT > 40) this.jogBend *= Math.exp(-dt * 12);
    if (Math.abs(this.jogBend) < 1e-4) this.jogBend = 0;

    const r = this.rate;
    if (Math.abs(r - this.sentRate) > 1e-6) {
      this.sentRate = r;
      this.post({ type: 'rate', value: r });
    }

    const revPerSec = 1 / SECONDS_PER_REV;
    this.platterAngle -= this.platter * (this.rpm45 ? 1.35 : 1) * revPerSec * dt * Math.PI * 2;
    if (!this.scratching) this.recordAngle -= this.rV * revPerSec * dt * Math.PI * 2;
    this.platterAngle = mod(this.platterAngle, Math.PI * 2);
    this.recordAngle = mod(this.recordAngle, Math.PI * 2);
  }
}
