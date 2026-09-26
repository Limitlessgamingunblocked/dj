import * as THREE from 'three';

type V3 = [number, number, number];

/** Accumulates triangles with normals, UVs and vertex colours into one BufferGeometry. */
export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];

  get empty() {
    return this.pos.length === 0;
  }

  /** Quad a-b-c-d (counter-clockwise seen from the front). */
  quad(a: V3, b: V3, c: V3, d: V3, uvs: [number, number][], color: THREE.Color): void {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = new THREE.Vector3(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]).normalize();
    const vs = [a, b, c, a, c, d];
    const us = [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]];
    for (let k = 0; k < 6; k++) {
      this.pos.push(...vs[k]);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(...us[k]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  tri(a: V3, b: V3, c: V3, color: THREE.Color): void {
    const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const e2 = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = e1.cross(e2).normalize();
    for (const v of [a, b, c]) {
      this.pos.push(...v);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(0, 0);
      this.col.push(color.r, color.g, color.b);
    }
  }

  /** Horizontal rectangle facing up. UVs are world metres divided by `tile`. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, color: THREE.Color, tile = 1): void {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [[x0 / tile, z1 / tile], [x1 / tile, z1 / tile], [x1 / tile, z0 / tile], [x0 / tile, z0 / tile]], color);
  }

  /**
   * Box walls with UVs in metres / (tileU, tileV) so a repeating facade texture keeps its scale,
   * plus an optional flat top.
   */
  walls(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, color: THREE.Color, tileU: number, tileV: number, top = false): void {
    const v0 = 0;
    const v1 = (y1 - y0) / tileV;
    const w = (x1 - x0) / tileU;
    const d = (z1 - z0) / tileU;
    // south (+z)
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [[0, v0], [w, v0], [w, v1], [0, v1]], color);
    // north (-z)
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [[0, v0], [w, v0], [w, v1], [0, v1]], color);
    // east (+x)
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [[0, v0], [d, v0], [d, v1], [0, v1]], color);
    // west (-x)
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [[0, v0], [d, v0], [d, v1], [0, v1]], color);
    if (top) this.flat(x0, z0, x1, z1, y1, color);
  }

  /** Axis-aligned box with all six faces, UV 0..1 per face. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color): void {
    const uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uv, color);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], uv, color);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uv, color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uv, color);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], uv, color);
  }

  /** Vertical cylinder side + cap. */
  cylinder(cx: number, cz: number, r: number, y0: number, y1: number, color: THREE.Color, seg = 20, tileU = 4, tileV = 3.5): void {
    const circ = 2 * Math.PI * r;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2;
      const a1 = ((k + 1) / seg) * Math.PI * 2;
      const p0: V3 = [cx + Math.sin(a0) * r, y0, cz + Math.cos(a0) * r];
      const p1: V3 = [cx + Math.sin(a1) * r, y0, cz + Math.cos(a1) * r];
      const u0 = ((k / seg) * circ) / tileU;
      const u1 = (((k + 1) / seg) * circ) / tileU;
      const v1 = (y1 - y0) / tileV;
      this.quad(p0, p1, [p1[0], y1, p1[2]], [p0[0], y1, p0[2]], [[u0, 0], [u1, 0], [u1, v1], [u0, v1]], color);
      this.tri([cx, y1, cz], [p0[0], y1, p0[2]], [p1[0], y1, p1[2]], color);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
