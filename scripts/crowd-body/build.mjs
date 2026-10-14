/*
 * Builds the crowd's body (src/three/venues/crowdbody.data.ts) from the
 * MakeHuman base mesh, skeleton weights and shape targets (all CC0).
 *
 *   MH_DIR=/path/to/makehuman-data node scripts/crowd-body/build.mjs
 *
 * MH_DIR holds base.obj (data/3dobjs), default.mhskel and
 * default_weights.mhw (data/rigs) from the makehuman repository, and
 * targets.npz from the makehuman 1.x package (data/targets.npz).
 *
 * What it does:
 *   – the shapes: a young adult man of mixed ancestry is the base; a woman, a
 *     heavier/slimmer build, a more/less muscular build and African and East
 *     Asian features are each stored as offsets from it (positions and, for
 *     the big ones, normals), so the crowd shader can mix a different person
 *     for every instance
 *   – every shape is reposed from MakeHuman's A-pose into the crowd's rest
 *     pose (arms hanging, legs straight, feet flat) and scaled to 1.75 m;
 *     the groin is smoothed flat, as clothes would hold it
 *   – the skeleton's weights become the crowd's 11 rigid bones plus a blend:
 *     each vertex names the bone it follows and how much of that bone's own
 *     joint turn it takes, so shoulders, elbows, knees and the neck bend
 *     smoothly instead of hinging
 *   – one vertex set, three triangle lists (the front row's close-up, the
 *     crowd's near and far models), simplified with meshoptimizer with the
 *     face given priority over the hands
 */
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';
import { dense, loadMH } from './mh.mjs';

const dir = process.env.MH_DIR ?? process.argv[2];
if (!dir) throw new Error('set MH_DIR to the MakeHuman data folder');
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/three/venues/crowdbody.data.ts');
const HEIGHT = 1.75;
/* the triangle budgets of the three levels of detail */
const LOD_TRIS = [5600, 4200, 1050];

const mh = loadMH(dir);
const N = mh.obj.pos.length / 3;

/* ------------------------------------------------------------------ the mesh */

const bodyTris = [];
const eyeTris = [];
for (const f of mh.obj.faces) {
  const list = f.group === 'body' ? bodyTris : f.group === 'helper-l-eye' || f.group === 'helper-r-eye' ? eyeTris : null;
  if (!list) continue;
  for (let k = 1; k + 1 < f.v.length; k++) list.push(f.v[0], f.v[k], f.v[k + 1]);
}
const bodyVerts = new Set(bodyTris);

/* ------------------------------------------------------------------ weights */

const W = {};
for (const [bone, list] of Object.entries(mh.weights)) {
  const a = (W[bone] = new Float64Array(N));
  for (const [v, w] of list) a[v] = w;
}
const bones = Object.keys(W);
const sum = (pred) => {
  const out = new Float64Array(N);
  for (const b of bones) {
    const k = pred(b);
    if (!k) continue;
    const a = W[b];
    for (let i = 0; i < N; i++) out[i] += a[i] * k;
  }
  return out;
};
const side = (b, s) => b.endsWith(`.${s}`);
const isFore = (b) => /^(lowerarm|wrist|metacarpal|finger)/.test(b);
const isArm = (b) => /^(upperarm|lowerarm|wrist|metacarpal|finger)/.test(b);
const isLeg = (b) => /^(upperleg|lowerleg|foot|toe)/.test(b);
const isShin = (b) => /^(lowerleg|foot|toe)/.test(b);
const isFoot = (b) => /^(foot|toe)/.test(b);

