/*
 * The Dome: a made-up arena (not modelled on, or affiliated with, any real
 * venue). A round floor 52 m across under a hemisphere whose whole inside is
 * one LED screen, springing from a 4.5 m wall.
 *
 *   the ceiling   domeScreen.ts draws it, domeEye.ts times it: a giant eye
 *                 over the stage that looks round the room in saccades every
 *                 2 beats, blinks every 4 bars, pumps its pupil with the kick,
 *                 squints through a build and stares wide on the drop; in the
 *                 groove and the peak, the visual player across the whole dome
 *   the stage     a round riser at one side of the floor, the booth near its
 *                 front, up-lights behind the DJ firing into the haze in
 *                 front of the eye, line arrays either side, subs at its feet,
 *                 a barrier round the front, blinders, CO2 and lasers on its lip
 *   the rig       a ring of moving heads and strobes on a circular truss over
 *                 the floor, hung from the dome on chain hoists
 *   the room      the crowd all over the floor (the jointed dancers near the
 *                 stage, cut-outs to the back), LED wristbands, haze, a mix
 *                 position, bars, exits and fire doors in the wall, a lit ring
 *                 where the dome springs
 *   the light     the dome lights the room: its average colour (the visual
 *                 player's, or the eye's white and amber glow) washes the
 *                 crowd and the floor, through the floor's light map and three
 *                 lights high in the dome
 *
 * Coordinates as every venue: metres, the DJ at the origin on the stage deck
 * (y = 0) facing −Z, the dance floor 1.2 m below.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { nameService } from '../../name/NameService';
import { nameStyleFor } from '../../name/venueStyles';
import { fxTier } from '../fx';
import type { FloorReflect } from '../reflect';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { atBar } from './crew';
import { barCounter, boothClutter, DustMotes, exitSign } from './details';
import { Dresser } from './dress';
import { DomeEye } from './domeEye';
import { domePatch, domeScreen, type DomeSpec, type DomeUniforms } from './domeScreen';
import { FarCrowd, scatter } from './farcrowd';
import { Blinders, booth, Co2Jets, Crowd, crowdArea, HazeLayer, Hazers, LedStrings, lineArray, MovingHeads, speakerGeometry, Strobes, TABLE_Y, truss } from './fixtures';
import { Lasers } from './lasers';
import { LightMap, ScreenAverage, useLightMap } from './lightmap';
import type { ShowState } from './show';
import { Wristbands } from './showfx';
import { canvasTexture, floorTexture, withSurface } from './tex';
import { silhouettes } from './warehouse';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The room's size (metres). */
export const DOME = {
  /** the hemisphere's radius: the floor is twice this across */
  radius: 26,
  /** the wall the dome springs from */
  drum: 4.5,
  /** the dome's middle, in front of the booth */
  centreZ: -15,
  /** the dance floor, below the stage deck */
  floorY: -1.2,
  /** the round stage: its radius and the z of its middle */
  stageR: 4.7,
  stageZ: 0.4,
};

const FL = DOME.floorY;
const R = DOME.radius;
const C = V(0, FL + DOME.drum, DOME.centreZ);
const SC = V(0, 0, DOME.stageZ);
/** the ring truss: its middle (over the floor) and radius */
const RING = { c: V(0, FL + 11.5, -19), r: 12.5 };

/** a point round the dome's middle: azimuth 0 is +Z (the stage), π/2 is +X */
const around = (a: number, r: number, y: number) => V(C.x + Math.sin(a) * r, y, C.z + Math.cos(a) * r);
/** a point round the stage's middle: angle 0 faces the crowd (−Z), π/2 is +X */
const onStage = (a: number, r: number, y: number) => V(SC.x + Math.sin(a) * r, y, SC.z - Math.cos(a) * r);

/** How far along a ray (unit `dir`) from a point inside the sphere it hits the inside (the far root). */
export function domeHit(from: THREE.Vector3, dir: THREE.Vector3, centre = C, radius = R): number {
  const ox = from.x - centre.x;
  const oy = from.y - centre.y;
  const oz = from.z - centre.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  return -b + Math.sqrt(Math.max(0, b * b - c));
}

const el = (deg: number) => V(0, Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180));

