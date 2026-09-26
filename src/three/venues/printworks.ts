/*
 * Printworks, London — the Press Halls of the old newspaper print plant: a
 * vast industrial hall with three levels of steel gantries, a stage at one
 * end and the famous overhead lighting rig — a grid of truss, light bars and
 * beam fixtures that lowers over the crowd through the build-up and slams
 * down on the drop. Lasers, blinders and CO2 from the stage front, and the
 * visual player on a screen across the far wall.
 */
import * as THREE from 'three';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { Blinders, block, booth, Co2Jets, Crowd, crowdArea, HazeLayer, Lasers, LedStrings, lineArray, MovingHeads, speaker, Strobes, truss } from './fixtures';
import type { ShowState } from './show';
import { concreteTexture, floorTexture } from './tex';
import { laserLines, silhouettes } from './warehouse';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const STAGE = 1.5;
const RIG_UP = 13.5;
const RIG_DOWN = 6.8;
const RIG_ROWS = [-8, -13, -18, -23, -28, -33];
const BARS = 14;

class Printworks extends VenueBase {
  readonly views: VenueViews = {
    wide: { pos: V(-10.3, 10.4, -4.6), target: V(1.5, 3.5, -30) },
    wideLabel: 'Gantry',
    crowd: { pos: V(3.6, 2.4, -17.5), target: V(0, 2.2, 0) },
  };
  private rig = new THREE.Group();
  private bars: THREE.InstancedMesh;
  private descend = 0;
  private cables: THREE.LineSegments;
  private c = new THREE.Color();

