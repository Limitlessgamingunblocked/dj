/*
 * The Rooftop Bar (Section 5.2): capacity 250. A terrace high over the city:
 * the skyline all round, festoon bulbs strung overhead, plants in planters,
 * a glass railing, the stair tower behind the booth with your name on it in
 * neon script. The set starts at golden hour (the sun going down over the
 * crowd) and the sky fades to night as it goes on. Open, light reverb
 * (audio/room.ts), glasses clinking. A dressed-up after-work crowd that gets
 * looser as the set goes on.
 *
 * Signature moment: on the right drop after dark, the city's lights switch
 * on block by block across the skyline.
 *
 * TODO: procedural stand-in for the Blender rooftop set (Section 14).
 */
import * as THREE from 'three';
import { nameStyleFor } from '../../name/venueStyles';
import type { Features } from '../../visualizer/AudioFeatures';
import type { VenueDef, VenueViews } from './base';
import { barCounter, boothClutter } from './details';
import { atBar, crewArc, vipCrew } from './crew';
import { booth, Crowd, crowdArea, HazeLayer, LedStrings, MovingHeads, speaker, TABLE_Y } from './fixtures';
import { moments, setClock } from './moments';
import { OpenAir } from './openair';
import { beaconLights, skyline, type SkyKey, type SkylineBlock } from './outdoor';
import type { ShowState } from './show';
import { canvasTexture, concreteTexture, rng, withSurface } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** the terrace: the booth at the back against the stair tower */
const T = { x0: -11, x1: 11, z0: -15, z1: 4.2 };
/** how far the street is below */
const DROP = 62;

export const ROOFTOP_SKY: SkyKey[] = [
  { k: 0, zenith: '#4f7cc0', horizon: '#ffbf80', ground: '#3a3036', sun: 9, sunColor: '#ffad5a', light: 2.4, ambSky: '#b8c4e0', ambGround: '#5a4438', amb: 0.62, stars: 0, night: 0 },
  { k: 0.3, zenith: '#3a5aa0', horizon: '#ff9a62', ground: '#2a2230', sun: 2, sunColor: '#ff7a3a', light: 1.8, ambSky: '#c09ab0', ambGround: '#3a2a36', amb: 0.5, stars: 0, night: 0.15 },
  { k: 0.5, zenith: '#1f2a5a', horizon: '#e8705a', ground: '#1a1424', sun: -3, sunColor: '#ff5a3a', light: 0.2, ambSky: '#7a5a8a', ambGround: '#22182a', amb: 0.45, stars: 0.1, night: 0.55 },
  { k: 0.72, zenith: '#0c1030', horizon: '#4a2a50', ground: '#0c0a14', sun: -8, sunColor: '#ff4a3a', light: 0, ambSky: '#2a2a5a', ambGround: '#100c18', amb: 0.26, stars: 0.5, night: 0.85 },
  { k: 1, zenith: '#04050f', horizon: '#1c1630', ground: '#06050a', sun: -14, sunColor: '#ff4a3a', light: 0, ambSky: '#141a3a', ambGround: '#08060c', amb: 0.2, stars: 0.9, night: 1 },
];

/** the street grid far below: lamps in rows */
function streetTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'rooftop-streets',
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#07080b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#3a2a1c';
      g.fillRect(0, 120, w, 16);
      g.fillRect(120, 0, 16, h);
      const r = rng(5);
      for (let i = 0; i < w; i += 8) {
        g.fillStyle = r() < 0.8 ? '#ffb15a' : '#ffffff';
        g.fillRect(i, 118, 2, 2);
        g.fillRect(i, 136, 2, 2);
        g.fillRect(118, i, 2, 2);
        g.fillRect(136, i, 2, 2);
      }
      for (let i = 0; i < 40; i++) {
        g.fillStyle = r() < 0.5 ? '#ff3020' : '#fff4d0';
        g.fillRect(r() * w, 126 + (r() - 0.5) * 6, 2, 1);
      }
    },
    { repeat: true },
  );
}

