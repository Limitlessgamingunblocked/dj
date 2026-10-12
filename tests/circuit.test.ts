import { describe, expect, it } from 'vitest';
import {
  CITIES,
  circuitOffers,
  circuitSpecial,
  cityTaste,
  clashStep,
  cleanCircuit,
  freeRun,
  nextTourCity,
  pickNightEvent,
  planTour,
  relAfter,
  relDeclined,
  relPerks,
  relStatus,
  residencyAfter,
  residencyOffer,
  STOP_AT,
  tourReward,
  travelFor,
  type CircuitSave,
} from '../src/game/circuit';
import { PROGRESS, BOOKINGS, type BookingsSave } from '../src/core/models';
import { makeOffer, seeded, PROMOTERS } from '../src/game/bookings';

const progress = (tier: number) => ({ ...PROGRESS.defaults(), tier, followers: 5000 });
const empty = (): CircuitSave => cleanCircuit(null);

describe('promoter relationships', () => {
  it('good sets warm a promoter, bad ones cool them, and they stop calling below the line', () => {
    let rel = relAfter({}, 'Sweat Box', 'S', true);
    expect(rel['Sweat Box']).toBeCloseTo(0.3);
    expect(relStatus(rel['Sweat Box']).tone).toBe('good');
    rel = { 'Sweat Box': -0.45 };
    rel = relAfter(rel, 'Sweat Box', 'D', false);
    expect(rel['Sweat Box']).toBeLessThanOrEqual(STOP_AT);
    expect(relStatus(rel['Sweat Box']).label).toBe('Stopped calling');
    expect(relDeclined({}, 'X', true).X).toBeLessThan(relDeclined({}, 'X', false).X);
  });

  it('keen promoters pay more and give the peak slots', () => {
    expect(relPerks(0.5).pay).toBeGreaterThan(1.1);
    expect(relPerks(0.5).prime).toBe(true);
    expect(relPerks(-0.4).pay).toBeLessThan(1);
    expect(relPerks(undefined).pay).toBe(1);
  });

  it('a stopped promoter’s offers go; a keen one’s pay goes up once', () => {
    const p = progress(3);
    const r = seeded(3);
    const a = { ...makeOffer('basement', 2, p, r, 'bk1'), promoter: 'Sweat Box' };
    const b = { ...makeOffer('basement', 3, p, r, 'bk2'), promoter: 'Low Ceiling Collective' };
    const save: BookingsSave = { night: 1, items: [a, b] };
    const c = { ...empty(), rel: { 'Sweat Box': -0.8, 'Low Ceiling Collective': 0.6 } };
    const out = circuitOffers(save, p, c, seeded(1));
    expect(out.save.items.find((x) => x.promoter === 'Sweat Box')!.status).toBe('declined');
    const keen = out.save.items.find((x) => x.promoter === 'Low Ceiling Collective')!;
    expect(keen.pay).toBeGreaterThan(b.pay);
    // running it again doesn't raise the pay twice
    const again = circuitOffers(out.save, p, out.circuit, seeded(1));
    expect(again.save.items.find((x) => x.promoter === 'Low Ceiling Collective')!.pay).toBe(keen.pay);
  });
});

describe('residency', () => {
  it('is offered by a promoter who likes you, at tier 2 or more', () => {
    expect(residencyOffer({ tier: 1 }, { 'Sweat Box': 0.5 }, null, 1, PROMOTERS)).toBeNull();
    const o = residencyOffer({ tier: 2 }, { 'Sweat Box': 0.5 }, null, 1, PROMOTERS);
    expect(o?.venue).toBe('basement');
    expect(o?.promoter).toBe('Sweat Box');
  });

  it('puts its weekly night in the calendar once, and not over another booking', () => {
    const p = progress(3);
    const res = { venue: 'basement' as const, promoter: 'Sweat Box', day: 3, weeks: 0, crowd: 0.8, lastTracks: [], booked: 0 };
    const out = circuitOffers({ night: 1, items: [] }, p, { ...empty(), residency: res }, seeded(2));
    const nights = out.save.items.filter((b) => b.special === 'residency');
    expect(nights).toHaveLength(1);
    expect(nights[0].night % 7).toBe(3);
    expect(nights[0].status).toBe('accepted');
    // a second pass adds nothing, even after the night is declined
    const declined = { ...out.save, items: out.save.items.map((b) => ({ ...b, status: 'declined' as const })) };
    const again = circuitOffers(declined, p, out.circuit, seeded(2));
    expect(again.save.items.filter((b) => b.special === 'residency' && b.status === 'accepted')).toHaveLength(0);
  });

  it('grows with fresh, good sets and shrinks with repeats', () => {
    const r = { venue: 'basement' as const, promoter: 'X', day: 0, weeks: 2, crowd: 1, lastTracks: ['a', 'b', 'c'], booked: 0 };
    const fresh = residencyAfter(r, ['d', 'e', 'f'], 'A');
    expect(fresh.res.crowd).toBeGreaterThan(1);
    expect(fresh.res.weeks).toBe(3);
    expect(fresh.res.lastTracks).toEqual(['d', 'e', 'f']);
    const stale = residencyAfter(r, ['a', 'b', 'c'], 'C');
    expect(stale.res.crowd).toBeLessThan(1);
    expect(stale.fresh).toBe(0);
  });
});

