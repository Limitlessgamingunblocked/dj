/*
 * Boiler Room — an outdoor night session in downtown LA, as in the reference
 * photo: the crowd packed in all around (and behind) the DJ, phones up, the
 * red neon ring sign hanging on wires over them, a truss tower with a hot
 * lamp, trees and the lit City Hall tower behind, and the stream camera in
 * front of the decks with a monitor showing the live feed.
 */
import * as THREE from 'three';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { booth, boxUV, Crowd, crowdArea, floor, Lasers, MovingHeads, Strobes, truss } from './fixtures';
import { floorTexture, foliageTexture, neonTextTexture, rng, skyTexture, windowsTexture } from './tex';
import { silhouettes } from './warehouse';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function building(w: number, h: number, d: number, key: string, lit: string, density: number, stone = 0x1a1c22): THREE.Mesh {
  const tex = windowsTexture(key, lit, density);
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 12), new THREE.MeshStandardMaterial({ color: stone, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.7, roughness: 0.9 }));
  m.position.y = h / 2;
  return m;
}

function tree(r: () => number, scale: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.26 * scale, 3.2 * scale, 8), new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1 }));
  trunk.position.y = 1.6 * scale;
  g.add(trunk);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2a3a1c, emissive: 0x1a0306, roughness: 1, map: foliageTexture(), flatShading: true });
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry((1.1 + r() * 0.9) * scale, 1), leaf);
    c.position.set((r() - 0.5) * 2.4 * scale, (3.6 + r() * 2.2) * scale, (r() - 0.5) * 2.4 * scale);
    g.add(c);
  }
  return g;
}

class BoilerRoom extends VenueBase {
  readonly views: VenueViews = {
    wide: { pos: V(-0.55, 1.52, -2.2), target: V(0.25, 2.0, 1.0) },
    wideLabel: 'Stream cam',
    crowd: { pos: V(-3.6, 2.5, -5.2), target: V(0, 1.3, 0.8) },
  };
  private neon: THREE.MeshBasicMaterial[] = [];
  private tally: THREE.MeshBasicMaterial;
  private beacons: THREE.MeshBasicMaterial[] = [];
  private lamp: THREE.SpotLight;
  private lampLens: THREE.MeshBasicMaterial;
  private flicker = 0;

