import { h } from './dom';
import { uiSound } from '../audio/uisound';

let host: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 3800): void {
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  // only errors make a sound: notices come mid-mix too, and a chime there would be in the way
  if (kind === 'error') uiSound('error');
  const t = h('div', { class: `toast ${kind}` }, message);
  host.append(t);
  setTimeout(() => t.remove(), ms);
}
