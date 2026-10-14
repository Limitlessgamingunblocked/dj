/*
 * The planet the globe menus share (the World Tour, the venue picker): the
 * dotted world in space with its atmosphere, pins that stand up off the
 * surface, names placed beside them, and the turning: your drag with a
 * little throw, a turn to bring a place round to the front, a slow drift
 * when you leave it.
 */
import * as THREE from 'three';
import { faceTurn, latLonToXYZ, nearestAngle, onLand, spherePoints } from './globe';
import { damp, glowTexture } from './menu3d';

export const PLANET_R = 1;

const HALO_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const HALO_FRAG = /* glsl */ `
uniform vec3 color;
uniform float power;
uniform float strength;
uniform float back;
varying vec3 vN;
varying vec3 vV;
void main() {
  float d = dot(vN, vV);
  float k = back > 0.5 ? pow(clamp(0.62 + d, 0.0, 1.0), power) : pow(1.0 - clamp(d, 0.0, 1.0), power);
  gl_FragColor = vec4(color * k * strength, 1.0);
}`;

const halo = (r: number, back: boolean, power: number, strength: number) =>
  new THREE.Mesh(
    new THREE.SphereGeometry(r, 64, 48),
    new THREE.ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { color: { value: new THREE.Color(0x3d7bff) }, power: { value: power }, strength: { value: strength }, back: { value: back ? 1 : 0 } },
      side: back ? THREE.BackSide : THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );

export const v3 = (p: [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2]);

export interface Planet {
  /** tilts towards you (about the screen's x axis) */
  tiltG: THREE.Group;
  /** turns about the planet's own axis: pins and routes go in here */
  spinG: THREE.Group;
  sphere: THREE.Mesh;
}

/** the stars, the light, the planet and its atmosphere, into `scene` */
export function buildPlanet(scene: THREE.Scene): Planet {
  const R = PLANET_R;
  scene.background = new THREE.Color(0x04060d);
  scene.environmentIntensity = 0.15;
  {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [lat, lon] = [Math.asin(Math.random() * 2 - 1) * (180 / Math.PI), Math.random() * 360 - 180];
      pos.set(latLonToXYZ(lat, lon, 40 + Math.random() * 20), i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb4ff, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false })));
  }
  const sun = new THREE.DirectionalLight(0xdfe8ff, 1.6);
  sun.position.set(-3, 2, 4);
  scene.add(sun, new THREE.HemisphereLight(0x5a78c8, 0x05060a, 0.5));

  const tiltG = new THREE.Group();
  const spinG = new THREE.Group();
  tiltG.add(spinG);
  scene.add(tiltG);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 72, 54), new THREE.MeshStandardMaterial({ color: 0x081026, roughness: 0.8, metalness: 0.05, emissive: 0x03060f }));
  sphere.name = 'globe';
  spinG.add(sphere);
  // the atmosphere: a rim on the globe and a glow round it
  scene.add(halo(R * 1.16, true, 3.2, 0.9));
  tiltG.add(halo(R * 1.003, false, 3.6, 0.4));
  // the land, as dots
  {
    const dot = glowTexture(32);
    const pts = spherePoints(22000).filter(([lat, lon]) => onLand(lat, lon));
    const pos = new Float32Array(pts.length * 3);
    pts.forEach(([lat, lon], i) => pos.set(latLonToXYZ(lat, lon, R * 1.002), i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    spinG.add(new THREE.Points(g, new THREE.PointsMaterial({ map: dot, color: 0xa8c4ff, size: 0.022, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false, alphaTest: 0.02 })));
  }
  // the graticule
  {
    const seg: number[] = [];
    const ring = (fn: (t: number) => [number, number]) => {
      for (let i = 0; i < 96; i++) seg.push(...latLonToXYZ(...fn(i / 96), R * 1.001), ...latLonToXYZ(...fn((i + 1) / 96), R * 1.001));
    };
    for (let lon = -180; lon < 180; lon += 30) ring((t) => [-90 + t * 180, lon]);
    for (let lat = -60; lat <= 60; lat += 30) ring((t) => [lat, -180 + t * 360]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    spinG.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x3d5aa8, transparent: true, opacity: 0.18, depthWrite: false })));
  }
  return { tiltG, spinG, sphere };
}

