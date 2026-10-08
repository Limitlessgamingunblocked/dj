/*
 * User preferences that many parts of the app read: key notation, colours,
 * deck defaults, crowd size, the keyboard map. One object, saved in this
 * browser, with a change event. Everything loaded or imported goes through
 * sanitizePrefs(), so an old or hand-edited file can't break the app: unknown
 * fields are dropped, numbers are clamped and bad values fall back to the
 * defaults.
 */
import type { KeyNotation } from '../analysis/keys';
import { LENS_LOOKS, type LensLook } from '../three/looks';
import { loadSetting, saveSetting } from './settings';

export type { KeyNotation } from '../analysis/keys';
export type WaveScheme = 'rgb' | 'threeband' | 'blue' | 'mono';
export type JogMode = 'vinyl' | 'cdj';

export interface Prefs {
  keyNotation: KeyNotation;
  waveScheme: WaveScheme;
  /** interface accent colour; '' follows the venue */
  accent: string;
  deckColors: [string, string, string, string];
  /** size of the panels around the stage, 0.8..1.3 */
  uiScale: number;
  /** idle camera sway and the beat shake (always off when the system asks for reduced motion) */
  cameraMotion: boolean;
  /** seconds before the end a playing deck starts warning; 0 = off */
  endWarning: number;
  /** refuse to load onto a deck that is playing */
  loadLock: boolean;
  /** tempo fader range, as a fraction (0.08 = ±8 %) */
  tempoRange: number;
  keylock: boolean;
  quantize: boolean;
  /** jog wheel top: scratch (vinyl) or pitch bend (CDJ) */
  jogMode: JogMode;
  loopBeats: number;
  jumpBeats: number;
  /** crowd size: 0 is an empty room, 1 the venue's normal crowd, 1.5 packed */
  crowd: number;
  /** Auto DJ: how long each mix takes, in bars */
  autoMixBars: number;
  /** a title card on the stage when a new track takes over */
  nowPlaying: boolean;
  /** lens look on the club camera: 'auto' gives each camera angle its own (fisheye, camcorder…) */
  lens: LensLook | 'auto';
  /** keyboard: default key → assigned key ('' = no key). Only changed keys are stored. */
  keys: Record<string, string>;
}

export const KEY_NOTATIONS: { id: KeyNotation; name: string; example: string }[] = [
  { id: 'camelot', name: 'Camelot', example: '8A' },
  { id: 'openkey', name: 'Open Key', example: '1m' },
  { id: 'musical', name: 'Musical', example: 'Am' },
  { id: 'both', name: 'Camelot + musical', example: '8A Am' },
];

export const WAVE_SCHEMES: { id: WaveScheme; name: string }[] = [
  { id: 'rgb', name: 'RGB (low red, mid green, high blue)' },
  { id: 'threeband', name: '3-band (blue, orange, white)' },
  { id: 'blue', name: 'Blue' },
  { id: 'mono', name: 'Single colour' },
];

export const TEMPO_RANGE_CHOICES = [0.06, 0.08, 0.1, 0.16, 0.25, 0.5, 1];
export const BEAT_CHOICES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
export const DEFAULT_DECK_COLORS: [string, string, string, string] = ['#4cc9f0', '#ff9f1c', '#3ddc97', '#c77dff'];

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  keyNotation: 'camelot',
  waveScheme: 'rgb',
  accent: '',
  deckColors: DEFAULT_DECK_COLORS,
  uiScale: 1,
  cameraMotion: true,
  endWarning: 30,
  loadLock: true,
  tempoRange: 0.08,
  keylock: false,
  quantize: true,
  jogMode: 'vinyl',
  loopBeats: 4,
  jumpBeats: 4,
  crowd: 1,
  lens: 'auto',
  autoMixBars: 16,
  nowPlaying: true,
  keys: {},
});

const HEX = /^#[0-9a-f]{6}$/i;
/** a key code as KeyboardEvent.code gives it, optionally on the Shift layer */
const CHORD = /^(Shift\+)?[A-Za-z][A-Za-z0-9]{0,24}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const colour = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);

/** Check anything loaded or imported against the defaults; always returns a complete, valid Prefs. */
export function sanitizePrefs(raw: unknown): Prefs {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_PREFS;
  const dc = Array.isArray(r.deckColors) ? r.deckColors : [];
  const keys: Record<string, string> = {};
  if (isObj(r.keys))
    for (const [k, v] of Object.entries(r.keys)) {
      if (!CHORD.test(k) || typeof v !== 'string' || (v !== '' && !CHORD.test(v)) || v === k) continue;
      keys[k] = v;
    }
  return {
    keyNotation: oneOf(r.keyNotation, KEY_NOTATIONS.map((n) => n.id), d.keyNotation),
    waveScheme: oneOf(r.waveScheme, WAVE_SCHEMES.map((s) => s.id), d.waveScheme),
    accent: r.accent === '' ? '' : colour(r.accent, d.accent),
    deckColors: [0, 1, 2, 3].map((i) => colour(dc[i], d.deckColors[i])) as Prefs['deckColors'],
    uiScale: Math.round(num(r.uiScale, 0.8, 1.3, d.uiScale) * 20) / 20,
    cameraMotion: bool(r.cameraMotion, d.cameraMotion),
    endWarning: Math.round(num(r.endWarning, 0, 120, d.endWarning)),
    loadLock: bool(r.loadLock, d.loadLock),
    tempoRange: oneOf(r.tempoRange, TEMPO_RANGE_CHOICES, d.tempoRange),
    keylock: bool(r.keylock, d.keylock),
    quantize: bool(r.quantize, d.quantize),
    jogMode: oneOf(r.jogMode, ['vinyl', 'cdj'] as const, d.jogMode),
    loopBeats: oneOf(r.loopBeats, BEAT_CHOICES, d.loopBeats),
    jumpBeats: oneOf(r.jumpBeats, BEAT_CHOICES, d.jumpBeats),
    crowd: Math.round(num(r.crowd, 0, 1.5, d.crowd) * 20) / 20,
    autoMixBars: oneOf(r.autoMixBars, [8, 16, 32], d.autoMixBars),
    nowPlaying: bool(r.nowPlaying, d.nowPlaying),
    lens: oneOf(r.lens, ['auto', ...LENS_LOOKS.map((l) => l.id)] as (LensLook | 'auto')[], d.lens),
    keys,
  };
}

/** A loaded deck inside the end-of-track warning time. */
export function nearEnd(d: { loaded: boolean; remaining: number }): boolean {
  return prefs.endWarning > 0 && d.loaded && d.remaining < prefs.endWarning;
}

type Listener = (p: Prefs, changed: Set<keyof Prefs>) => void;
const listeners = new Set<Listener>();

/** the live preferences (read freely; change them with setPrefs) */
export const prefs: Prefs = sanitizePrefs(loadSetting<unknown>('prefs', {}));

/** Change some preferences, save them and tell everyone who listens what changed. */
export function setPrefs(patch: Partial<Prefs>): void {
  const next = sanitizePrefs({ ...prefs, ...patch });
  const changed = new Set<keyof Prefs>();
  for (const k of Object.keys(next) as (keyof Prefs)[]) if (JSON.stringify(next[k]) !== JSON.stringify(prefs[k])) changed.add(k);
  if (!changed.size) return;
  Object.assign(prefs, next);
  saveSetting('prefs', prefs);
  for (const fn of listeners) fn(prefs, changed);
}

export function resetPrefs(): void {
  setPrefs(structuredClone(DEFAULT_PREFS) as Prefs);
}

/** Listen for changes; returns a function that stops listening. */
export function onPrefs(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
