/*
 * How each venue writes the DJ name (Section 3.3): the booth's front panel,
 * a sign on the wall, and the LED walls on drops. The brief's career venues
 * are listed ahead of being built; the real rooms get a look that suits them.
 */
import type { NameStyle } from './styles';

export interface VenueNameStyle {
  booth: NameStyle;
  sign?: NameStyle;
  screen?: NameStyle;
}

export const VENUE_NAME_STYLES: Record<string, VenueNameStyle> = {
  // the career (Section 3.3)
  bedroom: { booth: 'marker', sign: 'marker' },
  basement: { booth: 'neon_red', sign: 'neon_red' },
  rooftop: { booth: 'chrome_led', sign: 'neon_script' },
  warehouse: { booth: 'chrome_led', sign: 'neon_red', screen: 'chrome_led' },
  beach: { booth: 'handpainted', sign: 'handpainted' },
  boat: { booth: 'chrome_led', sign: 'led_sign' },
  festival: { booth: 'pixel_led', screen: 'pixel_led' },
  sunrise: { booth: 'white_install', sign: 'white_install' },
  // the real rooms, and the house room
  deckhouse: { booth: 'chrome_led', sign: 'neon_red', screen: 'chrome_led' },
  dc10: { booth: 'neon_red', sign: 'neon_red' },
  boilerroom: { booth: 'marker' },
  berghain: { booth: 'white_install' },
  printworks: { booth: 'chrome_led', screen: 'chrome_led' },
  allypally: { booth: 'pixel_led', screen: 'pixel_led' },
  'allypally-round': { booth: 'pixel_led' },
};

export function nameStyleFor(venue: string): VenueNameStyle {
  return VENUE_NAME_STYLES[venue] ?? { booth: 'chrome_led' };
}
