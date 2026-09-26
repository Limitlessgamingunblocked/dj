import { reconstruct, segmentAll, type ReconstructSettings } from './reconstruct';
import { detectDirection, detectRevolution, measureGeometry } from './turntable';
import type { Frame } from './types';

export type WorkerRequest =
  | { type: 'load'; frames: Frame[] }
  | { type: 'analyze'; id: number; floorY: number; sensitivity: number }
  | { type: 'build'; id: number; settings: ReconstructSettings };

export interface Analysis {
  turnFrames: number;
  turnConfident: boolean;
  direction: 1 | -1;
  directionConfident: boolean;
  axisX: number | null;
  radius: number | null;
}

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; fraction: number }
  | { type: 'analysis'; id: number; analysis: Analysis }
  | { type: 'built'; id: number; positions: Float32Array; indices: Uint32Array; voxelSize: number; axisX: number }
  | { type: 'error'; id: number; message: string };

export type Post = (msg: WorkerResponse, transfer?: Transferable[]) => void;

export interface CoreState {
  frames: Frame[];
}

/** The reconstruction work, shared by the Web Worker and the in-page fallback. */
export function handleRequest(state: CoreState, msg: WorkerRequest, post: Post): void {
  if (msg.type === 'load') {
    state.frames = msg.frames;
    return;
  }
  const frames = state.frames;
  try {
    if (msg.type === 'analyze') {
      const rev = detectRevolution(frames, msg.floorY);
      const turn = frames.slice(0, rev.turnFrames);
      const masks = segmentAll(turn, msg.floorY, msg.sensitivity);
      const geom = measureGeometry(masks, msg.floorY);
      const dir = geom ? detectDirection(turn, masks, geom, turn.length) : { direction: 1 as const, confident: false };
      post({
        type: 'analysis',
        id: msg.id,
        analysis: {
          turnFrames: rev.turnFrames,
          turnConfident: rev.confident,
          direction: dir.direction,
          directionConfident: dir.confident,
          axisX: geom?.axisX ?? null,
          radius: geom?.radius ?? null,
        },
      });
    } else if (msg.type === 'build') {
      const r = reconstruct(frames, msg.settings, (stage, fraction) => post({ type: 'progress', id: msg.id, stage, fraction }));
      post(
        { type: 'built', id: msg.id, positions: r.mesh.positions, indices: r.mesh.indices, voxelSize: r.voxelSize, axisX: r.axisX },
        [r.mesh.positions.buffer, r.mesh.indices.buffer],
      );
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
}
