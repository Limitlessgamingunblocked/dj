/*
 * Deckhouse Warehouse (free play, id 'deckhouse'; the career's Warehouse Rave
 * is rave.ts): the house club — stage, LED wall, truss rig, lasers —
 * modelled on big warehouse rooms like Depot Mayfield (docs/venue-research.md):
 * steel pillars down both sides carrying pairs of LED battens, a polished
 * concrete floor, a bar along one wall and exit signs, so the room has edges.
 */
import * as THREE from 'three';
import type { FloorReflect } from '../reflect';
import { nameStyleFor } from '../../name/venueStyles';
import { Confetti } from './confetti';
import { MirrorBallSpots } from './mirrorball';
import { Pyro } from './pyro';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { barCounter, boothClutter, DustMotes, exitSign, PillarBars } from './details';
import { Dresser } from './dress';
import { atBar } from './crew';
import { Blinders, booth, Co2Jets, Crowd, crowdArea, floor, HazeLayer, mirrorBall, MovingHeads, speaker, Strobes, TABLE_Y, truss } from './fixtures';
import { Lasers, laserStands } from './lasers';
import { KineticRig } from './showfx';
import { concreteTexture, floorTexture, withSurface } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const STAGE = 0.6; // DJ riser height above the dance floor

class Warehouse extends VenueBase {
  // polished concrete: the LED wall and the beams skid across it
  readonly reflect: FloorReflect[] = [
    { y: -STAGE, strength: 0.6, rough: 0.35 },
    // the stage deck: the LED wall in its gloss
    { y: 0, strength: 0.4, rough: 0.45 },
  ];
  readonly views: VenueViews = {
    wide: { pos: V(2.6, 2.3, 3.3), target: V(0, 1.4, -3.2) },
    wideLabel: 'Club',
    director: {
      style: 'stream',
    },
    crowd: { pos: V(1.4, 2.5, -7.6), target: V(0, 1.1, 0) },
    drone: [V(0, 3.2, 3.6), V(0.3, 2.4, 1.2), V(0.6, 1.95, -2.2), V(1.8, 2.1, -5.5), V(4.6, 2.9, -7.6), V(6.2, 2.3, -4.2), V(5.5, 1.5, -1.6), V(2.6, 1.6, -1.6), V(-1.2, 1.6, -1.0), V(-4.2, 1.8, -1.9), V(-6.2, 2.6, -5.5), V(-3.6, 3.6, -8.0), V(-1.5, 4.4, -3.0), V(-2.5, 3.8, 2.8)],
  };

