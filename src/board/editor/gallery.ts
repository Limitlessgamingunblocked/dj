/*
 * The boards window (Section 13.12): start from a template or a random board,
 * your saved boards (rate them, favourite them, remix them), the showcase
 * boards that come with the game with this week's featured one, and sharing:
 * a share code to copy and paste, or a board file to save and open.
 */
import type { BoardEntry, Progress } from '../../core/models';
import { clear, h } from '../../ui/dom';
import { openModal, type ModalHandle } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { emptyBoard, type BoardComponent, type BoardFile } from '../format';
import { isShowcase, SHOWCASE, type BoardLibrary } from '../library';
import { fromTemplate, randomBoard, TEMPLATES } from '../templates';

export interface GalleryDeps {
  library: BoardLibrary;
  current: BoardFile;
  progress(): Progress;
  /** open a board in the editor (false if you said no) */
  open(doc: BoardFile): boolean;
  /** replace what's in the editor with a new start (undoable) */
  startFrom(doc: BoardFile): void;
  exportFile(): void;
  saveAsNew(name: string): Promise<void>;
}

const schematics = new Map<string, string>();

/** a top view drawn from the parts' positions, for boards with no picture yet */
export function schematic(doc: BoardFile, key = doc.id): string {
  const hit = schematics.get(key);
  if (hit) return hit;
  const W = 320;
  const H = 180;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#11151c');
  grad.addColorStop(1, '#07090d');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const items: { x: number; z: number; w: number; d: number; round: boolean; c: string; a: string }[] = [];
  const size = (cp: BoardComponent) => {
    const p = cp.props as Record<string, unknown>;
    const n = (k: string, fb: number) => (typeof p[k] === 'number' ? (p[k] as number) : fb);
    if (cp.type === 'jog' || cp.type === 'turntable') return { w: n('size', 0.07) * 2, d: n('size', 0.07) * 2, round: true };
    if (cp.type === 'mixer') return { w: n('channels', 2) * 0.034 + 0.02, d: 0.26, round: false };
    if (cp.type === 'knob' || cp.type === 'button') return { w: n('size', 0.01) * 2, d: n('size', 0.01) * 2, round: cp.type === 'knob' };
    return { w: n('w', n('length', n('size', 0.03) * 2)), d: n('d', n('size', 0.03) * 2), round: cp.type === 'disco_ball' || cp.type === 'globe' };
  };
  const walk = (list: BoardComponent[], ox: number, oz: number) => {
    for (const cp of list) {
      const s = size(cp);
      items.push({ x: ox + cp.pos[0], z: oz + cp.pos[2], ...s, c: cp.props.colors[0], a: cp.props.colors[2] });
      walk(cp.children, ox + cp.pos[0], oz + cp.pos[2]);
    }
  };
  walk(doc.components, 0, 0);
  if (items.length) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const it of items) {
      x0 = Math.min(x0, it.x - it.w / 2);
      x1 = Math.max(x1, it.x + it.w / 2);
      z0 = Math.min(z0, it.z - it.d / 2);
      z1 = Math.max(z1, it.z + it.d / 2);
    }
    const k = Math.min((W - 24) / Math.max(0.05, x1 - x0), (H - 24) / Math.max(0.05, z1 - z0));
    const X = (x: number) => W / 2 + (x - (x0 + x1) / 2) * k;
    const Z = (z: number) => H / 2 + (z - (z0 + z1) / 2) * k;
    // big things first, so the small ones sit on top
    items.sort((a, b) => b.w * b.d - a.w * a.d);
    for (const it of items) {
      g.fillStyle = it.c;
      g.strokeStyle = it.a;
      g.lineWidth = 1;
      g.beginPath();
      if (it.round) g.arc(X(it.x), Z(it.z), Math.max(1.5, (it.w * k) / 2), 0, Math.PI * 2);
      else g.roundRect(X(it.x - it.w / 2), Z(it.z - it.d / 2), Math.max(2, it.w * k), Math.max(2, it.d * k), 3);
      g.fill();
      g.stroke();
    }
  } else {
    g.fillStyle = '#76829a';
    g.font = '600 16px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText('Empty bench', W / 2, H / 2);
  }
  const url = c.toDataURL('image/png');
  schematics.set(key, url);
  return url;
}

