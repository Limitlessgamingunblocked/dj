/*
 * Alexandra Palace, London: the Great Hall (see docs/venue-research.md).
 *
 * The room, at the venue's published size: 116.6 m long, 55.11 m wide,
 * 14 m to the springing of the vault and 25 m to its crown, pillar-free. The
 * ceiling is the tensioned-fabric barrel vault of the 1980s rebuild, in bays
 * between arched ribs carried on exposed steel columns. At the far end, the
 * organ on its gallery, with the rose window behind it.
 *
 * Two productions, both built from what has actually been staged there:
 *   – "Alexandra Palace": an arena end-stage. A 23 × 7 m upstage LED wall
 *     with the visual player and two portrait LED towers showing a live
 *     camera on the DJ (IMAG). Flown L/R and side hangs with delays
 *     halfway down the hall, and a sub line in the pit. A stage rig of
 *     moving heads with upstage floor beams, audience trusses of spots and
 *     strobe bars over the crowd, lasers, blinders, CO2 and cold sparks. A
 *     mix position mid-floor, bars, and ~8,000 people.
 *   – "Alexandra Palace · In the round": decks on a round riser in the
 *     middle of the floor, the crowd all the way round, and a field of
 *     43,000 hanging lights over the whole room playing the music in 3D,
 *     with a surround PA.
 * The hall, rose window and organ are modelled from published facts and
 * descriptions; nothing is traced from photos, and nothing carries a logo.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Pyro } from './pyro';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { barCounter, boothClutter, DustMotes, exitSign } from './details';
import { FarCrowd, scatter } from './farcrowd';
import { Blinders, block, booth, Co2Jets, Crowd, crowdArea, HazeLayer, Hazers, LedStrings, MovingHeads, Strobes, TABLE_Y, truss } from './fixtures';
import { LightMap, ScreenAverage, useLightMap } from './lightmap';
import { Lasers, laserStands, type AudienceZone, type RoomProxy } from './lasers';
import { LightField } from './lightfield';
import type { ShowState } from './show';
import { canvasTexture, concreteTexture, floorTexture, grilleTexture, rng, withSurface } from './tex';
import { laserLines, silhouettes } from './warehouse';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The Great Hall, from the venue's published figures (metres). */
export const HALL = { length: 116.6, width: 55.11, wallHeight: 14, crown: 25 };
const BAYS = 10;

/**
 * The segmental barrel vault through the tops of both side walls and the
 * crown: its radius, the height of its centre above the floor, and the half
 * angle it subtends.
 */
export function vault(halfWidth: number, wallHeight: number, crown: number): { radius: number; centreY: number; halfAngle: number } {
  const rise = crown - wallHeight;
  const radius = (halfWidth * halfWidth + rise * rise) / (2 * rise);
  return { radius, centreY: crown - radius, halfAngle: Math.asin(halfWidth / radius) };
}

/** The hall as the lasers see it: floor, side walls, end walls, the vault, the organ gallery and case, plus `solids`. */
function hallRoom(FL: number, zA: number, solids: THREE.Box3[] = []): RoomProxy {
  const hw = HALL.width / 2;
  const zB = zA - HALL.length;
  const v = vault(hw, HALL.wallHeight, HALL.crown);
  const GAL = FL + 7.5;
  return {
    floorY: FL,
    x0: -hw,
    x1: hw,
    z0: zB,
    z1: zA,
    vault: { centreY: FL + v.centreY, radius: v.radius },
    solids: [new THREE.Box3(new THREE.Vector3(-17, GAL - 0.6, zB), new THREE.Vector3(17, GAL + 1.1, zB + 6)), new THREE.Box3(new THREE.Vector3(-13, GAL, zB), new THREE.Vector3(13, GAL + 9.6, zB + 3.6)), ...solids],
  };
}

/* ------------------------------------------------------------------ */
/* textures                                                             */
/* ------------------------------------------------------------------ */

/** One tensioned fabric panel of the vault: seams at the edges, a soft pillow of light in the middle. */
function fabricTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'ally-fabric',
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#cfcac1';
      g.fillRect(0, 0, w, h);
      const pillow = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.75);
      pillow.addColorStop(0, 'rgba(255,255,255,0.22)');
      pillow.addColorStop(1, 'rgba(60,55,50,0.25)');
      g.fillStyle = pillow;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(40,36,32,0.55)';
      g.fillRect(0, 0, 3, h);
      g.fillRect(0, 0, w, 2);
    },
    { repeat: true },
  );
}

/**
 * The rose window: an outer ring of sixteen pointed lights, a ring of
 * roundels, an eight-lobed centre and a central roundel, in deep blue, ruby,
 * amber and green glass with dark tracery. Drawn from the general form of a
 * rose window, not from the real window's design (which isn't documented).
 */
