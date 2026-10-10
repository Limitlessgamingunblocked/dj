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
import { warehouseRave } from './rave';
import { rooftop } from './rooftop';
import { warehouse } from './warehouse';
import { beach } from './beach';
import { boat } from './boat';
import { festival } from './festival';
import { sunrise } from './sunrise';

/** the career's rooms first (Section 5.2), then the real rooms */
export const VENUES: VenueDef[] = [bedroom, basement, rooftop, warehouseRave, beach, boat, festival, sunrise, dc10, boilerRoom, berghain, printworks, allyPally, allyPallyRound, warehouse];

export function venueById(id: string): VenueDef {
  return VENUES.find((v) => v.id === id) ?? VENUES[0];
}
