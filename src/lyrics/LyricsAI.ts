/*
 * AI lyrics on the main thread: a queue of tracks to listen to, the
 * listening worker (listen.worker.ts), and what comes back.
 *
 * It listens from the part of the track under the playhead first, and the
 * words show as karaoke while it's still listening (kept apart from the
 * track's own lyrics until it finishes, so a half-heard song is never saved).
 * When it's done the lyrics are saved with the track, so it only ever
 * listens to a song once.
 *
 * Two jobs: "detect" writes the lyrics from what it hears; "time" keeps
 * lyrics you already have (pasted, looked up, from the tags) and only takes
 * their timing, word by word, from what it hears.
 */
import ListenWorker from './listen.worker?worker&inline';
import { Emitter } from '../core/emitter';
import { loadSetting, saveSetting } from '../core/settings';
import type { Library } from '../library/Library';
import type { LibraryTrack } from '../core/types';
import type { LyricWord, Lyrics } from './lyrics';
import type { ListenQuality } from './aiModels';
import { lyricsFromHeard, resampleTo16k, timeKnownLyrics } from './listen';
import type { ListenIn, ListenOut, ListenStage } from './listen.worker';

export type AiStatus = 'queued' | 'preparing' | ListenStage | 'done' | 'nothing' | 'error';

export interface AiState {
  trackId: string;
  mode: 'detect' | 'time';
  status: AiStatus;
  /** 0..1 within the status */
  progress: number;
  /** 0..1 over the whole job, for one bar */
  overall: number;
  device?: string;
  message?: string;
  /** lines heard so far */
  lines: number;
}

export interface AiSettings {
  /** listen to every track loaded on a deck that has no lyrics */
  auto: boolean;
  quality: ListenQuality;
  /** a language code, or 'auto' */
  language: string;
  /** the guide has been read and the download agreed to */
  agreed: boolean;
}

const KEY = 'lyricsAi';
const DEFAULTS: AiSettings = { auto: true, quality: 'standard', language: 'auto', agreed: false };

/** how the stages add up on one bar */
const SPAN: Partial<Record<AiStatus, [number, number]>> = {
  preparing: [0, 0.03],
  runtime: [0.03, 0.06],
  download: [0.06, 0.4],
  warmup: [0.4, 0.42],
  analysing: [0.42, 0.5],
  language: [0.5, 0.52],
  listening: [0.52, 1],
};

/** a stage in words, for the deck chip and the editor */
export function statusText(s: AiState): string {
  const pct = `${Math.round(s.progress * 100)}%`;
  switch (s.status) {
    case 'queued':
      return 'Waiting to listen';
    case 'preparing':
      return 'Getting the vocals ready';
    case 'runtime':
      return 'Starting the AI';
    case 'download':
      return `Downloading the AI model ${pct}`;
    case 'warmup':
      return 'Warming up the AI';
    case 'analysing':
      return 'Finding where the vocals are';
    case 'language':
      return 'Working out the language';
    case 'listening':
      return `${s.mode === 'time' ? 'Timing the words' : 'Listening'} ${pct}`;
    case 'done':
      return s.mode === 'time' ? 'Timed by AI' : 'Lyrics found';
    case 'nothing':
      return 'No vocals heard';
    case 'error':
      return s.message ?? 'The AI could not listen';
  }
}

export function loadAiSettings(): AiSettings {
  return { ...DEFAULTS, ...loadSetting<Partial<AiSettings>>(KEY, {}) };
}

interface Job {
  id: number;
  track: LibraryTrack;
  mode: 'detect' | 'time';
  from: number;
  words: LyricWord[];
  /** the lyrics being timed (time mode) */
  known: Lyrics | null;
  /** detect: replace lyrics the track already has */
  replace: boolean;
  done: (r: { lyrics: Lyrics | null; matched?: number }) => void;
  fail: (e: Error) => void;
}

export class LyricsAI extends Emitter<{ state: AiState; done: { track: LibraryTrack; lyrics: Lyrics | null; mode: 'detect' | 'time'; matched?: number } }> {
  readonly settings: AiSettings = loadAiSettings();
  private worker: Worker | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private jobs = new Map<number, Job>();
  private nextId = 1;
  private states = new Map<string, AiState>();
  /** what's been heard so far of a track still being listened to, for the karaoke */
  private partials = new Map<string, Lyrics>();

