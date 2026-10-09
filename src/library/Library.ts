/*
 * Music library: track collection with IndexedDB persistence (audio blobs,
 * metadata, analysis cache, cue points), crates in nested folders, the
 * ingestion pipeline (tags → decode → analysis in workers), built-in demo
 * tracks, JSON export/import of crates and cue data, and smart search.
 */
import { Emitter } from '../core/emitter';
import { ANALYSIS_VERSION, type DemoSpec, type HotCue, type LibraryTrack, type PcmData, type TrackAnalysis } from '../core/types';
import { uid } from '../core/util';
import type { AnalysisPool } from '../analysis/AnalysisPool';
import { sniffPcmFormat } from '../analysis/pcm';
import { makeKey, parseKeyTag } from '../analysis/keys';
import { DEMO_TRACKS } from '../audio/synth';
import { dbAll, dbDelete, dbGet, dbPut } from './db';
import { readTags } from './tags';
import { lyricsFromSynced, lyricsFromText, type Lyrics } from '../lyrics/lyrics';
import { demoLyrics } from '../lyrics/demo';
import { ORIGINAL_IDS, trackInfo } from '../game/tracks';

export interface Crate {
  id: string;
  name: string;
  kind: 'folder' | 'crate';
  parent: string | null;
  trackIds: string[];
}

interface LibraryEvents extends Record<string, unknown> {
  changed: void;
  track: LibraryTrack;
  error: { track: LibraryTrack | null; message: string };
}

export const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.aif,.aiff,.aifc,.flac,.ogg,.oga,.opus,.m4a,.aac,.mp4,.webm';
const AUDIO_EXT = /\.(mp3|wav|aiff?|aifc|flac|ogg|oga|opus|m4a|aac|mp4|webm|wma|alac)$/i;

export function isAudioFile(f: File): boolean {
  return f.type.startsWith('audio/') || AUDIO_EXT.test(f.name);
}

async function artToDataUrl(pic: { mime: string; data: Uint8Array }): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(new Blob([pic.data as Uint8Array<ArrayBuffer>], { type: pic.mime }));
    const size = 192;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    const s = Math.min(bmp.width, bmp.height);
    g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
    bmp.close();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return undefined;
  }
}

export class Library extends Emitter<LibraryEvents> {
  readonly tracks = new Map<string, LibraryTrack>();
  crates: Crate[] = [];
  history: string[] = [];
  private pcmCache = new Map<string, PcmData>();
  private pcmPending = new Map<string, Promise<PcmData>>();
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  importing = 0;

  constructor(
    private pool: AnalysisPool,
    private decodeCompressed: (bytes: ArrayBuffer) => Promise<PcmData>,
  ) {
    super();
  }

  async init(): Promise<void> {
    const stored = await dbAll<LibraryTrack>('tracks');
    for (const t of stored) {
      if (t.status === 'analyzing') t.status = t.analysis ? 'ready' : 'new';
      this.tracks.set(t.id, t);
    }
    this.crates = (await dbGet<Crate[]>('kv', 'crates')) ?? [];
    this.ensureDemos();
    if (!this.crates.length) {
      const folder = this.createCrate('Sets', 'folder', null, false);
      const demo = this.createCrate('Demo Set', 'crate', folder.id, false);
      demo.trackIds = DEMO_TRACKS.map((d) => `demo-${d.spec.seed}`);
      this.createCrate('Warm Up', 'crate', folder.id, false);
      this.saveCrates();
    }
    // the game's own tracks, ready for the first gigs
    if (!this.crates.some((c) => c.name === 'First Gigs' && c.kind === 'crate')) {
      const folder = this.crates.find((c) => c.kind === 'folder' && c.name === 'Sets') ?? null;
      const first = this.createCrate('First Gigs', 'crate', folder?.id ?? null, false);
      first.trackIds = [...ORIGINAL_IDS];
      this.saveCrates();
    }
    this.emit('changed', undefined);
  }

  /** Analyse anything that is missing or outdated, in the background. */
  analyzeMissing(): void {
    for (const t of this.tracks.values()) {
      if (t.status === 'analyzing') continue;
      if (!t.analysis || t.analysis.version !== ANALYSIS_VERSION) void this.analyzeInBackground(t);
    }
  }

