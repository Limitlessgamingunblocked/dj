/*
 * Ghost duels in the interface: "Duel a friend" on the results screen makes a
 * code (and a link, where the game runs from a web address) from the set you
 * just played; "Open a ghost duel" (⋯ menu, or the link) reads one, shows
 * whose run it is, the night and the score to beat, and plays it. After the
 * duel, the results show who won and the line to paste back.
 */
import { decodeDuel, duelLink, encodeDuel, findDuelCode, type Duel, type DuelOutcome } from '../game/duel';
import { matchTracks } from '../game/setcode';
import { SLOTS } from '../game/vibe';
import { h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

const fmt = (n: number) => n.toLocaleString();

function copyText(text: string, done: string): void {
  navigator.clipboard?.writeText(text).then(
    () => toast(done),
    () => toast('Select the text and copy it'),
  );
}

/** the page's own address, when it's one a friend can open (not a file or the desktop app) */
function webBase(): string | null {
  return typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? location.href : null;
}

/** the night in a few words: "Daily #291 · Warehouse · Peak time · 10 min" */
export function duelNight(d: Duel, venueName: string, dailyNumber?: number): string {
  return [d.daily ? `Daily #${dailyNumber ?? ''}`.trim() : null, venueName, SLOTS[d.slot].label, `${d.minutes} min`].filter(Boolean).join(' · ');
}

/** send a run: the code to copy, the link where there is one */
export async function openSendDuel(duel: Duel, o: { venueName: string; dailyNumber?: number }): Promise<void> {
  let code: string;
  try {
    code = await encodeDuel(duel);
  } catch {
    toast('That set was too short to send as a ghost');
    return;
  }
  const base = webBase();
  const link = base ? duelLink(base, code) : null;
  const box = h('textarea', { class: 'setcode-box mono', readonly: true, rows: 4, 'aria-label': 'Duel code' }, code) as HTMLTextAreaElement;
  const copy = h('button', { type: 'button', class: 'btn primary' }, 'Copy code');
  copy.addEventListener('click', () => {
    box.select();
    copyText(code, 'Duel code copied');
  });
  const copyLink = link ? h('button', { type: 'button', class: 'btn' }, 'Copy link') : null;
  copyLink?.addEventListener('click', () => copyText(link!, 'Duel link copied'));
  openModal(
    duel.answers !== undefined ? 'Send your run back' : 'Duel a friend',
    h(
      'div',
      { class: 'setcode duel' },
      h('p', {}, h('b', {}, `${duel.grade ? `${duel.grade} · ` : ''}${fmt(duel.score)} pts`), ` · ${duelNight(duel, o.venueName, o.dailyNumber)}`),
      h('p', { class: 'note' }, `Send this to a friend. They open it with ⋯ → Open a ghost duel${link ? ' (or just open the link)' : ''} and play the same night with their own music, against your ghost: your vibe on their meter and the points between you, live.${duel.tracks.length ? ` Your ${duel.tracks.length === 1 ? 'track comes' : `${duel.tracks.length} tracks come`} with it, so they can play ${duel.tracks.length === 1 ? 'it if they have it' : 'the ones they have'}.` : ''}`),
      box,
      h('div', { class: 'gs-actions' }, copyLink, copy),
    ),
  );
}

export interface OpenDuelHooks {
  /** a pasted code or link to start with */
  initial?: string;
  /** the venue's name, or null if it isn't in this game */
  venueName(id: string): string | null;
  dailyNumber(key: string): number;
  library(): { id: string; title: string; artist: string }[];
  /** play it: the friend's run, and the tracks of theirs you have, in order */
  play(duel: Duel, trackIds: string[]): void;
}

/** open a duel: paste a code (or a link), see whose run it is, play against it */
export function openDuelCode(hooks: OpenDuelHooks): void {
  const box = h('textarea', { class: 'setcode-box mono', rows: 4, placeholder: 'Paste a duel code (DG1.…) or link', 'aria-label': 'Duel code' }) as HTMLTextAreaElement;
  const preview = h('div', { class: 'setcode-preview' });
  const play = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Play against their ghost') as HTMLButtonElement;
  let ready: { duel: Duel; ids: string[] } | null = null;
  const read = async () => {
    ready = null;
    play.disabled = true;
    const v = box.value.trim();
    if (!v) {
      preview.replaceChildren();
      return;
    }
    const duel = findDuelCode(v) ? await decodeDuel(v) : null;
    if (box.value.trim() !== v) return;
    if (!duel) {
      preview.replaceChildren(h('p', { class: 'note' }, 'That isn’t a duel code (they start DG1. or DG0.).'));
      return;
    }
    const venue = hooks.venueName(duel.venue);
    const who = duel.dj || 'A friend';
    const { found, missing } = matchTracks(duel.tracks, hooks.library());
    if (!venue) {
      preview.replaceChildren(h('p', { class: 'note' }, `${who}’s run was at a venue that isn’t in your game (a room they built?), so it can’t be played here.`));
      return;
    }
    ready = { duel, ids: found.map((t) => t.id) };
    play.disabled = false;
    const parts: (HTMLElement | null)[] = [
      h('p', {}, h('b', {}, `${who}’s ghost`), ` · ${duelNight(duel, venue, duel.daily ? hooks.dailyNumber(duel.daily) : undefined)}`),
      h('p', { class: 'duel-target' }, 'Score to beat: ', h('b', {}, `${fmt(duel.score)} pts`), duel.grade ? ` (grade ${duel.grade})` : '', duel.answers !== undefined ? ` · a rematch of your ${fmt(duel.answers)}` : ''),
      duel.tracks.length
        ? h('p', { class: 'note' }, found.length >= 2 ? `You have ${found.length} of their ${duel.tracks.length} tracks: they go in a crate for the set. Any of your music counts, though.` : `They played ${duel.tracks.length} track${duel.tracks.length === 1 ? '' : 's'}${found.length ? `; you have ${found.length}` : ' you don’t have'}. Bring your own music: any tracks count.`)
        : null,
      duel.tracks.length && missing.length < duel.tracks.length
        ? h('ol', { class: 'setcode-list' }, ...duel.tracks.map((t) => h('li', { class: missing.includes(t) ? 'missing' : 'have' }, `${t.artist ? `${t.artist} – ` : ''}${t.title}${missing.includes(t) ? ' (missing)' : ''}`)))
        : null,
    ];
    preview.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  };
  box.addEventListener('input', () => void read());
  play.addEventListener('click', () => {
    if (!ready) return;
    m.close();
    hooks.play(ready.duel, ready.ids);
  });
  const m = openModal('Open a ghost duel', h('div', { class: 'setcode duel' }, box, preview, h('div', { class: 'gs-actions' }, play)));
  if (hooks.initial) {
    box.value = hooks.initial;
    void read();
  } else setTimeout(() => box.focus(), 30);
}

export interface DuelOut {
  name: string;
  score: number;
  yours: number;
  pts: [number, number, number][];
  outcome: DuelOutcome;
  /** the result as text to paste back */
  share: string;
}

/** the results screen's duel block: who won, by how much, how the race went, the line to paste back */
export function duelBlock(d: DuelOut, sendBack?: () => void): HTMLElement {
  const o = d.outcome;
  const head = o.result === 'won' ? `You beat ${d.name}’s ghost by ${fmt(o.margin)}` : o.result === 'lost' ? `${d.name}’s ghost won by ${fmt(o.margin)}` : `Dead level with ${d.name}’s ghost`;
  const race = [o.bestLead > 0 ? `furthest ahead +${fmt(o.bestLead)}` : null, o.worstLead < 0 ? `furthest behind −${fmt(-o.worstLead)}` : null].filter(Boolean).join(' · ');
  const copy = h('button', { class: 'btn small', type: 'button', title: 'Copy the result to paste to them' }, 'Copy result');
  copy.addEventListener('click', () => copyText(d.share, 'Result copied'));
  const back = sendBack ? h('button', { class: 'btn primary small', type: 'button', title: 'Your run as a duel code: now they race your ghost' }, 'Send your run back') : null;
  back?.addEventListener('click', () => sendBack?.());
  return h(
    'div',
    { class: `res-daily res-duel ${o.result}` },
    h('div', { class: 'res-daily-head' }, h('b', {}, `👻 ${head}`)),
    h('p', { class: 'res-duel-score' }, h('span', {}, 'You ', h('b', {}, fmt(d.yours))), h('span', {}, `${d.name} `, h('b', {}, fmt(d.score)))),
    race ? h('small', {}, race) : null,
    h('div', { class: 'res-daily-acts' }, back, copy),
  );
}
