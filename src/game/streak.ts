/*
 * The streak: clean moments in a row multiply what they score. Every named
 * transition, built drop and comeback adds one to it; the second in a row pays
 * ×1.25, the third ×1.5, up to ×2. A trainwreck, a key clash, dead air,
 * redlining, too many drops, a repeat or going too hard breaks it. (The crowd
 * getting restless doesn't: that's a nudge, not a mistake.)
 *
 * Pure: the gig feeds it the vibe meter's events and adds the bonus.
 */
import type { MistakeName, VibeEvent } from './vibe';

export const STREAK_STEP = 0.25;
export const STREAK_MAX = 2;

const BREAKS: ReadonlySet<MistakeName> = new Set(['trainwreck', 'key_clash', 'dead_air', 'redline', 'drop_spam', 'repeat', 'too_hard']);

export class Streak {
  /** clean moments in a row */
  count = 0;
  best = 0;
  /** extra points the streak has paid tonight */
  bonus = 0;

  /** the multiplier the next clean moment would get */
  get next(): number {
    return Math.min(STREAK_MAX, 1 + STREAK_STEP * this.count);
  }

  /** the multiplier the last clean moment got */
  get mult(): number {
    return Math.min(STREAK_MAX, 1 + STREAK_STEP * Math.max(0, this.count - 1));
  }

  /** an event from the vibe meter: the extra points it earns (0 when it breaks or doesn't count) */
  onEvent(e: VibeEvent): number {
    if (e.kind === 'transition' || e.kind === 'comeback' || (e.kind === 'drop' && e.built)) {
      const m = this.next;
      this.count++;
      this.best = Math.max(this.best, this.count);
      const extra = Math.round((e.points * (m - 1)) / 10) * 10;
      this.bonus += extra;
      return extra;
    }
    if (e.kind === 'mistake' && BREAKS.has(e.name)) this.count = 0;
    return 0;
  }
}