/** The ceiling as the shader sees it: drawn for a spot mid-crowd, the eye 30° up over the stage. */
export const DOME_SPEC: DomeSpec = {
  centre: C,
  radius: R,
  sweet: V(0, FL + 1.7, -17),
  eyeAt: el(30),
  // the eye covers ±34° across from the sweet spot: it fills the dome over the stage, and still fits a 50° lens from the floor
  eyeHalf: Math.tan((34 * Math.PI) / 180),
  visAt: el(34),
  visHalf: [1.25, 0.7],
  pitch: 0.025,
  panel: 0.5,
};

/** where the eye's middle is on the dome */
export const EYE_POINT = DOME_SPEC.sweet.clone().addScaledVector(DOME_SPEC.eyeAt, domeHit(DOME_SPEC.sweet, DOME_SPEC.eyeAt));

/** The dark acoustic slats of the wall round the floor. */
function slatTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'dome-slats',
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#0d0e11';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 16; i++) {
        const x = (i / 16) * w;
        const grad = g.createLinearGradient(x, 0, x + w / 16, 0);
        grad.addColorStop(0, '#16181c');
        grad.addColorStop(0.5, '#1d2025');
        grad.addColorStop(1, '#111215');
        g.fillStyle = grad;
        g.fillRect(x + 1, 0, w / 16 - 3, h);
      }
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(0, h - 3, w, 3);
    },
    { repeat: true },
  );
}

class Dome extends VenueBase {
  // polished concrete: the dome shows in it
  readonly reflect: FloorReflect[] = [
    { y: FL, strength: 0.5, rough: 0.38 },
    { y: 0, strength: 0.35, rough: 0.4 },
  ];
  readonly views: VenueViews;
  private eye = new DomeEye();
  private u: DomeUniforms;
  private lm: LightMap;
  private avg = new ScreenAverage();
  private lights: THREE.PointLight[] = [];
  private col = new THREE.Color();
  private eyeLight = new THREE.Color();
  private glow = new THREE.Color();
  private amber = new THREE.Color(1, 0.55, 0.22);
  private flash = 0;

  constructor() {
    super({ fog: 0x05040a, fogDensity: 0.0115, hemiSky: 0x2a2836, hemiGround: 0x0c0b10, hemi: 0.16, flashAt: V(0, 14, -14), flashRange: 70 });
    // ACES, for blacks as deep as an LED screen switched to black: the eye's sky has to read as dark
    this.toneMapping = 'aces';
    this.keyLight = { color: 0xfff0e2, intensity: 12 };
    this.grade = { tint: 0xfbf7ff, contrast: 1.1, saturation: 1.06, lift: 0 };
    this.lm = new LightMap(new THREE.Vector2(-R, C.z - R), new THREE.Vector2(2 * R, 2 * R), [192, 192]);
    const d = new Dresser(4404);
    this.u = this.buildShell(d);
    this.buildStage(d);
    this.buildRig();
    this.buildCrowd(d);
    this.dress(d);
    this.add(d.done());

    const eye = EYE_POINT;
    this.views = {
      wide: { pos: V(-7.5, FL + 5.4, -36), target: V(0, 9.5, 0) },
      wideLabel: 'From the back',
      director: {
        style: 'festival',
        landmarks: [
          // from the floor, looking up into it
          { label: 'The eye', from: { pos: V(1.6, FL + 1.65, -11), target: eye.clone().add(V(0, -1.5, 0)) }, to: { pos: V(1.2, FL + 1.65, -13), target: eye.clone() }, fov: 50 },
          { label: 'Under the dome', from: { pos: V(-7, FL + 1.6, -31), target: V(-1, 21, -6) }, to: { pos: V(-6, FL + 1.6, -29), target: V(-4, 23, -8) }, fov: 64 },
          // a long lens on the iris: the LEDs show
          { label: 'Into the eye', from: { pos: V(-2.2, FL + 1.7, -19), target: eye.clone() }, fov: 13 },
        ],
      },
      extra: {
        crane: { radius: 4.6, low: 1.8, high: 4.8 },
        rig: { pos: V(3, RING.c.y - 0.6, RING.c.z + RING.r), target: V(0, 1, 0.2) },
        cctv: { pos: around(-2.35, R - 1.2, FL + 4.2), target: V(0, 0.5, -4) },
        camcorder: { pos: V(1.4, 0.45, -7.4), target: V(0, 1.4, 0.6) },
        vertigo: { near: 2.4, far: 7.5, height: 1.9 },
      },
      crowd: { pos: V(3.4, FL + 1.75, -13.5), target: V(0, 5.2, 1.5) },
      drone: [
        V(0, 4.2, 5.2), V(3.2, 1.8, 2.8), V(5.4, 1.5, -1.2), V(6.5, 2.8, -8), V(7.5, 5.8, -16), V(4, 8.2, -25), V(-4, 8.6, -28),
        V(-10, 7, -20), V(-11, 4.6, -10), V(-7, 2.2, -4.5), V(-3.2, 1.4, -2.6), V(0, 1.3, -2.4), V(3.2, 1.4, -2.6), V(4.5, 3.4, 1.5),
      ],
    };
  }