  private ensureDemos(): void {
    for (const d of DEMO_TRACKS) {
      const id = `demo-${d.spec.seed}`;
      const have = this.tracks.get(id);
      if (have) {
        if (!have.lyrics) {
          const l = demoLyrics(d.spec);
          if (l) {
            have.lyrics = l;
            this.saveTrack(have, 0);
          }
        }
        continue;
      }
      const t: LibraryTrack = {
        id,
        fileName: `${d.title}.demo`,
        size: 0,
        addedAt: Date.now(),
        meta: { title: d.title, artist: d.artist, album: d.energy !== undefined ? 'Deckhouse Originals' : 'Deckhouse Demo Tracks', genre: d.genre ?? d.spec.style, label: d.label, year: '2026', format: 'SYNTH', sampleRate: 44100, bitrate: 1411 },
        cues: { cue: null, hot: [] },
        source: 'demo',
        demo: d.spec,
        plays: 0,
        status: 'new',
        lyrics: demoLyrics(d.spec) ?? undefined,
      };
      this.tracks.set(id, t);
      this.saveTrack(t, 0);
    }
  }

  /** Star a track in the crate, or take the star off. */
  setFavorite(t: LibraryTrack, on: boolean): void {
    t.fav = on || undefined;
    this.saveTrack(t, 0);
    this.emit('changed', undefined);
  }

  /** Store (or clear) a track's lyrics. */
  setLyrics(t: LibraryTrack, lyrics: Lyrics | null): void {
    t.lyrics = lyrics ?? undefined;
    this.saveTrack(t, 0);
    this.emit('changed', undefined);
  }

  list(): LibraryTrack[] {
    return [...this.tracks.values()];
  }

  get(id: string): LibraryTrack | undefined {
    return this.tracks.get(id);
  }

  saveTrack(t: LibraryTrack, delay = 400): void {
    const prev = this.saveTimers.get(t.id);
    if (prev) clearTimeout(prev);
    this.saveTimers.set(
      t.id,
      setTimeout(() => {
        this.saveTimers.delete(t.id);
        void dbPut('tracks', t.id, t);
      }, delay),
    );
  }

  private touch(t: LibraryTrack): void {
    this.emit('track', t);
    this.saveTrack(t);
  }

  /* ------------------------------------------------------------------ */
  /* ingestion                                                            */
  /* ------------------------------------------------------------------ */