/* ------------------------------------------------------------------ maths */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** the rotation (axis, angle) taking direction a to direction b */
function fromTo(a, b) {
  a = norm(a);
  b = norm(b);
  const ax = cross(a, b);
  const s = len(ax);
  return { axis: s > 1e-9 ? [ax[0] / s, ax[1] / s, ax[2] / s] : [1, 0, 0], angle: Math.atan2(s, dot(a, b)) };
}
/** rotate v about a unit axis by an angle (Rodrigues) */
function rot(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = dot(axis, v) * (1 - c);
  const x = cross(axis, v);
  return [v[0] * c + x[0] * s + axis[0] * k, v[1] * c + x[1] * s + axis[1] * k, v[2] * c + x[2] * s + axis[2] * k];
}
const get = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
const set = (P, i, v) => {
  P[i * 3] = v[0];
  P[i * 3 + 1] = v[1];
  P[i * 3 + 2] = v[2];
};
function joint(P, name) {
  const idx = mh.skel.joints[name];
  const s = [0, 0, 0];
  for (const i of idx) for (let k = 0; k < 3; k++) s[k] += P[i * 3 + k] / idx.length;
  return s;
}
const head = (P, bone) => joint(P, `${bone}____head`);

/* ------------------------------------------------------------------ shapes */

const T = (k) => {
  if (!mh.targets[k]) throw new Error(`no target ${k}`);
  return dense(mh.targets[k], N);
};
const RACES = ['african', 'asian', 'caucasian'];
/** a person: gender 'male' | 'female', race weights, build (-1 slim .. 1 heavy), muscle (-1 .. 1) */
function shape({ gender, race = [1 / 3, 1 / 3, 1 / 3], build = 0, muscle = 0 }) {
  const P = Float64Array.from(mh.obj.pos);
  const add = (t, k) => {
    if (!k) return;
    for (let i = 0; i < P.length; i++) P[i] += t[i] * k;
  };
  RACES.forEach((r, i) => add(T(`${r}-${gender}-young`), race[i]));
  if (build) add(T(`universal-${gender}-young-averagemuscle-${build > 0 ? 'max' : 'min'}weight`), Math.abs(build));
  if (muscle) add(T(`universal-${gender}-young-${muscle > 0 ? 'max' : 'min'}muscle-averageweight`), Math.abs(muscle));
  return relax(smoothCrotch(repose(P)));
}

/*
 * A friendly, relaxed face: MakeHuman's base face is blank. The corners of
 * the mouth are lifted and drawn back into a soft smile, the cheeks rising a
 * touch with it.
 */
let ORIS = null;
function relax(P) {
  ORIS ??= sum((b) => (b.startsWith('oris') ? 1 : 0));
  let lo = Infinity;
  let hi = -Infinity;
  let w = 0;
  let zf = -Infinity;
  for (const i of bodyVerts) {
    if (ORIS[i] <= 0.45) continue;
    lo = Math.min(lo, P[i * 3 + 1]);
    hi = Math.max(hi, P[i * 3 + 1]);
    w = Math.max(w, P[i * 3]);
    zf = Math.max(zf, P[i * 3 + 2]);
  }
  const my = (lo + hi) / 2;
  for (const i of bodyVerts) {
    const x = P[i * 3];
    const y = P[i * 3 + 1];
    const z = P[i * 3 + 2];
    if (z < zf - 0.05 || Math.abs(y - my) > 0.05 || Math.abs(x) > w + 0.04) continue;
    const ax = Math.abs(x);
    // (the lips are closed by the crowd shader: the line between them is drawn facing forward)
    const dz = 0;
    // the corners up and back, a little wider
    const c = Math.exp(-(((ax - w * 0.92) / 0.011) ** 2) - ((y - my) / 0.011) ** 2);
    // the cheeks lift with the smile
    const ck = Math.exp(-(((ax - w - 0.012) / 0.016) ** 2) - ((y - my - 0.022) / 0.014) ** 2);
    P[i * 3] += Math.sign(x) * 0.0012 * c;
    P[i * 3 + 1] += 0.003 * c + 0.0016 * ck;
    P[i * 3 + 2] += dz - 0.0012 * c + 0.0012 * ck;
  }
  return P;
}

