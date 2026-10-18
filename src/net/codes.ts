/*
 * Room codes: five characters a friend can read out or type, from an
 * alphabet without the look-alikes (no 0/O, no 1/I). 32^5 is about 33 million
 * codes, plenty for the rooms open on the broker at any one time; a clash is
 * caught when the host registers (the broker says the id is taken) and a new
 * code is drawn.
 */

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

/** the broker's id for a room; the prefix keeps us apart from other PeerJS apps on the shared broker */
export const ROOM_PREFIX = 'deckhouse-room-';

export function newRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return s;
}

/** what someone typed, as a code (case, spaces and dashes ignored), or null if it can't be one */
export function normalizeRoomCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]+/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const c of s) if (!CODE_ALPHABET.includes(c)) return null;
  return s;
}

export function roomPeerId(code: string): string {
  return ROOM_PREFIX + code;
}

/** a link that opens the game straight into the room (`?room=CODE`) */
export function roomLink(code: string, base: string = typeof location !== 'undefined' ? location.href : ''): string {
  const u = new URL(base);
  u.searchParams.set('room', code);
  u.hash = '';
  return u.toString();
}

/** the room code in a page address, if it has one */
export function roomFromUrl(href: string = typeof location !== 'undefined' ? location.href : ''): string | null {
  try {
    const v = new URL(href).searchParams.get('room');
    return v ? normalizeRoomCode(v) : null;
  } catch {
    return null;
  }
}
