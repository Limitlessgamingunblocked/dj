import { clamp, type Vec2 } from './math';
import { mulberry32, pick, range, type Rng } from './rng';

/** Blocks per side. Roads run along every multiple of P, so there are N + 1 road lines each way. */
export const N = 10;
/** Distance between road centre lines (m). */
export const P = 100;
/** Road width, sidewalk width, lane centre offset and the pulled-over offset (m). */
export const RW = 18;
export const SW = 4;
export const LANE = 4.5;
export const SHOULDER = 7.4;
export const SIZE = N * P;
/** How far from the outer roads you can drive before the world edge. */
export const EDGE = 40;

export type Zone = 'residential' | 'downtown' | 'industrial' | 'park' | 'hospital' | 'training' | 'stadium' | 'rural';

export type BuildingKind = 'tower' | 'office' | 'apartment' | 'house' | 'warehouse' | 'tank' | 'hospital' | 'stadium' | 'barn' | 'training';

export interface Building {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  h: number;
  kind: BuildingKind;
  color: number;
}

export type PropKind = 'tree' | 'pine' | 'pond' | 'cone' | 'bench';

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  s: number;
}

export interface Block {
  bi: number;
  bj: number;
  zone: Zone;
  /** Lot bounds, inside the sidewalk ring. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  name: string;
  buildings: Building[];
}

export interface Place {
  id: string;
  name: string;
  block: Block;
  /** Drop-off point on the road in front of the building (westbound lane on the south side). */
  bay: Vec2;
}

export interface City {
  seed: number;
  blocks: Block[][];
  buildings: Building[];
  props: Prop[];
  hospitals: Place[];
  training: Place;
  stadium: Place;
  parks: Block[];
}

// Rows run north (bj = 0) to south; columns west (bi = 0) to east.
//   R residential  D downtown  I industrial  P park  H hospital  T training  S stadium  F rural
const MAP = [
  'RRRRRIIIII',
  'RPRRSIIHII',
  'RRRRDDIIII',
  'RRRDDDDIII',
  'RHRDDDDDII',
  'RRRDDDDDTR',
  'RRRDDDDRRR',
  'RRRRDDRRPR',
  'RRRRRRRRRR',
  'FFRRRRRRRR',
];

const ZONES: Record<string, Zone> = {
  R: 'residential',
  D: 'downtown',
  I: 'industrial',
  P: 'park',
  H: 'hospital',
  T: 'training',
  S: 'stadium',
  F: 'rural',
};

const NAMED: Record<string, string> = {
  '1,1': 'Maple Park',
  '8,7': 'Harbor Park',
  '1,4': 'St. Grace Medical Center',
  '7,1': 'Metro Trauma Center',
  '4,1': 'Civic Stadium',
  '8,5': 'Civic Response Training Center',
};

export function zoneAt(bi: number, bj: number): Zone {
  return ZONES[MAP[bj][bi]];
}

export function districtOf(bi: number, bj: number): string {
  const z = zoneAt(bi, bj);
  if (z === 'rural') return 'Pinecrest Hollow';
  if (z === 'industrial') return 'Ironworks';
  if (z === 'downtown') return 'Downtown';
  if (bj >= 7) return bi >= 6 ? 'Harborside' : 'Southside';
  if (bi <= 2) return 'Westbrook';
  if (bj <= 1) return 'Northgate';
  return 'Eastvale';
}

export const lotBounds = (bi: number, bj: number) => {
  const m = RW / 2 + SW;
  return { x0: bi * P + m, z0: bj * P + m, x1: (bi + 1) * P - m, z1: (bj + 1) * P - m };
};

export const nodePos = (i: number, j: number): Vec2 => ({ x: i * P, z: j * P });

