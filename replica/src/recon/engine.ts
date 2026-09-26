import { spawnWorker } from './spawnWorker';
import { handleRequest, type CoreState, type WorkerRequest, type WorkerResponse } from './workerCore';

export interface Engine {
  send(msg: WorkerRequest): void;
  terminate(): void;
}

/**
 * Runs reconstruction in a Web Worker so the page stays responsive. If the worker can't start
 * (blocked by the host, or no reply within a few seconds), the same code runs in the page instead.
 */
export function createEngine(onMessage: (msg: WorkerResponse) => void): Engine {
  let mode: 'starting' | 'worker' | 'inline' = 'starting';
  let stopped = false;
  let worker: Worker | null = null;
  let timer = 0;
  const queue: WorkerRequest[] = [];
  const state: CoreState = { frames: [] };

  const runInline = (msg: WorkerRequest) =>
    setTimeout(() => {
      if (!stopped) handleRequest(state, msg, onMessage);
    }, 0);
  const fallBack = () => {
    if (mode !== 'starting') return;
    mode = 'inline';
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
    for (const m of queue.splice(0)) runInline(m);
  };

  try {
    worker = spawnWorker();
    worker.onmessage = (e: MessageEvent<WorkerResponse | { type: 'pong' }>) => {
      if (e.data.type === 'pong') {
        if (mode !== 'starting') return;
        mode = 'worker';
        clearTimeout(timer);
        for (const m of queue.splice(0)) worker!.postMessage(m);
        return;
      }
      onMessage(e.data);
    };
    worker.onerror = fallBack;
    worker.postMessage({ type: 'ping' });
    timer = window.setTimeout(fallBack, 5000);
  } catch {
    fallBack();
  }

  return {
    send(msg) {
      if (stopped) return;
      if (mode === 'worker') worker!.postMessage(msg);
      else if (mode === 'inline') runInline(msg);
      else queue.push(msg);
    },
    terminate() {
      stopped = true;
      clearTimeout(timer);
      worker?.terminate();
    },
  };
}
