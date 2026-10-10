import { describe, expect, it } from 'vitest';
import { classifyGenre, genreFeatures, genreScores, type Genre } from '../src/analysis/genre';
import { resolveGenre } from '../src/library/genres';

/*
 * Small synthetic beats in each style: the drum pattern, the swing, the sub,
 * the chords and a "voice" band are what tell the genres apart here, the way
 * they do in real tracks.
 */
const SR = 22050;

interface Beat {
  bpm: number;
  bars?: number;
  /** steps of a 16-step bar */
  kick: number[];
  snare: number[];
  /** closed hats on these steps (32 for 32nd-note rolls) */
  hats?: number[];
  hatGrid?: 16 | 32;
  openHats?: number[];
  swing?: number;
  /** a long 808 under each kick */
  boom?: boolean;
  /** sustained chords: gain, and brightness 0..1 */
  pad?: number;
  bright?: number;
  /** a formant-ish band in the voice range */
  voice?: number;
  /** filtered off-beat bass */
  offBass?: boolean;
}

function render(b: Beat): Float32Array {
  const bars = b.bars ?? 24;
  const beat = 60 / b.bpm;
  const len = Math.ceil(bars * 4 * beat * SR) + SR;
  const out = new Float32Array(len);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (t: number, dur: number, f: (s: number, i: number) => number) => {
    const i0 = Math.floor(t * SR);
    const n = Math.floor(dur * SR);
    for (let i = 0; i < n && i0 + i < len; i++) out[i0 + i] += f(i / SR, i);
  };
  const kick = (t: number) => {
    let ph = 0;
    add(t, 0.3, (s) => {
      ph += (45 + 90 * Math.exp(-s * 30)) / SR;
      return Math.sin(2 * Math.PI * ph) * Math.exp(-s * 9) * 0.9;
    });
  };
  const boom = (t: number) => add(t, 0.9, (s) => Math.sin(2 * Math.PI * 50 * s) * Math.exp(-s * 2.5) * 0.7);
  const snare = (t: number) => add(t, 0.18, (s) => (rnd() * 0.6 + Math.sin(2 * Math.PI * 190 * s) * 0.4) * Math.exp(-s * 22) * 0.6);
  let hp = 0;
  const hat = (t: number, open: boolean) =>
    add(t, open ? 0.2 : 0.04, (s) => {
      const n = rnd();
      const v = n - hp;
      hp = n;
      return v * Math.exp(-s * (open ? 14 : 90)) * (open ? 0.22 : 0.16);
    });
  for (let bar = 0; bar < bars; bar++) {
    const t0 = 0.5 + bar * 4 * beat;
    const step = (k: number) => t0 + k * (beat / 4) + (k % 2 === 1 ? (b.swing ?? 0) * (beat / 4) : 0);
    for (const k of b.kick) {
      kick(step(k));
      if (b.boom) boom(step(k));
    }
    for (const k of b.snare) snare(step(k));
    for (const k of b.openHats ?? []) hat(step(k), true);
    const grid = b.hatGrid ?? 16;
    for (const k of b.hats ?? []) hat(grid === 32 ? t0 + k * (beat / 8) : step(k), false);
    if (b.offBass) for (let q = 0; q < 4; q++) add(t0 + q * beat + beat / 2, beat * 0.4, (s) => Math.sin(2 * Math.PI * 70 * s) * Math.exp(-s * 6) * 0.4);
  }
  // chords and a voice-like band over the whole thing
  if (b.pad || b.voice) {
    const bright = b.bright ?? 0.3;
    const notes = [220, 277, 330, 440];
    add(0, len / SR - 0.01, (s) => {
      let v = 0;
      if (b.pad) for (const f of notes) v += (Math.sin(2 * Math.PI * f * s) + bright * Math.sin(2 * Math.PI * f * 4 * s) * 0.5 + bright * Math.sin(2 * Math.PI * f * 8 * s) * 0.3) * b.pad * 0.08;
      if (b.voice) v += Math.sin(2 * Math.PI * 800 * s + 3 * Math.sin(2 * Math.PI * 5 * s)) * Math.sin(2 * Math.PI * 1.3 * s) ** 2 * b.voice * 0.25;
      return v;
    });
  }
  return out;
}

