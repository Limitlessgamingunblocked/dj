/*
 * The Basement Club (Section 5.2): capacity 80. A low ceiling with exposed
 * pipes, black walls, one red light, a tiny booth on the same level as the
 * crowd, close enough to touch the decks. One strobe, one red wash, a single
 * mirror ball, thick haze. Tight, dry and punchy (audio/room.ts).
 *
 * Signature moment: at peak energy, condensation drips off the pipes and the
 * crowd starts banging on the low ceiling to the kick: the pipes rattle and
 * dust shakes down on every beat.
 *
 * TODO: procedural stand-in for the Blender basement set (Section 14).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { nameStyleFor } from '../../name/venueStyles';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { boothClutter, exitSign } from './details';
import { booth, Crowd, crowdArea, HazeLayer, mirrorBall, speaker, Strobes, TABLE_Y } from './fixtures';
import { MirrorBallSpots } from './mirrorball';
import type { ShowState } from './show';
import { canvasTexture, concreteTexture, rng, withSurface } from './tex';
import type { Features } from '../../visualizer/AudioFeatures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** the room: low and tight */
export const BASEMENT = { x0: -5, x1: 5, z0: -9.5, z1: 1.8, h: 2.65 };

/** painted brick, black, a bit damp */
function brickTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'basement-brick',
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#0d0d0f';
      g.fillRect(0, 0, w, h);
      const r = rng(66);
      for (let y = 0; y < h; y += 32) {
        for (let x = (y / 32) % 2 ? -32 : 0; x < w; x += 64) {
          const v = 14 + r() * 10;
          g.fillStyle = `rgb(${v},${v},${v + 2})`;
          g.fillRect(x + 2, y + 2, 60, 28);
        }
      }
      // damp streaks running down from the ceiling
      for (let i = 0; i < 18; i++) {
        const x = r() * w;
        const grad = g.createLinearGradient(x, 0, x, h * (0.3 + r() * 0.6));
        grad.addColorStop(0, 'rgba(60,60,70,0.35)');
        grad.addColorStop(1, 'rgba(60,60,70,0)');
        g.fillStyle = grad;
        g.fillRect(x, 0, 3 + r() * 8, h);
      }
    },
    { repeat: true },
  );
}

/** a flyer pasted on the wall (made-up nights) */
function poster(seed: number): THREE.CanvasTexture {
  return canvasTexture(`bsmt-poster:${seed}`, 128, 180, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = ['#e9e2cf', '#ff2e88', '#ffb547', '#0e0e10'][seed % 4];
    g.fillRect(0, 0, w, h);
    g.fillStyle = seed % 4 === 3 ? '#ff1a2e' : '#0e0e10';
    g.font = '800 30px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText(['LOW END', 'SUB CLUB', 'NO PHONES', 'RED ROOM'][seed % 4], w / 2, h * 0.42);
    g.font = '600 13px "Barlow Condensed", sans-serif';
    g.fillText('EVERY FRIDAY · 11–5', w / 2, h * 0.58);
    g.globalAlpha = 0.3;
    for (let i = 0; i < 40; i++) g.fillRect(r() * w, r() * h, 2, 2);
  });
}

/** drips of condensation off the pipes, and dust shaken down by the banging */
class Drips {
  readonly object: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private kind: Float32Array;
  private sources: THREE.Vector3[];
  private rand = rng(9);
  /** 0..1 how much is falling */
  level = 0;
  private bang = 0;