/** a bushy planter */
function planter(seed: number, w: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7 }));
  box.position.y = 0.3;
  g.add(box);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.85, flatShading: true });
  for (let i = 0; i < Math.round(w * 4); i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + r() * 0.18, 0), leaf);
    b.position.set((r() - 0.5) * (w - 0.3), 0.7 + r() * 0.35, (r() - 0.5) * 0.3);
    b.rotation.set(r() * 3, r() * 3, 0);
    g.add(b);
  }
  return g;
}

/** a small olive tree in a pot */
function olive(seed: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0xb8a48a, roughness: 0.9 }));
  pot.position.y = 0.35;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.5, 7), new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 }));
  trunk.position.y = 1.4;
  trunk.rotation.z = (r() - 0.5) * 0.2;
  g.add(pot, trunk);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x6f7f52, roughness: 0.9, flatShading: true });
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 + r() * 0.2, 0), leaf);
    b.position.set((r() - 0.5) * 0.8, 2.1 + r() * 0.5, (r() - 0.5) * 0.8);
    g.add(b);
  }
  return g;
}

class Rooftop extends OpenAir {
  readonly views: VenueViews = {
    // from the railing at the front corner, back at the booth and the tower, the city behind
    wide: { pos: V(10.4, 4.6, -16.2), target: V(-0.8, 1.4, 1.2) },
    wideLabel: 'From the railing',
    crowd: { pos: V(-1.2, 1.7, -6.5), target: V(0, 1.4, 0.8) },
    drone: [V(0, 3.2, 3.2), V(4, 2.6, 0.5), V(8.5, 2.4, -4), V(9.5, 3.4, -12), V(14, 6, -18), V(0, 8, -22), V(-14, 6, -18), V(-9.5, 3.4, -12), V(-8.5, 2.4, -4), V(-4, 2.6, 0.5)],
    extra: { cctv: { pos: V(-10.6, 3.4, -14.6), target: V(0, 1, -2) }, crane: { radius: 4, low: 1.2, high: 3.4 } },
  };
  private crowd: Crowd;
  private blocks: SkylineBlock[] = [];
  private beacons: ReturnType<typeof beaconLights>;
  private streets: THREE.MeshBasicMaterial;
  private bulbs: THREE.PointLight[] = [];
  private leds: LedStrings;
  /** the signature moment: the time each block switches on (-1: not yet) */
  private sweep: number[] = [];
  private sweepT = -1;
  private lastProgress = 0;

