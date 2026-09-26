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

let frames: Frame[] = [];
// Typed against the DOM lib; in a worker, postMessage(message, { transfer }) has the same shape.
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    frames = msg.frames;
    return;
  }
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
};
