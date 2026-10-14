/*
 * The bodies of the show fixtures: the hardware the light comes out of, so a
 * rig reads as real machines when the camera gets close. Every builder returns
 * a cached geometry in the fixture's own frame, ready to instance:
 *   movingHead  a base with an omega bracket and safety loop, a yoke that pans,
 *               a head that tilts (bezel, cooling rings, tilt hubs), and the
 *               pixel ring round the lens
 *   strobeBar   a bare tube in a frame with end caps and mounting tabs, lit
 *               from every side (venues hang strobes at all sorts of angles)
 *   blinder     a two-lamp housing on a yoke bracket with cooling fins, and the
 *               lamps: a bulb face in a reflector bowl
 * A hanging moving head's frame: the pivot of the tilt at the origin, the lens
 * at y −0.17 (the beam starts there), the yoke and base above it.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bevelBox } from '../bevel';

/** non-indexed, position/normal/uv only (and colour when asked), merged */
export function mergeParts(parts: THREE.BufferGeometry[], color?: (i: number) => THREE.Color): THREE.BufferGeometry {
  const flat = parts.map((p, i) => {
    const g = p.index ? p.toNonIndexed() : p;
    if (g !== p) p.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (color) {
      const c = color(i);
      const n = g.attributes.position.count;
      const a = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) a.set([c.r, c.g, c.b], v * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    g.clearGroups();
    return g;
  });
  const out = mergeGeometries(flat)!;
  for (const g of flat) g.dispose();
  return out;
}

const Y = new THREE.Vector3(0, 1, 0);

/** a cylinder from a to b */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8, r2 = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r2, r, a.distanceTo(b), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/* ------------------------------------------------------------------ */
/* moving head                                                          */
/* ------------------------------------------------------------------ */

export interface MovingHeadGeometry {
  /** fixed to the rig: base, omega bracket, safety loop */
  base: THREE.BufferGeometry;
  /** turns with the pan: the U of the yoke and the pan bearing */
  yoke: THREE.BufferGeometry;
  /** turns with the pan and the tilt: the head itself */
  head: THREE.BufferGeometry;
  /** the pixel ring round the lens: sixteen cells, a comet of brightness (vertex colour) to spin */
  ring: THREE.BufferGeometry;
}

/** where the lens sits on the head (the beam starts a little beyond) */
export const LENS_Y = -0.165;
const HEAD_R = 0.12;

let headCache: MovingHeadGeometry | null = null;
export function movingHead(): MovingHeadGeometry {
  if (headCache) return headCache;
  // the base: a housing with a front panel, handles each side, the omega bracket and safety loop on top
  const base: THREE.BufferGeometry[] = [
    bevelBox(0.34, 0.08, 0.28, 0.018).translate(0, 0.25, 0),
    // the display and buttons panel on the front, inset a touch
    bevelBox(0.12, 0.04, 0.012, 0.004).translate(-0.06, 0.25, -0.143),
    ...[-0.02, 0.01, 0.04].map((x) => new THREE.CylinderGeometry(0.006, 0.006, 0.01, 6, 1, true).rotateX(Math.PI / 2).translate(0.06 + x, 0.25, -0.143)),
    // the bracket: a bar across the top, two quarter-turn cams
    bevelBox(0.07, 0.012, 0.3, 0.004).translate(0, 0.296, 0),
    ...[-0.1, 0.1].map((z) => new THREE.CylinderGeometry(0.018, 0.018, 0.018, 8).translate(0, 0.31, z)),
    // the safety cable: a loop up to the rig
    new THREE.TorusGeometry(0.03, 0.003, 3, 10).translate(0.09, 0.33, 0),
  ];
  for (const s of [-1, 1]) {
    // a carry handle on each side
    base.push(new THREE.TorusGeometry(0.04, 0.008, 4, 8, Math.PI).rotateX(Math.PI / 2).rotateY((s * Math.PI) / 2).translate(s * 0.17, 0.25, 0));
  }
  // the yoke: a crossbar under the base, the pan bearing, two arms down to the tilt hubs
  const yoke: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(0.075, 0.075, 0.025, 16).translate(0, 0.198, 0),
    bevelBox(0.36, 0.03, 0.1, 0.01).translate(0, 0.175, 0),
  ];
  for (const s of [-1, 1]) {
    const x = s * (HEAD_R + 0.037);
    yoke.push(bevelBox(0.034, 0.2, 0.1, 0.01).translate(x, 0.075, 0));
    // the arm's rounded foot round the hub
    yoke.push(new THREE.CylinderGeometry(0.05, 0.05, 0.034, 14).rotateZ(Math.PI / 2).translate(x, 0, 0));
    // a cover plate on the outside, where the tilt motor sits
    yoke.push(new THREE.CylinderGeometry(0.036, 0.036, 0.006, 10, 1, true).rotateZ(Math.PI / 2).translate(x + s * 0.019, 0, 0));
  }
  // the head: a can, a rounded back, cooling rings, the bezel round the lens, tilt hubs into the arms
  const head: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(HEAD_R - 0.012, HEAD_R, 0.2, 20, 1, true).translate(0, -0.06, 0),
    new THREE.SphereGeometry(HEAD_R - 0.012, 20, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.32, 1).translate(0, 0.04, 0),
    new THREE.TorusGeometry(HEAD_R - 0.003, 0.012, 4, 24).rotateX(Math.PI / 2).translate(0, -0.158, 0),
    ...[-0.11, -0.075, -0.04].map((y) => new THREE.TorusGeometry(HEAD_R + 0.001 - (y + 0.16) * 0.06, 0.0045, 3, 20).rotateX(Math.PI / 2).translate(0, y, 0)),
    // the dark throat behind the lens, so the face isn't hollow from the side
    new THREE.CircleGeometry(HEAD_R - 0.004, 20).rotateX(Math.PI / 2).translate(0, -0.152, 0),
    new THREE.CylinderGeometry(0.042, 0.042, 2 * (HEAD_R + 0.02), 12, 1, true).rotateZ(Math.PI / 2),
    // a little handle on the back of the head
    rod(new THREE.Vector3(-0.04, 0.072, 0.03), new THREE.Vector3(0.04, 0.072, 0.03), 0.007, 6),
  ];
  // the pixel ring: cells between the lens and the bezel, brightest at the head of the comet
  const ring: THREE.BufferGeometry[] = [];
  const cells = 16;
  for (let k = 0; k < cells; k++) {
    const a = (k / cells) * Math.PI * 2;
    ring.push(
      new THREE.RingGeometry(0.1, 0.113, 2, 1, a + 0.03, (Math.PI * 2) / cells - 0.06)
        .rotateX(Math.PI / 2)
        .translate(0, LENS_Y - 0.004, 0),
    );
  }
  const shade = (i: number) => {
    const v = 0.08 + 0.92 * Math.pow(i / (cells - 1), 2.2);
    return new THREE.Color(v, v, v);
  };
  headCache = { base: mergeParts(base), yoke: mergeParts(yoke), head: mergeParts(head), ring: mergeParts(ring, shade) };
  return headCache;
}