/* everyone is dressed: the groin is smoothed flat, as trousers and shorts would hold it */
const NEIGH = (() => {
  const n = Array.from({ length: N }, () => new Set());
  for (let t = 0; t < bodyTris.length; t += 3) {
    const [a, b, c] = [bodyTris[t], bodyTris[t + 1], bodyTris[t + 2]];
    n[a].add(b).add(c);
    n[b].add(a).add(c);
    n[c].add(a).add(b);
  }
  return n.map((s) => [...s]);
})();
function smoothCrotch(P) {
  const hy = (P.joints.hipL[1] + P.joints.hipR[1]) / 2;
  const wt = new Float64Array(N);
  const zone = [];
  for (const i of bodyVerts) {
    const [x, y] = [P[i * 3], P[i * 3 + 1]];
    const w = Math.max(0, 1 - Math.abs(x) / 0.085) * Math.max(0, 1 - Math.abs(y - (hy - 0.07)) / 0.13);
    if (w > 0) {
      wt[i] = Math.min(1, w * 2);
      zone.push(i);
    }
  }
  for (let it = 0; it < 30; it++) {
    const Q = Float64Array.from(P);
    for (const i of zone) {
      const nb = NEIGH[i];
      if (!nb.length) continue;
      for (let c = 0; c < 3; c++) {
        let m = 0;
        for (const j of nb) m += Q[j * 3 + c];
        P[i * 3 + c] += (m / nb.length - Q[i * 3 + c]) * 0.5 * wt[i];
      }
    }
  }
  return P;
}

/* the arms hang a little out from the sides, the legs straight down */
const ARM_OUT = 0.07;

/**
 * From MakeHuman's A-pose to the crowd's rest pose: each arm turned down
 * about the shoulder, the forearm straightened under it; each leg turned in
 * under the hip, the shin under the knee, the foot turned back flat. Weighted
 * vertices turn by their share of the angle, so the joints bend smoothly.
 * Then into metres, feet on the floor, scaled to the crowd's height.
 */
