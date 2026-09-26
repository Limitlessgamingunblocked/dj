/*
 * Camera rig: OrbitControls with damping, smooth spring transitions between
 * preset views (top-down ergonomics, dynamic performance, first-person booth,
 * wide club) and user-saved camera anchors.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadSetting, saveSetting } from '../core/settings';
import type { Features } from '../visualizer/AudioFeatures';
import type { VenueViews } from './venues/base';

export type ViewId = 'top' | 'perf' | 'booth' | 'wide' | 'crowd';
export interface CameraAnchor {
  name: string;
  pos: [number, number, number];
  target: [number, number, number];
}

export const VIEW_LABELS: Record<ViewId, string> = {
  top: 'Top-down',
  perf: 'Performance',
  booth: 'Booth POV',
  wide: 'Venue',
  crowd: 'From the crowd',
};

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

export class CameraRig {
  readonly controls: OrbitControls;
  view: ViewId | 'custom' = 'perf';
  /** true while zoomed in on a board section (auto-zoom) */
  focused = false;
  /** the overview pose auto-zoom returns to */
  private base: Pose | null = null;
  private goalPos: THREE.Vector3 | null = null;
  private goalTarget: THREE.Vector3 | null = null;
  private goalSpeed = 5.5;
  private box = new THREE.Box3(new THREE.Vector3(-0.3, 0.9, -0.2), new THREE.Vector3(0.3, 1.0, 0.2));
  private lastInteraction = 0;
  private sway = 0;
  private boardId = '';
  shake = 0;
  private shakeOffset = new THREE.Vector3();
  /** user is dragging/zooming the camera with OrbitControls */
  interacting = false;
  /** performance.now() of the last camera move made by the user */
  lastManual = -1e9;
  private inUpdate = false;
  private userMoved = false;
  private onManual: (() => void) | null = null;
  private venueViews: VenueViews | null = null;

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
    c.maxDistance = 45;
    c.maxPolarAngle = Math.PI * 0.56;
    c.screenSpacePanning = true;
    c.addEventListener('start', () => {
      this.interacting = true;
      this.userMoved = false;
      this.lastInteraction = performance.now();
    });
    // camera changes outside our own update() come from the user's hand
    c.addEventListener('change', () => {
      if (this.inUpdate || !this.interacting) return;
      this.userMoved = true;
      this.goalPos = null;
      this.goalTarget = null;
    });
    c.addEventListener('end', () => {
      this.interacting = false;
      this.lastInteraction = performance.now();
      if (!this.userMoved) return; // a click without movement leaves the view alone
      this.userMoved = false;
      this.lastManual = performance.now();
      this.view = 'custom';
      this.focused = false;
      this.base = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
      this.onManual?.();
    });
  }

  /** called after the user moves the camera by hand */
  onManualMove(fn: () => void): void {
    this.onManual = fn;
  }

  /** the venue's own camera angles (wide / crowd) */
  setViews(v: VenueViews): void {
    this.venueViews = v;
    if ((this.view === 'wide' || this.view === 'crowd') && !this.focused) this.goTo(this.view);
  }

  label(v: ViewId): string {
    return v === 'wide' && this.venueViews ? this.venueViews.wideLabel : VIEW_LABELS[v];
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
      wide: this.venueViews ? { pos: this.venueViews.wide.pos.clone(), target: this.venueViews.wide.target.clone() } : { pos: new THREE.Vector3(c.x + 2.6, 2.3, c.z + 3.3), target: new THREE.Vector3(0, 1.7, -3.2) },
      crowd: this.venueViews ? { pos: this.venueViews.crowd.pos.clone(), target: this.venueViews.crowd.target.clone() } : { pos: new THREE.Vector3(0, 1.2, -6), target: new THREE.Vector3(0, 1.3, 0) },
    };
  }

  goTo(v: ViewId, instant = false): void {
    const p = this.presets()[v];
    this.view = v;
    this.focused = false;
    this.base = { pos: p.pos.clone(), target: p.target.clone() };
    this.setGoal(p.pos, p.target, instant);
  }

  /** Zoom in on a board section, framing `box` from above the DJ's side. */
  focusBox(box: THREE.Box3, instant = false): void {
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(0.3, this.camera.aspect);
    const tilt = 0.4; // radians from vertical, towards the DJ
    const fitW = (size.x / 2 + 0.012) / (Math.tan(fov / 2) * aspect);
    const fitD = ((size.z / 2 + 0.012) / Math.tan(fov / 2)) * 1.08;
    const dist = Math.max(fitW, fitD, 0.22);
    const target = new THREE.Vector3(c.x, box.max.y - 0.01, c.z + size.z * 0.03);
    const pos = target.clone().add(new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt)).multiplyScalar(dist));
    this.focused = true;
    this.goalSpeed = 8;
    this.setGoal(pos, target, instant);
  }

  /** a smooth camera move is in progress */
  get moving(): boolean {
    return this.goalPos !== null;
  }

  /** Stop any camera move in progress (a control was grabbed: keep it under the hand). */
  hold(): void {
    this.goalPos = null;
    this.goalTarget = null;
  }

  /** Return from a section zoom to the overview. */
  unfocus(): void {
    if (!this.focused) return;
    this.focused = false;
    this.goalSpeed = 6;
    if (this.view !== 'custom') {
      const p = this.presets()[this.view];
      this.base = { pos: p.pos.clone(), target: p.target.clone() };
    }
    if (this.base) this.setGoal(this.base.pos, this.base.target, false);
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
    this.focused = false;
    this.base = { pos: new THREE.Vector3(...a.pos), target: new THREE.Vector3(...a.target) };
    this.setGoal(this.base.pos, this.base.target, false);
  }

  /** re-fit the current preset after a resize or board change */
  refit(instant = true): void {
    if (this.view !== 'custom' && !this.focused) this.goTo(this.view, instant);
  }

  update(dt: number, f: Features | null, shakeEnabled: boolean): void {
    this.inUpdate = true;
    this.camera.position.sub(this.shakeOffset);
    this.shakeOffset.set(0, 0, 0);
    if (this.goalPos && this.goalTarget) {
      const k = 1 - Math.exp(-dt * this.goalSpeed);
      this.camera.position.lerp(this.goalPos, k);
      this.controls.target.lerp(this.goalTarget, k);
      if (this.camera.position.distanceTo(this.goalPos) < 0.002 && this.controls.target.distanceTo(this.goalTarget) < 0.002) {
        this.goalPos = null;
        this.goalTarget = null;
        this.goalSpeed = 5.5;
      }
    }
    // dynamic performance view: slow sway around the board when idle
    const idle = performance.now() - this.lastInteraction > 4000;
    if (this.view === 'perf' && idle && !this.focused && !this.goalPos && f?.playing) {
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
    if (this.camera.position.y < -1.2) this.camera.position.y = -1.2;
    if (shakeEnabled && f && !this.focused && (this.view === 'wide' || this.view === 'crowd' || (this.view === 'perf' && idle))) {
      const mult = this.view === 'perf' ? 1 : 3;
      this.shake = Math.max(this.shake * Math.exp(-dt * 12), (f.kickPulse * 0.006 * f.intensity + f.drop * 0.01) * mult);
      this.shakeOffset.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.camera.position.add(this.shakeOffset);
    }
    this.inUpdate = false;
  }
}
