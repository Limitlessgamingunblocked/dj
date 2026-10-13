/*
 * The Main-Stage Festival (Section 5.2): capacity 40,000. A massive stage
 * structure with an LED wall the size of a building behind the booth, IMAG
 * screens on the wings, the PA hung from the roof, delay towers out in the
 * field, and a crowd that stretches to the horizon: flags, people on
 * shoulders, a sea of phone lights. Everything goes off: lasers, pyro, CO2,
 * confetti, giant LED visuals. Huge open air with the delay towers' slap
 * (audio/room.ts).
 *
 * Signature moment: a drone show assembles your name in the night sky above
 * the crowd, after the room has been at the top for a while.
 *
 * TODO: procedural stand-in for the Blender festival set (Section 14).
 */
import * as THREE from 'three';
import type { FloorReflect } from '../reflect';
import { nameService } from '../../name/NameService';
import { nameStyleFor } from '../../name/venueStyles';
import type { Features } from '../../visualizer/AudioFeatures';
import type { VenueDef, VenueViews } from './base';
import { Confetti } from './confetti';
import { boothClutter } from './details';
import { Dresser } from './dress';
import { FarCrowd, scatter } from './farcrowd';
import { Aircraft, FerrisWheel } from './landmarks';
import { crewArc, lightingTech, security, vipCrew } from './crew';
import { Blinders, booth, Co2Jets, Crowd, crowdArea, HazeLayer, lineArray, MovingHeads, speaker, Strobes, TABLE_Y, truss } from './fixtures';
import { Lasers, laserStands } from './lasers';
import { moments, PeakTrigger } from './moments';
import { OpenAir } from './openair';
import type { SkyKey } from './outdoor';
import { Pyro } from './pyro';
import type { ShowState } from './show';
import { HoloScrim, Wristbands } from './showfx';
import { canvasTexture, rng } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** the field is this far below the stage deck */
const FL = -2.4;
const FIELD_BACK = -230;
const ROOF_Y = 24;
/** half the field's width at z: it widens towards the back */
const fieldHalf = (z: number) => 26 + (z / FIELD_BACK) * 70;

export const FESTIVAL_SKY: SkyKey[] = [
  { k: 0, zenith: '#16205a', horizon: '#c8603a', ground: '#140e14', sun: -2, sunColor: '#ff6a3a', light: 0.3, ambSky: '#5a4a7a', ambGround: '#1a1218', amb: 0.4, stars: 0.05, night: 0.5 },
  { k: 0.35, zenith: '#0a1038', horizon: '#4a2a50', ground: '#0a0a10', sun: -8, sunColor: '#ff5a3a', light: 0, ambSky: '#2a2a5a', ambGround: '#0c0a10', amb: 0.26, stars: 0.5, night: 0.9 },
  { k: 1, zenith: '#03040c', horizon: '#1a1630', ground: '#050508', sun: -18, sunColor: '#ff5a3a', light: 0, ambSky: '#141a3a', ambGround: '#06060a', amb: 0.2, stars: 0.9, night: 1 },
];

/**
 * Where the drones go to spell a word: every `step`-th lit pixel of a
 * rendered word (alpha over half), at most `max` of them spread evenly, as
 * x, y in −0.5..0.5 (y up), aspect kept.
 */
export function dronePoints(alpha: ArrayLike<number>, w: number, h: number, max: number, step = 3): [number, number][] {
  const all: [number, number][] = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (alpha[(y * w + x) * 4 + 3] > 128) all.push([x / w - 0.5, (0.5 - y / h) * (h / w)]);
  if (all.length <= max) return all;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(all[Math.floor((i * all.length) / max)]);
  return out;
}

/** the drone show: they rise from behind the field, spell your name over the crowd, then scatter */
class DroneShow {
  readonly object: THREE.Points;
  private n: number;
  private from: Float32Array;
  private to: Float32Array;
  private pos: Float32Array;
  private col: Float32Array;
  private seed: Float32Array;
  t = -1;
  private center = V(0, 62, -100);
  private width = 84;