function repose(P0) {
  const P = Float64Array.from(P0);
  const jt = {};
  for (const s of ['L', 'R']) {
    const sd = Math.sign(head(P0, `upperarm01.${s}`)[0]);
    // arms
    {
      const a = sum((b) => (side(b, s) && isArm(b) ? 1 : side(b, s) && b.startsWith('shoulder01') ? 0.5 : 0));
      const fw = sum((b) => (side(b, s) && isFore(b) ? 1 : 0));
      const S = head(P, `upperarm01.${s}`);
      const E = head(P, `lowerarm01.${s}`);
      const Wr = head(P, `wrist.${s}`);
      const down = [sd * Math.sin(ARM_OUT), -Math.cos(ARM_OUT), 0];
      const r1 = fromTo(sub(E, S), down);
      const E1 = add3(S, rot(sub(E, S), r1.axis, r1.angle));
      const W1 = add3(S, rot(sub(Wr, S), r1.axis, r1.angle));
      const r2 = fromTo(sub(W1, E1), down);
      for (let i = 0; i < N; i++) {
        if (!a[i] && !fw[i]) continue;
        let v = get(P, i);
        v = add3(S, rot(sub(v, S), r1.axis, r1.angle * Math.min(1, a[i])));
        if (fw[i]) v = add3(E1, rot(sub(v, E1), r2.axis, r2.angle * Math.min(1, fw[i])));
        set(P, i, v);
      }
      jt[`shoulder${s}`] = S;
      jt[`elbow${s}`] = E1;
      jt[`wrist${s}`] = add3(E1, rot(sub(W1, E1), r2.axis, r2.angle));
      // the fingers relax into a soft curl towards the palm (which faces the thigh)
      const armT = (v) => add3(E1, rot(sub(add3(S, rot(sub(v, S), r1.axis, r1.angle)), E1), r2.axis, r2.angle));
      const palm = [-sd, 0, 0.25];
      for (let f = 1; f <= 5; f++) {
        const curl = f === 1 ? [0.15, 0.2, 0.2] : [0.3 + 0.05 * f, 0.5 + 0.04 * f, 0.35];
        const names = [1, 2, 3].map((k) => `finger${f}-${k}.${s}`);
        const ws = names.map((_, k) => sum((b) => (names.slice(k).includes(b) ? 1 : 0)));
        let js = names.map((nm) => armT(head(P0, nm)));
        const tip = armT(joint(P0, `${names[2]}____tail`));
        for (let k = 0; k < 3; k++) {
          const dir = norm(sub(k < 2 ? js[k + 1] : tip, js[k]));
          const axis = norm(cross(dir, palm));
          const piv = js[k];
          for (let i = 0; i < N; i++) {
            if (!ws[k][i]) continue;
            set(P, i, add3(piv, rot(sub(get(P, i), piv), axis, curl[k] * Math.min(1, ws[k][i]))));
          }
          // the joints further out turn with it
          js = js.map((j, m) => (m > k ? add3(piv, rot(sub(j, piv), axis, curl[k])) : j));
        }
      }
    }
    // legs
    {
      const t = sum((b) => (side(b, s) && isLeg(b) ? 1 : 0));
      const sh = sum((b) => (side(b, s) && isShin(b) ? 1 : 0));
      const ft = sum((b) => (side(b, s) && isFoot(b) ? 1 : 0));
      const H = head(P, `upperleg01.${s}`);
      const K = head(P, `lowerleg01.${s}`);
      const A = head(P, `foot.${s}`);
      const down = [0, -1, 0];
      const r1 = fromTo(sub(K, H), down);
      const K1 = add3(H, rot(sub(K, H), r1.axis, r1.angle));
      const A1 = add3(H, rot(sub(A, H), r1.axis, r1.angle));
      const r2 = fromTo(sub(A1, K1), down);
      const A2 = add3(K1, rot(sub(A1, K1), r2.axis, r2.angle));
      jt[`hip${s}`] = H;
      jt[`knee${s}`] = K1;
      jt[`ankle${s}`] = A2;
      for (let i = 0; i < N; i++) {
        if (!t[i]) continue;
        let v = get(P, i);
        v = add3(H, rot(sub(v, H), r1.axis, r1.angle * Math.min(1, t[i])));
        if (sh[i]) v = add3(K1, rot(sub(v, K1), r2.axis, r2.angle * Math.min(1, sh[i])));
        if (ft[i]) {
          // the foot keeps its own orientation: undo the leg's turn about the ankle
          v = add3(A2, rot(sub(v, A2), r2.axis, -r2.angle * Math.min(1, ft[i])));
          v = add3(A2, rot(sub(v, A2), r1.axis, -r1.angle * Math.min(1, ft[i])));
        }
        set(P, i, v);
      }
    }
  }
  // metres, feet on the floor, scaled to height
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const i of bodyVerts) {
    y0 = Math.min(y0, P[i * 3 + 1]);
    y1 = Math.max(y1, P[i * 3 + 1]);
  }
  const k = HEIGHT / (y1 - y0);
  for (let i = 0; i < N; i++) {
    P[i * 3] *= k;
    P[i * 3 + 1] = (P[i * 3 + 1] - y0) * k;
    P[i * 3 + 2] *= k;
  }
  // the joints, through the same turns and into the same space (the ones that didn't move are read off the mesh)
  for (const name of ['neck01', 'head']) jt[name] = head(P0, name);
  for (const s of ['L', 'R']) jt[`eye${s}`] = head(P0, `eye.${s}`);
  const J = {};
  for (const [name, v] of Object.entries(jt)) J[name] = [v[0] * k, (v[1] - y0) * k, v[2] * k];
  P.joints = J;
  return P;
}
function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/* ------------------------------------------------------------------ the people */

