/*
 * Up next, everywhere: the next-track coach running all the time, not just in
 * a gig. Every couple of seconds (and as soon as a deck loads or the library
 * changes) it ranks the crate on show, or the whole library, against what's
 * playing. The stage card, the Library's "Up next" strip, an empty deck's
 * hint and the gig HUD all read the same picks.
 *   – outside a gig the energy it wants is a step above what's on (a warm-up
 *     opener when nothing is); a gig hands it its slot's energy instead
 *   – a track counts as heard once the room has heard it; heard tracks and
 *     ones on the decks are never suggested
 *   – "another" skips the top pick until what's playing changes
 */
import type { AudioEngine } from '../audio/AudioEngine';
import { Emitter } from '../core/emitter';
import type { LibraryTrack } from '../core/types';
import { freeWant, rankNext, type Suggestion } from '../game/coach';
import { trackInfo } from '../game/tracks';
import type { Library } from '../library/Library';
import { genreOf } from '../library/genres';

export interface NextUpHost {
  engine: AudioEngine;
  library: Library;
  /** the crate on show in the Library (null: the whole collection) */
  currentCrate(): string | null;
  loadTrack(deck: number, id: string): Promise<void>;
  /** the deck shown on each side */
  sideDeck(side: 'L' | 'R'): number;
}

/** what a gig tells the coach: its slot's energy, what the room's heard tonight */
export interface GigCoach {
  want: number;
  heard: Set<string>;
}

export class NextUp {
  readonly events = new Emitter<{ changed: void }>();
  /** set by a gig while it runs */
  gig: GigCoach | null = null;
  private picks: Suggestion[] = [];
  private heard = new Set<string>();
  private skipped = new Set<string>();
  private energy = new Map<string, number>();
  private t = 0;
  private at = -1e9;
  private dirty = true;
  private lead: string | null = null;
  private sig = '';

  constructor(private host: NextUpHost) {
    host.library.on('changed', () => this.touch());
    host.library.on('track', () => this.touch());
    for (const d of host.engine.decks) d.on('loaded', () => this.touch());
  }

  /** recompute on the next frame */
  touch(): void {
    this.dirty = true;
  }

  /** the picks, best first (up to three) */
  list(): Suggestion[] {
    return this.picks;
  }

  top(): Suggestion | null {
    return this.picks[0] ?? null;
  }

  /** the deck a suggestion loads onto: one of the two on show that isn't playing, an empty one first */
  freeDeck(): number | null {
    const e = this.host.engine;
    const ids = [this.host.sideDeck('L'), this.host.sideDeck('R')];
    const front = ids.map((id) => e.deck(id)).filter((d) => d && !d.playing);
    return (front.find((d) => !d.loaded) ?? front[0])?.id ?? null;
  }

  /** nothing playing and nothing loaded: the picks are openers */
  opening(): boolean {
    return !this.host.engine.decks.some((d) => d.loaded);
  }

  /** load a pick (the top one by default) on the free deck, or on `deck` */
  load(id?: string, deck?: number): boolean {
    const pick = id ?? this.top()?.id;
    const to = deck ?? this.freeDeck();
    if (!pick || to === null || to === undefined) return false;
    void this.host.loadTrack(to, pick);
    this.picks = this.picks.filter((p) => p.id !== pick);
    this.events.emit('changed', undefined);
    this.touch();
    return true;
  }

  /** skip the top pick: the next best moves up */
  another(): void {
    const top = this.top();
    if (!top) return;
    this.skipped.add(top.id);
    this.touch();
  }

  update(dt: number): void {
    this.t += dt;
    const e = this.host.engine;
    // the room has heard a track once it's been up on the faders
    e.decks.forEach((d, i) => {
      const ch = e.channels[i];
      if (d.playing && d.track && ch && ch.state.fader * ch.xfGain > 0.12) this.heard.add(d.track.id);
    });
    const leadDeck = e.masterDeck?.playing ? e.masterDeck : e.decks.find((d) => d.playing && d.loaded);
    const lead = leadDeck?.track?.id ?? null;
    if (lead !== this.lead) {
      // a new track out front: the skips were about the last one
      this.lead = lead;
      this.skipped.clear();
      this.dirty = true;
    }
    if (!this.dirty && this.t - this.at < 2) return;
    this.dirty = false;
    this.at = this.t;
    const crate = this.host.currentCrate();
    this.picks = this.rank(crate, 3, this.skipped);
    const sig = this.picks.map((p) => p.id + p.why).join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.events.emit('changed', undefined);
    }
  }

  /** the whole library ranked for right now, best first, leaving out what's heard and what's on the decks */
  candidates(n: number): Suggestion[] {
    return this.rank(null, n, new Set());
  }

  /** has the room heard it (tonight, in a gig) or is it on a deck */
  used(id: string): boolean {
    const heard = this.gig ? this.gig.heard : this.heard;
    return heard.has(id) || this.host.engine.decks.some((d) => d.track?.id === id);
  }

  private rank(crate: string | null, n: number, skip: Set<string>): Suggestion[] {
    const e = this.host.engine;
    const leadDeck = e.masterDeck?.playing ? e.masterDeck : e.decks.find((d) => d.playing && d.loaded);
    const lib = this.host.library;
    const ids = crate ? (lib.crate(crate)?.trackIds ?? []) : null;
    const pool = (ids ? ids.map((id) => lib.get(id)) : lib.list()).filter((t): t is LibraryTrack => !!t && !!t.analysis && t.status !== 'error');
    const onDecks = new Set(e.decks.map((d) => d.track?.id).filter((x): x is string => !!x));
    const heard = this.gig ? this.gig.heard : this.heard;
    const lt = leadDeck?.track ?? null;
    const leadEnergy = lt ? this.energyOf(lt) / 10 : null;
    const playing = leadDeck && lt ? { bpm: leadDeck.bpm, key: leadDeck.currentKey(), energy: leadEnergy ?? undefined, genre: genreOf(lt).genre || undefined } : null;
    return rankNext({
      playing,
      want: this.gig ? this.gig.want : freeWant(leadEnergy),
      tracks: pool.map((t) => ({ id: t.id, title: t.meta.title, artist: t.meta.artist, bpm: t.analysis!.bpm, key: t.analysis!.key, energy: this.energyOf(t), genre: genreOf(t).genre || undefined })),
      exclude: new Set([...heard, ...onDecks, ...skip]),
      n,
    });
  }

  private energyOf(t: LibraryTrack): number {
    const k = `${t.id}:${t.analysis ? 1 : 0}`;
    let v = this.energy.get(k);
    if (v === undefined) {
      v = trackInfo(t).energy;
      this.energy.set(k, v);
    }
    return v;
  }
}
