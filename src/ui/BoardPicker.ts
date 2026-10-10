/* Board gallery: schematic top views generated from each preset's real layout. */
import { BoardBuild } from '../three/builder';
import { BOARDS, type BoardDef } from '../three/boards';
import { ButtonPart, FaderPart, JogPart, KnobPart, PadPart, PlatterPart, ScreenPart, TonearmPart, VuPart } from '../three/parts';
import { h, clear } from './dom';
import { openModal } from './modal';

const thumbCache = new Map<string, string>();

export function boardThumbnail(def: BoardDef, finishId: string): string {
  const key = `${def.id}|${finishId}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const f = def.finishes.find((x) => x.id === finishId) ?? def.finishes[0];
  const b = new BoardBuild(f);
  def.build(b);
  const W = 480;
  const H = 270;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0b0f15');
  grad.addColorStop(1, '#05070a');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const u of b.units) {
    minX = Math.min(minX, u.group.position.x - u.w / 2);
    maxX = Math.max(maxX, u.group.position.x + u.w / 2);
    minZ = Math.min(minZ, u.group.position.z - u.d / 2);
    maxZ = Math.max(maxZ, u.group.position.z + u.d / 2);
  }
  const s = Math.min((W - 30) / (maxX - minX), (H - 30) / (maxZ - minZ));
  const ox = W / 2 - ((minX + maxX) / 2) * s;
  const oz = H / 2 - ((minZ + maxZ) / 2) * s;
  const X = (x: number) => ox + x * s;
  const Z = (z: number) => oz + z * s;
  for (const u of b.units) {
    const ux = u.group.position.x;
    const uz = u.group.position.z;
    g.fillStyle = f.face.base;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(X(ux - u.w / 2), Z(uz - u.d / 2), u.w * s, u.d * s, 6);
    g.fill();
    g.stroke();
  }
  const accent = f.accent;
  for (const p of b.parts) {
    const unit = p.object.parent!;
    const x = X(unit.position.x + p.object.position.x);
    const z = Z(unit.position.z + p.object.position.z);
    if (p instanceof JogPart) {
      const r = p.radius * s;
      g.fillStyle = '#2a2e35';
      g.beginPath();
      g.arc(x, z, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, z, r * 0.8, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#12151a';
      g.beginPath();
      g.arc(x, z, r * 0.76, 0, Math.PI * 2);
      g.fill();
    } else if (p instanceof PlatterPart) {
      g.fillStyle = '#9aa0a8';
      g.beginPath();
      g.arc(x, z, 0.166 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0a0a0a';
      g.beginPath();
      g.arc(x, z, 0.152 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(x, z, 0.05 * s, 0, Math.PI * 2);
      g.fill();
    } else if (p instanceof TonearmPart) {
      g.strokeStyle = '#d9dde3';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, z);
      g.lineTo(x - 0.05 * s, z + 0.2 * s);
      g.stroke();
    } else if (p instanceof KnobPart) {
      g.fillStyle = p.encoder ? '#3a404a' : '#c9ced6';
      g.beginPath();
      g.arc(x, z, Math.max(1.5, p.radius * s), 0, Math.PI * 2);
      g.fill();
    } else if (p instanceof FaderPart) {
      g.fillStyle = '#e5e8ec';
      g.fillRect(x - 3, z - 2, 6, 4);
    } else if (p instanceof PadPart) {
      g.fillStyle = accent;
      g.globalAlpha = 0.75;
      g.fillRect(x - 3.5, z - 3.5, 7, 7);
      g.globalAlpha = 1;
    } else if (p instanceof ButtonPart) {
      g.fillStyle = '#5b6372';
      g.fillRect(x - 2, z - 1.5, 4, 3);
    } else if (p instanceof ScreenPart) {
      g.fillStyle = '#1f6fb0';
      g.fillRect(x - (p.w * s) / 2, z - (p.d * s) / 2, p.w * s, p.d * s);
    } else if (p instanceof VuPart) {
      g.fillStyle = '#3ddc97';
      g.fillRect(x - 1, z - 6, 2, 12);
    }
  }
  const url = c.toDataURL('image/png');
  thumbCache.set(key, url);
  return url;
}

export function openBoardPicker(current: { board: string; finish: string }, choose: (board: string, finish: string) => void): void {
  const body = h('div', { style: { display: 'grid', gap: '12px' } });
  const render = () => {
    clear(body);
    const grid = h('div', { class: 'board-cards' });
    for (const def of BOARDS) {
      const finishId = def.id === current.board ? current.finish : def.finishes[0].id;
      const img = h('img', { class: 'thumb', alt: `${def.name} top view`, src: boardThumbnail(def, finishId), width: 480, height: 270 });
      const swatches = h('div', { class: 'finishes' });
      for (const f of def.finishes) {
        const sw = h('button', { class: `swatch${def.id === current.board && f.id === current.finish ? ' active' : ''}`, title: f.name, 'aria-label': `${def.name} in ${f.name}`, style: { background: f.swatch } });
        sw.addEventListener('click', (e) => {
          e.stopPropagation();
          current = { board: def.id, finish: f.id };
          choose(def.id, f.id);
          render();
        });
        swatches.append(sw);
      }
      const card = h(
        'button',
        { class: `board-card${def.id === current.board ? ' active' : ''}`, type: 'button' },
        img,
        h('div', { class: 'info' }, h('span', { class: 'cls' }, `${def.category} · ${def.decks} decks`), h('b', {}, def.name), h('p', {}, def.description), swatches),
      );
      card.addEventListener('click', () => {
        current = { board: def.id, finish: finishId };
        choose(def.id, finishId);
        render();
      });
      grid.append(card);
    }
    body.append(grid);
  };
  render();
  openModal('Board', body, { wide: true });
}
