/*
 * The decks as the room hears them, for the vibe meter (game/vibe.ts): who's
 * up and how loud, where each is in its beat grid, its key, the energy it
 * brings (from the track's sections, or the live audio for imported music),
 * and what the DJ is doing with the EQ, filter, echo and loop roll.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { LibraryTrack } from '../core/types';
import type { Features } from '../visualizer/AudioFeatures';
import { energyAt, sectionAt, trackInfo, type TrackInfo } from './tracks';
import type { DeckSnap } from './vibe';

export class Snapshot {
  private info = new Map<string, TrackInfo>();

  constructor(private engine: AudioEngine) {}

  /** what the game knows about a track (cached: it doesn't change mid-set) */
  infoFor(t: LibraryTrack): TrackInfo {
    // an imported track's estimate improves once it's analysed
    const key = `${t.id}:${t.analysis ? 1 : 0}`;
    let i = this.info.get(key);
    if (!i) {
      i = trackInfo(t);
      this.info.set(key, i);
    }
    return i;
  }

  decks(f: Features): DeckSnap[] {
    const e = this.engine;
    const fx = e.fx;
    const echoing = fx.on && (fx.type === 'echo' || fx.type === 'pingpong') && fx.depth > 0.15;
    return e.decks.map((d, i): DeckSnap => {
      const ch = e.channels[i];
      const t = d.track;
      const info = t ? this.infoFor(t) : null;
      const pos = d.displayPosition();
      const loaded = d.loaded && !!t;
      return {
        id: d.id,
        trackId: loaded ? t!.id : null,
        artist: t?.meta.artist ?? '',
        playing: loaded && d.playing,
        audible: ch ? Math.max(0, Math.min(1, ch.state.fader * ch.xfGain)) : 0,
        bpm: d.bpm,
        beat: d.beatPosition(pos),
        key: d.currentKey(),
        // marked tracks: their energy at this point; imported music: its rating, moved by the live audio
        energy: info ? (info.sections ? energyAt(info, pos) : Math.min(1, (info.energy / 10) * 0.6 + f.energy * 0.5)) : 0,
        section: info ? (sectionAt(info.sections, pos)?.kind ?? null) : null,
        low: ch?.state.low ?? 0.5,
        filter: ch?.state.filter ?? 0.5,
        echo: echoing && (fx.targets.has('M') || fx.targets.has(d.id as 1 | 2 | 3 | 4)),
        roll: d.loop.active && d.loop.roll,
      };
    });
  }

  /** the master level, 0..1 (silence below about 0.01) */
  level(): number {
    const [l, r] = this.engine.mixer.masterLevels();
    return Math.max(l, r);
  }
}
