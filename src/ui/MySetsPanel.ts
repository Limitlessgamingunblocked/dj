/*
 * My Sets (Section 11.6): every recording, saved mix and clip, with its
 * date, venue, length, grade, tracklist and thumbnail. Sort, rename (in the
 * set's view), delete, favourite; and a storage manager that shows the space
 * used and clears old sets in one go, after asking (favourites are kept).
 */
import type { Recording } from '../core/models';
import { mmss } from '../media/Compositor';
import { formatBytes, storageEstimate } from '../media/MediaStore';
import { cleanupPlan, sortSets, type SetLibrary, type SortKey } from '../media/sets';
import { h, setText } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

export interface MySetsHooks {
  sets: SetLibrary;
  open(r: Recording): void;
  trim(r: Recording): void;
  venueName(id: string): string;
}

type Filter = 'all' | 'rec' | 'buffer' | 'clip' | 'fav';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'rec', label: 'Recordings' },
  { id: 'buffer', label: 'Saved mixes' },
  { id: 'clip', label: 'Clips' },
  { id: 'fav', label: '★ Favourites' },
];
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'date', label: 'Newest' },
  { id: 'length', label: 'Longest' },
  { id: 'grade', label: 'Best grade' },
  { id: 'venue', label: 'Venue' },
  { id: 'title', label: 'Title' },
];
const SOURCE: Record<Recording['source'], string> = { rec: 'REC', buffer: 'SAVED MIX', clip: 'CLIP', trim: 'CLIP' };

