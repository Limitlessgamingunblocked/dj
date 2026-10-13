/*
 * AI lyrics, the pure parts (no model, no DOM, so they run in tests and in
 * the listening worker alike):
 *   – the vocal stem the model hears: 16 kHz, the centre of the mix with the
 *     lows cut, the way the stems' "vocals" knob hears it
 *   – where to listen: the sung stretches of the track (from the vocal map),
 *     cut into windows the speech model takes (under 30 s)
 *   – cleaning what the model heard: music tags, the stock phrases speech
 *     models invent over instrumentals, runaway repeats
 *   – grouping heard words into karaoke lines
 *   – timing lyrics you already have (pasted, looked up) word by word from
 *     what the model heard, by aligning the two word lists
 */
import { markHooks, syllables, type LyricLine, type LyricWord, type Lyrics } from './lyrics';
import type { VocalMap } from './vocal';

/** the speech model's sample rate */
export const LISTEN_RATE = 16000;
/** the longest window the model takes at once (its limit is 30 s) */
export const MAX_WINDOW = 28;

/* ---------------- the vocal stem ---------------- */

/** RBJ biquad, run in place. */
function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

function coeffs(type: 'lowpass' | 'highpass', f: number, sr: number, q = Math.SQRT1_2): [number, number, number, number, number] {
  const w = (2 * Math.PI * Math.min(f, sr * 0.49)) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b1 = type === 'lowpass' ? 1 - cos : -(1 + cos);
  const b0 = type === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2;
  return [b0 / a0, b1 / a0, b0 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

/** A 4th-order (Linkwitz–Riley) filter in place: two Butterworth passes. */
export function filter4(x: Float32Array, type: 'lowpass' | 'highpass', f: number, sr: number): void {
  const c = coeffs(type, f, sr);
  biquad(x, ...c);
  biquad(x, ...c);
}

/** One channel to 16 kHz: low-passed under the new Nyquist, then sampled with linear interpolation. */
export function resampleTo16k(ch: Float32Array, sr: number): Float32Array {
  if (sr === LISTEN_RATE) return ch.slice();
  const src = ch.slice();
  if (sr > LISTEN_RATE) filter4(src, 'lowpass', LISTEN_RATE * 0.45, sr);
  const n = Math.floor((src.length * LISTEN_RATE) / sr);
  const out = new Float32Array(n);
  const step = sr / LISTEN_RATE;
  for (let i = 0; i < n; i++) {
    const p = i * step;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = src[j] * (1 - f) + (src[j + 1] ?? src[j]) * f;
  }
  return out;
}

/** The vocal stem from 16 kHz left and right: the centre (what's the same in both ears), lows and kick cut. */
export function vocalStem(l: Float32Array, r: Float32Array): Float32Array {
  const n = Math.min(l.length, r.length);
  const mid = new Float32Array(n);
  for (let i = 0; i < n; i++) mid[i] = (l[i] + r[i]) * 0.5;
  filter4(mid, 'highpass', 140, LISTEN_RATE);
  // even out the level: speech models like a steady, healthy signal
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mid[i]));
  if (peak > 1e-4) {
    const g = 0.9 / peak;
    for (let i = 0; i < n; i++) mid[i] *= g;
  }
  return mid;
}

/* ---------------- where to listen ---------------- */

export interface Window {
  start: number;
  end: number;
}

/**
 * The sung stretches of a track as windows for the model: vocal activity
 * over a low bar (missing a quiet vocal costs more than listening to a pad),
 * short gaps bridged, padded, and long stretches cut where the vocal is
 * quietest. Too little found (a heavily processed vocal, say) and the whole
 * track is listened to.
 */
