/*
 * Library browser: collection / favourites / history views, nested crate folders,
 * smart search ("bpm:120-128 key:8A artist:x"), BPM range, key-match
 * highlighting against a deck, sortable columns, a genre column (its tag, or
 * the analyser's guess, or your own pick) with a genre filter, drag to decks,
 * crates, JSON export/import of crates and cues.
 */
import { saveFile } from '../core/download';
import type { AppContext } from '../app/context';
import { camelotColor, compatibility, formatKey } from '../analysis/keys';
import type { LibraryTrack } from '../core/types';
import { formatBpm, formatTime } from '../core/util';
import { AUDIO_ACCEPT, matchTrack, parseSearch, type Crate } from '../library/Library';
import { GENRES } from '../analysis/genre';
import { genreNote, genreOf } from '../library/genres';
import { trackInfo } from '../game/tracks';
import { clear, h } from './dom';
import { openPlaylistImport } from './PlaylistImport';
import { entryLabel } from '../library/playlists';
import { contextMenu, openModal } from './modal';
import { toast } from './toast';

type View = { kind: 'all' } | { kind: 'favs' } | { kind: 'history' } | { kind: 'crate'; id: string };
export type SortKey = 'title' | 'artist' | 'genre' | 'bpm' | 'key' | 'energy' | 'time' | 'bitrate' | 'added' | 'format' | 'fav';

export class LibraryPanel {
  readonly el: HTMLElement;
  private side: HTMLElement;
  private tbody: HTMLTableSectionElement;
  private thead: HTMLTableSectionElement;
  private search: HTMLInputElement;
  private bpmMin: HTMLInputElement;
  private bpmMax: HTMLInputElement;
  private keyMatch: HTMLSelectElement;
  private genreFilter: HTMLSelectElement;
  private genreOptions = '';
  private countEl: HTMLElement;
  private view: View = { kind: 'all' };
  private sort: { key: SortKey; dir: 1 | -1 } = { key: 'added', dir: -1 };
  private rows: LibraryTrack[] = [];
  private openFolders = new Set<string>();
  private renaming: string | null = null;
  private renderQueued = false;
  private fileInput: HTMLInputElement;
  private folderInput: HTMLInputElement;

  constructor(private app: AppContext) {
    const lib = app.library;
    this.fileInput = h('input', { type: 'file', multiple: true, accept: AUDIO_ACCEPT, hidden: true }) as HTMLInputElement;
    this.folderInput = h('input', { type: 'file', multiple: true, hidden: true }) as HTMLInputElement;
    this.folderInput.setAttribute('webkitdirectory', '');
    const onPick = (inp: HTMLInputElement) => () => {
      if (inp.files?.length) void this.app.importFiles([...inp.files], undefined, this.currentCrate());
      inp.value = '';
    };
    this.fileInput.addEventListener('change', onPick(this.fileInput));
    this.folderInput.addEventListener('change', onPick(this.folderInput));

    this.side = h('nav', { class: 'lib-side', 'aria-label': 'Library sources and crates' });
    this.search = h('input', { class: 'search', type: 'search', placeholder: 'Search', title: 'Title, artist or genre. Also try bpm:120-128, key:8A or genre:house', 'aria-label': 'Search library' }) as HTMLInputElement;
    this.bpmMin = h('input', { type: 'number', min: 40, max: 250, placeholder: 'min', 'aria-label': 'Minimum BPM' }) as HTMLInputElement;
    this.bpmMax = h('input', { type: 'number', min: 40, max: 250, placeholder: 'max', 'aria-label': 'Maximum BPM' }) as HTMLInputElement;
    this.keyMatch = h(
      'select',
      { 'aria-label': 'Key filter', title: 'Tracks whose key suits the master deck' },
      h('option', { value: 'all' }, 'Any key'),
      h('option', { value: 'mark' }, 'Highlight key matches'),
      h('option', { value: 'only' }, 'Key matches only'),
    ) as HTMLSelectElement;
    this.keyMatch.value = 'mark';
    this.genreFilter = h('select', { 'aria-label': 'Genre filter', title: 'Only tracks of one genre' }, h('option', { value: '' }, 'All genres')) as HTMLSelectElement;
    this.genreFilter.addEventListener('change', () => this.queueRender());
    this.countEl = h('span', { class: 'label' });
    for (const el of [this.search, this.bpmMin, this.bpmMax]) el.addEventListener('input', () => this.queueRender());
    this.keyMatch.addEventListener('change', () => this.queueRender());
    this.search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.moveSelection(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') this.loadSelectedTo(e.shiftKey ? 'R' : 'L');
    });

