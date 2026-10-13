/*
 * Burning Man, Black Rock City, Nevada: a fan-made recreation, not
 * affiliated with Burning Man Project. Burn night on the open playa: you're
 * on the top deck of a sound art car parked on the burn perimeter, 1,000 ft
 * from the Man at about 5:30, the crowd in front of you in fur and goggles
 * and EL wire, a fire-breathing mechanical octopus parked alongside, art cars
 * crawling past at 5 mph, bikes everywhere. Behind you the Man stands on his
 * pavilion in neon, the Temple out past him at 12:00, the mountains round the
 * whole lake bed; in front, past the crowd, the city's horseshoe of light from
 * 2:00 to 10:00 with Center Camp at 6:00 and the lantern spires walking down
 * the promenade. The set runs from the dark to sunrise.
 *
 * Measurements and the layout come from Burning Man's city plan (playa.ts).
 * The Man, the Temple and every art car here are generic forms built for
 * this, not copies of any year's design or any artist's work.
 *
 * Signature moment: the Man burns. On a long peak in the dark he raises his
 * arms, the fireworks go up off his base, the fire takes the pavilion and
 * climbs him, and he falls. The fire burns down to a glow for the rest of
 * the night.
 */
import * as THREE from 'three';
import { nameStyleFor } from '../../name/venueStyles';
import type { Features } from '../../visualizer/AudioFeatures';
import type { VenueDef, VenueViews } from './base';
import { boothClutter } from './details';
import { Dresser } from './dress';
import { FarCrowd, scatter } from './farcrowd';
import { crewArc, vipCrew } from './crew';
import { booth, Crowd, crowdArea, HazeLayer, MovingHeads, speaker, Strobes, TABLE_Y, type Fixture } from './fixtures';
import { thinFog } from './landmarks';
import { Lasers } from './lasers';
import { moments, PeakTrigger, setClock } from './moments';
import { OpenAir } from './openair';
import type { SkyKey } from './outdoor';
import { BikeLights, BRC, burnState, BurnFire, centerCamp, CityLights, clockPos, Fireballs, Fireworks, lanternSpires, milkyWay, playaMountains, playaTexture, temple, TheMan } from './playa';
import type { ShowState } from './show';
import { rng } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** the playa, below the art car's top deck */
export const PL = -3.8;
/** the Man: on the burn perimeter, 1,000 ft out, us at about 5:30 */
export const MAN = V(75, PL, 296);

/**
 * The night on the playa, dark to sunrise: no moon, the Milky Way over a
 * dark desert, the city's glow on the horizon behind the crowd; then blue
 * hour, the hills going magenta, and the sun up over them at about one
 * o'clock (sunrise is about 6:15 at the end of August).
 */
export const PLAYA_SKY: SkyKey[] = [
  { k: 0, zenith: '#020309', horizon: '#141022', ground: '#06060a', sun: -24, sunColor: '#ff7a3a', light: 0, ambSky: '#1a1e3a', ambGround: '#0a0a0e', amb: 0.16, stars: 1, night: 1 },
  { k: 0.65, zenith: '#03040c', horizon: '#161226', ground: '#07070c', sun: -14, sunColor: '#ff7a3a', light: 0, ambSky: '#1e2240', ambGround: '#0a0a10', amb: 0.17, stars: 0.95, night: 1 },
  { k: 0.8, zenith: '#0a1236', horizon: '#3a3050', ground: '#0e0e16', sun: -7, sunColor: '#ff7050', light: 0, ambSky: '#3a4070', ambGround: '#16141c', amb: 0.28, stars: 0.5, night: 0.85 },
  { k: 0.9, zenith: '#1e3a7a', horizon: '#ff9a6a', ground: '#2a2228', sun: -1.8, sunColor: '#ff6a3a', light: 0.2, ambSky: '#9a88b0', ambGround: '#4a3830', amb: 0.5, stars: 0.08, night: 0.45 },
  { k: 0.97, zenith: '#3a68b0', horizon: '#ffc890', ground: '#5a4a40', sun: 0.8, sunColor: '#ff9a50', light: 1.6, ambSky: '#d0b8a8', ambGround: '#8a7460', amb: 0.66, stars: 0, night: 0.15 },
  { k: 1, zenith: '#4a80c8', horizon: '#ffd8a8', ground: '#7a6a5a', sun: 3.5, sunColor: '#ffb868', light: 2.6, ambSky: '#d8d4cc', ambGround: '#a89880', amb: 0.8, stars: 0, night: 0 },
];

/* ------------------------------------------------------------------ */
/* the sound art car                                                    */
/* ------------------------------------------------------------------ */

const RIB_VERT = /* glsl */ `
  attribute vec2 aRib;
  varying vec2 vRib;
  void main() {
    vRib = aRib;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RIB_FRAG = /* glsl */ `
  uniform vec3 uC0, uC1, uC2;
  uniform float uTime, uBeat, uKick, uLevel, uSafe;
  varying vec2 vRib;
  void main() {
    // each rib takes a colour from the show, a pulse runs up every rib on the beat and meets at the spine
    float along = abs(vRib.x - 0.5) * 2.0;
    vec3 c = mix(mix(uC0, uC1, smoothstep(0.0, 0.5, vRib.y)), uC2, smoothstep(0.5, 1.0, vRib.y));
    float pulse = exp(-pow((1.0 - along) - fract(uBeat) , 2.0) * 40.0);
    float chase = 0.55 + 0.45 * sin(vRib.y * 18.0 - uTime * 2.0);
    float k = uLevel * (0.35 + 0.35 * chase + mix(0.8, 0.25, uSafe) * pulse + uKick * mix(0.6, 0.15, uSafe));
    gl_FragColor = vec4(c * k * 1.6, 1.0);
  }
