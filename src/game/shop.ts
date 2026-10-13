/*
 * The shop: somewhere to spend the cash your sets earn. It sells the
 * wardrobe early (anything that fame or a count of sets would unlock, priced
 * by how far off it is) and the next home up. Milestone, rival and secret-room
 * pieces stay earned, so they still mean something.
 *
 * A purchase is a key in `progress.unlocked` (`buy:item:<id>`, `buy:home:1`),
 * so it lives in the career save with everything else and the wardrobe's
 * ownership check (`ownedThing` in look.ts) reads it. Plain data in, plain
 * data out: `buy()` returns the progress patch for the caller to save.
 */
import { HAIR, IRIS_STYLES, ITEMS, OUTFIT_SETS, SLOT_LABEL, type Unlock } from '../character/catalog';
import { boughtKey, ownedThing, unlockText, unlockTier, type WearKind } from '../character/look';
import type { Progress } from '../core/models';
import { HOME_NAMES, HOME_TIERS, homeOf } from './home';

export type ShopKind = WearKind | 'home';

export interface ShopEntry {
  /** `<kind>:<id>`, unique in the shop */
  key: string;
  kind: ShopKind;
  id: string;
  label: string;
  /** a line under the name: the slot, what's in a set, the home's tier */
  sub: string;
  price: number;
  /** how it unlocks without paying (wardrobe only) */
  unlock?: Unlock;
  /** wardrobe pieces that come with it (a set's pieces) */
  pieces?: string[];
}

/** can the shop sell it? Tier and set-count unlocks are for sale; milestones, rivals and rooms are earned. */
export function forSale(u: Unlock): boolean {
  return unlockTier(u) !== null || u.startsWith('set:');
}

const round10 = (x: number) => Math.max(10, Math.round(x / 10) * 10);

/** what a piece costs: the further off it is, the more */
export function priceFor(kind: WearKind, u: Unlock): number {
  const t = unlockTier(u);
  const base = t !== null ? 40 * Math.pow(t, 1.75) : 30 + 12 * Number(u.slice(4));
  const k = kind === 'set' ? 2.5 : kind === 'hair' ? 0.8 : kind === 'iris' ? 0.6 : 1;
  return round10(base * k);
}

/** the next home, early: the studio and the penthouse */
export const HOME_PRICES = [0, 600, 2500] as const;

let catalog: ShopEntry[] | null = null;

/** everything the shop sells */
export function shopCatalog(): ShopEntry[] {
  if (catalog) return catalog;
  const out: ShopEntry[] = [];
  for (const lvl of [1, 2] as const) out.push({ key: `home:${lvl}`, kind: 'home', id: String(lvl), label: HOME_NAMES[lvl], sub: `Move in now (fame tier ${HOME_TIERS[lvl]} moves you for free)`, price: HOME_PRICES[lvl] });
  for (const s of OUTFIT_SETS) if (forSale(s.unlock)) out.push({ key: `set:${s.id}`, kind: 'set', id: s.id, label: s.label, sub: `${s.vibe} · ${Object.keys(s.pieces).length} pieces`, price: priceFor('set', s.unlock), unlock: s.unlock, pieces: Object.values(s.pieces) });
  for (const i of ITEMS) if (forSale(i.unlock)) out.push({ key: `item:${i.id}`, kind: 'item', id: i.id, label: i.label, sub: SLOT_LABEL[i.slot], price: priceFor('item', i.unlock), unlock: i.unlock });
  for (const x of HAIR) if (forSale(x.unlock)) out.push({ key: `hair:${x.id}`, kind: 'hair', id: x.id, label: x.label, sub: 'Hair', price: priceFor('hair', x.unlock), unlock: x.unlock });
  for (const x of IRIS_STYLES) if (forSale(x.unlock)) out.push({ key: `iris:${x.id}`, kind: 'iris', id: x.id, label: x.label, sub: 'Eyes', price: priceFor('iris', x.unlock), unlock: x.unlock });
  catalog = out;
  return out;
}

type Owns = Pick<Progress, 'tier' | 'unlocked' | 'sandbox' | 'setsPlayed'>;

/** already yours (unlocked, bought, or a home you live in or above) */
export function isOwned(e: ShopEntry, p: Owns): boolean {
  if (e.kind === 'home') return homeOf(p) >= Number(e.id);
  return ownedThing(e.kind, { id: e.id, unlock: e.unlock! }, p);
}

/** why it can't be bought now (null: it can) */
export function cantBuy(e: ShopEntry, p: Owns & Pick<Progress, 'cash'>): string | null {
  if (isOwned(e, p)) return 'Owned';
  if (e.kind === 'home' && e.id === '2' && homeOf(p) < 1) return 'Move to the studio first';
  if (p.cash < e.price) return `$${(e.price - p.cash).toLocaleString()} short`;
  return null;
}

/** how it unlocks for free, in words */
export function freeWay(e: ShopEntry): string {
  return e.unlock ? unlockText(e.unlock) : `Reach fame tier ${HOME_TIERS[Number(e.id)]}`;
}

/** buy it: the progress patch to save, or why not */
export function buy(p: Progress, e: ShopEntry): { ok: true; patch: Partial<Progress> } | { ok: false; why: string } {
  const why = cantBuy(e, p);
  if (why) return { ok: false, why };
  const keys = e.kind === 'home' ? [`buy:home:${e.id}`] : [boughtKey(e.kind, e.id), ...(e.pieces ?? []).map((id) => boughtKey('item', id))];
  return {
    ok: true,
    patch: {
      cash: p.cash - e.price,
      unlocked: [...new Set([...p.unlocked, ...keys])],
      stats: { ...p.stats, shop_spent: (p.stats.shop_spent ?? 0) + e.price, shop_buys: (p.stats.shop_buys ?? 0) + 1 },
    },
  };
}