describe('World Tour', () => {
  it('needs tier 4 and two cities, and travel gets grander', () => {
    expect(planTour(['london', 'berlin'], { tier: 3 }, 2)).toBeNull();
    expect(planTour(['london'], { tier: 5 }, 2)).toBeNull();
    const t = planTour(['london', 'berlin', 'london', 'nowhere', 'tokyo'], { tier: 6 }, 4)!;
    expect(t.cities).toEqual(['london', 'berlin', 'tokyo']);
    expect(t.travel).toBe('jet');
    expect(travelFor(4).mode).toBe('van');
    expect(travelFor(5).mode).toBe('train');
  });

  it('books one leg a night as accepted bookings', () => {
    const p = progress(5);
    const t = planTour(['berlin', 'ibiza', 'tokyo'], p, 3)!;
    const out = circuitOffers({ night: 1, items: [] }, p, { ...empty(), tour: t }, seeded(4));
    const legs = out.save.items.filter((b) => b.special?.startsWith('tour:'));
    expect(legs.map((b) => b.night)).toEqual([3, 4, 5]);
    expect(legs[0].promoter).toBe(CITIES.find((c) => c.id === 'berlin')!.promoter);
    // the saves survive validation (the special kinds are allowed)
    const v = BOOKINGS.validate(out.save);
    expect(v.items.filter((b) => b.special?.startsWith('tour:'))).toHaveLength(3);
  });

  it('legs can be played out of order: a played city is not booked again, the rest stay', () => {
    const p = progress(5);
    const t = { ...planTour(['berlin', 'ibiza', 'tokyo'], p, 3)!, leg: 1, results: [{ city: 'ibiza', grade: 'A' }] };
    const out = circuitOffers({ night: 4, items: [] }, p, { ...empty(), tour: t }, seeded(4));
    const cities = out.save.items.filter((b) => b.special?.startsWith('tour:')).map((b) => b.special);
    expect(cities).toEqual(['tour:berlin', 'tour:tokyo']);
    expect(nextTourCity(t)).toBe('berlin');
  });

  it('finds a run of free nights', () => {
    const p = progress(5);
    const busy = { ...makeOffer('basement', 3, p, seeded(1), 'bk1'), status: 'accepted' as const };
    expect(freeRun({ night: 1, items: [busy] }, 2, 2)).toBe(4);
    expect(freeRun({ night: 1, items: [] }, 2, 3)).toBe(2);
  });

  it('cities have tastes and a tour pays in followers', () => {
    expect(cityTaste('berlin', 'Techno')).toBe(1);
    expect(cityTaste('berlin', 'Tech House')).toBeGreaterThan(0);
    expect(cityTaste('berlin', 'Pop')).toBe(0);
    expect(tourReward([{ grade: 'S' }, { grade: 'A' }]).followers).toBe(1500);
    for (const c of CITIES) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(1);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(1);
    }
  });
});

describe('festival clash and night events', () => {
  it('the field drifts to whoever plays better, within limits', () => {
    let s = 0.5;
    for (let i = 0; i < 600; i++) s = clashStep(s, 0.95, 0.4, 1);
    expect(s).toBeGreaterThan(0.8);
    expect(s).toBeLessThanOrEqual(0.88);
    for (let i = 0; i < 600; i++) s = clashStep(s, 0.2, 0.8, 1);
    expect(s).toBeLessThan(0.2);
    expect(s).toBeGreaterThanOrEqual(0.12);
  });

  it('clash offers come at tier 6, spaced out', () => {
    const p = progress(6);
    let got: ReturnType<typeof circuitOffers> | null = null;
    for (let seed = 1; seed < 30 && !got; seed++) {
      const out = circuitOffers({ night: 10, items: [] }, p, empty(), seeded(seed));
      if (out.save.items.some((b) => b.special?.startsWith('clash:'))) got = out;
    }
    expect(got).not.toBeNull();
    expect(got!.circuit.clashNight).toBe(10);
    // not again the next night
    const next = circuitOffers({ night: 11, items: [] }, p, got!.circuit, seeded(1));
    expect(next.save.items.some((b) => b.special?.startsWith('clash:'))).toBe(false);
    expect(circuitSpecial(got!.save.items[0].special)?.title).toBe('MAIN STAGE');
  });

  it('rain only falls outdoors; most nights pass quietly', () => {
    let quiet = 0;
    for (let i = 0; i < 400; i++) {
      const r = seeded(i + 1);
      const ev = pickNightEvent(false, r);
      if (!ev) quiet++;
      else {
        expect(ev.id).not.toBe('rain');
        expect(ev.at).toBeGreaterThanOrEqual(0.25);
        expect(ev.at).toBeLessThanOrEqual(0.75);
      }
    }
    expect(quiet).toBeGreaterThan(200);
  });

  it('cleans a damaged save', () => {
    const c = cleanCircuit({ rel: { a: 5, b: 'x' }, residency: { venue: 'moon', promoter: 'x' }, tour: { cities: ['london'] }, toured: [1, 'tokyo'] });
    expect(c.rel).toEqual({ a: 1 });
    expect(c.residency).toBeNull();
    expect(c.tour).toBeNull();
    expect(c.toured).toEqual(['tokyo']);
  });
});
