import { carve, countSolid } from './carve';
import { blurField, flattenBase, surfaceNets, taubinSmooth } from './mesh';
import { estimateBackground, segmentFrame } from './segment';
import { measureGeometry } from './turntable';
import type { Frame, Mask, Mesh } from './types';

export interface ReconstructSettings {
  floorY: number;
  sensitivity: number;
  /** Frames that make up one full turn, counted from the first frame. */
  turnFrames: number;
  direction: 1 | -1;
  elevationDeg: number;
  resolution: number;
  tolerance: number;
  /** Overrides the automatically found axis position (pixels), if set. */
  axisX?: number;
  /** Taubin smoothing passes on the final mesh. */
  smoothing: number;
  /** Extra blur passes on the voxel field before meshing (0 = sharpest). */
  fieldBlur?: number;
}

export interface ReconstructResult {
  /** In image pixels, Y-up, base at y = 0. */
  mesh: Mesh;
  voxelSize: number;
  solidVoxels: number;
  axisX: number;
}

export type Progress = (stage: string, fraction: number) => void;

export function segmentAll(frames: Frame[], floorY: number, sensitivity: number, progress?: Progress): Mask[] {
  const masks: Mask[] = [];
  for (let i = 0; i < frames.length; i++) {
    // Re-estimate the backdrop per frame so auto-exposure drift doesn't matter.
    const bg = estimateBackground(frames[i], floorY);
    masks.push(segmentFrame(frames[i], bg, { floorY, sensitivity }));
    progress?.('Finding the item in each frame', (i + 1) / frames.length);
  }
  return masks;
}

export function reconstruct(frames: Frame[], s: ReconstructSettings, progress?: Progress): ReconstructResult {
  const turn = frames.slice(0, Math.max(3, Math.min(frames.length, s.turnFrames)));
  const masks = segmentAll(turn, s.floorY, s.sensitivity, progress);
  const geom = measureGeometry(masks, s.floorY);
  if (!geom) throw new Error("Couldn't find the item in the video. Try a higher background sensitivity or a plainer backdrop.");
  if (s.axisX !== undefined) {
    geom.radius += Math.abs(s.axisX - geom.axisX);
    geom.axisX = s.axisX;
  }
  // Angles assume the turntable spins at a steady speed.
  const angles = turn.map((_, i) => (s.direction * 2 * Math.PI * i) / turn.length);
  const grid = carve(masks, angles, { ...geom, elevationDeg: s.elevationDeg, resolution: s.resolution, tolerance: s.tolerance }, (f) =>
    progress?.('Carving the 3D shape', f),
  );
  const solidVoxels = countSolid(grid);
  if (solidVoxels < 8) throw new Error('Nothing was left after carving. Check that the video covers exactly one full turn and the spin direction is right.');
  progress?.('Building the surface', 0);
  let field = grid.field;
  for (let i = 0; i < (s.fieldBlur ?? 0); i++) field = blurField(field, grid);
  const mesh = surfaceNets(field, grid);
  progress?.('Smoothing', 0.5);
  const pinned = flattenBase(mesh, grid.voxelSize * 0.75);
  taubinSmooth(mesh, s.smoothing, pinned);
  progress?.('Smoothing', 1);
  return { mesh, voxelSize: grid.voxelSize, solidVoxels, axisX: geom.axisX };
}
