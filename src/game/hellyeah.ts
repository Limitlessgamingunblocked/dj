/*
 * When to shout HELL YEAH (the party moment, app/party.ts). The pad or
 * Shift+H fires it any time, but not more than once every few seconds so the
 * moments don't pile on top of each other. With "HELL YEAH on big moments"
 * on, it also fires by itself: every fourth clean moment in a row, a built
 * drop, the encore, a raid. The automatic ones stay at least 45 s apart, so
 * they stay special. Pure, so it's unit-tested.
 */

export type Moment = 'pad' | 'streak' | 'drop' | 'encore' | 'raid';

/** seconds between any two HELL YEAHs */
export const MANUAL_GAP = 4;
/** seconds between two automatic ones */
export const AUTO_GAP = 45;

export class HellYeah {
  private lastAny = Number.NEGATIVE_INFINITY;
  private lastAuto = Number.NEGATIVE_INFINITY;
  /** fire by itself on the big moments */
  auto = true;

  /** does this moment, at time t (seconds), get a HELL YEAH? Remembers it if so. */
  ask(what: Moment, t: number): boolean {
    if (t - this.lastAny < MANUAL_GAP) return false;
    if (what !== 'pad') {
      if (!this.auto || t - this.lastAuto < AUTO_GAP) return false;
      this.lastAuto = t;
    }
    this.lastAny = t;
    return true;
  }
}

/** a streak worth shouting about: every fourth clean moment in a row */
export function streakMoment(count: number): boolean {
  return count >= 4 && count % 4 === 0;
}
