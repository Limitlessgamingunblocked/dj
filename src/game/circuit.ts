/*
 * The career beyond single bookings (saved in settings as "circuit"):
 *   - promoter relationships: every promoter remembers how your sets for them
 *     went. Good ones bring better slots and pay; a promoter you let down
 *     enough stops calling.
 *   - a residency: a weekly night at one club. The crowd remembers last
 *     week's tracks (play them again and they're bored) and grows when you
 *     keep it fresh and play well.
 *   - the World Tour: a run of cities on consecutive nights, travelling by
 *     van, then train, then private jet as you get bigger. Each city's crowd
 *     has its own taste.
 *   - festival clashes: you're on at the same time as a rival on another
 *     stage, and the field drifts to whoever's playing better.
 *   - night events: a power cut, rain, a broken channel or a fire alarm,
 *     each a test mid-set.
 * Pure logic: the app keeps the save, the gig director runs the effects.
 */
import { loadSetting, saveSetting } from '../core/settings';
import type { Booking, BookingsSave, Progress } from '../core/models';
import { makeOfferFor } from './bookings';
import { CAREER, type CareerVenue } from './progression';
import { RIVAL_IDS, RIVALS, type RivalId } from './rivals';

/* ---------------- promoter relationships ---------------- */

export type Relations = Record<string, number>;

/** a promoter below this has stopped calling */
export const STOP_AT = -0.5;

const GRADE_REL: Record<string, number> = { S: 0.25, A: 0.15, B: 0.05, C: -0.06, D: -0.12 };

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

/** after a booking: how it went, and whether you hit their objective */
export function relAfter(rel: Relations, promoter: string, grade: string, met: boolean): Relations {
  const v = (rel[promoter] ?? 0) + (GRADE_REL[grade] ?? 0) + (met ? 0.05 : 0);
  return { ...rel, [promoter]: Math.round(clamp(v) * 1000) / 1000 };
}

/** turning an offer down cools them a little; pulling out of a booking more */
export function relDeclined(rel: Relations, promoter: string, wasBooked: boolean): Relations {
  const v = (rel[promoter] ?? 0) - (wasBooked ? 0.15 : 0.04);
  return { ...rel, [promoter]: Math.round(clamp(v) * 1000) / 1000 };
}

export function relStatus(v: number | undefined): { label: string; tone: 'good' | 'neutral' | 'bad' } {
  const x = v ?? 0;
  if (x <= STOP_AT) return { label: 'Stopped calling', tone: 'bad' };
  if (x < -0.15) return { label: 'Cooling off', tone: 'bad' };
  if (x >= 0.5) return { label: 'Loves you', tone: 'good' };
  if (x >= 0.2) return { label: 'Keen', tone: 'good' };
  return { label: 'Knows you', tone: 'neutral' };
}

/** a promoter's fee multiplier and whether they give you the better slots */
export function relPerks(v: number | undefined): { pay: number; prime: boolean } {
  const x = v ?? 0;
  return { pay: 1 + Math.max(0, x) * 0.35 + Math.min(0, x) * 0.2, prime: x >= 0.4 };
}

/* ---------------- the residency ---------------- */

export const RESIDENCY_VENUES: CareerVenue[] = ['basement', 'rooftop', 'warehouse'];

export interface Residency {
  venue: CareerVenue;
  promoter: string;
  /** the night of the week (night % 7) */
  day: number;
  weeks: number;
  /** how full the room is, against its usual crowd (0.6 to 1.6) */
  crowd: number;
  /** last week's tracks */
  lastTracks: string[];
  /** the last night its bookings are in the calendar up to */
  booked: number;
}

/** a residency on offer: a promoter at a club who likes you enough */
export function residencyOffer(p: Pick<Progress, 'tier'>, rel: Relations, current: Residency | null, night: number, promoters: Record<string, string[]>): Residency | null {
  if (current || p.tier < 2) return null;
  for (const venue of RESIDENCY_VENUES) {
    if (CAREER[venue].tier > p.tier) continue;
    const pr = (promoters[venue] ?? []).find((x) => (rel[x] ?? 0) >= 0.3);
    if (pr) return { venue, promoter: pr, day: (night + 2) % 7, weeks: 0, crowd: 0.8, lastTracks: [], booked: night - 1 };
  }
  return null;
}

