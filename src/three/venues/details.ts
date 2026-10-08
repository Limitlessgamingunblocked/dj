/*
 * The details that make a room read as a real venue rather than a set:
 *   exitSign      green emergency-exit signs over the doors
 *   barCounter    a bar along a wall: counter, back shelf of lit bottles,
 *                 warm under-glow
 *   boothClutter  what's really on a DJ booth: laptop on a stand, drinks,
 *                 a cable run off the back, gaffer tape on the front
 *   PillarBars    steel pillars each carrying a pair of vertical LED battens
 *                 that follow the show (big warehouse clubs)
 *   LightBar      one long fixed light bar across a room (Berghain)
 *   pressLine     old printing presses, part-lit, along a hall's side
 *                 (Printworks)
 *   DustMotes     specks drifting through the booth light, only visible a
 *                 few metres from the camera
 * All of it is cheap: merged or instanced geometry, emissive materials, no
 * extra lights.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';
import { canvasTexture, rng } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/* ------------------------------------------------------------------ */
/* exit signs                                                           */
/* ------------------------------------------------------------------ */

function exitTexture(): THREE.CanvasTexture {
  return canvasTexture('exit-sign', 256, 96, (g, w, h) => {
    g.fillStyle = '#0a8a3c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#eafff1';
    // running figure towards a door (the generic emergency-exit pictogram)
    g.fillRect(14, 14, 44, 68);
    g.fillStyle = '#0a8a3c';
    g.fillRect(20, 20, 32, 56);
    g.fillStyle = '#eafff1';
    g.beginPath();
    g.arc(78, 26, 7, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.strokeStyle = '#eafff1';
    g.beginPath();
    g.moveTo(76, 36);
    g.lineTo(70, 56);
    g.lineTo(80, 72);
    g.moveTo(70, 56);
    g.lineTo(58, 70);
    g.moveTo(74, 42);
    g.lineTo(88, 50);
    g.moveTo(74, 42);
    g.lineTo(62, 46);
    g.stroke();
    g.font = '800 46px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('EXIT', 112, h / 2 + 2);
  });
}

let exitMat: THREE.MeshBasicMaterial | null = null;
const exitBody = new THREE.MeshStandardMaterial({ color: 0xd8dad6, roughness: 0.6 });

/** An emergency-exit sign facing +Z at `pos` (rotate with `yaw`). */
export function exitSign(pos: THREE.Vector3, yaw = 0): THREE.Group {
  exitMat ??= new THREE.MeshBasicMaterial({ map: exitTexture(), color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false });
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.17, 0.06), exitBody);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.15), exitMat);
  face.position.z = 0.031;
  g.add(box, face);
  g.position.copy(pos);
  g.rotation.y = yaw;
  return g;
}

/* ------------------------------------------------------------------ */
/* bar                                                                  */
/* ------------------------------------------------------------------ */

/**
 * A bar counter `len` long, front facing +Z, centred on the origin (place
 * and rotate the returned group). `glow` tints the under-counter light.
 */
