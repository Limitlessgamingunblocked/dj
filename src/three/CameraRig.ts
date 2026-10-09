/*
 * Camera rig: OrbitControls with damping, smooth spring transitions between
 * preset views (top-down ergonomics, dynamic performance, first-person booth,
 * wide club) and user-saved camera anchors, plus the FPV drone: a looping
 * fly-through of the venue (over the crowd, past the pyro, round the booth)
 * with banking into turns, a wide lens and speed that follows the energy.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { prefs } from '../core/prefs';
import { loadSetting, saveSetting } from '../core/settings';
import type { Features } from '../visualizer/AudioFeatures';
import type { VenueViews } from './venues/base';

export type ViewId = 'top' | 'perf' | 'booth' | 'wide' | 'crowd' | 'fisheye' | 'crane' | 'rig' | 'cctv' | 'camcorder' | 'vertigo' | 'drone';
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
  fisheye: 'Fisheye on the booth',
  crane: 'Crane sweep',
  rig: 'Lighting rig',
  cctv: 'Security camera',
  camcorder: '90s camcorder',
  vertigo: 'Dolly zoom',
  drone: 'Drone FPV',
};

/**
 * Angles that move on their own, computed every frame: a fisheye clamped to
 * the booth (the bass shakes it), a crane sweeping round the DJ, a camera up in
 * the lighting rig, a panning security camera, someone in the front rows
 * filming on a camcorder, and a dolly zoom that pulls back while zooming in.
 */
export const LIVE_VIEWS: ViewId[] = ['fisheye', 'crane', 'rig', 'cctv', 'camcorder', 'vertigo'];

const DRONE_FOV = 94;
/** the OS asks for less motion, or camera motion is off in Settings: no idle sway, no beat shake */
const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reducedMotion = () => !!motionQuery?.matches || !prefs.cameraMotion;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

