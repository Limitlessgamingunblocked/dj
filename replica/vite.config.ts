import { defineConfig } from 'vite';

// `vite build --mode preview` makes the single-file preview (see scripts/build-preview.mjs):
// accounts kept in the browser, and the worker bundled into the page.
export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  return {
    base: preview ? './' : '/',
    define: {
      __LOCAL_BACKEND__: JSON.stringify(preview),
    },
    resolve: {
      alias: preview ? [{ find: /^(.*)\/spawnWorker$/, replacement: '$1/spawnWorker.inline' }] : [],
    },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1500,
      ...(preview && {
        outDir: 'dist-preview',
        assetsInlineLimit: 100_000_000,
        cssCodeSplit: false,
        modulePreload: false,
        rollupOptions: { output: { inlineDynamicImports: true } },
      }),
    },
    worker: {
      format: 'es',
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      testTimeout: 30000,
    },
  } as never;
});
