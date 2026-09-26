import { defineConfig } from 'vite';

// Run from the repo root: `npm run dev:gta` / `npm run build:gta`.
export default defineConfig({
  root: __dirname,
  base: './',
  build: {
    target: 'es2022',
    outDir: '../dist-gta-good',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
