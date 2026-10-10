/*
 * The hub (Section 9.7): your home between gigs, and it grows with your
 * fame. A small bedroom at first (a desk with a cheap controller, posters,
 * fairy lights), then a proper studio (a booth, monitors, record shelves, a
 * sofa), then the penthouse (glass all along one side and the city below,
 * your name in neon). The wall fills up with the flyers of the gigs you've
 * played, framed plaques for your milestones and gold records engraved with
 * your name. The stations (bookings, wardrobe, crates, My Sets, the phone)
 * are things in the room; the hub screen's buttons open them.
 *
 * TODO: procedural stand-in for the Blender apartment sets (Section 14).
 */
import * as THREE from 'three';
import { drawFlyer, type FlyerInfo } from '../../ui/flyer';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { LedStrings, speaker } from './fixtures';
import { skyline } from './outdoor';
import { canvasTexture, concreteTexture, rng, windowsTexture } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface HubState {
  tier: number;
  dj: string;
  /** the gigs you've played, newest first */
  flyers: FlyerInfo[];
  /** milestones reached (their names) */
  plaques: string[];
  /** gold records on the wall */
  golds: number;
}

let state: HubState = { tier: 1, dj: '', flyers: [], plaques: [], golds: 0 };

/** what the next hub build shows */
export function setHubState(s: HubState): void {
  state = s;
}

export const HOME_NAMES = ['Your bedroom', 'Your studio', 'The penthouse'] as const;
/** the fame tier each home comes with */
export const HOME_TIERS = [1, 3, 5] as const;

/** which home you live in at a fame tier: 0 bedroom, 1 studio, 2 penthouse */
export function homeLevel(tier: number): 0 | 1 | 2 {
  return tier >= HOME_TIERS[2] ? 2 : tier >= HOME_TIERS[1] ? 1 : 0;
}

/** gold records for a career so far: one per tier from 3, one per 25 sets */
export function goldRecords(tier: number, setsPlayed: number): number {
  return Math.max(0, tier - 2) + Math.floor(setsPlayed / 25);
}

/** the room sizes: width, depth, height */
const ROOMS: [number, number, number][] = [
  [4.4, 5.2, 2.6],
  [8, 9, 3.2],
  [13, 11, 3.8],
];

function planks(tone: number): THREE.CanvasTexture {
  return canvasTexture(
    `hub-floor:${tone}`,
    256,
    256,
    (g, w, h) => {
      const r = rng(tone);
      for (let y = 0; y < h; y += 24) {
        let x = -r() * 120;
        while (x < w) {
          const len = 80 + r() * 120;
          const v = tone + r() * 30;
          g.fillStyle = `rgb(${v},${v * 0.72},${v * 0.5})`;
          g.fillRect(x, y, len, 24);
          g.fillStyle = 'rgba(30,20,12,0.6)';
          g.fillRect(x, y, 1.5, 24);
          x += len;
        }
        g.fillStyle = 'rgba(30,20,12,0.6)';
        g.fillRect(0, y, w, 1.5);
      }
    },
    { repeat: true },
  );
}

/** a framed picture on a wall */
function frame(tex: THREE.Texture, w: number, h: number, border = 0.04, color = 0x111111): THREE.Group {
  const g = new THREE.Group();
  const back = new THREE.Mesh(new THREE.BoxGeometry(w + border * 2, h + border * 2, 0.03), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 }));
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
  pic.position.z = 0.017;
  g.add(back, pic);
  return g;
}

/** a milestone plaque: brushed metal on dark wood */
function plaqueTexture(text: string, dj: string): THREE.CanvasTexture {
  return canvasTexture(`plaque:${text}:${dj}`, 256, 192, (g, w, h) => {
    g.fillStyle = '#2a1c12';
    g.fillRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#d8d4c8');
    grad.addColorStop(0.5, '#9a968c');
    grad.addColorStop(1, '#d0ccc0');
    g.fillStyle = grad;
    g.fillRect(24, 24, w - 48, h - 48);
    g.fillStyle = '#1a1a1a';
    g.textAlign = 'center';
    g.font = '700 22px "Barlow Condensed", sans-serif';
    g.fillText(text.toUpperCase().slice(0, 22), w / 2, h / 2 - 4);
    g.font = '500 15px "Barlow Condensed", sans-serif';
    g.fillText(dj || 'DJ', w / 2, h / 2 + 22);
  });
}

