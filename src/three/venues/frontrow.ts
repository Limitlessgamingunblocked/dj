/*
 * The front row: the couple of dozen dancers nearest the booth, the people
 * the close cameras (the booth, over the DJ's shoulder, the crowd shots) look
 * straight at. They are the same people the crowd places, dressed and posed
 * by the same shader (crowd.ts), just built from a much more detailed model
 * and drawn by one instanced mesh of their own in place of their low-detail
 * selves, so they dance in step with everyone else.
 *
 *   – the head: a face with real features (eyes in sockets that blink, brows,
 *     a nose, lips that open to shout and sing along, cheekbones, a chin,
 *     ears), hair with volume (clumped, curls, buns, long hair that waves)
 *   – hands: a palm, four fingers and a thumb
 *   – layers by the venue's look: open jackets, hoodies with the hood down,
 *     short-sleeved shirts, gilets, fur coats (the playa), leather and
 *     harnesses (Berghain), swimwear (the beach), crossbody bags, bucket hats,
 *     sunglasses, goggles, bandanas, fur collars
 *   – props: glowsticks that glow, hand fans, phones with the camera app lit
 *     up, as well as the crowd's drinks and towel
 *   – the show on them: the rig's colours on their faces, a phone's glow when
 *     they film, sweat that builds into a sheen and beads over a long peak
 *
 * The model keeps the crowd's skeleton (the same joints and bones), so the
 * crowd's pose code moves it unchanged. About 5,000 triangles a person.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FOREARM, growHead, headGeometry, NECK, PELVIS, PERSON_BONES as B, PERSON_MATS as M, part, shapeHead, SHIN, smooth, THIGH, TORSO, turned, UPPER_ARM } from './crowd';

/** the venue's look: what the front row wears */
export type CrowdLook = 'club' | 'dark' | 'beach' | 'festival' | 'playa';
export const LOOK_CODE: Record<CrowdLook, number> = { club: 0, dark: 1, beach: 2, festival: 3, playa: 4 };

/* the front row's own materials, after the crowd's */
export const FRONT_MATS = { eye: 18, brow: 19, shell: 20, shellLo: 21, hood: 22, strap: 23, glasses: 24, hat: 25, glow: 26, fan: 27, curls: 28, bun: 29, collar: 30, goggles: 31, harness: 32 };
const F = FRONT_MATS;

/* where the head sits (as in the crowd model) */
const HEAD_Y = 1.6;
const HEAD_Z = 0.004;

const gauss = (dx: number, dy: number, rx: number, ry: number) => Math.exp(-(dx * dx) / (rx * rx) - (dy * dy) / (ry * ry));

/** the face's relief, in the head's own space (y = 0 at the head's middle, the eyes just above) */
function sculpt(v: THREE.Vector3): void {
  if (v.z <= 0) return;
  const x = v.x;
  const y = v.y;
  const ax = Math.abs(x);
  // fades out round the sides of the face
  const f = smooth(0.02, 0.07, v.z);
  let dz = 0;
  // soft eye sockets under a gentle brow (deep sockets read as hollow and haunted)
  dz -= 0.0045 * gauss(ax - 0.033, y - 0.003, 0.019, 0.014);
  dz += 0.0022 * gauss(ax - 0.034, y - 0.027, 0.022, 0.007);
  // a small, rounded button nose: a low bridge rising to a soft tip, the nostrils either side
  const t = THREE.MathUtils.clamp((0.018 - y) / 0.04, 0, 1);
  const under = smooth(-0.022, -0.032, y);
  const prof = y > 0.018 ? 0.002 * smooth(0.04, 0.018, y) : (0.003 + 0.0105 * t * t) * (1 - under);
  const w = 0.008 + 0.007 * t;
  dz += prof * Math.exp(-(x * x) / (w * w));
  dz += 0.0035 * gauss(ax - 0.011, y + 0.025, 0.0075, 0.0065);
  // full, round cheeks, soft lips, a small rounded chin
  dz += 0.0065 * gauss(ax - 0.047, y + 0.018, 0.022, 0.018);
  dz += 0.0022 * gauss(x, y + 0.045, 0.02, 0.006);
  dz += 0.0026 * gauss(x, y + 0.056, 0.018, 0.006);
  dz -= 0.0012 * gauss(x, y + 0.066, 0.02, 0.005);
  dz += 0.0035 * gauss(x, y + 0.084, 0.024, 0.012);
  v.z += dz * f;
}

/**
 * The head with a face: a sphere with its pole on the face and its rings
 * packed close round it (so the eyes, nose and mouth get the triangles),
 * shaped like the crowd's head, then sculpted.
 */
function faceHead(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 24, 17);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const theta = Math.acos(THREE.MathUtils.clamp(v.y, -1, 1));
    const th = Math.PI * Math.pow(theta / Math.PI, 1.6);
    const r = Math.hypot(v.x, v.z);
    const s = Math.sin(th);
    if (r > 1e-6) v.set((v.x / r) * s, Math.cos(th), (v.z / r) * s);
    // the pole to the front
    v.set(v.x, -v.z, v.y);
    shapeHead(v);
    sculpt(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const w = mergeVertices(g, 1e-5);
  w.computeVertexNormals();
  w.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(w.attributes.position.count * 2), 2));
  return w;
}

/** the face's surface depth at (x, y) in head space */
function surfaceZ(head: THREE.BufferGeometry, x: number, y: number): number {
  const pos = head.attributes.position;
  let best = Infinity;
  let z = 0.09;
  for (let i = 0; i < pos.count; i++) {
    const pz = pos.getZ(i);
    if (pz <= 0) continue;
    const d = (pos.getX(i) - x) ** 2 + (pos.getY(i) - y) ** 2;
    if (d < best) {
      best = d;
      z = pz;
    }
  }
  return z;
}

/** a shell over a turned profile, pushed out by `k` and `add` */
const grown = (profile: [number, number][], k: number, add: number): [number, number][] => profile.map(([r, y]) => [r * k + add, y]);

/** an open lathe (no end caps): a layer of clothing over a part */
function sleeve(profile: [number, number][], radial: number, x = 0): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    radial,
  ).translate(x, 0, 0);
}