/** after a residency night: the crowd grows when it was good and fresh, shrinks when it wasn't */
export function residencyAfter(r: Residency, played: string[], grade: string): { res: Residency; fresh: number; delta: number } {
  const repeats = played.filter((t) => r.lastTracks.includes(t)).length;
  const fresh = played.length ? 1 - repeats / played.length : 0;
  const g = GRADE_REL[grade] ?? 0;
  let delta = g * 0.6 + (fresh - 0.7) * 0.25;
  if (!played.length) delta = -0.1;
  const crowd = Math.round(clamp(r.crowd + delta, 0.6, 1.6) * 100) / 100;
  return { res: { ...r, weeks: r.weeks + 1, crowd, lastTracks: played.slice(0, 40) }, fresh, delta: crowd - r.crowd };
}

/* ---------------- the World Tour ---------------- */

export interface City {
  id: string;
  name: string;
  /** on the tour map, 0..1 across and down (longitude, and latitude from 80° N to 60° S) */
  x: number;
  y: number;
  /** the room the night's in (a venue in the game) */
  venue: CareerVenue;
  /** what the crowd there loves */
  genres: string[];
  taste: string;
  promoter: string;
}

/** real cities, fictional promoters and rooms (the rooms are the game's own venues) */
export const CITIES: City[] = [
  { id: 'london', name: 'London', x: 0.4997, y: 0.2036, venue: 'warehouse', genres: ['Drum & Bass', 'UK Garage', 'Dubstep'], taste: 'Drum & bass, garage and anything with weight', promoter: 'Southbank Bass Club' },
  { id: 'berlin', name: 'Berlin', x: 0.5372, y: 0.1964, venue: 'warehouse', genres: ['Techno', 'Tech House'], taste: 'Techno, long and hypnotic', promoter: 'Spree Night Shift' },
  { id: 'ibiza', name: 'Ibiza', x: 0.5039, y: 0.2936, venue: 'beach', genres: ['House', 'Tech House', 'Afro House'], taste: 'House on the terrace till sunrise', promoter: 'White Isle Sessions' },
  { id: 'amsterdam', name: 'Amsterdam', x: 0.5136, y: 0.1971, venue: 'boat', genres: ['Trance', 'Techno', 'House'], taste: 'Trance and techno on the canals', promoter: 'Canal Ring Rave' },
  { id: 'detroit', name: 'Detroit', x: 0.2694, y: 0.2693, venue: 'basement', genres: ['Techno', 'House'], taste: 'Where techno began: they know the classics', promoter: 'Motor City Underground' },
  { id: 'newyork', name: 'New York', x: 0.2944, y: 0.2807, venue: 'rooftop', genres: ['House', 'Hip Hop', 'Disco'], taste: 'House, disco and a bit of hip hop', promoter: 'Five Boroughs Roof' },
  { id: 'saopaulo', name: 'São Paulo', x: 0.3706, y: 0.7393, venue: 'festival', genres: ['House', 'Afro House', 'Tech House'], taste: 'Deep, rolling house for a huge crowd', promoter: 'Paulista Open Air' },
  { id: 'lagos', name: 'Lagos', x: 0.5094, y: 0.525, venue: 'rooftop', genres: ['Afro House', 'Hip Hop', 'Reggaeton'], taste: 'Afro house and amapiano energy', promoter: 'Island Rhythm Roof' },
  { id: 'tokyo', name: 'Tokyo', x: 0.8881, y: 0.3164, venue: 'basement', genres: ['Techno', 'House', 'Drum & Bass'], taste: 'Heads who know every record: play it tight', promoter: 'Shibuya Low Light' },
  { id: 'sydney', name: 'Sydney', x: 0.92, y: 0.8136, venue: 'beach', genres: ['House', 'Pop', 'Trance'], taste: 'Big summer house on the harbour', promoter: 'Harbour Beach Club' },
];

export type Travel = 'van' | 'train' | 'jet';

