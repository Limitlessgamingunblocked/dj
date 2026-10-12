/*
 * The UV Blacklight Room: the white light off, UV tubes on, so everything
 * glows. White clothes go blue-violet, bright colours fluoresce (you too:
 * the avatar's blacklight look), and glow paint splats onto the black walls
 * and floor on the beat, building up through the night.
 *
 *   modes    glow, neon jungle, galaxy, splatter (how much paint, which colours)
 *   pads     splat, UV pulse (hold), wipe the walls, dripping paint
 *   moments  paint explosion (big), blackout (deep), drip (deep)
 *   stems    the walls' paint lands with the drums, the floor's with the
 *            snare, the tubes breathe with the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { Avatar } from '../../../character/Avatar';
import type { VenueDef } from '../base';
import type { ShowState } from '../show';
import { CrazyRoom, type RoomAction, type RoomMoment } from './kit';

const W = 7;
const H = 4.5;
const D = 13;

const PALETTES: string[][] = [
  ['#39ff14', '#ff2bd6', '#00e5ff', '#fff200'],
  ['#39ff14', '#7dff00', '#00ffa2', '#d4ff00'],
  ['#7a3cff', '#00e5ff', '#ff2bd6', '#ffffff'],
  ['#ff2bd6', '#fff200', '#ff6a00', '#00e5ff'],
];

/** a canvas the paint lands on: splats with spatter and drips */
class PaintWall {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  drips: { x: number; y: number; len: number; col: string; w: number }[] = [];

