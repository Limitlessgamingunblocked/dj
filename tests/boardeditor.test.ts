import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import '../src/board/build';
import { typeInfo } from '../src/board/catalog';
import { checkBoardFile, emptyBoard, type BoardFile } from '../src/board/format';
import { History } from '../src/board/editor/history';
import * as ops from '../src/board/editor/ops';
import { make } from '../src/board/templates';

function board(): BoardFile {
  const b = emptyBoard('e1');
  b.components.push(
    make('jog', [-0.4, 0.03, 0], { deck: 1 }),
    make('fader', [-0.2, 0.03, 0.1], { fn: 'ch.1.fader' }),
    make('knob', [0, 0.03, -0.1], { fn: 'deck.1.tempo' }),
  );
  return b;
}

const world = (b: BoardFile, id: string) => new THREE.Vector3().setFromMatrixPosition(ops.worldMatrix(b, id));

describe('board editor operations', () => {
  it('duplicates beside the originals with fresh ids all the way down', () => {
    const b = board();
    const [id] = ops.duplicate(b, [b.components[0].id]);
    expect(b.components).toHaveLength(4);
    expect(b.components[1].id).toBe(id);
    expect(id).not.toBe(b.components[0].id);
    expect(b.components[1].pos[0]).toBeCloseTo(-0.37);
  });

  it('mirrors to the other side and swaps deck 1 for deck 2', () => {
    const b = board();
    const ids = ops.mirrorCopy(b, b.components.map((c) => c.id));
    const jog = ops.find(b, ids[0])!.c;
    expect(jog.pos[0]).toBeCloseTo(0.4);
    expect(jog.props.deck).toBe(2);
    expect(ops.find(b, ids[1])!.c.props.fn).toBe('ch.2.fader');
    expect(ops.find(b, ids[2])!.c.props.fn).toBe('deck.2.tempo');
    expect(ops.swapSide('deck.3.play ch.4.eq')).toBe('deck.4.play ch.3.eq');
  });

  it('makes an array of copies a step apart', () => {
    const b = board();
    const ids = ops.arrayCopy(b, [b.components[2].id], 3, [0.02, 0, 0]);
    expect(ids).toHaveLength(3);
    expect(ids.map((id) => ops.find(b, id)!.c.pos[0])).toEqual([0.02, 0.04, 0.06].map((x) => expect.closeTo(x, 6)));
  });

  it('groups around the middle and ungroups back to where things were, even after the group turns', () => {
    const b = board();
    const before = b.components.map((c) => world(b, c.id));
    const ids = b.components.map((c) => c.id);
    const gid = ops.group(b, ids, (pos) => make('group', pos))!;
    expect(b.components).toHaveLength(1);
    const g = b.components[0];
    expect(g.id).toBe(gid);
    expect(g.children.map((c) => c.id)).toEqual(ids);
    ids.forEach((id, i) => expect(world(b, id).distanceTo(before[i])).toBeLessThan(1e-6));
    // turn and move the group, then ungroup: the parts keep their places on the board
    g.rot = [0, Math.PI / 2, 0];
    g.pos = [0.1, 0, 0.05];
    const turned = ids.map((id) => world(b, id));
    ops.ungroup(b, gid);
    expect(b.components.map((c) => c.id)).toEqual(ids);
    ids.forEach((id, i) => expect(world(b, id).distanceTo(turned[i])).toBeLessThan(1e-5));
    expect(b.components[0].rot[1]).toBeCloseTo(Math.PI / 2);
  });

  it('only groups parts that share a parent', () => {
    const b = board();
    const gid = ops.group(b, [b.components[0].id, b.components[1].id], (pos) => make('group', pos))!;
    const inner = ops.find(b, gid)!.c.children[0].id;
    expect(ops.group(b, [inner, b.components[1].id], (pos) => make('group', pos))).toBeNull();
    expect(ops.outermost(b, [gid, inner])).toEqual([gid]);
    expect(ops.ancestors(b, inner)).toEqual([gid]);
  });

  it('moves in the layers list without moving on the board, and never into itself', () => {
    const b = board();
    const gid = ops.group(b, [b.components[0].id], () => make('group', [0.2, 0, 0]))!;
    const knob = b.components.find((c) => c.type === 'knob')!.id;
    const at = world(b, knob);
    expect(ops.moveTo(b, knob, { parent: gid })).toBe(true);
    expect(ops.find(b, knob)!.parent!.id).toBe(gid);
    expect(world(b, knob).distanceTo(at)).toBeLessThan(1e-6);
    expect(ops.moveTo(b, gid, { parent: gid })).toBe(false);
    expect(ops.moveTo(b, gid, { before: knob })).toBe(false);
    expect(ops.reorder(b, b.components[0].id, -1)).toBe(false);
    expect(ops.reorder(b, b.components[0].id, 1)).toBe(true);
  });

  it('finds the symmetry twin across the centre line', () => {
    const b = board();
    const [m] = ops.mirrorCopy(b, [b.components[0].id]);
    expect(ops.twinOf(b, b.components[0].id)).toBe(m);
    expect(ops.twinOf(b, m)).toBe(b.components[0].id);
    expect(ops.twinOf(b, b.components.find((c) => c.type === 'knob')!.id)).toBeNull();
  });

  it('removing parts takes their MIDI mappings and wiring with them', () => {
    const b = board();
    const f = b.components[1].id;
    b.midi = { 'cc:1:7': f, 'cc:1:8': b.components[2].id };
    b.wiring.nodes = [{ id: 'n1', type: 'in.component', params: { component: f }, x: 0, y: 0 }, { id: 'n2', type: 'out.crowd', params: {}, x: 0, y: 0 }];
    b.wiring.cables = [{ from: 'n1', to: 'n2' }];
    expect(ops.remove(b, [f])).toBe(1);
    expect(b.midi).toEqual({ 'cc:1:8': b.components[1].id });
    expect(b.wiring.nodes.map((n) => n.id)).toEqual(['n2']);
    expect(b.wiring.cables).toHaveLength(0);
  });

  it('snaps to the grid and lines boxes up with their neighbours and the centre line', () => {
    expect(ops.snap(0.0137, 0.005)).toBeCloseTo(0.015);
    expect(ops.snap(0.0137, 0)).toBe(0.0137);
    const other = { x0: 0.1, x1: 0.2, z0: 0, z1: 0.1 };
    const a = ops.align({ x0: 0.102, x1: 0.14, z0: 0.3, z1: 0.35 }, [other], 0.004);
    expect(a.dx).toBeCloseTo(-0.002);
    expect(a.guides[0]).toMatchObject({ axis: 'x', at: 0.1 });
    const c = ops.align({ x0: -0.051, x1: 0.049, z0: 0.5, z1: 0.6 }, [], 0.004);
    expect(c.dx).toBeCloseTo(0.001);
    expect(c.guides[0].at).toBe(0);
    expect(ops.align({ x0: 1, x1: 1.1, z0: 1, z1: 1.1 }, [other], 0.004)).toEqual({ dx: 0, dz: 0, guides: [] });
  });

  it('sets nested properties', () => {
    const b = board();
    ops.setProp(b, [b.components[0].id], 'glow.intensity', 0.7);
    expect(b.components[0].props.glow.intensity).toBe(0.7);
    expect(ops.getProp(b.components[0], 'glow.intensity')).toBe(0.7);
  });

  it('a part’s picture (the image material) survives saving and loading', () => {
    const b = board();
    b.components[0].props.material = 'image';
    b.components[0].props.image = 'data:image/jpeg;base64,AAAA';
    b.components[1].props.image = 'javascript:alert(1)';
    const back = checkBoardFile(JSON.parse(JSON.stringify(b)), typeInfo)!;
    expect(back.components[0].props.image).toBe('data:image/jpeg;base64,AAAA');
    expect(back.components[1].props.image).toBeUndefined();
  });
});

