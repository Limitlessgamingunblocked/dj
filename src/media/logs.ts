/*
 * What happened when, on the audio clock (seconds): the tracks that played
 * (for tracklists, Section 11.6) and the moments worth keeping (smart
 * markers, Section 12.5). Recordings and the replay buffer cut a window out
 * of these, with times made relative to the window's start.
 */
import type { Marker, TracklistEntry } from '../core/models';

export interface NowTrack {
  id: string;
  title: string;
  artist: string;
}

/** a track counts once it has been the main one for this long (a quick check of the next track doesn't) */
export const TRACK_SETTLE = 6;

export class TracklistLog {
  readonly entries: (TracklistEntry & { id: string })[] = [];
  private cand: (NowTrack & { since: number }) | null = null;

  /** every frame (or a few times a second): the track the room hears most, or null */
  update(t: number, cur: NowTrack | null): void {
    if (!cur) {
      this.cand = null;
      return;
    }
    if (this.entries.at(-1)?.id === cur.id) {
      this.cand = null;
      return;
    }
    if (!this.cand || this.cand.id !== cur.id) this.cand = { ...cur, since: t };
    else if (t - this.cand.since >= TRACK_SETTLE) {
      this.entries.push({ id: cur.id, at: this.cand.since, title: cur.title, artist: cur.artist });
      if (this.entries.length > 1000) this.entries.splice(0, this.entries.length - 1000);
      this.cand = null;
    }
  }

  /** the tracks heard between `from` and `to`, times from `from`; the one already playing at `from` starts at 0 */
  window(from: number, to: number): TracklistEntry[] {
    const out: TracklistEntry[] = [];
    let before: TracklistEntry | null = null;
    for (const e of this.entries) {
      if (e.at <= from) before = e;
      else if (e.at < to) out.push({ at: e.at - from, title: e.title, artist: e.artist });
    }
    if (before) out.unshift({ at: 0, title: before.title, artist: before.artist });
    return out;
  }

  clear(): void {
    this.entries.length = 0;
    this.cand = null;
  }
}

export class MarkerLog {
  readonly items: Marker[] = [];

  /** a moment; the same kind twice within `gap` seconds counts once */
  add(at: number, kind: Marker['kind'], label: string, gap = 4): void {
    const last = [...this.items].reverse().find((m) => m.kind === kind);
    if (last && at - last.at < gap) return;
    this.items.push({ at, kind, label });
    if (this.items.length > 2000) this.items.splice(0, this.items.length - 2000);
  }

  window(from: number, to: number): Marker[] {
    return this.items.filter((m) => m.at >= from && m.at <= to).map((m) => ({ ...m, at: m.at - from }));
  }

  clear(): void {
    this.items.length = 0;
  }
}

/**
 * A sensible clip around a marker (Section 12.5): a few bars before it and
 * more after, inside the audio there is. Drops and transitions want the run-up;
 * peaks want the reaction.
 */
export function clipAround(m: Pick<Marker, 'at' | 'kind'>, total: number, bar = 2): { from: number; to: number } {
  const before = m.kind === 'drop' || m.kind === 'transition' ? 8 * bar : 4 * bar;
  const after = m.kind === 'transition' ? 8 * bar : 12 * bar;
  let from = Math.max(0, m.at - before);
  let to = Math.min(total, m.at + after);
  if (to - from < Math.min(total, 15)) {
    from = Math.max(0, to - 15);
    to = Math.min(total, from + 15);
  }
  return { from, to };
}
