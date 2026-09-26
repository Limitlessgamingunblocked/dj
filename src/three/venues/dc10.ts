/*
 * Circoloco @ DC-10, Ibiza — the main room as seen in the reference photos:
 * a low black room washed red and orange, orange globe lamps hanging over a
 * packed floor, strings of warm bulbs across the ceiling, red laser sheets
 * over the crowd, the spinning fan wheel on the wall, cream booth monitors
 * hanging over the DJ and the crowd pressed right up to a raised booth.
 */
import * as THREE from 'three';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { Blinders, booth, Co2Jets, Crowd, crowdArea, Globes, HazeLayer, Lasers, LedStrings, lineArray, mirrorBall, MovingHeads, speaker, Strobes } from './fixtures';
import { concreteTexture, floorTexture, rng, signTexture } from './tex';
import { laserLines, silhouettes } from './warehouse';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const STAGE = 0.7;
const CEIL = 5.3;

class DC10 extends VenueBase {
  readonly views: VenueViews = {
    wide: { pos: V(-1.45, 2.3, 1.75), target: V(0.9, 1.3, -5.5) },
    wideLabel: 'Over the shoulder',
    crowd: { pos: V(-2.4, 2.6, -11.5), target: V(0.3, 2.0, 0) },
  };
  private fans: THREE.Group[] = [];

