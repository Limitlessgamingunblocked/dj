/*
 * The bedroom tutorial (Section 5.2): your first mix, one step at a time,
 * each step ticked off by what you actually do on the decks. Finishing it
 * opens the Basement Club. Short, casual copy (Section 2.6).
 */
import type { DeckSnap } from './vibe';

export interface TutorialInput {
  decks: DeckSnap[];
  /** sync on, per deck */
  sync: boolean[];
  /** Pro: no sync, so the tempo step is by ear */
  pro: boolean;
}

export interface TutorialStep {
  id: string;
  text: string;
  hint: string;
  /** `from`: each deck's track when the tutorial began (so a preloaded deck doesn't count as loading) */
  done(i: TutorialInput, from: readonly (string | null | undefined)[]): boolean;
}

const tempoClose = (a: DeckSnap, b: DeckSnap) => {
  let r = a.bpm / Math.max(1, b.bpm);
  if (r > 1.5) r /= 2;
  else if (r < 0.75) r *= 2;
  return Math.abs(r - 1) < 0.004;
};

export const TUTORIAL: TutorialStep[] = [
  { id: 'play1', text: 'Press play on deck 1.', hint: 'The ▶ button on the left deck, or the big play button on the controller.', done: (i) => !!i.decks[0]?.playing && i.decks[0].audible > 0.3 },
  { id: 'load2', text: 'Load another track on deck 2.', hint: 'In the crate, press 2 on a track’s row (or drag it onto the right deck).', done: (i, from) => !!i.decks[1]?.trackId && i.decks[1].trackId !== from[1] && i.decks[1].trackId !== i.decks[0]?.trackId },
  {
    id: 'tempo',
    text: 'Match deck 2’s tempo to deck 1.',
    hint: 'Hit SYNC on deck 2. (In Pro, ride deck 2’s pitch fader until the BPMs match.)',
    done: (i) => (i.pro ? !!i.decks[0] && !!i.decks[1] && tempoClose(i.decks[0], i.decks[1]) : !!i.sync[1]),
  },
  { id: 'prep', text: 'Pull deck 2’s fader down and turn its LOW knob all the way down.', hint: 'Channel 2 on the mixer: the fader at the bottom, the LOW knob above it.', done: (i) => !!i.decks[1] && i.decks[1].audible < 0.15 && i.decks[1].low < 0.15 },
  { id: 'start2', text: 'Start deck 2 on a new phrase.', hint: 'Wait for a big change in deck 1, then press play on deck 2.', done: (i) => !!i.decks[1]?.playing },
  { id: 'fadein', text: 'Slide deck 2’s fader up.', hint: 'Its bass is still off, so the kicks won’t fight.', done: (i) => !!i.decks[1] && i.decks[1].playing && i.decks[1].audible > 0.6 },
  { id: 'swap', text: 'Swap the bass: deck 2’s LOW up, deck 1’s LOW down.', hint: 'Do both together, on a phrase. That’s a bass swap.', done: (i) => !!i.decks[0] && !!i.decks[1] && i.decks[1].low > 0.4 && i.decks[0].low < 0.15 },
  { id: 'fadeout', text: 'Pull deck 1’s fader down. That’s your first mix.', hint: 'Bring deck 1’s LOW back up afterwards, ready for next time.', done: (i) => !!i.decks[0] && !!i.decks[1] && i.decks[0].audible < 0.1 && i.decks[1].audible > 0.5 },
];

/** the first step not done yet, in order (steps are done one at a time) */
export class Tutorial {
  step = 0;
  private from: (string | null | undefined)[] | null = null;
  get done(): boolean {
    return this.step >= TUTORIAL.length;
  }
  get current(): TutorialStep | null {
    return TUTORIAL[this.step] ?? null;
  }
  /** returns true when a step was just completed */
  update(i: TutorialInput): boolean {
    const s = this.current;
    if (!s) return false;
    this.from ??= i.decks.map((d) => d?.trackId);
    if (s.done(i, this.from)) {
      this.step++;
      return true;
    }
    return false;
  }
}
