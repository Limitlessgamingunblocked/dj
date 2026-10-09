/*
 * How a control feels (Section 13.4): the response curve between where the
 * control sits and the value it sends, how far you drag for a full turn,
 * notches on knobs, and how heavy a fader is. Plus the touch sounds.
 */
import type { CommonProps } from './format';

export type Curve = CommonProps['feel']['curve'];

/** position (0..1) → value (0..1) */
export function applyCurve(x: number, c: Curve): number {
  const t = Math.min(1, Math.max(0, x));
  switch (c) {
    case 'log':
      return Math.log1p(t * 9) / Math.log(10);
    case 'exp':
      return (Math.pow(10, t) - 1) / 9;
    case 's':
      return t * t * (3 - 2 * t);
    default:
      return t;
  }
}

/** value (0..1) → position (0..1): the inverse, for controls moved from elsewhere (MIDI, the screen) */
export function invertCurve(v: number, c: Curve): number {
  const y = Math.min(1, Math.max(0, v));
  switch (c) {
    case 'log':
      return (Math.pow(10, y) - 1) / 9;
    case 'exp':
      return Math.log1p(y * 9) / Math.log(10);
    case 's': {
      // solve 3t² − 2t³ = y by bisection (it's monotonic)
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 24; i++) {
        const m = (lo + hi) / 2;
        if (m * m * (3 - 2 * m) < y) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    }
    default:
      return y;
  }
}

/** snap to `n` notches (0 = smooth) */
export function detent(x: number, n: number): number {
  if (n < 2) return x;
  return Math.round(x * (n - 1)) / (n - 1);
}

/* ------------------------------ touch sounds ------------------------------ */

let ctx: AudioContext | null = null;
let last = 0;

/** a short touch sound, straight to the speakers (not the mix, not recordings) */
export function touchSound(kind: CommonProps['sound'], audio?: AudioContext | null): void {
  if (kind === 'silent') return;
  const c = audio ?? (ctx ??= typeof AudioContext !== 'undefined' ? new AudioContext() : null);
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  // a busy knob doesn't machine-gun
  if (now - last < 0.035) return;
  last = now;
  const g = c.createGain();
  g.connect(c.destination);
  if (kind === 'whoosh') {
    const n = c.createBufferSource();
    const b = c.createBuffer(1, Math.floor(c.sampleRate * 0.25), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / d.length) * Math.PI);
    n.buffer = b;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(600, now);
    f.frequency.exponentialRampToValueAtTime(3000, now + 0.22);
    g.gain.value = 0.05;
    n.connect(f).connect(g);
    n.start(now);
    return;
  }
  const o = c.createOscillator();
  const freq = kind === 'click' ? 2200 : kind === 'mechanical' ? 900 : 420;
  const len = kind === 'soft' ? 0.05 : kind === 'mechanical' ? 0.03 : 0.012;
  o.type = kind === 'mechanical' ? 'square' : 'triangle';
  o.frequency.setValueAtTime(freq, now);
  o.frequency.exponentialRampToValueAtTime(freq * 0.5, now + len);
  g.gain.setValueAtTime(kind === 'soft' ? 0.05 : 0.07, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + len);
  o.connect(g);
  o.start(now);
  o.stop(now + len + 0.01);
}
