/*
 * AudioEngine: builds the complete Web Audio graph
 *
 *   Deck 1..4 (AudioWorklet + Wasm) → Channel 1..4 → Mixer (crossfader, master,
 *   limiter, cue/phones) → output
 *                               ↘ Beat FX (matrix) ↗
 *   Sampler → master bus
 *
 * and runs the master/follower sync with continuous phase lock.
 */
import { clamp, dbToGain } from '../core/util';
import { nextRedline } from './redline';
import { CrowdAudio } from './crowd';
import { Channel, gainToTrimKnob } from './Channel';
import { Deck, type DeckHost } from './Deck';
import { Mixer } from './Mixer';
import { BeatFX, type FxTarget } from './fx/BeatFX';
import { Sampler } from './Sampler';
import { MixRecorder } from './Recorder';
import { dspWasm, loadWorklets } from './worklets';
import type { DeckId } from '../core/types';

const mod = (a: number, n: number) => ((a % n) + n) % n;

export class AudioEngine {
  readonly decks: Deck[] = [];
  readonly channels: Channel[] = [];
  readonly mixer: Mixer;
  readonly fx: BeatFX;
  readonly sampler: Sampler;
  readonly recorder: MixRecorder;
  /** the crowd you hear, in the room */
  readonly crowd: CrowdAudio;
  /** analyser on the master output for the visual player */
  readonly visAnalyser: AnalyserNode;
  readonly wasmAvailable: boolean;

  explicitMaster: Deck | null = null;
  masterDeck: Deck | null = null;
  private autoMaster: Deck | null = null;
  private syncMult = new Map<Deck, number>();
  autoGain = true;
  deckCount = 2;
  isShift: () => boolean = () => false;

