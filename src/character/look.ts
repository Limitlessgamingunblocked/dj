/*
 * Working with a Look (src/core/models.ts): the defaults, reading a slider
 * or an option with its default, wearing a signature set, what the player
 * owns, randomising one category or everything, undo / redo, and the
 * dress-code bonus (Section 4.9). Pure: the avatar and the creator build on it.
 */
import type { Look, Progress } from '../core/models';
import {
  EYE_COLORS,
  HAIR,
  IRIS_STYLES,
  ITEM_BY_ID,
  ITEMS,
  NATURAL_HAIR,
  OPTIONS,
  OUTFIT_SETS,
  PIERCINGS,
  SKIN_TONES,
  SLIDERS,
  SLOTS,
  TATTOO_PLACES,
  TATTOOS,
  VENUE_VIBES,
  WILD_HAIR,
  type OptionKey,
  type OutfitSet,
  type Slot,
  type Unlock,
} from './catalog';

export type Category = 'all' | 'body' | 'face' | 'eyes' | 'skin' | 'hair' | 'makeup' | 'outfit' | 'personality';

export function cloneLook(l: Look): Look {
  return structuredClone(l);
}

export function slider(l: Look, id: string): number {
  return l.sliders[id] ?? 0;
}

export function option<K extends OptionKey>(l: Look, key: K): (typeof OPTIONS)[K][number] {
  const v = l.options[key];
  const allowed = OPTIONS[key] as readonly string[];
  return (allowed.includes(v) ? v : allowed[0]) as (typeof OPTIONS)[K][number];
}

/** the 3 zone colours of whatever is in a slot (the look's own, or the item's defaults) */
export function zoneColors(l: Look, slot: Slot): [string, string, string] {
  const item = ITEM_BY_ID.get(l.items[slot] ?? '');
  const d = item?.colors ?? ['#2a2d33', '#1b1d22', '#ff2e88'];
  return [l.colors[`${slot}_1`] ?? d[0], l.colors[`${slot}_2`] ?? d[1], l.colors[`${slot}_3`] ?? d[2]];
}

export function slotMaterial(l: Look, slot: Slot): string {
  return l.options[`${slot}_material`] ?? ITEM_BY_ID.get(l.items[slot] ?? '')?.material ?? 'cotton';
}

export function slotPattern(l: Look, slot: Slot): string {
  return l.options[`${slot}_pattern`] ?? ITEM_BY_ID.get(l.items[slot] ?? '')?.pattern ?? 'solid';
}

/** Put on a signature set: its pieces go on (with their own colours), other slots stay as they are. */
export function wearSet(l: Look, set: OutfitSet): Look {
  const out = cloneLook(l);
  for (const [slot, id] of Object.entries(set.pieces)) {
    out.items[slot] = id;
    for (let z = 1; z <= 3; z++) delete out.colors[`${slot}_${z}`];
    delete out.options[`${slot}_material`];
    delete out.options[`${slot}_pattern`];
  }
  Object.assign(out.options, set.options ?? {});
  return out;
}

/** venues each fame tier opens (Section 9.2) */
const TIER_VENUES: string[][] = [[], ['bedroom', 'basement'], ['rooftop'], ['warehouse'], ['beach'], ['boat'], ['festival'], ['sunrise']];

/** Has the player unlocked this? Sandbox (or the debug menu) owns everything. */
export function owned(unlock: Unlock, p: Pick<Progress, 'tier' | 'unlocked' | 'sandbox'>): boolean {
  if (unlock === 'start' || p.sandbox || p.unlocked.includes(unlock)) return true;
  for (let t = 1; t <= p.tier && t < TIER_VENUES.length; t++) if (TIER_VENUES[t].includes(unlock)) return true;
  return false;
}

const VENUE_UNLOCK: Record<string, string> = {
  basement: 'Basement Club',
  rooftop: 'Rooftop',
  warehouse: 'Warehouse',
  beach: 'Beach Club',
  boat: 'Boat Party',
  festival: 'Festival',
  sunrise: 'Sunrise Closing',
};

/** how something unlocks, in words (shown on locked items) */
export function unlockText(u: Unlock): string {
  if (u === 'start') return 'Starter';
  if (u.startsWith('milestone:')) return `Milestone: ${u.slice(10).replace(/_/g, ' ')}`;
  if (u.startsWith('rival:')) return `Beat ${u.slice(6).replace(/_/g, ' ')} in a B2B`;
  return `Play the ${VENUE_UNLOCK[u] ?? u}`;
}

