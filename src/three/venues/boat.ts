/*
 * The Boat Party (Section 5.2): capacity 400. A two-level party boat on the
 * river at night: the booth at the stern of the top deck, the crowd packed
 * on the top deck and on the open bow deck below, strung lights along the
 * rails, LED strips on the deck edges, the city's lights passing on both
 * banks and the bridges coming over. Open air with water all round
 * (audio/room.ts), the engine's hum and the water lapping. Unlocked by
 * playing the Boat Party booking offer.
 *
 * Signature moment: the boat passes under a bridge mid-drop. A bridge set
 * up during a build is hurried along when the drop lands, and as it passes
 * overhead the sound echoes off it (the room's reverb swells) and the crowd
 * screams.
 *
 * TODO: procedural stand-in for the Blender boat set (Section 14).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { nameStyleFor } from '../../name/venueStyles';
import type { Features } from '../../visualizer/AudioFeatures';
import type { VenueDef, VenueViews } from './base';
import { boothClutter } from './details';
import { crewArc, security, vipCrew } from './crew';
import { booth, Crowd, crowdArea, HazeLayer, LedStrings, MovingHeads, speaker, Strobes, TABLE_Y, truss } from './fixtures';
import { moments, setClock } from './moments';
import { OpenAir } from './openair';
import { Water, type SkyKey } from './outdoor';
import type { ShowState } from './show';
import { canvasTexture, rng, windowsTexture } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** the boat: top deck at y = 0 */
const TOP = { x: 4.6, z0: -14, z1: 4.5 };
const LOWER_Y = -2.7;
const WATER_Y = -4.3;
/** the river: banks either side */
const BANK_X = 34;
/** one stretch of bank, repeated as the boat goes */
const SEG = 120;
const SEGS = 5;
/** how fast the city goes by (m/s) */
const SPEED = 4.5;

export const BOAT_SKY: SkyKey[] = [
  { k: 0, zenith: '#0c1640', horizon: '#3a3a6a', ground: '#080c18', sun: -6, sunColor: '#ff6a3a', light: 0, ambSky: '#2a3260', ambGround: '#0c0c14', amb: 0.3, stars: 0.3, night: 0.8 },
  { k: 1, zenith: '#04060f', horizon: '#241c38', ground: '#05070c', sun: -14, sunColor: '#ff6a3a', light: 0, ambSky: '#1a2048', ambGround: '#08080c', amb: 0.22, stars: 0.7, night: 1 },
];

/** a stretch of bank: the quay wall, a row of buildings with lit windows, lamps along the edge */
function bankSegment(seed: number, side: -1 | 1): { group: THREE.Group; lamps: THREE.Vector3[] } {
  const r = rng(seed);
  const group = new THREE.Group();
  const quay = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, SEG), new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.9 }));
  quay.position.set(side * (BANK_X + 3), WATER_Y + 1.4, 0);
  group.add(quay);
  const geos: THREE.BufferGeometry[] = [];
  let z = -SEG / 2;
  while (z < SEG / 2) {
    const w = 8 + r() * 14;
    const d = 10 + r() * 10;
    const h = 10 + Math.pow(r(), 1.5) * 50;
    const g = new THREE.BoxGeometry(d, h, w);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4);
      const fw = face < 2 ? w : d;
      uv.setXY(i, uv.getX(i) * (fw / 16), uv.getY(i) * (h / 36));
    }
    g.translate(side * (BANK_X + 9 + d / 2 + r() * 6), WATER_Y + 3 + h / 2, z + w / 2);
    geos.push(g.toNonIndexed());
    z += w + 1 + r() * 4;
  }
  const win = windowsTexture(`river:${seed % 3}`, '#ffd9a0', 0.5);
  const bld = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshStandardMaterial({ color: 0x1c1e24, roughness: 0.9, emissive: 0xffffff, emissiveMap: win, emissiveIntensity: 0.8 }));
  group.add(bld);
  const lamps: THREE.Vector3[] = [];
  for (let k = -SEG / 2; k < SEG / 2; k += 12) lamps.push(V(side * (BANK_X + 0.6), WATER_Y + 5.6, k));
  const poles = mergeGeometries(lamps.map((p) => new THREE.CylinderGeometry(0.06, 0.08, 2.6, 5).translate(p.x, p.y - 1.3, p.z)))!;
  group.add(new THREE.Mesh(poles, new THREE.MeshStandardMaterial({ color: 0x1a1a1e })));
  return { group, lamps };
}

