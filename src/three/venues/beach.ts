/*
 * The Beach Club Terrace (Section 5.2): capacity 2,000. Wooden decking, palm
 * trees, white sun loungers on the sand and the sea right behind the booth.
 * The set runs from late afternoon through the sunset (warm amber) into
 * night, when the palms are uplit. Open air, soft and warm (audio/room.ts),
 * waves on the shore. Linen, swimwear and sunglasses: holiday mood.
 *
 * Signature moment: the sun hangs just above the sea until you drop a track,
 * then touches the water on the drop. The crowd stops to watch, then loses it.
 *
 * TODO: procedural stand-in for the Blender beach club set (Section 14).
 */
import * as THREE from 'three';
import { nameStyleFor } from '../../name/venueStyles';
import type { Features } from '../../visualizer/AudioFeatures';
import type { VenueDef, VenueViews } from './base';
import { barCounter, boothClutter } from './details';
import { FarCrowd, scatter } from './farcrowd';
import { atBar, crewArc, security, vipCrew } from './crew';
import { booth, Crowd, crowdArea, HazeLayer, LedStrings, MovingHeads, speaker, TABLE_Y } from './fixtures';
import { moments, setClock } from './moments';
import { OpenAir } from './openair';
import { lounger, palmTree, Water, type SkyKey, type SkyLook } from './outdoor';
import type { ShowState } from './show';
import { canvasTexture, rng, withSurface } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DECK = { x0: -16, x1: 16, z0: -32, z1: 3 };

export const BEACH_SKY: SkyKey[] = [
  { k: 0, zenith: '#4a8fd6', horizon: '#f6d8a8', ground: '#2a6a7a', sun: 16, sunColor: '#ffd08a', light: 2.8, ambSky: '#bcd4ee', ambGround: '#c8a878', amb: 0.7, stars: 0, night: 0 },
  { k: 0.3, zenith: '#3a6ab8', horizon: '#ffb070', ground: '#2a5a6a', sun: 6, sunColor: '#ffaa55', light: 2.4, ambSky: '#d8b8a8', ambGround: '#a8805a', amb: 0.58, stars: 0, night: 0 },
  { k: 0.5, zenith: '#2a3f88', horizon: '#ff7a3a', ground: '#1e3a4a', sun: 0.9, sunColor: '#ff6a2a', light: 1.6, ambSky: '#d88a6a', ambGround: '#6a4a3a', amb: 0.45, stars: 0, night: 0.15 },
  { k: 0.78, zenith: '#141a48', horizon: '#c8503a', ground: '#0e1a28', sun: 0.4, sunColor: '#ff4a2a', light: 0.9, ambSky: '#6a4a7a', ambGround: '#2a1e28', amb: 0.32, stars: 0.15, night: 0.5 },
  { k: 0.86, zenith: '#0c1036', horizon: '#6a2a40', ground: '#0a1220', sun: -3, sunColor: '#ff4a2a', light: 0, ambSky: '#3a3060', ambGround: '#141018', amb: 0.24, stars: 0.4, night: 0.8 },
  { k: 1, zenith: '#04060f', horizon: '#1a1a34', ground: '#050a12', sun: -10, sunColor: '#ff4a2a', light: 0, ambSky: '#18204a', ambGround: '#08080c', amb: 0.18, stars: 0.9, night: 1 },
];

function planks(): THREE.CanvasTexture {
  return canvasTexture(
    'beach-planks',
    512,
    512,
    (g, w, h) => {
      const r = rng(12);
      for (let x = 0; x < w; x += 32) {
        const v = 150 + r() * 40;
        g.fillStyle = `rgb(${v},${v * 0.74},${v * 0.52})`;
        g.fillRect(x, 0, 32, h);
        g.fillStyle = 'rgba(60,40,24,0.55)';
        g.fillRect(x, 0, 2, h);
        for (let i = 0; i < 6; i++) {
          g.fillStyle = `rgba(90,60,36,${0.08 + r() * 0.1})`;
          g.fillRect(x + 4 + r() * 22, r() * h, 1, 40 + r() * 120);
        }
        // butt joints
        g.fillStyle = 'rgba(60,40,24,0.5)';
        g.fillRect(x, r() * h, 32, 2);
      }
    },
    { repeat: true },
  );
}

