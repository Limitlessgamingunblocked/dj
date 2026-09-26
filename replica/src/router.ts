let handler: () => void = () => undefined;
let current = readHash() ?? '/';

function readHash(): string | null {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : null;
}

/** The current route, e.g. "/models". */
export const currentPath = () => current;

/**
 * Routes live in memory and are mirrored to the URL hash where the host allows it, so the app
 * also works inside frames that don't pass hash changes through.
 */
export function onRoute(fn: () => void) {
  handler = fn;
  window.addEventListener('popstate', () => {
    const h = readHash();
    if (h && h !== current) {
      current = h;
      handler();
    }
  });
  // Same-page links such as <a href="#/models">.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href^="#/"]');
    if (!a) return;
    e.preventDefault();
    go(a.getAttribute('href')!.slice(1));
  });
}

/** Updates the address bar without re-rendering. */
export function setPath(path: string, push = false) {
  current = path;
  try {
    if (location.hash !== `#${path}`) history[push ? 'pushState' : 'replaceState'](null, '', `#${path}`);
  } catch {
    /* some frames don't allow history changes */
  }
}

/** Navigates to a route (re-rendering even if it's the current one). */
export function go(path: string) {
  setPath(path, path !== current);
  handler();
}