/** a bridge over the river: the deck, piers, arches and lamps along both parapets */
function bridge(): { group: THREE.Group; lamps: THREE.Vector3[] } {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.9 });
  const span = BANK_X * 2 + 16;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 1.6, 12), stone);
  deck.position.y = 9.2;
  group.add(deck);
  // a shallow arch under the deck
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 11.6, 48, 1, true, -0.62, 1.24).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.9, side: THREE.DoubleSide }));
  arch.position.y = 8.3 - 42 + 3.2;
  arch.rotation.y = Math.PI / 2;
  group.add(arch);
  for (const s of [-1, 1]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(6, 14, 12.4), stone);
    pier.position.set(s * (BANK_X - 1), WATER_Y + 7, 0);
    group.add(pier);
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(span, 1.0, 0.4), stone);
    parapet.position.set(0, 10.5, s * 5.8);
    group.add(parapet);
  }
  const lamps: THREE.Vector3[] = [];
  for (let x = -BANK_X; x <= BANK_X; x += 6) for (const s of [-1, 1]) lamps.push(V(x, 11.6, s * 5.8));
  // lamps on the underside: the boat goes under them
  for (let x = -12; x <= 12; x += 6) lamps.push(V(x, 8.25, 0));
  return { group, lamps };
}

/** a little boat going the other way, people on deck waving */
class PassingBoat {
  readonly group = new THREE.Group();
  private arms: THREE.Mesh[] = [];
  z = -600;
  side: -1 | 1 = 1;

  constructor() {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.6, 14), new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.6 }));
    hull.position.y = WATER_Y + 0.6;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.8, 6),
      new THREE.MeshStandardMaterial({
        color: 0x2a2c30,
        emissive: 0xffffff,
        emissiveIntensity: 1.2,
        emissiveMap: canvasTexture('pboat-win', 64, 32, (g, w, h) => {
          g.fillStyle = '#000';
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#ffd9a0';
          for (let x = 4; x < w; x += 12) g.fillRect(x, 10, 8, 10);
        }),
      }),
    );
    cabin.position.set(0, WATER_Y + 2.3, 1.5);
    this.group.add(hull, cabin);
    const skin = new THREE.MeshStandardMaterial({ color: 0xc8a080, roughness: 0.8 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.8, 4, 8), shirt);
      body.position.set(-1 + i * 0.7, WATER_Y + 2.1, -4.5 + (i % 2) * 0.6);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), skin);
      head.position.set(body.position.x, WATER_Y + 2.85, body.position.z);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6).translate(0, 0.35, 0), skin);
      arm.position.set(body.position.x + 0.25, WATER_Y + 2.45, body.position.z);
      this.group.add(body, head, arm);
      this.arms.push(arm);
    }
  }

  update(dt: number, t: number, speed: number): void {
    this.z += (speed + 4) * dt;
    this.group.position.set(this.side * 18, 0, this.z);
    this.arms.forEach((a, i) => {
      // waving at the party boat (the arm facing it)
      a.rotation.z = -this.side * (0.6 + Math.sin(t * 7 + i * 1.7) * 0.5);
    });
  }
}

