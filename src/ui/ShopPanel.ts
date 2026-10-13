/*
 * The shop, from Home: spend your cash on the wardrobe early or a bigger
 * home. Each card says what it costs and how it would unlock for free; Buy
 * asks once more ("Confirm $300") before it spends. The rules live in
 * game/shop.ts.
 */
import { ITEMS, OUTFIT_SETS } from '../character/catalog';
import { uiSound } from '../audio/uisound';
import type { Career } from '../game/Career';
import { cantBuy, freeWay, isOwned, shopCatalog, type ShopEntry, type ShopKind } from '../game/shop';
import { announceEarned } from './AchievementsPanel';
import { h } from './dom';
import { openModal, type ModalHandle } from './modal';
import { toast } from './toast';

export interface ShopHooks {
  career: Career;
  /** something was bought (Home rebuilds the room when it's a new home) */
  bought?(e: ShopEntry): void;
}

type Filter = 'all' | ShopKind;
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['home', 'Home'],
  ['set', 'Outfits'],
  ['item', 'Clothes'],
  ['hair', 'Hair'],
  ['iris', 'Eyes'],
];

const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
const SET_BY_ID = new Map(OUTFIT_SETS.map((s) => [s.id, s]));

/** colour chips for a card: an item's three colours, a set's pieces */
function swatches(e: ShopEntry): HTMLElement | null {
  const cols = e.kind === 'item' ? ITEM_BY_ID.get(e.id)?.colors : e.kind === 'set' ? Object.values(SET_BY_ID.get(e.id)?.pieces ?? {}).map((id) => ITEM_BY_ID.get(id)?.colors[0] ?? '#444') : null;
  return cols ? h('span', { class: 'shop-sw', 'aria-hidden': 'true' }, ...cols.slice(0, 5).map((c) => h('i', { style: { background: c } }))) : null;
}

export function openShop(o: ShopHooks): ModalHandle {
  const c = o.career;
  let filter: Filter = 'all';
  let hideOwned = true;
  /** the card waiting for its second click */
  let arming: string | null = null;
  let armTimer = 0;
  const cash = h('b', { class: 'shop-cash' });
  const grid = h('div', { class: 'shop-grid' });
  const chips = h('div', { class: 'shop-filters', role: 'tablist', 'aria-label': 'Category' });
  const ownedBox = h('input', { type: 'checkbox', checked: hideOwned }) as HTMLInputElement;
  ownedBox.addEventListener('change', () => {
    hideOwned = ownedBox.checked;
    render();
  });

  const card = (e: ShopEntry) => {
    const p = c.progress;
    const have = isOwned(e, p);
    const why = cantBuy(e, p);
    const armed = arming === e.key;
    const btn = h('button', { type: 'button', class: `btn${armed ? ' primary' : ''}`, disabled: !!why }, have ? 'Owned' : armed ? `Confirm $${e.price.toLocaleString()}` : why ?? 'Buy');
    btn.addEventListener('click', () => {
      if (arming !== e.key) {
        arming = e.key;
        clearTimeout(armTimer);
        armTimer = window.setTimeout(() => {
          arming = null;
          render();
        }, 4000);
        render();
        return;
      }
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
    });
    return h(
      'article',
      { class: `shop-card k-${e.kind}${have ? ' owned' : ''}` },
      h('div', { class: 'shop-top' }, swatches(e), h('span', { class: 'shop-price' }, have ? '✓' : `$${e.price.toLocaleString()}`)),
      h('b', {}, e.label),
      h('span', { class: 'shop-sub' }, e.sub),
      have ? null : h('span', { class: 'shop-free' }, `Free: ${freeWay(e)}`),
      btn,
    );
  };

  function render(): void {
    const p = c.progress;
    cash.textContent = `$${p.cash.toLocaleString()}`;
    chips.replaceChildren(
      ...FILTERS.map(([id, label]) => {
        const b = h('button', { type: 'button', role: 'tab', class: `shop-chip${filter === id ? ' active' : ''}`, 'aria-selected': String(filter === id) }, label);
        b.addEventListener('click', () => {
          filter = id;
          render();
        });
        return b;
      }),
    );
    const all = shopCatalog().filter((e) => filter === 'all' || e.kind === filter);
    const shown = all.filter((e) => !hideOwned || !isOwned(e, p)).sort((a, b) => Number(isOwned(a, p)) - Number(isOwned(b, p)) || Number(b.kind === 'home') - Number(a.kind === 'home') || a.price - b.price);
    const owned = all.length - all.filter((e) => !isOwned(e, p)).length;
    grid.replaceChildren(...(shown.length ? shown.map(card) : [h('p', { class: 'shop-empty' }, owned ? 'You own everything here.' : 'Nothing for sale here.')]));
  }

  render();
  return openModal(
    'Shop',
    h(
      'div',
      { class: 'shop' },
      h('div', { class: 'shop-head' }, h('span', {}, 'Your cash ', cash), h('label', { class: 'shop-own' }, ownedBox, 'Hide what you own')),
      h('p', { class: 'note' }, 'Buy wardrobe pieces before your fame unlocks them, or move to a bigger home early. Milestone, rival and secret-room pieces can only be earned.'),
      chips,
      grid,
    ),
    { wide: true },
  );
}
