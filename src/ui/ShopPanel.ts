/*
 * The shop, from Home: spend your cash on the wardrobe early or a bigger
 * home. A fitting room: the left is a stage with your DJ wearing whatever
 * card is picked (ShopPreview.ts), the right a bar of category icons over a
 * grid of cards, each with a picture of the piece. Picking a card says what
 * it costs and how it would unlock for free; the big button buys it, asking
 * once more ("Confirm $300") before it spends, and once it's yours, wears it.
 * The rules live in game/shop.ts.
 */
import { ITEMS, OUTFIT_SETS } from '../character/catalog';
import { uiSound } from '../audio/uisound';
import type { Career } from '../game/Career';
import type { Look } from '../core/models';
import { focusOf, freeWay, isOwned, shopAction, shopCatalog, tryOn, type ShopEntry, type ShopKind } from '../game/shop';
import { nameService } from '../name/NameService';
import { announceEarned } from './AchievementsPanel';
import { h } from './dom';
import { icon, type IconName } from './icons';
import { openModal, type ModalHandle } from './modal';
import { createShopPreview, type ShopPreview } from './ShopPreview';
import { toast } from './toast';

export interface ShopHooks {
  career: Career;
  /** something was bought (Home rebuilds the room when it's a new home) */
  bought?(e: ShopEntry): void;
  /** you put something on from the shop (Home dresses you in the room) */
  wore?(look: Look): void;
}

type Filter = 'all' | ShopKind;
const FILTERS: [Filter, string, IconName][] = [
  ['all', 'All', 'grid'],
  ['home', 'Home', 'home'],
  ['set', 'Outfits', 'hanger'],
  ['item', 'Clothes', 'shirt'],
  ['hair', 'Hair', 'hair'],
  ['iris', 'Eyes', 'eye'],
];
const KIND_ICON: Record<ShopKind, IconName> = { home: 'home', set: 'hanger', item: 'shirt', hair: 'hair', iris: 'eye' };

const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
const SET_BY_ID = new Map(OUTFIT_SETS.map((s) => [s.id, s]));

/** an entry's colours: an item's three, a set's pieces */
function colours(e: ShopEntry): string[] {
  if (e.kind === 'item') return [...(ITEM_BY_ID.get(e.id)?.colors ?? [])];
  if (e.kind === 'set') return Object.values(SET_BY_ID.get(e.id)?.pieces ?? {}).map((id) => ITEM_BY_ID.get(id)?.colors[0] ?? '#444');
  return [];
}

/** a card's stand-in picture (before its render is ready, or without WebGL): the icon over its colours */
function tile(e: ShopEntry): HTMLElement {
  const cols = colours(e).slice(0, 5);
  return h(
    'span',
    { class: 'shop-tile', 'aria-hidden': 'true', style: cols.length ? `--c1:${cols[0]};--c2:${cols[1] ?? cols[0]}` : undefined },
    h('span', { class: 'shop-disc' }, icon(KIND_ICON[e.kind], 30)),
    cols.length ? h('span', { class: 'shop-sw' }, ...cols.map((c) => h('i', { style: { background: c } }))) : null,
  );
}

const picture = (url: string) => h('img', { src: url, alt: '', draggable: 'false' });

/** a short, stable name for a look (the card pictures are drawn per look) */
function sig(l: Look): string {
  const s = JSON.stringify(l);
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
}