/** a gold record in a frame, your name on the label */
function goldTexture(dj: string, n: number): THREE.CanvasTexture {
  return canvasTexture(`gold:${dj}:${n}`, 256, 320, (g, w, h) => {
    g.fillStyle = '#0c0c0e';
    g.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.42;
    const r = w * 0.4;
    const disc = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    disc.addColorStop(0, '#fff2b0');
    disc.addColorStop(0.5, '#d8a830');
    disc.addColorStop(1, '#8a6410');
    g.fillStyle = disc;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(80,50,0,0.35)';
    for (let k = r * 0.4; k < r; k += 3) {
      g.beginPath();
      g.arc(cx, cy, k, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#1a1a1a';
    g.beginPath();
    g.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d8a830';
    g.textAlign = 'center';
    g.font = '700 14px "Barlow Condensed", sans-serif';
    g.fillText((dj || 'DJ').slice(0, 14), cx, cy + 5);
    g.fillStyle = '#d8d4c8';
    g.font = '600 16px "Barlow Condensed", sans-serif';
    g.fillText('PRESENTED TO', cx, h * 0.84);
    g.font = '700 20px "Barlow Condensed", sans-serif';
    g.fillText((dj || 'DJ').toUpperCase().slice(0, 18), cx, h * 0.92);
  });
}

/** record sleeves on shelves: the crate-digging corner */
function recordShelf(w: number, rows: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4e36, roughness: 0.75 });
  const r = rng(seed);
  for (let i = 0; i <= rows; i++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, 0.34), wood);
    shelf.position.y = i * 0.36;
    g.add(shelf);
  }
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.03, rows * 0.36, 0.34), wood);
    side.position.set((s * w) / 2, (rows * 0.36) / 2, 0);
    g.add(side);
  }
  const sleeves = new THREE.InstancedMesh(new THREE.BoxGeometry(0.008, 0.31, 0.31), new THREE.MeshStandardMaterial({ roughness: 0.6 }), Math.round((w / 0.012) * rows));
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let k = 0;
  for (let row = 0; row < rows; row++) {
    for (let x = -w / 2 + 0.03; x < w / 2 - 0.03 && k < sleeves.count; x += 0.011 + r() * 0.004) {
      m.makeRotationZ((r() - 0.5) * 0.06);
      m.setPosition(x, row * 0.36 + 0.17, 0);
      sleeves.setMatrixAt(k, m);
      sleeves.setColorAt(k++, c.setHSL(r(), 0.3 + r() * 0.5, 0.2 + r() * 0.45));
    }
  }
  sleeves.count = k;
  g.add(sleeves);
  return g;
}

/** a deck-and-mixer setup on a desk (just the shapes; the playable board lives at the gigs) */
function setup(w: number, glow: string): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x18191d, roughness: 0.5, metalness: 0.3 });
  const plat = new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.4, metalness: 0.6 });
  for (const s of [-1, 1]) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w * 0.34, 0.06, w * 0.3), body);
    deck.position.set(s * w * 0.31, 0.03, 0);
    const jog = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.1, w * 0.1, 0.012, 32), plat);
    jog.position.set(s * w * 0.31, 0.066, 0.01);
    g.add(deck, jog);
  }
  const mixer = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, 0.08, w * 0.3), body);
  mixer.position.y = 0.04;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.006, 0.006), new THREE.MeshBasicMaterial({ color: new THREE.Color(glow).multiplyScalar(2), toneMapped: false }));
  strip.position.set(0, 0.07, w * 0.15);
  g.add(mixer, strip);
  return g;
}

class Hub extends VenueBase {
  readonly views: VenueViews;
  private phoneGlow: THREE.MeshBasicMaterial;
  private t = 0;

