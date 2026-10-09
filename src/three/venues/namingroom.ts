/*
 * The naming scene's room (Section 3.1): pitch dark, haze hanging in the air,
 * one spotlight on a blank LED sign on the back wall, and, unseen until the
 * camera pulls back, a small crowd facing it. The sign's picture belongs to
 * the naming scene (ui/NamingScene.ts), which lights each letter as it's
 * typed. Not in the venue picker.
 */
import * as THREE from 'three';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { Crowd, crowdArea, HazeLayer } from './fixtures';
import type { ShowState } from './show';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** where the sign hangs */
export const SIGN = { pos: V(0, 2.5, -9.5), w: 3.8, h: 1.0 };

const CONE_VERT = /* glsl */ `
  varying float vV;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vV = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const CONE_FRAG = /* glsl */ `
  uniform float uLevel;
  varying float vV;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    // brightest near the lamp, soft at the edges of the cone
    float edge = pow(abs(dot(normalize(vN), normalize(vView))), 1.5);
    float a = edge * (0.25 + 0.75 * vV) * uLevel;
    gl_FragColor = vec4(vec3(1.0, 0.93, 0.82) * a, 1.0);
  }`;

class NamingRoom extends VenueBase {
  readonly views: VenueViews = {
    // the sign in the dark, from in front of the crowd (they're behind the camera); the sign sits high in
    // the frame, above the form
    wide: { pos: V(0, 2.2, -3.6), target: V(0, 1.85, -9.5) },
    wideLabel: 'The sign',
    // pulled back over the crowd's heads (and still in front of the booth at the origin)
    crowd: { pos: V(0, 3.0, -0.8), target: V(0, 1.7, -9.5) },
    drone: [V(0, 2.6, -1), V(2, 2.4, -4), V(0, 2.2, -6.5), V(-2, 2.4, -4)],
  };
  /** the sign's canvas texture, drawn by the naming scene */
  readonly signTexture: THREE.CanvasTexture;
  readonly signCanvas: HTMLCanvasElement;
  private signMat: THREE.MeshBasicMaterial;
  private cone: THREE.ShaderMaterial;
  private spot: THREE.SpotLight;
  /** sign brightness, set by the naming scene (above 1 blooms; kept under the lens ghosts' threshold) */
  glow = 1.3;

  constructor() {
    super({ fog: 0x020204, fogDensity: 0.07, background: 0x020204, hemiSky: 0x20222a, hemiGround: 0x050505, hemi: 0.05, flashAt: V(0, 3.5, -4), flashRange: 20 });
    this.keyLight = { color: 0xfff1dd, intensity: 0 };
    this.toneMapping = 'aces';
    const black = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.92 });
    const room = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 14), [black, black, black, new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.35, metalness: 0.2 }), black, black]);
    room.material.forEach((m) => (m.side = THREE.BackSide));
    room.position.set(0, 3, -4.2);
    this.group.add(room);

    // the sign: a black frame, and the LED face the naming scene draws on
    const frame = new THREE.Mesh(new THREE.BoxGeometry(SIGN.w + 0.28, SIGN.h + 0.28, 0.14), new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.4, metalness: 0.6 }));
    frame.position.copy(SIGN.pos).add(V(0, 0, -0.08));
    this.signCanvas = document.createElement('canvas');
    this.signCanvas.width = 1024;
    this.signCanvas.height = Math.round((1024 * SIGN.h) / SIGN.w);
    this.signTexture = new THREE.CanvasTexture(this.signCanvas);
    this.signTexture.colorSpace = THREE.SRGBColorSpace;
    this.signMat = new THREE.MeshBasicMaterial({ map: this.signTexture, color: new THREE.Color(1.4, 1.4, 1.4) });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(SIGN.w, SIGN.h), this.signMat);
    face.position.copy(SIGN.pos);
    // two cables up into the dark
    const top = SIGN.pos.y + SIGN.h / 2 + 0.14;
    const cz = SIGN.pos.z - 0.08;
    const cables = new THREE.BufferGeometry().setFromPoints([V(-1.5, top, cz), V(-1.5, 6, cz), V(1.5, top, cz), V(1.5, 6, cz)]);
    this.group.add(frame, face, new THREE.LineSegments(cables, new THREE.LineBasicMaterial({ color: 0x1a1a1d })));

    // one spotlight from above and in front, its beam in the haze
    this.spot = new THREE.SpotLight(0xfff0dc, 60, 14, 0.32, 0.6, 1.4);
    this.spot.position.set(0, 5.6, -6.2);
    this.spot.target.position.copy(SIGN.pos);
    this.group.add(this.spot, this.spot.target);
    this.cone = new THREE.ShaderMaterial({ uniforms: { uLevel: { value: 0.18 } }, vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const len = this.spot.position.distanceTo(SIGN.pos);
    const coneGeo = new THREE.CylinderGeometry(0.06, 1.25, len, 32, 1, true).translate(0, -len / 2, 0);
    const beam = new THREE.Mesh(coneGeo, this.cone);
    beam.position.copy(this.spot.position);
    beam.quaternion.setFromUnitVectors(V(0, -1, 0), SIGN.pos.clone().sub(this.spot.position).normalize());
    this.group.add(beam);
    this.add(new HazeLayer(new THREE.Box3(V(-5, 0.4, -10.5), V(5, 5, 1)), 5, 0.5));

    // the crowd, facing the sign, waiting
    const spots = crowdArea(-3.4, 3.4, -1.5, -3.25, 1.7, 4041, { y: 0 });
    this.add(new Crowd(spots, { seed: 4040, booth: V(0, 0, -10), phones: 0.25, clothes: ['#141518', '#1d1f24', '#d9d6cf', '#2a2d33', '#5a1e22', '#23262d'] }));
    this.wash(V(0, 4.5, -3), 0, 0.6, 9, 0.6);
  }

  update(s: ShowState, ...rest: [Parameters<VenueBase['update']>[1], number, THREE.Camera]): void {
    super.update(s, ...rest);
    this.signMat.color.setScalar(Math.min(1.5, this.glow));
    this.cone.uniforms.uLevel.value = 0.14 + 0.1 * s.flash;
  }
}

export const namingRoom: VenueDef = {
  id: 'naming',
  name: 'The sign',
  place: '',
  kind: 'naming scene',
  blurb: '',
  palette: ['#ffb547', '#ff2e88', '#7a3cff'],
  ui: '#ff2e88',
  capacity: '',
  build: () => new NamingRoom(),
  thumb(g, w, h) {
    g.fillStyle = '#020204';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffb547';
    g.fillRect(w * 0.25, h * 0.4, w * 0.5, h * 0.18);
  },
};

export type NamingRoomScene = NamingRoom;