  constructor(n = 700) {
    this.n = n;
    this.from = new Float32Array(n * 3);
    this.to = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.seed = new Float32Array(n);
    const r = rng(77);
    for (let i = 0; i < n; i++) {
      // parked in rows on the ground behind the field
      this.from.set([(i % 35) * 2.2 - 38, FL + 0.5, FIELD_BACK - 20 - Math.floor(i / 35) * 2.2], i * 3);
      this.seed[i] = r();
    }
    this.pos.set(this.from);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.object = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  /** spell this word next */
  start(word: string): void {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d');
    let pts: [number, number][] = [];
    if (g) {
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = 110;
      g.font = `800 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      while (g.measureText(word).width > 490 && size > 30) g.font = `800 ${(size -= 6)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      g.fillText(word, 256, 66);
      pts = dronePoints(g.getImageData(0, 0, 512, 128).data, 512, 128, this.n, 3);
    }
    for (let i = 0; i < this.n; i++) {
      const p = pts.length ? pts[i % pts.length] : [((i % 40) / 40 - 0.5), Math.floor(i / 40) / 40 - 0.25];
      // spares (more drones than pixels) make a halo round the word
      const spare = i >= pts.length && pts.length > 0;
      const a = this.seed[i] * Math.PI * 2;
      const x = spare ? Math.cos(a) * 0.62 : p[0];
      const y = spare ? Math.sin(a) * 0.2 : p[1];
      this.to.set([this.center.x + x * this.width, this.center.y + y * this.width, this.center.z + (this.seed[i] - 0.5) * 2], i * 3);
    }
    this.t = 0;
    this.object.visible = true;
  }

  update(dt: number, s: ShowState): void {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      const sd = this.seed[i];
      // rise (0–5 s), fly to the word (5–13 s), hold (13–30 s), scatter and fade (30–36 s)
      const fly = THREE.MathUtils.smoothstep(t, 4 + sd * 2, 12 + sd * 1.5);
      const rise = THREE.MathUtils.smoothstep(t, sd * 2, 5 + sd);
      const out = THREE.MathUtils.smoothstep(t, 30 + sd * 2, 36);
      for (let k = 0; k < 3; k++) {
        const f = this.from[i * 3 + k];
        const lifted = k === 1 ? f + rise * 30 : f;
        const target = this.to[i * 3 + k];
        let v = lifted + (target - lifted) * fly;
        if (out > 0) v += (k === 1 ? 25 : (sd - 0.5) * 60) * out;
        this.pos[i * 3 + k] = v;
      }
      // white while flying, the show's colours once the word holds, a shimmer on the beat
      const hold = THREE.MathUtils.smoothstep(t, 12, 14);
      c.setRGB(1, 1, 1).lerp(s.colors[Math.floor(sd * 3) % 3], hold * 0.7);
      const tw = 0.75 + 0.25 * Math.sin(t * 3 + sd * 20) + s.kick * 0.25 * hold;
      const fade = 1 - out;
      this.col.set([c.r * tw * fade * 2.2, c.g * tw * fade * 2.2, c.b * tw * fade * 2.2], i * 3);
    }
    const g = this.object.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    if (t > 37) {
      this.t = -1;
      this.object.visible = false;
    }
  }
}

/** flags over the crowd, waving */
class Flags {
  readonly object = new THREE.Group();
  private cloths: { geo: THREE.PlaneGeometry; base: Float32Array; phase: number }[] = [];

  constructor(spots: THREE.Vector3[], seed: number) {
    const r = rng(seed);
    const pole = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.6, roughness: 0.4 });
    const designs = ['#ff2e88|#ffffff', '#3ad7ff|#0a1a3a', '#ffd23f|#ff5a2a', '#b6ff3b|#111111', '#ffffff|#7a3cff', '#ff5a2a|#ffd23f|#7a3cff'];
    for (const p of spots) {
      const h = 5 + r() * 2.5;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, h, 5), pole);
      m.position.set(p.x, p.y + h / 2, p.z);
      this.object.add(m);
      const geo = new THREE.PlaneGeometry(1.5, 1, 10, 4).translate(0.75, 0, 0);
      const d = designs[Math.floor(r() * designs.length)].split('|');
      const tex = canvasTexture(`flag:${d.join()}`, 64, 40, (g, w, hh) => {
        d.forEach((c, i) => {
          g.fillStyle = c;
          g.fillRect(0, (i * hh) / d.length, w, hh / d.length + 1);
        });
      });
      const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
      cloth.position.set(p.x, p.y + h - 0.5, p.z);
      cloth.rotation.y = r() * Math.PI * 2;
      this.object.add(cloth);
      this.cloths.push({ geo, base: Float32Array.from(geo.attributes.position.array as Float32Array), phase: r() * 10 });
    }
  }

  update(t: number, hype: number): void {
    for (const c of this.cloths) {
      const p = c.geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = c.base[i * 3];
        // waved harder as the crowd gets into it
        p.setZ(i, Math.sin(x * 3 - t * (3 + hype * 4) + c.phase) * x * (0.12 + hype * 0.12));
      }
      p.needsUpdate = true;
    }
  }
}

class Festival extends OpenAir {
  // the stage deck's black gloss mirrors the LED wall (the field is grass: no reflection)
  readonly reflect: FloorReflect = { y: 0, strength: 0.45, rough: 0.4 };
  readonly views: VenueViews = {
    // out in the crowd, the whole stage and the screens
    wide: { pos: V(9, FL + 7, -46), target: V(0, 7, 4) },
    wideLabel: 'Out in the field',
    crowd: { pos: V(-2.5, FL + 2.1, -9), target: V(0, 2.5, 2) },
    drone: [V(0, 6, 4), V(14, 5, -2), V(24, 9, -20), V(20, 14, -60), V(0, 22, -90), V(-20, 14, -60), V(-24, 9, -20), V(-14, 5, -2), V(0, 12, -18)],
    extra: { cctv: { pos: V(-21, 15, -2), target: V(0, FL, -24) }, rig: { pos: V(6, 15.5, -1), target: V(0, 0.9, 0.4) }, crane: { radius: 8, low: 1.4, high: 9 }, camcorder: { pos: V(3, FL + 1.8, -8), target: V(0, 3, 2) } },
  };
  private crowd: Crowd;
  private farCrowd: FarCrowd;
  private bands: Wristbands;
  private scrim: HoloScrim;
  private flags: Flags;
  private drones = new DroneShow();
  private trigger = new PeakTrigger(0.87, 12);
  private carpet: THREE.MeshBasicMaterial;

