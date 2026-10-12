/*
 * The Hologram Room: a tall dark room full of projection haze, with a giant
 * hologram of you towering over the back of the crowd, copying your every
 * move at the decks, floating heads of people from the crowd that turn to
 * look around, and abstract shapes that the music draws and scales.
 *
 * The hologram is a second copy of your character, built from your current
 * look; each frame it takes every joint's pose from you, so the hands that
 * reach for a fader reach for it up there too.
 *
 *   modes    cyan, gold, rainbow, matrix
 *   pads     giant (the hologram grows), glitch, heads, scatter the shapes
 *   moments  rise (big: the hologram rises out of the floor), glitch (big),
 *            calm (deep: the heads all turn to the booth)
 *   stems    the shapes follow the drums, the hologram's light the melody,
 *            the heads the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import { Avatar, type BoneName } from '../../../character/Avatar';
import type { Look } from '../../../core/models';
import type { VenueDef } from '../base';
import { PERSON_BONES, PERSON_MATS, personGeometry } from '../crowd';
import type { ShowState } from '../show';
import { CrazyRoom, HUE_GLSL, V, type RoomAction, type RoomMoment } from './kit';

const W = 8;
const H = 9;
const D = 16;
const HOLO_Z = -13.5;

function holoMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.3, 0.9, 1.4) }, uTime: { value: 0 }, uGlitch: { value: 0 }, uGain: { value: 1 }, uMode: { value: 0 }, uHue: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime, uGlitch;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        // glitch: horizontal bands jump sideways
        float band = floor(wp.y * 3.0 + floor(uTime * 12.0));
        wp.x += uGlitch * (fract(sin(band * 78.2) * 4375.5) - 0.5) * 0.9 * step(0.6, fract(sin(band * 13.1 + floor(uTime * 8.0)) * 43.7));
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${HUE_GLSL}
      uniform vec3 uColor; uniform float uTime, uGain, uMode, uHue;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float scan = 0.65 + 0.35 * sin(vW.y * 60.0 - uTime * 6.0);
        float sweep = smoothstep(0.0, 0.08, abs(fract(vW.y * 0.08 - uTime * 0.25) - 0.5));
        vec3 c = uColor;
        if (uMode > 1.5 && uMode < 2.5) c = hsv(fract(vW.y * 0.06 + uTime * 0.05 + uHue), 0.8, 1.4);
        if (uMode > 2.5) c = vec3(0.2, 1.4, 0.4) * (0.5 + 0.5 * step(0.5, fract(vW.y * 8.0 + uTime)));
        float flicker = 0.92 + 0.08 * sin(uTime * 37.0);
        gl_FragColor = vec4(c * (0.12 + rim * 1.4) * scan * (0.6 + 0.4 * sweep) * flicker * uGain, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** a crowd member's head (with hair, ears and nose) out of the crowd's own model, as one geometry */
function headGeometry(): THREE.BufferGeometry {
  const g = personGeometry(0).toNonIndexed();
  const bone = g.attributes.aBone as THREE.BufferAttribute;
  const mat = g.attributes.aMat as THREE.BufferAttribute;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const keep: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const m = mat.getX(i);
    if (bone.getX(i) !== PERSON_BONES.head || m === PERSON_MATS.cap || m === PERSON_MATS.longHair || m === PERSON_MATS.hairUp) continue;
    for (let k = 0; k < 3; k++) keep.push(pos.getX(i + k), pos.getY(i + k) - 1.6, pos.getZ(i + k));
  }
  g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  out.computeVertexNormals();
  return out;
}

class HologramRoom extends CrazyRoom {
  readonly modes = ['Cyan', 'Gold', 'Rainbow', 'Matrix'];
  readonly actions: RoomAction[] = [
    { id: 'giant', label: 'Giant', kind: 'toggle' },
    { id: 'glitch', label: 'Glitch', kind: 'hit' },
    { id: 'heads', label: 'Heads', kind: 'toggle' },
    { id: 'scatter', label: 'Scatter shapes', kind: 'hit' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'rise', label: 'Your hologram rises out of the floor', energy: 'big' },
    { id: 'glitch', label: 'The holograms glitch', energy: 'big' },
    { id: 'calm', label: 'The heads all turn to the booth', energy: 'deep' },
  ];
  private holoMat = holoMaterial();
  private shapeMat = holoMaterial();
  private headMat = holoMaterial();
  private holo: Avatar | null = null;
  private dj: Avatar | null = null;
  private holoRoot = new THREE.Group();
  private heads: THREE.Mesh[] = [];
  private shapes: THREE.Mesh[] = [];
  private scale = 5;
  private rise = 1;
  private glitch = 0;
  private scatter = 0;