  constructor() {
    super({ fog: 0x7a6070, fogDensity: 0.0011, hemiSky: 0xffd8a8, hemiGround: 0x4a3a40, hemi: 1, flashAt: V(0, 3.5, -5), flashRange: 18, sunYaw: Math.PI - 0.45, skyRadius: 900 }, ROOFTOP_SKY);
    this.keyLight = { color: 0xffe2c0, intensity: 9 };
    this.grade = { tint: 0xfff2e6, contrast: 1.06, saturation: 1.08, lift: 0.002 };
    this.toneMapping = 'agx';
    const { x0, x1, z0, z1 } = T;

    // the terrace: pale stone tiles
    const tiles = concreteTexture(150).clone();
    tiles.userData = {};
    tiles.repeat.set(8, 8);
    tiles.needsUpdate = true;
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), withSurface(new THREE.MeshStandardMaterial({ map: tiles, color: 0xb0a89c }), 'roof-tiles', { bumps: 0.2, grain: 0.3, seams: 24, rough: 0.7, roughVar: 0.15, repeat: 8, normalScale: 0.4 }));
    deck.position.set(0, 0, (z0 + z1) / 2);
    deck.receiveShadow = true;
    this.group.add(deck);
    // the building under it, so the edge has depth
    const bldg = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.6, DROP, z1 - z0 + 0.6), new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.9, emissive: 0xffffff, emissiveMap: skylineWindows(), emissiveIntensity: 0.25 }));
    bldg.position.set(0, -DROP / 2 - 0.05, (z0 + z1) / 2);
    this.group.add(bldg);
    // the street far below
    const st = streetTexture();
    st.repeat.set(30, 30);
    this.streets = new THREE.MeshBasicMaterial({ map: st, color: new THREE.Color(0.2, 0.2, 0.2) });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), this.streets);
    ground.position.y = -DROP;
    this.group.add(ground);

    // the city all round, in blocks that can light up one by one
    const sky = skyline({ seed: 260, inner: 120, outer: 520, from: -Math.PI, to: Math.PI, blocks: 16, minH: 30, maxH: 150, y: -DROP, lit: '#ffd9a0', density: 0.62 });
    this.group.add(sky.group);
    this.blocks = sky.blocks;
    this.beacons = beaconLights(sky.beacons);
    this.group.add(this.beacons.object);

    // the glass railing round the edge, a steel handrail on top
    const glass = new THREE.MeshStandardMaterial({ color: 0xcfe6ee, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const rail = new THREE.MeshStandardMaterial({ color: 0x9a9ea6, metalness: 0.85, roughness: 0.3 });
    const edge = (a: THREE.Vector3, b: THREE.Vector3) => {
      const len = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.05, len), glass);
      pane.position.set(mid.x, 0.55, mid.z);
      pane.rotation.y = yaw;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 8).rotateX(Math.PI / 2), rail);
      top.position.set(mid.x, 1.1, mid.z);
      top.rotation.y = yaw;
      this.group.add(pane, top);
    };
    edge(V(x0, 0, z1), V(x0, 0, z0));
    edge(V(x0, 0, z0), V(x1, 0, z0));
    edge(V(x1, 0, z0), V(x1, 0, z1));

    // the stair and lift tower behind the booth, your name on it in neon script
    const tower = new THREE.Mesh(new THREE.BoxGeometry(9, 3.8, 4), new THREE.MeshStandardMaterial({ color: 0x8a8580, map: concreteTexture(120), roughness: 0.85 }));
    tower.position.set(0, 1.9, z1 + 2);
    this.group.add(tower);
    const nm = nameStyleFor('rooftop');
    if (nm.sign) this.nameSign(nm.sign, 3.6, 1.0, V(0, 2.75, z1 - 0.02), Math.PI, 1.4);
    // the booth: a low riser, a wooden front
    const riser = new THREE.Mesh(new THREE.BoxGeometry(5, 0.18, 2.6), new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.8 }));
    riser.position.set(0, -0.09 + 0.001, 0.9);
    this.group.add(riser);
    const b = booth({ w: 2.2, d: 0.8, front: new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.7 }), strip: '#ffcf8a', name: nm.booth });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 2.2, TABLE_Y, -0.4, 261);
    for (const s of [-1, 1]) {
      const sp = speaker(0.5, 0.8, 0.45, 'mid', 0x1a1a1c);
      sp.position.set(s * 2.1, 1.6, 0.5);
      sp.rotation.set(0.12, Math.PI + s * 0.2, 0, 'YXZ');
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6), rail);
      pole.position.set(s * 2.1, 0.6, 0.5);
      this.group.add(sp, pole);
    }

    // plants, olive trees, a bar along the left
    for (const [x, z, w] of [
      [x0 + 0.5, -2, 3],
      [x0 + 0.5, -7, 3],
      [x1 - 0.5, -3, 3],
      [x1 - 0.5, -9, 3],
      [-6, z0 + 0.5, 4],
      [6, z0 + 0.5, 4],
    ]) {
      const p = planter(Math.round(x * 13 + z * 7), w);
      p.position.set(x, 0, z);
      if (Math.abs(x) > 9) p.rotation.y = Math.PI / 2;
      this.group.add(p);
    }
    for (const [x, z] of [
      [-4.6, 2.6],
      [4.6, 2.6],
      [x0 + 1, z0 + 1],
      [x1 - 1, z0 + 1],
    ]) {
      const o = olive(Math.round(x * 7 + z));
      o.position.set(x, 0, z);
      this.group.add(o);
    }
    const bar = barCounter(6, { glow: '#ffcf8a', body: 0x2a221c, top: 0xd8d0c4, seed: 262 });
    bar.position.set(x0 + 1.4, 0, -10.5);
    bar.rotation.y = Math.PI / 2;
    this.group.add(bar);
    this.add(atBar(bar, 6, 265, { staff: 2, leaners: 3, clothes: ['#f2efe8', '#1c2a44', '#111214', '#a9c4de'] }));
    // friends behind the booth, more of them as you get bigger
    const crew = vipCrew(crewArc(0, 1.7, 2.5, 0.5, 2.2), 266, ['#f2efe8', '#1c2a44', '#d8c8a8', '#5a1e2a', '#111214']);
    if (crew) this.add(crew);

    // festoon bulbs on poles round the edge, strung across
    const poles: THREE.Vector3[] = [];
    for (const z of [2, -4, -10, -14.4]) for (const x of [x0 + 0.3, x1 - 0.3]) poles.push(V(x, 3.4, z));
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 3.4, 6).translate(0, 1.7, 0);
    for (const p of poles) {
      const m = new THREE.Mesh(poleGeo, rail);
      m.position.set(p.x, 0, p.z);
      this.group.add(m);
    }
    const leds = new LedStrings({ warm: '#ffc27a', size: 0.11, spacing: 0.5 });
    const sag = (a: THREE.Vector3, b: THREE.Vector3) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(a.clone().lerp(b, t).add(V(0, -Math.sin(t * Math.PI) * 0.55, 0)));
      }
      leds.path(pts);
    };
    for (let i = 0; i < 4; i++) sag(poles[i * 2], poles[i * 2 + 1]);
    for (let i = 0; i < 3; i++) {
      sag(poles[i * 2], poles[i * 2 + 3]);
      sag(poles[i * 2 + 1], poles[i * 2 + 2]);
    }
    this.leds = this.add(leds.done());
    // a little real light from the bulbs (a few lamps stand in for the strings)
    for (const z of [-1, -7, -12]) {
      const l = new THREE.PointLight(0xffc27a, 0, 12, 1.6);
      l.position.set(0, 2.9, z);
      this.group.add(l);
      this.bulbs.push(l);
    }
    // two small moving heads standing on the tower, for later on
    this.add(new MovingHeads([V(-3.6, 3.8, z1 + 0.4), V(3.6, 3.8, z1 + 0.4)].map((pos) => ({ pos, up: true })), { length: 9, radius: 0.5, gain: 0.8, floorY: 0 }));
    this.wash(V(-6, 0.5, -5), 0, 2.5, 8);
    this.wash(V(6, 0.5, -8), 1, 2.5, 8);
    this.wash(V(0, 0.4, 2.2), 2, 2, 6, 0.6);
    this.add(new HazeLayer(new THREE.Box3(V(x0, 0.4, z0), V(x1, 3.2, z1)), 3, 0.25));

    // the after-work crowd, drinks in hand
    this.crowd = new Crowd(crowdArea(x0 + 1.2, x1 - 1.2, -1.6, z0 + 1.6, 1.25, 263, { avoid: [new THREE.Box2(new THREE.Vector2(x0, -13), new THREE.Vector2(x0 + 2.6, -8))] }), {
      seed: 264,
      phones: 0.1,
      drinks: 0.6,
      signs: 1,
      clothes: ['#f2efe8', '#a9c4de', '#1c2a44', '#d8c8a8', '#111214', '#5a1e2a', '#e8e2d4', '#3a4a5a', '#c9a07a', '#2a2a2e'],
    });
    this.group.add(this.crowd.object);
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    const l = this.look;
    const night = l.night;
    // a new set starts with the lights off again
    if (setClock.progress < this.lastProgress - 0.2) {
      this.sweepT = -1;
      this.sweep = [];
    }
    this.lastProgress = setClock.progress;
    // the signature moment: the right drop once it's dark enough
    if (this.sweepT < 0 && s.dropHit && night > 0.35 && s.hype > 0.72) {
      this.sweepT = 0;
      // left to right across the skyline as the DJ sees it, one block a beat
      const beat = 60 / Math.max(80, s.bpm || 124);
      const order = this.blocks.map((b, i) => ({ i, a: Math.atan2(Math.sin(b.angle), -Math.cos(b.angle)) })).sort((p, q) => p.a - q.a);
      this.sweep = new Array(this.blocks.length).fill(0);
      order.forEach((o, n) => (this.sweep[o.i] = n * beat * 0.5));
      moments.emit({ venue: 'rooftop', label: 'The city lights up', crowd: 'cheer' });
    }
    if (this.sweepT >= 0) this.sweepT += dt;
    this.blocks.forEach((b, i) => {
      const before = 0.06 + night * 0.28;
      let k = before;
      if (this.sweepT >= 0) {
        const t = this.sweepT - this.sweep[i];
        // each block pops on with a little overshoot, then holds
        k = t < 0 ? before : Math.max(0.4 + night * 0.7, (0.4 + night * 0.7) * (1 + Math.exp(-t * 3) * 0.8));
      }
      b.mat.emissiveIntensity = k;
    });
    this.beacons.update(this.time, night);
    this.streets.color.setScalar(0.12 + night * 0.9);
    this.glow.setRGB(1, 0.55, 0.3).multiplyScalar(0.14 * night * (this.sweepT >= 0 ? 1.4 : 0.8));
    for (const b of this.bulbs) b.intensity = (0.6 + night * 5) * (0.8 + s.hat * 0.2);
    // bulbs barely show in daylight
    this.leds.gain = 0.25 + night * 0.75;
    // the after-work crowd loosens up as the set goes on
    this.crowd.update({ ...s, hype: s.hype * (0.6 + 0.4 * Math.min(1, setClock.progress * 1.6)) }, dt, camera);
  }
}

