/*
 * The base for venues under the open sky: the sky dome, the sun (a
 * directional light that follows it), the sky's fill light and the haze all
 * follow the time of day, which runs on the set clock (moments.ts) unless the
 * venue bends it (the Beach Club holds the sun on the sea for a drop).
 */
import * as THREE from 'three';
import type { Features } from '../../visualizer/AudioFeatures';
import { VenueBase } from './base';
import { setClock } from './moments';
import { newLook, sampleSky, SkyDome, type SkyKey, type SkyLook } from './outdoor';
import type { ShowState } from './show';

export abstract class OpenAir extends VenueBase {
  protected sky: SkyDome;
  protected sun = new THREE.DirectionalLight(0xffffff, 0);
  protected look: SkyLook = newLook();
  /** where the sun is: 0 behind the booth (+Z), π in front of the DJ, over the crowd */
  protected sunYaw: number;
  /** the glow along the horizon (city light), added to the sky */
  protected glow = new THREE.Color(0, 0, 0);
  protected time = 0;
  /** how much of the haze takes the horizon's colour */
  protected hazeFromSky = 0.85;

  constructor(
    o: ConstructorParameters<typeof VenueBase>[0] & { skyRadius?: number; sunYaw: number },
    protected keys: SkyKey[],
  ) {
    super(o);
    this.sunYaw = o.sunYaw;
    this.sky = new SkyDome(o.skyRadius ?? 700);
    this.far = (o.skyRadius ?? 700) * 1.3;
    this.group.add(this.sky.mesh, this.sun, this.sun.target);
  }

  /** the time of day, 0..1 */
  protected dayK(): number {
    return setClock.progress;
  }

  /** change the sampled sky before it's applied (the sun held on the horizon, say) */
  protected shapeSky(_l: SkyLook, _s: ShowState, _dt: number): void {}

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const l = sampleSky(this.keys, this.dayK(), this.look);
    this.shapeSky(l, s, dt);
    this.sky.apply(l, this.sunYaw, this.time, this.glow);
    this.sun.color.copy(l.sunColor);
    this.sun.intensity = l.light * THREE.MathUtils.clamp((l.sun + 1) / 3, 0, 1);
    this.sun.position.copy(this.sky.sunDir).multiplyScalar(80);
    this.hemi.color.copy(l.ambSky);
    this.hemi.groundColor.copy(l.ambGround);
    this.hemiBase = l.amb;
    this.fogBase.copy(l.horizon).multiplyScalar(this.hazeFromSky);
    super.update(s, f, dt, camera);
    // daylight doesn't black out with the rig
    this.hemi.intensity = l.amb * (0.35 + 0.65 * Math.max(s.master, 1 - l.night)) + s.flash * 0.3;
  }
}
