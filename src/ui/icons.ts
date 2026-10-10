/*
 * A few line icons, drawn the same way (24 px grid, 1.8 px stroke, round
 * caps), so the interface doesn't lean on emoji, which look different on
 * every system.
 */
const PATHS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  shirt: '<path d="M8 4 4 6.5l1.8 4L8 9.6V20h8V9.6l2.2.9 1.8-4L16 4c-.6 1.4-2.1 2.3-4 2.3S8.6 5.4 8 4z"/>',
  record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 18h2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 20): SVGSVGElement {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return span.firstElementChild as SVGSVGElement;
}
