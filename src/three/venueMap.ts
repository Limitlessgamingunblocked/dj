/*
 * Where the venues are, for the venue globe: the real clubs on the map (the
 * rooms are fan-made recreations, not affiliated with the clubs), grouped by
 * city so one pin stands for every room there; the career's own rooms ride
 * an orbit round the planet, the secret rooms and yours an outer ring of
 * portals.
 */

export interface VenuePlace {
  lat: number;
  lon: number;
  city: string;
}

/** the real rooms, where they really are */
export const VENUE_PLACES: Record<string, VenuePlace> = {
  allypally: { lat: 51.594, lon: -0.131, city: 'London' },
  'allypally-round': { lat: 51.594, lon: -0.131, city: 'London' },
  printworks: { lat: 51.497, lon: -0.044, city: 'London' },
  berghain: { lat: 52.511, lon: 13.443, city: 'Berlin' },
  dc10: { lat: 38.882, lon: 1.398, city: 'Ibiza' },
  boilerroom: { lat: 34.05, lon: -118.24, city: 'Los Angeles' },
  burningman: { lat: 40.786, lon: -119.206, city: 'Black Rock City' },
};

/** where a city's name sits beside its pin (px, and which side), when the default would land on a neighbour */
export const CITY_LABEL: Record<string, [number, number, 'left' | 'right' | 'center']> = {
  'Black Rock City': [-6, -2, 'right'],
  'Los Angeles': [6, 10, 'left'],
  London: [-6, 0, 'right'],
  Berlin: [6, 0, 'left'],
};

export type VenueGroup = 'real' | 'circuit' | 'secret' | 'yours';

export const GROUP_NAMES: Record<VenueGroup, string> = {
  real: 'Real clubs',
  circuit: 'On the circuit',
  secret: 'Secret rooms',
  yours: 'Your rooms',
};

/** which part of the globe a venue lives on */
export function venueGroup(id: string, secret: ReadonlySet<string>): VenueGroup {
  if (VENUE_PLACES[id]) return 'real';
  if (id.startsWith('custom-')) return 'yours';
  if (secret.has(id)) return 'secret';
  return 'circuit';
}

export interface CityPin {
  city: string;
  lat: number;
  lon: number;
  /** the rooms there, in the order given */
  ids: string[];
}

/** one pin per city, at the average of its rooms */
export function cityPins(ids: readonly string[]): CityPin[] {
  const out: CityPin[] = [];
  for (const id of ids) {
    const p = VENUE_PLACES[id];
    if (!p) continue;
    let pin = out.find((c) => c.city === p.city);
    if (!pin) {
      pin = { city: p.city, lat: 0, lon: 0, ids: [] };
      out.push(pin);
    }
    pin.ids.push(id);
  }
  for (const pin of out) {
    pin.lat = pin.ids.reduce((s, id) => s + VENUE_PLACES[id].lat, 0) / pin.ids.length;
    pin.lon = pin.ids.reduce((s, id) => s + VENUE_PLACES[id].lon, 0) / pin.ids.length;
  }
  return out;
}

/** a ring big enough for `n` things `spacing` apart, never smaller than `min` */
export function ringRadius(n: number, spacing: number, min: number): number {
  return Math.max(min, (n * spacing) / (Math.PI * 2));
}