const all16 = Array.from({ length: 16 }, (_, i) => i);
const eighths = [0, 2, 4, 6, 8, 10, 12, 14];
const BEATS: Record<string, { beat: Beat; want: Genre[]; minor?: boolean }> = {
  house: { beat: { bpm: 124, kick: [0, 4, 8, 12], snare: [4, 12], openHats: [2, 6, 10, 14], hats: all16, offBass: true, pad: 0.6, bright: 0.4 }, want: ['House', 'Deep House', 'Tech House', 'Disco'] },
  techno: { beat: { bpm: 132, kick: [0, 4, 8, 12], snare: [], hats: all16, openHats: [2, 6, 10, 14], pad: 0.15, bright: 0.05 }, want: ['Techno'], minor: true },
  trance: { beat: { bpm: 138, kick: [0, 4, 8, 12], snare: [4, 12], openHats: [2, 6, 10, 14], offBass: true, pad: 1, bright: 1 }, want: ['Trance'] },
  dnb: { beat: { bpm: 174, kick: [0, 10], snare: [4, 12], hats: eighths, boom: true }, want: ['Drum & Bass'] },
  dubstep: { beat: { bpm: 140, kick: [0], snare: [8], hats: [0, 4, 8, 12], boom: true }, want: ['Dubstep', 'Trap'], minor: true },
  trap: { beat: { bpm: 140, kick: [0, 7, 10], snare: [8], hats: [...Array.from({ length: 32 }, (_, i) => i).filter((i) => i % 2 === 0), 13, 15, 29, 31], hatGrid: 32, boom: true, voice: 0.6 }, want: ['Trap'] },
  hiphop: { beat: { bpm: 90, kick: [0, 7, 10], snare: [4, 12], hats: eighths, swing: 0.3, voice: 1, pad: 0.4 }, want: ['Hip Hop', 'Lo-fi'] },
  reggaeton: { beat: { bpm: 95, kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], hats: eighths, voice: 0.8 }, want: ['Reggaeton'] },
  garage: { beat: { bpm: 132, kick: [0, 10], snare: [4, 12], hats: all16, swing: 0.3, pad: 0.4 }, want: ['UK Garage'] },
  ambient: { beat: { bpm: 120, kick: [], snare: [], pad: 1, bright: 0.2 }, want: ['Ambient'] },
};

describe('the genre analyser', () => {
  for (const [name, { beat, want, minor }] of Object.entries(BEATS)) {
    it(`hears ${name}`, () => {
      const f = genreFeatures(render(beat), SR, beat.bpm, 0.5, !!minor);
      const g = classifyGenre(f);
      const top = (Object.entries(genreScores(f)) as [Genre, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3);
      // eslint-disable-next-line no-console
      console.log(name, g.genre, g.confidence.toFixed(2), top.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '), JSON.stringify(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]))));
      expect(want).toContain(g.genre);
    });
  }
});

describe('which genre a track shows', () => {
  it('prefers your own pick, then the file’s tag, then the guess', () => {
    const guess = { genre: 'Techno' as Genre, confidence: 0.6, runnerUp: 'House' as Genre };
    expect(resolveGenre({ genre: '' }, guess, undefined)).toEqual({ genre: 'Techno', source: 'guess' });
    expect(resolveGenre({ genre: 'Deep House' }, guess, undefined)).toEqual({ genre: 'Deep House', source: 'tag' });
    expect(resolveGenre({ genre: 'Deep House' }, guess, 'Afro House')).toEqual({ genre: 'Afro House', source: 'you' });
    // tags are tidied: one name per genre, whatever the spelling
    expect(resolveGenre({ genre: 'hip-hop' }, null, undefined).genre).toBe('Hip Hop');
    expect(resolveGenre({ genre: 'DnB' }, null, undefined).genre).toBe('Drum & Bass');
    expect(resolveGenre({ genre: 'Electronica' }, null, undefined).genre).toBe('Electronica');
    expect(resolveGenre({ genre: '' }, null, undefined)).toEqual({ genre: '', source: 'none' });
    // an unsure guess still shows, marked as a guess
    expect(resolveGenre({ genre: '' }, { ...guess, confidence: 0.05 }, undefined).source).toBe('guess');
  });
});
