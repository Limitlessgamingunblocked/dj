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
import { nameService } from '../../name/NameService';
import { nameStyleFor } from '../../name/venueStyles';
import type { Features } from '../../visualizer/AudioFeatures';
import type { VenueDef, VenueViews } from './base';
import { Confetti } from './confetti';
import { boothClutter } from './details';
import { FarCrowd, scatter } from './farcrowd';
import { crewArc, lightingTech, security, vipCrew } from './crew';
import { Blinders, booth, Co2Jets, Crowd, crowdArea, HazeLayer, lineArray, MovingHeads, speaker, Strobes, TABLE_Y, truss } from './fixtures';
import { Lasers, laserStands } from './lasers';
import { moments, PeakTrigger } from './moments';
import { OpenAir } from './openair';
import type { SkyKey } from './outdoor';
import { Pyro } from './pyro';
import type { ShowState } from './show';
import { canvasTexture, rng } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** the field is this far below the stage deck */
const FL = -2.4;
const FIELD_BACK = -230;

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
  private flags: Flags;
  private drones = new DroneShow();
  private trigger = new PeakTrigger(0.87, 12);
  private carpet: THREE.MeshBasicMaterial;

  constructor() {
    super({ fog: 0x1a1630, fogDensity: 0.0042, hemiSky: 0x2a2a5a, hemiGround: 0x0c0a10, hemi: 0.26, flashAt: V(0, 12, -14), flashRange: 60, sunYaw: Math.PI + 0.3, skyRadius: 900 }, FESTIVAL_SKY);
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
    const roofY = 24;
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
    const tent = new THREE.Mesh(new THREE.BoxGeometry(12, 4.2, 8), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.9 }));
    tent.position.set(0, FL + 2.1, -42);
    this.group.add(tent);
    // the barrier and the pit
    const fence = new THREE.MeshStandardMaterial({ color: 0x6a6c70, metalness: 0.7, roughness: 0.4 });
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(50, 1.2, 0.5), fence);
    barrier.position.set(0, FL + 0.6, -4.2);
    this.group.add(barrier);

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
    this.crowd = new Crowd(crowdArea(-17, 17, -5.2, -12.5, 1.9, 602, { y: FL }), { seed: 603, phones: 0.16, drinks: 0.15, signs: 6, clothes, riders: 7 });
    // the stage party behind you, security in the pit, the lighting tech out at the mix tent
    const crew = vipCrew(crewArc(0, 2.8, 4.4, 0.6, 2.8), 608, clothes);
    if (crew) this.add(crew);
    this.add(security([-13, -7, 7, 13].map((x) => ({ x, z: -3.3, y: FL })), 609));
    this.add(lightingTech({ x: 1.2, z: -40.6, y: FL + 0.2, face: 0 }, 610));
    this.group.add(this.crowd.object);
    const avoid = [new THREE.Box2(new THREE.Vector2(-7, -47), new THREE.Vector2(7, -37)), ...[-70, -140].flatMap((z) => [-1, 1].map((s) => new THREE.Box2(new THREE.Vector2(s * 16 - 1.5, z - 1.5), new THREE.Vector2(s * 16 + 1.5, z + 1.5))))];
    const density = (x: number, z: number) => {
      if (z > -12.5 && Math.abs(x) < 17) return 0;
      // the field widens towards the back
      const half = 26 + (-z / -FIELD_BACK) * 70;
      if (Math.abs(x) > half) return 0;
      const t = (z - FIELD_BACK) / -FIELD_BACK;
      return 0.55 + 1.7 * t * t;
    };
    this.farCrowd = new FarCrowd(scatter(-100, 100, FIELD_BACK, -5, density, 604, avoid).map((p) => ({ ...p, y: FL })), { seed: 605, clothes, phones: 0.12, focus: V(0, 6, 4) });
    this.group.add(this.farCrowd.object);
    // flags across the crowd
    const r = rng(606);
    const flagSpots: THREE.Vector3[] = [];
    for (let i = 0; i < 34; i++) flagSpots.push(V((r() - 0.5) * 70, FL, -10 - r() * 110));
    this.flags = new Flags(flagSpots, 607);
    this.group.add(this.flags.object);
    this.group.add(this.drones.object);
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
  blurb: 'A stage structure the size of a building, an LED wall to match, delay towers in the field and forty thousand people to the horizon. Lasers, pyro, CO2, confetti.',
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
