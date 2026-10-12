/*
 * Open-air pieces for the venues outside (Section 5.2): the time of day as
 * the set goes on (golden hour → night on the Rooftop, sunset over the sea
 * at the Beach Club, the sunrise on the closing set) as keys the sky is
 * worked out from (sky.ts), a city skyline whose windows can switch on
 * block by block, palm trees and the sun loungers. The water is water.ts.
 *
 * TODO: procedural stand-ins for Blender sets (Section 14).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, rng, windowsTexture } from './tex';

/* ------------------------------------------------------------------ */
/* time of day                                                          */
/* ------------------------------------------------------------------ */

/** one moment of the day, as hex colours and numbers */
export interface SkyKey {
  /** where in the set (0..1) */
  k: number;
  zenith: string;
  horizon: string;
  /** below the horizon (sea or land far off) */
  ground: string;
  /** the sun's height in degrees (negative: below the horizon) */
  sun: number;
  sunColor: string;
  /** direct sunlight intensity */
  light: number;
  /** sky and ground fill (the hemisphere light) */
  ambSky: string;
  ambGround: string;
  amb: number;
  /** 0..1 stars out */
  stars: number;
  /** how much the city / site lights are on, 0..1 */
  night: number;
}

export interface SkyLook {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sun: number;
  sunColor: THREE.Color;
  light: number;
  ambSky: THREE.Color;
  ambGround: THREE.Color;
  amb: number;
  stars: number;
  night: number;
}

export function newLook(): SkyLook {
  return { zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sun: 0, sunColor: new THREE.Color(), light: 0, ambSky: new THREE.Color(), ambGround: new THREE.Color(), amb: 0, stars: 0, night: 0 };
}

const ca = new THREE.Color();
const cb = new THREE.Color();

/** the sky at `k`, between the keys either side (smoothly) */
export function sampleSky(keys: SkyKey[], k: number, out: SkyLook = newLook()): SkyLook {
  const x = Math.max(0, Math.min(1, k));
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].k < x) i++;
  const a = keys[i];
  const b = keys[Math.min(keys.length - 1, i + 1)];
  const span = b.k - a.k;
  const t0 = span > 0 ? Math.max(0, Math.min(1, (x - a.k) / span)) : 0;
  const t = t0 * t0 * (3 - 2 * t0);
  const col = (o: THREE.Color, p: string, q: string) => o.copy(ca.set(p)).lerp(cb.set(q), t);
  const num = (p: number, q: number) => p + (q - p) * t;
  col(out.zenith, a.zenith, b.zenith);
  col(out.horizon, a.horizon, b.horizon);
  col(out.ground, a.ground, b.ground);
  col(out.sunColor, a.sunColor, b.sunColor);
  col(out.ambSky, a.ambSky, b.ambSky);
  col(out.ambGround, a.ambGround, b.ambGround);
  out.sun = num(a.sun, b.sun);
  out.light = num(a.light, b.light);
  out.amb = num(a.amb, b.amb);
  out.stars = num(a.stars, b.stars);
  out.night = num(a.night, b.night);
  return out;
}

/** a direction for the sun: `elev` degrees up, at bearing `yaw` (0 = straight down +Z behind the booth) */
export function sunDirection(elev: number, yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(elev);
  return out.set(Math.sin(yaw) * Math.cos(e), Math.sin(e), Math.cos(yaw) * Math.cos(e)).normalize();
}

/* ------------------------------------------------------------------ */
/* a city skyline                                                       */
/* ------------------------------------------------------------------ */

export interface SkylineBlock {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  /** its angle round the skyline (radians), for sweeps */
  angle: number;
}

/**
 * A ring of buildings round `center`, between `inner` and `outer` metres,
 * across the arc `from`..`to` (radians, 0 = +Z, going towards +X). Split into
 * `blocks` sectors, each its own material, so their windows can come on one
 * block at a time. Window light is emissive, set per block (0..1).
 */
