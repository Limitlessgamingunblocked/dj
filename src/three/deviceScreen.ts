/*
 * The all-in-one's 10.1-inch touch screen (16:10), working like the real
 * thing:
 *   DECKS      both decks' scrolling waveforms, title, BPM, key, tempo and
 *              time, beat FX, and an overview per deck: tap it to jump there
 *   BROWSE     your track library, the same list as the Library panel (same
 *              source, sort and selection): tap a track to pick it, tap it
 *              again to load it; drag or scroll the wheel to move through
 *              the list; tap a column to sort; LOAD 1 / LOAD 2 below
 *   PLAYLISTS  the collection, demo tracks, favourites, history and your
 *              crates: tap one to browse it
 *   SEARCH     jump to a letter, or change the sort
 * The browse encoder, BACK, TAG and the LOAD buttons next to the screen drive
 * the same pages (turning the encoder opens BROWSE).
 */
import * as THREE from 'three';
import type { Deck } from '../audio/Deck';
import { camelotColor, compatibility, formatKey } from '../analysis/keys';
import { DECK_COLORS, type DeckId, type LibraryTrack } from '../core/types';
import { formatBpm, formatTime } from '../core/util';
import { drawOverview, drawZoomed } from '../ui/waveform';
import { Part, type PartCtx, type PointerInfo } from './parts';

/** what the screen needs from the library (the app supplies the Library panel's list) */
export interface LibraryBrowser {
  sources(): { id: string; name: string; count: number; depth: number; folder: boolean }[];
  sourceId(): string;
  setSource(id: string): void;
  tracks(): LibraryTrack[];
  selected(): LibraryTrack | null;
  select(t: LibraryTrack): void;
  load(deck: number, t: LibraryTrack): void;
  sorting(): { key: string; dir: 1 | -1 };
  sortBy(key: 'title' | 'artist' | 'bpm' | 'key' | 'time'): void;
  toggleFav(t: LibraryTrack): void;
}

export type ScreenPage = 'decks' | 'browse' | 'playlists' | 'search';

export const SCREEN_W = 1024;
export const SCREEN_H = 640;
export const TABS: { page: ScreenPage; label: string }[] = [
  { page: 'decks', label: 'DECKS' },
  { page: 'browse', label: 'BROWSE' },
  { page: 'playlists', label: 'PLAYLISTS' },
  { page: 'search', label: 'SEARCH' },
];
const TAB_H = 46;
const TAB_W = 168;
/** the track and playlist lists: where the rows start, how tall they are, how many fit */
export const LIST = { top: 134, rowH: 44, rows: 10 };
const FOOT_Y = 580;
/** browse page's buttons along the bottom */
export const FOOT: { id: 'back' | 'load1' | 'load2' | 'tag'; label: string; x: number; w: number }[] = [
  { id: 'back', label: '◀ BACK', x: 8, w: 160 },
  { id: 'load1', label: 'LOAD ▶ DECK 1', x: 180, w: 250 },
  { id: 'load2', label: 'LOAD ▶ DECK 2', x: 442, w: 250 },
  { id: 'tag', label: '★ TAG', x: 704, w: 160 },
];
/** browse columns: [sort key, header, x] */
const COLS: ['title' | 'artist' | 'bpm' | 'key' | 'time', string, number][] = [
  ['title', 'TITLE', 64],
  ['artist', 'ARTIST', 470],
  ['bpm', 'BPM', 742],
  ['key', 'KEY', 840],
  ['time', 'TIME', 920],
];
export const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
const KEY_COLS = 9;
const KEYS = { x: 24, y: 120, w: (SCREEN_W - 48) / KEY_COLS, h: 92 };
const SORT_Y = 430;

/* ------------------------------------------------------------------ */
/* layout and hit-testing (pure, tested)                                */
/* ------------------------------------------------------------------ */

export function tabAt(x: number, y: number): ScreenPage | null {
  if (y < 0 || y > TAB_H) return null;
  const i = Math.floor((x - 8) / TAB_W);
  return i >= 0 && i < TABS.length ? TABS[i].page : null;
}

export function clampScroll(scroll: number, count: number, rows = LIST.rows): number {
  return Math.max(0, Math.min(Math.max(0, count - rows), scroll));
}

