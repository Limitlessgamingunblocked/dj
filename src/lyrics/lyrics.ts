/*
 * Lyrics: the data model plus every text format they arrive in.
 *   – LRC (line timestamps), enhanced LRC (<mm:ss.xx> per word), [offset:]
 *   – plain text (with [Chorus]-style section markers)
 *   – ID3 SYLT frames (synced), USLT / Vorbis LYRICS / MP4 ©lyr (text or LRC)
 *   – LRCLIB API responses (opt-in online lookup)
 * Lines get word timings (exact from enhanced LRC, otherwise spread by
 * syllables and later snapped to vocal onsets) and repeated lines are marked
 * as hooks, which the stage uses for key-phrase lighting hits.
 */

export interface LyricWord {
  t: number;
  end: number;
  text: string;
}

export interface LyricLine {
  t: number;
  end: number;
  text: string;
  words: LyricWord[];
  /** chorus / repeated key phrase */
  hook: boolean;
}

export type LyricSource = 'tags' | 'lrc' | 'pasted' | 'lrclib' | 'demo' | 'tapped';

export interface Lyrics {
  source: LyricSource;
  /** word: every word timed exactly · line: line times, words estimated · auto: aligned to the vocals · none: not timed yet */
  timing: 'word' | 'line' | 'auto' | 'none';
  /** seconds added to every timestamp (fine alignment) */
  offset: number;
  lines: LyricLine[];
  /** the text as it came in (LRC or plain) */
  raw: string;
}

const TS = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TS = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;

function stamp(m: string, s: string): number {
  return parseInt(m, 10) * 60 + parseFloat(s.replace(':', '.'));
}

export function isLrc(text: string): boolean {
  let n = 0;
  for (const line of text.split(/\r?\n/)) if (/^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(line)) n++;
  return n >= 2;
}

/** Rough syllable count, used to spread a line's time over its words. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!w) return 1;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Spread a line's words over [t, end] by syllables (a sung line rarely fills the whole gap). */
export function spreadWords(text: string, t: number, end: number): LyricWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const weights = tokens.map((w) => syllables(w) + 0.35);
  const total = weights.reduce((a, b) => a + b, 0);
  const sung = Math.max(0.2, Math.min((end - t) * 0.92, total * 0.34 + 0.35));
  const out: LyricWord[] = [];
  let at = t;
  tokens.forEach((w, i) => {
    const d = (weights[i] / total) * sung;
    out.push({ t: at, end: at + d, text: w });
    at += d;
  });
  return out;
}

/** Mark repeated lines (and lines under [Chorus]/[Hook] markers) as hooks. */
export function markHooks(lines: { text: string; hook: boolean }[]): void {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const count = new Map<string, number>();
  for (const l of lines) count.set(norm(l.text), (count.get(norm(l.text)) ?? 0) + 1);
  for (const l of lines) if ((count.get(norm(l.text)) ?? 0) >= 2 && norm(l.text).length >= 3) l.hook = true;
}

/** Finish raw timed lines: sort, set ends from the next line, time the words, mark hooks. */
function finish(raw: { t: number; text: string; words?: { t: number; text: string }[]; hook?: boolean }[], duration?: number): LyricLine[] {
  const rows = raw.filter((r) => r.text.trim()).sort((a, b) => a.t - b.t);
  const lines: LyricLine[] = rows.map((r, i) => {
    const next = rows[i + 1]?.t ?? (duration ?? r.t + 6);
    const end = Math.max(r.t + 0.3, Math.min(next, r.t + 12));
    let words: LyricWord[];
    if (r.words?.length) {
      words = r.words.map((w, j) => ({ t: w.t, end: r.words![j + 1]?.t ?? Math.min(end, w.t + 0.6), text: w.text.trim() })).filter((w) => w.text);
    } else words = spreadWords(r.text.trim(), r.t, end);
    return { t: r.t, end, text: r.text.trim(), words, hook: !!r.hook };
  });
  markHooks(lines);
  return lines;
}

/** Parse LRC / enhanced LRC. Returns null when the text isn't LRC. */
export function parseLrc(text: string, duration?: number): { lines: LyricLine[]; word: boolean } | null {
  if (!isLrc(text)) return null;
  let offset = 0;
  const rows: { t: number; text: string; words?: { t: number; text: string }[] }[] = [];
  let word = false;
  for (const line of text.split(/\r?\n/)) {
    const off = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(line);
    if (off) {
      offset = parseInt(off[1], 10) / 1000;
      continue;
    }
    const times: number[] = [];
    TS.lastIndex = 0;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = TS.exec(line)) && m.index === last) {
      times.push(stamp(m[1], m[2]));
      last = TS.lastIndex;
    }
    if (!times.length) continue;
    const body = line.slice(last);
    let words: { t: number; text: string }[] | undefined;
    if (WORD_TS.test(body)) {
      word = true;
      words = [];
      const parts = body.split(WORD_TS);
      // split gives [pre, m, s, text, m, s, text, ...]
      for (let i = 1; i + 2 < parts.length; i += 3) {
        const t = stamp(parts[i], parts[i + 1]);
        for (const w of parts[i + 2].split(/\s+/).filter(Boolean)) words.push({ t, text: w });
      }
      // several words after one stamp share it; spread them a little
      for (let i = 1; i < words.length; i++) if (words[i].t <= words[i - 1].t) words[i].t = words[i - 1].t + 0.12;
    }
    WORD_TS.lastIndex = 0;
    const clean = body.replace(WORD_TS, '').replace(/\s+/g, ' ').trim();
    for (const t of times) rows.push({ t: t - offset, text: clean, words: words?.map((w) => ({ t: w.t - offset + (t - times[0]), text: w.text })) });
  }
  if (!rows.length) return null;
  return { lines: finish(rows, duration), word };
}

