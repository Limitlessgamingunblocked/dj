import { describe, expect, it } from 'vitest';
import { alignKnownText, cleanHeard, filter4, listenOrder, listenWindows, lyricsFromHeard, resampleTo16k, timeKnownLyrics, trimRepeats, vocalStem, wordsToLines } from '../src/lyrics/listen';
import type { LyricWord, Lyrics } from '../src/lyrics/lyrics';
import type { VocalMap } from '../src/lyrics/vocal';
import { laneView, wordFill } from '../src/ui/Karaoke';
import { explain, statusText } from '../src/lyrics/LyricsAI';

const map = (rate: number, spans: [number, number][], duration: number): VocalMap => {
  const n = Math.round(duration * rate);
  const activity = new Float32Array(n);
  for (const [a, b] of spans) for (let f = Math.round(a * rate); f < Math.min(n, Math.round(b * rate)); f++) activity[f] = 0.8;
  return { rate, activity, onsets: [], duration };
};

const words = (spec: string, start: number, step = 0.4): LyricWord[] => spec.split(' ').map((text, i) => ({ t: start + i * step, end: start + i * step + step * 0.8, text }));

describe('the vocal stem', () => {
  it('resamples to 16 kHz and keeps a tone in the voice band', () => {
    const sr = 44100;
    const x = new Float32Array(sr);
    for (let i = 0; i < sr; i++) x[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
    const y = resampleTo16k(x, sr);
    expect(y.length).toBe(16000);
    let peak = 0;
    for (let i = 2000; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
    expect(peak).toBeGreaterThan(0.95);
  });

  it('cuts what is only in one ear and the low end', () => {
    const n = 16000;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const voice = Math.sin((2 * Math.PI * 600 * i) / 16000) * 0.5;
      const side = Math.sin((2 * Math.PI * 900 * i) / 16000) * 0.5;
      const kick = Math.sin((2 * Math.PI * 50 * i) / 16000) * 0.8;
      l[i] = voice + side + kick;
      r[i] = voice - side + kick;
    }
    const v = vocalStem(l, r);
    // compare energy at 600 Hz (kept) against 50 Hz (cut) after the stem: correlate with each
    const corr = (f: number) => {
      let a = 0;
      let b = 0;
      for (let i = 4000; i < n; i++) {
        a += v[i] * Math.sin((2 * Math.PI * f * i) / 16000);
        b += v[i] * Math.cos((2 * Math.PI * f * i) / 16000);
      }
      return Math.hypot(a, b) / (n - 4000);
    };
    expect(corr(600)).toBeGreaterThan(corr(50) * 20);
    expect(corr(900)).toBeLessThan(corr(600) * 0.05);
  });

  it('filters in place without blowing up', () => {
    const x = new Float32Array(1000).fill(1);
    filter4(x, 'highpass', 140, 16000);
    expect(Math.abs(x[999])).toBeLessThan(0.01);
  });
});

describe('where to listen', () => {
  it('listens only where the vocals are, padded and merged', () => {
    const v = map(50, [
      [10, 20],
      [21, 25],
      [60, 70],
    ], 120);
    const w = listenWindows(v, 120);
    expect(w.length).toBe(2);
    expect(w[0].start).toBeCloseTo(9.5, 1);
    expect(w[0].end).toBeCloseTo(25.5, 1);
    expect(w[1].start).toBeCloseTo(59.5, 1);
  });

  it('cuts long stretches under the model’s 30 s, at the quietest point', () => {
    const v = map(50, [[5, 80]], 100);
    // a dip at 27 s
    for (let f = 27 * 50; f < 27.3 * 50; f++) v.activity[f] = 0.3;
    const w = listenWindows(v, 100);
    for (const x of w) expect(x.end - x.start).toBeLessThanOrEqual(28.01);
    expect(w[0].end).toBeCloseTo(27, 0);
    expect(w[w.length - 1].end).toBeCloseTo(80.5, 1);
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBeCloseTo(w[i - 1].end, 5);
  });

  it('listens to the whole track when it finds hardly any vocals', () => {
    const w = listenWindows(map(50, [[10, 11]], 90), 90);
    expect(w[0].start).toBe(0);
    expect(w[w.length - 1].end).toBeCloseTo(90, 5);
  });

  it('starts with the window under the playhead', () => {
    const w = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
      { start: 40, end: 50 },
    ];
    expect(listenOrder(w, 25)).toEqual([1, 2, 0]);
    expect(listenOrder(w, 0)).toEqual([0, 1, 2]);
    expect(listenOrder(w, 60)).toEqual([0, 1, 2]);
  });
});

