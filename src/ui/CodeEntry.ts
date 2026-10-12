/*
 * "Enter a code" (⋯ menu): a box for the codes in game/codes.ts. A code that
 * works closes the box with an unlock chime and says what it did; one that
 * doesn't shakes the box and says so.
 */
import { uiSound } from '../audio/uisound';
import { h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

export interface CodeEntryHooks {
  /** apply a code: what it did, or null if it isn't one */
  redeem(code: string): string | null;
}

export function openCodeEntry(hooks: CodeEntryHooks): void {
  const input = h('input', { class: 'search code-input', type: 'text', maxlength: 24, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'Type a code', 'aria-label': 'Code' }) as HTMLInputElement;
  const go = h('button', { class: 'btn primary', type: 'submit' }, 'Unlock');
  const msg = h('p', { class: 'note code-msg', role: 'status', 'aria-live': 'polite' });
  const form = h('form', { class: 'code-entry' }, h('div', { class: 'toggle-row' }, input, go), msg) as HTMLFormElement;
  const modal = openModal('Enter a code', form);
  input.addEventListener('input', () => (msg.textContent = ''));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    const done = hooks.redeem(code);
    if (done) {
      modal.close();
      uiSound('unlock');
      toast(done);
      return;
    }
    msg.textContent = 'That code doesn’t do anything.';
    form.classList.remove('wrong');
    void form.offsetWidth;
    form.classList.add('wrong');
    uiSound('error');
    input.select();
  });
  setTimeout(() => input.focus(), 30);
}
