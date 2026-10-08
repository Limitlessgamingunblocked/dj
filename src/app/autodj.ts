/*
 * Auto DJ: mixes on its own, the way you would on two decks.
 *   – the next track is the next one in your Set Builder set, or the best
 *     match in the library (a compatible key, a close tempo, not played this
 *     session); a track you load onto the free deck yourself wins
 *   – it's cued on its first downbeat, synced, with its bass cut
 *   – it starts on an 8-bar line of the outgoing track, the last one that
 *     leaves room for the whole mix before the end
 *   – over the mix (16 bars by default) the crossfader (or the channel faders,
 *     on mixers without one) moves across and the basses swap at the half
 *   – the outgoing deck stops, the incoming one keeps the tempo it was synced
 *     to, and the next track gets ready on the deck that just finished
 * Touch the crossfader, a fader or bass EQ of either deck, or play/pause, and
 * it hands the mix back to you.
 */
import { compatibility } from '../analysis/keys';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Deck } from '../audio/Deck';
import { TEMPO_RANGE_CHOICES as TEMPO_RANGES } from '../core/prefs';
import type { ControlRegistry } from '../core/controls';
import type { KeyInfo, LibraryTrack } from '../core/types';

/* ------------------------------------------------------------------ */
/* the decisions (pure, tested)                                         */
/* ------------------------------------------------------------------ */

export interface Candidate {
  id: string;
  bpm: number;
  key: KeyInfo | null;
}

/**
 * The best next track: a compatible key and a tempo within a few percent of the
 * one playing score highest; tracks more than 10 % away in tempo (allowing half /
 * double time) are left out unless nothing else is left. `rand` breaks ties.
 */
