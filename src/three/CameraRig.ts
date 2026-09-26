/*
 * Camera rig: OrbitControls with damping, smooth spring transitions between
 * preset views (top-down ergonomics, dynamic performance, first-person booth,
 * wide club) and user-saved camera anchors.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadSetting, saveSetting } from '../core/settings';
import type { Features } from '../visualizer/AudioFeatures';

export type ViewId = 'top' | 'perf' | 'booth' | 'wide';
export interface CameraAnchor {
  name: string;
  pos: [number, number, number];
  target: [number, number, number];
}

export const VIEW_LABELS: Record<ViewId, string> = {
  top: 'Top-down',
  perf: 'Performance',
  booth: 'Booth POV',
  wide: 'Club',
};

export class CameraRig {
  readonly controls: OrbitControls;
  view: ViewId | 'custom' = 'perf';
  private goalPos: THREE.Vector3 | null = null;
  private goalTarget: THREE.Vector3 | null = null;
  private box = new THREE.Box3(new THREE.Vector3(-0.3, 0.9, -0.2), new THREE.Vector3(0.3, 1.0, 0.2));
  private lastInteraction = 0;
  private sway = 0;
  private boardId = '';
  shake = 0;
  private shakeOffset = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.controls = new OrbitControls(camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.8;
    c.panSpeed = 0.7;
    c.minDistance = 0.18;
    c.maxDistance = 14;
    c.maxPolarAngle = Math.PI * 0.47;
    c.screenSpacePanning = true;
    c.addEventListener('start', () => {
      this.goalPos = null;
      this.goalTarget = null;
      this.lastInteraction = performance.now();
      if (this.view !== 'custom') this.view = 'custom';
    });
    c.addEventListener('end', () => (this.lastInteraction = performance.now()));
  }

  noteInteraction(): void {
    this.lastInteraction = performance.now();
  }

  setBounds(box: THREE.Box3, boardId: string): void {
    this.box.copy(box);
    this.boardId = boardId;
  }

  private presets(): Record<ViewId, { pos: THREE.Vector3; target: THREE.Vector3 }> {
    const c = this.box.getCenter(new THREE.Vector3());
    const size = this.box.getSize(new THREE.Vector3());
    const top = this.box.max.y;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(0.3, this.camera.aspect);
    const fitW = (size.x / 2 + 0.02) / (Math.tan(fov / 2) * aspect);
    const fitD = (size.z / 2 + 0.02) / Math.tan(fov / 2);
    const h = Math.max(fitW, fitD) * 1.04;
    const perfDist = Math.max(fitW * 1.05, fitD * 1.6, 0.45);
    return {
      top: { pos: new THREE.Vector3(c.x, top + h, c.z + h * 0.02), target: new THREE.Vector3(c.x, top, c.z) },
      perf: { pos: new THREE.Vector3(c.x, top + perfDist * 0.78, c.z + size.z / 2 + perfDist * 0.55), target: new THREE.Vector3(c.x, top - 0.02, c.z - size.z * 0.08) },
      booth: { pos: new THREE.Vector3(c.x, 1.66, this.box.max.z + 0.34), target: new THREE.Vector3(c.x, top, c.z - size.z * 0.25) },
      wide: { pos: new THREE.Vector3(c.x + 2.6, 2.3, c.z + 3.3), target: new THREE.Vector3(0, 1.7, -3.2) },
    };
  }

  goTo(v: ViewId, instant = false): void {
    const p = this.presets()[v];
    this.view = v;
    this.setGoal(p.pos, p.target, instant);
  }

  private setGoal(pos: THREE.Vector3, target: THREE.Vector3, instant: boolean): void {
    if (instant) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.goalPos = null;
      this.goalTarget = null;
      this.controls.update();
    } else {
      this.goalPos = pos.clone();
      this.goalTarget = target.clone();
    }
  }

  anchors(): CameraAnchor[] {
    return loadSetting<CameraAnchor[]>(`anchors:${this.boardId}`, []);
  }

  saveAnchor(name: string): CameraAnchor {
    const a: CameraAnchor = {
      name,
      pos: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
    };
    const list = this.anchors().filter((x) => x.name !== name);
    list.push(a);
    saveSetting(`anchors:${this.boardId}`, list.slice(-8));
    return a;
  }

  deleteAnchor(name: string): void {
    saveSetting(
      `anchors:${this.boardId}`,
      this.anchors().filter((x) => x.name !== name),
    );
  }

  goToAnchor(a: CameraAnchor): void {
    this.view = 'custom';
    this.setGoal(new THREE.Vector3(...a.pos), new THREE.Vector3(...a.target), false);
  }

  /** re-fit the current preset after a resize or board change */
  refit(instant = true): void {
    if (this.view !== 'custom') this.goTo(this.view, instant);
  }

  update(dt: number, f: Features | null, shakeEnabled: boolean): void {
    this.camera.position.sub(this.shakeOffset);
    this.shakeOffset.set(0, 0, 0);
    if (this.goalPos && this.goalTarget) {
      const k = 1 - Math.exp(-dt * 5.5);
      this.camera.position.lerp(this.goalPos, k);
      this.controls.target.lerp(this.goalTarget, k);
      if (this.camera.position.distanceTo(this.goalPos) < 0.002 && this.controls.target.distanceTo(this.goalTarget) < 0.002) {
        this.goalPos = null;
        this.goalTarget = null;
      }
    }
    // dynamic performance view: slow sway around the board when idle
    const idle = performance.now() - this.lastInteraction > 4000;
    if (this.view === 'perf' && idle && !this.goalPos && f?.playing) {
      this.sway += dt;
      const p = this.presets().perf;
      const c = this.controls.target;
      const off = p.pos.clone().sub(p.target);
      const ang = Math.sin(this.sway * 0.12) * 0.22;
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      off.multiplyScalar(1 + Math.sin(this.sway * 0.07) * 0.06);
      const want = c.clone().add(off);
      this.camera.position.lerp(want, 1 - Math.exp(-dt * 0.8));
    }
    this.controls.update();
    if (shakeEnabled && f && (this.view === 'wide' || (this.view === 'perf' && idle))) {
      const mult = this.view === 'wide' ? 3 : 1;
      this.shake = Math.max(this.shake * Math.exp(-dt * 12), (f.kickPulse * 0.006 * f.intensity + f.drop * 0.01) * mult);
      this.shakeOffset.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.camera.position.add(this.shakeOffset);
    }
  }
}