function sand(): THREE.CanvasTexture {
  return canvasTexture(
    'beach-sand',
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#d8c09a';
      g.fillRect(0, 0, w, h);
      const r = rng(13);
      for (let i = 0; i < 4000; i++) {
        const v = 170 + r() * 70;
        g.fillStyle = `rgba(${v},${v * 0.85},${v * 0.66},0.5)`;
        g.fillRect(r() * w, r() * h, 1, 1);
      }
    },
    { repeat: true },
  );
}

class Beach extends OpenAir {
  readonly views: VenueViews = {
    // from the back of the deck: the booth, the sea and the sun behind it
    wide: { pos: V(-5.5, 3.6, -17), target: V(0.6, 1.8, 8) },
    wideLabel: 'Sunset over the booth',
    crowd: { pos: V(1.4, 1.8, -6.5), target: V(0, 1.6, 2.5) },
    drone: [V(0, 4, 8), V(8, 3.2, 4), V(14, 3.4, -6), V(10, 4.5, -22), V(0, 6, -30), V(-10, 4.5, -22), V(-14, 3.4, -6), V(-8, 3.2, 4), V(0, 2.6, 14)],
    extra: { cctv: { pos: V(15, 4.5, -30), target: V(0, 1, -4) }, crane: { radius: 5, low: 1.4, high: 4.2 } },
  };
  private water: Water;
  private crowd: Crowd;
  private farCrowd: FarCrowd;
  private palms: { trunk: THREE.MeshStandardMaterial; i: number }[] = [];
  private uplights: THREE.SpotLight[] = [];
  private leds: LedStrings;
  /** the signature moment: seconds since the sun met the drop (-1: not yet) */
  private sunsetT = -1;
  private sunFrom = 0;
  private lastProgress = 0;
  private cheered = false;
  private dayAmb = new THREE.Color();