  constructor() {
    super({ fog: 0x1a1630, fogDensity: 0.0042, hemiSky: 0x2a2a5a, hemiGround: 0x0c0a10, hemi: 0.26, flashAt: V(0, 12, -14), flashRange: 60, sunYaw: Math.PI + 0.3, skyRadius: 900, skyShow: { at: V(0, 75, 130), scale: 1.7, fireworks: true } }, FESTIVAL_SKY, {
      // summer haze over the fields; a few heaps of cloud and high streaks catching the last light; the full moon rising behind the stage
      air: { turbidity: 2.2 },
      clouds: { cover: 0.35, cirrus: 0.35, wind: [0.3, 0.12] },
      moon: { yaw: 0.3, el0: 4, el1: 26 },
      albedo: '#5a6a38',
      groundTint: '#6a7058',
    });
    this.keyLight = { color: 0xf4f0ff, intensity: 14 };
    this.grade = { tint: 0xf6f4ff, contrast: 1.12, saturation: 1.14, lift: 0 };
    this.toneMapping = 'agx';
    this.glow.setRGB(0.5, 0.3, 0.6).multiplyScalar(0.1);
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.8 });

    // the field, trodden grass
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x2a3020,
        roughness: 1,
        map: canvasTexture(
          'fest-grass',
          256,
          256,
          (g, w, h) => {
            g.fillStyle = '#3a4228';
            g.fillRect(0, 0, w, h);
            const r = rng(31);
            for (let i = 0; i < 3000; i++) {
              const v = 30 + r() * 50;
              g.fillStyle = `rgba(${v},${v * 1.1},${v * 0.6},0.6)`;
              g.fillRect(r() * w, r() * h, 1, 2);
            }
          },
          { repeat: true },
        ),
      }),
    );
    ((grass.material as THREE.MeshStandardMaterial).map as THREE.Texture).repeat.set(120, 120);
    grass.position.set(0, FL, -200);
    this.group.add(grass);
    // past the last people: a carpet of crowd to the horizon, phone lights twinkling
    this.carpet = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      map: canvasTexture(
        'fest-carpet',
        512,
        512,
        (g, w, h) => {
          g.clearRect(0, 0, w, h);
          const r = rng(32);
          for (let i = 0; i < 9000; i++) {
            const v = 14 + r() * 30;
            g.fillStyle = `rgba(${v},${v},${v + 6},0.9)`;
            g.beginPath();
            g.arc(r() * w, r() * h, 1.6 + r() * 1.4, 0, Math.PI * 2);
            g.fill();
          }
          for (let i = 0; i < 260; i++) {
            g.fillStyle = r() < 0.7 ? '#e8f0ff' : '#ffd9a0';
            g.fillRect(r() * w, r() * h, 1.5, 1.5);
          }
        },
        { repeat: true },
      ),
    });
    (this.carpet.map as THREE.Texture).repeat.set(26, 8);
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(520, 260).rotateX(-Math.PI / 2), this.carpet);
    carpet.position.set(0, FL + 0.6, FIELD_BACK - 120);
    this.group.add(carpet);
    // a tree line on the far hills
    const hills = new THREE.Mesh(
      new THREE.CylinderGeometry(560, 560, 40, 64, 1, true),
      new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        transparent: true,
        fog: false,
        map: canvasTexture('fest-hills', 1024, 64, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          g.fillStyle = '#05060a';
          g.beginPath();
          g.moveTo(0, h);
          for (let x = 0; x <= w; x += 4) g.lineTo(x, h * 0.55 + Math.sin(x * 0.013) * 8 + Math.sin(x * 0.07) * 3 + Math.sin(x * 0.4) * 1.5);
          g.lineTo(w, h);
          g.fill();
        }),
      }),
    );
    hills.position.set(0, FL + 14, 0);
    this.group.add(hills);

    // the stage: deck, roof, wings
    const deck = new THREE.Mesh(new THREE.BoxGeometry(44, -FL, 16), black);
    deck.position.set(0, FL / 2, 6);
    this.group.add(deck);
    const roofY = ROOF_Y;
    for (const x of [-23, 23]) for (const z of [-1.5, 13.5]) this.group.add(truss(V(x, FL, z), V(x, roofY, z), 1.0));
    for (const z of [-1.5, 5.5, 13.5]) this.group.add(truss(V(-23, roofY, z), V(23, roofY, z), 1.0));
    for (const x of [-23, -11.5, 0, 11.5, 23]) this.group.add(truss(V(x, roofY, -1.5), V(x, roofY, 13.5), 0.8));
    const roof = new THREE.Mesh(new THREE.BoxGeometry(48, 0.3, 17), black);
    roof.position.set(0, roofY + 0.9, 6);
    this.group.add(roof);
    // the LED wall the size of a building, behind the booth
    const wallW = 38;
    const wallH = 17;
    const wall = this.screen(new THREE.Mesh(new THREE.PlaneGeometry(wallW, wallH)), { size: [wallW, wallH], pitch: 0.0052 });
    wall.position.set(0, 1.2 + wallH / 2, 11.5);
    wall.rotation.y = Math.PI;
    this.nameScreen(wall, wallW, wallH, nameStyleFor('festival').screen ?? 'pixel_led');
    // IMAG screens on the wings, and their towers
    for (const s of [-1, 1]) {
      const side = this.screen(new THREE.Mesh(new THREE.PlaneGeometry(10, 14)), { size: [10, 14], pitch: 0.006 });
      side.position.set(s * 30, FL + 12, 2);
      side.rotation.y = Math.PI + s * 0.32;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(11, 0.6, 2), black);
      tower.position.set(s * 30, FL + 4.6, 2.6);
      this.group.add(tower, truss(V(s * 26, FL, 3.5), V(s * 26, FL + 20, 3.5), 0.6), truss(V(s * 34, FL, 3.5), V(s * 34, FL + 20, 3.5), 0.6));
      // the PA: line arrays from the roof, subs under the stage lip
      const arr = lineArray(14, 1.2, 0.42, 0.8);
      arr.position.set(s * 19.5, roofY - 1.2, -1.2);
      arr.rotation.y = Math.PI + s * 0.12;
      this.group.add(arr);
      for (let k = 0; k < 4; k++) {
        const sub = speaker(1.3, 0.75, 1, 'sub');
        sub.position.set(s * (5 + k * 3.4), FL + 0.4, -1.6);
        sub.rotation.y = Math.PI;
        this.group.add(sub);
      }
    }
    // delay towers out in the field, and the mix tent
    for (const z of [-70, -140]) {
      for (const s of [-1, 1]) {
        const x = s * 16;
        this.group.add(truss(V(x, FL, z), V(x, FL + 14, z), 0.9));
        const arr = lineArray(8, 1.1, 0.4, 0.7);
        arr.position.set(x, FL + 13, z + 0.6);
        arr.rotation.y = Math.PI;
        this.group.add(arr);
      }
    }
    // (the mix tent, the barrier and the rest of the site: dress())

    // the booth, front and centre; your name on it in pixels
    const nm = nameStyleFor('festival');
    const riser = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 4), black);
    riser.position.set(0, -0.25 + 0.001, 1.2);
    this.group.add(riser);
    const b = booth({ w: 3.4, d: 1.0, strip: '#b6ff3b', name: nm.booth });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 3.4, TABLE_Y, -0.5, 601);
    for (const s of [-1, 1]) {
      const mon = speaker(0.5, 0.4, 0.6, 'monitor');
      mon.position.set(s * 2.4, 0.22, -0.9);
      mon.rotation.set(-0.4, Math.PI, 0, 'YXZ');
      this.group.add(mon);
    }

    // the rig: heads on every roof truss, beams standing upstage, strobes, blinders
    const heads = [
      ...[-1.5, 5.5].flatMap((z) => [-20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20].map((x) => ({ pos: V(x, roofY - 0.8, z) }))),
      ...[-18, -14, -10, -6, 6, 10, 14, 18].map((x) => ({ pos: V(x, 0.3, 10.6), up: true })),
    ];
    this.add(new MovingHeads(heads, { length: 40, radius: 2.0, gain: 1.25, floorY: FL, haze: [FL + 1, roofY + 6] }));
    this.add(new Strobes([...[-16, -8, 0, 8, 16].map((x) => ({ pos: V(x, roofY - 1, -1.5), tilt: 0.7 })), ...[-14, -7, 7, 14].map((x) => ({ pos: V(x, 0.1, -1.4), tilt: -Math.PI / 2 + 0.3 }))], [1, 0.12, 0.12]));
    this.add(new Blinders([-15, -10, -5, 5, 10, 15].map((x) => ({ pos: V(x, roofY - 1.6, -1.4), tilt: -0.6 }))));
    const low = [V(-21, FL + 3.6, -2.8), V(21, FL + 3.6, -2.8)];
    this.group.add(laserStands(low, FL));
    this.add(
      new Lasers(
        [
          { pos: V(-12, 0.3, -1.6), dir: V(0.1, 0.32, -1), side: -1, beams: 20, length: 220 },
          { pos: V(-4, 0.3, -1.6), dir: V(0.04, 0.34, -1), side: -1, beams: 20, length: 220, alt: true },
          { pos: V(4, 0.3, -1.6), dir: V(-0.04, 0.34, -1), side: 1, beams: 20, length: 220, alt: true },
          { pos: V(12, 0.3, -1.6), dir: V(-0.1, 0.32, -1), side: 1, beams: 20, length: 220 },
          { pos: low[0], dir: V(0.12, 0, -1), side: -1, beams: 26, length: 220 },
          { pos: low[1], dir: V(-0.12, 0, -1), side: 1, beams: 26, length: 220, alt: true },
          { pos: V(-20, roofY - 1.5, 5), dir: V(0.15, -0.05, -1), side: -1, beams: 18, length: 220 },
          { pos: V(20, roofY - 1.5, 5), dir: V(-0.15, -0.05, -1), side: 1, beams: 18, length: 220, alt: true },
          { pos: V(-16, FL + 13.5, -70), dir: V(0.05, 0.05, 1), side: -1, beams: 14, length: 90 },
          { pos: V(16, FL + 13.5, -70), dir: V(-0.05, 0.05, 1), side: 1, beams: 14, length: 90, alt: true },
        ],
        {
          room: { floorY: FL, x0: -120, x1: 120, z0: FIELD_BACK - 60, z1: 14, solids: [new THREE.Box3(V(-wallW / 2, 1, 11.3), V(wallW / 2, 1.2 + wallH, 11.7))] },
          audience: { floorY: FL, x0: -120, x1: 120, z0: FIELD_BACK - 60, z1: -4.4 },
          focus: V(0, FL + 18, -60),
          haze: [FL + 1, roofY + 6],
        },
      ),
    );
    this.add(new Co2Jets([-18, -12, -6, 6, 12, 18].map((x) => V(x, 0.02, -1.2)), 14));
    this.add(
      new Pyro(
        [
          ...[-21, -15, -9, 9, 15, 21].map((x) => ({ pos: V(x, 0, -1.2), kind: 'flame' as const })),
          ...[-6, -3, 3, 6].map((x) => ({ pos: V(x, 0, -1.4), kind: 'spark' as const })),
        ],
        { height: 6 },
      ),
    );
    this.add(new Confetti([-16, -8, 8, 16].map((x) => ({ pos: V(x, 0.05, -1.3), dir: V(Math.sign(x) * 0.1, 0.85, -0.55) })), { floorY: FL, speed: 22, count: 5000 }));
    this.wash(V(0, 14, -10), 0, 8, 40);
    this.wash(V(-14, 10, -24), 1, 6, 34);
    this.wash(V(14, 10, -24), 2, 6, 34);
    this.add(new HazeLayer(new THREE.Box3(V(-40, FL + 3, -110), V(40, roofY + 2, 12)), 8, 0.35));

    // the crowd: the front pit as people, then cut-outs to the back of the field
    const clothes = ['#111214', '#f2efe8', '#2a3a5a', '#ff2e88', '#3ad7ff', '#b6ff3b', '#5a1e2a', '#d8c8a8', '#1b1d22', '#ffd23f', '#7a3cff', '#e8e2d4'];
    this.crowd = new Crowd(crowdArea(-17, 17, -5.2, -12.5, 1.9, 602, { y: FL }), { seed: 603, phones: 0.16, drinks: 0.15, signs: 6, clothes, riders: 7, shorts: 0.35, look: 'festival' });
    // the stage party behind you, security in the pit, the lighting tech out at the mix tent
    const crew = vipCrew(crewArc(0, 2.8, 4.4, 0.6, 2.8), 608, clothes);
    if (crew) this.add(crew);
    this.add(security([-13, -7, 7, 13].map((x) => ({ x, z: -3.3, y: FL })), 609));
    this.add(lightingTech({ x: 1.2, z: -40.6, y: FL + 0.2, face: 0 }, 610));
    this.group.add(this.crowd.object);
    const avoid = [new THREE.Box2(new THREE.Vector2(-11.5, -47), new THREE.Vector2(7, -37)), ...[-70, -140].flatMap((z) => [-1, 1].map((s) => new THREE.Box2(new THREE.Vector2(s * 16 - 2.7, z - 2.7), new THREE.Vector2(s * 16 + 2.7, z + 2.7))))];
    const density = (x: number, z: number) => {
      if (z > -12.5 && Math.abs(x) < 17) return 0;
      if (Math.abs(x) > fieldHalf(z)) return 0;
      const t = (z - FIELD_BACK) / -FIELD_BACK;
      return 0.55 + 1.7 * t * t;
    };
    const field = scatter(-100, 100, FIELD_BACK, -5, density, 604, avoid).map((p) => ({ ...p, y: FL }));
    this.farCrowd = new FarCrowd(field, { seed: 605, clothes, phones: 0.12, focus: V(0, 6, 4) });
    this.group.add(this.farCrowd.object);
    // everyone in the field wears an LED wristband the show drives
    this.bands = this.add(new Wristbands(field, { origin: new THREE.Vector2(0, 0), seed: 607 }));
    // a holographic gauze across the stage lip: shapes hang in the air in front of the booth, drawn for the mix tent's view
    this.scrim = this.add(new HoloScrim([32, 15], V(0, 7.9, -1.95), V(0, FL + 1.7, -42)));
    // flags across the crowd
    const r = rng(606);
    const flagSpots: THREE.Vector3[] = [];
    for (let i = 0; i < 34; i++) flagSpots.push(V((r() - 0.5) * 70, FL, -10 - r() * 110));
    this.flags = new Flags(flagSpots, 607);
    this.group.add(this.flags.object);
    this.group.add(this.drones.object);
    this.dress();
  }

  /** the site round the stage: the pit, the wings, backstage, the mix tent, towers, food, a bar, toilets, fences, the trodden field */
  private dress(): void {
    const d = new Dresser(611);
    const edge = Math.atan(70 / -FIELD_BACK);
    // the pit: steel barrier, trackway for security, water for the front rows
    d.barrier(V(25, FL, -4.2), V(-25, FL, -4.2));
    d.trackway(V(-24.5, FL, -3.1), V(24.5, FL, -3.1), 1.9);
    for (const s of [-1, 1]) {
      d.roadCase(V(s * 23.6, FL, -3.3), 0.1 * s, 1.0, 0.7, 0.6);
      for (let i = 0; i < 4; i++) d.box('blue', 0.4, 0.3, 0.3, s * (21.8 - i * 0.46), FL + 0.15 + (i === 3 ? 0.3 : 0), -2.55, 0.1 * i);
    }
    // the stage lip: an LED edge in the show's colours, white tape on the edge
    d.put(d.glow('#ffffff', 'palette', 1.6, 0), new THREE.BoxGeometry(44, 0.05, 0.03).translate(0, -0.06, -2.02));
    d.box('white', 44, 0.004, 0.05, 0, 0.002, -1.93);
    for (const s of [-1, 1]) {
      // side of stage: a desk looking at the booth, amp racks, cases, hazers upstage
      d.foh(V(s * 16.5, 0, 3.2), (-s * Math.PI) / 2, 2.6);
      for (let i = 0; i < 3; i++) d.ampRack(V(s * 20.6, 0, 5.6 + i * 0.75), (-s * Math.PI) / 2, i === 2 ? 6 : 8);
      d.roadCase(V(s * 18.2, 0, 8.7), 0.05 * s, 1.2, 0.8, 0.8);
      d.roadCase(V(s * 18.2, 0.8, 8.7), -0.04 * s, 1.0, 0.6, 0.7);
      d.roadCase(V(s * 16.5, 0, 9.1), 0.2 * s, 0.8, 1.2, 0.6);
      d.roadCase(V(s * 19.8, 0, 10.2), 0, 1.6, 0.9, 0.8);
      d.hazer(V(s * 10, 0, 10.0), Math.PI);
      d.hazer(V(s * 3, 0, 10.4), Math.PI);
      // cable from the booth out to the wing, and a loom down the downstage leg
      d.tube('rubber', [V(s * 1.8, 0.012, 0.5), V(s * 6, 0.012, 1.5), V(s * 11, 0.012, 2.1), V(s * 15.2, 0.012, 3.1)], 0.012, 4);
      d.tube('rubber', [V(s * 23.45, ROOF_Y - 0.6, -1.1), V(s * 23.45, 1.4, -1.1), V(s * 22.8, 0.05, -0.4), V(s * 21.5, 0.05, 0.6)], 0.045, 6);
      d.put('rubber', new THREE.TorusGeometry(0.35, 0.04, 5, 16).rotateX(Math.PI / 2).translate(s * 21.2, 0.04, 1.4));
      // chain motors and their chains over the hangs
      for (const dz of [-0.5, 0.5]) {
        d.box('black', 0.3, 0.36, 0.3, s * 19.5, ROOF_Y - 0.3, -1.2 + dz);
        d.rod('steel', V(s * 19.5, ROOF_Y - 0.48, -1.2 + dz), V(s * 19.5, ROOF_Y - 1.15, -1.2 + dz), 0.012, 4);
      }
      // stairs up the back of the stage
      d.steps(V(s * 19.5, FL, 14 + 13 * 0.28), Math.PI, 13, 1.2, -FL / 13, 0.28);
      // ballast at the screen towers
      for (const x of [26, 34]) for (const dz of [-1.25, 1.25]) d.ibc(V(s * x, FL, 3.5 + dz));
    }

    // backstage: production cabins with lit windows, generators, the trucks, a mast
    const lit = d.glow('#dfe8ff', 'steady', 0.9);
    for (const x of [-30, -23, -16]) d.cabin(V(x, FL, 22), Math.PI, 6, lit);
    d.festoon(V(-33, FL + 2.8, 20.6), V(-13, FL + 2.8, 20.6), 0.5, d.glow('#ffcf7a', 'breathe', 2), 0.6);
    d.bench(V(-26.5, FL, 18.6), Math.PI, 1.8);
    d.bench(V(-19.5, FL, 18.4), Math.PI + 0.1, 1.8);
    d.wheelieBins(V(-11.5, FL, 22.4), Math.PI, 3);
    d.generator(V(16, FL, 21), Math.PI);
    d.generator(V(21.5, FL, 21), Math.PI);
    for (const x of [16, 21.5]) d.tube('rubber', [V(x - 1, FL + 0.04, 20.2), V(x - 3, FL + 0.04, 17), V(x - 6, FL + 0.04, 14.6), V(x - 7, FL + 0.6, 14.05)], 0.035, 5);
    d.lorry(V(6, FL, 31), -Math.PI / 2, 13.6, 'blue');
    d.lorry(V(6, FL, 35.5), -Math.PI / 2, 13.6, 'red');
    d.lightMast(V(0, FL, 26), Math.PI, 7);
    d.trackway(V(-8, FL, 15), V(-8, FL, 40), 3);

    // front of house: a black scaffold tent on a low deck, open to the stage; both desks, racks behind, a camera riser beside
    const fz = -42;
    d.box('black', 12, 0.2, 8, 0, FL + 0.1, fz);
    for (const x of [-6, 0, 6]) for (const z of [fz - 4, fz + 4]) d.rod('galv', V(x, FL + 0.2, z), V(x, FL + 4.2, z), 0.04, 6);
    for (const s of [-1, 1]) d.box('black', 12.4, 0.05, 4.4, 0, FL + 4.5, fz + s * 2.05, 0, s * 0.16);
    d.box('black', 12, 4.0, 0.05, 0, FL + 2.2, fz - 4);
    for (const s of [-1, 1]) d.box('black', 0.05, 4.0, 4, s * 6, FL + 2.2, fz - 2);
    d.rail([V(-6, FL + 0.2, fz + 4.05), V(6, FL + 0.2, fz + 4.05)], 1.0, 2);
    d.foh(V(-2.2, FL + 0.2, -39.7), 0, 3.0);
    d.foh(V(1.5, FL + 0.2, -39.7), 0, 2.8);
    d.ampRack(V(-4.6, FL + 0.2, fz - 3.3), 0, 8);
    d.ampRack(V(-3.9, FL + 0.2, fz - 3.3), 0, 6);
    d.roadCase(V(4.4, FL + 0.2, fz - 3.3), 0, 1.2, 0.9, 0.8);
    d.roadCase(V(4.4, FL + 1.1, fz - 3.3), 0.1, 0.9, 0.5, 0.6);
    const work = d.glow('#ffe2b0', 'steady', 1.6);
    for (const x of [-3, 3]) d.put(work, new THREE.SphereGeometry(0.08, 8, 6).translate(x, FL + 3.85, fz));
    d.cableRamp(V(0.6, FL, -37.6), V(0.6, FL, -4.8));
    d.scaffold(V(-9.5, FL, -41), 3, 3, 3, 1.5);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      d.rod('blackMetal', V(-9.5 + Math.cos(a) * 0.35, FL + 3.04, -41 + Math.sin(a) * 0.35), V(-9.5, FL + 4.4, -41), 0.015, 4);
    }
    d.box('black', 0.4, 0.34, 0.7, -9.5, FL + 4.6, -41, 0.15);
    d.rod('black', V(-9.45, FL + 4.6, -40.6), V(-9.42, FL + 4.6, -40.25), 0.09, 10);
    d.sign('FOH', V(0, FL + 3.85, fz + 4.1), 0, 1.4, 0.5);

    // the delay towers: water ballast and a fence round each, the feed down the leg
    for (const z of [-70, -140])
      for (const s of [-1, 1]) {
        const x = s * 16;
        for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) d.ibc(V(x + dx, FL, z + dz));
        const c = [V(x - 2.4, FL, z - 2.4), V(x + 2.4, FL, z - 2.4), V(x + 2.4, FL, z + 2.4), V(x - 2.4, FL, z + 2.4)];
        for (let i = 0; i < 4; i++) d.fence(c[i], c[(i + 1) % 4], 2.0);
        d.tube('rubber', [V(x + 0.5, FL + 13, z + 0.5), V(x + 0.5, FL + 0.6, z + 0.5), V(x + 1.6, FL + 0.04, z + 2.6), V(x + 2, FL + 0.04, z + 6)], 0.03, 5);
      }

    // food down the left side, a bar on the right, toilets further back, all facing the field
    const left = Math.PI / 2 + edge;
    const right = -Math.PI / 2 - edge;
    [-46, -56, -66, -76, -86].forEach((z, i) => d.foodTruck(V(-(fieldHalf(z) + 5), FL, z), left, i));
    for (const z of [-51, -71]) d.wheelieBins(V(-(fieldHalf(z) + 3.2), FL, z), left, 3);
    d.barTent(V(fieldHalf(-44) + 5, FL, -44), right, 12);
    d.barTent(V(fieldHalf(-62) + 5, FL, -62), right, 10);
    d.wheelieBins(V(fieldHalf(-53) + 3, FL, -53), right, 3);
    for (const [s, z] of [[-1, -122], [1, -126]] as [number, number][]) {
      d.portaloos(V(s * (fieldHalf(z) + 4.5), FL, z), s < 0 ? left : right, 8);
      d.sign('TOILETS', V(s * (fieldHalf(z + 7) + 3), FL + 2.6, z + 7), s < 0 ? left : right, 1.8, 0.55, '#14161a', '#3ad7ff', FL);
    }
    d.sign('FOOD', V(-(fieldHalf(-38) + 3), FL + 2.8, -38), left, 1.6, 0.55, '#14161a', '#ffd23f', FL);
    d.sign('WATER', V(fieldHalf(-34) + 2.5, FL + 2.6, -34), right, 1.6, 0.55, '#14161a', '#3ad7ff', FL);
    // a service road behind the stalls, light masts, the perimeter fence
    for (const s of [-1, 1]) {
      d.trackway(V(s * (fieldHalf(-20) + 9.5), FL, -20), V(s * (fieldHalf(-200) + 9.5), FL, -200), 3);
      for (const z of [-30, -105, -175]) d.lightMast(V(s * (fieldHalf(z) + 12.5), FL, z), s < 0 ? left : right, 7);
      d.fence(V(s * (fieldHalf(-6) + 14), FL, -6), V(s * (fieldHalf(-215) + 14), FL, -215), 2.2);
      d.fence(V(s * 34.6, FL, -1), V(s * (fieldHalf(-6) + 14), FL, -6), 2.2);
    }
    // the field after a day of it: mud where people stand and walk, cups and cans underfoot
    d.mud(-27, 27, -62, -4.6, FL, 61);
    d.mud(-13, 9, -49, -35, FL, 62);
    d.mud(-(fieldHalf(-90) + 4), -(fieldHalf(-40) - 5), -90, -40, FL, 63);
    d.mud(fieldHalf(-40) - 5, fieldHalf(-68) + 4, -68, -38, FL, 64);
    d.litter(-24, 24, -48, -4.8, 260, FL);
    d.litter(-60, 60, -110, -48, 160, FL);

    // a funfair past the fence on the left, out where the drone flies: the big wheel turning, stalls round its foot
    const night = () => this.look.night;
    this.add(new FerrisWheel(V(-112, FL, -152), 0.8, { radius: 18, night, d }));
    for (const [x, z, i] of [[-96, -128, 1], [-90, -140, 3], [-128, -132, 0], [-134, -168, 2]]) d.foodTruck(V(x, FL, z), Math.atan2(-112 - x, -152 - z), i);
    d.festoon(V(-96, FL + 3, -128), V(-128, FL + 3, -132), 1.2, d.glow('#ffcf7a', 'breathe', 2), 1.2);
    d.lightMast(V(-100, FL, -170), 0.8, 7);
    this.add(d.done());
    // an airliner high over the site now and then
    this.add(new Aircraft({ from: V(-700, 420, -620), to: V(650, 360, 380), period: 140, offset: 30, night }));
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    const night = this.look.night;
    // the crowd catches the stage's light
    const amb = new THREE.Color().copy(s.colors[0]).multiplyScalar(0.03 * s.master * (0.4 + s.wash)).add(new THREE.Color().copy(this.look.ambSky).multiplyScalar(this.look.amb * 0.25));
    this.farCrowd.ambient(amb);
    this.crowd.update(s, dt, camera);
    this.farCrowd.update(s, dt);
    this.flags.update(this.time, s.hype);
    this.carpet.color.setScalar(0.5 + s.photos * 0.6 + night * 0.3);
    // bands and the gauze don't read in daylight: they come up with the dark
    this.bands.amount = THREE.MathUtils.smoothstep(night, 0.45, 0.9);
    this.scrim.amount = 0.25 + 0.75 * THREE.MathUtils.smoothstep(night, 0.45, 0.9);
    // the signature moment: a long run at the top, and the drones spell your name
    if (this.trigger.update(dt, s.hype, s.playing) && night > 0.5) {
      this.drones.start(nameService.text);
      moments.emit({ venue: 'festival', label: 'Your name in the sky', crowd: 'chant' });
    }
    this.drones.update(dt, s);
  }
}

