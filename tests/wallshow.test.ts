import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BLOB_CLEAR, BOX_BEATS, BOX_END, boxAt, fitBlob, MAIN_WALLS, pickWallFx, TILE_BEATS, TILE_SIZE, tileLayout, TILES_END, tilesAt, WallDirector, WallShow, type WallInput, type WallMode } from '../src/three/venues/wallshow';
import type { ShowState } from '../src/three/venues/show';

const input = (o: Partial<WallInput> = {}): WallInput => ({ dropHit: false, playing: true, bpm: 120, energy: 0.5, build: 0, peak: 0, ...o });
const show = (o: Partial<ShowState> = {}): ShowState =>
  ({ t: 0, master: 1, intensity: 1, kick: 0, flash: 0, energy: 0.5, beat: 0, bar: 0, bpm: 120, build: 0, peak: 0, dropHit: false, playing: true, reduceFlash: false, wall: 'auto', colors: [new THREE.Color(1, 0, 0), new THREE.Color(0, 1, 0), new THREE.Color(0, 0, 1)], ...o }) as unknown as ShowState;

/** run a director through `beats` beats at 120 bpm in 1/60 s steps */
function run(d: WallDirector, beats: number, mode: WallMode = 'auto', o: Partial<WallInput> = {}): void {
  const dt = 1 / 60;
  for (let t = 0; t < beats / 2; t += dt) d.update(input(o), mode, dt);
}

describe('the box', () => {
  it('opens on the drop and pushes the blob out over a beat and a half', () => {
    expect(boxAt(0).open).toBe(0);
    expect(boxAt(BOX_BEATS.open).open).toBe(1);
    // the blob is through the wall well inside its push, then settles after overshooting a little
    expect(boxAt(BOX_BEATS.push * 0.6).out).toBeGreaterThan(0.9);
    let peak = 0;
    for (let b = 0; b <= BOX_BEATS.push; b += 0.01) peak = Math.max(peak, boxAt(b).out);
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.15);
    expect(boxAt(BOX_BEATS.push).out).toBeCloseTo(1, 5);
  });

  it('hangs the blob for eight bars, sinks it, and only then closes the window', () => {
    for (let b = BOX_BEATS.push; b < BOX_BEATS.hold; b += 0.5) expect(boxAt(b).out).toBe(1);
    expect(BOX_BEATS.hold).toBe(32);
    // sinking: the window stays open the whole way down
    for (let b = BOX_BEATS.hold; b <= BOX_BEATS.hold + BOX_BEATS.sink; b += 0.25) expect(boxAt(b).open).toBe(1);
    expect(boxAt(BOX_BEATS.hold + BOX_BEATS.sink).out).toBe(0);
    expect(boxAt(BOX_END - 0.5).open).toBeLessThan(1);
    expect(boxAt(BOX_END)).toEqual({ open: 0, out: 0 });
    expect(boxAt(-1)).toEqual({ open: 0, out: 0 });
  });
});

