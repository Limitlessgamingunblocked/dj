/*
 * The crazy rooms as secret venues: each opens when you meet its challenge
 * in a set (checked after every set, like milestones), and stays open. The
 * debug sandbox and the FAME code open them all. Pure logic: the venues
 * themselves are in three/venues/rooms.
 */
import type { Progress } from '../core/models';
import type { SetSummary } from './progression';

export interface RoomChallenge {
  id: string;
  name: string;
  /** what to do, as the lock says it */
  text: string;
  done(s: SetSummary, after: Pick<Progress, 'tier' | 'setsPlayed' | 'venuesPlayed'>): boolean;
}

export const ROOM_CHALLENGES: RoomChallenge[] = [
  { id: 'uv', name: 'UV Blacklight Room', text: 'Play a set in the Basement Club', done: (s) => s.venue === 'basement' },
  { id: 'kaleido', name: 'Kaleidoscope Dome', text: 'Play 3 sets', done: (_s, p) => p.setsPlayed >= 3 },
  { id: 'glitch', name: 'Glitch Room', text: 'Finish a set with no mistakes', done: (s) => s.full && s.mistakes === 0 },
  { id: 'lasergrid', name: 'Laser Grid Room', text: 'Land 3 perfect transitions in one set', done: (s) => s.perfect >= 3 },
  { id: 'ledcube', name: 'LED Cube', text: 'Land 5 named transitions in one set', done: (s) => s.transitions >= 5 },
  { id: 'neonmaze', name: 'Neon Maze', text: 'Reach fame tier 3', done: (_s, p) => p.tier >= 3 },
  { id: 'water', name: 'Water Room', text: 'Play a set at the Beach Club Terrace', done: (s) => s.venue === 'beach' },
  { id: 'fog', name: 'Fog Room', text: 'Play a closing set', done: (s) => s.slot === 'closing' && s.full },
  { id: 'mirror', name: 'Infinity Mirror Room', text: 'Finish a set with an A or better', done: (s) => s.grade === 'A' || s.grade === 'S' },
  { id: 'soundwave', name: 'Sound Wave Room', text: 'Keep the average vibe over 70% for a whole set', done: (s) => s.full && s.average >= 0.7 },
  { id: 'upsidedown', name: 'Upside-Down Room', text: 'Get called back for an encore', done: (s) => s.encore },
  { id: 'hologram', name: 'Hologram Room', text: 'Play in 5 different venues', done: (_s, p) => p.venuesPlayed.length >= 5 },
  { id: 'lava', name: 'Lava Lamp Room', text: 'Play a set at the Rooftop Bar', done: (s) => s.venue === 'rooftop' },
  { id: 'arcade', name: 'Arcade Room', text: 'Hold the room at 100% for a full minute', done: (s) => s.fullMinute },
  { id: 'vinyl', name: 'Vinyl Floor', text: 'Mix in key 4 times in one set', done: (s) => s.keyMixes >= 4 },
  { id: 'aquarium', name: 'Aquarium', text: 'Play the Boat Party', done: (s) => s.venue === 'boat' },
  { id: 'speaker', name: 'Inside a Speaker', text: 'Land 8 drops in one set', done: (s) => s.drops >= 8 },
  { id: 'zerog', name: 'Zero Gravity', text: 'Play a set at the Main-Stage Festival', done: (s) => s.venue === 'festival' },
  { id: 'cloud', name: 'Cloud Room', text: 'Play the Sunrise closing set', done: (s) => s.venue === 'sunrise' },
];

export const CRAZY_ROOM_IDS = ROOM_CHALLENGES.map((c) => c.id);

export const isCrazyRoom = (id: string): boolean => CRAZY_ROOM_IDS.includes(id);

/** why a crazy room is still locked (null: open) */
export function roomLock(id: string, p: Pick<Progress, 'unlocked' | 'sandbox'>): string | null {
  if (p.sandbox || p.unlocked.includes(`room:${id}`)) return null;
  const c = ROOM_CHALLENGES.find((x) => x.id === id);
  return c ? `Secret room: ${c.text.charAt(0).toLowerCase()}${c.text.slice(1)}` : null;
}

/** the rooms a set opens: their unlock keys and names */
export function roomsOpenedBy(s: SetSummary, after: Pick<Progress, 'tier' | 'setsPlayed' | 'venuesPlayed' | 'unlocked'>): { keys: string[]; names: string[] } {
  const keys: string[] = [];
  const names: string[] = [];
  for (const c of ROOM_CHALLENGES) {
    const key = `room:${c.id}`;
    if (after.unlocked.includes(key) || !c.done(s, after)) continue;
    keys.push(key);
    names.push(c.name);
  }
  return { keys, names };
}
