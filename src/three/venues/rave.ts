/*
 * The Warehouse Rave (Section 5.2): capacity 1,500. An industrial shed:
 * concrete, steel roof trusses and columns, shipping containers stacked down
 * both sides (lasers and a few people up on top), heavy haze. Laser arrays,
 * an LED wall behind the booth and LED battens on the columns, strobe banks
 * and moving heads in the roof. Big, echoing, heavy low end (audio/room.ts).
 * Ravers in black, hands up, all in.
 *
 * Signature moment: at full energy, the giant roller door at the back lifts
 * to show hundreds more people outside under the yard lights, and they flood
 * in.
 *
 * TODO: procedural stand-in for the Blender warehouse set (Section 14).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { nameStyleFor } from '../../name/venueStyles';
import type { Features } from '../../visualizer/AudioFeatures';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { Confetti } from './confetti';
import { barCounter, boothClutter, DustMotes, exitSign, PillarBars } from './details';
import { FarCrowd, scatter } from './farcrowd';
import { atBar, crewArc, lightingTech, security, vipCrew } from './crew';
import { Blinders, booth, Co2Jets, Crowd, crowdArea, HazeLayer, lineArray, MovingHeads, speaker, Strobes, TABLE_Y, truss } from './fixtures';
import { Lasers, laserStands } from './lasers';
import { moments, PeakTrigger } from './moments';
import { Pyro } from './pyro';
import type { ShowState } from './show';
import { canvasTexture, concreteTexture, floorTexture, rng, withSurface } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** the dance floor, below the stage */
const FL = -1.3;
const W = 28;
const Z0 = -38;
const Z1 = 6;
const H = 12;
const DOOR = { w: 12, h: 7.5 };

/** corrugated steel, for the walls and the door's slats */
function corrugated(key: string, base: string): THREE.CanvasTexture {
  return canvasTexture(
    key,
    256,
    256,
    (g, w, h) => {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 8) {
        const grad = g.createLinearGradient(x, 0, x + 8, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0.08)');
        grad.addColorStop(0.5, 'rgba(0,0,0,0.25)');
        grad.addColorStop(1, 'rgba(255,255,255,0.08)');
        g.fillStyle = grad;
        g.fillRect(x, 0, 8, h);
      }
      const r = rng(key.length * 7);
      for (let i = 0; i < 30; i++) {
        g.fillStyle = `rgba(90,50,30,${0.05 + r() * 0.12})`;
        g.fillRect(r() * w, r() * h, 2 + r() * 10, 10 + r() * 60);
      }
    },
    { repeat: true },
  );
}

/** the roller door's slats: horizontal ribs */
function slats(): THREE.CanvasTexture {
  return canvasTexture(
    'rave-door',
    128,
    256,
    (g, w, h) => {
      g.fillStyle = '#5a5e64';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 10) {
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(0, y, w, 2);
        g.fillStyle = 'rgba(255,255,255,0.1)';
        g.fillRect(0, y + 2, w, 1);
      }
    },
    { repeat: true },
  );
}

/** a shipping container (12 × 2.6 × 2.4 m), its long side along z */
function container(color: string, seed: number): THREE.Mesh {
  const tex = corrugated(`container:${color}`, color);
  tex.repeat.set(3, 1);
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.44, 2.6, 12.2), new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.7, metalness: 0.3 }));
  m.userData.seed = seed;
  return m;
}

class WarehouseRave extends VenueBase {
  readonly views: VenueViews = {
    // from the back of the floor, by the roller door
    wide: { pos: V(5, FL + 5.2, -33), target: V(0, 2.6, 3) },
    wideLabel: 'Back of the warehouse',
    crowd: { pos: V(-1.5, FL + 2, -7), target: V(0, 1.5, 1) },
    drone: [V(0, 6, 5), V(9, 5, 0), V(10.5, 6, -14), V(8, 8, -30), V(0, 9, -35), V(-8, 8, -30), V(-10.5, 6, -14), V(-9, 5, 0), V(0, 10, -12)],
    extra: { cctv: { pos: V(-12.5, 9, 5), target: V(0, FL + 2, -34) }, rig: { pos: V(5, H - 1.6, -3), target: V(0, 0.9, 0.3) }, crane: { radius: 6, low: 1.4, high: 6 } },
  };
  private door: THREE.Mesh;
  private doorDrum: THREE.Mesh;
  private open = 0;
  private openT = -1;
  private outside: FarCrowd;
  private yard: THREE.SpotLight;
  private yardGlow: THREE.MeshBasicMaterial;
  private trigger = new PeakTrigger(0.9, 8);
  private yardAmb = new THREE.Color();