/** how you travel, by how big you are */
export function travelFor(tier: number): { mode: Travel; label: string; note: string } {
  if (tier >= 6) return { mode: 'jet', label: 'Private jet', note: 'Anywhere overnight' };
  if (tier >= 5) return { mode: 'train', label: 'Train and planes', note: 'A night between cities' };
  return { mode: 'van', label: 'Tour van', note: 'Long drives, sleep in the back' };
}

export interface Tour {
  cities: string[];
  /** cities played so far (they can be played in any order; the tour's done when every city has a result) */
  leg: number;
  travel: Travel;
  /** the first night of the tour */
  start: number;
  results: { city: string; grade: string }[];
}

export const TOUR_TIER = 4;
export const MAX_TOUR_CITIES = 5;

/** a tour of these cities, one a night from `start` */
export function planTour(cities: string[], p: Pick<Progress, 'tier'>, start: number): Tour | null {
  const ok = cities.filter((c, i) => CITIES.some((x) => x.id === c) && cities.indexOf(c) === i).slice(0, MAX_TOUR_CITIES);
  if (ok.length < 2 || p.tier < TOUR_TIER) return null;
  return { cities: ok, leg: 0, travel: travelFor(p.tier).mode, start, results: [] };
}

/** how a city takes a genre: loved (1), fine (0) */
export function cityTaste(cityId: string, genre: string): number {
  const c = CITIES.find((x) => x.id === cityId);
  if (!c || !genre) return 0;
  return c.genres[0] === genre ? 1 : c.genres.includes(genre) ? 0.6 : 0;
}

/** what a finished tour is worth: followers for each city, more for good nights */
export function tourReward(results: { grade: string }[]): { followers: number; fame: number } {
  const per: Record<string, number> = { S: 900, A: 600, B: 350, C: 150, D: 50 };
  const followers = results.reduce((a, r) => a + (per[r.grade] ?? 0), 0);
  return { followers, fame: Math.round(followers / 30) };
}

/* ---------------- festival clashes ---------------- */

/** how the field splits: you hold more when the room's with you, a strong rival pulls them away */
export function clashStep(share: number, vibe: number, rival: number, dt: number): number {
  const want = clamp(0.5 + (vibe - rival) * 0.9, 0.12, 0.88);
  return share + (want - share) * Math.min(1, dt * 0.05);
}

/* ---------------- night events ---------------- */

export type NightEventId = 'powercut' | 'rain' | 'channel' | 'alarm';

export const NIGHT_EVENTS: Record<NightEventId, { label: string; say: string; tip: string; len: number; outdoorOnly?: boolean }> = {
  powercut: { label: 'Power cut', say: 'The power’s gone! You’re on the generator: half the lights, keep them dancing.', tip: 'half the lights: keep them dancing', len: 25 },
  rain: { label: 'Rain', say: 'Here comes the rain. Keep the energy up and they’ll dance through it.', tip: 'keep the energy up', len: 60, outdoorOnly: true },
  channel: { label: 'Broken channel', say: 'A channel on the mixer just died. Mix with the others till the tech fixes it.', tip: 'mix with the other decks', len: 35 },
  alarm: { label: 'Fire alarm', say: 'Fire alarm! The music stops. Bring them back when it ends.', tip: 'the speakers are off: drop something big when it ends', len: 12 },
};

/** the night's event, if any: about one set in three, somewhere in the middle */
export function pickNightEvent(outdoor: boolean, r: () => number): { id: NightEventId; at: number } | null {
  if (r() > 0.35) return null;
  const pool = (Object.keys(NIGHT_EVENTS) as NightEventId[]).filter((k) => outdoor || !NIGHT_EVENTS[k].outdoorOnly);
  return { id: pool[Math.floor(r() * pool.length) % pool.length], at: 0.25 + r() * 0.5 };
}

/* ---------------- the save ---------------- */

export interface CircuitSave {
  rel: Relations;
  residency: Residency | null;
  /** a residency on offer (accept or decline in the bookings) */
  residencyOffer: Residency | null;
  tour: Tour | null;
  /** cities you've toured */
  toured: string[];
  /** the night the last festival clash was offered */
  clashNight: number;
}