class Boat extends OpenAir {
  readonly views: VenueViews = {
    // from the bow, low on the lower deck: both decks packed, the booth at the top
    wide: { pos: V(2.2, LOWER_Y + 1.7, -23.5), target: V(0, 1.4, 0) },
    wideLabel: 'From the bow',
    crowd: { pos: V(-1.4, 1.7, -7), target: V(0, 1.4, 0.8) },
    drone: [V(0, 4.5, 9), V(9, 3, 2), V(10, 1, -12), V(6, 2.5, -30), V(0, 4, -36), V(-6, 2.5, -30), V(-10, 1, -12), V(-9, 3, 2), V(0, 6, 12)],
    extra: { cctv: { pos: V(4.3, 3.2, 3.6), target: V(0, 0.4, -8) }, crane: { radius: 4, low: 1.2, high: 3.4 } },
  };
  private world = new THREE.Group();
  private water: Water;
  private banks: THREE.Group[] = [];
  private bankLamps: THREE.Points;
  private bridgeG: THREE.Group;
  private bridgeZ = -900;
  private rush = 0;
  private bridgeLampsMat: THREE.PointsMaterial;
  private passing = new PassingBoat();
  private passCooldown = 25;
  private crowd: Crowd[] = [];
  private deckLeds: THREE.MeshBasicMaterial[] = [];
  private leds: LedStrings;
  private momentDone = false;
  private lastDrop = -1e9;
  private lastProgress = 0;
  private echoBridge = false;