  constructor() {
    super({ fog: 0x0a0406, fogDensity: 0.012, hemiSky: 0x4a1424, hemiGround: 0x080305, hemi: 0.5, flashAt: V(0, 5, 0), flashRange: 18 });
    this.keyLight = { color: 0xffc2c8, intensity: 12 };
    const r = rng(2024);

    // night sky and the plaza
    const sky = new THREE.Mesh(new THREE.SphereGeometry(110, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture('la', '#030409', '#0b0a14', '#3a1a22'), side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    this.group.add(sky);
    const ft = floorTexture('#15110f', 'plaza');
    ft.repeat.set(24, 24);
    this.group.add(floor(220, new THREE.MeshStandardMaterial({ map: ft, roughness: 0.75, metalness: 0.05 })));

    // City Hall behind the DJ, downtown towers all around
    const hall = new THREE.Group();
    const stone = 0x8e877c;
    const base = building(24, 16, 14, 'hall-base', '#fff1d0', 0.75, stone);
    hall.add(base);
    const shaft = building(9, 32, 9, 'hall-shaft', '#fff4dc', 0.85, stone);
    shaft.position.y += 16;
    hall.add(shaft);
    const crown = building(6.4, 7, 6.4, 'hall-crown', '#fff6e2', 0.9, stone);
    crown.position.y += 48;
    hall.add(crown);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 8, 4), new THREE.MeshStandardMaterial({ color: 0xb8b0a2, emissive: 0x3a352d, roughness: 0.8 }));
    roof.position.y = 59;
    roof.rotation.y = Math.PI / 4;
    hall.add(roof);
    hall.scale.setScalar(0.8);
    hall.position.set(-10, 0, 78);
    this.group.add(hall);
    const flood = new THREE.SpotLight(0xfff0dc, 900, 90, 0.35, 0.6, 1.2);
    flood.position.set(-10, 2, 52);
    flood.target.position.set(-10, 30, 78);
    this.group.add(flood, flood.target);
    const towers: [number, number, number, number, number][] = [
      [26, 34, 14, 30, 16],
      [40, 10, 12, 22, 12],
      [-34, 30, 16, 40, 14],
      [-44, -8, 12, 26, 12],
      [30, -46, 18, 48, 16],
      [-18, -58, 14, 36, 14],
      [8, -64, 20, 58, 18],
      [52, 60, 16, 36, 16],
      [18, 70, 14, 28, 14],
    ];
    towers.forEach(([x, z, w, h, d], i) => {
      const b = building(w, h, d, `la-${i}`, i % 3 ? '#ffe7b8' : '#cfe3ff', 0.3 + r() * 0.35);
      b.position.x = x;
      b.position.z = z;
      this.group.add(b);
      const beacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.05), toneMapped: false });
      const bm = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), beacon);
      bm.position.set(x, h + 0.4, z);
      this.group.add(bm);
      this.beacons.push(beacon);
    });

    // trees and street lamps around the plaza
    for (let i = 0; i < 16; i++) {
      const a = r() * Math.PI * 2;
      const d = 7 + r() * 10;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (z > 3 && Math.abs(x) < 9) continue;
      const t = tree(r, 0.9 + r() * 0.5);
      t.position.set(x, 0, z);
      this.group.add(t);
    }
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.9), toneMapped: false });
    const pole = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.6, roughness: 0.5 });
    for (const [x, z] of [
      [-14, -6],
      [14, -8],
      [-12, 12],
      [15, 10],
      [0, -18],
      [-22, 2],
    ]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5, 8), pole);
      p.position.set(x, 2.5, z);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), lampMat);
      bulb.position.set(x, 5.1, z);
      this.group.add(p, bulb);
    }

    // the booth: a long white-fronted table
    const b = booth({ w: 2.6, d: 0.9, front: new THREE.MeshStandardMaterial({ color: 0xe6e1dc, roughness: 0.7 }), top: 0x19191b, strip: null });
    this.group.add(b.group);

    // truss towers with the hot lamp and PARs
    const ta = V(2.45, 0, 2.3);
    const tb = V(-3.3, 0, -1.7);
    for (const t of [ta, tb]) {
      this.group.add(truss(t.clone(), t.clone().setY(4.6), 0.32));
      this.group.add(truss(t.clone().add(V(-0.5, 4.45, 0)), t.clone().add(V(0.5, 4.45, 0)), 0.22));
    }
    this.lamp = new THREE.SpotLight(0xffdede, 60, 16, 0.42, 0.55, 1.3);
    this.lamp.position.set(ta.x - 0.2, 4.2, ta.z - 0.2);
    this.lamp.target.position.set(0, 1.1, 0.2);
    this.group.add(this.lamp, this.lamp.target);
    this.lampLens = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 2.6), toneMapped: false });
    const lamp = new THREE.Group();
    lamp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.4, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x141418, metalness: 0.5, roughness: 0.4 })));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), this.lampLens);
    lens.position.z = 0.21;
    lamp.add(lens);
    lamp.position.copy(this.lamp.position);
    lamp.lookAt(this.lamp.target.position);
    this.group.add(lamp);
    const parMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.15, 0.2), toneMapped: false });
    for (const t of [ta, tb]) {
      for (let i = 0; i < 3; i++) {
        const par = new THREE.Mesh(new THREE.CircleGeometry(0.1, 14), parMat);
        par.position.set(t.x + 0.2, 1.6 + i * 0.9, t.z + (t.z > 0 ? -0.2 : 0.2));
        par.lookAt(0, 1.2, 0);
        this.group.add(par);
      }
    }
    this.add(new MovingHeads([{ pos: V(ta.x - 0.35, 4.35, ta.z) }, { pos: V(ta.x + 0.35, 4.35, ta.z) }, { pos: V(tb.x - 0.35, 4.35, tb.z), yaw: Math.PI * 0.8 }, { pos: V(tb.x + 0.35, 4.35, tb.z), yaw: Math.PI * 0.8 }], { length: 9, radius: 0.7 }));
    this.add(new Strobes([{ pos: V(ta.x, 3.9, ta.z - 0.25), tilt: -0.3 }, { pos: V(tb.x, 3.9, tb.z + 0.25), yaw: Math.PI, tilt: -0.3 }], [0.4, 0.14, 0.07]));
    this.add(
      new Lasers([
        { pos: V(ta.x, 4.7, ta.z), dir: V(-0.3, 0.05, -1), beams: 8, side: 1, color: '#ff1030', length: 26 },
        { pos: V(tb.x, 4.7, tb.z), dir: V(0.4, 0.05, 1), beams: 8, side: -1, color: '#ff1030', length: 26 },
      ]),
    );

    // the neon ring sign hanging on wires behind the DJ
    const sign = new THREE.Group();
    const neonA = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.25, 0.45), toneMapped: false });
    const neonB = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.35, 0.5), toneMapped: false });
    sign.add(new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.032, 10, 72), neonA), new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.018, 8, 72), neonB));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.06, 64), new THREE.MeshStandardMaterial({ color: 0x1a0508, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2 }));
    disc.position.z = -0.02;
    sign.add(disc);
    const text = new THREE.MeshBasicMaterial({ map: neonTextTexture('boiler-room', ['BOILER', 'ROOM'], '#ff2a4a'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.8, 1.4, 1.5), toneMapped: false });
    const tm = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.88), text);
    tm.position.z = 0.02;
    sign.add(tm);
    this.neon.push(neonA, neonB, text);
    sign.position.set(-1.45, 3.35, 2.75);
    sign.rotation.y = Math.PI;
    this.group.add(sign);
    const wg = new THREE.BufferGeometry().setFromPoints([V(-1.45, 4.4, 2.75), V(ta.x, 4.6, ta.z), V(-1.45, 4.4, 2.75), V(-6.5, 5.6, 4.5)]);
    this.group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a1a1c })));
    const glow = new THREE.PointLight(0xff2040, 4, 6, 1.6);
    glow.position.set(-1.45, 3.1, 2.3);
    this.group.add(glow);

    // the stream camera on its tripod, with a monitor showing the live feed
    const cam = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x121214, metalness: 0.6, roughness: 0.45 });
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.4, 6), metal);
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.22, 0.66, Math.sin(a) * 0.22);
      leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      cam.add(leg);
    }
    const bodyM = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.15, 0.28), metal);
    bodyM.position.y = 1.47;
    const lensM = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.2, 16).rotateX(Math.PI / 2), metal);
    lensM.position.set(0, 1.47, 0.22);
    this.tally = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 3, 0.4), toneMapped: false });
    const tallyM = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), this.tally);
    tallyM.position.set(0.05, 1.57, 0.1);
    cam.add(bodyM, lensM, tallyM);
    // linear HDR like the main pass; the output pass tone-maps the whole frame
    const target = new THREE.WebGLRenderTarget(320, 180, { type: THREE.HalfFloatType });
    const mon = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1125), new THREE.MeshBasicMaterial({ map: target.texture, toneMapped: true }));
    mon.position.set(0.16, 1.5, -0.08);
    mon.rotation.y = Math.PI + 0.5;
    const monBody = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.02), metal);
    monBody.position.set(0.165, 1.5, -0.07);
    monBody.rotation.y = 0.5;
    cam.add(monBody, mon);
    cam.position.set(-1.05, 0, -1.25);
    cam.lookAt(0.1, 0, 0.6);
    this.group.add(cam);
    const feedCam = new THREE.PerspectiveCamera(48, 16 / 9, 0.05, 200);
    feedCam.position.set(-1.05, 1.47, -1.1);
    feedCam.lookAt(0.15, 1.35, 0.8);
    this.feed = { camera: feedCam, target, screen: mon };

    // the crowd: all around and behind the DJ, phones up
    const clothes = ['#e9e6df', '#1b1d22', '#2a2d33', '#6b1d2a', '#bfae8e', '#101114', '#3a3f4a', '#8a2a2a', '#d6d2cb'];
    const spots = [
      // behind the DJ: guests with drinks, chatting and filming
      ...crowdArea(-3.8, 3.8, 1.1, 5.2, 2.7, 71, { avoid: [new THREE.Box2(new THREE.Vector2(2.0, 1.8), new THREE.Vector2(2.9, 2.8))], role: 'vip' }),
      ...crowdArea(-6, -1.65, -3.3, 1.05, 2.4, 72, { avoid: [new THREE.Box2(new THREE.Vector2(-3.8, -2.2), new THREE.Vector2(-2.8, -1.2))] }),
      ...crowdArea(1.65, 6, -3.3, 1.05, 2.4, 73),
      ...crowdArea(-6, 6, -3.4, -8, 1.4, 74),
    ];
    this.add(new Crowd(spots, { seed: 70, phones: 0.2, clothes }));

    this.wash(V(0, 3.4, 3.6), 0, 5, 10);
    this.wash(V(-3.6, 3.2, -2.6), 1, 4, 9);
    this.wash(V(3.6, 3.2, -2.6), 0, 4, 9);
    this.wash(V(0, 4, -6.5), 2, 3, 10, 0.5);
  }

  update(...args: Parameters<VenueBase['update']>): void {
    super.update(...args);
    const [s, , dt] = args;
    this.flicker = Math.max(0, this.flicker - dt);
    if (Math.random() < dt * 0.4) this.flicker = 0.05 + Math.random() * 0.08;
    const n = (this.flicker > 0 ? 0.35 : 1) * (0.6 + 0.4 * s.master);
    this.neon[0].color.setRGB(3.2 * n, 0.25 * n, 0.45 * n);
    this.neon[1].color.setRGB(2.6 * n, 0.35 * n, 0.5 * n);
    this.neon[2].color.setRGB(1.8 * n, 1.4 * n, 1.5 * n);
    const blink = Math.floor(s.t * 1.1) % 2 === 0;
    for (const b of this.beacons) b.color.setRGB(blink ? 3 : 0.3, 0.1, 0.05);
    this.tally.color.setRGB(0.2, s.playing ? 3 : 0.8, 0.4);
    this.lamp.intensity = (45 + s.kick * 30 + s.flash * 60) * s.master;
    this.lampLens.color.setRGB(3, 2.6, 2.6).multiplyScalar(0.3 + 0.7 * s.master);
  }
}

