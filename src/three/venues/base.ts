/*
 * Venue plumbing: the VenueDef catalogue entry, and VenueBase which every
 * venue scene extends — fixtures list, colour-wash lights driven by the show,
 * a room flash for strobes/blinders, haze-tinted fog and clean disposal.
 *
 * Coordinates: metres, the DJ stands at the origin behind the booth facing −Z
 * (the room); the booth table top is at TABLE_Y.
 */
import * as THREE from 'three';
import type { Features } from '../../visualizer/AudioFeatures';
import type { Grade } from '../lens';
import { updateAll, type Fixture } from './fixtures';
import { ledScreen } from './led';
import { nameService, type NameStyle } from '../../name/NameService';
import type { ShowState } from './show';

export interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

export interface VenueViews {
  /** the venue's signature angle */
  wide: Pose;
  wideLabel: string;
  /** looking at the booth from the dance floor */
  crowd: Pose;
  /** FPV drone loop: over the crowd, past the pyro and the booth (closed CatmullRom path) */
  drone: THREE.Vector3[];
  /**
   * Placing the extra angles in this room (anything left out goes round the
   * booth): the camera up in the lighting rig, the security camera in a high
   * corner, the camcorder in the front rows, the crane's reach and heights
   * (above the booth floor) and the dolly zoom's nearest / furthest distance.
   */
  extra?: {
    rig?: Pose;
    cctv?: Pose;
    camcorder?: Pose;
    crane?: { radius: number; low: number; high: number };
    vertigo?: { near: number; far: number; height: number };
  };
}

export interface LiveFeed {
  camera: THREE.PerspectiveCamera;
  target: THREE.WebGLRenderTarget;
  /** the object showing the feed; rendering is skipped when it's off screen */
  screen: THREE.Object3D;
  /** render the feed every n-th frame (default 3) */
  every?: number;
}

export interface VenueScene {
  readonly group: THREE.Group;
  readonly visMaterials: THREE.MeshBasicMaterial[];
  readonly visObjects: THREE.Object3D[];
  readonly views: VenueViews;
  readonly background: THREE.Color;
  readonly fog: THREE.FogExp2;
  /** tint of the booth work light */
  readonly keyLight: { color: number; intensity: number };
  readonly feed?: LiveFeed;
  /** colour grade for the club camera (tone-mapped output) */
  readonly grade?: Grade;
  /**
   * tone mapper: AgX rolls saturated lights off towards white like a camera
   * sensor and keeps shadow detail; ACES keeps deeper blacks (default)
   */
  readonly toneMapping?: 'aces' | 'agx';
  /**
   * How much of the stage's own soft light (the studio reflections and the
   * blue fill) reaches the room, 0..1 (default 1). A blacklight room wants
   * almost none.
   */
  readonly ambient?: number;
  /** how far the camera sees (default 160 m): open-air venues see the horizon */
  readonly far?: number;
  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void;
  /** off-screen renders the venue needs each frame (light maps), before the club is drawn */
  prerender?(renderer: THREE.WebGLRenderer, dt: number): void;
  dispose(): void;
}

export interface VenueDef {
  id: string;
  name: string;
  /** short name for tight spaces (phone top bar) */
  short?: string;
  /** city / country */
  place: string;
  kind: string;
  blurb: string;
  /** show palette */
  palette: [string, string, string];
  /** accent colour the software UI takes on */
  ui: string;
  capacity: string;
  /** shown once when entering */
  note?: string;
  build(): VenueScene;
  /** small illustration for the venue picker */
  thumb(g: CanvasRenderingContext2D, w: number, h: number): void;
}

interface Wash {
  light: THREE.PointLight | THREE.SpotLight;
  color: number;
  base: number;
  kick: number;
}

export abstract class VenueBase implements VenueScene {
  readonly group = new THREE.Group();
  readonly visMaterials: THREE.MeshBasicMaterial[] = [];
  readonly visObjects: THREE.Object3D[] = [];
  abstract readonly views: VenueViews;
  background = new THREE.Color(0x020306);
  fog: THREE.FogExp2;
  keyLight = { color: 0xfff4e6, intensity: 15 };
  feed?: LiveFeed;
  grade?: Grade;
  toneMapping?: 'aces' | 'agx';
  far?: number;
  protected fixtures: Fixture[] = [];
  protected washes: Wash[] = [];
  protected hemi: THREE.HemisphereLight;
  protected flashLight: THREE.PointLight;
  protected hemiBase: number;
  /** the haze's own colour (open-air venues follow the sky with it) */
  protected fogBase: THREE.Color;
  protected fogDensity: number;
  private boothStrips: THREE.MeshBasicMaterial[] = [];
  private tmp = new THREE.Color();