  async importFiles(files: Iterable<File>, crateId?: string | null, lyricFiles: File[] = []): Promise<LibraryTrack[]> {
    const list = [...files].filter(isAudioFile);
    const created: LibraryTrack[] = [];
    // sidecar lyrics: song.lrc / song.txt next to song.mp3
    const base = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase();
    const sidecars = new Map(lyricFiles.map((f) => [base(f.name), f]));
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const f = list[i++];
        const t = await this.ingest(f);
        if (t) {
          created.push(t);
          if (crateId) this.addToCrate(crateId, [t.id]);
          const side = sidecars.get(base(f.name));
          if (side) {
            const l = lyricsFromText(await side.text(), /\.lrc$/i.test(side.name) ? 'lrc' : 'pasted', t.analysis?.duration);
            if (l) this.setLyrics(t, l);
          }
        }
      }
    };
    this.importing += list.length;
    this.emit('changed', undefined);
    await Promise.all(Array.from({ length: Math.min(2, list.length) }, worker));
    return created;
  }

  private async ingest(file: File): Promise<LibraryTrack | null> {
    const dup = this.list().find((t) => t.fileName === file.name && t.size === file.size);
    if (dup) {
      this.importing--;
      return dup;
    }
    const id = uid('t');
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch (err) {
      this.importing--;
      this.emit('error', { track: null, message: `Couldn't read ${file.name}: ${String(err)}` });
      return null;
    }
    const tags = readTags(bytes, file.name);
    const t: LibraryTrack = {
      id,
      fileName: file.name,
      size: file.size,
      addedAt: Date.now(),
      meta: {
        title: tags.title || file.name,
        artist: tags.artist || '',
        album: tags.album || '',
        genre: tags.genre || '',
        label: tags.label || undefined,
        year: tags.year || '',
        bpmTag: tags.bpm,
        keyTag: tags.key,
        format: tags.format,
      },
      cues: { cue: null, hot: [] },
      source: 'file',
      plays: 0,
      status: 'analyzing',
    };
    if (tags.picture) t.meta.art = await artToDataUrl(tags.picture);
    const lyr = (tags.synced?.length ? lyricsFromSynced(tags.synced) : null) ?? (tags.lyrics ? lyricsFromText(tags.lyrics, 'tags') : null);
    if (lyr) t.lyrics = lyr;
    this.tracks.set(id, t);
    this.emit('changed', undefined);
    await dbPut('blobs', id, file);
    try {
      const pcm = await this.decode(bytes, false);
      const duration = pcm.channels[0].length / pcm.sampleRate;
      t.meta.sampleRate = pcm.sampleRate;
      t.meta.bitrate = Math.round((file.size * 8) / Math.max(1, duration) / 1000);
      this.cachePcm(id, pcm);
      t.analysis = await this.pool.analyze(pcm);
      this.applyTagHints(t);
      t.status = 'ready';
    } catch (err) {
      t.status = 'error';
      t.error = `This file couldn't be decoded by your browser (${err instanceof Error ? err.message : String(err)}).`;
      this.emit('error', { track: t, message: `${file.name}: ${t.error}` });
    }
    this.importing--;
    this.touch(t);
    this.emit('changed', undefined);
    return t;
  }

  /** When no key could be detected, fall back to the file's key tag. */
  private applyTagHints(t: LibraryTrack): void {
    if (t.analysis && !t.analysis.key && t.meta.keyTag) t.analysis.key = parseKeyTag(t.meta.keyTag);
  }

  private async decode(bytes: ArrayBuffer, priority: boolean): Promise<PcmData> {
    if (sniffPcmFormat(bytes)) {
      try {
        return await this.pool.parsePcm(bytes.slice(0), priority);
      } catch {
        /* unsupported PCM variant: let the browser decode it */
      }
    }
    return this.decodeCompressed(bytes);
  }

  private cachePcm(id: string, pcm: PcmData): void {
    this.pcmCache.delete(id);
    this.pcmCache.set(id, pcm);
    while (this.pcmCache.size > 2) this.pcmCache.delete(this.pcmCache.keys().next().value!);
  }

  /** Decoded audio for a track (cached for the two most recent tracks). */
  getPcm(t: LibraryTrack): Promise<PcmData> {
    const cached = this.pcmCache.get(t.id);
    if (cached) return Promise.resolve(cached);
    const pending = this.pcmPending.get(t.id);
    if (pending) return pending;
    const p = (async () => {
      let pcm: PcmData;
      if (t.source === 'demo' && t.demo) {
        const needs = !t.analysis || t.analysis.version !== ANALYSIS_VERSION;
        const r = await this.pool.demo(t.demo, { analyze: needs, returnPcm: true, priority: true });
        pcm = r.pcm!;
        if (r.analysis) this.setAnalysis(t, r.analysis);
      } else {
        const blob = await dbGet<Blob>('blobs', t.id);
        if (!blob) throw new Error('The audio for this track is no longer stored in this browser. Import the file again.');
        pcm = await this.decode(await blob.arrayBuffer(), true);
      }
      this.cachePcm(t.id, pcm);
      return pcm;
    })();
    this.pcmPending.set(t.id, p);
    p.finally(() => this.pcmPending.delete(t.id)).catch(() => {});
    return p;
  }

  private setAnalysis(t: LibraryTrack, a: TrackAnalysis): void {
    t.analysis = a;
    this.applyTagHints(t);
    t.status = 'ready';
    this.touch(t);
    this.emit('changed', undefined);
  }

  /** Make sure the track has current analysis (used right before loading a deck). */
  async ensureAnalysis(t: LibraryTrack, pcm: PcmData): Promise<TrackAnalysis> {
    if (t.analysis && t.analysis.version === ANALYSIS_VERSION) return t.analysis;
    t.status = 'analyzing';
    this.emit('track', t);
    const a = await this.pool.analyze(pcm, true);
    this.setAnalysis(t, a);
    return a;
  }

  private async analyzeInBackground(t: LibraryTrack): Promise<void> {
    t.status = 'analyzing';
    this.emit('track', t);
    try {
      if (t.source === 'demo' && t.demo) {
        const r = await this.pool.demo(t.demo, { analyze: true, returnPcm: false });
        if (r.analysis) this.setAnalysis(t, r.analysis);
      } else {
        const pcm = await this.getPcm(t);
        const a = await this.pool.analyze(pcm);
        this.setAnalysis(t, a);
      }
    } catch (err) {
      t.status = 'error';
      t.error = err instanceof Error ? err.message : String(err);
      this.touch(t);
    }
  }

  markPlayed(t: LibraryTrack): void {
    t.plays++;
    this.history = [t.id, ...this.history.filter((x) => x !== t.id)].slice(0, 100);
    this.touch(t);
    this.emit('changed', undefined);
  }

  updateCues(t: LibraryTrack, cues: { cue: number | null; hot: (HotCue | null)[] }): void {
    t.cues = cues;
    this.saveTrack(t);
    this.emit('track', t);
  }

  /** Manual beat-grid edits (tap tempo, ×2, ÷2, grid shift). */
  updateGrid(t: LibraryTrack, patch: { bpm?: number; firstBeat?: number }): void {
    if (!t.analysis) return;
    if (patch.bpm) t.analysis.bpm = patch.bpm;
    if (patch.firstBeat !== undefined) t.analysis.firstBeat = patch.firstBeat;
    this.touch(t);
    this.emit('changed', undefined);
  }

  async deleteTrack(id: string): Promise<void> {
    const t = this.tracks.get(id);
    if (!t || t.source === 'demo') return;
    this.tracks.delete(id);
    this.pcmCache.delete(id);
    for (const c of this.crates) c.trackIds = c.trackIds.filter((x) => x !== id);
    this.saveCrates();
    await dbDelete('tracks', id);
    await dbDelete('blobs', id);
    this.emit('changed', undefined);
  }

  /* ------------------------------------------------------------------ */
  /* crates & folders                                                     */
  /* ------------------------------------------------------------------ */

  saveCrates(): void {
    void dbPut('kv', 'crates', this.crates);
  }

  createCrate(name: string, kind: 'folder' | 'crate', parent: string | null, save = true): Crate {
    const c: Crate = { id: uid('c'), name, kind, parent, trackIds: [] };
    this.crates.push(c);
    if (save) {
      this.saveCrates();
      this.emit('changed', undefined);
    }
    return c;
  }

  crate(id: string): Crate | undefined {
    return this.crates.find((c) => c.id === id);
  }

  children(parent: string | null): Crate[] {
    return this.crates.filter((c) => c.parent === parent).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
  }

  renameCrate(id: string, name: string): void {
    const c = this.crate(id);
    if (!c || !name.trim()) return;
    c.name = name.trim();
    this.saveCrates();
    this.emit('changed', undefined);
  }

  deleteCrate(id: string): void {
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of this.crates) if (c.parent && doomed.has(c.parent) && !doomed.has(c.id)) {
        doomed.add(c.id);
        grew = true;
      }
    }
    this.crates = this.crates.filter((c) => !doomed.has(c.id));
    this.saveCrates();
    this.emit('changed', undefined);
  }

  moveCrate(id: string, parent: string | null): void {
    const c = this.crate(id);
    if (!c || c.id === parent) return;
    // prevent moving a folder into its own descendant
    let p = parent;
    while (p) {
      if (p === id) return;
      p = this.crate(p)?.parent ?? null;
    }
    c.parent = parent;
    this.saveCrates();
    this.emit('changed', undefined);
  }

  addToCrate(id: string, trackIds: string[]): void {
    const c = this.crate(id);
    if (!c || c.kind !== 'crate') return;
    for (const t of trackIds) if (!c.trackIds.includes(t)) c.trackIds.push(t);
    this.saveCrates();
    this.emit('changed', undefined);
  }

  removeFromCrate(id: string, trackIds: string[]): void {
    const c = this.crate(id);
    if (!c) return;
    c.trackIds = c.trackIds.filter((t) => !trackIds.includes(t));
    this.saveCrates();
    this.emit('changed', undefined);
  }

  /* ------------------------------------------------------------------ */
  /* export / import                                                      */
  /* ------------------------------------------------------------------ */

  private trackKey(t: LibraryTrack): string {
    return t.source === 'demo' ? t.id : `${t.fileName}|${t.size}`;
  }

  exportJSON(): string {
    const tracks = this.list().map((t) => ({
      key: this.trackKey(t),
      fileName: t.fileName,
      size: t.size,
      title: t.meta.title,
      artist: t.meta.artist,
      bpm: t.analysis?.bpm ?? null,
      firstBeat: t.analysis?.firstBeat ?? null,
      musicalKey: t.analysis?.key?.camelot ?? null,
      cues: t.cues,
    }));
    const keyOf = new Map(this.list().map((t) => [t.id, this.trackKey(t)]));
    const crates = this.crates.map((c) => ({ id: c.id, name: c.name, kind: c.kind, parent: c.parent, tracks: c.trackIds.map((id) => keyOf.get(id)).filter(Boolean) }));
    return JSON.stringify({ app: 'deckhouse', version: 1, exportedAt: new Date().toISOString(), crates, tracks }, null, 2);
  }

  importJSON(text: string): { crates: number; matched: number; missing: number } {
    const data = JSON.parse(text) as {
      app?: string;
      crates?: { id: string; name: string; kind: 'folder' | 'crate'; parent: string | null; tracks: string[] }[];
      tracks?: { key: string; fileName: string; size: number; title: string; artist: string; bpm: number | null; firstBeat: number | null; cues: LibraryTrack['cues'] }[];
    };
    if (data.app !== 'deckhouse') throw new Error('This file is not a Deckhouse library export.');
    const byKey = new Map(this.list().map((t) => [this.trackKey(t), t]));
    const byName = new Map(this.list().map((t) => [`${t.meta.artist}|${t.meta.title}`.toLowerCase(), t]));
    let matched = 0;
    let missing = 0;
    const idForKey = new Map<string, string>();
    for (const x of data.tracks ?? []) {
      const t = byKey.get(x.key) ?? byName.get(`${x.artist}|${x.title}`.toLowerCase());
      if (!t) {
        missing++;
        continue;
      }
      matched++;
      idForKey.set(x.key, t.id);
      if (x.cues) t.cues = x.cues;
      if (t.analysis && x.bpm) t.analysis.bpm = x.bpm;
      if (t.analysis && x.firstBeat != null) t.analysis.firstBeat = x.firstBeat;
      this.saveTrack(t);
    }
    const idMap = new Map<string, string>();
    for (const c of data.crates ?? []) idMap.set(c.id, uid('c'));
    for (const c of data.crates ?? []) {
      this.crates.push({
        id: idMap.get(c.id)!,
        name: c.name,
        kind: c.kind,
        parent: c.parent ? idMap.get(c.parent) ?? null : null,
        trackIds: (c.tracks ?? []).map((k) => idForKey.get(k)).filter((x): x is string => !!x),
      });
    }
    this.saveCrates();
    this.emit('changed', undefined);
    return { crates: data.crates?.length ?? 0, matched, missing };
  }
}

