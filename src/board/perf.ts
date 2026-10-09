/*
 * The performance safeguard (Section 13.13): no hard limits, but a live
 * meter of how heavy the board is, and specific, friendly suggestions when it
 * gets heavy enough to cause lag ("37 lava lamps are using a lot of power —
 * switch some to a static material?"), never a block.
 * The weights are rough draw-call equivalents; a 200-part board of ordinary
 * parts sits comfortably inside the budget.
 */
import { defOf } from './catalog';
import type { BoardFile } from './format';
import { walkComponents } from './logic';
import { isAnimated, materialCost } from './materials';

export const BUDGET = 1100;

export interface PerfReport {
  /** total cost, budget units */
  cost: number;
  /** 0..1+ of the budget */
  load: number;
  level: 'light' | 'busy' | 'heavy';
  parts: number;
  warnings: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function measure(doc: BoardFile): PerfReport {
  let cost = 20;
  let parts = 0;
  const byType = new Map<string, number>();
  let animated = 0;
  let glass = 0;
  let screens = 0;
  let lights = 0;
  let glowBeat = 0;
  walkComponents(doc.components, (c) => {
    parts++;
    const def = defOf(c.type);
    if (!def) return;
    byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
    const m = { id: c.props.material, color: c.props.colors[0], glow: c.props.glow };
    let k = def.cost * materialCost(m);
    // bigger pad grids and mixers cost more
    if (c.type === 'pads') k *= Math.max(1, (Number(c.props.rows) * Number(c.props.cols)) / 8);
    if (c.type === 'mixer') k *= Number(c.props.channels) / 2;
    if (c.type === 'mini_crowd' || c.type === 'dancers') k *= Math.max(1, Number(c.props.count) / 12);
    cost += k;
    if (isAnimated(c.props.material)) animated++;
    if (c.props.material === 'acrylic' || c.props.material === 'frosted') glass++;
    if (c.type === 'screen' || c.type === 'crowd_cam') screens++;
    if (c.type === 'disco_ball') lights++;
    if (c.props.glow.beat && c.props.glow.intensity > 0) glowBeat++;
  });
  // the booth
  const b = doc.booth;
  cost += (b.glassFloor ? 8 : 0) + (b.sideScreens ? 6 : 0) + (b.cables !== 'hidden' ? 10 : 0) + (b.monitors === 'stack' ? 8 : b.monitors === 'none' ? 0 : 4);
  // lights are expensive in a forward renderer: every one is paid on every lit pixel
  cost += lights * 30;
  if (glass > 0) cost += 60; // a transmission pass, once

  const load = cost / BUDGET;
  const level = load < 0.6 ? 'light' : load < 1 ? 'busy' : 'heavy';
  const warnings: string[] = [];
  if (load >= 0.6) {
    const lava = [...byType.entries()].filter(([t]) => t === 'lava_lamp');
    if (lava.length && lava[0][1] >= 8) warnings.push(`${plural(lava[0][1], 'lava lamp')} are using a lot of power — switch some to a static material?`);
    if (animated >= 12) warnings.push(`${plural(animated, 'part')} use animated materials (lava, ice, galaxy, liquid, holographic): switch some to a static material?`);
    if (lights >= 3) warnings.push(`${plural(lights, 'mini disco ball')} each throw light around the booth, the heaviest thing on a board: keep one or two?`);
    if (glass >= 1 && load >= 0.9) warnings.push(`Clear acrylic and frosted glass need an extra render pass (${plural(glass, 'part')}): try gloss instead?`);
    if (screens >= 6) warnings.push(`${plural(screens, 'screen')} redraw every few frames: a couple of them could show something static, like your name?`);
    if (glowBeat >= 40) warnings.push(`${plural(glowBeat, 'part')} glow on the beat: turning that off on some saves a little.`);
    if (parts >= 400) warnings.push(`${parts} parts: decorations far from the camera are simplified automatically, but deleting some helps more.`);
    if (!warnings.length && level === 'heavy') warnings.push('This board is heavy: the frame rate may drop on slower machines. Removing a few of the busiest parts helps.');
  }
  return { cost: Math.round(cost), load, level, parts, warnings };
}
