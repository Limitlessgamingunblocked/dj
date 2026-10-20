/*
 * Fingers for a generated character's hands. The generators' rigs stop at the
 * wrist, so each hand comes as one rigid lump, its fingers sculpted straight
 * and spread: it can't relax, curl or hold anything. This finds the fingers
 * in the hand's own shape and gives them the body's finger joints:
 *   – distances over the hand's surface from the wrist: the fingertips are the
 *     five points furthest along it, each well apart from the others; the
 *     thumb's is the one nearest the wrist, the index the finger nearest it
 *   – distances from each fingertip: each point is on the finger it's the
 *     least share of the way down (each finger's length from tip to knuckle
 *     a share of the hand's, as people's are)
 *   – each finger's middle line (the middle of its rings of equal distance
 *     from the tip), drawn on to the knuckle
 *   – the character's palm turned over to face as the body's does (shared
 *     along the forearm), the body's hand turned to lie as the character's
 *     does, and each of its finger joints stood on the character's
 *   – each point of a finger skinned to its knuckle, middle or end joint by how
 *     far it is from the tip, blending into the hand round the knuckle
 * A hand whose fingers can't be told apart (a fist, a glove, too coarse a
 * mesh) is left as it was: one piece.
 */
import * as THREE from 'three';

const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;

/** a hand's points' new skins: point → [body bone, weight][] */
export type HandSkin = Map<number, [number, number][]>;

export interface HandReport {
  side: 'l' | 'r';
  ok: boolean;
  why?: string;
  /** hand length, then each finger's length from tip to knuckle (thumb first) */
  lengths?: number[];
  /** how far the character's hand was turned over to face as the body's does, and how far the
   * body's hand was then turned about its own length to lie as the character's does (degrees) */
  over?: number;
  roll?: number;
}

/**
 * Fit one hand: `geo` is the character's mesh in the body's space, `skinOn`
 * how much of a point the rig put on a body bone, `wrist`/`elbow` the
 * character's joints. Turns the character's forearm and hand over (its points,
 * in place), turns and moves the body's (posed) hand and finger bones onto
 * it, and fills `skin` with the hand's points' new weights.
 */
