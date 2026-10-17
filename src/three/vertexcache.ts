import type * as THREE from 'three';

/*
 * Triangle order for the GPU's vertex cache. A GPU keeps the last few dozen
 * vertices it has shaded and reuses them when the next triangles share them;
 * the order the triangles come in decides how often that works. Meshes merged
 * from parts (the crowd's people) come in an order that shades each vertex
 * about 2.3 times. Reordered, it's closer to once.
 *
 * Only the order of the triangles changes: the same triangles, the same
 * vertices, the same picture (an opaque mesh with depth testing draws the same
 * whatever order its triangles come in).
 *
 * The method is Tom Forsyth's "Linear-speed vertex cache optimisation" (2006):
 * each vertex scores higher the more recently it was used and the fewer of its
 * triangles are left, and the next triangle is the best-scoring one touching
 * the cache.
 */

const CACHE = 32;
const DECAY = 1.5;
const LAST_TRI = 0.75;
const VALENCE_SCALE = 2;
const VALENCE_POWER = 0.5;

function vertexScore(pos: number, left: number): number {
  if (left === 0) return -1;
  let s = 0;
  if (pos >= 0) {
    // the last triangle's three vertices score the same, so the next triangle doesn't just favour one edge
    if (pos < 3) s = LAST_TRI;
    else s = Math.pow(1 - (pos - 3) / (CACHE - 3), DECAY);
  }
  // vertices with few triangles left go first, so they leave the cache sooner
  return s + VALENCE_SCALE * Math.pow(left, -VALENCE_POWER);
}

/** The triangles of an index buffer reordered for the vertex cache (a new array of the same type and length). */
export function vertexCacheOrder<T extends Uint16Array | Uint32Array>(index: T, vertexCount: number): T {
  const nTri = Math.floor(index.length / 3);
  // each vertex's triangles
  const left = new Int32Array(vertexCount);
  for (let i = 0; i < nTri * 3; i++) left[index[i]]++;
  const start = new Int32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v++) start[v + 1] = start[v] + left[v];
  const tris = new Int32Array(start[vertexCount]);
  const fill = start.slice(0, vertexCount);
  for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) tris[fill[index[t * 3 + k]]++] = t;

  const pos = new Int32Array(vertexCount).fill(-1);
  const vScore = new Float64Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) vScore[v] = vertexScore(-1, left[v]);
  const tScore = new Float64Array(nTri);
  const added = new Uint8Array(nTri);
  for (let t = 0; t < nTri; t++) tScore[t] = vScore[index[t * 3]] + vScore[index[t * 3 + 1]] + vScore[index[t * 3 + 2]];

  const out = new (index.constructor as { new (n: number): T })(index.length);
  let cache: number[] = [];
  let best = -1;
  // where the search for an unplaced triangle picks up when the cache has nothing to offer
  let scan = 0;
  for (let n = 0; n < nTri; n++) {
    if (best < 0) {
      let bs = -Infinity;
      for (let t = scan; t < nTri; t++) {
        if (added[t]) {
          if (t === scan) scan++;
          continue;
        }
        if (tScore[t] > bs) {
          bs = tScore[t];
          best = t;
        }
      }
    }
    const t = best;
    added[t] = 1;
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    out[n * 3] = a;
    out[n * 3 + 1] = b;
    out[n * 3 + 2] = c;
    // the triangle's vertices go to the front of the cache, and it leaves their lists
    const next = [a, b, c];
    for (const v of cache) if (v !== a && v !== b && v !== c) next.push(v);
    for (const v of [a, b, c]) {
      left[v]--;
      const s = start[v];
      const e = s + left[v] + 1;
      for (let i = s; i < e; i++) {
        if (tris[i] === t) {
          tris[i] = tris[e - 1];
          tris[e - 1] = t;
          break;
        }
      }
    }
    // rescore what's in the cache (and what just fell out of it)
    for (let i = 0; i < next.length; i++) {
      const v = next[i];
      pos[v] = i < CACHE ? i : -1;
      vScore[v] = vertexScore(pos[v], left[v]);
    }
    cache = next.slice(0, CACHE);
    // the best triangle touching the cache
    best = -1;
    let bs = -Infinity;
    for (const v of next) {
      for (let i = start[v]; i < start[v] + left[v]; i++) {
        const u = tris[i];
        const s = vScore[index[u * 3]] + vScore[index[u * 3 + 1]] + vScore[index[u * 3 + 2]];
        tScore[u] = s;
        if (s > bs) {
          bs = s;
          best = u;
        }
      }
    }
  }
  return out;
}

/** Reorder an indexed geometry's triangles for the vertex cache, in place; geometry groups (one material each) keep their ranges. */
export function optimizeVertexCache(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = g.index;
  if (!index) return g;
  const arr = index.array as Uint16Array | Uint32Array;
  const n = g.attributes.position.count;
  const ranges = g.groups.length ? g.groups.map((r) => [r.start, r.start + r.count]) : [[0, arr.length]];
  const next = arr.slice() as Uint16Array | Uint32Array;
  for (const [s, e] of ranges) next.set(vertexCacheOrder(arr.subarray(s, Math.min(e, arr.length)) as Uint16Array | Uint32Array, n), s);
  index.array.set(next);
  index.needsUpdate = true;
  return g;
}

/** Shaded vertices per triangle for a FIFO cache of a given size: 3 is none reused, about 0.6 the best a mesh can do. */
export function cacheMissRatio(index: ArrayLike<number>, size = 32): number {
  const q = new Int32Array(size).fill(-1);
  let head = 0;
  let miss = 0;
  for (let i = 0; i < index.length; i++) {
    const v = index[i];
    let hit = false;
    for (let k = 0; k < size; k++) if (q[k] === v) hit = true;
    if (hit) continue;
    miss++;
    q[head] = v;
    head = (head + 1) % size;
  }
  return miss / (index.length / 3);
}