/** the scroll that keeps row `index` in view */
export function ensureVisible(scroll: number, index: number, rows = LIST.rows): number {
  if (index < 0) return scroll;
  if (index < scroll) return index;
  if (index >= scroll + rows) return index - rows + 1;
  return scroll;
}

/** the list row under a point (null outside the list) */
export function rowAt(y: number, scroll: number, count: number): number | null {
  if (y < LIST.top || y >= LIST.top + LIST.rowH * LIST.rows) return null;
  const i = Math.floor(scroll) + Math.floor((y - LIST.top + (scroll % 1) * LIST.rowH) / LIST.rowH);
  return i >= 0 && i < count ? i : null;
}

export function footAt(x: number, y: number): (typeof FOOT)[number]['id'] | null {
  if (y < FOOT_Y || y > SCREEN_H - 4) return null;
  return FOOT.find((b) => x >= b.x && x <= b.x + b.w)?.id ?? null;
}

export function letterAt(x: number, y: number): string | null {
  const col = Math.floor((x - KEYS.x) / KEYS.w);
  const row = Math.floor((y - KEYS.y) / KEYS.h);
  if (col < 0 || col >= KEY_COLS || row < 0) return null;
  return LETTERS[row * KEY_COLS + col] ?? null;
}

/** the first track whose name starts with the letter ('#': anything not A–Z) */
export function letterIndex(list: LibraryTrack[], letter: string, by: 'title' | 'artist' = 'title'): number {
  return list.findIndex((t) => {
    const c = (by === 'artist' ? t.meta.artist : t.meta.title).trim().charAt(0).toUpperCase();
    return letter === '#' ? !/[A-Z]/.test(c) : c === letter;
  });
}

/** decks page: the two decks' panels along the bottom */
export const DECK_PANEL = { y: 352, h: 280, w: 500, gap: 8, ovTop: 560, ovH: 64 };
export function deckPanelAt(x: number, y: number): { deck: 1 | 2; part: 'head' | 'overview' | 'body'; frac: number } | null {
  if (y < DECK_PANEL.y || y > DECK_PANEL.y + DECK_PANEL.h) return null;
  const i = x < SCREEN_W / 2 ? 0 : 1;
  const x0 = 8 + i * (DECK_PANEL.w + DECK_PANEL.gap);
  if (x < x0 || x > x0 + DECK_PANEL.w) return null;
  const frac = (x - x0) / DECK_PANEL.w;
  const part = y >= DECK_PANEL.ovTop ? 'overview' : y < DECK_PANEL.y + 70 ? 'head' : 'body';
  return { deck: (i + 1) as 1 | 2, part, frac };
}

/* ------------------------------------------------------------------ */
/* the screen's state (one board on the stage at a time)                */
/* ------------------------------------------------------------------ */

export const deviceScreen = {
  page: 'decks' as ScreenPage,
  /** the deck a second tap on a track loads to: the deck you last touched (0: the first one not playing) */
  target: 0,
  browseScroll: 0,
  sourceScroll: 0,
  /** set when something outside the screen changes it */
  dirty: true,
  open(p: ScreenPage): void {
    this.page = p;
    this.dirty = true;
  },
  /** BACK: up a level (a list → the decks; playlists and search → the track list) */
  back(): void {
    this.open(this.page === 'browse' ? 'decks' : this.page === 'decks' ? 'decks' : 'browse');
  },
};

/* ------------------------------------------------------------------ */
/* drawing                                                              */
/* ------------------------------------------------------------------ */

const BG = '#05070b';
const PANEL = '#0d1118';
const LINE = '#1c2330';
const DIM = '#7d8799';
const TEXT = '#e9edf3';
const HILITE = '#24507a';
const ACCENT = '#43b8ff';

function fit(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(s.slice(0, mid) + '…').width <= max) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + '…';
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, o: { size: number; color?: string; weight?: number; mono?: boolean; align?: CanvasTextAlign; max?: number }): void {
  g.font = `${o.weight ?? 600} ${o.size}px ${o.mono ? '"JetBrains Mono", monospace' : '"Barlow Condensed", "Arial Narrow", sans-serif'}`;
  g.fillStyle = o.color ?? TEXT;
  g.textAlign = o.align ?? 'left';
  g.textBaseline = 'middle';
  g.fillText(o.max ? fit(g, s, o.max) : s, x, y);
}