export function pickNext(cur: { bpm: number; key: KeyInfo | null }, pool: Candidate[], exclude: Set<string>, rand: () => number = Math.random): Candidate | null {
  const scored = pool
    .filter((c) => !exclude.has(c.id) && c.bpm > 0)
    .map((c) => {
      // tempo distance, allowing half and double time
      const d = Math.min(...[0.5, 1, 2].map((m) => Math.abs(Math.log((c.bpm * m) / Math.max(1, cur.bpm)))));
      const tempo = d < 0.025 ? 3 : d < 0.05 ? 2 : d < 0.1 ? 1 : -3;
      const k = compatibility(cur.key, c.key);
      const key = k === 'same' ? 3 : k === 'harmonic' ? 2.5 : k === 'boost' ? 1 : 0;
      return { c, score: tempo + key + rand() * 0.75 };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.c ?? null;
}

/**
 * Where the mix is at progress p (0..1): the crossfader's travel towards the
 * incoming deck (eased, so both are up through the middle), and the two bass
 * knobs swapping around the half (0.5 = flat, 0 = killed).
 */
export function mixCurves(p: number): { travel: number; inLow: number; outLow: number } {
  const q = Math.min(1, Math.max(0, p));
  const travel = q * q * (3 - 2 * q);
  const swap = Math.min(1, Math.max(0, (q - 0.42) / 0.16));
  return { travel, inLow: 0.5 * swap, outLow: 0.5 * (1 - swap) };
}

/**
 * Start now? Called when the outgoing deck crosses a phrase line (every
 * `phrase` beats). Yes if the next line would leave too little room for the
 * whole mix before the track ends.
 */
export function startHere(remainingBeats: number, mixBeats: number, phrase = 32): boolean {
  return remainingBeats - phrase < mixBeats + 4;
}

/* ------------------------------------------------------------------ */
/* the driver                                                           */
/* ------------------------------------------------------------------ */

export interface AutoDJHooks {
  loadTrack(deck: number, id: string): Promise<void>;
  /** the next track of the Set Builder set (advancing it), or null */
  nextFromSet(): string | null;
  candidates(): LibraryTrack[];
  mixBars(): number;
  /** a mix started / finished, or Auto DJ stopped itself (for toasts and the title card) */
  note(kind: 'start' | 'done' | 'off' | 'empty', deck: Deck, other?: Deck): void;
}

type Phase = 'waiting' | 'loading' | 'ready' | 'mixing';

export class AutoDJ {
  on = false;
  phase: Phase = 'waiting';
  /** the deck playing out front */
  main: Deck | null = null;
  private played = new Set<string>();
  private mix: { from: Deck; to: Deck; startBeat: number; beats: number; xfFrom: number; xfTo: number; useXf: boolean; inFader: number } | null = null;
  private lastBar = Number.NaN;
  /** don't try to load again before this (performance.now ms) after a failed load */
  private retryAt = 0;
  /** set while Auto DJ itself is moving things, so its own moves aren't taken as yours */
  private busy = false;

  constructor(
    private engine: AudioEngine,
    reg: ControlRegistry,
    private hooks: AutoDJHooks,
  ) {
    reg.on('activity', ({ id, source }) => {
      if (!this.on || this.busy || source === undefined) return;
      if (this.touches(id)) this.stop('off');
    });
  }

  /** the two decks it mixes between: 1 and 2 */
  private decks(): [Deck, Deck] {
    return [this.engine.deck(1), this.engine.deck(2)];
  }

  private other(d: Deck): Deck {
    const [a, b] = this.decks();
    return d === a ? b : a;
  }

  /** a control the DJ touched that means "I've got this" */
  private touches(id: string): boolean {
    if (id === 'mixer.xfader') return true;
    return /^ch\.[12]\.(fader|low)$/.test(id) || /^deck\.[12]\.(play|start)$/.test(id);
  }

  start(): boolean {
    const [a, b] = this.decks();
    this.on = true;
    this.mix = null;
    this.lastBar = Number.NaN;
    // whatever plays (or deck 1) is out front
    const main = a.playing ? a : b.playing ? b : a.loaded ? a : b.loaded ? b : null;
    if (!main) {
      this.on = false;
      return false;
    }
    this.main = main;
    this.busy = true;
    if (!main.playing) main.play();
    this.setXf(this.sideOf(main) === 'A' ? 0 : this.sideOf(main) === 'B' ? 1 : this.engine.mixer.xfader);
    this.busy = false;
    if (main.track) this.played.add(main.track.id);
    this.phase = 'waiting';
    return true;
  }

  stop(why: 'off' | 'empty' = 'off'): void {
    if (!this.on) return;
    this.on = false;
    this.phase = 'waiting';
    if (this.main) this.hooks.note(why, this.main);
    this.mix = null;
  }

  private sideOf(d: Deck): 'A' | 'B' | 'THRU' {
    return this.engine.channels[d.id - 1].state.assign;
  }

  private setXf(v: number): void {
    this.engine.mixer.setCrossfader(v);
  }

  /** seconds until the incoming track starts, for the status line (null when not known yet) */
  eta(): number | null {
    const m = this.main;
    if (!this.on || !m?.analysis || this.phase === 'mixing') return null;
    const beats = this.hooks.mixBars() * 4;
    const remBeats = m.remaining / m.beatLen;
    const pos = m.beatPosition();
    const next = Math.ceil((pos + 1e-6) / 32) * 32;
    // the last phrase line that leaves room for the mix
    let line = next;
    while (remBeats - (line - pos) - 32 >= beats + 4) line += 32;
    return ((line - pos) * m.beatLen) / Math.max(0.05, m.rate);
  }

  /** progress through the mix, 0..1, or null */
  progress(): number | null {
    const x = this.mix;
    if (!x || !x.to.analysis) return null;
    return Math.min(1, Math.max(0, (x.to.beatPosition() - x.startBeat) / x.beats));
  }

  next(): Deck | null {
    return this.main ? this.other(this.main) : null;
  }

  update(): void {
    if (!this.on) return;
    const main = this.main;
    if (!main || !main.loaded) return this.stop('empty');
    if (this.phase === 'mixing') return this.updateMix();
    const inc = this.other(main);
    // the outgoing track ran out before a mix could start
    if (!main.playing && !inc.playing) return this.stop('empty');
    // you're playing both decks yourself: wait until one stops
    if (inc.playing) return;
    if (this.phase === 'waiting' && main.analysis && performance.now() >= this.retryAt) {
      const rem = main.remaining;
      const mixSec = this.hooks.mixBars() * 4 * main.beatLen;
      if (rem < mixSec + 45) void this.prepare(inc);
    }
    if (this.phase === 'ready' && main.analysis && inc.loaded && inc.analysis) {
      const pos = main.beatPosition();
      const bar = Math.floor(pos / 4);
      const crossed = bar !== this.lastBar && !Number.isNaN(this.lastBar);
      this.lastBar = bar;
      if (!crossed) return;
      const remBeats = main.remaining / main.beatLen;
      const beats = this.hooks.mixBars() * 4;
      // on an 8-bar line: the last one that leaves room for the whole mix
      if (((bar % 8) + 8) % 8 === 0 && startHere(remBeats, beats)) this.begin(main, inc, Math.max(16, Math.min(beats, Math.floor(remBeats - 4))));
      // too close to the end for that (switched on late): go now, with whatever room is left
      else if (remBeats < beats + 4 && remBeats > 12) this.begin(main, inc, Math.max(8, Math.floor(remBeats - 4)));
    }
  }

  /** get the next track onto the free deck: cued on its first downbeat, synced, bass cut */
  private async prepare(inc: Deck): Promise<void> {
    this.phase = 'loading';
    const main = this.main!;
    // a track you put there yourself (not one already played) is the next one
    let id = inc.track && !this.played.has(inc.track.id) && inc.track.id !== main.track?.id ? inc.track.id : null;
    if (!id) {
      id = this.hooks.nextFromSet();
      if (!id) {
        const pool = this.hooks
          .candidates()
          .filter((t) => t.status === 'ready' && t.analysis)
          .map((t) => ({ id: t.id, bpm: t.analysis!.bpm, key: t.analysis!.key ?? null }));
        const exclude = new Set([...this.played, main.track?.id ?? '']);
        id = pickNext({ bpm: main.bpm, key: main.currentKey() }, pool, exclude)?.id ?? null;
      }
      if (!id) {
        this.phase = 'waiting';
        return this.stop('empty');
      }
      if (inc.track?.id !== id) await this.hooks.loadTrack(inc.id, id);
      if (inc.track?.id !== id) {
        // it didn't load (a broken file, or the deck got busy): skip it and try again in a moment
        this.played.add(id);
        this.retryAt = performance.now() + 2000;
        if (this.phase === 'loading') this.phase = 'waiting';
        return;
      }
    }
    if (!this.on || this.main !== main || !inc.loaded || !inc.analysis || inc.playing) {
      if (this.on && this.phase === 'loading') this.phase = 'waiting';
      return;
    }
    this.busy = true;
    inc.seek(Math.max(0, inc.analysis.firstBeat));
    inc.setSync(true);
    const ch = this.engine.channels[inc.id - 1];
    ch.setEq('low', 0);
    this.busy = false;
    this.phase = 'ready';
    this.lastBar = Number.NaN;
  }

  private begin(from: Deck, to: Deck, beats: number): void {
    this.busy = true;
    const fs = this.sideOf(from);
    const ts = this.sideOf(to);
    const useXf = fs !== 'THRU' && ts !== 'THRU' && fs !== ts;
    const inCh = this.engine.channels[to.id - 1];
    const outCh = this.engine.channels[from.id - 1];
    const inFader = Math.max(0.6, outCh.state.fader);
    if (useXf) {
      // the incoming channel up to the same level, the crossfader still on the outgoing side
      this.setXf(fs === 'A' ? 0 : 1);
      inCh.setFader(inFader);
    } else inCh.setFader(0);
    to.play();
    this.busy = false;
    this.mix = { from, to, startBeat: to.beatPosition(), beats, xfFrom: fs === 'A' ? 0 : 1, xfTo: ts === 'A' ? 0 : 1, useXf, inFader };
    this.phase = 'mixing';
    this.hooks.note('start', from, to);
  }

  private updateMix(): void {
    const x = this.mix!;
    const p = this.progress() ?? 0;
    const c = mixCurves(p);
    this.busy = true;
    const inCh = this.engine.channels[x.to.id - 1];
    const outCh = this.engine.channels[x.from.id - 1];
    if (x.useXf) this.setXf(x.xfFrom + (x.xfTo - x.xfFrom) * c.travel);
    else {
      inCh.setFader(x.inFader * Math.min(1, c.travel * 1.6));
      outCh.setFader(x.inFader * Math.min(1, (1 - c.travel) * 1.6));
    }
    inCh.setEq('low', c.inLow);
    outCh.setEq('low', c.outLow);
    this.busy = false;
    if (p >= 1 || !x.from.playing) this.finish();
  }

  private finish(): void {
    const x = this.mix!;
    this.busy = true;
    if (x.from.playing) x.from.pause();
    const outCh = this.engine.channels[x.from.id - 1];
    outCh.setEq('low', 0.5);
    this.engine.channels[x.to.id - 1].setEq('low', 0.5);
    if (!x.useXf) outCh.setFader(x.inFader);
    // the incoming deck keeps the tempo it was synced to when it becomes the master
    adoptRate(x.to);
    this.busy = false;
    if (x.from.track) this.played.add(x.from.track.id);
    if (x.to.track) this.played.add(x.to.track.id);
    this.mix = null;
    this.main = x.to;
    this.phase = 'waiting';
    this.hooks.note('done', x.to, x.from);
  }
}

/** Put a synced deck's own tempo fader where its synced speed is, so nothing jumps when it leads. */
export function adoptRate(d: Pick<Deck, 'tempoRate' | 'range' | 'setRange'> & { tempo: number }): void {
  const r = d.tempoRate;
  const need = Math.abs(r - 1);
  if (need > d.range) d.setRange(TEMPO_RANGES.find((x) => x >= need) ?? 1);
  d.tempo = Math.max(-1, Math.min(1, (r - 1) / d.range));
}
