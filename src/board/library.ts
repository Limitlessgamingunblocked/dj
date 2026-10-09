/*
 * Your boards (Section 13.12): saved, loaded, rated, remixed, shared by code
 * or file, with a thumbnail each. The list is a career save (`boards` v2);
 * each board's file lives in the media store (IndexedDB) as the documented
 * JSON (docs/board-format.md), checked against the catalogue when it opens.
 *
 * The local gallery: your boards plus a few showcase boards that come with
 * the game, a Board of the Week picked from them, star ratings and remixing.
 * TODO: an online gallery (upload, browse, other people's ratings) needs a
 * server; share codes and files are how boards travel for now.
 */
import { Emitter } from '../core/emitter';
import { BOARDS, type BoardEntry, type BoardsSave, type Progress } from '../core/models';
import type { SaveSystem } from '../core/SaveSystem';
import { mediaStore } from '../media/MediaStore';
import { typeInfo, type CompDef } from './catalog';
import { checkBoardFile, compact, readShareCode, shareCode, type BoardFile } from './format';
import { walkComponents } from './logic';
import { fromTemplate } from './templates';

/** what the library needs from storage (tests pass a map) */
export interface BlobStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  delete(ids: string[]): Promise<void>;
}

const fileKey = (id: string) => `board:${id}`;
const thumbKey = (id: string) => `board-thumb:${id}`;

/** the boards that come with the game, as if from the community (made-up builders) */
export const SHOWCASE: { id: string; template: string; name: string; by: string; blurb: string }[] = [
  { id: 'showcase_booth', template: 'club_real', name: 'The Booth Standard', by: 'resident_rae', blurb: 'Life-size media players and a club mixer, set up the way the clubs do.' },
  { id: 'showcase_wax', template: 'vinyl_real', name: 'Wax & Walnut', by: 'crate_kid', blurb: 'Two turntables, a rotary mixer, a setlist in marker.' },
  { id: 'showcase_club', template: 'club2', name: 'Friday Standard', by: 'basement_ben', blurb: 'The two-deck layout every club has. Nothing in the way.' },
  { id: 'showcase_pro', template: 'pro4', name: 'Four Corners', by: 'quadrant', blurb: 'Four decks, kills on every channel, FX in reach.' },
  { id: 'showcase_battle', template: 'battle', name: 'Cut Session', by: 'scratchpad_sal', blurb: 'Turntables sideways, a scratch tower in the middle.' },
  { id: 'showcase_minimal', template: 'minimal', name: 'Oak & Air', by: 'less_is', blurb: 'Two jogs, two faders, two filters, a slab of oak.' },
  { id: 'showcase_festival', template: 'festival', name: 'Main Stage Rig', by: 'pyro_pete', blurb: 'Lights, lasers, pyro and cameras at your fingertips.' },
  { id: 'showcase_chaos', template: 'chaos', name: 'Absolute Chaos', by: 'gremlin', blurb: 'Every wild add-on at once. Good luck.' },
];

export const isShowcase = (id: string) => id.startsWith('showcase_');

/** the ISO week number of a date (Board of the Week turns over on Mondays) */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7) + t.getUTCFullYear() * 53;
}

/** can this part be used yet? Sandbox opens everything; otherwise its fame tier or milestone */
export function unlocked(def: CompDef, p: Pick<Progress, 'tier' | 'milestones' | 'sandbox'>): boolean {
  const u = def.unlock;
  if (!u || p.sandbox) return true;
  if (u.tier !== undefined && p.tier < u.tier) return false;
  if (u.milestone && !p.milestones.includes(u.milestone)) return false;
  return true;
}

export function countParts(doc: BoardFile): number {
  let n = 0;
  walkComponents(doc.components, () => n++);
  return n;
}

export class BoardLibrary {
  data: BoardsSave;
  readonly changed = new Emitter<{ list: BoardEntry[] }>();
  private cache = new Map<string, BoardFile>();

  constructor(
    private saves: SaveSystem,
    private store: BlobStore = mediaStore,
  ) {
    this.data = saves.load(BOARDS).data;
    void this.flushPending();
  }

  get items(): BoardEntry[] {
    return this.data.items;
  }

  get(id: string): BoardEntry | undefined {
    return this.data.items.find((b) => b.id === id);
  }

  private commit(): void {
    this.data = BOARDS.validate(this.data);
    this.saves.autosave(BOARDS, () => this.data);
    this.changed.emit('list', this.data.items);
  }

  /** files left in an older save move into the media store */
  private async flushPending(): Promise<void> {
    const ids = Object.keys(this.data.pending);
    if (!ids.length) return;
    for (const id of ids) {
      try {
        await this.store.put(fileKey(id), new Blob([JSON.stringify(this.data.pending[id])], { type: 'application/json' }));
        delete this.data.pending[id];
      } catch {
        return; // the store isn't available: try again next time
      }
    }
    this.commit();
  }

  /** a fresh id no board has */
  newId(): string {
    let id = `board_${Date.now().toString(36)}`;
    while (this.get(id) || isShowcase(id)) id += 'x';
    return id;
  }

  /** the board that was on the stage last time, straight from the save (no waiting for the store) */
  currentFile(): BoardFile | null {
    return this.data.currentFile ? checkBoardFile(this.data.currentFile, typeInfo) : null;
  }

  /** open a board: yours from the store, or a showcase board */
  async load(id: string): Promise<BoardFile | null> {
    const cached = this.cache.get(id);
    if (cached) return structuredClone(cached);
    const show = SHOWCASE.find((s) => s.id === id);
    if (show) return fromTemplate(show.template, show.id, show.name);
    let doc: BoardFile | null = null;
    try {
      const blob = await this.store.get(fileKey(id));
      if (blob) doc = checkBoardFile(JSON.parse(await blob.text()), typeInfo);
    } catch {
      doc = null;
    }
    if (!doc && this.data.current === id) doc = this.currentFile();
    if (doc) this.cache.set(id, structuredClone(doc));
    return doc;
  }

