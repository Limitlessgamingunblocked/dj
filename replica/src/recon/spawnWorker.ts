/** Starts the reconstruction worker from its own file. The single-file preview build swaps in spawnWorker.inline.ts. */
export const spawnWorker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