interface DroneState {
  curve: THREE.CatmullRomCurve3;
  length: number;
  u: number;
  speed: number;
  heading: number;
  roll: number;
  t: number;
}

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
  private baseFov: number;
  private drone: DroneState | null = null;
  /** drone look for the lens pass: amount 0..1 (eases in/out), speed m/s, roll rad */
  readonly droneFx = { amount: 0, speed: 0, roll: 0 };
  /**
   * Held camera moves from the on-screen camera pad, the keyboard or MIDI, each
   * −1..1: yaw orbits round the board (negative = to the left), pitch raises
   * (positive, more from above) or lowers the camera, zoom moves it in (positive)
   * or out.
   */
  readonly move = { yaw: 0, pitch: 0, zoom: 0 };
  private sph = new THREE.Spherical();
  /** field of view a lens look needs (the fisheye renders wide, then remaps), degrees */
  lensFov: number | null = null;
  /** the last named angle (lens looks follow it while you nudge the camera by hand) */
  named: ViewId = 'perf';
  private liveT = 0;
  private liveTarget = new THREE.Vector3();
  private livePos = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private booth = new THREE.Vector3(0, 1.45, 0.3);
  private ahead = new THREE.Vector3();
  private perfOffset: THREE.Vector3 | null = null;
  private perfOffsetAt = 0;
  /** the drop punch-in (Section 2.5): seconds since it fired, and the zoom it has applied */
  private punchT = 1e9;
  private punchMult = 1;
  private punchShake = false;
  /** the breakdown orbit: 0..1, how strongly a still shot drifts round the booth */
  orbit = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.baseFov = camera.fov;
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
    if (this.view === 'drone') this.startDrone();
    else if ((this.view === 'wide' || this.view === 'crowd') && !this.focused) this.goTo(this.view);
  }

  label(v: ViewId): string {
    return v === 'wide' && this.venueViews ? this.venueViews.wideLabel : VIEW_LABELS[v];
  }

  /** an angle that moves on its own is showing */
  get isLive(): boolean {
    return LIVE_VIEWS.includes(this.view as ViewId);
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
    const fov = THREE.MathUtils.degToRad(this.baseFov);
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
      drone: { pos: this.camera.position.clone(), target: this.controls.target.clone() },
      fisheye: this.livePose('fisheye', null, 0),
      crane: this.livePose('crane', null, 0),
      rig: this.livePose('rig', null, 0),
      cctv: this.livePose('cctv', null, 0),
      camcorder: this.livePose('camcorder', null, 0),
      vertigo: this.livePose('vertigo', null, 0),
    };
  }

  /**
   * Where a live angle's camera is at time t (seconds on it). Venues can place
   * the rig, security and camcorder cameras and size the crane and dolly
   * (VenueViews.extra); otherwise they go round the booth. Motion that is just
   * shake (the camcorder's hand, the bass on the booth) stops when reduced
   * motion is asked for; the moves that are the point of the angle don't.
   */
  private livePose(v: ViewId, f: Features | null, t: number): Pose & { fov?: number } {
    const x = this.venueViews?.extra ?? {};
    const still = reducedMotion();
    // the beat clock: one cycle per 8 bars while the music plays, slower in seconds otherwise
    const beats = f?.playing && f.bpm > 0 ? f.beatCount + f.beatPhase : t * 2;
    const cyc = (beats / 32) * Math.PI * 2;
    const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c);
    switch (v) {
      case 'fisheye': {
        const c = this.box.getCenter(new THREE.Vector3());
        const top = this.box.max.y;
        // clamped to the front edge of the booth, just above the decks, looking across them at the DJ
        const pos = V(c.x + 0.05, top + 0.12, this.box.min.z - 0.09);
        if (!still && f) pos.y += Math.sin(t * 80) * f.kickPulse * 0.004;
        return { pos, target: V(c.x, top + 0.32, this.box.max.z + 0.6) };
      }
      case 'rig': {
        const p = x.rig ?? { pos: V(1.4, 4.6, -3.2), target: V(0, 0.95, 0.35) };
        const pos = p.pos.clone();
        pos.x += Math.sin(t * 0.06) * 0.5;
        return { pos, target: p.target.clone() };
      }
      case 'cctv': {
        const p = x.cctv ?? { pos: V(5.5, 4.0, -6), target: V(0, 1, 0) };
        // a slow pan back and forth, like a real one on a motor
        const off = p.target.clone().sub(p.pos).applyAxisAngle(Y_AXIS, Math.sin((t * Math.PI * 2) / 28) * 0.28);
        return { pos: p.pos.clone(), target: p.pos.clone().add(off) };
      }
      case 'crane': {
        const cr = x.crane ?? { radius: 3.4, low: 1.7, high: 3.4 };
        const a = Math.sin(cyc) * 0.95;
        const h = cr.low + (cr.high - cr.low) * (0.5 + 0.5 * Math.sin(cyc * 0.5 + 0.6));
        return { pos: V(Math.sin(a) * cr.radius, h, 0.6 - Math.cos(a) * cr.radius), target: V(0, 1.2, 0.55) };
      }
      case 'camcorder': {
        const p = x.camcorder ?? { pos: V(0.8, 1.3, -2.4), target: V(0, 1.35, 0.6) };
        const pos = p.pos.clone();
        const target = p.target.clone();
        // whoever is filming drifts between the DJ and the room, and dances a bit
        target.x += Math.sin(t * 0.21) * 0.6 + Math.sin(t * 0.07) * 0.4;
        target.y += Math.sin(t * 0.29) * 0.15;
        if (!still) {
          pos.x += Math.sin(t * 1.3) * 0.03 + Math.sin(t * 2.9) * 0.012;
          pos.y += Math.sin(t * 1.7) * 0.02 + Math.sin(t * 4.1) * 0.01 + (f?.kickPulse ?? 0) * 0.012;
          pos.z += Math.sin(t * 0.9) * 0.03;
          target.x += Math.sin(t * 1.9) * 0.02;
          target.y += Math.sin(t * 2.3) * 0.02;
        }
        return { pos, target };
      }
      case 'vertigo': {
        const vz = x.vertigo ?? { near: 2.2, far: 6.5, height: 1.7 };
        const d = vz.near + (vz.far - vz.near) * (0.5 - 0.5 * Math.cos(cyc));
        const target = V(0, 1.3, 0.6);
        // pull straight back from the DJ while the lens zooms in to keep them the same size
        const frame = 2 * vz.near * Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2);
        return { pos: V(0, vz.height, target.z - d), target, fov: THREE.MathUtils.radToDeg(2 * Math.atan(frame / 2 / d)) };
      }
      default:
        return { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    }
  }

  goTo(v: ViewId, instant = false): void {
    if (v === 'drone') {
      this.startDrone();
      return;
    }
    this.stopDrone();
    this.named = v;
    if (LIVE_VIEWS.includes(v)) {
      // live angles fly in from wherever the camera is, then keep moving (update())
      if (this.view !== v) this.liveT = 0;
      this.view = v;
      this.focused = false;
      const p = this.livePose(v, null, this.liveT);
      this.base = { pos: p.pos.clone(), target: p.target.clone() };
      this.goalPos = null;
      this.goalTarget = null;
      if (instant) this.setGoal(p.pos, p.target, true);
      return;
    }
    const p = this.presets()[v];
    this.view = v;
    this.focused = false;
    this.base = { pos: p.pos.clone(), target: p.target.clone() };
    this.setGoal(p.pos, p.target, instant);
  }

  /** Turn a held camera move into a frame's worth of orbit, tilt and zoom round the look-at point. */
  private applyMove(dt: number): void {
    if (this.drone) {
      // take the drone's current shot as the starting point (the lens eases back on its own)
      this.stopDrone();
    }
    const c = this.controls;
    const m = this.move;
    const off = this.tmpA.copy(this.camera.position).sub(c.target);
    this.sph.setFromVector3(off);
    this.sph.theta += m.yaw * dt * 1.1;
    this.sph.phi = THREE.MathUtils.clamp(this.sph.phi - m.pitch * dt * 0.8, 0.012, c.maxPolarAngle);
    this.sph.radius = THREE.MathUtils.clamp(this.sph.radius * Math.exp(-m.zoom * dt * 1.4), c.minDistance, c.maxDistance);
    this.camera.position.copy(c.target).add(off.setFromSpherical(this.sph));
    this.camera.lookAt(c.target);
    this.goalPos = null;
    this.goalTarget = null;
    this.focused = false;
    const now = performance.now();
    this.lastManual = now;
    this.lastInteraction = now;
    this.base = { pos: this.camera.position.clone(), target: c.target.clone() };
    if (this.view !== 'custom') {
      this.view = 'custom';
      this.onManual?.();
    }
  }

  /** Where an angle puts the camera (its starting point, for the moving ones); null for the drone. */
  poseOf(v: ViewId): Pose | null {
    return v === 'drone' ? (this.venueViews?.drone[0] ? { pos: this.venueViews.drone[0].clone(), target: this.controls.target.clone() } : null) : this.presets()[v];
  }

  /** Zoom in on a board section, framing `box` from above the DJ's side. */
  focusBox(box: THREE.Box3, instant = false): void {
    if (this.drone) return;
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
    this.stopDrone();
    this.view = 'custom';
    this.focused = false;
    this.base = { pos: new THREE.Vector3(...a.pos), target: new THREE.Vector3(...a.target) };
    this.setGoal(this.base.pos, this.base.target, false);
  }

  /** re-fit the current preset after a resize or board change */
  refit(instant = true): void {
    if (this.view !== 'custom' && !this.focused) this.goTo(this.view, instant);
  }

  /* ---------------------------------------------------------------- */
  /* FPV drone                                                          */
  /* ---------------------------------------------------------------- */

  private startDrone(): void {
    const pts = this.venueViews?.drone ?? [
      new THREE.Vector3(0, 3, 3),
      new THREE.Vector3(3, 2, -1),
      new THREE.Vector3(0, 1.6, -3),
      new THREE.Vector3(-3, 2, -1),
    ];
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.clone()), true, 'centripetal', 0.5);
    const length = curve.getLength();
    // join the loop where it passes closest to the camera, so the cut is short
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < 240; i++) {
      const d = curve.getPointAt(i / 240, this.tmpA).distanceToSquared(this.camera.position);
      if (d < bestD) {
        bestD = d;
        best = i / 240;
      }
    }
    const tan = curve.getTangentAt(best, this.tmpB);
    this.drone = { curve, length, u: best, speed: 3.5, heading: Math.atan2(tan.x, tan.z), roll: 0, t: 0 };
    this.view = 'drone';
    this.focused = false;
    this.goalPos = null;
    this.goalTarget = null;
    this.controls.enabled = false;
  }

  private stopDrone(): void {
    if (!this.drone) return;
    this.drone = null;
    this.controls.enabled = true;
  }

  private updateDrone(dt: number, f: Features | null): void {
    const d = this.drone!;
    d.t += dt;
    const target = 3.4 + (f?.playing ? f.energy * 2.6 + f.drop * 2.2 : 0);
    d.speed += (target - d.speed) * Math.min(1, dt * 1.2);
    d.u = (d.u + (d.speed * dt) / d.length) % 1;
    const p = d.curve.getPointAt(d.u, this.tmpA);
    const tan = d.curve.getTangentAt(d.u, this.tmpB);
    // bank into the turn: roll follows the yaw rate
    const heading = Math.atan2(tan.x, tan.z);
    let dh = heading - d.heading;
    dh -= Math.round(dh / (Math.PI * 2)) * Math.PI * 2;
    d.heading = heading;
    const rollTarget = THREE.MathUtils.clamp((dh / Math.max(dt, 1e-3)) * 0.24, -0.75, 0.75);
    d.roll += (rollTarget - d.roll) * Math.min(1, dt * 2.5);
    // look ahead along the path, swinging towards the DJ when flying past the booth
    const ahead = d.curve.getPointAt((d.u + 3 / d.length) % 1, this.ahead);
    const near = THREE.MathUtils.smoothstep(p.distanceTo(this.booth), 2.5, 7);
    ahead.lerp(this.booth, (1 - near) * 0.55);
    // prop buzz and a bump on the kick
    const kick = f ? f.kickPulse * f.intensity : 0;
    const buzz = 0.006 + kick * 0.008;
    this.camera.position.set(p.x + Math.sin(d.t * 37) * buzz, p.y + Math.sin(d.t * 41 + 1) * buzz - kick * 0.01, p.z + Math.sin(d.t * 29 + 2) * buzz);
    this.camera.lookAt(ahead);
    this.camera.rotateZ(d.roll);
    this.controls.target.copy(ahead);
    this.droneFx.speed = d.speed;
    this.droneFx.roll = d.roll;
  }

  /** The drop punch-in: a snap zoom towards the DJ that eases back over a couple of bars (with a jolt if `shake`). */
  punch(shake = true): void {
    if (reducedMotion() || this.drone) return;
    this.punchT = 0;
    this.punchShake = shake;
  }

  update(dt: number, f: Features | null, shakeEnabled: boolean): void {
    this.inUpdate = true;
    // take off last frame's punch zoom before anything reads the lens
    if (this.punchMult !== 1) {
      this.camera.fov /= this.punchMult;
      this.punchMult = 1;
      this.camera.updateProjectionMatrix();
    }
    // lens: the drone flies wide, everything else uses the normal lens
    const wantFov = this.drone ? DRONE_FOV : (this.lensFov ?? this.baseFov);
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
    this.droneFx.amount += ((this.drone ? 1 : 0) - this.droneFx.amount) * Math.min(1, dt * 4);
    if (this.move.yaw || this.move.pitch || this.move.zoom) this.applyMove(dt);
    if (this.drone) {
      this.camera.position.sub(this.shakeOffset);
      this.shakeOffset.set(0, 0, 0);
      this.updateDrone(dt, f);
      this.inUpdate = false;
      return;
    }
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
    // live angles: follow their path; the fly-in from the last angle comes from the same easing
    let liveFov: number | undefined;
    if (this.isLive && !this.focused && !this.goalPos) {
      this.liveT += dt;
      const p = this.livePose(this.view as ViewId, f, this.liveT);
      this.livePos.copy(p.pos);
      this.liveTarget.copy(p.target);
      const k = 1 - Math.exp(-dt * 3.2);
      this.camera.position.lerp(this.livePos, k);
      this.controls.target.lerp(this.liveTarget, k);
      this.base = { pos: p.pos, target: p.target };
      liveFov = p.fov;
    }
    // the breakdown orbit: a still shot drifts slowly round the booth while the track breathes
    if (this.orbit > 0.01 && !this.isLive && !this.focused && !this.goalPos && this.view !== 'top' && !reducedMotion()) {
      const off = this.tmpB.copy(this.camera.position).sub(this.controls.target).applyAxisAngle(Y_AXIS, dt * 0.075 * this.orbit);
      this.camera.position.copy(this.controls.target).add(off);
    }
    // dynamic performance view: slow sway around the board when idle
    const idle = performance.now() - this.lastInteraction > 4000;
    if (this.view === 'perf' && idle && !this.focused && !this.goalPos && f?.playing && !reducedMotion()) {
      this.sway += dt;
      // the preset only changes with the board or the aspect: refresh it now and then, not every frame
      if (!this.perfOffset || this.sway - this.perfOffsetAt > 1) {
        const p = this.presets().perf;
        this.perfOffset = p.pos.sub(p.target);
        this.perfOffsetAt = this.sway;
      }
      const ang = Math.sin(this.sway * 0.12) * 0.22;
      const off = this.tmpB.copy(this.perfOffset).applyAxisAngle(Y_AXIS, ang).multiplyScalar(1 + Math.sin(this.sway * 0.07) * 0.06);
      const want = this.tmpA.copy(this.controls.target).add(off);
      this.camera.position.lerp(want, 1 - Math.exp(-dt * 0.8));
    }
    this.controls.update();
    if (this.camera.position.y < -1.2) this.camera.position.y = -1.2;
    // the dolly zoom: the lens follows the camera's real distance so the DJ stays the same size
    if (liveFov !== undefined && this.lensFov === null) {
      const dNow = this.camera.position.distanceTo(this.controls.target);
      const dWant = this.livePos.distanceTo(this.liveTarget);
      const fov = THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(liveFov) / 2) * dWant) / Math.max(0.1, dNow)));
      this.camera.fov = THREE.MathUtils.clamp(fov, 8, 70);
      this.camera.updateProjectionMatrix();
    }
    if (shakeEnabled && f && !this.focused && !reducedMotion() && (this.view === 'wide' || this.view === 'crowd' || (this.view === 'perf' && idle))) {
      const mult = this.view === 'perf' ? 1 : 3;
      this.shake = Math.max(this.shake * Math.exp(-dt * 12), (f.kickPulse * 0.006 * f.intensity + f.drop * 0.01) * mult);
      this.shakeOffset.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.camera.position.add(this.shakeOffset);
    }
    // the punch-in: 0.15 s in, then back out over about three seconds
    if (this.punchT < 6 && !this.drone) {
      this.punchT += dt;
      const t = this.punchT;
      const k = t < 0.15 ? t / 0.15 : Math.exp(-(t - 0.15) / 1.4);
      this.punchMult = 1 - 0.22 * k * (2 - k);
      this.camera.fov *= this.punchMult;
      this.camera.updateProjectionMatrix();
      if (this.punchShake && shakeEnabled && t < 0.4) {
        const j = 0.02 * (1 - t / 0.4);
        const jolt = this.tmpA.set((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, 0);
        this.shakeOffset.add(jolt);
        this.camera.position.add(jolt);
      }
    }
    this.inUpdate = false;
  }
}
