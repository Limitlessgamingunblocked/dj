/*
 * Follows the lyrics of whatever the room is hearing: picks the loudest
 * playing deck whose track has timed lyrics and reports the current line and
 * word from the deck's playback position every frame.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import { lineAt, type LyricLine, type Lyrics } from './lyrics';

export interface LyricFrame {
  deck: number;
  title: string;
  lines: LyricLine[];
  index: number;
  /** current line, or null in a gap */
  line: LyricLine | null;
  /** the line coming up next */
  next: LyricLine | null;
  /** lyrics clock: track time + offset */
  pos: number;
  /** a new line started this frame */
  lineStarted: boolean;
}

export class LyricsEngine {
  private lastKey = '';

  constructor(
    private engine: AudioEngine,
    private lyricsOf: (deck: number) => { lyrics: Lyrics; title: string } | null,
  ) {}

  frame(): LyricFrame | null {
    let best: { id: number; w: number; l: { lyrics: Lyrics; title: string } } | null = null;
    for (const d of this.engine.decks) {
      if (!d.playing || !d.loaded) continue;
      const l = this.lyricsOf(d.id);
      if (!l || l.lyrics.timing === 'none' || !l.lyrics.lines.length) continue;
      const ch = this.engine.channels[d.id - 1];
      const w = ch ? ch.state.fader * ch.xfGain : 0;
      if (w > 0.12 && (!best || w > best.w)) best = { id: d.id, w, l };
    }
    if (!best) {
      this.lastKey = '';
      return null;
    }
    const deck = this.engine.deck(best.id);
    const lyr = best.l.lyrics;
    const pos = deck.displayPosition() - lyr.offset;
    const lines = lyr.lines;
    const i = lineAt(lines, pos + 0.05);
    const cur = i >= 0 ? lines[i] : null;
    const inLine = cur && pos <= cur.end + 0.6 ? cur : null;
    const key = `${best.id}:${inLine ? i : -1}`;
    const started = !!inLine && key !== this.lastKey && pos - inLine.t < 0.4;
    this.lastKey = key;
    return { deck: best.id, title: best.l.title, lines, index: i, line: inLine, next: lines[i + 1] ?? null, pos, lineStarted: started };
  }
}