const male = shape({ gender: 'male' });
const female = shape({ gender: 'female' });
const avg = (fn) => {
  const a = fn('male');
  const b = fn('female');
  return a.map((v, i) => (v + b[i]) / 2);
};
const base = { male, female };
const diff = (a, b) => a.map((v, i) => v - b[i]);
const D = {
  female: diff(female, male),
  build: avg((g) => diff(shape({ gender: g, build: 1 }), shape({ gender: g, build: -1 })).map((v) => v / 2)),
  muscle: avg((g) => diff(shape({ gender: g, muscle: 1 }), shape({ gender: g, muscle: -1 })).map((v) => v / 2)),
  african: avg((g) => diff(shape({ gender: g, race: [1, 0, 0] }), base[g])),
  asian: avg((g) => diff(shape({ gender: g, race: [0, 1, 0] }), base[g])),
};
const MORPHS = ['female', 'build', 'muscle', 'african', 'asian'];
/* normals are stored for the morphs that change the outline most */
const NORMAL_MORPHS = ['female', 'build', 'muscle'];

/* ------------------------------------------------------------------ joints */

const sideOf = (s) => Math.sign(head(mh.obj.pos, `upperarm01.${s}`)[0]);
const rs = sideOf('L') > 0 ? 'L' : 'R';
const joints = (P) => {
  const j = P.joints;
  return {
    shoulder: j[`shoulder${rs}`],
    elbow: j[`elbow${rs}`],
    wrist: j[`wrist${rs}`],
    hip: j[`hip${rs}`],
    knee: j[`knee${rs}`],
    ankle: j[`ankle${rs}`],
    neck: j.neck01,
    head: j.head,
    eye: j[`eye${rs}`],
  };
};
const JM = joints(male);
const JF = joints(female);
console.log('joints', JSON.stringify(JM));
console.log('female', JSON.stringify(JF));

/* ------------------------------------------------------------------ crowd bones */

/* crowd bones (crowd.ts): body 0, thighL 1, thighR 2, shinL 3, shinR 4, upperL 5, foreL 6, upperR 7, foreR 8, head 9; L is -x */
const crowdSide = (s) => (sideOf(s) < 0 ? 0 : 1);
const HEADLEVEL = { neck01: 0.3, neck02: 0.6, neck03: 0.85 };
const groupOf = (b) => {
  const s = b.endsWith('.L') ? 'L' : b.endsWith('.R') ? 'R' : '';
  const c = s ? crowdSide(s) : 0;
  if (/^(upperarm)/.test(b)) return { bone: c ? 7 : 5, level: 1 };
  if (/^shoulder01/.test(b)) return { bone: c ? 7 : 5, level: 0.4 };
  if (isFore(b)) return { bone: c ? 8 : 6, level: 1 };
  if (/^upperleg/.test(b)) return { bone: c ? 2 : 1, level: 1 };
  if (isShin(b)) return { bone: c ? 4 : 3, level: 1 };
  if (HEADLEVEL[b] !== undefined) return { bone: 9, level: HEADLEVEL[b] };
  if (/^(head|jaw|eye|levator|oculi|orbicularis|oris|risorius|temporalis|special0[3456]|tongue)/.test(b)) return { bone: 9, level: 1 };
  return { bone: 0, level: 1 };
};
const PARENT = { 1: 0, 2: 0, 3: 1, 4: 2, 5: 0, 6: 5, 7: 0, 8: 7, 9: 0 };
const DEPTH = { 0: 0, 1: 1, 2: 1, 5: 1, 7: 1, 9: 1, 3: 2, 4: 2, 6: 2, 8: 2 };
const vBone = new Uint8Array(N);
const vF = new Float64Array(N).fill(1);
const REGION = { torso: 0, upper: 1, fore: 2, hand: 3, head: 4, thigh: 5, shin: 6, foot: 7, eye: 8 };
const regionOf = (b) =>
  /^(upperarm|shoulder01)/.test(b) ? 'upper' : /^lowerarm/.test(b) ? 'fore' : /^(wrist|metacarpal|finger)/.test(b) ? 'hand' : /^upperleg/.test(b) ? 'thigh' : /^lowerleg/.test(b) ? 'shin' : isFoot(b) ? 'foot' : groupOf(b).bone === 9 ? 'head' : 'torso';