/* ------------------------------------------------------------------ */
/* smart search                                                         */
/* ------------------------------------------------------------------ */

export interface SearchQuery {
  text: string;
  bpmMin?: number;
  bpmMax?: number;
  keys?: Set<string>;
}

/** Parses "deep house bpm:120-126 key:8A artist:foo" style queries. */
export function parseSearch(q: string): SearchQuery & { fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const words: string[] = [];
  let bpmMin: number | undefined;
  let bpmMax: number | undefined;
  let keys: Set<string> | undefined;
  for (const tok of q.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(\w+):(.+)$/.exec(tok);
    if (!m) {
      words.push(tok.toLowerCase());
      continue;
    }
    const [, k, v] = m;
    const key = k.toLowerCase();
    if (key === 'bpm') {
      const r = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/.exec(v);
      if (r) {
        bpmMin = parseFloat(r[1]);
        bpmMax = r[2] ? parseFloat(r[2]) : bpmMin + 0.99;
        if (!r[2]) bpmMin -= 0.5;
      }
    } else if (key === 'key') {
      const parsed = parseKeyTag(v);
      if (parsed) keys = new Set([parsed.camelot]);
    } else fields[key] = v.toLowerCase();
  }
  return { text: words.join(' '), bpmMin, bpmMax, keys, fields };
}

