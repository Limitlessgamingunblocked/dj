/*
 * Black Rock City, the pieces: the playa, the mountains round it, the city's
 * lights, the lantern promenades, the Man and his burn, the Temple, Center
 * Camp, bikes and art cars, the propane poofers and the fireworks.
 *
 * Measurements from Burning Man's own city plan (2023 location data, the
 * 2022 and 2024 plans): the Esplanade, the city's innermost street, runs
 * 2,500 ft from the Man; the outer road (Kraken) is 11,690 ft across; Center
 * Camp is 3,026 ft out at 6:00; the Temple stands out at 12:00, about
 * 2,500 ft past the Man; promenades 40 ft wide run out along the 6:00/12:00
 * and 3:00/9:00 axes with lantern spires about every 150 ft; the city fills
 * the clock from 2:00 to 10:00; true north lies along the 4:30 axis, so
 * 12:00 points north-east and the sun comes up over the hills at about one
 * o'clock. On burn night the crowd sits in a circle about 1,000 ft from the
 * Man. Art cars drive at 5 mph; their propane poofers fire at least 10 ft up.
 *
 * The clock here: 12:00 is +Z from the Man, 3:00 is −X (on your right as
 * you face 12:00), 6:00 is −Z.
 *
 * Generic forms only: the Man, the Temple and the art cars are built to the
 * type, not copies of any year's design or anyone's artwork.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Dresser } from './dress';
import type { Fixture } from './fixtures';
import { thinFog } from './landmarks';
import { FLAME_FRAG, FLAME_VERT, Pyro } from './pyro';
import type { ShowState } from './show';
import { canvasTexture, rng, smokeTexture, softDotTexture } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const FT = 0.3048;

/** the city plan, in metres */
export const BRC = {
  esplanade: 2500 * FT,
  /** the outer road's radius */
  outer: (11690 / 2) * FT,
  centerCamp: 3026 * FT,
  temple: 2500 * FT,
  /** where the crowd sits on burn night */
  perimeter: 1000 * FT,
  lanterns: 150 * FT,
  fence: 8430 * FT,
  /** the city spans the clock from 2:00 to 10:00 */
  from: 2,
  to: 10,
};

/** the direction from the Man to a clock position (12:00 is +Z, 3:00 is −X) */
export function clockDir(hour: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = (hour / 12) * Math.PI * 2;
  return out.set(-Math.sin(a), 0, Math.cos(a));
}

/** where a clock address lands: hour and distance from the Man */
export function clockPos(man: THREE.Vector3, hour: number, dist: number, out = new THREE.Vector3()): THREE.Vector3 {
  return clockDir(hour, out).multiplyScalar(dist).add(man).setY(man.y);
}

/** the clock position of a point, as seen from the Man (0..12) */
export function clockOf(man: THREE.Vector3, p: THREE.Vector3): number {
  const a = Math.atan2(-(p.x - man.x), p.z - man.z);
  return ((((a / (Math.PI * 2)) * 12) % 12) + 12) % 12;
}

/* ------------------------------------------------------------------ */
/* the playa                                                            */
/* ------------------------------------------------------------------ */

/** the dry lake bed: pale alkali mud cracked into plates, a few tyre marks; tiles every 6 m */
export function playaTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'playa-cracks',
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#d6cfc0';
      g.fillRect(0, 0, w, h);
      const r = rng(1986);
      for (let i = 0; i < 9000; i++) {
        const v = 196 + r() * 40;
        g.fillStyle = `rgba(${v},${v - 6},${v - 18},0.35)`;
        g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
      }
      // plates: a jittered grid joined to its neighbours with ragged cracks, wrapped so it tiles
      const n = 14;
      const pts: [number, number][] = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) pts.push([((x + 0.15 + r() * 0.7) / n) * w, ((y + 0.15 + r() * 0.7) / n) * h]);
      const at = (x: number, y: number): [number, number] => {
        const p = pts[(((y % n) + n) % n) * n + (((x % n) + n) % n)];
        return [p[0] + Math.floor(x / n) * w, p[1] + Math.floor(y / n) * h];
      };
      const crack = (a: [number, number], b: [number, number]) => {
        for (const [dx, dy] of [[0, 0], [-w, 0], [0, -h], [-w, -h], [w, 0], [0, h]]) {
          g.beginPath();
          g.moveTo(a[0] + dx, a[1] + dy);
          const steps = 4;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const j = s < steps ? (r() - 0.5) * 5 : 0;
            g.lineTo(a[0] + (b[0] - a[0]) * t + j + dx, a[1] + (b[1] - a[1]) * t + j + dy);
          }
          g.stroke();
        }
      };
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const a = at(x, y);
          // a light lip either side of each crack, the crack itself dark
          for (const [col, lw] of [['rgba(240,236,226,0.55)', 3.2], ['rgba(120,108,92,0.75)', 1.1]] as [string, number][]) {
            g.strokeStyle = col;
            g.lineWidth = lw;
            crack(a, at(x + 1, y));
            crack(a, at(x, y + 1));
            if ((x + y) % 2) crack(a, at(x + 1, y + 1));
          }
        }
      // a bike track or two pressed into the crust
      g.strokeStyle = 'rgba(150,140,124,0.25)';
      g.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        const y0 = r() * h;
        g.moveTo(0, y0);
        g.bezierCurveTo(w * 0.3, y0 + (r() - 0.5) * 80, w * 0.7, y0 + (r() - 0.5) * 80, w, y0);
        g.stroke();
      }
    },
    { repeat: true },
  );
}

/**
 * The hills round the playa as seen from the Man, by compass bearing (true
 * north 0°): the Granite Range to the west, highest (Granite Peak just under
 * 9,000 ft, some 17 km off), the Calico Hills to the north-west, the Black
 * Rock Range to the north, the far Jackson Mountains east-north-east, the
 * Selenite Range south-east, and the playa running away flat to the
 * north-east, behind the Temple.
 * Returns the skyline's elevation in degrees.
 */
export function ridgeElevation(bearing: number): number {
  const b = ((bearing % 360) + 360) % 360;
  const bump = (c: number, wd: number, hgt: number) => {
    let d = Math.abs(b - c);
    d = Math.min(d, 360 - d);
    return hgt * Math.exp(-(d * d) / (2 * wd * wd));
  };
  const n = (f: number, p: number) => Math.sin((b * f * Math.PI) / 180 + p);
  // the ridgelines break up: smaller summits on every range
  const rough = 1 + 0.12 * n(23, 1) + 0.06 * n(57, 2) + 0.03 * n(131, 0.4);
  return Math.max(0.12, (bump(262, 16, 4.2) + bump(287, 8, 1.6) + bump(322, 22, 2.1) + bump(14, 13, 2.0) + bump(74, 11, 1.1) + bump(158, 26, 2.1) + bump(205, 14, 1.3) + 0.3) * rough);
}

/** the compass bearing of a direction in the venue (12:00, +Z, points north-east) */
export function bearingOf(dir: THREE.Vector3): number {
  // clock angle clockwise from 12:00, then 12:00 is 45°
  const clock = Math.atan2(-dir.x, dir.z);
  return ((((clock * 180) / Math.PI + 45) % 360) + 360) % 360;
}

/** the mountains as a ring of silhouette round the venue, `radius` out; tint it with the time of day */
export function playaMountains(radius: number, groundY: number): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
  const H = radius * Math.tan(THREE.MathUtils.degToRad(7));
  const tex = canvasTexture('playa-ridge', 2048, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // the far ranges paler, the near ones (the profile itself) full
    for (const [alpha, scale] of [[0.45, 1.12], [1, 1]] as [number, number][]) {
      g.fillStyle = `rgba(255,255,255,${alpha})`;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 2) {
        // the cylinder's u runs from +Z towards +X: θ, direction (sin θ, cos θ)
        const th = (x / w) * Math.PI * 2;
        const e = ridgeElevation(bearingOf(new THREE.Vector3(Math.sin(th), 0, Math.cos(th)))) * scale;
        const y = (radius * Math.tan(THREE.MathUtils.degToRad(e))) / H;
        g.lineTo(x, h - y * h);
      }
      g.lineTo(w, h);
      g.fill();
    }
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, color: 0x0c0e18, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, H, 128, 1, true), mat);
  mesh.position.y = groundY + H / 2 - 1.5;
  mesh.renderOrder = -5;
  return { mesh, mat };
}