  constructor() {
    super({ fog: 0x04050a, fogDensity: 0.03, hemiSky: 0x5a6a90, hemiGround: 0x060608, hemi: 0.28, flashAt: V(0, 8, -12), flashRange: 40 });
    this.grade = { tint: 0xf4f6ff, contrast: 1.14, saturation: 1.1, lift: 0 };
    this.toneMapping = 'agx';
    const x0 = -W / 2;
    const x1 = W / 2;

    // the shed: concrete floor, corrugated walls, the roof sheeting
    const fl = floorTexture('#101115', 'rave');
    fl.repeat.set(14, 22);
    const floorMat = withSurface(new THREE.MeshStandardMaterial({ map: fl, metalness: 0.15 }), 'rave-floor', { bumps: 0.4, grain: 0.5, seams: 96, rough: 0.45, roughVar: 0.2, polish: 0.25, repeat: 12, normalScale: 0.5 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Z1 - Z0).rotateX(-Math.PI / 2), floorMat);
    floor.position.set(0, FL, (Z0 + Z1) / 2);
    floor.receiveShadow = true;
    this.group.add(floor);
    const wallTex = corrugated('rave-wall', '#2a2c30');
    wallTex.repeat.set(10, 3);
    const wall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.75, metalness: 0.4 });
    const conc = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, map: concreteTexture(50), roughness: 0.9 });
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(Z1 - Z0, H - FL), wall);
      side.position.set(s * (W / 2), (H + FL) / 2, (Z0 + Z1) / 2);
      side.rotation.y = -s * (Math.PI / 2);
      this.group.add(side);
    }
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H - FL), conc);
    front.position.set(0, (H + FL) / 2, Z1);
    front.rotation.y = Math.PI;
    this.group.add(front);
    // the back wall, with the door opening in it
    const bw = (W - DOOR.w) / 2;
    for (const s of [-1, 1]) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(bw, H - FL), conc);
      pane.position.set(s * (DOOR.w / 2 + bw / 2), (H + FL) / 2, Z0);
      this.group.add(pane);
    }
    const lintel = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.w, H - FL - DOOR.h), conc);
    lintel.position.set(0, FL + DOOR.h + (H - FL - DOOR.h) / 2, Z0);
    this.group.add(lintel);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(W, Z1 - Z0).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.9 }));
    roof.position.set(0, H, (Z0 + Z1) / 2);
    this.group.add(roof);

    // steel: I-beam columns down the sides, triangular roof trusses across
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3e46, metalness: 0.75, roughness: 0.45 });
    const beams: THREE.BufferGeometry[] = [];
    const bar = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const len = a.distanceTo(b);
      const g = new THREE.BoxGeometry(r, len, r);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      beams.push(g.toNonIndexed());
    };
    for (let z = Z1 - 2; z > Z0 + 1; z -= 6) {
      for (const s of [-1, 1]) {
        beams.push(new THREE.BoxGeometry(0.36, H - FL, 0.18).translate(s * (W / 2 - 0.3), (H + FL) / 2, z).toNonIndexed());
        beams.push(new THREE.BoxGeometry(0.04, H - FL, 0.36).translate(s * (W / 2 - 0.3), (H + FL) / 2, z).toNonIndexed());
      }
      // the truss: bottom chord, two rafters, web members
      const lo = H - 2.4;
      bar(V(x0 + 0.3, lo, z), V(x1 - 0.3, lo, z), 0.2);
      bar(V(x0 + 0.3, lo, z), V(0, H - 0.2, z), 0.22);
      bar(V(x1 - 0.3, lo, z), V(0, H - 0.2, z), 0.22);
      for (let k = 1; k < 7; k++) {
        const x = x0 + 0.3 + (k * (W - 0.6)) / 7;
        const top = lo + (H - 0.2 - lo) * (1 - Math.abs(x) / (W / 2 - 0.3));
        bar(V(x, lo, z), V(x, top, z), 0.08);
        if (k < 6) bar(V(x, lo, z), V(x + (W - 0.6) / 7, lo + (H - 0.2 - lo) * (1 - Math.abs(x + (W - 0.6) / 7) / (W / 2 - 0.3)), z), 0.07);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(beams)!, steel));
    // LED battens on columns down the floor
    this.add(new PillarBars([-8, -16, -24].flatMap((z) => [V(-10.6, 0, z), V(10.6, 0, z)]), FL, H - 2.6));

    // shipping containers down both sides, two high, rusty and faded
    const colors = ['#7a2e22', '#2a4a6a', '#3a5a3a', '#8a6a2a', '#5a5e64', '#6a2a3a'];
    let ci = 0;
    for (const s of [-1, 1]) {
      for (const z of [-11, -24]) {
        for (let lvl = 0; lvl < 2; lvl++) {
          const c = container(colors[ci++ % colors.length], ci);
          c.position.set(s * (W / 2 - 1.5), FL + 1.3 + lvl * 2.62, z);
          this.group.add(c);
        }
      }
    }

    // the stage: riser, the booth, the LED wall behind
    const riser = new THREE.Mesh(new THREE.BoxGeometry(18, -FL, 7), new THREE.MeshStandardMaterial({ color: 0x15161a, map: concreteTexture(30), roughness: 0.8 }));
    riser.position.set(0, FL / 2, 2.4);
    this.group.add(riser);
    const nm = nameStyleFor('warehouse');
    const b = booth({ w: 3, d: 1.0, strip: '#2ec4f1', name: nm.booth });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 3, TABLE_Y, -0.5, 801);
    this.add(new DustMotes(new THREE.Box3(V(-3, TABLE_Y - 0.3, -2.4), V(3, TABLE_Y + 2.6, 1.6)), 320, 802));
    const led = this.screen(new THREE.Mesh(new THREE.PlaneGeometry(16, 7)), { size: [16, 7], pitch: 0.0039 });
    led.position.set(0, 1.0 + 3.5, 5.6);
    led.rotation.y = Math.PI;
    if (nm.screen) this.nameScreen(led, 16, 7, nm.screen);
    for (const s of [-1, 1]) {
      const arr = lineArray(10, 1.1, 0.4, 0.75);
      arr.position.set(s * 8.4, H - 2.8, -1.2);
      arr.rotation.y = Math.PI + s * 0.1;
      this.group.add(arr);
      for (let k = 0; k < 3; k++) {
        const sub = speaker(1.2, 0.8, 0.9, 'sub');
        sub.position.set(s * (5.5 + k * 1.3), FL + 0.4, -1.4);
        sub.rotation.y = Math.PI;
        this.group.add(sub);
      }
      const mon = speaker(0.4, 0.55, 0.38, 'monitor');
      mon.position.set(s * 1.6, 0.9 + 0.28, -0.35);
      mon.rotation.y = Math.PI + s * 0.35;
      this.group.add(mon);
    }
    // a bar in the right-hand containers' shadow, the exits, your name in neon over the bar
    const barG = barCounter(7, { glow: '#2ec4f1', body: 0x111318, top: 0x23262c, seed: 803 });
    barG.position.set(W / 2 - 3.6, FL, -30.5);
    barG.rotation.y = -Math.PI / 2;
    this.group.add(barG);
    this.add(atBar(barG, 7, 811, { staff: 2, leaners: 3, clothes: ['#0e0e10', '#16171a', '#2a2d33'] }));
    this.group.add(exitSign(V(-W / 2 + 0.05, FL + 2.6, -33), Math.PI / 2), exitSign(V(W / 2 - 0.05, FL + 2.6, -4), -Math.PI / 2));
    if (nm.sign) this.nameSign(nm.sign, 4.2, 1.1, V(W / 2 - 0.06, FL + 6.4, -30.5), -Math.PI / 2, 1.1);

    // the roof rig: heads, strobe banks, lasers on the stage, the containers and the roof
    const rigY = H - 2.6;
    for (const z of [-2, -9, -16]) this.group.add(truss(V(-10, rigY, z), V(10, rigY, z), 0.45));
    this.add(new MovingHeads([-2, -9, -16].flatMap((z) => [-9, -6, -3, 0, 3, 6, 9].map((x) => ({ pos: V(x, rigY - 0.4, z) }))), { length: 18, radius: 1.2, gain: 1.15, floorY: FL, haze: [FL + 1, H] }));
    this.add(new Strobes([-2, -9, -16].flatMap((z) => [-7.5, -2.5, 2.5, 7.5].map((x) => ({ pos: V(x, rigY - 0.3, z), tilt: Math.PI / 2 }))), [1, 0.1, 0.1]));
    this.add(new Blinders([-6, -3, 3, 6].map((x) => ({ pos: V(x, 0.3, -1.3), tilt: -0.3 }))));
    const tops = [V(-W / 2 + 1.5, FL + 5.4, -11), V(W / 2 - 1.5, FL + 5.4, -11), V(-W / 2 + 1.5, FL + 5.4, -24), V(W / 2 - 1.5, FL + 5.4, -24)];
    this.group.add(laserStands(tops, FL + 5.24));
    this.add(
      new Lasers(
        [
          { pos: V(-6, 0.3, -1.4), dir: V(0.1, 0.25, -1), side: -1, beams: 16, length: 50 },
          { pos: V(6, 0.3, -1.4), dir: V(-0.1, 0.25, -1), side: 1, beams: 16, length: 50, alt: true },
          { pos: tops[0], dir: V(1, 0.02, -0.25), side: -1, beams: 14, length: 40 },
          { pos: tops[1], dir: V(-1, 0.02, -0.25), side: 1, beams: 14, length: 40, alt: true },
          { pos: tops[2], dir: V(1, 0.02, 0.35), side: -1, beams: 14, length: 40, alt: true },
          { pos: tops[3], dir: V(-1, 0.02, 0.35), side: 1, beams: 14, length: 40 },
          { pos: V(-8, rigY - 0.6, -16), dir: V(0.2, -0.05, 1), side: -1, beams: 12, length: 40 },
          { pos: V(8, rigY - 0.6, -16), dir: V(-0.2, -0.05, 1), side: 1, beams: 12, length: 40, alt: true },
        ],
        {
          room: { floorY: FL, x0, x1, z0: Z0, z1: Z1, ceilY: H, solids: [new THREE.Box3(V(-8, 1, 5.5), V(8, 8, 5.8))] },
          audience: { floorY: FL, x0, x1, z0: Z0, z1: -1.8 },
          focus: V(0, 5, -18),
          haze: [FL + 0.5, H],
        },
      ),
    );
    this.add(new Co2Jets([-7, -4.5, 4.5, 7].map((x) => V(x, 0.05, -1.3)), 10));
    this.add(new Confetti([-1, 1].map((s) => ({ pos: V(s * 5, 0.05, -1.3), dir: V(s * 0.12, 0.75, -0.65) })), { floorY: FL, speed: 11, count: 3000 }));
    this.add(new Pyro([...[-7.6, 7.6].map((x) => ({ pos: V(x, 0, -1.0), kind: 'flame' as const })), ...[-3, 3].map((x) => ({ pos: V(x, 0, -1.2), kind: 'spark' as const }))], { height: 4 }));
    this.wash(V(-5, 5, -6), 0, 7, 16);
    this.wash(V(5, 5, -14), 1, 7, 16);
    this.wash(V(0, 6, -26), 2, 6, 18);
    // heavy haze
    this.add(new HazeLayer(new THREE.Box3(V(x0 + 1, FL + 1.5, Z0 + 1), V(x1 - 1, H - 1, 2)), 9, 0.9));

    // ravers: black clothes, all in
    const clothes = ['#0e0e10', '#16171a', '#1d1f24', '#0e0e10', '#2a2d33', '#101114', '#3a3d44', '#d9d6cf', '#5a1e22'];
    this.add(new Crowd(crowdArea(-10, 10, -2.4, -11, 2.2, 804, { y: FL }), { seed: 805, phones: 0.05, drinks: 0.15, signs: 3, clothes }));
    // the crew on stage behind you, security at the barrier, the lighting tech beside the stage
    const crew = vipCrew(crewArc(0, 2.4, 3.6, 0.7, 2.6), 812, clothes);
    if (crew) this.add(crew);
    this.add(security([{ x: -4, z: -1.9, y: FL }, { x: 4, z: -1.9, y: FL }], 813));
    this.add(lightingTech({ x: 7.4, z: 1.6, y: 0, face: Math.PI - 0.3 }, 814));
    // friends up on the containers
    this.add(new Crowd([-11, -9, -24, -26].flatMap((z) => [-1, 1].map((s) => ({ x: s * (W / 2 - 1.5), z, y: FL + 5.24, face: s > 0 ? -Math.PI / 2 - 0.4 : Math.PI / 2 + 0.4, role: 'vip' as const }))), { seed: 806, clothes }));
    const inside = (x: number, z: number) => (Math.abs(x) > W / 2 - 3 ? 0 : z > -11 && Math.abs(x) < 10 ? 0 : 2.2 - (-11 - z) * 0.03);
    this.add(new FarCrowd(scatter(-W / 2 + 3, W / 2 - 3, -27, -9, inside, 807, [new THREE.Box2(new THREE.Vector2(W / 2 - 5, -34), new THREE.Vector2(W / 2, -27))]).map((p) => ({ ...p, y: FL })), { seed: 808, clothes, phones: 0.05, focus: V(0, 2, 2) }));

    // outside: the yard under sodium lights, hundreds waiting
    const yardFloor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.95 }));
    yardFloor.position.set(0, FL - 0.01, Z0 - 20);
    this.group.add(yardFloor);
    this.yardGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.12, 0.04), fog: false });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(80, 30), this.yardGlow);
    backdrop.position.set(0, FL + 12, Z0 - 38);
    this.group.add(backdrop);
    for (const x of [-9, 9]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), steel);
      pole.position.set(x, FL + 3.5, Z0 - 14);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.5), toneMapped: false }));
      lamp.position.set(x, FL + 7, Z0 - 14);
      this.group.add(pole, lamp);
    }
    this.yard = new THREE.SpotLight(0xffa04a, 0, 50, 0.7, 0.6, 1.2);
    this.yard.position.set(0, FL + 7, Z0 - 16);
    this.yard.target.position.set(0, FL, Z0 + 10);
    this.group.add(this.yard, this.yard.target);
    const out = (x: number) => (Math.abs(x) > DOOR.w / 2 - 0.6 ? 0 : 2.4);
    this.outside = new FarCrowd(scatter(-DOOR.w / 2, DOOR.w / 2, Z0 - 28, Z0 - 2.5, out, 809).map((p) => ({ ...p, y: FL })), { seed: 810, clothes, phones: 0.12, focus: V(0, 2, 2) });
    this.outside.ambient(new THREE.Color(0.18, 0.09, 0.03));
    this.group.add(this.outside.object);

    // the roller door, rolled down, and its drum at the top
    const st = slats();
    st.repeat.set(4, 3);
    this.door = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.w, DOOR.h), new THREE.MeshStandardMaterial({ map: st, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }));
    this.door.position.set(0, FL + DOOR.h / 2, Z0 + 0.1);
    this.group.add(this.door);
    this.doorDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, DOOR.w + 0.4, 16).rotateZ(Math.PI / 2), steel);
    this.doorDrum.position.set(0, FL + DOOR.h + 0.35, Z0 + 0.45);
    this.group.add(this.doorDrum);
    // hazard stripes on the frame
    const hazard = new THREE.MeshStandardMaterial({
      roughness: 0.7,
      map: canvasTexture(
        'rave-hazard',
        64,
        64,
        (g, w, h) => {
          g.fillStyle = '#e8b800';
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#111';
          for (let i = -w; i < w * 2; i += 16) {
            g.beginPath();
            g.moveTo(i, 0);
            g.lineTo(i + 8, 0);
            g.lineTo(i + 8 + h, h);
            g.lineTo(i + h, h);
            g.fill();
          }
        },
        { repeat: true },
      ),
    });
    (hazard.map as THREE.Texture).repeat.set(1, 6);
    for (const s of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.3, DOOR.h, 0.3), hazard);
      jamb.position.set(s * (DOOR.w / 2 + 0.15), FL + DOOR.h / 2, Z0 + 0.15);
      this.group.add(jamb);
    }
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    // the signature moment: hold it at the top and the door goes up
    if (this.trigger.update(dt, s.hype, s.playing)) {
      this.openT = 0;
      moments.emit({ venue: 'warehouse', label: 'The roller door goes up', crowd: 'cheer' });
    }
    // a new set: the door comes back down
    if (!this.trigger.fired) this.openT = -1;
    if (this.openT >= 0) {
      this.openT += dt;
      this.open = Math.min(1, this.openT / 7);
    } else this.open = Math.max(0, this.open - dt * 0.2);
    const o = this.open * this.open * (3 - 2 * this.open);
    // it rolls up into the drum: the bottom edge rises
    this.door.scale.y = Math.max(0.02, 1 - o);
    this.door.position.y = FL + DOOR.h - (DOOR.h * (1 - o)) / 2;
    this.doorDrum.rotation.x = -o * 30;
    // the yard's light floods in, and so do the people
    this.yard.intensity = o * 400;
    this.yardGlow.color.setRGB(0.25, 0.12, 0.04).multiplyScalar(0.3 + o * 0.7);
    const walk = THREE.MathUtils.smoothstep(this.openT, 6, 18);
    this.outside.object.position.z = walk * 15;
    this.outside.ambient(this.yardAmb.setRGB(0.18, 0.09, 0.03).multiplyScalar(1 - walk * 0.7));
    this.outside.update(this.openT >= 0 ? { ...s, hype: Math.max(s.hype, 0.95), peak: Math.max(s.peak, 0.6) } : { ...s, hype: s.hype * 0.4 }, dt);
  }
}

