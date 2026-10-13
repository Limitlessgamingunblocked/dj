/*
 * Berghain, Berlin — the main floor of the old power station (see
 * docs/venue-research.md): an 18 m raw-concrete hall with steel pillars, no
 * stage — the booth is recessed into the back wall — Funktion-One-style
 * stacks in the corners, a single fixed light bar across the room, sparse
 * cold beams, red work lamps and a strobe bank for the peak. No lasers, no
 * mirrors, no VIP area, no phones. The steel balcony is unverified.
 */
import * as THREE from 'three';
import type { FloorReflect } from '../reflect';
import { nameStyleFor } from '../../name/venueStyles';
import { Confetti } from './confetti';
import { Pyro } from './pyro';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { barCounter, boothClutter, DustMotes, exitSign, LightBar } from './details';
import { Dresser } from './dress';
import { atBar } from './crew';
import { block, booth, Crowd, crowdArea, HazeLayer, MovingHeads, speaker, Strobes, TABLE_Y } from './fixtures';
import { concreteTexture, withSurface } from './tex';
import { beams, silhouettes } from './warehouse';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const STAGE = 1.0;

class Berghain extends VenueBase {
  // bare concrete worn by years of it: a dull sheen
  readonly reflect: FloorReflect[] = [
    { y: -STAGE, strength: 0.3, rough: 0.75 },
    { y: 0, strength: 0.2, rough: 0.7 },
  ];
  readonly views: VenueViews = {
    wide: { pos: V(-9.2, 7.4, -11), target: V(0, 0.6, -1.5) },
    wideLabel: 'Balcony',
    director: {
      style: 'stream',
      landmarks: [{ label: 'The hall', from: { pos: V(3.6, 3.7, -15.5), target: V(0, 2, 0) }, to: { pos: V(2.4, 3.9, -14.5), target: V(0, 2.2, 0) }, fov: 36 }],
    },
    crowd: { pos: V(2.8, 2.3, -13.5), target: V(0, 1.6, 0) },
    // the booth sits in a niche: the crane and the rig camera reach out over the floor, the camcorder stands in the crowd
    extra: { crane: { radius: 5, low: 1.8, high: 4.6 }, rig: { pos: V(2.2, 5.6, -6.2), target: V(0, 0.9, 0.3) }, camcorder: { pos: V(1.1, 0.95, -4.6), target: V(0, 1.4, 0.6) } },
    // out of the booth niche, round the hall, across the wall and back in through the opening
    drone: [V(0, 2.5, 2.8), V(0.3, 2.1, 0.8), V(0.6, 2.0, -2.8), V(2.0, 2.3, -9.0), V(3.5, 3.2, -17.0), V(0, 5.5, -25.0), V(-4.0, 4.0, -19.0), V(-8.5, 7.5, -12.0), V(-8.0, 3.0, -5.0), V(-4.6, 1.6, -2.0), V(-1.0, 1.6, -1.8), V(3.0, 1.6, -1.9), V(5.6, 2.4, -2.2), V(1.8, 2.6, -1.6)],
  };