export function fitHand(
  side: 'l' | 'r',
  geo: THREE.BufferGeometry,
  skinOn: (i: number, bone: string) => number,
  wrist: THREE.Vector3,
  elbow: THREE.Vector3,
  bone: (name: string) => THREE.Bone | undefined,
  boneIndex: Map<string, number>,
  skin: HandSkin,
): HandReport {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const N = pos.count;

  /* ---------------- the hand's surface: points at the same place are one */
  const groupOf = new Int32Array(N).fill(-1);
  const at: THREE.Vector3[] = [];
  const members: number[][] = [];
  const key = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    if (skinOn(i, `hand_${side}`) < 0.5) continue;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
    let g = key.get(k);
    if (g === undefined) {
      key.set(k, (g = at.length));
      at.push(new THREE.Vector3(x, y, z));
      members.push([]);
    }
    groupOf[i] = g;
    members[g].push(i);
  }
  const G = at.length;
  if (G < 150) return { side, ok: false, why: `only ${G} points` };
  const near: Map<number, number>[] = Array.from({ length: G }, () => new Map());
  const idx = geo.getIndex();
  const tris = (idx ? idx.count : N) / 3;
  const vi = (t: number) => (idx ? idx.getX(t) : t);
  for (let t = 0; t < tris; t++) {
    const a = groupOf[vi(t * 3)];
    const b = groupOf[vi(t * 3 + 1)];
    const c = groupOf[vi(t * 3 + 2)];
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (x < 0 || y < 0 || x === y) continue;
      const d = at[x].distanceTo(at[y]);
      near[x].set(y, d);
      near[y].set(x, d);
    }
  }
  /** distances over the surface from `from` (with each one's starting distance) */
  const spread = (from: [number, number][]): Float64Array => {
    const d = new Float64Array(G).fill(Infinity);
    // (a plain binary heap of [distance, point])
    const heap: [number, number][] = [];
    const push = (e: [number, number]) => {
      heap.push(e);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    for (const [g, d0] of from) if (d0 < d[g]) push([(d[g] = d0), g]);
    while (heap.length) {
      const [dg, g] = pop();
      if (dg > d[g]) continue;
      for (const [h, e] of near[g]) if (dg + e < d[h]) push([(d[h] = dg + e), h]);
    }
    return d;
  };

  const hand = bone(`hand_${side}`);
  const mid1 = bone(`middle_01_${side}`);
  const idx1 = bone(`index_01_${side}`);
  const pin1 = bone(`pinky_01_${side}`);
  if (!hand || !mid1 || !idx1 || !pin1) return { side, ok: false, why: 'no finger bones' };
  const world = (b: THREE.Object3D) => {
    b.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  };
  /** turn bone `b` (in the world) by `turn`, its children with it */
  const turnBy = (b: THREE.Object3D, turn: THREE.Quaternion) => {
    const wq = b.getWorldQuaternion(new THREE.Quaternion());
    const pq = b.parent!.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(pq.invert().multiply(turn.clone().multiply(wq)));
    b.updateMatrixWorld(true);
  };
  /** stand bone `b` on world point `p` */
  const standOn = (b: THREE.Object3D, p: THREE.Vector3) => {
    b.parent!.updateWorldMatrix(true, false);
    b.position.copy(b.parent!.worldToLocal(p.clone()));
    b.updateMatrixWorld(true);
  };
  const flat = (axis: THREE.Vector3, v: THREE.Vector3) => v.sub(axis.clone().multiplyScalar(v.dot(axis))).normalize();

  /* ---------------- the character's palm turned over to face as the body's does */
  // (the generators stand their characters palms in, the body palms back: a quarter turn the game's
  // hand poses would otherwise show side on.) Which way the palm faces: the hand's widest way across
  // its length is across the knuckles. The turn is the way a forearm turns a hand over (the right
  // one way, the left the other), shared along it, nothing at the elbow and all of it at the wrist.
  const fore = wrist.clone().sub(elbow);
  const foreLen = fore.length();
  fore.normalize();
  const c = new THREE.Vector3();
  for (const p of at) c.add(p);
  c.multiplyScalar(1 / G);
  const e1 = flat(fore, new THREE.Vector3(1, 0, 0).cross(fore).lengthSq() > 0.1 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  const e2 = fore.clone().cross(e1);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of at) {
    const x = p.clone().sub(c).dot(e1);
    const y = p.clone().sub(c).dot(e2);
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  const wide = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const mine = e1.clone().multiplyScalar(Math.cos(wide)).add(e2.clone().multiplyScalar(Math.sin(wide)));
  const body = flat(fore, world(idx1).sub(world(pin1)));
  let over = mine.angleTo(body) * (mine.clone().cross(body).dot(fore) < 0 ? -1 : 1);
  // (a line across: the turn's either this or half a turn round from it)
  const sign = side === 'r' ? 1 : -1;
  if (over * sign < 0) over += sign * Math.PI;
  const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const wh = skinOn(i, `hand_${side}`);
    const wf = skinOn(i, `forearm_${side}`);
    if (wh + wf <= 0) continue;
    v.fromBufferAttribute(pos, i).sub(elbow);
    const u = Math.min(1, Math.max(0, v.dot(fore) / foreLen));
    q.setFromAxisAngle(fore, over * (wh + wf * u));
    v.applyQuaternion(q).add(elbow);
    pos.setXYZ(i, v.x, v.y, v.z);
    if (nor) {
      v.fromBufferAttribute(nor, i).applyQuaternion(q);
      nor.setXYZ(i, v.x, v.y, v.z);
    }
  }
  for (let g = 0; g < G; g++) at[g].fromBufferAttribute(pos, members[g][0]);
  const turned = { over: (over * 180) / Math.PI };

  /* ---------------- from the wrist: the fingertips */
  const along = elbow.clone().sub(wrist).negate().normalize();
  const pa = at.map((p) => p.clone().sub(wrist).dot(along));
  const minPa = Math.min(...pa);
  const fromWrist = spread(at.map((_, g) => [g, pa[g] - minPa] as [number, number]).filter(([g]) => pa[g] < minPa + 0.012));
  let reach = 0;
  for (let g = 0; g < G; g++) if (isFinite(fromWrist[g])) reach = Math.max(reach, fromWrist[g]);
  if (reach < 0.08 || reach > 0.3) return { side, ok: false, ...turned, why: `hand ${reach.toFixed(3)} long` };
  const order = [...Array(G).keys()].filter((g) => isFinite(fromWrist[g])).sort((a, b) => fromWrist[b] - fromWrist[a]);
  const tips: number[] = [];
  const fromTip: Float64Array[] = [];
  for (const g of order) {
    if (fromWrist[g] < reach * 0.45 || tips.length === 5) break;
    // only the end of something (nothing next to it further out), and not further down a finger
    // already found (fingertips can touch, so not just anywhere near another tip)
    let end = true;
    for (const h of near[g].keys()) if (fromWrist[h] > fromWrist[g]) end = false;
    if (!end || fromTip.some((d, k) => d[g] < fromWrist[tips[k]] - fromWrist[g] + reach * 0.06)) continue;
    tips.push(g);
    fromTip.push(spread([[g, 0]]));
  }
  if (tips.length < 5) return { side, ok: false, ...turned, why: `${tips.length} fingertips` };

  // the thumb's tip is the one nearest the wrist; the index the finger nearest the thumb; then across the hand
  const t = [0, 1, 2, 3, 4].sort((a, b) => pa[tips[a]] - pa[tips[b]])[0];
  const rest = [0, 1, 2, 3, 4].filter((i) => i !== t);
  const index = rest.reduce((a, b) => (fromTip[t][tips[a]] < fromTip[t][tips[b]] ? a : b));
  const tipMid = new THREE.Vector3();
  for (const i of rest) tipMid.add(at[tips[i]]);
  tipMid.multiplyScalar(0.25);
  const across = at[tips[index]].clone().sub(tipMid);
  across.sub(along.clone().multiplyScalar(across.dot(along))).normalize();
  rest.sort((a, b) => at[tips[b]].dot(across) - at[tips[a]].dot(across));
  if (rest[0] !== index) return { side, ok: false, ...turned, why: 'index not next to the thumb' };
  if (at[tips[t]].clone().sub(tipMid).dot(across) < at[tips[index]].clone().sub(tipMid).dot(across) * 0.5) return { side, ok: false, ...turned, why: 'thumb not by the index' };
  const fingers = [t, ...rest]; // thumb, index, middle, ring, pinky

  /* ---------------- each finger's length from tip to knuckle, and its points */
  // (a hand's own proportions, by its length: the webs can't be measured where fingertips touch)
  const len = [0.34, 0.43, 0.46, 0.44, 0.36].map((k) => k * reach);
  // the finger each point is on: the one it's the least share of the way down
  const owner = new Int8Array(G);
  const share = new Float64Array(G).fill(Infinity);
  for (let g = 0; g < G; g++)
    fingers.forEach((tipOf, f) => {
      const u = fromTip[tipOf][g] / len[f];
      if (u < share[g]) [share[g], owner[g]] = [u, f];
    });

  /** the middle of a finger's ring of points `s` from its tip (on the free part only; past it, drawn on straight) */
  const line = (f: number): ((s: number) => THREE.Vector3) => {
    const d = fromTip[fingers[f]];
    const pts: [number, THREE.Vector3][] = [];
    const step = len[f] / 10;
    for (let s = step; s < len[f] * 0.75; s += step) {
      const c = new THREE.Vector3();
      let n = 0;
      for (let g = 0; g < G; g++)
        if (owner[g] === f && Math.abs(d[g] - s) < step / 2) {
          c.add(at[g]);
          n++;
        }
      if (n) pts.push([s, c.multiplyScalar(1 / n)]);
    }
    const tip = at[tips[fingers[f]]].clone();
    // the line through the rings (least squares, by distance from the tip)
    const sm = pts.reduce((a, [s]) => a + s, 0) / pts.length;
    const pm = pts.reduce((a, [, p]) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    const dir = new THREE.Vector3();
    let ss = 0;
    for (const [s, p] of pts) {
      dir.add(p.clone().sub(pm).multiplyScalar(s - sm));
      ss += (s - sm) ** 2;
    }
    if (pts.length < 3 || ss === 0) return (s) => tip.clone().add(along.clone().multiplyScalar(-s));
    dir.multiplyScalar(1 / ss);
    return (s) => (s <= pts[0][0] ? tip.clone().lerp(pts[0][1], s / pts[0][0]) : pm.clone().add(dir.clone().multiplyScalar(s - sm)));
  };
  const lines = fingers.map((_, f) => line(f));
  // where each joint sits, as a share of the finger's length from the tip: end, middle, knuckle
  const JOINT = [0.27, 0.55, 1];
  const THUMB = [0.45, 1];

  /* ---------------- the body's hand laid along the character's */
  const knuckle = (f: number) => lines[f](len[f]);
  const w0 = world(hand);
  // (fingers found wrong would have their knuckles across some other way than the palm's)
  const off = flat(fore, knuckle(1).sub(knuckle(4))).angleTo(body);
  if (off > 0.6) return { side, ok: false, ...turned, why: `knuckles ${Math.round((off * 180) / Math.PI)}° off the palm` };
  turnBy(hand, new THREE.Quaternion().setFromUnitVectors(world(mid1).sub(w0).normalize(), knuckle(2).sub(w0).normalize()));
  // then about that line, so the knuckles run across the same way
  const axis = knuckle(2).sub(w0).normalize();
  const roll = new THREE.Quaternion().setFromUnitVectors(flat(axis, world(idx1).sub(world(pin1))), flat(axis, knuckle(1).sub(knuckle(4))));
  turnBy(hand, roll);

  // each finger's joints on the character's, each bone pointing at the next joint
  const chain = (names: string[], joints: THREE.Vector3[], tip: THREE.Vector3, stand: boolean[]) => {
    names.forEach((n, j) => {
      const b = bone(n)!;
      if (stand[j]) standOn(b, joints[j]);
      const next = j + 1 < names.length ? joints[j + 1] : tip;
      const child = j + 1 < names.length ? bone(names[j + 1])! : null;
      const from = child ? world(child).sub(world(b)) : new THREE.Vector3(0, 1, 0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()));
      turnBy(b, new THREE.Quaternion().setFromUnitVectors(from.normalize(), next.clone().sub(world(b)).normalize()));
    });
  };
  FINGERS.forEach((name, k) => {
    const f = k + 1;
    const names = ['01', '02', '03'].map((s) => `${name}_${s}_${side}`);
    if (names.some((n) => !bone(n))) return;
    chain(names, [lines[f](len[f]), lines[f](len[f] * JOINT[1]), lines[f](len[f] * JOINT[0])], at[tips[fingers[f]]], [true, true, true]);
  });
  const thumbNames = ['01', '02', '03'].map((s) => `thumb_${s}_${side}`);
  if (thumbNames.every((n) => bone(n))) {
    // (its root stays the body's, deep in the palm)
    chain(thumbNames, [world(bone(thumbNames[0])!), lines[0](len[0]), lines[0](len[0] * THUMB[0])], at[tips[fingers[0]]], [false, true, true]);
  }

  /* ---------------- the skin: each finger's points by their distance from its tip */
  const ix = (n: string) => boneIndex.get(n)!;
  const ease = (a: number, b: number, x: number) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  for (let g = 0; g < G; g++) {
    const best = owner[g];
    if (share[g] > 1.2) continue;
    const ws: [number, number][] = [];
    const toHand = ease(0.92, 1.2, share[g]);
    if (best === 0) {
      const tw = 1 - toHand;
      const end = 1 - ease(THUMB[0] - 0.08, THUMB[0] + 0.08, share[g]);
      ws.push([ix(thumbNames[2]), tw * end], [ix(thumbNames[1]), tw * (1 - end) * (1 - ease(0.9, 1.1, share[g]))], [ix(thumbNames[0]), tw * (1 - end) * ease(0.9, 1.1, share[g])]);
    } else {
      const name = FINGERS[best - 1];
      const tw = 1 - toHand;
      const e = 1 - ease(JOINT[0] - 0.05, JOINT[0] + 0.05, share[g]); // end
      const m = (1 - e) * (1 - ease(JOINT[1] - 0.06, JOINT[1] + 0.06, share[g])); // middle
      ws.push([ix(`${name}_03_${side}`), tw * e], [ix(`${name}_02_${side}`), tw * m], [ix(`${name}_01_${side}`), tw * (1 - e - m)]);
    }
    ws.push([ix(`hand_${side}`), toHand]);
    const kept = ws.filter(([, w]) => w > 1e-4);
    for (const i of members[g]) skin.set(i, kept);
  }
  return { side, ok: true, lengths: [reach, ...len], ...turned, roll: (2 * Math.acos(Math.min(1, Math.abs(roll.w))) * 180) / Math.PI };
}