export function barCounter(len: number, o: { glow?: string; top?: number; body?: number; seed?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const r = rng(o.seed ?? 9);
  const body = new THREE.MeshStandardMaterial({ color: o.body ?? 0x15120f, roughness: 0.7, metalness: 0.1 });
  const top = new THREE.MeshStandardMaterial({ color: o.top ?? 0x2a2622, roughness: 0.35, metalness: 0.2 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(len, 1.05, 0.6), body);
  counter.position.set(0, 0.525, 0);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, 0.05, 0.7), top);
  slab.position.set(0, 1.075, 0.02);
  // warm strip under the counter lip, light on the floor in front
  const glowCol = new THREE.Color(o.glow ?? '#ffb060');
  const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: glowCol.clone().multiplyScalar(2.2), toneMapped: false }));
  strip.position.set(0, 1.03, 0.33);
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(len, 1.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture(), color: glowCol.clone().multiplyScalar(0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  pool.position.set(0, 0.012, 0.75);
  // back shelf: lit glass shelves with bottles
  const shelfMat = new THREE.MeshBasicMaterial({ color: glowCol.clone().multiplyScalar(0.9), toneMapped: false });
  const back = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, 0.3), body);
  back.position.set(0, 1.1, -1.25);
  g.add(counter, slab, strip, pool, back);
  const bottles: THREE.BufferGeometry[] = [];
  for (const y of [1.25, 1.75]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(len - 0.2, 0.025, 0.24), shelfMat);
    shelf.position.set(0, y, -1.05);
    g.add(shelf);
    for (let x = -len / 2 + 0.2; x < len / 2 - 0.2; x += 0.09 + r() * 0.05) {
      const hgt = 0.22 + r() * 0.12;
      bottles.push(new THREE.CylinderGeometry(0.035, 0.038, hgt, 6).translate(x, y + 0.012 + hgt / 2, -1.05 + (r() - 0.5) * 0.08));
    }
  }
  if (bottles.length) {
    const bottleMat = new THREE.MeshStandardMaterial({ color: 0x3a5a3a, roughness: 0.15, metalness: 0.1, emissive: glowCol, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 });
    g.add(new THREE.Mesh(mergeGeometries(bottles)!, bottleMat));
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* booth clutter                                                        */
/* ------------------------------------------------------------------ */

let tapeTex: THREE.CanvasTexture | null = null;
function gafferTexture(): THREE.CanvasTexture {
  tapeTex ??= canvasTexture('gaffer', 128, 32, (g, w, h) => {
    g.fillStyle = '#161718';
    g.fillRect(0, 0, w, h);
    const r = rng(77);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
      g.fillRect(r() * w, r() * h, 2, 1);
    }
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.moveTo(0, h - 3);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h - 3 - r() * 3);
    g.stroke();
  });
  return tapeTex;
}

/**
 * Laptop on a stand, drinks, a cable run and gaffer tape for a booth of width
 * `w` whose top is at `top` and front face at z = `front` (the room side is
 * −Z). Adds to `group`.
 */
export function boothClutter(group: THREE.Group, w: number, top: number, front: number, seed = 3): void {
  const r = rng(seed);
  const side = r() < 0.5 ? -1 : 1;
  // laptop on a stand at one end, screen facing the DJ (+Z)
  const metal = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.35, metalness: 0.8 });
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.22).translate(0, 0.06, 0), new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.5, metalness: 0.4 }));
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.015, 0.22), metal);
  base.position.set(0, 0.13, 0);
  base.rotation.x = -0.25;
  const lid = new THREE.Group();
  const lidBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.21, 0.01), metal);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.18), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.45, 0.7), toneMapped: false }));
  screen.position.z = 0.006;
  lid.add(lidBody, screen);
  lid.position.set(0, 0.24, -0.1);
  lid.rotation.x = -0.25;
  const laptop = new THREE.Group();
  laptop.add(stand, base, lid);
  laptop.position.set(side * (w / 2 - 0.2), top, front + 0.42);
  laptop.rotation.y = side * 0.35;
  group.add(laptop);
  // drinks at the other end: a plastic cup and a bottle of water
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.032, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0xc41f1f, roughness: 0.4 }));
  cup.position.set(-side * (w / 2 - 0.16), top + 0.06, front + 0.3);
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 10), new THREE.MeshStandardMaterial({ color: 0xbfd8e8, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55 }));
  bottle.position.set(-side * (w / 2 - 0.28), top + 0.12, front + 0.5);
  group.add(cup, bottle);
  // cable run hanging off the back of the booth
  const curve = new THREE.CatmullRomCurve3([V(side * 0.4, top + 0.01, front + 0.9), V(side * 0.6, top - 0.05, front + 1.02), V(side * 0.75, top - 0.5, front + 1.08), V(side * 0.95, 0.02, front + 1.25)]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.009, 5), new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.6 }));
  group.add(cable);
  // gaffer tape strips on the booth front
  const tape = new THREE.MeshStandardMaterial({ map: gafferTexture(), roughness: 0.55 });
  for (let i = 0; i < 3; i++) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.22 + r() * 0.3, 0.05), tape);
    strip.position.set((r() - 0.5) * (w - 0.6), top - 0.12 - r() * 0.45, front - 0.003);
    strip.rotation.set(0, Math.PI, (r() - 0.5) * 0.25);
    group.add(strip);
  }
}

/* ------------------------------------------------------------------ */
/* contact-shadow texture                                               */
/* ------------------------------------------------------------------ */