/** the Milky Way: a soft band of stars across the sky, for a dark desert night */
export function milkyWay(radius: number): THREE.Mesh {
  const tex = canvasTexture('milky-way', 1024, 512, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const r = rng(77);
    // the band runs round the sky, tilted; brightest towards the galactic centre
    for (let i = 0; i < 26000; i++) {
      const u = r();
      const spread = (r() + r() + r() - 1.5) * 0.1;
      const x = u * w;
      const y = h * (0.5 + Math.sin(u * Math.PI * 2) * 0.12 + spread * (1 + Math.sin(u * Math.PI) * 0.6));
      const core = Math.exp(-Math.pow((u - 0.62) / 0.12, 2));
      const a = (0.08 + 0.5 * core) * (0.3 + r() * 0.7);
      g.fillStyle = `rgba(${200 + r() * 55},${200 + r() * 40},${220 + r() * 35},${a})`;
      g.fillRect(x, y, r() < 0.04 ? 2 : 1, r() < 0.04 ? 2 : 1);
    }
    // dust lanes through the middle
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 400; i++) {
      const u = r();
      const y = h * (0.5 + Math.sin(u * Math.PI * 2) * 0.12 + (r() - 0.5) * 0.03);
      g.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.2})`;
      g.beginPath();
      g.ellipse(u * w, y, 8 + r() * 20, 2 + r() * 4, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.BackSide, opacity: 0 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), mat);
  mesh.rotation.set(0.5, 0.9, 0.35);
  mesh.renderOrder = -9;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* the city                                                             */
/* ------------------------------------------------------------------ */

const CITY_VERT = /* glsl */ `
  attribute vec3 aCol;
  attribute vec2 aInfo;
  uniform float uTime, uScale, uNight;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // camps cycle their colours slowly; some lights twinkle; all come up with the dark
    float cyc = step(0.75, aInfo.y);
    float h = fract(aInfo.y * 7.0 + uTime * 0.05);
    vec3 hue = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    vCol = mix(aCol, hue * 1.3, cyc * 0.8);
    vA = uNight * (0.75 + 0.25 * sin(uTime * (0.6 + aInfo.y * 2.0) + aInfo.y * 40.0));
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aInfo.x * uScale / max(1.0, -mv.z), 1.0, 24.0);
  }
`;
const CITY_FRAG = /* glsl */ `
  uniform sampler2D uDot;
  varying vec3 vCol;
  varying float vA;
  void main() {
    float a = texture2D(uDot, gl_PointCoord).a;
    if (a < 0.02) discard;
    gl_FragColor = vec4(vCol * a * vA, 1.0);
  }
