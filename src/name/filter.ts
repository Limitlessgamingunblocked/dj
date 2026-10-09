/*
 * The name filter (Section 3.1). The matching is here: it sees through
 * spacing, punctuation, accents and number-for-letter swaps, and checks short
 * words that hide inside innocent ones only as whole words. The word list is
 * not: it's loaded with setBlockedWords().
 *
 * TODO: supply the list (a vetted, maintained public list or a moderation
 * service) in src/name/blocklist.json; until then nothing is blocked. See TODO.md.
 */
import blocklist from './blocklist.json';

let anywhere: string[] = [];
let whole = new Set<string>();

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };

/** lower case, accents off, number-for-letter swaps undone */
export function fold(s: string): string {
  return [...s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()].map((c) => LEET[c] ?? c).join('');
}

/**
 * Set the words to refuse. `anywhere` words are refused even inside other
 * letters or spaced out; `whole` words only on their own.
 */
export function setBlockedWords(list: { anywhere?: string[]; whole?: string[] }): void {
  anywhere = (list.anywhere ?? []).map((w) => fold(w).replace(/[^a-z]/g, '')).filter((w) => w.length >= 3);
  whole = new Set((list.whole ?? []).map((w) => fold(w).replace(/[^a-z]/g, '')).filter(Boolean));
}

/** Is this name (or tagline) refused? */
export function isBlocked(text: string): boolean {
  const f = fold(text);
  const squashed = f.replace(/[^a-z]/g, '');
  if (anywhere.some((w) => squashed.includes(w))) return true;
  const words = f.split(/[^a-z]+/).filter(Boolean);
  if (words.some((w) => whole.has(w))) return true;
  // spaced-out letters ("b a d") count as one word
  const singles = f.split(/[^a-z]+/).filter((w) => w.length === 1).join('');
  return singles.length > 1 && whole.has(singles);
}

setBlockedWords(blocklist as { anywhere?: string[]; whole?: string[] });
