/*
 * The rivals (Section 6.10): four fictional DJs, each with a style and a
 * personality. They turn up in B2B offers from fame tier 5; the B2B set
 * itself (turn-taking, chemistry) builds on these.
 */

export const RIVAL_IDS = ['marlowe', 'kiki_volt', 'double_dutch', 'nox'] as const;
export type RivalId = (typeof RIVAL_IDS)[number];

export interface Rival {
  id: RivalId;
  name: string;
  /** one line for the offer and the intro */
  style: string;
  /** their colour on the HUD and the flyer */
  color: string;
}

export const RIVALS: Record<RivalId, Rival> = {
  marlowe: { id: 'marlowe', name: 'MARLOWE', style: 'Deep purist. Long blends. Judges you for big drops.', color: '#7fb3ff' },
  kiki_volt: { id: 'kiki_volt', name: 'KIKI VOLT', style: 'Rave energy and piano stabs. Pushes the tempo up.', color: '#ff4fb0' },
  double_dutch: { id: 'double_dutch', name: 'DOUBLE DUTCH', style: 'Bouncy tech house, vocal hooks, playful.', color: '#ffb547' },
  nox: { id: 'nox', name: 'NOX', style: 'Afterhours minimalist. Hypnotic. Barely speaks.', color: '#9d8cff' },
};

/** the rival in a 'b2b:<id>' special, if any */
export function rivalOf(special: string | null | undefined): Rival | null {
  if (!special?.startsWith('b2b:')) return null;
  return RIVALS[special.slice(4) as RivalId] ?? null;
}