  constructor() {
    super({ roomId: 'hologram', roomName: 'Hologram Room', w: W, h: H, d: D, back: 3, fog: 0x02060c, fogDensity: 0.03, hemi: 0.18, hemiSky: 0x10304a, booth: { strip: '#5ae0ff' } });
    this.ambient = 0.4;
    // the signature angle: from the front corner, up at your hologram over the crowd
    this.views.wide = { pos: V(-6.2, 2.6, -1.8), target: V(0, 4.2, HOLO_Z) };
    this.views.wideLabel = 'Your hologram';
    const walls = new THREE.MeshStandardMaterial({ color: 0x05080d, roughness: 0.85, side: THREE.BackSide });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + 3), walls);
    shell.position.set(0, H / 2, (3 - D) / 2);
    this.group.add(shell);
    // the projector rig: a ring on the floor where the hologram stands
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.06, 8, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 2), toneMapped: false }));
    ring.position.set(0, 0.05, HOLO_Z);
    this.group.add(ring);
    this.holoRoot.position.set(0, 0, HOLO_Z);
    this.holoRoot.rotation.y = Math.PI;
    this.group.add(this.holoRoot);
    // floating heads over the sides of the room
    const hg = headGeometry();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(hg, this.headMat);
      m.scale.setScalar(5);
      m.position.set((i % 2 ? 1 : -1) * (W - 2), 5.2 + (i > 1 ? 0.8 : 0), -4 - Math.floor(i / 2) * 5.5);
      this.heads.push(m);
      this.group.add(m);
    }
    // the music's shapes, round the hologram
    const geos = [new THREE.TorusKnotGeometry(0.8, 0.22, 96, 12), new THREE.IcosahedronGeometry(0.9, 0), new THREE.OctahedronGeometry(0.9, 0), new THREE.TorusGeometry(0.9, 0.12, 8, 48), new THREE.DodecahedronGeometry(0.85, 0), new THREE.SphereGeometry(0.8, 16, 10)];
    geos.forEach((g, i) => {
      const m = new THREE.Mesh(g, this.shapeMat);
      this.shapes.push(m);
      this.group.add(m);
      m.userData.a = (i / geos.length) * Math.PI * 2;
    });
    this.wash(V(0, H - 1, HOLO_Z + 2), 0, 2, 14);
    this.wash(V(0, 2, -4), 1, 1.2, 9);
    this.people(0.85, 2201, { phones: 0.35, clothes: ['#101114', '#2b2d33', '#f2f2f2', '#5ae0ff', '#16171a', '#1d1f24'] });
  }

  /** build the hologram from your look (again when it changes) */
  attachDJ(dj: Avatar, look: Look): void {
    this.dj = dj;
    if (this.holo) {
      this.holoRoot.remove(this.holo.object);
      this.holo.dispose();
    }
    const holo = new Avatar(look);
    holo.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = this.holoMat;
    });
    holo.object.scale.setScalar(this.scale);
    this.holoRoot.add(holo.object);
    this.holo = holo;
  }

  protected onAction(id: string): void {
    if (id === 'scatter') this.scatter = 1;
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const t = this.time;
    const mode = this.look.mode;
    // copy your pose onto the hologram, joint by joint
    if (this.holo && this.dj) {
      for (const name of Object.keys(this.dj.bones) as BoneName[]) {
        const a = this.dj.bones[name];
        const b = this.holo.bones[name];
        if (!a || !b) continue;
        b.position.copy(a.position);
        b.quaternion.copy(a.quaternion);
      }
    }
    const giant = this.on('giant') ? 8 : 5;
    this.scale += (giant - this.scale) * Math.min(1, dt * 2);
    // the rise: up out of the floor on the moment
    const riseK = this.moment?.id === 'rise' ? Math.min(1, this.moment.t / 2.5) : 1;
    this.rise += (riseK - this.rise) * Math.min(1, dt * 4);
    if (this.holo) {
      this.holo.object.scale.setScalar(this.scale);
      this.holo.object.position.y = (this.rise - 1) * this.scale * 1.8 + Math.sin(t * 0.8) * 0.15 + 0.3;
    }
    const glitchWant = Math.max(this.since('glitch') < 0.8 ? 1 : 0, this.momentK('glitch'));
    this.glitch += (glitchWant - this.glitch) * Math.min(1, dt * 8);
    const melody = this.parts?.melody ?? s.high;
    const hue = mode === 1 ? new THREE.Color(1.4, 0.9, 0.3) : new THREE.Color(0.3, 0.9, 1.4);
    for (const m of [this.holoMat, this.shapeMat, this.headMat]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uMode.value = mode;
      m.uniforms.uHue.value = this.look.hue;
      m.uniforms.uGlitch.value = s.reduceFlash ? this.glitch * 0.4 : this.glitch;
      (m.uniforms.uColor.value as THREE.Color).copy(hue);
    }
    this.holoMat.uniforms.uGain.value = (0.7 + melody * 0.8) * (0.4 + 0.6 * s.master) * this.look.level;
    this.headMat.uniforms.uGain.value = (this.on('heads') || this.look.toggles.length === 0 ? 1 : 0.6) * (0.5 + this.drive.ceil * 0.8);
    // the heads look round the room, or all at the booth on the calm moment
    const calm = this.momentK('calm');
    this.heads.forEach((h, i) => {
      h.visible = !this.look.toggles.includes('heads') || this.on('heads');
      const look = Math.sin(t * 0.35 + i * 1.7) * 0.9;
      const toBooth = Math.atan2(0 - h.position.x, 0.5 - h.position.z);
      h.rotation.y = THREE.MathUtils.lerp(look + (h.position.x > 0 ? -1.2 : 1.2), toBooth, calm);
      h.position.y += Math.sin(t * 0.6 + i) * 0.002;
    });
    // the shapes orbit the hologram, scale with the drums, scatter on the pad
    this.scatter = Math.max(0, this.scatter - dt * 0.6);
    const sc = this.scatter;
    this.shapes.forEach((m, i) => {
      const a = m.userData.a + t * 0.25;
      const r = 4.2 + sc * 4 + Math.sin(t * 0.5 + i) * 0.4;
      m.position.set(Math.cos(a) * r, 3 + Math.sin(t * 0.7 + i * 1.3) * 1.4 + sc * 2, HOLO_Z + Math.sin(a) * r * 0.6);
      m.rotation.x += dt * (0.3 + i * 0.1);
      m.rotation.y += dt * (0.2 + this.drive.floor);
      m.scale.setScalar(0.8 + this.drive.floor * 1.3 + (i === Math.floor(t * 2) % 6 ? s.kick * 0.6 : 0));
    });
    this.shapeMat.uniforms.uGain.value = 0.8 + this.drive.floor;
    this.lookUp = 0.55;
  }

  dispose(): void {
    if (this.holo) {
      this.holoRoot.remove(this.holo.object);
      this.holo.dispose();
    }
    super.dispose();
  }
}

export const hologramRoom: VenueDef = {
  id: 'hologram',
  name: 'Hologram Room',
  short: 'Hologram',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'A giant hologram of you copies your moves over the crowd, with floating heads and shapes drawn by the music.',
  palette: ['#5ae0ff', '#ff2e88', '#b6ff3b'],
  ui: '#5ae0ff',
  capacity: '260',
  build: () => new HologramRoom(),
  thumb(g, w, h) {
    g.fillStyle = '#02060c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,224,255,0.9)';
    g.lineWidth = 2;
    // a big figure
    g.beginPath();
    g.arc(w / 2, h * 0.22, h * 0.09, 0, Math.PI * 2);
    g.moveTo(w / 2, h * 0.31);
    g.lineTo(w / 2, h * 0.62);
    g.moveTo(w / 2 - h * 0.18, h * 0.38);
    g.lineTo(w / 2 + h * 0.18, h * 0.38);
    g.moveTo(w / 2, h * 0.62);
    g.lineTo(w / 2 - h * 0.12, h * 0.9);
    g.moveTo(w / 2, h * 0.62);
    g.lineTo(w / 2 + h * 0.12, h * 0.9);
    g.stroke();
    g.fillStyle = 'rgba(90,224,255,0.25)';
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  },
};
