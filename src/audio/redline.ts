/**
 * The redline envelope: past 1 dB of limiting it rises quickly towards how
 * deep the limiting goes (full at 6 dB), and lets go slowly, so a meter can
 * flash and scoring can see it.
 */
export function nextRedline(cur: number, reductionDb: number, dt: number): number {
  const want = Math.min(1, Math.max(0, ((Number.isFinite(reductionDb) ? reductionDb : 0) - 1) / 5));
  const k = 1 - Math.exp(-dt * (want > cur ? 20 : 2));
  return cur + (want - cur) * k;
}
