/*
 * One set (Section 11.6): watch or listen back, rename it, see its tracklist
 * and moments, and export it: the video as recorded, WAV, MP3, the cover art
 * and the tracklist. Opens after every recording and from My Sets.
 */
import type { Recording } from '../core/models';
import { formatBytes } from '../media/MediaStore';
import { downloadBlob, type SetLibrary } from '../media/sets';
import { mmss } from '../media/Compositor';
import { h, setText } from './dom';
import { openModal, type ModalHandle } from './modal';
import { toast } from './toast';

export interface SetViewHooks {
  sets: SetLibrary;
  djName: string;
  venueName(id: string): string;
  /** open the trim editor on this set (when it has audio to trim) */
  trim?(r: Recording, at?: number): void;
  /** a word on top: "Mix saved. That one's a keeper." */
  headline?: string;
}

const SOURCE: Record<Recording['source'], string> = { rec: 'Recorded', buffer: 'Save That Mix', clip: 'Clip', trim: 'Trimmed' };

export function openSetView(r: Recording, o: SetViewHooks): ModalHandle {
  const venue = o.venueName(r.venue);
  const urls: string[] = [];
  const media = h('div', { class: 'sv-media' });
  const cover = h('img', { class: 'sv-cover', alt: `Cover art: ${r.title}` }) as HTMLImageElement;
  const load = async () => {
    const c = await o.sets.file(r, 'cover');
    if (c) {
      const u = URL.createObjectURL(c);
      urls.push(u);
      cover.src = u;
    }
    const v = await o.sets.file(r, 'video');
    if (v) {
      const u = URL.createObjectURL(v);
      urls.push(u);
      media.replaceChildren(h('video', { src: u, controls: true, playsinline: true, poster: cover.src || undefined, class: `sv-video a-${r.aspect.replace(':', 'x')}` }));
      return;
    }
    const w = await o.sets.wav(r);
    if (w) {
      const u = URL.createObjectURL(w);
      urls.push(u);
      media.replaceChildren(cover, h('audio', { src: u, controls: true, class: 'sv-audio' }));
    } else media.replaceChildren(cover, h('p', { class: 'gs-note' }, 'The files for this set are missing (the browser may have cleared its storage).'));
  };
  media.append(cover);
  void load();

  const title = h('input', { class: 'sv-title', value: r.title, maxlength: 80, 'aria-label': 'Title' }) as HTMLInputElement;
  title.addEventListener('change', () => o.sets.rename(r.id, title.value));
  const fav = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(r.favorite) }, r.favorite ? '★ Favourite' : '☆ Favourite');
  fav.addEventListener('click', () => {
    o.sets.toggleFavorite(r.id);
    fav.textContent = r.favorite ? '★ Favourite' : '☆ Favourite';
    fav.setAttribute('aria-pressed', String(r.favorite));
  });
  const facts = h('p', { class: 'sv-facts' }, `${SOURCE[r.source]} · ${venue} · ${new Date(r.date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · ${mmss(r.seconds)}${r.grade ? ` · Grade ${r.grade}` : ''} · ${formatBytes(r.bytes)}`);

  const tl = h('ol', { class: 'sv-tracks' }, ...(r.tracklist.length ? r.tracklist.map((t) => h('li', {}, h('span', { class: 'mono' }, mmss(t.at)), ` ${t.title} — ${t.artist}`)) : [h('li', { class: 'gs-note' }, 'No track played long enough to be listed.')]));
  const marks = h(
    'ul',
    { class: 'sv-marks' },
    ...r.markers.slice(0, 40).map((m) => {
      const b = h('button', { type: 'button', class: 'gs-chip', title: o.trim ? 'Open the trim editor here' : '' }, `${mmss(m.at)} ${m.label}`);
      if (o.trim && r.files.pcm) b.addEventListener('click', () => (handle.close(), o.trim!(r, m.at)));
      else b.disabled = true;
      return h('li', {}, b);
    }),
  );

  const status = h('span', { class: 'gs-note' });
  const btn = (label: string, run: () => Promise<void> | void, enabled = true) => {
    const b = h('button', { class: 'btn', type: 'button' }, label) as HTMLButtonElement;
    b.disabled = !enabled;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await run();
      } catch (e) {
        toast(`Export failed: ${(e as Error).message}`, 'error');
      } finally {
        b.disabled = false;
      }
    });
    return b;
  };
  const name = (ext: string) => o.sets.fileName(r, o.djName, venue, ext);
  const exports = h(
    'div',
    { class: 'sv-exports' },
    btn('Video', async () => {
      const v = await o.sets.file(r, 'video');
      if (v) downloadBlob(v, name(v.type.includes('mp4') ? 'mp4' : 'webm'));
    }, !!r.files.video),
    btn('WAV (24-bit)', async () => {
      const w = await o.sets.wav(r);
      if (w) downloadBlob(w, name('wav'));
    }, !!r.files.pcm),
    btn('MP3 (320)', async () => {
      setText(status, 'Encoding MP3… 0%');
      const m = await o.sets.mp3(r, o.djName, venue, (k) => setText(status, `Encoding MP3… ${Math.round(k * 100)}%`));
      setText(status, '');
      if (m) downloadBlob(m, name('mp3'));
    }, !!r.files.pcm),
    btn('Cover art', async () => {
      const c = await o.sets.file(r, 'cover');
      if (c) downloadBlob(c, name('png'));
    }, !!r.files.cover),
    btn('Tracklist', () => downloadBlob(o.sets.tracklist(r, o.djName, venue), name('txt'))),
    status,
  );
  if (o.trim && r.files.pcm) exports.prepend(btn('✂ Trim', () => (handle.close(), o.trim!(r))));
  const del = h('button', { class: 'btn ghost danger', type: 'button' }, 'Delete');
  del.addEventListener('click', async () => {
    if (!confirm(`Delete “${r.title}”? This can’t be undone.`)) return;
    await o.sets.remove([r.id]);
    handle.close();
    toast('Set deleted');
  });

  const handle = openModal(
    o.headline ?? r.title,
    h(
      'div',
      { class: 'set-view' },
      media,
      h('div', { class: 'sv-side' }, h('div', { class: 'sv-head' }, title, fav), facts, exports, h('h3', { class: 'rp-h' }, 'Tracklist'), tl, r.markers.length ? h('h3', { class: 'rp-h' }, 'Moments') : null, r.markers.length ? marks : null, h('div', { class: 'gs-actions' }, del)),
      h('p', { class: 'gs-note sv-hint' }, 'If a download does nothing (some embedded viewers block them), open the page on its own.'),
    ),
    { wide: true },
  );
  const close = handle.close;
  handle.close = () => {
    close();
    for (const u of urls) URL.revokeObjectURL(u);
  };
  return handle;
}
