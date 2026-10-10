import { describe, expect, it } from 'vitest';
import { crewArc, crewSize, getCrewTier, setCrewTier } from '../src/three/venues/crew';

describe('the VIP crew (Section 8.4)', () => {
  it('grows with fame: a few friends at the rooftop, a full crew at the warehouse, a stage party at the festival', () => {
    expect(crewSize(1, 16)).toBeLessThanOrEqual(1);
    expect(crewSize(2, 16)).toBeGreaterThanOrEqual(2);
    expect(crewSize(2, 16)).toBeLessThanOrEqual(4);
    expect(crewSize(3, 16)).toBeGreaterThanOrEqual(5);
    expect(crewSize(6, 16)).toBeGreaterThanOrEqual(10);
    for (let t = 1; t < 7; t++) expect(crewSize(t + 1, 99)).toBeGreaterThanOrEqual(crewSize(t, 99));
    // never more than the stage has room for
    expect(crewSize(7, 4)).toBe(4);
  });

  it('stands behind the booth, nearest places first', () => {
    const spots = crewArc(0, 1.8, 2.8, 0.6, 2.4);
    expect(spots).toHaveLength(16);
    for (const p of spots) expect(p.z).toBeGreaterThan(0.6);
    // the first few are the closest to the DJ
    const score = (p: { x: number; z: number }) => Math.abs(p.x) + p.z * 0.3;
    for (let i = 1; i < spots.length; i++) expect(score(spots[i])).toBeGreaterThanOrEqual(score(spots[i - 1]));
  });

  it('takes the tier the venue is built for', () => {
    setCrewTier(9);
    expect(getCrewTier()).toBe(7);
    setCrewTier(0);
    expect(getCrewTier()).toBe(1);
  });
});

describe('the promoter (Section 8.5)', () => {
  it('gets warmer as you get bigger', async () => {
    const { promoterHello } = await import('../src/app/gigs');
    expect(promoterHello(1, 'Deep warm-up')).toMatch(/Thanks for stepping in\. Deep warm-up\./);
    expect(promoterHello(6, 'Peak time')).toMatch(/Sold out/);
    expect(promoterHello(4, 'x')).not.toBe(promoterHello(1, 'x'));
  });
});
