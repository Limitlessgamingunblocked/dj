/*
 * Import a playlist: a playlist file from another app (M3U, PLS, XSPF,
 * rekordbox, Traktor, Apple Music), a CSV export of a streaming playlist, or a
 * pasted track list. Each one becomes a crate. Tracks already in the library
 * go straight in; the rest are listed, and slot in when you add their files.
 */
import type { Library } from '../library/Library';
import { AUDIO_ACCEPT } from '../library/Library';
import { entryLabel, parsePlaylistFile, parseText, PLAYLIST_ACCEPT, type Playlist } from '../library/playlists';
import { h } from './dom';
import { openModal, type ModalHandle } from './modal';
import { toast } from './toast';

export interface PlaylistImportHooks {
  library: Library;
  /** import audio files (the ones a playlist is missing) */
  importFiles(files: File[]): Promise<unknown>;
  /** show a crate in the library */
  showCrate(id: string): void;
}

export function openPlaylistImport(o: PlaylistImportHooks): ModalHandle {
  const fileIn = h('input', { type: 'file', multiple: true, accept: PLAYLIST_ACCEPT, hidden: true }) as HTMLInputElement;
  const audioIn = h('input', { type: 'file', multiple: true, accept: AUDIO_ACCEPT, hidden: true }) as HTMLInputElement;
  const folderIn = h('input', { type: 'file', multiple: true, hidden: true }) as HTMLInputElement;
  folderIn.setAttribute('webkitdirectory', '');
  const body = h('div', { class: 'pl-import' });
  let lastCrate: string | null = null;

  const pick = h('button', { class: 'btn primary', type: 'button' }, 'Choose playlist files');
  pick.addEventListener('click', () => fileIn.click());
  const paste = h('textarea', { class: 'pl-paste', rows: 6, placeholder: 'Or paste a track list, one per line:\nArtist - Title', 'aria-label': 'Track list' }) as HTMLTextAreaElement;
  paste.addEventListener('keydown', (e) => e.stopPropagation());
  const name = h('input', { class: 'search', placeholder: 'Playlist name', 'aria-label': 'Playlist name' }) as HTMLInputElement;
  name.addEventListener('keydown', (e) => e.stopPropagation());
  const addPasted = h('button', { class: 'btn', type: 'button' }, 'Make a crate');
  addPasted.addEventListener('click', () => {
    const p = parseText(paste.value, name.value.trim() || 'Pasted playlist');
    if (!p.entries.length) return toast('Paste at least one track.');
    done([p]);
  });

  const start = () =>
    body.replaceChildren(
      h('div', { class: 'pl-pick' }, pick, h('p', { class: 'note' }, 'M3U, PLS, XSPF, rekordbox XML, Traktor NML, an Apple Music library XML, or a CSV.')),
      h('div', { class: 'pl-or' }, h('div', { class: 'pl-paste-wrap' }, paste, h('div', { class: 'pl-row' }, name, addPasted))),
      h('p', { class: 'note fineprint' }, 'Spotify and SoundCloud don’t let their audio into DJ apps. Bring the track list (a playlist export tool can save a CSV), then add your own files: they slot into the crate.'),
    );

  const done = (pls: Playlist[]) => {
    const res = o.library.importPlaylists(pls);
    lastCrate = res[0]?.id ?? null;
    if (lastCrate) o.showCrate(lastCrate);
    const missing = res.reduce((n, r) => n + r.missing.length, 0);
    const addFiles = h('button', { class: 'btn primary', type: 'button' }, 'Add the missing files…');
    addFiles.addEventListener('click', () => audioIn.click());
    const addFolder = h('button', { class: 'btn', type: 'button' }, 'Add a folder…');
    addFolder.addEventListener('click', () => folderIn.click());
    const close = h('button', { class: 'btn', type: 'button' }, 'Done');
    close.addEventListener('click', () => m.close());
    body.replaceChildren(
      ...res.map((r): Node =>
        h(
          'section',
          { class: 'pl-result' },
          h('div', { class: 'pl-result-head' }, h('b', {}, r.name), h('span', { class: r.missing.length ? 'pl-count part' : 'pl-count all' }, `${r.found} of ${r.found + r.missing.length} found`)),
          r.missing.length ? h('ul', { class: 'pl-missing' }, ...r.missing.slice(0, 8).map((e) => h('li', {}, entryLabel(e))), r.missing.length > 8 ? h('li', { class: 'more' }, `and ${r.missing.length - 8} more`) : null) : null,
        ),
      ),
      h('p', { class: 'note' }, missing ? 'Add the files for the missing tracks and they go into the crate.' : 'Everything was already in your library.'),
      h('div', { class: 'gs-actions' }, missing ? addFolder : null, missing ? addFiles : null, close),
    );
  };

  fileIn.addEventListener('change', async () => {
    const files = [...(fileIn.files ?? [])];
    fileIn.value = '';
    const pls: Playlist[] = [];
    for (const f of files) {
      try {
        pls.push(...parsePlaylistFile(f.name, await f.text()));
      } catch {
        toast(`Couldn’t read ${f.name}.`, 'error');
      }
    }
    if (!pls.length) return toast('No tracks found in that file.', 'error');
    done(pls);
  });
  const addAudio = async (inp: HTMLInputElement) => {
    const files = [...(inp.files ?? [])];
    inp.value = '';
    if (!files.length) return;
    m.close();
    await o.importFiles(files);
    const left = o.library.wantedCount;
    toast(left ? `${left} track${left > 1 ? 's' : ''} still missing from your playlists.` : 'Your playlists are complete.');
  };
  audioIn.addEventListener('change', () => void addAudio(audioIn));
  folderIn.addEventListener('change', () => void addAudio(folderIn));

  start();
  const m = openModal('Import a playlist', h('div', {}, body, fileIn, audioIn, folderIn));
  return m;
}
