#!/usr/bin/env node
// Rebuilds ASSETS.md (Section 14.8) from the export reports that
// scripts/blender/export_glb.py writes next to each model, plus
// assets/status.json for what's been tested in the engine:
//   { "board_fader_long_01": { "tested": true, "notes": "…" } }
//   node scripts/assets-report.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const models = resolve(root, 'assets/models');
const previews = resolve(root, 'assets/previews');
const statusFile = resolve(root, 'assets/status.json');
const status = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) : {};
const reports = existsSync(models)
  ? readdirSync(models)
      .filter((f) => f.endsWith('.report.json'))
      .map((f) => JSON.parse(readFileSync(resolve(models, f), 'utf8')))
      .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))
  : [];

const yn = (b) => (b ? 'Y' : 'N');
const rows = reports.map((r) => {
  const preview = existsSync(resolve(previews, `${r.name}.png`)) ? `[png](assets/previews/${r.name}.png)` : '—';
  const tris = r.budget ? `${r.triangles.toLocaleString('en')} / ${r.budget.toLocaleString('en')}${r.overBudget ? ' ⚠' : ''}` : r.triangles.toLocaleString('en');
  const zones = [r.zones?.length ? `zones ${r.zones.join(',')}` : '', r.nameSurface ? 'name_surface' : ''].filter(Boolean).join(' · ') || '—';
  return `| \`${r.name}\` | ${r.category ?? '?'} | ${tris} | ${r.lods?.length ? r.lods.map((l) => `LOD${l}`).join(' ') : '—'} | ${yn(r.rigged)} | ${zones} | ${preview} | ${yn(status[r.name]?.tested)} | ${r.problems?.length ? r.problems.join('; ') : ''} |`;
});

const md = `# Assets

Every 3D asset in the game (Section 14.8). **Generated** by \`node scripts/assets-report.mjs\` from the export reports in \`assets/models/\`; edit \`assets/status.json\` to mark an asset tested in the engine. Pipeline rules: \`assets_source/blender/README.md\`. Budgets: \`scripts/blender/budgets.json\`.

| Asset | Category | Triangles / budget | LODs | Rigged | Customisable | Preview | In-engine tested | Problems |
|---|---|---:|---|---|---|---|---|---|
${rows.length ? rows.join('\n') : '| _none yet_ | | | | | | | | |'}

${rows.length ? '' : '**No modelled assets yet.** Everything the player sees is still procedural (built in code). Modelling needs Blender access; see TODO.md.\n'}`;
writeFileSync(resolve(root, 'ASSETS.md'), md);
console.log(`ASSETS.md: ${reports.length} asset(s)`);