  constructor() {
    const level = homeLevel(state.tier);
    const [W, D, H] = ROOMS[level];
    super({ fog: 0x0a0a10, fogDensity: 0.004, hemiSky: 0x8a90b0, hemiGround: 0x2a2018, hemi: 0.5, flashAt: V(0, H - 0.3, 0), flashRange: 8 });
    this.keyLight = { color: 0xffe2c0, intensity: 6 };
    this.grade = { tint: 0xfff4ea, contrast: 1.04, saturation: 1.05, lift: 0.004 };
    this.toneMapping = 'agx';
    if (level === 2) this.far = 600;
    // the camera: from the front corner, looking at the wall of fame
    this.views = {
      wide: { pos: V(W * 0.36, H * 0.62, D * 0.36), target: V(-W * 0.1, H * 0.45, -D * 0.4) },
      wideLabel: HOME_NAMES[level],
      crowd: { pos: V(0, 1.55, -D * 0.05), target: V(0, 1.6, -D / 2) },
      drone: [V(W * 0.3, H * 0.7, D * 0.3), V(-W * 0.3, H * 0.7, D * 0.3), V(-W * 0.3, H * 0.7, -D * 0.1), V(W * 0.3, H * 0.7, -D * 0.1)],
      extra: { crane: { radius: Math.min(W, D) * 0.3, low: 1.2, high: H - 0.4 } },
    };

    // the room
    const floorTex = planks(level === 2 ? 120 : 150);
    floorTex.repeat.set(W / 2, D / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 }));
    this.group.add(floor);
    const wallColor = [0x6a7088, 0xb8b2a8, 0x2a2c32][level];
    const wall = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9, map: level === 1 ? concreteTexture(170) : null });
    const ceiling = new THREE.MeshStandardMaterial({ color: level === 2 ? 0x1a1b20 : 0xd8d4cc, roughness: 0.95 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [wall, wall, ceiling, new THREE.MeshBasicMaterial({ visible: false }), wall, wall]);
    for (const m of box.material as THREE.Material[]) m.side = THREE.BackSide;
    box.position.y = H / 2;
    this.group.add(box);

    // the window: small, wide, then glass all along the right-hand wall with the city below
    const city = windowsTexture('hub-city', '#ffd9a0', 0.4);
    if (level < 2) {
      const ww = level === 0 ? 1.1 : 3.4;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(ww, level === 0 ? 0.9 : 1.6), new THREE.MeshBasicMaterial({ map: city, color: new THREE.Color(0.6, 0.6, 0.75) }));
      win.position.set(W / 2 - 0.02, 1.6, -D * 0.1);
      win.rotation.y = -Math.PI / 2;
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, ww + 0.1), new THREE.MeshStandardMaterial({ color: 0xe8e4dc }));
      sill.position.set(W / 2 - 0.06, 1.6 - (level === 0 ? 0.47 : 0.82), -D * 0.1);
      this.group.add(win, sill);
    } else {
      // the glass wall replaces the right-hand wall: mullions, and the city
      const mull = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.6, roughness: 0.4 });
      for (let z = -D / 2; z <= D / 2; z += 2.2) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, H, 0.08), mull);
        m.position.set(W / 2 - 0.05, H / 2, z);
        this.group.add(m);
      }
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(D, H), new THREE.MeshBasicMaterial({ color: 0x050608, transparent: true, opacity: 0.0, depthWrite: false }));
      glass.position.set(W / 2 - 0.03, H / 2, 0);
      glass.rotation.y = -Math.PI / 2;
      this.group.add(glass);
      // hide the right wall behind the glass
      (box.material as THREE.Material[])[0] = new THREE.MeshBasicMaterial({ visible: false });
      const sky = skyline({ seed: 9090, inner: 80, outer: 360, from: Math.PI * 0.15, to: Math.PI * 0.85, blocks: 6, minH: 20, maxH: 110, y: -70, density: 0.6 });
      for (const b of sky.blocks) b.mat.emissiveIntensity = 1;
      this.group.add(sky.group);
      const night = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), new THREE.MeshBasicMaterial({ color: 0x0c0e1c, side: THREE.BackSide, fog: false }));
      this.group.add(night);
    }

    // the wall of fame: flyers, plaques, gold records (back wall)
    const fame = new THREE.Group();
    fame.position.set(0, 0, -D / 2 + 0.03);
    this.group.add(fame);
    const fly = state.flyers.slice(0, [6, 10, 16][level]);
    const cols = [3, 5, 8][level];
    fly.forEach((f, i) => {
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = 320;
      drawFlyer(c, f);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const fr = level === 0 ? (() => {
        // taped up in the bedroom
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
        return m;
      })() : frame(tex, 0.36, 0.48, 0.025);
      const x = ((i % cols) - (cols - 1) / 2) * (level === 0 ? 0.36 : 0.5);
      const y = (level === 0 ? 1.95 : 2.1) - Math.floor(i / cols) * (level === 0 ? 0.46 : 0.6);
      fr.position.set(x - (level === 0 ? 0.6 : 0), y, 0.01);
      fr.rotation.z = level === 0 ? (Math.sin(i * 7.1) * 0.05) : 0;
      fame.add(fr);
    });
    // plaques along the left wall, gold records on the back wall's right
    const plaques = state.plaques.slice(0, [3, 8, 14][level]);
    plaques.forEach((p, i) => {
      const fr = frame(plaqueTexture(p, state.dj), 0.36, 0.27, 0.02, 0x2a1c12);
      fr.position.set(-W / 2 + 0.04, 2.0 - Math.floor(i / 4) * 0.42, -D * 0.3 + (i % 4) * 0.48);
      fr.rotation.y = Math.PI / 2;
      this.group.add(fr);
    });
    const golds = Math.min(state.golds, [1, 4, 10][level]);
    for (let i = 0; i < golds; i++) {
      const fr = frame(goldTexture(state.dj, i), 0.4, 0.5, 0.03, 0x0c0c0e);
      fr.position.set(W / 2 - 0.9 - (i % 5) * 0.56, 2.1 - Math.floor(i / 5) * 0.66, 0.01);
      fame.add(fr);
      if (i === 0) {
        const spot = new THREE.SpotLight(0xfff0d0, 6, 4, 0.5, 0.6, 1.5);
        spot.position.set(fr.position.x, H - 0.1, -D / 2 + 1);
        spot.target.position.set(fr.position.x, 1.8, -D / 2);
        this.group.add(spot, spot.target);
      }
    }

    // the furniture, by home
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4e36, roughness: 0.75 });
    const black = new THREE.MeshStandardMaterial({ color: 0x16171b, roughness: 0.6 });
    if (level === 0) {
      // the bed, the desk with the cheap controller, posters and fairy lights
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 2.0), new THREE.MeshStandardMaterial({ color: 0x3a4a6a, roughness: 0.9 }));
      bed.position.set(-W / 2 + 0.75, 0.225, D / 2 - 1.1);
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.35), new THREE.MeshStandardMaterial({ color: 0xe8e4dc }));
      pillow.position.set(-W / 2 + 0.75, 0.5, D / 2 - 0.3);
      const desk = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.6), wood);
      desk.position.set(W / 2 - 0.85, 0.75, -D / 2 + 0.45);
      for (const sx of [-0.7, 0.7]) for (const sz of [-0.25, 0.25]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.75, 0.04), wood);
        leg.position.set(W / 2 - 0.85 + sx, 0.375, -D / 2 + 0.45 + sz);
        this.group.add(leg);
      }
      const ctl = setup(0.7, '#7a3cff');
      ctl.position.set(W / 2 - 0.85, 0.78, -D / 2 + 0.45);
      const lamp = new THREE.PointLight(0xffd8a8, 2.2, 5, 1.6);
      lamp.position.set(W / 2 - 0.4, 1.3, -D / 2 + 0.4);
      this.group.add(bed, pillow, desk, ctl, lamp);
      const leds = new LedStrings({ warm: '#ffcf8a', size: 0.06, spacing: 0.18 });
      leds.path([V(-W / 2 + 0.05, H - 0.15, -D / 2 + 0.05), V(0, H - 0.3, -D / 2 + 0.05), V(W / 2 - 0.05, H - 0.15, -D / 2 + 0.05)]);
      this.add(leds.done());
    } else {
      // the booth corner: a desk, the setup, monitors either side
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.7), black);
      desk.position.set(-W * 0.18, 0.45, -D / 2 + 1.2);
      const kit = setup(1.4, level === 2 ? '#ff2e88' : '#2ec4f1');
      kit.position.set(-W * 0.18, 0.9, -D / 2 + 1.2);
      this.group.add(desk, kit);
      for (const s of [-1, 1]) {
        const mon = speaker(0.3, 0.45, 0.3, 'monitor');
        mon.position.set(-W * 0.18 + s * 1.3, 1.15, -D / 2 + 1.1);
        mon.rotation.y = s * -0.3;
        this.group.add(mon);
      }
      // crates: shelves of records along the left wall
      const shelf = recordShelf(level === 2 ? 3.6 : 2.4, level === 2 ? 5 : 4, 77);
      shelf.position.set(-W / 2 + 0.2, 0.02, D * 0.1);
      shelf.rotation.y = Math.PI / 2;
      this.group.add(shelf);
      // the sofa and a coffee table with the phone on it
      const sofa = new THREE.Group();
      const cushion = new THREE.MeshStandardMaterial({ color: level === 2 ? 0x2a2a32 : 0x8a5a3a, roughness: 0.9 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.42, 0.9), cushion);
      seat.position.y = 0.21;
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.22), cushion);
      back.position.set(0, 0.62, 0.34);
      sofa.add(seat, back);
      sofa.position.set(W * 0.1, 0, D / 2 - 1.3);
      sofa.rotation.y = Math.PI;
      this.group.add(sofa);
      const table = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 0.6), wood);
      table.position.set(W * 0.1, 0.2, D / 2 - 2.4);
      this.group.add(table);
      // a clothes rail: the wardrobe
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 6).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 }));
      rail.position.set(W / 2 - 1.2, 1.6, D / 2 - 0.6);
      this.group.add(rail);
      const r = rng(5);
      for (let i = 0; i < 8; i++) {
        const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.45), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(r(), 0.4, 0.35 + r() * 0.3), roughness: 0.9 }));
        shirt.position.set(W / 2 - 1.8 + i * 0.16, 1.22, D / 2 - 0.6);
        this.group.add(shirt);
      }
      // LED strips along the ceiling
      const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.4, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(level === 2 ? '#ff2e88' : '#2ec4f1').multiplyScalar(1.6), toneMapped: false }));
      strip.position.set(0, H - 0.05, -D / 2 + 0.1);
      this.group.add(strip);
      this.wash(V(-W * 0.18, H - 0.4, -D / 2 + 1.5), 0, 2.5, 6);
      const lamp = new THREE.PointLight(0xffd8a8, 3, 9, 1.6);
      lamp.position.set(W * 0.1, H - 0.5, D / 2 - 2);
      this.group.add(lamp);
      if (level === 2) {
        // your name in neon over the booth, plants, a kitchen island
        this.nameSign('neon_script', 3, 0.8, V(-W * 0.18, 2.6, -D / 2 + 0.06), 0, 1.2);
        const island = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.95, 0.9), new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.3 }));
        island.position.set(-W / 2 + 2.4, 0.475, D / 2 - 1.4);
        this.group.add(island);
        for (const [x, z] of [
          [W / 2 - 0.7, -D / 2 + 0.7],
          [W / 2 - 0.7, D / 2 - 2.6],
          [-W / 2 + 0.7, -D / 2 + 0.7],
        ]) {
          const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 14), black);
          pot.position.set(x, 0.25, z);
          const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x2f5a2a, flatShading: true, roughness: 0.85 }));
          leaf.position.set(x, 1.0, z);
          leaf.scale.set(1, 1.4, 1);
          this.group.add(pot, leaf);
        }
      }
    }
    // the phone, glowing on the table (or the bed)
    this.phoneGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.7, 1.2), toneMapped: false });
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.01, 0.15), this.phoneGlow);
    phone.position.copy(level === 0 ? V(-W / 2 + 0.9, 0.46, D / 2 - 1.4) : V(W * 0.1 + 0.2, 0.41, D / 2 - 2.4));
    phone.rotation.y = 0.4;
    this.group.add(phone);
    // a poster or two on the side wall
    const posterCol = ['#ff2e88', '#ffb547', '#3ad7ff'];
    for (let i = 0; i < (level === 0 ? 3 : 1); i++) {
      const p = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.7),
        new THREE.MeshStandardMaterial({
          map: canvasTexture(`hub-poster:${i}`, 100, 140, (g, w, h) => {
            g.fillStyle = posterCol[i];
            g.fillRect(0, 0, w, h);
            g.fillStyle = '#111';
            g.font = '800 20px "Barlow Condensed", sans-serif';
            g.textAlign = 'center';
            g.fillText(['HOUSE', 'GROOVE', 'RAVE'][i], w / 2, h * 0.5);
            g.font = '600 10px "Barlow Condensed", sans-serif';
            g.fillText('ALL NIGHT LONG', w / 2, h * 0.62);
          }),
        }),
      );
      p.position.set(-W / 2 + 0.02, 1.55, -D * 0.25 + i * 0.7 + (level === 0 ? 0 : 1.5));
      p.rotation.y = Math.PI / 2;
      this.group.add(p);
    }
  }

  update(...args: Parameters<VenueBase['update']>): void {
    super.update(...args);
    const [, , dt] = args;
    this.t += dt;
    // a notification now and then
    this.phoneGlow.color.setRGB(0.6, 0.7, 1.2).multiplyScalar(0.6 + 0.4 * (Math.sin(this.t * 0.8) > 0.6 ? 1 : 0.3));
  }
}

export const hub: VenueDef = {
  id: 'hub',
  name: 'Home',
  place: '',
  kind: 'your place',
  blurb: '',
  palette: ['#ffcf8a', '#ff2e88', '#2ec4f1'],
  ui: '#ff2e88',
  capacity: '',
  build: () => new Hub(),
  thumb(g, w, h) {
    g.fillStyle = '#1a1820';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffcf8a';
    for (let i = 0; i < 6; i++) g.fillRect(w * 0.15 + i * w * 0.12, h * 0.3, w * 0.08, h * 0.12);
  },
};
