/*
 * The Legendary Sunrise Closing Set (Section 5.2): capacity 10,000. An
 * open-air site on a hillside: a minimal timber stage at the foot of the
 * slope, the land falling away behind it to the valley and the horizon, the
 * crowd up the hill looking over the booth at the sky. It starts in the dark;
 * the real light show is the sunrise, which runs across the whole set. Open,
 * warm and emotional (audio/room.ts), birds as it gets light. Everyone who's
 * lasted the night: tired, emotional, euphoric.
 *
 * Signature moment: the sun clears the horizon on the final track, and the
 * whole hill goes up.
 *
 * TODO: procedural stand-in for the Blender hillside set (Section 14).
 */
import * as THREE from 'three';
import { nameStyleFor } from '../../name/venueStyles';
import type { Features } from '../../visualizer/AudioFeatures';
import type { VenueDef, VenueViews } from './base';
import { boothClutter } from './details';
import { Dresser } from './dress';
import { FarCrowd, scatter } from './farcrowd';
import { Balloons, Birds } from './landmarks';
import { crewArc, security, vipCrew } from './crew';
import { booth, Crowd, crowdArea, Globes, HazeLayer, MovingHeads, speaker, TABLE_Y } from './fixtures';
import { moments, setClock } from './moments';
import { OpenAir } from './openair';
import type { SkyKey } from './outdoor';
import type { ShowState } from './show';
import { canvasTexture, rng } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** the ground: the hill the crowd stands on rises away from the stage; behind the stage it falls to the valley */
export function groundY(x: number, z: number): number {
  if (z < -1.5) return -1.1 + (-z - 1.5) * 0.13 + Math.sin(x * 0.08) * 0.4 * Math.min(1, (-z - 1.5) / 20);
  if (z < 5) return -1.1;
  return -1.1 - Math.min(48, (z - 5) * 0.55 + Math.pow(Math.max(0, z - 5) / 12, 2));
}

/**
 * The sunrise across the set: dark and starry at the start, blue hour by the
 * middle, the sky colouring in, and the sun's top edge on the horizon at
 * about 0.9, clear of it in the final minutes.
 */
export const SUNRISE_SKY: SkyKey[] = [
  { k: 0, zenith: '#03040c', horizon: '#0e1020', ground: '#04050a', sun: -16, sunColor: '#ff7a3a', light: 0, ambSky: '#121838', ambGround: '#060608', amb: 0.16, stars: 1, night: 1 },
  { k: 0.4, zenith: '#080c26', horizon: '#1e2a52', ground: '#060810', sun: -10, sunColor: '#ff7a3a', light: 0, ambSky: '#1e2650', ambGround: '#0a0a10', amb: 0.22, stars: 0.75, night: 0.95 },
  { k: 0.62, zenith: '#16245a', horizon: '#6a5a8a', ground: '#0e1020', sun: -6, sunColor: '#ff7050', light: 0, ambSky: '#4a5288', ambGround: '#141420', amb: 0.34, stars: 0.35, night: 0.8 },
  { k: 0.8, zenith: '#2a4a90', horizon: '#ff9a6a', ground: '#2a2232', sun: -2.2, sunColor: '#ff6a3a', light: 0.2, ambSky: '#8a88b8', ambGround: '#3a2a30', amb: 0.5, stars: 0.05, night: 0.45 },
  { k: 0.91, zenith: '#3a68b0', horizon: '#ffb070', ground: '#3a2e30', sun: -0.25, sunColor: '#ff8a40', light: 1.2, ambSky: '#c8a8a8', ambGround: '#4a3a30', amb: 0.62, stars: 0, night: 0.2 },
  { k: 1, zenith: '#4a80c8', horizon: '#ffd2a0', ground: '#4a4038', sun: 3.2, sunColor: '#ffb060', light: 2.4, ambSky: '#d8d0c8', ambGround: '#5a4a38', amb: 0.75, stars: 0, night: 0 },
];