/** a thin surface seen from both sides (a brim, a fan, a lens) */
function twoSided(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const a = g.index ? g.toNonIndexed() : g;
  const b = a.clone();
  const n = b.attributes.normal;
  for (let i = 0; i < n.count; i += 3) {
    // swap two corners to flip the winding
    for (const attr of Object.values(b.attributes)) {
      const s = attr.itemSize;
      const arr = attr.array as Float32Array;
      for (let k = 0; k < s; k++) {
        const t = arr[(i + 1) * s + k];
        arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
        arr[(i + 2) * s + k] = t;
      }
    }
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return mergeVertices(mergeGeometries([a, b])!, 1e-7);
}

/** cheap smooth bumps over a direction (hair clumps, curls) */
const bumps = (d: THREE.Vector3, f: number, seed: number) =>
  Math.sin(d.x * f + seed) * Math.sin(d.y * f * 1.3 + seed * 2.1) * Math.sin(d.z * f * 0.9 + seed * 0.7) + 0.5 * Math.sin((d.x + d.y * 0.7 - d.z * 0.4) * f * 1.9 + seed * 3.3);

export interface FacePoints {
  /** an eye's centre (right side; mirror x for the left) and radius */
  eye: THREE.Vector3;
  eyeR: number;
}

let frontGeo: THREE.BufferGeometry | null = null;
let face: FacePoints | null = null;

/** the eyes and so on, for the shader that paints them (in the head's own coordinates, before it's grown: see growHead) */
export function facePoints(): FacePoints {
  frontGeometry();
  return face!;
}

/**
 * The front row's model, in the crowd's rest pose and skeleton (facing +Z,
 * feet on y = 0, hips 0.9, knees 0.5, shoulders 1.42, elbows 1.14, neck 1.47).
 */
export function frontGeometry(): THREE.BufferGeometry {
  if (frontGeo) return frontGeo;
  const parts: THREE.BufferGeometry[] = [];
  const cap = (r: number, len: number, caps: number, radial: number) => new THREE.CapsuleGeometry(r, len, caps, radial);
  const sph = (r: number, ws: number, hs: number, ...rest: number[]) => new THREE.SphereGeometry(r, ws, hs, ...rest);

  // the head and its face
  const head = faceHead();
  const eyeX = 0.033;
  const eyeY = 0.003;
  const eyeR = 0.0135;
  const socket = surfaceZ(head, eyeX, eyeY);
  // the eyeball shows a little proud of the socket's floor, behind the brow and the cheek
  const eyeZ = socket + 0.0052 - eyeR;
  face = { eye: new THREE.Vector3(eyeX, HEAD_Y + eyeY, eyeZ + HEAD_Z), eyeR };
  const browZ = surfaceZ(head, 0.034, 0.031);
  const foreheadZ = surfaceZ(head, 0.034, 0.064);
  parts.push(part(head.translate(0, HEAD_Y, HEAD_Z), B.head, M.skin));
  for (const sd of [-1, 1]) {
    parts.push(part(sph(eyeR, 8, 6).translate(sd * eyeX, HEAD_Y + eyeY, HEAD_Z + eyeZ), B.head, F.eye));
    // brows: a soft, level stroke, raised a little (a lifted outer end reads as stern, a lifted inner end as worried)
    parts.push(part(cap(0.0038, 0.024, 1, 5).rotateZ(Math.PI / 2).scale(1, 1, 0.55).translate(sd * 0.034, HEAD_Y + 0.032, HEAD_Z + browZ + 0.0016), B.head, F.brow));
    // ears: flat, angled back from the head, the fold painted
    parts.push(part(sph(0.031, 7, 5).scale(0.3, 1, 0.64).rotateY(-sd * 0.35).translate(sd * 0.089, HEAD_Y - 0.004, HEAD_Z - 0.01), B.head, M.skin));
  }
  const neck = part(turned(NECK, 12, false), B.head, M.skin);
  parts.push(neck);

  // hair: a shell with volume (clumped over the crown), the quiff, long hair, curls, a bun
  const hair = headGeometry(18, 9, Math.PI * 0.66, (phi) => Math.PI * (0.37 + 0.27 * smooth(0.5, 2.9, Math.abs(phi))), 0.09);
  {
    const p = hair.attributes.position;
    const v = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      d.copy(v).normalize();
      const k = 1.025 + 0.04 * Math.max(0, bumps(d, 9, 1.7)) * smooth(0.04, 0.09, v.y);
      p.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    hair.computeVertexNormals();
  }
  parts.push(part(hair.translate(0, HEAD_Y, HEAD_Z), B.head, M.hair));
  parts.push(part(sph(0.078, 10, 6).scale(0.92, 0.34, 0.86).rotateX(-0.32).translate(0, 1.69, 0.045), B.head, M.hairUp));
  {
    const lh = new THREE.CylinderGeometry(0.098, 0.13, 0.3, 16, 3, true, Math.PI * 0.32, Math.PI * 1.36);
    const p = lh.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const a = Math.atan2(x, z);
      const k = 1 + 0.05 * Math.sin(a * 11 + y * 18) + 0.03 * Math.sin(a * 5 - y * 9);
      p.setXYZ(i, x * k, y, z * k);
    }
    lh.computeVertexNormals();
    parts.push(part(lh.scale(0.92, 1, 0.98).translate(0, 1.49, -0.014), B.head, M.longHair));
  }
  {
    const cu = sph(0.122, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.64);
    const p = cu.attributes.position;
    const d = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      d.fromBufferAttribute(p, i).normalize();
      const k = 1 + 0.07 * bumps(d, 14, 0.3);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    cu.deleteAttribute('normal');
    cu.deleteAttribute('uv');
    const cw = mergeVertices(cu, 1e-6);
    cw.computeVertexNormals();
    cw.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(cw.attributes.position.count * 2), 2));
    parts.push(part(cw.scale(0.95, 0.92, 1).translate(0, 1.632, -0.022), B.head, F.curls));
  }
  parts.push(part(sph(0.044, 8, 6).scale(1, 0.9, 1).translate(0, 1.705, -0.085), B.head, F.bun));
  // the cap (the crowd's)
  parts.push(part(sph(0.12, 12, 4, 0, Math.PI * 2, 0, Math.PI * 0.44).scale(0.82, 0.86, 0.97).translate(0, 1.64, -0.004), B.head, M.cap));
  parts.push(part(new THREE.CylinderGeometry(0.086, 0.086, 0.01, 12, 1, false, -Math.PI / 2, Math.PI).scale(0.86, 1, 0.92).translate(0, 1.663, 0.056), B.head, M.cap));
  // a bucket hat: the crown and a sloping brim
  parts.push(part(new THREE.CylinderGeometry(0.084, 0.096, 0.075, 12, 1).scale(0.97, 1, 1.07).translate(0, 1.705, -0.004), B.head, F.hat));
  parts.push(part(twoSided(new THREE.CylinderGeometry(0.1, 0.152, 0.04, 12, 1, true).scale(0.97, 1, 1.07).translate(0, 1.652, -0.004)), B.head, F.hat));
  // sunglasses: two lenses, the top bar, the arms back to the ears
  const lensZ = HEAD_Z + eyeZ + eyeR + 0.011;
  for (const sd of [-1, 1]) {
    parts.push(part(twoSided(new THREE.CircleGeometry(0.0205, 10).scale(1.12, 0.84, 1).rotateY(sd * 0.16).translate(sd * eyeX, HEAD_Y + eyeY, lensZ)), B.head, F.glasses));
    parts.push(part(new THREE.BoxGeometry(0.0045, 0.006, 0.105).translate(sd * 0.085, HEAD_Y + eyeY + 0.012, lensZ - 0.058), B.head, F.glasses));
  }
  parts.push(part(new THREE.BoxGeometry(0.172, 0.006, 0.006).translate(0, HEAD_Y + eyeY + 0.016, lensZ - 0.002), B.head, F.glasses));
  // goggles up on the forehead (the playa): a band round the head and two round lenses
  parts.push(part(new THREE.CylinderGeometry(1, 1, 0.022, 16, 1, true).scale(0.079, 1, 0.094).translate(0, HEAD_Y + 0.064, HEAD_Z - 0.004), B.head, F.goggles));
  for (const sd of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(0.025, 0.027, 0.02, 8, 1).rotateX(Math.PI / 2).rotateY(sd * 0.32).translate(sd * 0.034, HEAD_Y + 0.066, HEAD_Z + foreheadZ + 0.02), B.head, F.goggles));

  // the body: the crowd's parts (legs and arms at the crowd's close-up detail; the torso rounder)
  for (const sd of [-1, 1]) {
    const L = sd < 0;
    const lx = sd * 0.09;
    const ax = sd * 0.2;
    const shin = L ? B.shinL : B.shinR;
    const thigh = L ? B.thighL : B.thighR;
    const upper = L ? B.upperL : B.upperR;
    const fore = L ? B.foreL : B.foreR;
    parts.push(
      part(cap(0.047, 0.15, 2, 8).rotateX(Math.PI / 2).scale(1.1, 0.72, 1).translate(lx, 0.035, 0.046), shin, M.shoes),
      part(turned(SHIN.filter((_, i) => i % 2 === 0 || i === SHIN.length - 1), 10, false, lx), shin, M.shin),
      part(sph(0.05, 8, 5).scale(1, 1, 1.04).translate(lx, 0.505, 0.003), shin, M.shin),
      part(turned(THIGH, 8, false, lx), thigh, M.bottoms),
      part(sph(0.056, 8, 6).scale(1, 0.9, 0.9).translate(ax, 1.378, 0), upper, M.sleeveUp),
      part(turned(UPPER_ARM, 10, false, ax), upper, M.sleeveUp),
      part(sph(0.043, 6, 4).translate(ax, 1.14, 0), fore, M.sleeveLo),
      part(turned(FOREARM, 10, false, ax), fore, M.sleeveLo),
      // the hand: a palm, then four fingers hanging from it, curled in a little towards the palm, and a thumb forward
      part(sph(0.042, 8, 6).scale(0.52, 0.98, 0.86).translate(ax - sd * 0.004, 0.84, 0.006), fore, M.skin),
    );
    const fz = [0.024, 0.01, -0.004, -0.017];
    const fl = [0.062, 0.068, 0.064, 0.05];
    const fr = [0.0087, 0.009, 0.0085, 0.0074];
    for (let k = 0; k < 4; k++) {
      parts.push(
        part(
          cap(fr[k], fl[k], 1, 5)
            .translate(0, -fl[k] / 2, 0)
            .rotateZ(-sd * (0.22 + 0.05 * k))
            .rotateX((fz[k] - 0.004) * 4)
            .translate(ax - sd * 0.004, 0.812, fz[k]),
          fore,
          M.skin,
        ),
      );
    }
    parts.push(part(cap(0.0105, 0.036, 1, 5).translate(0, -0.018, 0).rotateX(-0.75).rotateZ(-sd * 0.3).translate(ax - sd * 0.008, 0.842, 0.032), fore, M.skin));

    // the outer layer's sleeves (a jacket, a hoodie, a shirt, a coat) and its shoulder
    parts.push(part(sph(0.066, 8, 6).scale(1, 0.92, 0.92).translate(ax, 1.38, 0), upper, F.shell));
    parts.push(part(sleeve(grown([[0.044, 1.1], UPPER_ARM[2], UPPER_ARM[4]], 1.16, 0.006), 10, ax), upper, F.shell));
    parts.push(part(sleeve(grown([[0.036, 0.895], FOREARM[2], FOREARM[4]], 1.2, 0.006), 10, ax), fore, F.shellLo));
  }
  parts.push(
    part(turned(PELVIS, 12, false).scale(1.12, 1, 0.7), B.body, M.bottoms),
    part(new THREE.LatheGeometry(TORSO.map(([r, y]) => new THREE.Vector2(r, y)), 16).scale(1.12, 1, 0.68), B.body, M.top),
  );
  // the outer layer over the torso: longer than the top, open at the neck (and down the front, painted)
  parts.push(part(sleeve([[0.157, 0.87], [0.154, 0.93], ...grown(TORSO.slice(2, 12).filter((_, i) => i % 2 === 0 || i === 9), 1.07, 0.006), [0.118, 1.446], [0.082, 1.47]], 14).scale(1.12, 1, 0.7), B.body, F.shell));
  parts.push(part(new THREE.TorusGeometry(0.068, 0.017, 4, 14).rotateX(Math.PI / 2).scale(1.18, 1, 1.02).translate(0, 1.462, -0.004), B.body, F.shell));
  // the hood, down: rolled round the back of the neck and lying between the shoulders
  parts.push(part(new THREE.TorusGeometry(0.085, 0.032, 4, 8, Math.PI * 1.25).rotateZ(Math.PI * 1.25).rotateX(Math.PI / 2).scale(1.15, 1, 1).translate(0, 1.47, -0.012), B.body, F.hood));
  parts.push(part(sph(0.11, 6, 3).scale(1, 1.05, 0.32).translate(0, 1.35, -0.112), B.body, F.hood));
  // a collar: a fur collar, a bandana or a choker by the venue
  parts.push(part(new THREE.TorusGeometry(0.064, 0.014, 4, 14).rotateX(Math.PI / 2).scale(1.12, 0.8, 1).translate(0, 1.47, -0.002), B.body, F.collar));
  // a crossbody bag's pouch at the hip (the strap is painted over the top and the jacket)
  parts.push(part(sph(1, 8, 5).scale(0.078, 0.048, 0.03).translate(-0.12, 1.02, 0.112), B.body, F.strap));
  // a harness's steel ring at the chest (the straps are painted)
  parts.push(part(new THREE.TorusGeometry(0.017, 0.004, 4, 10).translate(0, 1.33, 0.118), B.body, F.harness));

  // props: the phone in the right hand (screen to the holder, torch on the back), the drink in the left, the sign, the towel
  parts.push(
    part(new THREE.BoxGeometry(0.07, 0.14, 0.012).translate(0.2, 0.76, 0.03), B.foreR, M.phone),
    part(new THREE.PlaneGeometry(0.062, 0.128).translate(0.2, 0.76, 0.0365), B.foreR, M.screen),
    part(new THREE.PlaneGeometry(0.014, 0.014).rotateY(Math.PI).translate(0.215, 0.705, 0.0235), B.foreR, M.torch),
    part(new THREE.CylinderGeometry(0.036, 0.028, 0.11, 10).translate(0, 0.02, 0.04).rotateX(2.2).translate(-0.2, 0.83, 0), B.foreL, M.cup),
    part(new THREE.BoxGeometry(0.76, 0.22, 0.02).translate(0, 2.1, 0.12), B.sign, M.signFrame),
    part(new THREE.PlaneGeometry(0.72, 0.18).translate(0, 2.1, 0.1305), B.sign, M.signFace),
    part(new THREE.PlaneGeometry(0.32, 0.56, 1, 3).translate(0.2, 0.5, 0.02), B.foreR, M.towel),
    // a glowstick in the left fist, pointing forward
    part(new THREE.CylinderGeometry(0.0065, 0.0065, 0.19, 6, 1).rotateX(Math.PI / 2 - 0.35).translate(-0.205, 0.818, 0.04), B.foreL, F.glow),
    // a folding fan, open, from the left hand (it follows the forearm up)
    part(twoSided(new THREE.CircleGeometry(0.17, 12, Math.PI * 1.08, Math.PI * 0.84).rotateY(Math.PI / 2).translate(-0.205, 0.8, 0.03)), B.foreL, F.fan),
  );
  // the head drawn a little larger than life, as in the crowd's model
  for (const g of parts) if (g !== neck && g.attributes.aBone.getX(0) === B.head) growHead(g);
  frontGeo = mergeGeometries(parts.map((g) => (g.index ? g : mergeVertices(g, 1e-9))))!;
  return frontGeo;
}