`;

/**
 * Black Rock City from the open playa: a horseshoe of light round the Man,
 * from 2:00 to 10:00. The Esplanade's big camps (stages, domes, towers, art
 * walls) in silhouette with their lights, the city behind them a sea of
 * small lights to the horizon, lasers from the sound camps sweeping the sky.
 */
export class CityLights implements Fixture {
  readonly object = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private beams: THREE.InstancedMesh;
  private beamMat: THREE.MeshBasicMaterial;
  private beamBase: { pos: THREE.Vector3; yaw: number; speed: number; phase: number }[] = [];
  private dummy = new THREE.Object3D();
  private t = 0;
  private night: () => number;

  constructor(man: THREE.Vector3, o: { count: number; maxDist: number; seed: number; night: () => number; d: Dresser }) {
    const r = rng(o.seed);
    this.night = o.night;
    const pos: number[] = [];
    const col: number[] = [];
    const info: number[] = [];
    const warm = [new THREE.Color('#ffd9a0'), new THREE.Color('#fff1dc'), new THREE.Color('#ffb15a')];
    const led = ['#ff2e88', '#3ad7ff', '#b6ff3b', '#7a3cff', '#ffd23f', '#ff5a2a', '#2ee6c0'].map((c) => new THREE.Color(c));
    const p = new THREE.Vector3();
    const light = (x: number, y: number, z: number, c: THREE.Color, size: number, k: number, cycle = false) => {
      pos.push(x, y, z);
      col.push(c.r * k, c.g * k, c.b * k);
      info.push(size, cycle ? 0.76 + r() * 0.24 : r() * 0.74);
    };
    // the city behind the Esplanade: denser near the front, thinning out
    for (let i = 0; i < o.count; i++) {
      const hour = BRC.from + r() * (BRC.to - BRC.from);
      const dist = BRC.esplanade + 30 + Math.pow(r(), 1.6) * (o.maxDist - BRC.esplanade);
      clockPos(man, hour, dist, p);
      const ledLight = r() < 0.35;
      light(p.x + (r() - 0.5) * 8, man.y + 1 + r() * (ledLight ? 6 : 3), p.z + (r() - 0.5) * 8, ledLight ? led[Math.floor(r() * led.length)] : warm[Math.floor(r() * warm.length)], 1.2 + r() * 1.2, 0.8 + r() * 0.8, ledLight && r() < 0.5);
    }
    // the Esplanade: a camp every 18–40 m round the arc, big structures in silhouette, lit
    const d = o.d;
    const sil: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0) => sil.push(g.rotateY(yaw).translate(x, y, z).toNonIndexed());
    const span = ((BRC.to - BRC.from) / 12) * Math.PI * 2 * (BRC.esplanade + 25);
    let s = 0;
    while (s < span) {
      const hour = BRC.from + (s / span) * (BRC.to - BRC.from);
      // leave the promenades and the plaza portals open (3:00, 4:30, 6:00, 7:30, 9:00)
      const near = [3, 4.5, 6, 7.5, 9].some((h) => Math.abs(h - hour) < 0.05);
      const dist = BRC.esplanade + 20 + r() * 25;
      clockPos(man, hour, dist, p);
      const yaw = Math.atan2(man.x - p.x, man.z - p.z);
      const kind = near ? -1 : Math.floor(r() * 6);
      const c = led[Math.floor(r() * led.length)];
      if (kind === 0) {
        // a sound stage: a frame, a canopy, a wall of LED
        add(new THREE.BoxGeometry(14, 0.6, 8), p.x, man.y + 1.5, p.z, yaw);
        for (const sx of [-6.5, 6.5]) add(new THREE.BoxGeometry(0.5, 9, 0.5), p.x + Math.cos(yaw) * sx, man.y + 4.5, p.z - Math.sin(yaw) * sx, yaw);
        add(new THREE.BoxGeometry(14, 0.5, 8), p.x, man.y + 9, p.z, yaw);
        for (let k = 0; k < 40; k++) light(p.x + Math.cos(yaw) * (k / 39 - 0.5) * 12, man.y + 2.2 + (k % 5) * 1.4, p.z - Math.sin(yaw) * (k / 39 - 0.5) * 12, c, 2.2, 1.6, true);
        this.beamBase.push({ pos: V(p.x, man.y + 9.5, p.z), yaw, speed: 0.2 + r() * 0.4, phase: r() * 6 });
      } else if (kind === 1) {
        // a geodesic dome, lit inside
        add(new THREE.SphereGeometry(7 + r() * 5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), p.x, man.y, p.z);
        for (let k = 0; k < 18; k++) light(p.x + (r() - 0.5) * 10, man.y + 1 + r() * 5, p.z + (r() - 0.5) * 10, c, 2.4, 1.1, true);
      } else if (kind === 2) {
        // a tower or a sculpture, lit up its height
        const ht = 10 + r() * 14;
        add(new THREE.CylinderGeometry(0.6, 2.2, ht, 6), p.x, man.y + ht / 2, p.z);
        for (let k = 0; k < 14; k++) light(p.x + (r() - 0.5) * 1.6, man.y + (k / 13) * ht, p.z + (r() - 0.5) * 1.6, c, 1.8, 1.4, k % 2 === 0);
      } else if (kind >= 3) {
        // shade structures, RVs, a bar under a frame: low and warm
        const w = 8 + r() * 14;
        add(new THREE.BoxGeometry(w, 2.8 + r() * 1.6, 4 + r() * 4), p.x, man.y + 1.6, p.z, yaw);
        for (let k = 0; k < 8; k++) light(p.x + Math.cos(yaw) * (r() - 0.5) * w, man.y + 2 + r() * 1.5, p.z - Math.sin(yaw) * (r() - 0.5) * w, k < 2 ? c : warm[k % 3], 1.6, 1.2, k < 2);
      }
      s += 18 + r() * 22;
    }
    if (sil.length) {
      for (const g of sil) if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      d.extra(new THREE.Mesh(mergeGeometries(sil)!, thinFog(new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 1 }), 0.5)));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 900 }, uNight: { value: 1 }, uDot: { value: softDotTexture() } },
      vertexShader: CITY_VERT,
      fragmentShader: CITY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const pts = new THREE.Points(g, this.mat);
    pts.frustumCulled = false;
    this.object.add(pts);
    // the sound camps' lasers, sweeping slowly into the sky
    const beam = new THREE.CylinderGeometry(0.05, 0.6, 420, 5, 1, true).translate(0, 210, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.beams = new THREE.InstancedMesh(beam, this.beamMat, Math.max(1, this.beamBase.length));
    this.beams.count = this.beamBase.length;
    this.beamBase.forEach((_, i) => this.beams.setColorAt(i, new THREE.Color(i % 3 === 0 ? '#2aff6a' : i % 3 === 1 ? '#3a8aff' : '#ff3aa8').multiplyScalar(1.4)));
    this.beams.frustumCulled = false;
    this.object.add(this.beams);
  }

  update(s: ShowState, dt: number): void {
    this.t += dt;
    const night = this.night();
    this.mat.uniforms.uTime.value = this.t;
    this.mat.uniforms.uScale.value = Pyro.pixelScale;
    this.mat.uniforms.uNight.value = THREE.MathUtils.smoothstep(night, 0.1, 0.7);
    this.beamMat.opacity = 0.16 * THREE.MathUtils.smoothstep(night, 0.4, 0.85);
    this.beams.visible = this.beamMat.opacity > 0.005;
    if (!this.beams.visible) return;
    // each laser sweeps its own slow arc, faster when the city's going off (the music carries)
    const k = s.reduceFlash ? 0.5 : 1;
    this.beamBase.forEach((b, i) => {
      const a = this.t * b.speed * k + b.phase;
      this.dummy.position.copy(b.pos);
      this.dummy.rotation.set(0.25 + Math.sin(a) * 0.35, b.yaw + Math.sin(a * 0.7) * 0.8, Math.cos(a * 1.3) * 0.3, 'YXZ');
      this.dummy.updateMatrix();
      this.beams.setMatrixAt(i, this.dummy.matrix);
    });
    this.beams.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* bikes                                                                */
/* ------------------------------------------------------------------ */

/**
 * Bikes riding the open playa at night: a white headlamp and a ring of EL
 * wire each, on long loops round the Man and out to the city. One Points
 * object moved each frame.
 */
export class BikeLights implements Fixture {
  readonly object: THREE.Points;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private riders: { cx: number; cz: number; r: number; a: number; w: number; c: THREE.Color; bob: number }[] = [];
  private mat: THREE.ShaderMaterial;
  private t = 0;
  private avoid: (x: number, z: number) => boolean;
  private manY: number;

  constructor(
    man: THREE.Vector3,
    o: { count: number; seed: number; avoid: (x: number, z: number) => boolean },
    private night: () => number,
  ) {
    const r = rng(o.seed);
    const el = ['#ff2e88', '#3ad7ff', '#b6ff3b', '#ffd23f', '#7a3cff', '#ff5a2a', '#ffffff'].map((c) => new THREE.Color(c));
    for (let i = 0; i < o.count; i++) {
      // most circle the Man between the burn perimeter and the city, some cross towards it
      const rad = BRC.perimeter * (0.6 + r() * 1.5);
      this.riders.push({ cx: man.x + (r() - 0.5) * 60, cz: man.z + (r() - 0.5) * 60, r: rad, a: r() * Math.PI * 2, w: ((r() < 0.5 ? -1 : 1) * (3 + r() * 3)) / rad, c: el[Math.floor(r() * el.length)], bob: r() * 10 });
    }
    this.avoid = o.avoid;
    this.manY = man.y;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(o.count * 2 * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(o.count * 2 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('aCol', this.col);
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(new Float32Array(o.count * 4).map((_, k) => (k % 2 === 0 ? (k % 4 === 0 ? 0.9 : 1.3) : 0.2)), 2));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 900 }, uNight: { value: 1 }, uDot: { value: softDotTexture() } },
      vertexShader: CITY_VERT,
      fragmentShader: CITY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.object = new THREE.Points(g, this.mat);
    this.object.frustumCulled = false;
  }

  update(_s: ShowState, dt: number): void {
    this.t += dt;
    const n = this.night();
    this.mat.uniforms.uTime.value = this.t;
    this.mat.uniforms.uScale.value = Pyro.pixelScale;
    this.mat.uniforms.uNight.value = THREE.MathUtils.smoothstep(n, 0.2, 0.7);
    this.object.visible = n > 0.2;
    if (!this.object.visible) return;
    const p = this.pos.array as Float32Array;
    const c = this.col.array as Float32Array;
    this.riders.forEach((b, i) => {
      b.a += b.w * dt;
      let x = b.cx + Math.sin(b.a) * b.r;
      let z = b.cz + Math.cos(b.a) * b.r;
      // riders steer round the crowd at the art car: they just go dark through it
      const hide = this.avoid(x, z);
      const y = this.manY + 1.0 + Math.sin(this.t * 3 + b.bob) * 0.03;
      const hx = Math.cos(b.a) * Math.sign(b.w);
      const hz = -Math.sin(b.a) * Math.sign(b.w);
      if (hide) x = z = 1e5;
      p.set([x + hx * 0.8, y + 0.1, z + hz * 0.8, x, y - 0.4, z], i * 6);
      c.set([1.4, 1.4, 1.3, b.c.r * 1.6, b.c.g * 1.6, b.c.b * 1.6], i * 6);
    });
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* poofers                                                              */
/* ------------------------------------------------------------------ */

const BALL_VERT = /* glsl */ `
  attribute float iAge;
  attribute float iSeed;
  attribute float iSize;
  attribute float iPuff;
  uniform float uTime;
  varying float vAge;
  varying float vSeed;
  varying float vH;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vP;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), u.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y), u.z);
  }
  void main() {
    // one billow of a flame column: it leaves the nozzle as a tight jet, catches, and rolls upward,
    // swelling and slowing as it burns off. The billows behind it leave a beat later, so a burst
    // reads as one tall, rolling column of fire
    float a = clamp(iAge, 0.0, 1.0);
    float grow = smoothstep(0.0, 0.5, a);
    vec3 p = position;
    float bill = noise(normal * 2.4 + vec3(0.0, -uTime * 2.2, iSeed * 9.0)) * 0.6 + noise(normal * 5.5 + vec3(iSeed * 3.0, -uTime * 3.0, 0.0)) * 0.3;
    // thin as it leaves, rounder as it rolls: a flat-ish underside and a dome on top
    float w = (0.16 + 0.9 * grow) * (0.75 + bill);
    p.xz *= w;
    p.y *= w * mix(2.3, 1.05, grow) * (p.y < 0.0 ? 0.7 : 1.0);
    p *= iSize;
    // buoyant: it shoots up out of the nozzle, then drifts up slower, leaning a little with the wind
    p.y += iSize * (0.45 + a * 3.4 - a * a * 0.8) * (1.0 + iPuff * 0.2);
    p.x += sin(iSeed * 12.0 + uTime * 0.7) * a * a * iSize * 0.5;
    vAge = iAge;
    vSeed = iSeed;
    vH = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
    vP = p;
    vec4 wp = instanceMatrix * vec4(p, 1.0);
    vec4 mv = modelViewMatrix * wp;
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const BALL_FRAG = /* glsl */ `
  uniform float uTime;
  varying float vAge;
  varying float vSeed;
  varying float vH;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vP;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; } return v; }
  void main() {
    if (vAge <= 0.0 || vAge >= 1.0) discard;
    float edge = abs(dot(vN, vView));
    float n = fbm(vec2(atan(vN.z, vN.x) * 1.4 + vSeed * 5.0, vP.y * 0.8 - uTime * 2.6));
    // pale yellow at the heart early on, orange as it rolls, a dull red rim as it burns out
    float heat = clamp(1.2 - vAge * 1.35 + (edge - 0.5) * 0.9 + (n - 0.5) * 0.7, 0.0, 1.0);
    vec3 col = mix(vec3(0.45, 0.06, 0.0), vec3(1.0, 0.34, 0.03), smoothstep(0.08, 0.45, heat));
    col = mix(col, vec3(1.0, 0.64, 0.18), smoothstep(0.5, 0.8, heat));
    col = mix(col, vec3(1.0, 0.84, 0.5), smoothstep(0.84, 1.0, heat));
    // the underside, still fed with fresh gas, burns blue for an instant
    col = mix(col, vec3(0.25, 0.4, 1.0), (1.0 - vH) * (1.0 - smoothstep(0.0, 0.16, vAge)) * 0.6);
    float a = pow(edge, 1.3) * smoothstep(0.28, 0.6, n + edge * 0.35) * (1.0 - smoothstep(0.55, 1.0, vAge)) * smoothstep(0.0, 0.04, vAge);
    // several billows overlap in a column: each one is held back so the stack stays fire-coloured
    gl_FragColor = vec4(col * a * 0.75, 1.0);
  }
`;

/** billows in one burst, how far apart they leave the nozzle (s), and how long each one burns (s) */
const PUFFS = 5;
const PUFF_GAP = 0.07;
const PUFF_LIFE = 1.15;
/** how long a burst lives, seconds: the valve's open while the billows leave, then the last one burns off */
export const POOF_LIFE = PUFF_LIFE + (PUFFS - 1) * PUFF_GAP;
/** the blue root at the nozzle shows while the valve's open */
const JET = (PUFFS - 1) * PUFF_GAP + 0.06;

/**
 * Which poofers fire now. On the drop: all of them, rippling out; at the
 * peak: half of them on beats one and three, alternating sides. With reduce
 * flashing the peak fires once a bar.
 */
export function poofPlan(s: { dropHit: boolean; peak: number; beatInBar: number; playing: boolean; reduceFlash: boolean }, beat: number, last: number, n: number): number[] {
  if (!s.playing || n === 0) return [];
  if (s.dropHit) return Array.from({ length: n }, (_, i) => i);
  if (s.peak <= 0.55) return [];
  if (s.reduceFlash ? s.beatInBar !== 0 || beat - last < 4 : s.beatInBar % 2 !== 0 || beat - last < 2) return [];
  const side = Math.floor(beat / 2) % 2;
  return Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === side);
}