class Sunrise extends OpenAir {
  readonly views: VenueViews = {
    // up the hill behind everyone: the crowd, the little stage, the sky
    wide: { pos: V(-7, groundY(-7, -46) + 4.5, -46), target: V(0, -4, 40) },
    wideLabel: 'Up the hill',
    director: {
      style: 'cinematic',
      open: true,
      landmarks: [
        { label: 'The valley at dawn', from: { pos: V(-4, 3.2, 3.6), target: V(0, -4, 200) }, to: { pos: V(4, 3.4, 4), target: V(14, -2, 200) }, fov: 42 },
        { label: 'The balloons', from: { pos: V(0, 2.6, 3), target: V(-15, 23, 260) }, to: { pos: V(0.5, 2.6, 3), target: V(30, 12, 150) }, fov: 18 },
        { label: 'Down the hill', from: { pos: V(8, groundY(8, -15) + 2, -15), target: V(0, 2, 6) }, to: { pos: V(5, groundY(5, -12) + 2.4, -12), target: V(0, 2, 6) }, fov: 38 },
      ],
    },
    crowd: { pos: V(1.4, 0.9, -6.2), target: V(0, 1.7, 6) },
    drone: [V(0, 5, 10), V(12, 4, 2), V(18, 6, -16), V(10, 9, -40), V(0, 12, -50), V(-10, 9, -40), V(-18, 6, -16), V(-12, 4, 2), V(0, 3, 24)],
    extra: { cctv: { pos: V(14, 4, 5), target: V(0, 0, -10) }, crane: { radius: 6, low: 1.4, high: 6 } },
  };
  private crowd: Crowd;
  private farCrowd: FarCrowd;
  private cleared = false;
  private clearedT = 0;
  private lastProgress = 0;
  private amb = new THREE.Color();

