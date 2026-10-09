import { beforeEach, describe, expect, it } from 'vitest';
import { callCue, ColorFx, cueToDelete } from '../src/app/controlDefs';
import type { LibraryTrack } from '../src/core/types';
import { boardById } from '../src/three/boards';
import { clampScroll, deckPanelAt, DECK_PANEL, deviceScreen, ensureVisible, FOOT, footAt, LETTERS, letterIndex, LIST, rowAt, SCREEN_W, tabAt, TABS, TouchScreenPart, type LibraryBrowser } from '../src/three/deviceScreen';
import type { PartCtx } from '../src/three/parts';

const track = (id: string, title: string, artist = 'Someone'): LibraryTrack =>
  ({ id, fileName: `${id}.wav`, size: 1, addedAt: 0, meta: { title, artist }, cues: { cue: null, hot: [] }, source: 'demo', plays: 0, status: 'ready' }) as unknown as LibraryTrack;

function fakeLibrary() {
  const tracks = [track('a', 'Above The Line'), track('b', 'Basement Hum'), track('c', 'Ceiling Drip'), track('d', '4am Again')];
  const log: string[] = [];
  let selected: LibraryTrack | null = null;
  let source = 'all';
  const browser: LibraryBrowser = {
    sources: () => [
      { id: 'all', name: 'Collection', count: 4, depth: 0, folder: false },
      { id: 'favs', name: 'Favourites', count: 0, depth: 0, folder: false },
      { id: 'crate:x', name: 'Warm-up', count: 2, depth: 0, folder: false },
    ],
    sourceId: () => source,
    setSource: (id) => {
      source = id;
      log.push(`source ${id}`);
    },
    tracks: () => tracks,
    selected: () => selected,
    select: (t) => {
      selected = t;
      log.push(`select ${t.id}`);
    },
    load: (deck, t) => log.push(`load ${t.id} → ${deck}`),
    sorting: () => ({ key: 'title', dir: 1 }),
    sortBy: (k) => log.push(`sort ${k}`),
    toggleFav: (t) => log.push(`fav ${t.id}`),
  };
  const seeks: number[] = [];
  const deck = (playing: boolean) => ({ loaded: true, playing, duration: 200, seek: (t: number) => seeks.push(t) });
  const decks = [deck(true), deck(false)];
  const ctx = { browser, deck: (n: number) => decks[n - 1], reg: { get: () => undefined } } as unknown as PartCtx;
  return { tracks, log, ctx, seeks, browser };
}

const tap = (x: number, y: number, ctx: PartCtx) => TouchScreenPart.prototype.tap.call({}, x, y, ctx);
const rowY = (i: number) => LIST.top + i * LIST.rowH + LIST.rowH / 2;
const tabX = (page: string) => 8 + TABS.findIndex((t) => t.page === page) * 168 + 60;