const vRegion = new Uint8Array(N);
{
  const per = Array.from({ length: N }, () => new Float64Array(10));
  const best = new Float64Array(N);
  for (const b of bones) {
    const { bone, level } = groupOf(b);
    const r = REGION[regionOf(b)];
    const a = W[b];
    for (let i = 0; i < N; i++) {
      if (!a[i]) continue;
      per[i][bone] += a[i] * level;
      per[i][PARENT[bone] ?? 0] += a[i] * (1 - level);
      if (a[i] > best[i]) {
        best[i] = a[i];
        vRegion[i] = r;
      }
    }
  }
  for (let i = 0; i < N; i++) {
    const w = per[i];
    let deep = 0;
    for (let b = 1; b < 10; b++) if (w[b] > 0.02 && DEPTH[b] > DEPTH[deep]) deep = b;
    // two bones of the same depth (rare): the heavier
    for (let b = 1; b < 10; b++) if (w[b] > 0.02 && DEPTH[b] === DEPTH[deep] && w[b] > w[deep]) deep = b;
    vBone[i] = deep;
    if (deep) {
      const p = PARENT[deep];
      vF[i] = w[deep] / Math.max(1e-9, w[deep] + w[p]);
    }
  }
}
// the eyes: on the head
for (const i of new Set(eyeTris)) {
  vBone[i] = 9;
  vF[i] = 1;
  vRegion[i] = REGION.eye;
}

/* ------------------------------------------------------------------ landmarks */

/* points on the face and head the shaders paint from (the base body, metres) */
const LM = {};
{
  const box = (pred) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    let n = 0;
    for (const i of bodyVerts) {
      if (!pred(i)) continue;
      n++;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], male[i * 3 + k]);
        hi[k] = Math.max(hi[k], male[i * 3 + k]);
      }
    }
    return { lo, hi, n };
  };
  const wsum = (pred) => sum((b) => (pred(b) ? 1 : 0));
  const oris = wsum((b) => b.startsWith('oris'));
  const lips = box((i) => oris[i] > 0.45);
  LM.mouth = [0, (lips.lo[1] + lips.hi[1]) / 2, lips.hi[2]];
  LM.mouthSize = [lips.hi[0], (lips.hi[1] - lips.lo[1]) / 2];
  const isHead = (i) => vRegion[i] === REGION.head;
  const h = box(isHead);
  LM.headTop = h.hi[1];
  LM.headBack = h.lo[2];
  LM.headFront = h.hi[2];
  // the nose tip: the furthest-forward point near the middle; the chin: the lowest point of the face's front
  let tip = null;
  let chin = null;
  for (const i of bodyVerts) {
    if (!isHead(i)) continue;
    const v = get(male, i);
    if (Math.abs(v[0]) < 0.004 && (!tip || v[2] > tip[2])) tip = v;
  }
  for (const i of bodyVerts) {
    if (!isHead(i)) continue;
    const v = get(male, i);
    if (Math.abs(v[0]) < 0.004 && v[2] > tip[2] - 0.05 && v[1] < tip[1] && (!chin || v[1] < chin[1])) chin = v;
  }
  LM.nose = tip;
  LM.chin = chin;
  // the ears: the widest part of the head at eye height
  const ear = box((i) => isHead(i) && Math.abs(male[i * 3 + 1] - (JM.eye[1] - 0.02)) < 0.03 && male[i * 3] > 0);
  LM.earX = ear.hi[0];
  // the eyeballs: the right eye's centre and radius
  const eyeV = [...new Set(eyeTris)].filter((i) => male[i * 3] > 0);
  const c = [0, 0, 0];
  for (const i of eyeV) for (let k = 0; k < 3; k++) c[k] += male[i * 3 + k] / eyeV.length;
  let r = 0;
  for (const i of eyeV) r += len(sub(get(male, i), c)) / eyeV.length;
  LM.eye = c;
  LM.eyeR = r;
  // the neck at its base (where a collar sits) and the hands' grip
  const neck = box((i) => isHead(i) && male[i * 3 + 1] < JM.neck[1] + 0.02);
  LM.neckBase = neck.lo[1];
  LM.neckR = neck.hi[0];
  const hand = box((i) => vRegion[i] === REGION.hand && male[i * 3] > 0);
  LM.hand = [(hand.lo[0] + hand.hi[0]) / 2, (hand.lo[1] + hand.hi[1]) / 2, (hand.lo[2] + hand.hi[2]) / 2];
  LM.handLo = hand.lo[1];
  const foot = box((i) => vRegion[i] === REGION.foot && male[i * 3] > 0);
  LM.foot = { lo: foot.lo, hi: foot.hi };
  // the chest's front at its fullest, the waist
  const chest = box((i) => vRegion[i] === REGION.torso && male[i * 3 + 1] > 1.2 && male[i * 3 + 1] < 1.35);
  LM.chestZ = chest.hi[2];
  LM.chestX = chest.hi[0];
  console.log('landmarks', JSON.stringify(LM));
}

