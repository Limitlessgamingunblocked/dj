/* Musical key helpers: names, Camelot wheel codes and harmonic compatibility. */
import type { KeyInfo } from '../core/types';

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function camelotNumber(root: number, minor: boolean): number {
  return minor ? mod(mod(7 * (root - 9), 12) + 7, 12) + 1 : mod(mod(7 * root, 12) + 7, 12) + 1;
}

export function makeKey(root: number, minor: boolean, confidence = 1): KeyInfo {
  root = mod(Math.round(root), 12);
  return {
    root,
    minor,
    camelot: `${camelotNumber(root, minor)}${minor ? 'A' : 'B'}`,
    name: `${NOTE_NAMES[root]}${minor ? 'm' : ''}`,
    confidence,
  };
}

/** how keys are written: Camelot (8A), Open Key (1m), musical (Am) or Camelot plus musical */
export type KeyNotation = 'camelot' | 'openkey' | 'musical' | 'both';
let notation: KeyNotation = 'camelot';

export function setKeyNotation(n: KeyNotation): void {
  notation = n;
}

/** Open Key code: the Camelot wheel turned so that C major is 1d and A minor 1m */
export function openKey(key: KeyInfo): string {
  const n = parseInt(key.camelot, 10);
  return `${mod(n - 8, 12) + 1}${key.minor ? 'm' : 'd'}`;
}

/** A key as the user chose to see it (Settings → Appearance). */
export function formatKey(key: KeyInfo, n: KeyNotation = notation): string {
  if (n === 'openkey') return openKey(key);
  if (n === 'musical') return key.name;
  if (n === 'both') return `${key.camelot} ${key.name}`;
  return key.camelot;
}

/** every way of writing the key, for search */
export function keySearchText(key: KeyInfo): string {
  return `${key.camelot} ${openKey(key)} ${key.name}`.toLowerCase();
}

export function shiftKey(key: KeyInfo, semis: number): KeyInfo {
  return makeKey(key.root + Math.round(semis), key.minor, key.confidence);
}

export type Compat = 'same' | 'harmonic' | 'boost' | null;

function parseCamelot(code: string): { n: number; l: string } {
  return { n: parseInt(code, 10), l: code.slice(-1) };
}

/** Harmonic mixing relationship between two keys on the Camelot wheel. */
export function compatibility(a: KeyInfo | null | undefined, b: KeyInfo | null | undefined): Compat {
  if (!a || !b) return null;
  const x = parseCamelot(a.camelot);
  const y = parseCamelot(b.camelot);
  if (x.n === y.n && x.l === y.l) return 'same';
  const d = mod(y.n - x.n, 12);
  if (x.n === y.n) return 'harmonic'; // relative major/minor
  if (x.l === y.l && (d === 1 || d === 11)) return 'harmonic';
  if (x.l === y.l && (d === 2 || d === 7)) return 'boost';
  return null;
}

/** Semitone shift (−6..+5) that moves `from` onto the key of (or relative to) `to`. */
export function keySyncShift(from: KeyInfo, to: KeyInfo): number {
  // relative major/minor share a Camelot number; compare in the target's mode
  const targetRoot = from.minor === to.minor ? to.root : from.minor ? to.root - 3 : to.root + 3;
  let s = mod(targetRoot - from.root, 12);
  if (s > 5) s -= 12;
  return s;
}

/** Parse key tags such as "8A", "1m" (Open Key), "Am", "A minor", "F#m", "Dbmaj". */
export function parseKeyTag(tag: string | undefined): KeyInfo | null {
  if (!tag) return null;
  const t = tag.trim();
  const cam = /^(1[0-2]|[1-9])\s*([ABab])$/.exec(t);
  if (cam) {
    const n = parseInt(cam[1], 10);
    const minor = cam[2].toUpperCase() === 'A';
    for (let r = 0; r < 12; r++) if (camelotNumber(r, minor) === n) return makeKey(r, minor, 0.5);
  }
  // Open Key: 1d = C major, 1m = A minor
  const ok = /^(1[0-2]|[1-9])\s*([dDmM])$/.exec(t);
  if (ok) {
    const n = mod(parseInt(ok[1], 10) + 6, 12) + 1;
    const minor = ok[2].toLowerCase() === 'm';
    for (let r = 0; r < 12; r++) if (camelotNumber(r, minor) === n) return makeKey(r, minor, 0.5);
  }
  const m = /^([A-Ga-g])\s*([#b♯♭]?)\s*(m(?!aj)|min(?:or)?|maj(?:or)?)?/i.exec(t);
  if (!m) return null;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let root = base[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') root++;
  if (m[2] === 'b' || m[2] === '♭') root--;
  const minor = !!m[3] && /^m(in)?/i.test(m[3]) && !/^maj/i.test(m[3]);
  return makeKey(root, minor, 0.5);
}

export const CAMELOT_COLORS = [
  '#5ee6c8', '#6fe18a', '#9ee35b', '#d6e04d', '#f5c24a', '#f79a4a',
  '#f76f6f', '#f06aa8', '#c46cf0', '#8f7cf6', '#5d9cf5', '#4cc7ef',
];

export function camelotColor(key: KeyInfo | null | undefined): string {
  if (!key) return '#6b7385';
  return CAMELOT_COLORS[(parseInt(key.camelot, 10) - 1) % 12];
}
