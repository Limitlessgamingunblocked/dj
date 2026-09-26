import * as THREE from 'three';
import { EDGE, N, P, RW, SIZE, SW, type Block, type Building, type City, type Place } from '../core/city';
import { mulberry32, pick, range } from '../core/rng';
import { canvasTexture, GeoBuilder } from './geo';

export const CURB = 0.12;

const LOT_COLORS: Record<Block['zone'], number> = {
  residential: 0x7fa65a,
  downtown: 0xb9b6ae,
  industrial: 0x9c9a92,
  park: 0x6fa24e,
  hospital: 0xc9ccc8,
  training: 0x8d9094,
  stadium: 0x5f9a45,
  rural: 0xa7ad62,
};

function roadTexture() {
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#3b3e43';
    ctx.fillRect(0, 0, 256, 256);
    const r = mulberry32(3);
    for (let k = 0; k < 2500; k++) {
      const g = 50 + Math.floor(r() * 25);
      ctx.fillStyle = `rgba(${g},${g + 2},${g + 6},0.5)`;
      ctx.fillRect(r() * 256, r() * 256, 2, 2);
    }
    // gutters, edge lines, double yellow centre line
    ctx.fillStyle = '#2f3236';
    ctx.fillRect(0, 0, 8, 256);
    ctx.fillRect(248, 0, 8, 256);
    ctx.fillStyle = '#e8e8e2';
    ctx.fillRect(12, 0, 3, 256);
    ctx.fillRect(241, 0, 3, 256);
    ctx.fillStyle = '#e2b634';
    ctx.fillRect(123, 0, 3, 256);
    ctx.fillRect(130, 0, 3, 256);
  });
}

function crossingTexture() {
  return canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#3b3e43';
      ctx.fillRect(0, 0, 256, 256);
      const r = mulberry32(5);
      for (let k = 0; k < 2500; k++) {
        const g = 50 + Math.floor(r() * 25);
        ctx.fillStyle = `rgba(${g},${g + 2},${g + 6},0.5)`;
        ctx.fillRect(r() * 256, r() * 256, 2, 2);
      }
      ctx.fillStyle = '#e8e8e2';
      const depth = 30;
      for (let k = 0; k < 9; k++) {
        const o = 20 + k * 24;
        ctx.fillRect(o, 2, 12, depth);
        ctx.fillRect(o, 254 - depth, 12, depth);
        ctx.fillRect(2, o, depth, 12);
        ctx.fillRect(254 - depth, o, depth, 12);
      }
    },
    false,
  );
}

function windowTexture() {
  // 8 m x 7 m: two bays by two floors.
  return canvasTexture(256, 224, (ctx) => {
    ctx.fillStyle = '#e9e9e6';
    ctx.fillRect(0, 0, 256, 224);
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        const x = a * 128 + 18;
        const y = b * 112 + 22;
        const grd = ctx.createLinearGradient(x, y, x + 92, y + 70);
        grd.addColorStop(0, '#3d5366');
        grd.addColorStop(0.55, '#243646');
        grd.addColorStop(1, '#4b6478');
        ctx.fillStyle = grd;
        ctx.fillRect(x, y, 92, 70);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + 4, y + 4, 26, 62);
        ctx.fillStyle = '#c9c9c4';
        ctx.fillRect(x + 44, y, 4, 70);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 104, 256, 8);
    ctx.fillRect(0, 216, 256, 8);
  });
}

function sidingTexture() {
  // 8 m x 7 m of ribbed cladding with a high strip of windows.
  return canvasTexture(256, 224, (ctx) => {
    ctx.fillStyle = '#e4e4e0';
    ctx.fillRect(0, 0, 256, 224);
    for (let x = 0; x < 256; x += 16) {
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(x, 0, 3, 224);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 3, 0, 2, 224);
    }
    ctx.fillStyle = '#3f4f5c';
    ctx.fillRect(30, 30, 70, 22);
    ctx.fillRect(156, 30, 70, 22);
  });
}

