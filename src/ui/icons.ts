/*
 * The interface's icons, all drawn the same way (24 px grid, 1.8 px stroke,
 * round caps), so buttons don't lean on emoji and symbol characters, which
 * look different on every system and font.
 */
const PATHS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  shirt: '<path d="M8 4 4 6.5l1.8 4L8 9.6V20h8V9.6l2.2.9 1.8-4L16 4c-.6 1.4-2.1 2.3-4 2.3S8.6 5.4 8 4z"/>',
  record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 18h2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  panels: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17"/>',
  orbitLeft: '<path d="M9 7H5V3"/><path d="M5.6 7A8 8 0 1 1 4 12"/>',
  orbitRight: '<path d="M15 7h4V3"/><path d="M18.4 7A8 8 0 1 0 20 12"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6.5 9.5V20h11V9.5"/>',
  next: '<path d="M5 12h13M13 7l5 5-5 5"/>',
  back: '<path d="M19 12H6M11 7l-5 5 5 5"/>',
  lens: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5 9 12M20.5 12 12 9M12 20.5 15 12M3.5 12 12 15"/>',
  camera: '<path d="M4 8h3l1.6-2.5h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.3" r="3.4"/>',
  play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/>',
  toStart: '<path d="M6 5.5v13M18 5.5v13L9 12z"/>',
  star: '<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  starOn: '<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" fill="currentColor"/>',
  pin: '<path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5M19 4v4h-4"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v3.5H8"/><path d="M12 8v4l3 2"/>',
  turnLeft: '<path d="M8 8H4V4"/><path d="M4.6 8A8 8 0 0 1 20 12"/>',
  turnRight: '<path d="M16 8h4V4"/><path d="M19.4 8A8 8 0 0 0 4 12"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 20): SVGSVGElement {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return span.firstElementChild as SVGSVGElement;
}