export function cleanCircuit(raw: unknown): CircuitSave {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const rel: Relations = {};
  if (typeof r.rel === 'object' && r.rel !== null) for (const [k, v] of Object.entries(r.rel)) if (typeof v === 'number' && Number.isFinite(v)) rel[k.slice(0, 60)] = clamp(v);
  const res = (x: unknown): Residency | null => {
    if (typeof x !== 'object' || x === null) return null;
    const o = x as Record<string, unknown>;
    if (!RESIDENCY_VENUES.includes(o.venue as CareerVenue) || typeof o.promoter !== 'string') return null;
    return {
      venue: o.venue as CareerVenue,
      promoter: o.promoter.slice(0, 60),
      day: typeof o.day === 'number' ? ((Math.round(o.day) % 7) + 7) % 7 : 0,
      weeks: typeof o.weeks === 'number' ? Math.max(0, Math.round(o.weeks)) : 0,
      crowd: typeof o.crowd === 'number' ? clamp(o.crowd, 0.6, 1.6) : 0.8,
      lastTracks: Array.isArray(o.lastTracks) ? o.lastTracks.filter((t): t is string => typeof t === 'string').slice(0, 40) : [],
      booked: typeof o.booked === 'number' && Number.isFinite(o.booked) ? Math.round(o.booked) : 0,
    };
  };
  let tour: Tour | null = null;
  if (typeof r.tour === 'object' && r.tour !== null) {
    const t = r.tour as Record<string, unknown>;
    const cities = Array.isArray(t.cities) ? t.cities.filter((c): c is string => typeof c === 'string' && CITIES.some((x) => x.id === c)) : [];
    if (cities.length >= 2)
      tour = {
        cities,
        leg: typeof t.leg === 'number' ? Math.max(0, Math.min(cities.length, Math.round(t.leg))) : 0,
        travel: (['van', 'train', 'jet'] as const).includes(t.travel as Travel) ? (t.travel as Travel) : 'van',
        start: typeof t.start === 'number' ? Math.max(1, Math.round(t.start)) : 1,
        results: Array.isArray(t.results) ? t.results.filter((x): x is { city: string; grade: string } => typeof x === 'object' && x !== null && typeof (x as { city?: unknown }).city === 'string').slice(0, 10) : [],
      };
  }
  return { rel, residency: res(r.residency), residencyOffer: res(r.residencyOffer), tour, toured: Array.isArray(r.toured) ? r.toured.filter((c): c is string => typeof c === 'string').slice(0, 20) : [], clashNight: typeof r.clashNight === 'number' && Number.isFinite(r.clashNight) ? Math.round(r.clashNight) : -99 };
}

export function loadCircuit(): CircuitSave {
  return cleanCircuit(loadSetting<unknown>('circuit', null));
}

export function saveCircuit(c: CircuitSave): void {
  saveSetting('circuit', c);
}

/* ---------------- offers ---------------- */

/**
 * The calendar with the circuit's bookings in: stopped promoters' offers go,
 * the ones who like you pay more (and give you the better slots), the
 * residency's weekly night, the tour's legs, and now and then a festival
 * clash. Returns the new saves (the same objects if nothing needed doing).
 */