function signTexture(text: string, bg: string, fg: string, w = 512, h = 128) {
  return canvasTexture(
    w,
    h,
    (ctx) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = fg;
      ctx.font = `700 ${Math.floor(h * 0.5)}px "Barlow Condensed", Arial Narrow, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 2);
    },
    false,
  );
}

function crossTexture() {
  return canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#d8262e';
      ctx.fillRect(96, 28, 64, 200);
      ctx.fillRect(28, 96, 200, 64);
    },
    false,
  );
}

function helipadTexture() {
  return canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#4a4f55';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(128, 128, 104, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f2f2f2';
      ctx.font = '700 150px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('H', 128, 136);
    },
    false,
  );
}

const WINDOWED = new Set<Building['kind']>(['tower', 'office', 'apartment', 'house', 'hospital', 'training']);
const ROOFS = [0x8a4b3a, 0x5d6168, 0x6e4f3c, 0x7b3e33, 0x4f555c];

export interface CityMeshes {
  group: THREE.Group;
}

export function buildCityMeshes(city: City): CityMeshes {
  const group = new THREE.Group();
  const c = new THREE.Color();
  const r = mulberry32(city.seed + 11);

  // Grass beyond the streets.
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE + EDGE * 2 + 1400, SIZE + EDGE * 2 + 1400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x6e9a4c, roughness: 1 }),
  );
  grass.position.set(SIZE / 2, -0.02, SIZE / 2);
  grass.receiveShadow = true;
  group.add(grass);

  // Lots and sidewalks.
  const lots = new GeoBuilder();
  const walk = new THREE.Color(0xc4c1b9);
  const curb = new THREE.Color(0xa9a79f);
  for (const col of city.blocks) {
    for (const b of col) {
      lots.flat(b.x0 - SW, b.z0 - SW, b.x1 + SW, b.z1 + SW, CURB, walk);
      lots.walls(b.x0 - SW, b.z0 - SW, b.x1 + SW, b.z1 + SW, 0, CURB, curb, 1, 1);
      lots.flat(b.x0, b.z0, b.x1, b.z1, CURB + 0.01, c.setHex(LOT_COLORS[b.zone]).clone());
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      if (b.zone === 'park') {
        const path = new THREE.Color(0xd8c9a0);
        lots.flat(cx - 1.5, b.z0, cx + 1.5, b.z1, CURB + 0.02, path);
        lots.flat(b.x0, cz - 1.5, b.x1, cz + 1.5, CURB + 0.02, path);
      }
      if (b.zone === 'stadium') {
        lots.flat(cx - 22, cz - 14, cx + 22, cz + 14, CURB + 0.02, new THREE.Color(0x4f8e3a));
        lots.flat(cx - 1, b.z1 - 12, cx + 1, b.z1, CURB + 0.02, walk);
      }
      if (b.zone === 'rural') {
        for (let k = 0; k < 4; k++) lots.flat(b.x0 + 2, b.z0 + 36 + k * 9, b.x1 - 2, b.z0 + 40 + k * 9, CURB + 0.02, new THREE.Color(0x8e9448));
      }
      if (b.zone === 'hospital' || b.zone === 'training') {
        // Parking bays.
        const line = new THREE.Color(0xededed);
        for (let k = 0; k < 8; k++) lots.flat(b.x1 - 40 + k * 4.5, b.z1 - 12, b.x1 - 39.8 + k * 4.5, b.z1 - 4, CURB + 0.02, line);
      }
    }
  }
  const lotMesh = new THREE.Mesh(lots.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  lotMesh.receiveShadow = true;
  group.add(lotMesh);

  // Roads and intersections.
  const roads = new GeoBuilder();
  const crossings = new GeoBuilder();
  const white = new THREE.Color(0xffffff);
  const h = RW / 2;
  const y = 0.02;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = i * P;
      const z = j * P;
      crossings.quad([x - h, y, z + h], [x + h, y, z + h], [x + h, y, z - h], [x - h, y, z - h], [[0, 0], [1, 0], [1, 1], [0, 1]], white);
      if (j < N) {
        const z0 = z + h;
        const z1 = z + P - h;
        roads.quad([x - h, y, z1], [x + h, y, z1], [x + h, y, z0], [x - h, y, z0], [[0, z1 / RW], [1, z1 / RW], [1, z0 / RW], [0, z0 / RW]], white);
      }
      if (i < N) {
        const x0 = x + h;
        const x1 = x + P - h;
        roads.quad([x0, y, z + h], [x1, y, z + h], [x1, y, z - h], [x0, y, z - h], [[0, x0 / RW], [0, x1 / RW], [1, x1 / RW], [1, x0 / RW]], white);
      }
    }
  }
  const roadMesh = new THREE.Mesh(roads.build(), new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.92 }));
  roadMesh.receiveShadow = true;
  const crossMesh = new THREE.Mesh(crossings.build(), new THREE.MeshStandardMaterial({ map: crossingTexture(), roughness: 0.92 }));
  crossMesh.receiveShadow = true;
  group.add(roadMesh, crossMesh);

  // Buildings: windowed facades, clad facades and roofs.
  const windowed = new GeoBuilder();
  const clad = new GeoBuilder();
  const roofs = new GeoBuilder();
  for (const b of city.buildings) {
    const base = CURB;
    const top = base + b.h;
    const bc = new THREE.Color(b.color);
    if (b.kind === 'tank') {
      const rr = Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2;
      clad.cylinder((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, rr, base, top, bc, 24, 6, 7);
      continue;
    }
    (WINDOWED.has(b.kind) ? windowed : clad).walls(b.x0, b.z0, b.x1, b.z1, base, top, bc, 8, 7);
    if (b.kind === 'house' || b.kind === 'barn') {
      const rc = new THREE.Color(b.kind === 'barn' ? 0x5b5f63 : pick(r, ROOFS));
      const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
      const rise = b.kind === 'barn' ? 4.5 : 3;
      const o = 0.5;
      const [x0, z0, x1, z1] = [b.x0 - o, b.z0 - o, b.x1 + o, b.z1 + o];
      if (alongX) {
        const zm = (z0 + z1) / 2;
        roofs.quad([x0, top, z1], [x1, top, z1], [x1, top + rise, zm], [x0, top + rise, zm], [[0, 0], [1, 0], [1, 1], [0, 1]], rc);
        roofs.quad([x1, top, z0], [x0, top, z0], [x0, top + rise, zm], [x1, top + rise, zm], [[0, 0], [1, 0], [1, 1], [0, 1]], rc);
        roofs.tri([x1, top, z1], [x1, top, z0], [x1, top + rise, zm], bc);
        roofs.tri([x0, top, z0], [x0, top, z1], [x0, top + rise, zm], bc);
      } else {
        const xm = (x0 + x1) / 2;
        roofs.quad([x1, top, z1], [x1, top, z0], [xm, top + rise, z0], [xm, top + rise, z1], [[0, 0], [1, 0], [1, 1], [0, 1]], rc);
        roofs.quad([x0, top, z0], [x0, top, z1], [xm, top + rise, z1], [xm, top + rise, z0], [[0, 0], [1, 0], [1, 1], [0, 1]], rc);
        roofs.tri([x0, top, z1], [x1, top, z1], [xm, top + rise, z1], bc);
        roofs.tri([x1, top, z0], [x0, top, z0], [xm, top + rise, z0], bc);
      }
    } else {
      const rc = bc.clone().multiplyScalar(0.62);
      roofs.flat(b.x0, b.z0, b.x1, b.z1, top, rc);
      // Parapet and rooftop plant on taller buildings.
      if (b.h > 12) {
        const p = 0.5;
        roofs.walls(b.x0, b.z0, b.x1, b.z1, top, top + 1.1, bc.clone().multiplyScalar(0.8), 1, 1);
        roofs.walls(b.x0 + p, b.z0 + p, b.x1 - p, b.z1 - p, top, top + 1.1, bc.clone().multiplyScalar(0.7), 1, 1);
        if (b.kind !== 'hospital' && b.kind !== 'stadium') {
          const w = Math.min(8, (b.x1 - b.x0) * 0.3);
          const cx = b.x0 + (b.x1 - b.x0) * range(r, 0.3, 0.7);
          const cz = b.z0 + (b.z1 - b.z0) * range(r, 0.3, 0.7);
          roofs.box(cx - w / 2, top, cz - w / 2, cx + w / 2, top + 3, cz + w / 2, new THREE.Color(0x9ea3a8));
        }
      }
    }
  }
  const winMat = new THREE.MeshStandardMaterial({ map: windowTexture(), vertexColors: true, roughness: 0.55, metalness: 0.15 });
  const cladMat = new THREE.MeshStandardMaterial({ map: sidingTexture(), vertexColors: true, roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  for (const [geo, mat] of [[windowed, winMat], [clad, cladMat], [roofs, roofMat]] as const) {
    if (geo.empty) continue;
    const m = new THREE.Mesh(geo.build(), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  for (const h2 of city.hospitals) addHospitalDressing(group, h2);
  addSign(group, city.stadium, 'CIVIC STADIUM · SAFETY ZONE', '#1f5fd6', '#ffffff');
  addSign(group, city.training, 'RESPONSE TRAINING CENTER', '#233142', '#ffd21f');
  addProps(group, city);
  addHorizon(group);
  return { group };
}

function addSign(group: THREE.Group, place: Place, text: string, bg: string, fg: string) {
  const b = place.block;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.4), new THREE.MeshStandardMaterial({ map: signTexture(text, bg, fg, 1024, 154), roughness: 0.6 }));
  sign.position.set((b.x0 + b.x1) / 2 + 20, 4.2, b.z1 + 1);
  group.add(sign);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), new THREE.MeshStandardMaterial({ color: 0x555a60 }));
  post.position.set(sign.position.x - 7, 2, b.z1 + 0.9);
  const post2 = post.clone();
  post2.position.x += 14;
  group.add(post, post2);
}

function addHospitalDressing(group: THREE.Group, place: Place) {
  const b = place.block;
  const cross = new THREE.MeshStandardMaterial({ map: crossTexture(), emissive: 0x551111, roughness: 0.5 });
  const main = b.buildings[0];
  const wing = b.buildings[1];
  // Red crosses high on the south and west faces of the main block.
  const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), cross);
  s.position.set((main.x0 + main.x1) / 2 + 10, CURB + main.h - 5, main.z1 + 0.05);
  group.add(s);
  const w = s.clone();
  w.position.set(main.x0 - 0.05, CURB + main.h - 5, (main.z0 + main.z1) / 2);
  w.rotation.y = -Math.PI / 2;
  group.add(w);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: helipadTexture(), roughness: 0.8 }));
  pad.position.set((main.x0 + main.x1) / 2 + 8, CURB + main.h + 0.05, (main.z0 + main.z1) / 2);
  group.add(pad);
  // Emergency entrance canopy over the south side facing the ER bay.
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(22, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0xd8262e, roughness: 0.6 }));
  canopy.position.set(place.bay.x, CURB + 5, b.z1 - 3);
  canopy.castShadow = true;
  group.add(canopy);
  for (const dx of [-10, 10]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 5), new THREE.MeshStandardMaterial({ color: 0xe0e0e0 }));
    col.position.set(place.bay.x + dx, CURB + 2.5, b.z1 - 0.5);
    group.add(col);
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.8), new THREE.MeshStandardMaterial({ map: signTexture('EMERGENCY', '#d8262e', '#ffffff'), emissive: 0x330000 }));
  sign.position.set(place.bay.x, CURB + 5.9, b.z1 + 1.01);
  group.add(sign);
  const name = new THREE.Mesh(new THREE.PlaneGeometry(26, 2.6), new THREE.MeshStandardMaterial({ map: signTexture(place.name.toUpperCase(), '#ffffff', '#1d4f91', 1024, 104) }));
  name.position.set((wing.x0 + wing.x1) / 2, CURB + wing.h - 2, wing.z1 + 0.05);
  name.scale.set(0.8, 0.8, 1);
  group.add(name);
}

function addProps(group: THREE.Group, city: City) {
  const trees = city.props.filter((p) => p.kind === 'tree');
  const pines = city.props.filter((p) => p.kind === 'pine');
  const cones = city.props.filter((p) => p.kind === 'cone');
  const benches = city.props.filter((p) => p.kind === 'bench');
  const r = mulberry32(city.seed + 99);
  // Perimeter woods hide the edge of the world.
  for (let k = 0; k < 260; k++) {
    const side = k % 4;
    const t = range(r, -EDGE - 60, SIZE + EDGE + 60);
    const d = range(r, EDGE + 14, EDGE + 90);
    const x = side === 0 ? t : side === 1 ? SIZE + d : side === 2 ? t : -d;
    const z = side === 0 ? -d : side === 1 ? t : side === 2 ? SIZE + d : t;
    pines.push({ kind: 'pine', x, z, s: range(r, 1.2, 2.4) });
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.count = n;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
  const trunks = inst(new THREE.CylinderGeometry(0.22, 0.32, 1, 6).translate(0, 0.5, 0), trunkMat, trees.length + pines.length);
  const crowns = inst(new THREE.IcosahedronGeometry(1, 1), leafMat, trees.length);
  const cones3 = inst(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), leafMat, pines.length);
  let t = 0;
  trees.forEach((p, k) => {
    const s = p.s;
    m4.compose(new THREE.Vector3(p.x, CURB, p.z), q, new THREE.Vector3(s, 2.6 * s, s));
    trunks.setMatrixAt(t++, m4);
    m4.compose(new THREE.Vector3(p.x, CURB + 3.6 * s, p.z), q, new THREE.Vector3(2.4 * s, 2.1 * s, 2.4 * s));
    crowns.setMatrixAt(k, m4);
    crowns.setColorAt(k, col.setHSL(0.26 + range(r, -0.04, 0.05), 0.45, 0.32 + range(r, -0.05, 0.06)));
  });
  pines.forEach((p, k) => {
    const s = p.s;
    m4.compose(new THREE.Vector3(p.x, CURB, p.z), q, new THREE.Vector3(s, 1.6 * s, s));
    trunks.setMatrixAt(t++, m4);
    m4.compose(new THREE.Vector3(p.x, CURB + 1.2 * s, p.z), q, new THREE.Vector3(2 * s, 6 * s, 2 * s));
    cones3.setMatrixAt(k, m4);
    cones3.setColorAt(k, col.setHSL(0.33 + range(r, -0.03, 0.03), 0.4, 0.24 + range(r, -0.04, 0.04)));
  });
  const coneMesh = inst(new THREE.ConeGeometry(0.3, 0.8, 10).translate(0, 0.4, 0), new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 }), cones.length);
  cones.forEach((p, k) => {
    m4.compose(new THREE.Vector3(p.x, CURB, p.z), q, new THREE.Vector3(1, 1, 1));
    coneMesh.setMatrixAt(k, m4);
  });
  const benchMesh = inst(new THREE.BoxGeometry(2.2, 0.5, 0.7).translate(0, 0.45, 0), new THREE.MeshStandardMaterial({ color: 0x7a5a3a }), benches.length);
  benches.forEach((p, k) => {
    m4.compose(new THREE.Vector3(p.x, CURB, p.z), q, new THREE.Vector3(1, 1, 1));
    benchMesh.setMatrixAt(k, m4);
  });
  for (const p of city.props.filter((x) => x.kind === 'pond')) {
    const pond = new THREE.Mesh(new THREE.CircleGeometry(p.s, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3f7fa6, roughness: 0.15, metalness: 0.2 }));
    pond.position.set(p.x, CURB + 0.04, p.z);
    group.add(pond);
  }
}

function addHorizon(group: THREE.Group) {
  const r = mulberry32(42);
  const mat = new THREE.MeshStandardMaterial({ color: 0x7f9a86, roughness: 1, flatShading: true });
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + range(r, -0.1, 0.1);
    const d = range(r, 950, 1150);
    const hill = new THREE.Mesh(new THREE.ConeGeometry(range(r, 160, 300), range(r, 60, 150), 7), mat);
    hill.position.set(SIZE / 2 + Math.cos(a) * d, 20, SIZE / 2 + Math.sin(a) * d);
    group.add(hill);
  }
}