  /** The floor, the wall round it, the ring where the dome springs, and the dome. */
  private buildShell(d: Dresser): DomeUniforms {
    const ft = floorTexture('#141417', 'dome');
    ft.repeat.set(14, 14);
    const floorMat = withSurface(new THREE.MeshStandardMaterial({ map: ft, metalness: 0.08 }), 'dome-floor', { bumps: 0.25, grain: 0.3, seams: 64, rough: 0.5, roughVar: 0.08, polish: 0.3, repeat: 14, normalScale: 0.4 });
    useLightMap(floorMat, this.lm, 0.75);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), floorMat);
    floor.position.set(C.x, FL, C.z);
    floor.receiveShadow = true;
    this.group.add(floor);

    const slats = slatTexture();
    slats.repeat.set(160, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: slats, roughness: 0.85, metalness: 0.05, side: THREE.BackSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, DOME.drum, 128, 1, true), wallMat);
    wall.position.set(C.x, FL + DOME.drum / 2, C.z);
    this.group.add(wall);
    // the ring beam the dome stands on, with a line of light along it
    const beam = new THREE.Mesh(new THREE.TorusGeometry(R - 0.2, 0.22, 6, 160).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.7, roughness: 0.45 }));
    beam.position.copy(C);
    this.group.add(beam);
    const springing = new LedStrings({ size: 0.05, spacing: 0.3 });
    springing.path(Array.from({ length: 161 }, (_, i) => around((i / 160) * Math.PI * 2, R - 0.45, C.y - 0.32)));
    this.add(springing.done());

    // the dome: one mesh, one material, the visual player's texture handed to it like any screen
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.BackSide });
    const u = domeScreen(mat, DOME_SPEC);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 112, 40, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.position.copy(C);
    this.visMaterials.push(mat);
    this.visObjects.push(dome);
    this.group.add(dome);

    // the DJ name on the dome, low over the stage (on drops, through builds and a phrase every 32 bars)
    const az = 0.27;
    const e0 = 0.03;
    const e1 = 0.15;
    const name = new THREE.Mesh(domePatch(R, -az, az, e0, e1, 0.12), nameService.material(nameStyleFor('dome').screen!, 2 * R * Math.sin(az), R * (e1 - e0), { screen: true, gain: 1.15 }));
    name.position.copy(C);
    name.renderOrder = 3;
    this.group.add(name);

    // exits: fire doors in the wall either side of the stage and round the back, the main way in at the back
    for (const a of [1.08, -1.08, 2.0, -2.0]) d.fireDoor(around(a, R - 0.04, FL), a + Math.PI, 1.8, 2.3);
    const main = around(Math.PI, R - 0.05, FL);
    d.box('blackMetal', 4.6, 0.3, 0.3, main.x, FL + 3.05, main.z + 0.1);
    for (const s of [-1, 1]) d.box('blackMetal', 0.3, 3.2, 0.3, main.x + s * 2.15, FL + 1.6, main.z + 0.1);
    // the lit corridor out to the foyer
    d.put(d.glow('#ffd9a8', 'steady', 0.55), new THREE.PlaneGeometry(4.0, 2.9).translate(main.x, FL + 1.45, main.z + 0.04));
    this.group.add(exitSign(V(main.x, FL + 3.5, main.z + 0.2), 0));
    for (const [a, word] of [
      [1.55, 'TOILETS'],
      [-1.55, 'TOILETS'],
      [2.75, 'CLOAKROOM'],
    ] as [number, string][]) {
      d.sign(word, around(a, R - 0.06, FL + 2.9), a + Math.PI, 1.9, 0.55, '#121318', '#f2ead8');
    }
    for (const a of [1.2, -1.2, 1.88, -1.88, 2.9, -2.9]) {
      d.extinguisher(around(a, R - 0.08, FL + 0.4), a + Math.PI);
      d.callPoint(around(a + 0.03, R - 0.07, FL + 1.4), a + Math.PI);
    }
    return u;
  }

  /** The round stage, the booth, the PA and the stage's own lights and effects. */
  private buildStage(d: Dresser): void {
    const black = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.75 });
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(DOME.stageR, DOME.stageR + 0.08, -FL, 72), black);
    stage.position.set(SC.x, FL / 2, SC.z);
    this.group.add(stage);
    // a ring of light round the stage's edge, and one at its foot
    const rim = new LedStrings({ size: 0.045, spacing: 0.14 });
    rim.path(Array.from({ length: 73 }, (_, i) => onStage((i / 72) * Math.PI * 2, DOME.stageR + 0.1, -0.05)));
    rim.path(Array.from({ length: 73 }, (_, i) => onStage((i / 72) * Math.PI * 2, DOME.stageR + 0.14, FL + 0.08)));
    this.add(rim.done());

    const b = booth({ w: 3.2, d: 1.0, strip: '#19d3c5', name: nameStyleFor('dome').booth });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 3.2, TABLE_Y, -0.5, 4405);
    this.add(new DustMotes(new THREE.Box3(V(-2.6, TABLE_Y - 0.3, -2.4), V(2.6, TABLE_Y + 2.6, 1.8)), 300, 4406));

    // line arrays either side, flown from the dome's structure; subs stacked at the stage's feet
    for (const s of [-1, 1]) {
      const pa = lineArray(10, 1.0, 0.34, 0.7);
      pa.position.set(s * 8.6, FL + 11.2, -0.6);
      pa.rotation.y = Math.PI + s * 0.16;
      this.group.add(pa);
      d.rod('blackMetal', V(s * 8.6, FL + 11.25, -0.6), V(s * 8.6, C.y + Math.sqrt(R * R - 8.6 * 8.6 - 14.4 * 14.4), -0.6), 0.012, 4);
    }
    const subGeo = speakerGeometry(1.1, 0.78, 0.85, 'sub');
    const subs = new THREE.InstancedMesh(subGeo, [new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.62, metalness: 0.1 }), new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.85 })], 12);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let k = 0;
    for (const a of [-1.2, -0.95, 0.95, 1.2]) {
      const p = onStage(a, DOME.stageR + 0.75, FL + 0.39);
      for (let h = 0; h < 3; h++) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - a);
        subs.setMatrixAt(k++, m4.compose(V(p.x, FL + 0.39 + h * 0.79, p.z), q, new THREE.Vector3(1, 1, 1)));
      }
    }
    this.group.add(subs);

    // up-lights behind the DJ, firing up through the haze in front of the eye
    this.add(new MovingHeads([-1.25, -0.75, -0.3, 0.3, 0.75, 1.25].map((a) => ({ pos: onStage(Math.PI + a, 3.7, 0.3), up: true })), { length: 16, radius: 0.8, gain: 0.85, floorY: FL, haze: [FL + 1, FL + 22] }));
    // blinders and CO2 round the lip, lasers either side of the booth
    this.add(new Blinders([-0.9, -0.55, -0.2, 0.2, 0.55, 0.9].map((a) => ({ pos: onStage(a, DOME.stageR + 0.18, -0.45), yaw: -a, tilt: -0.15 }))));
    this.add(new Co2Jets([-1.05, -0.38, 0.38, 1.05].map((a) => onStage(a, DOME.stageR - 0.3, 0.02)), 12));
    const lasers = [-0.7, -0.25, 0.25, 0.7].map((a) => onStage(a, DOME.stageR - 0.45, 0.12));
    this.add(
      new Lasers(
        lasers.map((p, i) => ({ pos: p, dir: V(p.x * 0.05, 0.28, -1), side: i < 2 ? -1 : 1, beams: 14, length: 60, alt: i === 1 || i === 2, color: i % 2 ? '#ffa53a' : '#19d3c5' })),
        {
          room: { floorY: FL, x0: -R, x1: R, z0: C.z - R, z1: C.z + R, dome: { centre: C.clone(), radius: R }, solids: [new THREE.Box3(V(-DOME.stageR, FL, SC.z - DOME.stageR), V(DOME.stageR, 0, SC.z + DOME.stageR))] },
          audience: { floorY: FL, x0: -R, x1: R, z0: C.z - R, z1: -5.6 },
          focus: V(0, 10, -22),
          haze: [FL + 1, FL + 22],
        },
      ),
    );
    this.add(new Hazers([-1.3, 1.3].map((a) => ({ pos: onStage(Math.PI + a, 3.9, 0.15), dir: V(-Math.sin(a) * 0.2, 0, -0.5) }))));
    // the stage's own colour, behind the DJ and on the deck
    this.wash(V(0, 6, 3.5), 0, 6, 14);
    this.wash(V(0, 5, -3), 1, 4, 12, 0.6);
  }

  /** The ring truss over the floor: moving heads and strobes, on chain hoists up to the dome. */
  private buildRig(): void {
    const n = 28;
    const segs: THREE.BufferGeometry[] = [];
    let steel: THREE.Material | THREE.Material[] = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const t = truss(V(RING.c.x + Math.sin(a0) * RING.r, RING.c.y, RING.c.z + Math.cos(a0) * RING.r), V(RING.c.x + Math.sin(a1) * RING.r, RING.c.y, RING.c.z + Math.cos(a1) * RING.r), 0.4);
      t.updateMatrix();
      segs.push(t.geometry.clone().applyMatrix4(t.matrix));
      steel = t.material;
    }
    // one mesh for the whole ring
    const ring = new THREE.Mesh(mergeGeometries(segs)!, steel);
    for (const g of segs) g.dispose();
    this.group.add(ring);
    // hoists: chains from eight points on the ring up to the dome
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      const x = RING.c.x + Math.sin(a) * RING.r;
      const z = RING.c.z + Math.cos(a) * RING.r;
      const top = C.y + Math.sqrt(Math.max(0, R * R - x * x - (z - C.z) * (z - C.z))) - 0.3;
      pts.push(x, RING.c.y + 0.2, z, x, top, z);
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.group.add(new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: 0x2a2b30 })));

    const heads = new MovingHeads(
      Array.from({ length: 20 }, (_, i) => {
        const a = ((i + 0.5) / 20) * Math.PI * 2;
        return { pos: V(RING.c.x + Math.sin(a) * RING.r, RING.c.y - 0.5, RING.c.z + Math.cos(a) * RING.r), yaw: a };
      }),
      { length: 15, radius: 1.1, gain: 0.9, floorY: FL, haze: [FL + 1, FL + 22] },
    );
    heads.lightMap = this.lm;
    this.add(heads);
    this.add(new Strobes(Array.from({ length: 8 }, (_, i) => ({ pos: V(RING.c.x + Math.sin((i / 8) * Math.PI * 2) * RING.r, RING.c.y - 0.35, RING.c.z + Math.cos((i / 8) * Math.PI * 2) * RING.r), yaw: (i / 8) * Math.PI * 2, tilt: Math.PI / 2 })), [0.9, 0.14, 0.12]));
  }

  /** The crowd over the floor, the mix position and the bars. */
  private buildCrowd(d: Dresser): void {
    const clothes = ['#0d0e10', '#17181b', '#1f2125', '#2b2d32', '#d9d6cf', '#3a2f2a', '#26323f', '#4a3a2a', '#121212', '#8f8a82'];
    const FOH = V(0, FL, -29);
    // room on the floor for the crowd camera and the eye's landmark shots
    const cams = [V(3.4, 0, -13.5), V(1.6, 0, -11), V(1.2, 0, -13), V(-2.2, 0, -19), V(-7, 0, -31), V(-6, 0, -29)];
    // on the floor: inside the wall, clear of the barrier, not behind the stage's front line
    const onFloor = (x: number, z: number) => {
      const rc = Math.hypot(x - C.x, z - C.z);
      const rs = Math.hypot(x - SC.x, z - SC.z);
      if (rc > R - 1.6 || rs < DOME.stageR + 1.9) return false;
      if (z > SC.z - 2 && Math.abs(x) < DOME.stageR + 3.2) return false;
      if (z > 2.5) return false;
      if (Math.abs(x - FOH.x) < 4.5 && Math.abs(z - FOH.z) < 3.5) return false;
      return cams.every((c) => Math.hypot(x - c.x, z - c.z) > 1.3);
    };
    const NEAR = 14;
    const near = crowdArea(-14, 14, 2.5, -14, 1.7, 4410, { y: FL }).filter((s) => onFloor(s.x, s.z) && Math.hypot(s.x - SC.x, s.z - SC.z) < NEAR);
    this.add(new Crowd(near, { seed: 4411, clothes, phones: 0.08, drinks: 0.14, signs: 4, lightMap: this.lm }));
    const bars = [2.55, -2.55].map((a) => around(a, R - 2.1, FL));
    const avoid = bars.map((p) => new THREE.Box2(new THREE.Vector2(p.x - 5.5, p.z - 3.5), new THREE.Vector2(p.x + 5.5, p.z + 3.5)));
    const density = (x: number, z: number) => {
      if (!onFloor(x, z) || Math.hypot(x - SC.x, z - SC.z) < NEAR) return 0;
      // packed towards the stage, thinning to the back wall
      return 2.1 - 1.0 * Math.min(1, Math.max(0, (C.z - z + 4) / 24));
    };
    const standing = scatter(-R, R, C.z - R, 3, density, 4412, avoid).map((p) => ({ ...p, y: FL }));
    this.add(new FarCrowd(standing, { seed: 4413, clothes, phones: 0.06, focus: V(0, 3, 0), lightMap: this.lm }));
    this.add(new Wristbands(standing, { origin: new THREE.Vector2(SC.x, SC.z), seed: 4414 }));

    // the mix position: a riser, the desk, two engineers, the snake under a ramp to the stage
    const riser = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 4), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.8 }));
    riser.position.set(FOH.x, FL + 0.25, FOH.z);
    this.group.add(riser);
    d.foh(V(FOH.x, FL + 0.5, FOH.z + 0.6), 0, 2.8);
    d.ampRack(V(FOH.x - 2.2, FL + 0.5, FOH.z - 1.4), 0, 8);
    d.ampRack(V(FOH.x + 2.2, FL + 0.5, FOH.z - 1.4), 0, 8);
    this.add(new Crowd([-0.7, 0.8].map((x) => ({ x, z: FOH.z - 0.3, y: FL + 0.5, face: Math.PI, role: 'dj' as const })), { seed: 4415, clothes: ['#0b0b0c', '#141516'] }));
    d.cableRamp(V(0.5, FL, FOH.z + 2.2), V(0.5, FL, SC.z - DOME.stageR - 1.4));
    for (const s of [-1, 1]) {
      const p = V(s * 3.4, FL, FOH.z + 2.2);
      d.stanchions(p, p.clone().add(V(0, 0, -4.4)));
    }

    // two bars at the back, against the wall
    bars.forEach((p, i) => {
      const a = i ? -2.55 : 2.55;
      const bar = barCounter(9, { glow: '#ffbf80', seed: 4416 + i });
      bar.position.copy(p);
      bar.rotation.y = a + Math.PI;
      this.group.add(bar);
      this.add(atBar(bar, 9, 4418 + i, { staff: 2, leaners: 3 }));
    });

    this.add(new HazeLayer(new THREE.Box3(V(-23, FL + 2.5, C.z - 23), V(23, FL + 19, 8)), 7, 0.35, this.lm));
    // the dome's light on the room: three lights high up, and the floor's light map
    for (const [z, y, range] of [
      [-4, FL + 15, 34],
      [-18, FL + 19, 42],
      [-32, FL + 14, 34],
    ]) {
      const l = new THREE.PointLight(0xffffff, 0, range, 1.5);
      l.position.set(0, y, z);
      this.group.add(l);
      this.lights.push(l);
    }
  }

  /** The stage's back and wings, the floor after a night. */
  private dress(d: Dresser): void {
    // steps up the back of the stage, racks and cases behind the booth, cable off to the wing
    for (const s of [-1, 1]) {
      const x = s * 2.1;
      const edge = SC.z + Math.sqrt(DOME.stageR * DOME.stageR - x * x);
      d.steps(V(x, FL, edge + 7 * 0.28), Math.PI, 7, 1.1, -FL / 7, 0.28);
      d.ampRack(V(s * 3.4, 0, 3.0), Math.PI + s * 0.5, 8);
      d.roadCase(V(s * 3.0, 0, 3.9), Math.PI + s * 0.4, 1.2, 0.8, 0.7);
      d.roadCase(V(s * 3.0, 0.8, 3.9), Math.PI + s * 0.45, 1.0, 0.5, 0.6);
      d.tube('rubber', [V(s * 1.7, 0.012, 0.5), V(s * 2.6, 0.012, 1.8), V(s * 3.2, 0.012, 2.8)], 0.014, 4);
      d.wedge(V(s * 2.0, 0, -0.4), Math.atan2(-s * 2.0, 1.1));
    }
    // the barrier round the front of the stage
    const arc = Array.from({ length: 13 }, (_, i) => onStage(-1.45 + (i / 12) * 2.9, DOME.stageR + 1.55, FL));
    for (let i = 0; i < arc.length - 1; i++) d.barrier(arc[i + 1], arc[i]);
    // the floor: worn concrete, the night's cups thickest at the front
    d.wear(-14, 14, -16, -5, FL, 'dome', 4420, 'dark');
    d.litter(-12, 12, -14, -6, 160, FL);
    d.litter(-18, 18, -36, -14, 120, FL);
  }

  update(...args: Parameters<VenueBase['update']>): void {
    const [s, , dt] = args;
    this.lm.begin();
    super.update(...args);
    const e = this.eye.update(s, dt);
    const u = this.u;
    const m = s.master;
    u.uScreen.value = e.screen;
    u.uOpen.value = e.open;
    u.uGaze.value.set(e.gaze[0], e.gaze[1]);
    u.uPupil.value = e.pupil;
    u.uWide.value = e.wide;
    u.uKick.value = s.kick;
    u.uBeat.value = e.beat;
    u.uTime.value = s.t;
    u.uDetail.value = fxTier() === 'low' ? 0 : 1;
    // the screen follows the show's blackouts, so the drop lands out of the dark
    u.uLevel.value = 0.06 + 0.94 * m;
    if (s.dropHit) this.flash = 1;
    this.flash *= Math.exp(-dt * 6);
    u.uFlash.value = this.flash * (s.reduceFlash ? 0.05 : 0.22) * m;
    // the glow round the eye: amber, leaning a little to the show's colour
    this.glow.copy(this.amber).lerp(s.colors[0], 0.22);
    u.uGlow.value.copy(this.glow);
    this.light(s, e.screen, e.open, e.wide);
  }

  /** The dome lights the room: the visual player's colour, or the eye's, crossfaded as the dome is. */
  private light(s: ShowState, screen: number, open: number, wide: number): void {
    domeLight(this.avg.color, screen, open, s.kick, wide, this.glow, this.col);
    const lvl = (0.06 + 0.94 * s.master) * Math.min(1.3, s.intensity);
    const lum = this.col.r * 0.2126 + this.col.g * 0.7152 + this.col.b * 0.0722;
    const peak = Math.max(this.col.r, this.col.g, this.col.b, 0.05);
    this.eyeLight.copy(this.col).multiplyScalar(1 / peak);
    for (const l of this.lights) {
      l.color.copy(this.eyeLight);
      l.intensity = 70 * lum * lvl;
    }
    // over the whole floor, brighter towards the front where the dome's middle is
    this.lm.splat(0, C.z, R, R, this.col, 0.9 * lvl);
    this.lm.splat(0, -8, 14, 10, this.col, 0.5 * lvl);
    const f = s.flash * 0.25 + s.strobe * s.master * 0.16;
    this.lm.flash(f, f, f * 1.05);
  }

  prerender(renderer: THREE.WebGLRenderer, dt: number): void {
    this.avg.update(renderer, this.visMaterials[0]?.map, dt);
    this.lm.render(renderer);
  }

  dispose(): void {
    super.dispose();
    this.lm.dispose();
    this.avg.dispose();
  }
}