export function listenWindows(v: VocalMap, duration: number): Window[] {
  const n = v.activity.length;
  const rate = v.rate;
  const on = (f: number) => v.activity[f] > 0.28;
  const runs: Window[] = [];
  let s = -1;
  let lastOn = -1;
  for (let f = 0; f <= n; f++) {
    if (f < n && on(f)) {
      if (s < 0) s = f;
      else if (f - lastOn > rate * 1.2) {
        runs.push({ start: s / rate, end: (lastOn + 1) / rate });
        s = f;
      }
      lastOn = f;
    } else if (f === n && s >= 0) runs.push({ start: s / rate, end: (lastOn + 1) / rate });
  }
  const sung = runs.filter((r) => r.end - r.start >= 0.35);
  const covered = sung.reduce((a, r) => a + (r.end - r.start), 0);
  let regions: Window[];
  if (!sung.length || covered < Math.min(12, duration * 0.08)) regions = [{ start: 0, end: duration }];
  else {
    regions = [];
    for (const r of sung) {
      const w = { start: Math.max(0, r.start - 0.5), end: Math.min(duration, r.end + 0.5) };
      const prev = regions[regions.length - 1];
      if (prev && w.start - prev.end < 1.5) prev.end = Math.max(prev.end, w.end);
      else regions.push(w);
    }
  }
  // cut anything longer than the model takes at the quietest point 15–28 s in
  const act = (t: number) => v.activity[Math.min(n - 1, Math.max(0, Math.round(t * rate)))] ?? 0;
  const out: Window[] = [];
  for (const r of regions) {
    let a = r.start;
    while (r.end - a > MAX_WINDOW) {
      let best = a + MAX_WINDOW;
      let bestV = Infinity;
      for (let t = a + 15; t <= a + MAX_WINDOW; t += 0.05) {
        const x = act(t);
        if (x < bestV - 1e-6) {
          bestV = x;
          best = t;
        }
      }
      out.push({ start: a, end: best });
      a = best;
    }
    if (r.end - a >= 0.8) out.push({ start: a, end: r.end });
    else if (out.length && out[out.length - 1].end === a) out[out.length - 1].end = r.end;
  }
  return out;
}

/** The windows in listening order: from the one under the playhead to the end, then the start. */
export function listenOrder(windows: Window[], from: number): number[] {
  const idx = windows.map((_, i) => i);
  const first = windows.findIndex((w) => w.end > from);
  if (first <= 0) return idx;
  return [...idx.slice(first), ...idx.slice(0, first)];
}

/* ---------------- what the model heard ---------------- */

/** a word chunk as the speech pipeline returns it (seconds, from the window's start) */
export interface HeardChunk {
  text: string;
  timestamp: [number, number | null];
}

/** the stock lines speech models invent over music and silence */
const INVENTED = /^(thank you( (so|very) much)?( for watching)?|thanks for watching|please subscribe|subscribe|you|bye|bye bye|so|oh|uh|um|hmm|the end|music|applause|silence|amen)$/;
const CREDITS = /subtitles? (by|from)|captions? by|transcri(bed|ption) by|amara\.org|www\.|\.com\b|copyright|all rights reserved/i;

export const normWord = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}']/gu, '')
    .replace(/^'+|'+$/g, '');

/**
 * One window's chunks → clean words in track time. Drops music tags ([Music],
 * (upbeat music), ♪), invented sign-offs and credits, and the pile-ups a
 * speech model leaves when it loops (several words stamped at one instant).
 */