/* ------------------------------------------------------------------ shaders */

/** what each person in the front row wears: shared by the vertex shader (what shows) and the fragment shader (its colours) */
export const FRONT_COMMON = /* glsl */ `
  uniform float uOutfit;
  /* each person's picks, made in the vertex shader: the outer layer, bare top, bag strap, harness; two free picks */
  varying vec4 vPick;
  varying vec2 vPick2;
  float fHash(vec4 s, float k) { return fract(sin(dot(s, vec4(12.9898, 78.233, 45.164, 94.673)) * (1.0 + k * 0.137) + k * 17.17) * 43758.5453); }
  /* a chance by the venue's look: club, dark, beach, festival, playa */
  float byLook(vec4 a, float playa) { return uOutfit < 0.5 ? a.x : uOutfit < 1.5 ? a.y : uOutfit < 2.5 ? a.z : uOutfit < 3.5 ? a.w : playa; }
  /* the outer layer: 0 none, 1 open jacket, 2 hoodie, 3 open short-sleeved shirt, 4 fur coat, 5 gilet */
  float frontShell(vec4 s) {
    float h = fHash(s, 1.0);
    vec4 c; float v;
    if (uOutfit < 0.5) { c = vec4(0.2, 0.4, 0.48, 0.48); v = 0.53; }
    else if (uOutfit < 1.5) { c = vec4(0.38, 0.44, 0.46, 0.46); v = 0.56; }
    else if (uOutfit < 2.5) { c = vec4(0.02, 0.04, 0.42, 0.42); v = 0.46; }
    else if (uOutfit < 3.5) { c = vec4(0.18, 0.34, 0.44, 0.44); v = 0.54; }
    else { c = vec4(0.05, 0.07, 0.17, 0.47); v = 0.65; }
    return h < c.x ? 1.0 : h < c.y ? 2.0 : h < c.z ? 3.0 : h < c.w ? 4.0 : h < v ? 5.0 : 0.0;
  }
  /* bare top (shirtless, or a bikini top at the beach) */
  bool frontSwim(vec4 s, float shell) { return (shell < 0.5 || shell > 2.5 && shell < 3.5) && fHash(s, 2.0) < byLook(vec4(0.0, 0.22, 0.55, 0.08), 0.3); }
  bool frontPick(vec4 s, float k, vec4 a, float playa) { return fHash(s, k) < byLook(a, playa); }
`;