  constructor() {
    super({ fog: 0x1c0503, fogDensity: 0.05, hemiSky: 0x9a2e16, hemiGround: 0x140404, hemi: 0.38, flashAt: V(0, 4.6, -6) });
    this.keyLight = { color: 0xffcfb0, intensity: 13 };
    const r = rng(1010);

    // room: black walls and ceiling, worn dark floor
    const wallTex = concreteTexture(22);
    const wall = new THREE.MeshStandardMaterial({ color: 0x241412, map: wallTex, roughness: 0.9 });
    const ceil = new THREE.MeshStandardMaterial({ color: 0x0a0707, roughness: 0.95 });
    const ft = floorTexture('#140c0b', 'dc10');
    ft.repeat.set(6, 6);
    const fl = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55, metalness: 0.1 });
    const room = new THREE.Mesh(new THREE.BoxGeometry(17, CEIL + STAGE, 19.6), [wall, wall, ceil, fl, wall, wall]);
    (room.material as THREE.Material[]).forEach((m) => (m.side = THREE.BackSide));
    room.position.set(0, (CEIL - STAGE) / 2, -7.2);
    room.receiveShadow = true;
    this.group.add(room);

    // raised booth: riser, black front skirt, lit edge
    const riser = new THREE.Mesh(new THREE.BoxGeometry(8.5, STAGE, 3.3), new THREE.MeshStandardMaterial({ color: 0x0d0a0a, roughness: 0.8 }));
    riser.position.set(0, -STAGE / 2, 1.0);
    this.group.add(riser);
    const b = booth({ w: 3.4, d: 1.0, strip: '#fff1e6' });
    this.group.add(b.group);
    this.strip(b.strip);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(3.5, STAGE, 0.06), new THREE.MeshStandardMaterial({ color: 0x0b0909, roughness: 0.7 }));
    skirt.position.set(0, -STAGE / 2, -0.53);
    this.group.add(skirt);

    // the back wall over the booth: lit lettering and hanging black PA
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 0.95),
      new THREE.MeshBasicMaterial({ map: signTexture('circoloco', 'circoloco', { bg: '#050303', fg: '#fff4ea', font: '800 190px "Barlow", "Helvetica Neue", Arial, sans-serif', glow: '#ff7a4a' }), color: new THREE.Color(1.5, 1.4, 1.35), toneMapped: false }),
    );
    sign.position.set(0, 3.55, 2.62);
    sign.rotation.y = Math.PI;
    this.group.add(sign);
    for (const s of [-1, 1]) {
      const pa = lineArray(4, 0.8, 0.3, 0.55);
      pa.position.set(s * 2.9, CEIL - 0.3, -0.4);
      pa.rotation.y = Math.PI + s * 0.15;
      this.group.add(pa);
      // cream booth monitors hanging over the DJ, tilted down at the decks
      const mon = speaker(0.46, 0.68, 0.42, 'monitor', 0xd9cfbd);
      mon.position.set(s * 1.2, 2.65, -0.45);
      mon.rotation.set(0.5, s * -0.25, 0, 'YXZ');
      this.group.add(mon);
      const sub = speaker(1.2, 0.9, 0.9, 'sub');
      sub.position.set(s * 3.6, -STAGE + 0.45, -1.2);
      sub.rotation.y = Math.PI;
      this.group.add(sub);
    }

    // orange globes over the floor, a few mirror balls
    const globes: { pos: THREE.Vector3; r: number }[] = [];
    while (globes.length < 52) {
      const x = (r() - 0.5) * 15;
      const z = -1.6 - r() * 14;
      if (Math.abs(x) < 1.8 && z > -2.6) continue;
      globes.push({ pos: V(x, 2.75 + r() * 1.6, z), r: 0.12 + r() * 0.08 });
    }
    this.add(new Globes(globes, '#ff761a', CEIL));
    for (const [x, y, z] of [
      [-3, 4.3, -6],
      [2.6, 4.5, -9.5],
      [5.4, 4.1, -4],
    ]) {
      const ball = mirrorBall(0.17);
      ball.position.set(x, y, z);
      this.group.add(ball);
    }

    // warm bulb strings across the ceiling, zig-zag strips up the columns
    const leds = new LedStrings({ warm: '#ffae66', size: 0.075, spacing: 0.24 });
    for (let k = 0; k <= 10; k++) leds.line(V(-1.2 + k * 0.24, CEIL - 0.08, -1.2), V(-8 + k * 1.6, CEIL - 0.08, -16.6));
    for (const z of [-4.5, -8.5, -12.5]) leds.path([V(-8.2, CEIL - 0.1, z), V(0, CEIL - 0.45, z), V(8.2, CEIL - 0.1, z)]);
    this.add(leds.done());
    const colLeds = new LedStrings({ size: 0.07, spacing: 0.2 });
    const colMat = new THREE.MeshStandardMaterial({ color: 0x120c0b, roughness: 0.8 });
    for (const [x, z] of [
      [-5.2, -7],
      [5.2, -7],
      [-5.2, -12.5],
      [5.2, -12.5],
    ]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.55, CEIL + STAGE, 0.55), colMat);
      col.position.set(x, (CEIL - STAGE) / 2, z);
      this.group.add(col);
      const face = x < 0 ? 0.3 : -0.3;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) pts.push(V(x + face, -STAGE + 0.3 + i * 0.42, z + (i % 2 ? 0.26 : -0.26)));
      colLeds.path(pts);
    }
    this.add(colLeds.done());

    // the fan wheels on the walls
    for (const [x, z, rad] of [
      [-8.42, -8, 1.25],
      [8.42, -12.5, 0.9],
    ]) {
      const g = new THREE.Group();
      g.position.set(x, 2.4, z);
      g.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      const glow = new THREE.Mesh(new THREE.CircleGeometry(rad, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.75, 0.12), toneMapped: false }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.07, 10, 48), new THREE.MeshStandardMaterial({ color: 0x1a1210, metalness: 0.6, roughness: 0.4 }));
      ring.position.z = 0.06;
      const blades = new THREE.Group();
      blades.position.z = 0.08;
      for (let i = 0; i < 7; i++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(rad * 0.34, rad * 0.95, 0.02), new THREE.MeshStandardMaterial({ color: 0x150d0b, roughness: 0.6 }));
        bl.position.y = rad * 0.5;
        bl.rotation.y = 0.5;
        const arm = new THREE.Group();
        arm.rotation.z = (i / 7) * Math.PI * 2;
        arm.add(bl);
        blades.add(arm);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.12, rad * 0.12, 0.08, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0e0908 }));
      hub.position.z = 0.1;
      g.add(glow, ring, blades, hub);
      this.fans.push(blades);
      this.group.add(g);
      const l = new THREE.PointLight(0xff7a2a, 5, 7, 1.6);
      l.position.set(x + (x < 0 ? 1 : -1), 2.4, z);
      this.group.add(l);
    }

    // lights
    this.add(
      new MovingHeads(
        [
          { pos: V(-1.7, CEIL - 0.35, -0.9) },
          { pos: V(1.7, CEIL - 0.35, -0.9) },
          { pos: V(-3.6, CEIL - 0.35, -4) },
          { pos: V(3.6, CEIL - 0.35, -4) },
          { pos: V(-3.6, CEIL - 0.35, -9) },
          { pos: V(3.6, CEIL - 0.35, -9) },
          { pos: V(-3.6, CEIL - 0.35, -13.5) },
          { pos: V(3.6, CEIL - 0.35, -13.5) },
        ],
        { length: 6.2, radius: 0.62, gain: 1.35 },
      ),
    );
    this.add(
      new Lasers([
        { pos: V(-3.3, CEIL - 0.45, 2.2), dir: V(0.08, -0.12, -1), side: -1, beams: 16, length: 22, color: '#ff1a0d' },
        { pos: V(3.3, CEIL - 0.45, 2.2), dir: V(-0.08, -0.12, -1), side: 1, beams: 16, length: 22, color: '#ff1a0d' },
        { pos: V(-7.9, CEIL - 0.4, -16.4), dir: V(0.45, -0.1, 1), side: -1, beams: 12, length: 22, alt: true, color: '#ff2a0a' },
        { pos: V(7.9, CEIL - 0.4, -16.4), dir: V(-0.45, -0.1, 1), side: 1, beams: 12, length: 22, alt: true, color: '#ff2a0a' },
      ]),
    );
    this.add(new Strobes([V(-6, CEIL - 0.1, -4), V(6, CEIL - 0.1, -4), V(-6, CEIL - 0.1, -10.5), V(6, CEIL - 0.1, -10.5), V(-1.8, CEIL - 0.1, -1.5), V(1.8, CEIL - 0.1, -1.5)].map((p) => ({ pos: p, tilt: Math.PI / 2 }))));
    this.add(new Blinders([V(-2.3, -0.28, -0.6), V(2.3, -0.28, -0.6)].map((p) => ({ pos: p, tilt: -0.15 }))));
    this.add(new Co2Jets([V(-1.95, 0.02, -0.72), V(1.95, 0.02, -0.72)], 8));

    // the crowd, right up against the booth, and friends in the booth
    const crowd = this.add(new Crowd(crowdArea(-8, 8, -1.45, -16.2, 2.1, 1011, { y: -STAGE }), { seed: 12, phones: 0.05, clothes: ['#1b1d22', '#2a2d33', '#8a857c', '#101114', '#3a2f2a', '#23262d', '#6e6250', '#4a1a1e', '#1d2b3a', '#a39d93'] }));
    crowd.extras.forEach((e) => this.group.add(e));
    this.add(new Crowd([{ x: -2.1, z: 1.0 }, { x: -2.9, z: 1.6 }, { x: 2.2, z: 1.1 }, { x: 3.0, z: 1.7 }, { x: -1.9, z: 2.1 }].map((p) => ({ ...p, face: Math.PI + (p.x < 0 ? -0.4 : 0.4) })), { seed: 44, clothes: ['#a39d93', '#1b1d22', '#7d6f5a'] }));
    this.add(new HazeLayer(new THREE.Box3(V(-8, 1.6, -16), V(8, CEIL - 0.2, 0)), 5));

    this.wash(V(-3, 4, -4), 0, 4.5, 12);
    this.wash(V(3, 4, -8.5), 0, 4.5, 12);
    this.wash(V(0, 4.4, -13), 1, 3.5, 12);
    this.wash(V(0, 3.2, 1.6), 0, 2.5, 6, 0.5);
  }

  update(...args: Parameters<VenueBase['update']>): void {
    super.update(...args);
    const [s, , dt] = args;
    for (const f of this.fans) f.rotation.z -= dt * (1.2 + s.energy * 2 + s.peak * 3);
  }
}