describe('cleaning what the model heard', () => {
  const win = { start: 30, end: 58 };
  it('moves words into track time and joins split words', () => {
    const w = cleanHeard(
      [
        { text: ' I', timestamp: [0.5, 0.7] },
        { text: ' don', timestamp: [0.7, 0.9] },
        { text: "'t", timestamp: [0.9, 1.0] },
        { text: ' know', timestamp: [1.0, 1.6] },
      ],
      win,
    );
    expect(w.map((x) => x.text)).toEqual(['I', "don't", 'know']);
    expect(w[0].t).toBeCloseTo(30.5, 5);
  });

  it('drops music tags, credits and invented sign-offs', () => {
    expect(cleanHeard([{ text: ' [Music]', timestamp: [0, 3] }], win)).toEqual([]);
    expect(cleanHeard([{ text: ' (upbeat', timestamp: [0, 1] }, { text: ' music)', timestamp: [1, 2] }, { text: ' Hold', timestamp: [3, 3.5] }], win).map((x) => x.text)).toEqual(['Hold']);
    expect(cleanHeard([{ text: ' ♪', timestamp: [0, 3] }], win)).toEqual([]);
    expect(cleanHeard([{ text: ' Thank', timestamp: [0, 0.5] }, { text: ' you.', timestamp: [0.5, 1] }], win)).toEqual([]);
    expect(cleanHeard([{ text: ' Subtitles', timestamp: [0, 0.5] }, { text: ' by', timestamp: [0.5, 1] }, { text: ' Amara.org', timestamp: [1, 2] }], win)).toEqual([]);
  });

  it('drops a pile-up of words at one instant (the model looping)', () => {
    const chunks = [{ text: ' Feel', timestamp: [1, 1.4] as [number, number] }, ...Array.from({ length: 5 }, () => ({ text: ' it', timestamp: [27.9, 27.9] as [number, number] }))];
    expect(cleanHeard(chunks, win).map((x) => x.text)).toEqual(['Feel']);
  });

  it('cuts runaway repeats but keeps a real hook’s repeats', () => {
    const many = words(Array(12).fill('na').join(' '), 0, 0.3);
    expect(trimRepeats(many).length).toBe(4);
    const hook = words('la la la la la', 0);
    expect(trimRepeats(hook).length).toBe(5);
  });
});

describe('heard words into karaoke lines', () => {
  it('breaks on breaths and sentence ends', () => {
    const w = [...words('Hold me closer tonight.', 10), ...words('Don’t let go', 11.6), ...words('never let me go', 16)];
    const lines = wordsToLines(w);
    expect(lines.map((l) => l.text)).toEqual(['Hold me closer tonight', 'Don’t let go', 'never let me go']);
    expect(lines[0].t).toBeCloseTo(10, 5);
    for (let i = 1; i < lines.length; i++) expect(lines[i].t).toBeGreaterThanOrEqual(lines[i - 1].end);
  });

  it('never runs past nine words', () => {
    const lines = wordsToLines(words('one two three four five six seven eight nine ten eleven twelve', 0, 0.3));
    expect(lines[0].words.length).toBeLessThanOrEqual(9);
    expect(lines.length).toBe(2);
  });

  it('marks repeated lines as hooks and tags the lyrics as the AI’s', () => {
    const w = [...words('feel the bass', 0), ...words('in my soul', 3), ...words('feel the bass', 6)];
    const l = lyricsFromHeard(w, 'whisper-base')!;
    expect(l.source).toBe('ai');
    expect(l.timing).toBe('word');
    expect(l.ai?.model).toBe('whisper-base');
    expect(l.lines[0].hook && l.lines[2].hook).toBe(true);
    expect(l.lines[1].hook).toBe(false);
  });
});

