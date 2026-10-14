/*
 * Backstage, for the walk out to the booth (ui/WalkOut.ts): the corridor
 * from the dressing room to the stage door. Block walls with a stripe in the
 * venue's colour, strip lights overhead, cables along the floor, flight cases,
 * the night's flyer on the walls, the running order on a clipboard, and at
 * the end the stage door with the room's light round its edges, swinging open
 * as you get there.
 *
 * The timing of the walk (where you are, where the camera is, when the door
 * opens) is plain maths here so it can be checked without a screen.
 */
import * as THREE from 'three';
import { glowTexture } from './menu3d';

/** the corridor: half its width, its height, and where its ends are (you walk towards -z) */
export const HALL = { half: 1.15, height: 2.8, back: 2.6, door: -12.2 };

/** the walk: where you start, how fast you go, when you set off, how long it all takes */
export const WALK = { from: 0.6, speed: 1.9, setOff: 0.35, ramp: 0.6, length: 6.8, stride: 1.55 };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** how fast you're walking at `t` (m/s): from a standstill up to pace */
export function walkSpeed(t: number): number {
  return WALK.speed * Math.min(1, Math.max(0, (t - WALK.setOff) / WALK.ramp));
}

/** where you are along the corridor at `t` (z) */
export function walkerZ(t: number): number {
  const u = t - WALK.setOff;
  if (u <= 0) return WALK.from;
  const d = u < WALK.ramp ? (WALK.speed * u * u) / (2 * WALK.ramp) : WALK.speed * (WALK.ramp / 2 + u - WALK.ramp);
  return WALK.from - d;
}

/** how far open the stage door is (0..1) */
export function doorOpen(t: number): number {
  return smooth(4.3, 5.4, t);
}

/** the white-out into the room at the end (0..1) */
export function flashAt(t: number): number {
  return smooth(WALK.length - 0.7, WALK.length, t);
}

/** when the film cuts from in front of you to behind you */
export const CUT = 2.4;

/**
 * The camera at `t`: in front of you as you set off (backing away down the
 * corridor, looking at you), then a cut to over your right shoulder, following
 * you to the door and pushing in as it opens. Always inside the corridor.
 */
export function shotAt(t: number): { pos: [number, number, number]; look: [number, number, number] } {
  const z = walkerZ(t);
  if (t < CUT) {
    // a slow drift across as it backs away
    const k = t / CUT;
    return { pos: [0.5 - 0.25 * k, 1.5, z - 2.5 + 0.2 * k], look: [0.05, 1.42, z] };
  }
  const push = smooth(4.6, WALK.length, t);
  const sway = 0.04 * Math.sin(t * 1.7);
  const back = 1.75 - 0.55 * push;
  const pos: [number, number, number] = [0.42 - 0.12 * push + sway, 1.68 - 0.1 * push, z + back];
  // the way ahead, settling on the door
  const ahead: [number, number, number] = [0, 1.35, z - 4];
  const door: [number, number, number] = [0, 1.3, HALL.door];
  const look = ahead.map((v, i) => lerp(v, door[i], push * 0.7)) as [number, number, number];
  return { pos, look };
}

export interface Backstage {
  /** the two halves of the stage door, hinged at the walls */
  doors: [THREE.Object3D, THREE.Object3D];
  /** the room's light behind the door */
  spill: THREE.PointLight;
  roomGlow: THREE.MeshBasicMaterial;
  /** the strip lights (one flickers) */
  tubes: { mat: THREE.MeshStandardMaterial; light: THREE.PointLight }[];
  update(t: number, dt: number): void;
}

/** text on a canvas, for the signs */
function signTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface BackstageOptions {
  /** the venue's colour */
  ui: string;
  venueName: string;
  /** the night's flyer, for the posters (none: plain gig posters) */
  flyer: HTMLCanvasElement | null;
  /** the running order on the clipboard: your slot is the one marked */
  bill: { dj: string; slot: string; minutes: number };
}