/* the whole face turns with the head: the jaw and lips take none of the neck's lag (they'd shear off the face, and the mouth
   would open, every time the head nodded) */
{
  let n = 0;
  for (const i of bodyVerts) {
    if (vBone[i] !== 9 || vF[i] >= 0.999) continue;
    const y = male[i * 3 + 1];
    const z = male[i * 3 + 2];
    // in front of the neck, from under the chin up; behind it, from the ears up; blended over a couple of centimetres
    const fz = Math.min(1, Math.max(0, (z - JM.neck[2] - 0.01) / 0.03));
    const yFace = LM.chin[1] - 0.012;
    const yBack = JM.eye[1] - 0.04;
    const y0 = yFace * fz + yBack * (1 - fz);
    const k = Math.min(1, Math.max(0, (y - (y0 - 0.02)) / 0.02));
    if (k > 0) {
      vF[i] = vF[i] + (1 - vF[i]) * k;
      n++;
    }
  }
  console.log('face vertices made rigid with the head', n);
}

/* ------------------------------------------------------------------ normals */

function normals(P, tris) {
  const n = new Float64Array(N * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    const e1 = sub(get(P, b), get(P, a));
    const e2 = sub(get(P, c), get(P, a));
    const f = cross(e1, e2);
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) n[v * 3 + k] += f[k];
  }
  for (let i = 0; i < N; i++) set(n, i, norm(get(n, i)));
  return n;
}
const allTris = [...bodyTris, ...eyeTris];
const N0 = normals(male, allTris);
const ND = {};
for (const m of NORMAL_MORPHS) {
  const P = male.map((v, i) => v + D[m][i]);
  const n = normals(P, allTris);
  ND[m] = n.map((v, i) => v - N0[i]);
}

/* ------------------------------------------------------------------ simplify */

// the face keeps its detail, the hands and feet give theirs up first: the error is measured in a space with the head grown and the hands shrunk
const simpPos = new Float32Array(N * 3);
{
  const hc = [0, JM.eye[1] - 0.02, 0.02];
  for (let i = 0; i < N; i++) {
    const v = get(male, i);
    const r = vRegion[i];
    const k = r === REGION.head ? 2.6 : r === REGION.eye ? 2.6 : r === REGION.hand ? 0.55 : r === REGION.foot ? 0.7 : 1;
    const c = r === REGION.head || r === REGION.eye ? hc : v;
    set(simpPos, i, [c[0] + (v[0] - c[0]) * k, c[1] + (v[1] - c[1]) * k, c[2] + (v[2] - c[2]) * k]);
  }
}
await MeshoptSimplifier.ready;
const lods = [];
let src = Uint32Array.from(bodyTris);
for (const target of LOD_TRIS) {
  const [idx, err] = MeshoptSimplifier.simplify(src, simpPos, 3, target * 3, 0.05, ['LockBorder']);
  console.log('lod', target, 'got', idx.length / 3, 'error', err.toFixed(4));
  lods.push(idx);
  src = idx;
}

/* ------------------------------------------------------------------ pack */