  constructor(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d')!;
    this.g.fillStyle = '#000';
    this.g.fillRect(0, 0, w, h);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  splat(col: string, size: number, drip: boolean): void {
    const g = this.g;
    const { width: w, height: h } = this.canvas;
    const x = Math.random() * w;
    const y = Math.random() * h;
    g.fillStyle = col;
    g.globalAlpha = 0.9;
    g.beginPath();
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = size * (0.7 + Math.random() * 0.5);
      if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.fill();
    // spatter round it
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = size * (1.1 + Math.random() * 1.6);
      g.beginPath();
      g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, Math.random() * size * 0.18 + 1, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    if (drip) for (let i = 0; i < 3; i++) this.drips.push({ x: x + (Math.random() - 0.5) * size, y: y + size * 0.6, len: size * (1 + Math.random() * 3), col, w: 2 + Math.random() * 3 });
    this.texture.needsUpdate = true;
  }

  /** drips run down a little each frame */
  step(dt: number): void {
    if (!this.drips.length) return;
    const g = this.g;
    for (const d of this.drips) {
      const dy = Math.min(d.len, 40 * dt);
      g.fillStyle = d.col;
      g.fillRect(d.x, d.y, d.w, dy + 1);
      d.y += dy;
      d.len -= dy;
    }
    this.drips = this.drips.filter((d) => d.len > 0.5);
    this.texture.needsUpdate = true;
  }

  /** the paint fades a little (so the walls never fill up) or is wiped */
  fade(k: number): void {
    this.g.fillStyle = `rgba(0,0,0,${k})`;
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

class UvRoom extends CrazyRoom {
  readonly modes = ['Glow', 'Neon jungle', 'Galaxy', 'Splatter'];
  readonly actions: RoomAction[] = [
    { id: 'splat', label: 'Splat', kind: 'hit' },
    { id: 'pulse', label: 'UV pulse', kind: 'hold' },
    { id: 'wipe', label: 'Wipe walls', kind: 'hit' },
    { id: 'drip', label: 'Dripping paint', kind: 'toggle' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'explode', label: 'Glow paint explodes over the walls', energy: 'big' },
    { id: 'blackout', label: 'The UV goes out; only the paint glows', energy: 'deep' },
    { id: 'drip', label: 'The walls start to drip', energy: 'deep' },
  ];
  private walls = new PaintWall(1024, 384);
  private floorPaint = new PaintWall(512, 512);
  private wallMat: THREE.MeshStandardMaterial;
  private floorMat: THREE.MeshStandardMaterial;
  private tubes: THREE.MeshBasicMaterial;
  private uvLight: THREE.PointLight[] = [];
  private dj: Avatar | null = null;
  private uvK = 1;
  private lastKick = 0;
  private fadeT = 0;

  constructor() {
    super({ roomId: 'uv', roomName: 'UV Blacklight Room', w: W, h: H, d: D, back: 3, fog: 0x05020c, fogDensity: 0.03, hemi: 0.08, hemiSky: 0x2a0a5a, hemiGround: 0x05010a, booth: { strip: '#9a5cff' } });
    this.ambient = 0.08;
    this.grade = { tint: 0xeee0ff, contrast: 1.12, saturation: 1.2, lift: 0.002 };
    this.walls.texture.wrapS = THREE.RepeatWrapping;
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0x050407, roughness: 0.9, emissive: 0xffffff, emissiveMap: this.walls.texture, emissiveIntensity: 1.4, side: THREE.BackSide });
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x050407, roughness: 0.8, emissive: 0xffffff, emissiveMap: this.floorPaint.texture, emissiveIntensity: 1.2, side: THREE.BackSide });
    const ceil = new THREE.MeshStandardMaterial({ color: 0x030205, roughness: 0.95, side: THREE.BackSide });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + 3), [this.wallMat, this.wallMat, ceil, this.floorMat, this.wallMat, this.wallMat]);
    shell.position.set(0, H / 2, (3 - D) / 2);
    this.group.add(shell);
    // UV tubes along the top of the walls
    this.tubes = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.2, 2.2), toneMapped: false });
    for (const x of [-W + 0.08, W - 0.08])
      for (let z = 1; z > -D + 1; z -= 2.4) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.8, 8).rotateX(Math.PI / 2), this.tubes);
        t.position.set(x, H - 0.25, z - 0.9);
        this.group.add(t);
      }
    for (const z of [-2, -7, -11]) {
      const l = new THREE.PointLight(0x6a2aff, 4, 12, 1.6);
      l.position.set(0, H - 0.4, z);
      this.uvLight.push(l);
      this.group.add(l);
    }
    const c = this.people(1, 1601, { phones: 0.1, drinks: 0.2, clothes: ['#ffffff', '#f4f4f0', '#39ff14', '#ff2bd6', '#00e5ff', '#fff200', '#1a1a22', '#2a2a33', '#ffffff'] });
    c.uv = 1;
    // a first coat of paint
    for (let i = 0; i < 26; i++) this.walls.splat(PALETTES[0][i % 4], 14 + Math.random() * 22, false);
    for (let i = 0; i < 10; i++) this.floorPaint.splat(PALETTES[0][i % 4], 10 + Math.random() * 16, false);
  }

  attachDJ(dj: Avatar): void {
    this.dj = dj;
    dj.uv = 1;
  }

  protected onAction(id: string): void {
    const pal = PALETTES[this.look.mode] ?? PALETTES[0];
    if (id === 'splat') for (let i = 0; i < 6; i++) this.walls.splat(pal[i % 4], 24 + Math.random() * 30, this.on('drip'));
    if (id === 'wipe') {
      this.walls.fade(1);
      this.floorPaint.fade(1);
    }
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const pal = PALETTES[this.look.mode] ?? PALETTES[0];
    const splatter = this.look.mode === 3 ? 2 : 1;
    // paint lands with the music: the walls on the kick, the floor on the snare
    const kick = this.parts ? this.parts.kickHit : s.kick > 0.9 && this.time - this.lastKick > 0.3;
    if (kick && s.playing) {
      this.lastKick = this.time;
      if (Math.random() < 0.25 + this.drive.floor * 0.5 * splatter) this.walls.splat(pal[Math.floor(Math.random() * 4)], 12 + Math.random() * 26 * this.look.level, this.on('drip') || this.momentK('drip') > 0);
    }
    if ((this.parts?.snareHit ?? false) && s.playing && Math.random() < 0.4 * splatter) this.floorPaint.splat(pal[Math.floor(Math.random() * 4)], 10 + Math.random() * 14, false);
    if (this.moment?.id === 'explode' && this.moment.t < 1.2) for (let i = 0; i < 3; i++) this.walls.splat(pal[i % 4], 30 + Math.random() * 40, true);
    this.walls.step(dt);
    // the paint slowly fades so the walls keep changing
    this.fadeT += dt;
    if (this.fadeT > 4) {
      this.fadeT = 0;
      this.walls.fade(0.04);
      this.floorPaint.fade(0.05);
    }
    // the UV: on, breathing with the vocals, pulsing on the kick while held, out for the blackout
    const want = this.momentK('blackout') > 0.1 ? 0.05 : 1;
    this.uvK += (want - this.uvK) * Math.min(1, dt * 2);
    const pulse = this.on('pulse') ? 0.6 + s.kick * 1.4 : 1;
    const uv = this.uvK * pulse * (0.7 + this.drive.ceil * 0.5) * this.look.level;
    this.tubes.color.setRGB(0.5, 0.2, 2.2).multiplyScalar(0.3 + uv);
    for (const l of this.uvLight) l.intensity = 4 * uv;
    this.wallMat.emissiveIntensity = 0.6 + uv * 1.1;
    this.floorMat.emissiveIntensity = 0.5 + uv * 1.0;
    for (const c of this.crowds) c.uv = Math.min(1.4, uv);
    if (this.dj) this.dj.uv = Math.min(1.2, uv);
    this.lookUp = this.momentK('explode') * 0.6;
  }

  dispose(): void {
    if (this.dj) this.dj.uv = 0;
    this.walls.dispose();
    this.floorPaint.dispose();
    super.dispose();
  }
}

export const uvRoom: VenueDef = {
  id: 'uv',
  name: 'UV Blacklight Room',
  short: 'UV Room',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'Blacklight only: white clothes glow, neon fluoresces and glow paint splats onto the walls on the beat.',
  palette: ['#9a5cff', '#39ff14', '#ff2bd6'],
  ui: '#9a5cff',
  capacity: '150',
  build: () => new UvRoom(),
  thumb(g, w, h) {
    g.fillStyle = '#07020f';
    g.fillRect(0, 0, w, h);
    const cols = ['#39ff14', '#ff2bd6', '#00e5ff', '#fff200'];
    for (let i = 0; i < 26; i++) {
      g.fillStyle = cols[i % 4];
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(((i * 53) % w) + 4, ((i * 31) % (h * 0.7)) + 6, 3 + (i % 5) * 2, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#7a3cff';
    g.fillRect(0, 2, w, 3);
  },
};
