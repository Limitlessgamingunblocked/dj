/* Venue gallery: illustrated cards for every venue. */
import { VENUES, type VenueDef } from '../three/venues';
import { h, clear } from './dom';
import { openModal } from './modal';

const thumbs = new Map<string, string>();

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

export function openVenuePicker(current: () => string, pick: (id: string) => void, locked?: (id: string) => string | null): void {
  const cards = venueCards(current, pick, locked);
  openModal(
    'Venue',
    h('div', { style: { display: 'grid', gap: '12px' } }, cards.el, h('p', { class: 'note fineprint' }, 'Real venues are fan-made recreations, not affiliated with the clubs.')),
    { wide: true },
  );
}
