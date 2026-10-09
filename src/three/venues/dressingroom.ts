/*
 * The dressing room (Section 4.1): where the character creator and the
 * wardrobe live. A small backstage room: a mirror ringed with bulbs, a rail
 * of clothes, stickers and flyers on the walls, flight cases, a door to the
 * club with light leaking under it, and the set next door thumping through
 * the wall (the creator plays it, ../../audio/sfx.ts wallThump, and passes
 * its beat in). Not in the venue picker.
 *
 * Four lighting previews, to see the look under the lights it'll play in:
 *   room      the bulbs round the mirror and a strip on the ceiling
 *   club      coloured washes sweeping and a strobe on the beat (slow and soft
 *             under "reduce flashing")
 *   terrace   daylight on a terrace by the sea (the room walls go away)
 *   uv        blacklight: UV paint, irises and bright fabrics glow
 *
 * TODO: procedural stand-in for the dressing-room Blender set (Section 14);
 * the mirror is a dark glossy pane, not a real reflection.
 */
import * as THREE from 'three';
import type { Features } from '../../visualizer/AudioFeatures';
import { nameService } from '../../name/NameService';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { blobTexture } from './details';
import type { ShowState } from './show';
import { canvasTexture, concreteTexture, rng, skyTexture } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export type Lighting = 'room' | 'club' | 'terrace' | 'uv';
export const LIGHTINGS: { id: Lighting; label: string }[] = [
  { id: 'room', label: 'Dressing room' },
  { id: 'club', label: 'Club strobe' },
  { id: 'terrace', label: 'Daylight terrace' },
  { id: 'uv', label: 'UV blacklight' },
];

/** where you stand (facing +Z, towards the camera) */
export const STAND = V(0, 0, -4.4);

const ROOM = { x0: -2.5, x1: 2.5, z0: -6.4, z1: 0.4, h: 2.75 };

const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

/** a repeating copy of a shared texture (this copy is the room's own, freed with it) */
function repeated(t: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const c = t.clone();
  c.userData = {};
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

/** a gig flyer for the wall (made-up nights only); `uv` prints it in fluorescent ink */
function flyer(seed: number, uv: boolean): THREE.CanvasTexture {
  return canvasTexture(`flyer:${seed}:${uv}`, 256, 360, (g, w, h) => {
    const r = rng(seed);
    const inks = uv ? ['#b6ff3b', '#ff2e88', '#3ad7ff', '#ffd400'] : ['#ff2e88', '#ffb547', '#3ad7ff', '#e9e6df', '#b6ff3b'];
    const bg = uv ? '#120a1e' : ['#141518', '#e9e2cf', '#1f2c44', '#5a1e22'][Math.floor(r() * 4)];
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const ink = inks[Math.floor(r() * inks.length)];
    const ink2 = inks[Math.floor(r() * inks.length)];
    // a big shape
    g.fillStyle = ink2;
    g.globalAlpha = 0.85;
    const k = Math.floor(r() * 3);
    if (k === 0) {
      g.beginPath();
      g.arc(w / 2, h * 0.4, w * 0.32, 0, Math.PI * 2);
      g.fill();
    } else if (k === 1) for (let i = 0; i < 9; i++) g.fillRect(0, h * 0.12 + i * 22, w, 9);
    else {
      g.beginPath();
      g.moveTo(w / 2, h * 0.1);
      g.lineTo(w * 0.9, h * 0.66);
      g.lineTo(w * 0.1, h * 0.66);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
    const words = ['ALL NIGHT', 'BASEMENT 004', 'NO SLEEP', 'SUNDAY SERVICE', 'WAREHOUSE', 'ONE MORE', 'DEEP ROOM', 'LATE LICENCE'];
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.font = `800 ${46}px ${FONT}`;
    g.fillText(words[Math.floor(r() * words.length)], w / 2, h * 0.78);
    g.font = `600 ${20}px ${FONT}`;
    g.fillText(`FRI ${1 + Math.floor(r() * 28)} · 11PM–6AM`, w / 2, h * 0.86);
    g.fillText('HOUSE · TECHNO · DISCO', w / 2, h * 0.92);
    // worn: tape and a fold
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, h * 0.5, w, 2);
    g.fillStyle = 'rgba(230,220,190,0.55)';
    g.fillRect(w * 0.38, -4, 60, 18);
  });
}

/** the dressing-room wall: painted blockwork, scuffed, scrawled on */
function wallTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'dressing-wall',
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#2b2a2e';
      g.fillRect(0, 0, w, h);
      const r = rng(77);
      // blocks
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 3;
      for (let y = 0; y < h; y += 64) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
        for (let x = (y / 64) % 2 ? 64 : 0; x < w; x += 128) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y + 64);
          g.stroke();
        }
      }
      for (let i = 0; i < 5000; i++) {
        const v = 40 + (r() - 0.5) * 30;
        g.fillStyle = `rgba(${v},${v},${v + 4},0.3)`;
        g.fillRect(r() * w, r() * h, 2, 2);
      }
      // scuffs and marker tags
      g.lineCap = 'round';
      for (let i = 0; i < 16; i++) {
        g.strokeStyle = ['rgba(255,255,255,0.18)', 'rgba(255,46,136,0.35)', 'rgba(182,255,59,0.3)', 'rgba(0,0,0,0.4)'][i % 4];
        g.lineWidth = 2 + r() * 3;
        g.beginPath();
        let x = r() * w;
        let y = r() * h;
        g.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          x += (r() - 0.5) * 40;
          y += (r() - 0.5) * 20;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    },
    { repeat: true },
  );
}