export function openShop(o: ShopHooks): ModalHandle {
  const c = o.career;
  let filter: Filter = 'all';
  let hideOwned = true;
  /** the picked card */
  let selected: string | null = null;
  /** the picked card, waiting for its second press */
  let arming: string | null = null;
  let armTimer = 0;
  let preview: ShopPreview | null = null;

  /* the stage ------------------------------------------------------------------- */
  const cash = h('b', { class: 'shop-cash' });
  const poster = h('div', { class: 'shop-poster', hidden: true });
  const stage = h(
    'section',
    { class: 'shop-stage', 'aria-label': 'Fitting room' },
    poster,
    h('div', { class: 'shop-purse' }, h('span', {}, 'Your cash'), cash),
    h('p', { class: 'shop-note' }, 'Milestone, rival and secret-room pieces can only be earned.'),
  );

  /* the side: tabs, grid, the button ---------------------------------------------- */
  const tabs = h('div', { class: 'shop-tabs', role: 'tablist', 'aria-label': 'Category' });
  const grid = h('div', { class: 'shop-grid', role: 'listbox', 'aria-label': 'For sale' });
  const count = h('span', { class: 'shop-count' });
  const ownedBox = h('input', { type: 'checkbox', checked: hideOwned }) as HTMLInputElement;
  ownedBox.addEventListener('change', () => {
    hideOwned = ownedBox.checked;
    render();
  });
  const infoName = h('b', { class: 'shop-name' });
  const infoSub = h('span', { class: 'shop-sub' });
  const infoFree = h('span', { class: 'shop-free' });
  const goLabel = h('span', {});
  const go = h('button', { type: 'button', class: 'shop-go' }, goLabel, icon('next', 20));
  go.addEventListener('click', () => act());

  const entry = (key: string | null) => (key ? shopCatalog().find((e) => e.key === key) ?? null : null);

  /** the stage: your look with the picked card on (a home: its poster) */
  function dress(): void {
    const e = entry(selected);
    const look = e ? tryOn(c.look, e) : c.look;
    const showPoster = !!e && (e.kind === 'home' || !preview);
    poster.hidden = !showPoster;
    if (showPoster && e) {
      const cols = colours(e);
      poster.replaceChildren(
        h('div', { class: 'shop-poster-in' }, h('span', { class: 'shop-poster-ic' }, icon(KIND_ICON[e.kind], 64)), h('b', {}, e.label), h('span', {}, e.sub), cols.length ? h('span', { class: 'shop-sw big' }, ...cols.map((col) => h('i', { style: { background: col } }))) : null),
      );
    }
    stage.classList.toggle('home', e?.kind === 'home');
    preview?.show(look, e ? focusOf(e) : 'full');
  }

  function pick(key: string): void {
    if (selected === key) return;
    selected = key;
    arming = null;
    clearTimeout(armTimer);
    uiSound('tap');
    dress();
    render();
  }

  /** the big button: buy, confirm, wear */
  function act(): void {
    const e = entry(selected);
    if (!e) return;
    const a = shopAction(e, c.progress, c.look, arming === e.key);
    if (a.act === 'buy') {
      arming = e.key;
      clearTimeout(armTimer);
      armTimer = window.setTimeout(() => {
        arming = null;
        render();
      }, 4000);
      render();
      return;
    }
    if (a.act === 'confirm') {
      arming = null;
      clearTimeout(armTimer);
      const r = c.buy(e);
      if (!r.ok) {
        uiSound('error');
        toast(r.why, 'error');
      } else {
        uiSound('unlock');
        toast(e.kind === 'home' ? `Welcome to ${e.label.toLowerCase()}` : `${e.label} is in your wardrobe`);
        announceEarned(r.earned);
        o.bought?.(e);
      }
      render();
      return;
    }
    if (a.act === 'wear') {
      const next = tryOn(c.look, e);
      if (!next) return;
      c.saveLook(next);
      o.wore?.(next);
      uiSound('tap');
      toast(`Wearing ${e.label}`);
      dress();
      render();
    }
  }

  const card = (e: ShopEntry, lookSig: string) => {
    const p = c.progress;
    const have = isOwned(e, p);
    const sel = selected === e.key;
    const price = have ? 'Owned' : `$${e.price.toLocaleString()}`;
    const pic = h('span', { class: 'shop-thumb' });
    // the picture when it's drawn, in whichever card shows this entry by then
    const url = e.kind === 'home' || !preview ? null : preview.thumb(`${lookSig}|${e.key}`, tryOn(c.look, e)!, focusOf(e), (u) => grid.querySelector(`[data-key="${CSS.escape(e.key)}"] .shop-thumb`)?.replaceChildren(picture(u)));
    pic.append(url ? picture(url) : tile(e));
    const b = h(
      'button',
      { type: 'button', role: 'option', class: `shop-card k-${e.kind}${have ? ' owned' : ''}${sel ? ' sel' : ''}`, 'aria-selected': String(sel), 'aria-label': `${e.label}, ${e.sub}, ${price}`, title: `${e.label} · ${price}`, 'data-key': e.key },
      pic,
      h('span', { class: 'shop-tag' }, have ? icon('check', 12) : null, price),
    );
    b.addEventListener('click', () => pick(e.key));
    return b;
  };

  function render(): void {
    const p = c.progress;
    cash.textContent = `$${p.cash.toLocaleString()}`;
    tabs.replaceChildren(
      ...FILTERS.map(([id, label, ic]) => {
        const on = filter === id;
        const b = h('button', { type: 'button', role: 'tab', class: `shop-tab${on ? ' active' : ''}`, 'aria-selected': String(on), 'aria-label': label, title: label, tabindex: on ? '0' : '-1', 'data-filter': id }, icon(ic, 20));
        b.addEventListener('click', () => {
          if (filter === id) return;
          filter = id;
          uiSound('tap');
          preview?.clearQueue();
          render();
          grid.scrollTop = 0;
        });
        return b;
      }),
    );
    const all = shopCatalog().filter((e) => filter === 'all' || e.kind === filter);
    // the picked card stays while it's picked, even once it's yours (so you can wear it)
    const shown = all.filter((e) => !hideOwned || !isOwned(e, p) || e.key === selected).sort((a, b) => Number(isOwned(a, p)) - Number(isOwned(b, p)) || Number(b.kind === 'home') - Number(a.kind === 'home') || a.price - b.price);
    const owned = all.filter((e) => isOwned(e, p)).length;
    count.textContent = `${all.length - owned} for sale${owned ? ` · ${owned} yours` : ''}`;
    if (!shown.some((e) => e.key === selected)) {
      const was = selected;
      // a piece to try on rather than a home, when there is one
      selected = (shown.find((x) => x.kind !== 'home') ?? shown[0])?.key ?? null;
      arming = null;
      if (selected !== was) dress();
    }
    const lookSig = sig(c.look);
    // the cards are built afresh: keep the keyboard on the one it was on
    const focused = grid.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
    grid.replaceChildren(...(shown.length ? shown.map((e) => card(e, lookSig)) : [h('p', { class: 'shop-empty' }, owned ? 'You own everything here.' : 'Nothing for sale here.')]));
    if (focused) grid.querySelector<HTMLElement>(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });

    // what's picked, and the button
    const e = entry(selected);
    go.hidden = !e;
    if (!e) {
      infoName.textContent = '';
      infoSub.textContent = '';
      infoFree.textContent = '';
      return;
    }
    const a = shopAction(e, p, c.look, arming === e.key);
    const have = isOwned(e, p);
    infoName.textContent = e.label;
    infoSub.textContent = have ? e.sub : `${e.sub} · $${e.price.toLocaleString()}`;
    infoFree.textContent = have ? (e.kind === 'home' ? 'Yours: you live here or somewhere bigger' : 'Yours: in your wardrobe') : `Free: ${freeWay(e)}`;
    goLabel.textContent = a.label;
    go.disabled = !a.act;
    go.className = `shop-go${a.act === 'confirm' ? ' armed' : ''}${a.act === 'wear' ? ' wear' : ''}`;
  }

  preview = createShopPreview({ look: c.look, djName: nameService.text });
  if (preview) stage.prepend(preview.canvas);
  else stage.classList.add('flat');

  // arrow keys move along the tab bar
  tabs.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const i = FILTERS.findIndex(([id]) => id === filter);
    const n = (i + (ev.key === 'ArrowRight' ? 1 : FILTERS.length - 1)) % FILTERS.length;
    filter = FILTERS[n][0];
    preview?.clearQueue();
    render();
    tabs.querySelector<HTMLElement>('.shop-tab.active')?.focus();
    ev.preventDefault();
  });

  render();
  dress();
  const side = h(
    'section',
    { class: 'shop-side' },
    tabs,
    h('div', { class: 'shop-tools' }, count, h('label', { class: 'shop-own' }, ownedBox, 'Hide what you own')),
    grid,
    h('div', { class: 'shop-foot' }, h('div', { class: 'shop-info', 'aria-live': 'polite' }, infoName, infoSub, infoFree), go),
  );
  const m = openModal('Shop', h('div', { class: 'shop' }, stage, side), { wide: true });
  const box = m.body.parentElement;
  box?.classList.add('modal-shop');
  // closing lets go of the preview's renderer (and its avatars) straight away
  const close = m.close;
  m.close = () => {
    clearTimeout(armTimer);
    preview?.dispose();
    preview = null;
    close();
  };
  return m;
}
