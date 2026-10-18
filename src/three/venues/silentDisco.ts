/*
 * The silent disco's headphones on the crowd (the showdown: app/silentDisco.ts).
 * Every dancer wears a pair while it runs, the ear cups' rings glowing the
 * colour of the channel they're on, pulsing on that channel's beat. Who's on
 * which channel is a hash of the person against blue's share of the room, so
 * as the share moves people flip one by one, never all at once.
 *
 * The crowd's shader (crowd.ts) reads these uniforms; every crowd shares the
 * same objects, so the mode only sets them here.
 */
import * as THREE from 'three';

/** the crowd's material ids for the headphones (clear of the body's and the front row's) */
export const DISCO_MATS = { shell: 40, led: 41 };

export const discoUniforms = {
  /** 0..1: the headphones are on */
  uDisco: { value: 0 },
  /** blue's share of the dancers */
  uDiscoBlue: { value: 0.5 },
  /** each channel's beat glow, 0..1 (blue, red) */
  uDiscoPulse: { value: new THREE.Vector2(0, 0) },
};

/**
 * The headphones on a unit head (the skull a sphere of radius 1 at the
 * origin): the band over the top, a cup over each ear and a light on the
 * outside of each cup (its ring is painted from the disc's uv). Kept to about
 * a hundred vertices, since every dancer carries them.
 */
export function headphoneShapes(lo: boolean): [THREE.BufferGeometry, number][] {
  const R = (hi: number, low: number) => (lo ? low : hi);
  const out: [THREE.BufferGeometry, number][] = [];
  // the band: an arc over the crown, clear of the hair, down to the cups
  out.push([new THREE.TorusGeometry(1.14, 0.075, 3, R(10, 6), Math.PI).scale(1, 1.12, 1.6).translate(0, -0.16, -0.04), DISCO_MATS.shell]);
  for (const sd of [-1, 1]) {
    // the cup over the ear (open: its inside is against the head, its outside is the light)
    out.push([new THREE.CylinderGeometry(0.44, 0.48, 0.3, R(8, 6), 1, true).rotateZ(Math.PI / 2).translate(sd * 1.13, -0.16, -0.04), DISCO_MATS.shell]);
    out.push([new THREE.CircleGeometry(0.44, R(10, 6)).rotateY((sd * Math.PI) / 2).translate(sd * 1.28, -0.16, -0.04), DISCO_MATS.led]);
  }
  return out;
}

export const DISCO_VERT_HEAD = /* glsl */ `
  uniform float uDisco;
`;

/** inside the pose: the headphones only while it runs, never on the staff */
export const DISCO_VIS = /* glsl */ `
    if (aMat > ${DISCO_MATS.shell - 0.5}) vis = step(0.5, uDisco) * (1.0 - staff);
`;

export const DISCO_FRAG_HEAD = /* glsl */ `
  uniform float uDisco, uDiscoBlue;
  uniform vec2 uDiscoPulse;
`;

/** the colour: dark plastic, and the ring glowing the person's channel */
export const DISCO_FRAG = /* glsl */ `
  if (m > ${DISCO_MATS.shell - 0.5}) {
    float onBlue = step(fract(vSeed.y * 7.31 + vSeed.w * 3.17), uDiscoBlue);
    vec3 chan = mix(vec3(1.0, 0.13, 0.18), vec3(0.12, 0.45, 1.0), onBlue);
    float beat = mix(uDiscoPulse.y, uDiscoPulse.x, onBlue);
    if (m > ${DISCO_MATS.led - 0.5}) {
      // a ring of light round a dark centre
      float r = length(vUv2 - 0.5) * 2.0;
      float ring = smoothstep(0.5, 0.68, r) * (1.0 - smoothstep(0.9, 1.0, r));
      col = mix(vec3(0.03), chan * 0.5, ring);
      glow = chan * (0.15 + ring * (1.6 + 2.4 * beat)) * uDisco;
      crowdRough = 0.3;
    } else {
      col = vec3(0.03);
      glow = chan * 0.05 * uDisco;
      crowdRough = 0.35;
    }
  }
`;

/* ---------------- the regulars (Regulars.ts: the scanned people at the front of the floor) ---------------- */

const BLUE = new THREE.Color(0.12, 0.45, 1.0);
const RED = new THREE.Color(1.0, 0.13, 0.18);