/**
 * Propane poofers: nozzles that throw tall rolling columns of flame, a blue
 * root of fresh gas at the nozzle while the valve's open. Each burst lights
 * the playa round it orange for a second. One instanced mesh for every
 * billow, one for the roots.
 */
export class Fireballs implements Fixture {
  readonly object = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private roots: THREE.InstancedMesh;
  private age: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private fired: number[];
  private light: THREE.PointLight;
  private t = 0;
  private lastBeat = -1;
  private lastBeatFired = -100;
  private lastFire = -100;
  private c = new THREE.Vector3();
  private col = new THREE.Color();
  private m = new THREE.Matrix4();
  /** where each nozzle is (world), updated by its owner if it moves */
  readonly nozzles: THREE.Vector3[];

  constructor(nozzles: THREE.Vector3[], o: { size?: number; lightRange?: number } = {}) {
    this.nozzles = nozzles.map((v) => v.clone());
    const n = Math.max(1, nozzles.length);
    const size = o.size ?? 1.6;
    const geo = new THREE.IcosahedronGeometry(1, 3);
    this.age = new THREE.InstancedBufferAttribute(new Float32Array(n * PUFFS), 1);
    geo.setAttribute('iAge', this.age);
    const per = (f: (nozzle: number, k: number) => number) => new THREE.InstancedBufferAttribute(new Float32Array(n * PUFFS).map((_, i) => f(Math.floor(i / PUFFS), i % PUFFS)), 1);
    geo.setAttribute('iSeed', per((j, k) => (j * 0.37 + k * 0.23) % 1));
    // the first billow becomes the big rolling top; the ones behind it are the column
    geo.setAttribute('iSize', per((_, k) => size * (1 - k * 0.09)));
    geo.setAttribute('iPuff', per((_, k) => k / (PUFFS - 1)));
    // front faces only: with the backs added in too, a full volley stacked up to white
    this.mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: BALL_VERT, fragmentShader: BALL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, n * PUFFS);
    this.mesh.frustumCulled = false;
    // the root: a short blue cone of gas just catching, bright at the nozzle, gone a metre up
    const rootGeo = new THREE.CylinderGeometry(0.34 * size * 0.5, 0.08, 1.1 * size * 0.55, 12, 4, true).translate(0, 0.55 * size * 0.55, 0);
    const rc = new Float32Array(rootGeo.attributes.position.count * 3);
    for (let i = 0; i < rootGeo.attributes.position.count; i++) {
      const v = 1 - THREE.MathUtils.clamp(rootGeo.attributes.position.getY(i) / (1.1 * size * 0.55), 0, 1);
      rc.set([v, v, v], i * 3);
    }
    rootGeo.setAttribute('color', new THREE.BufferAttribute(rc, 3));
    this.roots = new THREE.InstancedMesh(rootGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), n);
    this.roots.frustumCulled = false;
    for (let i = 0; i < n; i++) this.roots.setColorAt(i, this.col.setRGB(0, 0, 0));
    this.fired = nozzles.map(() => -100);
    this.object.add(this.mesh, this.roots);
    this.light = new THREE.PointLight(0xff7a2a, 0, o.lightRange ?? 60, 1.3);
    this.object.add(this.light);
    this.place();
  }

  private place(): void {
    this.nozzles.forEach((p, i) => {
      this.m.makeTranslation(p.x, p.y, p.z);
      for (let k = 0; k < PUFFS; k++) this.mesh.setMatrixAt(i * PUFFS + k, this.m);
      this.roots.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.roots.instanceMatrix.needsUpdate = true;
  }

  /** fire these nozzles now (staggered by `stagger` seconds each) */
  fire(which: number[], stagger = 0): void {
    which.forEach((i, k) => {
      if (i >= 0 && i < this.fired.length && this.t - this.fired[i] > 0.4) this.fired[i] = this.t + k * stagger;
    });
    if (which.length) this.lastFire = this.t;
  }

  update(s: ShowState, dt: number): void {
    this.t += dt;
    const beat = Math.floor(s.beat);
    if (beat !== this.lastBeat || s.dropHit) {
      const plan = poofPlan(s, beat, this.lastBeatFired, this.nozzles.length);
      if (plan.length) {
        this.fire(plan, s.dropHit ? 0.06 : 0);
        this.lastBeatFired = beat;
      }
      this.lastBeat = beat;
    }
    this.place();
    const a = this.age.array as Float32Array;
    let lit = 0;
    const c = this.c.set(0, 0, 0);
    let w = 0;
    for (let i = 0; i < this.nozzles.length; i++) {
      const since = this.t - this.fired[i];
      for (let k = 0; k < PUFFS; k++) {
        const age = (since - k * PUFF_GAP) / PUFF_LIFE;
        a[i * PUFFS + k] = age > 0 && age < 1 ? age : 0;
      }
      // the gas root, flickering while the valve's open
      const on = since > 0 && since < JET ? (0.75 + 0.25 * Math.sin(this.t * 53 + i * 2.1)) * Math.min(1, since / 0.03) : 0;
      this.roots.setColorAt(i, this.col.setRGB(0.18 * on, 0.36 * on, 1.1 * on));
      const age = since / POOF_LIFE;
      if (age > 0 && age < 1) {
        const k = age < 0.15 ? age / 0.15 : Math.max(0, 1 - (age - 0.15) / 0.7);
        lit += k;
        c.addScaledVector(this.nozzles[i], k);
        w += k;
      }
    }
    this.age.needsUpdate = true;
    this.roots.instanceColor!.needsUpdate = true;
    this.mat.uniforms.uTime.value = this.t;
    if (w > 0) this.light.position.copy(c.multiplyScalar(1 / w)).add(V(0, 3, 0));
    this.light.intensity = Math.min(1.5, lit) * 110 * (0.9 + 0.1 * Math.sin(this.t * 31));
  }

  /** seconds since any nozzle last fired */
  sinceFire(): number {
    return this.t - this.lastFire;
  }
}

/* ------------------------------------------------------------------ */
/* fireworks                                                            */
/* ------------------------------------------------------------------ */

const FW_VERT = /* glsl */ `
  attribute vec4 aShell;   // launch x, y, z, launch time
  attribute vec4 aBurst;   // burst height, burst time after launch, hue, kind
  attribute vec3 aDir;     // this star's direction out of the burst
  uniform float uTime, uScale;
  varying vec3 vCol;
  varying float vA;
  vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
  void main() {
    float t = uTime - aShell.w;
    float up = aBurst.y;
    vec3 p = aShell.xyz;
    float a = 0.0;
    float size = 0.0;
    vec3 col = vec3(1.0, 0.8, 0.5);
    if (t > 0.0 && t < up) {
      // the shell climbing: one spark of the tail, the rest hidden
      float k = t / up;
      p.y += aBurst.x * (1.0 - (1.0 - k) * (1.0 - k));
      a = step(0.97, fract(aDir.x * 13.7)) * 0.9;
      size = 1.2;
    } else if (t >= up && t < up + 3.2) {
      float s = t - up;
      // the stars fly out, slow in the air, fall, and fade (a willow hangs longer)
      float drag = aBurst.w > 0.5 ? 0.9 : 1.6;
      float spread = (1.0 - exp(-drag * s)) / drag * (16.0 + 6.0 * fract(aDir.y * 7.3));
      p += vec3(0.0, aBurst.x, 0.0) + aDir * spread;
      p.y -= 2.2 * s * s * (aBurst.w > 0.5 ? 0.6 : 1.0);
      float life = aBurst.w > 0.5 ? 3.2 : 2.2;
      a = (1.0 - smoothstep(life * 0.5, life, s)) * (0.6 + 0.4 * fract(sin(s * 40.0 + aDir.z * 90.0) * 43758.5));
      size = mix(3.2, 1.4, smoothstep(0.0, 1.2, s));
      col = mix(vec3(1.0, 0.95, 0.85), hue(aBurst.z) * 1.4 + 0.15, smoothstep(0.0, 0.35, s));
      if (aBurst.w > 0.5) col = mix(col, vec3(1.0, 0.7, 0.3), smoothstep(0.6, 2.5, s));
    }
    vCol = col;
    vA = a;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = a > 0.0 ? clamp(size * uScale / max(1.0, -mv.z), 1.0, 40.0) : 0.0;
  }
`;
const FW_FRAG = /* glsl */ `
  uniform sampler2D uDot;
  varying vec3 vCol;
  varying float vA;
  void main() {
    if (vA <= 0.0) discard;
    float a = texture2D(uDot, gl_PointCoord).a;
    gl_FragColor = vec4(vCol * a * vA * 2.4, 1.0);
  }
`;

/** a fireworks show of `n` shells over `seconds`, no more than `perSecond` bursts in any second */
export function fireworkSchedule(n: number, seconds: number, perSecond: number, seed: number): number[] {
  const r = rng(seed);
  const out: number[] = [];
  const gap = 1 / perSecond;
  let t = 0;
  for (let i = 0; i < n; i++) {
    // building through the show: sparse at the start, the finale packed
    const k = i / Math.max(1, n - 1);
    t += Math.max(gap, ((seconds / n) * (1.6 - k * 1.2)) * (0.6 + r() * 0.8));
    out.push(t);
  }
  const scale = seconds / Math.max(seconds, out[out.length - 1] ?? 1);
  // squeezed into the show's length, never closer than the gap: forwards to space them, backwards to end in time
  const fitted = out.map((v) => v * scale);
  for (let i = 1; i < fitted.length; i++) fitted[i] = Math.max(fitted[i], fitted[i - 1] + gap);
  if (fitted.length) fitted[fitted.length - 1] = Math.min(fitted[fitted.length - 1], Math.max(seconds, (fitted.length - 1) * gap));
  for (let i = fitted.length - 2; i >= 0; i--) fitted[i] = Math.min(fitted[i], fitted[i + 1] - gap);
  return fitted.map((v) => Math.max(0, v));
}

/** fireworks from round the base of the Man: one Points object, the stars computed on the GPU */
export class Fireworks implements Fixture {
  readonly object: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private shell: THREE.BufferAttribute;
  private shells: number;
  private per: number;
  private t = 0;
  private center: THREE.Vector3;
  private light: THREE.PointLight;
  private bursts: { at: number; y: number }[] = [];

  constructor(center: THREE.Vector3, o: { shells?: number; stars?: number; seed?: number } = {}) {
    this.center = center.clone();
    this.shells = o.shells ?? 36;
    this.per = o.stars ?? 110;
    const n = this.shells * this.per;
    const r = rng(o.seed ?? 11);
    const shell = new Float32Array(n * 4);
    const burst = new Float32Array(n * 4);
    const dir = new Float32Array(n * 3);
    for (let s = 0; s < this.shells; s++) {
      const h = 45 + r() * 45;
      const hue = r();
      const kind = r() < 0.3 ? 1 : 0;
      for (let k = 0; k < this.per; k++) {
        const i = s * this.per + k;
        // an even sphere of stars
        const u = (k + 0.5) / this.per;
        const phi = Math.acos(1 - 2 * u);
        const th = k * 2.399963;
        dir.set([Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)], i * 3);
        burst.set([h, 1.6 + (h - 45) / 60, hue, kind], i * 4);
        shell.set([0, 0, 0, -100], i * 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.shell = new THREE.BufferAttribute(shell, 4);
    g.setAttribute('aShell', this.shell);
    g.setAttribute('aBurst', new THREE.BufferAttribute(burst, 4));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    this.mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uScale: { value: 900 }, uDot: { value: softDotTexture() } }, vertexShader: FW_VERT, fragmentShader: FW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.object = new THREE.Points(g, this.mat);
    this.object.frustumCulled = false;
    this.light = new THREE.PointLight(0xfff0e0, 0, 900, 1.2);
    this.object.add(this.light);
  }

  /** launch the show now, over `seconds`, at most `perSecond` bursts a second */
  launch(seconds: number, perSecond: number): void {
    const times = fireworkSchedule(this.shells, seconds, perSecond, 23);
    const a = this.shell.array as Float32Array;
    const r = rng(29);
    const burst = (this.object.geometry.attributes.aBurst as THREE.BufferAttribute).array as Float32Array;
    this.bursts = [];
    for (let s = 0; s < this.shells; s++) {
      const ang = r() * Math.PI * 2;
      const rad = 6 + r() * 16;
      const x = this.center.x + Math.cos(ang) * rad;
      const z = this.center.z + Math.sin(ang) * rad;
      for (let k = 0; k < this.per; k++) a.set([x, this.center.y, z, this.t + times[s]], (s * this.per + k) * 4);
      const i0 = s * this.per * 4;
      this.bursts.push({ at: this.t + times[s] + burst[i0 + 1], y: burst[i0] });
    }
    this.shell.needsUpdate = true;
  }

  update(_s: ShowState, dt: number): void {
    this.t += dt;
    this.mat.uniforms.uTime.value = this.t;
    this.mat.uniforms.uScale.value = Pyro.pixelScale;
    // each burst lights the playa for a moment
    let k = 0;
    for (const b of this.bursts) {
      const s = this.t - b.at;
      if (s >= 0 && s < 1.2) {
        k = Math.max(k, s < 0.08 ? s / 0.08 : Math.exp(-(s - 0.08) * 3));
        this.light.position.set(this.center.x, this.center.y + b.y, this.center.z);
      }
    }
    this.light.intensity = k * 8000;
  }
}

/* ------------------------------------------------------------------ */
/* the Man                                                              */
/* ------------------------------------------------------------------ */

/**
 * Where the burn is, `t` seconds in (compressed from about an hour to a
 * couple of minutes):
 *   0–6 s    the Man raises his arms
 *   5–24 s   fireworks off the base
 *   20–60 s  the fire takes the base, then climbs him
 *   70–76 s  he falls
 *   after    the fire burns down to a glow that lasts the rest of the night
 */
export function burnState(t: number): { arms: number; fireworks: boolean; base: number; body: number; fall: number; glow: number } {
  const ss = THREE.MathUtils.smoothstep;
  if (t < 0) return { arms: 0, fireworks: false, base: 0, body: 0, fall: 0, glow: 0 };
  const fall = ss(t, 70, 76);
  // down to embers over a couple of minutes after he falls
  const die = 1 - 0.65 * ss(t, 80, 160);
  return {
    arms: ss(t, 0, 6),
    fireworks: t >= 5 && t < 24,
    base: ss(t, 20, 32) * die,
    body: ss(t, 30, 48) * (1 - ss(t, 74, 90)),
    fall,
    glow: ss(t, 60, 120),
  };
}

/**
 * The Man: a timber figure on a timber pavilion, his outline in neon so he
 * can be found from anywhere on the playa (the neon goes back to 1991). The
 * arms hinge at the shoulders: down by his sides all week, raised on burn
 * night before the fireworks.
 */
export class TheMan {
  readonly object = new THREE.Group();
  readonly figure = new THREE.Group();
  readonly base = new THREE.Group();
  private arms: THREE.Group[] = [];
  readonly neon: THREE.MeshBasicMaterial;
  readonly height: number;
  readonly baseHeight: number;
  readonly baseWidth: number;
  /** points on him the fire climbs, local */
  readonly firePoints: THREE.Vector3[] = [];

  constructor(pos: THREE.Vector3, o: { man?: number; base?: number; baseWidth?: number } = {}) {
    const H = (this.height = o.man ?? 13.7);
    const BH = (this.baseHeight = o.base ?? 9);
    const BW = (this.baseWidth = o.baseWidth ?? 26);
    this.object.position.copy(pos);
    const wood = new THREE.MeshStandardMaterial({ color: 0xb08a5c, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 0.9 });
    this.neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.6, 2.2), toneMapped: false });
    // the pavilion: an octagon of timber walls with doorways, a ramp up, a deck on top
    const bg: THREE.BufferGeometry[] = [];
    const sides = 8;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const a2 = ((i + 1) / sides) * Math.PI * 2;
      const r = BW / 2;
      const p1 = V(Math.cos(a) * r, 0, Math.sin(a) * r);
      const p2 = V(Math.cos(a2) * r, 0, Math.sin(a2) * r);
      const mid = p1.clone().add(p2).multiplyScalar(0.5);
      const len = p1.distanceTo(p2);
      const yaw = -Math.atan2(p2.z - p1.z, p2.x - p1.x);
      // a wall of vertical slats with an arched doorway every other side
      const door = i % 2 === 0;
      for (let k = 0; k < 12; k++) {
        const t = (k + 0.5) / 12 - 0.5;
        if (door && Math.abs(t) < 0.2) {
          bg.push(new THREE.BoxGeometry(0.25, BH * 0.35, 0.3).translate(t * len, BH * 0.82, 0).rotateY(yaw).translate(mid.x, 0, mid.z));
          continue;
        }
        bg.push(new THREE.BoxGeometry(0.25, BH, 0.3).translate(t * len, BH / 2, 0).rotateY(yaw).translate(mid.x, 0, mid.z));
      }
      bg.push(new THREE.BoxGeometry(len, 0.5, 0.5).translate(0, BH, 0).rotateY(yaw).translate(mid.x, 0, mid.z));
      bg.push(new THREE.BoxGeometry(len, 0.4, 0.4).translate(0, BH * 0.62, 0).rotateY(yaw).translate(mid.x, 0, mid.z));
    }
    // the deck, and timber posts inside holding it
    bg.push(new THREE.CylinderGeometry(BW / 2 + 0.6, BW / 2 + 0.6, 0.5, sides).translate(0, BH + 0.25, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      bg.push(new THREE.BoxGeometry(0.6, BH, 0.6).translate(Math.cos(a) * BW * 0.22, BH / 2, Math.sin(a) * BW * 0.22));
    }
    // a plinth under his feet
    bg.push(new THREE.BoxGeometry(H * 0.45, 1.2, H * 0.22).translate(0, BH + 1.1, 0));
    const baseMesh = new THREE.Mesh(mergeGeometries(bg.map((g) => g.toNonIndexed()))!, wood);
    this.base.add(baseMesh);
    // warm light spilling out of the doorways
    const spill = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.5, 0.22), toneMapped: false });
    const doors: THREE.BufferGeometry[] = [];
    for (let i = 0; i < sides; i += 2) {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      const r = BW / 2 * Math.cos(Math.PI / sides) - 0.2;
      doors.push(new THREE.PlaneGeometry(BW * 0.16, BH * 0.62).rotateY(-a + Math.PI / 2).translate(Math.cos(a) * r, BH * 0.31, Math.sin(a) * r));
    }
    this.base.add(new THREE.Mesh(mergeGeometries(doors)!, spill));
    this.object.add(this.base);

    // the figure: lattice legs, a tapering torso, the head; timber members, neon along the outline
    const fy = BH + 1.7;
    this.figure.position.y = fy;
    const fig: THREE.BufferGeometry[] = [];
    const neon: THREE.BufferGeometry[] = [];
    const beam = (a: THREE.Vector3, b: THREE.Vector3, t: number, out = fig) => {
      const len = a.distanceTo(b);
      const g = new THREE.BoxGeometry(t, len, t);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
      const m = a.clone().add(b).multiplyScalar(0.5);
      out.push(g.translate(m.x, m.y, m.z));
    };
    const tube = (pts: THREE.Vector3[], out = neon) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = a.distanceTo(b);
        const g = new THREE.CylinderGeometry(0.07, 0.07, len, 5);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
        const m = a.clone().add(b).multiplyScalar(0.5);
        out.push(g.translate(m.x, m.y, m.z));
      }
    };
    const legH = H * 0.44;
    const hip = H * 0.44;
    const sh = H * 0.78;
    const legW = H * 0.11;
    for (const s of [-1, 1]) {
      // each leg a tapering box lattice, feet apart
      const foot = s * H * 0.13;
      const top = s * H * 0.06;
      for (const dz of [-0.35, 0.35])
        for (const dx of [-legW / 2, legW / 2]) beam(V(foot + dx * 1.2, 0, dz * 1.3), V(top + dx, legH, dz), 0.3);
      for (let k = 1; k < 5; k++) {
        const y = (k / 5) * legH;
        const x = foot + (top - foot) * (y / legH);
        beam(V(x - legW / 2, y, 0.4), V(x + legW / 2, y, 0.4), 0.18);
        beam(V(x - legW / 2, y, -0.4), V(x + legW / 2, y, -0.4), 0.18);
        beam(V(x - legW / 2, y - legH / 5, 0.42), V(x + legW / 2, y, 0.42), 0.12);
      }
      tube([V(foot - s * legW * 0.6, 0, 0.5), V(top - s * legW * 0.5, legH, 0.5)]);
      tube([V(foot + s * legW * 0.6, 0, 0.5), V(top + s * legW * 0.4, legH, 0.5)]);
      this.firePoints.push(V(foot, legH * 0.3, 0), V(top, legH * 0.85, 0));
    }
    // the torso: hips to shoulders, wider at the top
    const tw0 = H * 0.2;
    const tw1 = H * 0.3;
    for (const dz of [-0.45, 0.45]) {
      beam(V(-tw0 / 2, hip, dz), V(-tw1 / 2, sh, dz), 0.32);
      beam(V(tw0 / 2, hip, dz), V(tw1 / 2, sh, dz), 0.32);
      for (let k = 0; k <= 5; k++) {
        const y = hip + (k / 5) * (sh - hip);
        const w = tw0 + (tw1 - tw0) * (k / 5);
        beam(V(-w / 2, y, dz), V(w / 2, y, dz), 0.2);
        if (k < 5) beam(V(-w / 2, y, dz), V((tw0 + (tw1 - tw0) * ((k + 1) / 5)) / 2, hip + ((k + 1) / 5) * (sh - hip), dz), 0.12);
      }
    }
    tube([V(-tw0 / 2, hip, 0.55), V(-tw1 / 2, sh, 0.55), V(tw1 / 2, sh, 0.55), V(tw0 / 2, hip, 0.55), V(-tw0 / 2, hip, 0.55)]);
    this.firePoints.push(V(0, hip + 1, 0), V(0, sh - 1, 0));
    // the neck and head: a tall, faceted head on a short neck
    beam(V(0, sh, 0), V(0, sh + H * 0.05, 0), 0.5);
    const hb = sh + H * 0.05;
    const hh = H * 0.17;
    const hw = H * 0.085;
    const head = [V(0, hb, 0), V(-hw, hb + hh * 0.3, 0), V(-hw * 0.8, hb + hh * 0.8, 0), V(0, hb + hh, 0), V(hw * 0.8, hb + hh * 0.8, 0), V(hw, hb + hh * 0.3, 0), V(0, hb, 0)];
    for (const dz of [-0.4, 0.4]) for (let i = 0; i < head.length - 1; i++) beam(head[i].clone().setZ(dz), head[i + 1].clone().setZ(dz), 0.22);
    for (let i = 1; i < head.length - 1; i++) beam(head[i].clone().setZ(-0.4), head[i].clone().setZ(0.4), 0.16);
    tube(head.map((p) => p.clone().setZ(0.5)));
    this.firePoints.push(V(0, hb + hh * 0.5, 0));
    this.figure.add(new THREE.Mesh(mergeGeometries(fig.map((g) => g.toNonIndexed()))!, dark));
    this.figure.add(new THREE.Mesh(mergeGeometries(neon.map((g) => g.toNonIndexed()))!, this.neon));
    // the arms: hinged at each shoulder, hanging by his sides
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * tw1 / 2, sh - 0.2, 0);
      const ag: THREE.BufferGeometry[] = [];
      const an: THREE.BufferGeometry[] = [];
      const len = H * 0.38;
      for (const dz of [-0.3, 0.3]) {
        beam(V(0, 0, dz), V(s * 0.6, -len, dz), 0.26, ag);
        beam(V(s * 0.7, 0, dz), V(s * 1.0, -len, dz), 0.2, ag);
      }
      for (let k = 1; k < 6; k++) beam(V(s * 0.1 * (k / 6) * 6, -len * (k / 6), 0.32), V(s * (0.7 + 0.3 * (k / 6)), -len * (k / 6), 0.32), 0.12, ag);
      tube([V(0, 0, 0.42), V(s * 0.6, -len, 0.42)], an);
      tube([V(s * 0.7, 0, 0.42), V(s * 1.0, -len, 0.42)], an);
      arm.add(new THREE.Mesh(mergeGeometries(ag.map((g) => g.toNonIndexed()))!, dark));
      arm.add(new THREE.Mesh(mergeGeometries(an.map((g) => g.toNonIndexed()))!, this.neon));
      this.arms.push(arm);
      this.figure.add(arm);
    }
    this.object.add(this.figure);
  }

  /** arms down (0) to raised up and out (1) */
  setArms(k: number): void {
    this.arms.forEach((a, i) => (a.rotation.z = (i === 0 ? -1 : 1) * k * 2.3));
  }

  /** he falls: tips over backwards and drops into the base */
  setFall(k: number): void {
    const e = k * k;
    this.figure.rotation.x = e * 1.45;
    this.figure.position.y = this.baseHeight + 1.7 - e * this.baseHeight * 0.7;
    this.base.scale.y = 1 - 0.55 * Math.max(0, (k - 0.5) * 2);
  }

  /** the neon: on all week, gone once the fire's in him */
  setNeon(on: number, kick = 0): void {
    this.neon.color.setRGB(0.25, 1.6, 2.2).multiplyScalar(on * (0.85 + kick * 0.15));
    this.neon.visible = on > 0.01;
  }
}

