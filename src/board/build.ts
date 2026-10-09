/*
 * A board file becomes a playable board: every component built from the
 * catalogue, the booth around it, the runtime (wiring, macros, triggers),
 * wrapped as a BoardDef so the stage, the picker, the zones and recordings
 * treat it like any preset (Section 13.1: what you build is what you play on
 * in every venue, and what the crowd and cameras see).
 */
import * as THREE from 'three';
import type { ControlRegistry } from '../core/controls';
import type { BoardBuild, Finish } from '../three/builder';
import { finish } from '../three/builder';
import type { BoardDef } from '../three/boards';
import type { Part, PartCtx } from '../three/parts';
import { ADDONS } from './addons';
import { buildBooth, type BuiltBooth } from './booth';
import { allDefs, buildComponent, defOf, registerDefs } from './catalog';
import { DECOR } from './decor';
import type { BoardComponent, BoardFile } from './format';
import type { BoardHooks } from './hooks';
import { BoardRuntime, walkComponents } from './logic';
import { updateBoardUniforms } from './materials';
import { SHOW_CONTROLS } from './showctl';

registerDefs([...ADDONS, ...SHOW_CONTROLS, ...DECOR]);

export const CUSTOM_FINISH: Finish = finish({ id: 'custom', name: 'As built', swatch: '#ff2e88', body: '#16181c', face: { base: '#1d2025', print: '#e8ebf0', sub: '#6b7382', accent: '#ff2e88', texture: 'matte' }, accent: '#ff2e88' });

/** what a custom board adds to the usual build */
export interface CustomBuild {
  booth: BuiltBooth;
  runtime: BoardRuntime;
  ticks: ((c: PartCtx) => void)[];
}

/** the highest deck any component uses (the engine shows that many decks) */
export function decksUsed(doc: BoardFile): 2 | 4 {
  let max = 2;
  walkComponents(doc.components, (c) => {
    const d = Number(c.props.deck ?? 0);
    if (d > max) max = d;
    const fn = `${c.props.fn} ${c.props.base ?? ''}`;
    const m = /deck\.(\d)\./.exec(fn);
    if (m && Number(m[1]) > max) max = Number(m[1]);
    if (c.type === 'mixer' && Number(c.props.channels) > 2) max = Math.max(max, Number(c.props.channels));
  });
  return max > 2 ? 4 : 2;
}

/** Wrap a board file as a BoardDef. `ctx()` supplies the registry and hooks when it's built. */
export function customDef(doc: BoardFile, ctx: () => { reg: ControlRegistry; hooks: BoardHooks }): BoardDef & { custom: true; doc: BoardFile } {
  return {
    id: `custom:${doc.id}`,
    name: doc.name,
    category: 'My boards',
    description: `${countComponents(doc.components)} parts`,
    decks: decksUsed(doc),
    turntable: false,
    fixedDecks: true,
    xcurve: 0.5,
    finishes: [CUSTOM_FINISH],
    custom: true,
    doc,
    build(b: BoardBuild) {
      const { reg, hooks } = ctx();
      buildInto(b, doc, reg, hooks);
    },
  };
}

export function countComponents(list: BoardComponent[]): number {
  let n = 0;
  walkComponents(list, () => n++);
  return n;
}

/** Build the board's components and booth into a BoardBuild. */
export function buildInto(b: BoardBuild, doc: BoardFile, reg: ControlRegistry, hooks: BoardHooks): CustomBuild {
  const env = { reg, hooks };
  const parts: Part[] = [];
  const ticks: ((c: PartCtx) => void)[] = [];
  const runtime = new BoardRuntime(doc, reg, hooks);
  for (const c of doc.components) {
    const o = buildComponent(c, env, parts, ticks);
    if (o) b.root.add(o);
  }
  for (const p of parts) b.register(p);
  // the booth hangs below the board's origin, which sits on the table top
  const booth = buildBooth(doc.booth);
  booth.group.position.y = -booth.top;
  booth.group.userData.booth = true;
  b.root.add(booth.group);
  const extra: CustomBuild = { booth, runtime, ticks };
  (b as BoardBuild & { custom?: CustomBuild }).custom = extra;
  (b as BoardBuild & { rootY?: number }).rootY = doc.booth.table === 'none' ? undefined : booth.top;
  return extra;
}

/** per frame, from the stage: shared uniforms, the booth, add-on ticks, the runtime */
export function updateCustom(b: BoardBuild, c: PartCtx, hooks: BoardHooks): void {
  const x = (b as BoardBuild & { custom?: CustomBuild }).custom;
  if (!x) return;
  const kick = hooks.kick();
  updateBoardUniforms(c.dt, kick, hooks.beat().phase);
  x.booth.update(c.dt, kick, hooks.vibe());
  for (const t of x.ticks) t(c);
  x.runtime.update(c.dt);
}

export function disposeCustom(b: BoardBuild | null): void {
  const x = (b as (BoardBuild & { custom?: CustomBuild }) | null)?.custom;
  x?.runtime.dispose();
}

/** all component types, for palettes and checking */
export { allDefs, defOf };

/** a quick bounding size of a component (box select, alignment) */
export function componentBox(o: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(o);
}
