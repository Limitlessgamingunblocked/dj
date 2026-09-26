#!/usr/bin/env node
// Builds GTA Good as one self-contained HTML file (JS and CSS inlined) that opens straight from disk.
//   node scripts/build-gta-single.mjs   →  GTA-Good.html at the repo root
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist-gta-single');
execFileSync('npx', ['vite', 'build', '--config', 'gta-good/vite.config.ts', '--outDir', outDir, '--emptyOutDir'], { cwd: root, stdio: 'inherit' });

const assets = resolve(outDir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js'));
if (js.length !== 1) throw new Error(`expected a single JS chunk, found ${js.join(', ')}`);
const script = readFileSync(resolve(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const style = files
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(resolve(assets, f), 'utf8'))
  .join('\n');

const fonts =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">';
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>GTA Good</title>
<meta name="theme-color" content="#0b0f14">
${fonts}
<style>
${style}
</style>
</head>
<body>
<div id="app"></div>
<script type="module">
${script}
</script>
</body>
</html>
`;
const out = resolve(root, 'GTA-Good.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
