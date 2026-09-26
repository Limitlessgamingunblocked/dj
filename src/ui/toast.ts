import { h } from './dom';

let host: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 3800): void {
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const t = h('div', { class: `toast ${kind}` }, message);
  host.append(t);
  setTimeout(() => t.remove(), ms);
}