/**
 * The light the dome throws on the room (linear colour into `out`): the
 * visual player's average colour where it shows, and where the eye shows, its
 * white and iris (more of them the wider it's open) and the glow round it.
 * `screen` is the crossfade (0 the visual player .. 1 the eye).
 */
export function domeLight(vis: THREE.Color, screen: number, open: number, kick: number, wide: number, glow: THREE.Color, out: THREE.Color): THREE.Color {
  const white = Math.max(0, Math.min(1.4, open)) * 0.07;
  const g = 0.07 + 0.05 * kick + 0.14 * wide;
  const k = Math.max(0, Math.min(1, screen));
  // the mirrored copies further out are dimmer: about two thirds of the main frame overall
  out.setRGB(vis.r * 0.65 * (1 - k), vis.g * 0.65 * (1 - k), vis.b * 0.65 * (1 - k));
  out.r += (white * 0.92 + glow.r * g) * k;
  out.g += (white * 0.88 + glow.g * g) * k;
  out.b += (white * 0.84 + glow.b * g) * k;
  return out;
}

export const dome: VenueDef = {
  id: 'dome',
  name: 'The Dome',
  short: 'Dome',
  place: 'Anywhere',
  kind: 'Arena · LED dome',
  blurb: 'A round arena under one giant LED dome, and an eye up there watching the crowd.',
  palette: ['#19d3c5', '#ffa53a', '#8a5cff'],
  ui: '#19d3c5',
  capacity: '4,500',
  note: 'Look up: the whole ceiling is one screen.',
  build: () => new Dome(),
  thumb(g, w, h) {
    g.fillStyle = '#040308';
    g.fillRect(0, 0, w, h);
    const cx = w / 2;
    const base = h * 0.86;
    const rx = w * 0.62;
    const ry = h * 0.84;
    // the dome, its panel rings, and the glow round the eye
    g.save();
    g.beginPath();
    g.ellipse(cx, base, rx, ry, 0, Math.PI, Math.PI * 2);
    g.closePath();
    g.clip();
    const sky = g.createRadialGradient(cx, h * 0.36, 4, cx, h * 0.36, w * 0.5);
    sky.addColorStop(0, 'rgba(255,150,60,0.55)');
    sky.addColorStop(0.35, 'rgba(120,50,30,0.25)');
    sky.addColorStop(1, 'rgba(10,6,18,1)');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160,140,220,0.12)';
    g.lineWidth = 1;
    for (let i = 1; i < 9; i++) {
      g.beginPath();
      g.ellipse(cx, base, rx * (i / 9), ry * (i / 9), 0, Math.PI, Math.PI * 2);
      g.stroke();
    }
    for (let i = 1; i < 16; i++) {
      const a = Math.PI + (i / 16) * Math.PI;
      g.beginPath();
      g.moveTo(cx, base);
      g.lineTo(cx + Math.cos(a) * rx, base + Math.sin(a) * ry);
      g.stroke();
    }
    // the eye
    const ex = cx;
    const ey = h * 0.38;
    const ew = w * 0.27;
    const eh = h * 0.17;
    g.beginPath();
    g.moveTo(ex - ew, ey);
    g.quadraticCurveTo(ex, ey - eh * 1.6, ex + ew, ey);
    g.quadraticCurveTo(ex, ey + eh * 1.2, ex - ew, ey);
    g.closePath();
    g.fillStyle = '#e4ddd2';
    g.fill();
    g.save();
    g.clip();
    const ir = eh * 0.95;
    const iris = g.createRadialGradient(ex + ew * 0.08, ey - eh * 0.05, ir * 0.2, ex + ew * 0.08, ey - eh * 0.05, ir);
    iris.addColorStop(0, '#16b8b0');
    iris.addColorStop(0.55, '#c98a2a');
    iris.addColorStop(0.9, '#ffa53a');
    iris.addColorStop(1, '#3a2208');
    g.fillStyle = iris;
    g.beginPath();
    g.arc(ex + ew * 0.08, ey - eh * 0.05, ir, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#020203';
    g.beginPath();
    g.arc(ex + ew * 0.08, ey - eh * 0.05, ir * 0.36, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.arc(ex + ew * 0.08 - ir * 0.35, ey - eh * 0.05 - ir * 0.35, ir * 0.12, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.strokeStyle = '#0a0606';
    g.lineWidth = 2.5;
    g.stroke();
    g.restore();
    // the stage, its beams, the crowd
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x = cx + (i - 2.5) * w * 0.06;
      const grad = g.createLinearGradient(x, h * 0.78, x + (i - 2.5) * 30, h * 0.2);
      grad.addColorStop(0, i % 2 ? 'rgba(255,165,58,0.5)' : 'rgba(25,211,197,0.5)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - 2, h * 0.78);
      g.lineTo(x + 2, h * 0.78);
      g.lineTo(x + (i - 2.5) * 30 + 14, h * 0.2);
      g.lineTo(x + (i - 2.5) * 30 - 14, h * 0.2);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#0b0c10';
    g.beginPath();
    g.ellipse(cx, h * 0.8, w * 0.16, h * 0.035, 0, 0, Math.PI * 2);
    g.fill();
    silhouettes(g, w, h, '#020205', 77);
  },
};
