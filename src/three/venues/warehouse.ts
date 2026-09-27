/* Deckhouse Warehouse: the house club — stage, LED wall, truss rig, lasers. */
import * as THREE from 'three';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { Blinders, booth, Co2Jets, Crowd, crowdArea, floor, HazeLayer, Lasers, mirrorBall, MovingHeads, speaker, Strobes, truss } from './fixtures';
import { concreteTexture, floorTexture } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const STAGE = 0.6; // DJ riser height above the dance floor

class Warehouse extends VenueBase {
  readonly views: VenueViews = {
    wide: { pos: V(2.6, 2.3, 3.3), target: V(0, 1.4, -3.2) },
    wideLabel: 'Club',
    crowd: { pos: V(1.4, 2.5, -7.6), target: V(0, 1.1, 0) },
  };
  private ball: THREE.Mesh;

  constructor() {
    super({ fog: 0x03040a, fogDensity: 0.05, hemiSky: 0x6a7ba8, hemiGround: 0x07070a, hemi: 0.45, flashAt: V(0, 4.5, -4) });
    const fl = floorTexture('#0d0e13', 'warehouse');
    fl.repeat.set(10, 10);
    this.group.add(floor(60, new THREE.MeshStandardMaterial({ map: fl, roughness: 0.42, metalness: 0.2, envMapIntensity: 0.2 }), -STAGE));
    // stage riser under the booth
    const conc = concreteTexture(34);
    const stage = new THREE.Mesh(new THREE.BoxGeometry(12, STAGE, 5), new THREE.MeshStandardMaterial({ color: 0x1a1b20, map: conc, roughness: 0.8 }));
    stage.position.set(0, -STAGE / 2, 1.6);
    stage.receiveShadow = true;
    this.group.add(stage);
    const b = booth({ w: 2.8, d: 0.95, strip: '#2ec4f1' });
    this.group.add(b.group);
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
    this.screen(new THREE.Mesh(new THREE.PlaneGeometry(11.2, 6.3))).position.set(0, 3.3, -8);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(11.6, 6.7, 0.25), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.8 }));
    frame.position.set(0, 3.3, -8.14);
    this.group.add(frame);
    for (const s of [-1, 1]) {
      const side = this.screen(new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.7)));
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
    this.add(new MovingHeads(heads, { length: 10, radius: 0.85 }));
    this.add(new Strobes([-4, -1.3, 1.3, 4].map((x) => ({ pos: V(x, 4.35, -1.4), tilt: 0.4 }))));
    this.add(new Blinders([-3.4, -1.7, 1.7, 3.4].map((x) => ({ pos: V(x, 0.28, -1.05), tilt: -0.25 }))));
    this.add(
      new Lasers([
        { pos: V(-2.2, 0.25, -1.2), dir: V(0.15, 0.1, -1), side: -1, beams: 12 },
        { pos: V(2.2, 0.25, -1.2), dir: V(-0.15, 0.1, -1), side: 1, beams: 12, alt: true },
        { pos: V(-4.5, 6.9, -7.8), dir: V(0.2, -0.22, 1), side: -1, beams: 10 },
        { pos: V(4.5, 6.9, -7.8), dir: V(-0.2, -0.22, 1), side: 1, beams: 10, alt: true },
      ]),
    );
    this.add(new Co2Jets([V(-4, 0.05, -1.4), V(-2.6, 0.05, -1.4), V(2.6, 0.05, -1.4), V(4, 0.05, -1.4)]));
    this.ball = mirrorBall(0.35);
    this.ball.position.set(0, 5.4, -4.2);
    this.group.add(this.ball);

    this.add(new Crowd(crowdArea(-6.8, 6.8, -2.3, -7.4, 2.3, 21, { y: -STAGE }), { seed: 5, phones: 0.08, signs: 3 }));
    // guests on the riser beside the booth
    this.add(new Crowd([{ x: -2.5, z: 0.9, face: Math.PI - 0.5 }, { x: -3.1, z: 1.5, face: Math.PI / 2 + 0.3 }, { x: -2.4, z: 1.95, face: Math.PI - 1.2 }, { x: 3.9, z: 1.0, face: Math.PI + 0.6 }, { x: 4.4, z: 1.6, face: -Math.PI / 2 - 0.2 }].map((p) => ({ ...p, role: 'vip' as const })), { seed: 6, clothes: ['#d9d6cf', '#1b1d22', '#5a1e22', '#23262d'] }));
    this.add(new HazeLayer(new THREE.Box3(V(-9, 2, -9), V(9, 5.5, 0.5)), 5));

    this.wash(V(-2.5, 2.4, -2.5), 0, 6, 10);
    this.wash(V(2.5, 2.4, -2.5), 1, 6, 10);
    this.wash(V(0, 3.2, -6), 2, 5, 12);
  }

  update(...args: Parameters<VenueBase['update']>): void {
    super.update(...args);
    this.ball.rotation.y += args[2] * 0.4;
  }
}

export const warehouse: VenueDef = {
  id: 'warehouse',
  name: 'Deckhouse Warehouse',
  place: 'Anywhere',
  kind: 'House club · stage + LED wall',
  blurb: 'The house room: a raised stage, an 11 m LED wall running the visual player, a truss of moving heads, strobes, blinders, lasers and CO2.',
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
