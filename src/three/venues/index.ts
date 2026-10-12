/* Venue catalogue. The real venues are fan-made recreations, not affiliated with the clubs or promoters. */
import { customVenue, isCustomRoom, loadCustomRooms, type CustomRoomConfig } from './rooms/custom';
import type { VenueDef } from './base';

export type { VenueDef };
import { allyPally, allyPallyRound } from './allypally';
import { basement } from './basement';
import { bedroom } from './bedroom';
import { berghain } from './berghain';
import { boilerRoom } from './boilerroom';
import { burningMan } from './burningman';
import { dc10 } from './dc10';
import { printworks } from './printworks';
import { warehouseRave } from './rave';
import { rooftop } from './rooftop';
import { warehouse } from './warehouse';
import { beach } from './beach';
import { boat } from './boat';
import { festival } from './festival';
import { sunrise } from './sunrise';
import { CRAZY_ROOMS } from './rooms';

/** the career's rooms first (Section 5.2), then the real rooms, then the secret crazy rooms */
export const VENUES: VenueDef[] = [bedroom, basement, rooftop, warehouseRave, beach, boat, festival, sunrise, dc10, boilerRoom, berghain, printworks, allyPally, allyPallyRound, burningMan, warehouse, ...CRAZY_ROOMS];

/** the rooms you've built (Room editor): replaced in the venue list whenever they change */
export function registerCustomRooms(list: CustomRoomConfig[]): void {
  for (let i = VENUES.length - 1; i >= 0; i--) if (isCustomRoom(VENUES[i].id)) VENUES.splice(i, 1);
  VENUES.push(...list.map(customVenue));
}
registerCustomRooms(loadCustomRooms());

export function venueById(id: string): VenueDef {
  return VENUES.find((v) => v.id === id) ?? VENUES[0];
}