/** inside computePose: what of the front row's kit shows */
export const FRONT_VIS = /* glsl */ `
    {
      float fShell = frontShell(iSeed);
      float hatOn = (frontPick(iSeed, 5.0, vec4(0.04, 0.0, 0.24, 0.24), 0.14) ? 1.0 : 0.0) * (1.0 - capOn) * (1.0 - staff);
      float curlOn = (fHash(iSeed, 11.0) < 0.16 ? 1.0 : 0.0) * (1.0 - capOn) * (1.0 - hatOn);
      float glowOn = (frontPick(iSeed, 9.0, vec4(0.3, 0.04, 0.12, 0.32), 0.42) ? 1.0 : 0.0) * (1.0 - staff) * (1.0 - dj);
      float fanOn = (frontPick(iSeed, 10.0, vec4(0.08, 0.16, 0.1, 0.06), 0.1) ? 1.0 : 0.0) * (1.0 - glowOn) * (1.0 - staff) * (1.0 - dj);
      float leftFree = (1.0 - step(0.5, wDrink)) * (1.0 - sign);
      float m = aMat;
      vPick = vec4(fShell, frontSwim(iSeed, fShell) ? 1.0 : 0.0, frontPick(iSeed, 6.0, vec4(0.3, 0.08, 0.12, 0.45), 0.3) ? 1.0 : 0.0, frontPick(iSeed, 7.0, vec4(0.04, 0.35, 0.0, 0.0), 0.06) ? 1.0 : 0.0);
      vPick2 = vec2(fHash(iSeed, 21.0), fHash(iSeed, 22.0));
      if (m > 17.5) {
        if (m < 19.5) vis = 1.0;
        else if (m < 20.5) vis = step(0.5, fShell) * (fShell > 4.5 && aBone > 0.5 ? 0.0 : 1.0);
        else if (m < 21.5) vis = (fShell > 0.5 && fShell < 2.5) || (fShell > 3.5 && fShell < 4.5) ? 1.0 : 0.0;
        else if (m < 22.5) vis = fShell > 1.5 && fShell < 2.5 ? 1.0 : 0.0;
        else if (m < 23.5) vis = (frontPick(iSeed, 6.0, vec4(0.3, 0.08, 0.12, 0.45), 0.3) ? 1.0 : 0.0) * (1.0 - staff);
        else if (m < 24.5) vis = frontPick(iSeed, 3.0, vec4(0.1, 0.16, 0.5, 0.36), 0.16) ? 1.0 : 0.0;
        else if (m < 25.5) vis = hatOn;
        else if (m < 26.5) vis = glowOn * leftFree;
        else if (m < 27.5) vis = fanOn * leftFree;
        else if (m < 28.5) vis = curlOn;
        else if (m < 29.5) vis = (fHash(iSeed, 12.0) < 0.16 ? 1.0 : 0.0) * (1.0 - capOn) * (1.0 - hatOn) * (1.0 - curlOn);
        else if (m < 30.5) vis = (frontPick(iSeed, 8.0, vec4(0.0, 0.16, 0.0, 0.2), 0.45) ? 1.0 : 0.0) * (fShell > 1.5 && fShell < 2.5 || fShell > 3.5 && fShell < 4.5 ? 0.0 : 1.0);
        else if (m < 31.5) vis = (frontPick(iSeed, 4.0, vec4(0.0, 0.0, 0.0, 0.04), 0.55) ? 1.0 : 0.0) * (1.0 - hatOn) * (1.0 - capOn);
        else vis = (frontPick(iSeed, 7.0, vec4(0.04, 0.35, 0.0, 0.0), 0.06) ? 1.0 : 0.0) * (1.0 - staff);
      }
      // the quiff and long hair make way for curls, a bun or a hat
      else if (m > 16.5) vis *= (1.0 - curlOn) * (1.0 - hatOn);
      else if (m > 13.5 && m < 14.5) vis *= 1.0 - curlOn;
      // a shout on the drop, singing along when the room's going, otherwise closed
      poseMouth = clamp(wCheer * step(0.3, fract(iSeed.y * 13.7)) + max(0.0, vnoise(uTime * 1.7 + iSeed.x * 40.0) - 0.55) * 2.2 * smoothstep(0.55, 0.9, uHype) * step(0.4, fract(iSeed.z * 3.9)) + 0.6 * wCheer * pump, 0.0, 1.0);
      poseFilm = max(wFilm, wLight);
    }
`;

