import { describe, expect, it } from 'vitest';
import { carve } from '../src/recon/carve';
import { bounds, flattenBase, scaleMesh, signedVolume, surfaceArea, surfaceNets, taubinSmooth } from '../src/recon/mesh';
import { reconstruct } from '../src/recon/reconstruct';
import { estimateBackground, maskBounds, segmentFrame } from '../src/recon/segment';
import { fromBinaryStl, toBinaryStl } from '../src/recon/stl';
import { detectDirection, detectRevolution, guessFloorLine, measureGeometry } from '../src/recon/turntable';
import type { Mesh } from '../src/recon/types';
import { maskToFrame, prismMask, sphereMask, type Prism } from './synthetic';

const W = 240;
const H = 200;
const AXIS = 118;
const FLOOR = 180;

function turn(n: number, direction = 1) {
  return Array.from({ length: n }, (_, i) => (direction * 2 * Math.PI * i) / n);
}

function boxMeshFromMasks(prism: Prism, resolution = 96) {
  const angles = turn(72);
  const masks = angles.map((a) => prismMask(prism, a, W, H, AXIS, FLOOR));
  const geom = measureGeometry(masks, FLOOR)!;
  const grid = carve(masks, angles, { ...geom, elevationDeg: 0, resolution, tolerance: 1 });
  const mesh = surfaceNets(grid.field, grid);
  return { geom, grid, mesh };
}