export function skyline(o: { seed: number; inner: number; outer: number; from: number; to: number; blocks: number; minH: number; maxH: number; y?: number; lit?: string; body?: string; center?: THREE.Vector3; density?: number }): { group: THREE.Group; blocks: SkylineBlock[]; beacons: THREE.Vector3[] } {
  const r = rng(o.seed);
  const group = new THREE.Group();
  const blocks: SkylineBlock[] = [];
  const beacons: THREE.Vector3[] = [];
  const c = o.center ?? new THREE.Vector3();
  const y0 = o.y ?? 0;
  const win = windowsTexture(`skyline:${o.seed}`, o.lit ?? '#ffd9a0', o.density ?? 0.6);
  // what's on the roofs: setbacks, plant rooms, water towers, masts (one dark mesh for the lot)
  const roofs: THREE.BufferGeometry[] = [];
  const roof = (g: THREE.BufferGeometry, yaw: number, x: number, y: number, z: number) => roofs.push(g.rotateY(yaw).translate(x, y, z).toNonIndexed());
  for (let b = 0; b < o.blocks; b++) {
    const a0 = o.from + ((o.to - o.from) * b) / o.blocks;
    const a1 = o.from + ((o.to - o.from) * (b + 1)) / o.blocks;
    const geos: THREE.BufferGeometry[] = [];
    const span = Math.abs(a1 - a0);
    // rows of buildings, nearer ones lower
    for (let row = 0; row < 3; row++) {
      const rad = o.inner + ((o.outer - o.inner) * (row + r() * 0.5)) / 3;
      let a = Math.min(a0, a1);
      while (a < Math.max(a0, a1)) {
        const w = 10 + r() * 22;
        const d = 10 + r() * 18;
        const tall = r() < 0.12;
        const h = (o.minH + (o.maxH - o.minH) * Math.pow(r(), 1.6)) * (tall ? 1.7 : 1) * (0.7 + row * 0.25);
        const g = new THREE.BoxGeometry(w, h, d);
        // windows: one texture tile per ~4 × 12 m
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) {
          const face = Math.floor(i / 4);
          const fw = face < 2 ? d : w;
          uv.setXY(i, uv.getX(i) * (fw / 16), uv.getY(i) * (h / 36));
        }
        const x = c.x + Math.sin(a) * rad;
        const z = c.z + Math.cos(a) * rad;
        const yaw = a + (r() - 0.5) * 0.3;
        g.rotateY(yaw);
        g.translate(x, y0 + h / 2, z);
        geos.push(g.toNonIndexed());
        const top = y0 + h;
        // a setback, a plant room, a water tower on legs; a mast on the tall ones
        let crown = top;
        if (r() < 0.4) {
          const sh = h * (0.08 + r() * 0.1);
          roof(new THREE.BoxGeometry(w * (0.5 + r() * 0.2), sh, d * (0.5 + r() * 0.2)).translate(0, sh / 2, 0), yaw, x, top, z);
          crown = top + sh;
        }
        if (r() < 0.45) roof(new THREE.BoxGeometry(w * 0.25, 2.6, d * 0.3).translate(w * (r() - 0.5) * 0.4, 1.3, d * (r() - 0.5) * 0.4), yaw, x, crown, z);
        if (r() < 0.3) {
          const tr = 1.4 + r();
          const tx = w * (r() - 0.5) * 0.5;
          const tz = d * (r() - 0.5) * 0.5;
          roof(new THREE.CylinderGeometry(tr, tr, 3.2, 10).translate(tx, 4.6, tz), yaw, x, crown, z);
          roof(new THREE.ConeGeometry(tr * 1.05, 1.0, 10).translate(tx, 6.7, tz), yaw, x, crown, z);
          for (let k = 0; k < 4; k++) {
            const la = (k / 4) * Math.PI * 2 + 0.78;
            roof(new THREE.CylinderGeometry(0.12, 0.12, 3, 4).translate(tx + Math.cos(la) * tr * 0.7, 1.5, tz + Math.sin(la) * tr * 0.7), yaw, x, crown, z);
          }
        }
        if (tall) {
          const mh = 8 + r() * 12;
          roof(new THREE.CylinderGeometry(0.25, 0.5, mh, 6).translate(0, mh / 2, 0), yaw, x, crown, z);
          beacons.push(new THREE.Vector3(x, crown + mh + 0.6, z));
        }
        a += (w * 1.15) / rad + r() * 0.01;
        if (span <= 0) break;
      }
    }
    if (!geos.length) continue;
    const mat = new THREE.MeshStandardMaterial({ color: o.body ?? '#2b303a', roughness: 0.85, metalness: 0.1, emissive: new THREE.Color(1, 1, 1), emissiveMap: win, emissiveIntensity: 0.2 });
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
    group.add(mesh);
    blocks.push({ mesh, mat, angle: (a0 + a1) / 2 });
  }
  if (roofs.length) group.add(new THREE.Mesh(mergeGeometries(roofs)!, new THREE.MeshStandardMaterial({ color: new THREE.Color(o.body ?? '#2b303a').multiplyScalar(0.7), roughness: 0.9, metalness: 0.2 })));
  return { group, blocks, beacons };
}

