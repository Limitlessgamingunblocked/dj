/*
 * The Board Builder's edits as plain functions on a board file (Section
 * 13.3): add, delete, duplicate, mirror, array, group and ungroup, reorder
 * in the layers list, symmetry twins, the snap grid and alignment guides.
 * The editor calls these and rebuilds what changed; they're tested on their
 * own (tests/boardeditor.test.ts).
 */
import * as THREE from 'three';
import type { BoardComponent, BoardFile, Vec3 } from '../format';
import { walkComponents } from '../logic';
import { newId } from '../templates';

export interface Found {
  c: BoardComponent;
  parent: BoardComponent | null;
  list: BoardComponent[];
  index: number;
}

/** find a component anywhere in the tree */
export function find(doc: BoardFile, id: string): Found | null {
  const walk = (list: BoardComponent[], parent: BoardComponent | null): Found | null => {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.id === id) return { c, parent, list, index: i };
      const f = walk(c.children, c);
      if (f) return f;
    }
    return null;
  };
  return walk(doc.components, null);
}

/** the chain of groups from the top level down to (not including) `id` */
export function ancestors(doc: BoardFile, id: string): string[] {
  const out: string[] = [];
  let f = find(doc, id);
  while (f?.parent) {
    out.unshift(f.parent.id);
    f = find(doc, f.parent.id);
  }
  return out;
}

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** a copy with fresh ids all the way down */
export function freshCopy(c: BoardComponent): BoardComponent {
  const o = clone(c);
  const walk = (x: BoardComponent) => {
    x.id = newId();
    x.children.forEach(walk);
  };
  walk(o);
  return o;
}

export function add(doc: BoardFile, c: BoardComponent, parentId?: string | null): void {
  const p = parentId ? find(doc, parentId) : null;
  (p ? p.c.children : doc.components).push(c);
}

/** remove components (and their children); MIDI mappings and wiring that pointed at them go too */
export function remove(doc: BoardFile, ids: Iterable<string>): number {
  const gone = new Set<string>();
  let n = 0;
  for (const id of ids) {
    const f = find(doc, id);
    if (!f) continue;
    f.list.splice(f.index, 1);
    walkComponents([f.c], (x) => gone.add(x.id));
    n++;
  }
  if (!gone.size) return 0;
  for (const [k, v] of Object.entries(doc.midi)) if (gone.has(v)) delete doc.midi[k];
  const deadNodes = new Set(doc.wiring.nodes.filter((nd) => typeof nd.params.component === 'string' && gone.has(nd.params.component as string)).map((nd) => nd.id));
  doc.wiring.nodes = doc.wiring.nodes.filter((nd) => !deadNodes.has(nd.id));
  doc.wiring.cables = doc.wiring.cables.filter((c) => !deadNodes.has(c.from.split(':')[0]) && !deadNodes.has(c.to.split(':')[0]));
  return n;
}

/** keep only the outermost of a selection (a group and its child both selected = just the group) */
export function outermost(doc: BoardFile, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  return [...set].filter((id) => !ancestors(doc, id).some((a) => set.has(a)));
}

/** duplicate next to the originals (same parent), offset a little; returns the new ids */
export function duplicate(doc: BoardFile, ids: Iterable<string>, offset: Vec3 = [0.03, 0, 0.03]): string[] {
  const out: string[] = [];
  for (const id of outermost(doc, ids)) {
    const f = find(doc, id);
    if (!f) continue;
    const c = freshCopy(f.c);
    c.pos = [c.pos[0] + offset[0], c.pos[1] + offset[1], c.pos[2] + offset[2]];
    f.list.splice(f.index + 1, 0, c);
    out.push(c.id);
  }
  return out;
}

/* ------------------------------ mirroring ------------------------------ */

/** deck 1↔2 and 3↔4, channel 1↔2 and 3↔4: a mirrored deck controls the other side */
export function swapSide(s: string): string {
  return s.replace(/\b(deck|ch)\.([1-4])\./g, (_m, k: string, n: string) => `${k}.${({ 1: 2, 2: 1, 3: 4, 4: 3 } as Record<string, number>)[n]}.`);
}

/** mirror a component across the board's centre line (x = 0), in place */
export function mirrorInPlace(c: BoardComponent, swapDecks = true): void {
  c.pos[0] = -c.pos[0];
  c.rot[1] = -c.rot[1];
  c.rot[2] = -c.rot[2];
  if (swapDecks) {
    const d = Number(c.props.deck ?? 0);
    if (d >= 1 && d <= 4) c.props.deck = ({ 1: 2, 2: 1, 3: 4, 4: 3 } as Record<number, number>)[d];
    c.props.fn = swapSide(c.props.fn);
    c.props.fn2 = swapSide(c.props.fn2);
    if (typeof c.props.base === 'string') c.props.base = swapSide(c.props.base);
  }
  // children sit in the group's own space: mirror them in it
  for (const ch of c.children) mirrorInPlace(ch, swapDecks);
}