describe('the all-in-one touch screen', () => {
  beforeEach(() => {
    deviceScreen.page = 'decks';
    deviceScreen.target = 0;
    deviceScreen.browseScroll = 0;
    deviceScreen.sourceScroll = 0;
  });

  it('finds the tab, row, button and letter under a touch', () => {
    expect(tabAt(tabX('browse'), 20)).toBe('browse');
    expect(tabAt(tabX('search'), 20)).toBe('search');
    expect(tabAt(tabX('browse'), 80)).toBeNull();
    expect(rowAt(rowY(0), 0, 4)).toBe(0);
    expect(rowAt(rowY(3), 0, 4)).toBe(3);
    expect(rowAt(rowY(5), 0, 4)).toBeNull();
    expect(rowAt(rowY(1), 5, 20)).toBe(6);
    expect(footAt(FOOT[1].x + 10, 600)).toBe('load1');
    expect(footAt(FOOT[1].x + 10, 300)).toBeNull();
    expect(letterIndex([track('1', 'beta'), track('2', 'Alpha'), track('3', '9 Lives')], 'A')).toBe(1);
    expect(letterIndex([track('1', 'beta'), track('2', '9 Lives')], '#')).toBe(1);
    expect(LETTERS).toHaveLength(27);
  });

  it('keeps the selection in view and never scrolls past the ends', () => {
    expect(ensureVisible(0, 12)).toBe(12 - LIST.rows + 1);
    expect(ensureVisible(8, 3)).toBe(3);
    expect(ensureVisible(2, 5)).toBe(2);
    expect(clampScroll(-3, 40)).toBe(0);
    expect(clampScroll(100, 40)).toBe(40 - LIST.rows);
    expect(clampScroll(5, 4)).toBe(0);
  });

  it('tap a track to pick it, tap it again to load it to the deck not playing', () => {
    const { log, ctx } = fakeLibrary();
    tap(tabX('browse'), 20, ctx);
    expect(deviceScreen.page).toBe('browse');
    tap(200, rowY(1), ctx);
    expect(log).toEqual(['select b']);
    tap(200, rowY(1), ctx);
    // deck 1 is playing, so it goes to deck 2
    expect(log.at(-1)).toBe('load b → 2');
  });

  it('LOAD 1 / LOAD 2 and TAG work on the selected track; a column header sorts', () => {
    const { log, ctx } = fakeLibrary();
    deviceScreen.page = 'browse';
    tap(200, rowY(2), ctx);
    tap(FOOT[1].x + 20, 610, ctx);
    tap(FOOT[2].x + 20, 610, ctx);
    tap(FOOT[3].x + 20, 610, ctx);
    tap(750, LIST.top - 10, ctx);
    expect(log).toEqual(['select c', 'load c → 1', 'load c → 2', 'fav c', 'sort bpm']);
    tap(FOOT[0].x + 20, 610, ctx);
    expect(deviceScreen.page).toBe('decks');
  });

  it('a playlist opens it in the track list; a letter jumps to the first track starting with it', () => {
    const { log, ctx } = fakeLibrary();
    deviceScreen.page = 'playlists';
    tap(300, rowY(2), ctx);
    expect(log).toEqual(['source crate:x']);
    expect(deviceScreen.page).toBe('browse');
    deviceScreen.page = 'search';
    // C is the third key on the top row
    tap(24 + 2.5 * ((SCREEN_W - 48) / 9), 120 + 40, ctx);
    expect(log.at(-1)).toBe('select c');
    expect(deviceScreen.page).toBe('browse');
    deviceScreen.page = 'search';
    tap(24 + 8.5 * ((SCREEN_W - 48) / 9), 120 + 2 * 92 + 40, ctx);
    expect(log.at(-1)).toBe('select d');
  });

  it('on the decks page, tapping an overview jumps there and tapping a deck opens the list for it', () => {
    const { ctx, seeks } = fakeLibrary();
    const x0 = 8 + DECK_PANEL.w + DECK_PANEL.gap;
    expect(deckPanelAt(x0 + DECK_PANEL.w / 4, DECK_PANEL.ovTop + 10)).toEqual({ deck: 2, part: 'overview', frac: 0.25 });
    tap(x0 + DECK_PANEL.w / 4, DECK_PANEL.ovTop + 10, ctx);
    expect(seeks).toEqual([50]);
    tap(30, DECK_PANEL.y + 20, ctx);
    expect(deviceScreen.page).toBe('browse');
    expect(deviceScreen.target).toBe(1);
  });

  it('BACK goes up a level', () => {
    deviceScreen.open('search');
    deviceScreen.back();
    expect(deviceScreen.page).toBe('browse');
    deviceScreen.back();
    expect(deviceScreen.page).toBe('decks');
  });

  it('is a two-deck board in the picker', () => {
    const b = boardById('aio2');
    expect(b.id).toBe('aio2');
    expect(b.decks).toBe(2);
    expect(b.finishes.length).toBeGreaterThan(1);
  });
});

describe('memory and call on the hot cues', () => {
  const cues = [{ pos: 10 }, null, { pos: 40 }, { pos: 25 }];
  it('calls the next hot cue ahead and the previous one behind (not the one just passed)', () => {
    expect(callCue(cues, 12, 1)).toBe(25);
    expect(callCue(cues, 41, 1)).toBeNull();
    expect(callCue(cues, 25.2, -1)).toBe(10);
    expect(callCue(cues, 30, -1)).toBe(25);
    expect(callCue(cues, 5, -1)).toBeNull();
  });
  it('deletes the hot cue at or just behind the playhead', () => {
    expect(cueToDelete(cues, 25)).toBe(3);
    expect(cueToDelete(cues, 39)).toBe(3);
    expect(cueToDelete(cues, 5)).toBe(-1);
  });
});

describe('sound colour FX', () => {
  const ch = () => {
    const state = { filter: 0.5, crush: 0, res: 0.25 };
    return { state, setFilter: (v: number) => (state.filter = v), setCrush: (v: number) => (state.crush = v), setRes: (v: number) => (state.res = v) };
  };

  it('the COLOR knob plays the filter, or the bitcrusher growing either way from the centre', () => {
    const chs = [ch(), ch()];
    const fx = new ColorFx(chs);
    fx.set(0, 0.2);
    expect(chs[0].state.filter).toBeCloseTo(0.2);
    fx.setMode('crush');
    // switching keeps the knob where it is: the filter goes neutral, the crush takes over
    expect(chs[0].state.filter).toBe(0.5);
    expect(chs[0].state.crush).toBeCloseTo(0.6);
    expect(fx.get(0)).toBeCloseTo(0.2);
    fx.set(1, 0.9);
    expect(chs[1].state.crush).toBeCloseTo(0.8);
    fx.setMode('filter');
    expect(chs[1].state.crush).toBe(0);
    expect(chs[1].state.filter).toBeCloseTo(0.9);
  });
});
