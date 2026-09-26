import InlineWorker from './worker?worker&inline';

/** Starts the reconstruction worker from a copy bundled into the page (for single-file builds). */
export const spawnWorker = () => new InlineWorker();