  constructor() {
    super({ fog: 0x1a1830, fogDensity: 0.004, hemiSky: 0x2a3260, hemiGround: 0x0c0c14, hemi: 0.3, flashAt: V(0, 4, -6), flashRange: 18, sunYaw: Math.PI, skyRadius: 800 }, BOAT_SKY);
    this.keyLight = { color: 0xffe2c8, intensity: 10 };
    this.grade = { tint: 0xf4f2ff, contrast: 1.1, saturation: 1.1, lift: 0.004 };
    this.toneMapping = 'agx';
    this.glow.setRGB(1, 0.6, 0.35).multiplyScalar(0.12);
    this.group.add(this.world);

    // the river, flowing past
    this.water = new Water(1600, { chop: 0.45, deep: '#05101a', flow: [0, -SPEED] });
    this.water.mesh.position.y = WATER_Y;
    this.water.u.uGlintAmt.value = 0.9;
    this.world.add(this.water.mesh);
    // the banks: stretches of city that loop round as the boat goes
    const lampPts: THREE.Vector3[] = [];
    for (let i = 0; i < SEGS; i++) {
      for (const side of [-1, 1] as const) {
        const b = bankSegment(500 + i * 7 + (side > 0 ? 3 : 0), side);
        b.group.position.z = -SEG * (SEGS - 1) + i * SEG + SEG / 2 - 60;
        b.group.userData.lamps = b.lamps;
        this.world.add(b.group);
        this.banks.push(b.group);
        for (const p of b.lamps) lampPts.push(p.clone().add(V(0, 0, b.group.position.z)));
      }
    }
    // lamps as one cloud of points, moved with their stretch of bank
    this.bankLamps = new THREE.Points(new THREE.BufferGeometry().setFromPoints(lampPts), new THREE.PointsMaterial({ color: new THREE.Color(2.4, 1.5, 0.7), size: 0.7, sizeAttenuation: true, toneMapped: false, transparent: true, depthWrite: false }));
    this.bankLamps.frustumCulled = false;
    this.world.add(this.bankLamps);
    // the bridge (one, recycled)
    const br = bridge();
    this.bridgeG = br.group;
    this.bridgeLampsMat = new THREE.PointsMaterial({ color: new THREE.Color(2.6, 1.6, 0.8), size: 0.6, sizeAttenuation: true, toneMapped: false, transparent: true, depthWrite: false });
    this.bridgeG.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(br.lamps), this.bridgeLampsMat));
    this.world.add(this.bridgeG);
    this.world.add(this.passing.group);

    // the boat: hull, the cabin under the top deck, the open bow deck below
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.55 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x14203a, roughness: 0.5 });
    const teak = new THREE.MeshStandardMaterial({
      color: 0x9a7a5a,
      roughness: 0.75,
      map: canvasTexture(
        'boat-teak',
        256,
        256,
        (g, w, h) => {
          for (let x = 0; x < w; x += 16) {
            const v = 120 + ((x * 37) % 40);
            g.fillStyle = `rgb(${v},${v * 0.75},${v * 0.52})`;
            g.fillRect(x, 0, 16, h);
            g.fillStyle = '#2a1e14';
            g.fillRect(x, 0, 1.5, h);
          }
        },
        { repeat: true },
      ),
    });
    (teak.map as THREE.Texture).repeat.set(3, 6);
    const topDeck = new THREE.Mesh(new THREE.BoxGeometry(TOP.x * 2, 0.25, TOP.z1 - TOP.z0), teak);
    topDeck.position.set(0, -0.125, (TOP.z0 + TOP.z1) / 2);
    topDeck.receiveShadow = true;
    this.group.add(topDeck);
    // the cabin: walls with lit windows down both sides
    const win = new THREE.MeshStandardMaterial({
      color: 0x1a1c22,
      emissive: 0xffffff,
      emissiveIntensity: 1,
      emissiveMap: canvasTexture('boat-cabin', 256, 32, (g, w, h) => {
        g.fillStyle = '#0a0a0c';
        g.fillRect(0, 0, w, h);
        for (let x = 6; x < w; x += 20) {
          g.fillStyle = '#ffcf8a';
          g.fillRect(x, 8, 14, 14);
        }
      }),
    });
    const cabinLen = TOP.z1 - TOP.z0;
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.15, -LOWER_Y, cabinLen), [win, win, white, white, white, white]);
      wall.position.set(s * (TOP.x - 0.1), LOWER_Y / 2, (TOP.z0 + TOP.z1) / 2);
      this.group.add(wall);
    }
    const bowLen = 11;
    const hullGeo = new THREE.BoxGeometry(TOP.x * 2 + 0.3, 1.8, cabinLen + bowLen);
    // taper the bow
    const hp = hullGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < hp.count; i++) if (hp.getZ(i) < 0) hp.setX(i, hp.getX(i) * 0.55);
    hullGeo.computeVertexNormals();
    const hull = new THREE.Mesh(hullGeo, navy);
    hull.position.set(0, LOWER_Y - 0.8, (TOP.z0 + TOP.z1) / 2 - bowLen / 2);
    this.group.add(hull);
    const bowDeckGeo = new THREE.BoxGeometry(TOP.x * 2 - 0.2, 0.2, bowLen);
    const bp = bowDeckGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) if (bp.getZ(i) < 0) bp.setX(i, bp.getX(i) * 0.5);
    const bowDeck = new THREE.Mesh(bowDeckGeo, teak);
    bowDeck.position.set(0, LOWER_Y - 0.1, TOP.z0 - bowLen / 2);
    this.group.add(bowDeck);
    // rails: posts and a top rail round both decks, strung lights along them
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.85, roughness: 0.3 });
    const railPts = (y: number, pts: THREE.Vector3[]) => {
      const geos: THREE.BufferGeometry[] = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = a.distanceTo(b);
        const g = new THREE.CylinderGeometry(0.03, 0.03, len, 6);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
        g.translate((a.x + b.x) / 2, y + 1.05, (a.z + b.z) / 2);
        geos.push(g);
        const n = Math.max(1, Math.round(len / 1.4));
        for (let k = 0; k < n; k++) geos.push(new THREE.CylinderGeometry(0.025, 0.025, 1.05, 5).translate(a.x + ((b.x - a.x) * k) / n, y + 0.52, a.z + ((b.z - a.z) * k) / n));
      }
      this.group.add(new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed()))!, steel));
    };
    const topRail = [V(-TOP.x, 0, TOP.z1), V(-TOP.x, 0, TOP.z0), V(TOP.x, 0, TOP.z0), V(TOP.x, 0, TOP.z1)];
    railPts(0, topRail);
    const bowRail = [V(-TOP.x + 0.2, 0, TOP.z0), V(-TOP.x * 0.5, 0, TOP.z0 - bowLen + 0.3), V(TOP.x * 0.5, 0, TOP.z0 - bowLen + 0.3), V(TOP.x - 0.2, 0, TOP.z0)];
    railPts(LOWER_Y, bowRail);
    // stairs from the top deck down to the bow
    for (let i = 0; i < 8; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.32), teak);
      step.position.set(TOP.x - 0.9, -0.34 * i - 0.2, TOP.z0 - 0.15 - i * 0.3);
      this.group.add(step);
    }
    const leds = new LedStrings({ warm: '#ffc27a', size: 0.09, spacing: 0.45 });
    leds.path(topRail.map((p) => p.clone().setY(1.12)));
    leds.path(bowRail.map((p) => p.clone().setY(LOWER_Y + 1.12)));
    // strung across the top deck from the canopy to the bow
    for (const x of [-2.4, 0, 2.4]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push(V(x, 3.3 - Math.sin(t * Math.PI) * 0.7 - t * 0.6, 2.6 + (TOP.z0 + 0.4 - 2.6) * t));
      }
      leds.path(pts);
    }
    this.leds = this.add(leds.done());
    // deck LED strips along the edges, in the show's colours
    for (const [y, len, z, x] of [
      [0.02, cabinLen, (TOP.z0 + TOP.z1) / 2, TOP.x - 0.08],
      [LOWER_Y + 0.02, bowLen * 0.9, TOP.z0 - bowLen / 2, TOP.x * 0.75],
      [-0.6, cabinLen, (TOP.z0 + TOP.z1) / 2, TOP.x + 0.02],
    ]) {
      for (const s of [-1, 1]) {
        const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, len), m);
        bar.position.set(s * x, y, z);
        if (y === LOWER_Y + 0.02) bar.rotation.y = s * -0.2;
        this.group.add(bar);
        this.deckLeds.push(m);
      }
    }

    // the booth at the stern, a canopy truss over it with a few lights
    const nm = nameStyleFor('boat');
    const b = booth({ w: 2.4, d: 0.85, strip: '#5ad1ff', name: nm.booth });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 2.4, TABLE_Y, -0.42, 501);
    for (const x of [-3.4, 3.4]) {
      for (const z of [-0.6, 3.6]) this.group.add(truss(V(x, 0, z), V(x, 3.6, z), 0.22));
      this.group.add(truss(V(x, 3.6, -0.6), V(x, 3.6, 3.6), 0.22));
    }
    this.group.add(truss(V(-3.4, 3.6, -0.6), V(3.4, 3.6, -0.6), 0.22));
    this.group.add(truss(V(-3.4, 3.6, 3.6), V(3.4, 3.6, 3.6), 0.22));
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.9, side: THREE.DoubleSide }));
    canopy.position.set(0, 3.75, 1.5);
    this.group.add(canopy);
    if (nm.sign) this.nameSign(nm.sign, 3.2, 0.7, V(0, 3.15, -0.66), Math.PI, 1.4);
    for (const s of [-1, 1]) {
      const spk = speaker(0.5, 0.8, 0.45, 'mid', 0x111113);
      spk.position.set(s * 2.6, 0.4 + 0.4, -0.3);
      spk.rotation.y = Math.PI + s * 0.2;
      this.group.add(spk);
    }
    this.add(new MovingHeads([-2.4, -0.8, 0.8, 2.4].map((x) => ({ pos: V(x, 3.4, -0.6) })), { length: 12, radius: 0.6, gain: 1, floorY: 0 }));
    this.add(new Strobes([-1.6, 1.6].map((x) => ({ pos: V(x, 3.45, -0.5), tilt: 0.5 }))));
    this.wash(V(0, 3.2, -6), 0, 3, 10);
    this.wash(V(0, LOWER_Y + 2.4, -19), 1, 2.5, 8);
    this.add(new HazeLayer(new THREE.Box3(V(-TOP.x, 0.5, TOP.z0), V(TOP.x, 3.3, 3)), 3, 0.3));

    // packed on both levels
    const clothes = ['#f2efe8', '#1b1d22', '#2a3a5a', '#c8a07a', '#5a1e2a', '#e8e2d4', '#101114', '#3a7a8a', '#f28a6a', '#7a5cff'];
    const top = new Crowd(crowdArea(-TOP.x + 0.6, TOP.x - 0.6, -1.4, TOP.z0 + 0.6, 2.1, 502, { avoid: [new THREE.Box2(new THREE.Vector2(TOP.x - 1.6, TOP.z0), new THREE.Vector2(TOP.x, TOP.z0 + 1.2))] }), { seed: 503, phones: 0.14, drinks: 0.4, signs: 2, clothes });
    const bow = new Crowd(
      crowdArea(-TOP.x + 0.8, TOP.x - 0.8, TOP.z0 - 1.2, TOP.z0 - bowLen + 2.4, 2.1, 504, { y: LOWER_Y }).filter((p) => Math.abs(p.x) < TOP.x * (0.55 + 0.45 * ((p.z - (TOP.z0 - bowLen)) / bowLen)) - 0.7),
      { seed: 505, phones: 0.14, drinks: 0.4, clothes, booth: V(0, LOWER_Y, 0.2) },
    );
    const crew = vipCrew(crewArc(0, 1.6, 2.5, 0.7, 2.4).filter((p) => Math.abs(p.x) < TOP.x - 0.6), 506, clothes);
    if (crew) this.add(crew);
    this.add(security([{ x: 3.4, z: -0.9 }], 507));
    for (const c of [top, bow]) {
      this.group.add(c.object);
      this.crowd.push(c);
    }
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    const t = this.time;
    if (setClock.progress < this.lastProgress - 0.2) this.momentDone = false;
    this.lastProgress = setClock.progress;
    this.water.update(t, this.look, this.sky.sunDir, this.fog);
    (this.water.u.uGlints.value as THREE.Color).setRGB(1, 0.66, 0.36).lerp(s.colors[0], 0.25);
    // the city goes by
    const move = SPEED * dt;
    const pos = this.bankLamps.geometry.attributes.position as THREE.BufferAttribute;
    let li = 0;
    for (const b of this.banks) {
      b.position.z += move;
      if (b.position.z > SEG * 1.5) b.position.z -= SEG * SEGS;
      for (const p of b.userData.lamps as THREE.Vector3[]) pos.setZ(li++, p.z + b.position.z);
    }
    pos.needsUpdate = true;
    // the bridge: set one up in a build, hurry it to the drop
    if (s.dropHit) this.lastDrop = t;
    const ahead = -this.bridgeZ;
    if (this.bridgeZ < -800 && s.build > 0.55 && s.hype > 0.6) this.bridgeZ = -110;
    // one comes along now and then anyway
    if (this.bridgeZ < -800 && Math.random() < dt / 90) this.bridgeZ = -420;
    if (s.dropHit && ahead > 12 && ahead < 140) this.rush = Math.max(0, ahead / 3.2 - SPEED);
    this.bridgeZ += (SPEED + this.rush) * dt;
    if (this.bridgeZ > -2 && this.bridgeZ - (SPEED + this.rush) * dt <= -2) {
      // overhead: in a drop it's the moment, the sound bounces off the arch
      const inDrop = s.peak > 0.25 || t - this.lastDrop < 10;
      if (inDrop) {
        moments.emit({ venue: 'boat', label: this.momentDone ? 'Under the bridge' : 'Under the bridge on the drop', echo: 3.6, crowd: 'cheer' });
        this.momentDone = true;
        this.echoBridge = true;
      } else moments.emit({ venue: 'boat', label: '', echo: 2 });
    }
    if (this.bridgeZ > 40) {
      this.bridgeZ = -1000;
      this.rush = 0;
      this.echoBridge = false;
    }
    this.bridgeG.position.z = this.bridgeZ;
    this.bridgeG.visible = this.bridgeZ > -700;
    this.bridgeLampsMat.opacity = 1;
    // a boat going the other way, now and then
    this.passCooldown -= dt;
    if (this.passCooldown < 0 && this.passing.z > 80) {
      this.passing.z = -500;
      this.passing.side = Math.random() < 0.5 ? -1 : 1;
      this.passCooldown = 50 + Math.random() * 40;
    }
    this.passing.update(dt, t, SPEED);
    // the world rocks a little (the boat on the water)
    this.world.rotation.z = Math.sin(t * 0.45) * 0.006;
    this.world.rotation.x = Math.sin(t * 0.31 + 1) * 0.003;
    this.world.position.y = Math.sin(t * 0.6) * 0.05;
    // deck strips in the show's colours, on the kick
    this.deckLeds.forEach((m, i) => m.color.copy(s.colors[i % 2]).multiplyScalar((0.6 + s.kick * 1.4 + s.peak * 0.6) * (0.3 + 0.7 * s.master)));
    this.leds.gain = 1;
    // the crowd goes wild under the bridge
    const under = this.echoBridge && this.bridgeZ > -6 && this.bridgeZ < 12;
    const st = under ? { ...s, hype: 1, peak: Math.max(s.peak, 1) } : s;
    for (const c of this.crowd) c.update(st, dt, camera);
  }
}

