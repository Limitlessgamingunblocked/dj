/*
 * The game's name in 3D, for the title screen: the wordmark is drawn on a
 * canvas in the display face, its outline traced (marching squares, the
 * loops joined end to end and thinned out), the letters' holes found by how
 * deeply each loop is nested, and the shapes extruded with a bevel: chrome
 * faces, glowing sides.
 */
import * as THREE from 'three';

/** closed outlines of the filled pixels of a w × h mask (1 = filled), in pixel units, y down */
export function traceContours(mask: Uint8Array, w: number, h: number): THREE.Vector2[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  // segments between edge midpoints, keyed by doubled coordinates
  const segs: [number, number, number, number][] = [];
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const c = (at(x, y) << 3) | (at(x + 1, y) << 2) | (at(x + 1, y + 1) << 1) | at(x, y + 1);
      if (c === 0 || c === 15) continue;
      const T: [number, number] = [2 * x + 1, 2 * y];
      const R: [number, number] = [2 * x + 2, 2 * y + 1];
      const B: [number, number] = [2 * x + 1, 2 * y + 2];
      const L: [number, number] = [2 * x, 2 * y + 1];
      const add = (a: [number, number], b: [number, number]) => segs.push([a[0], a[1], b[0], b[1]]);
      switch (c) {
        case 1:
        case 14:
          add(L, B);
          break;
        case 2:
        case 13:
          add(B, R);
          break;
        case 3:
        case 12:
          add(L, R);
          break;
        case 4:
        case 11:
          add(T, R);
          break;
        case 6:
        case 9:
          add(T, B);
          break;
        case 7:
        case 8:
          add(L, T);
          break;
        case 5:
          // a saddle (top right and bottom left filled): keep the two corners apart
          add(T, R);
          add(L, B);
          break;
        case 10:
          // (top left and bottom right filled)
          add(L, T);
          add(B, R);
          break;
      }
    }
  }
  const key = (x: number, y: number) => y * (2 * w + 8) + x;
  const byPoint = new Map<number, number[]>();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const list = byPoint.get(k);
      if (list) list.push(i);
      else byPoint.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops: THREE.Vector2[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop: THREE.Vector2[] = [new THREE.Vector2(segs[i][0] / 2, segs[i][1] / 2)];
    let cx = segs[i][2];
    let cy = segs[i][3];
    const sx = segs[i][0];
    const sy = segs[i][1];
    for (let guard = 0; guard < segs.length; guard++) {
      if (cx === sx && cy === sy) break;
      loop.push(new THREE.Vector2(cx / 2, cy / 2));
      const next = (byPoint.get(key(cx, cy)) ?? []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      const s = segs[next];
      if (s[0] === cx && s[1] === cy) {
        cx = s[2];
        cy = s[3];
      } else {
        cx = s[0];
        cy = s[1];
      }
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Douglas–Peucker: drop points within `eps` of the line through their neighbours (a closed loop) */
export function simplifyLoop(pts: THREE.Vector2[], eps: number): THREE.Vector2[] {
  if (pts.length < 8) return pts;
  // the loop closed back to its start, so the second half can run to it
  const ring = [...pts, pts[0]];
  const dp = (a: number, b: number, out: THREE.Vector2[]) => {
    const A = ring[a];
    const B = ring[b];
    let best = -1;
    let bd = 0;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((ring[i].x - A.x) * dy - (ring[i].y - A.y) * dx) / len;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0 && bd > eps) {
      dp(a, best, out);
      dp(best, b, out);
    } else out.push(B);
  };
  // split the loop at its farthest point from the start, simplify both halves
  let far = 0;
  let fd = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].distanceToSquared(pts[0]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const out: THREE.Vector2[] = [pts[0]];
  dp(0, far, out);
  dp(far, ring.length - 1, out);
  out.pop();
  return out.length >= 3 ? out : pts;
}

function inside(p: THREE.Vector2, poly: THREE.Vector2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** loops to shapes: even nesting depth is an outline, odd a hole in the loop just outside it */
export function loopsToShapes(loops: THREE.Vector2[][]): THREE.Shape[] {
  const depth = loops.map((l, i) => loops.reduce((n, o, j) => (j !== i && inside(l[0], o) ? n + 1 : n), 0));
  const shapes = new Map<number, THREE.Shape>();
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) shapes.set(i, new THREE.Shape(l));
  });
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) return;
    // the smallest outline that contains it
    let best = -1;
    let bestArea = Infinity;
    loops.forEach((o, j) => {
      if (depth[j] % 2 !== 0 || depth[j] !== depth[i] - 1 || !inside(l[0], o)) return;
      const a = Math.abs(THREE.ShapeUtils.area(o));
      if (a < bestArea) {
        bestArea = a;
        best = j;
      }
    });
    if (best >= 0) shapes.get(best)!.holes.push(new THREE.Path(l));
  });
  return [...shapes.values()];
}

/** the wordmark as a mask, `px` pixels tall */
function textMask(text: string, px: number): { mask: Uint8Array; w: number; h: number } {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = `900 ${px}px "Barlow Condensed", "Arial Narrow", "Roboto Condensed", Impact, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width + px * 0.3);
  const h = Math.ceil(px * 1.3);
  c.width = w;
  c.height = h;
  g.font = font;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  g.fillText(text, w / 2, h / 2);
  const data = g.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return { mask, w, h };
}

/** The wordmark, extruded: `width` metres across, centred, facing +Z. Groups: 0 the faces, 1 the sides. */
export function logoGeometry(text: string, width: number): THREE.BufferGeometry {
  const px = 140;
  const { mask, w, h } = textMask(text, px);
  const loops = traceContours(mask, w, h).map((l) => simplifyLoop(l, 0.7).map((p) => new THREE.Vector2(p.x - w / 2, h / 2 - p.y)));
  const shapes = loopsToShapes(loops);
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: px * 0.16, bevelEnabled: true, bevelThickness: px * 0.035, bevelSize: px * 0.022, bevelSegments: 2, curveSegments: 4 });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const k = width / Math.max(1, bb.max.x - bb.min.x);
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  geo.scale(k, k, k);
  return geo;
}
