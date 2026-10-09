/*
 * The bookings calendar (Section 9.3): where you stand (fame tier, cash,
 * followers, reputation, what's next), the coming week, the sets you've
 * said yes to (with their flyers) and the offers waiting for an answer.
 * Accept one and play it, or play a free set with no booking.
 */
import type { Booking, Progress } from '../core/models';
import { accept, decline } from '../game/bookings';
import type { Career } from '../game/Career';
import { CAREER, isCareerVenue, nextGoal, REPUTATION, TIER_FAME, TIER_NAMES } from '../game/progression';
import { rivalOf } from '../game/rivals';
import { SLOTS } from '../game/vibe';
import { downloadBlob } from '../media/sets';
import { h } from './dom';
import { drawFlyer, nightDate, type FlyerInfo } from './flyer';
import { openModal, type ModalHandle } from './modal';

export interface BookingsHooks {
  career: Career;
  dj(): string;
  venueName(id: string): string;
  thumb(id: string, g: CanvasRenderingContext2D, w: number, h: number): void;
  /** play this booking: the pre-gig screen with its venue, slot and length fixed */
  play(b: Booking): void;
  /** a set with no booking: choose any open venue */
  free(): void;
}

export function flyerInfo(b: Booking, dj: string, venueName: string): FlyerInfo {
  return { venue: b.venue, venueName, promoter: b.promoter, dj, slotLabel: SLOTS[b.slot].label, minutes: b.minutes, night: b.night, special: b.special, rival: rivalOf(b.special)?.name };
}

