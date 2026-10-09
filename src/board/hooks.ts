/*
 * What board parts can ask of the game beyond the controls: the add-ons and
 * show controls (Section 13.6) push the crowd, fire the drop, run the lights,
 * switch cameras. The app supplies these; in the editor's test mode they work
 * for real.
 */
import type * as THREE from 'three';
import type { AddonSounds } from './sounds';

export type ShowCue =
  | 'strobe'
  | 'blinder'
  | 'blackout'
  | 'lasers'
  | 'laserColor'
  | 'laserPattern'
  | 'laserName'
  | 'co2'
  | 'pyro'
  | 'confetti'
  | 'streamers'
  | 'sparklers'
  | 'fog'
  | 'flashName'
  | 'nextVisual'
  | 'hazeUp';

export interface BoardHooks {
  audio(): AudioContext | null;
  /** add-on sounds, into the mix */
  sounds(): AddonSounds | null;
  /** the crowd cam picture, if the venue has one */
  crowdFeed(): THREE.Texture | null;
  /** the kick right now, 0..1, and the vibe */
  kick(): number;
  vibe(): number;
  /** the beat: seconds per beat, and where in the beat (0..1) and bar (0..4) we are */
  beat(): { period: number; phase: number; bar: number; next: number };
  /** bars heard since the start (counts up), and the section the track is in */
  clock?(): { bars: number; section: string };
  /** the master's key: root (MIDI note) and minor or not, or null */
  key(): { root: number; minor: boolean } | null;
  /** the deck in front (the master) */
  masterDeck(): number;
  /** push the crowd's energy (Crowd Fader), 0..1 */
  crowd(v: number): void;
  /** raise lights, crowd noise and FX together (Hype Dial), 0..1 */
  hype(v: number): void;
  /** the Big Red Drop: lights out, a second of silence, then everything at once */
  drop(): void;
  show(cue: ShowCue, on?: boolean): void;
  /** aim the lasers, −1..1 each way */
  laserAim(x: number, y: number): void;
  camera(view: string): void;
  /** outdoor venues only; false when it can't */
  weather(what: 'rain' | 'breeze' | 'sunrise'): boolean;
  /** slow a deck to a halt like a tape machine */
  tapeStop(deck: number): void;
  /** a pull-up rewind on a deck */
  rewind(deck: number): void;
  /** a drop happened in the last moment (decorations wake up) */
  dropPulse(): number;
  /** a short message to the player */
  toast(text: string): void;
}

/** hooks that do nothing: for building boards without a game around them (thumbnails, tests) */
export const NO_HOOKS: BoardHooks = {
  audio: () => null,
  sounds: () => null,
  crowdFeed: () => null,
  kick: () => 0,
  vibe: () => 0.5,
  beat: () => ({ period: 0.5, phase: 0, bar: 0, next: 0 }),
  key: () => null,
  masterDeck: () => 1,
  crowd: () => undefined,
  hype: () => undefined,
  drop: () => undefined,
  show: () => undefined,
  laserAim: () => undefined,
  camera: () => undefined,
  weather: () => false,
  tapeStop: () => undefined,
  rewind: () => undefined,
  dropPulse: () => 0,
  toast: () => undefined,
};