/* ------------------------------------------------------------------ */
/* strobe bar                                                           */
/* ------------------------------------------------------------------ */

const strobeCache = new Map<string, { frame: THREE.BufferGeometry; tube: THREE.BufferGeometry }>();

/** a bar strobe `size` = [length, height, depth]: a bare tube between end caps, two guard rods, mounting tabs */
export function strobeBar(size: [number, number, number]): { frame: THREE.BufferGeometry; tube: THREE.BufferGeometry } {
  const key = size.map((v) => v.toFixed(3)).join(':');
  const hit = strobeCache.get(key);
  if (hit) return hit;
  const [w, h, d] = size;
  const cap = Math.min(0.05, w * 0.08);
  const tubeR = Math.min(h, d) * 0.3;
  const x0 = -w / 2 + cap;
  const x1 = w / 2 - cap;
  const frame: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    frame.push(bevelBox(cap, h, d).translate(s * (w / 2 - cap / 2), 0, 0));
    // a mounting tab off each end
    frame.push(bevelBox(cap * 0.6, h * 0.5, 0.008, 0.002).translate(s * (w / 2 + cap * 0.25), 0, 0));
    // the tube's sockets
    frame.push(new THREE.CylinderGeometry(tubeR * 1.5, tubeR * 1.5, cap * 0.4, 12).rotateZ(Math.PI / 2).translate(s * (w / 2 - cap - cap * 0.2), 0, 0));
  }
  // two thin guard rods along the tube, top and bottom
  for (const y of [-1, 1]) frame.push(rod(new THREE.Vector3(x0, (y * h) / 2 - y * 0.008, 0), new THREE.Vector3(x1, (y * h) / 2 - y * 0.008, 0), 0.0045, 6));
  const tube = new THREE.CylinderGeometry(tubeR, tubeR, x1 - x0 - cap * 0.6, 14).rotateZ(Math.PI / 2);
  const out = { frame: mergeParts(frame), tube: mergeParts([tube]) };
  strobeCache.set(key, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* blinder                                                              */
/* ------------------------------------------------------------------ */

let blinderCache: { body: THREE.BufferGeometry; lamp: THREE.BufferGeometry } | null = null;

/** a two-lamp blinder facing −Z: the housing on a yoke bracket, and one lamp (bulb in a bowl) to instance twice */
export function blinder(): { body: THREE.BufferGeometry; lamp: THREE.BufferGeometry } {
  if (blinderCache) return blinderCache;
  const body: THREE.BufferGeometry[] = [bevelBox(0.5, 0.26, 0.12, 0.02).translate(0, 0, 0.01)];
  // cooling fins down the back
  for (let i = 0; i < 7; i++) body.push(new THREE.BoxGeometry(0.008, 0.2, 0.03).translate(-0.18 + i * 0.06, 0, 0.085));
  // the yoke: side plates, a bar round the back, knobs where it pivots
  for (const s of [-1, 1]) {
    body.push(bevelBox(0.012, 0.16, 0.06, 0.003).translate(s * 0.262, -0.02, 0.01));
    body.push(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 10).rotateZ(Math.PI / 2).translate(s * 0.276, 0, 0.01));
    body.push(bevelBox(0.012, 0.03, 0.14, 0.003).translate(s * 0.262, -0.11, 0.07));
  }
  body.push(bevelBox(0.536, 0.03, 0.012, 0.003).translate(0, -0.11, 0.14));
  // the front rims the lamps sit in
  for (const x of [-0.12, 0.12]) body.push(new THREE.TorusGeometry(0.104, 0.008, 3, 20).translate(x, 0, -0.083));
  // a lamp (centred on its spot): the bulb's face at the back of a reflector bowl standing
  // proud of the housing's front (vertex colour: the bowl glows less than the bulb)
  const bulb = new THREE.CircleGeometry(0.05, 18).rotateY(Math.PI).translate(0, 0, -0.051);
  const bowl = new THREE.CylinderGeometry(0.1, 0.05, 0.035, 22, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.0675);
  const lamp = mergeParts([bulb, bowl], (i) => (i === 0 ? new THREE.Color(1, 1, 1) : new THREE.Color(0.42, 0.42, 0.42)));
  blinderCache = { body: mergeParts(body), lamp };
  return blinderCache;
}

