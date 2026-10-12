/*
 * What the hardware reflects indoors: a small room of light painted in the
 * show's colours, so the jog wheels, chrome and screens pick up the club
 * instead of a neutral studio. A soft booth lamp overhead keeps the board as
 * readable as before; the wall the crowd stands in front of takes the first
 * show colour, the side walls the other two, and the moving heads, wash,
 * blinders and strobes brighten them. It is a 32 px cube filtered for
 * roughness, re-made several times a second (the same size as the open-air
 * sky's, so a venue change between the two never recompiles a material).
 */
import * as THREE from 'three';
import type { ShowState } from './venues/show';

/** the panels' brightness for a show moment: the room's lights at work, brighter on a hit */
export function wallLevel(s: Pick<ShowState, 'master' | 'intensity' | 'wash' | 'movers' | 'blinder' | 'flash' | 'kick' | 'playing'>): number {
  if (!s.playing) return 0.35 * s.master;
  const lights = 0.4 + 0.35 * s.wash + 0.25 * s.movers;
  const hit = 0.9 * s.blinder + 0.6 * s.flash + 0.25 * s.kick;
  return s.master * Math.min(1.4, s.intensity) * lights + hit;
}

export class ShowEnv {
  /** the filtered environment (null until the first update) */
  texture: THREE.Texture | null = null;
  private scene = new THREE.Scene();
  private front: THREE.MeshBasicMaterial;
  private left: THREE.MeshBasicMaterial;
  private right: THREE.MeshBasicMaterial;
  private cube = new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType });
  private cam = new THREE.CubeCamera(0.05, 20, this.cube);
  private pmrem: THREE.PMREMGenerator | null = null;
  private rt: THREE.WebGLRenderTarget | null = null;
  private level = 0;

  constructor() {
    const mat = (c: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, toneMapped: false, fog: false });
    // the room: dark walls with a little bounce, a warm lamp over the booth, a dim floor
    const room = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), mat(0x1a1a20));
    room.position.y = 1;
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), mat(new THREE.Color(1, 0.95, 0.88).multiplyScalar(9)));
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, 3.4, 0.4);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.5), mat(new THREE.Color(0.3, 0.3, 0.33)));
    back.position.set(0, 1.5, 3.9);
    back.rotation.y = Math.PI;
    // the room in front of the DJ (−Z) and the side walls take the show
    this.front = mat(0x000000);
    this.left = mat(0x000000);
    this.right = mat(0x000000);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), this.front);
    front.position.set(0, 1.8, -3.9);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.4), this.left);
    left.position.set(-3.9, 2.6, -0.5);
    left.rotation.y = Math.PI / 2;
    const right = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.4), this.right);
    right.position.set(3.9, 2.6, -0.5);
    right.rotation.y = -Math.PI / 2;
    this.scene.add(room, lamp, back, front, left, right);
    this.cam.position.set(0, 1.1, 0);
  }

  /** re-make the environment for this moment of the show */
  update(renderer: THREE.WebGLRenderer, s: ShowState, dt: number): void {
    // ease the walls so a strobe at the update rate reads as a lift, not a flicker
    const target = wallLevel(s);
    this.level += (target - this.level) * Math.min(1, dt * (target > this.level ? 14 : 4));
    const k = this.level;
    this.front.color.copy(s.colors[0]).multiplyScalar(1 + 3.4 * k);
    this.left.color.copy(s.colors[1]).multiplyScalar(0.7 + 3 * k);
    this.right.color.copy(s.colors[2]).multiplyScalar(0.7 + 3 * k);
    this.pmrem ??= new THREE.PMREMGenerator(renderer);
    const prev = renderer.getRenderTarget();
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    this.cam.update(renderer, this.scene);
    this.rt = this.pmrem.fromCubemap(this.cube.texture, this.rt);
    renderer.shadowMap.autoUpdate = auto;
    renderer.setRenderTarget(prev);
    this.texture = this.rt.texture;
  }

  dispose(): void {
    this.cube.dispose();
    this.rt?.dispose();
    this.pmrem?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
  }
}