  constructor() {
    super({ fog: 0xf6d8a8, fogDensity: 0.0016, hemiSky: 0xbcd4ee, hemiGround: 0xc8a878, hemi: 0.7, flashAt: V(0, 4, -6), flashRange: 24, sunYaw: 0.22, skyRadius: 900 }, BEACH_SKY);
    this.keyLight = { color: 0xffe0c0, intensity: 9 };
    this.grade = { tint: 0xfff0e0, contrast: 1.05, saturation: 1.12, lift: 0.002 };
    this.toneMapping = 'agx';
    const { x0, x1, z0, z1 } = DECK;

    // the deck
    const pt = planks();
    pt.repeat.set((x1 - x0) / 6, (z1 - z0) / 6);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0), withSurface(new THREE.MeshStandardMaterial({ map: pt, color: 0xcdb8a0 }), 'beach-deck', { bumps: 0.2, grain: 0.6, rough: 0.75, roughVar: 0.2, repeat: 6, normalScale: 0.5 }));
    deck.position.set(0, -0.15, (z0 + z1) / 2);
    deck.receiveShadow = true;
    this.group.add(deck);
    // the sand behind, down to the sea
    const st = sand();
    st.repeat.set(30, 12);
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(120, 40).rotateX(-Math.PI / 2 - 0.03), new THREE.MeshStandardMaterial({ map: st, roughness: 0.95 }));
    beach.position.set(0, -0.75, z1 + 18);
    this.group.add(beach);
    this.water = new Water(1800, { chop: 0.55, deep: '#0a3a4a', flow: [0, -0.4] });
    this.water.mesh.position.set(0, -1.05, 400);
    this.group.add(this.water.mesh);
    // foam where the waves break
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(120, 1.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf4f0e8, transparent: true, opacity: 0.55, depthWrite: false }));
    foam.position.set(0, -0.98, z1 + 27);
    foam.name = 'foam';
    this.group.add(foam);

    // the booth: a whitewashed riser with a timber front, a sail over it
    const nm = nameStyleFor('beach');
    const riser = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 3.4), new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.9 }));
    riser.position.set(0, -0.25 + 0.001, 1.2);
    this.group.add(riser);
    const b = booth({ w: 2.6, d: 0.85, front: new THREE.MeshStandardMaterial({ color: 0xa07a52, roughness: 0.8 }), strip: '#ffcf8a', name: nm.booth });
    this.group.add(b.group);
    this.strip(b.strip);
    boothClutter(this.group, 2.6, TABLE_Y, -0.42, 401);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 4.2, 8, 4), new THREE.MeshStandardMaterial({ color: 0xfaf8f2, roughness: 0.9, side: THREE.DoubleSide }));
    const sp = sail.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin((sp.getX(i) / 7.5 + 0.5) * Math.PI) * Math.sin((sp.getY(i) / 4.2 + 0.5) * Math.PI) * 0.5);
    sail.geometry.computeVertexNormals();
    sail.position.set(0, 4.1, 1.0);
    sail.rotation.x = -Math.PI / 2 + 0.12;
    this.group.add(sail);
    const timber = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
    for (const [x, z] of [
      [-3.6, 2.8],
      [3.6, 2.8],
      [-3.6, -0.8],
      [3.6, -0.8],
    ]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 4.4, 8), timber);
      post.position.set(x, 2.2, z);
      this.group.add(post);
    }
    for (const s of [-1, 1]) {
      const spk = speaker(0.6, 1.0, 0.55, 'mid', 0xe8e4dc);
      spk.position.set(s * 3.2, 0.5 + 0.5, -0.4);
      spk.rotation.y = Math.PI + s * 0.15;
      this.group.add(spk);
    }
    // your name hand-painted on a driftwood board over the bar
    if (nm.sign) this.nameSign(nm.sign, 3.4, 0.9, V(x0 + 0.35, 2.6, -16), Math.PI / 2, 1.2);
    const bar = barCounter(9, { glow: '#ffcf8a', body: 0x8a6a4a, top: 0xf0ece4, seed: 402 });
    bar.position.set(x0 + 1.2, 0, -16);
    bar.rotation.y = Math.PI / 2;
    this.group.add(bar);
    this.add(atBar(bar, 9, 407, { staff: 3, leaners: 4, clothes: ['#f4f1ea', '#7ac0d8', '#f28a6a', '#ffffff'] }));
    const crew = vipCrew(crewArc(0, 1.8, 2.8, 0.6, 2.4), 408, ['#ffffff', '#f4f1ea', '#f2d06a', '#c86a8a', '#7ac0d8']);
    if (crew) this.add(crew);
    this.add(security([{ x: -2.9, z: -1.05 }, { x: 2.9, z: -1.05 }], 409));

    // palms down both sides and on the sand
    let pi = 0;
    const palmAt = (x: number, z: number, y: number, hgt: number) => {
      const p = palmTree(Math.round(x * 31 + z * 17 + 400), hgt);
      p.group.position.set(x, y, z);
      this.group.add(p.group);
      this.palms.push({ trunk: p.trunk, i: pi++ });
      return p;
    };
    for (const z of [-28, -20, -12, -4]) {
      palmAt(x0 + 0.8, z, 0, 7 + ((z * 13) % 3));
      palmAt(x1 - 0.8, z + 3, 0, 7.5 + ((z * 7) % 2));
    }
    for (const [x, z] of [
      [-9, 7],
      [10, 9],
      [-20, 12],
      [22, 6],
      [-14, 16],
      [16, 15],
    ])
      palmAt(x, z, -0.7 - (z - 3) * 0.02, 8);
    // uplights at the foot of the palms nearest the booth
    for (const [x, z] of [
      [-9, 7],
      [10, 9],
      [x0 + 0.8, -4],
      [x1 - 0.8, -1],
    ]) {
      const l = new THREE.SpotLight(0xffffff, 0, 14, 0.5, 0.6, 1.2);
      l.position.set(x + 0.6, 0.2, z - 0.4);
      l.target.position.set(x, 8, z);
      this.group.add(l, l.target);
      this.uplights.push(l);
    }
    // white loungers on the sand either side of the booth
    for (let i = 0; i < 12; i++) {
      const side = i < 6 ? -1 : 1;
      const k = i % 6;
      const lo = lounger();
      lo.position.set(side * (7 + (k % 3) * 2.2), -0.62 - (k > 2 ? 0.06 : 0), 6 + (k > 2 ? 4 : 0));
      lo.rotation.y = Math.PI + side * 0.1;
      this.group.add(lo);
    }
    // festoon lights along the deck's edges
    const leds = new LedStrings({ warm: '#ffc27a', size: 0.1, spacing: 0.55 });
    for (const x of [x0 + 0.3, x1 - 0.3]) {
      const pts: THREE.Vector3[] = [];
      for (let z = z0; z <= z1; z += 4) pts.push(V(x, 3 - Math.abs(Math.sin(z * 0.785)) * 0.4, z));
      leds.path(pts);
    }
    this.leds = this.add(leds.done());
    // a few moving heads on the canopy's frame for after dark
    this.add(new MovingHeads([-3, -1, 1, 3].map((x) => ({ pos: V(x, 3.9, 2.8) })), { length: 14, radius: 0.7, gain: 0.9, floorY: 0 }));
    this.wash(V(0, 3.6, -2), 0, 3, 14);
    this.wash(V(-8, 2.5, -14), 1, 3, 14);
    this.wash(V(8, 2.5, -20), 2, 3, 14);
    this.add(new HazeLayer(new THREE.Box3(V(x0, 0.5, z0), V(x1, 4, z1)), 3, 0.2));

    // the crowd: linen, swimwear, holiday colours
    const clothes = ['#f4f1ea', '#e8dcc4', '#7ac0d8', '#f28a6a', '#2a3a5a', '#f2d06a', '#ffffff', '#c86a8a', '#3a7a6a', '#d8b890'];
    this.crowd = new Crowd(crowdArea(x0 + 2, x1 - 2, -1.4, -10, 1.6, 403, { avoid: [new THREE.Box2(new THREE.Vector2(x0, -21), new THREE.Vector2(x0 + 3, -11))] }), { seed: 404, phones: 0.12, drinks: 0.45, signs: 2, clothes });
    this.group.add(this.crowd.object);
    const density = (x: number, z: number) => (Math.abs(x) > 14.5 ? 0 : z > -10 ? 0 : 1.9 - ((-10 - z) / 22) * 0.7);
    this.farCrowd = new FarCrowd(scatter(x0 + 1, x1 - 1, z0 + 0.5, -10, density, 405, [new THREE.Box2(new THREE.Vector2(x0, -21), new THREE.Vector2(x0 + 3, -11))]), { seed: 406, clothes, phones: 0.1, focus: V(0, 2, 0) });
    this.group.add(this.farCrowd.object);
  }

  /** the sun waits just above the sea for a drop, then touches it on the drop */
  protected shapeSky(l: SkyLook, s: ShowState, dt: number): void {
    const k = setClock.progress;
    if (k < this.lastProgress - 0.2) {
      this.sunsetT = -1;
      this.cheered = false;
    }
    this.lastProgress = k;
    if (this.sunsetT < 0) {
      // waiting: hovering a hair above the water from mid-set until the drop (or until it's late)
      if (k >= 0.48 && k < 0.8) l.sun = Math.max(l.sun, 0.75 - (k - 0.48) * 0.8);
      if (s.dropHit && l.sun <= 1.3 && l.sun > 0 && s.hype > 0.55) {
        this.sunsetT = 0;
        this.sunFrom = l.sun;
        moments.emit({ venue: 'beach', label: 'The sun touches the sea', crowd: 'whoa' });
      }
    } else {
      this.sunsetT += dt;
      const t = Math.min(1, this.sunsetT / 9);
      const e = t * t * (3 - 2 * t);
      l.sun = Math.min(l.sun, this.sunFrom + (-1.4 - this.sunFrom) * e);
      // the sky flares as it goes
      const flare = Math.exp(-Math.pow(this.sunsetT - 4, 2) / 8) * 0.6;
      l.horizon.lerp(l.sunColor, flare * 0.5);
    }
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    const l = this.look;
    const night = l.night;
    this.water.update(this.time, l, this.sky.sunDir, this.fog);
    this.water.u.uGlintAmt.value = night * 0.5;
    (this.water.u.uGlints.value as THREE.Color).copy(s.colors[0]).lerp(new THREE.Color(1, 0.75, 0.45), 0.5);
    // palms uplit in the show's colours after dark
    for (const p of this.palms) p.trunk.emissive.copy(s.colors[p.i % 3]).multiplyScalar(night * 0.12 * (0.6 + 0.4 * s.master));
    this.uplights.forEach((u, i) => {
      u.color.copy(s.colors[i % 3]);
      u.intensity = night * 60 * (0.5 + 0.5 * s.master) * (0.8 + s.kick * 0.3);
    });
    this.leds.gain = 0.2 + night * 0.8;
    // daylight on the far crowd's cut-outs
    this.dayAmb.copy(l.ambSky).multiplyScalar(l.amb * 0.55).lerp(l.sunColor, Math.min(0.4, l.light * 0.1));
    this.farCrowd.ambient(this.dayAmb);
    // the signature moment: they stop to watch, then lose it
    let st = s;
    if (this.sunsetT >= 0 && this.sunsetT < 12) {
      if (this.sunsetT < 3.5) st = { ...s, hype: Math.min(s.hype, 0.22), peak: 0, drop: 0, dropHit: false };
      else {
        if (!this.cheered) {
          this.cheered = true;
          moments.emit({ venue: 'beach', label: 'They lose it', crowd: 'cheer' });
        }
        st = { ...s, hype: 1, peak: Math.max(s.peak, 0.9), dropHit: this.sunsetT - dt < 3.5 };
      }
    }
    this.crowd.update(st, dt, camera);
    this.farCrowd.update(st, dt);
  }
}

