/*
 * Set codes in the interface: "Share this set" makes a code from the tracks
 * you've played (and the room's look and scenes in a crazy room) to copy and
 * send; "Open a set code" reads one, shows what's in it and loads it: the
 * venue, the room's set-up and a crate of the tracks you have, in order.
 */
import { decodeSetCode, encodeSetCode, matchTracks, type SetCode, type SetTrack } from '../game/setcode';
import { h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

export interface SetCodeHooks {
  dj(): string;
  venue(): string;
  venueName(id: string): string | null;
  /** the tracks played, in order */
  played(): SetTrack[];
  /** the crazy room's look and scenes, if you're in one */
  room(): { look: unknown; scenes: unknown[] } | null;
  library(): { id: string; title: string; artist: string }[];
  /** go there, with this room set-up, and make a crate of these tracks */
  load(set: SetCode, trackIds: string[]): void;
}

export async function openShareCode(hooks: SetCodeHooks): Promise<void> {
  const tracks = hooks.played();
  if (!tracks.length) {
    toast('Play a few tracks first: the code carries the tracklist');
    return;
  }
  const set: SetCode = { v: 1, dj: hooks.dj(), venue: hooks.venue(), tracks, ...(hooks.room() ? { room: hooks.room()! } : {}) };
  const code = await encodeSetCode(set);
  const box = h('textarea', { class: 'setcode-box mono', readonly: true, rows: 4, 'aria-label': 'Set code' }, code) as HTMLTextAreaElement;
  const copy = h('button', { type: 'button', class: 'btn primary' }, 'Copy code');
  copy.addEventListener('click', () => {
    box.select();
    navigator.clipboard?.writeText(code).then(
      () => toast('Code copied'),
      () => toast('Select the code and copy it'),
    );
  });
  openModal(
    'Share this set',
    h(
      'div',
      { class: 'setcode' },
      h('p', {}, `${tracks.length} track${tracks.length === 1 ? '' : 's'} at ${hooks.venueName(set.venue) ?? set.venue}${set.room ? ', with the room’s look and scenes' : ''}. A friend opens it with ⋯ → Open a set code, and plays it with their own copies of the tracks.`),
      box,
      h('ol', { class: 'setcode-list' }, ...tracks.map((t) => h('li', {}, t.artist ? `${t.artist} – ${t.title}` : t.title))),
      h('div', { class: 'gs-actions' }, copy),
    ),
  );
}

export function openSetCode(hooks: SetCodeHooks): void {
  const box = h('textarea', { class: 'setcode-box mono', rows: 4, placeholder: 'Paste a set code (DH1.…)', 'aria-label': 'Set code' }) as HTMLTextAreaElement;
  const preview = h('div', { class: 'setcode-preview' });
  const load = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Load it') as HTMLButtonElement;
  let ready: { set: SetCode; ids: string[] } | null = null;
  const read = async () => {
    ready = null;
    load.disabled = true;
    const v = box.value.trim();
    if (!v) {
      preview.replaceChildren();
      return;
    }
    const set = await decodeSetCode(v);
    if (!set) {
      preview.replaceChildren(h('p', { class: 'note' }, 'That isn’t a set code (they start DH1. or DH0.).'));
      return;
    }
    const venue = hooks.venueName(set.venue);
    const { found, missing } = matchTracks(set.tracks, hooks.library());
    ready = { set, ids: found.map((t) => t.id) };
    load.disabled = !venue && !found.length;
    preview.replaceChildren(
      h('p', {}, h('b', {}, `${set.dj || 'A DJ'}’s set`), ` at ${venue ?? 'a venue you don’t have'}${set.room ? ', with their room set-up' : ''}`),
      h('p', { class: 'note' }, `You have ${found.length} of the ${set.tracks.length} tracks.${missing.length ? ' The others are listed so you can find them.' : ''}`),
      h(
        'ol',
        { class: 'setcode-list' },
        ...set.tracks.map((t) => {
          const have = !missing.includes(t);
          return h('li', { class: have ? 'have' : 'missing' }, `${t.artist ? `${t.artist} – ` : ''}${t.title}${t.bpm ? ` · ${t.bpm} BPM` : ''}${have ? '' : ' (missing)'}`);
        }),
      ),
    );
  };
  box.addEventListener('input', () => void read());
  load.addEventListener('click', () => {
    if (!ready) return;
    hooks.load(ready.set, ready.ids);
    m.close();
  });
  const m = openModal('Open a set code', h('div', { class: 'setcode' }, box, preview, h('div', { class: 'gs-actions' }, load)));
}
