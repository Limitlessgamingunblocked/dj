/* Energy arcs: the target energy (0–1) across a set, from start (t = 0) to end (t = 1). */

export type ArcId = 'peak' | 'warmup' | 'steady' | 'story' | 'journey';

export interface ArcDef {
  id: ArcId;
  name: string;
  blurb: string;
  points: [number, number][];
}

export const ARCS: ArcDef[] = [
  {
    id: 'peak',
    name: 'Peak Time Hour',
    blurb: 'Starts strong, climbs fast and stays high with one short breather.',
    points: [
      [0, 0.62],
      [0.2, 0.82],
      [0.42, 0.93],
      [0.56, 0.84],
      [0.78, 0.98],
      [1, 0.9],
    ],
  },
  {
    id: 'warmup',
    name: 'Warm-Up Sunset',
    blurb: 'Deep and patient, rising gently so the next DJ has somewhere to go.',
    points: [
      [0, 0.16],
      [0.3, 0.28],
      [0.6, 0.44],
      [0.85, 0.57],
      [1, 0.64],
    ],
  },
  {
    id: 'steady',
    name: 'Steady Energy Flow',
    blurb: 'Holds one groove level all the way through — good for long sessions.',
    points: [
      [0, 0.52],
      [0.5, 0.58],
      [1, 0.55],
    ],
  },
  {
    id: 'story',
    name: 'Peak & Drop Storytelling',
    blurb: 'Two climaxes with a deep breakdown between them, then a cool-down.',
    points: [
      [0, 0.3],
      [0.2, 0.56],
      [0.38, 0.86],
      [0.53, 0.38],
      [0.7, 0.7],
      [0.86, 1],
      [1, 0.55],
    ],
  },
  {
    id: 'journey',
    name: 'Style Journey',
    blurb: 'Travels through your style anchors one after another — deep grooves first, peak-time sounds last (or in the order you typed them).',
    points: [
      [0, 0.35],
      [0.33, 0.52],
      [0.66, 0.72],
      [1, 0.92],
    ],
  },
];

export function arcById(id: string): ArcDef {
  return ARCS.find((a) => a.id === id) ?? ARCS[0];
}

/** Target energy at position t (0–1), cosine-interpolated between the arc's points. */
export function arcEnergy(arc: ArcDef, t: number): number {
  const p = arc.points;
  if (t <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const [x0, y0] = p[i - 1];
      const [x1, y1] = p[i];
      const f = (1 - Math.cos(((t - x0) / (x1 - x0)) * Math.PI)) / 2;
      return y0 + (y1 - y0) * f;
    }
  }
  return p[p.length - 1][1];
}
