// Builds a single self-contained HTML page of the app (no server needed) for hosting as a
// claude.ai artifact or any static host. Accounts and saved models live in the browser.
//   node scripts/build-preview.mjs [output.html]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'dist-preview', 'replica-preview.html'));
await build({ root, mode: 'preview', logLevel: 'warn' });

const dist = join(root, 'dist-preview');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const scriptSrc = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
const cssHref = html.match(/<link[^>]+rel="stylesheet"[^>]+href="(\.\/assets\/[^"]+)"/)?.[1] ?? html.match(/href="(\.\/assets\/[^"]+\.css)"/)?.[1];
if (!scriptSrc || !cssHref) throw new Error('Could not find the built script and stylesheet.');
const js = readFileSync(join(dist, scriptSrc), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(dist, cssHref), 'utf8').replace(/<\/style/gi, '<\\/style');
const fonts = html.match(/<link[^>]+fonts\.googleapis\.com\/css2[^>]+>/)?.[0] ?? '';

// Page content only: the host wraps it in its own <!doctype html><head><body>.
const page = `<title>Replica</title>
<meta name="description" content="Upload a video of an item and get a true-to-size, print-ready STL file.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>${css}</style>
<div id="app"></div>
<script type="module">${js}</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`Wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