const GLASS = [0x6f8fa8, 0x5b7389, 0x8aa1b1, 0x49606f, 0x9fb3bd, 0x7d8c96];
const STONE = [0xc9b79c, 0xb7a58a, 0xd8cbb3, 0xa89a88, 0xc2b8aa];
const HOUSE = [0xe8d8c0, 0xf0e4cf, 0xc9d6df, 0xe7c9b4, 0xd9e2cc, 0xf2dcb3, 0xbfcfd9];
const INDUSTRIAL = [0x9aa0a6, 0x8a8f86, 0xa7a197, 0x7f8a92, 0xb0a28c];

function box(x0: number, z0: number, x1: number, z1: number, h: number, kind: BuildingKind, color: number): Building {
  return { x0, z0, x1, z1, h, kind, color };
}

function fillBlock(b: Block, r: Rng, props: Prop[]) {
  const { x0, z0, x1, z1 } = b;
  const L = x1 - x0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const out = b.buildings;
  switch (b.zone) {
    case 'downtown': {
      const c = SIZE / 2;
      const centrality = clamp(1 - Math.hypot(cx - c * 1.05, cz - c * 0.95) / (P * 3), 0, 1);
      const gap = 6;
      const half = (L - gap) / 2;
      for (let a = 0; a < 2; a++) {
        for (let d = 0; d < 2; d++) {
          const px = x0 + a * (half + gap);
          const pz = z0 + d * (half + gap);
          const h = (22 + 85 * centrality ** 1.4) * range(r, 0.55, 1.25);
          if (r() < 0.3) {
            const w = (half - 4) / 2;
            out.push(box(px, pz, px + w, pz + half, h, 'tower', pick(r, GLASS)));
            out.push(box(px + w + 4, pz, px + half, pz + half, h * range(r, 0.6, 0.9), 'office', pick(r, STONE)));
          } else {
            out.push(box(px, pz, px + half, pz + half, h, h > 50 ? 'tower' : 'office', h > 50 ? pick(r, GLASS) : pick(r, STONE)));
          }
        }
      }
      break;
    }
    case 'residential': {
      const nearCore = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([di, dj]) => {
        const bi = b.bi + di;
        const bj = b.bj + dj;
        return bi >= 0 && bj >= 0 && bi < N && bj < N && zoneAt(bi, bj) === 'downtown';
      });
      if (nearCore && r() < 0.75) {
        const gap = 10;
        const half = (L - gap) / 2;
        for (let a = 0; a < 2; a++) {
          for (let d = 0; d < 2; d++) {
            if (r() < 0.2) continue;
            const px = x0 + a * (half + gap);
            const pz = z0 + d * (half + gap);
            out.push(box(px + 2, pz + 2, px + half - 2, pz + half - 2, range(r, 12, 24), 'apartment', pick(r, STONE)));
          }
        }
        props.push({ kind: 'tree', x: cx, z: cz, s: range(r, 0.9, 1.3) });
        break;
      }
      const cell = L / 3;
      for (let a = 0; a < 3; a++) {
        for (let d = 0; d < 3; d++) {
          const ccx = x0 + (a + 0.5) * cell;
          const ccz = z0 + (d + 0.5) * cell;
          if (a === 1 && d === 1) {
            for (let k = 0; k < 3; k++) props.push({ kind: 'tree', x: ccx + range(r, -8, 8), z: ccz + range(r, -8, 8), s: range(r, 0.8, 1.3) });
            continue;
          }
          const w = range(r, 10, 14);
          const dd = range(r, 9, 12);
          const jx = range(r, -2, 2);
          const jz = range(r, -2, 2);
          out.push(box(ccx - w / 2 + jx, ccz - dd / 2 + jz, ccx + w / 2 + jx, ccz + dd / 2 + jz, range(r, 5, 7.5), 'house', pick(r, HOUSE)));
          if (r() < 0.6) props.push({ kind: 'tree', x: ccx + range(r, -10, 10), z: ccz + (r() < 0.5 ? -1 : 1) * 10, s: range(r, 0.7, 1.1) });
        }
      }
      break;
    }
    case 'industrial': {
      const hw = range(r, 36, 46);
      out.push(box(x0 + 3, z0 + 3, x0 + 3 + hw, z0 + 3 + range(r, 26, 34), range(r, 10, 14), 'warehouse', pick(r, INDUSTRIAL)));
      out.push(box(x0 + 4, z1 - 26, x0 + 4 + range(r, 20, 28), z1 - 4, range(r, 7, 10), 'warehouse', pick(r, INDUSTRIAL)));
      const tx = x1 - 14;
      for (let k = 0; k < 2; k++) {
        const tz = z0 + 14 + k * 24;
        out.push(box(tx - 8, tz - 8, tx + 8, tz + 8, range(r, 12, 18), 'tank', 0xd9dcd6));
      }
      break;
    }
    case 'hospital': {
      out.push(box(x0 + 6, z0 + 4, x1 - 6, z0 + 34, 30, 'hospital', 0xf2f4f5));
      out.push(box(x0 + 6, z0 + 34, x0 + 30, z0 + 56, 14, 'hospital', 0xe6ecef));
      for (let k = 0; k < 4; k++) props.push({ kind: 'tree', x: x1 - 8 - k * 9, z: z1 - 4, s: 0.8 });
      break;
    }
    case 'park': {
      props.push({ kind: 'pond', x: cx + 8, z: cz - 6, s: 11 });
      for (let k = 0; k < 34; k++) {
        const x = range(r, x0 + 3, x1 - 3);
        const z = range(r, z0 + 3, z1 - 3);
        if (Math.hypot(x - cx - 8, z - cz + 6) < 15) continue;
        if (Math.abs(x - cx) < 3 || Math.abs(z - cz) < 3) continue;
        props.push({ kind: r() < 0.3 ? 'pine' : 'tree', x, z, s: range(r, 0.8, 1.5) });
      }
      for (let k = 0; k < 6; k++) props.push({ kind: 'bench', x: cx - 20 + k * 8, z: cz + 4, s: 1 });
      break;
    }
    case 'training': {
      out.push(box(x0 + 4, z0 + 4, x0 + 34, z0 + 24, 8, 'training', 0xd4dde3));
      for (let k = 0; k < 7; k++) {
        props.push({ kind: 'cone', x: x0 + 12 + k * 8, z: z0 + 40 + (k % 2) * 6, s: 1 });
        props.push({ kind: 'cone', x: x0 + 12 + k * 8, z: z1 - 8, s: 1 });
      }
      break;
    }
    case 'stadium': {
      const t = 10;
      const i0 = 2;
      out.push(box(x0 + i0, z0 + i0, x1 - i0, z0 + i0 + t, 16, 'stadium', 0xcfd3d6));
      out.push(box(x0 + i0, z0 + i0 + t, x0 + i0 + t, z1 - i0, 16, 'stadium', 0xcfd3d6));
      out.push(box(x1 - i0 - t, z0 + i0 + t, x1 - i0, z1 - i0, 16, 'stadium', 0xcfd3d6));
      out.push(box(x0 + i0 + t, z1 - i0 - t, cx - 10, z1 - i0, 16, 'stadium', 0xcfd3d6));
      out.push(box(cx + 10, z1 - i0 - t, x1 - i0 - t, z1 - i0, 16, 'stadium', 0xcfd3d6));
      break;
    }
    case 'rural': {
      out.push(box(cx - 8, z0 + 8, cx + 8, z0 + 30, 9, 'barn', 0xa2402f));
      out.push(box(cx + 14, z0 + 10, cx + 22, z0 + 18, 16, 'tank', 0xc8c8c0));
      for (let k = 0; k < 22; k++) {
        const x = range(r, x0 + 2, x1 - 2);
        const z = range(r, z0 + 36, z1 - 2);
        props.push({ kind: 'pine', x, z, s: range(r, 0.9, 1.6) });
      }
      break;
    }
  }
}

