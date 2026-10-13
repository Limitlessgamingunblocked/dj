/*
 * Your home between gigs (Section 9.7): the bedroom, then the studio, then
 * the penthouse. Fame moves you up, or you buy the move early in the shop
 * (`buy:home:1`, `buy:home:2` in unlocked). Plain data, so the shop and its
 * tests don't need the 3D hub.
 */
import type { Progress } from '../core/models';

export const HOME_NAMES = ['Your bedroom', 'Your studio', 'The penthouse'] as const;
/** the fame tier each home comes with */
export const HOME_TIERS = [1, 3, 5] as const;

/** which home you live in at a fame tier: 0 bedroom, 1 studio, 2 penthouse */
export function homeLevel(tier: number): 0 | 1 | 2 {
  return tier >= HOME_TIERS[2] ? 2 : tier >= HOME_TIERS[1] ? 1 : 0;
}

/** the home you live in: the one your fame gives you, or a better one you bought */
export function homeOf(p: Pick<Progress, 'tier' | 'unlocked' | 'sandbox'>): 0 | 1 | 2 {
  if (p.sandbox) return 2;
  const bought = p.unlocked.includes('buy:home:2') ? 2 : p.unlocked.includes('buy:home:1') ? 1 : 0;
  return Math.max(homeLevel(p.tier), bought) as 0 | 1 | 2;
}
