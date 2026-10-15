/*
 * Keeps the desktop game up to date by itself.
 *
 * The app is a shell (main.cjs) around the game's web files, and nearly every
 * update only changes those files. So instead of replacing the app (which
 * macOS only allows for apps signed with an Apple certificate), the updater
 * downloads the newest game files from the latest GitHub release into the
 * app's data folder and plays from there: in the background, a few seconds
 * after launch and every few hours. When one is ready it asks to restart the
 * game now, or it starts the next time the app opens.
 *
 * If a release needs a newer shell (deckhouseShell in package.json went up),
 * it offers to download the new installer instead.
 */
const { app, dialog, net, shell } = require('electron');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { unpack } = require('./webpack-format.cjs');

const SHELL = require('./package.json').deckhouseShell || 1;
/** a one-off build (deckhouseUpdates: false) plays its own game files and never updates */
const OFF = require('./package.json').deckhouseUpdates === false;
const RELEASES = 'https://github.com/Limitlessgamingunblocked/dj/releases/latest';
const FEED = process.env.DECKHOUSE_UPDATE_FEED || `${RELEASES}/download/update.json`;
const EVERY = 6 * 60 * 60 * 1000;

const dataDir = () => path.join(app.getPath('userData'), 'web');
const stateFile = () => path.join(app.getPath('userData'), 'update-state.json');

/** compares dotted versions: >0 when a is newer */
function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** the game files to play: a downloaded update when it's newer than the ones the app came with */
function currentWeb(bundled) {
  const own = { root: bundled, version: app.getVersion() };
  if (OFF) return own;
  const cur = readJson(path.join(dataDir(), 'current.json'));
  if (!cur || typeof cur.version !== 'string' || newer(cur.version, own.version) <= 0) return own;
  const root = path.join(dataDir(), cur.version);
  return fs.existsSync(path.join(root, 'index.html')) ? { root, version: cur.version } : own;
}

async function fetchOk(url) {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/** downloads and unpacks one update; resolves to its folder */
async function install(info, feedUrl, inUse) {
  const res = await fetchOk(new URL(info.web.file, feedUrl).href);
  const gz = Buffer.from(await res.arrayBuffer());
  if (gz.length !== info.web.size || createHash('sha256').update(gz).digest('hex') !== info.web.sha256) throw new Error('update download is damaged');
  const files = unpack(gz);
  if (!files.some((f) => f.path === 'index.html')) throw new Error('update has no index.html');
  const base = dataDir();
  const dir = path.join(base, info.version);
  const part = `${dir}.part`;
  fs.rmSync(part, { recursive: true, force: true });
  for (const f of files) {
    const out = path.join(part, ...f.path.split('/'));
    if (!out.startsWith(part + path.sep)) throw new Error(`bad path in update: ${f.path}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, f.data);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(part, dir);
  fs.writeFileSync(path.join(base, 'current.json'), JSON.stringify({ version: info.version }));
  // older downloads (keeping the one playing right now)
  for (const name of fs.readdirSync(base)) {
    const p = path.join(base, name);
    if (name !== 'current.json' && p !== dir && p !== inUse) fs.rmSync(p, { recursive: true, force: true });
  }
  return dir;
}

/**
 * Starts checking for updates.
 *   getWeb()      the game files playing now ({ root, version })
 *   apply(web)    switch to new game files and reload the game
 *   parent()      the window to anchor the prompts to
 */
function startUpdates({ getWeb, apply, parent }) {
  if (OFF) return;
  let busy = false;
  /** downloaded, waiting for the next launch ("Later") */
  let pending = null;
  const state = readJson(stateFile()) || {};
  const save = () => fs.writeFileSync(stateFile(), JSON.stringify(state));
  const ask = (opts) => {
    const w = parent();
    return w && !w.isDestroyed() ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts);
  };

  async function check() {
    if (busy) return;
    busy = true;
    try {
      const res = await fetchOk(FEED);
      const info = await res.json();
      const web = getWeb();
      if (!info || typeof info.version !== 'string' || newer(info.version, web.version) <= 0 || info.version === pending) return;
      if ((info.shell || 1) > SHELL) {
        if (state.offeredShell === info.version) return;
        state.offeredShell = info.version;
        save();
        const { response } = await ask({
          type: 'info',
          buttons: ['Download it', 'Not now'],
          defaultId: 0,
          cancelId: 1,
          message: 'A new version of the Deckhouse DJ app is out',
          detail: `Version ${info.version} needs a fresh install of the app itself. Your library, career and settings stay as they are.`,
        });
        if (response === 0) shell.openExternal(RELEASES);
        return;
      }
      const dir = await install(info, res.url || FEED, web.root);
      pending = info.version;
      const { response } = await ask({
        type: 'info',
        buttons: ['Restart the game now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: `Deckhouse DJ ${info.version} is ready`,
        detail: 'Restart the game to play it now (your library, career and settings stay), or it starts the next time you open the app.',
      });
      if (response === 0) apply({ root: dir, version: info.version });
    } catch (err) {
      // offline, no release yet, or a bad download: try again later
      console.warn('update check:', err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  }

  setTimeout(check, 8000);
  setInterval(check, EVERY);
}

module.exports = { currentWeb, startUpdates, newer };