export function createCity(seed = 7): City {
  const r = mulberry32(seed);
  const blocks: Block[][] = [];
  const props: Prop[] = [];
  const buildings: Building[] = [];
  for (let bi = 0; bi < N; bi++) {
    blocks[bi] = [];
    for (let bj = 0; bj < N; bj++) {
      const zone = zoneAt(bi, bj);
      const b: Block = { bi, bj, zone, ...lotBounds(bi, bj), name: NAMED[`${bi},${bj}`] ?? districtOf(bi, bj), buildings: [] };
      fillBlock(b, r, props);
      buildings.push(...b.buildings);
      blocks[bi][bj] = b;
    }
  }
  const place = (id: string, bi: number, bj: number): Place => ({
    id,
    name: NAMED[`${bi},${bj}`],
    block: blocks[bi][bj],
    bay: { x: (bi + 0.5) * P, z: (bj + 1) * P - LANE },
  });
  const parks = blocks.flat().filter((b) => b.zone === 'park');
  return {
    seed,
    blocks,
    buildings,
    props,
    hospitals: [place('stgrace', 1, 4), place('metro', 7, 1)],
    training: place('training', 8, 5),
    stadium: place('stadium', 4, 1),
    parks,
  };
}

export function blockIndex(x: number, z: number): [number, number] {
  return [clamp(Math.floor(x / P), 0, N - 1), clamp(Math.floor(z / P), 0, N - 1)];
}

