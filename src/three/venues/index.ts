/* Venue catalogue. The real venues are fan-made recreations, not affiliated with the clubs or promoters. */
import type { VenueDef } from './base';

export type { VenueDef };
import { allyPally, allyPallyRound } from './allypally';
import { basement } from './basement';
import { bedroom } from './bedroom';
import { berghain } from './berghain';
import { boilerRoom } from './boilerroom';
import { dc10 } from './dc10';
import { printworks } from './printworks';
import { warehouse } from './warehouse';

/** the career's rooms first (Section 5.2), then the real rooms */
export const VENUES: VenueDef[] = [bedroom, basement, dc10, boilerRoom, berghain, printworks, allyPally, allyPallyRound, warehouse];

export function venueById(id: string): VenueDef {
  return VENUES.find((v) => v.id === id) ?? VENUES[0];
}