/** Every edge must be shared by exactly two triangles, in opposite directions. */
function edgeReport(mesh: Mesh) {
  const edges = new Map<string, number>();
  const ix = mesh.indices;
  for (let t = 0; t < ix.length; t += 3) {
    for (let q = 0; q < 3; q++) {
      const a = ix[t + q];
      const b = ix[t + ((q + 1) % 3)];
      const key = `${a},${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let unmatched = 0;
  let duplicated = 0;
  for (const [key, n] of edges) {
    const [a, b] = key.split(',');
    if (n > 1) duplicated++;
    if (!edges.has(`${b},${a}`)) unmatched++;
  }
  return { unmatched, duplicated };
}

describe('space carving', () => {
  it('recovers a box with the right proportions and orientation', () => {
    // 80 wide (X), 30 deep (Z), 100 tall, centred on the axis.
    const prism: Prism = { polygon: [[-40, -15], [40, -15], [40, 15], [-40, 15]], height: 100 };
    const { mesh, grid } = boxMeshFromMasks(prism);
    const { min, max } = bounds(mesh);
    const vs = grid.voxelSize;
    expect(Math.abs(max[0] - min[0] - 80)).toBeLessThan(vs * 2.5);
    expect(Math.abs(max[2] - min[2] - 30)).toBeLessThan(vs * 2.5);
    expect(Math.abs(max[1] - min[1] - 100)).toBeLessThan(vs * 2.5);
    const vol = signedVolume(mesh);
    expect(vol).toBeGreaterThan(0);
    expect(Math.abs(vol / (80 * 30 * 100) - 1)).toBeLessThan(0.1);
  });

  it('puts an off-centre item on the correct side (spin direction handled)', () => {
    // A 20×20 column centred at X = +30, Z = +20 in the first frame.
    const prism: Prism = { polygon: [[20, 10], [40, 10], [40, 30], [20, 30]], height: 60 };
    for (const direction of [1, -1] as const) {
      const angles = turn(90, direction);
      const masks = angles.map((a) => prismMask(prism, a, W, H, AXIS, FLOOR));
      const geom = measureGeometry(masks, FLOOR)!;
      expect(geom.axisX).toBeCloseTo(AXIS, 0);
      const grid = carve(masks, angles, { ...geom, elevationDeg: 0, resolution: 96, tolerance: 1 });
      const mesh = surfaceNets(grid.field, grid);
      const { min, max } = bounds(mesh);
      expect((min[0] + max[0]) / 2).toBeCloseTo(30, -0.5);
      expect((min[2] + max[2]) / 2).toBeCloseTo(20, -0.5);
    }
  });

  it('produces a closed, consistently oriented surface', () => {
    const angles = turn(48);
    const masks = angles.map(() => sphereMask(50, 55, W, H, AXIS, FLOOR));
    const geom = measureGeometry(masks, FLOOR)!;
    const grid = carve(masks, angles, { ...geom, elevationDeg: 0, resolution: 64, tolerance: 1 });
    const mesh = surfaceNets(grid.field, grid);
    expect(edgeReport(mesh)).toEqual({ unmatched: 0, duplicated: 0 });
    const vol = signedVolume(mesh);
    const expected = (4 / 3) * Math.PI * 50 ** 3;
    expect(Math.abs(vol / expected - 1)).toBeLessThan(0.08);
    const area = surfaceArea(mesh);
    expect(Math.abs(area / (4 * Math.PI * 50 ** 2) - 1)).toBeLessThan(0.12);
  });

  it('smoothing keeps volume and the flattened base sits at y = 0', () => {
    const prism: Prism = { polygon: [[-40, -15], [40, -15], [40, 15], [-40, 15]], height: 100 };
    const { mesh, grid } = boxMeshFromMasks(prism);
    const before = signedVolume(mesh);
    const pinned = flattenBase(mesh, grid.voxelSize * 0.75);
    taubinSmooth(mesh, 6, pinned);
    expect(Math.abs(signedVolume(mesh) / before - 1)).toBeLessThan(0.05);
    expect(bounds(mesh).min[1]).toBeCloseTo(0, 5);
  });

  it('a noise-tolerant carve ignores a single bad frame', () => {
    const prism: Prism = { polygon: [[-30, -30], [30, -30], [30, 30], [-30, 30]], height: 80 };
    const angles = turn(60);
    const masks = angles.map((a) => prismMask(prism, a, W, H, AXIS, FLOOR));
    // One frame with a bite missing from the silhouette.
    const bad = masks[10];
    for (let y = 120; y < 150; y++) for (let x = 90; x < 150; x++) bad.data[y * W + x] = 0;
    const geom = measureGeometry(masks, FLOOR)!;
    const strict = carve(masks, angles, { ...geom, elevationDeg: 0, resolution: 64, tolerance: 1 });
    const tolerant = carve(masks, angles, { ...geom, elevationDeg: 0, resolution: 64, tolerance: 2 });
    const vol = (g: typeof strict) => signedVolume(surfaceNets(g.field, g));
    expect(vol(tolerant)).toBeGreaterThan(vol(strict) * 1.05);
  });
});

describe('segmentation', () => {
  it('separates the item from a plain backdrop, ignoring the area below the floor line', () => {
    const truth = sphereMask(50, 60, W, H, AXIS, FLOOR);
    const frame = maskToFrame(truth, { noise: 8 });
    // A grey turntable below the floor line.
    for (let y = FLOOR; y < H; y++) for (let x = 40; x < 200; x++) frame.data.fill(90, (y * W + x) * 4, (y * W + x) * 4 + 3);
    const bg = estimateBackground(frame, FLOOR);
    const mask = segmentFrame(frame, bg, { floorY: FLOOR, sensitivity: 0.5 });
    let inter = 0;
    let union = 0;
    for (let i = 0; i < mask.data.length; i++) {
      inter += mask.data[i] & truth.data[i];
      union += mask.data[i] | truth.data[i];
    }
    expect(inter / union).toBeGreaterThan(0.95);
    expect(maskBounds(mask)!.bottom).toBeLessThanOrEqual(FLOOR);
  });

  it('keeps a real opening (like a handle) but fills pinholes', () => {
    const truth = prismMask({ polygon: [[-60, -10], [60, -10], [60, 10], [-60, 10]], height: 120 }, 0, W, H, AXIS, FLOOR);
    // Big window (a handle opening) and a 2×2 pinhole.
    for (let y = 90; y < 130; y++) for (let x = 90; x < 140; x++) truth.data[y * W + x] = 0;
    const frame = maskToFrame(truth, { noise: 2 });
    for (let y = 70; y < 72; y++) for (let x = 150; x < 152; x++) frame.data.set([235, 236, 240], (y * W + x) * 4);
    const mask = segmentFrame(frame, estimateBackground(frame, FLOOR), { floorY: FLOOR, sensitivity: 0.5 });
    expect(mask.data[110 * W + 115]).toBe(0);
    expect(mask.data[70 * W + 150]).toBe(1);
  });
});

describe('turntable analysis', () => {
  const prism: Prism = { polygon: [[-50, -12], [50, -12], [50, 12], [-50, 12]], height: 110 };
  const stripes = (x: number) => 0.6 + 0.4 * Math.sin(x * 0.9);

  it('finds one full turn in a longer clip', () => {
    // 60 frames per turn, clip runs 1.4 turns.
    const lopsided: Prism = { polygon: [[-50, -10], [40, -20], [55, 15], [-20, 25]], height: 110 };
    const frames = Array.from({ length: 84 }, (_, i) => maskToFrame(prismMask(lopsided, (2 * Math.PI * i) / 60 + 0.3, W, H, AXIS, FLOOR)));
    const rev = detectRevolution(frames, FLOOR);
    expect(rev.confident).toBe(true);
    expect(rev.turnFrames).toBe(60);
  });

  it('detects which way the item spins from surface texture', () => {
    for (const direction of [1, -1] as const) {
      // Texture that moves with the item: stripes on the camera-facing side slide with the rotation.
      const frames = Array.from({ length: 40 }, (_, i) => {
        const angle = (direction * 2 * Math.PI * i) / 120;
        const mask = prismMask(prism, angle, W, H, AXIS, FLOOR);
        const offset = direction * i * 3;
        return maskToFrame(mask, { stripes: (x) => stripes(x - offset), noise: 1 });
      });
      const masks = frames.map((f) => segmentFrame(f, estimateBackground(f, FLOOR), { floorY: FLOOR, sensitivity: 0.5 }));
      const geom = measureGeometry(masks, FLOOR)!;
      const res = detectDirection(frames, masks, geom, frames.length);
      expect(res.direction).toBe(direction);
    }
  });
});

describe('floor line guess', () => {
  it('finds the top of a turntable platter under the item', () => {
    const item = sphereMask(50, 60, W, H, AXIS, FLOOR);
    // Platter: 150 px wide, 8 px tall band just below the floor line.
    for (let y = FLOOR; y < FLOOR + 8; y++) for (let x = AXIS - 75; x < AXIS + 75; x++) item.data[y * W + x] = 1;
    expect(Math.abs(guessFloorLine(item) - FLOOR)).toBeLessThanOrEqual(1);
  });

  it('uses the bottom of the item when there is no platter in view', () => {
    const item = prismMask({ polygon: [[-30, -30], [30, -30], [30, 30], [-30, 30]], height: 90 }, 0.4, W, H, AXIS, FLOOR);
    expect(guessFloorLine(item)).toBe(FLOOR);
  });
});

describe('end to end', () => {
  it('reconstructs from colour frames and scales to a real measurement', () => {
    const prism: Prism = { polygon: [[-36, -24], [36, -24], [36, 24], [-36, 24]], height: 96 };
    const frames = turn(64).map((a) => maskToFrame(prismMask(prism, a, W, H, AXIS, FLOOR)));
    const result = reconstruct(frames, {
      floorY: FLOOR,
      sensitivity: 0.5,
      turnFrames: 64,
      direction: 1,
      elevationDeg: 0,
      resolution: 96,
      tolerance: 2,
      smoothing: 4,
    });
    const b = bounds(result.mesh);
    const height = b.max[1] - b.min[1];
    // The user says the item is 150 mm tall.
    const mm = scaleMesh(result.mesh, 150 / height);
    const s = bounds(mm);
    expect(s.max[1] - s.min[1]).toBeCloseTo(150, 3);
    expect(Math.abs((s.max[0] - s.min[0]) / 150 - 72 / 96)).toBeLessThan(0.04);
    expect(Math.abs((s.max[2] - s.min[2]) / 150 - 48 / 96)).toBeLessThan(0.04);
  });
});

describe('STL', () => {
  it('writes a valid binary STL that reads back identically', () => {
    const angles = turn(24);
    const masks = angles.map(() => sphereMask(30, 35, W, H, AXIS, FLOOR));
    const geom = measureGeometry(masks, FLOOR)!;
    const grid = carve(masks, angles, { ...geom, elevationDeg: 0, resolution: 32, tolerance: 1 });
    const mesh = surfaceNets(grid.field, grid);
    const stl = toBinaryStl(mesh, 'ball');
    const tris = mesh.indices.length / 3;
    expect(stl.byteLength).toBe(84 + tris * 50);
    expect(new DataView(stl).getUint32(80, true)).toBe(tris);
    const back = fromBinaryStl(stl);
    expect(signedVolume(back)).toBeCloseTo(signedVolume(mesh), 0);
    // Z-up: the sphere's centre height ends up on the STL's Z axis.
    const view = new DataView(stl);
    let maxZ = -Infinity;
    for (let t = 0; t < tris; t++) for (let q = 0; q < 3; q++) maxZ = Math.max(maxZ, view.getFloat32(84 + t * 50 + 12 + q * 12 + 8, true));
    expect(maxZ).toBeCloseTo(bounds(mesh).max[1], 3);
  });
});