export function defaultLook(id = 'look_1', name = 'My look'): Look {
  const base: Look = {
    id,
    name,
    sliders: {},
    colors: { skin: SKIN_TONES[8], hair: '#1d140e', hair2: '#6b4528', iris_l: EYE_COLORS[1], iris_r: EYE_COLORS[1], brows: '#1d140e', facial_hair: '#1d140e', eyeshadow: '#7a3cff', liner: '#111111', paint: '#b6ff3b' },
    items: { hair: 'crop' },
    options: { groove: 'shoulder_bounce', drop_move: 'hands_up', phones_wear: 'one_ear', between_habit: 'wave' },
    tattoos: [],
    piercings: [],
  };
  return wearSet(base, OUTFIT_SETS[0]);
}

/* ------------------------------------------------------------------ */
/* randomise                                                            */
/* ------------------------------------------------------------------ */

type Rand = () => number;
const pick = <T>(r: Rand, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];
/** a slider value that clusters near the middle (most people aren't extreme) */
const gauss = (r: Rand, spread: number) => Math.max(-1, Math.min(1, ((r() + r() + r()) / 1.5 - 1) * spread));
const hex = (r: Rand) => `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`;

/** Randomise one category, or the whole character, with only what the player owns. */
export function randomize(l: Look, cat: Category, r: Rand, p: Pick<Progress, 'tier' | 'unlocked' | 'sandbox'>): Look {
  const out = cloneLook(l);
  const doing = (c: Category) => cat === 'all' || cat === c;
  const sl = (group: string, spread: number) => {
    for (const d of SLIDERS) if (d.group === group) out.sliders[d.id] = d.min === 0 ? Math.max(0, gauss(r, 1) * 0.6 + (r() < 0.6 ? 0 : 0.3)) * (r() < 0.5 ? 0 : 1) : gauss(r, spread);
  };
  if (doing('body')) sl('body', 0.7);
  if (doing('face')) {
    sl('face', 0.6);
    out.options.face_shape = pick(r, OPTIONS.face_shape);
    out.options.brows = pick(r, OPTIONS.brows);
    out.options.brow_slit = r() < 0.85 ? 'none' : pick(r, OPTIONS.brow_slit);
    out.options.facial_hair = r() < 0.5 ? 'clean' : pick(r, OPTIONS.facial_hair);
  }
  if (doing('eyes')) {
    sl('eyes', 0.6);
    const iris = pick(r, EYE_COLORS);
    out.colors.iris_l = iris;
    out.colors.iris_r = r() < 0.06 ? pick(r, EYE_COLORS) : iris;
    const fancy = IRIS_STYLES.filter((i) => owned(i.unlock, p));
    out.options.iris_style = r() < 0.85 ? 'natural' : pick(r, fancy).id;
  }
  if (doing('skin')) {
    out.colors.skin = pick(r, SKIN_TONES);
    sl('skin', 0.8);
  }
  if (doing('hair')) {
    const styles = HAIR.filter((h) => owned(h.unlock, p));
    out.items.hair = pick(r, styles).id;
    const wild = r() < 0.2;
    out.colors.hair = wild ? pick(r, WILD_HAIR) : pick(r, NATURAL_HAIR);
    out.colors.hair2 = r() < 0.5 ? pick(r, WILD_HAIR) : pick(r, NATURAL_HAIR);
    out.options.hair_color_mode = r() < 0.7 ? 'solid' : pick(r, OPTIONS.hair_color_mode);
    out.options.hair_finish = pick(r, OPTIONS.hair_finish);
    out.colors.brows = out.colors.hair;
    out.colors.facial_hair = out.colors.hair;
  }
  if (doing('makeup')) {
    out.options.eyeliner = r() < 0.6 ? 'none' : pick(r, OPTIONS.eyeliner);
    out.options.face_paint = r() < 0.7 ? 'none' : pick(r, OPTIONS.face_paint);
    out.colors.eyeshadow = hex(r);
    out.colors.paint = pick(r, WILD_HAIR);
    out.sliders.glitter = r() < 0.7 ? 0 : r();
    out.tattoos = Array.from({ length: r() < 0.5 ? 0 : 1 + Math.floor(r() * 3) }, () => ({ design: pick(r, TATTOOS).id, place: pick(r, TATTOO_PLACES), size: 0.6 + r() * 0.6, rot: (r() - 0.5) * 0.6, color: r() < 0.8 ? '#1a1a1a' : pick(r, WILD_HAIR) }));
    out.piercings = PIERCINGS.filter(() => r() < 0.12);
  }
  if (doing('outfit')) {
    // a set as the base most of the time, then the odd swap; everything owned
    const sets = OUTFIT_SETS.filter((s) => owned(s.unlock, p));
    const base = r() < 0.6 ? wearSet(out, pick(r, sets)) : out;
    for (const slot of SLOTS) {
      const choices = ITEMS.filter((i) => i.slot === slot && owned(i.unlock, p));
      const keepEmpty = slot !== 'top' && slot !== 'bottom' && slot !== 'shoes';
      if (r() < 0.35 || !base.items[slot]) base.items[slot] = keepEmpty && r() < 0.55 ? null : choices.length ? pick(r, choices).id : null;
    }
    out.items = base.items;
    out.colors = { ...out.colors, ...Object.fromEntries(Object.entries(base.colors).filter(([k]) => !k.includes('_'))) };
    for (const slot of SLOTS) for (let z = 1; z <= 3; z++) delete out.colors[`${slot}_${z}`];
    if (r() < 0.3) out.colors.top_1 = hex(r);
    out.options = { ...out.options, ...base.options };
  }
  if (doing('personality')) {
    out.options.groove = pick(r, OPTIONS.groove);
    out.options.drop_move = pick(r, OPTIONS.drop_move);
    out.options.phones_wear = pick(r, OPTIONS.phones_wear);
    out.options.between_habit = pick(r, OPTIONS.between_habit);
  }
  return out;
}