export interface PinMesh {
  group: THREE.Group;
  head: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  glow: THREE.Sprite;
  /** an invisible, larger target for the pointer (its userData.id says which) */
  hit: THREE.Mesh;
}

let pinParts: { head: THREE.SphereGeometry; stick: THREE.CylinderGeometry; stickMat: THREE.MeshBasicMaterial; hit: THREE.SphereGeometry; hitMat: THREE.MeshBasicMaterial; glow: THREE.Texture } | null = null;

/** a glowing pin standing up off the planet at (lat, lon); add its group to the planet's spinG */
export function makePin(lat: number, lon: number, id: string): PinMesh {
  pinParts ??= {
    head: new THREE.SphereGeometry(0.014, 16, 12),
    stick: new THREE.CylinderGeometry(0.0022, 0.0022, 0.05, 6).translate(0, 0.025, 0),
    stickMat: new THREE.MeshBasicMaterial({ color: 0xcfd8ff, transparent: true, opacity: 0.55 }),
    hit: new THREE.SphereGeometry(0.05, 8, 6),
    hitMat: new THREE.MeshBasicMaterial({ visible: false }),
    glow: glowTexture(),
  };
  const P = pinParts;
  const group = new THREE.Group();
  group.position.copy(v3(latLonToXYZ(lat, lon, PLANET_R)));
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), group.position.clone().normalize());
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const head = new THREE.Mesh(P.head, mat);
  head.position.y = 0.052;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.glow, color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(0.09);
  glow.position.y = 0.052;
  const hit = new THREE.Mesh(P.hit, P.hitMat);
  hit.position.y = 0.04;
  hit.userData.id = id;
  group.add(new THREE.Mesh(P.stick, P.stickMat), head, glow, hit);
  return { group, head, mat, glow, hit };
}

const wp = new THREE.Vector3();
const camDir = new THREE.Vector3();

/**
 * Put a name beside a point on the planet (`obj`'s world position): nudged
 * by `nudge` (px, and which side it sits), faded out as it goes round the back.
 */
