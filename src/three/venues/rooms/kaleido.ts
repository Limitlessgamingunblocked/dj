/*
 * The Kaleidoscope Dome: a dome of mirrored triangles over a round floor.
 * Each facet sits at its own angle, so each shows its own piece of the room:
 * the crowd, the beams and the booth broken into a kaleidoscope. The dome
 * turns with the melody (faster as it climbs, the facets' tint following the
 * note), and the facets' angles open and close with the walls' stem.
 *
 *   modes    silver, stained glass, gold, prism
 *   pads     reverse, faster (hold), shimmer, split (hold: the facets open up)
 *   moments  bloom (big), spin (big), drift (deep)
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import { MovingHeads } from '../fixtures';
import type { ShowState } from '../show';
import { CrazyRoom, HUE_GLSL, MirrorProbe, PROBE_GLSL, V, type RoomAction, type RoomMoment } from './kit';

const R = 11;
const CZ = -6;

const FRAG = /* glsl */ `
  ${PROBE_GLSL}
  ${HUE_GLSL}
  uniform float uTwist, uRot, uMode, uHue, uShimmer, uBeat, uTime, uEdge;
  uniform vec3 uC0, uC1;
  varying vec3 vW;
  varying vec3 vN;
  varying float vFacet;
  varying vec3 vBary;
  vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
  void main() {
    vec3 N = normalize(vN);
    // each facet tips its own way: the kaleidoscope
    float h = vFacet;
    vec3 tip = normalize(vec3(sin(h * 41.0), cos(h * 23.0), sin(h * 17.0)));
    vec3 Nf = normalize(N + tip * uTwist * 0.6);
    vec3 Vd = normalize(vW - cameraPosition);
    vec3 Rr = rotY(reflect(Vd, Nf), uRot);
    vec3 col = probe(vW + N * 0.05, Rr);
    // the facet's glass
    vec3 tint = vec3(1.0);
    if (uMode > 0.5 && uMode < 1.5) tint = hsv(fract(h * 3.0 + uHue), 0.75, 1.0);
    else if (uMode > 1.5 && uMode < 2.5) tint = vec3(1.0, 0.78, 0.42);
    else if (uMode > 2.5) tint = hsv(fract(dot(Rr, vec3(0.3, 0.6, 0.2)) + uHue), 0.6, 1.0);
    float shim = 1.0 + uShimmer * 0.8 * step(0.7, fract(h * 9.0 + floor(uBeat)));
    col *= tint * 0.9 * shim;
    // the lead between facets catches the light
    float e = min(min(vBary.x, vBary.y), vBary.z);
    float edge = 1.0 - smoothstep(0.0, 0.035, e);
    col = mix(col, uC1 * uEdge, edge * 0.85);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** the upper half of an icosphere as separate triangles, each with its own id and corner coordinates */
function domeGeometry(r: number): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(r, 3).toNonIndexed();
  const p = ico.attributes.position as THREE.BufferAttribute;
  const pos: number[] = [];
  const facet: number[] = [];
  const bary: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    if ((a.y + b.y + c.y) / 3 < -0.6) continue;
    // inward-facing: swap the winding
    pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    const id = Math.random();
    facet.push(id, id, id);
    bary.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacet', new THREE.Float32BufferAttribute(facet, 1));
  g.setAttribute('aBary', new THREE.Float32BufferAttribute(bary, 3));
  g.computeVertexNormals();
  ico.dispose();
  return g;
}

class KaleidoDome extends CrazyRoom {
  readonly modes = ['Silver', 'Stained glass', 'Gold', 'Prism'];
  readonly actions: RoomAction[] = [
    { id: 'reverse', label: 'Reverse', kind: 'hit' },
    { id: 'faster', label: 'Faster', kind: 'hold' },
    { id: 'shimmer', label: 'Shimmer', kind: 'toggle' },
    { id: 'split', label: 'Split', kind: 'hold' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'bloom', label: 'The dome blooms open', energy: 'big' },
    { id: 'spin', label: 'The dome spins up', energy: 'big' },
    { id: 'drift', label: 'The dome drifts', energy: 'deep' },
  ];
  private probe: MirrorProbe;
  private mat: THREE.ShaderMaterial;
  private dome: THREE.Mesh;
  private rot = 0;
  private dir = 1;
  private twist = 0.2;

  constructor() {
    super({ roomId: 'kaleido', roomName: 'Kaleidoscope Dome', w: R * 0.8, h: R, d: R - CZ, back: 3, fog: 0x050408, fogDensity: 0.01, hemi: 0.3, booth: { strip: '#ffd8a0' } });
    // looking up into the dome from the middle of the floor
    this.views.wide = { pos: V(-3, 1.7, CZ + 2), target: V(0, R * 0.8, CZ) };
    this.views.wideLabel = 'Into the dome';
    this.probe = new MirrorProbe(192, V(0, 3, CZ), new THREE.Box3(V(-R, 0, CZ - R), V(R, R, CZ + R)), R);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.probe.uniforms,
        uTwist: { value: 0.2 },
        uRot: { value: 0 },
        uMode: { value: 0 },
        uHue: { value: 0 },
        uShimmer: { value: 0 },
        uBeat: { value: 0 },
        uTime: { value: 0 },
        uEdge: { value: 1 },
        uC0: { value: new THREE.Color() },
        uC1: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        attribute float aFacet; attribute vec3 aBary;
        varying vec3 vW; varying vec3 vN; varying float vFacet; varying vec3 vBary;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vFacet = aFacet; vBary = aBary;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: FRAG,
    });
    this.dome = new THREE.Mesh(domeGeometry(R), this.mat);
    this.dome.position.set(0, 0, CZ);
    this.group.add(this.dome);
    // a polished black floor disc
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.2, metalness: 0.6 }));
    floor.position.set(0, 0.001, CZ);
    this.group.add(floor);
    // floor lights shooting up into the facets
    const ring: { pos: THREE.Vector3; up: boolean; yaw: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ring.push({ pos: V(Math.cos(a) * (R - 1.5), 0.1, CZ + Math.sin(a) * (R - 1.5)), up: true, yaw: -a + Math.PI / 2 });
    }
    this.add(new MovingHeads(ring, { length: 12, radius: 0.5, gain: 1.2, floorY: 0, haze: [0.3, R] }));
    this.wash(V(0, R * 0.7, CZ), 0, 2.6, 18);
    this.wash(V(0, 1.2, CZ - 6), 1, 1.5, 10);
    this.people(0.85, 1401, { area: [-7, 7, -1.6, CZ - 7], phones: 0.2, clothes: ['#f2e6d8', '#101114', '#c9a46a', '#2b2d33', '#7a3cff', '#16171a'] });
  }

  prerender(renderer: THREE.WebGLRenderer, dt: number): void {
    this.probe.update(renderer, this.sceneRoot(), dt);
  }

  protected onAction(id: string): void {
    if (id === 'reverse') this.dir = -this.dir;
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const u = this.mat.uniforms;
    const melody = this.parts?.melody ?? s.high;
    const note = this.parts?.melodyNote ?? 0;
    // the dome turns with the melody: faster as it carries the track, a spin-up on the moment
    const speed = (0.03 + melody * 0.25 * this.look.level + (this.on('faster') ? 0.6 : 0) + this.momentK('spin') * 1.2 + this.momentK('drift') * 0.08) * (s.playing ? 1 : 0.3);
    this.rot += speed * dt * this.dir;
    u.uRot.value = this.rot;
    this.dome.rotation.y = this.rot * 0.25;
    const twistWant = 0.12 + this.drive.walls * 0.35 + (this.on('split') ? 0.9 : 0) + this.momentK('bloom') * 1.2;
    this.twist += (twistWant - this.twist) * Math.min(1, dt * 3);
    u.uTwist.value = this.twist;
    u.uMode.value = this.look.mode;
    u.uHue.value += ((note / 12 + this.look.hue - u.uHue.value + 1.5) % 1 - 0.5) * Math.min(1, dt * 2);
    u.uShimmer.value = this.on('shimmer') ? 1 : 0;
    u.uBeat.value = s.beat;
    u.uTime.value = this.time;
    (u.uC1.value as THREE.Color).copy(this.cols[1]).multiplyScalar(0.3 + this.drive.ceil * 1.5 + s.kick * 0.4);
    u.uEdge.value = 1;
    this.lookUp = Math.min(1, speed * 1.2 + this.twist * 0.3);
  }

  dispose(): void {
    this.probe.dispose();
    super.dispose();
  }
}

export const kaleidoDome: VenueDef = {
  id: 'kaleido',
  name: 'Kaleidoscope Dome',
  short: 'Kaleido',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'A dome of mirrored triangles that breaks the room into a turning kaleidoscope.',
  palette: ['#ffd8a0', '#ff2e88', '#7a3cff'],
  ui: '#ffb547',
  capacity: '300',
  build: () => new KaleidoDome(),
  thumb(g, w, h) {
    g.fillStyle = '#06050a';
    g.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.95;
    for (let i = 0; i < 18; i++) {
      for (let j = 0; j < 4; j++) {
        const a0 = Math.PI + (i / 18) * Math.PI;
        const a1 = Math.PI + ((i + 1) / 18) * Math.PI;
        const r0 = h * (0.25 + j * 0.2);
        const r1 = r0 + h * 0.2;
        g.fillStyle = `hsl(${(i * 37 + j * 70) % 360},70%,${45 + ((i + j) % 3) * 10}%)`;
        g.beginPath();
        g.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0);
        g.lineTo(cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0);
        g.lineTo(cx + Math.cos((a0 + a1) / 2) * r1, cy + Math.sin((a0 + a1) / 2) * r1);
        g.closePath();
        g.fill();
      }
    }
  },
};
