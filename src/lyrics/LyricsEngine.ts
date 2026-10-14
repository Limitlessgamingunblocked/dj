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
  /** how much of this deck the room hears (channel fader × crossfader) */
  weight: number;
  /** one beat at the deck's current tempo, in track seconds (0 without a grid) */
  beatLen: number;
  /** where the lyrics came from */
  source: Lyrics['source'];
  /** the AI is still listening: these are the words heard so far */
  listening: boolean;
}

export interface LyricSourceOf {
  lyrics: Lyrics;
  title: string;
  /** still being heard by the AI */
  listening?: boolean;
}

export class LyricsEngine {
  private lastKey = new Map<number, string>();

  constructor(
    private engine: AudioEngine,
    private lyricsOf: (deck: number) => LyricSourceOf | null,
  ) {}

  /** The loudest deck's lyrics (the screens and the lights follow one). */
  frame(): LyricFrame | null {
    return this.frames()[0] ?? null;
  }

  /** Every deck the room can hear that has timed lyrics, loudest first. */
  frames(): LyricFrame[] {
    const out: LyricFrame[] = [];
    for (const d of this.engine.decks) {
      const l = d.playing && d.loaded ? this.lyricsOf(d.id) : null;
      const ch = this.engine.channels[d.id - 1];
      const w = ch ? ch.state.fader * ch.xfGain : 0;
      if (!l || l.lyrics.timing === 'none' || !l.lyrics.lines.length || w <= 0.12) {
        this.lastKey.delete(d.id);
        continue;
      }
      const lyr = l.lyrics;
      const pos = d.displayPosition() - lyr.offset;
      const lines = lyr.lines;
      const i = lineAt(lines, pos + 0.05);
      const cur = i >= 0 ? lines[i] : null;
      const inLine = cur && pos <= cur.end + 0.6 ? cur : null;
      const key = `${inLine ? i : -1}`;
      const started = !!inLine && key !== this.lastKey.get(d.id) && pos - inLine.t < 0.4;
      this.lastKey.set(d.id, key);
      out.push({
        deck: d.id,
        title: l.title,
        lines,
        index: i,
        line: inLine,
        next: lines[i + 1] ?? null,
        pos,
        lineStarted: started,
        weight: w,
        beatLen: d.analysis ? d.beatLen : 0,
        source: lyr.source,
        listening: !!l.listening,
      });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }
}