export const festival: VenueDef = {
  id: 'festival',
  name: 'Main-Stage Festival',
  short: 'Festival',
  place: 'A field, somewhere',
  kind: 'Festival main stage',
  blurb: 'A main stage the size of a building and forty thousand people to the horizon.',
  palette: ['#b6ff3b', '#ff2e88', '#3ad7ff'],
  ui: '#b6ff3b',
  capacity: '40,000',
  build: () => new Festival(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#060818');
    grad.addColorStop(0.7, '#2a1a40');
    grad.addColorStop(1, '#0a0a10');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#0c0c10';
    g.fillRect(w * 0.12, h * 0.12, w * 0.76, h * 0.06);
    g.fillRect(w * 0.12, h * 0.12, w * 0.03, h * 0.6);
    g.fillRect(w * 0.85, h * 0.12, w * 0.03, h * 0.6);
    const wall = g.createLinearGradient(w * 0.2, 0, w * 0.8, 0);
    wall.addColorStop(0, '#ff2e88');
    wall.addColorStop(0.5, '#7a3cff');
    wall.addColorStop(1, '#3ad7ff');
    g.fillStyle = wall;
    g.fillRect(w * 0.2, h * 0.22, w * 0.6, h * 0.34);
    g.strokeStyle = 'rgba(182,255,59,0.7)';
    for (let i = 0; i < 16; i++) {
      g.beginPath();
      g.moveTo(w * 0.5, h * 0.6);
      g.lineTo(w * (i / 15), 0);
      g.stroke();
    }
    const r = rng(6);
    for (let i = 0; i < 900; i++) {
      const y = h * (0.66 + Math.pow(r(), 0.7) * 0.34);
      g.fillStyle = r() < 0.04 ? '#e8f0ff' : '#06060a';
      g.fillRect(r() * w, y, 2, 2);
    }
  },
};