  constructor() {
    super({ fog: 0x03040a, fogDensity: 0.05, hemiSky: 0x6a7ba8, hemiGround: 0x07070a, hemi: 0.36, flashAt: V(0, 4.5, -4) });
    this.grade = { tint: 0xf8f6ff, contrast: 1.12, saturation: 1.12, lift: 0 };
    this.toneMapping = 'agx';
    const fl = floorTexture('#0d0e13', 'warehouse');
    fl.repeat.set(10, 10);
    // polished concrete: the wash lights and beams skid across it
    this.group.add(floor(60, withSurface(new THREE.MeshStandardMaterial({ map: fl, metalness: 0.2, envMapIntensity: 0.2 }), 'wh-floor', { bumps: 0.3, grain: 0.4, seams: 128, rough: 0.36, roughVar: 0.12, polish: 0.3, repeat: 10, normalScale: 0.4 }), -STAGE));
    // the room itself: block walls and a dark ceiling (no more void past the crowd)
    const wallMat = withSurface(new THREE.MeshStandardMaterial({ color: 0x24262c, map: concreteTexture(44) }), 'wh-wall', { bumps: 0.5, grain: 0.6, seams: 32, rough: 0.9, roughVar: 0.06, repeat: 4 });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.95 });
    const room = new THREE.Mesh(new THREE.BoxGeometry(19, 7, 14), [wallMat, wallMat, ceilMat, hidden, wallMat, wallMat]);
    (room.material as THREE.Material[]).forEach((m) => (m.side = THREE.BackSide));
    room.position.set(0, -STAGE + 3.5, -2.5);
    room.receiveShadow = true;
    this.group.add(room);
    // steel pillars down both sides of the floor, each with a pair of LED battens
    this.add(new PillarBars([-2.8, -5.4, -8.0].flatMap((z) => [V(-7.7, 0, z), V(7.7, 0, z)]), -STAGE, 6.4));
    // a bar along the left wall, exits at the back
    const bar = barCounter(5, { glow: '#7ac8ff', body: 0x111318, top: 0x23262c, seed: 21 });
    bar.position.set(-8.2, -STAGE, -5.4);
    bar.rotation.y = Math.PI / 2;
    this.group.add(bar);
    this.add(atBar(bar, 5, 26, { staff: 2, leaners: 2 }));
    this.group.add(exitSign(V(-9.46, -STAGE + 2.4, -8.6), Math.PI / 2), exitSign(V(9.46, -STAGE + 2.4, -8.6), -Math.PI / 2), exitSign(V(9.46, -STAGE + 2.4, -1.4), -Math.PI / 2));
    // stage riser under the booth
    const conc = concreteTexture(34);
    const stage = new THREE.Mesh(new THREE.BoxGeometry(12, STAGE, 5), new THREE.MeshStandardMaterial({ color: 0x1a1b20, map: conc, roughness: 0.8 }));
    stage.position.set(0, -STAGE / 2, 1.6);
    stage.receiveShadow = true;
    this.group.add(stage);
    const b = booth({ w: 2.8, d: 0.95, strip: '#2ec4f1', name: nameStyleFor('deckhouse').booth });
    this.group.add(b.group);
    boothClutter(this.group, 2.8, TABLE_Y, -0.475, 22);
    this.add(new DustMotes(new THREE.Box3(V(-2.6, TABLE_Y - 0.3, -2.4), V(2.6, TABLE_Y + 2.6, 1.6)), 320, 23));
    this.strip(b.strip);
    for (const s of [-1, 1]) {
      const mon = speaker(0.34, 0.52, 0.34, 'monitor');
      mon.position.set(s * 1.36, 0.9 + 0.26, -0.32);
      mon.rotation.y = Math.PI + s * 0.35;
      this.group.add(mon);
      const stack = speaker(1.1, 1.3, 0.9, 'sub');
      stack.position.set(s * 4.6, -STAGE + 0.65, -1.2);
      this.group.add(stack);
      const top = speaker(1.1, 0.9, 0.8, 'mid');
      top.position.set(s * 4.6, -STAGE + 1.75, -1.2);
      this.group.add(top);
    }

    // LED wall + side screens (visual player)
    const main = this.screen(new THREE.Mesh(new THREE.PlaneGeometry(11.2, 6.3)), { size: [11.2, 6.3], pitch: 0.0039 });
    main.position.set(0, 3.3, -8);
    this.nameScreen(main, 11.2, 6.3, nameStyleFor('deckhouse').screen!);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(11.6, 6.7, 0.25), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.8 }));
    frame.position.set(0, 3.3, -8.14);
    this.group.add(frame);
    for (const s of [-1, 1]) {
      const side = this.screen(new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.7)), { size: [4.8, 2.7], pitch: 0.0039 });
      side.position.set(s * 8.2, 3.1, -5.2);
      side.rotation.y = -s * 0.75;
    }

    // truss with moving heads, strobes
    const heads = [];
    for (const z of [-1.4, -5.4]) {
      this.group.add(truss(V(-6.5, 4.6, z), V(6.5, 4.6, z)));
      for (const x of [-6.5, 6.5]) this.group.add(truss(V(x, -STAGE, z), V(x, 4.75, z)));
      for (const x of [-5, -2.5, 0, 2.5, 5]) heads.push({ pos: V(x, 4.3, z) });
    }
    this.add(new MovingHeads(heads, { length: 10, radius: 0.85, floorY: -STAGE }));
    // a small kinetic grid behind the truss: LED spheres on winches, under the low ceiling
    this.add(new KineticRig({ x0: -6, x1: 6, z0: -8.8, z1: -6.8, nx: 9, nz: 2, top: 6.3, low: 3.9, high: 6.0 }));
    this.add(new Strobes([-4, -1.3, 1.3, 4].map((x) => ({ pos: V(x, 4.35, -1.4), tilt: 0.4 }))));
    this.add(new Blinders([-3.4, -1.7, 1.7, 3.4].map((x) => ({ pos: V(x, 0.28, -1.05), tilt: -0.25 }))));
    this.group.add(laserStands([V(-4.6, 2.55, -1.3), V(4.6, 2.55, -1.3)], 0));
    this.add(
      new Lasers(
        [
          { pos: V(-4.6, 2.55, -1.3), dir: V(0.25, 0.02, -1), side: -1, beams: 12 },
          { pos: V(4.6, 2.55, -1.3), dir: V(-0.25, 0.02, -1), side: 1, beams: 12, alt: true },
          { pos: V(-4.5, 6.0, -7.8), dir: V(0.2, -0.1, 1), side: -1, beams: 10 },
          { pos: V(4.5, 6.0, -7.8), dir: V(-0.2, -0.1, 1), side: 1, beams: 10, alt: true },
        ],
        {
          room: { floorY: -STAGE, x0: -9.5, x1: 9.5, z0: -9.5, z1: 4.5, ceilY: 6.4 },
          audience: { floorY: -STAGE, x0: -9.4, x1: 9.4, z0: -9.4, z1: -2.2 },
          focus: V(0, 3.6, -6),
          haze: [0, 6.4],
        },
      ),
    );
    this.add(new Co2Jets([V(-4, 0.05, -1.4), V(-2.6, 0.05, -1.4), V(2.6, 0.05, -1.4), V(4, 0.05, -1.4)]));
    this.add(new Confetti([-1, 1].map((s) => ({ pos: V(s * 3.3, 0.05, -1.25), dir: V(s * 0.12, 0.72, -0.7) })), { floorY: -STAGE, speed: 8 }));
    this.add(
      new Pyro(
        [
          ...[-3.3, 3.3].map((x) => ({ pos: V(x, 0, -0.55), kind: 'flame' as const })),
          ...[-1.9, 1.9].map((x) => ({ pos: V(x, 0, -0.7), kind: 'spark' as const })),
        ],
        { height: 2.9 },
      ),
    );
    // the DJ name in neon over the bar
    this.nameSign(nameStyleFor('deckhouse').sign!, 3.0, 0.85, V(-9.44, 3.25, -5.4), Math.PI / 2);
    const ball = mirrorBall(0.35);
    ball.position.set(0, 5.4, -4.2);
    this.group.add(ball);
    // (it turns with its spots)
    this.add(new MirrorBallSpots([{ mesh: ball, spots: 240 }], { floorY: -STAGE, x0: -9.5, x1: 9.5, z0: -9.5, z1: 4.5, ceilY: 6.4 }));

    this.add(new Crowd(crowdArea(-6.8, 6.8, -2.3, -7.4, 2.3, 21, { y: -STAGE }), { seed: 5, phones: 0.08, signs: 3 }));
    // guests on the riser beside the booth
    this.add(new Crowd([{ x: -2.5, z: 0.9, face: Math.PI - 0.5 }, { x: -3.1, z: 1.5, face: Math.PI / 2 + 0.3 }, { x: -2.4, z: 1.95, face: Math.PI - 1.2 }, { x: 3.9, z: 1.0, face: Math.PI + 0.6 }, { x: 4.4, z: 1.6, face: -Math.PI / 2 - 0.2 }].map((p) => ({ ...p, role: 'vip' as const })), { seed: 6, clothes: ['#d9d6cf', '#1b1d22', '#5a1e22', '#23262d'] }));
    this.add(new HazeLayer(new THREE.Box3(V(-9, 2, -9), V(9, 5.5, 0.5)), 5));

    this.wash(V(-2.5, 2.4, -2.5), 0, 6, 10);
    this.wash(V(2.5, 2.4, -2.5), 1, 6, 10);
    this.wash(V(0, 3.2, -6), 2, 5, 12);
    this.dress();
  }

  /** the room's working parts: a star-cloth drape behind the stage, ducts and trays overhead, fire doors, the bar's stools, ledges and tables, the stage's cases, the floor */
  private dress(): void {
    const d = new Dresser(24);
    const FY = -STAGE;
    // behind the stage: a pleated black drape with a star cloth twinkling in it
    const drape = new THREE.PlaneGeometry(13, 5.6, 64, 1);
    const p = drape.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 9) * 0.06);
    d.put('cloth', drape.rotateY(Math.PI).translate(0, 2.8, 4.38));
    for (let i = 0; i < 70; i++) d.put(d.glow('#f4f0ff', 'blink', 1.8), new THREE.SphereGeometry(0.018, 6, 4).translate(-6.2 + d.r() * 12.4, 0.4 + d.r() * 5.2, 4.3));
    // overhead: ducts down the room, a sprinkler main, cable trays on the side walls
    for (const s of [-1, 1]) d.duct(V(s * 3.8, 5.9, 4.2), V(s * 3.8, 5.9, -7.0), 0.3, 6.4);
    d.sprinkler(V(1.3, 6.25, 4.3), V(1.3, 6.25, -9.3), 6.4);
    for (const s of [-1, 1]) d.tray(V(s * 9.25, 5.0, 4.2), V(s * 9.25, 5.0, -9.2), 6.4, 0.35);
    // fire doors under the exit signs, extinguishers and a call point by them
    d.fireDoor(V(-9.47, FY, -8.6), Math.PI / 2, 1.4, 2.1, false);
    d.fireDoor(V(9.47, FY, -8.6), -Math.PI / 2, 1.4, 2.1, false);
    d.fireDoor(V(9.47, FY, -1.4), -Math.PI / 2, 1.4, 2.1, false);
    d.extinguisher(V(-9.45, FY + 0.4, -7.4), Math.PI / 2);
    d.extinguisher(V(9.45, FY + 0.4, -2.7), -Math.PI / 2);
    d.callPoint(V(9.45, FY + 1.4, -7.3), -Math.PI / 2);
    // the bar's stools, a drink ledge and tables down the right-hand side, flyers by the door
    for (let i = 0; i < 5; i++) d.stool(V(-7.25, FY, -7.4 + i * 1.0));
    d.ledge(V(9.5, FY, -7.6), V(9.5, FY, -2.4));
    d.table(V(8.6, FY, -4.1));
    d.table(V(8.6, FY, -6.7));
    d.posters(V(9.47, FY + 1.6, -0.1), -Math.PI / 2, 1.6, 1.1, 10);
    // the stage: a lit edge, cases at the back corners, a hazer, steps up the side, cable to the stacks
    d.put(d.glow('#ffffff', 'palette', 1.4, 0), new THREE.BoxGeometry(12, 0.025, 0.02).translate(0, -0.03, -0.91));
    for (const s of [-1, 1]) {
      d.roadCase(V(s * 5.2, 0, 3.6), 0.1 * s, 1.0, 0.7, 0.6);
      d.roadCase(V(s * 5.2, 0.7, 3.6), -0.05 * s, 0.8, 0.5, 0.55);
      d.tube('rubber', [V(s * 1.6, 0.012, 0.4), V(s * 3.4, 0.012, 0.2), V(s * 4.6, 0.012, -0.5), V(s * 4.6, -0.3, -0.92)], 0.012, 4);
    }
    d.ampRack(V(-3.4, 0, 3.7), Math.PI, 6);
    d.hazer(V(3.0, 0, 3.9), Math.PI);
    d.steps(V(6 + 3 * 0.28, FY, 3.2), -Math.PI / 2, 3, 1.0, STAGE / 3, 0.28);
    // the floor: polished concrete with a night's wear on it, cups and cans
    d.wear(-9.2, 9.2, -9.2, -1.0, FY, 'deckhouse', 25, 'dark');
    d.litter(-7, 7, -7.6, -2.3, 70, FY);
    this.add(d.done());
  }
}