let mats: { shell: THREE.Material; blue: THREE.MeshStandardMaterial; red: THREE.MeshStandardMaterial } | null = null;
function phoneMats(): NonNullable<typeof mats> {
  mats ??= {
    shell: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.4 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x0a1630, emissive: BLUE, emissiveIntensity: 2, roughness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0x300a0c, emissive: RED, emissiveIntensity: 2, roughness: 0.3 }),
  };
  return mats;
}

/** a scanned head's size in its head bone's own space: the middle of the skull, half its width, its top */
interface HeadFit {
  c: THREE.Vector3;
  half: number;
  top: number;
}
const fits = new Map<string, HeadFit | null>();

/** measured once per scan, from the vertices its head bone carries */
export function headFit(mesh: THREE.SkinnedMesh, bone: number): HeadFit | null {
  const key = `${mesh.geometry.uuid}:${bone}`;
  if (fits.has(key)) return fits.get(key)!;
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  let fit: HeadFit | null = null;
  if (pos && si && sw) {
    const to = mesh.skeleton.boneInverses[bone].clone().multiply(mesh.bindMatrix);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bone) w += sw.getComponent(i, k);
      if (w < 0.6) continue;
      box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(to));
    }
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      // the head and neck: the ears sit about a third of the way down from the crown
      const top = box.max.y;
      const c = new THREE.Vector3((box.min.x + box.max.x) / 2, top - Math.min(size.y, 0.3) * 0.42, (box.min.z + box.max.z) / 2);
      fit = { c, half: Math.min(size.x, 0.24) / 2, top };
    }
  }
  fits.set(key, fit);
  return fit;
}

interface Worn {
  g: THREE.Group;
  leds: THREE.Mesh[];
  blue: boolean | null;
}
const worn = new WeakMap<object, Worn>();

/** the k-th regular's channel, as the crowd's shader picks it (a hash of who they are against blue's share) */
export function onBlue(k: number, share: number): boolean {
  const h = Math.sin(k * 12.9898 + 4.1414) * 43758.5453;
  return h - Math.floor(h) < share;
}

/** a pair sized to a head (in its bone's space) */
function phonesFor(fit: HeadFit): Worn {
  const m = phoneMats();
  const g = new THREE.Group();
  g.name = 'disco_phones';
  const rx = fit.half * 1.12;
  const ry = Math.max(rx, fit.top - fit.c.y + 0.012);
  g.position.copy(fit.c);
  g.add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.075, 4, 16, Math.PI).scale(rx, ry, 0.12), m.shell));
  const leds: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.038, 0.026, 12).rotateZ(Math.PI / 2), m.shell);
    cup.position.set(s * rx, 0, 0);
    const led = new THREE.Mesh(new THREE.RingGeometry(0.019, 0.032, 16).rotateY((s * Math.PI) / 2), m.blue);
    led.position.set(s * 0.0135, 0, 0);
    cup.add(led);
    leds.push(led);
    g.add(cup);
  }
  return { g, leds, blue: null };
}

/** a regular in headphones while a showdown runs (call each frame they're drawn, with their scanned body once it's in) */
export function discoPhones(who: object, k: number, body: THREE.Object3D | null): void {
  const on = discoUniforms.uDisco.value > 0.5;
  let w = worn.get(who);
  if (!on) {
    if (w) w.g.visible = false;
    return;
  }
  if (!w) {
    const mesh = body as THREE.SkinnedMesh | null;
    if (!mesh?.isSkinnedMesh) return;
    const i = mesh.skeleton.bones.findIndex((b) => b.name === 'head');
    const fit = i >= 0 ? headFit(mesh, i) : null;
    if (!fit) return;
    w = phonesFor(fit);
    mesh.skeleton.bones[i].add(w.g);
    worn.set(who, w);
  }
  w.g.visible = true;
  const blue = onBlue(k, discoUniforms.uDiscoBlue.value);
  if (blue !== w.blue) {
    w.blue = blue;
    const m = phoneMats();
    for (const l of w.leds) l.material = blue ? m.blue : m.red;
  }
}

/** the regulars' lights pulse on their channel's beat (with the crowd's: discoUniforms) */
export function pulseDiscoPhones(): void {
  if (!mats) return;
  const p = discoUniforms.uDiscoPulse.value;
  mats.blue.emissiveIntensity = 1.6 + 2.4 * p.x;
  mats.red.emissiveIntensity = 1.6 + 2.4 * p.y;
}
