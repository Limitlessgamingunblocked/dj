/*
 * Manual loops (LOOP IN / LOOP OUT), the way a club player does them:
 *   - with quantize on, the IN point lands on the nearest beat and the loop is
 *     a whole number of beats long, so it stays in time with the other deck
 *   - OUT closes the loop from the IN you just set; an IN that's been left
 *     behind (more than 64 beats back, or after a loop was exited) doesn't
 *     count, and OUT on its own makes a loop of the current size from here
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
