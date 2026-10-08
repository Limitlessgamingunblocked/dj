import { h } from './dom';

export interface ModalHandle {
  close(): void;
  body: HTMLElement;
}

export function openModal(title: string, content: HTMLElement | ((m: ModalHandle) => HTMLElement), opts: { wide?: boolean } = {}): ModalHandle {
  const body = h('div');
  const closeBtn = h('button', { class: 'btn ghost', 'aria-label': 'Close' }, 'Close');
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: opts.wide ? { width: 'min(1200px, 100%)' } : undefined }, h('div', { class: 'modal-head' }, h('h2', {}, title), closeBtn), body);
  const back = h('div', { class: 'modal-back' }, box);
  const handle: ModalHandle = {
    body,
    close: () => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      if (!document.querySelector('.modal-back')) document.body.classList.remove('modal-open');
    },
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handle.close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) handle.close();
  });
  closeBtn.addEventListener('click', () => handle.close());
  body.append(typeof content === 'function' ? content(handle) : content);
  document.body.append(back);
  document.body.classList.add('modal-open');
  closeBtn.focus();
  return handle;
}

export type MenuItem = { label: string; action: () => void; danger?: boolean } | { header: string } | 'sep';

export function contextMenu(x: number, y: number, items: MenuItem[]): void {
  document.querySelectorAll('.context-menu').forEach((m) => m.remove());
  const menu = h('div', { class: 'context-menu', role: 'menu' });
  for (const it of items) {
    if (it === 'sep') {
      menu.append(h('div', { class: 'sep' }));
      continue;
    }
    if ('header' in it) {
      menu.append(h('div', { class: 'cm-head', role: 'presentation' }, it.header));
      continue;
    }
    const b = h('button', { role: 'menuitem', style: it.danger ? { color: '#ff8fa3' } : undefined }, it.label);
    b.addEventListener('click', () => {
      menu.remove();
      it.action();
    });
    menu.append(b);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  // a long menu on a short screen starts at the top and scrolls
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  const off = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('pointerdown', off, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', off, true));
}
