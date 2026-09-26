import { TOOLS, type ToolId } from '../core/medical';

const NS = 'http://www.w3.org/2000/svg';

const ICONS: Record<ToolId, string> = {
  // Simple line icons drawn in a 24x24 box.
  epi: 'M5 19 L15 9 M13 7 L17 11 M15 5 L19 9 M4 20 L6 18',
  inhaler: 'M8 4 H14 V11 H18 V17 H8 Z M11 17 V20',
  aed: 'M13 3 L7 13 H12 L10 21 L17 10 H12 Z',
  trauma: 'M4 12 H20 M8 8 V16 M16 8 V16',
  glucose: 'M9 3 H15 V8 L17 12 V20 H7 V12 L9 8 Z',
  oxygen: 'M6 10 Q12 3 18 10 L16 17 H8 Z M12 17 V21',
};

export interface Wheel {
  el: SVGSVGElement;
  set(selected: ToolId, locked: ReadonlySet<ToolId>): void;
}

/** Radial equipment selector. */
export function createWheel(onPick: (t: ToolId) => void): Wheel {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-110 -110 220 220');
  svg.classList.add('wheel');
  const segs: { id: ToolId; path: SVGPathElement; g: SVGGElement }[] = [];
  const n = TOOLS.length;
  const r0 = 38;
  const r1 = 104;
  let locked: ReadonlySet<ToolId> = new Set();
  TOOLS.forEach((t, k) => {
    const a0 = ((k - 0.5) / n) * Math.PI * 2 - Math.PI / 2 + 0.03;
    const a1 = ((k + 0.5) / n) * Math.PI * 2 - Math.PI / 2 - 0.03;
    const p = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
    const g = document.createElementNS(NS, 'g');
    g.classList.add('seg');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', `M ${p(r0, a0)} L ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`);
    g.appendChild(path);
    const am = (a0 + a1) / 2;
    const cx = Math.cos(am) * 72;
    const cy = Math.sin(am) * 72;
    const icon = document.createElementNS(NS, 'path');
    icon.setAttribute('d', ICONS[t.id]);
    icon.setAttribute('transform', `translate(${cx - 12} ${cy - 20})`);
    icon.classList.add('icon');
    g.appendChild(icon);
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', cx.toFixed(1));
    label.setAttribute('y', (cy + 17).toFixed(1));
    label.textContent = `${t.key} ${t.short}`;
    g.appendChild(label);
    g.addEventListener('click', () => {
      if (!locked.has(t.id)) onPick(t.id);
    });
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${t.name} — ${t.hint}`;
    g.appendChild(title);
    svg.appendChild(g);
    segs.push({ id: t.id, path, g });
  });
  const hub = document.createElementNS(NS, 'text');
  hub.setAttribute('y', '5');
  hub.classList.add('hub');
  svg.appendChild(hub);
  return {
    el: svg,
    set(selected, lk) {
      locked = lk;
      for (const s of segs) {
        s.g.classList.toggle('on', s.id === selected);
        s.g.classList.toggle('locked', lk.has(s.id));
      }
      hub.textContent = TOOLS.find((t) => t.id === selected)?.short ?? '';
    },
  };
}