  constructor(o: { fog: number; fogDensity: number; background?: number; hemiSky: number; hemiGround: number; hemi: number; flashAt: THREE.Vector3; flashRange?: number }) {
    this.fogBase = new THREE.Color(o.fog);
    this.fogDensity = o.fogDensity;
    this.fog = new THREE.FogExp2(o.fog, o.fogDensity);
    if (o.background !== undefined) this.background = new THREE.Color(o.background);
    this.hemiBase = o.hemi;
    this.hemi = new THREE.HemisphereLight(o.hemiSky, o.hemiGround, o.hemi);
    this.flashLight = new THREE.PointLight(0xffffff, 0, o.flashRange ?? 30, 1.4);
    this.flashLight.position.copy(o.flashAt);
    this.group.add(this.hemi, this.flashLight);
  }

  protected add<T extends Fixture>(f: T): T {
    this.fixtures.push(f);
    this.group.add(f.object);
    return f;
  }

  /** a coloured point light that follows palette colour `color` */
  protected wash(pos: THREE.Vector3, color: number, base: number, distance: number, kick = 1): THREE.PointLight {
    const l = new THREE.PointLight(0xffffff, base, distance, 1.6);
    l.position.copy(pos);
    this.group.add(l);
    this.washes.push({ light: l, color, base, kick });
    return l;
  }

  protected strip(m: THREE.MeshBasicMaterial | null): void {
    if (m) this.boothStrips.push(m);
  }

  /**
   * A mesh that shows the visual player. With `led` (a plane's size in metres
   * and the LED pitch) it reads as an LED wall: pixels up close, tile seams,
   * dimmer off-axis.
   */
  protected screen(mesh: THREE.Mesh, led?: { size: [number, number]; pitch: number }): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ color: 0x050608, toneMapped: false });
    if (led) ledScreen(mat, led.size, led.pitch).uLEDGain.value = 1.15;
    mesh.material = mat;
    this.visMaterials.push(mat);
    this.visObjects.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  /** the DJ name as a sign on a wall: a w × h plane at `pos`, turned `rotY` (0 faces +Z) */
  protected nameSign(style: NameStyle, w: number, h: number, pos: THREE.Vector3, rotY: number, gain = 2): THREE.Mesh {
    const m = nameService.surface(style, w, h, { gain });
    m.position.copy(pos);
    m.rotation.y = rotY;
    this.group.add(m);
    return m;
  }

  /** the DJ name over an LED wall (w × h metres), shown on drops, builds and every 32 bars */
  protected nameScreen(screen: THREE.Mesh, w: number, h: number, style: NameStyle): void {
    const m = nameService.surface(style, w * 0.9, h * 0.6, { screen: true, gain: 1.25 });
    m.position.z = 0.03;
    screen.add(m);
  }

  update(s: ShowState, _f: Features, dt: number, camera: THREE.Camera): void {
    updateAll(this.fixtures, s, dt, camera);
    const m = s.master;
    for (const w of this.washes) {
      w.light.color.copy(s.colors[w.color]);
      w.light.intensity = w.base * (0.25 + s.wash * 1.1 + s.kick * 0.9 * w.kick) * m * Math.min(1.3, s.intensity);
    }
    this.flashLight.intensity = s.flash * 22;
    this.hemi.intensity = this.hemiBase * (0.35 + 0.65 * m) + s.flash * 0.35;
    for (const st of this.boothStrips) st.color.copy(s.colors[0]).lerp(this.tmp.setRGB(1, 1, 1), 0.35).multiplyScalar((0.9 + s.kick * 1.2) * (0.3 + 0.7 * m));
    // haze picks up the light
    this.fog.color.copy(this.fogBase).lerp(this.tmp.copy(s.colors[0]).multiplyScalar(0.05 * (0.3 + s.wash)), Math.min(0.7, s.smoke * 0.6));
    this.fog.color.lerp(this.tmp.setRGB(0.22, 0.22, 0.25), s.flash * 0.07);
    this.fog.density = this.fogDensity * (0.7 + s.smoke * 0.6);
    (this.background as THREE.Color).copy(this.fog.color);
  }

  dispose(): void {
    for (const f of this.fixtures) f.dispose?.();
    // the visual player's texture belongs to the visualizer
    for (const m of this.visMaterials) m.map = null;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.LineSegments).isLineSegments) return;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of mats) {
        if (!mm) continue;
        for (const v of Object.values(mm)) {
          const t = v as THREE.Texture;
          if (t && t.isTexture && !t.userData?.shared) t.dispose();
        }
        mm.dispose();
      }
    });
    this.feed?.target.dispose();
  }
}
