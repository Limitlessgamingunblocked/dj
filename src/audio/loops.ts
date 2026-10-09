/*
 * Manual loops (LOOP IN / LOOP OUT), the way a club player does them:
 *   - with quantize on, the IN point lands on the nearest beat and the loop is
 *     a whole number of beats long, so it stays in time with the other deck
 *   - OUT closes the loop from the IN you just set; an IN that's been left
 *     behind (more than 64 beats back, or after a loop was exited) doesn't
 *     count, and OUT on its own makes a loop of the current size from here
 *   - holding IN makes a 4-beat loop from it (as on club players)
 *   - an auto loop (4 BEAT, the loop-size push) starts on the beat you're on,
 *     so the music carries straight on into it instead of jumping back
 */

export interface Grid {
  firstBeat: number;
  /** seconds per beat */
  beatLen: number;
}

/** the furthest back an IN point still counts, in beats */
export const MAX_MANUAL_BEATS = 64;

/** where IN sets the loop start: the nearest beat with quantize, the playhead without */
export function loopInPoint(pos: number, grid: Grid | null, quantize: boolean): number {
  if (!quantize || !grid) return pos;
  return Math.max(0, grid.firstBeat + Math.round((pos - grid.firstBeat) / grid.beatLen) * grid.beatLen);
}

/** how long IN has to be held for the 4-beat loop, in seconds */
export const HOLD_FOR_LOOP = 0.6;

/**
 * Where an auto loop of `beats` starts. With quantize: loops of a beat or
 * more on the nearest beat (the playhead is in its first beat, or just short
 * of it, so it plays on seamlessly); shorter loops (rolls) on the last line of
 * their own length, so the playhead is inside them. Without: right here.
 */
export function autoLoopStart(pos: number, grid: Grid | null, quantize: boolean, beats: number): number {
  if (!quantize || !grid) return pos;
  if (beats >= 1) return loopInPoint(pos, grid, true);
  const len = beats * grid.beatLen;
  return Math.max(0, grid.firstBeat + Math.floor((pos - grid.firstBeat) / len + 1e-6) * len);
}

/**
 * The playhead between audio-thread reports, kept inside a loop it was
 * playing through (so the screen doesn't overshoot the loop end and snap back).
 */
export function wrapInLoop(reported: number, extrapolated: number, loop: { active: boolean; start: number; end: number }, forward: boolean): number {
  const len = loop.end - loop.start;
  if (!loop.active || len <= 1e-3 || !forward || reported >= loop.end || extrapolated < loop.end) return extrapolated;
  return loop.start + ((extrapolated - loop.start) % len);
}

/**
 * The loop OUT makes, or null when there's no IN to close (the caller then
 * makes a loop of the current size from the playhead).
 */
export function closeLoop(inPoint: number | null, pos: number, grid: Grid | null, quantize: boolean): { start: number; end: number } | null {
  if (inPoint === null) return null;
  const beat = grid?.beatLen ?? 0.5;
  const len = pos - inPoint;
  // an IN ahead of the playhead (it was snapped forward to the next beat) or long left behind isn't this loop's
  if (len < -beat * 0.5 || len > beat * MAX_MANUAL_BEATS) return null;
  if (quantize && grid) {
    const beats = Math.max(1, Math.round(len / grid.beatLen));
    return { start: inPoint, end: inPoint + beats * grid.beatLen };
  }
  return { start: inPoint, end: inPoint + Math.max(0.05, len) };
}
