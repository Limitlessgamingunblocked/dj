/* In-place iterative radix-2 complex FFT with cached tables. */
interface Tables {
  cos: Float32Array;
  sin: Float32Array;
  rev: Uint32Array;
}
const cache = new Map<number, Tables>();

function tables(n: number): Tables {
  let t = cache.get(n);
  if (t) return t;
  const cos = new Float32Array(n / 2);
  const sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let x = i;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r;
  }
  t = { cos, sin, rev };
  cache.set(n, t);
  return t;
}

export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  const { cos, sin, rev } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j;
        const b = a + half;
        const wr = cos[k];
        const wi = sin[k];
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

const hannCache = new Map<number, Float32Array>();
export function hann(n: number): Float32Array {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    hannCache.set(n, w);
  }
  return w;
}

/** Magnitude spectrum (n/2 bins) of a real frame starting at `offset`. */
export function magnitudes(x: Float32Array, offset: number, n: number, re: Float32Array, im: Float32Array, out: Float32Array): void {
  const w = hann(n);
  for (let i = 0; i < n; i++) {
    const idx = offset + i;
    re[i] = idx < x.length && idx >= 0 ? x[idx] * w[i] : 0;
    im[i] = 0;
  }
  fft(re, im);
  for (let k = 0; k < n / 2; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
}

/** Decimation with a two-stage moving-average anti-alias filter. */
export function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x;
  const n = Math.floor(x.length / factor);
  const a = new Float32Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += x[i] - (i >= factor ? x[i - factor] : 0);
    a[i] = acc / factor;
  }
  const out = new Float32Array(n);
  acc = 0;
  for (let i = 0, j = 0; i < x.length; i++) {
    acc += a[i] - (i >= factor ? a[i - factor] : 0);
    if ((i + 1) % factor === 0 && j < n) out[j++] = acc / factor;
  }
  return out;
}

export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(type: 'lp' | 'hp', f: number, sr: number, q = Math.SQRT1_2) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const cs = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (type === 'lp') {
      this.b0 = (1 - cs) / 2 / a0;
      this.b1 = (1 - cs) / a0;
    } else {
      this.b0 = (1 + cs) / 2 / a0;
      this.b1 = -(1 + cs) / a0;
    }
    this.b2 = this.b0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}
