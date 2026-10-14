#!/usr/bin/env node
// Packs ../dist for the desktop app's updater (run after `npm run build`):
//   node desktop/pack-web.mjs <version>
// writes desktop/release/deckhouse-web-<version>.pack.gz and desktop/release/update.json,
// which the release publishes next to the installers.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { pack } = require('./webpack-format.cjs');
const { deckhouseShell } = require('./package.json');

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('usage: pack-web.mjs <version, e.g. 1.0.12>');
const dist = resolve(here, '..', 'dist');
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(dist)
  .map((f) => ({ path: relative(dist, f).split('\\').join('/'), data: readFileSync(f) }))
  .filter((f) => f.path !== 'sw.js' && f.path !== '_headers');
if (!files.some((f) => f.path === 'index.html')) throw new Error('dist/ has no index.html: run npm run build first');

const gz = pack(files);
const file = `deckhouse-web-${version}.pack.gz`;
const out = resolve(here, 'release');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, file), gz);
const info = { version, shell: deckhouseShell, web: { file, size: gz.length, sha256: createHash('sha256').update(gz).digest('hex') } };
writeFileSync(join(out, 'update.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`wrote ${file} (${(gz.length / 1048576).toFixed(1)} MB, ${files.length} files) and update.json`);