/** Put one category back to the defaults. */
export function resetCategory(l: Look, cat: Exclude<Category, 'all'>): Look {
  const out = cloneLook(l);
  const d = defaultLook(l.id, l.name);
  const group = { body: 'body', face: 'face', eyes: 'eyes', skin: 'skin', hair: 'hair' }[cat as string];
  if (group) for (const s of SLIDERS) if (s.group === group) delete out.sliders[s.id];
  if (cat === 'face') for (const k of ['face_shape', 'brows', 'brow_slit', 'facial_hair']) delete out.options[k];
  if (cat === 'eyes') {
    delete out.options.iris_style;
    out.colors.iris_l = d.colors.iris_l;
    out.colors.iris_r = d.colors.iris_r;
  }
  if (cat === 'skin') out.colors.skin = d.colors.skin;
  if (cat === 'hair') {
    out.items.hair = d.items.hair;
    for (const k of ['hair', 'hair2', 'brows', 'facial_hair']) out.colors[k] = d.colors[k];
    delete out.options.hair_color_mode;
    delete out.options.hair_finish;
  }
  if (cat === 'makeup') {
    for (const k of ['eyeliner', 'face_paint']) delete out.options[k];
    delete out.sliders.glitter;
    out.tattoos = [];
    out.piercings = [];
  }
  if (cat === 'outfit') {
    for (const slot of SLOTS) {
      out.items[slot] = d.items[slot] ?? null;
      for (let z = 1; z <= 3; z++) delete out.colors[`${slot}_${z}`];
      delete out.options[`${slot}_material`];
      delete out.options[`${slot}_pattern`];
    }
  }
  if (cat === 'personality') for (const k of ['groove', 'drop_move', 'phones_wear', 'between_habit']) out.options[k] = d.options[k];
  return out;
}

/* ------------------------------------------------------------------ */
/* undo / redo                                                          */
/* ------------------------------------------------------------------ */

export class LookHistory {
  private past: Look[] = [];
  private future: Look[] = [];
  constructor(
    private current: Look,
    private max = 100,
  ) {}

  get look(): Look {
    return this.current;
  }

  /** a change: the old look goes on the undo stack */
  push(next: Look): Look {
    this.past.push(this.current);
    if (this.past.length > this.max) this.past.shift();
    this.future = [];
    this.current = next;
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): Look {
    const prev = this.past.pop();
    if (prev) {
      this.future.push(this.current);
      this.current = prev;
    }
    return this.current;
  }

  redo(): Look {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.current);
      this.current = next;
    }
    return this.current;
  }
}

/* ------------------------------------------------------------------ */
/* the dress code (Section 4.9)                                         */
/* ------------------------------------------------------------------ */

/**
 * Matching a venue's vibe gives the crowd a small lift at the start of a set:
 * 0.02 per worn piece that fits, up to 0.1.
 * TODO: computed and shown in the wardrobe; Stage 3's vibe meter applies it when a set starts.
 */
export function dressCodeBonus(l: Look, venue: string): { bonus: number; matched: string[] } {
  const vibes = VENUE_VIBES[venue] ?? [];
  const matched: string[] = [];
  for (const slot of SLOTS) {
    const item = ITEM_BY_ID.get(l.items[slot] ?? '');
    if (item && item.vibes.some((v) => vibes.includes(v))) matched.push(item.id);
  }
  return { bonus: Math.min(0.1, matched.length * 0.02), matched };
}