/**
 * The club-strobe preview's flash at a beat position: a hit on every beat, or
 * with reduce flashing a soft pulse every other beat (about 1 a second at 124
 * BPM; always under 3 a second).
 */
export function previewFlash(beat: number, reduce: boolean): number {
  const ph = ((beat % 1) + 1) % 1;
  if (reduce) return Math.floor(beat) % 2 === 0 ? Math.exp(-ph * 4) * 0.35 : 0;
  return ph < 0.08 ? 1 : 0;
}

class DressingRoom extends VenueBase {
  readonly views: VenueViews = {
    // full length, from just inside the door
    wide: { pos: V(0, 1.0, -1.3), target: V(0, 0.95, STAND.z) },
    wideLabel: 'Full length',
    crowd: { pos: V(0, 1.62, STAND.z + 0.85), target: V(0, 1.58, STAND.z) },
    drone: [V(0, 1.6, -1.4), V(1.8, 1.5, -3.4), V(0, 1.6, -5.6), V(-1.8, 1.5, -3.4)],
  };
  /** the wall's beat position (set by the creator from the thump it plays) */
  beat = 0;
  /** reduce flashing (from the show settings) */
  reduceFlash = false;
  lighting: Lighting = 'room';
  /** the stage's soft light: little in the club, almost none under the blacklight */
  ambient = 1;
  private room = new THREE.Group();
  private terrace = new THREE.Group();
  private bulbs: THREE.InstancedMesh;
  private bulbMat: THREE.MeshBasicMaterial;
  private mirrorLight: THREE.PointLight;
  private ceiling: THREE.PointLight;
  private ceilingMat: THREE.MeshBasicMaterial;
  private doorGlow: THREE.MeshBasicMaterial;
  private doorLight: THREE.PointLight;
  private washA: THREE.SpotLight;
  private washB: THREE.SpotLight;
  private uvLights: THREE.PointLight[] = [];
  private uvPosters: THREE.MeshStandardMaterial[] = [];
  private sun: THREE.DirectionalLight;
  private skyHemi: THREE.HemisphereLight;
  private skyBg = new THREE.Color(0x9cc8ec);
  private dark = new THREE.Color(0x060608);
  private t = 0;

