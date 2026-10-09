/*
 * My Sets (Section 11.6): every recording, Save That Mix and clip, with its
 * date, venue, length, grade, tracklist, markers, thumbnail and cover. The
 * list is a career save (RECORDINGS); the files live in the media store.
 * Exports are made on demand: WAV and MP3 from the lossless audio, the video
 * as recorded, the cover as PNG, the tracklist as text.
 */
import { mp3From, wavFrom } from '../audio/capture/export';
import { Emitter } from '../core/emitter';
import { RECORDINGS, type Recording } from '../core/models';
import type { SaveSystem } from '../core/SaveSystem';
import { coverPng, tracklistText, type CoverInfo } from './cover';
import { mediaStore } from './MediaStore';
import type { Take } from './Studio';

export interface NewSet {
  take: Take;
  venueId: string;
  venueName: string;
  title: string;
  grade: Recording['grade'];
  source: Recording['source'];
  cover: Omit<CoverInfo, 'still'>;
  /** bar lines (seconds from the start) */
  bars?: number[];
  /** a film strip of stills and the seconds between them */
  strip?: { blob: Blob; every: number } | null;
}

export type SortKey = 'date' | 'length' | 'grade' | 'venue' | 'title';

const GRADE_ORDER = { S: 5, A: 4, B: 3, C: 2, D: 1 } as const;

export function sortSets(items: Recording[], key: SortKey, favFirst = true): Recording[] {
  const by: Record<SortKey, (a: Recording, b: Recording) => number> = {
    date: (a, b) => Date.parse(b.date) - Date.parse(a.date),
    length: (a, b) => b.seconds - a.seconds,
    grade: (a, b) => (b.grade ? GRADE_ORDER[b.grade] : 0) - (a.grade ? GRADE_ORDER[a.grade] : 0),
    venue: (a, b) => a.venue.localeCompare(b.venue),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  return [...items].sort((a, b) => (favFirst ? Number(b.favorite) - Number(a.favorite) : 0) || by[key](a, b) || Date.parse(b.date) - Date.parse(a.date));
}

/** the sets to clear to free `bytes`: oldest first, favourites kept */
export function cleanupPlan(items: Recording[], bytes: number): Recording[] {
  const old = [...items].filter((r) => !r.favorite).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const out: Recording[] = [];
  let freed = 0;
  for (const r of old) {
    if (freed >= bytes) break;
    out.push(r);
    freed += r.bytes;
  }
  return out;
}

export function safeName(s: string): string {
  return s.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'set';
}

export class SetLibrary {
  items: Recording[];
  readonly changed = new Emitter<{ list: Recording[] }>();

  constructor(private saves: SaveSystem) {
    this.items = saves.load(RECORDINGS).data.items;
  }

  private commit(): void {
    this.saves.autosave(RECORDINGS, () => ({ items: this.items }));
    this.changed.emit('list', this.items);
  }

  get(id: string): Recording | undefined {
    return this.items.find((r) => r.id === id);
  }

  get bytes(): number {
    return this.items.reduce((n, r) => n + r.bytes, 0);
  }

  private newId(prefix: string): string {
    let id = `${prefix}_${Date.now().toString(36)}`;
    while (this.items.some((r) => r.id === id || Object.values(r.files).includes(id))) id += 'x';
    return id;
  }

  /** Keep a take: its files into the store, its entry into the list. */
  async add(n: NewSet): Promise<Recording> {
    const t = n.take;
    const id = this.newId('set');
    const files: Recording['files'] = {};
    let bytes = 0;
    const put = async (kind: keyof Recording['files'], blob: Blob | undefined | null) => {
      if (!blob || !blob.size) return;
      const fid = `${id}-${kind}`;
      await mediaStore.put(fid, blob);
      files[kind] = fid;
      bytes += blob.size;
    };
    await put('pcm', t.pcm);
    await put('video', t.video);
    await put('thumb', t.thumb);
    await put('strip', n.strip?.blob);
    let still: ImageBitmap | null = null;
    try {
      if (t.thumb) still = await createImageBitmap(t.thumb);
    } catch {
      still = null;
    }
    await put('cover', await coverPng({ ...n.cover, still }, 1000));
    still?.close();
    const rec = RECORDINGS.validate({
      items: [
        {
          id,
          kind: t.mode,
          source: n.source,
          venue: n.venueId,
          date: t.date.toISOString(),
          seconds: t.seconds,
          rate: t.rate,
          grade: n.grade,
          tracklist: t.tracklist,
          markers: t.markers,
          favorite: false,
          title: n.title,
          aspect: t.aspect,
          files,
          bytes,
          bars: n.bars ?? [],
          stripEvery: n.strip?.every ?? 2,
        },
      ],
    }).items[0];
    this.items = [rec, ...this.items];
    this.commit();
    return rec;
  }

  rename(id: string, title: string): void {
    const r = this.get(id);
    if (!r) return;
    r.title = title.trim().slice(0, 80) || r.title;
    this.commit();
  }

  toggleFavorite(id: string): void {
    const r = this.get(id);
    if (!r) return;
    r.favorite = !r.favorite;
    this.commit();
  }

  async remove(ids: string[]): Promise<void> {
    const gone = this.items.filter((r) => ids.includes(r.id));
    await mediaStore.delete(gone.flatMap((r) => Object.values(r.files).filter((x): x is string => !!x)));
    this.items = this.items.filter((r) => !ids.includes(r.id));
    this.commit();
  }

  file(r: Recording, kind: keyof Recording['files']): Promise<Blob | null> {
    const id = r.files[kind];
    return id ? mediaStore.get(id) : Promise.resolve(null);
  }

  /* ------------------------------ exports ------------------------------ */

  async wav(r: Recording): Promise<Blob | null> {
    const pcm = await this.file(r, 'pcm');
    return pcm ? wavFrom(pcm, r.rate) : null;
  }

  async mp3(r: Recording, artist: string, venueName: string, onProgress?: (k: number) => void): Promise<Blob | null> {
    const pcm = await this.file(r, 'pcm');
    if (!pcm) return null;
    const cover = await this.file(r, 'cover');
    return mp3From(pcm, r.rate, { title: r.title, artist: artist || 'DJ', album: venueName, date: r.date, cover: cover ? new Uint8Array(await cover.arrayBuffer()) : undefined }, onProgress);
  }

  tracklist(r: Recording, name: string, venueName: string): Blob {
    return new Blob([tracklistText({ name, venue: venueName, date: new Date(r.date), seconds: r.seconds, title: r.title, tracklist: r.tracklist })], { type: 'text/plain;charset=utf-8' });
  }

  /** a download file name: "Night-Owl-Basement-Club-2026-10-09.mp3" */
  fileName(r: Recording, name: string, venueName: string, ext: string): string {
    return `${safeName(`${name || 'DJ'} ${venueName}`)}-${r.date.slice(0, 10)}.${ext}`;
  }
}

/** save a file the browser way (a link with `download`) */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