export const boat: VenueDef = {
  id: 'boat',
  name: 'Boat Party',
  short: 'Boat',
  place: 'On the river',
  kind: 'Party boat · two decks',
  blurb: 'A party boat at night, the city and its bridges sliding past.',
  palette: ['#5ad1ff', '#ff4fb0', '#ffc27a'],
  ui: '#5ad1ff',
  capacity: '400',
  build: () => new Boat(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#060a1c');
    grad.addColorStop(0.55, '#1a1a3a');
    grad.addColorStop(0.56, '#0a1424');
    grad.addColorStop(1, '#03060c');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const r = rng(8);
    for (const side of [0, 1]) {
      let x = side ? w * 0.7 : 0;
      while (x < (side ? w : w * 0.3)) {
        const bw = 6 + r() * 12;
        const bh = h * (0.08 + r() * 0.2);
        g.fillStyle = '#10121a';
        g.fillRect(x, h * 0.55 - bh, bw, bh);
        g.fillStyle = 'rgba(255,217,160,0.85)';
        for (let y = h * 0.55 - bh + 3; y < h * 0.55; y += 5) for (let xx = x + 1; xx < x + bw - 1; xx += 4) if (r() < 0.35) g.fillRect(xx, y, 2, 2);
        x += bw + 1;
      }
    }
    g.fillStyle = 'rgba(255,190,110,0.35)';
    for (let i = 0; i < 30; i++) g.fillRect(r() * w, h * (0.58 + r() * 0.4), 8 + r() * 20, 1);
    g.fillStyle = '#e8e6e0';
    g.beginPath();
    g.moveTo(w * 0.3, h * 0.78);
    g.lineTo(w * 0.72, h * 0.78);
    g.lineTo(w * 0.66, h * 0.92);
    g.lineTo(w * 0.34, h * 0.92);
    g.fill();
    g.fillStyle = '#ffc27a';
    for (let i = 0; i <= 20; i++) g.fillRect(w * 0.3 + i * (w * 0.42) / 20, h * 0.7 + Math.sin((i / 20) * Math.PI) * 4, 2, 2);
    g.fillStyle = '#5ad1ff';
    g.fillRect(w * 0.32, h * 0.8, w * 0.38, 2);
  },
};