/** the windows of the building under the terrace */
function skylineWindows(): THREE.CanvasTexture {
  const t = canvasTexture(
    'rooftop-bldg',
    128,
    512,
    (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      const r = rng(9);
      for (let y = 8; y < h; y += 16) for (let x = 6; x < w; x += 16) if (r() < 0.45) (g.fillStyle = r() < 0.7 ? '#ffd9a0' : '#cfe0ff'), g.fillRect(x, y, 8, 9);
    },
    { repeat: true },
  );
  return t;
}

export const rooftop: VenueDef = {
  id: 'rooftop',
  name: 'Rooftop Bar',
  short: 'Rooftop',
  place: 'Downtown',
  kind: 'Rooftop terrace · golden hour to night',
  blurb: 'A terrace over the city: festoon bulbs, plants, a glass railing and the skyline all round. Golden hour at the start, night by the end.',
  palette: ['#ffb05a', '#ff5f8a', '#7a5cff'],
  ui: '#ffb05a',
  capacity: '250',
  build: () => new Rooftop(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#3a5aa0');
    grad.addColorStop(0.6, '#ff9a62');
    grad.addColorStop(1, '#2a1e2a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,220,150,0.9)';
    g.beginPath();
    g.arc(w * 0.62, h * 0.62, h * 0.12, 0, Math.PI * 2);
    g.fill();
    const r = rng(4);
    let x = 0;
    while (x < w) {
      const bw = 8 + r() * 16;
      const bh = h * (0.12 + r() * 0.3);
      g.fillStyle = '#231a26';
      g.fillRect(x, h * 0.72 - bh, bw, bh + h);
      g.fillStyle = 'rgba(255,217,160,0.8)';
      for (let y = h * 0.72 - bh + 4; y < h * 0.72; y += 6) for (let xx = x + 2; xx < x + bw - 2; xx += 5) if (r() < 0.3) g.fillRect(xx, y, 2, 2);
      x += bw + 1;
    }
    g.strokeStyle = '#ffd08a';
    g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(0, h * (0.2 + i * 0.08));
      g.quadraticCurveTo(w / 2, h * (0.32 + i * 0.08), w, h * (0.2 + i * 0.08));
      g.stroke();
    }
    g.fillStyle = '#ffd08a';
    for (let i = 0; i < 3; i++) for (let k = 0; k <= 12; k++) g.fillRect((k / 12) * w, h * (0.2 + i * 0.08) + Math.sin((k / 12) * Math.PI) * h * 0.06 - 1, 2, 2);
  },
};
