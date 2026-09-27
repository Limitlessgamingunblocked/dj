/*
 * Berghain, Berlin — the main floor of the old power station: a cathedral of
 * raw concrete, huge pillars, a steel balcony, towering speaker stacks, and a
 * lighting rig that stays dark and hard — cold white beams, red work lamps and
 * a strobe bank that detonates at the peak.
 */
import * as THREE from 'three';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { block, booth, Crowd, crowdArea, HazeLayer, Lasers, MovingHeads, speaker, Strobes } from './fixtures';
import { concreteTexture, floorTexture } from './tex';
import { beams, silhouettes } from './warehouse';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const STAGE = 1.0;

class Berghain extends VenueBase {
  readonly views: VenueViews = {
    wide: { pos: V(-9.2, 7.4, -11), target: V(0, 0.6, -1.5) },
    wideLabel: 'Balcony',
    crowd: { pos: V(2.8, 2.3, -13.5), target: V(0, 1.6, 0) },
  };

  constructor() {
    super({ fog: 0x040509, fogDensity: 0.034, hemiSky: 0x2a3140, hemiGround: 0x050507, hemi: 0.3, flashAt: V(0, 9, -10), flashRange: 45 });
    this.keyLight = { color: 0xdfe8ff, intensity: 11 };
    const conc = new THREE.MeshStandardMaterial({ color: 0x5b5d62, map: concreteTexture(70), roughness: 0.93 });
    const ft = floorTexture('#101012', 'berghain');
    ft.repeat.set(8, 8);
    const fl = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.6, metalness: 0.15 });
    const ceil = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, map: concreteTexture(40), roughness: 0.95 });
    const room = block(26, 19, 36, [conc, conc, ceil, fl, conc, conc], 5);
    (room.material as THREE.Material[]).forEach((m) => (m.side = THREE.BackSide));
    room.position.set(0, 8.5, -14);
    this.group.add(room);
    const concS = new THREE.MeshStandardMaterial({ color: 0x4a4c51, map: concreteTexture(70), roughness: 0.93 });
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

    // the booth on a concrete riser
    const riser = block(9, STAGE, 4, concS, 3);
    riser.position.set(0, -STAGE / 2, 1.2);
    this.group.add(riser);
    const b = booth({ w: 3.2, d: 1.0, front: concS, top: 0x2a2b2e, strip: null });
    this.group.add(b.group);
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.05, 0.05), steel);
    barrier.position.set(0, 0.2, -0.95);
    this.group.add(barrier);

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
    stack(-4.5, -2.3, Math.PI);
    stack(4.5, -2.3, Math.PI);
    stack(-11.6, -15, Math.PI / 2);
    stack(11.6, -15, -Math.PI / 2);

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
        { length: 15, radius: 0.95, gain: 1.15 },
      ),
    );
    this.add(new Strobes([-8, -4.8, -1.6, 1.6, 4.8, 8].flatMap((x) => [V(x, 11.5, -8), V(x, 11.5, -18)]).map((p) => ({ pos: p, tilt: Math.PI / 2 })), [0.7, 0.2, 0.1]));
    this.add(
      new Lasers([
        { pos: V(-2.8, 0.25, -1.3), dir: V(0.1, 0.12, -1), side: -1, beams: 10, color: '#cfe0ff', length: 30 },
        { pos: V(2.8, 0.25, -1.3), dir: V(-0.1, 0.12, -1), side: 1, beams: 10, color: '#cfe0ff', length: 30 },
      ]),
    );

    const avoid = [-5, -13, -21].flatMap((z) => [-6.5, 6.5].map((x) => new THREE.Box2(new THREE.Vector2(x - 0.9, z - 0.9), new THREE.Vector2(x + 0.9, z + 0.9))));
    avoid.push(new THREE.Box2(new THREE.Vector2(-5.4, -3.2), new THREE.Vector2(-3.6, -1.4)), new THREE.Box2(new THREE.Vector2(3.6, -3.2), new THREE.Vector2(5.4, -1.4)));
    const dark = ['#0b0b0d', '#141417', '#1c1c20', '#0f1012', '#2a2a2e', '#18181b'];
    // no phones and no signs: cameras get stickered at the door
    this.add(new Crowd([...crowdArea(-10.5, 10.5, -2.2, -24, 1.25, 81, { y: -STAGE, avoid }), ...crowdArea(-12.6, -9.6, -5, -27, 1.1, 82, { y: 5.68 })], { seed: 80, clothes: dark, drinks: 0.08 }));
    this.add(new Crowd([{ x: -2.7, z: 0.9, face: Math.PI - 0.5 }, { x: -3.4, z: 1.6, face: Math.PI / 2 + 0.4 }, { x: 2.8, z: 1.0, face: Math.PI + 0.5 }, { x: 3.5, z: 1.8, face: -Math.PI / 2 - 0.3 }].map((p) => ({ ...p, role: 'vip' as const })), { seed: 83, clothes: dark, phones: 0 }));
    this.add(new HazeLayer(new THREE.Box3(V(-12, 2, -28), V(12, 14, 0)), 6));

    this.wash(V(0, 9, -8), 1, 5, 22);
    this.wash(V(0, 10, -18), 0, 4, 22);
    this.wash(V(-10, 3, -12), 2, 2.2, 10, 0.3);
    this.wash(V(10, 3, -20), 2, 2.2, 10, 0.3);
  }
}

export const berghain: VenueDef = {
  id: 'berghain',
  name: 'Berghain',
  place: 'Berlin, Germany',
  kind: 'Techno club · main floor',
  blurb: 'The old power station: an 18 m concrete hall, huge pillars, a steel balcony and towering stacks. Dark and hard — cold white beams, red work lamps, and a strobe bank that goes off at the peak.',
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
