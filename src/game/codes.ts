/*
 * Codes you can type in the ⋯ menu's "Enter a code" box. Each one changes the
 * career through the same Progress save the game uses. Pure logic: the app
 * applies the patch and shows the message.
 *
 *   FAME   every career venue and secret room open for gigs, and fame at the
 *          top of the scale (the last tier, Legend, with everything the tiers unlock)
 */
import { MAX_TIER, type Progress } from '../core/models';
import { TIER_FAME } from './progression';
import { CRAZY_ROOM_IDS } from './rooms';

export interface CodeResult {
  patch: Partial<Progress>;
  /** what it did, for the toast */
  message: string;
}

/** the career venues that open by something other than fame: a first set (the Basement), a booking (the Boat) */
export const CODE_VENUE_UNLOCKS = ['venue:basement', 'venue:boat', ...CRAZY_ROOM_IDS.map((id) => `room:${id}`)];

/** what a code does to this career (null: not a code). Case and spaces around it don't matter. */
export function redeemCode(code: string, p: Progress): CodeResult | null {
  switch (code.trim().toUpperCase()) {
    case 'FAME':
      return {
        patch: {
          tier: MAX_TIER,
          fame: Math.max(p.fame, TIER_FAME[MAX_TIER - 1]),
          unlocked: [...new Set([...p.unlocked, ...CODE_VENUE_UNLOCKS])],
        },
        message: 'FAME: every venue and secret room is open for gigs and your fame is maxed out.',
      };
    default:
      return null;
  }
}