/** red aircraft lights on the tall towers: one Points object, slow blink */
export function beaconLights(points: THREE.Vector3[]): { object: THREE.Points; update(t: number, night: number): void } {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.PointsMaterial({ color: new THREE.Color(3, 0.15, 0.1), size: 4, sizeAttenuation: true, transparent: true, depthWrite: false, toneMapped: false, fog: false });
  const object = new THREE.Points(geo, mat);
  return {
    object,
    update(t, night) {
      // once a second, half on (well under the flash limit)
      mat.opacity = night * (Math.sin(t * Math.PI) > 0 ? 1 : 0.15);
    },
  };
}

/* ------------------------------------------------------------------ */
/* palms, loungers                                                      */
/* ------------------------------------------------------------------ */

function frondTexture(): THREE.CanvasTexture {
  // drawn at twice the old size (the fronds' edges were visibly pixelated up close)
  return canvasTexture('palm-frond', 256, 1024, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.scale(2, 2);
    const w = W / 2;
    const h = H / 2;
    // the midrib, and leaflets angled out along it
    g.strokeStyle = '#3d5a22';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(w / 2, h);
    g.lineTo(w / 2, 0);
    g.stroke();
    for (let y = h - 20; y > 6; y -= 9) {
      const len = (w / 2 - 4) * Math.sin((Math.PI * (h - y)) / h) * 0.95 + 6;
      for (const s of [-1, 1]) {
        g.strokeStyle = `hsl(${88 + Math.sin(y) * 8}, 45%, ${24 + ((y * 7) % 10)}%)`;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(w / 2, y);
        g.quadraticCurveTo(w / 2 + s * len * 0.6, y - 10, w / 2 + s * len, y - 26);
        g.stroke();
      }
    }
  });
}

/** a palm: a leaning, tapering trunk and a crown of drooping fronds */
export function palmTree(seed: number, height = 7): { group: THREE.Group; trunk: THREE.MeshStandardMaterial; crownTop: THREE.Vector3 } {
  const r = rng(seed);
  const group = new THREE.Group();
  const lean = new THREE.Vector3((r() - 0.5) * 0.6, 1, (r() - 0.5) * 0.6).normalize();
  const bend = (r() - 0.5) * 0.25;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector3(lean.x * height * t + bend * height * t * t, height * t, lean.z * height * t));
  }
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = a.distanceTo(b);
    const r0 = 0.22 - i * 0.012;
    const seg = new THREE.CylinderGeometry(r0 - 0.012, r0, len * 1.02, 10, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
    seg.applyQuaternion(q);
    seg.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    geos.push(seg.toNonIndexed());
  }
  const trunk = new THREE.MeshStandardMaterial({
    color: 0x6e5a44,
    roughness: 0.95,
    emissive: new THREE.Color(0, 0, 0),
    map: canvasTexture('palm-bark', 64, 256, (g, w, h) => {
      g.fillStyle = '#7a6650';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 10) {
        g.fillStyle = 'rgba(40,28,18,0.55)';
        g.fillRect(0, y, w, 3);
      }
    }),
  });
  const tm = new THREE.Mesh(mergeGeometries(geos)!, trunk);
  group.add(tm);
  // the crown
  const top = pts[pts.length - 1];
  // alpha to coverage: the frond's cut-out edges are antialiased by the multisampling instead of stair-stepping
  const leaf = new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.8, color: 0xc8d8a8 });
  const fronds: THREE.BufferGeometry[] = [];
  const n = 9 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const L = 2.6 + r() * 1.2;
    const g = new THREE.PlaneGeometry(0.9, L, 1, 8);
    // droop: bend the leaf down along its length
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + L / 2;
      const t = y / L;
      p.setXYZ(k, p.getX(k) * (1 - t * 0.4), y * Math.cos(t * 1.2), -y * Math.sin(t * 1.2) * 0.9 - t * t * 0.6);
    }
    g.rotateX(-Math.PI / 2 + 0.5 + r() * 0.3);
    g.rotateY((i / n) * Math.PI * 2 + r() * 0.3);
    g.translate(top.x, top.y, top.z);
    fronds.push(g);
  }
  group.add(new THREE.Mesh(mergeGeometries(fronds)!, leaf));
  return { group, trunk, crownTop: top.clone() };
}

/** a white sun lounger, about 2 m long, back raised */
export function lounger(): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 });
  const pad = new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 1.35), pad);
  base.position.set(0, 0.36, -0.2);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.7), pad);
  back.position.set(0, 0.55, 0.72);
  back.rotation.x = -0.6;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.22, 1.9), white);
  frame.position.set(0, 0.2, 0.05);
  g.add(frame, base, back);
  return g;
}
