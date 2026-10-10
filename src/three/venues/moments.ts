/*
 * What the venues share with the rest of the app:
 *   setClock   how far through the set we are (0 → 1). The open-air venues
 *              light themselves by it: golden hour to night on the Rooftop,
 *              sunset at the Beach Club, the sunrise across the closing set.
 *              In free play it runs on its own while the music plays.
 *   moments    a venue's signature moment as it happens, so the app can mark
 *              it for the replay buffer, cheer, and change the room's sound
 *              (the bridge's echo on the boat).
 */

export const setClock = {
  /** 0 at the first track, 1 at the end of the set */
  progress: 0,
  /** a gig is running (free play otherwise) */
  gig: false,
  /** free play: minutes for the clock to run from start to end */
  freeMinutes: 20,
};

/** advance the free-play clock (call every frame); a gig sets progress itself */
export function tickFreeClock(dt: number, playing: boolean): void {
  if (setClock.gig || !playing) return;
  setClock.progress = Math.min(1, setClock.progress + dt / (setClock.freeMinutes * 60));
}

export interface Moment {
  venue: string;
  /** what happened, for the replay buffer's marker ("The roller door goes up") */
  label: string;
  /** the room's sound changes for a few seconds (a bridge overhead) */
  echo?: number;
  /** the crowd's reaction */
  crowd?: 'cheer' | 'whoa' | 'chant';
}

const listeners = new Set<(m: Moment) => void>();

export const moments = {
  on(fn: (m: Moment) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(m: Moment): void {
    for (const fn of listeners) fn(m);
  },
};

/**
 * "Hold it at the top": a signature moment's trigger. Counts the seconds the
 * room stays above a vibe level while the music plays, and lets it fire once
 * per set (re-armed when the set clock goes back to the start).
 */
export class PeakTrigger {
  private held = 0;
  fired = false;
  private lastProgress = 0;

  constructor(
    private level = 0.86,
    private seconds = 10,
  ) {}

  /** true on the frame the moment should happen */
  update(dt: number, hype: number, playing: boolean): boolean {
    if (setClock.progress < this.lastProgress - 0.2) this.reset();
    this.lastProgress = setClock.progress;
    if (this.fired) return false;
    this.held = playing && hype >= this.level ? this.held + dt : Math.max(0, this.held - dt * 2);
    if (this.held >= this.seconds) {
      this.fired = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.held = 0;
    this.fired = false;
  }
}