  constructor() {
    super({ fog: 0x060608, fogDensity: 0.012, background: 0x060608, hemiSky: 0x5a5560, hemiGround: 0x1a1612, hemi: 0.14, flashAt: V(0, 2.4, STAND.z + 1.2), flashRange: 9 });
    this.keyLight = { color: 0xfff1dd, intensity: 0 };
    this.toneMapping = 'agx';
    const { x0, x1, z0, z1, h } = ROOM;
    const W = x1 - x0;
    const D = z1 - z0;
    const cz = (z0 + z1) / 2;

    // the shell
    const wallTex = repeated(wallTexture(), W / 2.2, h / 2.2);
    const wall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
    const floorTex = repeated(concreteTexture(46), W / 2, D / 2);
    const floor = new THREE.MeshStandardMaterial({ map: floorTex, color: 0x8a8580, roughness: 0.55, metalness: 0.05 });
    const ceil = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.95 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W, h, D), [wall, wall, ceil, floor, wall, wall]);
    for (const m of shell.material as THREE.Material[]) m.side = THREE.BackSide;
    shell.position.set(0, h / 2, cz);
    shell.receiveShadow = true;
    this.room.add(shell);
    // skirting
    const skirt = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.6 });
    for (const [x, z, w, d] of [
      [0, z0 + 0.01, W, 0.02],
      [x0 + 0.01, cz, 0.02, D],
      [x1 - 0.01, cz, 0.02, D],
    ]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), skirt);
      s.position.set(x, 0.05, z);
      this.room.add(s);
    }

    // the door to the club on the back wall, light leaking round it
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.5, metalness: 0.4 }));
    door.position.set(1.35, 1.025, z0 + 0.03);
    this.doorGlow = new THREE.MeshBasicMaterial({ color: 0xff2e88, toneMapped: false });
    const gap = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.025), this.doorGlow);
    gap.position.set(1.35, 0.0125, z0 + 0.06);
    const port = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.28), this.doorGlow);
    port.position.set(1.35, 1.55, z0 + 0.06);
    const push = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: 0x8c96a6, metalness: 0.8, roughness: 0.3 }));
    push.position.set(1.35, 1.0, z0 + 0.08);
    this.doorLight = new THREE.PointLight(0xff2e88, 0, 4, 1.6);
    this.doorLight.position.set(1.35, 0.15, z0 + 0.3);
    this.room.add(door, gap, port, push, this.doorLight);
    const sign = nameService.surface('marker', 0.7, 0.22, { gain: 1 });
    sign.position.set(1.35, 2.25, z0 + 0.02);
    this.room.add(sign);

    // the mirror on the left wall, ringed with bulbs, and a counter under it
    const mx = x0 + 0.03;
    const my = 1.55;
    const mz = STAND.z + 0.6;
    const mw = 1.5;
    const mh = 0.95;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.04, metalness: 1, envMapIntensity: 3 }));
    glass.position.set(mx + 0.02, my, mz);
    glass.rotation.y = Math.PI / 2;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.04, mh + 0.24, mw + 0.24), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.3 }));
    frame.position.set(mx, my, mz);
    this.room.add(frame, glass);
    const spots: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) spots.push(V(mx + 0.06, my + mh / 2 + 0.08, mz - mw / 2 + (i * mw) / 6));
    for (let i = 1; i < 4; i++) {
      spots.push(V(mx + 0.06, my + mh / 2 + 0.08 - (i * (mh + 0.16)) / 4, mz - mw / 2 - 0.08));
      spots.push(V(mx + 0.06, my + mh / 2 + 0.08 - (i * (mh + 0.16)) / 4, mz + mw / 2 + 0.08));
    }
    this.bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.1), toneMapped: false });
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 12, 8), this.bulbMat, spots.length);
    spots.forEach((p, i) => this.bulbs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p)));
    this.room.add(this.bulbs);
    this.mirrorLight = new THREE.PointLight(0xffd7a8, 2.2, 5, 1.4);
    this.mirrorLight.position.set(mx + 0.5, my + 0.1, mz);
    this.room.add(this.mirrorLight);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 1.9), new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.6 }));
    counter.position.set(x0 + 0.24, 0.82, mz);
    this.room.add(counter);
    // clutter on the counter: bottles, a make-up bag, a phone, cables
    const r = rng(912);
    for (let i = 0; i < 6; i++) {
      const tall = r() < 0.6;
      const b = new THREE.Mesh(
        tall ? new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10) : new THREE.BoxGeometry(0.12, 0.05, 0.08),
        tall ? new THREE.MeshPhysicalMaterial({ color: [0x2e6b3a, 0xbfd8e8, 0x6b3a1e][i % 3], roughness: 0.1, transmission: 0.5, transparent: true, opacity: 0.8 }) : new THREE.MeshStandardMaterial({ color: [0xff2e88, 0x111111, 0x7a3cff][i % 3], roughness: 0.6 }),
      );
      b.position.set(x0 + 0.14 + r() * 0.2, 0.845 + (tall ? 0.11 : 0.025), mz - 0.8 + i * 0.3 + r() * 0.1);
      this.room.add(b);
    }
    // a chair at the counter
    const chair = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.7 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: 0x5a1e22, roughness: 0.7 }));
    seat.position.y = 0.46;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.42), seat.material);
    back.position.set(0.2, 0.7, 0);
    chair.add(seat, back);
    for (const [x, z] of [[-0.18, -0.18], [-0.18, 0.18], [0.18, -0.18], [0.18, 0.18]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.46, 6), steel);
      leg.position.set(x, 0.23, z);
      chair.add(leg);
    }
    chair.position.set(x0 + 0.75, 0, mz + 0.3);
    chair.rotation.y = 0.5;
    this.room.add(chair);

    // the clothes rail on the right wall
    const rail = new THREE.Group();
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 2.2, 8).rotateX(Math.PI / 2), steel);
    pipe.position.y = 1.75;
    rail.add(pipe);
    for (const z of [-1.1, 1.1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.75, 8), steel);
      post.position.set(0, 0.875, z);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.04), steel);
      foot.position.set(0, 0.015, z);
      rail.add(post, foot);
    }
    const cloth = ['#d9d4c7', '#2a2a2c', '#ff7a3c', '#1f4fa8', '#c9a24a', '#7a3cff', '#efe9dc', '#111111', '#3a5a86', '#b3261e', '#2f3a2c', '#c9ced6'];
    for (let i = 0; i < 12; i++) {
      const z = -1.0 + i * 0.18 + (r() - 0.5) * 0.04;
      const len = 0.6 + r() * 0.45;
      const hanger = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.004, 4, 16, Math.PI), steel);
      hanger.rotation.set(0, Math.PI / 2, 0);
      hanger.position.set(0, 1.65, z);
      hanger.scale.set(1, 0.35, 1);
      const sat = i % 4 === 1;
      const g = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, len, 0.025),
        sat ? new THREE.MeshPhysicalMaterial({ color: cloth[i], roughness: 0.35, sheen: 1, sheenColor: new THREE.Color(cloth[i]) }) : new THREE.MeshStandardMaterial({ color: cloth[i], roughness: 0.85 }),
      );
      g.rotation.y = Math.PI / 2 + (r() - 0.5) * 0.25;
      g.position.set(0, 1.65 - len / 2, z);
      rail.add(hanger, g);
    }
    rail.position.set(x1 - 0.42, 0, STAND.z + 0.2);
    this.room.add(rail);

    // flight cases stacked in the back corner, a record box
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.45, metalness: 0.2 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.9 });
    for (const [x, y, z, w, hh, d, ry] of [
      [-1.75, 0.3, z0 + 0.5, 0.9, 0.6, 0.6, 0.05],
      [-1.7, 0.78, z0 + 0.5, 0.75, 0.36, 0.5, -0.08],
      [-0.65, 0.2, z0 + 0.45, 0.45, 0.4, 0.45, 0.2],
    ]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), caseMat);
      c.position.set(x, y, z);
      c.rotation.y = ry;
      const e = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.025, d + 0.01), edge);
      e.position.y = hh / 2 - 0.02;
      c.add(e);
      this.room.add(c);
    }

    // flyers and stickers on the walls (one is your name)
    const posters: [number, number, number, number][] = [
      [-0.9, 1.6, z0 + 0.01, 0],
      [-0.45, 1.75, z0 + 0.01, 0],
      [0.15, 1.5, z0 + 0.01, 0],
      [x1 - 0.01, 1.5, STAND.z - 1.6, -Math.PI / 2],
      [x1 - 0.01, 1.85, STAND.z + 1.6, -Math.PI / 2],
      [x0 + 0.01, 1.6, STAND.z - 1.2, Math.PI / 2],
    ];
    posters.forEach(([x, y, z, ry], i) => {
      const uv = i % 2 === 1;
      const m = new THREE.MeshStandardMaterial({ map: flyer(500 + i, uv), roughness: 0.8, emissive: 0xffffff, emissiveMap: uv ? flyer(500 + i, uv) : null, emissiveIntensity: 0 });
      if (uv) this.uvPosters.push(m);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.59), m);
      p.position.set(x, y, z);
      p.rotation.set(0, ry, (r() - 0.5) * 0.08);
      this.room.add(p);
    });
    const yours = nameService.surface('sticker', 0.5, 0.18, { gain: 1 });
    yours.position.set(0.15, 1.08, z0 + 0.012);
    yours.rotation.z = 0.06;
    this.room.add(yours);

    // a strip light on the ceiling
    this.ceilingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.5), toneMapped: false });
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 1.4), this.ceilingMat);
    tube.position.set(0, h - 0.03, STAND.z + 0.9);
    this.room.add(tube);
    this.ceiling = new THREE.PointLight(0xf2efe6, 1.8, 7, 1.3);
    this.ceiling.position.set(0, h - 0.25, STAND.z + 1.0);
    this.room.add(this.ceiling);

    // the club preview: two coloured washes from the ceiling corners
    this.washA = new THREE.SpotLight(0xff2e88, 0, 9, 0.55, 0.6, 1.2);
    this.washA.position.set(-1.8, h - 0.1, STAND.z + 1.6);
    this.washB = new THREE.SpotLight(0x3ad7ff, 0, 9, 0.55, 0.6, 1.2);
    this.washB.position.set(1.8, h - 0.1, STAND.z + 1.6);
    for (const w of [this.washA, this.washB]) {
      w.target.position.copy(STAND).add(V(0, 1, 0));
      this.group.add(w, w.target);
    }
    // the blacklight preview: violet tubes
    for (const x of [-1.6, 1.6]) {
      const l = new THREE.PointLight(0x5a2bff, 0, 7, 1.3);
      l.position.set(x, h - 0.3, STAND.z + 1.2);
      this.uvLights.push(l);
      this.group.add(l);
    }

    // the terrace preview: sky, sea, a deck and a rail
    const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture('terrace-sky', '#4a8fd6', '#9cc8ec', '#f6e2c0'), side: THREE.BackSide, fog: false }));
    sky.position.set(0, 0, STAND.z);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshStandardMaterial({ color: 0x2a6f9a, roughness: 0.15, metalness: 0.3 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -1.2, STAND.z - 30);
    const deckTex = canvasTexture(
      'terrace-deck',
      256,
      256,
      (g, w, hh) => {
        const rr = rng(31);
        for (let y = 0; y < hh; y += 32) {
          const v = 150 + rr() * 40;
          g.fillStyle = `rgb(${v},${v * 0.78},${v * 0.55})`;
          g.fillRect(0, y, w, 30);
          g.fillStyle = 'rgba(40,25,10,0.5)';
          g.fillRect(0, y + 30, w, 2);
        }
      },
      { repeat: true },
    );
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ map: repeated(deckTex, 3, 3), roughness: 0.75 }));
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, 0, STAND.z);
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.6 });
    const railTop = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 0.08), white);
    railTop.position.set(0, 1.05, STAND.z - 2.2);
    this.terrace.add(sky, sea, deck, railTop);
    for (let i = 0; i < 17; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.05), white);
      p.position.set(-4 + i * 0.5, 0.525, STAND.z - 2.2);
      this.terrace.add(p);
    }
    this.sun = new THREE.DirectionalLight(0xfff1dc, 0);
    this.sun.position.set(3, 6, STAND.z + 4);
    this.sun.target.position.copy(STAND);
    this.skyHemi = new THREE.HemisphereLight(0xa8d0ff, 0xc9a77a, 0);
    this.group.add(this.sun, this.sun.target, this.skyHemi);
    this.terrace.visible = false;

    // a soft contact shadow under your feet
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(STAND.x, 0.004, STAND.z);
    this.group.add(this.room, this.terrace, blob);
  }

  update(s: ShowState, _f: Features, dt: number, _camera: THREE.Camera): void {
    this.t += dt;
    const ph = ((this.beat % 1) + 1) % 1;
    const kick = Math.exp(-ph * 7);
    const L = this.lighting;
    const terrace = L === 'terrace';
    this.room.visible = !terrace;
    this.terrace.visible = terrace;
    // the bass through the wall: the bulbs and the strip shiver on the kick
    const shiver = 1 - kick * 0.06;
    const room = L === 'room' ? 1 : L === 'club' ? 0.12 : 0;
    this.mirrorLight.intensity = 2.2 * room * shiver;
    this.bulbMat.color.setRGB(2.2, 1.7, 1.1).multiplyScalar(Math.max(0.05, room * shiver));
    this.ceiling.intensity = 1.8 * (L === 'room' ? 1 : 0) * shiver;
    this.ceilingMat.color.setRGB(1.6, 1.6, 1.5).multiplyScalar(L === 'room' ? shiver : 0.04);
    // the club through the door
    const dc = new THREE.Color().setHSL((this.beat / 32) % 1, 0.9, 0.5);
    this.doorGlow.color.copy(dc).multiplyScalar(0.6 + kick * 1.4);
    this.doorLight.color.copy(dc);
    this.doorLight.intensity = (L === 'uv' ? 0.3 : 1) * (0.6 + kick * 2.5);
    // club strobe preview: washes sweeping on the bar, a strobe on the beat
    const club = L === 'club';
    const sweep = Math.sin((this.beat / 8) * Math.PI);
    this.washA.intensity = club ? 22 * (0.5 + kick * 0.8) : 0;
    this.washB.intensity = club ? 22 * (0.5 + (1 - kick) * 0.4) : 0;
    this.washA.target.position.set(STAND.x + sweep * 0.8, 1, STAND.z);
    this.washB.target.position.set(STAND.x - sweep * 0.8, 1, STAND.z);
    this.flashLight.intensity = club ? previewFlash(this.beat, this.reduceFlash) * 7 : 0;
    // blacklight
    const uv = L === 'uv';
    for (const l of this.uvLights) l.intensity = uv ? 9 : 0;
    for (const m of this.uvPosters) m.emissiveIntensity = uv ? 0.8 : 0;
    // daylight
    this.sun.intensity = terrace ? 2.2 : 0;
    this.skyHemi.intensity = terrace ? 0.9 : 0;
    this.hemi.intensity = terrace ? 0 : uv ? 0.02 : club ? 0.06 : 0.14;
    this.ambient = terrace ? 1 : uv ? 0.08 : club ? 0.3 : 0.7;
    const bg = terrace ? this.skyBg : this.dark;
    (this.background as THREE.Color).copy(bg);
    this.fog.color.copy(bg);
    this.fog.density = terrace ? 0.004 : 0.012;
    void s;
  }
}

export const dressingRoom: VenueDef = {
  id: 'dressing',
  name: 'Dressing room',
  place: '',
  kind: 'backstage',
  blurb: '',
  palette: ['#ffd7a8', '#ff2e88', '#3ad7ff'],
  ui: '#ff2e88',
  capacity: '',
  build: () => new DressingRoom(),
  thumb(g, w, h) {
    g.fillStyle = '#18171b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd7a8';
    for (let i = 0; i < 7; i++) g.fillRect(w * 0.2 + i * w * 0.1, h * 0.25, 4, 4);
  },
};

export type DressingRoomScene = DressingRoom;
