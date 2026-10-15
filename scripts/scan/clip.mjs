// Move a rigged dance onto the DJ body's skeleton (see clip.ts):
//   node scripts/scan/clip.mjs <rigged-with-animation.glb> <name, e.g. all_night>
// Needs the dev server running (npx vite --port 5179); writes src/character/dances/<name>.json.
import fs from 'fs';
import path from 'path';
// (Playwright from the project, or wherever PLAYWRIGHT points)
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');

const [src, name, port = '5179'] = process.argv.slice(2);
if (!src || !/^[a-z0-9_]+$/.test(name ?? '')) {
  console.error('usage: node scripts/scan/clip.mjs <clip.glb> <name>');
  process.exit(1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const tmpDir = path.join(root, '.scan-in');
fs.mkdirSync(tmpDir, { recursive: true });
fs.copyFileSync(src, path.join(tmpDir, 'clip.glb'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('page:', m.text()));
await page.goto(`http://localhost:${port}/scripts/scan/fit.html`);
const out = await page.evaluate(async () => {
  const { retargetClip } = await import('/scripts/scan/clip.ts');
  return retargetClip({ body: '/assets/models/character_dj_body_01.glb', clip: '/.scan-in/clip.glb' });
});
await browser.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
const dir = path.join(root, 'src/character/dances');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${name}.json`);
fs.writeFileSync(file, JSON.stringify({ ...out, name }));
console.log(JSON.stringify({ file, bytes: fs.statSync(file).size, frames: out.frames, bones: out.bones.length, from: out.name }));
