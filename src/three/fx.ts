/*
 * The effects level the venue fixtures read each frame: the Low / Medium /
 * High setting, and how far adaptive quality has stepped down (1 = full
 * detail). The stage writes it; fixtures pick their tier from it (haze slices,
 * dust, light-map rate).
 */
export const FX = {
  quality: 'medium' as 'low' | 'medium' | 'high',
  /** 1 at full detail, falling as adaptive quality steps down */
  detail: 1,
};

/** The effects tier after adaptive quality: High drops to Medium, Medium to Low, as frames run long. */
export function fxTier(): 'low' | 'medium' | 'high' {
  if (FX.quality === 'low') return 'low';
  if (FX.detail < 0.55) return 'low';
  if (FX.quality === 'high' && FX.detail > 0.8) return 'high';
  return 'medium';
}