export const warehouseRave: VenueDef = {
  id: 'warehouse',
  name: 'Warehouse Rave',
  short: 'Warehouse',
  place: 'The industrial estate',
  kind: 'Warehouse rave · 1,500',
  blurb: 'Concrete, steel trusses, shipping containers down both sides, heavy haze. Laser arrays, an LED wall, strobe banks and moving heads, and a roller door at the back.',
  palette: ['#2ec4f1', '#ff2e88', '#b6ff3b'],
  ui: '#2ec4f1',
  capacity: '1,500',
  build: () => new WarehouseRave(),
  thumb(g, w, h) {
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a2e36';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const y = h * 0.08 + i * 4;
      g.beginPath();
      g.moveTo(0, y + 18);
      g.lineTo(w / 2, y);
      g.lineTo(w, y + 18);
      g.stroke();
    }
    const glow = g.createRadialGradient(w / 2, h * 0.62, 4, w / 2, h * 0.62, w * 0.3);
    glow.addColorStop(0, 'rgba(255,160,74,0.9)');
    glow.addColorStop(1, 'rgba(255,160,74,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#7a2e22';
    g.fillRect(0, h * 0.5, w * 0.16, h * 0.36);
    g.fillStyle = '#2a4a6a';
    g.fillRect(w * 0.84, h * 0.5, w * 0.16, h * 0.36);
    g.strokeStyle = 'rgba(46,196,241,0.75)';
    g.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.moveTo(w * 0.15, h * 0.5);
      g.lineTo(w * (0.3 + i * 0.05), 0);
      g.moveTo(w * 0.85, h * 0.5);
      g.lineTo(w * (0.7 - i * 0.05), 0);
      g.stroke();
    }
    const r = rng(5);
    g.fillStyle = '#020204';
    for (let i = 0; i < 160; i++) {
      const x = r() * w;
      const y = h * (0.78 + r() * 0.22);
      g.beginPath();
      g.arc(x, y, 5 + r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  },
};