export function circuitOffers(save: BookingsSave, p: Progress, c: CircuitSave, r: () => number): { save: BookingsSave; circuit: CircuitSave } {
  const night = save.night;
  const items = save.items.map((b): Booking => {
    if (b.status !== 'offered' || b.special) return b;
    const v = c.rel[b.promoter];
    if (v !== undefined && v <= STOP_AT) return { ...b, status: 'declined' };
    const perks = relPerks(v);
    if (perks.pay !== 1 && !b.id.endsWith('r')) return { ...b, id: `${b.id}r`, pay: Math.round(b.pay * perks.pay), slot: perks.prime && b.slot === 'warmup' ? 'peak' : b.slot };
    return b;
  });
  let seq = Math.max(0, ...items.map((b) => Number(b.id.replace(/\D/g, '')) || 0)) + 1;
  const nextId = () => `ck${seq++}`;
  const booked = (n: number) => items.some((b) => b.night === n && b.status === 'accepted');
  let circuit = c;
  // the residency: its night this week, already yours (unless you're booked elsewhere that night)
  const res = c.residency;
  if (res) {
    const from = Math.max(night, res.booked + 1);
    for (let n = from; n < night + 7; n++) {
      if (((n % 7) + 7) % 7 !== res.day || booked(n)) continue;
      const b = makeOfferFor(res.venue, n, p, r, nextId(), 'residency', res.promoter);
      items.push({ ...b, status: 'accepted', slot: 'peak', expectation: `Week ${res.weeks + 1} of your residency: they remember last week, keep it fresh` });
    }
    if (from < night + 7) circuit = { ...circuit, residency: { ...res, booked: night + 6 } };
  }
  // the tour's legs, one a night
  const t = c.tour;
  if (t) {
    t.cities.forEach((city, i) => {
      if (t.results.some((x) => x.city === city)) return;
      const sp = `tour:${city}`;
      if (items.some((b) => b.special === sp && (b.status === 'accepted' || b.status === 'offered'))) return;
      const n = Math.max(t.start + i, night + (i - t.leg));
      const cc = CITIES.find((x) => x.id === city)!;
      const b = makeOfferFor(cc.venue, n, p, r, nextId(), sp, cc.promoter);
      items.push({ ...b, status: 'accepted', expectation: `${cc.name}: ${cc.taste}` });
    });
  }
  // a festival clash now and then, once the festival's yours
  if (p.tier >= 6 && night - c.clashNight >= 3 && !items.some((b) => b.special?.startsWith('clash:') && b.status === 'offered') && r() < 0.6) {
    const rival = RIVAL_IDS[Math.floor(r() * RIVAL_IDS.length) % RIVAL_IDS.length];
    const b = makeOfferFor('festival', night + 2, p, r, nextId(), `clash:${rival}`, 'Horizon Festival');
    items.push({ ...b, slot: 'peak', expectation: 'Same time as a rival on the other stage: hold the field' });
    circuit = { ...circuit, clashNight: night };
  }
  const same = JSON.stringify(items) === JSON.stringify(save.items);
  return { save: same ? save : { ...save, items }, circuit };
}

/** the first night from `from` with `n` free nights in a row (for a tour) */
export function freeRun(save: BookingsSave, from: number, n: number): number {
  const busy = (x: number) => save.items.some((b) => b.night === x && b.status === 'accepted');
  let s = from;
  for (let guard = 0; guard < 60; guard++, s++) {
    let ok = true;
    for (let i = 0; i < n; i++) if (busy(s + i)) ok = false;
    if (ok) return s;
  }
  return s;
}

/** how a circuit booking reads on its card and flyer (null: not one of the circuit's) */
export function circuitSpecial(special: string | null | undefined, c?: CircuitSave): { badge: string; title: string; line: string; color?: string } | null {
  if (!special) return null;
  if (special === 'residency') {
    const w = (c?.residency?.weeks ?? 0) + 1;
    return { badge: `Your residency · week ${w}`, title: 'RESIDENT', line: `WEEK ${w}` };
  }
  if (special.startsWith('tour:')) {
    const city = CITIES.find((x) => x.id === special.slice(5));
    const t = c?.tour;
    const i = t && city ? t.cities.indexOf(city.id) : -1;
    const of = t && i >= 0 ? ` · night ${i + 1} of ${t.cities.length}` : '';
    return { badge: `World Tour · ${city?.name ?? 'on the road'}${of}`, title: 'WORLD TOUR', line: (city?.name ?? '').toUpperCase() };
  }
  if (special.startsWith('clash:')) {
    const r = RIVALS[special.slice(6) as RivalId];
    return r ? { badge: `Clash: ${r.name} on the other stage`, title: 'MAIN STAGE', line: `VS ${r.name.toUpperCase()} · STAGE 2`, color: r.color } : null;
  }
  return null;
}

/** the rival in a festival clash */
export function clashRival(special: string | null | undefined): RivalId | null {
  if (!special?.startsWith('clash:')) return null;
  const id = special.slice(6) as RivalId;
  return RIVAL_IDS.includes(id) ? id : null;
}

/** the city of a tour leg */
export function tourCity(special: string | null | undefined): City | null {
  if (!special?.startsWith('tour:')) return null;
  return CITIES.find((x) => x.id === special.slice(5)) ?? null;
}

/** the next city on a tour: the first without a result */
export function nextTourCity(t: Tour): string | null {
  return t.cities.find((c) => !t.results.some((x) => x.city === c)) ?? null;
}