  static async create(): Promise<AudioEngine> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await loadWorklets(ctx);
    const wasm = await dspWasm();
    return new AudioEngine(ctx, wasm);
  }

  private constructor(
    readonly ctx: AudioContext,
    wasm: ArrayBuffer | null,
  ) {
    this.wasmAvailable = !!wasm;
    const host: DeckHost = {
      isShift: () => this.isShift(),
      samplerPad: (pad, down) => {
        if (down) this.sampler.trigger(pad);
        else if (this.sampler.slots[pad].mode === 'oneshot' && this.isShift()) this.sampler.stop(pad);
      },
      samplerLit: (pad) => (this.sampler.slots[pad].buffer ? (this.sampler.isPlaying(pad) ? '#ffffff' : this.sampler.slots[pad].color) : false),
      snapPhase: (deck) => this.snapPhase(deck),
    };
    for (let i = 0; i < 4; i++) {
      const ch = new Channel(ctx, i);
      ch.state.assign = i % 2 === 0 ? 'A' : 'B';
      this.channels.push(ch);
      const deck = new Deck(ctx, (i + 1) as DeckId, wasm, host);
      deck.node.connect(ch.input);
      deck.on('loaded', (d) => this.onLoaded(d));
      this.decks.push(deck);
    }
    this.mixer = new Mixer(ctx, this.channels);
    this.fx = new BeatFX(
      ctx,
      this.channels,
      this.mixer,
      {
        beatSeconds: (t) => this.fxBeatSeconds(t),
        nextBeatTime: (t) => this.nextBeatTime(this.fxDeck(t)),
      },
      wasm,
    );
    this.sampler = new Sampler(ctx, () => this.nextBeatTime(this.masterDeck));
    this.sampler.out.connect(this.mixer.masterBus);
    this.recorder = new MixRecorder(ctx, this.mixer.masterOut);
    this.crowd = new CrowdAudio(ctx, this.mixer.room.input);
    this.visAnalyser = ctx.createAnalyser();
    this.visAnalyser.fftSize = 4096;
    this.visAnalyser.smoothingTimeConstant = 0;
    this.mixer.masterOut.connect(this.visAnalyser);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* needs a user gesture */
      }
    }
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  deck(id: number): Deck {
    return this.decks[id - 1];
  }

  setDeckCount(n: number): void {
    this.deckCount = n;
    for (const d of this.decks) if (d.id > n && d.playing) d.pause(true);
  }

  private onLoaded(d: Deck): void {
    const a = d.analysis;
    if (!a) return;
    if (this.autoGain && isFinite(a.loudness)) {
      const trimDb = clamp(-10.5 - a.loudness, -12, 9);
      this.channels[d.id - 1].setTrim(gainToTrimKnob(dbToGain(trimDb)));
    }
  }

  setMaster(d: Deck): void {
    this.explicitMaster = this.explicitMaster === d ? null : d;
    this.updateSync();
  }

  /* ------------------------------------------------------------------ */
  /* sync                                                                 */
  /* ------------------------------------------------------------------ */

  private pickMaster(): Deck | null {
    const ex = this.explicitMaster;
    if (ex && ex.loaded && ex.analysis) return ex;
    const am = this.autoMaster;
    if (am && am.loaded && am.playing && am.analysis) return am;
    const playing = this.decks.find((d) => d.loaded && d.playing && d.analysis && !d.sync) ?? this.decks.find((d) => d.loaded && d.playing && d.analysis);
    this.autoMaster = playing ?? (am && am.loaded ? am : null);
    return this.autoMaster;
  }

  private phaseError(d: Deck, m: Deck): number {
    const mult = this.syncMult.get(d) ?? 1;
    const pf = mod(d.beatPosition(d.displayPosition()), 1);
    const pm = mod(m.beatPosition(m.displayPosition()) / mult, 1);
    let e = pf - pm;
    if (e > 0.5) e -= 1;
    if (e < -0.5) e += 1;
    return e;
  }

  updateSync(): void {
    const m = this.pickMaster();
    this.masterDeck = m;
    for (const d of this.decks) {
      d.isMaster = d === m;
      d.phaseCorr = 1;
      if (!d.sync || d === m || !m || !d.analysis || !m.analysis) continue;
      const base = d.analysis.bpm * (d.rpm45 ? 1.35 : 1);
      let best = 1;
      let bestMult = 1;
      let bestErr = Infinity;
      for (const mult of [0.5, 1, 2]) {
        const r = m.bpm / (base * mult);
        const e = Math.abs(Math.log(r));
        if (e < bestErr) {
          bestErr = e;
          best = r;
          bestMult = mult;
        }
      }
      d.syncRate = best;
      this.syncMult.set(d, bestMult);
      if (d.playing && m.playing && !d.jogTouched && !d.scratching && !d.loop.roll) {
        const err = this.phaseError(d, m);
        if (Math.abs(err) > 0.004) d.phaseCorr = 1 - clamp(err * 0.18, -0.025, 0.025);
      }
    }
  }

  /** Align a synced deck to the master's beat phase (on play / sync press). */
  snapPhase(d: Deck): void {
    this.updateSync();
    const m = this.masterDeck;
    if (!m || m === d || !d.sync || !m.playing || !d.analysis || !m.analysis) return;
    const err = this.phaseError(d, m);
    d.seek(d.position() - err * d.beatLen);
  }

  /** Relative beat offset of `d` against the master in beats (−0.5..0.5), for the phase meter. */
  phaseOffset(d: Deck): number | null {
    const m = this.masterDeck;
    if (!m || m === d || !d.analysis || !m.analysis || !d.loaded) return null;
    return this.phaseError(d, m);
  }

  nextBeatTime(d: Deck | null): number {
    const now = this.ctx.currentTime;
    if (!d || !d.playing || !d.analysis) return now;
    const phase = d.beatPhase();
    const rate = Math.max(0.05, d.rate);
    return now + ((1 - phase) * d.beatLen) / rate;
  }

  private fxDeck(t: Set<FxTarget>): Deck | null {
    if (!t.has('M')) {
      for (const x of t) if (x !== 'M') {
        const d = this.decks[x - 1];
        if (d.loaded && d.analysis) return d;
      }
    }
    return this.masterDeck;
  }

  private fxBeatSeconds(t: Set<FxTarget>): number {
    const d = this.fxDeck(t);
    if (!d || !d.analysis || d.bpm <= 0) return 0.5;
    return 60 / d.bpm;
  }

  /** Effective BPM of the sync master (or 0). */
  masterBpm(): number {
    return this.masterDeck?.bpm ?? 0;
  }

  /**
   * 0..1 how far the master is in the red (the limiter catching it): the mix
   * never clips, but redlining still shows on the meter and costs vibe.
   */
  redline = 0;

  update(dt: number): void {
    this.redline = nextRedline(this.redline, this.mixer.limiterReduction(), dt);
    this.updateSync();
    for (const d of this.decks) d.update(dt);
    this.fx.update();
  }
}
