#!/usr/bin/env node
// Builds a single self-contained HTML file (JS, CSS, workers and the Wasm DSP
// inlined) for hosts that serve one page, e.g. a claude.ai Artifact.
//   node scripts/build-single.mjs [--fragment]
// --fragment omits <!doctype>/<html>/<head>/<body> for hosts that wrap the page.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fragment = process.argv.includes('--fragment');
execFileSync('npx', ['vite', 'build', '--outDir', 'dist-single', '--emptyOutDir'], { cwd: root, stdio: 'inherit' });

const dist = resolve(root, 'dist-single');
const assets = resolve(dist, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`expected a single JS chunk, found ${js.join(', ')}`);

const script = readFileSync(resolve(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const style = css.map((f) => readFileSync(resolve(assets, f), 'utf8')).join('\n');
const fonts =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800;900&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">';

const body = `<div id="app"></div>\n<script type="module">\n${script}\n</script>`;
const head = `<title>Deckhouse DJ</title>\n<meta name="theme-color" content="#07090d">\n${fonts}\n<style>\n${style}\n</style>`;
const html = fragment
  ? `${head}\n${body}\n`
  : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

mkdirSync(dist, { recursive: true });
const out = resolve(dist, fragment ? 'deckhouse-fragment.html' : 'deckhouse.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