export function blockAt(city: City, x: number, z: number): Block {
  const [bi, bj] = blockIndex(x, z);
  return city.blocks[bi][bj];
}

export function districtAt(city: City, x: number, z: number): string {
  const b = blockAt(city, x, z);
  return b.zone === 'hospital' || b.zone === 'park' || b.zone === 'stadium' || b.zone === 'training' ? b.name : districtOf(b.bi, b.bj);
}

/** Buildings in the block under (x, z) and its eight neighbours. */
export function buildingsNear(city: City, x: number, z: number, out: Building[] = []): Building[] {
  out.length = 0;
  const bi = Math.floor(x / P);
  const bj = Math.floor(z / P);
  for (let i = bi - 1; i <= bi + 1; i++) {
    if (i < 0 || i >= N) continue;
    for (let j = bj - 1; j <= bj + 1; j++) {
      if (j < 0 || j >= N) continue;
      for (const b of city.blocks[i][j].buildings) out.push(b);
    }
  }
  return out;
}

export function isOnRoad(x: number, z: number): boolean {
  const h = RW / 2;
  if (x < -h || z < -h || x > SIZE + h || z > SIZE + h) return false;
  return Math.abs(x - Math.round(x / P) * P) <= h || Math.abs(z - Math.round(z / P) * P) <= h;
}

export function insideBuilding(city: City, x: number, z: number, pad = 0): boolean {
  for (const b of buildingsNear(city, x, z)) {
    if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return true;
  }
  return false;
}

/** Corners of the sidewalk ring around a block, clockwise from the north-west. */
export function sidewalkRing(b: Block): Vec2[] {
  const o = SW / 2;
  return [
    { x: b.x0 - o, z: b.z0 - o },
    { x: b.x1 + o, z: b.z0 - o },
    { x: b.x1 + o, z: b.z1 + o },
    { x: b.x0 - o, z: b.z1 + o },
  ];
}

/**
 * A point on the sidewalk of a block (side 0 north, 1 east, 2 south, 3 west; t along the side),
 * plus the nearest lane point on the adjacent road where a vehicle can stop.
 */
export function curbSpot(b: Block, side: number, t: number): { walk: Vec2; road: Vec2 } {
  const ring = sidewalkRing(b);
  const a = ring[side % 4];
  const c = ring[(side + 1) % 4];
  const walk = { x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t };
  const off = SW / 2 + RW / 2 - LANE;
  const n = [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }][side % 4];
  return { walk, road: { x: walk.x + n.x * off, z: walk.z + n.z * off } };
}

export function clampToWorld(p: Vec2): Vec2 {
  return { x: clamp(p.x, -EDGE, SIZE + EDGE), z: clamp(p.z, -EDGE, SIZE + EDGE) };
}
