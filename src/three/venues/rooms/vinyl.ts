/*
 * The Vinyl Floor: the dance floor is a giant record, 18 m across, turning
 * slowly with the crowd riding on it. Light catches in the grooves as a
 * shining bar that sweeps round with the spin, your name is on the label,
 * and the tonearm creeps in from the edge over the course of the set.
 *
 *   modes    black vinyl, splatter, picture disc (the visual player on the record), clear
 *   pads     scratch (hold: the record rocks back and forth), spinback, 45 rpm, needle drop
 *   moments  spinback (big), scratch (big), power down (deep: the record slows to a stop)
 *   stems    the spin follows the drums, the groove light the melody, the label the vocals
 *   also     scratch on the decks and the record scratches too
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import { nameService } from '../../../name/NameService';
import type { VenueDef } from '../base';
import { MovingHeads } from '../fixtures';
import { setClock } from '../moments';
import type { ShowState } from '../show';
import { CrazyRoom, roomShow, V, type RoomAction, type RoomMoment } from './kit';

const RR = 9;
const CZ = -RR - 0.8;
const LABEL = 2.3;
const ARM = 11.5;
/** the tonearm's pivot, off the record to the right of the booth */
const PIVOT = new THREE.Vector2(RR + 1.2, CZ + 7);

/** the angle of the arm (from its pivot) that puts the stylus at radius r from the record's centre */
export function armAngle(r: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i <= 720; i++) {
    const a = Math.PI + (i / 720) * Math.PI;
    const x = PIVOT.x + Math.cos(a) * ARM;
    const z = PIVOT.y + Math.sin(a) * ARM;
    const err = Math.abs(Math.hypot(x, z - CZ) - r);
    if (err < bestErr) {
      bestErr = err;
      best = a;
    }
  }
  return best;
}

const RECORD_FRAG = /* glsl */ `
  uniform float uMode, uSpin, uGlint, uTime;
  uniform vec3 uC0, uC1, uC2;
  uniform sampler2D uVis, uLabel;
  varying vec2 vUv;
  varying vec3 vL;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 p = vL.xz;
    float r = length(p);
    if (r > ${RR.toFixed(1)}) discard;
    float a = atan(p.y, p.x);
    // the label in the middle (it turns with the record)
    if (r < ${LABEL.toFixed(1)}) {
      vec2 luv = vec2(p.x, -p.y) / ${(LABEL * 2).toFixed(1)} + 0.5;
      vec3 lab = texture2D(uLabel, luv).rgb;
      if (r < 0.12) lab = vec3(0.02);
      gl_FragColor = vec4(lab, 1.0);
      return;
    }
    // grooves (antialiased so they don't shimmer), the lead-in and run-out bands
    float g = r * 140.0;
    float w = fwidth(g);
    float groove = 0.5 + 0.5 * cos(g * 6.2831853) * (1.0 - smoothstep(0.3, 0.6, w));
    float band = step(0.94, fract(r / 1.35));
    vec3 base = vec3(0.025, 0.025, 0.03);
    if (uMode > 0.5 && uMode < 1.5) {
      // splatter: blobs of colour through the vinyl
      float n = h21(floor(p * 2.0)) * 0.6 + h21(floor(p * 5.0)) * 0.4;
      base = mix(uC0 * 0.45, uC1 * 0.55, step(0.55, n));
      base = mix(base, vec3(0.9), step(0.92, h21(floor(p * 9.0))) * 0.8);
    } else if (uMode > 1.5 && uMode < 2.5) {
      // a picture disc: the visual player under the grooves
      base = texture2D(uVis, vec2(a / 6.2831853 + 0.5, r / ${RR.toFixed(1)})).rgb * 0.7;
    } else if (uMode > 2.5) {
      base = uC2 * 0.18 + vec3(0.02);
    }
    vec3 col = base * (0.75 + 0.25 * groove) * (1.0 - band * 0.35);
    // the glint: grooves catch the light where they run across the line to it, a bar sweeping round
    float bar = pow(abs(cos(a - 0.6)), 40.0) + pow(abs(cos(a - 2.6)), 60.0) * 0.6;
    col += mix(uC0, vec3(1.0), 0.5) * bar * groove * uGlint * 0.9;
    col += uC1 * pow(abs(cos(a + uTime * 0.1)), 80.0) * groove * uGlint * 0.4;
    gl_FragColor = vec4(col, 1.0);
  }
`;