export const beach: VenueDef = {
  id: 'beach',
  name: 'Beach Club Terrace',
  short: 'Beach Club',
  place: 'On the coast',
  kind: 'Beach club · sunset terrace',
  blurb: 'Decking, palms and the sea behind the booth, from sunset into the night.',
  palette: ['#ff8a3a', '#ff4f7a', '#3ad7c8'],
  ui: '#ff8a3a',
  capacity: '2,000',
  build: () => new Beach(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h * 0.62);
    grad.addColorStop(0, '#2a3f88');
    grad.addColorStop(1, '#ff7a3a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h * 0.62);
    g.fillStyle = '#ffd08a';
    g.beginPath();
    g.arc(w * 0.55, h * 0.62, h * 0.11, Math.PI, 0);
    g.fill();
    const sea = g.createLinearGradient(0, h * 0.62, 0, h);
    sea.addColorStop(0, '#1e3a4a');
    sea.addColorStop(1, '#0a2030');
    g.fillStyle = sea;
    g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = 'rgba(255,170,90,0.7)';
    for (let i = 0; i < 9; i++) g.fillRect(w * 0.55 - (20 - i * 2), h * (0.65 + i * 0.03), 40 - i * 4, 1.5);
    g.strokeStyle = '#1a1210';
    g.lineWidth = 3;
    for (const [x, s] of [
      [0.12, 1],
      [0.86, -1],
    ]) {
      g.beginPath();
      g.moveTo(w * x, h);
      g.quadraticCurveTo(w * x + s * 8, h * 0.6, w * x + s * 4, h * 0.3);
      g.stroke();
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        g.moveTo(w * x + s * 4, h * 0.3);
        const a = (k / 6) * Math.PI * 2;
        g.quadraticCurveTo(w * x + s * 4 + Math.cos(a) * 20, h * 0.3 + Math.sin(a) * 8 - 6, w * x + s * 4 + Math.cos(a) * 30, h * 0.3 + Math.sin(a) * 10 + 6);
        g.stroke();
      }
    }
  },
};
