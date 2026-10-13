import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { serviceWorkerSource } from './src/pwa/swSource';

/** writes sw.js (the installed game's offline cache) next to the finished build */
function offlineWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'deckhouse-offline-worker',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      // the single-file build runs from one page with nowhere to cache from
      if (process.env.DECKHOUSE_SINGLE) return;
      const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
      const files = walk(outDir).filter((f) => !f.endsWith('sw.js'));
      const hash = createHash('sha256');
      for (const f of files.sort()) hash.update(relative(outDir, f)).update(readFileSync(f));
      writeFileSync(join(outDir, 'sw.js'), serviceWorkerSource(files.map((f) => relative(outDir, f)), hash.digest('hex').slice(0, 12)));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [offlineWorker()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    // the single-file build (scripts/build-single.mjs) carries 3D models inline; the normal build ships them as files
    assetsInlineLimit: (file: string) => (process.env.DECKHOUSE_SINGLE && file.endsWith('.glb') ? true : undefined),
  },
  worker: {
    format: 'iife',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as never);