/** the burn's fire: big turbulent columns round the base and up the figure, and the smoke above */
export class BurnFire implements Fixture {
  readonly object = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private fire: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private light: THREE.PointLight;
  private smoke: THREE.Sprite[] = [];
  private embers: THREE.Points;
  private emberMat: THREE.ShaderMaterial;
  private t = 0;
  /** each column: base (0) or body (1) */
  private groups: number[] = [];
  base = 0;
  body = 0;
  glow = 0;

  constructor(private man: TheMan) {
    const spots: { p: THREE.Vector3; h: number; r: number; g: number }[] = [];
    const BW = man.baseWidth;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      spots.push({ p: V(Math.cos(a) * BW * 0.32, 0, Math.sin(a) * BW * 0.32), h: 22, r: 4.2, g: 0 });
    }
    spots.push({ p: V(0, 0, 0), h: 32, r: 6, g: 0 });
    for (const fp of man.firePoints) spots.push({ p: fp.clone().add(V(0, man.baseHeight + 1.7, 0)), h: 9, r: 1.8, g: 1 });
    const geo = new THREE.CylinderGeometry(1, 0.35, 1, 18, 14, true).translate(0, 0.5, 0);
    this.fire = new THREE.InstancedBufferAttribute(new Float32Array(spots.length), 1);
    geo.setAttribute('iFire', this.fire);
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(new Float32Array(spots.map((_, i) => (i * 0.618) % 1)), 1));
    this.mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uHeight: { value: 1 } }, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m.compose(s.p.clone().add(man.object.position), new THREE.Quaternion(), V(s.r, s.h, s.r));
      this.mesh.setMatrixAt(i, m);
      this.groups.push(s.g);
    });
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
    // the fire lights the whole playa out to the perimeter
    this.light = new THREE.PointLight(0xff7a2a, 0, 1200, 1.1);
    this.light.position.copy(man.object.position).add(V(0, 14, 0));
    this.object.add(this.light);
    // smoke: dark, lit orange from below, rolling up
    const smokeMat = new THREE.SpriteMaterial({ map: smokeTexture(), color: 0x3a2a22, transparent: true, depthWrite: false, opacity: 0 });
    for (let i = 0; i < 7; i++) {
      const sp = new THREE.Sprite(smokeMat.clone());
      this.smoke.push(sp);
      this.object.add(sp);
    }
    // embers lifting off it
    const n = 700;
    const seeds = new Float32Array(n * 3);
    const r = rng(5);
    for (let i = 0; i < n; i++) seeds.set([r(), r(), r()], i * 3);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    eg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.emberMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 900 }, uOn: { value: 0 }, uC: { value: man.object.position.clone() } },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        uniform float uTime, uScale, uOn;
        uniform vec3 uC;
        varying float vA;
        void main() {
          float life = 4.0 + aSeed.x * 5.0;
          float t = mod(uTime + aSeed.y * life, life);
          float ang = aSeed.z * 6.2832 + t * 0.4;
          vec3 p = uC + vec3(cos(ang) * (4.0 + aSeed.x * 10.0 + t * 1.5), 6.0 + t * (7.0 + aSeed.y * 6.0), sin(ang) * (4.0 + aSeed.x * 10.0 + t * 1.5));
          vA = uOn * (1.0 - t / life) * (0.5 + 0.5 * sin(uTime * 9.0 + aSeed.z * 50.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = vA > 0.01 ? clamp(0.35 * uScale / max(1.0, -mv.z), 1.0, 6.0) : 0.0;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(c)) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * a * 3.0, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.embers = new THREE.Points(eg, this.emberMat);
    this.embers.frustumCulled = false;
    this.object.add(this.embers);
  }

  update(_s: ShowState, dt: number): void {
    this.t += dt;
    const t = this.t;
    const a = this.fire.array as Float32Array;
    let lit = 0;
    for (let i = 0; i < a.length; i++) {
      // each column catches at its own moment as the level rises past it, and breathes
      const lvl = this.groups[i] ? this.body : Math.max(this.base, this.glow * 0.35);
      const th = ((i * 0.37) % 1) * 0.5;
      a[i] = THREE.MathUtils.clamp((lvl - th) / (1 - th), 0, 1) * (0.85 + 0.15 * Math.sin(t * 2.3 + i));
      lit += a[i];
    }
    this.fire.needsUpdate = true;
    this.mat.uniforms.uTime.value = t;
    const level = Math.min(1, lit / 8);
    // a smooth flicker, never a flash
    this.light.intensity = level * 6000 * (0.88 + 0.07 * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 13.1));
    this.light.visible = level > 0.002;
    const c = this.man.object.position;
    this.smoke.forEach((sp, i) => {
      const life = 14;
      const k = ((t / life + i / this.smoke.length) % 1);
      sp.position.set(c.x + Math.sin(i * 2.1 + t * 0.05) * (4 + k * 18), c.y + 20 + k * 70, c.z + Math.cos(i * 1.7) * (3 + k * 10));
      sp.scale.setScalar(18 + k * 60);
      const m = sp.material as THREE.SpriteMaterial;
      m.opacity = level * 0.5 * Math.sin(k * Math.PI);
      m.color.setRGB(0.25 + level * 0.35 * (1 - k), 0.17 + level * 0.12 * (1 - k), 0.14);
    });
    this.emberMat.uniforms.uTime.value = t;
    this.emberMat.uniforms.uOn.value = level;
    this.emberMat.uniforms.uScale.value = Pyro.pixelScale;
  }
}

