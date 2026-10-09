/*
 * The booth around the board (Section 13.7): the table's shape and height,
 * the front panel (plain, your name, LED, mesh, wood, mirror), booth
 * monitors, cables (hidden, coloured, coiled), a riser, a glass floor that
 * lights up, and side screens.
 * TODO: procedural stand-in for the Blender booth set (Section 14).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { nameService } from '../name/NameService';
import type { Booth } from './format';
import { boardMaterial } from './materials';
import { panelGeometry } from './parts';

export interface BuiltBooth {
  group: THREE.Group;
  /** the table top's height above the floor */
  top: number;
  update(dt: number, kick: number, vibe: number): void;
}

export function buildBooth(b: Booth): BuiltBooth {
  const g = new THREE.Group();
  const top = b.height + b.riser;
  const mat = boardMaterial({ id: b.material, color: b.color });
  const animated: ((dt: number, kick: number, vibe: number) => void)[] = [];
  if (b.riser > 0.01) {
    const riser = new THREE.Mesh(new RoundedBoxGeometry(b.width + 1.4, b.riser, b.depth + 1.6, 2, 0.02).translate(0, b.riser / 2, 0.3), boardMaterial({ id: 'matte', color: '#111216' }));
    riser.receiveShadow = true;
    g.add(riser);
  }
  if (b.glassFloor) {
    // a floor of light tiles that pulse with the kick
    const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.01, 0.38), new THREE.MeshStandardMaterial({ color: '#0a0a12', emissive: '#ffffff', emissiveIntensity: 0.6, roughness: 0.2 }), 36);
    const m = new THREE.Matrix4();
    const cols = ['#ff2e88', '#3ad7ff', '#b6ff3b', '#ffb547', '#c9b6ff'].map((c) => new THREE.Color(c));
    for (let i = 0; i < 36; i++) {
      m.makeTranslation(((i % 6) - 2.5) * 0.4, b.riser + 0.006, (Math.floor(i / 6) - 1.5) * 0.4 + 0.4);
      tiles.setMatrixAt(i, m);
      tiles.setColorAt(i, cols[i % cols.length]);
    }
    g.add(tiles);
    const tm = tiles.material as THREE.MeshStandardMaterial;
    animated.push((_dt, kick, vibe) => (tm.emissiveIntensity = 0.2 + kick * 0.9 * (0.5 + vibe)));
  }
  if (b.table !== 'none') {
    const thick = 0.04;
    const shape = b.table === 'round' ? 'round' : b.table === 'curved' ? 'curve' : b.table === 'L' ? 'L' : 'rect';
    const slab = new THREE.Mesh(panelGeometry(shape, b.width, b.depth, thick), mat);
    slab.position.y = top - thick;
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
    // the front: a panel facing the crowd
    const fh = Math.max(0.2, top - b.riser - 0.04);
    const front = new THREE.Mesh(new THREE.BoxGeometry(b.width * (b.table === 'round' ? 0.7 : 1), fh, 0.02), b.front === 'mirror' ? boardMaterial({ id: 'chrome', color: '#cccccc' }) : b.front === 'wood' ? boardMaterial({ id: 'walnut', color: '#ffffff' }) : b.front === 'mesh' ? boardMaterial({ id: 'carbon', color: '#ffffff' }) : mat);
    front.position.set(0, b.riser + fh / 2, b.depth / 2 - 0.02);
    // the board faces −z (the DJ stands at +z… the crowd at −z): the front sits on the crowd's side
    front.position.z = -b.depth / 2 + 0.01;
    g.add(front);
    if (b.front === 'name') {
      const name = nameService.surface('chrome_led', Math.min(b.width * 0.8, 1.6), Math.min(fh * 0.6, 0.5), {});
      name.position.set(0, b.riser + fh / 2, -b.depth / 2 - 0.002);
      name.rotation.y = Math.PI;
      g.add(name);
    } else if (b.front === 'led') {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const tex = new THREE.CanvasTexture(c);
      const led = new THREE.Mesh(new THREE.PlaneGeometry(b.width * 0.95, fh * 0.85), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      led.position.set(0, b.riser + fh / 2, -b.depth / 2 - 0.002);
      led.rotation.y = Math.PI;
      g.add(led);
      let t = 0;
      animated.push((dt, kick) => {
        t += dt;
        const x = c.getContext('2d')!;
        for (let i = 0; i < 32; i++) {
          const h = (i * 11 + t * 90) % 360;
          x.fillStyle = `hsl(${h}, 90%, ${30 + kick * 35}%)`;
          x.fillRect(i * 8, 0, 8, 64);
        }
        tex.needsUpdate = true;
      });
    }
    // legs for tables that need them
    if (b.table !== 'round') {
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, top - b.riser - thick, b.depth * 0.8), mat);
        leg.position.set((sx * b.width) / 2 - sx * 0.05, b.riser + (top - b.riser - thick) / 2, 0);
        g.add(leg);
      }
    } else {
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, top - b.riser - thick, 24), mat);
      ped.position.y = b.riser + (top - b.riser - thick) / 2;
      g.add(ped);
    }
  }
  if (b.monitors !== 'none') {
    const s = b.monitors === 'small' ? 0.28 : b.monitors === 'large' ? 0.45 : 0.4;
    for (const sx of [-1, 1]) {
      const stack = b.monitors === 'stack' ? 3 : 1;
      for (let k = 0; k < stack; k++) {
        const box = new THREE.Mesh(new RoundedBoxGeometry(s * 0.7, s, s * 0.75, 2, 0.01), boardMaterial({ id: 'matte', color: '#16171a' }));
        box.position.set(sx * (b.width / 2 + s * 0.45), b.riser + s / 2 + k * s, 0.05);
        box.rotation.y = sx * 0.35;
        box.castShadow = true;
        g.add(box);
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.22, s * 0.16, 0.02, 24).rotateX(Math.PI / 2), boardMaterial({ id: 'rubber', color: '#0b0b0c' }));
        cone.position.set(0, -s * 0.1, s * 0.38);
        box.add(cone);
        animated.push((_dt, kick) => (cone.position.z = s * 0.38 + kick * 0.006));
      }
    }
  }
  if (b.cables !== 'hidden') {
    const cm = boardMaterial({ id: 'rubber', color: b.cables === 'colored' ? b.cableColor : '#111', glow: b.cables === 'colored' ? { color: b.cableColor, intensity: 0.25, beat: false } : null });
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * b.width * 0.18;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        const coil = b.cables === 'coiled' ? 0.02 : 0;
        pts.push(new THREE.Vector3(x + Math.sin(t * 40) * coil, top - t * (top - b.riser - 0.01) + Math.cos(t * 40) * coil * 0.3, b.depth * 0.45 + t * 0.15 + (b.cables === 'coiled' ? Math.cos(t * 40) * coil : 0)));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.004, 6), cm);
      g.add(tube);
    }
  }
  if (b.sideScreens) {
    for (const sx of [-1, 1]) {
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#3ad7ff', emissiveIntensity: 0.4 }));
      scr.position.set(sx * (b.width / 2 + 0.9), top + 0.5, -0.1);
      scr.rotation.y = sx * -0.5 + Math.PI;
      g.add(scr);
      const sm = scr.material as THREE.MeshStandardMaterial;
      animated.push((_dt, kick, vibe) => (sm.emissiveIntensity = 0.25 + kick * 0.5 * vibe));
    }
  }
  return { group: g, top, update: (dt, kick, vibe) => animated.forEach((f) => f(dt, kick, vibe)) };
}
