import { clamp } from './math';
import type { ToolId } from './medical';

/** Points on the body diagram (viewBox 0 0 200 400, patient facing the viewer). */
export interface AimZone {
  x: number;
  y: number;
  r: number;
  label: string;
}

export interface TimingStep {
  label: string;
  /** Window on a 0..1 bar. */
  from: number;
  to: number;
  /** Marker sweeps per second. */
  speed: number;
}

export interface Procedure {
  zones: AimZone[];
  timing?: TimingStep;
  /** Where the wound is drawn, for the trauma kit. */
  wound?: { x: number; y: number };
}

/**
 * Target zones per tool. `mirror` flips left/right so each patient looks a bit different.
 * The patient's right side is on the viewer's left.
 */
export function procedureFor(tool: ToolId, mirror: boolean): Procedure {
  const mx = (x: number) => (mirror ? 200 - x : x);
  switch (tool) {
    case 'epi':
      return { zones: [{ x: mx(80), y: 288, r: 12, label: 'Outer mid-thigh' }] };
    case 'aed':
      return {
        zones: [
          { x: 80, y: 118, r: 15, label: 'Pad 1 · upper right chest' },
          { x: 126, y: 168, r: 15, label: 'Pad 2 · lower left side' },
        ],
        timing: { label: 'Charged — everyone clear — SHOCK', from: 0.62, to: 0.8, speed: 0.55 },
      };
    case 'inhaler':
      return {
        zones: [{ x: 100, y: 55, r: 9, label: 'Mouth' }],
        timing: { label: 'Press as they breathe in', from: 0.15, to: 0.38, speed: 0.4 },
      };
    case 'trauma':
      return { zones: [{ x: mx(150), y: 142, r: 11, label: 'Upper arm, above the wound' }], wound: { x: mx(158), y: 196 } };
    case 'glucose':
      return { zones: [{ x: mx(108), y: 55, r: 8, label: 'Inside the cheek' }] };
    case 'oxygen':
      return { zones: [{ x: 100, y: 48, r: 13, label: 'Nose and mouth' }] };
  }
}

/** Hand sway of the aiming reticle at time t (seconds), in diagram units. */
export function sway(t: number, amp: number): { x: number; y: number } {
  return {
    x: amp * (0.62 * Math.sin(t * 1.9) + 0.38 * Math.sin(t * 3.7 + 1.3)),
    y: amp * (0.58 * Math.cos(t * 1.4 + 0.4) + 0.42 * Math.sin(t * 2.9 + 2.1)),
  };
}

/**
 * Sway amplitude: steadier with the upgrade and a held breath, shakier when the patient is crashing.
 */
export function swayAmp(steadyLevel: number, stability: number, holdingBreath: boolean): number {
  const base = 14 * (1 - 0.22 * steadyLevel);
  const panic = 1 + (1 - clamp(stability, 0, 100) / 100) * 0.6;
  return base * panic * (holdingBreath ? 0.35 : 1);
}

export interface Shot {
  hit: boolean;
  quality: number;
  grade: 'Perfect' | 'Good' | 'OK' | 'Miss';
}

/** Scores a placement: full quality at the centre, falling to 0.2 at the rim, a bit of grace outside. */
export function scoreShot(px: number, py: number, zone: AimZone): Shot {
  const d = Math.hypot(px - zone.x, py - zone.y) / zone.r;
  if (d > 1.25) return { hit: false, quality: 0, grade: 'Miss' };
  const quality = d <= 1 ? 1 - 0.8 * d : 0.15;
  return { hit: true, quality, grade: quality > 0.8 ? 'Perfect' : quality > 0.45 ? 'Good' : 'OK' };
}

/** Marker position on a 0..1 bar that sweeps back and forth. */
export function timingMarker(t: number, speed: number): number {
  const u = (t * speed) % 2;
  return u < 1 ? u : 2 - u;
}

export function scoreTiming(pos: number, step: TimingStep): Shot {
  if (pos < step.from || pos > step.to) return { hit: false, quality: 0, grade: 'Miss' };
  const mid = (step.from + step.to) / 2;
  const quality = 1 - Math.abs(pos - mid) / ((step.to - step.from) / 2) * 0.7;
  return { hit: true, quality, grade: quality > 0.8 ? 'Perfect' : quality > 0.5 ? 'Good' : 'OK' };
}
