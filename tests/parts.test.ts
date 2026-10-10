import { describe, expect, it } from 'vitest';
import { PartTracker } from '../src/visualizer/parts';

/*
 * Synthetic spectra, the way an AnalyserNode reports them (dB per bin): kicks,
 * snares and hats as short broadband bursts, a synth as a steady harmonic
 * tone spread across the stereo field, a voice as a steady harmonic tone in
 * the middle of it.
 */
const SR = 48000;
const FFT = 4096;
const BINS = FFT / 2;
const HZ = SR / FFT;
const DT = 1 / 60;

class Frame {
  mid = new Float32Array(BINS).fill(1e-6);
  side = new Float32Array(BINS).fill(1e-6);
  tone(f0: number, amp: number, width: number, partials = 6): this {
    for (let k = 1; k <= partials; k++) {
      const c = (f0 * k) / HZ;
      for (let i = Math.floor(c) - 3; i <= Math.ceil(c) + 3; i++) {
        if (i < 1 || i >= BINS) continue;
        const a = (amp / k) * Math.exp(-((i - c) ** 2) / 1.2);
        this.mid[i] += a;
        this.side[i] += a * width;
      }
    }
    return this;
  }
  burst(f0: number, f1: number, amp: number): this {
    for (let i = Math.floor(f0 / HZ); i <= Math.ceil(f1 / HZ) && i < BINS; i++) {
      const a = amp * (0.7 + 0.3 * Math.sin(i * 1.7));
      this.mid[i] += a;
      this.side[i] += a * 0.5;
    }
    return this;
  }
  db(a: Float32Array): Float32Array {
    return a.map((v) => 20 * Math.log10(Math.max(v, 1e-6)));
  }
}

function run(frames: number, make: (i: number) => Frame) {
  const t = new PartTracker(HZ, BINS);
  const log = { kick: 0, snare: 0, hat: 0, notes: [] as number[], vocalOnAt: -1 };
  for (let i = 0; i < frames; i++) {
    const f = make(i);
    const p = t.update(f.db(f.mid), f.db(f.side), DT, i * DT);
    if (p.kickHit) log.kick++;
    if (p.snareHit) log.snare++;
    if (p.hatHit) log.hat++;
    if (p.melodyHit) log.notes.push(p.melodyNote);
    if (p.vocalOn && log.vocalOnAt < 0) log.vocalOnAt = i * DT;
  }
  return { p: t.p, log };
}

describe('the part tracker', () => {
  it('hears the kicks, snares and hats as drums, and a wide synth as the melody', () => {
    // 4 s at 120 BPM: a kick every half second, snares on 2 and 4, eighth-note hats, an A held on a wide synth
    const { p, log } = run(240, (i) => {
      const f = new Frame().tone(440, 0.05, 0.9);
      if (i % 30 < 3) f.burst(40, 130, 0.4);
      if (i % 60 >= 30 && i % 60 < 33) f.burst(180, 5000, 0.04);
      if (i % 15 < 2) f.burst(6500, 12000, 0.02);
      return f;
    });
    expect(log.kick).toBeGreaterThanOrEqual(6);
    expect(log.kick).toBeLessThanOrEqual(9);
    expect(log.snare).toBeGreaterThanOrEqual(3);
    expect(log.hat).toBeGreaterThanOrEqual(10);
    expect(p.melodyNote).toBe(9); // A
    expect(p.melody).toBeGreaterThan(0.3);
    expect(p.vocalOn).toBe(false);
    expect(p.vocal).toBeLessThan(0.15);
  });

  /** a voice: in the middle, and never quite still (5 Hz vibrato, ±40 cents) */
  const sing = (f0: number, i: number) => f0 * Math.pow(2, (40 * Math.sin(2 * Math.PI * 5 * i * DT)) / 1200);

  it('hears a voice in the middle of the mix as the vocal, and how high it is', () => {
    const low = run(150, (i) => new Frame().tone(sing(196, i), 0.05, 0.02).tone(110, 0.02, 0.9, 2));
    expect(low.p.vocalOn).toBe(true);
    expect(low.log.vocalOnAt).toBeLessThan(1.5);
    expect(low.p.vocal).toBeGreaterThan(0.3);
    const high = run(150, (i) => new Frame().tone(sing(523, i), 0.05, 0.02).tone(110, 0.02, 0.9, 2));
    expect(high.p.vocalPitch).toBeGreaterThan(low.p.vocalPitch + 0.1);
  });

  it('takes a synth lead in the middle that holds its pitch dead steady for melody, not a voice', () => {
    const { p } = run(240, () => new Frame().tone(392, 0.05, 0.02).tone(110, 0.02, 0.9, 2));
    expect(p.vocalOn).toBe(false);
    expect(p.vocal).toBeLessThan(0.15);
    expect(p.melody).toBeGreaterThan(0.3);
    expect(p.melodyNote).toBe(7); // G
  });

  it('follows the melody from note to note', () => {
    // A for a second, then C, then E
    const { p, log } = run(200, (i) => new Frame().tone(i < 60 ? 440 : i < 130 ? 523.25 : 659.26, 0.05, 0.9));
    // the first note sounding counts too
    expect(log.notes).toEqual([9, 0, 4]);
    expect(p.melodyNote).toBe(4);
    // the hue goes round the wheel towards E (4/12)
    expect(Math.abs(p.melodyHue - 4 / 12)).toBeLessThan(0.08);
  });

  it('still hears the melody and the voice over a bass ten times louder', () => {
    const mel = run(180, (i) => {
      const f = new Frame().tone(55, 0.5, 0.05, 3).tone(523.25, 0.03, 0.9);
      if (i % 30 < 3) f.burst(40, 130, 0.6);
      return f;
    });
    expect(mel.p.melody).toBeGreaterThan(0.3);
    expect(mel.p.melodyNote).toBe(0);
    const voc = run(180, (i) => new Frame().tone(55, 0.5, 0.05, 3).tone(sing(262, i), 0.03, 0.02));
    expect(voc.p.vocalOn).toBe(true);
  });

  it('doesn’t take drums alone for a melody or a voice', () => {
    const { p, log } = run(240, (i) => {
      const f = new Frame();
      if (i % 30 < 3) f.burst(40, 130, 0.4);
      if (i % 60 >= 30 && i % 60 < 33) f.burst(180, 5000, 0.04);
      if (i % 15 < 2) f.burst(6500, 12000, 0.02);
      return f;
    });
    expect(log.kick).toBeGreaterThanOrEqual(6);
    expect(p.melody).toBeLessThan(0.15);
    expect(p.vocalOn).toBe(false);
  });

  it('stays quiet in silence', () => {
    const { p, log } = run(120, () => new Frame());
    expect(log.kick + log.snare + log.hat).toBe(0);
    expect(p.vocalOn).toBe(false);
    expect(p.melody).toBe(0);
  });
});