/** a mirrored copy of each (the other side of the board); returns the new ids */
export function mirrorCopy(doc: BoardFile, ids: Iterable<string>): string[] {
  const out: string[] = [];
  for (const id of outermost(doc, ids)) {
    const f = find(doc, id);
    if (!f) continue;
    const c = freshCopy(f.c);
    mirrorInPlace(c);
    f.list.splice(f.index + 1, 0, c);
    out.push(c.id);
  }
  return out;
}

/** `count` more copies, each `step` further on; returns the new ids */
export function arrayCopy(doc: BoardFile, ids: Iterable<string>, count: number, step: Vec3): string[] {
  const out: string[] = [];
  const n = Math.max(0, Math.min(64, Math.round(count)));
  for (const id of outermost(doc, ids)) {
    const f = find(doc, id);
    if (!f) continue;
    let at = f.index;
    for (let i = 1; i <= n; i++) {
      const c = freshCopy(f.c);
      c.pos = [c.pos[0] + step[0] * i, c.pos[1] + step[1] * i, c.pos[2] + step[2] * i];
      f.list.splice(++at, 0, c);
      out.push(c.id);
    }
  }
  return out;
}

/* ------------------------------ groups ------------------------------ */

const m4 = (c: BoardComponent) => new THREE.Matrix4().compose(new THREE.Vector3(...c.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...c.rot)), new THREE.Vector3(...c.scale));

function setFrom(c: BoardComponent, m: THREE.Matrix4): void {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q);
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  c.pos = [r(p.x), r(p.y), r(p.z)];
  c.rot = [r(e.x), r(e.y), r(e.z)];
  c.scale = [r(s.x), r(s.y), r(s.z)];
}

/**
 * Put components that share a parent into a new group at their centre.
 * Returns the group's id, or null if they don't share a parent.
 */
export function group(doc: BoardFile, ids: Iterable<string>, makeGroup: (pos: Vec3) => BoardComponent): string | null {
  const top = outermost(doc, ids);
  if (top.length < 1) return null;
  const found = top.map((id) => find(doc, id)!).filter(Boolean);
  const parent = found[0].parent;
  if (found.some((f) => f.parent !== parent)) return null;
  const list = found[0].list;
  const cx = found.reduce((s, f) => s + f.c.pos[0], 0) / found.length;
  const cz = found.reduce((s, f) => s + f.c.pos[2], 0) / found.length;
  const g = makeGroup([Math.round(cx * 1e4) / 1e4, 0, Math.round(cz * 1e4) / 1e4]);
  const first = Math.min(...found.map((f) => f.index));
  // members, in their list order
  const members = found.sort((a, b) => a.index - b.index).map((f) => f.c);
  for (const c of members) list.splice(list.indexOf(c), 1);
  for (const c of members) {
    c.pos = [c.pos[0] - g.pos[0], c.pos[1] - g.pos[1], c.pos[2] - g.pos[2]];
    g.children.push(c);
  }
  list.splice(Math.min(first, list.length), 0, g);
  return g.id;
}

/** take a group's members out into its parent, keeping where they are; returns their ids */
export function ungroup(doc: BoardFile, id: string): string[] {
  const f = find(doc, id);
  if (!f || !f.c.children.length) return [];
  const gm = m4(f.c);
  const kids = f.c.children;
  for (const k of kids) setFrom(k, gm.clone().multiply(m4(k)));
  f.list.splice(f.index, 1, ...kids);
  return kids.map((k) => k.id);
}

/** move a component up (−1) or down (+1) in its list (the layers panel) */
export function reorder(doc: BoardFile, id: string, dir: -1 | 1): boolean {
  const f = find(doc, id);
  if (!f) return false;
  const j = f.index + dir;
  if (j < 0 || j >= f.list.length) return false;
  [f.list[f.index], f.list[j]] = [f.list[j], f.list[f.index]];
  return true;
}

/** move a component to sit just before `beforeId` (or at the end of `parentId`'s list), keeping its place in the world */
export function moveTo(doc: BoardFile, id: string, target: { before?: string; parent?: string | null }): boolean {
  const f = find(doc, id);
  if (!f) return false;
  if (target.before === id) return false;
  // never into itself
  if (target.parent && (target.parent === id || ancestors(doc, target.parent).includes(id))) return false;
  if (target.before && ancestors(doc, target.before).includes(id)) return false;
  const world = worldMatrix(doc, id);
  f.list.splice(f.index, 1);
  let list: BoardComponent[];
  let index: number;
  let parent: BoardComponent | null;
  if (target.before) {
    const b = find(doc, target.before);
    if (!b) {
      f.list.splice(f.index, 0, f.c);
      return false;
    }
    list = b.list;
    index = b.index;
    parent = b.parent;
  } else {
    parent = target.parent ? find(doc, target.parent)!.c : null;
    list = parent ? parent.children : doc.components;
    index = list.length;
  }
  const pm = parent ? worldMatrix(doc, parent.id) : new THREE.Matrix4();
  setFrom(f.c, pm.invert().multiply(world));
  list.splice(index, 0, f.c);
  return true;
}

