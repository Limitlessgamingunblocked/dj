/*
 * Laser looks: the names the lighting desk shows, and the automatic choice of
 * look from where the music is (pure, so it's unit-tested). The fixture in
 * lasers.ts turns a look into beam directions.
 *
 * The arc follows how arena laser shows are built (docs/venue-research.md):
 * quiet, slow looks in intros and breakdowns, a flat "liquid sky" sheet over
 * the crowd as a build starts, a tunnel as it deepens, every projector closing
 * in on one point at the top of the build, a burst on the drop, then the
 * busiest looks through the peak, changing every 4 bars.
 */

export const LASER_PATTERNS = ['fan', 'gaps', 'tunnel', 'sheet', 'liquid', 'wave', 'cross', 'converge', 'rotate', 'chase', 'burst', 'strobe', 'stars'] as const;
export type LaserPattern = (typeof LASER_PATTERNS)[number];
export const LASER_PATTERN_NAMES: Record<LaserPattern, string> = {
  fan: 'Fan',
  gaps: 'Fan with gaps',
  tunnel: 'Tunnel',
  sheet: 'Sheet',
  liquid: 'Liquid sky',
  wave: 'Wave',
  cross: 'Crossfire',
  converge: 'Converge',
  rotate: 'Rotating fan',
  chase: 'Chase',
  burst: 'Burst',
  strobe: 'Strobe fan',
  stars: 'Starfield',
};

export interface LookInput {
  /** 0..1 breakdown / build-up depth */
  build: number;
  /** 0..1 peak envelope after a drop */
  peak: number;
  bar: number;
  energy: number;
  /** bars left in the peak section (16 right after the drop) */
  peakBars: number;
  /** 0..1 envelope of the last hook line landing */
  accent: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const PEAK: LaserPattern[] = ['fan', 'cross', 'strobe', 'gaps', 'wave', 'converge', 'tunnel', 'burst'];
const CRUISE: LaserPattern[] = ['fan', 'sheet', 'wave', 'tunnel', 'chase', 'cross', 'gaps', 'rotate', 'liquid'];

/** The look for this moment of the track. */
export function autoLook(i: LookInput): LaserPattern {
  // the first bar after the drop, and a hook line landing hard
  if (i.peakBars >= 15) return 'burst';
  if (i.accent > 0.8) return 'burst';
  // the build: sheet over the crowd, then a tunnel, then everything closing in
  if (i.build > 0.85) return 'converge';
  if (i.build > 0.6) return 'tunnel';
  if (i.build > 0.35) return 'liquid';
  // the peak: busy looks, a new one every 4 bars
  if (i.peak > 0.5) return PEAK[(((Math.floor(i.bar / 4) % PEAK.length) + PEAK.length) % PEAK.length)];
  // quiet stretches: slow, sparse looks
  if (i.energy < 0.45) return Math.floor(i.bar / 8) % 2 ? 'stars' : 'rotate';
  // cruising: a new look every 8 bars
  return CRUISE[Math.floor(hash(Math.floor(i.bar / 8) + 17) * CRUISE.length)];
}

/** How much of a look is a sheet of light (planes between neighbouring beams) rather than separate beams. */
export const SHEET: Partial<Record<LaserPattern, number>> = { sheet: 1, liquid: 1, wave: 0.85, tunnel: 0.6, rotate: 0.35, converge: 0.25 };