class VinylFloor extends CrazyRoom {
  readonly modes = ['Black', 'Splatter', 'Picture disc', 'Clear'];
  readonly actions: RoomAction[] = [
    { id: 'scratch', label: 'Scratch', kind: 'hold' },
    { id: 'spinback', label: 'Spinback', kind: 'hit' },
    { id: 'fast', label: '45 rpm', kind: 'toggle' },
    { id: 'needle', label: 'Needle drop', kind: 'hit' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'spinback', label: 'The record spins back', energy: 'big' },
    { id: 'scratch', label: 'The floor scratches', energy: 'big' },
    { id: 'powerdown', label: 'The record winds down', energy: 'deep' },
  ];
  private record: THREE.Group;
  private mat: THREE.ShaderMaterial;
  private visMat: THREE.MeshBasicMaterial;
  private labelTex: THREE.CanvasTexture;
  private labelName = '';
  private arm: THREE.Group;
  private armLift = 0;
  private angle = 0;
  private omega = 0;
  private kick = 0;
  private needleT = 99;

  constructor() {
    super({ roomId: 'vinyl', roomName: 'Vinyl Floor', w: RR + 1, h: 9, d: RR * 2 + 1.5, back: 3, fog: 0x07060a, fogDensity: 0.018, hemi: 0.3, booth: { strip: '#ffd23f' } });
    this.views.wide = { pos: V(-RR - 1, 6.5, CZ - RR + 1), target: V(0, 0, CZ + 2) };
    this.views.wideLabel = 'Over the record';
    this.views.extra = { ...this.views.extra, rig: { pos: V(0, 22, CZ), target: V(0, 0, CZ - 0.01) } };
    // the visual player, for the picture disc (assigned by the stage each frame)
    this.visMat = new THREE.MeshBasicMaterial();
    this.visMaterials.push(this.visMat);
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    this.labelTex = new THREE.CanvasTexture(c);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMode: { value: 0 }, uSpin: { value: 0 }, uGlint: { value: 0.5 }, uTime: { value: 0 }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uVis: { value: null }, uLabel: { value: this.labelTex } },
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vL; void main() { vUv = uv; vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: RECORD_FRAG,
    });
    this.record = new THREE.Group();
    this.record.position.set(0, 0, CZ);
    this.group.add(this.record);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(RR, 128).rotateX(-Math.PI / 2), this.mat);
    disc.position.y = 0.06;
    this.record.add(disc);
    // the record's edge, and the platter under it
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(RR, RR, 0.06, 128, 1, true), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.3 }));
    edge.position.y = 0.03;
    this.record.add(edge);
    const platter = new THREE.Mesh(new THREE.CylinderGeometry(RR + 0.5, RR + 0.6, 0.05, 128), new THREE.MeshStandardMaterial({ color: 0x8a8d94, roughness: 0.3, metalness: 0.9 }));
    platter.position.set(0, 0.0, CZ);
    this.group.add(platter);
    // the room: a dark floor and black drapes
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.8 }));
    floor.position.set(0, -0.01, CZ);
    this.group.add(floor);
    // the booth's riser at the record's edge
    const riser = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 3), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.6 }));
    riser.position.set(0, 0.0, 0.8);
    this.group.add(riser);
    // the tonearm: a tower, the arm, the counterweight, the headshell
    this.arm = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.95 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.6, 24), metal);
    tower.position.set(PIVOT.x, 0.8, PIVOT.y);
    this.group.add(tower);
    this.arm.position.set(PIVOT.x, 1.55, PIVOT.y);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, ARM, 16).rotateZ(Math.PI / 2).translate(ARM / 2, 0, 0), metal);
    const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 24).rotateZ(Math.PI / 2).translate(-0.9, 0, 0), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.8 }));
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.55), new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.4 }));
    shell.position.set(ARM + 0.3, -0.25, 0);
    const stylus = new THREE.Mesh(new THREE.ConeGeometry(0.06, 1.3, 8).translate(0, -0.65, 0), metal);
    stylus.position.set(ARM + 0.4, -0.25, 0);
    this.arm.add(tube, weight, shell, stylus);
    this.group.add(this.arm);
    // lights round the record
    this.add(
      new MovingHeads(
        Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return { pos: V(Math.cos(a) * (RR + 2.5), 7.5, CZ + Math.sin(a) * (RR + 2.5)) };
        }),
        { length: 11, radius: 0.45, gain: 1.3, floorY: 0, haze: [0.3, 8] },
      ),
    );
    // the crowd stands on the record and turns with it
    const crowd = this.people(0.8, 2301, { area: [-RR + 1.5, RR - 1.5, -RR + 1.5, RR - 1.5], y: 0.06, phones: 0.3, booth: V(0, 0, -CZ), clothes: ['#e8eaf0', '#ffd23f', '#16171a', '#2a2d33', '#ff2e88', '#d0d4dc'] });
    // keep them on the vinyl, off the label
    this.group.remove(crowd.object);
    this.record.add(crowd.object);
    this.trimCrowd(crowd.object);
    this.wash(V(0, 6, CZ), 0, 2.2, 16);
    this.wash(V(0, 3, 1.5), 1, 1, 6);
  }

  /** the people in the area square who'd be off the record or on the label: hidden by scaling them away */
  private trimCrowd(obj: THREE.Object3D): void {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    obj.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh) return;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const r = Math.hypot(p.x, p.z);
        if (r > RR - 0.7 || r < LABEL + 0.6) {
          m.makeScale(0, 0, 0);
          im.setMatrixAt(i, m);
        }
      }
      im.instanceMatrix.needsUpdate = true;
    });
  }

  private drawLabel(): void {
    const name = nameService.text || 'DECKHOUSE';
    if (name === this.labelName) return;
    this.labelName = name;
    const c = this.labelTex.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(256, 256, 20, 256, 256, 256);
    grad.addColorStop(0, '#ffd23f');
    grad.addColorStop(1, '#ff7a1a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#1a1006';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 72;
    g.font = `900 ${size}px "Barlow Condensed", sans-serif`;
    const w = g.measureText(name.toUpperCase()).width;
    if (w > 380) {
      size *= 380 / w;
      g.font = `900 ${size}px "Barlow Condensed", sans-serif`;
    }
    g.fillText(name.toUpperCase(), 256, 170);
    g.font = '600 34px "Barlow Condensed", sans-serif';
    g.fillText('SIDE A  ·  33⅓', 256, 360);
    g.strokeStyle = '#1a1006';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(256, 256, 236, 0, Math.PI * 2);
    g.stroke();
    this.labelTex.needsUpdate = true;
  }

  protected onAction(id: string): void {
    if (id === 'spinback') this.omega = -6;
    if (id === 'needle') this.needleT = 0;
  }

  startMoment(id: string, len = 8): void {
    super.startMoment(id, len);
    if (id === 'spinback') this.omega = -7;
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    this.drawLabel();
    const u = this.mat.uniforms;
    // the spin: 33 (or 45) at a dance-floor pace, following the tempo, the drums giving it a nudge
    const rpm = this.on('fast') ? 1.35 : 1;
    const down = this.momentK('powerdown');
    const want = s.playing ? 0.16 * rpm * (0.85 + this.drive.floor * 0.3) * (1 - down) : 0.03;
    this.omega += (want - this.omega) * Math.min(1, dt * (this.omega < 0 ? 1.2 : 0.8));
    let wobble = 0;
    // scratching: the pad, the moment, or you scratching on the decks
    const scratch = Math.max(this.on('scratch') ? 1 : 0, this.momentK('scratch'), roomShow.glitch > 0.8 ? 0.8 : 0);
    if (scratch > 0) wobble = Math.sin(this.time * 9) * 0.12 * scratch;
    this.angle += this.omega * dt;
    this.record.rotation.y = this.angle + wobble;
    // the arm creeps in over the set; a needle drop lifts it and puts it back at the edge
    this.needleT += dt;
    const lift = this.needleT < 1.2 ? Math.sin((this.needleT / 1.2) * Math.PI) : 0;
    this.armLift += (lift - this.armLift) * Math.min(1, dt * 8);
    const r = this.needleT < 1.2 ? RR - 0.4 : RR - 0.6 - setClock.progress * (RR - LABEL - 1.4);
    this.arm.rotation.set(0, -armAngle(r), this.armLift * 0.12);
    u.uMode.value = this.look.mode;
    u.uVis.value = this.visMat.map;
    u.uTime.value = this.time;
    this.kick += (s.kick - this.kick) * Math.min(1, dt * 10);
    u.uGlint.value = (0.35 + (this.parts?.melody ?? s.high) * 0.9 + this.kick * 0.3) * (0.4 + 0.6 * s.master) * this.look.level;
    (u.uC0.value as THREE.Color).copy(this.cols[0]);
    (u.uC1.value as THREE.Color).copy(this.cols[1]);
    (u.uC2.value as THREE.Color).copy(this.cols[2]);
    this.lookUp = Math.min(1, down * 0.5 + this.momentK('spinback') * 0.8);
  }
}

export const vinylFloor: VenueDef = {
  id: 'vinyl',
  name: 'Vinyl Floor',
  short: 'Vinyl',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'The dance floor is a giant spinning record, the crowd riding the grooves and the tonearm creeping in.',
  palette: ['#ffd23f', '#ff2e88', '#3dd6ff'],
  ui: '#ffd23f',
  capacity: '260',
  build: () => new VinylFloor(),
  thumb(g, w, h) {
    g.fillStyle = '#0b0b0d';
    g.fillRect(0, 0, w, h);
    const cx = w * 0.45;
    const cy = h / 2;
    for (let r = h * 0.46; r > h * 0.12; r -= 2) {
      g.strokeStyle = r % 6 < 2 ? '#1c1c20' : '#111114';
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#ffb02e';
    g.beginPath();
    g.arc(cx, cy, h * 0.12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c9ced6';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(w * 0.92, h * 0.12);
    g.lineTo(w * 0.62, h * 0.62);
    g.stroke();
  },
};