  constructor() {
    super({ fog: 0x0e1020, fogDensity: 0.006, hemiSky: 0x121838, hemiGround: 0x060608, hemi: 0.16, flashAt: V(0, 4, -8), flashRange: 26, sunYaw: 0.18, skyRadius: 900, skyShow: { at: V(0, 60, 140), scale: 1.4 } }, SUNRISE_SKY, {
      // mist in the valley, high cirrus that turns pink before the sun is up, and the old moon a thin crescent over the dawn
      air: { turbidity: 1.8 },
      clouds: { cover: 0.18, cirrus: 0.5, wind: [0.15, 0.1] },
      moon: { yaw: 0.78, el0: 18, el1: 28 },
      albedo: '#5a6a38',
      groundTint: '#4a5040',
    });
    this.keyLight = { color: 0xffe8d0, intensity: 9 };
    this.grade = { tint: 0xfff4ec, contrast: 1.06, saturation: 1.1, lift: 0.003 };
    this.toneMapping = 'agx';
    this.hazeFromSky = 0.7;

    // the land: the hill, the stage's level, the fall to the valley
    const land = new THREE.PlaneGeometry(420, 420, 140, 140).rotateX(-Math.PI / 2);
    const lp = land.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setY(i, groundY(lp.getX(i), lp.getZ(i)));
    land.computeVertexNormals();
    const grass = canvasTexture(
      'sunrise-grass',
      256,
      256,
      (g, w, h) => {
        g.fillStyle = '#3a4628';
        g.fillRect(0, 0, w, h);
        const r = rng(61);
        for (let i = 0; i < 4000; i++) {
          const v = 30 + r() * 60;
          g.fillStyle = `rgba(${v * 0.9},${v * 1.1},${v * 0.5},0.55)`;
          g.fillRect(r() * w, r() * h, 1, 3);
        }
      },
      { repeat: true },
    );
    grass.repeat.set(90, 90);
    const ground = new THREE.Mesh(land, new THREE.MeshStandardMaterial({ map: grass, color: 0x8a9a7a, roughness: 1 }));
    this.group.add(ground);
    // the valley floor far below, fields to the horizon
    const fields = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        roughness: 1,
        map: canvasTexture(
          'sunrise-fields',
          256,
          256,
          (g, w, h) => {
            const r = rng(62);
            for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) (g.fillStyle = ['#3a4a2a', '#4a5230', '#2e3e26', '#5a5a34'][Math.floor(r() * 4)]), g.fillRect(x, y, 32, 32);
            g.strokeStyle = 'rgba(20,24,14,0.6)';
            for (let i = 0; i <= w; i += 32) {
              g.beginPath();
              g.moveTo(i, 0);
              g.lineTo(i, h);
              g.moveTo(0, i);
              g.lineTo(w, i);
              g.stroke();
            }
          },
          { repeat: true },
        ),
      }),
    );
    ((fields.material as THREE.MeshStandardMaterial).map as THREE.Texture).repeat.set(60, 60);
    fields.position.set(0, -50, 1200);
    this.group.add(fields);
    // low hills on the horizon, the sun comes up over them
    const ridge = new THREE.Mesh(
      new THREE.CylinderGeometry(820, 820, 60, 96, 1, true, -Math.PI / 2, Math.PI),
      new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        transparent: true,
        color: 0x0a0c14,
        map: canvasTexture('sunrise-ridge', 1024, 64, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.moveTo(0, h);
          for (let x = 0; x <= w; x += 4) g.lineTo(x, h * 0.72 + Math.sin(x * 0.009) * 5 + Math.sin(x * 0.031) * 2);
          g.lineTo(w, h);
          g.fill();
        }),
      }),
    );
    ridge.position.set(0, -48, 0);
    ridge.name = 'ridge';
    this.group.add(ridge);

    // the minimal stage: a timber platform and a square timber frame, a few warm lamps
    const timber = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(12, 1.1, 6), timber);
    deck.position.set(0, -0.55, 1.6);
    this.group.add(deck);
    for (const x of [-5.6, 5.6]) {
      for (const z of [-1.2, 4.4]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.6, 0.22), timber);
        post.position.set(x, 2.3, z);
        this.group.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 5.8), timber);
      beam.position.set(x, 4.6, 1.6);
      this.group.add(beam);
    }
    for (const z of [-1.2, 4.4]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.26, 0.22), timber);
      beam.position.set(0, 4.6, z);
      this.group.add(beam);
    }
    const nm = nameStyleFor('sunrise');
    const b = booth({ w: 2.4, d: 0.85, front: timber, strip: '#ffd2a0', name: nm.booth });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 2.4, TABLE_Y, -0.42, 701);
    for (const s of [-1, 1]) {
      const stack = speaker(1.1, 1.6, 0.9, 'mid', 0x18181a);
      stack.position.set(s * 4.6, 0.8, -0.6);
      stack.rotation.y = Math.PI;
      this.group.add(stack);
    }
    // your name, a white installation standing on the slope beside the stage
    if (nm.sign) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 0.08), timber);
      frame.position.set(-11, 1.6, -3);
      frame.rotation.y = 0.3;
      this.group.add(frame);
      this.nameSign(nm.sign, 4.2, 1.1, V(-11, 2.25, -3), Math.PI + 0.3, 1.2);
    }
    this.add(new Globes([-4, -2, 0, 2, 4].map((x) => ({ pos: V(x, 3.9, -1.0), r: 0.11 })), '#ffb46a', 4.5));
    this.add(new MovingHeads([-4.5, -1.5, 1.5, 4.5].map((x) => ({ pos: V(x, 4.4, -1.2) })), { length: 16, radius: 0.8, gain: 0.85, floorY: -1.1 }));
    this.wash(V(0, 4, -6), 0, 2.5, 14);
    this.wash(V(-8, 3, -16), 1, 2, 14);
    this.wash(V(8, 3, -16), 2, 2, 14);
    this.add(new HazeLayer(new THREE.Box3(V(-20, 0, -40), V(20, 6, 4)), 4, 0.25));

    // everyone who's lasted the night, up the hill
    const clothes = ['#2a2d33', '#d8c8a8', '#5a1e2a', '#e8e2d4', '#3a4a5a', '#8a6a4a', '#f2efe8', '#1b1d22', '#c86a8a', '#3a7a6a'];
    const front = crowdArea(-13, 13, -2.4, -10, 1.6, 702).map((p) => ({ ...p, y: groundY(p.x, p.z) }));
    const crew = vipCrew(crewArc(0, 1.8, 2.8, 0.6, 2.4), 706, clothes);
    if (crew) this.add(crew);
    this.add(security([{ x: -3.4, z: -1.8, y: -1.1 }, { x: 3.4, z: -1.8, y: -1.1 }], 707));
    this.crowd = new Crowd(front, { seed: 703, phones: 0.06, drinks: 0.2, signs: 2, clothes, booth: V(0, 0, 0.2), shorts: 0.35, look: 'beach' });
    this.group.add(this.crowd.object);
    const density = (x: number, z: number) => {
      if (z > -10 && Math.abs(x) < 13) return 0;
      const half = 18 + (-z - 2) * 0.7;
      if (Math.abs(x) > half || z > -2.4) return 0;
      return 1.5 - Math.min(0.9, (-z - 10) / 90);
    };
    this.farCrowd = new FarCrowd(scatter(-90, 90, -95, -2.4, density, 704).map((p) => ({ ...p, y: groundY(p.x, p.z) })), { seed: 705, clothes, phones: 0.05, focus: V(0, 2, 6) });
    this.group.add(this.farCrowd.object);
    this.dress(nm.sign !== undefined);

    // over the valley: balloons up for the dawn, burners glowing in the dark, climbing as it gets light
    const night = () => this.look.night;
    this.add(
      new Balloons(
        [
          { pos: V(30, 10, 150), size: 20, colors: ['#e8402a', '#f6c445'] },
          { pos: V(-60, 17, 200), size: 22, colors: ['#2a6ad8', '#f2efe8'] },
          { pos: V(95, 5, 230), size: 19, colors: ['#3aa05a', '#f2d23a'] },
          { pos: V(-15, 23, 260), size: 23, colors: ['#8a3ad8', '#ff9a3a'] },
          { pos: V(140, 18, 175), size: 19, colors: ['#f2efe8', '#e83a6a'] },
          { pos: V(-120, 8, 160), size: 18, colors: ['#f2a03a', '#2a3a8a'] },
        ],
        { night, wind: V(1, 0, 0), span: 320, climb: 16 },
      ),
    );
    // birds as it gets light: a flock looping over the stage and the valley, a smaller one further out
    const dawn = () => THREE.MathUtils.smoothstep(1 - this.look.night, 0.25, 0.6);
    this.add(new Birds({ count: 24, center: V(10, 22, 70), radius: V(70, 4, 30), speed: 9, size: 0.9, color: '#16120e', seed: 721, visible: dawn }));
    this.add(new Birds({ count: 13, center: V(-40, 34, 160), radius: V(90, 6, 40), speed: 8, size: 1.0, color: '#1a1612', seed: 722, glide: 0.45, visible: dawn }));
  }

  /**
   * The hillside after a night of it: a dressed timber stage (greenery on
   * the frame, drapes, rugs), festoons and bunting strung up the hill, trees
   * against the sky, hay bales round fire pits, bell tents, a bar on a deck,
   * fences, and the trodden grass.
   */
  private dress(hasSign: boolean): void {
    const d = new Dresser(711);
    const G = (x: number, z: number) => V(x, groundY(x, z), z);
    const slope = Math.atan(0.13);
    const half = (z: number) => 18 + (-z - 2) * 0.7;
    // the stage: plank seams, a fascia, steps down the side, a rail at the back where the land falls away
    for (let z = -1.3; z < 4.6; z += 0.16) d.box('darkWood', 12, 0.003, 0.012, 0, 0.0015, z);
    d.box('darkWood', 12.1, 0.22, 0.05, 0, -0.11, -1.43);
    d.steps(V(-7.68, -1.1, 0.6), Math.PI / 2, 6, 1.0, 1.1 / 6, 0.28, 'wood');
    d.rail([V(-6, 0, 4.5), V(6, 0, 4.5)], 1.0, 2);
    // rugs under the booth, wedges for the DJ, cases at the back corners
    d.rug(V(0, 0, 0.9), 0, 3.2, 2.2, 0);
    d.rug(V(-3.6, 0, 2.6), 0.2, 2.0, 1.4, 2);
    for (const s of [-1, 1]) {
      d.wedge(V(s * 1.9, 0, 0.1), Math.atan2(-s * 1.9, 0.5));
      d.roadCase(V(s * 4.6, 0, 3.6), 0.1 * s, 1.0, 0.7, 0.7);
      d.roadCase(V(s * 4.6, 0.7, 3.6), -0.05 * s, 0.8, 0.5, 0.6);
    }
    // the frame dressed: greenery along the front beam, vines hanging, drapes tied at the front posts
    for (let x = -5.6; x <= 5.6; x += 0.32) {
      d.put('foliage', new THREE.IcosahedronGeometry(0.16 + d.r() * 0.14, 0).translate(x, 4.62 + (d.r() - 0.5) * 0.12, -1.2 + (d.r() - 0.5) * 0.2));
      if (d.r() < 0.45) {
        const len = 0.5 + d.r() * 1.1;
        d.put('leaf', new THREE.PlaneGeometry(0.1, len, 1, 2).translate(x + (d.r() - 0.5) * 0.2, 4.55 - len / 2, -1.25));
      }
    }
    for (const s of [-1, 1]) {
      const drape = new THREE.PlaneGeometry(0.8, 4.4, 10, 1);
      const p = drape.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < p.count; j++) {
        const y = p.getY(j);
        // gathered towards the post at the bottom
        p.setX(j, p.getX(j) * (0.45 + 0.55 * ((y + 2.2) / 4.4)));
        p.setZ(j, Math.sin(p.getX(j) * 26) * 0.04);
      }
      d.put('canvas', drape.translate(s * 5.35, 2.35, -1.36));
    }
    // a generator on the level by the stage, its feed to the stage
    d.generator(V(9.5, -1.1, 3.2), -Math.PI / 2);
    d.tube('rubber', [V(8.7, -1.06, 3.2), V(7.4, -1.06, 2.6), V(6.1, -0.9, 2.4)], 0.03, 5);

    // posts up the hill, festoons zig-zagging between them, bunting on the cross spans
    const bulb = d.glow('#ffcf7a', 'breathe', 2.2);
    const rows = [-9, -22, -36, -52];
    const post = (s: number, z: number) => {
      const p = G(s * (half(z) * 0.5 + 3), z);
      d.box('wood', 0.16, 5.2, 0.16, p.x, p.y + 2.6, p.z);
      return p.setY(p.y + 5);
    };
    const tops = rows.map((z) => [post(-1, z), post(1, z)]);
    for (const s of [-1, 1]) d.festoon(V(s * 5.6, 4.6, -1.2), tops[0][s < 0 ? 0 : 1], 0.5, bulb);
    for (let i = 0; i < tops.length; i++) {
      d.festoon(tops[i][0], tops[i][1], 1.4, bulb);
      d.bunting(tops[i][0].clone().setY(tops[i][0].y - 0.3), tops[i][1].clone().setY(tops[i][1].y - 0.3), 1.6);
      if (i > 0) for (const k of [0, 1]) d.festoon(tops[i - 1][k], tops[i][k], 0.6, bulb);
    }
    // delay speakers on poles for the top of the hill
    for (const s of [-1, 1]) for (const z of [-30, -58]) d.poleSpeaker(G(s * (half(z) * 0.5 + 4.5), z), Math.PI, 4.2);

    // trees: behind the stage where the land drops (they stand against the sunrise), and down both sides of the hill
    for (const [x, z, h, kind] of [
      [-11, 9, 9, 0], [12.5, 11, 10, 0], [-16.5, 14, 11, 1], [17.5, 7.5, 8.5, 0], [-24, 18, 12, 1], [26, 16, 11, 1], [-7.5, 22, 9, 0], [9, 26, 12, 1], [-31, 10, 10, 0], [33, 22, 13, 1],
    ] as [number, number, number, number][]) {
      if (kind) d.pine(G(x, z), h);
      else d.tree(G(x, z), h);
    }
    for (const s of [-1, 1])
      for (const z of [-6, -20, -34, -48, -64, -80]) {
        const x = s * (half(z) + 7 + d.r() * 6);
        if (d.r() < 0.5) d.pine(G(x, z), 9 + d.r() * 5);
        else d.tree(G(x, z), 7 + d.r() * 4);
      }

    // round bales at the edges, square ones round two fire pits, rugs and blankets on the grass
    for (const [x, z, yaw] of [[-30, -8, 0.4], [-33, -11, 1.3], [29, -12, 2.1], [34, -46, 0.2], [-38, -40, 1.1]] as [number, number, number][]) d.hayBale(G(x, z), yaw, true);
    for (const [cx, cz] of [[-24, -18], [23, -30]] as [number, number][]) {
      d.firePit(G(cx, cz));
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        const p = G(cx + Math.cos(a) * 2.2, cz + Math.sin(a) * 2.2);
        d.hayBale(p, -a + Math.PI / 2);
      }
    }
    for (const [x, z, yaw, seed] of [[-20, -10, 0.3, 1], [-22, -24, -0.5, 3], [19, -16, 0.8, 0], [21, -40, -0.2, 2], [-27, -48, 0.4, 1], [26, -56, 1.2, 3]] as [number, number, number, number][]) {
      d.rug(G(x, z), yaw, 1.6, 1.2, seed, slope);
    }
    // bell tents at the top of the hill, lamps lit inside
    const tentLamp = d.glow('#ffb46a', 'breathe', 1.4);
    for (const [x, z, yaw] of [[-40, -58, 0.6], [-46, -50, 0.9], [-38, -70, 0.3], [42, -66, -0.5], [48, -58, -0.8]] as [number, number, number][]) d.bellTent(G(x, z), yaw, 2.2, tentLamp);
    d.sign('CAMP', G(-34, -48).add(V(0, 1.5, 0)), 0.5, 1.2, 0.45, '#2a2018', '#f2e6c8', groundY(-34, -48));

    // a bar on a timber deck at the side of the hill, counter facing down to the stage
    const bx = -27;
    const bz = -30;
    const top = groundY(bx, bz - 2.5) + 0.15;
    const low = Math.min(groundY(bx - 6, bz + 2.5), groundY(bx + 6, bz + 2.5));
    d.box('wood', 13, top - low + 0.1, 5.4, bx, (top + low - 0.1) / 2, bz);
    d.barTent(V(bx, top + 0.05, bz), 0, 11);
    d.rail([V(bx - 6.5, top + 0.05, bz + 2.7), V(bx - 3, top + 0.05, bz + 2.7)], 1.0, 1.75);
    d.rail([V(bx + 3, top + 0.05, bz + 2.7), V(bx + 6.5, top + 0.05, bz + 2.7)], 1.0, 1.75);
    d.wheelieBins(G(bx + 8, bz + 1), 0, 3);
    d.portaloos(G(40, -30), -Math.PI / 2 - 0.3, 6);
    d.sign('TOILETS', G(37, -22).add(V(0, 1.6, 0)), -Math.PI / 2, 1.6, 0.5, '#2a2018', '#f2e6c8', groundY(37, -22));
    // a post-and-rail fence round the field
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let z = -3; z >= -96; z -= 3) pts.push(G(s * (half(z) + 3), z));
      d.postRail(pts);
    }
    // the name installation stands on two posts
    if (hasSign)
      for (const s of [-1, 1]) {
        const x = -11 + Math.cos(0.3) * s * 2;
        const z = -3 - Math.sin(0.3) * s * 2;
        d.box('wood', 0.09, 2.9 - groundY(x, z), 0.09, x, (2.9 + groundY(x, z)) / 2, z, 0.3);
      }
    // the grass: trodden to mud in front of the stage, cups on the slope
    d.mud(-14, 14, -26, -2.2, 0, 71, groundY);
    d.litter(-15, 15, -42, -2.6, 150, 0, groundY);
    this.add(d.done());
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    const l = this.look;
    const k = setClock.progress;
    if (k < this.lastProgress - 0.2) this.cleared = false;
    this.lastProgress = k;
    // the moment: the sun's disc clears the horizon (late in the set: the final track)
    if (!this.cleared && l.sun > 0.55 && k > 0.85) {
      this.cleared = true;
      this.clearedT = 0;
      moments.emit({ venue: 'sunrise', label: 'The sun clears the horizon', crowd: 'cheer' });
    }
    if (this.cleared) this.clearedT += dt;
    const day = 1 - l.night;
    this.amb.copy(l.ambSky).multiplyScalar(l.amb * 0.6).lerp(l.sunColor, Math.min(0.35, l.light * 0.12));
    this.farCrowd.ambient(this.amb);
    // tired through the night, euphoric as the light comes; the whole hill goes up at the moment
    let hype = s.hype * (0.75 + 0.25 * day);
    let peak = s.peak;
    if (this.cleared && this.clearedT < 24) {
      hype = Math.max(hype, 0.95);
      peak = Math.max(peak, 0.8 * (1 - this.clearedT / 24));
    }
    const st = { ...s, hype, peak, dropHit: s.dropHit || (this.cleared && this.clearedT - dt <= 0) };
    this.crowd.update(st, dt, camera);
    this.farCrowd.update(st, dt);
  }
}