export const warehouse: VenueDef = {
  id: 'deckhouse',
  name: 'Deckhouse Warehouse',
  short: 'Warehouse',
  place: 'Anywhere',
  kind: 'House club · stage + LED wall',
  blurb: 'The house room: a raised stage, an 11 m LED wall and the full rig.',
  palette: ['#2ec4f1', '#ff5fcf', '#7b5cff'],
  ui: '#2ec4f1',
  capacity: '600',
  build: () => new Warehouse(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#05070d');
    grad.addColorStop(1, '#0b0f1a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const wall = g.createLinearGradient(w * 0.2, 0, w * 0.8, 0);
    wall.addColorStop(0, '#2ec4f1');
    wall.addColorStop(0.5, '#7b5cff');
    wall.addColorStop(1, '#ff5fcf');
    g.globalAlpha = 0.85;
    g.fillStyle = wall;
    g.fillRect(w * 0.22, h * 0.14, w * 0.56, h * 0.36);
    g.globalAlpha = 1;
    beams(g, w, h, ['#2ec4f1', '#ff5fcf'], 5, h * 0.08);
    silhouettes(g, w, h, '#020306', 7);
  },
};

/* thumbnail helpers shared by the venue illustrations */
export function beams(g: CanvasRenderingContext2D, w: number, h: number, colors: string[], n: number, y: number, spread = 0.5): void {
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x = w * (0.15 + (0.7 * i) / Math.max(1, n - 1));
    const a = (i / Math.max(1, n - 1) - 0.5) * spread;
    const grad = g.createLinearGradient(x, y, x + Math.sin(a) * h, y + h);
    grad.addColorStop(0, colors[i % colors.length]);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.globalAlpha = 0.5;
    g.beginPath();
    g.moveTo(x - 2, y);
    g.lineTo(x + 2, y);
    g.lineTo(x + Math.sin(a) * h + 22, y + h);
    g.lineTo(x + Math.sin(a) * h - 22, y + h);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

export function laserLines(g: CanvasRenderingContext2D, x: number, y: number, color: string, n: number, spread: number, len: number, dir = -Math.PI / 2): void {
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 6;
  g.lineWidth = 1.2;
  for (let i = 0; i < n; i++) {
    const a = dir + (i / Math.max(1, n - 1) - 0.5) * spread;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  g.shadowBlur = 0;
  g.globalCompositeOperation = 'source-over';
}

export function silhouettes(g: CanvasRenderingContext2D, w: number, h: number, color: string, seed: number): void {
  let a = seed;
  const r = () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  g.fillStyle = color;
  for (let row = 0; row < 3; row++) {
    const base = h * (0.8 + row * 0.08);
    for (let x = -10; x < w + 10; x += 14 + r() * 8) {
      const hh = h * (0.1 + r() * 0.05);
      g.beginPath();
      g.ellipse(x, base - hh, 6 + r() * 2, 7 + r() * 2, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.roundRect(x - 11, base - hh + 6, 22, h, 8);
      g.fill();
      if (r() > 0.75) {
        g.fillRect(x + 7, base - hh - 22, 4, 26);
      }
    }
  }
}
