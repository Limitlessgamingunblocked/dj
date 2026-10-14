/* Venue picker: the venue globe (VenueGlobe), with illustrated cards for every venue as its grid view. */
import { VENUES, type VenueDef } from '../three/venues';
import { h, clear } from './dom';
import { openModal, type ModalHandle } from './modal';
import { venueGlobe } from './VenueGlobe';

const thumbs = new Map<string, string>();

/** drop a cached picture (a room you've just rebuilt) */
export function forgetThumb(id: string): void {
  thumbs.delete(id);
}

export function venueThumb(v: VenueDef): string {
  const hit = thumbs.get(v.id);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 270;
  v.thumb(c.getContext('2d')!, c.width, c.height);
  const url = c.toDataURL('image/png');
  thumbs.set(v.id, url);
  return url;
}

/** a grid of venue cards; `pick` is called with the chosen id */
export function venueCards(current: () => string, pick: (id: string) => void, locked: (id: string) => string | null = () => null): { el: HTMLElement; refresh(): void } {
  const el = h('div', { class: 'venue-cards' });
  const refresh = () => {
    clear(el);
    for (const v of VENUES) {
      const lock = locked(v.id);
      const card = h(
        'button',
        { class: `venue-card${v.id === current() ? ' active' : ''}${lock ? ' locked' : ''}`, type: 'button', disabled: !!lock, title: lock ?? '' },
        h('img', { src: venueThumb(v), alt: `${v.name} illustration`, width: 480, height: 270 }),
        h('div', { class: 'info' }, h('span', { class: 'where' }, v.place), h('b', {}, v.name), h('p', {}, lock ? h('span', { class: 'lock' }, lock) : v.blurb), h('span', { class: 'cap' }, `Capacity ${v.capacity}`)),
      );
      card.style.setProperty('--vc', v.ui);
      card.addEventListener('click', () => {
        pick(v.id);
        refresh();
      });
      el.append(card);
    }
  };
  refresh();
  return { el, refresh };
}

const fineprint = () => h('p', { class: 'note fineprint' }, 'Real venues are fan-made recreations, not affiliated with the clubs.');

export function openVenuePicker(current: () => string, pick: (id: string) => void, locked: (id: string) => string | null = () => null): void {
  let modal: ModalHandle | null = null;
  const showGrid = (canGoBack: boolean) => {
    const cards = venueCards(current, pick, locked);
    const back = canGoBack ? h('button', { type: 'button', class: 'btn ghost small', style: { justifySelf: 'start' } }, 'Back to the globe') : null;
    back?.addEventListener('click', showGlobe);
    modal?.body.replaceChildren(h('div', { style: { display: 'grid', gap: '12px' } }, back, cards.el, fineprint()));
  };
  const showGlobe = () => {
    const globe = venueGlobe({ current, pick, locked, grid: () => showGrid(true) }, () => modal);
    if (globe) {
      modal?.body.replaceChildren(globe);
      globe.focus({ preventScroll: true });
    } else showGrid(false);
  };
  modal = openModal('Venue', h('div'), { wide: true });
  showGlobe();
}