/* ------------------------------------------------------------------ */
/* the Temple, Center Camp, the lanterns                                */
/* ------------------------------------------------------------------ */

/** the Temple out at 12:00: a tiered timber sanctuary with a spire, lit warm from inside */
export function temple(d: Dresser, pos: THREE.Vector3, size = 1): void {
  const s = size;
  const glow = d.glow('#ffcf8a', 'breathe', 1.8);
  // a square courtyard of timber screens, open at the four gates
  for (let k = 0; k < 4; k++) {
    const yaw = (k / 4) * Math.PI * 2;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (const off of [-14, 14]) d.box('wood', 16 * s, 4 * s, 0.4, pos.x + (sn * 30 + c * off) * s, pos.y + 2 * s, pos.z + (c * 30 - sn * off) * s, yaw);
  }
  // three stacked tiers, each smaller, flared eaves, the spire
  let y = pos.y;
  for (let t = 0; t < 3; t++) {
    const w = (18 - t * 5) * s;
    const h = (7 - t * 1.2) * s;
    d.box('wood', w, h, w, pos.x, y + h / 2, pos.z, Math.PI / 4);
    d.put(glow, new THREE.BoxGeometry(w * 0.72, h * 0.6, w * 1.01).rotateY(Math.PI / 4).translate(pos.x, y + h * 0.5, pos.z));
    d.put('darkWood', new THREE.ConeGeometry(w * 0.85, h * 0.4, 4).rotateY(Math.PI / 4).translate(pos.x, y + h + h * 0.2, pos.z));
    y += h + h * 0.3;
  }
  d.put('darkWood', new THREE.ConeGeometry(2.2 * s, 14 * s, 4).rotateY(Math.PI / 4).translate(pos.x, y + 7 * s, pos.z));
}