`;

/** a tube of varying radius along a curve, with ribs every so often (the octopus's arms) */
function taperTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 40, radial = 10, bands = 0): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(seg, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p = curve.getPointAt(t);
    let r = r0 + (r1 - r0) * t;
    // a band every so often, proud of the skin
    if (bands > 0) {
      const f = (t * bands) % 1;
      if (f < 0.12) r *= 1.12;
    }
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const n = N.clone().multiplyScalar(Math.cos(a)).add(B.clone().multiplyScalar(Math.sin(a)));
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * The art car's canopy: steel ribs arching over the top deck like an
 * upturned hull, pixel strips down every rib, one shader for all of them.
 */
class RibLights implements Fixture {
  readonly object: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private t = 0;

  constructor(ribs: THREE.Curve<THREE.Vector3>[]) {
    const geos: THREE.BufferGeometry[] = [];
    ribs.forEach((c, k) => {
      const g = new THREE.TubeGeometry(c, 48, 0.06, 5, false);
      const n = g.attributes.position.count;
      const rib = new Float32Array(n * 2);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) rib.set([uv.getX(i), k / Math.max(1, ribs.length - 1)], i * 2);
      g.setAttribute('aRib', new THREE.BufferAttribute(rib, 2));
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      geos.push(g.toNonIndexed());
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uTime: { value: 0 }, uBeat: { value: 0 }, uKick: { value: 0 }, uLevel: { value: 1 }, uSafe: { value: 0 } },
      vertexShader: RIB_VERT,
      fragmentShader: RIB_FRAG,
      toneMapped: false,
    });
    const merged = new THREE.BufferGeometry();
    let count = 0;
    for (const g of geos) count += g.attributes.position.count;
    const pos = new Float32Array(count * 3);
    const rib = new Float32Array(count * 2);
    let o = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      rib.set(g.attributes.aRib.array as Float32Array, o * 2);
      o += g.attributes.position.count;
      g.dispose();
    }
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('aRib', new THREE.BufferAttribute(rib, 2));
    this.object = new THREE.Mesh(merged, this.mat);
  }

  update(s: ShowState, dt: number): void {
    this.t += dt;
    const u = this.mat.uniforms;
    (u.uC0.value as THREE.Color).copy(s.colors[0]);
    (u.uC1.value as THREE.Color).copy(s.colors[1]);
    (u.uC2.value as THREE.Color).copy(s.colors[2]);
    u.uTime.value = this.t;
    u.uBeat.value = s.beat;
    u.uKick.value = s.kick;
    u.uLevel.value = 0.3 + 0.7 * s.master;
    u.uSafe.value = s.reduceFlash ? 1 : 0;
  }
}

/* ------------------------------------------------------------------ */
/* the mechanical octopus                                               */
/* ------------------------------------------------------------------ */

/**
 * A fire-breathing mechanical octopus art car: a riveted brass mantle on a
 * rolling base, two lamp eyes with a slit pupil, a chimney on the crown, and
 * eight segmented arms, six of them raised with propane nozzles at their
 * tips. It throws fireballs on the drop and through the peak, and now and
 * then on its own. (An original design in the spirit of the playa's fire
 * creatures, not a copy of any of them.)
 */
class MechOctopus implements Fixture {
  readonly object = new THREE.Group();
  readonly fire: Fireballs;
  private arms: { g: THREE.Group; phase: number; tip: THREE.Vector3; az: number; raised: boolean; lights: THREE.Vector3[] }[] = [];
  private eyes: THREE.MeshBasicMaterial;
  private lightPts: THREE.Points;
  private lightPos: THREE.BufferAttribute;
  private lightCol: THREE.BufferAttribute;
  private t = 0;
  private lastBar = -1;
  private r = rng(4242);
  private tmp = new THREE.Vector3();
  private headNozzle: THREE.Vector3;

  constructor(pos: THREE.Vector3, yaw: number, d: Dresser) {
    this.object.position.copy(pos);
    this.object.rotation.y = yaw;
    this.object.updateMatrixWorld();
    const m = this.object.matrixWorld.clone();
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.85, roughness: 0.32 });
    const copper = new THREE.MeshStandardMaterial({ color: 0x9a5a34, metalness: 0.8, roughness: 0.4 });
    const put = (mat: THREE.Material | 'black' | 'blackMetal' | 'rubber' | 'steel', g: THREE.BufferGeometry) => d.put(mat, g.applyMatrix4(m));
    // the rolling base: a riveted deck on six wheels, skirt panels with portholes
    put(copper, new THREE.BoxGeometry(7.6, 1.0, 6.2).translate(0, 0.95, 0));
    // a matte deck: polished, its flat top caught the wash and threw a lens ghost across the frame
    put('blackMetal', new THREE.BoxGeometry(7.8, 0.14, 6.4).translate(0, 1.5, 0));
    for (const x of [-2.6, 0, 2.6]) for (const z of [-3.0, 3.0]) put('rubber', new THREE.CylinderGeometry(0.62, 0.62, 0.5, 16).rotateX(Math.PI / 2).translate(x, 0.62, z));
    const port = d.glow('#ffb35a', 'breathe', 1.6);
    for (const x of [-3, -1.5, 0, 1.5, 3]) for (const z of [-3.11, 3.11]) d.put(port, new THREE.CircleGeometry(0.2, 12).rotateY(z < 0 ? Math.PI : 0).translate(x, 0.95, z).applyMatrix4(m));
    // the mantle: an egg of brass plates with rivet bands
    const profile = [V(1.7, 0, 0), V(2.4, 0.6, 0), V(2.75, 1.8, 0), V(2.65, 3.2, 0), V(2.25, 4.4, 0), V(1.55, 5.3, 0), V(0.65, 5.85, 0), V(0, 5.95, 0)].map((p) => new THREE.Vector2(p.x, p.y));
    const mantleY = 1.55;
    put(brass, new THREE.LatheGeometry(profile, 32).translate(0, mantleY, 0));
    const curve = new THREE.SplineCurve(profile);
    for (const t of [0.12, 0.3, 0.48, 0.66, 0.82]) {
      const p = curve.getPointAt(t);
      put(copper, new THREE.TorusGeometry(p.x + 0.02, 0.06, 6, 40).rotateX(Math.PI / 2).translate(0, mantleY + p.y, 0));
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        put(copper, new THREE.SphereGeometry(0.05, 5, 3).translate(Math.cos(a) * (p.x + 0.06), mantleY + p.y + 0.12, Math.sin(a) * (p.x + 0.06)));
      }
    }
    // the eyes: lamp discs in brass sockets, a slit pupil, a heavy brow
    this.eyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.1, 0.3), toneMapped: false });
    for (const s of [-1, 1]) {
      const ex = s * 1.25;
      const ey = mantleY + 3.1;
      const ez = 2.45;
      const face = new THREE.Matrix4().makeRotationY(s * 0.32);
      const at = (g: THREE.BufferGeometry) => g.applyMatrix4(face).translate(ex, ey, ez);
      put(brass, at(new THREE.TorusGeometry(0.72, 0.13, 8, 28)));
      d.put(this.eyes, at(new THREE.CircleGeometry(0.62, 28).translate(0, 0, 0.02)).applyMatrix4(m));
      put('black', at(new THREE.BoxGeometry(0.95, 0.14, 0.04).translate(0, 0, 0.06)));
      put(copper, at(new THREE.TorusGeometry(0.85, 0.16, 6, 20, Math.PI).translate(0, 0.12, 0.05)));
    }
    // a siphon on the side, a chimney and nozzle on the crown
    put(copper, new THREE.CylinderGeometry(0.28, 0.45, 1.4, 12).rotateZ(1.2).translate(2.6, mantleY + 1.4, 0.8));
    put(copper, new THREE.CylinderGeometry(0.3, 0.38, 1.3, 12).translate(0, mantleY + 6.4, 0));
    put('steel', new THREE.CylinderGeometry(0.42, 0.2, 0.3, 12).translate(0, mantleY + 7.1, 0));
    this.headNozzle = V(0, mantleY + 7.3, 0);

    // the arms: from round the base of the mantle; six raised with nozzles, the two at the front resting on the deck
    const nozzles: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const az = (i / 8) * Math.PI * 2 + Math.PI / 8;
      // the face is +Z: the arm's outward direction is (cos az, −sin az), so the front pair sit near az = −90°
      const front = Math.abs(Math.atan2(Math.sin(az + Math.PI / 2), Math.cos(az + Math.PI / 2))) < 0.6;
      const lift = 4.6 + (i % 3) * 0.8;
      const pts = front
        ? [V(0, 0, 0), V(1.4, -0.4, 0), V(3.0, -1.0, 0.3), V(4.4, -1.15, -0.2), V(5.3, -0.9, 0.4), V(5.0, -0.4, 0.9)]
        : [V(0, 0, 0), V(1.3, -0.3, 0), V(2.9, 0.1, 0.2), V(3.9, 1.6, -0.2), V(3.8, 3.2, 0.3), V(3.3, lift - 0.6, 0), V(3.15, lift, 0)];
      const c = new THREE.CatmullRomCurve3(pts);
      const g = new THREE.Group();
      g.position.set(Math.cos(az) * 2.1, mantleY + 0.5, -Math.sin(az) * 2.1);
      g.rotation.set(0, az, 0);
      const arm = new THREE.Mesh(taperTube(c, 0.55, front ? 0.14 : 0.2, 48, 10, 9), brass);
      g.add(arm);
      const tip = c.getPointAt(1).clone();
      if (!front) {
        const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.5, 10), copper);
        nz.position.copy(tip).add(V(0, 0.2, 0));
        g.add(nz);
        nozzles.push(V(0, 0, 0));
      }
      const lights: THREE.Vector3[] = [];
      for (let k = 1; k <= 10; k++) {
        const t = k / 11;
        const p = c.getPointAt(t);
        lights.push(p.clone().add(V(0, 0.42 - t * 0.25, 0)));
      }
      this.object.add(g);
      this.arms.push({ g, phase: i * 1.7, tip: tip.add(V(0, 0.5, 0)), az, raised: !front, lights });
    }
    nozzles.push(V(0, 0, 0));
    this.fire = new Fireballs(nozzles, { size: 2.1, lightRange: 70 });
    // warm lamps along the arms, chasing out to the tips on the beat
    const n = this.arms.length * 10;
    const g = new THREE.BufferGeometry();
    this.lightPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.lightCol = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    g.setAttribute('position', this.lightPos);
    g.setAttribute('color', this.lightCol);
    this.lightPts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.32, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.lightPts.frustumCulled = false;
  }

  /** the fireballs and the arm lamps live in world space; add them to the venue next to this */
  extras(): THREE.Object3D[] {
    return [this.lightPts];
  }

  update(s: ShowState, dt: number): void {
    this.t += dt;
    const t = this.t;
    // the arms sway, a little more as the crowd gets into it; the raised ones lift at the peak
    for (const a of this.arms) {
      const sway = Math.sin(t * 0.55 + a.phase) * 0.05 + Math.sin(t * 1.3 + a.phase * 2) * 0.02;
      a.g.rotation.set(0, a.az, sway * (0.6 + s.hype) + (a.raised ? s.peak * 0.06 : 0));
    }
    this.object.updateMatrixWorld();
    let k = 0;
    for (const a of this.arms) {
      if (a.raised) this.fire.nozzles[k++].copy(a.g.localToWorld(this.tmp.copy(a.tip)));
    }
    this.fire.nozzles[k].copy(this.object.localToWorld(this.tmp.copy(this.headNozzle)));
    // now and then a single poof on a bar line, even in the groove
    if (s.playing && s.bar !== this.lastBar) {
      this.lastBar = s.bar;
      if (s.bar % (s.reduceFlash ? 8 : 4) === 0 && this.fire.sinceFire() > 2) this.fire.fire([Math.floor(this.r() * this.fire.nozzles.length)]);
    }
    this.fire.update(s, dt);
    // the eyes glow with the music
    this.eyes.color.setRGB(2.2, 1.1, 0.3).multiplyScalar(0.55 + 0.35 * s.level + 0.25 * s.kick);
    const p = this.lightPos.array as Float32Array;
    const c = this.lightCol.array as Float32Array;
    let i = 0;
    const beat = s.beat % 1;
    for (const a of this.arms)
      a.lights.forEach((lp, j) => {
        const w = a.g.localToWorld(this.tmp.copy(lp));
        p.set([w.x, w.y, w.z], i * 3);
        const run = Math.exp(-Math.pow(j / 9 - beat, 2) * (s.reduceFlash ? 6 : 30));
        const b = 0.5 + 0.9 * run * s.master;
        c.set([2.0 * b, 1.1 * b, 0.35 * b], i * 3);
        i++;
      });
    this.lightPos.needsUpdate = true;
    this.lightCol.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* art cars on the move                                                 */
/* ------------------------------------------------------------------ */

type CarKind = 'jellyfish' | 'galleon' | 'dome' | 'fish';

/** an art car's body (dark) and its lights (one colour, cycled), built facing +Z, wheels on y = 0 */
function artCarParts(kind: CarKind): { body: THREE.BufferGeometry; lights: THREE.BufferGeometry } {
  const body: THREE.BufferGeometry[] = [];
  const lit: THREE.BufferGeometry[] = [];
  const wheels = (len: number, wid: number) => {
    for (const z of [-len * 0.35, len * 0.35]) for (const x of [-wid / 2, wid / 2]) body.push(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10).rotateZ(Math.PI / 2).translate(x, 0.5, z));
    body.push(new THREE.BoxGeometry(wid, 0.6, len).translate(0, 0.9, 0));
  };
  if (kind === 'jellyfish') {
    wheels(5, 3);
    body.push(new THREE.CylinderGeometry(0.3, 0.3, 3, 8).translate(0, 2.7, 0));
    lit.push(new THREE.SphereGeometry(3.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 4.0, 0));
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const len = 1.6 + (i % 3) * 0.7;
      lit.push(new THREE.CylinderGeometry(0.05, 0.05, len, 4).translate(Math.cos(a) * 3.0, 4.0 - len / 2, Math.sin(a) * 3.0));
    }
  } else if (kind === 'galleon') {
    wheels(9, 3.4);
    const hull = new THREE.CylinderGeometry(1.9, 1.2, 9, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI).translate(0, 2.4, 0);
    body.push(hull);
    for (const z of [-2.8, 0.4, 3.2]) {
      body.push(new THREE.CylinderGeometry(0.1, 0.12, 8, 6).translate(0, 6.2, z));
      lit.push(new THREE.PlaneGeometry(3.2 - Math.abs(z) * 0.2, 2.4).translate(0, 6.0, z + 0.05));
      lit.push(new THREE.PlaneGeometry(2.6 - Math.abs(z) * 0.2, 1.8).translate(0, 8.4, z + 0.05));
    }
    lit.push(new THREE.BoxGeometry(3.6, 0.08, 9.2).translate(0, 2.45, 0));
  } else if (kind === 'dome') {
    wheels(6, 3.2);
    body.push(new THREE.IcosahedronGeometry(3.2, 1).translate(0, 3.0, 0));
    lit.push(new THREE.IcosahedronGeometry(3.25, 1).translate(0, 3.0, 0));
    lit.push(new THREE.SphereGeometry(0.7, 12, 8).translate(0, 6.9, 0));
  } else {
    wheels(8, 3);
    // a fish in ribs: an outline of light bands on a dark frame
    for (let i = 0; i <= 8; i++) {
      const z = -4 + i;
      const r = Math.sin((i / 8) * Math.PI) * 2.2 + 0.3;
      lit.push(new THREE.TorusGeometry(r, 0.07, 4, 20).translate(0, 3.2, z));
    }
    lit.push(new THREE.ConeGeometry(1.6, 2, 4).rotateX(-Math.PI / 2).translate(0, 3.2, -5.2));
    body.push(new THREE.BoxGeometry(0.3, 0.3, 9).translate(0, 3.2, 0));
  }
  const fix = (gs: THREE.BufferGeometry[]) => mergeAll(gs);
  return { body: fix(body), lights: fix(lit) };
}

function mergeAll(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = gs.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  });
  let count = 0;
  for (const g of flat) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * Art cars crawling round the Man at 5 mph, each on its own loop: a
 * jellyfish with glowing strands, a galleon under lit sails, a dome with a
 * mirror ball, a fish in rings of light. Lights cycle slowly through colours.
 */
class RoamingArtCars implements Fixture {
  readonly object = new THREE.Group();
  private cars: { g: THREE.Group; mat: THREE.MeshBasicMaterial; r: number; a: number; w: number; hue: number }[] = [];
  private t = 0;

  constructor(
    private man: THREE.Vector3,
    private night: () => number,
  ) {
    const body = thinFog(new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.7, metalness: 0.3 }), 0.6);
    const spec: [CarKind, number, number, number][] = [
      ['jellyfish', 150, 2.6, 0.55],
      ['galleon', 210, 0.4, 0.08],
      ['dome', 185, 4.2, 0.8],
      ['fish', 245, 1.4, 0.3],
    ];
    for (const [kind, r, a, hue] of spec) {
      const parts = artCarParts(kind);
      const g = new THREE.Group();
      const mat = thinFog(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }), 0.4);
      g.add(new THREE.Mesh(parts.body, body), new THREE.Mesh(parts.lights, mat));
      this.object.add(g);
      // 5 mph is about 2.2 m/s; some go round one way, some the other
      this.cars.push({ g, mat, r, a, w: ((kind === 'galleon' || kind === 'fish' ? -1 : 1) * 2.2) / r, hue });
    }
  }

  update(s: ShowState, dt: number): void {
    this.t += dt;
    const n = this.night();
    for (const c of this.cars) {
      c.a += c.w * dt;
      const x = this.man.x + Math.sin(c.a) * c.r;
      const z = this.man.z + Math.cos(c.a) * c.r;
      c.g.position.set(x, this.man.y, z);
      // facing along the loop
      c.g.rotation.y = c.a + (c.w > 0 ? Math.PI / 2 : -Math.PI / 2);
      const h = (c.hue + this.t * 0.02) % 1;
      c.mat.color.setHSL(h, 0.85, 0.5).multiplyScalar(0.4 + 1.6 * n * (0.8 + 0.2 * s.level));
    }
  }
}

/* ------------------------------------------------------------------ */
/* the venue                                                            */
/* ------------------------------------------------------------------ */

class BurningMan extends OpenAir {
  // the burn fills the frame with fire: its lens ghost would land on the crowd as a red smear
  readonly lensGhost = 0.25;
  readonly views: VenueViews = {
    // from the top deck of the next art car along: the crowd, the car, the Man in neon past it
    wide: { pos: V(-34, 9, -52), target: V(8, 0, 30) },
    wideLabel: 'From the next art car',
    director: {
      style: 'cinematic',
      open: true,
      landmarks: [
        { label: 'The Man', from: { pos: V(0, 5.6, 3), target: V(MAN.x, MAN.y + 12, MAN.z) }, to: { pos: V(1, 5.9, 3.4), target: V(MAN.x, MAN.y + 16, MAN.z) }, fov: 12 },
        { label: 'The octopus', from: { pos: V(-14, PL + 3, -10), target: V(-27, PL + 5, 2) }, to: { pos: V(-17, PL + 2.5, -12), target: V(-27, PL + 6, 2) }, fov: 40 },
        { label: 'The open playa', from: { pos: V(-60, 6, -40), target: V(0, 2, 0) }, to: { pos: V(-55, 9, -32), target: V(0, 2, 0) }, fov: 30 },
      ],
    },
    crowd: { pos: V(-2.2, PL + 1.8, -11), target: V(0, 1.6, 0) },
    drone: [V(0, 8, 6), V(18, 5, -6), V(30, 8, -30), V(10, 12, -52), V(-30, 10, -38), V(-42, 7, -6), V(-28, 11, 18), V(0, 14, 32), V(40, 18, 90), V(24, 11, 34), V(10, 6, 12)],
    extra: {
      cctv: { pos: V(24, 10, -26), target: V(0, PL, -8) },
      crane: { radius: 9, low: 1.6, high: 9 },
      // out in the crowd, turned round to watch the Man
      camcorder: { pos: V(10, PL + 1.7, -16), target: V(MAN.x, MAN.y + 14, MAN.z) },
      rig: { pos: V(5, 7.6, -1.5), target: V(0, 0.9, 0.3) },
    },
  };
  private crowd: Crowd;
  private farCrowd: FarCrowd;
  private man: TheMan;
  private burnFire: BurnFire;
  private heads: MovingHeads;
  private fireworks: Fireworks;
  private octopus: MechOctopus;
  private mountains: THREE.MeshBasicMaterial;
  private playaMat: THREE.MeshStandardMaterial;
  private stars: THREE.MeshBasicMaterial;
  private trigger = new PeakTrigger(0.84, 10);
  /** seconds into the burn (−1: not yet) */
  private burnT = -1;
  private launched = false;
  private fell = false;
  private sunUp = false;
  private lastProgress = 0;
  private amb = new THREE.Color();

  constructor() {
    super({ fog: 0x141022, fogDensity: 0.0011, hemiSky: 0x1a1e3a, hemiGround: 0x0a0a0e, hemi: 0.16, flashAt: V(0, 6, -10), flashRange: 40, sunYaw: -0.61, skyRadius: 900 }, PLAYA_SKY, {
      // dust in the desert air, a clear sky (thin streaks at dawn), and a fine crescent low in the east before sunrise, so the Milky Way stays
      air: { turbidity: 3 },
      clouds: { cover: 0, cirrus: 0.12, wind: [0.4, 0] },
      moon: { yaw: -0.26, el0: 8, el1: 20 },
      albedo: '#c8c0b0',
      groundTint: '#a89c8c',
    });
    this.keyLight = { color: 0xffe8d0, intensity: 10 };
    this.grade = { tint: 0xfff2e8, contrast: 1.08, saturation: 1.12, lift: 0.002 };
    this.toneMapping = 'agx';
    this.hazeFromSky = 0.66;
    // the city's glow on the horizon
    this.glow.setRGB(0.55, 0.32, 0.4).multiplyScalar(0.08);
    const night = () => this.look.night;

    // the playa: a dry lake bed flat to the hills
    const ground = playaTexture();
    ground.repeat.set(700, 700);
    this.playaMat = new THREE.MeshStandardMaterial({ map: ground, color: 0xc8c0b0, roughness: 1 });
    const playa = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200).rotateX(-Math.PI / 2), this.playaMat);
    playa.position.set(0, PL, 0);
    playa.receiveShadow = true;
    this.group.add(playa);
    const hills = playaMountains(880, PL);
    this.mountains = hills.mat;
    this.group.add(hills.mesh);
    const mw = milkyWay(860);
    this.stars = mw.material as THREE.MeshBasicMaterial;
    this.group.add(mw);

    // the art car: a hull on six wheels, a top deck, the canopy of ribs
    const nm = nameStyleFor('burningman');
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x1e2a2c, roughness: 0.55, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.4, metalness: 0.8 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(18, -PL - 1.1, 7), hullMat);
    hull.position.set(0, PL + 1.0 + (-PL - 1.1) / 2, 0.9);
    this.group.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.2, 7.4), steel);
    deck.position.set(0, -0.1, 0.9);
    this.group.add(deck);
    // the ribs, and a spine along the top
    const ribs: THREE.CatmullRomCurve3[] = [];
    const ribMeshes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const x = -7.8 + i * 2.6;
      const top = 6.4 - Math.abs(i - 3) * 0.35;
      const c = new THREE.CatmullRomCurve3([V(x, 0, -2.5), V(x, top * 0.62, -2.1), V(x, top, 0.9), V(x, top * 0.62, 3.9), V(x, 0, 4.3)]);
      // the pixel strip rides on the outside of each rib, where the crowd sees it
      const mid = V(x, 2.2, 0.9);
      ribs.push(new THREE.CatmullRomCurve3(c.getPoints(24).map((p) => p.clone().addScaledVector(p.clone().sub(mid).setX(0).normalize(), 0.15))));
      ribMeshes.push(new THREE.TubeGeometry(c, 40, 0.11, 6, false));
    }
    ribMeshes.push(new THREE.CylinderGeometry(0.14, 0.14, 15.8, 8).rotateZ(Math.PI / 2).translate(0, 6.42, 0.9));
    this.group.add(new THREE.Mesh(mergeAll(ribMeshes), steel));
    this.add(new RibLights(ribs));
    // the LED band down the front of the hull, the screens behind the DJ: the visual player
    const band = this.screen(new THREE.Mesh(new THREE.PlaneGeometry(15, 1.5)), { size: [15, 1.5], pitch: 0.008 });
    band.position.set(0, PL + 2.05, -2.62);
    band.rotation.y = Math.PI;
    for (const s of [-1, 1]) {
      const panel = this.screen(new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4)), { size: [3.4, 2.4], pitch: 0.006 });
      panel.position.set(s * 4.4, 2.1, 3.95);
      panel.rotation.y = Math.PI;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.6, 0.12), steel);
      frame.position.set(s * 4.4, 2.1, 4.03);
      this.group.add(frame);
    }
    if (nm.sign) this.nameSign(nm.sign, 6.4, 1.1, V(0, 5.0, -1.75), Math.PI, 1.6);
    // the DJ's booth on the top deck, monitors, the speaker stacks out on the front corners
    const b = booth({ w: 2.8, d: 0.9, strip: '#ff8a3a', name: nm.booth, front: new THREE.MeshStandardMaterial({ color: 0x2a1e18, roughness: 0.6 }) });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 2.8, TABLE_Y, -0.45, 1986);
    for (const s of [-1, 1]) {
      const mon = speaker(0.5, 0.4, 0.6, 'monitor');
      mon.position.set(s * 2.1, 0.22, -0.9);
      mon.rotation.set(-0.4, Math.PI, 0, 'YXZ');
      this.group.add(mon);
      for (let k = 0; k < 3; k++) {
        const mid = speaker(1.2, 0.9, 0.8, 'mid', 0x15161a);
        mid.position.set(s * 8.2, PL + 1.45 + k * 0.92, -3.15);
        mid.rotation.y = Math.PI + s * 0.12;
        this.group.add(mid);
      }
      const sub = speaker(1.3, 1.0, 1.0, 'sub', 0x15161a);
      sub.position.set(s * 6.6, PL + 1.5, -3.15);
      sub.rotation.y = Math.PI;
      this.group.add(sub);
    }

    // the rig on the canopy: heads under the ribs, lasers off the spine, strobes, a wash or two
    this.heads = this.add(new MovingHeads([-7.8, -5.2, -2.6, 2.6, 5.2, 7.8].map((x) => ({ pos: V(x, 5.6 - Math.abs(x) * 0.05, -1.4) })), { length: 40, radius: 1.6, gain: 0.95, floorY: PL, haze: [PL + 1, 14] }));
    this.add(new Strobes([-6.5, -2, 2, 6.5].map((x) => ({ pos: V(x, 5.8, -1.6), tilt: 0.6 })), [1, 0.12, 0.12]));
    this.add(
      new Lasers(
        [
          { pos: V(-2.6, 6.6, 0.4), dir: V(0.05, 0.12, -1), side: -1, beams: 22, length: 150 },
          { pos: V(2.6, 6.6, 0.4), dir: V(-0.05, 0.12, -1), side: 1, beams: 22, length: 150, alt: true },
          { pos: V(-7.8, 5.6, -1.6), dir: V(0.1, 0.02, -1), side: -1, beams: 18, length: 150 },
          { pos: V(7.8, 5.6, -1.6), dir: V(-0.1, 0.02, -1), side: 1, beams: 18, length: 150, alt: true },
        ],
        {
          room: { floorY: PL, x0: -400, x1: 400, z0: -400, z1: 60 },
          // everyone's on the open playa round the car: the beams stay over heads everywhere they can reach
          audience: { floorY: PL, x0: -200, x1: 200, z0: -220, z1: 60 },
          focus: V(0, PL + 14, -60),
          haze: [PL + 1, 14],
        },
      ),
    );
    this.add(new Fireballs([V(-8.6, 6.7, -2.2), V(8.6, 6.7, -2.2), V(-8.6, 6.7, 4.0), V(8.6, 6.7, 4.0)], { size: 1.7 }));
    for (const s of [-1, 1]) {
      for (const z of [-2.2, 4.0]) {
        const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.6, 10), steel);
        nz.position.set(s * 8.6, 6.5, z);
        this.group.add(nz);
      }
    }
    this.wash(V(0, 7, -10), 0, 6, 32);
    this.wash(V(-12, 5, -18), 1, 3, 22);
    this.wash(V(12, 5, -18), 2, 4, 26);
    // dust in the air round the car, kept under the canopy's height: seen from above, never as a lid
    this.add(new HazeLayer(new THREE.Box3(V(-30, PL + 0.8, -55), V(30, 6.2, 8)), 5, 0.22));

    // the octopus parked alongside, facing the crowd; its static parts go into the venue's set
    const dressing = new Dresser(1987);
    this.octopus = this.add(new MechOctopus(V(-27, PL, 2), 2.0, dressing));
    for (const o of this.octopus.extras()) this.group.add(o);
    this.group.add(this.octopus.fire.object);

    // the Man, the fire that will take him, the fireworks off his base
    // about 85 ft in all: a 51 ft figure on a 33 ft pavilion
    this.man = new TheMan(MAN, { man: 15.5, base: 10, baseWidth: 28 });
    this.group.add(this.man.object);
    this.burnFire = this.add(new BurnFire(this.man));
    this.fireworks = this.add(new Fireworks(MAN.clone().setY(PL + this.man.baseHeight)));
    // uplights on the Man, so the timber reads at night
    const up = new THREE.SpotLight(0xffd0a0, 700, 120, 0.5, 0.6, 1.2);
    up.position.set(MAN.x, PL + 2, MAN.z - 40);
    up.target.position.set(MAN.x, PL + 18, MAN.z);
    this.group.add(up, up.target);

    // the city, the bikes, the art cars on the move
    this.add(new CityLights(MAN, { count: 7000, maxDist: 1500, seed: 1988, night, d: dressing }));
    const crowdZone = (x: number, z: number) => Math.abs(x) < 70 && z > -90 && z < 30;
    this.add(new BikeLights(MAN, { count: 160, seed: 1989, avoid: crowdZone }, night));
    this.add(new RoamingArtCars(MAN, night));

    // burners: fur, goggles, sequins, dust
    const clothes = ['#f2efe8', '#e8c8d8', '#c8a070', '#2a2420', '#d8b060', '#a8b8c8', '#ff5a2a', '#3ad7ff', '#8a6a4a', '#c86a8a', '#e8e2d4', '#1b1d22'];
    this.crowd = new Crowd(crowdArea(-13, 13, -4.2, -17, 1.5, 1990, { y: PL }), { seed: 1991, phones: 0.05, drinks: 0.12, signs: 3, clothes, riders: 3, booth: V(0, 0, 0.2), shorts: 0.45, look: 'playa' });
    this.group.add(this.crowd.object);
    const crew = vipCrew(crewArc(0, 1.8, 3.2, 0.6, 2.8), 1992, clothes);
    if (crew) this.add(crew);
    const avoid = [new THREE.Box2(new THREE.Vector2(-34, -6), new THREE.Vector2(-20, 10)), new THREE.Box2(new THREE.Vector2(-10, -4), new THREE.Vector2(10, 6))];
    const density = (x: number, z: number) => {
      if (z > -17 && z < 6 && Math.abs(x) < 13) return 0;
      const d = Math.hypot(x, z + 10);
      if (d > 75) return 0;
      return 1.3 * Math.exp(-d / 28);
    };
    this.farCrowd = new FarCrowd(scatter(-75, 75, -85, 30, density, 1993, avoid).map((p) => ({ ...p, y: PL })), { seed: 1994, clothes, phones: 0.04, focus: V(0, 3, 0) });
    this.group.add(this.farCrowd.object);
    this.dress(dressing);
  }

  /**
   * The playa round the car: the lantern spires walking down the promenades,
   * the Temple at 12:00, Center Camp at 6:00, bikes in heaps, a few pieces
   * of art out on the open playa, the deck's rails and stairs, dust on everything.
   */
  private dress(d: Dresser): void {
    // the deck: rails round the top, stairs down the side, cases behind the DJ
    d.rail([V(-9.1, 0, -2.6), V(-1.6, 0, -2.6)], 1.05, 1.5);
    d.rail([V(1.6, 0, -2.6), V(9.1, 0, -2.6)], 1.05, 1.5);
    d.rail([V(-9.1, 0, 4.3), V(9.1, 0, 4.3)], 1.05, 1.5);
    d.rail([V(9.1, 0, -2.6), V(9.1, 0, 4.3)], 1.05, 1.5);
    d.steps(V(-9.3, PL, 3.2), -Math.PI / 2, 13, 1.1, -PL / 13, 0.3, 'steel');
    d.roadCase(V(-2.6, 0, 2.6), 0.1, 1.0, 0.7, 0.6);
    d.roadCase(V(2.6, 0, 2.8), -0.1, 1.0, 0.7, 0.6);
    for (const x of [-6, 0, 6]) for (const z of [-2.3, 4.1]) d.put('rubber', new THREE.CylinderGeometry(0.9, 0.9, 0.7, 16).rotateX(Math.PI / 2).translate(x, PL + 0.9, z));
    d.box('blackMetal', 3, 2.4, 3.4, 10.4, PL + 1.9, 0.9);
    d.put(d.glow('#9fd8ff', 'steady', 0.8), new THREE.PlaneGeometry(2.6, 1.0).rotateY(Math.PI / 2).translate(11.92, PL + 2.4, 0.9));
    // the promenades: lantern spires every 150 ft out from the Man along 6:00 and along 3:00/9:00
    const clear = (p: THREE.Vector3) => Math.abs(p.x) < 40 && p.z > -60 && p.z < 30;
    lanternSpires(d, MAN, clockPos(MAN, 6, BRC.esplanade - 10), clear);
    lanternSpires(d, MAN, clockPos(MAN, 3, BRC.esplanade - 10), clear);
    lanternSpires(d, MAN, clockPos(MAN, 9, BRC.esplanade - 10), clear);
    lanternSpires(d, MAN, clockPos(MAN, 12, BRC.temple - 40), clear);
    // the Temple at 12:00, Center Camp at 6:00
    temple(d, clockPos(MAN, 12, BRC.temple), 1);
    centerCamp(d, clockPos(MAN, 6, BRC.centerCamp));
    // bikes dropped in heaps at the edge of the crowd
    const r = rng(1995);
    for (const [cx, cz, n] of [[-17, -12, 14], [16, -15, 12], [-8, -24, 10], [22, -4, 8], [-38, -10, 9]] as [number, number, number][]) {
      for (let i = 0; i < n; i++) bike(d, V(cx + (r() - 0.5) * 5, PL, cz + (r() - 0.5) * 4), r() * Math.PI * 2, r() < 0.7, r);
    }
    // art out on the open playa: a ring of light, a forest of glowing poles, a steel tree
    const ringGlow = d.glow('#ffffff', 'palette', 1.5, 1);
    const ring = V(-60, PL, 70);
    d.put('steel', new THREE.TorusGeometry(9, 0.35, 8, 48).translate(ring.x, ring.y + 9.6, ring.z));
    d.put(ringGlow, new THREE.TorusGeometry(9, 0.12, 6, 64).translate(ring.x, ring.y + 9.6, ring.z - 0.36));
    for (const s of [-1, 1]) d.rod('steel', V(ring.x + s * 6, ring.y, ring.z), V(ring.x + s * 3.5, ring.y + 3.2, ring.z), 0.25, 6);
    const pole = d.glow('#7ad8ff', 'breathe', 2);
    for (let i = 0; i < 40; i++) {
      const p = V(70 + (r() - 0.5) * 30, PL, 40 + (r() - 0.5) * 30);
      const h = 3 + r() * 5;
      d.rod('blackMetal', p, p.clone().setY(PL + h), 0.06, 4);
      d.put(pole, new THREE.SphereGeometry(0.22, 6, 4).translate(p.x, PL + h + 0.2, p.z));
    }
    const tree = V(-110, PL, -30);
    d.rod('rust', tree, tree.clone().setY(PL + 7), 0.7, 8);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const tip = V(tree.x + Math.cos(a) * 6, PL + 10 + r() * 3, tree.z + Math.sin(a) * 6);
      d.rod('rust', V(tree.x, PL + 6.5, tree.z), tip, 0.22, 5);
      d.put(d.glow('#ff9a3a', 'breathe', 2.2), new THREE.SphereGeometry(0.4, 8, 6).translate(tip.x, tip.y, tip.z));
    }
    this.add(d.done());
  }

  /** a set-piece for testing or the desk: start the burn now */
  signature(what: string): void {
    if (what === 'burn' || what === 'signature') this.burn();
  }

  burn(): void {
    if (this.burnT >= 0) return;
    this.burnT = 0;
    this.launched = false;
    this.fell = false;
    moments.emit({ venue: 'burningman', label: 'The Man burns', crowd: 'cheer' });
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    const l = this.look;
    const k = setClock.progress;
    const day = 1 - l.night;
    // a set started again from the top: the Man stands again
    if (k < this.lastProgress - 0.2) {
      this.burnT = -1;
      this.sunUp = false;
      this.man.setArms(0);
      this.man.setFall(0);
    }
    this.lastProgress = k;
    // the moment: a long peak in the dark, he burns
    if (this.trigger.update(dt, s.hype, s.playing) && l.night > 0.55) this.burn();
    let hype = s.hype;
    let peak = s.peak;
    if (this.burnT >= 0) {
      this.burnT += dt;
      const b = burnState(this.burnT);
      this.man.setArms(b.arms);
      this.man.setFall(b.fall);
      this.man.setNeon(1 - THREE.MathUtils.smoothstep(b.body, 0.1, 0.4), s.kick);
      if (b.fireworks && !this.launched) {
        this.launched = true;
        this.fireworks.launch(18, s.reduceFlash ? 1.8 : 3);
      }
      if (b.fall > 0.02 && !this.fell) {
        this.fell = true;
        moments.emit({ venue: 'burningman', label: 'The Man falls', crowd: 'cheer' });
      }
      this.burnFire.base = b.base;
      this.burnFire.body = b.body;
      this.burnFire.glow = b.glow;
      // the car's heads come down while he's in flames, so the fire lights the playa, then back up
      this.heads.dim = 1 - 0.7 * THREE.MathUtils.smoothstep(this.burnT, 14, 22) * (1 - THREE.MathUtils.smoothstep(this.burnT, 78, 92));
      // the whole perimeter goes up while he burns
      if (this.burnT < 90) {
        hype = Math.max(hype, 0.9);
        peak = Math.max(peak, 0.6 * (1 - this.burnT / 90));
      }
    } else {
      this.man.setNeon(1, s.kick);
      this.heads.dim = 1;
    }
    // the sun comes up over the hills: the night's done
    if (!this.sunUp && l.sun > 0.5 && k > 0.9) {
      this.sunUp = true;
      moments.emit({ venue: 'burningman', label: 'Sunrise on the playa', crowd: 'cheer' });
    }
    // the playa: the scene's fill light falls evenly on the pale alkali, so in the dark it's held down to
    // what starlight and the city's glow give it (near-black, faintly blue); the art car, the fire and
    // the poofers still light it where they reach
    const pd = THREE.MathUtils.smoothstep(day, 0.15, 0.9);
    this.playaMat.color.setRGB(0.08, 0.085, 0.11).lerp(new THREE.Color(0xc8c0b0), pd);
    // the hills: black against the stars, magenta at dawn, dusty in the morning
    const dawn = THREE.MathUtils.smoothstep(day, 0.3, 0.75) * (1 - THREE.MathUtils.smoothstep(day, 0.85, 1));
    this.mountains.color.setRGB(0.05, 0.055, 0.09).lerp(new THREE.Color(0.48, 0.42, 0.4), THREE.MathUtils.smoothstep(day, 0.6, 1)).lerp(new THREE.Color(0.55, 0.22, 0.38), dawn * 0.7);
    this.stars.opacity = l.stars * 0.55;
    this.amb.copy(l.ambSky).multiplyScalar(l.amb * 0.5);
    this.farCrowd.ambient(this.amb);
    const st = { ...s, hype, peak };
    this.crowd.update(st, dt, camera);
    this.farCrowd.update(st, dt);
  }
}

/** a bike on its side or stood up, EL wire on some */
function bike(d: Dresser, p: THREE.Vector3, yaw: number, lying: boolean, r: () => number): void {
  const m = new THREE.Matrix4().makeRotationY(yaw);
  if (lying) m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.1));
  m.setPosition(p.x, p.y + (lying ? 0.12 : 0), p.z);
  const k = (['red', 'blue', 'white', 'yellow', 'green', 'rust'] as const)[Math.floor(r() * 6)];
  for (const z of [-0.52, 0.52]) d.put('rubber', new THREE.TorusGeometry(0.33, 0.035, 5, 16).rotateY(Math.PI / 2).translate(0, 0.35, z).applyMatrix4(m));
  const frame = (a: THREE.Vector3, b: THREE.Vector3) => {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(0.022, 0.022, len, 4);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    d.put(k, g.translate(mid.x, mid.y, mid.z).applyMatrix4(m));
  };
  frame(V(0, 0.35, -0.52), V(0, 0.75, -0.1));
  frame(V(0, 0.35, -0.52), V(0, 0.4, 0.05));
  frame(V(0, 0.4, 0.05), V(0, 0.75, -0.1));
  frame(V(0, 0.75, -0.1), V(0, 0.8, 0.45));
  frame(V(0, 0.4, 0.05), V(0, 0.8, 0.45));
  frame(V(0, 0.35, 0.52), V(0, 0.95, 0.45));
  d.put('black', new THREE.BoxGeometry(0.5, 0.03, 0.05).translate(0, 0.97, 0.45).applyMatrix4(m));
  if (r() < 0.4) d.put(d.glow(['#ff2e88', '#3ad7ff', '#b6ff3b'][Math.floor(r() * 3)], 'breathe', 1.6), new THREE.TorusGeometry(0.34, 0.012, 4, 20).rotateY(Math.PI / 2).translate(0, 0.35, 0.52).applyMatrix4(m));
}

export const burningMan: VenueDef = {
  id: 'burningman',
  name: 'Burning Man',
  short: 'Burning Man',
  place: 'Black Rock City, Nevada',
  kind: 'Sound art car · burn night',
  blurb: 'The top deck of an art car on the burn perimeter. The Man in neon behind you, the city’s lights to the horizon, dark to sunrise.',
  palette: ['#ff7a1a', '#3ad7ff', '#ff2e88'],
  ui: '#ff8a3a',
  capacity: '70,000 in the city',
  note: 'Fan-made, not affiliated with Burning Man Project. Hold a peak in the dark and the Man burns. Switch the camera to “From the next art car” to see him.',
  build: () => new BurningMan(),
  thumb(g, w, h) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#03040c');
    sky.addColorStop(0.62, '#1a1430');
    sky.addColorStop(0.7, '#3a2440');
    sky.addColorStop(1, '#0a0806');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const r = rng(3);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`;
      g.fillRect(r() * w, r() * h * 0.55, 1, 1);
    }
    // the hills, the city's lights along the horizon
    g.fillStyle = '#0a0b12';
    g.beginPath();
    g.moveTo(0, h * 0.7);
    for (let x = 0; x <= w; x += 6) g.lineTo(x, h * 0.66 - Math.max(0, Math.sin(x * 0.02) * 6 + Math.sin(x * 0.07) * 2));
    g.lineTo(w, h * 0.72);
    g.lineTo(0, h * 0.72);
    g.fill();
    for (let i = 0; i < 160; i++) {
      g.fillStyle = ['#ffd9a0', '#ff2e88', '#3ad7ff', '#b6ff3b'][Math.floor(r() * 4)];
      g.fillRect(r() * w, h * (0.69 + r() * 0.03), 1.5, 1.5);
    }
    // the Man in neon on his base, fire at his feet
    const cx = w * 0.5;
    const by = h * 0.68;
    const fire = g.createRadialGradient(cx, by, 2, cx, by, h * 0.3);
    fire.addColorStop(0, 'rgba(255,170,80,0.9)');
    fire.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = fire;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a1c12';
    g.fillRect(cx - w * 0.07, by - h * 0.08, w * 0.14, h * 0.08);
    g.strokeStyle = '#5ae0ff';
    g.lineWidth = 2;
    g.beginPath();
    const s = h * 0.36;
    g.moveTo(cx - s * 0.14, by - h * 0.08);
    g.lineTo(cx - s * 0.06, by - h * 0.08 - s * 0.45);
    g.lineTo(cx - s * 0.16, by - h * 0.08 - s * 0.78);
    g.lineTo(cx + s * 0.16, by - h * 0.08 - s * 0.78);
    g.lineTo(cx + s * 0.06, by - h * 0.08 - s * 0.45);
    g.lineTo(cx + s * 0.14, by - h * 0.08);
    g.moveTo(cx - s * 0.16, by - h * 0.08 - s * 0.78);
    g.lineTo(cx - s * 0.36, by - h * 0.08 - s * 1.0);
    g.moveTo(cx + s * 0.16, by - h * 0.08 - s * 0.78);
    g.lineTo(cx + s * 0.36, by - h * 0.08 - s * 1.0);
    g.stroke();
    g.beginPath();
    g.ellipse(cx, by - h * 0.08 - s * 0.9, s * 0.07, s * 0.1, 0, 0, Math.PI * 2);
    g.stroke();
  },
};
