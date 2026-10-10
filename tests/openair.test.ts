import { describe, expect, it } from 'vitest';
import { roomFor } from '../src/audio/room';
import { CAREER_VENUES } from '../src/game/progression';
import { VENUE_NAME_STYLES } from '../src/name/venueStyles';
import { venueById, VENUES } from '../src/three/venues';
import { BEACH_SKY } from '../src/three/venues/beach';
import { dronePoints } from '../src/three/venues/festival';
import { PeakTrigger, setClock, tickFreeClock } from '../src/three/venues/moments';
import { sampleSky, sunDirection } from '../src/three/venues/outdoor';
import { ROOFTOP_SKY } from '../src/three/venues/rooftop';
import { groundY, SUNRISE_SKY } from '../src/three/venues/sunrise';

describe('the career venues (Section 5.2)', () => {
  it('are all built, each with its name style and its own acoustics', () => {
    for (const id of CAREER_VENUES) {
      expect(venueById(id).id, id).toBe(id);
      expect(VENUE_NAME_STYLES[id], id).toBeTruthy();
    }
    // the free-play house room keeps its own id
    expect(VENUES.some((v) => v.id === 'deckhouse')).toBe(true);
    expect(new Set(VENUES.map((v) => v.id)).size).toBe(VENUES.length);
    // open air is drier than the warehouse; the festival has the delay towers' slap
    for (const id of ['rooftop', 'beach', 'boat', 'sunrise']) expect(roomFor(id).wet, id).toBeLessThan(roomFor('warehouse').wet);
    expect(roomFor('festival').slap).toBeGreaterThan(0.08);
  });
});

describe('time of day', () => {
  it('samples between keys and holds at the ends', () => {
    const a = sampleSky(ROOFTOP_SKY, -1);
    expect(a.sun).toBeCloseTo(ROOFTOP_SKY[0].sun);
    const b = sampleSky(ROOFTOP_SKY, 2);
    expect(b.night).toBeCloseTo(1);
    const mid = sampleSky(ROOFTOP_SKY, 0.4);
    expect(mid.sun).toBeLessThan(ROOFTOP_SKY[1].sun);
    expect(mid.sun).toBeGreaterThan(ROOFTOP_SKY[2].sun);
  });

  it('the rooftop runs from golden hour to night, getting darker all the way', () => {
    let last = -1;
    for (let k = 0; k <= 1; k += 0.05) {
      const l = sampleSky(ROOFTOP_SKY, k);
      expect(l.night).toBeGreaterThanOrEqual(last - 1e-9);
      last = l.night;
    }
    expect(sampleSky(ROOFTOP_SKY, 0).sun).toBeGreaterThan(5);
    expect(sampleSky(ROOFTOP_SKY, 1).sun).toBeLessThan(-6);
  });

  it('the beach sun reaches the sea by the middle of the set', () => {
    expect(sampleSky(BEACH_SKY, 0).sun).toBeGreaterThan(10);
    const half = sampleSky(BEACH_SKY, 0.5).sun;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1.5);
    expect(sampleSky(BEACH_SKY, 1).sun).toBeLessThan(0);
  });

  it('the sunrise clears the horizon only in the last part of the set (the final track)', () => {
    // dark at the start
    expect(sampleSky(SUNRISE_SKY, 0).stars).toBeGreaterThan(0.9);
    let first = -1;
    for (let k = 0; k <= 1.0001; k += 0.005) {
      if (sampleSky(SUNRISE_SKY, k).sun > 0.55) {
        first = k;
        break;
      }
    }
    expect(first).toBeGreaterThan(0.88);
    expect(first).toBeLessThan(0.98);
    expect(sampleSky(SUNRISE_SKY, 1).light).toBeGreaterThan(1.5);
  });

  it('points the sun the right way', () => {
    const behind = sunDirection(0, 0);
    expect(behind.z).toBeCloseTo(1);
    expect(sunDirection(90, 0).y).toBeCloseTo(1);
    expect(sunDirection(10, Math.PI).z).toBeLessThan(0);
  });
});

describe('the sunrise hillside', () => {
  it('rises away from the stage so everyone sees over it, and falls away behind it', () => {
    expect(groundY(0, -40)).toBeGreaterThan(groundY(0, -10) + 3);
    expect(groundY(0, -10)).toBeGreaterThan(groundY(0, -2));
    expect(groundY(0, 2)).toBeCloseTo(-1.1);
    expect(groundY(0, 40)).toBeLessThan(-15);
  });
});

describe('the festival drone show', () => {
  it('places drones on the lit pixels of the word, evenly, keeping its shape', () => {
    const w = 64;
    const h = 16;
    const px = new Uint8ClampedArray(w * h * 4);
    // a solid bar in the middle third
    for (let y = 4; y < 12; y++) for (let x = 16; x < 48; x++) px[(y * w + x) * 4 + 3] = 255;
    const all = dronePoints(px, w, h, 10_000, 1);
    expect(all).toHaveLength(32 * 8);
    for (const [x, y] of all) {
      expect(Math.abs(x)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.0625 + 1e-9);
    }
    const few = dronePoints(px, w, h, 50, 1);
    expect(few).toHaveLength(50);
    // spread across the whole bar, not bunched at the start
    expect(Math.max(...few.map((p) => p[1]))).toBeGreaterThan(0.02);
    expect(Math.min(...few.map((p) => p[1]))).toBeLessThan(-0.02);
    expect(dronePoints(new Uint8ClampedArray(w * h * 4), w, h, 50)).toHaveLength(0);
  });
});

describe('signature moment triggers', () => {
  it('fire once after holding the top long enough, and re-arm for a new set', () => {
    setClock.progress = 0.3;
    const t = new PeakTrigger(0.86, 10);
    let fired = 0;
    for (let i = 0; i < 60 * 9; i++) fired += t.update(1 / 60, 0.9, true) ? 1 : 0;
    expect(fired).toBe(0);
    // a dip doesn't reset it at once
    for (let i = 0; i < 30; i++) t.update(1 / 60, 0.5, true);
    for (let i = 0; i < 60 * 3; i++) fired += t.update(1 / 60, 0.95, true) ? 1 : 0;
    expect(fired).toBe(1);
    for (let i = 0; i < 60 * 20; i++) fired += t.update(1 / 60, 0.95, true) ? 1 : 0;
    expect(fired).toBe(1);
    // silence doesn't count
    const q = new PeakTrigger(0.5, 1);
    for (let i = 0; i < 200; i++) expect(q.update(1 / 60, 1, false)).toBe(false);
    // the set clock back at the start: ready again
    setClock.progress = 0;
    for (let i = 0; i < 60 * 11; i++) fired += t.update(1 / 60, 0.95, true) ? 1 : 0;
    expect(fired).toBe(2);
  });

  it('the free-play clock runs while the music plays, and stops for a gig', () => {
    setClock.gig = false;
    setClock.progress = 0;
    setClock.freeMinutes = 20;
    tickFreeClock(60, true);
    expect(setClock.progress).toBeCloseTo(1 / 20);
    tickFreeClock(60, false);
    expect(setClock.progress).toBeCloseTo(1 / 20);
    setClock.gig = true;
    tickFreeClock(60, true);
    expect(setClock.progress).toBeCloseTo(1 / 20);
    setClock.gig = false;
    tickFreeClock(1e6, true);
    expect(setClock.progress).toBe(1);
    setClock.progress = 0;
  });
});