  constructor(private library: Library) {
    super();
  }

  save(): void {
    saveSetting(KEY, this.settings);
  }

  /** whether this browser can run it at all */
  static supported(): boolean {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
  }

  state(trackId: string): AiState | undefined {
    return this.states.get(trackId);
  }

  /** the job for this track is queued or running */
  busy(trackId: string): boolean {
    const s = this.states.get(trackId);
    return !!s && s.status !== 'done' && s.status !== 'nothing' && s.status !== 'error';
  }

  /** words heard so far, while a track is still being listened to */
  partial(trackId: string): Lyrics | null {
    return this.partials.get(trackId) ?? null;
  }

  /**
   * Listen to a track. `from` is where to start (the playhead), so the part
   * you hear first comes first. Time mode times `known` (default: the
   * track's lyrics); detect with `replace` overwrites lyrics it already has.
   */
  listen(track: LibraryTrack, mode: 'detect' | 'time', opts: { from?: number; known?: Lyrics; replace?: boolean } = {}): Promise<{ lyrics: Lyrics | null; matched?: number }> {
    if (this.busy(track.id)) return Promise.reject(new Error('Already listening to this track.'));
    const known = mode === 'time' ? (opts.known ?? track.lyrics ?? null) : null;
    if (mode === 'time' && !known) return Promise.reject(new Error('There are no lyrics to time yet.'));
    return new Promise((resolve, reject) => {
      const job: Job = { id: this.nextId++, track, mode, from: opts.from ?? 0, words: [], known, replace: !!opts.replace, done: resolve, fail: reject };
      this.jobs.set(job.id, job);
      this.set(job, 'queued', 0);
      void this.send(job);
    });
  }

  cancel(trackId: string): void {
    for (const job of this.jobs.values()) {
      if (job.track.id !== trackId) continue;
      this.worker?.postMessage({ type: 'cancel', job: job.id } satisfies ListenIn);
      this.jobs.delete(job.id);
      this.partials.delete(trackId);
      this.states.delete(trackId);
      job.fail(new Error('Stopped.'));
      this.emit('state', { trackId, mode: job.mode, status: 'error', progress: 0, overall: 0, lines: 0, message: 'Stopped' });
    }
    this.idleLater();
  }

  /**
   * A track went onto a deck: listen if it's on (and agreed to), the track
   * has no lyrics and it hasn't been listened to before.
   */
  trackLoaded(track: LibraryTrack, from: number): void {
    const s = this.settings;
    if (!s.auto || !s.agreed || !LyricsAI.supported()) return;
    if (track.lyrics || track.aiScan || track.source === 'demo' || this.busy(track.id)) return;
    this.listen(track, 'detect', { from }).catch(() => {});
  }

  private set(job: Job, status: AiStatus, progress: number, extra: Partial<AiState> = {}): void {
    const span = SPAN[status];
    const overall = span ? span[0] + (span[1] - span[0]) * progress : status === 'done' || status === 'nothing' ? 1 : 0;
    const prev = this.states.get(job.track.id);
    const s: AiState = { trackId: job.track.id, mode: job.mode, status, progress, overall, device: extra.device ?? prev?.device, message: extra.message, lines: extra.lines ?? prev?.lines ?? 0 };
    this.states.set(job.track.id, s);
    this.emit('state', s);
  }

  private ensureWorker(): Worker {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (this.worker) return this.worker;
    const w = new ListenWorker();
    w.onmessage = (e: MessageEvent<ListenOut>) => this.onMessage(e.data);
    w.onerror = (e) => {
      e.preventDefault();
      // the worker crashed (out of memory, usually): every job fails, the next one starts a fresh worker
      this.worker = null;
      for (const job of [...this.jobs.values()]) this.fail(job, 'The AI stopped unexpectedly (the browser may have run out of memory). Try the Standard model.');
    };
    this.worker = w;
    return w;
  }

