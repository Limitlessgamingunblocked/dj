import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { evaluateSky, skyDir, skyRadiance, skyUv, transmittance, twilightGain } from '../src/three/venues/atmosphere';
import { inBeam, steamStep, sweatStep } from '../src/three/venues/airlife';
import { ringGrid } from '../src/three/venues/water';
import { apertureScale, cocPx } from '../src/three/dof';
import { DepthTap } from '../src/three/ao';
import { cropRect, metresToSlider, sliderToMetres } from '../src/ui/PhotoMode';

const dir = (elDeg: number, az = 0) => {
  const e = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e));
};
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const air = { turbidity: 1.5 };

describe('the sky as light through air', () => {
  it('is blue overhead by day', () => {
    const z = skyRadiance(dir(90), dir(40), 1, air);
    expect(z.b).toBeGreaterThan(z.g);
    expect(z.g).toBeGreaterThan(z.r);
  });

  it('reddens the sun as it gets low, and loses it below the horizon', () => {
    const high = transmittance(dir(60), air);
    const low = transmittance(dir(2), air);
    expect(high.r / high.b).toBeLessThan(2);
    expect(low.r / Math.max(low.b, 1e-6)).toBeGreaterThan(20);
    expect(lum(transmittance(dir(-3), air))).toBe(0);
    // high up, the sun is still out a little after it's set on the ground (pink cloud after sunset)
    expect(lum(transmittance(dir(-1.5), air, 8))).toBeGreaterThan(0);
  });

  it('darkens through twilight, the moon keeps a night sky from going black', () => {
    const moon = dir(30, Math.PI);
    const day = evaluateSky(dir(30), moon, 0, air);
    const dusk = evaluateSky(dir(-4), moon, 0, air);
    const night = evaluateSky(dir(-25), moon, 0, air);
    const moonlit = evaluateSky(dir(-25), moon, 0.012, air);
    expect(lum(day.fill)).toBeGreaterThan(lum(dusk.fill) * 10);
    expect(lum(dusk.fill)).toBeGreaterThan(lum(night.fill));
    expect(lum(moonlit.zenith)).toBeGreaterThan(lum(night.zenith) * 1.5);
    expect(lum(night.sun)).toBe(0);
  });

  it('lifts the twilight sky like a camera opening up, never by day', () => {
    expect(twilightGain(30)).toBe(1);
    expect(twilightGain(-2)).toBeGreaterThan(1);
    expect(twilightGain(-10)).toBeCloseTo(3.5, 5);
    for (let e = 10; e > -12; e -= 1) expect(twilightGain(e - 1)).toBeGreaterThanOrEqual(twilightGain(e));
  });

  it('packs the sky-view table both ways the same', () => {
    for (const [el, az] of [
      [0.5, 0.3],
      [20, -2],
      [60, 2.8],
      [-3, 1],
    ]) {
      const d = dir(el, az);
      const [u, v] = skyUv(d);
      expect(skyDir(u, v).distanceTo(d)).toBeLessThan(1e-6);
    }
  });
});

describe('the water and the air', () => {
  it('builds the water as rings, fine in the middle and coarse at the edge', () => {
    const g = ringGrid(0.5, 1000, 40, 32);
    const pos = g.attributes.position;
    expect(pos.count).toBe(1 + 40 * 32);
    const r = (i: number) => Math.hypot(pos.getX(i), pos.getZ(i));
    expect(r(1 + 32) - r(1)).toBeLessThan(r(1 + 39 * 32) - r(1 + 38 * 32));
    expect(g.index!.count).toBe((32 + 39 * 32 * 2) * 3);
  });

  it('lights a speck of dust only inside a beam', () => {
    const lens = new THREE.Vector3(0, 6, 0);
    const down = new THREE.Vector3(0, -1, 0);
    expect(inBeam(new THREE.Vector3(0, 3, 0), lens, down, 0.1, 10)).toBeGreaterThan(0.5);
    expect(inBeam(new THREE.Vector3(2, 3, 0), lens, down, 0.1, 10)).toBe(0);
    expect(inBeam(new THREE.Vector3(0, 7, 0), lens, down, 0.1, 10)).toBe(0);
    // brighter near the lens than at the far end
    expect(inBeam(new THREE.Vector3(0, 5, 0), lens, down, 0.1, 10)).toBeGreaterThan(inBeam(new THREE.Vector3(0, -3, 0), lens, down, 0.1, 10));
  });

  it('builds steam and sweat over a hot peak, and clears them in the quiet', () => {
    let steam = 0;
    let sweat = 0;
    for (let i = 0; i < 600; i++) {
      steam = steamStep(steam, 0.1, 0.95, 0.8, true);
      sweat = sweatStep(sweat, 0.1, 0.95, 0.8, true);
    }
    expect(steam).toBeGreaterThan(0.6);
    expect(sweat).toBeGreaterThan(0.3);
    const peakSteam = steam;
    for (let i = 0; i < 600; i++) steam = steamStep(steam, 0.1, 0.3, 0, true);
    expect(steam).toBeLessThan(peakSteam * 0.3);
    // a cold room never steams
    expect(steamStep(0, 1, 0.4, 0, true)).toBe(0);
  });
});

describe('photo mode', () => {
  it('blurs away from the focus, more with a wider aperture', () => {
    expect(cocPx(3, 3, apertureScale(2.8), 14)).toBe(0);
    expect(cocPx(10, 3, apertureScale(2.8), 14)).toBeGreaterThan(0);
    expect(cocPx(1, 3, apertureScale(2.8), 14)).toBeLessThan(0);
    expect(Math.abs(cocPx(10, 3, apertureScale(1.4), 14))).toBeGreaterThan(Math.abs(cocPx(10, 3, apertureScale(16), 14)));
  });

  it('crops the picture to the frame, centred', () => {
    expect(cropRect(1920, 1080, null)).toEqual([0, 0, 1920, 1080]);
    expect(cropRect(1920, 1080, 1)).toEqual([420, 0, 1080, 1080]);
    const [x, y, w, h] = cropRect(1920, 1080, 2.39);
    expect(x).toBe(0);
    expect(w / h).toBeCloseTo(2.39, 1);
    expect(y).toBeGreaterThan(0);
  });

  it('copies depth out as distance only on the frames depth of field asks for it', () => {
    const calls: string[] = [];
    const renderer = { setRenderTarget: () => calls.push('target'), render: () => calls.push('draw') } as unknown as THREE.WebGLRenderer;
    const read = new THREE.WebGLRenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
    const tap = new DepthTap(new THREE.PerspectiveCamera());
    const frame = () => tap.render(renderer, read, read);
    frame();
    expect(tap.depth).toBe(read.depthTexture);
    expect(tap.distance).toBeNull();
    expect(calls).toEqual([]);
    tap.requestDistance();
    frame();
    expect(tap.distance).not.toBeNull();
    frame();
    expect(tap.distance).not.toBeNull();
    // nobody asked again: it stops
    frame();
    expect(tap.distance).toBeNull();
    expect(calls.filter((c) => c === 'draw').length).toBe(2);
    // no camera, no copy
    const blind = new DepthTap();
    blind.requestDistance();
    blind.render(renderer, read, read);
    expect(blind.distance).toBeNull();
    tap.dispose();
  });

  it('maps the focus slider to metres and back', () => {
    expect(sliderToMetres(0)).toBeCloseTo(0.4, 5);
    expect(sliderToMetres(1)).toBeCloseTo(60, 5);
    for (const m of [0.6, 2, 7, 25]) expect(sliderToMetres(metresToSlider(m))).toBeCloseTo(m, 5);
  });
});