describe('undo history', () => {
  it('undoes and redoes, and a new change clears redo', () => {
    const h = new History(3);
    h.record('a', 'Add');
    h.record('b', 'Move');
    expect(h.undoLabel).toBe('Move');
    expect(h.undo('c')!.state).toBe('b');
    expect(h.redoLabel).toBe('Move');
    expect(h.redo('b')!.state).toBe('c');
    h.undo('c');
    h.record('b2', 'Colour');
    expect(h.canRedo).toBe(false);
    h.record('d', 'x');
    h.record('e', 'y');
    // the oldest step falls off the end
    const states: string[] = [];
    let s;
    while ((s = h.undo('now'))) states.push(s.state);
    expect(states).toEqual(['e', 'd', 'b2']);
  });
});

describe('a board’s own MIDI mapping', () => {
  it('routes a mapped message to the part’s control, after the global mappings, and reports every message for learning', async () => {
    const { ControlRegistry } = await import('../src/core/controls');
    const { MidiManager } = await import('../src/midi/MidiManager');
    const reg = new ControlRegistry();
    let v = 0;
    let pressed = 0;
    reg.register({ id: 'ch.1.filter', label: 'Filter', kind: 'continuous', get: () => v, set: (x) => (v = x), def: 0.5 });
    reg.register({ id: 'board.k1', label: 'Pad', kind: 'button', press: () => pressed++, lit: () => false });
    const m = new MidiManager(reg);
    m.mappings = [];
    const keys: string[] = [];
    m.on('raw', ({ key }) => keys.push(key));
    m.boardMidi = (key) => ({ 'cc:1:7': 'ch.1.filter', 'note:2:36': 'board.k1' })[key] ?? null;
    const send = (bytes: number[]) => (m as unknown as { onMessage(d: string, b: Uint8Array): void }).onMessage('Test', new Uint8Array(bytes));
    send([0xb0, 7, 127]);
    expect(v).toBe(1);
    send([0x91, 36, 100]);
    expect(pressed).toBe(1);
    send([0xb0, 8, 64]);
    expect(keys).toEqual(['cc:1:7', 'note:2:36', 'cc:1:8']);
  });
});