export const boilerRoom: VenueDef = {
  id: 'boilerroom',
  name: 'Boiler Room',
  place: 'Los Angeles, USA',
  kind: 'Outdoor session · livestream',
  blurb: 'A night session downtown: the crowd packed in around (and behind) you, phones up, the red neon ring on its wires, City Hall lit up behind, and the stream camera rolling in front of the decks. Try the Stream cam view.',
  palette: ['#ff1e3c', '#ff4d6d', '#ffe3e8'],
  ui: '#ff2d55',
  capacity: '400 · streaming live',
  note: 'You’re live on Boiler Room. Switch the camera to “Stream cam” to see the shot.',
  build: () => new BoilerRoom(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#07060d');
    grad.addColorStop(0.7, '#3a0a14');
    grad.addColorStop(1, '#1a0408');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // tower
    g.fillStyle = '#b8ae9c';
    g.fillRect(w * 0.13, h * 0.12, w * 0.07, h * 0.6);
    g.beginPath();
    g.moveTo(w * 0.13, h * 0.12);
    g.lineTo(w * 0.165, h * 0.02);
    g.lineTo(w * 0.2, h * 0.12);
    g.fill();
    // neon ring
    g.strokeStyle = '#ff2a4a';
    g.shadowColor = '#ff2a4a';
    g.shadowBlur = 14;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(w * 0.33, h * 0.32, h * 0.2, 0, Math.PI * 2);
    g.stroke();
    g.font = '900 17px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 1.2;
    g.strokeText('BOILER', w * 0.33, h * 0.3);
    g.strokeText('ROOM', w * 0.33, h * 0.38);
    g.shadowBlur = 0;
    const glow = g.createRadialGradient(w * 0.75, h * 0.1, 0, w * 0.75, h * 0.1, w * 0.5);
    glow.addColorStop(0, 'rgba(255,40,70,0.7)');
    glow.addColorStop(1, 'rgba(255,40,70,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    silhouettes(g, w, h, '#14040a', 23);
    g.fillStyle = '#3dff6a';
    g.beginPath();
    g.arc(w * 0.9, h * 0.62, 3, 0, Math.PI * 2);
    g.fill();
  },
};