/* ------------------------------------------------------------------ */
/* truss cable loom                                                     */
/* ------------------------------------------------------------------ */

/** the cables taped along a truss's bottom chord (local frame of trussGeometry: run along +Y) */
export function trussLoom(len: number, size: number): THREE.BufferGeometry[] {
  const h = size / 2 - size * 0.06;
  const chordR = size * 0.075;
  const y0 = -len / 2 + size * 0.2;
  const y1 = len / 2 - size * 0.2;
  if (y1 - y0 < 0.3) return [];
  const parts: THREE.BufferGeometry[] = [];
  // two cables, a fat power feed and a thin data line, inside the chord
  const at = (r: number, off: number) => new THREE.Vector3(-h + chordR + r + off, 0, -h + chordR + r);
  const power = at(size * 0.04, 0);
  const data = at(size * 0.022, size * 0.075);
  parts.push(rod(power.clone().setY(y0), power.clone().setY(y1), size * 0.04, 6));
  parts.push(rod(data.clone().setY(y0), data.clone().setY(y1), size * 0.022, 5));
  // ties round the chord and the cables every half metre
  const ties = Math.max(2, Math.round((y1 - y0) / 0.5));
  for (let i = 0; i <= ties; i++) {
    const y = y0 + ((y1 - y0) * i) / ties;
    parts.push(new THREE.TorusGeometry(chordR + size * 0.06, size * 0.006, 3, 10).rotateX(Math.PI / 2).translate(-h + size * 0.05, y, -h + size * 0.02));
  }
  return parts;
}
