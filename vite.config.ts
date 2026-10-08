import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
