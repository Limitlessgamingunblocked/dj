/*
 * Lens looks for the club camera: what the final pass (lens.ts) does to the
 * picture. Each camera angle can bring its own look (the fisheye on the booth,
 * the security camera, the 90s camcorder…), and any look can be put on any
 * angle from the camera menu or Settings. Looks are plain numbers so they can
 * blend smoothly when the camera changes.
 */

export type LensLook = 'none' | 'fisheye' | 'vhs' | 'cctv' | 'tiltshift' | 'cinema' | 'thermal' | 'nightvision';

export const LENS_LOOKS: { id: LensLook; name: string }[] = [
  { id: 'none', name: 'Clean' },
  { id: 'fisheye', name: 'Fisheye' },
  { id: 'vhs', name: '90s camcorder (VHS)' },
  { id: 'cctv', name: 'Security camera' },
  { id: 'tiltshift', name: 'Tilt-shift miniature' },
  { id: 'cinema', name: 'Cinematic widescreen' },
  { id: 'thermal', name: 'Thermal' },
  { id: 'nightvision', name: 'Night vision' },
];

export interface LookParams {
  /** fisheye remap 0..1 */
  fish: number;
  /** plain barrel distortion (corners stay put) */
  distort: number;
  /** radial colour fringing */
  ca: number;
  /** black and white 0..1, tinted, with an exposure curve (night vision amplifies) */
  mono: number;
  monoTint: [number, number, number];
  monoGain: number;
  /** scanlines and a slow rolling bar */
  scan: number;
  /** tape: line jitter, a tracking band, colour shift and bleed */
  vhs: number;
  /** tilt-shift: blur above and below a sharp band */
  tilt: number;
  /** 2.39:1 letterbox bars */
  bars: number;
  /** teal shadows, orange highlights */
  split: number;
  /** brightness mapped to a heat palette */
  thermal: number;
  /** extra saturation (tilt-shift's toy look) */
  sat: number;
  grain: number;
  vignette: number;
  /** frames per second the picture updates at (0 = every frame); not blended */
  fps: number;
  /** vertical field of view the look needs, degrees (0 = the angle's own); not blended */
  fov: number;
}

const BASE: LookParams = { fish: 0, distort: 0, ca: 0, mono: 0, monoTint: [1, 1, 1], monoGain: 1, scan: 0, vhs: 0, tilt: 0, bars: 0, split: 0, thermal: 0, sat: 0, grain: 0, vignette: 0, fps: 0, fov: 0 };

export const LOOKS: Record<LensLook, LookParams> = {
  none: BASE,
  fisheye: { ...BASE, fish: 1, ca: 0.01, vignette: 0.15, fov: 104 },
  vhs: { ...BASE, vhs: 1, scan: 0.35, distort: 0.08, grain: 0.07, vignette: 0.45 },
  cctv: { ...BASE, mono: 1, monoTint: [0.82, 0.95, 0.86], monoGain: 2.2, scan: 0.7, distort: 0.16, grain: 0.09, vignette: 0.55, fps: 8, fov: 70 },
  tiltshift: { ...BASE, tilt: 1, sat: 0.4 },
  cinema: { ...BASE, bars: 1, split: 0.8, vignette: 0.35 },
  thermal: { ...BASE, thermal: 1, grain: 0.03, vignette: 0.2 },
  nightvision: { ...BASE, mono: 1, monoTint: [0.38, 1, 0.5], monoGain: 5, scan: 0.25, grain: 0.16, vignette: 0.9 },
};

/** the angles that come with their own look */
export const VIEW_LOOKS: Partial<Record<string, LensLook>> = {
  fisheye: 'fisheye',
  rig: 'tiltshift',
  cctv: 'cctv',
  camcorder: 'vhs',
  crane: 'cinema',
  vertigo: 'cinema',
};

/** The look for an angle: the one picked in the menu, or (on Auto) the angle's own. */
export function lookFor(view: string, pick: LensLook | 'auto'): LensLook {
  return pick === 'auto' ? (VIEW_LOOKS[view] ?? 'none') : pick;
}

const NUM_KEYS = ['fish', 'distort', 'ca', 'mono', 'monoGain', 'scan', 'vhs', 'tilt', 'bars', 'split', 'thermal', 'sat', 'grain', 'vignette'] as const;

/** Move `cur` towards `target` by fraction k (0..1), in place. fps and fov switch straight away. */
export function approachLook(cur: LookParams, target: LookParams, k: number): LookParams {
  for (const key of NUM_KEYS) cur[key] += (target[key] - cur[key]) * k;
  for (let i = 0; i < 3; i++) cur.monoTint[i] += (target.monoTint[i] - cur.monoTint[i]) * k;
  cur.fps = target.fps;
  cur.fov = target.fov;
  return cur;
}

export function copyLook(l: LookParams): LookParams {
  return { ...l, monoTint: [...l.monoTint] as [number, number, number] };
}