export function matchTrack(t: LibraryTrack, q: ReturnType<typeof parseSearch>): boolean {
  const m = t.meta;
  const info = q.text || q.fields.tag || q.fields.energy ? trackInfo(t) : null;
  if (q.text) {
    // tags count as words: "rave" finds rave-tagged tracks
    const hay = `${m.title} ${m.artist} ${m.album} ${m.genre} ${t.fileName} ${info!.tags.join(' ')}`.toLowerCase();
    for (const w of q.text.split(' ')) if (!hay.includes(w)) return false;
  }
  for (const [k, v] of Object.entries(q.fields)) {
    if (k === 'tag') {
      if (!info!.tags.some((x) => x.startsWith(v))) return false;
      continue;
    }
    if (k === 'energy') {
      // energy:7 or energy:5-8
      const r = /^(\d+)(?:-(\d+))?$/.exec(v);
      if (r && (info!.energy < +r[1] || info!.energy > +(r[2] ?? r[1]))) return false;
      continue;
    }
    const val = (k === 'title' ? m.title : k === 'artist' ? m.artist : k === 'album' ? m.album : k === 'genre' ? m.genre : '').toLowerCase();
    if (!val.includes(v)) return false;
  }
  const bpm = t.analysis?.bpm;
  if (q.bpmMin !== undefined && (!bpm || bpm < q.bpmMin)) return false;
  if (q.bpmMax !== undefined && (!bpm || bpm > q.bpmMax)) return false;
  if (q.keys && (!t.analysis?.key || !q.keys.has(t.analysis.key.camelot))) return false;
  return true;
}

export function demoKey(spec: DemoSpec) {
  return makeKey(spec.root, spec.minor);
}