/** Plain text → untimed lines ([Chorus] / (Hook) / "Chorus:" markers flag the lines that follow as hooks). */
export function parsePlain(text: string): { text: string; hook: boolean }[] {
  const out: { text: string; hook: boolean }[] = [];
  let hookSection = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const marker = /^[[(]?\s*(chorus|hook|refrain|pre-?chorus|verse|bridge|intro|outro|drop|break)[^\])]*[\])]?:?$/i.exec(line);
    if (marker) {
      hookSection = /chorus|hook|refrain|drop/i.test(marker[1]) && !/pre/i.test(marker[1]);
      continue;
    }
    out.push({ text: line, hook: hookSection });
  }
  markHooks(out);
  return out;
}

/** Lyrics from any text: LRC is timed right away; plain text waits for alignment. */
export function lyricsFromText(text: string, source: LyricSource, duration?: number): Lyrics | null {
  const t = text.replace(/\r/g, '').trim();
  if (!t) return null;
  const lrc = parseLrc(t, duration);
  if (lrc) return { source, timing: lrc.word ? 'word' : 'line', offset: 0, lines: lrc.lines, raw: t };
  const plain = parsePlain(t);
  if (!plain.length) return null;
  return { source, timing: 'none', offset: 0, lines: plain.map((p) => ({ t: 0, end: 0, text: p.text, words: [], hook: p.hook })), raw: t };
}

/** From an ID3 SYLT frame's (time, text) events. */
export function lyricsFromSynced(events: { t: number; text: string }[], duration?: number): Lyrics | null {
  if (!events.length) return null;
  // SYLT often carries one event per word or syllable: group into lines on newlines or pauses
  const rows: { t: number; text: string; words: { t: number; text: string }[] }[] = [];
  let cur: (typeof rows)[number] | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const newLine = !cur || /^[\r\n]/.test(e.text) || e.t - (events[i - 1]?.t ?? e.t) > 1.6 || cur.words.length > 12;
    const txt = e.text.replace(/[\r\n]/g, ' ').trim();
    if (newLine) {
      cur = { t: e.t, text: '', words: [] };
      rows.push(cur);
    }
    if (txt) {
      cur!.words.push({ t: e.t, text: txt });
      cur!.text = `${cur!.text} ${txt}`.trim();
    }
  }
  const lines = finish(rows, duration);
  return { source: 'tags', timing: 'word', offset: 0, lines, raw: lines.map((l) => l.text).join('\n') };
}

function fmt(t: number): string {
  const m = Math.floor(Math.max(0, t) / 60);
  const s = Math.max(0, t) - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Enhanced LRC with the current timings (and offset applied), for saving or editing. */
export function toLrc(l: Lyrics): string {
  return l.lines
    .map((line) => `[${fmt(line.t + l.offset)}]${line.words.length ? line.words.map((w) => `<${fmt(w.t + l.offset)}>${w.text}`).join(' ') : line.text}`)
    .join('\n');
}

/** Re-time a line's words from new line bounds (after tap-sync or offset edits). */
export function retime(line: LyricLine, t: number, end: number): void {
  line.t = t;
  line.end = end;
  line.words = spreadWords(line.text, t, end);
}

/** LRCLIB (lrclib.net) response → lyrics text (synced preferred). */
export function parseLrclib(json: unknown): string | null {
  const pick = (o: unknown): string | null => {
    if (!o || typeof o !== 'object') return null;
    const r = o as { syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean };
    if (r.instrumental) return null;
    return r.syncedLyrics || r.plainLyrics || null;
  };
  if (Array.isArray(json)) {
    const synced = json.find((x) => x && typeof x === 'object' && (x as { syncedLyrics?: string }).syncedLyrics);
    return pick(synced ?? json[0]);
  }
  return pick(json);
}

/** Opt-in online lookup. Sends artist, title and duration to lrclib.net. */
export async function lrclibLookup(artist: string, title: string, duration: number): Promise<string | null> {
  const q = new URLSearchParams({ artist_name: artist, track_name: title, duration: String(Math.round(duration)) });
  const get = async (url: string) => {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`LRCLIB answered ${r.status}`);
    return r.json();
  };
  const exact = parseLrclib(await get(`https://lrclib.net/api/get?${q}`));
  if (exact) return exact;
  return parseLrclib(await get(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${artist} ${title}` })}`));
}

/** Current line index at time `pos` (binary search), −1 before the first line. */
export function lineAt(lines: LyricLine[], pos: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= pos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