export function cleanHeard(chunks: HeardChunk[], win: Window): LyricWord[] {
  const raw: LyricWord[] = [];
  let bracket = 0;
  for (const c of chunks) {
    let text = c.text;
    const opens = (text.match(/[[(]/g) ?? []).length;
    const closes = (text.match(/[\])]/g) ?? []).length;
    const inside = bracket > 0 || opens > 0;
    bracket = Math.max(0, bracket + opens - closes);
    if (inside || /[♪♫*#]/.test(text)) continue;
    text = text.replace(/[♪♫]/g, '');
    const t0 = c.timestamp[0];
    const t1 = c.timestamp[1] ?? t0 + 0.3;
    if (!Number.isFinite(t0)) continue;
    const word = { t: win.start + t0, end: win.start + Math.max(t0 + 0.05, t1), text: text.trim() };
    if (!word.text) continue;
    // a chunk with no leading space carries on the word before ("don" + "'t")
    const prev = raw[raw.length - 1];
    if (prev && !/^\s/.test(text) && /^[\p{L}\p{N}']/u.test(word.text) && word.t - prev.end < 0.2) {
      prev.text += word.text;
      prev.end = Math.max(prev.end, word.end);
    } else raw.push(word);
  }
  // inside the window only
  let words = raw.filter((w) => w.t < win.end + 0.25 && normWord(w.text)).map((w) => ({ ...w, end: Math.min(w.end, win.end + 0.5) }));
  // pile-ups: three or more words starting at the same instant is the model looping
  const out: LyricWord[] = [];
  for (let i = 0; i < words.length; i++) {
    let j = i;
    while (j + 1 < words.length && Math.abs(words[j + 1].t - words[i].t) < 0.02) j++;
    if (j - i >= 2) {
      i = j;
      continue;
    }
    out.push(words[i]);
  }
  words = out;
  // a runaway repeat: the same short phrase more than six times in a row in one window
  words = trimRepeats(words);
  const text = words.map((w) => normWord(w.text)).join(' ');
  if (!text || INVENTED.test(text) || CREDITS.test(words.map((w) => w.text).join(' '))) return [];
  return words;
}

/** Cut a phrase of 1–4 words repeated back to back more than six times down to four times. */
export function trimRepeats(words: LyricWord[]): LyricWord[] {
  const key = words.map((w) => normWord(w.text));
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i + n * 7 <= key.length; i++) {
      let reps = 1;
      while (i + (reps + 1) * n <= key.length && key.slice(i + reps * n, i + (reps + 1) * n).join(' ') === key.slice(i, i + n).join(' ')) reps++;
      if (reps > 6) {
        const keep = i + 4 * n;
        const drop = (reps - 4) * n;
        return trimRepeats([...words.slice(0, keep), ...words.slice(keep + drop)]);
      }
    }
  }
  return words;
}

/* ---------------- heard words → karaoke lines ---------------- */

const END_PUNCT = /[.?!…]["”’)]?$/;

/**
 * Group words into sung lines: a breath (a gap over half a second) or the end
 * of a sentence starts a new one, a comma does in a long line, and no line
 * runs past nine words or about five seconds.
 */
export function wordsToLines(words: LyricWord[]): LyricLine[] {
  const sorted = [...words].sort((a, b) => a.t - b.t);
  const lines: LyricLine[] = [];
  let cur: LyricWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    const ws = cur.map((w, i) => ({ ...w, text: i === cur.length - 1 ? w.text.replace(/[.,;:]+$/, '') : w.text }));
    lines.push({ t: ws[0].t, end: ws[ws.length - 1].end, text: ws.map((w) => w.text).join(' '), words: ws, hook: false });
    cur = [];
  };
  for (const w of sorted) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = w.t - prev.end;
      const len = cur.length;
      const span = w.end - cur[0].t;
      if (gap > 0.5 || w.t - prev.t > 2.4 || (END_PUNCT.test(prev.text) && len >= 3) || (/,$/.test(prev.text) && len >= 5) || len >= 9 || (span > 5.2 && len >= 3)) flush();
    }
    cur.push({ ...w });
  }
  flush();
  // keep each line's words inside it and the lines in order
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1];
    if (next && l.end > next.t) l.end = Math.max(l.t + 0.2, next.t - 0.02);
    for (const w of l.words) w.end = Math.min(w.end, l.end);
  }
  markHooks(lines);
  return lines;
}

/** Heard words → lyrics, word-timed. */
export function lyricsFromHeard(words: LyricWord[], model: string): Lyrics | null {
  const lines = wordsToLines(words);
  if (!lines.length) return null;
  return { source: 'ai', timing: 'word', offset: 0, lines, raw: lines.map((l) => l.text).join('\n'), ai: { model, at: Date.now() } };
}

/* ---------------- timing known lyrics from what was heard ---------------- */

/** Edit distance, for near-misses ("gonna" / "going", "ya" / "you"). */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[n];
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(0, 1 - lev(a, b) / Math.max(a.length, b.length));
}

export interface AlignResult {
  lines: LyricLine[];
  /** the share of your words the model heard */
  matched: number;
}

/**
 * Time lyrics you already have from the words the model heard. The two word
 * lists are aligned (Needleman–Wunsch: a match scores by how alike the words
 * are, skipping a word on either side costs a little), each matched word
 * takes the heard word's time, and the words between matches are spread over
 * the gap by syllables. The text stays yours; only the timing comes from the
 * model. A line keeps its hook flag.
 */
