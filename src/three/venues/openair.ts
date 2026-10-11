/*
 * The base for venues under the open sky. The time of day runs on the set
 * clock (moments.ts) unless the venue bends it (the Beach Club holds the sun
 * on the sea for a drop); each venue's keys give the sun's height, the stars
 * and when the site lights come on. The sky itself is light through air
 * (atmosphere.ts, sky.ts), and everything outside takes its light from it:
 *   – the sun (a directional light) is the colour and strength of the light
 *     that gets through the air to the ground; after dark the moon takes
 *     over, cool and dim, its strength following its phase
 *   – the hemisphere fill is the sky's own light from above and the ground's
 *     bounce from below (the site's albedo lit by the sun and the sky)
 *   – the haze takes the horizon's colour; metal and glass reflect the sky
 */
import * as THREE from 'three';
import type { Features } from '../../visualizer/AudioFeatures';
import { VenueBase } from './base';
import { evaluateSky, MOON_I, newSkyLight, transmittance, twilightGain, type AirSpec } from './atmosphere';
import { setClock } from './moments';
import { newLook, sampleSky, sunDirection, type SkyKey, type SkyLook } from './outdoor';
import { PhysicalSky, type CloudSpec } from './sky';
import type { ShowState } from './show';

export interface MoonSpec {
  /** bearing (0 behind the booth, +Z) */
  yaw: number;
  /** height in degrees at the start and the end of the set */
  el0: number;
  el1: number;
}

export interface OpenAirSpec {
  air: AirSpec;
  clouds: CloudSpec;
  moon: MoonSpec;
  /** the ground's colour for the light it bounces back up (grass, sand, sea, playa) */
  albedo: string;
  /** the far ground or sea below the horizon, as a share of the horizon's light */
  groundTint?: string;
}