export function blobTexture(): THREE.CanvasTexture {
  return canvasTexture('blob', 128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/* ------------------------------------------------------------------ */
/* pillars with LED battens                                             */
/* ------------------------------------------------------------------ */

export class PillarBars implements Fixture {
  readonly object = new THREE.Group();
  private bars: THREE.InstancedMesh;
  private c = new THREE.Color();
  private n: number;

  /** pillars from floor `y0` to `y1` at `spots`; each carries two vertical LED bars facing the room centre (x = 0) */
  constructor(spots: THREE.Vector3[], y0: number, y1: number) {
    const h = y1 - y0;
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.55, metalness: 0.7 });
    const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, h, 0.42), steel, spots.length);
    this.n = spots.length * 2;
    this.bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, h * 0.36, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), this.n);
    const m = new THREE.Matrix4();
    spots.forEach((p, i) => {
      pillars.setMatrixAt(i, m.makeTranslation(p.x, y0 + h / 2, p.z));
      const face = p.x > 0 ? -0.24 : 0.24;
      for (let j = 0; j < 2; j++) {
        this.bars.setMatrixAt(i * 2 + j, m.makeTranslation(p.x + face, y0 + h * (j ? 0.72 : 0.32), p.z));
        this.bars.setColorAt(i * 2 + j, this.c.setRGB(0.05, 0.05, 0.05));
      }
    });
    this.object.add(pillars, this.bars);
  }

  update(s: ShowState): void {
    const b = s.beat;
    for (let i = 0; i < this.n; i++) {
      const pillar = Math.floor(i / 2);
      // chase down the room on the beat, all together on the peak
      const chase = s.peak > 0.5 ? 1 : 0.35 + 0.65 * Math.max(0, Math.cos((b * Math.PI) / 2 - pillar * 0.9));
      const level = (0.25 + s.kick * 0.9 + s.strobe * 2) * chase * s.master * s.intensity;
      // (the beat count is negative before a track's first beat)
      this.bars.setColorAt(i, this.c.copy(s.colors[(((i + Math.floor(b / 4)) % 2) + 2) % 2]).multiplyScalar(level * 2.4));
    }
    this.bars.instanceColor!.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* Berghain-style fixed light bar                                       */
/* ------------------------------------------------------------------ */

export class LightBar implements Fixture {
  readonly object = new THREE.Group();
  private lamps: THREE.MeshBasicMaterial;
  private glow: THREE.MeshBasicMaterial;

  /** a bar from `a` to `b` with lamps facing down */
  constructor(a: THREE.Vector3, b: THREE.Vector3) {
    const len = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a).normalize();
    const steel = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.5, metalness: 0.7 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.22), steel);
    this.lamps = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const lampGeo: THREE.BufferGeometry[] = [];
    for (let x = -len / 2 + 0.3; x < len / 2; x += 0.6) lampGeo.push(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 10).translate(x, -0.09, 0));
    const lamps = new THREE.Mesh(mergeGeometries(lampGeo)!, this.lamps);
    // soft spill below the bar so it reads as a light source in the haze
    this.glow = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(len * 1.05, 3.2), this.glow);
    spill.position.y = -1.4;
    const g = new THREE.Group();
    g.add(beam, lamps, spill);
    g.position.copy(mid);
    g.quaternion.setFromUnitVectors(V(1, 0, 0), dir);
    this.object.add(g);
  }

  update(s: ShowState): void {
    // fixed warm-white bar: steady in the groove, hits with strobes and blinders
    const level = (0.55 + s.kick * 0.25 + s.flash * 2.2) * s.master * s.intensity;
    this.lamps.color.setRGB(2.4 * level, 2.2 * level, 1.9 * level);
    this.glow.color.setRGB(0.12 * level, 0.11 * level, 0.095 * level);
  }
}

/* ------------------------------------------------------------------ */
/* printing presses                                                     */
/* ------------------------------------------------------------------ */

/**
 * A line of old printing presses along z (from `z0` to `z1`) centred on x,
 * at floor `y`: steel frames with roller drums, catwalk rails and a few warm
 * work lamps still lit.
 */