    const importBtn = h('button', { class: 'btn primary' }, 'Import music');
    importBtn.addEventListener('click', () => this.fileInput.click());
    const moreBtn = h('button', { class: 'btn', title: 'More library actions', 'aria-label': 'More library actions' }, '⋯');
    moreBtn.addEventListener('click', (e) =>
      contextMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY, [
        { label: 'Import a folder…', action: () => this.folderInput.click() },
        { label: 'Import a playlist…', action: () => this.importPlaylist() },
        'sep',
        { label: 'Back up crates and cues', action: () => this.exportJson() },
        { label: 'Restore crates and cues…', action: () => this.importJson() },
      ]),
    );
    this.thead = h('thead');
    this.tbody = h('tbody');
    const table = h('table', { class: 'tracks' }, this.thead, this.tbody);
    const wrap = h('div', { class: 'table-wrap' }, table);

    this.el = h(
      'div',
      { class: 'library' },
      this.side,
      h(
        'div',
        { class: 'lib-main' },
        h(
          'div',
          { class: 'lib-toolbar' },
          this.search,
          h('div', { class: 'bpm-range', title: 'BPM range' }, h('span', { class: 'label' }, 'BPM'), this.bpmMin, h('span', { class: 'label' }, '–'), this.bpmMax),
          this.keyMatch,
          this.genreFilter,
          this.countEl,
          h('span', { class: 'spacer' }),
          importBtn,
          moreBtn,
          this.fileInput,
          this.folderInput,
        ),
        wrap,
      ),
    );

    wrap.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    wrap.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void this.app.importFiles([...e.dataTransfer.files], undefined, this.currentCrate());
    });

    lib.on('changed', () => this.queueRender());
    lib.on('track', () => this.queueRender());
    app.events.on('selection', () => this.highlightSelection());
    for (const d of app.engine.decks) d.on('loaded', () => this.queueRender());
    this.renderSide();
    this.render();
  }

  currentCrate(): string | null {
    return this.view.kind === 'crate' ? this.view.id : null;
  }

  focusSearch(): void {
    this.search.focus();
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderSide();
      this.render();
    });
  }

  /* ------------------------------------------------------------------ */
  /* sidebar                                                              */
  /* ------------------------------------------------------------------ */

  private renderSide(): void {
    const lib = this.app.library;
    clear(this.side);
    const newCrate = h('button', { class: 'btn small' }, '+ Crate');
    const newFolder = h('button', { class: 'btn small' }, '+ Folder');
    newCrate.addEventListener('click', () => this.create('crate'));
    newFolder.addEventListener('click', () => this.create('folder'));
    this.side.append(h('div', { class: 'side-actions' }, newCrate, newFolder));
    const item = (label: string, icon: string, count: number, active: boolean, onClick: () => void) => {
      const el = h('div', { class: `tree-item${active ? ' active' : ''}`, role: 'button', tabindex: 0 }, h('span', { class: 'ic' }, icon), h('span', { class: 'nm' }, label), h('span', { class: 'ct' }, String(count)));
      el.addEventListener('click', onClick);
      return el;
    };
    const all = lib.list();
    this.side.append(
      item('Collection', '◉', all.length, this.view.kind === 'all', () => this.setView({ kind: 'all' })),
      item('Favourites', '★', all.filter((t) => t.fav).length, this.view.kind === 'favs', () => this.setView({ kind: 'favs' })),
      item('History', '↺', lib.history.length, this.view.kind === 'history', () => this.setView({ kind: 'history' })),
    );
    const walk = (parent: string | null, depth: number) => {
      for (const c of lib.children(parent)) {
        this.side.append(this.crateItem(c, depth));
        if (c.kind === 'folder' && this.openFolders.has(c.id)) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
  }

  private crateItem(c: Crate, depth: number): HTMLElement {
    const lib = this.app.library;
    const active = this.view.kind === 'crate' && this.view.id === c.id;
    const open = this.openFolders.has(c.id);
    const icon = c.kind === 'folder' ? (open ? '▾' : '▸') : '▤';
    const el = h('div', { class: `tree-item${active ? ' active' : ''}`, role: 'button', tabindex: 0, style: { paddingLeft: `${6 + depth * 14}px` }, draggable: 'true' }, h('span', { class: 'ic' }, icon));
    if (this.renaming === c.id) {
      const input = h('input', { value: c.name, 'aria-label': 'Crate name' }) as HTMLInputElement;
      const commit = () => {
        this.renaming = null;
        lib.renameCrate(c.id, input.value);
        this.queueRender();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          this.renaming = null;
          this.queueRender();
        }
      });
      input.addEventListener('blur', commit);
      el.append(input);
      setTimeout(() => {
        input.focus();
        input.select();
      });
    } else {
      el.append(h('span', { class: 'nm' }, c.name));
      if (c.kind === 'crate') el.append(h('span', { class: 'ct', title: c.wanted?.length ? `${c.wanted.length} still to add` : undefined }, c.wanted?.length ? `${c.trackIds.length}/${c.trackIds.length + c.wanted.length}` : String(c.trackIds.length)));
      const more = h('button', { class: 'more', 'aria-label': `${c.name} options` }, '⋯');
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        this.crateMenu(c, e as MouseEvent);
      });
      el.append(more);
    }
    el.addEventListener('click', () => {
      if (c.kind === 'folder') {
        if (open) this.openFolders.delete(c.id);
        else this.openFolders.add(c.id);
        this.renderSide();
      } else this.setView({ kind: 'crate', id: c.id });
    });
    el.addEventListener('dblclick', () => {
      this.renaming = c.id;
      this.renderSide();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.crateMenu(c, e);
    });
    el.addEventListener('dragstart', (e) => e.dataTransfer?.setData('application/x-deckhouse-crate', c.id));
    el.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (types.includes('application/x-deckhouse-track') || types.includes('application/x-deckhouse-crate') || types.includes('Files')) {
        e.preventDefault();
        el.classList.add('drop');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop');
      const tid = e.dataTransfer?.getData('application/x-deckhouse-track');
      const cid = e.dataTransfer?.getData('application/x-deckhouse-crate');
      if (tid && c.kind === 'crate') {
        lib.addToCrate(c.id, [tid]);
        toast(`Added to ${c.name}`);
      } else if (cid && c.kind === 'folder') lib.moveCrate(cid, c.id);
      else if (e.dataTransfer?.files.length && c.kind === 'crate') void this.app.importFiles([...e.dataTransfer.files], undefined, c.id);
    });
    return el;
  }

  private crateMenu(c: Crate, e: MouseEvent): void {
    const lib = this.app.library;
    const items: ({ label: string; action: () => void; danger?: boolean } | 'sep')[] = [
      {
        label: 'Rename',
        action: () => {
          this.renaming = c.id;
          this.renderSide();
        },
      },
    ];
    if (c.kind === 'folder') {
      items.push({ label: 'New crate inside', action: () => this.create('crate', c.id) });
      items.push({ label: 'New folder inside', action: () => this.create('folder', c.id) });
    }
    if (c.parent) items.push({ label: 'Move to top level', action: () => lib.moveCrate(c.id, null) });
    items.push('sep', { label: `Delete ${c.kind}`, danger: true, action: () => this.confirmDelete(c) });
    contextMenu(e.clientX, e.clientY, items);
  }

  private confirmDelete(c: Crate): void {
    const yes = h('button', { class: 'btn danger' }, `Delete ${c.kind}`);
    const no = h('button', { class: 'btn' }, 'Keep it');
    const m = openModal(`Delete "${c.name}"?`, h('div', {}, h('p', { class: 'note' }, c.kind === 'folder' ? 'The folder and every crate inside it will be removed. Tracks stay in your collection.' : 'The crate will be removed. Tracks stay in your collection.'), h('div', { style: { display: 'flex', gap: '8px' } }, yes, no)));
    yes.addEventListener('click', () => {
      this.app.library.deleteCrate(c.id);
      if (this.view.kind === 'crate' && this.view.id === c.id) this.view = { kind: 'all' };
      m.close();
    });
    no.addEventListener('click', () => m.close());
  }

  private create(kind: 'crate' | 'folder', parent: string | null = null): void {
    const lib = this.app.library;
    if (!parent && this.view.kind === 'crate') {
      const cur = lib.crate(this.view.id);
      parent = cur?.parent ?? null;
    }
    const c = lib.createCrate(kind === 'crate' ? 'New crate' : 'New folder', kind, parent);
    if (parent) this.openFolders.add(parent);
    this.renaming = c.id;
    this.renderSide();
  }

  /** show a crate (or the whole collection) */
  showCrate(id: string | null): void {
    const c = id ? this.app.library.crate(id) : undefined;
    // open the folders it sits in
    for (let p = c?.parent ?? null; p; p = this.app.library.crate(p)?.parent ?? null) this.openFolders.add(p);
    this.setView(c ? { kind: 'crate', id: c.id } : { kind: 'all' });
  }

  private setView(v: View): void {
    this.view = v;
    this.renderSide();
    this.render();
  }

  /* ------------------------------------------------------------------ */
  /* track table                                                          */
  /* ------------------------------------------------------------------ */

  private matchKey() {
    if (this.keyMatch.value === 'all') return null;
    const e = this.app.engine;
    const d = e.masterDeck ?? e.deck(this.app.sideDeck('L'));
    return d && d.loaded ? d.currentKey() : null;
  }

  private visibleTracks(): LibraryTrack[] {
    const lib = this.app.library;
    let list: LibraryTrack[];
    switch (this.view.kind) {
      case 'favs':
        list = lib.list().filter((t) => t.fav);
        break;
      case 'history':
        list = lib.history.map((id) => lib.get(id)).filter((t): t is LibraryTrack => !!t);
        break;
      case 'crate': {
        const c = lib.crate(this.view.id);
        list = c ? c.trackIds.map((id) => lib.get(id)).filter((t): t is LibraryTrack => !!t) : [];
        break;
      }
      default:
        list = lib.list();
    }
    const q = parseSearch(this.search.value);
    const min = parseFloat(this.bpmMin.value);
    const max = parseFloat(this.bpmMax.value);
    if (!isNaN(min)) q.bpmMin = Math.max(q.bpmMin ?? 0, min);
    if (!isNaN(max)) q.bpmMax = Math.min(q.bpmMax ?? 999, max);
    list = list.filter((t) => matchTrack(t, q));
    const mk = this.matchKey();
    if (this.keyMatch.value === 'only' && mk) list = list.filter((t) => compatibility(t.analysis?.key, mk) !== null);
    const genre = this.genreFilter.value;
    if (genre) list = list.filter((t) => genreOf(t).genre === genre);
    if (this.view.kind !== 'history') {
      const { key, dir } = this.sort;
      const val = (t: LibraryTrack): string | number => {
        switch (key) {
          case 'title':
            return t.meta.title.toLowerCase();
          case 'artist':
            return t.meta.artist.toLowerCase();
          case 'genre':
            // tracks with no genre yet go to the bottom
            return genreOf(t).genre.toLowerCase() || '\uffff';
          case 'bpm':
            return t.analysis?.bpm ?? 0;
          case 'key':
            return t.analysis?.key ? parseInt(t.analysis.key.camelot, 10) * 2 + (t.analysis.key.minor ? 0 : 1) : 99;
          case 'energy':
            return trackInfo(t).energy;
          case 'fav':
            return t.fav ? 0 : 1;
          case 'time':
            return t.analysis?.duration ?? 0;
          case 'bitrate':
            return t.meta.bitrate ?? 0;
          case 'format':
            return t.meta.format;
          default:
            return t.addedAt;
        }
      };
      list.sort((a, b) => {
        const x = val(a);
        const y = val(b);
        return (x < y ? -1 : x > y ? 1 : 0) * dir;
      });
    }
    return list;
  }

  private render(): void {
    const cols: [SortKey | null, string][] = [
      ['fav', '★'],
      [null, ''],
      ['title', 'Title'],
      ['artist', 'Artist'],
      ['genre', 'Genre'],
      ['bpm', 'BPM'],
      ['key', 'Key'],
      ['energy', 'Energy'],
      ['time', 'Time'],
      [null, 'Load'],
    ];
    clear(this.thead);
    const tr = h('tr');
    for (const [k, label] of cols) {
      const th = h('th', { class: k && this.sort.key === k ? 'sorted' : '' }, label + (k && this.sort.key === k ? (this.sort.dir > 0 ? ' ▲' : ' ▼') : ''));
      if (k)
        th.addEventListener('click', () => {
          this.sort = { key: k, dir: this.sort.key === k ? ((-this.sort.dir) as 1 | -1) : k === 'added' ? -1 : 1 };
          this.render();
        });
      tr.append(th);
    }
    this.thead.append(tr);

    this.refreshGenres();
    this.rows = this.visibleTracks();
    const importing = this.app.library.importing;
    this.countEl.textContent = `${this.rows.length} tracks${importing ? ` · importing ${importing}` : ''}`;
    clear(this.tbody);
    const lib = this.app.library;
    if (!lib.list().length && this.view.kind !== 'crate') {
      this.tbody.append(h('tr', {}, h('td', { colspan: cols.length }, this.welcome())));
      return;
    }
    const wanted = this.view.kind === 'crate' ? (lib.crate(this.view.id)?.wanted ?? []) : [];
    if (!this.rows.length && !wanted.length) {
      const msg =
        this.view.kind === 'crate'
          ? h('div', { class: 'empty' }, h('strong', {}, 'Empty crate'), 'Drag tracks onto its name in the sidebar.')
          : h('div', { class: 'empty' }, h('strong', {}, 'No tracks match'), 'Try a different search, or drop audio files here to import them.');
      this.tbody.append(h('tr', {}, h('td', { colspan: cols.length }, msg)));
      return;
    }
    const mk = this.matchKey();
    const loaded = new Set(this.app.engine.decks.filter((d) => d.track).map((d) => d.track!.id));
    const deckIds = this.app.deckCount() === 4 ? [1, 2, 3, 4] : [1, 2];
    const sel = this.app.selectedTrack();
    const frag = document.createDocumentFragment();
    for (const t of this.rows) {
      const a = t.analysis;
      const compat = mk ? compatibility(a?.key, mk) : null;
      const row = h('tr', {
        class: `${sel?.id === t.id ? 'selected ' : ''}${compat === 'same' || compat === 'harmonic' ? 'compat ' : ''}${loaded.has(t.id) ? 'loaded' : ''}`,
        draggable: 'true',
        'data-id': t.id,
      });
      const art = h('span', { class: 'art', style: t.meta.art ? { backgroundImage: `url("${t.meta.art}")` } : undefined });
      const status =
        t.status === 'analyzing'
          ? h('span', { class: 'status-pill' }, h('span', { class: 'spinner' }), 'analysing')
          : t.status === 'error'
            ? h('span', { class: 'status-pill', title: t.error ?? '', style: { color: '#ff8fa3' } }, 'can’t play')
            : null;
      const keyCell = a?.key ? h('span', { class: 'chip key', style: { background: camelotColor(a.key) }, title: a.key.name }, formatKey(a.key)) : status ?? '—';
      const loads = h('div', { class: 'load-btns' });
      for (const id of deckIds) {
        const b = h('button', { class: 'btn', title: `Load to deck ${id}` }, String(id));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          void this.app.loadTrack(id, t.id);
        });
        loads.append(b);
      }
      const info = trackInfo(t);
      const star = h('button', { class: `fav${t.fav ? ' on' : ''}`, type: 'button', title: t.fav ? 'Take the star off' : 'Star it', 'aria-label': t.fav ? `Unstar ${t.meta.title}` : `Star ${t.meta.title}`, 'aria-pressed': String(!!t.fav) }, t.fav ? '★' : '☆');
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.library.setFavorite(t, !t.fav);
      });
      const g = genreOf(t);
      const unsure = g.source === 'guess' && (a?.genre?.confidence ?? 0) < 0.25;
      const genreBtn = g.genre
        ? h('button', { class: `genre ${g.source}`, type: 'button', title: genreNote(t) }, g.genre + (unsure ? '?' : ''))
        : h('button', { class: 'genre none', type: 'button', title: genreNote(t) }, t.status === 'analyzing' ? '…' : '—');
      genreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.select(t);
        const r = genreBtn.getBoundingClientRect();
        this.genreMenu(t, r.left, r.bottom + 4);
      });
      const energy = h('span', { class: 'energy', title: `Energy ${info.energy} of 10`, style: { '--e': String(info.energy / 10) } as Partial<CSSStyleDeclaration> }, String(info.energy));
      row.append(
        h('td', {}, star),
        h('td', {}, art),
        h('td', { class: 'title', title: t.meta.title }, t.meta.title),
        h('td', { title: t.meta.artist }, t.meta.artist || '—'),
        h('td', { class: 'genre-cell' }, genreBtn),
        h('td', { class: 'num' }, a ? formatBpm(a.bpm) : status ?? '—'),
        h('td', {}, keyCell),
        h('td', { class: 'num' }, energy),
        h('td', { class: 'num' }, a ? formatTime(a.duration) : '—'),
        h('td', {}, loads),
      );
      row.addEventListener('click', () => this.app.select(t));
      row.addEventListener('dblclick', () => this.loadToFree(t));
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/x-deckhouse-track', t.id);
        e.dataTransfer?.setData('text/plain', t.meta.title);
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.app.select(t);
        this.trackMenu(t, e);
      });
      frag.append(row);
    }
    this.tbody.append(frag);
    if (wanted.length) {
      const add = h('button', { class: 'btn small', type: 'button' }, 'Add files…');
      add.addEventListener('click', () => this.fileInput.click());
      this.tbody.append(
        h(
          'tr',
          { class: 'wanted-row' },
          h('td', { colspan: cols.length }, h('div', { class: 'wanted' }, h('b', {}, `${wanted.length} more in this playlist`), h('span', { class: 'wanted-list' }, wanted.slice(0, 6).map(entryLabel).join(' · ') + (wanted.length > 6 ? ' …' : '')), add)),
        ),
      );
    }
  }

  /** an empty library: how to get music in */
  private welcome(): HTMLElement {
    const files = h('button', { class: 'btn primary', type: 'button' }, 'Import music');
    files.addEventListener('click', () => this.fileInput.click());
    const folder = h('button', { class: 'btn', type: 'button' }, 'Import a folder');
    folder.addEventListener('click', () => this.folderInput.click());
    const playlist = h('button', { class: 'btn', type: 'button' }, 'Import a playlist');
    playlist.addEventListener('click', () => this.importPlaylist());
    return h(
      'div',
      { class: 'lib-welcome' },
      h('h3', {}, 'Add your music'),
      h('p', {}, 'Drop audio files anywhere, or pick them here. They stay on this device.'),
      h('div', { class: 'lib-welcome-acts' }, files, folder, playlist),
      h('p', { class: 'fineprint' }, 'MP3, WAV, AIFF, FLAC, OGG and M4A. Playlists from rekordbox, Traktor, Apple Music, or a CSV of a streaming playlist.'),
    );
  }

  private importPlaylist(): void {
    openPlaylistImport({
      library: this.app.library,
      importFiles: (files) => this.app.importFiles(files),
      showCrate: (id) => this.showCrate(id),
    });
  }

  private highlightSelection(): void {
    const sel = this.app.selectedTrack();
    for (const tr of this.tbody.querySelectorAll('tr')) {
      const on = tr.getAttribute('data-id') === sel?.id;
      tr.classList.toggle('selected', on);
      if (on) tr.scrollIntoView({ block: 'nearest' });
    }
  }

  private loadToFree(t: LibraryTrack): void {
    const e = this.app.engine;
    const L = this.app.sideDeck('L');
    const R = this.app.sideDeck('R');
    const target = !e.deck(L).playing ? L : !e.deck(R).playing ? R : null;
    if (target === null) {
      toast('Both decks are playing. Pause one first.');
      return;
    }
    void this.app.loadTrack(target, t.id);
  }

  private trackMenu(t: LibraryTrack, e: MouseEvent): void {
    const lib = this.app.library;
    const deckIds = this.app.deckCount() === 4 ? [1, 2, 3, 4] : [1, 2];
    const items: ({ label: string; action: () => void; danger?: boolean } | 'sep')[] = deckIds.map((id) => ({ label: `Load to deck ${id}`, action: () => void this.app.loadTrack(id, t.id) }));
    items.push('sep', { label: `Genre: ${genreOf(t).genre || 'none'}…`, action: () => this.genreMenu(t, e.clientX, e.clientY) });
    const crates = lib.crates.filter((c) => c.kind === 'crate');
    if (crates.length) {
      items.push('sep');
      for (const c of crates) items.push({ label: `Add to “${c.name}”`, action: () => lib.addToCrate(c.id, [t.id]) });
    }
    if (this.view.kind === 'crate') {
      const cid = this.view.id;
      items.push({ label: 'Remove from this crate', action: () => lib.removeFromCrate(cid, [t.id]) });
    }
    items.push('sep', { label: 'Remove from library', danger: true, action: () => void lib.deleteTrack(t.id) });
    contextMenu(e.clientX, e.clientY, items);
  }

  /** pick a genre for a track: the analyser's list, any other genres in the library, or back to automatic */
  private genreMenu(t: LibraryTrack, x: number, y: number): void {
    const lib = this.app.library;
    const cur = genreOf(t);
    const extra = [...new Set(lib.list().map((x) => genreOf(x).genre))].filter((g) => g && !(GENRES as readonly string[]).includes(g)).sort();
    const pick = (g: string) => ({ label: g, checked: cur.genre === g, action: () => lib.setGenre(t, g) });
    const auto = genreOf({ ...t, genre: undefined });
    contextMenu(x, y, [
      { header: 'Genre' },
      ...(t.genre ? [{ label: auto.genre ? `Automatic (${auto.genre})` : 'Automatic', action: () => lib.setGenre(t, null) }, 'sep' as const] : []),
      ...GENRES.map(pick),
      ...(extra.length ? ['sep' as const, ...extra.map(pick)] : []),
    ]);
  }

  /** the genre filter lists the genres in the library */
  private refreshGenres(): void {
    const counts = new Map<string, number>();
    for (const t of this.app.library.list()) {
      const g = genreOf(t).genre;
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const list = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const sig = list.map(([g, n]) => `${g}:${n}`).join('|');
    if (sig === this.genreOptions) return;
    this.genreOptions = sig;
    const cur = this.genreFilter.value;
    clear(this.genreFilter);
    this.genreFilter.append(h('option', { value: '' }, 'All genres'), ...list.map(([g, n]) => h('option', { value: g }, `${g} (${n})`)));
    this.genreFilter.value = counts.has(cur) ? cur : '';
    this.genreFilter.hidden = !list.length;
  }

  /* ------------------------------------------------------------------ */
  /* the board's touch screen browses the same list                      */
  /* ------------------------------------------------------------------ */

  /** every source the library has: the collection, favourites, history, then crates and folders */
  sources(): { id: string; name: string; count: number; depth: number; folder: boolean }[] {
    const lib = this.app.library;
    const all = lib.list();
    const out = [
      { id: 'all', name: 'Collection', count: all.length, depth: 0, folder: false },
      { id: 'favs', name: 'Favourites', count: all.filter((t) => t.fav).length, depth: 0, folder: false },
      { id: 'history', name: 'History', count: lib.history.length, depth: 0, folder: false },
    ];
    const walk = (parent: string | null, depth: number) => {
      for (const c of lib.children(parent)) {
        out.push({ id: `crate:${c.id}`, name: c.name, count: c.trackIds.length, depth, folder: c.kind === 'folder' });
        if (c.kind === 'folder') walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  /** the source on show ('all', 'demo', 'favs', 'history' or 'crate:<id>') */
  sourceId(): string {
    return this.view.kind === 'crate' ? `crate:${this.view.id}` : this.view.kind;
  }

  setSource(id: string): void {
    if (id.startsWith('crate:')) this.showCrate(id.slice(6));
    else if (id === 'all' || id === 'favs' || id === 'history') this.setView({ kind: id });
  }

  /** the tracks on show, in the order shown */
  visible(): LibraryTrack[] {
    return this.rows;
  }

  sorting(): { key: SortKey; dir: 1 | -1 } {
    return this.sort;
  }

  /** sort by a column; again on the same one reverses it */
  sortBy(key: SortKey): void {
    this.sort = { key, dir: this.sort.key === key ? ((-this.sort.dir) as 1 | -1) : key === 'added' ? -1 : 1 };
    this.render();
  }

  moveSelection(delta: number): void {
    if (!this.rows.length) return;
    const sel = this.app.selectedTrack();
    let i = sel ? this.rows.findIndex((r) => r.id === sel.id) : -1;
    i = Math.max(0, Math.min(this.rows.length - 1, i + delta));
    this.app.select(this.rows[i]);
  }

  loadSelectedTo(side: 'L' | 'R'): void {
    const sel = this.app.selectedTrack();
    if (sel) void this.app.loadTrack(this.app.sideDeck(side), sel.id);
  }

  private exportJson(): void {
    const json = this.app.library.exportJSON();
    const name = `deckhouse-library-${new Date().toISOString().slice(0, 10)}.json`;
    void saveFile(json, name, 'application/json');
    const ta = h('textarea', { class: 'json', readonly: true }) as HTMLTextAreaElement;
    ta.value = json;
    const copy = h('button', { class: 'btn primary' }, 'Copy JSON');
    copy.addEventListener('click', () => {
      navigator.clipboard?.writeText(json).then(
        () => toast('Library JSON copied'),
        () => {
          ta.select();
          toast('Select-all is ready — press Ctrl/⌘+C to copy');
        },
      );
    });
    openModal('Export crates & cues', h('div', { style: { display: 'grid', gap: '8px' } }, h('p', { class: 'note' }, `A download named ${name} was started. If your browser blocked it, copy the JSON below. Audio files are not included — only crates, cue points, grids and track references.`), ta, h('div', {}, copy)));
  }

  private importJson(): void {
    const ta = h('textarea', { class: 'json', placeholder: 'Paste a Deckhouse library export here, or choose a file.' }) as HTMLTextAreaElement;
    const file = h('input', { type: 'file', accept: '.json,application/json' }) as HTMLInputElement;
    const go = h('button', { class: 'btn primary' }, 'Import');
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) ta.value = await f.text();
    });
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    const m = openModal('Import crates & cues', h('div', { style: { display: 'grid', gap: '8px' } }, file, ta, h('div', {}, go)));
    go.addEventListener('click', () => {
      try {
        const r = this.app.library.importJSON(ta.value);
        toast(`Imported ${r.crates} crates · cue data matched ${r.matched} tracks${r.missing ? ` · ${r.missing} not in this library` : ''}`);
        m.close();
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
      }
    });
  }
}
