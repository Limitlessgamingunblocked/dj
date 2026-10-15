/*
 * Settings backup: everything the app keeps in this browser's localStorage
 * (layout, preferences, keyboard shortcuts, MIDI mappings, saved camera views,
 * Set Builder options) as one JSON file to save, carry to another browser and
 * load again. The music library lives in IndexedDB and is not part of it, and
 * neither is the AI key (a file gets passed around; the key stays here).
 */
import { AI_SETTING } from './ai';
import { PREFIX } from './settings';

/** settings that never go in the file, and that loading one leaves alone */
const PRIVATE = new Set([AI_SETTING]);

export const BACKUP_KIND = 'deckhouse-settings';
const KEY = /^[A-Za-z][\w:.-]{0,63}$/;
const MAX_BYTES = 2_000_000;

export interface Backup {
  kind: typeof BACKUP_KIND;
  version: 1;
  exported: string;
  entries: Record<string, unknown>;
}

export function makeBackup(entries: Record<string, unknown>, now = new Date()): Backup {
  return { kind: BACKUP_KIND, version: 1, exported: now.toISOString(), entries };
}

/** Read a backup file's text. Throws an Error with a message for the user when it isn't one. */
export function parseBackup(text: string): Record<string, unknown> {
  if (text.length > MAX_BYTES) throw new Error('That file is too big to be a settings file.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That isn’t a settings file (it isn’t JSON).');
  }
  const b = data as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.kind !== BACKUP_KIND) throw new Error('That isn’t a Deckhouse settings file.');
  if (typeof b.version !== 'number' || b.version > 1) throw new Error('That settings file is from a newer version of Deckhouse.');
  if (!b.entries || typeof b.entries !== 'object' || Array.isArray(b.entries)) throw new Error('That settings file is empty or damaged.');
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b.entries)) if (KEY.test(k) && v !== undefined && !PRIVATE.has(k)) out[k] = v;
  return out;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Every saved setting, by key without the prefix. */
export function readAllSettings(): Record<string, unknown> {
  const s = storage();
  const out: Record<string, unknown> = {};
  if (!s) return out;
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k?.startsWith(PREFIX) || PRIVATE.has(k.slice(PREFIX.length))) continue;
    try {
      out[k.slice(PREFIX.length)] = JSON.parse(s.getItem(k) ?? 'null');
    } catch {
      /* skip a damaged entry */
    }
  }
  return out;
}

/** Remove every saved setting (the library is untouched); `keepPrivate` leaves the AI key */
export function clearAllSettings(keepPrivate = false): void {
  const s = storage();
  if (!s) return;
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(PREFIX) && !(keepPrivate && PRIVATE.has(k.slice(PREFIX.length)))) keys.push(k);
  }
  for (const k of keys) s.removeItem(k);
}

/** Replace the saved settings with a backup's. Returns false if storage isn't available. */
export function restoreSettings(entries: Record<string, unknown>): boolean {
  const s = storage();
  if (!s) return false;
  clearAllSettings(true);
  try {
    for (const [k, v] of Object.entries(entries)) if (!PRIVATE.has(k)) s.setItem(PREFIX + k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}