export function alignKnownText(known: { text: string; hook: boolean }[], heard: LyricWord[], duration: number): AlignResult | null {
  const K: { text: string; line: number; key: string }[] = [];
  known.forEach((l, li) => {
    for (const w of l.text.split(/\s+/).filter(Boolean)) K.push({ text: w, line: li, key: normWord(w) });
  });
  const H = heard.map((w) => ({ ...w, key: normWord(w.text) }));
  if (!K.length || !H.length) return null;
  const m = K.length;
  const n = H.length;
  const GAP = -0.35;
  const score = new Float32Array((m + 1) * (n + 1));
  const move = new Uint8Array((m + 1) * (n + 1)); // 1 diag, 2 up (skip known), 3 left (skip heard)
  const at = (i: number, j: number) => i * (n + 1) + j;
  for (let i = 1; i <= m; i++) {
    score[at(i, 0)] = i * GAP;
    move[at(i, 0)] = 2;
  }
  for (let j = 1; j <= n; j++) {
    score[at(0, j)] = j * GAP;
    move[at(0, j)] = 3;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sim = similarity(K[i - 1].key, H[j - 1].key);
      const d = score[at(i - 1, j - 1)] + (sim >= 0.5 ? sim * 2 - 0.6 : -1.2);
      const u = score[at(i - 1, j)] + GAP;
      const l = score[at(i, j - 1)] + GAP;
      if (d >= u && d >= l) {
        score[at(i, j)] = d;
        move[at(i, j)] = 1;
      } else if (u >= l) {
        score[at(i, j)] = u;
        move[at(i, j)] = 2;
      } else {
        score[at(i, j)] = l;
        move[at(i, j)] = 3;
      }
    }
  }
  // walk back: which heard word each known word got
  const pair = new Int32Array(m).fill(-1);
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const mv = move[at(i, j)];
    if (mv === 1) {
      if (similarity(K[i - 1].key, H[j - 1].key) >= 0.5) pair[i - 1] = j - 1;
      i--;
      j--;
    } else if (mv === 2) i--;
    else j--;
  }
  const matched = pair.reduce((s, p) => s + (p >= 0 ? 1 : 0), 0) / m;
  // times: matched words from the model, the rest spread between their neighbours
  const t = new Float64Array(m);
  const e = new Float64Array(m);
  const anchors: number[] = [];
  for (let k = 0; k < m; k++) {
    if (pair[k] >= 0) {
      t[k] = H[pair[k]].t;
      e[k] = H[pair[k]].end;
      anchors.push(k);
    }
  }
  if (!anchors.length) return { lines: [], matched: 0 };
  const fill = (from: number, to: number, a: number, b: number) => {
    // words from..to (inclusive) share [a, b] by syllables
    const ws = [];
    for (let k = from; k <= to; k++) ws.push(syllables(K[k].text) + 0.35);
    const tot = ws.reduce((s, x) => s + x, 0);
    let at2 = a;
    for (let k = from; k <= to; k++) {
      const d = ((ws[k - from] / tot) * Math.max(0.1, b - a));
      t[k] = at2;
      e[k] = at2 + d;
      at2 += d;
    }
  };
  // before the first anchor: back from it at a sung pace
  const first = anchors[0];
  if (first > 0) {
    const need = first * 0.32;
    fill(0, first - 1, Math.max(0, t[first] - need), t[first]);
  }
  for (let a = 0; a + 1 < anchors.length; a++) {
    const k0 = anchors[a];
    const k1 = anchors[a + 1];
    if (k1 - k0 > 1) fill(k0 + 1, k1 - 1, e[k0], t[k1]);
  }
  const last = anchors[anchors.length - 1];
  if (last < m - 1) fill(last + 1, m - 1, e[last], Math.min(duration || Infinity, e[last] + (m - 1 - last) * 0.32));
  // build the lines; a line starts where its first word does
  const lines: LyricLine[] = known.map((l) => ({ t: 0, end: 0, text: l.text, words: [], hook: l.hook }));
  for (let k = 0; k < m; k++) lines[K[k].line].words.push({ t: t[k], end: Math.max(t[k] + 0.06, e[k]), text: K[k].text });
  const out = lines.filter((l) => l.words.length);
  for (const l of out) {
    // keep words in order inside a line (a model's slip can cross two)
    for (let w = 1; w < l.words.length; w++) if (l.words[w].t < l.words[w - 1].t) l.words[w].t = l.words[w - 1].t + 0.05;
    l.t = l.words[0].t;
    l.end = l.words[l.words.length - 1].end;
  }
  for (let k = 0; k + 1 < out.length; k++) if (out[k].end > out[k + 1].t) out[k].end = Math.max(out[k].t + 0.2, out[k + 1].t - 0.02);
  for (const l of out) for (const w of l.words) w.end = Math.min(w.end, l.end);
  return { lines: out, matched };
}

/** Lyrics that keep their text and take the model's timing (falls back to null when too little matched). */
export function timeKnownLyrics(known: Lyrics, heard: LyricWord[], duration: number, model: string): { lyrics: Lyrics; matched: number } | null {
  const r = alignKnownText(
    known.lines.map((l) => ({ text: l.text, hook: l.hook })),
    heard,
    duration,
  );
  if (!r || r.matched < 0.25 || !r.lines.length) return null;
  return { lyrics: { ...known, timing: 'word', offset: 0, lines: r.lines, ai: { model, at: Date.now(), timedOnly: true } }, matched: r.matched };
}