  constructor(sources: THREE.Vector3[]) {
    this.sources = sources;
    this.n = 260;
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n);
    this.kind = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -10;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1));
    this.object = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          attribute float aKind;
          varying float vKind;
          void main() {
            vKind = aKind;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = (aKind > 0.5 ? 26.0 : 40.0) / max(0.3, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying float vKind;
          void main() {
            vec2 d = gl_PointCoord - 0.5;
            // drips: a little bright streak; dust: a soft grey speck
            float a = vKind > 0.5 ? smoothstep(0.5, 0.0, length(d * vec2(1.0, 0.45))) * 0.9 : smoothstep(0.5, 0.1, length(d)) * 0.35;
            vec3 c = vKind > 0.5 ? vec3(0.9, 0.85, 0.9) : vec3(0.55, 0.5, 0.48);
            gl_FragColor = vec4(c * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.object.frustumCulled = false;
  }

  /** a bang on the ceiling: a puff of dust from above */
  hit(): void {
    this.bang = 1;
  }

  update(dt: number): void {
    const r = this.rand;
    let spawnDrip = this.level * dt * 30;
    let spawnDust = this.bang * 40;
    this.bang = 0;
    for (let i = 0; i < this.n; i++) {
      const y = this.pos[i * 3 + 1];
      if (y > -1) {
        this.vel[i] += dt * (this.kind[i] > 0.5 ? 9.8 : 1.2);
        this.pos[i * 3 + 1] -= this.vel[i] * dt;
        continue;
      }
      if (spawnDrip > r()) {
        spawnDrip -= 1;
        const s = this.sources[Math.floor(r() * this.sources.length)];
        this.pos.set([s.x + (r() - 0.5) * 0.6, s.y - 0.05, s.z + (r() - 0.5) * 0.6], i * 3);
        this.vel[i] = 0;
        this.kind[i] = 1;
      } else if (spawnDust > 0) {
        spawnDust -= 1;
        this.pos.set([BASEMENT.x0 + 0.5 + r() * (BASEMENT.x1 - BASEMENT.x0 - 1), BASEMENT.h - 0.05, -0.8 - r() * 6], i * 3);
        this.vel[i] = 0.1 + r() * 0.2;
        this.kind[i] = 0;
      }
    }
    const g = this.object.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aKind as THREE.BufferAttribute).needsUpdate = true;
  }
}

class Basement extends VenueBase {
  readonly views: VenueViews = {
    // the back corner, looking over heads at the booth
    wide: { pos: V(-4.1, 2.2, -8.6), target: V(0.4, 1.2, 0.2) },
    wideLabel: 'Back of the room',
    crowd: { pos: V(0.6, 1.55, -3.2), target: V(0, 1.35, 0.6) },
    drone: [V(0, 2.2, -8.5), V(3.6, 2.1, -6), V(3.4, 2.1, -2), V(0.6, 2.2, -1.2), V(-3.4, 2.1, -2.2), V(-3.8, 2.1, -6.4)],
    extra: { cctv: { pos: V(4.6, 2.5, -9.2), target: V(0, 1, -3) }, crane: { radius: 3, low: 1.2, high: 2.3 } },
  };
  private red: THREE.SpotLight;
  private redLens: THREE.MeshBasicMaterial;
  private pipes = new THREE.Group();
  private drips: Drips;
  private bar: THREE.MeshBasicMaterial;
  /** the signature moment's state: 0 → 1 as the room hits the ceiling */
  private peakFor = 0;
  private sig = 0;
  private lastBeat = -1;
  private shake = 0;

  constructor() {
    super({ fog: 0x060304, fogDensity: 0.07, background: 0x020102, hemiSky: 0x2a0a0e, hemiGround: 0x050203, hemi: 0.18, flashAt: V(0, 2.3, -3), flashRange: 14 });
    this.keyLight = { color: 0xff8a8a, intensity: 6 };
    this.grade = { tint: 0xffe6e6, contrast: 1.14, saturation: 1.05, lift: 0.004 };
    this.toneMapping = 'agx';
    const { x0, x1, z0, z1, h } = BASEMENT;
    const W = x1 - x0;
    const D = z1 - z0;
    const cz = (z0 + z1) / 2;

    // the shell: black brick, a wet concrete floor, a black ceiling
    const brick = brickTexture().clone();
    brick.userData = {};
    brick.repeat.set(W / 2.4, h / 2.4);
    brick.needsUpdate = true;
    const wall = new THREE.MeshStandardMaterial({ map: brick, roughness: 0.85 });
    const fl = concreteTexture(30).clone();
    fl.userData = {};
    fl.repeat.set(W / 3, D / 3);
    fl.needsUpdate = true;
    const floorMat = withSurface(new THREE.MeshStandardMaterial({ map: fl, color: 0x5a5658, metalness: 0.1 }), 'bsmt-floor', { bumps: 0.4, grain: 0.5, rough: 0.5, roughVar: 0.25, polish: 0.35, repeat: 4, normalScale: 0.4 });
    const ceil = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W, h, D), [wall, wall, ceil, floorMat, wall, wall]);
    for (const m of shell.material as THREE.Material[]) m.side = THREE.BackSide;
    shell.position.set(0, h / 2, cz);
    shell.receiveShadow = true;
    this.group.add(shell);

    // exposed pipes along the ceiling, with brackets
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, metalness: 0.7, roughness: 0.35 });
    const geos: THREE.BufferGeometry[] = [];
    const drips: THREE.Vector3[] = [];
    for (const [x, r] of [
      [-3.2, 0.09],
      [-2.7, 0.05],
      [1.6, 0.11],
      [3.4, 0.07],
    ] as [number, number][]) {
      geos.push(new THREE.CylinderGeometry(r, r, D - 0.2, 12).rotateX(Math.PI / 2).translate(x, h - 0.16 - r, cz));
      for (let z = z0 + 1; z < z1 - 0.5; z += 1.6) {
        geos.push(new THREE.BoxGeometry(0.03, 0.16, 0.05).translate(x, h - 0.08, z));
        drips.push(V(x, h - 0.2 - r * 2, z + 0.4));
      }
    }
    for (const z of [-2.2, -5.4]) geos.push(new THREE.CylinderGeometry(0.07, 0.07, W - 0.2, 12).rotateZ(Math.PI / 2).translate(0, h - 0.34, z));
    this.pipes.add(new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed()))!, pipeMat));
    this.group.add(this.pipes);

    // the tiny booth, at floor level, the crowd right up against it
    const nm = nameStyleFor('basement');
    const b = booth({ w: 1.7, d: 0.75, front: new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.7 }), strip: '#ff1a2e', name: nm.booth });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 1.7, TABLE_Y, -0.38, 81);
    for (const x of [-1.35, 1.35]) {
      const sp = speaker(0.55, 1.05, 0.5, 'mid', 0x0a0a0b);
      sp.position.set(x, 0.53, 0.25);
      this.group.add(sp);
    }

    // the one red light, a single strobe over the booth, the mirror ball in the middle
    this.red = new THREE.SpotLight(0xff1020, 40, 14, 0.75, 0.6, 1.1);
    this.red.position.set(0, h - 0.12, -1.0);
    this.red.target.position.set(0, 0.6, -4.5);
    this.group.add(this.red, this.red.target);
    this.redLens = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.15), toneMapped: false });
    const can = new THREE.Group();
    can.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.24, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x111113, metalness: 0.5, roughness: 0.4 })));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), this.redLens);
    lens.position.z = 0.125;
    can.add(lens);
    can.position.copy(this.red.position);
    can.lookAt(this.red.target.position);
    this.group.add(can);
    this.wash(V(0, h - 0.3, -6.5), 0, 1.6, 9, 1);
    this.add(new Strobes([{ pos: V(0, h - 0.1, 0.9), tilt: -0.6 }], [0.36, 0.1, 0.06]));
    const ball = mirrorBall(0.22);
    ball.position.set(0.2, h - 0.38, -4.2);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 4), pipeMat);
    chain.position.set(0.2, h - 0.08, -4.2);
    this.group.add(ball, chain);
    this.add(new MirrorBallSpots([{ mesh: ball, spots: 120 }], { floorY: 0, x0, x1, z0, z1, ceilY: h }, 0.28));
    this.add(new HazeLayer(new THREE.Box3(V(x0 + 0.3, 0.3, z0 + 0.3), V(x1 - 0.3, h - 0.1, 0.8)), 6, 0.7));

    // a little bar at the back, glowing red, posters, the exit
    this.bar = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.08, 0.12), toneMapped: false });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.05, 0.6), new THREE.MeshStandardMaterial({ color: 0x141012, roughness: 0.6 }));
    counter.position.set(-2.4, 0.525, z0 + 0.6);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.02, 0.02), this.bar);
    glow.position.set(-2.4, 1.0, z0 + 0.92);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(3, 0.03, 0.2), new THREE.MeshStandardMaterial({ color: 0x1a1416 }));
    shelf.position.set(-2.4, 1.6, z0 + 0.12);
    this.group.add(counter, glow, shelf);
    const r = rng(77);
    for (let i = 0; i < 14; i++) {
      const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 8), new THREE.MeshPhysicalMaterial({ color: [0x2e6b3a, 0x6b3a1e, 0xbfd8e8][i % 3], roughness: 0.1, transmission: 0.4, transparent: true, opacity: 0.85 }));
      bt.position.set(-3.7 + i * 0.2 + r() * 0.04, 1.76, z0 + 0.12);
      this.group.add(bt);
    }
    this.group.add(exitSign(V(3.6, 2.2, z0 + 0.04)));
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.6), new THREE.MeshStandardMaterial({ map: poster(i), roughness: 0.9 }));
      const left = i < 3;
      p.position.set(left ? x0 + 0.02 : x1 - 0.02, 1.5 + (i % 2) * 0.15, -2 - (i % 3) * 2.2);
      p.rotation.set(0, left ? Math.PI / 2 : -Math.PI / 2, (r() - 0.5) * 0.08);
      this.group.add(p);
    }
    // the name in red neon on the back wall behind the booth
    if (nm.sign) this.nameSign(nm.sign, 2.2, 0.55, V(0, 1.85, z1 - 0.04), Math.PI, 1.05);

    // eighty people, close enough to touch the decks
    this.add(new Crowd(crowdArea(x0 + 0.4, x1 - 0.4, -0.85, z0 + 1.6, 1.15, 808, { y: 0 }), { seed: 808, phones: 0.04, drinks: 0.35, signs: 1, clothes: ['#0e0e10', '#16171a', '#1d1f24', '#2a2d33', '#5a1e22', '#0e0e10', '#d9d6cf'] }));

    this.drips = new Drips(drips);
    this.group.add(this.drips.object);
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    // the red can breathes with the bass, brighter as the room warms up
    const lv = (0.35 + 0.65 * s.master) * (0.5 + 0.7 * s.hype);
    this.red.intensity = 40 * lv * (0.8 + s.kick * 0.6);
    this.redLens.color.setRGB(3, 0.1, 0.15).multiplyScalar(0.4 + lv);
    this.bar.color.setRGB(1.6, 0.08, 0.12).multiplyScalar(0.6 + s.kick * 0.5);

    // the signature moment: a long run at the top and the ceiling gets it
    if (s.playing && s.hype > 0.86) this.peakFor += dt;
    else this.peakFor = Math.max(0, this.peakFor - dt * 3);
    const want = this.peakFor > 10 ? 1 : s.hype < 0.7 ? 0 : this.sig;
    this.sig += (want - this.sig) * Math.min(1, dt * 1.2);
    this.drips.level = this.sig;
    const beat = Math.floor(s.beat);
    if (this.sig > 0.5 && s.playing && beat !== this.lastBeat) {
      this.drips.hit();
      this.shake = 1;
    }
    this.lastBeat = beat;
    this.shake *= Math.exp(-dt * 14);
    // the pipes rattle on each bang
    this.pipes.position.y = Math.sin(this.shake * 30) * 0.006 * this.shake;
    this.drips.update(dt);
  }
}

export const basement: VenueDef = {
  id: 'basement',
  name: 'Basement Club',
  short: 'Basement',
  place: 'Underneath somewhere',
  kind: 'Basement club',
  blurb: 'Low ceiling, black walls, one red light. Eighty people close enough to touch the decks.',
  palette: ['#ff1a2e', '#ffb547', '#7a3cff'],
  ui: '#ff1a2e',
  capacity: '80',
  build: () => new Basement(),
  thumb(g, w, h) {
    g.fillStyle = '#060304';
    g.fillRect(0, 0, w, h);
    const grad = g.createRadialGradient(w / 2, h * 0.15, 4, w / 2, h * 0.5, w * 0.6);
    grad.addColorStop(0, 'rgba(255,26,46,0.9)');
    grad.addColorStop(1, 'rgba(255,26,46,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a2a2e';
    for (const x of [0.2, 0.35, 0.7]) g.fillRect(w * x, 4, 6, h * 0.08);
    g.fillStyle = '#0a0a0c';
    for (let i = 0; i < 14; i++) g.beginPath(), g.arc(w * (0.05 + i * 0.07), h * 0.85, 9, 0, Math.PI * 2), g.fill();
  },
};
