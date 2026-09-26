/* Tiny DOM helpers. */
type Attrs = Record<string, string | number | boolean | EventListener | Partial<CSSStyleDeclaration> | undefined | null>;
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: (Child | Child[])[]): void {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c);
    else if (c === null || c === undefined || c === false) continue;
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Sets textContent only when it changed (avoids layout churn in per-frame updates). */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function setVar(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

/** Starts a pointer drag; move/up callbacks receive pixel deltas from the start. */
export function drag(e: PointerEvent, move: (dx: number, dy: number, ev: PointerEvent) => void, up?: (ev: PointerEvent) => void): void {
  const target = e.currentTarget as HTMLElement;
  const sx = e.clientX;
  const sy = e.clientY;
  try {
    target.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    move(ev.clientX - sx, ev.clientY - sy, ev);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    up?.(ev);
  };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}
