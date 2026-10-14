/*
 * The board showroom's turntable floor: the plinths stand in a ring and the
 * ring turns to bring the one you're looking at to the front.
 */

/** wrap an index into 0..n-1 */
export function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** the ring's turn (radians) that brings slot `i` of `n` to the front, starting from `from` the short way round */
export function ringTurnFor(i: number, n: number, from: number): number {
  const target = -(i / n) * Math.PI * 2;
  const full = Math.PI * 2;
  let d = (target - from) % full;
  if (d > Math.PI) d -= full;
  if (d < -Math.PI) d += full;
  return from + d;
}

/** where slot `i` of `n` stands on a ring of radius `r` (before the ring turns): x, z */
export function slotPosition(i: number, n: number, r: number): [number, number] {
  const a = (i / n) * Math.PI * 2;
  return [Math.sin(a) * r, Math.cos(a) * r];
}

/** a board's scale on its plinth: real size, unless it's wider than the plinth allows */
export function plinthScale(width: number, maxWidth: number): number {
  return width > maxWidth ? maxWidth / width : 1;
}
