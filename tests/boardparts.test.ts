import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import '../src/board/build';
import { allDefs, defOf, typeInfo, type OptionSpec } from '../src/board/catalog';
import { checkBoardFile, commonDefaults, compact, emptyBoard } from '../src/board/format';
import { underCeiling } from '../src/board/editor/ops';
import { fromTemplate, make } from '../src/board/templates';
import { finishFor } from '../src/board/units';

/** a value for an option that isn't its default, so a round trip has something to lose */
function changed(o: OptionSpec, def: unknown): unknown {
  switch (o.kind) {
    case 'number': {
      const lo = o.min ?? 0;
      const hi = o.max ?? lo + 1;
      const v = def === hi ? lo : hi;
      return v;
    }
    case 'select':
      return (o.choices ?? []).map((c) => c.id).find((id) => id !== def) ?? def;
    case 'bool':
      return !def;
    case 'color':
      return '#123456';
    case 'control':
      return 'ch.2.filter';
    default:
      return Array.isArray(def) ? ['roll', 'echo'] : 'changed';
  }
}

describe('the parts catalogue', () => {
  it('every setting a part offers has a default, so the inspector and the file checker agree', () => {
    for (const d of allDefs()) {
      const defaults = { ...commonDefaults(), ...d.defaults() } as Record<string, unknown>;
      for (const o of d.options ?? []) expect(Object.keys(defaults), `${d.type}: ${o.key}`).toContain(o.key);
    }
  });

  it('a board with one of every part keeps each part’s own settings through a share code', () => {
    const b = emptyBoard('all', 'Everything');
    const want = new Map<string, Record<string, unknown>>();
    for (const d of allDefs()) {
      const defaults = d.defaults();
      const props: Record<string, unknown> = {};
      for (const o of d.options ?? []) props[o.key] = changed(o, defaults[o.key] ?? (commonDefaults() as unknown as Record<string, unknown>)[o.key]);
      const c = make(d.type, [0, 0, 0], props);
      b.components.push(c);
      want.set(c.id, props);
    }
    const back = checkBoardFile(JSON.parse(JSON.stringify(compact(b, typeInfo))), typeInfo)!;
    expect(back.components).toHaveLength(b.components.length);
    for (const c of back.components) {
      const props = want.get(c.id)!;
      for (const [k, v] of Object.entries(props)) expect(c.props[k], `${c.type}.${k}`).toEqual(v);
    }
  });

  it('the new booth gear and pro units are in the catalogue, all costing something, none controlling anything they shouldn’t', () => {
    for (const t of ['headphones', 'laptop', 'usb_stick', 'booth_mic', 'booth_monitor', 'setlist', 'gaffer_tape', 'water_bottle', 'record_crate']) {
      const d = defOf(t)!;
      expect(d.category, t).toBe('gear');
      expect(d.cost, t).toBeGreaterThan(0);
      expect(d.defaults().fn, t).toBe('');
    }
    for (const t of ['media_player', 'club_mixer', 'dd_turntable', 'rotary_mixer']) expect(defOf(t)!.cost, t).toBeGreaterThan(20);
  });

  it('a pro unit’s finish follows the part’s material: metal reads brushed, gloss and acrylic shine, the rest are matte', () => {
    const tex = (material: string) => finishFor(make('club_mixer', [0, 0, 0], { material: material as never })).face.texture;
    expect(tex('brushed')).toBe('brushed');
    expect(tex('chrome')).toBe('brushed');
    expect(tex('gloss')).toBe('gloss');
    expect(tex('acrylic')).toBe('gloss');
    expect(tex('matte')).toBe('matte');
    expect(tex('walnut')).toBe('matte');
    const f = finishFor(make('club_mixer', [0, 0, 0], { colors: ['#202020', '#ffffff', '#ff0000'] }));
    expect(f.accent).toBe('#ff0000');
    expect(f.face.print).toBe('#ffffff');
  });
});

describe('the life-size templates', () => {
  it('the club booth is two media players either side of a club mixer, decks 1 and 2, all on the table', () => {
    const b = checkBoardFile(JSON.parse(JSON.stringify(fromTemplate('club_real', 't1'))), typeInfo)!;
    const players = b.components.filter((c) => c.type === 'media_player');
    expect(players.map((c) => c.props.deck).sort()).toEqual([1, 2]);
    expect(Math.sign(players.find((c) => c.props.deck === 1)!.pos[0])).toBe(-1);
    expect(b.components.some((c) => c.type === 'club_mixer')).toBe(true);
    for (const c of b.components) expect(Math.abs(c.pos[0]), c.type).toBeLessThan(b.booth.width / 2);
  });

  it('the vinyl booth is two direct-drive turntables and a rotary mixer', () => {
    const b = fromTemplate('vinyl_real', 't2');
    expect(b.components.filter((c) => c.type === 'dd_turntable').map((c) => c.props.deck).sort()).toEqual([1, 2]);
    expect(b.components.some((c) => c.type === 'rotary_mixer')).toBe(true);
  });
});

describe('framing under a low ceiling', () => {
  const target = new THREE.Vector3(0, 0.95, 0);
  const dir = new THREE.Vector3(0, 0.8, 0.6);

  it('leaves the view alone when it fits under the ceiling', () => {
    const p = underCeiling(target, dir, 1, 2.5);
    expect(p.y).toBeCloseTo(0.95 + 0.8);
    expect(p.z).toBeCloseTo(0.6);
  });

  it('comes in lower and further back, at the same distance, when it would go through the ceiling', () => {
    const p = underCeiling(target, dir, 3, 2.35);
    expect(p.y).toBeCloseTo(2.35);
    expect(p.distanceTo(target)).toBeCloseTo(3);
    expect(p.z).toBeGreaterThan(3 * 0.6);
    expect(p.x).toBeCloseTo(0);
  });

  it('a top-down view just stops at the ceiling', () => {
    const p = underCeiling(target, new THREE.Vector3(0, 1, 0.02), 3, 2.35, true);
    expect(p.y).toBe(2.35);
    expect(p.z).toBeLessThan(0.1);
  });
});