export const dc10: VenueDef = {
  id: 'dc10',
  name: 'Circoloco @ DC-10',
  place: 'Ibiza, Spain',
  kind: 'Club · main room',
  blurb: 'The Monday institution by the airport: a low red room, orange globe lamps over the crowd, strings of warm bulbs, red laser sheets, the fan wheel on the wall and a crowd pressed right up to the booth.',
  palette: ['#ff2d1a', '#ff7a1a', '#ffb24d'],
  ui: '#ff5a2a',
  capacity: '1,500',
  build: () => new DC10(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1a0302');
    grad.addColorStop(0.6, '#5a0c04');
    grad.addColorStop(1, '#2a0502');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    laserLines(g, w * 0.5, h * 0.05, '#ff3b1f', 14, 1.2, h * 1.2, Math.PI / 2);
    const r = rng(3);
    for (let i = 0; i < 22; i++) {
      const x = r() * w;
      const y = h * (0.12 + r() * 0.42);
      const rad = 3 + r() * 5;
      const gl = g.createRadialGradient(x, y, 0, x, y, rad * 2.2);
      gl.addColorStop(0, '#ffd08a');
      gl.addColorStop(0.4, '#ff7a1a');
      gl.addColorStop(1, 'rgba(255,90,20,0)');
      g.fillStyle = gl;
      g.beginPath();
      g.arc(x, y, rad * 2.2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#fff1e6';
    g.font = '800 26px "Barlow", sans-serif';
    g.textAlign = 'center';
    g.fillText('circoloco', w / 2, h * 0.14);
    silhouettes(g, w, h, '#120202', 11);
  },
};