describe('timing lyrics you have from what was heard', () => {
  const known = [
    { text: 'Gonna take you higher', hook: false },
    { text: 'Hands up to the sky', hook: true },
  ];
  it('keeps your words and takes the heard timing, near-misses included', () => {
    const heard = [...words('going to take ya higher', 20, 0.5), ...words('hands up to the sky', 24, 0.5)];
    const r = alignKnownText(known, heard, 200)!;
    expect(r.lines.map((l) => l.text)).toEqual(['Gonna take you higher', 'Hands up to the sky']);
    expect(r.lines[1].hook).toBe(true);
    const w0 = r.lines[0].words;
    // take / higher matched exactly
    expect(w0[1].t).toBeCloseTo(21, 5);
    expect(w0[3].t).toBeCloseTo(22, 5);
    expect(r.lines[1].t).toBeCloseTo(24, 5);
    expect(r.matched).toBeGreaterThan(0.7);
  });

  it('spreads words the model missed between the ones it heard', () => {
    const heard = [...words('take', 21), ...words('sky', 26)];
    const r = alignKnownText(known, heard, 200)!;
    const all = r.lines.flatMap((l) => l.words);
    for (let i = 1; i < all.length; i++) expect(all[i].t).toBeGreaterThanOrEqual(all[i - 1].t);
    expect(all.find((w) => w.text === 'up')!.t).toBeGreaterThan(21);
    expect(all.find((w) => w.text === 'up')!.t).toBeLessThan(26);
  });

  it('gives up when the lyrics are for a different song', () => {
    const lyr: Lyrics = { source: 'pasted', timing: 'none', offset: 0, raw: '', lines: known.map((k) => ({ ...k, t: 0, end: 0, words: [] })) };
    expect(timeKnownLyrics(lyr, words('something else entirely here tonight baby', 3), 100, 'm')).toBeNull();
    const ok = timeKnownLyrics(lyr, [...words('gonna take you higher', 5), ...words('hands up to the sky', 9)], 100, 'm')!;
    expect(ok.lyrics.timing).toBe('word');
    expect(ok.lyrics.source).toBe('pasted');
    expect(ok.lyrics.ai?.timedOnly).toBe(true);
  });
});

describe('the karaoke lane', () => {
  const lines = wordsToLines([...words('first line here', 2), ...words('second line', 12), ...words('third', 13.5)]);
  const frame = (pos: number) => {
    let index = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i].t <= pos + 0.05) index = i;
    const cur = index >= 0 ? lines[index] : null;
    return { lines, index, line: cur && pos <= cur.end + 0.6 ? cur : null, next: lines[index + 1] ?? null, pos, beatLen: 0.5 };
  };

  it('fills each word over the time it is sung', () => {
    const w = { t: 1, end: 2 };
    expect(wordFill(w, 0.5)).toBe(0);
    expect(wordFill(w, 1.5)).toBeCloseTo(0.5, 5);
    expect(wordFill(w, 3)).toBe(1);
  });

  it('shows the line being sung with the next one underneath', () => {
    const v = laneView(frame(2.5));
    expect(v.show?.text).toBe('first line here');
    expect(v.upcoming?.text).toBe('second line');
    expect(v.count).toBe(0);
  });

  it('counts in on the beat before a line after a long gap', () => {
    const far = laneView(frame(6));
    expect(far.show).toBeNull();
    expect(far.upcoming?.text).toBe('second line');
    const near = laneView(frame(10.6));
    expect(near.show?.text).toBe('second line');
    expect(near.count).toBe(3);
    expect(near.upcoming?.text).toBe('third');
  });
});

describe('AI lyrics in words', () => {
  it('says what it is doing', () => {
    expect(statusText({ trackId: 'x', mode: 'detect', status: 'listening', progress: 0.42, overall: 0.7, lines: 3 })).toBe('Listening 42%');
    expect(statusText({ trackId: 'x', mode: 'time', status: 'listening', progress: 0.5, overall: 0.7, lines: 0 })).toBe('Timing the words 50%');
    expect(statusText({ trackId: 'x', mode: 'detect', status: 'download', progress: 0.1, overall: 0.1, lines: 0 })).toBe('Downloading the AI model 10%');
  });
  it('explains a failed download', () => {
    expect(explain('Failed to fetch')).toMatch(/couldn’t download/);
    expect(explain('weird')).toMatch(/weird/);
  });
});
