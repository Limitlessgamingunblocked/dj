import { describe, expect, it } from 'vitest';
import '../src/board/build';
import { allDefs, CATEGORIES, typeInfo } from '../src/board/catalog';
import { applyCurve, detent, invertCurve } from '../src/board/feel';
import { BOARD_FORMAT, BOARD_VERSION, checkBoardFile, compact, emptyBoard, readShareCode, shareCode } from '../src/board/format';
import { BUDGET, measure } from '../src/board/perf';
import { fromTemplate, make, randomBoard, TEMPLATES } from '../src/board/templates';
import { scaleNote } from '../src/board/sounds';

describe('board catalogue', () => {
  it('has every component the brief lists, each in a category with defaults', () => {
    const types = new Set(allDefs().map((d) => d.type));
    // standard (13.5)
    for (const t of ['jog', 'mixer', 'fader', 'knob', 'button', 'pads', 'screen', 'meter', 'fx', 'panel', 'group', 'transport', 'turntable']) expect(types).toContain(t);
    // wild add-ons (13.6): all sixteen
    for (const t of ['theremin', 'ribbon', 'xy', 'globe', 'crowd_fader', 'drop_button', 'scratch_tower', 'tape_stop', 'rewind', 'horn', 'vocal_keys', 'sequencer', 'ball_pit', 'pendulum', 'fire_fader', 'hype_dial']) expect(types).toContain(t);
    // show controls (13.6): all seven
    for (const t of ['laser_ctl', 'light_desk', 'pyro_panel', 'ledwall_ctl', 'cam_switcher', 'weather', 'crowd_cam']) expect(types).toContain(t);
    // decoration
    for (const t of ['bobblehead', 'lava_lamp', 'disco_ball', 'plant', 'speaker_stack', 'cocktail', 'cat', 'gears', 'dancers', 'mini_crowd', 'sticker', 'drawing', 'engraving']) expect(types).toContain(t);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const d of allDefs()) {
      expect(cats.has(d.category)).toBe(true);
      expect(typeof d.defaults()).toBe('object');
      expect(d.cost).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('board file format', () => {
  it('checks a board: unknown types skipped, numbers clamped, bad values replaced', () => {
    const raw = {
      format: BOARD_FORMAT,
      version: 99,
      id: 'b1',
      name: 'Test',
      booth: { table: 'spaceship', width: 999, glassFloor: true },
      components: [
        { id: 'k1', type: 'knob', pos: [0, 0, 9999], props: { material: 'unobtainium', colors: ['#fff', '#123456', 'red'], size: 0.02, feel: { detents: 999 } } },
        { id: 'x1', type: 'hoverboard', pos: [0, 0, 0] },
        { id: 'g1', type: 'group', pos: [0, 0, 0], children: [{ id: 'f1', type: 'fader', pos: [0.1, 0, 0], props: { fn: 'ch.1.fader' } }, { id: 'bad id!', type: 'knob' }] },
      ],
      wiring: { nodes: [{ id: 'n1', type: 'in.vibe' }, { id: 'n2', type: 'out.crowd' }, { id: 'n3', type: 'not valid' }], cables: [{ from: 'n1', to: 'n2' }, { from: 'n1', to: 'nope' }] },
      macros: [{ id: 'm1', name: 'Drop it', steps: [{ at: 0, control: 'ch.1.filter', value: 0.2 }, { at: 100, control: '' }] }],
      triggers: [{ id: 't1', when: 'vibe', above: 1, action: 'show:confetti' }, { id: 't2', when: 'drop', action: 'rm -rf' }],
      midi: { 'cc:1:7': 'k1', 'cc:1:8': 'gone' },
    };
    const b = checkBoardFile(raw, typeInfo)!;
    expect(b.version).toBe(BOARD_VERSION);
    expect(b.booth.table).toBe('rect');
    expect(b.booth.width).toBe(12);
    expect(b.booth.glassFloor).toBe(true);
    expect(b.components.map((c) => c.id)).toEqual(['k1', 'g1']);
    const k = b.components[0];
    expect(k.pos[2]).toBe(100);
    expect(k.props.material).toBe('matte');
    expect(k.props.colors[1]).toBe('#123456');
    expect(k.props.colors[0]).toBe('#1b1d22');
    expect(k.props.size).toBe(0.02);
    expect(k.props.feel.detents).toBe(64);
    expect(b.components[1].children.map((c) => c.id)).toEqual(['f1']);
    expect(b.wiring.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(b.wiring.cables).toHaveLength(1);
    expect(b.macros[0].steps).toHaveLength(1);
    expect(b.triggers.map((t) => t.id)).toEqual(['t1']);
    expect(b.midi).toEqual({ 'cc:1:7': 'k1' });
  });

  it('refuses files that aren’t boards', () => {
    expect(checkBoardFile({ format: 'something-else', id: 'x' }, typeInfo)).toBeNull();
    expect(checkBoardFile({ name: 'no id' }, typeInfo)).toBeNull();
  });

  it('round-trips through a share code, and the code is much smaller than the JSON', async () => {
    const b = fromTemplate('festival', 'share1');
    const code = await shareCode(b, typeInfo);
    expect(code.startsWith('DH1.')).toBe(true);
    expect(code.length).toBeLessThan(JSON.stringify(b).length / 3);
    const back = (await readShareCode(code, typeInfo))!;
    expect(back.name).toBe(b.name);
    // share codes keep positions to the millimetre
    const mm = (x: unknown): string => JSON.stringify(x, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
    expect(mm(back.components)).toBe(mm(checkBoardFile(JSON.parse(JSON.stringify(b)), typeInfo)!.components));
    expect(back.booth).toEqual(b.booth);
    expect(await readShareCode('not a code', typeInfo)).toBeNull();
    expect(await readShareCode('DH1.!!!!', typeInfo)).toBeNull();
  });

  it('compacts away defaults', () => {
    const b = emptyBoard('c1');
    b.components.push(make('knob', [0.1, 0, 0]));
    const c = compact(b, typeInfo) as { components: { props?: unknown }[]; booth: object };
    expect(Object.keys(c.booth)).toHaveLength(0);
    expect(c.components[0].props).toBeUndefined();
  });
});

describe('templates and randomize', () => {
  it('every template makes a valid board that survives checking', () => {
    for (const t of TEMPLATES) {
      const b = fromTemplate(t.id, `t-${t.id}`);
      const again = checkBoardFile(JSON.parse(JSON.stringify(b)), typeInfo)!;
      expect(again.components.length).toBe(b.components.length);
    }
  });

  it('randomize makes something different each time, and valid', () => {
    let s = 1;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const a = randomBoard('r1', r);
    const b = randomBoard('r2', r);
    expect(JSON.stringify(a.components)).not.toBe(JSON.stringify(b.components));
    expect(checkBoardFile(JSON.parse(JSON.stringify(a)), typeInfo)!.components.length).toBe(a.components.length);
  });
});

describe('performance safeguard', () => {
  it('a 200-part board of ordinary parts stays inside the budget', () => {
    const b = emptyBoard('p1');
    for (let i = 0; i < 200; i++) b.components.push(make(i % 2 ? 'knob' : 'button', [i * 0.01, 0, 0]));
    const r = measure(b);
    expect(r.parts).toBe(200);
    expect(r.load).toBeLessThan(1);
    expect(r.warnings).toHaveLength(0);
  });

  it('warns helpfully instead of blocking when it gets heavy', () => {
    const b = emptyBoard('p2');
    for (let i = 0; i < 40; i++) b.components.push(make('lava_lamp', [i * 0.02, 0, 0], { material: 'lava' }));
    for (let i = 0; i < 4; i++) b.components.push(make('disco_ball', [0, 0, i * 0.05]));
    for (let i = 0; i < 60; i++) b.components.push(make('mixer', [0, 0, 0], { channels: 4 }));
    const r = measure(b);
    expect(r.level).toBe('heavy');
    expect(r.cost).toBeGreaterThan(BUDGET);
    expect(r.warnings.join(' ')).toMatch(/40 lava lamps are using a lot of power/);
    expect(r.warnings.join(' ')).toMatch(/disco ball/);
  });
});

describe('feel', () => {
  it('curves invert cleanly and notches snap', () => {
    for (const c of ['linear', 'log', 'exp', 's'] as const) for (const x of [0, 0.1, 0.37, 0.5, 0.9, 1]) expect(invertCurve(applyCurve(x, c), c)).toBeCloseTo(x, 4);
    expect(applyCurve(0.5, 'log')).toBeGreaterThan(0.5);
    expect(applyCurve(0.5, 'exp')).toBeLessThan(0.5);
    expect(detent(0.33, 5)).toBe(0.25);
    expect(detent(0.33, 0)).toBe(0.33);
  });

  it('the vocal keyboard walks the track’s scale', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => scaleNote(60, false, i))).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect([0, 1, 2].map((i) => scaleNote(57, true, i))).toEqual([57, 59, 60]);
  });
});