  constructor() {
    super({ fog: 0x05060a, fogDensity: 0.021, hemiSky: 0x3a4250, hemiGround: 0x060608, hemi: 0.4, flashAt: V(0, 12, -20), flashRange: 60 });
    this.keyLight = { color: 0xeaf3ff, intensity: 13 };
    const wall = new THREE.MeshStandardMaterial({ color: 0x3a3634, map: concreteTexture(52), roughness: 0.92 });
    const ft = floorTexture('#121315', 'printworks');
    ft.repeat.set(10, 18);
    const fl = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55, metalness: 0.15 });
    const ceil = new THREE.MeshStandardMaterial({ color: 0x131417, roughness: 0.95 });
    const room = block(34, 22, 68, [wall, wall, ceil, fl, wall, wall], 6);
    (room.material as THREE.Material[]).forEach((m) => (m.side = THREE.BackSide));
    room.position.set(0, 9.5, -30);
    this.group.add(room);

    // steel columns and three levels of gantries down both sides
    const steel = new THREE.MeshStandardMaterial({ color: 0x2c2e33, metalness: 0.8, roughness: 0.45 });
    const cols = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 22, 0.5), steel, 16);
    let ci = 0;
    for (let z = -4; z >= -60; z -= 8) for (const x of [-9.6, 9.6]) cols.setMatrixAt(ci++, new THREE.Matrix4().makeTranslation(x, 9.5, z));
    cols.count = ci;
    this.group.add(cols);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1.05, 0.05), steel, 6 * 29);
    let pi = 0;
    const gantryLeds = new LedStrings({ size: 0.06, spacing: 0.5 });
    for (const y of [4.5, 8.5, 12.5]) {
      for (const s of [-1, 1]) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.25, 56), steel);
        slab.position.set(s * 12.9, y, -31);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 56), steel);
        rail.position.set(s * 10.1, y + 1.1, -31);
        this.group.add(slab, rail);
        for (let i = 0; i < 29; i++) posts.setMatrixAt(pi++, new THREE.Matrix4().makeTranslation(s * 10.1, y + 0.6, -3 - i * 2));
        gantryLeds.line(V(s * 10.12, y - 0.14, -3), V(s * 10.12, y - 0.14, -59));
      }
    }
    this.group.add(posts);
    this.add(gantryLeds.done());

    // the stage
    const stage = block(18, STAGE, 5.6, new THREE.MeshStandardMaterial({ color: 0x0c0c0f, roughness: 0.7 }), 3);
    stage.position.set(0, -STAGE / 2, 1.4);
    this.group.add(stage);
    const b = booth({ w: 3.6, d: 1.0, strip: '#27e1ff' });
    this.group.add(b.group);
    this.strip(b.strip);
    const lip = new LedStrings({ size: 0.05, spacing: 0.12 });
    lip.line(V(-9, -0.05, -1.42), V(9, -0.05, -1.42));
    this.add(lip.done());
    for (const s of [-1, 1]) {
      const pa = lineArray(8, 1.0, 0.36, 0.7);
      pa.position.set(s * 8.4, 12.5, -1.6);
      pa.rotation.y = Math.PI + s * 0.12;
      this.group.add(pa);
      for (let i = 0; i < 3; i++) {
        const sub = speaker(1.3, 1.1, 1.0, 'sub');
        sub.position.set(s * (2.4 + i * 1.5), -STAGE + 0.55, -2.1);
        sub.rotation.y = Math.PI;
        this.group.add(sub);
      }
    }

    // far wall screen for the visual player
    this.screen(new THREE.Mesh(new THREE.PlaneGeometry(22, 12.4))).position.set(0, 8, -63.7);

    // the rig: truss grid with light bars, beam fixtures and strobes
    for (const z of RIG_ROWS) this.rig.add(truss(V(-8.6, 0, z), V(8.6, 0, z), 0.4));
    for (const x of [-8.6, 8.6]) this.rig.add(truss(V(x, 0, RIG_ROWS[0]), V(x, 0, RIG_ROWS[RIG_ROWS.length - 1]), 0.4));
    this.bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 0.08, 0.14), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), RIG_ROWS.length * BARS);
    RIG_ROWS.forEach((z, r) => {
      for (let i = 0; i < BARS; i++) {
        const k = r * BARS + i;
        this.bars.setMatrixAt(k, new THREE.Matrix4().makeTranslation(-7.8 + (i * 15.6) / (BARS - 1), -0.27, z));
        this.bars.setColorAt(k, this.c.setRGB(0.05, 0.05, 0.05));
      }
    });
    this.rig.add(this.bars);
    const heads = new MovingHeads(
      RIG_ROWS.flatMap((z) => [-6, -2, 2, 6].map((x) => ({ pos: V(x, -0.5, z) }))),
      { length: 11, radius: 0.75, gain: 1.1 },
    );
    this.fixtures.push(heads);
    this.rig.add(heads.object);
    const rigStrobes = new Strobes(RIG_ROWS.flatMap((z) => [-4.4, 4.4].map((x) => ({ pos: V(x, -0.3, z), tilt: Math.PI / 2 }))), [0.6, 0.18, 0.1]);
    this.fixtures.push(rigStrobes);
    this.rig.add(rigStrobes.object);
    this.rig.position.y = RIG_UP;
    this.group.add(this.rig);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3));
    this.cables = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x3a3c42 }));
    this.cables.frustumCulled = false;
    this.group.add(this.cables);

    // stage front: lasers, blinders, CO2
    this.add(
      new Lasers([
        { pos: V(-6.5, 0.3, -1.45), dir: V(0.12, 0.09, -1), side: -1, beams: 14, color: '#27e1ff', length: 50 },
        { pos: V(-3.3, 0.3, -1.45), dir: V(0.05, 0.1, -1), side: -1, beams: 12, color: '#3dff7a', length: 50, alt: true },
        { pos: V(3.3, 0.3, -1.45), dir: V(-0.05, 0.1, -1), side: 1, beams: 12, color: '#3dff7a', length: 50, alt: true },
        { pos: V(6.5, 0.3, -1.45), dir: V(-0.12, 0.09, -1), side: 1, beams: 14, color: '#27e1ff', length: 50 },
        { pos: V(-12, 13.6, -60.5), dir: V(0.2, -0.1, 1), side: -1, beams: 12, color: '#3dff7a', length: 55 },
        { pos: V(12, 13.6, -60.5), dir: V(-0.2, -0.1, 1), side: 1, beams: 12, color: '#3dff7a', length: 55 },
      ]),
    );
    this.add(new Blinders([-7, -5, -3, -1, 1, 3, 5, 7].map((x) => ({ pos: V(x, -0.55, -1.52), tilt: -0.2 }))));
    this.add(new Co2Jets([-7.4, -4.8, -2.2, 2.2, 4.8, 7.4].map((x) => V(x, 0.02, -1.55)), 13));

    // the crowd, on the floor and along the first gantries
    const crowd = this.add(
      new Crowd(
        [
          ...crowdArea(-9.1, 9.1, -2.6, -42, 0.8, 91, { y: -STAGE }),
          ...crowdArea(10.4, 15.3, -5, -52, 0.42, 92, { y: 4.63, face: -Math.PI / 2 }),
          ...crowdArea(-15.3, -10.4, -5, -52, 0.42, 93, { y: 4.63, face: Math.PI / 2 }),
        ],
        { seed: 90, phones: 0.05 },
      ),
    );
    crowd.extras.forEach((e) => this.group.add(e));
    this.add(new HazeLayer(new THREE.Box3(V(-12, 2, -45), V(12, 16, -2)), 6));

    this.wash(V(0, 10, -10), 0, 7, 25);
    this.wash(V(0, 10, -26), 1, 7, 25);
    this.wash(V(-5, 7, -18), 2, 4, 16, 0.6);
    this.wash(V(5, 7, -32), 2, 4, 16, 0.6);
  }

  update(...args: Parameters<VenueBase['update']>): void {
    const [s, , dt] = args;
    // the rig drops through the build and slams down on the drop
    const want = s.playing ? Math.min(1, s.build * 0.85 + s.peak) : 0;
    const rate = want > this.descend ? (s.peak > 0.5 ? 4 : 0.35) : 0.25;
    this.descend += (want - this.descend) * Math.min(1, dt * rate);
    this.rig.position.y = RIG_UP - (RIG_UP - RIG_DOWN) * this.descend;
    this.rig.rotation.x = Math.sin(s.t * 0.3) * 0.035 * s.peak;
    this.rig.updateMatrixWorld();
    super.update(...args);
    this.updateBars(s);
    const p = this.cables.geometry.attributes.position as THREE.BufferAttribute;
    let k = 0;
    for (const x of [-8.6, 8.6]) {
      for (const z of [RIG_ROWS[0], RIG_ROWS[RIG_ROWS.length - 1]]) {
        p.setXYZ(k++, x, this.rig.position.y, z);
        p.setXYZ(k++, x, 20.4, z);
      }
    }
    p.needsUpdate = true;
  }

  private updateBars(s: ShowState): void {
    const mode = s.peak > 0.5 ? 2 : s.build > 0.35 ? 1 : 0;
    const m = s.master * Math.min(1.3, s.intensity);
    RIG_ROWS.forEach((_, r) => {
      for (let i = 0; i < BARS; i++) {
        let v: number;
        if (mode === 2) v = (Math.floor(s.beat * 2) + r + i) % 2 ? 1 : 0.06;
        else if (mode === 1) v = r / (RIG_ROWS.length - 1) <= s.build ? 0.45 + 0.55 * (Math.sin(s.t * (8 + s.build * 30)) > 0 ? 1 : 0) : 0.04;
        else v = 0.08 + 0.9 * Math.pow(0.5 + 0.5 * Math.cos(((i / (BARS - 1)) * 2 - s.beat * 0.5 + r * 0.2) * Math.PI * 2), 6);
        v *= s.playing ? 1 : 0.4;
        this.c.copy(s.colors[r % 2]).multiplyScalar(v * 3.2 * m + s.kick * 0.4 * m);
        this.bars.setColorAt(r * BARS + i, this.c);
      }
    });
    this.bars.instanceColor!.needsUpdate = true;
  }
}

