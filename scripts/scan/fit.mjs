// Fit a generated character onto the DJ body's skeleton (see fit.ts):
//   node scripts/scan/fit.mjs <character.glb> <asset name, e.g. character_scan_minimal_01>
// Needs the dev server running (npx vite --port 5179); writes assets/models/<name>.glb.
import fs from 'fs';
import path from 'path';
// (Playwright from the project, or wherever PLAYWRIGHT points)
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');

const [src, name, port = '5179'] = process.argv.slice(2);
if (!src || !/^character_[a-z0-9]+(_[a-z0-9]+)*_\d{2}$/.test(name ?? '')) {
  console.error('usage: node scripts/scan/fit.mjs <character.glb> character_<item>_<variant>_<##>');
  process.exit(1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const tmpDir = path.join(root, '.scan-in');
fs.mkdirSync(tmpDir, { recursive: true });
fs.copyFileSync(src, path.join(tmpDir, 'in.glb'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('page:', m.text()));
await page.goto(`http://localhost:${port}/scripts/scan/fit.html`);
const out = await page.evaluate(async () => {
  const { fitScan } = await import('/scripts/scan/fit.ts');
  const r = await fitScan({ body: '/assets/models/character_dj_body_01.glb', scan: '/.scan-in/in.glb' });
  const bytes = new Uint8Array(r.glb);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ...r, glb: btoa(bin) };
});
await browser.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
const file = path.join(root, 'assets/models', `${name}.glb`);
fs.writeFileSync(file, Buffer.from(out.glb, 'base64'));
console.log(JSON.stringify({ file, bytes: fs.statSync(file).size, vertices: out.vertices, triangles: out.triangles, height: out.height, turned: out.turned, hands: out.hands, scanBones: out.scanBones }, null, 1));
