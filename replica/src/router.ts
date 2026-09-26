let handler: () => void = () => undefined;

export function onRoute(fn: () => void) {
  handler = fn;
}

/** Navigates to a hash route (re-rendering if it's the current one). */
export function go(path: string) {
  if (location.hash === `#${path}`) handler();
  else location.hash = path;
}