/** fill: the hemisphere light per unit of sky light (calibrated against the keyed skies it replaced) */
const FILL_K = 1.3;
const MOON_LIGHT = 0.16;
const MOON_TINT = new THREE.Color(0.72, 0.82, 1);

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export abstract class OpenAir extends VenueBase {
  protected sky: PhysicalSky;
  protected sun = new THREE.DirectionalLight(0xffffff, 0);
  protected look: SkyLook = newLook();
  /** where the sun is: 0 behind the booth (+Z), π in front of the DJ, over the crowd */
  protected sunYaw: number;
  /** the glow along the horizon (city light), added to the sky */
  protected glow = new THREE.Color(0, 0, 0);
  protected time = 0;
  /** how much of the haze takes the horizon's colour (the horizon's light is the real thing now: bright by day) */
  protected hazeFromSky = 0.62;
  /** the strongest the sun gets here (the keys' brightest light) */
  private sunPeak: number;
  private light = newSkyLight();
  private lightKey = '';
  private cirrusSun = new THREE.Color();
  private albedo: THREE.Color;
  private groundTint: THREE.Color;
  private lastSun = new THREE.Color(1, 0.6, 0.3);
  private c = new THREE.Color();
  private c2 = new THREE.Color();

  constructor(
    o: ConstructorParameters<typeof VenueBase>[0] & { skyRadius?: number; sunYaw: number },
    protected keys: SkyKey[],
    protected spec: OpenAirSpec,
  ) {
    super(o);
    this.sunYaw = o.sunYaw;
    this.sky = new PhysicalSky(o.skyRadius ?? 700, spec.air, spec.clouds);
    this.far = (o.skyRadius ?? 700) * 1.3;
    this.sunPeak = Math.max(...keys.map((k) => k.light), 0.5);
    this.albedo = new THREE.Color(spec.albedo);
    this.groundTint = new THREE.Color(spec.groundTint ?? spec.albedo);
    this.group.add(this.sky.mesh, this.sun, this.sun.target);
  }

  /** the sky's reflections for the materials out here (Stage puts them on the scene) */
  get environment(): THREE.Texture | null {
    return this.sky.environment;
  }

  /** the time of day, 0..1 */
  protected dayK(): number {
    return setClock.progress;
  }

  /** change the sampled sky before it's applied (the sun held on the horizon, say) */
  protected shapeSky(_l: SkyLook, _s: ShowState, _dt: number): void {}

  prerender(renderer: THREE.WebGLRenderer, dt: number): void {
    this.sky.prerender(renderer, dt);
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const k = this.dayK();
    const l = sampleSky(this.keys, k, this.look);
    this.shapeSky(l, s, dt);
    const sky = this.sky;
    const sunDir = sunDirection(l.sun, this.sunYaw, sky.sunDir);
    const m = this.spec.moon;
    const moonEl = m.el0 + (m.el1 - m.el0) * k;
    const moonDir = sunDirection(moonEl, m.yaw, sky.moonDir);
    // the moon's lit share: full opposite the sun, new beside it
    const phase = (1 - sunDir.dot(moonDir)) / 2;
    const moonI = MOON_I * phase * THREE.MathUtils.clamp((moonEl + 1) / 3, 0, 1);
    const gain = twilightGain(l.sun);
    sky.lutUniforms(gain, moonI);
    // the light, re-worked when the sun or the moon has moved enough to see
    const key = `${l.sun.toFixed(2)}|${moonEl.toFixed(1)}`;
    const L = this.light;
    if (key !== this.lightKey) {
      this.lightKey = key;
      evaluateSky(sunDir, moonDir, moonI, this.spec.air, L, 2, gain);
      transmittance(sunDir, this.spec.air, 8, this.cirrusSun);
    }
    // what the rest of the venue reads: the physical sky written into the look
    l.zenith.copy(L.zenith);
    l.horizon.copy(L.horizon);
    l.ground.copy(L.horizon).multiply(this.groundTint).multiplyScalar(0.55);
    const sunT = lum(L.sun);
    if (sunT > 1e-4) {
      const mx = Math.max(L.sun.r, L.sun.g, L.sun.b);
      this.lastSun.copy(L.sun).multiplyScalar(1 / mx);
    }
    l.sunColor.copy(this.lastSun);
    // the eye takes a low sun as brighter than the meter does
    const sunRel = Math.pow(Math.min(1, sunT / 0.82), 0.55);
    l.light = this.sunPeak * sunRel;
    const fm = Math.max(L.fill.r, L.fill.g, L.fill.b, 1e-6);
    l.ambSky.copy(L.fill).multiplyScalar(1 / fm);
    l.amb = fm * FILL_K;
    // the ground's bounce: its colour lit by the sun and the sky
    this.c.copy(L.sun).multiplyScalar(sunRel * Math.max(0, sunDir.y) * 0.8).add(this.c2.copy(L.fill).multiplyScalar(1.6));
    l.ambGround.copy(this.albedo).multiply(this.c).multiplyScalar(FILL_K / Math.max(l.amb, 1e-4));
    // the dome
    const u = sky.u;
    (u.uSunDisc.value as THREE.Color).copy(L.sun);
    const moonT = transmittance(moonDir, this.spec.air, 0.01, this.c2);
    const mt = Math.max(moonT.r, moonT.g, moonT.b, 1e-4);
    (u.uMoonLight.value as THREE.Color).setRGB(1.25, 1.22, 1.15).multiply(moonT.multiplyScalar(1 / Math.max(mt, 0.25)));
    u.uMoonPhaseLight.value = phase;
    (u.uCloudSun.value as THREE.Color).copy(L.cloudSun).multiplyScalar(1.1 * gain);
    (u.uCirrusSun.value as THREE.Color).copy(this.cirrusSun).multiplyScalar(0.9 * gain);
    (u.uCloudMoon.value as THREE.Color).copy(L.moon).multiplyScalar(0.5);
    (u.uCloudAmb.value as THREE.Color).copy(L.fill).multiplyScalar(0.9);
    // the site's light thrown up under the cloud: the city glow and the show's colours
    this.c.copy(s.colors[0]).lerp(s.colors[1], 0.5).multiplyScalar(0.012 * s.master * (0.4 + s.wash) * l.night);
    (u.uCloudGlow.value as THREE.Color).copy(this.glow).multiplyScalar(0.6).add(this.c);
    (u.uGround.value as THREE.Color).copy(l.ground);
    (u.uGlow.value as THREE.Color).copy(this.glow);
    // stars fade as the moon brightens the sky
    u.uStars.value = l.stars * (1 - 0.5 * phase * THREE.MathUtils.clamp(moonEl / 20, 0, 1));
    sky.tick(dt, this.time);
    // the sun by day, the moon by night
    const moonLight = MOON_LIGHT * phase * THREE.MathUtils.clamp((moonEl - 1) / 6, 0, 1) * THREE.MathUtils.clamp((-l.sun - 1) / 4, 0, 1);
    if (l.light >= moonLight) {
      this.sun.color.copy(l.sunColor);
      this.sun.intensity = l.light;
      this.sun.position.copy(sunDir).multiplyScalar(80);
    } else {
      this.sun.color.copy(MOON_TINT);
      this.sun.intensity = moonLight;
      this.sun.position.copy(moonDir).multiplyScalar(80);
    }
    this.hemi.color.copy(l.ambSky);
    this.hemi.groundColor.copy(l.ambGround);
    this.hemiBase = l.amb;
    this.fogBase.copy(l.horizon).multiplyScalar(this.hazeFromSky);
    super.update(s, f, dt, camera);
    // daylight doesn't black out with the rig
    this.hemi.intensity = l.amb * (0.35 + 0.65 * Math.max(s.master, 1 - l.night)) + s.flash * 0.3;
  }

  dispose(): void {
    this.sky.dispose();
    super.dispose();
  }
}
