/*
 * The way into a silent disco showdown: open a room for a friend (you're
 * blue, they're red, anyone else who joins watches and picks a channel),
 * join a friend's with their code, or practise against one of the rivals.
 */
import type { SilentDiscoMode } from '../app/silentDisco';
import { LENGTHS } from '../game/silentDisco';
import { RIVALS, type RivalId } from '../game/rivals';
import { h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';
import './styles/disco.css';

/** how good each rival is to practise against */
const SKILL: Record<RivalId, number> = { marlowe: 0.65, kiki_volt: 0.55, double_dutch: 0.45, nox: 0.75 };

export function openSilentDisco(mode: SilentDiscoMode): void {
  const length = h('select', { 'aria-label': 'How long' }, ...LENGTHS.map((m) => h('option', { value: String(m), selected: m === 10 }, `${m} minutes`))) as HTMLSelectElement;
  const minutes = () => Number(length.value) || 10;
  const hostBtn = h('button', { type: 'button', class: 'btn primary' }, 'Open a room');
  const code = h('input', { type: 'text', class: 'sd-code-in mono', maxlength: 7, placeholder: 'CODE', 'aria-label': 'Room code', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const joinDj = h('button', { type: 'button', class: 'btn' }, 'Join as the other DJ');
  const joinWatch = h('button', { type: 'button', class: 'btn' }, 'Join to watch');
  const rival = h('select', { 'aria-label': 'Rival' }, ...(Object.keys(RIVALS) as RivalId[]).map((id) => h('option', { value: id }, RIVALS[id].name))) as HTMLSelectElement;
  const practise = h('button', { type: 'button', class: 'btn' }, 'Practise');
  const busy = (on: boolean) => {
    for (const b of [hostBtn, joinDj, joinWatch, practise]) b.disabled = on;
  };

  const m = openModal(
    'Silent disco showdown',
    h(
      'div',
      { class: 'sd-panel' },
      h('p', {}, 'You and a friend both play at once, each on your own headphone channel. Everyone in the room is on blue or red, their headphones glowing the colour, and a better mix pulls people over to yours. Friends who join to watch can flip channels themselves. Whoever holds most of the room when the time’s up wins.'),
      h('div', { class: 'sd-line' }, h('span', {}, 'Showdown length'), length),
      h('h3', {}, 'Play a friend'),
      h('p', { class: 'note' }, 'Open a room and send your friend the code. You play blue, they play red.'),
      h('div', { class: 'sd-line' }, hostBtn),
      h('h3', {}, 'Join a friend'),
      h('div', { class: 'sd-line' }, code, joinDj, joinWatch),
      h('h3', {}, 'Practise'),
      h('p', { class: 'note' }, 'A rival plays the red channel. Nobody needs to join.'),
      h('div', { class: 'sd-line' }, rival, practise),
    ),
  );

  hostBtn.addEventListener('click', async () => {
    busy(true);
    try {
      const c = await mode.hostOnline(minutes());
      m.close();
      toast(`Room ${c} is open. Send your friend the code.`);
    } catch {
      toast('Couldn’t open a room. Check your internet connection.', 'error');
    } finally {
      busy(false);
    }
  });
  const join = async (asDj: boolean) => {
    if (!code.value.trim()) {
      code.focus();
      return;
    }
    busy(true);
    try {
      await mode.join(code.value, asDj);
      m.close();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t join that room.', 'error');
    } finally {
      busy(false);
    }
  };
  joinDj.addEventListener('click', () => void join(true));
  joinWatch.addEventListener('click', () => void join(false));
  code.addEventListener('keydown', (e) => e.key === 'Enter' && void join(true));
  practise.addEventListener('click', () => {
    const id = rival.value as RivalId;
    mode.practice(minutes(), RIVALS[id].name, SKILL[id]);
    m.close();
  });
}