export const sunrise: VenueDef = {
  id: 'sunrise',
  name: 'Sunrise Closing Set',
  short: 'Sunrise',
  place: 'A hillside at dawn',
  kind: 'Open air · closing set',
  blurb: 'A stage at the foot of a hill. It starts in the dark; the sunrise is the light show.',
  palette: ['#ffb070', '#ff6a8a', '#8a88ff'],
  ui: '#ffb070',
  capacity: '10,000',
  build: () => new Sunrise(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h * 0.6);
    grad.addColorStop(0, '#2a4a90');
    grad.addColorStop(0.7, '#ff9a6a');
    grad.addColorStop(1, '#ffd2a0');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h * 0.6);
    const sun = g.createRadialGradient(w * 0.56, h * 0.6, 0, w * 0.56, h * 0.6, h * 0.3);
    sun.addColorStop(0, 'rgba(255,240,200,1)');
    sun.addColorStop(0.25, 'rgba(255,200,120,0.8)');
    sun.addColorStop(1, 'rgba(255,160,100,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h * 0.6);
    g.fillStyle = '#1a1820';
    g.beginPath();
    g.moveTo(0, h * 0.62);
    for (let x = 0; x <= w; x += 6) g.lineTo(x, h * 0.6 + Math.sin(x * 0.05) * 2);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.fill();
    const r = rng(7);
    g.fillStyle = '#08080c';
    for (let i = 0; i < 500; i++) {
      const y = h * (0.7 + Math.pow(r(), 0.8) * 0.3);
      g.fillRect(r() * w, y, 2, 3);
    }
    g.fillStyle = '#3a2a20';
    g.fillRect(w * 0.42, h * 0.62, w * 0.16, h * 0.05);
  },
};
