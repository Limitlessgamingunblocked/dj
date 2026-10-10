import { h } from './dom';

export interface ModalHandle {
  close(): void;
  body: HTMLElement;
}

/** close any open pop-up menu */
export function closeMenus(): void {
  for (const m of document.querySelectorAll<HTMLElement & { close?: () => void }>('.context-menu')) (m.close ?? (() => m.remove()))();
}

export function openModal(title: string, content: HTMLElement | ((m: ModalHandle) => HTMLElement), opts: { wide?: boolean } = {}): ModalHandle {
  closeMenus();
  const body = h('div', { class: 'modal-body' });
  const closeBtn = h('button', { class: 'btn ghost icon modal-x', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1', style: opts.wide ? { width: 'min(1200px, 100%)' } : undefined }, h('div', { class: 'modal-head' }, h('h2', {}, title), closeBtn), body);
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
    // only the top dialog answers Escape (a menu inside it closes first)
    if (e.key === 'Escape' && !document.querySelector('.context-menu') && back === [...document.querySelectorAll('.modal-back')].pop()) {
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
  box.focus({ preventScroll: true });
  return handle;
}

export type MenuItem = { label: string; action: () => void; danger?: boolean; checked?: boolean; hint?: string } | { header: string } | 'sep';

export function contextMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenus();
  const menu = h('div', { class: 'context-menu', role: 'menu' }) as HTMLElement & { close?: () => void };
  const checks = items.some((it) => typeof it === 'object' && 'label' in it && it.checked !== undefined);
  if (checks) menu.classList.add('has-checks');
  for (const it of items) {
    if (it === 'sep') {
      menu.append(h('div', { class: 'sep', role: 'separator' }));
      continue;
    }
    if ('header' in it) {
      menu.append(h('div', { class: 'cm-head', role: 'presentation' }, it.header));
      continue;
    }
    const role = it.checked === undefined ? 'menuitem' : 'menuitemcheckbox';
    const b = h(
      'button',
      { type: 'button', role, class: it.danger ? 'danger' : undefined, 'aria-checked': it.checked === undefined ? undefined : String(it.checked) },
      checks ? h('span', { class: 'cm-check', 'aria-hidden': 'true' }, it.checked ? '✓' : '') : null,
      h('span', { class: 'cm-label' }, it.label),
      it.hint ? h('kbd', { class: 'cm-hint' }, it.hint) : null,
    );
    b.addEventListener('click', () => {
      close();
      it.action();
    });
    menu.append(b);
  }
  const buttons = () => [...menu.querySelectorAll<HTMLButtonElement>('button')];
  const off = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    const bs = buttons();
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') bs[(i + 1) % bs.length]?.focus();
    else if (e.key === 'ArrowUp') bs[(i - 1 + bs.length) % bs.length]?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', off, true);
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', close);
  };
  menu.close = close;
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  // a long menu on a short screen starts at the top and scrolls
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', close);
  setTimeout(() => document.addEventListener('pointerdown', off, true));
}
