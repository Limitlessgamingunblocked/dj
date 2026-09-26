import type { AudioEngine } from '../audio/AudioEngine';
import type { ControlRegistry } from '../core/controls';
import type { Emitter } from '../core/emitter';
import type { LibraryTrack } from '../core/types';
import type { Library } from '../library/Library';

export interface AppEvents extends Record<string, unknown> {
  board: string;
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
}
