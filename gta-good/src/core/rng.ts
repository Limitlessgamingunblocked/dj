export type Rng = () => number;

/** Small seeded PRNG so the city and its events are reproducible. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (r: Rng, a: number, b: number) => a + (b - a) * r();
export const irange = (r: Rng, a: number, b: number) => Math.floor(range(r, a, b + 1));
export const pick = <T>(r: Rng, items: readonly T[]): T => items[Math.floor(r() * items.length)];