export function buildBackstage(scene: THREE.Scene, o: BackstageOptions): Backstage {
  const { half, height, back, door } = HALL;
  const len = back - door;
  const mid = (back + door) / 2;
  const venueCol = new THREE.Color(o.ui);
  scene.background = new THREE.Color(0x07080b);
  scene.fog = new THREE.Fog(0x07080b, 6, 22);
  scene.environmentIntensity = 0.25;
  scene.add(new THREE.HemisphereLight(0x9aa6c0, 0x1a1712, 0.35));

  /* the corridor ------------------------------------------------------------------------------- */
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.92 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x232326, roughness: 0.6, metalness: 0.05 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, len), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = mid;
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, len), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, height, mid);
  scene.add(floor, ceil);
  for (const k of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, height), wallMat);
    wall.rotation.y = (-k * Math.PI) / 2;
    wall.position.set(k * half, height / 2, mid);
    // a stripe in the venue's colour at hand height, and a dark skirting
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.08, len), new THREE.MeshStandardMaterial({ color: venueCol, roughness: 0.5, emissive: venueCol, emissiveIntensity: 0.25 }));
    stripe.position.set(k * (half - 0.005), 1.05, mid);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, len), new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7 }));
    skirt.position.set(k * (half - 0.01), 0.06, mid);
    // the cable run along the wall
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.45 }));
    cable.position.set(k * (half - 0.07), 0.02, mid);
    scene.add(wall, stripe, skirt, cable);
  }
  // the dressing-room end: a wall with its door, a star on it
  {
    const end = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, height), wallMat);
    end.rotation.y = Math.PI;
    end.position.set(0, height / 2, back);
    const dr = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 2.1),
      new THREE.MeshStandardMaterial({
        roughness: 0.6,
        map: signTexture(180, 420, (g, w, h) => {
          g.fillStyle = '#4a3b30';
          g.fillRect(0, 0, w, h);
          g.strokeStyle = '#2c231c';
          g.lineWidth = 6;
          g.strokeRect(14, 14, w - 28, h - 28);
          g.fillStyle = '#f2d36b';
          g.font = '700 64px system-ui, sans-serif';
          g.textAlign = 'center';
          g.fillText('★', w / 2, 120);
        }),
      }),
    );
    dr.rotation.y = Math.PI;
    dr.position.set(0, 1.05, back - 0.01);
    scene.add(end, dr);
  }
  // tape on the floor down the middle, every couple of metres an arrow
  {
    const tape = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.8 });
    for (let z = back - 1.5; z > door + 1; z -= 2.2) {
      const arrow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 3), tape);
      arrow.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
      arrow.position.set(0, 0.002, z);
      arrow.scale.set(1, 0.55, 1);
      scene.add(arrow);
    }
  }
  // flight cases by the dressing room
  {
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.55 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.3, metalness: 0.9 });
    const box = (w: number, hgt: number, d: number, x: number, y: number, z: number, ry = 0) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), caseMat));
      for (const sy of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.025, d + 0.01), trim);
        edge.position.y = (sy * (hgt - 0.025)) / 2;
        g.add(edge);
      }
      g.position.set(x, y + hgt / 2, z);
      g.rotation.y = ry;
      scene.add(g);
    };
    box(0.62, 0.55, 0.5, -half + 0.36, 0, 1.2, 0.08);
    box(0.5, 0.42, 0.42, -half + 0.32, 0.55, 1.18, -0.06);
    box(0.7, 0.7, 0.5, half - 0.4, 0, -4.6, -0.05);
  }

  /* the walls' paper: the flyer twice, and the running order -------------------------------- */
  {
    const poster = (x: number, z: number, side: 1 | -1, tex: THREE.Texture, w: number, h: number, tilt = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
      m.rotation.set(0, (side * -Math.PI) / 2, tilt);
      m.position.set(x, 1.55, z);
      scene.add(m);
    };
    const flyer = o.flyer
      ? (() => {
          const t = new THREE.CanvasTexture(o.flyer);
          t.colorSpace = THREE.SRGBColorSpace;
          return t;
        })()
      : signTexture(300, 400, (g, w, h) => {
          const grad = g.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, o.ui);
          grad.addColorStop(1, '#0a0a0e');
          g.fillStyle = grad;
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#fff';
          g.textAlign = 'center';
          g.font = '800 34px system-ui, sans-serif';
          g.fillText(o.venueName.toUpperCase().slice(0, 16), w / 2, h * 0.45);
          g.font = '600 22px system-ui, sans-serif';
          g.fillText(`tonight: ${o.bill.dj}`, w / 2, h * 0.58);
        });
    poster(-half + 0.012, -2.4, -1, flyer, 0.6, 0.8, 0.03);
    poster(-half + 0.012, -3.2, -1, flyer, 0.6, 0.8, -0.02);
    poster(half - 0.012, -7.8, 1, flyer, 0.6, 0.8, 0.02);
    // the running order, on a clipboard by the dressing room door
    const slots = ['Doors', o.bill.slot, 'Lights up'];
    const sheet = signTexture(320, 440, (g, w, h) => {
      g.fillStyle = '#7a5a3a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f6f3ea';
      g.fillRect(18, 44, w - 36, h - 62);
      g.fillStyle = '#b8bcc4';
      g.fillRect(w / 2 - 60, 14, 120, 40);
      g.fillStyle = '#111';
      g.textAlign = 'left';
      g.font = '800 26px system-ui, sans-serif';
      g.fillText('RUNNING ORDER', 34, 96);
      g.font = '500 18px system-ui, sans-serif';
      g.fillText(o.venueName.slice(0, 26), 34, 124);
      slots.forEach((s, i) => {
        const y = 180 + i * 64;
        const you = i === 1;
        if (you) {
          g.fillStyle = 'rgba(255, 226, 60, 0.75)';
          g.fillRect(28, y - 30, w - 56, 52);
        }
        g.fillStyle = '#111';
        g.font = `${you ? 800 : 500} 21px system-ui, sans-serif`;
        g.fillText(s, 38, y);
        g.font = '500 17px system-ui, sans-serif';
        g.fillText(you ? `${o.bill.dj} · ${o.bill.minutes} min` : i === 0 ? 'Crew call' : 'House lights', 38, y + 20);
      });
      g.strokeStyle = '#c2272d';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(w - 64, 180 + 64 - 6, 30, 0, Math.PI * 2);
      g.stroke();
    });
    poster(half - 0.015, 0.9, 1, sheet, 0.32, 0.44, 0.04);
  }

  /* the strip lights ------------------------------------------------------------------------------- */
  const tubeGeo = new THREE.BoxGeometry(0.1, 0.04, 1.2);
  const tubes: Backstage['tubes'] = [];
  for (let z = back - 1.2; z > door + 0.8; z -= 3.1) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f0ff, emissiveIntensity: 2.2 });
    const tube = new THREE.Mesh(tubeGeo, mat);
    tube.position.set(0, height - 0.03, z);
    const light = new THREE.PointLight(0xdfe8ff, 5, 6, 1.6);
    light.position.set(0, height - 0.25, z);
    scene.add(tube, light);
    tubes.push({ mat, light });
  }

  /* the stage door --------------------------------------------------------------------------------- */
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.5, metalness: 0.4 });
  const barMat = new THREE.MeshStandardMaterial({ color: 0xb0b4bc, roughness: 0.3, metalness: 0.9 });
  const doors: THREE.Object3D[] = [];
  for (const k of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(k * 0.95, 0, door);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.94, 2.3, 0.05), doorMat);
    leaf.position.set(-k * 0.47, 1.15, 0);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8).rotateZ(Math.PI / 2), barMat);
    bar.position.set(-k * 0.5, 1.05, 0.06);
    // a porthole onto the room
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshBasicMaterial({ color: venueCol, toneMapped: false }));
    port.position.set(-k * 0.47, 1.65, 0.027);
    hinge.add(leaf, bar, port);
    scene.add(hinge);
    doors.push(hinge);
  }
  // the frame, the wall round it, and the STAGE sign over it
  {
    const wallUp = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, height - 2.35), wallMat);
    wallUp.position.set(0, 2.35 + (height - 2.35) / 2, door - 0.001);
    scene.add(wallUp);
    for (const k of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.PlaneGeometry(half - 0.97, 2.35), wallMat);
      jamb.position.set(k * (0.97 + (half - 0.97) / 2), 2.35 / 2, door - 0.001);
      scene.add(jamb);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.24),
      new THREE.MeshBasicMaterial({
        toneMapped: false,
        map: signTexture(360, 96, (g, w, h) => {
          g.fillStyle = '#120405';
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#ff3340';
          g.shadowColor = '#ff3340';
          g.shadowBlur = 14;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.font = '800 50px system-ui, sans-serif';
          g.fillText('STAGE ▸', w / 2, h / 2 + 2);
        }),
      }),
    );
    sign.position.set(0, 2.52, door + 0.03);
    const name = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.16),
      new THREE.MeshBasicMaterial({
        transparent: true,
        toneMapped: false,
        map: signTexture(640, 64, (g, w, h) => {
          g.fillStyle = o.ui;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.font = '700 34px system-ui, sans-serif';
          g.fillText(o.venueName.toUpperCase(), w / 2, h / 2);
        }),
      }),
    );
    name.position.set(0, 2.72, door + 0.03);
    scene.add(sign, name);
  }
  // the room behind it: light, and the haze in it
  const roomGlow = new THREE.MeshBasicMaterial({ color: venueCol.clone().lerp(new THREE.Color(0xffffff), 0.35), toneMapped: false });
  const room = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), roomGlow);
  room.position.set(0, 1.6, door - 1.6);
  scene.add(room);
  const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: venueCol, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }));
  haze.scale.set(4.5, 3.2, 1);
  haze.position.set(0, 1.3, door + 0.3);
  scene.add(haze);
  // light round the edges of the shut door
  const crack = new THREE.Mesh(new THREE.PlaneGeometry(1.96, 2.36), new THREE.MeshBasicMaterial({ color: venueCol, toneMapped: false }));
  crack.position.set(0, 1.17, door - 0.04);
  scene.add(crack);
  // the room's lights sweeping about past the door
  const beamMat = new THREE.MeshBasicMaterial({ color: venueCol, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const beams: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.35, 5, 16, 1, true).translate(0, -2.5, 0), beamMat);
    beam.position.set(-1.5 + i, 3.2, door - 1.2);
    scene.add(beam);
    beams.push(beam);
  }
  const spill = new THREE.PointLight(venueCol, 1.5, 9, 1.4);
  spill.position.set(0, 1.6, door + 0.4);
  scene.add(spill);

  let flick = 0;
  return {
    doors: [doors[0], doors[1]],
    spill,
    roomGlow,
    tubes,
    update(t, dt) {
      const k = doorOpen(t);
      // each leaf swings out into the room
      doors[0].rotation.y = k * 1.7;
      doors[1].rotation.y = -k * 1.7;
      spill.intensity = 1.5 + k * 26;
      spill.distance = 9 + k * 6;
      (haze.material as THREE.SpriteMaterial).opacity = k * 0.8;
      crack.visible = k < 0.04;
      beams.forEach((b, i) => {
        b.rotation.z = Math.sin(t * 1.3 + i * 1.7) * 0.6;
        b.rotation.x = Math.cos(t * 0.9 + i) * 0.3 - 0.2;
      });
      // the light pulses with the room once the door's open
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * (124 / 60));
      roomGlow.color.copy(venueCol).lerp(new THREE.Color(0xffffff), 0.3 + 0.25 * pulse * k);
      // one tube near the door never quite works
      flick -= dt;
      const bad = tubes[tubes.length - 1];
      if (bad) {
        if (flick < 0) flick = 0.05 + Math.random() * (Math.random() < 0.2 ? 0.08 : 1.4);
        const on = flick > 0.06 || Math.random() > 0.5;
        bad.mat.emissiveIntensity = on ? 2.2 : 0.2;
        bad.light.intensity = on ? 5 : 0.4;
      }
    },
  };
}
