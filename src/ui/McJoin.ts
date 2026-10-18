/*
 * Joining a friend's set as their MC: type the room code they sent (or open
 * their ?mc= link), your name, and you're on the mic. You hear their mix,
 * your voice goes into it, and the card shows the words, the beat and your
 * call pads.
 */
import { joinAsMc } from '../app/hypeman/link';
import { JoinError, JOIN_FAILURE_TEXT, normalizeRoomCode } from '../net';
import { loadSetting, saveSetting } from '../core/settings';
import { h } from './dom';
import { McCard } from './McCard';
import { openModal } from './modal';

export function openMcJoin(code0: string | null = null): void {
  const code = h('input', { type: 'text', maxlength: 8, placeholder: 'K7QMP', value: code0 ?? '', class: 'mono', autocomplete: 'off', 'aria-label': 'Room code' }) as HTMLInputElement;
  const name = h('input', { type: 'text', maxlength: 24, placeholder: 'MC name', value: loadSetting<string>('mcName', ''), 'aria-label': 'Your MC name' }) as HTMLInputElement;
  const msg = h('p', { class: 'note' }, 'Headphones on: you’ll hear the DJ’s mix, and the room hears you.');
  const go = h('button', { type: 'button', class: 'btn primary' }, 'Get on the mic') as HTMLButtonElement;
  const form = h('div', { class: 'mc-join' }, h('label', {}, 'Room code', code), h('label', {}, 'Your name', name), msg, h('div', { class: 'gs-actions' }, go));
  const m = openModal('Join as the MC', form);
  let session: { leave(): void } | null = null;
  const close = m.close;
  m.close = () => {
    session?.leave();
    close();
  };
  go.addEventListener('click', async () => {
    const c = normalizeRoomCode(code.value);
    if (!c) {
      msg.textContent = 'Room codes are five letters and numbers.';
      return;
    }
    const who = name.value.trim() || 'MC';
    saveSetting('mcName', who);
    go.disabled = true;
    msg.textContent = 'Connecting to the booth…';
    const card = new McCard();
    card.el.classList.add('mc-page');
    card.setWho(`You, on the mic`);
    try {
      session = await joinAsMc(c, who, card);
    } catch (e) {
      go.disabled = false;
      msg.textContent = e instanceof JoinError ? JOIN_FAILURE_TEXT[e.reason] : 'The microphone was blocked. Allow it in the browser’s site settings and try again.';
      return;
    }
    form.replaceWith(h('div', { class: 'mc-join' }, card.el, h('div', { class: 'gs-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Leave the mic'))));
  });
}