export function pressLine(x: number, y: number, z0: number, z1: number, seed = 5): THREE.Group {
  const g = new THREE.Group();
  const r = rng(seed);
  const steel = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6, metalness: 0.65 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.7, metalness: 0.5 });
  const frames: THREE.BufferGeometry[] = [];
  const drums: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  const step = 9;
  for (let z = Math.max(z0, z1); z > Math.min(z0, z1) + step * 0.5; z -= step) {
    const L = 6.4;
    const H = 3.2 + r() * 0.6;
    const zc = z - step / 2;
    // two side frames and a top beam
    for (const sx of [-1.6, 1.6]) frames.push(new THREE.BoxGeometry(0.3, H, L).translate(x + sx, y + H / 2, zc));
    frames.push(new THREE.BoxGeometry(3.5, 0.3, L).translate(x, y + H, zc));
    frames.push(new THREE.BoxGeometry(3.6, 0.5, L + 0.6).translate(x, y + 0.25, zc));
    // roller drums across the frame
    for (let k = 0; k < 4; k++) drums.push(new THREE.CylinderGeometry(0.42, 0.42, 3.0, 16).rotateZ(Math.PI / 2).translate(x, y + 0.9 + (k % 2) * 1.1, zc - L / 2 + 0.9 + k * 1.5));
    // catwalk rail on top
    frames.push(new THREE.BoxGeometry(0.06, 0.06, L).translate(x - 1.5, y + H + 1.0, zc));
    frames.push(new THREE.BoxGeometry(0.06, 0.06, L).translate(x + 1.5, y + H + 1.0, zc));
    // a couple of work lamps still burning
    if (r() < 0.75) lamps.push(new THREE.SphereGeometry(0.09, 8, 6).translate(x + (r() < 0.5 ? -1.4 : 1.4), y + H - 0.4, zc + (r() - 0.5) * L * 0.6));
  }
  g.add(new THREE.Mesh(mergeGeometries(frames)!, steel), new THREE.Mesh(mergeGeometries(drums)!, dark));
  if (lamps.length) g.add(new THREE.Mesh(mergeGeometries(lamps)!, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.7, 0.6), toneMapped: false })));
  return g;
}

/* ------------------------------------------------------------------ */
/* dust in the booth light                                              */
/* ------------------------------------------------------------------ */

export class DustMotes implements Fixture {
  readonly object: THREE.Points;
  private u = { uTime: { value: 0 }, uLevel: { value: 0.4 }, uColor: { value: new THREE.Color(1, 0.95, 0.88) } };

  /** `count` specks drifting through `box`; one draw call, no lights */
  constructor(box: THREE.Box3, count = 320, seed = 5) {
    const r = rng(seed);
    const size = box.getSize(new THREE.Vector3());
    const pos = new Float32Array(count * 3);
    const sd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = box.min.x + r() * size.x;
      pos[i * 3 + 1] = r() * size.y;
      pos[i * 3 + 2] = box.min.z + r() * size.z;
      sd[i] = r();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    geo.boundingSphere = new THREE.Sphere(box.getCenter(new THREE.Vector3()), size.length() / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.u, uY0: { value: box.min.y }, uH: { value: size.y } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime, uY0, uH;
        varying float vA;
        void main() {
          vec3 p = position;
          // slow fall with a lazy sway, wrapping round the box
          p.y = uY0 + mod(p.y - uTime * (0.02 + aSeed * 0.03), uH);
          p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.12;
          p.z += cos(uTime * 0.23 + aSeed * 31.0) * 0.12;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          // only close to the camera, never right on the lens; specks catch the light now and then
          vA = smoothstep(0.35, 0.9, d) * (1.0 - smoothstep(4.0, 7.0, d)) * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.6 + aSeed) + aSeed * 60.0), 4.0));
          gl_PointSize = clamp(5.0 / max(d, 0.1), 1.0, 4.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uLevel;
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(uColor * uLevel * vA * smoothstep(0.5, 0.1, r), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.Points(geo, mat);
  }

  update(s: ShowState, dt: number): void {
    this.u.uTime.value += dt;
    this.u.uColor.value.setRGB(1, 0.95, 0.88).lerp(s.colors[0], 0.25);
    this.u.uLevel.value = (0.35 + s.wash * 0.4 + s.flash * 1.2) * s.master;
  }
}