  /** save a board (new or changed); a thumbnail if there's one */
  async save(doc: BoardFile, o: { thumb?: Blob | null; source?: BoardEntry['source']; remixOf?: string | null } = {}): Promise<BoardEntry> {
    const file = compact(doc, typeInfo) as Record<string, unknown>;
    await this.store.put(fileKey(doc.id), new Blob([JSON.stringify(file)], { type: 'application/json' }));
    if (o.thumb) await this.store.put(thumbKey(doc.id), o.thumb).catch(() => undefined);
    this.cache.set(doc.id, structuredClone(doc));
    const now = new Date().toISOString();
    const old = this.get(doc.id);
    const entry: BoardEntry = {
      id: doc.id,
      name: doc.name,
      created: old?.created ?? now,
      updated: now,
      parts: countParts(doc),
      rating: old?.rating ?? 0,
      remixOf: old?.remixOf ?? o.remixOf ?? null,
      source: old?.source ?? o.source ?? 'mine',
      plays: old?.plays ?? 0,
      favorite: old?.favorite ?? false,
    };
    const items = this.data.items.filter((b) => b.id !== doc.id);
    items.unshift(entry);
    this.data.items = items;
    if (this.data.current === doc.id) this.data.currentFile = file;
    this.commit();
    return entry;
  }

  /** the board on the stage (null for a preset) */
  setCurrent(doc: BoardFile | null): void {
    this.data.current = doc && this.get(doc.id) ? doc.id : null;
    this.data.currentFile = this.data.current && doc ? (compact(doc, typeInfo) as Record<string, unknown>) : null;
    this.commit();
  }

  async remove(id: string): Promise<void> {
    this.data.items = this.data.items.filter((b) => b.id !== id);
    if (this.data.current === id) {
      this.data.current = null;
      this.data.currentFile = null;
    }
    this.cache.delete(id);
    this.commit();
    await this.store.delete([fileKey(id), thumbKey(id)]).catch(() => undefined);
  }

  rename(id: string, name: string): void {
    const e = this.get(id);
    const clean = name.trim().slice(0, 60);
    if (!e || !clean) return;
    e.name = clean;
    const c = this.cache.get(id);
    if (c) c.name = clean;
    void this.load(id).then((doc) => doc && this.save({ ...doc, name: clean }));
  }

  /** your stars, 1–5 (0 clears) */
  rate(id: string, stars: number): void {
    const s = Math.max(0, Math.min(5, Math.round(stars)));
    if (isShowcase(id)) {
      if (s) this.data.ratings[id] = s;
      else delete this.data.ratings[id];
    } else {
      const e = this.get(id);
      if (!e) return;
      e.rating = s;
    }
    this.commit();
  }

  ratingOf(id: string): number {
    return isShowcase(id) ? (this.data.ratings[id] ?? 0) : (this.get(id)?.rating ?? 0);
  }

  toggleFavorite(id: string): void {
    const e = this.get(id);
    if (!e) return;
    e.favorite = !e.favorite;
    this.commit();
  }

  /** a gig was played on this board */
  played(id: string): void {
    const e = this.get(id);
    if (!e) return;
    e.plays++;
    this.commit();
  }

  /** a copy of any board (yours or a showcase one) to make your own; saved straight away */
  async remix(id: string): Promise<BoardFile | null> {
    const src = await this.load(id);
    if (!src) return null;
    const doc: BoardFile = { ...structuredClone(src), id: this.newId(), name: `${src.name} (remix)`.slice(0, 60), created: new Date().toISOString() };
    const thumb = await this.thumb(id);
    await this.save(doc, { source: 'remix', remixOf: id, thumb });
    return doc;
  }

  /** a share code for a board */
  code(doc: BoardFile): Promise<string> {
    return shareCode(doc, typeInfo);
  }

  /** a board from a share code, saved as yours (with a new id, so it never overwrites one) */
  async importCode(code: string): Promise<BoardFile | null> {
    const doc = await readShareCode(code, typeInfo);
    if (!doc) return null;
    doc.id = this.newId();
    await this.save(doc, { source: 'code' });
    return doc;
  }

  /** a board from a file's text */
  async importFile(text: string): Promise<BoardFile | null> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const doc = checkBoardFile(raw, typeInfo);
    if (!doc) return null;
    doc.id = this.newId();
    await this.save(doc, { source: 'file' });
    return doc;
  }

  /** the file to save to disk: the documented format, without defaults */
  exportText(doc: BoardFile): string {
    return JSON.stringify(compact(doc, typeInfo), null, 1);
  }

  async thumb(id: string): Promise<Blob | null> {
    return this.store.get(thumbKey(id)).catch(() => null);
  }

  toggleFavPart(type: string): void {
    const f = this.data.favParts;
    this.data.favParts = f.includes(type) ? f.filter((t) => t !== type) : [...f, type];
    this.commit();
  }

  /** this week's featured board: the showcase boards and your own best-rated ones take turns */
  boardOfTheWeek(now = new Date()): { id: string; name: string; by: string } {
    const mine = this.data.items.filter((b) => b.rating >= 4).map((b) => ({ id: b.id, name: b.name, by: 'you' }));
    const pool = [...SHOWCASE.map((s) => ({ id: s.id, name: s.name, by: s.by })), ...mine];
    return pool[isoWeek(now) % pool.length];
  }
}
