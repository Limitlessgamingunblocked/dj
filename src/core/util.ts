export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => (g <= 0 ? -Infinity : 20 * Math.log10(g));

export function formatTime(sec: number, tenths = false): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const base = `${m}:${s.toString().padStart(2, '0')}`;
  if (!tenths) return base;
  return `${base}.${Math.floor((sec * 10) % 10)}`;
}

export function uid(prefix = ''): string {
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${r}`;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function formatBpm(bpm: number | undefined | null): string {
  if (!bpm || !isFinite(bpm)) return '--.-';
  return bpm.toFixed(bpm >= 100 ? 1 : 2);
}
