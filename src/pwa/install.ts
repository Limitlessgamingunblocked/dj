/*
 * Installing the game: the offline cache (sw.js, written by the build) and
 * the browser's own "install this app" prompt, which Settings → Install the
 * game offers as a button. The desktop app (desktop/) runs the same build in
 * its own window and needs neither.
 */

/** the desktop app's GitHub release page */
export const DESKTOP_DOWNLOADS = 'https://github.com/Limitlessgamingunblocked/dj/releases/latest';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState =
  /** running as the desktop app */
  | 'desktop'
  /** running as an installed web app (its own window) */
  | 'installed'
  /** the browser offers to install: promptInstall() shows its dialog */
  | 'ready'
  /** no prompt (yet): Safari, Firefox, already installed, or a page that can't be installed */
  | 'manual';

let deferred: InstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export function isDesktopApp(): boolean {
  return typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent) && /\bDeckhouseDJ\//.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function installState(): InstallState {
  if (isDesktopApp()) return 'desktop';
  if (isStandalone() || justInstalled) return 'installed';
  return deferred ? 'ready' : 'manual';
}

/** shows the browser's install dialog; true if the player said yes */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === 'accepted') justInstalled = true;
  changed();
  return outcome === 'accepted';
}

export function onInstallChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** how to install by hand in browsers that don't offer a prompt */
export function manualInstallHint(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'In Safari, tap Share, then Add to Home Screen.';
  if (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'In Safari on a Mac, choose File → Add to Dock.';
  if (/Firefox\//.test(ua)) return "Firefox can't install web apps: open this page in Chrome or Edge to install it, or get the desktop app.";
  return 'Open the browser menu and choose Install Deckhouse DJ (in Chrome: ⋮ → Cast, save and share → Install page as app).';
}

/** call once at startup */
export function setupInstall(): void {
  if (typeof window === 'undefined' || isDesktopApp()) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    changed();
  });
  // the offline cache: only for the real build served over http(s) (not the dev server, test browsers or
  // the single-file build, which has no manifest and nothing beside it to cache)
  const servable = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const manifest = !!document.querySelector('link[rel="manifest"]');
  if (import.meta.env.PROD && servable && manifest && 'serviceWorker' in navigator && !navigator.webdriver) {
    const register = () => navigator.serviceWorker.register('sw.js').catch((err) => console.warn('offline cache unavailable', err));
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
}
