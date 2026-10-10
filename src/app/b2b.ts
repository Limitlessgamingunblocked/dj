/*
 * Back to back (Section 6.10): you and a rival take turns on decks 1 and 2.
 * You open; when your track has been going a while it's their turn, and
 * they pick an answer to it (rivals.ts: their taste, the key and tempo, how
 * they answer your energy) and mix it in themselves, Auto DJ style, in their
 * own time (MARLOWE takes 32 bars, KIKI VOLT slams it in over 8). Then it's
 * yours: load something and mix it in. How it lands with them (the key and
 * tempo against their track, whether it's their kind of thing, how clean the
 * mix was) moves the chemistry meter, and they say so. Grab the faders while
 * they're mixing and you've stepped on their transition.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { Deck } from '../audio/Deck';
import type { ControlRegistry } from '../core/controls';
import type { LibraryTrack } from '../core/types';
import { chemistryAfter, judgeTransition, rivalPick, RIVALS, TASTE, type B2BTrack, type RivalId } from '../game/rivals';
import { trackInfo } from '../game/tracks';
import type { VibeEvent } from '../game/vibe';
import { AutoDJ } from './autodj';

export interface B2BHooks {
  engine: AudioEngine;
  reg: ControlRegistry;
  tracks(): LibraryTrack[];
  loadTrack(deck: number, id: string): Promise<void>;
  /** a line in the HUD */
  say(who: string, text: string): void;
}

/** how clean a named transition was, 0..1 */
const BAND_CLEAN: Record<string, number> = { perfect: 1, good: 0.75, loose: 0.4, trainwreck: 0 };

export class B2B {
  chemistry = 0.5;
  turn: 'you' | 'rival' = 'you';
  readonly rival: RivalId;
  private auto: AutoDJ;
  private quiet = false;
  /** the deck and track the rival last brought in */
  private theirs: { deck: Deck; track: B2BTrack } | null = null;
  private played = new Set<string>();
  /** how clean your last mix was (from the vibe meter's transition calls) */
  private clean: number | null = null;
  private bigDrop = false;
  private yourSince = 0;
  private t = 0;
  /** chemistry over the set, for the results */
  readonly history: number[] = [];

  constructor(
    rival: RivalId,
    private hooks: B2BHooks,
  ) {
    this.rival = rival;
    this.auto = new AutoDJ(hooks.engine, hooks.reg, {
      loadTrack: (d, id) => hooks.loadTrack(d, id),
      nextFromSet: () => this.pick(),
      candidates: () => [],
      mixBars: () => TASTE[rival].mixBars,
      note: (kind, deck) => this.note(kind, deck),
    });
  }

  get name(): string {
    return RIVALS[this.rival].name;
  }

  private info(t: LibraryTrack | null | undefined): B2BTrack | null {
    if (!t?.analysis) return null;
    const i = trackInfo(t);
    return { id: t.id, bpm: t.analysis.bpm, key: t.analysis.key ?? null, energy: i.energy, tags: i.tags };
  }

  /** their answer to what's playing */
  private pick(): string | null {
    const cur = this.hooks.engine.decks.find((d) => d.playing && d.track);
    const now = this.info(cur?.track);
    if (!now) return null;
    const pool = this.hooks
      .tracks()
      .filter((t) => t.status === 'ready')
      .map((t) => this.info(t))
      .filter((x): x is B2BTrack => !!x);
    return rivalPick(this.rival, now, pool, this.played)?.id ?? null;
  }

  private note(kind: 'start' | 'done' | 'off' | 'empty', deck: Deck): void {
    if (this.quiet) return;
    if (kind === 'start') this.hooks.say(`${this.name}:`, this.rival === 'nox' ? '…' : 'Coming in.');
    if (kind === 'done') {
      // their track is in: your turn
      const tr = this.info(deck.track);
      if (tr) {
        this.theirs = { deck, track: tr };
        this.played.add(tr.id);
      }
      this.handOver();
    }
    if (kind === 'off') {
      // you grabbed the mix off them
      this.chemistry = chemistryAfter(this.chemistry, -0.06);
      this.hooks.say(`${this.name}:`, this.rival === 'nox' ? '…' : 'Oi! That was my mix.');
      this.turn = 'you';
      this.yourSince = this.t;
    }
    if (kind === 'empty') {
      this.turn = 'you';
      this.yourSince = this.t;
    }
  }

  private handOver(): void {
    this.quiet = true;
    this.auto.stop();
    this.quiet = false;
    this.turn = 'you';
    this.yourSince = this.t;
    this.clean = null;
    this.bigDrop = false;
    this.hooks.say(`${this.name}:`, 'Your turn.');
  }

  /** the vibe meter's calls while you mix: how clean it was, a big drop */
  onEvent(ev: VibeEvent): void {
    if (this.turn !== 'you') return;
    if (ev.kind === 'transition') this.clean = Math.max(this.clean ?? 0, BAND_CLEAN[ev.band] ?? 0.5);
    if (ev.kind === 'mistake' && ev.name === 'trainwreck') this.clean = 0;
    if (ev.kind === 'drop') this.bigDrop = true;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.turn === 'rival') {
      this.auto.update();
      return;
    }
    const decks = this.hooks.engine.decks.slice(0, 2);
    const playing = decks.filter((d) => d.playing && d.loaded);
    // you open the set: after a while on your first track, it's their go
    if (!this.theirs) {
      if (playing.length === 1 && this.t - this.yourSince > 45) this.toRival(playing[0]);
      return;
    }
    // your mix is done when their deck has stopped and one of yours is playing something new
    const yours = playing.find((d) => d !== this.theirs!.deck && d.track && d.track.id !== this.theirs!.track.id);
    if (yours && !this.theirs.deck.playing) {
      const mine = this.info(yours.track);
      if (mine) {
        const j = judgeTransition(this.rival, { from: this.theirs.track, to: mine, clean: this.clean ?? 0.45, bigDrop: this.bigDrop });
        this.chemistry = chemistryAfter(this.chemistry, j.delta);
        this.history.push(this.chemistry);
        if (j.line) this.hooks.say(`${this.name}:`, j.line);
        this.played.add(mine.id);
      }
      this.toRival(yours);
    }
  }

  private toRival(_yours: Deck): void {
    this.turn = 'rival';
    this.quiet = true;
    const ok = this.auto.start();
    this.quiet = false;
    if (!ok) this.turn = 'you';
  }

  stop(): void {
    this.quiet = true;
    this.auto.stop();
    this.quiet = false;
  }
}
