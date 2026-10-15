/*
 * Smoother skin for the scanned people. A scan's skin weights come from an
 * automatic rig: neighbouring points of the skin can follow quite different
 * bones, so when an arm goes up the shirt at the armpit tears into a jagged
 * edge and the shoulder stretches in lumps. Blurring each point's weights a
 * little with its neighbours' (across the mesh's seams too: points at the same
 * place count as one) makes the skin bend in a smooth sweep instead, the way
 * cloth and skin do.
 */
import type * as THREE from 'three';

/**
 * Blur a skinned geometry's weights over its surface, in place: `passes`
 * rounds, each moving a point `amount` of the way to its neighbours' average;
 * then the four biggest kept, summing to 1. `focus` blurs some more where any
 * of its bones (by index) has a say: the shoulders, say, where an arm going up
 * pulls the shirt from the chest, so the stretch spreads over a wide sweep
 * instead of tearing at a seam.
 */
export function smoothSkin(geo: THREE.BufferGeometry, passes = 4, amount = 0.5, focus?: { bones: number[]; passes: number }): void {
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  if (!pos || !si || !sw) return;
  const n = pos.count;

  // points at the same place are one point (the mesh splits them along its UV seams)
  const groupOf = new Int32Array(n);
  const key = new Map<string, number>();
  let groups = 0;
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(pos.getX(v) * 1e4)},${Math.round(pos.getY(v) * 1e4)},${Math.round(pos.getZ(v) * 1e4)}`;
    let g = key.get(k);
    if (g === undefined) key.set(k, (g = groups++));
    groupOf[v] = g;
  }

  // who's next to whom, along the triangles' edges
  const near: Set<number>[] = Array.from({ length: groups }, () => new Set<number>());
  const idx = geo.getIndex();
  const tris = idx ? idx.count / 3 : n / 3;
  const at = (i: number) => groupOf[idx ? idx.getX(i) : i];
  for (let t = 0; t < tris; t++) {
    const a = at(t * 3);
    const b = at(t * 3 + 1);
    const c = at(t * 3 + 2);
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      if (x === y) continue;
      near[x].add(y);
      near[y].add(x);
    }
  }

  // each point's weights, one column per bone used
  let bones = 0;
  for (let v = 0; v < n; v++) for (let j = 0; j < 4; j++) if (sw.getComponent(v, j) > 0) bones = Math.max(bones, si.getComponent(v, j) + 1);
  if (!bones) return;
  let w = new Float32Array(groups * bones);
  const members = new Uint16Array(groups);
  for (let v = 0; v < n; v++) {
    const g = groupOf[v];
    members[g]++;
    for (let j = 0; j < 4; j++) {
      const x = sw.getComponent(v, j);
      if (x > 0) w[g * bones + si.getComponent(v, j)] += x;
    }
  }
  for (let g = 0; g < groups; g++) if (members[g] > 1) for (let b = 0; b < bones; b++) w[g * bones + b] /= members[g];

  // where the focus bones have a say
  let only: Uint8Array | null = null;
  if (focus) {
    only = new Uint8Array(groups);
    for (let g = 0; g < groups; g++) if (focus.bones.some((b) => b < bones && w[g * bones + b] > 0.02)) only[g] = 1;
  }

  let next = new Float32Array(w.length);
  for (let p = 0; p < passes + (focus?.passes ?? 0); p++) {
    const some = p >= passes ? only : null;
    for (let g = 0; g < groups; g++) {
      const o = g * bones;
      const nb = near[g];
      if (!nb.size || (some && !some[g])) {
        for (let b = 0; b < bones; b++) next[o + b] = w[o + b];
        continue;
      }
      const k = amount / nb.size;
      for (let b = 0; b < bones; b++) next[o + b] = w[o + b] * (1 - amount);
      for (const h of nb) {
        const q = h * bones;
        for (let b = 0; b < bones; b++) next[o + b] += w[q + b] * k;
      }
    }
    [w, next] = [next, w];
  }

  // back onto every point: the four biggest, summing to one
  const top = [0, 0, 0, 0];
  const topW = [0, 0, 0, 0];
  for (let v = 0; v < n; v++) {
    const o = groupOf[v] * bones;
    top.fill(0);
    topW.fill(0);
    for (let b = 0; b < bones; b++) {
      const x = w[o + b];
      if (x <= topW[3]) continue;
      let j = 3;
      while (j > 0 && x > topW[j - 1]) {
        topW[j] = topW[j - 1];
        top[j] = top[j - 1];
        j--;
      }
      topW[j] = x;
      top[j] = b;
    }
    const sum = topW[0] + topW[1] + topW[2] + topW[3] || 1;
    for (let j = 0; j < 4; j++) {
      si.setComponent(v, j, top[j]);
      sw.setComponent(v, j, topW[j] / sum);
    }
  }
  si.needsUpdate = true;
  sw.needsUpdate = true;
}