/** a component's matrix on the board (through its groups) */
export function worldMatrix(doc: BoardFile, id: string): THREE.Matrix4 {
  const chain = [...ancestors(doc, id), id];
  const m = new THREE.Matrix4();
  for (const a of chain) m.multiply(m4(find(doc, a)!.c));
  return m;
}

/** every component of a type (select all of a type) */
export function ofType(doc: BoardFile, type: string): string[] {
  const out: string[] = [];
  walkComponents(doc.components, (c) => {
    if (c.type === type) out.push(c.id);
  });
  return out;
}

/* ------------------------------ symmetry ------------------------------ */

/** the matching part on the other side of the centre line (same type and level, mirrored position), if there is one */
export function twinOf(doc: BoardFile, id: string, tol = 0.004): string | null {
  const f = find(doc, id);
  if (!f || Math.abs(f.c.pos[0]) < tol) return null;
  for (const o of f.list) {
    if (o === f.c || o.type !== f.c.type) continue;
    if (Math.abs(o.pos[0] + f.c.pos[0]) < tol && Math.abs(o.pos[1] - f.c.pos[1]) < tol && Math.abs(o.pos[2] - f.c.pos[2]) < tol) return o.id;
  }
  return null;
}

/* ------------------------------ snapping ------------------------------ */

export const GRID_STEPS = [0, 0.005, 0.01, 0.025] as const;

export const snap = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

export interface Box2 {
  /** x0, x1 across; z0, z1 front to back (board space, metres) */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Guide {
  axis: 'x' | 'z';
  /** where the line is */
  at: number;
  /** how far it runs (the other axis) */
  from: number;
  to: number;
}

/**
 * Alignment guides: if the moving box's edges or centre come within `tol` of
 * another box's (or the centre line), nudge it there and say where to draw
 * the guide. Returns the nudge and the guides.
 */
export function align(moving: Box2, others: Box2[], tol = 0.004): { dx: number; dz: number; guides: Guide[] } {
  const xs = (b: Box2) => [b.x0, (b.x0 + b.x1) / 2, b.x1];
  const zs = (b: Box2) => [b.z0, (b.z0 + b.z1) / 2, b.z1];
  type Best = { d: number; shift: number; line: number; o: Box2 | null; hit: boolean };
  let bx: Best = { d: tol, shift: 0, line: 0, o: null, hit: false };
  let bz: Best = { d: tol, shift: 0, line: 0, o: null, hit: false };
  for (const o of others) {
    for (const a of xs(moving))
      for (const b of xs(o)) {
        const d = Math.abs(b - a);
        if (d < bx.d) bx = { d, shift: b - a, line: b, o, hit: true };
      }
    for (const a of zs(moving))
      for (const b of zs(o)) {
        const d = Math.abs(b - a);
        if (d < bz.d) bz = { d, shift: b - a, line: b, o, hit: true };
      }
  }
  // the board's centre line
  for (const a of xs(moving)) {
    const d = Math.abs(a);
    if (d < bx.d) bx = { d, shift: -a, line: 0, o: null, hit: true };
  }
  const dx = bx.hit ? bx.shift : 0;
  const dz = bz.hit ? bz.shift : 0;
  const guides: Guide[] = [];
  if (bx.hit) guides.push({ axis: 'x', at: bx.line, from: Math.min(bx.o?.z0 ?? Infinity, moving.z0 + dz) - 0.02, to: Math.max(bx.o?.z1 ?? -Infinity, moving.z1 + dz) + 0.02 });
  if (bz.hit && bz.o) guides.push({ axis: 'z', at: bz.line, from: Math.min(bz.o.x0, moving.x0 + dx) - 0.02, to: Math.max(bz.o.x1, moving.x1 + dx) + 0.02 });
  return { dx, dz, guides };
}

/* ------------------------------ props ------------------------------ */

/** set a (possibly nested: 'glow.intensity') property on components */
export function setProp(doc: BoardFile, ids: Iterable<string>, path: string, value: unknown): void {
  const keys = path.split('.');
  for (const id of ids) {
    const f = find(doc, id);
    if (!f) continue;
    let o = f.c.props as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      const next = o[keys[i]];
      if (typeof next !== 'object' || next === null) o[keys[i]] = {};
      o = o[keys[i]] as Record<string, unknown>;
    }
    o[keys[keys.length - 1]] = value;
  }
}

export function getProp(c: BoardComponent, path: string): unknown {
  let o: unknown = c.props;
  for (const k of path.split('.')) o = o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;
  return o;
}
