/*
 * What happens over the crowd's heads on a HELL YEAH: giant beach balls (and
 * now and then an inflatable flamingo) the crowd keeps punching back up, and
 * someone crowd-surfing to the front, arms out, carried on hands. Only where there's a proper crowd: the venue's crowd
 * says where its dancers stand (Crowd's userData.crowd).
 */
import * as THREE from 'three';
import { Avatar, type AvatarInput } from '../character/Avatar';
import { defaultLook, randomize } from '../character/look';

interface Ball {
  mesh: THREE.Object3D;
  /** the flamingo turns slowly instead of tumbling */
  float?: boolean;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

/** big inflatables float: gravity is gentle and the air slows them */
const GRAVITY = 4.2;
const DRAG = 0.35;
const RADIUS = 0.6;
/** hands reach about this high above the crowd's floor */
const REACH = 2.05;
const MAX_BALLS = 4;

function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  const cols = ['#ffffff', '#ff2a3c', '#ffd23f', '#2e7dff', '#3dff7a', '#ff7a1a'];
  cols.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect((i * 256) / cols.length, 0, 256 / cols.length + 1, 64);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** an inflatable flamingo, about 1.5 m long, in glossy pink vinyl */
function flamingo(): THREE.Group {
  const g = new THREE.Group();
  const pink = new THREE.MeshStandardMaterial({ color: 0xff5fa2, roughness: 0.28 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), pink);
  body.scale.set(1.25, 0.7, 0.8);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 16), pink);
  tail.rotation.z = Math.PI / 2 + 0.5;
  tail.position.set(-0.7, 0.12, 0);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.45, 0.15, 0), new THREE.Vector3(0.7, 0.55, 0), new THREE.Vector3(0.55, 0.95, 0), new THREE.Vector3(0.7, 1.25, 0)]);
  const neck = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.09, 12), pink);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), pink);
  head.position.set(0.74, 1.3, 0);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 12), dark);
  beak.rotation.z = -Math.PI / 2 - 0.6;
  beak.position.set(0.9, 1.22, 0);
  for (const z of [-0.09, 0.09]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), dark);
    eye.position.set(0.82, 1.36, z * 1.2);
    g.add(eye);
  }
  g.add(body, tail, neck, head, beak);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

export class PartyProps {
  readonly group = new THREE.Group();
  private balls: Ball[] = [];
  private box: THREE.Box3 | null = null;
  private ballGeo = new THREE.SphereGeometry(RADIUS, 28, 18);
  private ballMat: THREE.MeshStandardMaterial | null = null;
  private surfer: Avatar | null = null;
  private carrier = new THREE.Group();
  private surf: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;

  constructor() {
    this.group.add(this.carrier);
    this.carrier.visible = false;
  }

  /** a new venue: find its dancing crowd (the biggest one) */
  setVenue(venue: THREE.Object3D | null): void {
    for (const b of this.balls) this.disposeBall(b);
    this.balls = [];
    this.surf = null;
    this.carrier.visible = false;
    this.box = null;
    if (!venue) return;
    venue.updateMatrixWorld(true);
    let best = 0;
    venue.traverse((o) => {
      const c = o.userData.crowd as { box: THREE.Box3; count: number } | undefined;
      if (c && c.count > best) {
        best = c.count;
        this.box = c.box.clone().applyMatrix4(o.matrixWorld);
      }
    });
    // the surfer is built now, so the moment itself doesn't stall
    if (this.box && !this.surfer) {
      let s = Math.floor(Math.random() * 1e9);
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      this.surfer = new Avatar(randomize(defaultLook('surfer', 'Crowd surfer'), 'all', r, { tier: 7, unlocked: [], sandbox: true, setsPlayed: 99 }));
      this.surfer.mode = 'surf';
      // lying on their back, head towards the booth
      this.surfer.object.rotation.x = -Math.PI / 2;
      const turn = new THREE.Group();
      turn.rotation.y = Math.PI;
      turn.add(this.surfer.object);
      this.carrier.add(turn);
    }
  }

  /** is there a crowd to throw things at? */
  get hasCrowd(): boolean {
    return !!this.box;
  }

