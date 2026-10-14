/*
 * Deckhouse DJ, the desktop game: the same build the website serves
 * (../dist, packed into the app as resources/web), in its own window.
 *
 * The files load from app://deckhouse/ rather than file://, so the page
 * gets a real origin: its library, career and settings persist between
 * launches, and the audio worklets, Web MIDI (DJ controllers), the camera
 * (Air DJ) and the sound card picker all work as they do in Chrome.
 *
 * updater.cjs keeps the game files up to date from the latest release.
 */
const { app, BrowserWindow, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'deckhouse';
const ORIGIN = `${SCHEME}://${HOST}`;
const { currentWeb, startUpdates } = require('./updater.cjs');

const BUNDLED = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'dist');
/** the game files being served: the ones the app came with, or a newer downloaded update */
let web = { root: BUNDLED, version: app.getVersion() };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

/* what the page may use: everything a DJ game needs, for its own pages only */
const ALLOWED = new Set(['media', 'midi', 'midiSysex', 'fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'clipboard-read', 'speaker-selection', 'persistent-storage', 'notifications', 'window-management']);
const ours = (url) => typeof url === 'string' && url.startsWith(ORIGIN);

async function serve(req) {
  const url = new URL(req.url);
  if (url.host !== HOST) return new Response('Not found', { status: 404 });
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const root = web.root;
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
  try {
    const data = await fs.readFile(file);
    return new Response(data, { headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

let main = null;

function windowOptions(extra = {}) {
  return {
    backgroundColor: '#07090d',
    title: 'Deckhouse DJ',
    autoHideMenuBar: true,
    show: false,
    ...extra,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // a DJ game keeps playing when it isn't the front window
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  };
}

function wire(win) {
  win.once('ready-to-show', () => win.show());
  // the VJ controls window opens as another game window; links (Spotify, Apple Music, GitHub) open in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ours(url)) return { action: 'allow', overrideBrowserWindowOptions: windowOptions({ width: 900, height: 800, show: true }) };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => wire(child));
  win.webContents.on('will-navigate', (e, url) => {
    if (ours(url)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
}

function createWindow() {
  main = new BrowserWindow(windowOptions({ width: 1440, height: 900, minWidth: 960, minHeight: 600 }));
  wire(main);
  main.on('closed', () => (main = null));
  main.loadURL(`${ORIGIN}/`);
}

app.on('second-instance', () => {
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.focus();
});

app.whenReady().then(() => {
  web = currentWeb(BUNDLED);
  // tells the page it's the desktop app (Settings shows that instead of the install button)
  app.userAgentFallback = `${app.userAgentFallback} DeckhouseDJ/${web.version}`;
  protocol.handle(SCHEME, serve);
  const s = session.defaultSession;
  s.setPermissionRequestHandler((wc, permission, done) => done(ours(wc.getURL()) && ALLOWED.has(permission)));
  s.setPermissionCheckHandler((wc, permission, origin) => ALLOWED.has(permission) && (ours(origin) || (wc ? ours(wc.getURL()) : false)));
  createWindow();
  // only the packed app updates itself (npm start runs ../dist as it is)
  if (app.isPackaged || process.env.DECKHOUSE_UPDATE_FEED)
    startUpdates({
      getWeb: () => web,
      apply: (next) => {
        web = next;
        for (const w of BrowserWindow.getAllWindows()) w.webContents.reloadIgnoringCache();
      },
      parent: () => main,
    });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
