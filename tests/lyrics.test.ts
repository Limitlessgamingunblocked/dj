import { describe, expect, it } from 'vitest';
import { lineAt, lyricsFromSynced, lyricsFromText, parseLrc, parseLrclib, parsePlain, spreadWords, syllables, toLrc } from '../src/lyrics/lyrics';
import { alignToVocals, analyzeVocals, snapWords, type VocalMap } from '../src/lyrics/vocal';
import { demoLyrics } from './fixtures/demoLyrics';
import { readTags } from '../src/library/tags';
import { DEMO_TRACKS } from './fixtures/synth';

describe('lyrics formats', () => {
  it('parses LRC with ends, repeated stamps, offset and hooks', () => {
    const lrc = ['[ar:Someone]', '[offset:+500]', '[00:10.00]First line here', '[00:14.50][00:30.00]Hold me closer', '[00:20.25]Another one', '[00:40]'].join('\n');
    const r = parseLrc(lrc, 60)!;
    expect(r.word).toBe(false);
    const l = r.lines;
    expect(l.map((x) => x.text)).toEqual(['First line here', 'Hold me closer', 'Another one', 'Hold me closer']);
    expect(l[0].t).toBeCloseTo(9.5, 5);
    expect(l[0].end).toBeCloseTo(14.0, 5);
    expect(l[1].hook && l[3].hook).toBe(true);
    expect(l[0].hook).toBe(false);
    // words spread inside the line, in order
    const w = l[0].words;
    expect(w.map((x) => x.text)).toEqual(['First', 'line', 'here']);
    expect(w[0].t).toBeCloseTo(9.5, 5);
    for (let i = 1; i < w.length; i++) expect(w[i].t).toBeGreaterThan(w[i - 1].t);
    expect(w[w.length - 1].end).toBeLessThanOrEqual(l[0].end + 1e-6);
  });

  it('parses enhanced LRC word stamps', () => {
    const r = parseLrc('[00:01.00]<00:01.00>Feel <00:01.40>the <00:01.60>bass\n[00:03.00]<00:03.00>go <00:03.50>on', 10)!;
    expect(r.word).toBe(true);
    expect(r.lines[0].words.map((w) => [w.text, w.t])).toEqual([
      ['Feel', 1],
      ['the', 1.4],
      ['bass', 1.6],
    ]);
    expect(r.lines[0].text).toBe('Feel the bass');
    expect(r.lines[0].words[0].end).toBeCloseTo(1.4, 5);
  });

  it('round-trips through toLrc', () => {
    const a = lyricsFromText('[00:05.00]<00:05.00>one <00:05.50>two\n[00:08.00]<00:08.00>three', 'lrc', 20)!;
    const b = lyricsFromText(toLrc(a), 'lrc', 20)!;
    expect(b.timing).toBe('word');
    expect(b.lines.map((l) => l.words.map((w) => w.t))).toEqual(a.lines.map((l) => l.words.map((w) => w.t)));
  });

  it('reads plain text with section markers as untimed lines', () => {
    const p = parsePlain('[Verse 1]\nWalking down the street\n\n[Chorus]\nWe go all night\nDance until the light\n[Verse 2]\nSomething else');
    expect(p.map((x) => x.hook)).toEqual([false, true, true, false]);
    const l = lyricsFromText('just some words\nand some more', 'pasted')!;
    expect(l.timing).toBe('none');
    expect(l.lines.length).toBe(2);
    expect(lyricsFromText('   ', 'pasted')).toBeNull();
  });

  it('groups SYLT word events into lines', () => {
    const ev = [
      { t: 1, text: 'Hey' },
      { t: 1.3, text: 'there' },
      { t: 5, text: 'new' },
      { t: 5.2, text: 'line' },
    ];
    const l = lyricsFromSynced(ev, 10)!;
    expect(l.timing).toBe('word');
    expect(l.lines.map((x) => x.text)).toEqual(['Hey there', 'new line']);
    expect(l.lines[1].words[1].t).toBe(5.2);
  });

  it('reads USLT and SYLT frames from ID3 tags', () => {
    const str = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const frame = (id: string, body: number[]) => {
      const n = body.length;
      return [...str(id), (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, 0, 0, ...body];
    };
    const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    const uslt = frame('USLT', [0, ...str('eng'), 0, ...str('line one\nline two')]);
    const sylt = frame('SYLT', [0, ...str('eng'), 2, 1, 0, ...str('Hello'), 0, ...u32(1500), ...str('world'), 0, ...u32(2000)]);
    const frames = [...uslt, ...sylt];
    const size = frames.length;
    const header = [0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127];
    const t = readTags(new Uint8Array([...header, ...frames, 0xff, 0xfb, 0x90, 0x00]).buffer, 'x.mp3');
    expect(t.lyrics).toBe('line one\nline two');
    expect(t.synced).toEqual([
      { t: 1.5, text: 'Hello' },
      { t: 2, text: 'world' },
    ]);
  });

  it('picks synced lyrics from LRCLIB responses', () => {
    expect(parseLrclib({ syncedLyrics: '[00:01.00]a\n[00:02.00]b', plainLyrics: 'a\nb' })).toContain('[00:01.00]');
    expect(parseLrclib({ plainLyrics: 'x', syncedLyrics: null })).toBe('x');
    expect(parseLrclib({ instrumental: true })).toBeNull();
    expect(parseLrclib([{ plainLyrics: 'p' }, { syncedLyrics: '[00:01.00]s\n[00:02.00]t' }])).toContain('s');
  });

  it('finds the current line and counts syllables', () => {
    const l = lyricsFromText('[00:01.00]a\n[00:03.00]b\n[00:05.00]c', 'lrc', 8)!.lines;
    expect(lineAt(l, 0.5)).toBe(-1);
    expect(lineAt(l, 1)).toBe(0);
    expect(lineAt(l, 4.9)).toBe(1);
    expect(lineAt(l, 99)).toBe(2);
    expect(syllables('beautiful')).toBe(3);
    expect(syllables('night')).toBe(1);
    const w = spreadWords('dance all night long', 10, 14);
    expect(w.length).toBe(4);
    expect(w[0].t).toBe(10);
  });
});

describe('vocal alignment', () => {
  const map = (dur: number, active: [number, number][], onsets: number[] = []): VocalMap => {
    const rate = 40;
    const activity = new Float32Array(Math.round(dur * rate));
    for (const [a, b] of active) for (let f = Math.round(a * rate); f < Math.round(b * rate); f++) activity[f] = 0.9;
    return { rate, activity, onsets, duration: dur };
  };

  it('lays lines over the vocal sections in order', () => {
    const v = map(120, [
      [20, 40],
      [70, 90],
    ]);
    const lines = alignToVocals(
      ['one two three four', 'five six seven eight', 'nine ten eleven twelve', 'more words to sing here'].map((text) => ({ text, hook: false })),
      v,
      120,
    );
    for (const l of lines) {
      const inside = (l.t >= 19.9 && l.t <= 40.1) || (l.t >= 69.9 && l.t <= 90.1);
      expect(inside).toBe(true);
      expect(l.words.length).toBe(l.text.split(' ').length);
    }
    for (let i = 1; i < lines.length; i++) expect(lines[i].t).toBeGreaterThan(lines[i - 1].t);
    expect(lines[0].t).toBeCloseTo(20, 0);
    // the second half of the lyrics falls in the second vocal section
    expect(lines[3].t).toBeGreaterThan(69.9);
  });

  it('spreads over the middle of the track when there are no vocals', () => {
    const lines = alignToVocals([{ text: 'a b', hook: false }, { text: 'c d', hook: false }], map(100, []), 100);
    expect(lines[0].t).toBeCloseTo(12, 0);
    expect(lines[1].t).toBeGreaterThan(lines[0].t);
    expect(lines[1].end).toBeLessThanOrEqual(88.5);
  });

  it('snaps word starts onto nearby onsets', () => {
    const v = map(10, [[0, 10]], [1.05, 1.62, 3.0]);
    const w = snapWords(
      [
        { t: 1.0, end: 1.5, text: 'a' },
        { t: 1.5, end: 2.0, text: 'b' },
        { t: 2.0, end: 2.5, text: 'c' },
      ],
      v,
      3,
    );
    expect(w[0].t).toBeCloseTo(1.05, 5);
    expect(w[1].t).toBeCloseTo(1.62, 5);
    expect(w[2].t).toBe(2.0);
  });

  it('hears a centred sung tone but not a hard-panned one', async () => {
    const sr = 22050;
    const n = sr * 8;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      // quiet broadband noise throughout (drums / hiss)
      const noise = (Math.random() - 0.5) * 0.02;
      L[i] = noise;
      R[i] = noise;
      const f0 = 330 * (1 + 0.01 * Math.sin(2 * Math.PI * 5 * t));
      const voice = (Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(4 * Math.PI * f0 * t) + 0.3 * Math.sin(6 * Math.PI * f0 * t)) * 0.2;
      if (t >= 2 && t < 4) {
        L[i] += voice;
        R[i] += voice;
      }
      if (t >= 5 && t < 7) L[i] += voice; // a hard-left synth
    }
    const v = await analyzeVocals({ sampleRate: sr, channels: [L, R] });
    const avg = (a: number, b: number) => {
      let s = 0;
      let c = 0;
      for (let f = Math.round(a * v.rate); f < Math.round(b * v.rate); f++) {
        s += v.activity[f];
        c++;
      }
      return s / c;
    };
    expect(avg(2.3, 3.7)).toBeGreaterThan(0.6);
    expect(avg(5.3, 6.7)).toBeLessThan(0.35);
    expect(avg(0.3, 1.7)).toBeLessThan(0.2);
    expect(v.onsets.some((o) => Math.abs(o - 2) < 0.2)).toBe(true);
  });
});

describe('demo lyrics', () => {
  it('times the demo vocal chops and marks drop hooks', () => {
    const th = DEMO_TRACKS.find((d) => d.spec.style === 'techhouse')!;
    const l = demoLyrics(th.spec)!;
    expect(l.timing).toBe('word');
    expect(l.lines.some((x) => x.hook)).toBe(true);
    for (let i = 1; i < l.lines.length; i++) expect(l.lines[i].t).toBeGreaterThanOrEqual(l.lines[i - 1].end - 1e-6);
    const deep = DEMO_TRACKS.find((d) => d.spec.style === 'minimal')!;
    expect(demoLyrics(deep.spec)).toBeNull();
  });
});