/** Center Camp: the big round shade at 6:00, a mast through the middle, lights strung out to its rim */
export function centerCamp(d: Dresser, pos: THREE.Vector3): void {
  const R = 32;
  const lamps = d.glow('#ffd9a0', 'steady', 1.6);
  d.put('canvas', new THREE.ConeGeometry(R, 9, 32, 1, true).translate(pos.x, pos.y + 13, pos.z));
  d.rod('steel', pos, pos.clone().setY(pos.y + 24), 0.5, 8);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rim = V(pos.x + Math.cos(a) * R, pos.y, pos.z + Math.sin(a) * R);
    d.rod('steel', rim, rim.clone().setY(pos.y + 8.5), 0.18, 5);
    d.put(lamps, new THREE.SphereGeometry(0.45, 6, 4).translate(rim.x, pos.y + 8, rim.z));
  }
  for (let i = 0; i < 40; i++) d.put(lamps, new THREE.SphereGeometry(0.4, 6, 4).translate(pos.x + (d.r() - 0.5) * R * 1.4, pos.y + 2 + d.r() * 4, pos.z + (d.r() - 0.5) * R * 1.4));
}

/** lantern spires down a promenade from `a` to `b`, one every 150 ft */
export function lanternSpires(d: Dresser, a: THREE.Vector3, b: THREE.Vector3, skip: (p: THREE.Vector3) => boolean = () => false): number {
  const lamp = d.glow('#ffc070', 'breathe', 2.4);
  const len = a.distanceTo(b);
  const dir = b.clone().sub(a).normalize();
  let n = 0;
  for (let s = BRC.lanterns; s < len; s += BRC.lanterns) {
    const p = a.clone().addScaledVector(dir, s);
    if (skip(p)) continue;
    d.rod('wood', p, p.clone().setY(p.y + 4.2), 0.08, 5);
    d.box('wood', 0.9, 0.08, 0.08, p.x, p.y + 4.0, p.z);
    d.put(lamp, new THREE.CylinderGeometry(0.16, 0.16, 0.36, 8).translate(p.x + 0.38, p.y + 3.7, p.z));
    d.put(lamp, new THREE.CylinderGeometry(0.16, 0.16, 0.36, 8).translate(p.x - 0.38, p.y + 3.7, p.z));
    n++;
  }
  return n;
}