export const printworks: VenueDef = {
  id: 'printworks',
  name: 'Printworks',
  place: 'London, UK',
  kind: 'Warehouse · Press Halls',
  blurb: 'The old print plant: a colossal hall with three levels of steel gantries, a far-wall screen, and the overhead rig of light bars and beams that lowers over the crowd through the build-up and slams down on the drop. Lasers, blinders and CO2 across the stage.',
  palette: ['#ffffff', '#27e1ff', '#ffb000'],
  ui: '#27e1ff',
  capacity: '5,000',
  build: () => new Printworks(),
  thumb(g, w, h) {
    g.fillStyle = '#06070a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a2d33';
    g.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const y = h * (0.25 + i * 0.16);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w * 0.18, y + 8);
      g.moveTo(w, y);
      g.lineTo(w * 0.82, y + 8);
      g.stroke();
    }
    for (let r = 0; r < 4; r++) {
      const y = h * (0.12 + r * 0.06);
      const x0 = w * (0.2 - r * 0.03);
      const x1 = w * (0.8 + r * 0.03);
      for (let i = 0; i < 10; i++) {
        g.fillStyle = (i + r) % 2 ? '#ffffff' : '#27e1ff';
        g.shadowColor = g.fillStyle;
        g.shadowBlur = 8;
        g.fillRect(x0 + ((x1 - x0) * i) / 9 - 6, y, 12, 3);
      }
    }
    g.shadowBlur = 0;
    laserLines(g, w * 0.3, h * 0.85, '#27e1ff', 9, 1.4, h, -Math.PI / 2 - 0.2);
    laserLines(g, w * 0.7, h * 0.85, '#3dff7a', 9, 1.4, h, -Math.PI / 2 + 0.2);
    silhouettes(g, w, h, '#030305', 41);
  },
};