function header(p: Progress): HTMLElement {
  const lo = TIER_FAME[p.tier - 1] ?? 0;
  const hi = TIER_FAME[p.tier] ?? lo;
  const k = hi > lo ? Math.min(1, (p.fame - lo) / (hi - lo)) : 1;
  const bar = h('div', { class: 'bk-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(k * 100)), 'aria-label': 'Fame to the next tier' }, h('i', { style: `width:${(k * 100).toFixed(1)}%` }));
  const rep = p.reputation ? REPUTATION[p.reputation] : null;
  return h(
    'div',
    { class: 'bk-head' },
    h('div', { class: 'bk-tier' }, h('b', {}, `Tier ${p.tier}`), h('span', {}, TIER_NAMES[p.tier - 1] ?? ''), bar, h('small', {}, hi > lo ? `${p.fame.toLocaleString()} / ${hi.toLocaleString()} fame` : `${p.fame.toLocaleString()} fame`)),
    h('div', { class: 'bk-num' }, h('span', {}, 'Cash'), h('b', {}, `$${p.cash.toLocaleString()}`)),
    h('div', { class: 'bk-num' }, h('span', {}, 'Followers'), h('b', {}, p.followers.toLocaleString())),
    h('div', { class: 'bk-num', title: rep?.blurb ?? 'Play a few sets: how you mix earns a reputation' }, h('span', {}, 'Reputation'), h('b', {}, rep ? `⭐ ${rep.label}` : '—')),
    h('p', { class: 'bk-next' }, 'Next: ', nextGoal(p)),
  );
}

export function openBookings(o: BookingsHooks): ModalHandle {
  const c = o.career;
  let modal: ModalHandle | null = null;
  const body = h('div', { class: 'bookings' });

  const render = () => {
    const save = c.refreshBookings();
    const p = c.progress;
    const night = save.night;
    const live = save.items.filter((b) => b.status === 'offered' || b.status === 'accepted');
    const accepted = live.filter((b) => b.status === 'accepted').sort((a, b) => a.night - b.night);
    const offers = live.filter((b) => b.status === 'offered').sort((a, b) => (b.special ? 1 : 0) - (a.special ? 1 : 0) || a.night - b.night);

    // the coming week
    const week = h('div', { class: 'bk-week', role: 'list', 'aria-label': 'The coming week' });
    for (let n = night; n < night + 7; n++) {
      const on = live.filter((b) => b.night === n);
      const yes = on.find((b) => b.status === 'accepted');
      const day = h(
        'button',
        { type: 'button', class: `bk-day${n === night ? ' tonight' : ''}${yes ? ' booked' : ''}`, role: 'listitem', title: on.length ? on.map((b) => `${o.venueName(b.venue)} (${b.status === 'accepted' ? 'booked' : 'offer'})`).join(', ') : 'Nothing yet' },
        h('span', {}, n === night ? 'Tonight' : nightDate(n).slice(0, 3)),
        h('b', {}, nightDate(n).slice(4)),
        h('small', {}, yes ? o.venueName(yes.venue) : on.length ? `${on.length} offer${on.length > 1 ? 's' : ''}` : ''),
      );
      day.addEventListener('click', () => body.querySelector(`[data-night="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      week.append(day);
    }

    const card = (b: Booking) => {
      const name = o.venueName(b.venue);
      const rival = rivalOf(b.special);
      const pic = h('canvas', { width: 180, height: b.status === 'accepted' ? 240 : 90, class: b.status === 'accepted' ? 'bk-flyer' : 'bk-thumb', 'aria-hidden': 'true' }) as HTMLCanvasElement;
      if (b.status === 'accepted') drawFlyer(pic, flyerInfo(b, o.dj(), name));
      else o.thumb(b.venue, pic.getContext('2d')!, 180, 90);
      const special = b.special === 'boat' ? h('span', { class: 'bk-special' }, '⚓ Special: opens the Boat Party') : rival ? h('span', { class: 'bk-special', style: `--rc:${rival.color}` }, `🤝 B2B with ${rival.name}`) : null;
      const actions = h('div', { class: 'bk-actions' });
      if (b.status === 'offered') {
        const yes = h('button', { type: 'button', class: 'btn primary' }, 'Accept');
        const no = h('button', { type: 'button', class: 'btn ghost' }, 'Decline');
        yes.addEventListener('click', () => {
          c.setBookings(accept(c.bookings, b.id));
          render();
        });
        no.addEventListener('click', () => {
          c.setBookings(decline(c.bookings, b.id));
          render();
        });
        actions.append(yes, no);
      } else {
        const go = h('button', { type: 'button', class: 'btn primary' }, b.night <= night ? 'Play this set' : 'Play it now');
        const save = h('button', { type: 'button', class: 'btn ghost', title: 'Save the flyer as a picture' }, 'Save flyer');
        const cancel = h('button', { type: 'button', class: 'btn ghost', title: 'Pull out of this booking' }, 'Cancel');
        go.addEventListener('click', () => {
          modal?.close();
          o.play(b);
        });
        save.addEventListener('click', () => {
          const big = h('canvas', { width: 900, height: 1200 }) as HTMLCanvasElement;
          drawFlyer(big, flyerInfo(b, o.dj(), name));
          big.toBlob((blob) => blob && downloadBlob(blob, `flyer-${b.venue}-${nightDate(b.night).replace(/ /g, '-').toLowerCase()}.png`), 'image/png');
        });
        cancel.addEventListener('click', () => {
          if (!confirm(`Pull out of ${name} on ${nightDate(b.night)}?`)) return;
          c.setBookings(decline(c.bookings, b.id));
          render();
        });
        actions.append(go, save, cancel);
      }
      const big = isCareerVenue(b.venue) ? `cap. ${CAREER[b.venue].capacity.toLocaleString()}` : '';
      return h(
        'article',
        { class: `bk-card ${b.status}${b.special ? ' special' : ''}`, 'data-night': String(b.night) },
        pic,
        h(
          'div',
          { class: 'bk-info' },
          h('span', { class: 'bk-when' }, `${b.night === night ? 'Tonight' : nightDate(b.night)} · ${b.promoter}`),
          h('h4', {}, name, big ? h('small', {}, ` ${big}`) : null),
          special,
          h('div', { class: 'bk-facts' }, h('span', {}, SLOTS[b.slot].label), h('span', {}, `${b.minutes} min`), h('b', {}, `$${b.pay.toLocaleString()}`)),
          h('p', { class: 'bk-expect' }, '“', b.expectation, '”'),
          h('p', { class: 'bk-goal' }, h('b', {}, 'Bonus: '), b.objective, h('small', {}, ' (+25% pay and fame)')),
          actions,
        ),
      );
    };

    const free = h('button', { type: 'button', class: 'btn' }, 'Free set (no booking)…');
    free.addEventListener('click', () => {
      modal?.close();
      o.free();
    });
    body.replaceChildren(
      header(p),
      week,
      ...(accepted.length ? [h('section', {}, h('h3', {}, 'Your bookings'), h('div', { class: 'bk-list' }, ...accepted.map(card)))] : []),
      h('section', {}, h('h3', {}, 'Offers'), offers.length ? h('div', { class: 'bk-list' }, ...offers.map(card)) : h('p', { class: 'gs-note' }, 'No offers right now. Play a set and the promoters will call.')),
      h('div', { class: 'bk-foot' }, h('span', { class: 'gs-note' }, 'A free set pays less and has no objective, but it still moves your career on.'), free),
    );
  };

  render();
  modal = openModal('Bookings', body, { wide: true });
  return modal;
}