describe('the flying tiles', () => {
  it('blow apart within a beat, then fly home flat over two bars', () => {
    expect(tilesAt(0)).toEqual({ out: 0, turn: 0 });
    expect(tilesAt(TILE_BEATS.burst).out).toBeCloseTo(1, 5);
    expect(tilesAt(0.5).out).toBeGreaterThan(0.8);
    expect(TILE_BEATS.back).toBe(8);
    expect(tilesAt(TILES_END - 0.01).out).toBeLessThan(0.01);
    // the tumble only goes forwards, and lands on whole turns
    let prev = -1;
    for (let b = 0; b < TILES_END; b += 0.1) {
      const t = tilesAt(b).turn;
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(tilesAt(TILES_END - 0.001).turn).toBeGreaterThan(0.999);
    for (let b = 0; b < TILES_END; b += 0.1) expect(tilesAt(b).out).toBeLessThan(1.13);
  });
});

describe('the wall show director', () => {
  it("plays the venue's own effect, and the other every third drop", () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => pickWallFx('auto', 'tiles', n))).toEqual(['tiles', 'tiles', 'box', 'tiles', 'tiles', 'box']);
    expect([0, 1, 2].map((n) => pickWallFx('auto', 'box', n))).toEqual(['box', 'box', 'tiles']);
    expect(pickWallFx('box', 'tiles', 0)).toBe('box');
    expect(pickWallFx('tiles', 'box', 2)).toBe('tiles');
    expect(pickWallFx('off', 'box', 0)).toBeNull();
  });

  it('counts beats from the tempo and ends on time', () => {
    const d = new WallDirector('box');
    d.update(input({ dropHit: true }), 'auto', 1 / 60);
    expect(d.fx).toBe('box');
    // 120 bpm: two beats a second
    run(d, 8);
    expect(d.b).toBeCloseTo(8, 0);
    run(d, BOX_END - 8 + 0.2);
    expect(d.fx).toBeNull();
    // a slower track takes longer
    const slow = new WallDirector('tiles');
    slow.update(input({ dropHit: true, bpm: 60 }), 'auto', 0);
    for (let i = 0; i < 60; i++) slow.update(input({ bpm: 60 }), 'auto', 1 / 60);
    expect(slow.b).toBeCloseTo(1, 1);
  });

  it("doesn't restart on a drop while one is running", () => {
    const d = new WallDirector('tiles');
    d.update(input({ dropHit: true }), 'auto', 0);
    run(d, 4);
    const b = d.b;
    d.update(input({ dropHit: true }), 'auto', 0);
    expect(d.b).toBe(b);
    expect(d.drops).toBe(1);
  });

  it('winds down instead of cutting when the wall is turned off or the music stops', () => {
    const d = new WallDirector('box');
    d.update(input({ dropHit: true }), 'auto', 0);
    run(d, 4);
    d.update(input(), 'off', 1 / 60);
    // straight to the sink: the blob goes back into the box, the window still open
    expect(d.fx).toBe('box');
    expect(d.b).toBeGreaterThanOrEqual(BOX_BEATS.hold);
    expect(boxAt(d.b).open).toBe(1);
    run(d, BOX_BEATS.sink + BOX_BEATS.close + 0.1, 'off');
    expect(d.fx).toBeNull();
    // off: drops play nothing
    d.update(input({ dropHit: true }), 'off', 0);
    expect(d.fx).toBeNull();

    const t = new WallDirector('tiles');
    t.update(input({ dropHit: true }), 'auto', 0);
    t.update(input({ playing: false }), 'auto', 1 / 60);
    expect(t.b).toBeGreaterThanOrEqual(TILE_BEATS.drift);
  });

  it('ripples the panels only in a high-energy groove after a drop', () => {
    const d = new WallDirector('tiles');
    run(d, 16, 'auto', { energy: 0.9, peak: 1 });
    expect(d.ripple).toBeGreaterThan(0.6);
    run(d, 16, 'auto', { energy: 0.9, peak: 1, build: 0.6 });
    expect(d.ripple).toBeLessThan(0.05);
    run(d, 16, 'auto', { energy: 0.4, peak: 1 });
    expect(d.ripple).toBeLessThan(0.05);
    run(d, 16, 'box', { energy: 0.9, peak: 1 });
    expect(d.ripple).toBeLessThan(0.05);
    // the box up: no panels at all
    const b = new WallDirector('box');
    run(b, 16, 'auto', { energy: 0.9, peak: 1 });
    b.update(input({ dropHit: true, energy: 0.9, peak: 1 }), 'auto', 1 / 60);
    expect(b.ripple).toBe(0);
  });
});

describe('the panels', () => {
  const walls = Object.entries(MAIN_WALLS);

  it('cut every main wall into panels of about 1.5 m, near square, covering it exactly', () => {
    for (const [, s] of walls) {
      const [w, h] = s.size;
      const l = tileLayout(w, h, TILE_SIZE.normal);
      expect(l.tw).toBeGreaterThanOrEqual(1);
      expect(l.tw).toBeLessThanOrEqual(2);
      expect(l.th).toBeGreaterThanOrEqual(1);
      expect(l.th).toBeLessThanOrEqual(2);
      expect(Math.max(l.tw / l.th, l.th / l.tw)).toBeLessThan(1.35);
      expect(l.nx * l.tw).toBeCloseTo(w, 6);
      expect(l.ny * l.th).toBeCloseTo(h, 6);
      expect(l.nx * l.ny).toBeLessThanOrEqual(240);
      // Low: fewer, bigger panels
      const low = tileLayout(w, h, TILE_SIZE.low);
      expect(low.nx * low.ny).toBeLessThan(l.nx * l.ny);
    }
  });

  it('keeps to the panel budget on a huge wall', () => {
    const l = tileLayout(80, 30, 1.5, 200);
    expect(l.nx * l.ny).toBeLessThanOrEqual(200);
    expect(tileLayout(0.5, 0.5)).toEqual({ nx: 1, ny: 1, tw: 0.5, th: 0.5 });
  });
});