export class MySetsPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private usage: HTMLElement;
  private sort: SortKey = 'date';
  private filter: Filter = 'all';
  private thumbs = new Map<string, string>();

  constructor(private o: MySetsHooks) {
    const sortSel = h('select', { 'aria-label': 'Sort sets' }, ...SORTS.map((s) => h('option', { value: s.id }, s.label))) as HTMLSelectElement;
    sortSel.addEventListener('change', () => {
      this.sort = sortSel.value as SortKey;
      this.render();
    });
    const chips = h('div', { class: 'gs-chips', role: 'radiogroup', 'aria-label': 'Show' });
    for (const f of FILTERS) {
      const b = h('button', { type: 'button', class: 'gs-chip', role: 'radio' }, f.label);
      b.addEventListener('click', () => {
        this.filter = f.id;
        this.render();
      });
      chips.append(b);
    }
    this.usage = h('span', { class: 'ms-usage' });
    const manage = h('button', { class: 'btn', type: 'button' }, 'Storage…');
    manage.addEventListener('click', () => this.storage());
    this.list = h('div', { class: 'ms-list', role: 'list' });
    this.el = h('div', { class: 'my-sets' }, h('div', { class: 'ms-bar' }, chips, h('span', { class: 'spacer' }), sortSel, this.usage, manage), this.list);
    o.sets.changed.on('list', () => this.render());
    this.render();
  }

  private visible(): Recording[] {
    const items = this.o.sets.items.filter((r) => (this.filter === 'all' ? true : this.filter === 'fav' ? r.favorite : this.filter === 'clip' ? r.source === 'clip' || r.source === 'trim' : r.source === this.filter));
    return sortSets(items, this.sort);
  }

  render(): void {
    const chips = this.el.querySelectorAll('.ms-bar .gs-chip');
    chips.forEach((c, i) => c.classList.toggle('active', FILTERS[i].id === this.filter));
    const items = this.visible();
    setText(this.usage, `${this.o.sets.items.length} sets · ${formatBytes(this.o.sets.bytes)}`);
    const keep = new Set(this.o.sets.items.map((r) => r.id));
    for (const [id, u] of this.thumbs) if (!keep.has(id)) (URL.revokeObjectURL(u), this.thumbs.delete(id));
    if (!items.length) {
      this.list.replaceChildren(
        h('div', { class: 'ms-empty' }, h('b', {}, this.o.sets.items.length ? 'Nothing here with that filter.' : 'No sets yet.'), h('p', {}, 'Press REC (Shift+R) to record, or SAVE THAT MIX (Shift+S) to keep the last few minutes from the replay buffer. CLIP IT (Shift+C) makes a vertical clip of the last 30 seconds.')),
      );
      return;
    }
    this.list.replaceChildren(...items.map((r) => this.card(r)));
  }

  private card(r: Recording): HTMLElement {
    const img = h('img', { class: 'ms-thumb', alt: '', loading: 'lazy' }) as HTMLImageElement;
    const cached = this.thumbs.get(r.id);
    if (cached) img.src = cached;
    else
      void (async () => {
        const b = (await this.o.sets.file(r, 'thumb')) ?? (await this.o.sets.file(r, 'cover'));
        if (!b) return;
        const u = URL.createObjectURL(b);
        this.thumbs.set(r.id, u);
        img.src = u;
      })();
    const fav = h('button', { class: 'btn ghost ms-fav', type: 'button', title: r.favorite ? 'Favourite (kept by cleanup)' : 'Mark as favourite', 'aria-pressed': String(r.favorite) }, r.favorite ? '★' : '☆');
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      this.o.sets.toggleFavorite(r.id);
    });
    const del = h('button', { class: 'btn ghost', type: 'button', title: 'Delete', 'aria-label': `Delete ${r.title}` }, '🗑');
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete “${r.title}”? This can’t be undone.`)) return;
      await this.o.sets.remove([r.id]);
      toast('Set deleted');
    });
    const trim = h('button', { class: 'btn ghost', type: 'button', title: 'Trim', 'aria-label': `Trim ${r.title}` }, '✂');
    trim.disabled = !r.files.pcm;
    trim.addEventListener('click', (e) => {
      e.stopPropagation();
      this.o.trim(r);
    });
    const d = new Date(r.date);
    const card = h(
      'div',
      { class: 'ms-card', role: 'listitem', tabindex: 0, title: 'Open' },
      h('div', { class: 'ms-pic' }, img, h('span', { class: `ms-badge s-${r.source}` }, SOURCE[r.source]), r.grade ? h('span', { class: `ms-grade g-${r.grade}` }, r.grade) : null, h('span', { class: 'ms-len mono' }, mmss(r.seconds))),
      h('div', { class: 'ms-info' }, h('b', { class: 'ms-title' }, r.title), h('span', { class: 'ms-meta' }, `${this.o.venueName(r.venue)} · ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${r.tracklist.length} track${r.tracklist.length === 1 ? '' : 's'}${r.kind !== 'audio' ? ` · ${r.aspect}` : ' · audio'}`)),
      h('div', { class: 'ms-acts' }, fav, trim, del),
    );
    card.addEventListener('click', () => this.o.open(r));
    card.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && this.o.open(r));
    return card;
  }

  /** the storage manager: what's used, and a one-tap clear-out of the oldest sets */
  private storage(): void {
    const sets = this.o.sets;
    const est = h('p', { class: 'gs-note' }, 'Checking the browser’s storage…');
    void storageEstimate().then((e) => setText(est, e ? `This browser lets the app use about ${formatBytes(e.quota)}; ${formatBytes(e.usage)} is in use (music library included).` : 'This browser doesn’t say how much space it allows.'));
    let free = 512 << 20;
    const plan = h('div', { class: 'ms-plan' });
    const go = h('button', { class: 'btn primary', type: 'button' }) as HTMLButtonElement;
    const sizes = [100 << 20, 512 << 20, 1 << 30, 5 << 30, Infinity];
    const pick = h('div', { class: 'gs-chips' });
    const refresh = () => {
      const list = cleanupPlan(sets.items, free);
      const bytes = list.reduce((n, r) => n + r.bytes, 0);
      plan.replaceChildren(...(list.length ? list.slice(0, 12).map((r) => h('div', { class: 'ms-plan-row' }, h('span', {}, r.title), h('span', { class: 'gs-note' }, `${new Date(r.date).toLocaleDateString('en-GB')} · ${formatBytes(r.bytes)}`))) : [h('p', { class: 'gs-note' }, 'Nothing to clear: only favourites are left.')]));
      if (list.length > 12) plan.append(h('p', { class: 'gs-note' }, `…and ${list.length - 12} more.`));
      go.textContent = list.length ? `Delete ${list.length} oldest set${list.length === 1 ? '' : 's'} (${formatBytes(bytes)})` : 'Nothing to delete';
      go.disabled = !list.length;
      [...pick.children].forEach((c, i) => c.classList.toggle('active', sizes[i] === free));
    };
    for (const s of sizes) {
      const b = h('button', { type: 'button', class: 'gs-chip' }, s === Infinity ? 'Everything but favourites' : `Free ${formatBytes(s)}`);
      b.addEventListener('click', () => {
        free = s;
        refresh();
      });
      pick.append(b);
    }
    const m = openModal(
      'Storage',
      h('div', { class: 'gig-setup' }, h('p', {}, `My Sets uses ${formatBytes(sets.bytes)} for ${sets.items.length} set${sets.items.length === 1 ? '' : 's'}.`), est, h('h3', { class: 'rp-h' }, 'Clean up'), h('p', { class: 'gs-note' }, 'Oldest first. Favourites are never cleared.'), pick, plan, h('div', { class: 'gs-actions' }, go)),
    );
    go.addEventListener('click', async () => {
      const list = cleanupPlan(sets.items, free);
      if (!list.length || !confirm(`Delete ${list.length} set${list.length === 1 ? '' : 's'}? This can’t be undone.`)) return;
      await sets.remove(list.map((r) => r.id));
      toast(`Cleared ${list.length} set${list.length === 1 ? '' : 's'}.`);
      m.close();
    });
    refresh();
  }
}