function roseTexture(): THREE.CanvasTexture {
  return canvasTexture('ally-rose', 1024, 1024, (g, w) => {
    const c = w / 2;
    const R = w / 2;
    const glass = ['#1d3c8f', '#8e1730', '#d08a1e', '#1b6a4c', '#4a2a7c', '#2a5fb0'];
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, w, w);
    const r = rng(1988);
    // glass fields, each sector mottled
    const sector = (r0: number, r1: number, a0: number, a1: number, col: string) => {
      g.beginPath();
      g.arc(c, c, r1 * R, a0, a1);
      g.arc(c, c, r0 * R, a1, a0, true);
      g.closePath();
      g.fillStyle = col;
      g.fill();
      for (let k = 0; k < 14; k++) {
        const a = a0 + r() * (a1 - a0);
        const rr = (r0 + r() * (r1 - r0)) * R;
        g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.12})`;
        g.beginPath();
        g.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 6 + r() * 16, 0, Math.PI * 2);
        g.fill();
      }
    };
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / N) * Math.PI * 2 - Math.PI / 2;
      sector(0.58, 0.95, a0, a1, glass[i % 2 ? 0 : 5]);
      sector(0.34, 0.58, a0, a1, glass[i % 2 ? 1 : 2]);
    }
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2 - Math.PI / 2;
      sector(0.12, 0.34, a0, a0 + Math.PI / 4, glass[i % 2 ? 3 : 4]);
    }
    sector(0, 0.12, 0, Math.PI * 2, '#d9a43a');
    // tracery
    g.strokeStyle = '#141210';
    g.lineCap = 'round';
    const ring = (rr: number, lw: number) => {
      g.lineWidth = lw;
      g.beginPath();
      g.arc(c, c, rr * R, 0, Math.PI * 2);
      g.stroke();
    };
    ring(0.97, 26);
    ring(0.58, 16);
    ring(0.34, 14);
    ring(0.12, 12);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      // mullions between the outer lights
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 0.34 * R, c + Math.sin(a) * 0.34 * R);
      g.lineTo(c + Math.cos(a) * 0.96 * R, c + Math.sin(a) * 0.96 * R);
      g.stroke();
      // a pointed arch heading each outer light, and a roundel in each middle-ring light
      const am = a + Math.PI / N;
      const span = Math.PI / N;
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 0.8 * R, c + Math.sin(a) * 0.8 * R);
      g.quadraticCurveTo(c + Math.cos(am) * 0.86 * R, c + Math.sin(am) * 0.86 * R, c + Math.cos(am) * 0.92 * R, c + Math.sin(am) * 0.92 * R);
      g.quadraticCurveTo(c + Math.cos(am) * 0.86 * R, c + Math.sin(am) * 0.86 * R, c + Math.cos(a + 2 * span) * 0.8 * R, c + Math.sin(a + 2 * span) * 0.8 * R);
      g.stroke();
      g.beginPath();
      g.arc(c + Math.cos(am) * 0.46 * R, c + Math.sin(am) * 0.46 * R, 0.065 * R, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < 8; i++) {
      // the eight lobes of the centre
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2 + Math.PI / 8;
      g.lineWidth = 9;
      g.beginPath();
      g.arc(c + Math.cos(a) * 0.23 * R, c + Math.sin(a) * 0.23 * R, 0.085 * R, 0, Math.PI * 2);
      g.stroke();
    }
    // leading: a fine grid of lead lines over the glass
    g.strokeStyle = 'rgba(10,9,8,0.55)';
    g.lineWidth = 2;
    for (let k = 1; k < 22; k++) {
      g.beginPath();
      g.arc(c, c, (k / 22) * 0.95 * R, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

/** Faint LED tile seams and a pixel grid, laid over a screen so it reads as a video wall. */
function ledSeamTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'ally-led-seams',
    64,
    64,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.16)';
      for (let i = 0; i < w; i += 4) g.fillRect(i, 0, 1, h);
      for (let i = 0; i < h; i += 4) g.fillRect(0, i, w, 1);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, 0, 2, h);
      g.fillRect(0, 0, w, 2);
    },
    { srgb: false, repeat: true },
  );
}

/* ------------------------------------------------------------------ */
/* small builders                                                       */
/* ------------------------------------------------------------------ */

const speakerBody = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.62, metalness: 0.12 });

/**
 * A flown line-array hang as two meshes (cabinets, grilles), front facing +Z,
 * curving down. Each speaker() is its own pair of draws; a hall this size has
 * ~90 cabinets.
 */
function paHang(n: number, w: number, h: number, d: number): THREE.Group {
  const bodies: THREE.BufferGeometry[] = [];
  const fronts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const x = new THREE.Vector3(1, 0, 0);
  let y = 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    q.setFromAxisAngle(x, a);
    m.compose(new THREE.Vector3(0, y - h / 2, 0), q, new THREE.Vector3(1, 1, 1));
    bodies.push(new THREE.BoxGeometry(w, h * 0.98, d).applyMatrix4(m));
    fronts.push(new THREE.PlaneGeometry(w * 0.96, h * 0.9).translate(0, 0, d / 2 + 0.004).applyMatrix4(m));
    y -= h * 0.98;
    a += 0.035 + i * 0.01;
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeometries(bodies)!, speakerBody), new THREE.Mesh(mergeGeometries(fronts)!, new THREE.MeshStandardMaterial({ map: grilleTexture('top'), roughness: 0.85 })));
  // the flying frame and its chain to the roof
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, 0.12, d * 1.1), speakerBody);
  frame.position.y = 0.06;
  g.add(frame);
  return g;
}

/**
 * Ground-stacked cabinets (subs, front fills) as two meshes. Each spot is a
 * box `w × h × d` at `pos`, turned by `yaw` and tilted by `tilt`, grille on
 * its local +Z face.
 */
function cabinets(spots: { pos: THREE.Vector3; yaw: number; tilt?: number }[], w: number, h: number, d: number, layout: 'sub' | 'top'): THREE.Group {
  const bodies: THREE.BufferGeometry[] = [];
  const fronts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const sp of spots) {
    q.setFromEuler(e.set(sp.tilt ?? 0, sp.yaw, 0, 'YXZ'));
    m.compose(sp.pos, q, new THREE.Vector3(1, 1, 1));
    bodies.push(new THREE.BoxGeometry(w, h * 0.98, d).applyMatrix4(m));
    fronts.push(new THREE.PlaneGeometry(w * 0.94, h * 0.88).translate(0, 0, d / 2 + 0.004).applyMatrix4(m));
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeometries(bodies)!, speakerBody), new THREE.Mesh(mergeGeometries(fronts)!, new THREE.MeshStandardMaterial({ map: grilleTexture(layout), roughness: 0.85 })));
  return g;
}

/* ------------------------------------------------------------------ */
/* the venue                                                            */
/* ------------------------------------------------------------------ */

type Layout = 'arena' | 'round';

class AllyPally extends VenueBase {
  readonly views: VenueViews;
  private rose!: THREE.MeshBasicMaterial;
  private field: LightField | null = null;
  private fieldLights: THREE.PointLight[] = [];
  private tally: THREE.MeshBasicMaterial | null = null;
  private c = new THREE.Color();
  /** the light on the floor, read by the floor and both crowds */
  private lm: LightMap;
  /** the LED wall's average colour, for its spill */
  private screenAvg: ScreenAverage | null = null;
  private wallLight: THREE.PointLight | null = null;
  private blinderLight: THREE.PointLight | null = null;
  private warm = new THREE.Color(1, 0.62, 0.28);

  constructor(layout: Layout) {
    const FL = layout === 'arena' ? -1.8 : -1.5;
    super({ fog: 0x04050a, fogDensity: 0.0125, hemiSky: 0x2c3242, hemiGround: 0x16130f, hemi: 0.15, flashAt: V(0, 14, layout === 'arena' ? -30 : 0), flashRange: 90 });
    this.toneMapping = 'agx';
    const zA = layout === 'arena' ? 13 : HALL.length / 2;
    this.lm = new LightMap(new THREE.Vector2(-HALL.width / 2, zA - HALL.length), new THREE.Vector2(HALL.width, HALL.length));
    if (layout === 'arena') {
      // stage end wall 13 m behind the DJ; the hall runs 116.6 m to the organ
      this.buildHall(FL, 13);
      this.buildArena(FL);
      this.keyLight = { color: 0xf2f4ff, intensity: 14 };
      this.grade = { tint: 0xf7f6ff, contrast: 1.12, saturation: 1.08, lift: 0 };
      this.views = {
        wide: { pos: V(-7.5, 7.4, 4.6), target: V(1.5, 5.4, -55) },
        wideLabel: 'From the stage',
        crowd: { pos: V(4.2, FL + 1.95, -14.6), target: V(0, 3.9, 4) },
        drone: [
          V(0, 9.4, 6.5), V(0, 4.6, -2.8), V(3, 3.0, -10), V(6, 4.6, -30), V(4, 7.6, -60), V(0, 10.5, -84), V(0, 15.2, -95),
          V(-10, 17, -80), V(-16, 15, -50), V(-14, 12.4, -22), V(-9, 6, -7), V(-5, 2.3, -3.6), V(0, 1.9, -3.7), V(5, 2.3, -3.6), V(9, 6, -1), V(6, 9.6, 4.2),
        ],
      };
    } else {
      // the booth in the middle of the floor: the hall runs 58.3 m either way
      this.buildHall(FL, HALL.length / 2);
      this.buildRound(FL);
      this.keyLight = { color: 0xffe9cf, intensity: 12 };
      this.grade = { tint: 0xfff6ec, contrast: 1.12, saturation: 1.05, lift: 0 };
      this.views = {
        wide: { pos: V(0, FL + 9.0, -52.6), target: V(0, FL + 4.0, 0) },
        wideLabel: 'From the organ gallery',
        crowd: { pos: V(5.4, FL + 1.75, -8.6), target: V(0, 1.4, 0) },
        drone: [
          V(0, 5.5, 9), V(3.5, 2.2, 5), V(4.6, 1.6, 0), V(2.5, 1.5, -3.9), V(-2.5, 1.5, -3.9), V(-6, 2.6, -10), V(-10, 3.4, -24), V(-4, 6.8, -38),
          V(6, 9.4, -44), V(16, 8.2, -20), V(18, 3.4, 4), V(10, 3.2, 20), V(-6, 7.2, 26), V(-8, 4.6, 12),
        ],
      };
    }
  }

  /* ---------------------------------------------------------------- */
  /* the Great Hall                                                    */
  /* ---------------------------------------------------------------- */

  /** The room: floor, walls, columns, the fabric vault and its ribs, both end walls, the organ and the rose window. `zA` is the stage-end wall; the organ end is 116.6 m away. */
  private buildHall(FL: number, zA: number): void {
    const W = HALL.width;
    const L = HALL.length;
    const hw = W / 2;
    const zB = zA - L;
    const zMid = (zA + zB) / 2;
    const vlt = vault(hw, HALL.wallHeight, HALL.crown);

    // floor: dark, sealed concrete, smooth enough to pick up the light
    const ft = floorTexture('#151517', 'ally');
    ft.repeat.set(12, 26);
    const floorMat = withSurface(new THREE.MeshStandardMaterial({ map: ft, metalness: 0.08 }), 'ally-floor', { bumps: 0.25, grain: 0.3, seams: 64, rough: 0.55, roughVar: 0.08, polish: 0.25, repeat: 12, normalScale: 0.4 });
    useLightMap(floorMat, this.lm, 0.7);
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2), floorMat);
    floorMesh.position.set(0, FL, zMid);
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);

    // side walls: painted plaster
    const plaster = withSurface(new THREE.MeshStandardMaterial({ color: 0x5c5851, map: concreteTexture(175) }), 'ally-plaster', { bumps: 0.35, grain: 0.25, rough: 0.9, roughVar: 0.05, repeat: 6 });
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(L, HALL.wallHeight), plaster);
      wall.rotation.y = -s * (Math.PI / 2);
      wall.position.set(s * hw, FL + HALL.wallHeight / 2, zMid);
      this.group.add(wall);
      // cornice where the vault springs
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, L), plaster);
      cornice.position.set(s * (hw - 0.4), FL + HALL.wallHeight - 0.35, zMid);
      this.group.add(cornice);
    }

    // the vault: tensioned acoustic fabric in bays between arched ribs
    const fabric = new THREE.MeshStandardMaterial({ color: 0x7a766e, map: fabricTexture(), roughness: 0.95, side: THREE.BackSide });
    fabric.map!.repeat.set(10, BAYS);
    const vaultGeo = new THREE.CylinderGeometry(vlt.radius, vlt.radius, L, 72, 1, true, Math.PI - vlt.halfAngle, vlt.halfAngle * 2).rotateX(Math.PI / 2);
    const vaultMesh = new THREE.Mesh(vaultGeo, fabric);
    vaultMesh.position.set(0, FL + vlt.centreY, zMid);
    this.group.add(vaultMesh);
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.8, metalness: 0.2 });
    const ribGeo = new THREE.TorusGeometry(vlt.radius - 0.35, 0.42, 6, 72, vlt.halfAngle * 2).rotateZ(Math.PI / 2 - vlt.halfAngle);
    const ribs = new THREE.InstancedMesh(ribGeo, ribMat, BAYS + 1);
    // exposed steel columns carry the ribs down the side walls
    const colMat = new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.55, metalness: 0.55 });
    const cols = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, HALL.wallHeight, 1.0), colMat, (BAYS + 1) * 2);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i <= BAYS; i++) {
      const z = zA - (L * i) / BAYS;
      ribs.setMatrixAt(i, m4.makeTranslation(0, FL + vlt.centreY, z));
      for (const s of [-1, 1]) cols.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m4.makeTranslation(s * (hw - 0.5), FL + HALL.wallHeight / 2, z));
    }
    this.group.add(ribs, cols);

    // end walls: a rectangle up to the springing with the vault's arc over it
    const shape = new THREE.Shape();
    shape.moveTo(-hw, 0);
    shape.lineTo(hw, 0);
    shape.lineTo(hw, HALL.wallHeight);
    shape.absarc(0, vlt.centreY, vlt.radius, Math.PI / 2 - vlt.halfAngle, Math.PI / 2 + vlt.halfAngle, false);
    shape.lineTo(-hw, 0);
    const endGeo = new THREE.ShapeGeometry(shape, 48);
    const endB = new THREE.Mesh(endGeo, plaster);
    endB.position.set(0, FL, zB);
    const endA = new THREE.Mesh(endGeo, plaster);
    endA.position.set(0, FL, zA);
    endA.rotation.y = Math.PI;
    this.group.add(endA, endB);

    // doors along the side walls, exit signs over every other one
    const doors: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
    for (let i = 1; i < BAYS; i += 2) {
      const z = zA - (L * (i + 0.5)) / BAYS;
      for (const s of [-1, 1]) {
        doors.push(new THREE.PlaneGeometry(2.6, 3.0).rotateY(-s * (Math.PI / 2)).translate(s * (hw - 0.07), FL + 1.5, z));
        frames.push(new THREE.BoxGeometry(0.12, 3.3, 3.0).translate(s * (hw - 0.04), FL + 1.62, z));
        if (i % 4 === 1) this.group.add(exitSign(V(s * (hw - 0.08), FL + 3.5, z), -s * (Math.PI / 2)));
      }
    }
    this.group.add(
      new THREE.Mesh(mergeGeometries(frames)!, new THREE.MeshStandardMaterial({ color: 0x5f5a52, roughness: 0.7 })),
      new THREE.Mesh(mergeGeometries(doors)!, new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6, metalness: 0.3 })),
    );

    // the organ end: gallery, organ case and pipes, the rose window behind
    const GAL = FL + 7.5;
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a291b, roughness: 0.55, metalness: 0.05 });
    const gallery = block(34, 0.6, 6, plaster, 4);
    gallery.position.set(0, GAL - 0.3, zB + 3);
    const parapet = block(34, 1.1, 0.28, wood, 2);
    parapet.position.set(0, GAL + 0.55, zB + 6);
    this.group.add(gallery, parapet);
    const galCols = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.3, GAL - FL - 0.6, 16), colMat, 6);
    [-15, -9, -3, 3, 9, 15].forEach((x, i) => galCols.setMatrixAt(i, m4.makeTranslation(x, FL + (GAL - FL - 0.6) / 2, zB + 5.7)));
    this.group.add(galCols);
    const under = new LedStrings({ size: 0.05, spacing: 0.6, warm: '#ffb46a' });
    under.line(V(-16.5, GAL - 0.62, zB + 5.6), V(16.5, GAL - 0.62, zB + 5.6));
    this.add(under.done());
    const caseBase = block(24, 3.2, 3.4, wood, 2);
    caseBase.position.set(0, GAL + 1.6, zB + 2.2);
    this.group.add(caseBase);
    const pipeTop = GAL + 3.2;
    const groups: { x: number; n: number; h: number; w: number; dz: number }[] = [
      { x: 0, n: 15, h: 6.0, w: 4.6, dz: 0.9 },
      { x: -6.3, n: 9, h: 4.4, w: 3.2, dz: 0.4 },
      { x: 6.3, n: 9, h: 4.4, w: 3.2, dz: 0.4 },
      { x: -10.6, n: 11, h: 5.3, w: 3.6, dz: 0.7 },
      { x: 10.6, n: 11, h: 5.3, w: 3.6, dz: 0.7 },
    ];
    const nPipes = groups.reduce((n, g) => n + g.n, 0);
    const tin = new THREE.MeshStandardMaterial({ color: 0xc8ccd3, metalness: 0.95, roughness: 0.22 });
    const pipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12), tin, nPipes);
    const caps: THREE.BufferGeometry[] = [];
    let pi = 0;
    const one = new THREE.Quaternion();
    for (const grp of groups) {
      for (let k = 0; k < grp.n; k++) {
        const u = grp.n > 1 ? (k / (grp.n - 1)) * 2 - 1 : 0;
        // tallest in the middle of each tower, a mitred V
        const h = grp.h * (0.55 + 0.45 * (1 - Math.pow(Math.abs(u), 1.3)));
        const r = 0.07 + 0.09 * (h / 6);
        m4.compose(V(grp.x + (u * grp.w) / 2, pipeTop + h / 2, zB + 2.2 + grp.dz), one, V(r, h, r));
        pipes.setMatrixAt(pi++, m4);
      }
      caps.push(new THREE.BoxGeometry(grp.w + 0.5, 0.35, 1.1).translate(grp.x, pipeTop + grp.h + 0.35, zB + 2.2 + grp.dz - 0.1));
    }
    this.group.add(pipes, new THREE.Mesh(mergeGeometries(caps)!, wood));
    // the rose window, its stone ring, and glass that the show lights up
    const ROSE_Y = FL + 18.4;
    const ROSE_R = 5.0;
    this.rose = new THREE.MeshBasicMaterial({ map: roseTexture(), color: new THREE.Color(0.3, 0.3, 0.3) });
    const rose = new THREE.Mesh(new THREE.CircleGeometry(ROSE_R, 72), this.rose);
    rose.position.set(0, ROSE_Y, zB + 0.12);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ROSE_R + 0.2, 0.32, 10, 72), plaster);
    ring.position.set(0, ROSE_Y, zB + 0.2);
    this.group.add(rose, ring);
    // under the gallery: the back bar and the exits
    const bar = barCounter(16, { glow: '#ffb46a', seed: 1875 });
    bar.position.set(0, FL, zB + 2.4);
    this.group.add(bar);
    for (const s of [-1, 1]) this.group.add(exitSign(V(s * 13, FL + 2.7, zB + 0.06), 0));
  }

  /* ---------------------------------------------------------------- */
  /* production 1: the arena end-stage                                 */
  /* ---------------------------------------------------------------- */

  private buildArena(FL: number): void {
    const hw = HALL.width / 2;
    const zB = 13 - HALL.length;
    const black = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x24262b, metalness: 0.75, roughness: 0.45 });

    // the stage deck, its skirt, the pit and the barrier
    const deck = block(24, -FL, 15, new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.75 }), 3);
    deck.position.set(0, FL / 2, 5);
    this.group.add(deck);
    const lip = new LedStrings({ size: 0.05, spacing: 0.14 });
    lip.line(V(-12, -0.04, -2.52), V(12, -0.04, -2.52));
    this.add(lip.done());
    const barrierGeo: THREE.BufferGeometry[] = [];
    for (let x = -13; x < 13; x += 1.0) {
      barrierGeo.push(new THREE.BoxGeometry(0.98, 1.15, 0.06).translate(x + 0.5, FL + 0.58, -4.35));
      barrierGeo.push(new THREE.BoxGeometry(0.98, 0.04, 0.9).translate(x + 0.5, FL + 0.02, -3.95));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(barrierGeo)!, steel));
    // a sub line on the pit floor against the stage face, and front fills on the lip
    const subs: { pos: THREE.Vector3; yaw: number }[] = [];
    for (let i = 0; i < 10; i++) for (let k = 0; k < 2; k++) subs.push({ pos: V(-9.9 + i * 2.2, FL + 0.43 + k * 0.86, -3.0), yaw: Math.PI });
    this.group.add(cabinets(subs, 1.15, 0.85, 0.9, 'sub'));
    this.group.add(cabinets([-9, -5.4, 5.4, 9].map((x) => ({ pos: V(x, 0.14, -2.25), yaw: Math.PI, tilt: -0.15 })), 0.45, 0.28, 0.32, 'top'));

    // black masking: upstage and the wings
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 17), black);
    back.position.set(0, 8.5, 12.3);
    back.rotation.y = Math.PI;
    this.group.add(back);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(14.5, 17), black);
      wing.position.set(s * 20, 8.5, 5);
      wing.rotation.y = -s * (Math.PI / 2);
      this.group.add(wing);
    }

    // the booth
    const b = booth({ w: 3.8, d: 1.1, strip: '#ff3355' });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 3.8, TABLE_Y, -0.55, 1873);
    this.add(new DustMotes(new THREE.Box3(V(-2.6, TABLE_Y - 0.3, -2.4), V(2.6, TABLE_Y + 2.6, 1.6)), 320, 1875));

    // the upstage LED wall (23 × 7 m) with the visual player; its UVs crop the 16:9 frame to the wall's shape
    const wallGeo = new THREE.PlaneGeometry(23, 7);
    const uv = wallGeo.attributes.uv as THREE.BufferAttribute;
    const crop = ((7 / 23) * 16) / 9;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 0.5 + (uv.getY(i) - 0.5) * crop);
    const wall = this.screen(new THREE.Mesh(wallGeo));
    wall.position.set(0, 4.6, 9.0);
    wall.rotation.y = Math.PI;
    this.seams(wall, 23, 7);
    const wallFrame = block(23.4, 7.4, 0.3, black, 2);
    wallFrame.position.set(0, 4.6, 9.2);
    this.group.add(wallFrame);

    // two portrait LED towers with a live camera on the DJ (IMAG)
    const target = new THREE.WebGLRenderTarget(240, 480, { type: THREE.HalfFloatType });
    const towers = new THREE.Group();
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(5, 10), new THREE.MeshBasicMaterial({ map: target.texture, color: new THREE.Color(1.25, 1.25, 1.25) }));
      t.position.set(s * 16.4, 5.6, 0.4);
      t.rotation.y = Math.PI + s * 0.32;
      towers.add(t);
      this.seams(t, 5, 10);
      const tf = block(5.3, 10.3, 0.3, black, 2);
      tf.position.copy(t.position);
      tf.rotation.y = t.rotation.y;
      tf.translateZ(-0.18);
      this.group.add(tf);
    }
    this.group.add(towers);
    // the camera: a long lens on a tripod in the pit, framing the DJ head and shoulders
    const cam = new THREE.Group();
    const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.4), steel);
    const camLens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.36, 12).rotateX(Math.PI / 2), steel);
    camLens.position.z = 0.34;
    this.tally = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.2), toneMapped: false });
    const tally = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), this.tally);
    tally.position.set(0.06, 0.11, 0.1);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 2.1, 6), steel);
    legs.position.y = -1.05;
    cam.add(camBody, camLens, tally, legs);
    cam.position.set(3.2, FL + 2.0, -3.7);
    cam.lookAt(0, 1.6, 0.9);
    this.group.add(cam);
    // the DJ stands behind the table, about 0.9 m back from its centre line
    const feedCam = new THREE.PerspectiveCamera(20, 0.5, 0.1, 200);
    feedCam.position.set(3.2, FL + 2.05, -3.55);
    feedCam.lookAt(0, 1.6, 0.9);
    // 15 fps on a 60 Hz display: the camera sees the decks, which are a few hundred draws
    this.feed = { camera: feedCam, target, screen: towers, every: 4 };

    // the PA: flown mains and subs either side of the wall, side hangs, delays halfway down
    const hang = (n: number, x: number, y: number, z: number, yaw: number, h = 0.36) => {
      const p = paHang(n, 1.2, h, 0.72);
      p.position.set(x, y, z);
      p.rotation.y = Math.PI + yaw;
      this.group.add(p);
      return p;
    };
    const chains: number[] = [];
    for (const s of [-1, 1]) {
      // mains toe in a little, side hangs splay out to the sides of the room
      hang(14, s * 12.6, 13.4, -2.0, s * 0.06);
      hang(6, s * 12.6, 13.4, -0.4, s * 0.06, 0.62);
      hang(12, s * 18.4, 13.0, -1.6, -s * 0.48);
      hang(8, s * 13.5, 12.4, -46, s * 0.03);
      for (const [x, z] of [
        [s * 12.6, -2.0],
        [s * 12.6, -0.4],
        [s * 18.4, -1.6],
        [s * 13.5, -46],
      ])
        chains.push(x, 13.5, z, x, 22.4, z);
    }

    // the lighting: three stage trusses with side trusses, three audience trusses over the floor
    const TRIM = FL + 12.8;
    const stageRows = [-1.6, 2.6, 6.8];
    for (const z of stageRows) this.group.add(truss(V(-12, TRIM, z), V(12, TRIM, z), 0.5));
    for (const s of [-1, 1]) this.group.add(truss(V(s * 12, TRIM, stageRows[0]), V(s * 12, TRIM, stageRows[2]), 0.5));
    const audRows = [-15, -28, -41];
    for (const z of audRows) this.group.add(truss(V(-22, TRIM, z), V(22, TRIM, z), 0.5));
    for (const z of [...stageRows, ...audRows]) {
      const span = z > -5 ? 12 : 22;
      for (const x of [-span, -span / 3, span / 3, span]) chains.push(x, TRIM + 0.25, z, x, FL + 22.4 + (Math.abs(x) > 15 ? -2.5 : 0), z);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(chains, 3));
    this.group.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x2c2d31 })));

    // stage heads, and a row of beams standing upstage firing up through the haze
    const stageHeads = new MovingHeads(
      [
        ...stageRows.flatMap((z) => [-10.8, -8.4, -6, -3.6, -1.2, 1.2, 3.6, 6, 8.4, 10.8].map((x) => ({ pos: V(x, TRIM - 0.45, z) }))),
        ...[-10, -7.5, -5, -2.5, 2.5, 5, 7.5, 10].map((x) => ({ pos: V(x, 0.32, 8.1), up: true })),
      ],
      { length: 24, radius: 1.25, gain: 1.15, floorY: FL, haze: [FL + 1, FL + 22] },
    );
    stageHeads.lightMap = this.lm;
    this.add(stageHeads);
    const audHeads = new MovingHeads(
      audRows.flatMap((z) => [-19, -13.5, -8, -2.7, 2.7, 8, 13.5, 19].map((x) => ({ pos: V(x, TRIM - 0.45, z) }))),
      { length: 18, radius: 1.5, gain: 0.95, floorY: FL, haze: [FL + 1, FL + 22] },
    );
    audHeads.lightMap = this.lm;
    this.add(audHeads);
    // strobe bars: on the stage trusses, along the lip, and over the crowd
    this.add(
      new Strobes(
        [
          ...[-1.6, 2.6].flatMap((z) => [-9.6, -4.8, 0, 4.8, 9.6].map((x) => ({ pos: V(x, TRIM - 0.35, z), tilt: 0.6 }))),
          ...[-10.5, -7.5, 7.5, 10.5].map((x) => ({ pos: V(x, 0.08, -2.35), tilt: -Math.PI / 2 + 0.25 })),
          ...audRows.flatMap((z) => [-16.5, -11, -5.5, 0, 5.5, 11, 16.5].map((x) => ({ pos: V(x, TRIM - 0.35, z), tilt: Math.PI / 2 }))),
        ],
        [1.0, 0.12, 0.12],
      ),
    );
    this.add(new Blinders([-10, -7, -4, -1.3, 1.3, 4, 7, 10].map((x) => ({ pos: V(x, TRIM - 0.55, -1.75), tilt: -0.55 }))));
    // lasers, 14 projectors placed as arena rigs place them: the stage lip, stands at the stage
    // corners (the flat liquid-sky sheet at 3.4 m), high upstage beside the wall, the audience
    // trusses, the side walls mid-hall and the mix position firing back at the stage
    const FOH_Z = -45;
    const room = hallRoom(FL, 12.3, [
      new THREE.Box3(new THREE.Vector3(-11.7, 0.9, 8.85), new THREE.Vector3(11.7, 8.3, 9.4)),
      new THREE.Box3(new THREE.Vector3(-12, FL, -2.5), new THREE.Vector3(12, 0, 12.5)),
      new THREE.Box3(new THREE.Vector3(-20.1, 0, -2.25), new THREE.Vector3(-19.9, 17, 12.3)),
      new THREE.Box3(new THREE.Vector3(19.9, 0, -2.25), new THREE.Vector3(20.1, 17, 12.3)),
      new THREE.Box3(new THREE.Vector3(-5, FL + 3.6, FOH_Z - 3.3), new THREE.Vector3(5, FL + 3.78, FOH_Z + 3.3)),
    ]);
    const audience: AudienceZone = { floorY: FL, x0: -hw, x1: hw, z0: zB + 7.5, z1: -4.95 };
    const low = [V(-12.2, FL + 3.45, -2.2), V(12.2, FL + 3.45, -2.2)];
    this.group.add(laserStands(low, 0));
    this.add(
      new Lasers(
        [
          { pos: V(-8.6, 0.3, -2.4), dir: V(0.1, 0.3, -1), side: -1, beams: 18, length: 125 },
          { pos: V(-3.4, 0.3, -2.4), dir: V(0.04, 0.32, -1), side: -1, beams: 18, length: 125, alt: true },
          { pos: V(3.4, 0.3, -2.4), dir: V(-0.04, 0.32, -1), side: 1, beams: 18, length: 125, alt: true },
          { pos: V(8.6, 0.3, -2.4), dir: V(-0.1, 0.3, -1), side: 1, beams: 18, length: 125 },
          { pos: low[0], dir: V(0.15, 0, -1), side: -1, beams: 24, length: 125 },
          { pos: low[1], dir: V(-0.15, 0, -1), side: 1, beams: 24, length: 125, alt: true },
          { pos: V(-11, 9, 8.4), dir: V(0.12, -0.03, -1), side: -1, beams: 16, length: 125 },
          { pos: V(11, 9, 8.4), dir: V(-0.12, -0.03, -1), side: 1, beams: 16, length: 125, alt: true },
          { pos: V(-8, TRIM - 0.65, -28), dir: V(0.05, -0.02, -1), side: -1, beams: 14, length: 100 },
          { pos: V(8, TRIM - 0.65, -28), dir: V(-0.05, -0.02, 1), side: 1, beams: 14, length: 100, alt: true },
          { pos: V(-hw + 0.6, FL + 7.5, -38), dir: V(1, 0.02, 0.1), side: -1, beams: 14, length: 70 },
          { pos: V(hw - 0.6, FL + 7.5, -38), dir: V(-1, 0.02, -0.1), side: 1, beams: 14, length: 70, alt: true },
          { pos: V(-2.8, FL + 3.9, FOH_Z), dir: V(0.05, 0, 1), side: -1, beams: 20, length: 60 },
          { pos: V(2.8, FL + 3.9, FOH_Z), dir: V(-0.05, 0, 1), side: 1, beams: 20, length: 60, alt: true },
        ],
        { room, audience, focus: V(0, FL + 10, -26), haze: [FL + 1, FL + 22] },
      ),
    );
    this.add(new Co2Jets([-10.6, -7.2, -3.8, 3.8, 7.2, 10.6].map((x) => V(x, 0.02, -2.3)), 12));
    this.add(new Pyro([-11.2, -8, -4.8, 4.8, 8, 11.2].map((x) => ({ pos: V(x, 0, -2.0), kind: 'spark' as const }))));

    // the mix position, mid-floor
    const riser = block(9, 0.6, 5.5, black, 2);
    riser.position.set(0, FL + 0.3, FOH_Z);
    const desk = block(6.4, 0.95, 1.1, new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.4 }), 2);
    desk.position.set(0, FL + 1.08, FOH_Z + 0.6);
    const roof = block(10, 0.14, 6.6, black, 2);
    roof.position.set(0, FL + 3.7, FOH_Z);
    this.group.add(riser, desk, roof);
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.55, 1.1), toneMapped: false });
    for (const x of [-2.4, -0.8, 0.8, 2.4]) {
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), glow);
      scr.position.set(x, FL + 1.9, FOH_Z + 1.02);
      scr.rotation.y = Math.PI;
      scr.rotation.x = -0.25;
      this.group.add(scr);
    }
    const poles: THREE.BufferGeometry[] = [];
    for (const [x, z] of [
      [-4.8, FOH_Z - 3.2],
      [4.8, FOH_Z - 3.2],
      [-4.8, FOH_Z + 3.2],
      [4.8, FOH_Z + 3.2],
    ])
      poles.push(new THREE.CylinderGeometry(0.05, 0.05, 3.7, 6).translate(x, FL + 1.85, z));
    for (const [x, z, w, d] of [
      [0, FOH_Z - 3.4, 10, 0.06],
      [0, FOH_Z + 3.4, 10, 0.06],
      [-5, FOH_Z, 0.06, 6.8],
      [5, FOH_Z, 0.06, 6.8],
    ])
      poles.push(new THREE.BoxGeometry(w, 1.1, d).translate(x, FL + 0.55, z));
    this.group.add(new THREE.Mesh(mergeGeometries(poles)!, steel));

    // bars along both walls in the back half
    for (const s of [-1, 1]) {
      const sb = barCounter(13, { glow: '#ffc890', seed: s < 0 ? 1980 : 1988 });
      sb.position.set(s * (hw - 1.4), FL, -70);
      sb.rotation.y = -s * (Math.PI / 2);
      this.group.add(sb);
    }

    // the crowd: jointed dancers packed at the front, ~7,000 more out to the back of the hall
    const clothes = ['#0d0e10', '#16171a', '#1e2024', '#2a2c31', '#d8d5ce', '#3b2f2a', '#2a3644', '#5a1d24', '#121212', '#9a948a'];
    this.add(
      new Crowd([...crowdArea(-14, 14, -4.95, -9, 2.0, 1873, { y: FL }), ...crowdArea(-14, 14, -9, -15.5, 1.5, 1875, { y: FL }).filter((p) => Math.hypot(p.x - 4.2, p.z + 14.6) > 1.1)], {
        seed: 1988,
        clothes,
        phones: 0.08,
        signs: 7,
        drinks: 0.12,
        lightMap: this.lm,
      }),
    );
    // engineers at the desk (hands on the faders), facing the stage
    this.add(new Crowd([-1.6, 0, 1.6].map((x) => ({ x, z: FOH_Z + 1.4, y: FL + 0.6, face: 0, role: 'dj' as const })), { seed: 45, clothes: ['#0b0b0c', '#141516'] }));
    const avoid = [
      new THREE.Box2(new THREE.Vector2(-6, FOH_Z - 4), new THREE.Vector2(6, FOH_Z + 4)),
      new THREE.Box2(new THREE.Vector2(-hw, -78), new THREE.Vector2(-hw + 4.5, -62)),
      new THREE.Box2(new THREE.Vector2(hw - 4.5, -78), new THREE.Vector2(hw, -62)),
    ];
    const front = -4.95;
    const backZ = zB + 7.5;
    const density = (x: number, z: number) => {
      if (Math.abs(x) < 14 && z > -15.5) return 0; // the 3D dancers
      if (Math.abs(x) > hw - 1.6) return 0; // a walkway along the walls
      const t = (z - backZ) / (front - backZ);
      return 1.25 + 1.65 * t * t;
    };
    this.add(new FarCrowd(scatter(-hw, hw, backZ, front, density, 1988, avoid).map((p) => ({ ...p, y: FL })), { seed: 1873, clothes, phones: 0.07, focus: V(0, 4, 4), lightMap: this.lm }));

    this.add(new HazeLayer(new THREE.Box3(V(-26, FL + 3, -96), V(26, FL + 21, 6)), 7, 0.5, this.lm));
    // hazers on stage, their clouds rolling out over the front of the crowd
    this.add(new Hazers([V(-11, 0, 1), V(11, 0, 1), V(-6, 0, 7.5), V(6, 0, 7.5)].map((pos) => ({ pos, dir: V(-pos.x * 0.02, 0, -0.55) }))));
    // the LED wall's light spills onto the stage, the front rows and the vault; blinders light the front rows warm
    this.screenAvg = new ScreenAverage();
    this.wallLight = new THREE.PointLight(0xffffff, 0, 45, 1.5);
    this.wallLight.position.set(0, 4.8, 6.5);
    this.blinderLight = new THREE.PointLight(0xffa060, 0, 28, 1.6);
    this.blinderLight.position.set(0, 6, -3.5);
    this.group.add(this.wallLight, this.blinderLight);

    // colour washes: stage, the floor, the vault, and the organ end
    this.wash(V(0, 9, 3), 0, 9, 24);
    this.wash(V(0, 10.5, -12), 1, 11, 30);
    this.wash(V(0, 12, -34), 0, 11, 34, 0.7);
    this.wash(V(-14, FL + 19, -22), 2, 9, 42, 0.5);
    this.wash(V(14, FL + 19, -55), 1, 9, 42, 0.5);
    this.wash(V(0, FL + 15, zB + 18), 2, 9, 38, 0.4);
  }

  /* ---------------------------------------------------------------- */
  /* production 2: in the round, under a field of hanging lights       */
  /* ---------------------------------------------------------------- */

  private buildRound(FL: number): void {
    const hw = HALL.width / 2;
    const zB = -HALL.length / 2;
    const black = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x24262b, metalness: 0.75, roughness: 0.45 });

    // the round riser, its light rim and the barrier ring
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.9, -FL, 48), black);
    riser.position.y = FL / 2;
    this.group.add(riser);
    const rim = new LedStrings({ size: 0.045, spacing: 0.16, warm: '#ffd2a0' });
    rim.path(Array.from({ length: 49 }, (_, i) => V(Math.cos((i / 48) * Math.PI * 2) * 2.86, -0.06, Math.sin((i / 48) * Math.PI * 2) * 2.86)));
    this.add(rim.done());
    const ring: THREE.BufferGeometry[] = [];
    const RB = 3.7;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const seg = new THREE.BoxGeometry(0.06, 1.1, (2 * Math.PI * RB) / 28 - 0.05).translate(0, FL + 0.55, 0).rotateY(-a);
      seg.translate(Math.cos(a) * RB, 0, Math.sin(a) * RB);
      ring.push(seg);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(ring)!, steel));
    const b = booth({ w: 3.2, d: 1.0, strip: '#ffd2a0' });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 3.2, TABLE_Y, -0.5, 2023);
    this.add(new DustMotes(new THREE.Box3(V(-2.6, TABLE_Y - 0.3, -2.4), V(2.6, TABLE_Y + 2.6, 2.4)), 320, 2019));

    // the field: 43,000 lights on strings over the whole floor, hung from a grid of trusses
    const top = FL + 13.2;
    this.field = this.add(
      new LightField({ x0: -25, x1: 25, z0: -50, z1: 50, spacing: 0.76, bulbs: 5, yLow: FL + 5.0, yHigh: FL + 11.4, origin: V(0, FL + 8, 0), clear: 4.0 }, 42000),
    );
    for (const x of [-22.5, -13.5, -4.5, 4.5, 13.5, 22.5]) this.group.add(truss(V(x, top + 0.3, -53), V(x, top + 0.3, 53), 0.5));
    for (const z of [-45, -30, -15, 0, 15, 30, 45]) this.group.add(truss(V(-24, top + 0.75, z), V(24, top + 0.75, z), 0.4));
    // the field's glow lights the room, the riser and the people round it
    for (const [x, z, range] of [
      [-12, -24, 46],
      [12, -24, 46],
      [-12, 24, 46],
      [12, 24, 46],
      [0, 0, 24],
    ]) {
      const l = new THREE.PointLight(0xffd2a0, 0, range, 1.6);
      l.position.set(x, FL + 8, z);
      this.group.add(l);
      this.fieldLights.push(l);
    }

    // a surround PA: six hangs round the floor and two on the long axis, all aimed at the middle
    for (const [x, z] of [
      [-21, -30],
      [21, -30],
      [-21, 0],
      [21, 0],
      [-21, 30],
      [21, 30],
      [0, -48],
      [0, 48],
    ]) {
      const p = paHang(8, 1.1, 0.34, 0.7);
      p.position.set(x, FL + 12.4, z);
      p.rotation.y = Math.atan2(-x, -z);
      this.group.add(p);
    }
    const subs: { pos: THREE.Vector3; yaw: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      for (let k = 0; k < 2; k++) subs.push({ pos: V(Math.cos(a) * 4.6, FL + 0.4 + k * 0.81, Math.sin(a) * 4.6), yaw: Math.atan2(Math.cos(a), Math.sin(a)) });
    }
    this.group.add(cabinets(subs, 1.1, 0.8, 0.85, 'sub'));

    // a few beams and strobe bars from the four corners of the rig; the field is the show
    const corners = [
      [-20, -40],
      [20, -40],
      [-20, 40],
      [20, 40],
    ];
    const cornerHeads = new MovingHeads(
      corners.flatMap(([x, z]) => [-1.5, 0, 1.5].map((d) => ({ pos: V(x + d, top - 0.3, z), yaw: Math.atan2(x, z) }))),
      { length: 22, radius: 1.2, gain: 0.8, floorY: FL, haze: [FL + 1, FL + 22] },
    );
    cornerHeads.lightMap = this.lm;
    this.add(cornerHeads);
    this.add(new Strobes(corners.flatMap(([x, z]) => [-0.8, 0.8].map((d) => ({ pos: V(x + d, top - 0.4, z), tilt: Math.PI / 2 }))), [1.0, 0.12, 0.12]));

    // lasers: a ring on the riser firing up through the field, the grid's corners and both ends
    const ringAngles = Array.from({ length: 6 }, (_, k) => (k / 6) * Math.PI * 2 + Math.PI / 6);
    this.add(
      new Lasers(
        [
          ...ringAngles.map((a, k) => ({ pos: V(Math.cos(a) * 2.35, 0.08, Math.sin(a) * 2.35), dir: V(Math.cos(a), 1.1, Math.sin(a)), side: k % 2 ? 1 : -1, beams: 14, length: 60, alt: k % 2 === 1, skip: ['converge' as const] })),
          ...corners.map(([x, z], k) => ({ pos: V(x, top - 0.35, z), dir: V(Math.sign(x) * 0.5, 0.04, Math.sign(z)), side: Math.sign(x), beams: 16, length: 90, alt: k % 2 === 1 })),
          { pos: V(-9, top - 0.35, -42), dir: V(0.1, -0.02, 1), side: -1, beams: 18, length: 110 },
          { pos: V(9, top - 0.35, 42), dir: V(-0.1, -0.02, -1), side: 1, beams: 18, length: 110, alt: true },
        ],
        { room: hallRoom(FL, HALL.length / 2), audience: { floorY: FL, x0: -hw, x1: hw, z0: zB + 1, z1: -zB - 1 }, focus: V(0, FL + 11, 0), haze: [FL + 1, FL + 22] },
      ),
    );

    // the mix position, behind the DJ's back
    const FOH_Z = 34;
    const foh = block(8, 0.6, 5, black, 2);
    foh.position.set(0, FL + 0.3, FOH_Z);
    const desk = block(5.6, 0.95, 1.0, new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.4 }), 2);
    desk.position.set(0, FL + 1.08, FOH_Z - 0.6);
    this.group.add(foh, desk);
    this.add(new Crowd([-1.4, 0.2, 1.6].map((x) => ({ x, z: FOH_Z - 1.4, y: FL + 0.6, face: Math.PI, role: 'dj' as const })), { seed: 46, clothes: ['#0b0b0c', '#141516'] }));
    for (const s of [-1, 1]) {
      const sb = barCounter(13, { glow: '#ffc890', seed: s < 0 ? 2019 : 2023 });
      sb.position.set(s * (hw - 1.4), FL, 40);
      sb.rotation.y = -s * (Math.PI / 2);
      this.group.add(sb);
    }

    // the crowd all the way round: dancers near the riser, thousands more out to the walls
    const clothes = ['#0d0e10', '#16171a', '#1e2024', '#2a2c31', '#d8d5ce', '#3b2f2a', '#2a3644', '#4a3a2a', '#121212', '#9a948a'];
    // (and nobody standing on the crowd camera)
    const NEAR = 11;
    const near = crowdArea(-NEAR, NEAR, -NEAR, NEAR, 1.6, 2019, { y: FL }).filter((s) => {
      if (Math.hypot(s.x - 5.4, s.z + 8.6) < 1.7) return false;
      const r = Math.hypot(s.x, s.z);
      // clear of the barrier and the four sub stacks just outside it
      const a = Math.atan2(s.z, s.x) - Math.PI / 4;
      const toSub = Math.abs(a - Math.round(a / (Math.PI / 2)) * (Math.PI / 2));
      return r > RB + 0.45 && r < NEAR && !(toSub < 0.2 && r < 5.6);
    });
    this.add(new Crowd(near, { seed: 2023, clothes, phones: 0.05, drinks: 0.14, lightMap: this.lm }));
    const avoid = [
      new THREE.Box2(new THREE.Vector2(-5.5, FOH_Z - 3.5), new THREE.Vector2(5.5, FOH_Z + 3.5)),
      new THREE.Box2(new THREE.Vector2(-hw, 32), new THREE.Vector2(-hw + 4.5, 48)),
      new THREE.Box2(new THREE.Vector2(hw - 4.5, 32), new THREE.Vector2(hw, 48)),
    ];
    const density = (x: number, z: number) => {
      const r = Math.hypot(x, z);
      if (r < NEAR) return 0;
      if (Math.abs(x) > hw - 1.6) return 0;
      return 2.2 - 1.15 * Math.min(1, (r - NEAR) / 40);
    };
    this.add(new FarCrowd(scatter(-hw, hw, zB + 7.5, -zB - 2, density, 2023, avoid).map((p) => ({ ...p, y: FL })), { seed: 2019, clothes, phones: 0.04, focus: V(0, 3, 0), lightMap: this.lm }));

    this.add(new HazeLayer(new THREE.Box3(V(-26, FL + 3, -54), V(26, FL + 20, 54)), 7, 0.5, this.lm));
    // hazers round the riser
    this.add(new Hazers([0, 1, 2, 3].map((k) => {
      const a = (k / 4) * Math.PI * 2;
      return { pos: V(Math.cos(a) * 4.2, FL + 0.2, Math.sin(a) * 4.2), dir: V(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5) };
    })));
    this.wash(V(0, FL + 19, -30), 2, 8, 42, 0.4);
    this.wash(V(0, FL + 19, 30), 1, 8, 42, 0.4);
    // the field and the corner beams spill onto the people round the riser
    this.wash(V(0, FL + 6.5, -6), 0, 7, 18, 0.6);
    this.wash(V(0, FL + 6.5, 6), 1, 7, 18, 0.6);
  }

  /** a faint LED tile grid in front of a screen */
  private seams(screen: THREE.Mesh, w: number, h: number): void {
    const tex = ledSeamTexture().clone();
    tex.repeat.set(w * 2, h * 2);
    tex.userData.shared = false;
    tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.position.z = 0.015;
    screen.add(m);
  }

  update(...args: Parameters<VenueBase['update']>): void {
    // a new frame of light on the floor: the moving heads paint their pools as they update
    this.lm.begin();
    super.update(...args);
    const s: ShowState = args[0];
    const m = s.master;
    // strobes and blinders light the whole room at once
    const w = s.flash * 0.28 + s.strobe * m * 0.18;
    this.lm.flash(w, w, w * 1.05);
    if (this.screenAvg && this.wallLight) {
      // the LED wall's picture lights the front of the room in its own colours
      const col = this.screenAvg.color;
      const lum = col.r * 0.2126 + col.g * 0.7152 + col.b * 0.0722;
      this.lm.splat(0, -9, 17, 8, col, 1.1 * m);
      this.lm.splat(0, -17, 24, 15, col, 0.35 * m);
      this.wallLight.color.copy(col).multiplyScalar(1 / Math.max(0.05, Math.max(col.r, col.g, col.b)));
      this.wallLight.intensity = 90 * lum * m;
    }
    if (this.blinderLight) {
      this.lm.splat(0, -7.5, 18, 5, this.warm, s.blinder * 2.4);
      this.blinderLight.intensity = s.blinder * 60;
    }
    // the rose window catches the show's light
    const lit = (0.18 + s.wash * 0.25 + s.kick * 0.06 + s.flash * 0.6) * (0.4 + 0.6 * s.master);
    this.rose.color.setRGB(lit, lit, lit).lerp(this.c.copy(s.colors[0]).multiplyScalar(lit), 0.25);
    if (this.tally) this.tally.color.setRGB(s.playing ? 3 : 0.4, 0.15, 0.15);
    if (this.field) {
      const g = this.field.glow;
      for (const l of this.fieldLights) {
        l.color.copy(s.colors[0]).lerp(this.c.setRGB(1, 0.82, 0.62), 0.6);
        l.intensity = 18 * g;
      }
      // the floor and the people under the field catch its glow
      this.c.copy(s.colors[0]).lerp(this.warm.setRGB(1, 0.82, 0.62), 0.6);
      this.lm.splat(0, 0, 26, 52, this.c, 0.12 + g * 0.35);
      this.warm.setRGB(1, 0.62, 0.28);
    }
  }

  prerender(renderer: THREE.WebGLRenderer, dt: number): void {
    this.screenAvg?.update(renderer, this.visMaterials[0]?.map, dt);
    this.lm.render(renderer);
  }

  dispose(): void {
    super.dispose();
    this.lm.dispose();
    this.screenAvg?.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* catalogue entries                                                    */
/* ------------------------------------------------------------------ */

/** The hall's outline for the picker cards: the vault, ribs and the rose window. */
function hallThumb(g: CanvasRenderingContext2D, w: number, h: number, rose: boolean): void {
  g.fillStyle = '#05060a';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(190,180,165,0.32)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const k = 1 - i * 0.14;
    g.beginPath();
    g.ellipse(w / 2, h * (0.62 - i * 0.015), w * 0.62 * k, h * 0.6 * k, 0, Math.PI, Math.PI * 2);
    g.stroke();
  }
  if (rose) {
    const cx = w / 2;
    const cy = h * 0.26;
    const R = h * 0.13;
    g.fillStyle = '#1d3c8f';
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d08a1e';
    g.lineWidth = 1.2;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3);
      g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.stroke();
    }
    g.strokeStyle = '#8e1730';
    g.beginPath();
    g.arc(cx, cy, R * 0.55, 0, Math.PI * 2);
    g.stroke();
  }
}

export const allyPally: VenueDef = {
  id: 'allypally',
  name: 'Alexandra Palace',
  short: 'Ally Pally',
  place: 'London, UK',
  kind: 'Concert hall · Great Hall',
  blurb:
    'The Great Hall at its real size (116.6 × 55 m, 25 m to the crown of the fabric vault), with the organ and rose window at the far end. An arena production: a 23 m LED wall, live-camera LED towers, flown PA with delays, a rig of beams and strobe bars over about 8,000 people, lasers, CO2 and sparks.',
  palette: ['#ffffff', '#ff2a3c', '#7a3cff'],
  ui: '#ff3355',
  capacity: '10,250',
  note: 'The towers either side of the LED wall show the pit camera on you. Switch the camera to “From the stage” to look down the hall to the organ.',
  build: () => new AllyPally('arena'),
  thumb(g, w, h) {
    hallThumb(g, w, h, true);
    // the stage: LED wall, beams and lasers over the crowd
    const grad = g.createLinearGradient(w * 0.3, 0, w * 0.7, 0);
    grad.addColorStop(0, '#ff2a3c');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#7a3cff');
    g.fillStyle = grad;
    g.globalAlpha = 0.85;
    g.fillRect(w * 0.3, h * 0.5, w * 0.4, h * 0.12);
    g.globalAlpha = 1;
    laserLines(g, w * 0.35, h * 0.66, '#ff2a3c', 8, 1.2, h * 0.9, -Math.PI / 2 - 0.35);
    laserLines(g, w * 0.65, h * 0.66, '#7a3cff', 8, 1.2, h * 0.9, -Math.PI / 2 + 0.35);
    g.globalCompositeOperation = 'source-over';
    silhouettes(g, w, h, '#030305', 52);
  },
};

export const allyPallyRound: VenueDef = {
  id: 'allypally-round',
  name: 'Alexandra Palace · In the round',
  short: 'Ally Pally ◯',
  place: 'London, UK',
  kind: 'Concert hall · in the round',
  blurb:
    'The Great Hall with the decks on a round riser in the middle of the floor and the crowd all the way round, under a field of 43,000 hanging lights that plays the music in 3D: ripples on the kick, sheets of light through the build, the whole room on the drop. Surround PA.',
  palette: ['#ffd9a8', '#ffffff', '#7ab8ff'],
  ui: '#ffcf8a',
  capacity: '10,250',
  note: 'You’re in the middle of the room. The lights overhead play the music: watch the ripples on the kick and the sweep through a build-up.',
  build: () => new AllyPally('round'),
  thumb(g, w, h) {
    hallThumb(g, w, h, true);
    // the field in perspective, a ripple running out from the middle
    g.globalCompositeOperation = 'lighter';
    for (let row = 0; row < 9; row++) {
      const t = row / 8;
      const y = h * (0.42 + t * 0.32);
      const spread = 0.25 + t * 0.75;
      for (let i = 0; i < 26; i++) {
        const u = i / 25 - 0.5;
        const x = w / 2 + u * w * spread;
        const d = Math.hypot(u * 2, (t - 0.55) * 1.6);
        const lit = Math.exp(-Math.pow((d - 0.55) / 0.12, 2)) * 0.8 + 0.3;
        g.fillStyle = `rgba(255,${200 + Math.round(40 * lit)},${150 + Math.round(60 * lit)},${lit})`;
        g.beginPath();
        g.arc(x, y, 1 + t * 1.8, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalCompositeOperation = 'source-over';
    silhouettes(g, w, h, '#030305', 53);
  },
};
