/* 3-band waveform (low / mid / high / full peaks at WAVE_RATE points per second). */
import { Biquad } from './fft';

export function computeWaveform(mono: Float32Array, sr: number, rate: number): Uint8Array {
  const n = Math.ceil((mono.length / sr) * rate);
  const out = new Uint8Array(n * 4);
  const lo1 = new Biquad('lp', 220, sr);
  const lo2 = new Biquad('lp', 220, sr);
  const hi1 = new Biquad('hp', 2600, sr);
  const hi2 = new Biquad('hp', 2600, sr);
  const peaks = new Float32Array(n * 4);
  const step = sr / rate;
  let next = step;
  let j = 0;
  let pl = 0;
  let pm = 0;
  let ph = 0;
  let pf = 0;
  for (let i = 0; i < mono.length; i++) {
    const x = mono[i];
    const l = lo2.run(lo1.run(x));
    const h = hi2.run(hi1.run(x));
    const m = x - l - h;
    const al = Math.abs(l);
    const am = Math.abs(m);
    const ah = Math.abs(h);
    const af = Math.abs(x);
    if (al > pl) pl = al;
    if (am > pm) pm = am;
    if (ah > ph) ph = ah;
    if (af > pf) pf = af;
    if (i + 1 >= next || i === mono.length - 1) {
      if (j < n) {
        peaks[j * 4] = pl;
        peaks[j * 4 + 1] = pm;
        peaks[j * 4 + 2] = ph;
        peaks[j * 4 + 3] = pf;
        j++;
      }
      pl = pm = ph = pf = 0;
      next += step;
    }
  }
  let max = 1e-6;
  for (let k = 0; k < n; k++) max = Math.max(max, peaks[k * 4 + 3]);
  const gains = [1.0, 0.8, 1.25, 1.0];
  for (let k = 0; k < n * 4; k++) {
    out[k] = Math.min(255, Math.round((peaks[k] / max) * gains[k % 4] * 255));
  }
  return out;
}

/** Loudness (dBFS RMS of the louder half of 400 ms windows) and sample peak. */
export function loudness(mono: Float32Array, sr: number): { loudness: number; peak: number } {
  const win = Math.floor(sr * 0.4);
  const energies: number[] = [];
  let peak = 0;
  for (let s = 0; s + win <= mono.length; s += win) {
    let e = 0;
    for (let i = s; i < s + win; i++) {
      const v = mono[i];
      e += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    energies.push(e / win);
  }
  if (!energies.length) return { loudness: -60, peak };
  energies.sort((a, b) => b - a);
  const top = energies.slice(0, Math.max(1, Math.floor(energies.length / 2)));
  const mean = top.reduce((a, b) => a + b, 0) / top.length;
  return { loudness: 10 * Math.log10(mean + 1e-12), peak };
}