/** the front row's colours: after the crowd's own (col, glow, crowdRough, skin, hair, top, p, aa, m are in scope) */
export function frontFrag(): string {
  const f = facePoints();
  const e = (n: number) => n.toFixed(5);
  return /* glsl */ `
  {
    // the picks come from the vertex shader: a hash of an interpolated seed would flicker from pixel to pixel
    float fShell = floor(vPick.x + 0.5);
    bool swim = vPick.y > 0.5;
    float look = uOutfit;
    float fh1 = vPick2.x;
    float fh2 = vPick2.y;
    // fine detail (fur pile, stubble, sweat beads) fades out before it can shimmer
    float fine = 1.0 - smoothstep(0.0016, 0.004, aa);
    vec3 eyeC = vec3(${e(f.eye.x)} * sign(p.x), ${e(f.eye.y)}, ${e(f.eye.z)});
    // the outer layer's colour
    vec3 shellCol = vec3(0.04);
    float shellRough = 0.8;
    if (fShell < 1.5) {
      // jacket: leather at Berghain, a rain jacket or bomber at a festival, suede on the playa, denim/olive/black in a club
      if (look > 0.5 && look < 1.5) { shellCol = vec3(0.018); shellRough = 0.32; }
      else if (look > 2.5 && look < 3.5) { shellCol = fh1 < 0.25 ? vec3(0.85, 0.62, 0.04) : fh1 < 0.45 ? vec3(0.9, 0.3, 0.06) : fh1 < 0.65 ? vec3(0.05, 0.42, 0.42) : vec3(0.1, 0.12, 0.08); shellRough = fh1 < 0.65 ? 0.45 : 0.7; }
      else if (look > 3.5) { shellCol = vec3(0.36, 0.22, 0.12); shellRough = 0.9; }
      else shellCol = fh1 < 0.3 ? vec3(0.02) : fh1 < 0.55 ? vec3(0.14, 0.16, 0.09) : fh1 < 0.8 ? vec3(0.1, 0.16, 0.28) : top * 0.45 + vec3(0.02);
    } else if (fShell < 2.5) {
      // hoodie: grey marl, black, or the top's colour turned down
      shellCol = fh1 < 0.35 ? vec3(0.32, 0.32, 0.33) : fh1 < 0.65 ? vec3(0.025) : mix(top, vec3(0.5), 0.35);
      shellRough = 0.95;
    } else if (fShell < 3.5) {
      // a short-sleeved shirt: a big floral print on a pale or bright ground
      vec3 ground = fh1 < 0.25 ? vec3(0.85, 0.84, 0.8) : fh1 < 0.45 ? vec3(0.05, 0.38, 0.45) : fh1 < 0.6 ? vec3(0.85, 0.45, 0.35) : fh1 < 0.75 ? vec3(0.05, 0.07, 0.2) : top;
      vec3 ink = fh2 < 0.35 ? vec3(0.95, 0.85, 0.3) : fh2 < 0.7 ? vec3(0.95, 0.35, 0.5) : vec3(0.95, 0.95, 0.92);
      // hibiscus flowers and leaves, one to a cell, turned and nudged about
      vec2 fuv = vec2(p.x + p.z * 0.8, p.y) * 13.0 + vSeed.xy * 7.0;
      vec2 cell = floor(fuv);
      float ch = crowdHash(cell);
      vec2 fq = fract(fuv) - 0.5 + (vec2(crowdHash(cell + 7.1), crowdHash(cell + 3.3)) - 0.5) * 0.25;
      float fr = length(fq);
      float fa = atan(fq.y, fq.x) + ch * 6.283;
      float petals = 1.0 - smoothstep(0.0, 0.03, fr - 0.3 * (0.62 + 0.38 * cos(5.0 * fa)));
      vec2 lq = mat2(cos(fa), sin(fa), -sin(fa), cos(fa)) * fq;
      float leaf = 1.0 - smoothstep(0.0, 0.03, length(lq / vec2(0.42, 0.16)) - 1.0);
      shellCol = ground;
      if (ch < 0.55) {
        shellCol = mix(shellCol, ink, petals);
        shellCol = mix(shellCol, vec3(0.6, 0.1, 0.12), 1.0 - smoothstep(0.05, 0.08, fr));
      } else shellCol = mix(shellCol, vec3(0.08, 0.32, 0.14), leaf * 0.85);
      shellRough = 0.85;
    } else if (fShell < 4.5) {
      // a fur coat: white, pink, purple, turquoise or leopard
      shellCol = fh1 < 0.25 ? vec3(0.88, 0.86, 0.82) : fh1 < 0.45 ? vec3(0.95, 0.4, 0.62) : fh1 < 0.6 ? vec3(0.45, 0.22, 0.68) : fh1 < 0.75 ? vec3(0.15, 0.7, 0.75) : vec3(0.66, 0.46, 0.22);
      if (fh1 >= 0.75) {
        vec3 q3 = p * 55.0;
        float spot = sin(q3.x) * sin(q3.y * 1.2 + q3.z) * sin(q3.z * 0.8);
        shellCol = mix(shellCol, vec3(0.08, 0.05, 0.03), smoothstep(0.32, 0.4, spot));
      }
      shellRough = 1.0;
    } else {
      // a gilet: a quilted puffer, or leather on the playa
      shellCol = look > 3.5 ? vec3(0.3, 0.17, 0.08) : fh1 < 0.4 || (look > 0.5 && look < 1.5) ? vec3(0.02) : fh1 < 0.7 ? top * 0.6 : vec3(0.75, 0.35, 0.1);
      shellRough = look > 3.5 ? 0.85 : 0.45;
    }
    if (m > 17.5) {
      if (m < 18.5) {
        // the eye: the white, the iris and pupil looking out, the lids (they blink), lashes
        vec3 d = p - eyeC;
        float r = length(d.xy);
        float iris = fh1 < 0.45 || tone > 0.45 ? 0.0 : fh1 < 0.7 ? 1.0 : fh1 < 0.85 ? 2.0 : 3.0;
        vec3 irisCol = iris < 0.5 ? vec3(0.12, 0.055, 0.02) : iris < 1.5 ? vec3(0.08, 0.2, 0.34) : iris < 2.5 ? vec3(0.12, 0.22, 0.08) : vec3(0.25, 0.15, 0.05);
        col = vec3(0.74, 0.71, 0.68);
        crowdRough = 0.1;
        if (d.z > 0.0) {
          // a big iris (a friendly, open look), the pupil, a ring a shade darker round the iris
          col = mix(col, irisCol * 0.6, 1.0 - smoothstep(0.0084, 0.0084 + aa, r));
          col = mix(col, irisCol, 1.0 - smoothstep(0.0072, 0.0072 + aa, r));
          col = mix(col, vec3(0.008), 1.0 - smoothstep(0.0033, 0.0033 + aa, r));
          // a catch light, high on the same side in both eyes
          col = mix(col, vec3(1.2), 1.0 - smoothstep(0.0017, 0.0017 + aa, length(d.xy - vec2(-0.0028, 0.0031))));
        }
        // relaxed lids: the upper lid just over the top of the iris, the lower lid lifted a touch as if smiling
        float blink = step(0.965, fract(uTime * 0.23 + vSeed.x * 7.0));
        float lid = mix(0.0078, -0.0125, blink) - 0.0012 * (d.x / 0.0135) * (d.x / 0.0135);
        float lower = -0.0088 + 0.0016 * (1.0 - (d.x / 0.0135) * (d.x / 0.0135));
        float lidMix = smoothstep(lid - aa, lid + aa, d.y) + (1.0 - smoothstep(lower - aa, lower + aa, d.y));
        vec3 lidCol = skin * 0.95;
        col = mix(col, lidCol, clamp(lidMix, 0.0, 1.0));
        float lash = 1.0 - smoothstep(0.0012, 0.0012 + 0.0008 + aa, abs(d.y - lid));
        col = mix(col, vec3(0.02, 0.015, 0.015), lash * 0.95 * (1.0 - step(lid + 0.002, d.y)));
        if (lidMix > 0.5) crowdRough = 0.55;
      }
      else if (m < 19.5) { col = hair * 0.75; crowdRough = 0.7; }
      else if (m < 22.5) {
        col = shellCol;
        crowdRough = shellRough;
        // open down the front (jackets, shirts, coats, gilets): the top shows between the fronts, a darker edge
        if (vBone < 0.5 && fShell != 2.0 && p.z > 0.0 && m < 20.5) {
          float open = 0.028 + 0.05 * smoothstep(1.2, 1.46, p.y);
          if (abs(p.x) < open && p.y < 1.452) discard;
          col *= 1.0 - 0.35 * (1.0 - smoothstep(open, open + 0.012, abs(p.x)));
        }
        // a hoodie: the kangaroo pocket, the drawstrings, ribbed cuffs and hem
        if (fShell > 1.5 && fShell < 2.5) {
          if (vBone < 0.5 && p.z > 0.06 && p.y > 0.99 && p.y < 1.13 && abs(p.x) < 0.11) col *= 0.85;
          if (vBone < 0.5 && p.z > 0.07 && abs(abs(p.x) - 0.03) < 0.0028 && p.y > 1.3 && p.y < 1.44) col = vec3(0.85);
        }
        // a gilet: quilted bands
        if (fShell > 4.5 && look < 3.5) col *= 0.82 + 0.18 * smoothstep(0.0, 0.25, abs(fract(p.y * 14.0) - 0.5));
        // cuffs and the hem
        if (p.y < 0.9 || (m > 20.5 && p.y < 0.91 && vBone > 4.5)) col *= 0.8;
        // fur: a deep pile
        if (fShell > 3.5 && fShell < 4.5) {
          float pile = crowdHash(floor(p.xy * 260.0) + floor(p.z * 260.0));
          col *= 1.0 + (0.4 * pile - 0.2) * fine;
        }
      }
      else if (m < 23.5) {
        // the bag: black, the top's colour or a bright one, a zip along the top
        col = fh2 < 0.5 ? vec3(0.02) : fh2 < 0.75 ? top * 0.7 : vec3(0.85, 0.3, 0.08);
        if (p.y > 1.04 && p.y < 1.048) col = vec3(0.4);
        crowdRough = 0.6;
      }
      else if (m < 24.5) {
        // sunglasses: dark lenses that catch the show (mirrored on some), black, white or tortoiseshell frames
        bool lens = p.z > ${e(f.eye.z + f.eyeR + 0.005)} && abs(p.y - ${e(f.eye.y)}) < 0.013;
        col = lens ? vec3(0.015) : fh2 < 0.5 ? vec3(0.015) : fh2 < 0.75 ? vec3(0.85) : vec3(0.25, 0.12, 0.04);
        crowdRough = lens ? 0.18 : 0.4;
        if (lens) glow += uRim * (fh2 < 0.4 ? 0.3 : 0.1) * (0.4 + 0.6 * smoothstep(-0.01, 0.015, p.y - ${e(f.eye.y)}));
      }
      else if (m < 25.5) {
        // a bucket hat: khaki, black, a check, or the top's colour
        col = fh1 < 0.3 ? vec3(0.42, 0.38, 0.26) : fh1 < 0.55 ? vec3(0.025) : fh1 < 0.8 ? top : vec3(0.7, 0.68, 0.62);
        if (fh1 >= 0.8) col *= 0.75 + 0.35 * step(0.5, fract(p.x * 40.0)) * step(0.5, fract(p.y * 40.0 + p.z * 40.0));
        crowdRough = 0.9;
      }
      else if (m < 26.5) {
        // a glowstick
        vec3 gc = fh2 < 0.25 ? vec3(0.2, 1.0, 0.25) : fh2 < 0.45 ? vec3(1.0, 0.15, 0.6) : fh2 < 0.65 ? vec3(0.2, 0.55, 1.0) : fh2 < 0.85 ? vec3(1.0, 0.85, 0.1) : vec3(1.0, 0.4, 0.05);
        col = gc * 0.3;
        glow = gc * 4.0;
        crowdRough = 0.3;
      }
      else if (m < 27.5) {
        // a folding fan: pleats from the pivot in the hand, a print
        vec2 fp = vec2(p.z - 0.03, p.y - 0.8);
        float ang = atan(fp.y, fp.x);
        float pleat = fract(ang * 9.0);
        vec3 fc = fh2 < 0.35 ? vec3(0.02) : fh2 < 0.6 ? vec3(0.75, 0.05, 0.08) : fh2 < 0.8 ? vec3(0.85, 0.7, 0.3) : 0.5 + 0.5 * cos(6.283 * (ang * 0.4 + vec3(0.0, 0.33, 0.67)));
        col = fc * (0.8 + 0.25 * smoothstep(0.2, 0.5, pleat) - 0.2 * smoothstep(0.5, 0.9, pleat));
        if (length(fp) > 0.16) col = fc * 0.5;
        crowdRough = 0.7;
      }
      else if (m < 29.5) { col = hair; crowdRough = 0.55; }
      else if (m < 30.5) {
        // fur collar on the playa, a bandana at a festival, a choker and chain elsewhere
        if (look > 3.5) { col = fh2 < 0.5 ? vec3(0.9, 0.88, 0.84) : vec3(0.92, 0.45, 0.7); crowdRough = 1.0; col *= 1.0 + (0.4 * crowdHash(floor(p.xz * 260.0) + floor(p.y * 260.0)) - 0.2) * fine; }
        else if (look > 2.5) { col = fh2 < 0.5 ? vec3(0.6, 0.05, 0.05) : vec3(0.05, 0.1, 0.35); col = mix(col, vec3(0.9), step(0.7, fract(atan(p.x, p.z) * 4.0 + p.y * 60.0)) * 0.6); crowdRough = 0.9; }
        else { col = vec3(0.02); crowdRough = 0.35; }
      }
      else if (m < 31.5) {
        // goggles: a leather band, brass rims, amber or mirrored lenses that catch the show
        col = vec3(0.12, 0.07, 0.04);
        crowdRough = 0.7;
        if (p.z > ${e(0.07)}) {
          vec2 gq = vec2(abs(p.x) - 0.034, p.y - ${e(HEAD_Y + 0.066)});
          float gr = length(gq);
          if (gr < 0.019) { col = fh2 < 0.5 ? vec3(0.35, 0.18, 0.02) : vec3(0.05); crowdRough = 0.05; glow += uRim * 0.5; }
          else if (gr < 0.028) { col = vec3(0.5, 0.38, 0.15); crowdRough = 0.35; }
        }
      }
      else {
        // the harness's steel ring
        col = vec3(0.6);
        crowdRough = 0.2;
      }
    }
    // swimwear and bare tops: skin, a bikini top for some at the beach, board shorts
    if (swim) {
      if (m < 0.5) {
        col = skin;
        crowdRough = mix(0.55, 0.25, uSweat);
        // a little definition: the chest and the line down the middle
        col *= 1.0 - 0.06 * smoothstep(0.012, 0.0, abs(p.x)) * step(1.05, p.y) * step(p.y, 1.36) * step(0.0, p.z);
        if (look > 1.5 && look < 3.5 && fh2 < 0.5) {
          vec2 cup = vec2(abs(p.x) - 0.066, p.y - 1.285);
          float tri = step(0.0, p.z) * step(cup.y, 0.035 - abs(cup.x) * 1.2) * step(-0.03, cup.y);
          float band = step(abs(p.y - 1.25), 0.008);
          float strap = step(abs(abs(p.x) - 0.075 + (p.y - 1.32) * 0.3), 0.005) * step(1.3, p.y);
          vec3 bik = fh1 < 0.3 ? vec3(0.9, 0.1, 0.3) : fh1 < 0.6 ? vec3(0.05, 0.5, 0.7) : fh1 < 0.8 ? vec3(0.95, 0.8, 0.1) : vec3(0.02);
          if (max(tri, max(band, strap)) > 0.5) { col = bik; crowdRough = 0.7; }
        }
      }
      if (m > 4.5 && m < 6.5) { col = skin; crowdRough = mix(0.55, 0.25, uSweat); }
    }
    // painted on the torso (the top, or bare skin) and over a jacket: a crossbody bag's strap, a harness
    if (vBone < 0.5 && (m < 0.5 || (m > 19.5 && m < 20.5))) {
      if (vPick.z > 0.5) {
        // the strap over the right shoulder and down to the left hip, front and back
        float d = dot(p - vec3(0.1, 1.475, 0.0), vec3(0.858, -0.513, 0.0));
        float w = 1.0 - smoothstep(0.011, 0.011 + aa, abs(d));
        col = mix(col, vec3(0.025), w);
        crowdRough = mix(crowdRough, 0.6, w);
        col *= 1.0 - 0.35 * (1.0 - smoothstep(0.011, 0.02, abs(d))) * (1.0 - w);
      }
      if (m < 0.5 && vPick.w > 0.5) {
        // the chest band; straps from the ring up over the shoulders, and down the back to the band
        vec2 q = vec2(abs(p.x), p.y);
        vec2 a = p.z > 0.0 ? vec2(0.0, 1.33) : vec2(0.025, 1.25);
        vec2 b = vec2(0.105, 1.47);
        vec2 ab = b - a;
        float sd = length(q - a - ab * clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0));
        float hz = min(abs(p.y - 1.25) - 0.009, sd - 0.008);
        float w = 1.0 - smoothstep(0.0, aa, hz);
        col = mix(col, vec3(0.012), w);
        crowdRough = mix(crowdRough, 0.28, w);
      }
    }
    if (m > 1.5 && m < 2.5) {
      crowdRough = mix(0.55, 0.2, uSweat);
      // sweat: beads that catch the light, more as the night goes on (the face, the chest, the arms)
      vec3 sc = floor(p * 170.0);
      float bead = step(1.0 - 0.07 * uSweat, crowdHash(sc.xy + sc.z * 3.7)) * fine;
      bead *= 1.0 - smoothstep(0.22, 0.34, length(fract(p * 170.0) - 0.5));
      crowdRough = mix(crowdRough, 0.05, bead);
      if (vBone > 8.5 && vBone < 9.5 && p.z > 0.04 && p.y > 1.48) {
        vec2 q = vec2(abs(p.x), p.y - ${e(HEAD_Y)});
        // a smile: the mouth line curves up at the corners, soft lips round it
        float mx = q.x / 0.022;
        float open = vMouth;
        float topY = -0.045 + 0.0075 * mx * mx;
        float lipW = 0.0042 - 0.0022 * mx * mx;
        float lips = (1.0 - smoothstep(0.88, 1.0, mx)) * (1.0 - smoothstep(lipW, lipW + 0.0015, abs(q.y - topY + 0.0008)));
        vec3 lipCol = mix(skin, vec3(0.5, 0.16, 0.15), 0.28 + 0.22 * step(0.75, fh1));
        col = mix(col, lipCol, lips * 0.8);
        // open (a cheer, a sung line): a D-shaped grin, teeth along the top, dark below
        float botY = topY - (0.0012 + 0.017 * open) * (1.0 - mx * mx);
        float inMouth = (1.0 - smoothstep(0.92, 1.0, mx)) * smoothstep(botY - aa, botY + aa, q.y) * (1.0 - smoothstep(topY - aa, topY + aa, q.y));
        vec3 inside = q.y > topY - 0.0045 ? vec3(0.74, 0.71, 0.66) : mix(vec3(0.07, 0.015, 0.015), vec3(0.32, 0.08, 0.08), smoothstep(topY - 0.008, botY, q.y) * step(0.3, open));
        col = mix(col, inside, inMouth);
        // the line of the smile, and a dimple at each corner
        col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.0012 + aa, abs(q.y - topY))) * (1.0 - smoothstep(0.85, 1.0, mx));
        col *= 1.0 - 0.18 * exp(-dot(q - vec2(0.025, -0.039), q - vec2(0.025, -0.039)) / 0.000006);
        // a soft shade in the sockets, rosy cheeks, the nostrils
        col *= 1.0 - 0.06 * exp(-dot(q - vec2(0.033, 0.003), q - vec2(0.033, 0.003)) / 0.0003);
        col = mix(col, col * vec3(1.16, 0.9, 0.88), 0.65 * exp(-dot(q - vec2(0.048, -0.02), q - vec2(0.048, -0.02)) / 0.00045));
        col *= 1.0 - 0.35 * exp(-dot(q - vec2(0.0085, -0.027), q - vec2(0.0085, -0.027)) / 0.00001);
        // stubble on some
        if (fh2 > 0.85) col *= 1.0 - (0.06 - 0.05 * crowdHash(floor(p.xy * 900.0)) * fine) * smoothstep(-0.05, -0.062, q.y) * smoothstep(-0.118, -0.1, q.y);
        // glitter on the cheekbones at a festival or on the playa
        if (look > 2.5 && fh1 > 0.6) glow += vec3(1.2, 0.9, 1.4) * step(0.985, crowdHash(floor(p.xy * 700.0) + floor(uTime * 3.0))) * exp(-dot(q - vec2(0.05, -0.006), q - vec2(0.05, -0.006)) / 0.0003);
        // a phone's light on the face when they're filming
        glow += vec3(0.4, 0.5, 0.8) * 0.06 * vFilm * smoothstep(0.03, 0.09, p.z);
      }
      // the ear's fold
      if (vBone > 8.5 && vBone < 9.5 && abs(p.x) > 0.076 && p.y > 1.56 && p.y < 1.63) col *= 0.88;
    }
    // the hair goes darker and clumps with sweat
    if ((m > 2.5 && m < 3.5) || (m > 13.5 && m < 14.5) || (m > 16.5 && m < 17.5) || (m > 27.5 && m < 29.5)) {
      col *= 1.0 - 0.25 * uSweat;
      crowdRough = mix(crowdRough, 0.3, uSweat);
      if (m > 27.5 && m < 28.5) col *= 1.0 + (0.3 * crowdHash(floor(p.xz * 300.0) + floor(p.y * 300.0)) - 0.15) * fine;
    }
    // sweat through the top: down the chest and the back
    if (m < 0.5 && !swim) {
      float wetPatch = smoothstep(0.08, 0.0, abs(p.x)) * smoothstep(1.02, 1.2, p.y) * smoothstep(1.42, 1.3, p.y);
      col *= 1.0 - 0.3 * uSweat * wetPatch;
    }
    // the phone: the camera app (the show in the viewfinder, the red record dot)
    if (m > 8.5 && m < 9.5) {
      vec2 su = vUv2;
      vec3 view = mix(uRim * 3.0 + vec3(0.05, 0.05, 0.1), vec3(0.6, 0.55, 0.8), smoothstep(0.4, 0.9, su.y) * 0.4);
      float frame = step(0.12, su.y) * step(su.y, 0.88);
      float rec = 1.0 - smoothstep(0.03, 0.04, length((su - vec2(0.5, 0.06)) * vec2(1.0, 2.0)));
      glow = mix(vec3(0.03), view, frame) * 1.4 + vec3(1.6, 0.08, 0.06) * rec;
    }
  }
`;
}

/** the show's light on the front row: the rig's colours on the faces turned to it */
export const FRONT_LIGHT = /* glsl */ `
  {
    vec3 toRig = normalize((viewMatrix * vec4(uRimFrom, 1.0)).xyz + vViewPosition);
    float facing = clamp(dot(normal, toRig), 0.0, 1.0);
    totalEmissiveRadiance += uRim * diffuseColor.rgb * facing * 0.55;
  }
`;