describe('the blob', () => {
  it('fits every main wall: above the hands, under the rig, short of the stage front', () => {
    for (const [id, s] of Object.entries(MAIN_WALLS)) {
      const h = s.size[1];
      const b = fitBlob(h, s.room);
      expect(b, id).not.toBeNull();
      if (!b) continue;
      expect(b.y - b.r, id).toBeGreaterThanOrEqual(s.room.hands + BLOB_CLEAR - 1e-9);
      expect(b.y + b.r, id).toBeLessThanOrEqual(s.room.top - BLOB_CLEAR + 1e-9);
      expect(b.z + b.r, id).toBeLessThanOrEqual(s.room.reach + 1e-9);
      expect(b.r, id).toBeLessThanOrEqual(h * 0.42 + 1e-9);
      // big enough to read as a giant shape
      expect(b.r * 2, id).toBeGreaterThan(h * 0.4);
    }
  });

  it('only bulges through the wall in the low house warehouse, and comes right out on the big stages', () => {
    const wh = fitBlob(MAIN_WALLS.deckhouse.size[1], MAIN_WALLS.deckhouse.room)!;
    expect(wh.z).toBeLessThan(0);
    expect(wh.z + wh.r).toBeGreaterThan(0.5);
    for (const id of ['warehouse', 'printworks', 'festival', 'allypally'] as const) {
      const b = fitBlob(MAIN_WALLS[id].size[1], MAIN_WALLS[id].room)!;
      expect(b.z, id).toBeGreaterThan(b.r * 0.6);
    }
  });

  it('shrinks in a lower room, and is left out where it would be too small to read', () => {
    const room = { hands: -2, top: 6, reach: 10 };
    const big = fitBlob(10, room)!;
    const low = fitBlob(10, { ...room, top: 3 })!;
    expect(low.r).toBeLessThan(big.r);
    expect(fitBlob(10, { ...room, top: -0.5 })).toBeNull();
  });
});

describe('the wall show on a wall', () => {
  const make = (home: 'box' | 'tiles') => {
    const mat = new THREE.MeshBasicMaterial();
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(16, 7), mat);
    const name = new THREE.Mesh(new THREE.PlaneGeometry(14, 4), new THREE.MeshBasicMaterial());
    name.position.z = 0.03;
    screen.add(name);
    screen.position.set(0, 4.5, 5.6);
    screen.rotation.y = Math.PI;
    const ws = new WallShow(screen, { ...MAIN_WALLS.warehouse, home });
    return { ws, screen, mat, name };
  };
  const step = (ws: WallShow, o: Partial<ShowState>, beats: number) => {
    let beat = o.beat ?? 0;
    for (let i = 0; i < beats * 30; i++) {
      beat += 1 / 30;
      ws.update(show({ ...o, beat, dropHit: false }), 1 / 60);
    }
  };

  it('sits on the wall, starts with everything shown for the shader compile, then hides it all', () => {
    const { ws, screen, mat } = make('box');
    expect(ws.object.position.equals(screen.position)).toBe(true);
    const box = ws.object.children[0];
    expect(box.visible).toBe(true);
    ws.update(show(), 1 / 60);
    expect(box.visible).toBe(false);
    expect(mat.visible).toBe(true);
    expect((ws.object.children[1] as THREE.InstancedMesh).count).toBe(0);
  });

  it('fades the wall into the box and masks its window, then puts it back', () => {
    const { ws, screen, mat } = make('box');
    ws.update(show({ dropHit: true }), 1 / 60);
    step(ws, {}, 2);
    expect(ws.director.fx).toBe('box');
    expect(screen.renderOrder).toBe(-999);
    expect(mat.opacity).toBe(0);
    expect(mat.blending).toBe(THREE.CustomBlending);
    expect(ws.object.children[0].visible).toBe(true);
    step(ws, {}, BOX_END);
    expect(ws.director.fx).toBeNull();
    expect(screen.renderOrder).toBe(0);
    expect(mat.opacity).toBe(1);
    expect(mat.blending).toBe(THREE.NormalBlending);
    expect(ws.object.children[0].visible).toBe(false);
  });

  it('throws the panels towards the crowd and brings them home flat, keeping the name in front', () => {
    const { ws, mat, name } = make('tiles');
    const tiles = ws.object.children[1] as THREE.InstancedMesh;
    ws.update(show({ dropHit: true }), 1 / 60);
    step(ws, {}, 1.5);
    expect(mat.visible).toBe(false);
    expect(tiles.count).toBeGreaterThan(20);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let out = 0;
    for (let i = 0; i < tiles.count; i++) {
      tiles.getMatrixAt(i, m);
      out += p.setFromMatrixPosition(m).z;
    }
    // out into the room (+z in the wall's frame)
    expect(out / tiles.count).toBeGreaterThan(1);
    expect(name.position.z).toBeGreaterThan(0.03);
    step(ws, {}, TILES_END);
    expect(ws.director.fx).toBeNull();
    expect(tiles.count).toBe(0);
    expect(mat.visible).toBe(true);
    expect(name.position.z).toBeCloseTo(0.03, 6);
  });
});