// the vertex set: every vertex the close-up uses, then the eyes
const used = [...new Set([...lods[0], ...eyeTris])];
const remap = new Map(used.map((v, i) => [v, i]));
const V = used.length;
console.log('vertices', V);
const chunks = [];
const push = (arr) => chunks.push(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
const POS_K = 32767 / 2;
const D_K = 32767 / 0.25;
const pos = new Int16Array(V * 3);
const nor = new Int8Array(V * 3);
used.forEach((v, i) => {
  for (let k = 0; k < 3; k++) {
    pos[i * 3 + k] = Math.round(male[v * 3 + k] * POS_K);
    nor[i * 3 + k] = Math.round(N0[v * 3 + k] * 127);
  }
});
push(pos);
push(nor);
const rig = new Uint8Array(V * 3);
used.forEach((v, i) => {
  rig[i * 3] = vBone[v];
  rig[i * 3 + 1] = Math.round(vF[v] * 255);
  rig[i * 3 + 2] = vRegion[v];
});
push(rig);
let maxD = 0;
for (const m of MORPHS) {
  const a = new Int16Array(V * 3);
  used.forEach((v, i) => {
    for (let k = 0; k < 3; k++) {
      const d = D[m][v * 3 + k];
      maxD = Math.max(maxD, Math.abs(d));
      a[i * 3 + k] = Math.max(-32767, Math.min(32767, Math.round(d * D_K)));
    }
  });
  push(a);
}
console.log('largest offset (m)', maxD.toFixed(3));
for (const m of NORMAL_MORPHS) {
  const a = new Int8Array(V * 3);
  used.forEach((v, i) => {
    for (let k = 0; k < 3; k++) a[i * 3 + k] = Math.max(-127, Math.min(127, Math.round(ND[m][v * 3 + k] * 63.5)));
  });
  push(a);
}
const tri = (list) => Uint16Array.from(list, (v) => remap.get(v));
const lists = [...lods.map(tri), tri(eyeTris)];
for (const l of lists) push(l);
// keep every section 2-byte aligned for the Int16Array views
const parts = [];
const offsets = [];
let off = 0;
for (const c of chunks) {
  if (off % 2) {
    parts.push(Buffer.alloc(1));
    off++;
  }
  offsets.push(off);
  parts.push(c);
  off += c.length;
}
const blob = Buffer.concat(parts);
console.log('bytes', blob.length);

const r4 = (a) => a.map((v) => +v.toFixed(4));
const out = `/*
 * GENERATED by scripts/crowd-body/build.mjs from the MakeHuman base mesh,
 * skeleton weights and shape targets (CC0, makehumancommunity.org). Do not
 * edit by hand: change the script and run it again.
 */
/** joints of the base body (a young man, 1.75 m, the right side: +x), in metres */
export const BODY_JOINTS = ${JSON.stringify(Object.fromEntries(Object.entries(JM).map(([k, v]) => [k, r4(v)])))};
/** the same joints on the woman's shape */
export const BODY_JOINTS_FEMALE = ${JSON.stringify(Object.fromEntries(Object.entries(JF).map(([k, v]) => [k, r4(v)])))};
/** points on the base body the shaders and the kit are placed from */
export const BODY_LANDMARKS = ${JSON.stringify(LM, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v))};
export const BODY_MORPHS = ${JSON.stringify(MORPHS)};
export const BODY_NORMAL_MORPHS = ${JSON.stringify(NORMAL_MORPHS)};
export const BODY_REGION = ${JSON.stringify(REGION)};
export const BODY_LAYOUT = ${JSON.stringify({ vertices: V, posScale: 1 / POS_K, morphScale: 1 / D_K, normalMorphScale: 1 / 63.5, lods: lists.slice(0, 3).map((l) => l.length), eyes: lists[3].length, offsets })};
export const BODY_DATA = '${blob.toString('base64')}';
`;
fs.writeFileSync(OUT, out);
console.log('wrote', OUT, (out.length / 1024).toFixed(0), 'KB');
