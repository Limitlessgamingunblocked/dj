import { handleRequest, type CoreState, type WorkerRequest, type WorkerResponse } from './workerCore';

const state: CoreState = { frames: [] };
// Typed against the DOM lib; in a worker, postMessage(message, { transfer }) has the same shape.
const post = (msg: WorkerResponse | { type: 'pong' }, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

self.onmessage = (e: MessageEvent<WorkerRequest | { type: 'ping' }>) => {
  if (e.data.type === 'ping') post({ type: 'pong' });
  else handleRequest(state, e.data, post);
};