  /** beach balls into the crowd, from the front */
  launch(n = 2): void {
    const box = this.box;
    if (!box) return;
    this.ballMat ??= new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.35 });
    // now and then a flamingo comes along with the balls
    const bird = Math.random() < 0.5;
    for (let i = 0; i < n + (bird ? 1 : 0); i++) {
      if (this.balls.length >= MAX_BALLS + 1) this.disposeBall(this.balls.shift()!);
      const float = bird && i === n;
      const mesh = float ? flamingo() : new THREE.Mesh(this.ballGeo, this.ballMat);
      mesh.castShadow = true;
      const x = THREE.MathUtils.lerp(box.min.x, box.max.x, 0.25 + Math.random() * 0.5);
      mesh.position.set(x, box.min.y + REACH + 1.2, box.max.z - 0.5);
      this.group.add(mesh);
      this.balls.push({ mesh, float, v: new THREE.Vector3((Math.random() - 0.5) * 1.5, 3.5, -2.5 - Math.random() * 1.5), spin: new THREE.Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 3), life: 28 + Math.random() * 8 });
    }
  }

  private disposeBall(b: Ball): void {
    b.mesh.removeFromParent();
    // the flamingo owns its meshes; the balls share one geometry and material
    if (b.float)
      b.mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
  }

  /** someone crowd-surfs from the back to the front, on the side away from a camera standing in the crowd */
  sendSurfer(avoid?: THREE.Vector3): void {
    const box = this.box;
    if (!box || !this.surfer || this.surf) return;
    const depth = box.max.z - box.min.z;
    const width = box.max.x - box.min.x;
    if (depth < 4 || width < 3) return;
    let x = THREE.MathUtils.lerp(box.min.x, box.max.x, 0.3 + Math.random() * 0.4);
    if (avoid) {
      x = avoid.x > (box.min.x + box.max.x) / 2 ? box.min.x + width * 0.22 : box.max.x - width * 0.22;
      // too narrow a room to pass the camera at a distance: no surfer
      if (Math.abs(x - avoid.x) < 2) return;
    }
    const y = box.min.y + REACH + 0.12;
    this.surf = { from: new THREE.Vector3(x, y, box.min.z + depth * 0.35), to: new THREE.Vector3(x * 0.6, y, box.max.z - 0.8), t: 0, dur: 9 };
    this.carrier.visible = true;
  }

  update(s: AvatarInput, dt: number): void {
    const box = this.box;
    if (!box) return;
    const h = Math.min(dt, 0.05);
    const head = box.min.y + REACH + RADIUS;
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      const p = b.mesh.position;
      b.life -= h;
      b.v.y -= GRAVITY * h;
      b.v.multiplyScalar(1 - DRAG * h);
      p.addScaledVector(b.v, h);
      const over = p.x > box.min.x && p.x < box.max.x && p.z > box.min.z && p.z < box.max.z;
      // a hand punches it back up, nudging it back over the crowd if it's drifting off
      if (over && p.y < head && b.v.y < 0 && b.life > 0) {
        b.v.y = 3 + Math.random() * 1.8 + s.kick * 0.8;
        b.v.x = (Math.random() - 0.5) * 2.2 + (cx - p.x) * 0.15;
        b.v.z = (Math.random() - 0.5) * 2.2 + (cz - p.z) * 0.15;
        b.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      }
      if (b.float) {
        // the flamingo bobs upright-ish, turning slowly
        b.mesh.rotation.y += b.spin.y * 0.15 * h;
        b.mesh.rotation.x = Math.sin(b.life * 1.3) * 0.35;
        b.mesh.rotation.z = Math.sin(b.life * 0.9) * 0.3;
      } else {
        b.mesh.rotation.x += b.spin.x * h;
        b.mesh.rotation.y += b.spin.y * h;
        b.mesh.rotation.z += b.spin.z * h;
      }
      // nobody catches it any more: it sinks into the crowd and is gone
      if (p.y < box.min.y + 1.2) {
        this.disposeBall(b);
        this.balls.splice(i, 1);
      }
    }
    const sf = this.surf;
    if (sf && this.surfer) {
      sf.t += h;
      const k = Math.min(1, sf.t / sf.dur);
      const e = k * k * (3 - 2 * k);
      this.carrier.position.lerpVectors(sf.from, sf.to, e);
      // carried on hands: bobbing and rocking
      this.carrier.position.y += Math.sin(sf.t * 6.5) * 0.06 + Math.sin(sf.t * 2.3) * 0.04;
      this.carrier.rotation.z = Math.sin(sf.t * 1.7) * 0.18;
      this.carrier.rotation.y = Math.sin(sf.t * 0.9) * 0.25;
      this.surfer.update(s, dt);
      if (k >= 1) {
        this.surf = null;
        this.carrier.visible = false;
      }
    }
  }

  dispose(): void {
    this.setVenue(null);
    this.ballGeo.dispose();
    this.ballMat?.map?.dispose();
    this.ballMat?.dispose();
    this.surfer?.dispose();
  }
}