export function placeLabel(label: HTMLElement, obj: THREE.Object3D, camera: THREE.Camera, size: { w: number; h: number }, nudge: [number, number, 'left' | 'right' | 'center'] = [0, 18, 'center']): void {
  obj.getWorldPosition(wp);
  camDir.copy(camera.position).sub(wp).normalize();
  const facing = wp.clone().normalize().dot(camDir);
  const v = wp.project(camera);
  const vis = THREE.MathUtils.clamp((facing - 0.08) / 0.2, 0, 1);
  const [dx, dy, align] = nudge;
  const x = (v.x * 0.5 + 0.5) * size.w + dx + (align === 'right' ? -6 : align === 'left' ? 6 : 0);
  const y = (-v.y * 0.5 + 0.5) * size.h + dy;
  const tx = align === 'right' ? '-100%' : align === 'left' ? '0' : '-50%';
  label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${tx}, -50%)`;
  label.style.opacity = vis.toFixed(2);
  label.style.pointerEvents = vis > 0.5 ? 'auto' : 'none';
}

/**
 * Turning the planet: drag (with a throw when you let go), scroll to zoom,
 * `focusOn` to bring a place round, and a slow drift after a while alone.
 * A click that didn't drag goes to `click` with what `pick` found under it.
 */
export class GlobeSpin {
  yaw: number;
  tilt: number;
  dist: number;
  distTo: number;
  /** drift speed when left alone (radians a second; 0 holds still) */
  drift = 0.08;
  private yawVel: number;
  private tiltVel = 0;
  private focus: { yaw: number; tilt: number } | null = null;
  private dragging = false;
  private idle = 99;
  hover: string | null = null;

  constructor(
    private planet: Planet,
    start: { lat: number; lon: number; dist: number; zoom: [number, number] },
  ) {
    const t = faceTurn(start.lat, start.lon);
    this.yaw = t.yaw;
    this.tilt = t.tilt;
    this.dist = this.distTo = start.dist;
    this.yawVel = this.drift;
    this.zoom = start.zoom;
  }

  private zoom: [number, number];

  /** turn (lat, lon) round to the front */
  focusOn(lat: number, lon: number): void {
    const t = faceTurn(lat, lon);
    this.focus = { yaw: nearestAngle(this.yaw, t.yaw), tilt: THREE.MathUtils.clamp(t.tilt, -0.9, 0.9) };
  }

  /** stop turning now (held still until the next drag) */
  hold(): void {
    this.yawVel = 0;
    this.tiltVel = 0;
    this.drift = 0;
  }

  update(dt: number): void {
    if (!this.dragging) {
      this.idle += dt;
      if (this.focus) {
        this.yaw = damp(this.yaw, this.focus.yaw, 4, dt);
        this.tilt = damp(this.tilt, this.focus.tilt, 4, dt);
        if (Math.abs(this.yaw - this.focus.yaw) < 0.002 && Math.abs(this.tilt - this.focus.tilt) < 0.002) this.focus = null;
        this.yawVel = 0;
        this.tiltVel = 0;
      } else {
        this.yaw += this.yawVel * dt;
        this.tilt = THREE.MathUtils.clamp(this.tilt + this.tiltVel * dt, -1.2, 1.2);
        this.tiltVel *= Math.exp(-3 * dt);
        // let go: the spin eases down to the drift
        this.yawVel = damp(this.yawVel, this.idle > 2.5 ? this.drift : this.yawVel * Math.exp(-2.5 * dt), 1.5, dt);
      }
    }
    this.planet.tiltG.rotation.x = this.tilt;
    this.planet.spinG.rotation.y = this.yaw;
    this.dist = damp(this.dist, this.distTo, 8, dt);
  }

  /** wire the pointer to the canvas: `pick` says what's under a point (an id, or null) */
  attach(canvas: HTMLCanvasElement, size: { w: number; h: number }, pick: (x: number, y: number) => string | null, click: (id: string) => void): void {
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let downX = 0;
    let downY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.focus = null;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      lastT = performance.now();
      this.yawVel = 0;
      this.tiltVel = 0;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) {
        this.hover = pick(e.clientX, e.clientY);
        canvas.style.cursor = this.hover ? 'pointer' : 'grab';
        return;
      }
      canvas.style.cursor = 'grabbing';
      const now = performance.now();
      const k = (2.2 / Math.max(300, size.h)) * (this.dist / 4);
      const dx = (e.clientX - lastX) * k;
      const dy = (e.clientY - lastY) * k;
      this.yaw += dx;
      this.tilt = THREE.MathUtils.clamp(this.tilt + dy, -1.2, 1.2);
      const sec = Math.max(0.008, (now - lastT) / 1000);
      this.yawVel = dx / sec;
      this.tiltVel = dy / sec;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = now;
    });
    const up = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.idle = 0;
      canvas.style.cursor = 'grab';
      if (performance.now() - lastT > 80) {
        this.yawVel = 0;
        this.tiltVel = 0;
      }
      this.yawVel = THREE.MathUtils.clamp(this.yawVel, -6, 6);
      this.tiltVel = THREE.MathUtils.clamp(this.tiltVel, -4, 4);
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5) {
        const id = pick(e.clientX, e.clientY);
        if (id) click(id);
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distTo = THREE.MathUtils.clamp(this.distTo * Math.exp(e.deltaY * 0.0012), this.zoom[0], this.zoom[1]);
      },
      { passive: false },
    );
  }
}

/** what's under a point on the canvas: the first of `targets` hit (its userData.id), the planet blocking what's behind it */
export function pickAt(canvas: HTMLCanvasElement, camera: THREE.Camera, x: number, y: number, blockers: THREE.Object3D[], targets: THREE.Object3D[]): string | null {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([...blockers, ...targets], true)[0];
  let o: THREE.Object3D | null = hit?.object ?? null;
  while (o && o.userData.id === undefined) o = o.parent;
  return (o?.userData.id as string | undefined) ?? null;
}
