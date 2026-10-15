/*
 * Keeps the crowd's next song request ready (game/songRequests.ts). The AI
 * takes a few seconds to answer, so one request is asked for ahead of time
 * and swapped for a fresh one when it goes stale (the room heard the track,
 * or the night moved on). Taking one when none is ready, or with no key, or
 * with the AI down, gives the crowd's own lines straight away.
 *
 * A gig asks through its Requests (scored). In free play the crowd asks every
 * few minutes of music too, when the setting is on: the Up next card shows
 * it, and playing the track gets a cheer.
 */
import { aiReady, AiError, chat, type AiProblem } from '../core/ai';
import { prefs } from '../core/prefs';
import type { LibraryTrack } from '../core/types';
import { builtInAsk, parseRequest, requestPrompt, shortlist, type AskContext, type SongAsk, type SongCandidate } from '../game/songRequests';
import type { Library } from '../library/Library';
import { genreOf } from '../library/genres';
import type { NextUp } from './nextup';

export interface SongRequesterHost {
  library: Library;
  nextUp: NextUp;
  /** the night as the crowd sees it (the shortlist comes from here) */
  context(): Omit<AskContext, 'recent'>;
}

export type FreeRequestEvent = { what: 'ask' | 'met' | 'gone'; ask: SongAsk };

/** seconds a ready request stays fresh, and between tries when the AI fails */
const FRESH = 150;
const RETRY = 20;
const RETRY_DOWN = 90;
/** free play: seconds of music between requests, and how long one stands */
const FREE_GAP: [number, number] = [150, 240];
const FREE_STANDS = 240;

export class SongRequester {
  /** what went wrong the last time the AI was asked (null: it answered, or it hasn't been asked) */
  problem: AiProblem | null = null;
  /** the request standing in free play */
  free: SongAsk | null = null;
  private ready: SongAsk | null = null;
  private readyAt = -1e9;
  private busy = false;
  private triedAt = -1e9;
  private t = 0;
  private recent: string[] = [];
  private freeT = 0;
  private freeNext = 90;
  private freeAt = 0;

  constructor(private host: SongRequesterHost) {}

  /** every frame: keep a request ready */
  update(dt: number): void {
    this.t += dt;
    const r = this.ready;
    if (r && (this.host.nextUp.used(r.trackId) || this.t - this.readyAt > FRESH)) this.ready = null;
    if (this.ready || this.busy) return;
    if (this.t - this.triedAt < (this.problem && this.problem !== 'empty' ? RETRY_DOWN : RETRY)) return;
    this.triedAt = this.t;
    void this.prepare();
  }

  /** a request for right now: the one kept ready, or the crowd's own */
  take(): SongAsk | null {
    let ask = this.ready && !this.host.nextUp.used(this.ready.trackId) ? this.ready : null;
    this.ready = null;
    // asked for the next one soon
    this.triedAt = Math.min(this.triedAt, this.t - RETRY + 5);
    if (!ask) ask = builtInAsk(this.candidates(), { recent: this.recent });
    if (ask) this.recent = [...this.recent.filter((w) => w !== ask!.who), ask.who].slice(-6);
    return ask;
  }

  /** a new night: new people */
  reset(): void {
    this.recent = [];
    this.ready = null;
    this.free = null;
    this.freeT = 0;
    this.freeNext = 90;
  }

  /**
   * Free play, every frame: after a few minutes of music someone asks; the
   * request stands until the track plays or it's been a few minutes.
   */
  freeUpdate(dt: number, playing: boolean, audible: string[]): FreeRequestEvent[] {
    const out: FreeRequestEvent[] = [];
    if (!prefs.crowdRequests) {
      if (this.free) this.free = null;
      return out;
    }
    if (this.free) {
      const f = this.free;
      if (audible.includes(f.trackId)) {
        this.free = null;
        out.push({ what: 'met', ask: f });
      } else if (this.t - this.freeAt > FREE_STANDS) {
        this.free = null;
        out.push({ what: 'gone', ask: f });
      }
      return out;
    }
    if (!playing) return out;
    this.freeT += dt;
    if (this.freeT < this.freeNext) return out;
    this.freeT = 0;
    this.freeNext = FREE_GAP[0] + Math.random() * (FREE_GAP[1] - FREE_GAP[0]);
    const ask = this.take();
    if (!ask) return out;
    this.free = ask;
    this.freeAt = this.t;
    out.push({ what: 'ask', ask });
    return out;
  }

  /** the shortlist for right now */
  private candidates(): SongCandidate[] {
    const lib = this.host.library;
    const nu = this.host.nextUp;
    const asCand = (t: LibraryTrack | undefined): SongCandidate | null => (t && t.analysis ? { id: t.id, title: t.meta.title || t.fileName, artist: t.meta.artist || '', bpm: t.analysis.bpm, genre: genreOf(t).genre || undefined } : null);
    const ranked = nu
      .candidates(6)
      .map((s) => asCand(lib.get(s.id)))
      .filter((c): c is SongCandidate => !!c);
    const ids = new Set(ranked.map((c) => c.id));
    // the wildcards: anything else the room hasn't heard (a sample is plenty)
    const rest: SongCandidate[] = [];
    for (const t of lib.list()) {
      if (rest.length >= 40) break;
      if (ids.has(t.id) || t.status === 'error' || nu.used(t.id)) continue;
      const c = asCand(t);
      if (c) rest.push(c);
    }
    return shortlist(ranked, rest);
  }

  private async prepare(): Promise<void> {
    const cands = this.candidates();
    if (!cands.length) return;
    if (!aiReady()) {
      // no key: the crowd's own lines are made when they're needed
      this.problem = null;
      return;
    }
    this.busy = true;
    try {
      const text = await chat(requestPrompt(cands, { ...this.host.context(), recent: this.recent }), { maxTokens: 400, temperature: 1 });
      const ask = parseRequest(text, cands);
      this.problem = ask ? null : 'empty';
      if (ask && !this.host.nextUp.used(ask.trackId)) {
        this.ready = ask;
        this.readyAt = this.t;
      }
    } catch (e) {
      this.problem = e instanceof AiError ? e.problem : 'server';
    } finally {
      this.busy = false;
    }
  }
}
