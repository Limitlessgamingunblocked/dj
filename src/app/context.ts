import type { AudioEngine } from '../audio/AudioEngine';
import type { ControlRegistry } from '../core/controls';
import type { Emitter } from '../core/emitter';
import type { LibraryTrack } from '../core/types';
import type { Library } from '../library/Library';
import type { LyricsAI } from '../lyrics/LyricsAI';
import type { NextUp } from './nextup';

export interface AppEvents extends Record<string, unknown> {
  board: string;
  venue: string;
  selection: LibraryTrack | null;
  layout: void;
}

/** What UI panels need from the application. */
export interface AppContext {
  engine: AudioEngine;
  reg: ControlRegistry;
  library: Library;
  events: Emitter<AppEvents>;
  deckCount(): number;
  loadTrack(deck: number, trackId: string): Promise<void>;
  importFiles(files: File[], loadTo?: number, crateId?: string | null): Promise<LibraryTrack[]>;
  selectedTrack(): LibraryTrack | null;
  select(track: LibraryTrack | null): void;
  /** deck currently shown on the left/right side */
  sideDeck(side: 'L' | 'R'): number;
  /** id of the venue being played */
  venueId(): string;
  setVenue(id: string): void;
  /** why a crazy room is still locked (its unlock challenge), or null when it's open */
  roomLock(id: string): string | null;
  /** your signature drop move (the look's), and changing it */
  signatureMove(): string;
  setSignatureMove(id: string): void;
  /** the regulars and how much they like you */
  regulars(): { name: string; style: string; color: string; loyalty: number; front: boolean; here: boolean }[];
  /** the next-track coach: picks for what to play next, in every mode */
  nextUp: NextUp;
  /** AI lyrics: listens to a track for its words */
  lyricsAi: LyricsAI;
}