function keyChip(g: CanvasRenderingContext2D, t: LibraryTrack | null | undefined, key: ReturnType<Deck['currentKey']> | undefined, x: number, y: number, w: number, h: number): void {
  const k = key ?? t?.analysis?.key ?? null;
  if (!k) return;
  rr(g, x, y, w, h, 4, camelotColor(k));
  text(g, formatKey(k), x + w / 2, y + h / 2 + 1, { size: h * 0.62, color: '#05070a', weight: 700, mono: true, align: 'center' });
}

export class TouchScreenPart extends Part {
  readonly glass: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private ov: HTMLCanvasElement[] = [];
  private press: { x: number; y: number; scroll: number; moved: boolean } | null = null;
  private plane = new THREE.Plane();
  private lastSel: string | null = null;
  private lastTurn = -1;
  private v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  /** `w` × `h`: the active area, metres */
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    super();
    this.label = 'Touch screen: tap the tabs; tap a track to pick it and again to load it; tap a waveform to jump; drag or scroll the list';
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCREEN_W;
    this.canvas.height = SCREEN_H;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.glass.rotation.x = -Math.PI / 2;
    this.object.add(this.glass);
    this.addHit(this.glass);
    for (let i = 0; i < 2; i++) {
      const c = document.createElement('canvas');
      c.width = DECK_PANEL.w;
      c.height = DECK_PANEL.ovH;
      this.ov.push(c);
    }
  }

  /* ---------------------------- input ---------------------------- */

  private toCanvas(pt: THREE.Vector3): [number, number] {
    const l = this.glass.worldToLocal(this.v[0].copy(pt));
    return [(l.x / this.w + 0.5) * SCREEN_W, (0.5 - l.y / this.h) * SCREEN_H];
  }

  private rayToCanvas(ray: THREE.Ray): [number, number] | null {
    const n = this.v[1].set(0, 0, 1).transformDirection(this.glass.matrixWorld);
    this.plane.setFromNormalAndCoplanarPoint(n, this.glass.getWorldPosition(this.v[2]));
    const hit = ray.intersectPlane(this.plane, this.v[0]);
    return hit ? this.toCanvas(hit) : null;
  }

  private get scroll(): number {
    const s = deviceScreen;
    return s.page === 'playlists' ? s.sourceScroll : s.browseScroll;
  }

  private set scroll(v: number) {
    const s = deviceScreen;
    if (s.page === 'playlists') s.sourceScroll = v;
    else s.browseScroll = v;
  }

  down(p: PointerInfo): void {
    const [x, y] = this.toCanvas(p.point);
    this.press = { x, y, scroll: this.scroll, moved: false };
  }

  move(p: PointerInfo, c: PartCtx): void {
    const pr = this.press;
    const at = this.rayToCanvas(p.ray);
    if (!pr || !at) return;
    const dy = at[1] - pr.y;
    if (Math.abs(dy) > 10 || Math.abs(at[0] - pr.x) > 10) pr.moved = true;
    const page = deviceScreen.page;
    if (pr.moved && (page === 'browse' || page === 'playlists')) {
      const count = page === 'browse' ? (c.browser?.tracks().length ?? 0) : (c.browser?.sources().length ?? 0);
      this.scroll = clampScroll(pr.scroll - dy / LIST.rowH, count);
      deviceScreen.dirty = true;
    }
  }

  up(_p: PointerInfo, c: PartCtx): void {
    const pr = this.press;
    this.press = null;
    if (pr && !pr.moved) this.tap(pr.x, pr.y, c);
  }

  wheel(delta: number, c: PartCtx): void {
    const s = deviceScreen;
    const b = c.browser;
    if (!b) return;
    if (s.page === 'decks' || s.page === 'search') {
      // like turning the browse encoder
      const enc = c.reg.get('browse');
      if (enc?.kind === 'encoder') enc.step(-delta);
      s.open('browse');
      return;
    }
    const count = s.page === 'browse' ? b.tracks().length : b.sources().length;
    this.scroll = clampScroll(Math.round(this.scroll) - delta * 3, count);
    s.dirty = true;
  }

  /** what a tap at canvas (x, y) does */
  tap(x: number, y: number, c: PartCtx): void {
    const s = deviceScreen;
    const b = c.browser;
    s.dirty = true;
    const tab = tabAt(x, y);
    if (tab) return s.open(tab);
    if (s.page === 'decks') {
      const hit = deckPanelAt(x, y);
      if (!hit) return;
      s.target = hit.deck;
      const d = c.deck(hit.deck);
      if (hit.part === 'overview') {
        if (d.loaded) d.seek(hit.frac * d.duration);
      } else if (b) s.open('browse');
      return;
    }
    if (!b) return;
    if (s.page === 'browse') {
      const list = b.tracks();
      const f = footAt(x, y);
      const sel = b.selected();
      if (f === 'back') return s.back();
      if (f === 'load1' || f === 'load2') {
        if (sel) b.load(f === 'load1' ? 1 : 2, sel);
        return;
      }
      if (f === 'tag') {
        if (sel) b.toggleFav(sel);
        return;
      }
      if (y > TAB_H && y < LIST.top) {
        const col = [...COLS].reverse().find(([, , cx]) => x >= cx - 12);
        if (col && y > LIST.top - 26) b.sortBy(col[0]);
        return;
      }
      const i = rowAt(y, s.browseScroll, list.length);
      if (i === null) return;
      const t = list[i];
      if (sel && sel.id === t.id) {
        // a second tap loads it: to the deck you last touched, or the first one not playing
        const deck = s.target || (c.deck(1).playing && !c.deck(2).playing ? 2 : 1);
        b.load(deck, t);
      } else b.select(t);
      return;
    }
    if (s.page === 'playlists') {
      const src = b.sources();
      const i = rowAt(y, s.sourceScroll, src.length);
      if (i === null) return;
      b.setSource(src[i].id);
      s.browseScroll = 0;
      s.open('browse');
      return;
    }
    if (s.page === 'search') {
      if (y >= SORT_Y && y <= SORT_Y + 64) {
        const i = Math.floor((x - 24) / ((SCREEN_W - 48) / COLS.length));
        if (COLS[i]) b.sortBy(COLS[i][0]);
        return;
      }
      const letter = letterAt(x, y);
      if (!letter) return;
      const list = b.tracks();
      const i = letterIndex(list, letter, b.sorting().key === 'artist' ? 'artist' : 'title');
      if (i >= 0) {
        b.select(list[i]);
        s.browseScroll = clampScroll(i, list.length);
        s.open('browse');
      }
    }
  }

  /* ---------------------------- frame ---------------------------- */

  update(c: PartCtx): void {
    const s = deviceScreen;
    const b = c.browser;
    // turning the browse encoder (by hand, MIDI or the keys) opens the track list, and the list follows the selection
    const turned = c.reg.lastActive('browse');
    if (turned > this.lastTurn) {
      // (a turn from before this board was on the stage doesn't count)
      if (b && s.page === 'decks' && this.lastTurn >= 0) s.open('browse');
      this.lastTurn = turned;
    } else if (this.lastTurn < 0) this.lastTurn = turned;
    const sel = b?.selected()?.id ?? null;
    if (b && sel !== this.lastSel) {
      this.lastSel = sel;
      const list = b.tracks();
      const i = sel ? list.findIndex((t) => t.id === sel) : -1;
      s.browseScroll = clampScroll(ensureVisible(Math.round(s.browseScroll), i), list.length);
      s.dirty = true;
    }
    const every = s.page === 'decks' ? 2 : 6;
    if (!s.dirty && c.frame % every !== 0) return;
    s.dirty = false;
    this.draw(c);
    this.tex.needsUpdate = true;
  }

  private draw(c: PartCtx): void {
    const g = this.g;
    g.fillStyle = BG;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    this.drawTabs(c);
    const b = c.browser;
    const page = deviceScreen.page;
    if (page === 'decks' || !b) {
      this.drawDecks(c);
      if (!b && page !== 'decks') text(g, 'The library isn’t ready yet', SCREEN_W / 2, 300, { size: 30, color: DIM, align: 'center' });
    } else if (page === 'browse') this.drawBrowse(c, b);
    else if (page === 'playlists') this.drawPlaylists(b);
    else this.drawSearch(b);
  }

  private drawTabs(c: PartCtx): void {
    const g = this.g;
    g.fillStyle = '#0a0e14';
    g.fillRect(0, 0, SCREEN_W, TAB_H);
    TABS.forEach((t, i) => {
      const on = deviceScreen.page === t.page;
      const x = 8 + i * TAB_W;
      rr(g, x, 6, TAB_W - 8, TAB_H - 12, 4, on ? ACCENT : '#141a24');
      text(g, t.label, x + (TAB_W - 8) / 2, TAB_H / 2 + 1, { size: 21, weight: 700, color: on ? '#04121d' : '#b8c2d3', align: 'center' });
    });
    const now = new Date();
    text(g, `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, SCREEN_W - 14, TAB_H / 2 + 1, { size: 22, mono: true, weight: 700, color: '#b8c2d3', align: 'right' });
    const m = c.engine.masterDeck;
    text(g, m ? `MASTER ${m.id} · ${formatBpm(m.bpm)}` : 'MASTER —', SCREEN_W - 104, TAB_H / 2 + 1, { size: 19, color: '#ff9f1c', weight: 700, align: 'right' });
  }

  /* ---------------------------- DECKS ---------------------------- */

  private drawDecks(c: PartCtx): void {
    const g = this.g;
    const decks = [c.deck(1), c.deck(2)];
    const laneX = 132;
    const laneW = 712;
    decks.forEach((d, i) => {
      const y = 52 + i * 148;
      const col = DECK_COLORS[d.id as DeckId];
      // left: which deck, how long
      rr(g, 8, y, laneX - 16, 140, 6, PANEL);
      text(g, `DECK ${d.id}`, 18, y + 22, { size: 22, weight: 700, color: col });
      text(g, d.loaded ? `${(d.duration / 60).toFixed(1)} min` : 'EMPTY', 18, y + 52, { size: 20, color: DIM });
      if (d.isMaster) {
        rr(g, 16, y + 74, 92, 24, 4, '#ff9f1c');
        text(g, 'MASTER', 62, y + 87, { size: 17, weight: 700, color: '#05070a', align: 'center' });
      }
      if (d.sync) {
        rr(g, 16, y + 104, 92, 24, 4, '#2ec4f1');
        text(g, 'SYNC', 62, y + 117, { size: 17, weight: 700, color: '#05070a', align: 'center' });
      }
      drawZoomed(g, d, laneX, y, laneW, 140, { pxPerSec: laneW / 6, deckColor: col, compact: false });
      if (!d.loaded) text(g, 'Load a track: turn BROWSE, or tap below', laneX + 20, y + 70, { size: 24, color: '#3b4556' });
    });
    // right: beat FX
    const fx = c.engine.fx;
    const fx0 = 852;
    rr(g, fx0, 52, SCREEN_W - fx0 - 8, 288, 6, PANEL);
    text(g, 'BEAT FX', fx0 + 12, 74, { size: 18, color: DIM, weight: 700 });
    rr(g, fx0 + 10, 92, SCREEN_W - fx0 - 28, 44, 4, fx.on ? '#ff3b5c' : '#1a212d');
    text(g, fx.type.toUpperCase(), fx0 + (SCREEN_W - fx0 - 8) / 2, 115, { size: 24, weight: 700, color: fx.on ? '#fff' : '#d5dbe6', align: 'center' });
    const beats = fx.beats;
    text(g, beats >= 1 ? `${beats}` : `1/${Math.round(1 / beats)}`, fx0 + 12, 168, { size: 34, mono: true, weight: 700 });
    text(g, 'BEAT', fx0 + 12, 196, { size: 16, color: DIM });
    const tg = [...fx.targets].map((x) => (x === 'M' ? 'MST' : `CH${x}`)).join(' ');
    text(g, tg, fx0 + 12, 232, { size: 22, weight: 700, color: ACCENT });
    text(g, `LEVEL ${Math.round(fx.depth * 100)}%`, fx0 + 12, 268, { size: 20, color: DIM });
    text(g, fx.on ? 'ON' : 'OFF', fx0 + 12, 304, { size: 26, weight: 700, color: fx.on ? '#ff3b5c' : '#3b4556' });
    // bottom: both decks
    decks.forEach((d, i) => this.drawDeckPanel(c, d, 8 + i * (DECK_PANEL.w + DECK_PANEL.gap), i));
  }

  private drawDeckPanel(c: PartCtx, d: Deck, x0: number, i: number): void {
    const g = this.g;
    const y0 = DECK_PANEL.y;
    const W = DECK_PANEL.w;
    const col = DECK_COLORS[d.id as DeckId];
    rr(g, x0, y0, W, DECK_PANEL.h, 6, PANEL);
    rr(g, x0, y0, 54, 64, 6, col);
    text(g, String(d.id).padStart(2, '0'), x0 + 27, y0 + 33, { size: 30, weight: 700, color: '#05070a', align: 'center', mono: true });
    const t = d.track;
    text(g, t ? t.meta.title : 'No track — tap to browse', x0 + 66, y0 + 22, { size: 26, weight: 700, max: W - 80 });
    text(g, t ? t.meta.artist || 'Unknown artist' : '', x0 + 66, y0 + 50, { size: 20, color: DIM, max: W - 80 });
    // time and tempo
    const near = d.loaded && d.remaining < 30 && d.playing;
    text(g, d.loaded ? `-${formatTime(d.remaining, true)}` : '-:--.-', x0 + 12, y0 + 104, { size: 46, mono: true, weight: 700, color: near ? '#ff3b5c' : TEXT });
    text(g, d.loaded ? formatTime(d.position(), true) : '', x0 + 14, y0 + 140, { size: 20, mono: true, color: DIM });
    text(g, d.loaded ? formatBpm(d.bpm) : '--.-', x0 + W - 12, y0 + 104, { size: 46, mono: true, weight: 700, align: 'right' });
    const tp = d.tempoPercent;
    text(g, `${tp >= 0 ? '+' : ''}${tp.toFixed(2)}%  ±${Math.round(d.range * 100)}`, x0 + W - 12, y0 + 140, { size: 20, mono: true, color: tp === 0 ? DIM : '#ffd23f', align: 'right' });
    keyChip(g, t, d.loaded ? d.currentKey() : null, x0 + W / 2 - 34, y0 + 84, 68, 34);
    // state chips
    const chips: [string, boolean, string][] = [
      ['SYNC', d.sync, '#2ec4f1'],
      ['MASTER', d.isMaster, '#ff9f1c'],
      ['KEY LOCK', d.keylock, '#ff5fcf'],
      ['Q', d.quantize, '#ff3b5c'],
      ['SLIP', d.slip, '#b36bff'],
      [d.loop.active ? 'LOOP ON' : 'LOOP', d.loop.active, '#3ddc97'],
    ];
    let cx = x0 + 12;
    g.font = '700 16px "Barlow Condensed", sans-serif';
    for (const [label, on, color] of chips) {
      const w = g.measureText(label).width + 16;
      rr(g, cx, y0 + 162, w, 24, 4, on ? color : '#161c26');
      text(g, label, cx + w / 2, y0 + 175, { size: 16, weight: 700, color: on ? '#05070a' : '#4b5566', align: 'center' });
      cx += w + 6;
    }
    // hot cues A–H
    const hw = (W - 24) / 8;
    d.hotCues.forEach((cue, k) => {
      rr(g, x0 + 12 + k * hw, y0 + 196, hw - 4, 20, 3, cue ? cue.color : '#141a23');
      text(g, String.fromCharCode(65 + k), x0 + 12 + k * hw + (hw - 4) / 2, y0 + 207, { size: 14, weight: 700, color: cue ? '#05070a' : '#3a4454', align: 'center' });
    });
    // overview, with hot cues; tap to jump
    const ov = this.ov[i];
    drawOverview(ov.getContext('2d')!, d, ov.width, ov.height, 1);
    g.drawImage(ov, x0, DECK_PANEL.ovTop);
    g.strokeStyle = LINE;
    g.lineWidth = 2;
    g.strokeRect(x0 + 1, DECK_PANEL.ovTop, W - 2, DECK_PANEL.ovH);
    if (d.loaded && d.duration > 0) {
      const px = x0 + (d.position() / d.duration) * W;
      g.fillStyle = '#ff3b3b';
      g.fillRect(px - 1.5, DECK_PANEL.ovTop - 4, 3, DECK_PANEL.ovH + 8);
    }
    void c;
  }

  /* ---------------------------- BROWSE ---------------------------- */

  private drawBrowse(c: PartCtx, b: LibraryBrowser): void {
    const g = this.g;
    const list = b.tracks();
    const s = deviceScreen;
    const sel = b.selected();
    const src = b.sources().find((x) => x.id === b.sourceId());
    // what's loaded, small, above the list
    [c.deck(1), c.deck(2)].forEach((d, i) => {
      const x = 8 + i * 508;
      rr(g, x, 52, 500, 30, 4, PANEL);
      rr(g, x, 52, 34, 30, 4, DECK_COLORS[d.id as DeckId]);
      text(g, String(d.id), x + 17, 68, { size: 20, weight: 700, color: '#05070a', align: 'center' });
      text(g, d.track ? d.track.meta.title : 'empty', x + 44, 68, { size: 19, color: d.track ? TEXT : '#3b4556', max: 330 });
      if (d.loaded) text(g, `-${formatTime(d.remaining)}  ${formatBpm(d.bpm)}`, x + 490, 68, { size: 18, mono: true, color: d.playing ? '#3ddc97' : DIM, align: 'right' });
    });
    // source and column headers
    text(g, `${src?.name ?? 'Collection'} · ${list.length} tracks`, 12, 96, { size: 19, weight: 700, color: ACCENT, max: 520 });
    text(g, 'Tap a track to pick it, again to load it', SCREEN_W - 14, 96, { size: 17, color: DIM, align: 'right' });
    const sort = b.sorting();
    for (const [key, label, x] of COLS) {
      const on = sort.key === key;
      text(g, `${label}${on ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}`, x, LIST.top - 13, { size: 16, weight: 700, color: on ? ACCENT : DIM });
    }
    g.fillStyle = LINE;
    g.fillRect(0, LIST.top - 1, SCREEN_W, 2);
    // the rows
    g.save();
    g.beginPath();
    g.rect(0, LIST.top, SCREEN_W, LIST.rowH * LIST.rows);
    g.clip();
    const master = c.engine.masterDeck;
    const mk = master?.loaded ? master.currentKey() : null;
    const first = Math.floor(s.browseScroll);
    const off = (s.browseScroll - first) * LIST.rowH;
    const loaded = [c.deck(1).track?.id, c.deck(2).track?.id];
    if (!list.length) text(g, 'Nothing here yet: import music in the Library tab, or pick another playlist', 24, LIST.top + 40, { size: 22, color: DIM });
    for (let r = 0; r <= LIST.rows; r++) {
      const i = first + r;
      const t = list[i];
      if (!t) break;
      const y = LIST.top + r * LIST.rowH - off;
      const isSel = sel?.id === t.id;
      g.fillStyle = isSel ? HILITE : r % 2 ? '#090c12' : BG;
      g.fillRect(0, y, SCREEN_W - 14, LIST.rowH);
      if (isSel) {
        g.fillStyle = ACCENT;
        g.fillRect(0, y, 5, LIST.rowH);
      }
      const cy = y + LIST.rowH / 2;
      text(g, t.fav ? '★' : '', 16, cy, { size: 20, color: '#ffd23f' });
      const on = loaded.indexOf(t.id);
      if (on >= 0) {
        rr(g, 34, cy - 11, 22, 22, 4, DECK_COLORS[(on + 1) as DeckId]);
        text(g, String(on + 1), 45, cy + 1, { size: 15, weight: 700, color: '#05070a', align: 'center' });
      }
      text(g, t.meta.title, COLS[0][2], cy, { size: 22, weight: 600, max: COLS[1][2] - COLS[0][2] - 14, color: t.status === 'error' ? '#ff6b6b' : TEXT });
      text(g, t.meta.artist, COLS[1][2], cy, { size: 20, color: '#aab4c5', max: COLS[2][2] - COLS[1][2] - 14 });
      text(g, t.analysis?.bpm ? formatBpm(t.analysis.bpm) : t.status === 'analyzing' ? '…' : '', COLS[2][2], cy, { size: 20, mono: true });
      if (t.analysis?.key) {
        keyChip(g, t, undefined, COLS[3][2], cy - 13, 56, 26);
        if (mk && compatibility(t.analysis.key, mk) !== null) {
          g.fillStyle = '#3ddc97';
          g.beginPath();
          g.arc(COLS[3][2] + 66, cy, 5, 0, Math.PI * 2);
          g.fill();
        }
      }
      text(g, t.analysis?.duration ? formatTime(t.analysis.duration) : '', COLS[4][2], cy, { size: 20, mono: true, color: '#aab4c5' });
    }
    g.restore();
    // scroll bar
    if (list.length > LIST.rows) {
      const track = LIST.rowH * LIST.rows;
      const h = Math.max(30, (track * LIST.rows) / list.length);
      const y = LIST.top + (track - h) * (s.browseScroll / Math.max(1, list.length - LIST.rows));
      rr(g, SCREEN_W - 10, LIST.top, 6, track, 3, '#141a24');
      rr(g, SCREEN_W - 10, y, 6, h, 3, '#5d6b80');
    }
    // buttons
    for (const f of FOOT) {
      const live = f.id === 'back' || !!sel;
      rr(g, f.x, FOOT_Y, f.w, SCREEN_H - FOOT_Y - 8, 6, f.id === 'load1' || f.id === 'load2' ? (live ? '#1d3a57' : '#121822') : '#171e2a');
      text(g, f.id === 'tag' && sel?.fav ? '★ UNTAG' : f.label, f.x + f.w / 2, FOOT_Y + (SCREEN_H - FOOT_Y - 8) / 2 + 1, { size: 21, weight: 700, color: live ? TEXT : '#3b4556', align: 'center' });
    }
  }

  /* ---------------------------- PLAYLISTS ---------------------------- */

  private drawPlaylists(b: LibraryBrowser): void {
    const g = this.g;
    const src = b.sources();
    const cur = b.sourceId();
    text(g, 'PLAYLISTS · pick one to browse', 12, 92, { size: 22, weight: 700, color: ACCENT });
    g.fillStyle = LINE;
    g.fillRect(0, LIST.top - 1, SCREEN_W, 2);
    const s = deviceScreen;
    const first = Math.floor(s.sourceScroll);
    const icon: Record<string, string> = { all: '◉', demo: '♪', favs: '★', history: '↺' };
    for (let r = 0; r < LIST.rows; r++) {
      const x = src[first + r];
      if (!x) break;
      const y = LIST.top + r * LIST.rowH;
      const on = x.id === cur;
      g.fillStyle = on ? HILITE : r % 2 ? '#090c12' : BG;
      g.fillRect(0, y, SCREEN_W, LIST.rowH);
      const ind = 18 + x.depth * 28;
      text(g, icon[x.id] ?? (x.folder ? '▸' : '▤'), ind, y + LIST.rowH / 2, { size: 22, color: on ? ACCENT : DIM });
      text(g, x.name, ind + 34, y + LIST.rowH / 2, { size: 23, weight: 600, max: 700 });
      text(g, String(x.count), SCREEN_W - 24, y + LIST.rowH / 2, { size: 21, mono: true, color: DIM, align: 'right' });
    }
  }

  /* ---------------------------- SEARCH ---------------------------- */

  private drawSearch(b: LibraryBrowser): void {
    const g = this.g;
    const by = b.sorting().key === 'artist' ? 'artist' : 'title';
    text(g, `Jump to a letter (by ${by})`, 24, 92, { size: 22, weight: 700, color: ACCENT });
    const list = b.tracks();
    LETTERS.forEach((l, i) => {
      const col = i % KEY_COLS;
      const row = Math.floor(i / KEY_COLS);
      const x = KEYS.x + col * KEYS.w;
      const y = KEYS.y + row * KEYS.h;
      const has = letterIndex(list, l, by) >= 0;
      rr(g, x + 4, y + 4, KEYS.w - 8, KEYS.h - 8, 6, has ? '#18212e' : '#0c1017');
      text(g, l, x + KEYS.w / 2, y + KEYS.h / 2 + 2, { size: 40, weight: 700, color: has ? TEXT : '#2c3442', align: 'center' });
    });
    text(g, 'SORT BY', 24, SORT_Y - 18, { size: 18, weight: 700, color: DIM });
    const sort = b.sorting();
    const w = (SCREEN_W - 48) / COLS.length;
    COLS.forEach(([key, label], i) => {
      const on = sort.key === key;
      rr(g, 24 + i * w + 4, SORT_Y, w - 8, 60, 6, on ? ACCENT : '#18212e');
      text(g, `${label}${on ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}`, 24 + i * w + w / 2, SORT_Y + 31, { size: 24, weight: 700, color: on ? '#04121d' : TEXT, align: 'center' });
    });
    text(g, 'Turn BROWSE to move through the list · press LOAD 1 or LOAD 2 to load', SCREEN_W / 2, 560, { size: 20, color: DIM, align: 'center' });
  }
}