  /** with nothing to do for two minutes, the worker (and the model's memory) goes */
  private idleLater(): void {
    if (this.jobs.size || !this.worker) return;
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (this.jobs.size) return;
      this.worker?.terminate();
      this.worker = null;
    }, 120_000);
  }

  private async send(job: Job): Promise<void> {
    try {
      this.set(job, 'preparing', 0);
      const pcm = await this.library.getPcm(job.track);
      if (!this.jobs.has(job.id)) return;
      const l = pcm.channels[0];
      const r = pcm.channels[1] ?? l;
      const left = resampleTo16k(l, pcm.sampleRate);
      await new Promise((res) => setTimeout(res, 0));
      const right = r === l ? left.slice() : resampleTo16k(r, pcm.sampleRate);
      if (!this.jobs.has(job.id)) return;
      const duration = l.length / pcm.sampleRate;
      const msg: ListenIn = { type: 'listen', job: job.id, left, right, duration, from: job.from, quality: this.settings.quality, language: this.settings.language };
      this.ensureWorker().postMessage(msg, [left.buffer, right.buffer]);
    } catch (e) {
      this.fail(job, (e as Error)?.message ?? String(e));
    }
  }

  private onMessage(m: ListenOut): void {
    const job = this.jobs.get(m.job);
    if (!job) return;
    if (m.type === 'stage') this.set(job, m.stage, m.progress, { device: m.device });
    else if (m.type === 'words') {
      job.words.push(...m.words);
      // detect: show what's been heard so far as karaoke (time mode waits: half-timed lyrics jump about)
      if (job.mode === 'detect' && (!job.track.lyrics || job.replace)) {
        const l = lyricsFromHeard(job.words, '');
        if (l) this.partials.set(job.track.id, l);
      }
      this.set(job, 'listening', m.done / m.total, { lines: this.partials.get(job.track.id)?.lines.length ?? 0 });
    } else if (m.type === 'done') this.finish(job, m.model);
    else if (m.type === 'error') this.fail(job, explain(m.message));
  }

  private finish(job: Job, model: string): void {
    this.jobs.delete(job.id);
    this.partials.delete(job.track.id);
    const t = job.track;
    const duration = t.analysis?.duration ?? 0;
    let lyrics: Lyrics | null = null;
    let matched: number | undefined;
    if (job.mode === 'time' && job.known) {
      const r = timeKnownLyrics(job.known, job.words, duration, model);
      if (r) {
        // the offset goes back to zero: the new timing comes from the audio itself
        lyrics = r.lyrics;
        matched = r.matched;
        this.library.setLyrics(t, lyrics);
      }
      this.set(job, r ? 'done' : 'error', 1, r ? {} : { message: 'What the AI heard didn’t match these lyrics. Check they’re for this song.' });
    } else {
      lyrics = lyricsFromHeard(job.words, model);
      // lyrics you added while it listened win, unless you asked for these over them
      if (lyrics && (!t.lyrics || job.replace)) this.library.setLyrics(t, lyrics);
      this.library.setAiScan(t, { at: Date.now(), model, words: job.words.length });
      this.set(job, lyrics ? 'done' : 'nothing', 1, { lines: lyrics?.lines.length ?? 0 });
    }
    job.done({ lyrics, matched });
    this.emit('done', { track: t, lyrics, mode: job.mode, matched });
    this.idleLater();
  }

  private fail(job: Job, message: string): void {
    this.jobs.delete(job.id);
    this.partials.delete(job.track.id);
    this.set(job, 'error', 0, { message });
    job.fail(new Error(message));
    this.idleLater();
  }
}

/** an error from the worker, in words for the player */
export function explain(raw: string): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'The AI downloads its model the first time. Connect to the internet and try again.';
  if (/fetch|network|Failed to load|import|404|CORS/i.test(raw)) return 'The AI model couldn’t download. Check the connection (and that nothing blocks jsdelivr.net or huggingface.co), then try again.';
  if (/memory|allocation|OOM/i.test(raw)) return 'Not enough memory for the AI model. Close other tabs or pick the Standard model.';
  return `The AI couldn’t listen to this track (${raw.slice(0, 120)}).`;
}

