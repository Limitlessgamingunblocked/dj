/*
 * The bookings calendar (Section 9.3): where you stand (fame tier, cash,
 * followers, reputation, what's next), the coming week, the sets you've
 * said yes to (with their flyers) and the offers waiting for an answer.
 * Accept one and play it, or play a free set with no booking.
 */
import type { Booking, Progress } from '../core/models';
import { accept, decline } from '../game/bookings';
import { CITIES, circuitSpecial, nextTourCity, relDeclined, relStatus, TOUR_TIER, travelFor, type CircuitSave } from '../game/circuit';
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
  /** the World Tour map, to plan a run of cities */
  tour?(): void;
  /** today's daily challenge */
  daily?: { number: number; venueName: string; slotLabel: string; twist: string; goals: string[]; streak: number; played: string | null; play(): void };
}

export function flyerInfo(b: Booking, dj: string, venueName: string, c?: CircuitSave): FlyerInfo {
  const cs = circuitSpecial(b.special, c);
  return { venue: b.venue, venueName, promoter: b.promoter, dj, slotLabel: SLOTS[b.slot].label, minutes: b.minutes, night: b.night, special: b.special, rival: rivalOf(b.special)?.name, title: cs?.title, line: cs?.line };
}

const DAYS = ['Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday'];

/** the night of the week a residency's on (night n is n days after Thursday 1 January 2026) */
export function dayName(day: number): string {
  return DAYS[((day % 7) + 7) % 7];
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
    h('div', { class: 'bk-num', title: rep?.blurb ?? 'Play a few sets: how you mix earns a reputation' }, h('span', {}, 'Reputation'), h('b', {}, rep ? rep.label : '—')),
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
      if (b.status === 'accepted') drawFlyer(pic, flyerInfo(b, o.dj(), name, c.circuit));
      else o.thumb(b.venue, pic.getContext('2d')!, 180, 90);
      const cs = circuitSpecial(b.special, c.circuit);
      const special = b.special === 'boat' ? h('span', { class: 'bk-special' }, 'Opens the Boat Party') : rival ? h('span', { class: 'bk-special', style: `--rc:${rival.color}` }, `B2B with ${rival.name}`) : cs ? h('span', { class: 'bk-special', style: cs.color ? `--rc:${cs.color}` : '' }, cs.badge) : null;
      const rel = c.circuit.rel[b.promoter];
      const rs = rel !== undefined ? relStatus(rel) : null;
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
          c.setCircuit({ ...c.circuit, rel: relDeclined(c.circuit.rel, b.promoter, false) });
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
          drawFlyer(big, flyerInfo(b, o.dj(), name, c.circuit));
          big.toBlob((blob) => blob && downloadBlob(blob, `flyer-${b.venue}-${nightDate(b.night).replace(/ /g, '-').toLowerCase()}.png`), 'image/png');
        });
        cancel.addEventListener('click', () => {
          if (b.special?.startsWith('tour:')) {
            if (!confirm('Pull out of this night and the tour is off: the rest of the cities go too. Call off the tour?')) return;
            c.cancelTour();
            render();
            return;
          }
          if (!confirm(`Pull out of ${name} on ${nightDate(b.night)}? ${b.promoter} won’t forget it.`)) return;
          c.setBookings(decline(c.bookings, b.id));
          const res = c.circuit.residency;
          c.setCircuit({ ...c.circuit, rel: relDeclined(c.circuit.rel, b.promoter, true), residency: res && b.special === 'residency' ? { ...res, crowd: Math.max(0.6, res.crowd - 0.08) } : res });
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
          h('span', { class: 'bk-when' }, `${b.night === night ? 'Tonight' : nightDate(b.night)} · ${b.promoter}`, rs ? h('em', { class: `bk-rel ${rs.tone}`, title: 'How this promoter feels about you' }, rs.label) : null),
          h('h4', {}, name, big ? h('small', {}, ` ${big}`) : null),
          special,
          h('div', { class: 'bk-facts' }, h('span', {}, SLOTS[b.slot].label), h('span', {}, `${b.minutes} min`), h('b', {}, `$${b.pay.toLocaleString()}`)),
          h('p', { class: 'bk-expect' }, '“', b.expectation, '”'),
          h('p', { class: 'bk-goal', title: 'Hit it for 25% more pay and fame' }, h('b', {}, 'Bonus '), b.objective, h('small', {}, ' +25%')),
          actions,
        ),
      );
    };

    const free = h('button', { type: 'button', class: 'btn' }, 'Free set');
    free.addEventListener('click', () => {
      modal?.close();
      o.free();
    });
    const d = o.daily;
    let daily: HTMLElement | null = null;
    if (d) {
      const go = h('button', { type: 'button', class: 'btn primary' }, d.played ? 'Play again (practice)' : 'Play today’s challenge');
      go.addEventListener('click', () => {
        modal?.close();
        d.play();
      });
      daily = h(
        'section',
        { class: `bk-daily${d.played ? ' done' : ''}` },
        h('div', { class: 'bk-daily-head' }, h('span', { class: 'bk-daily-k' }, `Daily #${d.number}`), d.streak > 0 ? h('span', { class: 'bk-daily-streak' }, `🔥 ${d.streak}`) : null),
        h('h4', {}, `${d.venueName} · ${d.slotLabel} · 10 min`),
        h('p', { class: 'bk-expect' }, d.twist),
        h('ul', { class: 'bk-daily-goals' }, ...d.goals.map((g) => h('li', {}, g))),
        d.played ? h('p', { class: 'gs-note' }, `Today: ${d.played}`) : h('p', { class: 'gs-note' }, 'The same set for everyone today, on any stage. Your first finish counts.'),
        h('div', { class: 'bk-actions' }, go),
      );
    }
    body.replaceChildren(
      header(p),
      ...(daily ? [daily] : []),
      ...circuitCards(),
      week,
      ...(accepted.length ? [h('section', {}, h('h3', {}, 'Your bookings'), h('div', { class: 'bk-list' }, ...accepted.map(card)))] : []),
      h('section', {}, h('h3', {}, 'Offers'), offers.length ? h('div', { class: 'bk-list' }, ...offers.map(card)) : h('p', { class: 'gs-note' }, 'No offers right now. Play a set and promoters will call.')),
      ...promoterList(),
      h('div', { class: 'bk-foot' }, h('span', { class: 'gs-note' }, 'No booking? A free set pays less but still counts.'), free),
    );
  };

  /** the residency (on offer, or yours) and the World Tour */
  const circuitCards = (): HTMLElement[] => {
    const cs = c.circuit;
    const p = c.progress;
    const out: HTMLElement[] = [];
    const res = cs.residency ?? cs.residencyOffer;
    if (res) {
      const mine = !!cs.residency;
      const actions = h('div', { class: 'bk-actions' });
      if (mine) {
        const end = h('button', { type: 'button', class: 'btn ghost' }, 'End the residency');
        end.addEventListener('click', () => {
          if (!confirm(`End your residency at ${o.venueName(res.venue)}? ${res.promoter} will be disappointed.`)) return;
          c.dropResidency();
          render();
        });
        actions.append(end);
      } else {
        const yes = h('button', { type: 'button', class: 'btn primary' }, 'Take the residency');
        const no = h('button', { type: 'button', class: 'btn ghost' }, 'Not now');
        yes.addEventListener('click', () => {
          c.acceptResidency();
          render();
        });
        no.addEventListener('click', () => {
          c.dropResidency();
          render();
        });
        actions.append(yes, no);
      }
      const crowd = Math.round(res.crowd * 100);
      out.push(
        h(
          'section',
          { class: `bk-circuit bk-res${mine ? ' mine' : ''}` },
          h('div', { class: 'bk-daily-head' }, h('span', { class: 'bk-daily-k' }, mine ? 'Your residency' : 'Residency offer'), mine ? h('span', { class: 'bk-daily-streak' }, `Week ${res.weeks + 1}`) : null),
          h('h4', {}, `${o.venueName(res.venue)} · every ${dayName(res.day)}`),
          h('p', { class: 'bk-expect' }, mine ? `${res.promoter}’s room is ${crowd}% full. They remember last week’s tracks: play them again and they’re bored. Keep it fresh and play well and the room grows.` : `${res.promoter} wants you every ${dayName(res.day)}. A weekly night with a crowd that remembers you: it grows when you keep it fresh.`),
          mine ? h('div', { class: 'bk-bar', role: 'progressbar', 'aria-label': 'How full the room is', 'aria-valuenow': String(crowd), 'aria-valuemin': '60', 'aria-valuemax': '160' }, h('i', { style: `width:${(((res.crowd - 0.6) / 1) * 100).toFixed(0)}%` })) : null,
          actions,
        ),
      );
    }
    const t = cs.tour;
    const travel = travelFor(p.tier);
    if (t) {
      const stops = h(
        'ol',
        { class: 'bk-tour-stops' },
        ...t.cities.map((id, i) => {
          const city = CITIES.find((x) => x.id === id);
          const done = t.results.find((r) => r.city === id);
          const b = c.bookings.items.find((x) => x.special === `tour:${id}` && x.status === 'accepted');
          return h('li', { class: done ? 'done' : id === nextTourCity(t) ? 'next' : '' }, h('b', {}, city?.name ?? id), h('small', {}, done ? `Grade ${done.grade}` : nightDate(b?.night ?? t.start + i).slice(0, 10)));
        }),
      );
      const off = h('button', { type: 'button', class: 'btn ghost' }, 'Call off the tour');
      off.addEventListener('click', () => {
        if (!confirm('Call off the rest of the tour? The promoters in those cities won’t be happy.')) return;
        c.cancelTour();
        render();
      });
      out.push(h('section', { class: 'bk-circuit bk-tour' }, h('div', { class: 'bk-daily-head' }, h('span', { class: 'bk-daily-k' }, 'World Tour'), h('span', { class: 'bk-daily-streak' }, travel.label)), stops, h('p', { class: 'gs-note' }, `${t.results.length} of ${t.cities.length} cities played. Each city’s crowd has its own taste.`), h('div', { class: 'bk-actions' }, off)));
    } else if (o.tour) {
      const open = p.tier >= TOUR_TIER;
      const go = h('button', { type: 'button', class: `btn${open ? ' primary' : ''}`, disabled: open ? undefined : 'true' }, open ? 'Plan a World Tour' : `World Tour at tier ${TOUR_TIER}`);
      go.addEventListener('click', () => {
        if (!open) return;
        modal?.close();
        o.tour?.();
      });
      out.push(h('section', { class: 'bk-circuit bk-tour-cta' }, h('div', {}, h('h4', {}, 'World Tour'), h('p', { class: 'gs-note' }, open ? `A run of cities, one a night, by ${travel.label.toLowerCase()}. ${cs.toured.length ? `You’ve played ${cs.toured.length} cit${cs.toured.length > 1 ? 'ies' : 'y'} so far.` : ''}` : 'Get big enough and promoters around the world will book you for a run of nights.')), go));
    }
    return out;
  };

  /** the promoters you've worked with, and how they feel */
  const promoterList = (): HTMLElement[] => {
    const rel = Object.entries(c.circuit.rel).sort((a, b) => b[1] - a[1]);
    if (!rel.length) return [];
    return [
      h(
        'details',
        { class: 'bk-promoters' },
        h('summary', {}, `Promoters (${rel.length})`),
        h('p', { class: 'gs-note' }, 'They remember how your sets went. Keen ones pay more and give you the peak slots; let one down too often and they stop calling.'),
        h('ul', {}, ...rel.map(([name, v]) => {
          const st = relStatus(v);
          return h('li', {}, h('span', {}, name), h('i', { class: `bk-rel-bar ${st.tone}` }, h('b', { style: `left:${((v + 1) * 50).toFixed(0)}%` })), h('em', { class: `bk-rel ${st.tone}` }, st.label));
        })),
      ),
    ];
  };

  render();
  modal = openModal('Bookings', body, { wide: true });
  return modal;
}