  constructor() {
    super({ fog: 0x040509, fogDensity: 0.034, hemiSky: 0x2a3140, hemiGround: 0x050507, hemi: 0.3, flashAt: V(0, 9, -10), flashRange: 45 });
    this.keyLight = { color: 0xdfe8ff, intensity: 11 };
    this.grade = { tint: 0xf2f6ff, contrast: 1.04, saturation: 0.88, lift: 0.014 };
    // raw concrete everywhere; nothing shiny
    const conc = withSurface(new THREE.MeshStandardMaterial({ color: 0x5b5d62, map: concreteTexture(70) }), 'berghain-wall', { bumps: 0.7, grain: 0.7, seams: 64, rough: 0.92, roughVar: 0.06 });
    const ft = concreteTexture(34);
    const fl = withSurface(new THREE.MeshStandardMaterial({ color: 0x5c5e63, map: ft }), 'berghain-floor', { bumps: 0.4, grain: 0.8, rough: 0.82, roughVar: 0.12, polish: 0.15, repeat: 9, normalScale: 0.6 });
    ft.repeat.set(9, 9);
    const ceil = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, map: concreteTexture(40), roughness: 0.95 });
    // the niche walls face the room; the room box itself is seen from inside
    const concF = conc.clone();
    const room = block(26, 19, 36, [conc, conc, ceil, fl, conc, conc], 5);
    (room.material as THREE.Material[]).forEach((m) => (m.side = THREE.BackSide));
    room.position.set(0, 8.5, -14);
    this.group.add(room);
    const concS = withSurface(new THREE.MeshStandardMaterial({ color: 0x4a4c51, map: concreteTexture(70) }), 'berghain-pillar', { bumps: 0.6, grain: 0.7, seams: 96, rough: 0.93, roughVar: 0.05, repeat: 1.5 });
    for (const z of [-5, -13, -21, -29]) {
      for (const x of [-6.5, 6.5]) {
        const p = block(1.3, 19, 1.3, concS, 3);
        p.position.set(x, 8.5, z);
        this.group.add(p);
      }
    }
    for (const z of [-9, -17, -25]) {
      const beam = block(26, 1.2, 1, concS, 3);
      beam.position.set(0, 16.9, z);
      this.group.add(beam);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.45 });
    // steel balcony on the left wall
    const slab = new THREE.Mesh(new THREE.BoxGeometry(4, 0.35, 26), steel);
    slab.position.set(-11, 5.5, -16);
    this.group.add(slab);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 26), steel);
    rail.position.set(-9.05, 6.7, -16);
    this.group.add(rail);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), steel, 18);
    for (let i = 0; i < 18; i++) posts.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-9.05, 6.2, -3.3 - i * 1.5));
    this.group.add(posts);
    // pipes along the ceiling
    for (const [x, r] of [
      [3.5, 0.3],
      [4.4, 0.18],
      [9.5, 0.45],
    ]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 36, 12).rotateX(Math.PI / 2), steel);
      pipe.position.set(x, 15.2, -14);
      this.group.add(pipe);
    }

    // no stage: the booth sits in a niche cut into the back wall, a metre above the floor
    const NW = 2.6; // half width of the opening
    const NH = 3.6; // opening height above the booth floor
    const front = -0.9;
    const wallBlock = (x0: number, x1: number, y0: number, y1: number) => {
      const w = x1 - x0;
      const h = y1 - y0;
      const m = block(w, h, 4 - front, concF, 4);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (front + 4) / 2);
      this.group.add(m);
    };
    wallBlock(-13, -NW, -STAGE, 18);
    wallBlock(NW, 13, -STAGE, 18);
    wallBlock(-NW, NW, NH, 18);
    wallBlock(-NW, NW, -STAGE, 0);
    const b = booth({ w: 3.2, d: 1.0, front: concS, top: 0x2a2b2e, strip: null, name: nameStyleFor('berghain').booth });
    this.group.add(b.group);
    boothClutter(this.group, 3.2, TABLE_Y, -0.5, 81);
    this.add(new DustMotes(new THREE.Box3(V(-2.6, TABLE_Y - 0.3, -2.4), V(2.6, TABLE_Y + 2.6, 1.6)), 320, 83));
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(NW * 2, 0.05, 0.05), steel);
    barrier.position.set(0, 0.95, front - 0.05);
    this.group.add(barrier);
    // a dim warm strip under the niche's lintel outlines the opening from the floor
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(NW * 2 - 0.2, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.45), toneMapped: false }));
    lintel.position.set(0, NH - 0.05, front + 0.08);
    this.group.add(lintel);

    // stacks
    const stack = (x: number, z: number, rotY: number) => {
      const g = new THREE.Group();
      let y = -STAGE;
      for (const [w, h, d, kind] of [
        [1.3, 1.25, 1.1, 'sub'],
        [1.3, 1.25, 1.1, 'sub'],
        [1.2, 0.9, 0.9, 'mid'],
        [1.2, 0.9, 0.9, 'mid'],
        [1.1, 0.7, 0.8, 'top'],
      ] as const) {
        const s = speaker(w, h, d, kind);
        s.position.y = y + h / 2;
        y += h;
        g.add(s);
      }
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      this.group.add(g);
    };
    // a stack in each corner of the floor, turned to the middle of the room
    for (const [x, z] of [
      [-11.3, -2.6],
      [11.3, -2.6],
      [-11.3, -23.6],
      [11.3, -23.6],
    ]) stack(x, z, Math.atan2(-x, -13 - z));
    // the single fixed light bar across the room
    this.add(new LightBar(V(-12.8, 9.6, -12.5), V(12.8, 9.6, -12.5)));
    // a dim bar in the far corner, exits at the back
    const bar = barCounter(6.5, { glow: '#ff8a3c', seed: 82 });
    bar.position.set(11.9, -STAGE, -27.5);
    bar.rotation.y = -Math.PI / 2;
    this.group.add(bar);
    this.add(atBar(bar, 6.5, 86, { staff: 2, leaners: 1, clothes: ['#0b0b0d', '#141417', '#1c1c20'] }));
    this.group.add(exitSign(V(-12.92, 2.3, -29), Math.PI / 2), exitSign(V(12.92, 2.3, -20), -Math.PI / 2), exitSign(V(-6, 2.3, -31.9), 0));

    // work lamps on the pillars
    const redLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.12, 0.08), toneMapped: false });
    for (const z of [-5, -13, -21]) {
      for (const x of [-5.8, 5.8]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.12), redLamp);
        l.position.set(x, 3.2, z);
        this.group.add(l);
      }
    }

    this.add(
      new MovingHeads(
        [-8.5, -3, 3, 8.5].flatMap((x) => [V(x, 13.5, -6), V(x, 13.5, -16)]).map((pos) => ({ pos })),
        { length: 15, radius: 0.95, gain: 1.15, floorY: -STAGE },
      ),
    );
    this.add(new Strobes([-8, -4.8, -1.6, 1.6, 4.8, 8].flatMap((x) => [V(x, 11.5, -8), V(x, 11.5, -18)]).map((p) => ({ pos: p, tilt: Math.PI / 2 })), [0.7, 0.2, 0.1]));
    // cold sparks only at the niche's front corners
    this.add(new Pyro([V(-2.25, 0, -0.62), V(2.25, 0, -0.62)].map((pos) => ({ pos, kind: 'spark' as const }))));
    // not a confetti club: only by hand from the desk
    this.add(new Confetti([-1, 1].map((s) => ({ pos: V(s * 1.85, 0.02, -0.75), dir: V(s * 0.1, 0.8, -0.6) })), { floorY: -STAGE, speed: 12, onDrops: false }));

    const avoid = [-5, -13, -21].flatMap((z) => [-6.5, 6.5].map((x) => new THREE.Box2(new THREE.Vector2(x - 0.9, z - 0.9), new THREE.Vector2(x + 0.9, z + 0.9))));
    avoid.push(new THREE.Box2(new THREE.Vector2(9.6, -29), new THREE.Vector2(13, -24)));
    // keep the rail in front of the balcony camera clear
    const balconyCam = new THREE.Box2(new THREE.Vector2(-10.8, -12.6), new THREE.Vector2(-9.4, -9.4));
    const dark = ['#0b0b0d', '#141417', '#1c1c20', '#0f1012', '#2a2a2e', '#18181b'];
    // no phones and no signs: cameras get stickered at the door
    this.add(new Crowd([...crowdArea(-10.5, 10.5, -2.2, -24, 1.25, 81, { y: -STAGE, avoid }), ...crowdArea(-12.6, -9.6, -5, -27, 1.1, 82, { y: 5.68, avoid: [balconyCam] })], { seed: 80, clothes: dark, drinks: 0.08, look: 'dark' }));
    this.add(new HazeLayer(new THREE.Box3(V(-12, 2, -28), V(12, 14, 0)), 6));

    this.wash(V(0, 9, -8), 1, 5, 22);
    this.wash(V(0, 10, -18), 0, 4, 22);
    this.wash(V(-10, 3, -12), 2, 2.2, 10, 0.3);
    this.wash(V(10, 3, -20), 2, 2.2, 10, 0.3);
    // red work light grazing the booth wall, so the niche reads from the floor
    this.wash(V(0, 2.4, -3.4), 2, 2.6, 10, 0.4);
    this.dress();
  }

  /**
   * What's left of the power station: the crane girder and its rails, old
   * pipes with valves and gauges, a bank of control cabinets with a few lamps
   * still lit, a big sliding door, the balcony's brackets and mesh, a spiral
   * stair up to it, trays and a duct overhead, fire doors at the exits.
   */
  private dress(): void {
    const d = new Dresser(84);
    const FY = -STAGE;
    // the travelling crane: rails along both walls, the girder across the hall, its hook block and chains
    for (const s of [-1, 1]) d.box('rust', 0.5, 0.6, 35, s * 12.7, 13.0, -14);
    d.box('rust', 25.4, 0.9, 0.6, 0, 13.75, -20);
    for (const s of [-1, 1]) d.box('rust', 0.9, 0.5, 1.4, s * 12.2, 13.55, -20);
    d.rod('steel', V(-2.2, 13.3, -20), V(-2.2, 10.4, -20), 0.02, 6);
    d.box('yellow', 0.42, 0.6, 0.3, -2.2, 10.1, -20);
    d.put('steel', new THREE.TorusGeometry(0.14, 0.035, 6, 12, Math.PI * 1.4).rotateZ(-0.6).translate(-2.2, 9.65, -20));
    for (const x of [3.6, 6.2]) d.chain(V(x, 13.3, -20), V(x, 13.3 - 2.6 - (x % 2), -20));
    // old pipes on the front wall either side of the niche, valves and gauges on them; more on the back wall
    for (const x of [7.1, 7.7]) {
      d.pipe(V(x, FY, -1.15), V(x, 15, -1.15), x === 7.1 ? 0.16 : 0.1);
      for (let y = 1; y < 15; y += 3) d.box('rust', 0.08, 0.06, 0.25, x, y, -1.02);
    }
    d.pipe(V(7.1, 3.2, -1.15), V(10.4, 3.2, -1.15), 0.12);
    d.valve(V(7.1, 0.7, -1.32), Math.PI);
    d.valve(V(9.2, 3.2, -1.3), Math.PI, 0.14);
    d.gauge(V(7.7, 1.5, -1.26), Math.PI);
    d.gauge(V(8.4, 3.55, -1.06), Math.PI, 0.12);
    for (const x of [-9, -9.6, 9.5]) d.pipe(V(x, FY, -31.8), V(x, 14, -31.8), 0.14);
    d.valve(V(-9.3, 0.4, -31.6), 0);
    d.gauge(V(-9.6, 1.4, -31.62), 0);
    // the control room's old cabinets on the front wall, left of the niche
    d.cabinets(V(-7.4, FY, -1.21), Math.PI, 5);
    // a big steel sliding door in the back wall, its rail over it
    d.box('rust', 5.2, 5.2, 0.12, 5.4, FY + 2.6, -31.92);
    for (let x = 3.0; x <= 7.8; x += 0.6) d.box('rust', 0.06, 5.1, 0.05, x, FY + 2.6, -31.84);
    d.box('steel', 7, 0.18, 0.16, 6, FY + 5.4, -31.88);
    // fire doors under the exit signs, extinguishers on the pillars, a call point
    d.fireDoor(V(-12.97, FY, -29), Math.PI / 2, 1.6, 2.3, false);
    d.fireDoor(V(12.97, FY, -20), -Math.PI / 2, 1.6, 2.3, false);
    d.fireDoor(V(-6, FY, -31.97), 0, 1.6, 2.3, false);
    for (const z of [-13, -21]) for (const x of [-6.5, 6.5]) d.extinguisher(V(x, FY + 0.4, z + 0.655), 0);
    d.callPoint(V(12.95, FY + 1.4, -18.6), -Math.PI / 2);
    // overhead: cable trays down the walls, a square duct on the right, conduit to the light bar
    for (const s of [-1, 1]) d.tray(V(s * 12.6, 8.4, 1), V(s * 12.6, 8.4, -31), 18, 0.4);
    for (let z = 2; z > -31; z -= 1.5) {
      d.box('galv', 1.4, 0.9, 1.5, 10.6, 12, z - 0.75);
      d.box('galv', 1.5, 1.0, 0.06, 10.6, 12, z);
    }
    d.conduit([V(-12.9, FY + 1.2, -12.2), V(-12.9, 9.4, -12.2), V(-12.4, 9.4, -12.4)], 0.02);
    // the balcony: brackets under it, mesh behind the rail, a spiral stair up from the floor at the back
    for (let z = -4; z >= -28; z -= 3) d.rod('steel', V(-12.95, 3.4, z), V(-9.6, 5.3, z), 0.04, 6);
    d.fence(V(-9.05, 5.68, -3), V(-9.05, 5.68, -29), 1.0);
    d.box('blackMetal', 2.6, 0.06, 1.0, -10.7, 5.66, -29.5);
    d.spiralStair(V(-10.6, FY, -30.7), 5.68 - FY, 1.1, Math.PI);
    // the niche behind the DJ: a rack, cases, a panel with conduit
    d.ampRack(V(1.85, 0, 3.3), Math.PI, 6);
    d.roadCase(V(-1.85, 0, 3.4), Math.PI, 1.0, 0.7, 0.6);
    d.roadCase(V(-1.85, 0.7, 3.4), Math.PI + 0.1, 0.8, 0.45, 0.5);
    d.panel(V(0.5, 0, 3.98), Math.PI, 0.5, 0.6, 3.6);
    // the floor: concrete worn by years of it, a few cups and cans
    d.wear(-12.6, 12.6, -31.6, -1.0, FY, 'berghain', 85, 'dark');
    d.litter(-10, 10, -24, -2.4, 80, FY);
    this.add(d.done());
  }
}

export const berghain: VenueDef = {
  id: 'berghain',
  name: 'Berghain',
  place: 'Berlin, Germany',
  kind: 'Techno club · main floor',
  blurb: 'A concrete power station. Dark and hard: white beams and a strobe bank at the peak.',
  palette: ['#e8f0ff', '#4a7dff', '#ff2030'],
  ui: '#aab6cc',
  capacity: '1,500',
  note: 'Door policy: your phone camera just got a sticker over it. No photos on the dance floor.',
  build: () => new Berghain(),
  thumb(g, w, h) {
    g.fillStyle = '#07080b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a1c21';
    for (const x of [0.12, 0.34, 0.66, 0.88]) g.fillRect(w * x - 9, 0, 18, h);
    beams(g, w, h, ['#dfe8ff', '#6a8cff'], 4, 0, 0.25);
    g.fillStyle = 'rgba(255,40,40,0.8)';
    for (const x of [0.12, 0.88]) g.fillRect(w * x - 3, h * 0.45, 6, 8);
    silhouettes(g, w, h, '#020203', 31);
  },
};