function stars(cur: number, on: (n: number) => void, label: string): HTMLElement {
  const box = h('span', { class: 'bb-stars', role: 'radiogroup', 'aria-label': `Your rating for ${label}` });
  for (let i = 1; i <= 5; i++) {
    const b = h('button', { class: `bb-s${i <= cur ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(i === cur), 'aria-label': `${i} star${i === 1 ? '' : 's'}` }, i <= cur ? '★' : '☆');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      on(i === cur ? 0 : i);
    });
    box.append(b);
  }
  return box;
}

export function openGallery(o: GalleryDeps): ModalHandle {
  const lib = o.library;
  const urls: string[] = [];
  const body = h('div', { class: 'bb-gallery' });
  let modal: ModalHandle;

  const img = (alt: string, src: string) => h('img', { class: 'bb-thumb', alt, src, width: 320, height: 180, loading: 'lazy' });
  const thumbFor = (id: string, fallback: () => string, alt: string) => {
    const el = img(alt, fallback());
    void lib.thumb(id).then((b) => {
      if (!b) return;
      const u = URL.createObjectURL(b);
      urls.push(u);
      (el as HTMLImageElement).src = u;
    });
    return el;
  };

  const openDoc = async (id: string) => {
    const d = await lib.load(id);
    if (!d) return toast('That board couldn’t be opened.', 'error');
    if (o.open(d)) modal.close();
  };
  const remix = async (id: string) => {
    const d = await lib.remix(id);
    if (!d) return toast('That board couldn’t be remixed.', 'error');
    toast(`Remixed into “${d.name}”.`);
    if (o.open(d)) modal.close();
  };

  const render = () => {
    clear(body);
    // this week's board
    const botw = lib.boardOfTheWeek();
    const sc = SHOWCASE.find((s) => s.id === botw.id);
    const botwThumb = sc ? img(botw.name, schematic(fromTemplate(sc.template, sc.id, sc.name))) : thumbFor(botw.id, () => '', botw.name);
    body.append(
      h(
        'section',
        { class: 'bb-botw' },
        botwThumb,
        h(
          'div',
          {},
          h('span', { class: 'bb-kicker' }, 'Board of the Week'),
          h('h3', {}, botw.name),
          h('p', { class: 'bb-hint' }, `by ${botw.by === 'you' ? 'you' : `@${botw.by}`}${sc ? ` · ${sc.blurb}` : ''}`),
          h('div', { class: 'bb-flags' }, h('button', { class: 'btn primary', type: 'button', onclick: () => void remix(botw.id) }, 'Remix it'), botw.by === 'you' ? h('button', { class: 'btn', type: 'button', onclick: () => void openDoc(botw.id) }, 'Open') : null),
        ),
      ),
    );

    // start something new
    const starts = h('div', { class: 'bb-cards' });
    const startCard = (label: string, blurb: string, make: () => BoardFile, thumb: string) => {
      const b = h('button', { class: 'bb-card', type: 'button' }, img(label, thumb), h('b', {}, label), h('small', {}, blurb));
      b.addEventListener('click', () => {
        const d = make();
        o.startFrom(d);
        modal.close();
      });
      return b;
    };
    starts.append(startCard('Empty bench', 'Start from nothing.', () => emptyBoard(lib.newId()), schematic(emptyBoard('empty'), 'empty')));
    for (const t of TEMPLATES) starts.append(startCard(t.name, t.blurb, () => fromTemplate(t.id, lib.newId()), schematic(fromTemplate(t.id, `tpl-${t.id}`), `tpl-${t.id}`)));
    const rnd = h('button', { class: 'bb-card bb-random', type: 'button' }, h('span', { class: 'bb-dice', 'aria-hidden': 'true' }, '🎲'), h('b', {}, 'Randomize'), h('small', {}, 'Something completely wild.'));
    rnd.addEventListener('click', () => {
      o.startFrom(randomBoard(lib.newId()));
      modal.close();
    });
    starts.append(rnd);
    body.append(h('section', {}, h('h3', {}, 'Start something new'), starts));

    // yours
    const mine = h('div', { class: 'bb-cards' });
    const sorted = [...lib.items].sort((a, b) => Number(b.favorite) - Number(a.favorite) || Date.parse(b.updated) - Date.parse(a.updated));
    for (const e of sorted) mine.append(myCard(e));
    body.append(h('section', {}, h('h3', {}, `My boards${lib.items.length ? ` (${lib.items.length})` : ''}`), lib.items.length ? mine : h('p', { class: 'bb-empty' }, 'Nothing saved yet. Press Save in the builder.')));

    // the showcase
    const show = h('div', { class: 'bb-cards' });
    for (const s of SHOWCASE) {
      const card = h(
        'div',
        { class: 'bb-card' },
        img(s.name, schematic(fromTemplate(s.template, s.id, s.name))),
        h('b', {}, s.name),
        h('small', {}, `@${s.by} · ${s.blurb}`),
        stars(lib.ratingOf(s.id), (n) => (lib.rate(s.id, n), render()), s.name),
        h('div', { class: 'bb-flags' }, h('button', { class: 'btn', type: 'button', onclick: () => void remix(s.id) }, 'Remix')),
      );
      show.append(card);
    }
    body.append(h('section', {}, h('h3', {}, 'Showcase'), h('p', { class: 'bb-hint' }, 'Boards that come with the game. Remix one to make it yours.'), show));

    body.append(shareSection());
  };

  const myCard = (e: BoardEntry) => {
    const fav = h('button', { class: `bb-star${e.favorite ? ' on' : ''}`, type: 'button', title: e.favorite ? 'Unfavourite' : 'Favourite', 'aria-label': `${e.favorite ? 'Unfavourite' : 'Favourite'} ${e.name}`, 'aria-pressed': String(e.favorite) }, e.favorite ? '♥' : '♡');
    fav.addEventListener('click', () => (lib.toggleFavorite(e.id), render()));
    const del = h('button', { class: 'btn ghost', type: 'button', 'aria-label': `Delete ${e.name}` }, 'Delete');
    del.addEventListener('click', async () => {
      if (!confirm(`Delete “${e.name}”? This can’t be undone.`)) return;
      await lib.remove(e.id);
      render();
    });
    const code = h('button', { class: 'btn ghost', type: 'button' }, 'Code');
    code.addEventListener('click', async () => {
      const d = await lib.load(e.id);
      if (d) showCode(await lib.code(d), d.name);
    });
    const origin = e.remixOf ? ` · remix of ${isShowcase(e.remixOf) ? SHOWCASE.find((s) => s.id === e.remixOf)?.name ?? 'a board' : lib.get(e.remixOf)?.name ?? 'a board'}` : e.source === 'code' ? ' · from a code' : e.source === 'file' ? ' · from a file' : '';
    return h(
      'div',
      { class: `bb-card${e.id === o.current.id ? ' current' : ''}` },
      thumbFor(e.id, () => schematic(emptyBoard(e.id, e.name), `blank-${e.id}`), e.name),
      h('div', { class: 'bb-card-top' }, h('b', {}, e.name), fav),
      h('small', {}, `${e.parts} parts · ${new Date(e.updated).toLocaleDateString('en-GB')}${e.plays ? ` · ${e.plays} gig${e.plays === 1 ? '' : 's'}` : ''}${origin}`),
      stars(e.rating, (n) => (lib.rate(e.id, n), render()), e.name),
      h('div', { class: 'bb-flags' }, h('button', { class: 'btn primary', type: 'button', onclick: () => void openDoc(e.id) }, e.id === o.current.id ? 'Editing' : 'Open'), h('button', { class: 'btn', type: 'button', onclick: () => void remix(e.id) }, 'Remix'), code, del),
    );
  };

  const showCode = (code: string, name: string) => {
    const ta = h('textarea', { class: 'bb-code', readonly: true, rows: 5, 'aria-label': 'Share code' }, code) as HTMLTextAreaElement;
    const copy = h('button', { class: 'btn primary', type: 'button' }, 'Copy');
    copy.addEventListener('click', () =>
      navigator.clipboard?.writeText(code).then(
        () => toast('Share code copied.'),
        () => {
          ta.select();
          toast('Copying isn’t allowed here: the code is selected, press Ctrl/⌘+C.', 'error');
        },
      ),
    );
    openModal(`Share “${name}”`, h('div', { class: 'bb-dialog' }, h('p', { class: 'bb-hint' }, `Anyone can paste this into Boards → Import to get a copy of the board (${code.length.toLocaleString('en-GB')} characters).`), ta, copy));
    requestAnimationFrame(() => ta.select());
  };

  const shareSection = () => {
    const paste = h('textarea', { class: 'bb-code', rows: 3, placeholder: 'Paste a share code (it starts DH1.)', 'aria-label': 'Paste a share code' }) as HTMLTextAreaElement;
    const imp = h('button', { class: 'btn primary', type: 'button' }, 'Import code');
    imp.addEventListener('click', async () => {
      const d = await lib.importCode(paste.value.trim());
      if (!d) return toast('That isn’t a board share code (or it got cut short).', 'error');
      toast(`Imported “${d.name}”.`);
      if (o.open(d)) modal.close();
    });
    const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Open a board file' }) as HTMLInputElement;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const d = await lib.importFile(await f.text());
      if (!d) return toast('That file isn’t a Deckhouse board.', 'error');
      toast(`Opened “${d.name}”.`);
      if (o.open(d)) modal.close();
    });
    const code = h('button', { class: 'btn', type: 'button' }, 'Share code for this board');
    code.addEventListener('click', async () => showCode(await lib.code(o.current), o.current.name));
    const asNew = h('button', { class: 'btn', type: 'button' }, 'Save as a new board…');
    asNew.addEventListener('click', async () => {
      const name = prompt('Name for the new board', `${o.current.name} (copy)`);
      if (!name) return;
      await o.saveAsNew(name);
      modal.close();
    });
    return h(
      'section',
      {},
      h('h3', {}, 'Share and import'),
      h('div', { class: 'bb-flags' }, code, h('button', { class: 'btn', type: 'button', onclick: () => o.exportFile() }, 'Save board file'), asNew),
      h('div', { class: 'bb-import' }, paste, h('div', { class: 'bb-flags' }, imp, h('label', { class: 'btn ghost bb-file' }, 'Open a board file…', file))),
      // TODO: an online gallery (browse and rate other people's boards) needs a server
      h('p', { class: 'bb-hint' }, 'Boards travel as share codes and files: send one to a friend and they can play on it, or remix it.'),
    );
  };

  render();
  modal = openModal('Boards', body, { wide: true });
  const close = modal.close;
  modal.close = () => {
    close();
    for (const u of urls) URL.revokeObjectURL(u);
  };
  return modal;
}
