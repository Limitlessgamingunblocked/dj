/*
 * The World Tour globe: the tour map as a slowly turning planet in space.
 * The land is dots, each city a glowing pin with its name beside it, and the
 * route you pick flies between them as arcs in your travel's colour (the
 * van's dashes hug the ground, the train's run a little higher, the jet's
 * arc is solid and high), with your van, train or jet riding along it.
 *
 *   turn       drag the globe; it drifts on its own when you leave it
 *   zoom       scroll
 *   pick       click a pin or its name; the globe turns to the city you add
 *
 * TourMap owns the route and the list; this draws it. Without WebGL the flat
 * map stands in (createMenuScene returns null).
 */
import * as THREE from 'three';
import { CITIES, type City } from '../game/circuit';
import { arcPoints, cityLatLon, faceTurn, LABEL, latLonToXYZ, nearestAngle, onLand, spherePoints } from '../three/globe';
import { createMenuScene, damp, glowTexture } from '../three/menu3d';
import { h } from './dom';

export interface GlobeHooks {
  route: readonly string[];
  travel: 'van' | 'train' | 'jet';
  color: string;
  /** cities you've played on a tour */
  toured: readonly string[];
  toggle(id: string): void;
}

export interface TourGlobe {
  el: HTMLElement;
  /** the route changed: redraw it (and turn to the city just added) */
  update(): void;
}

const R = 1;
/** how high each kind of travel flies (× the hop's angle) */
const LIFT = { van: 0.04, train: 0.1, jet: 0.24 };
/** dash and gap along the route (globe units; 0: solid) */
const DASH = { van: [0.035, 0.03], train: [0.08, 0.02], jet: [0, 0] };

const ROUTE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ROUTE_FRAG = /* glsl */ `
uniform vec3 color;
uniform float time;
uniform float progress;
uniform float len;
uniform float dash;
uniform float gap;
varying vec2 vUv;
void main() {
  if (vUv.x > progress) discard;
  if (dash > 0.0) {
    float m = fract((vUv.x * len) / (dash + gap) - time * 0.9);
    if (m > dash / (dash + gap)) discard;
  }
  gl_FragColor = vec4(color * 1.7, 1.0);
}`;
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

const v3 = (p: [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2]);

interface Pin {
  city: City;
  group: THREE.Group;
  head: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  glow: THREE.Sprite;
  label: HTMLButtonElement;
  num: HTMLElement;
}

export function tourGlobe(o: GlobeHooks): TourGlobe | null {
  const ms = createMenuScene({ fov: 35, label: 'World map globe: drag to turn it, click cities to add them to the tour', className: 'tg-canvas' });
  if (!ms) return null;
  const { scene, camera } = ms;
  scene.background = new THREE.Color(0x04060d);
  scene.environmentIntensity = 0.15;

  /* space ---------------------------------------------------------------------- */
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

  /* the planet ----------------------------------------------------------------- */
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
      for (let i = 0; i < 96; i++) {
        seg.push(...latLonToXYZ(...fn(i / 96), R * 1.001), ...latLonToXYZ(...fn((i + 1) / 96), R * 1.001));
      }
    };
    for (let lon = -180; lon < 180; lon += 30) ring((t) => [-90 + t * 180, lon]);
    for (let lat = -60; lat <= 60; lat += 30) ring((t) => [lat, -180 + t * 360]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    spinG.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x3d5aa8, transparent: true, opacity: 0.18, depthWrite: false })));
  }

  /* the cities ------------------------------------------------------------------- */
  const labels = h('div', { class: 'tg-labels' });
  const glow = glowTexture();
  const headGeo = new THREE.SphereGeometry(0.014, 16, 12);
  const stickGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 0.05, 6).translate(0, 0.025, 0);
  const stickMat = new THREE.MeshBasicMaterial({ color: 0xcfd8ff, transparent: true, opacity: 0.55 });
  const hitGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const pins: Pin[] = CITIES.map((city) => {
    const [lat, lon] = cityLatLon(city);
    const group = new THREE.Group();
    group.position.copy(v3(latLonToXYZ(lat, lon, R)));
    // stand the pin up off the surface
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), group.position.clone().normalize());
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = 0.052;
    const gm = new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    const g = new THREE.Sprite(gm);
    g.scale.setScalar(0.09);
    g.position.y = 0.052;
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.y = 0.04;
    hit.userData.city = city.id;
    group.add(new THREE.Mesh(stickGeo, stickMat), head, g, hit);
    spinG.add(group);
    const num = h('span', { class: 'tg-n' });
    const label = h('button', { type: 'button', class: 'tg-label', tabindex: '-1' }, num, h('span', {}, city.name));
    label.addEventListener('click', () => o.toggle(city.id));
    labels.append(label);
    return { city, group, head, mat, glow: g, label, num };
  });

  /* the route ---------------------------------------------------------------------------- */
  const routeG = new THREE.Group();
  spinG.add(routeG);
  const routeMat = (len: number) =>
    new THREE.ShaderMaterial({
      vertexShader: ROUTE_VERT,
      fragmentShader: ROUTE_FRAG,
      uniforms: { color: { value: new THREE.Color(o.color) }, time: { value: 0 }, progress: { value: 1 }, len: { value: len }, dash: { value: DASH[o.travel][0] }, gap: { value: DASH[o.travel][1] } },
      transparent: true,
    });
  let legs: { curve: THREE.CatmullRomCurve3; mat: THREE.ShaderMaterial; len: number }[] = [];
  let drawIn = 1;
  // your ride along the route
  const ride = new THREE.Group();
  {
    const col = new THREE.Color(o.color);
    const body = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.4, metalness: 0.3, emissive: col, emissiveIntensity: 0.6 });
    if (o.travel === 'jet') {
      const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.06, 10).rotateX(Math.PI / 2), body);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.016, 10).rotateX(Math.PI / 2).translate(0, 0, 0.038), body);
      const wings = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.002, 0.016).translate(0, 0, 0.002), body);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.002, 0.008).translate(0, 0, -0.026), body);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.012, 0.01).translate(0, 0.006, -0.026), body);
      ride.add(fuselage, nose, wings, tail, fin);
    } else if (o.travel === 'train') {
      for (let i = 0; i < 3; i++) ride.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.024).translate(0, 0.005, -i * 0.027), body));
    } else {
      ride.add(new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.014, 0.03).translate(0, 0.007, 0), body));
    }
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: col, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.scale.setScalar(0.08);
    ride.add(g);
    ride.visible = false;
    spinG.add(ride);
  }

  const rebuildRoute = () => {
    for (const c of [...routeG.children]) {
      routeG.remove(c);
      (c as THREE.Mesh).geometry.dispose();
      ((c as THREE.Mesh).material as THREE.Material).dispose();
    }
    legs = [];
    const lift = LIFT[o.travel];
    for (let i = 1; i < o.route.length; i++) {
      const a = CITIES.find((x) => x.id === o.route[i - 1])!;
      const b = CITIES.find((x) => x.id === o.route[i])!;
      // from pin head to pin head
      const pa = latLonToXYZ(...cityLatLon(a), 1);
      const pb = latLonToXYZ(...cityLatLon(b), 1);
      const pts = arcPoints(pa, pb, lift, 64, R * 1.012).map(v3);
      const curve = new THREE.CatmullRomCurve3(pts);
      const len = curve.getLength();
      const mat = routeMat(len);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 128, o.travel === 'jet' ? 0.0055 : 0.0045, 6, false), mat);
      routeG.add(tube);
      legs.push({ curve, mat, len });
    }
    ride.visible = legs.length > 0;
  };

  /* turning the globe ------------------------------------------------------------------------ */
  // start over the Atlantic: the Americas, Europe and Africa in view
  const start = faceTurn(24, -30);
  let yaw = start.yaw;
  let tilt = start.tilt;
  let yawVel = 0.08;
  let tiltVel = 0;
  let focus: { yaw: number; tilt: number } | null = null;
  let dragging = false;
  let idle = 99;
  let dist = 4;
  let distTo = 4;
  let rideT = 0;
  let hover: string | null = null;

  const shown = new Set<string>();
  const update = () => {
    const before = new Set(shown);
    shown.clear();
    for (const id of o.route) shown.add(id);
    const added = o.route.find((id) => !before.has(id));
    rebuildRoute();
    // the newest leg draws itself in
    drawIn = added && o.route.length > 1 ? 0 : 1;
    if (added) {
      const t = faceTurn(...cityLatLon(CITIES.find((c) => c.id === added)!));
      focus = { yaw: nearestAngle(yaw, t.yaw), tilt: THREE.MathUtils.clamp(t.tilt, -0.9, 0.9) };
    }
    for (const p of pins) {
      const n = o.route.indexOf(p.city.id);
      p.num.textContent = n >= 0 ? String(n + 1) : '';
      p.label.classList.toggle('on', n >= 0);
      p.label.classList.toggle('played', o.toured.includes(p.city.id));
      p.label.setAttribute('aria-pressed', String(n >= 0));
    }
  };

  const wp = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const tColor = new THREE.Color(o.color);
  const white = new THREE.Color(0xffffff);
  const lime = new THREE.Color(0xb6ff3b);
  ms.onFrame = (dt, t) => {
    // turn: your drag, a turn to a city, or the slow drift
    if (!dragging) {
      idle += dt;
      if (focus) {
        yaw = damp(yaw, focus.yaw, 4, dt);
        tilt = damp(tilt, focus.tilt, 4, dt);
        if (Math.abs(yaw - focus.yaw) < 0.002 && Math.abs(tilt - focus.tilt) < 0.002) focus = null;
        yawVel = 0;
        tiltVel = 0;
      } else {
        yaw += yawVel * dt;
        tilt = THREE.MathUtils.clamp(tilt + tiltVel * dt, -1.2, 1.2);
        tiltVel *= Math.exp(-3 * dt);
        // let go: the spin eases down to the drift
        yawVel = damp(yawVel, idle > 2.5 ? 0.08 : yawVel * Math.exp(-2.5 * dt), 1.5, dt);
      }
    }
    tiltG.rotation.x = tilt;
    spinG.rotation.y = yaw;
    dist = damp(dist, distTo, 8, dt);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    // the route
    drawIn = Math.min(1, drawIn + dt / 0.8);
    legs.forEach((l, i) => {
      l.mat.uniforms.time.value = t;
      l.mat.uniforms.progress.value = i === legs.length - 1 ? drawIn : 1;
    });
    if (legs.length) {
      // the ride goes round the route at a steady speed, a breath at each city
      const total = legs.reduce((s, l) => s + l.len, 0);
      const speed = o.travel === 'jet' ? 0.5 : o.travel === 'train' ? 0.38 : 0.28;
      rideT = (rideT + (dt * speed) / total) % 1;
      let at = rideT * total;
      let leg = legs[0];
      for (const l of legs) {
        leg = l;
        if (at <= l.len) break;
        at -= l.len;
      }
      const u = Math.min(1, at / leg.len);
      const p = leg.curve.getPointAt(u);
      const ahead = leg.curve.getPointAt(Math.min(1, u + 0.01));
      if (u > 0.99) ahead.copy(p).add(leg.curve.getTangentAt(u).multiplyScalar(0.01));
      ride.position.copy(p);
      // upright on the planet (lookAt takes its up and target in world space)
      ride.up.copy(spinG.localToWorld(p.clone())).normalize();
      ride.lookAt(spinG.localToWorld(ahead.clone()));
    }
    // the pins and their names
    camera.updateMatrixWorld();
    const W = ms.size.w;
    const H = ms.size.h;
    for (const p of pins) {
      const n = o.route.indexOf(p.city.id);
      const on = n >= 0;
      const played = o.toured.includes(p.city.id);
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + p.city.x * 20);
      const col = on ? tColor : hover === p.city.id ? white : played ? lime : white;
      p.mat.color.copy(col);
      (p.glow.material as THREE.SpriteMaterial).color.copy(col);
      (p.glow.material as THREE.SpriteMaterial).opacity = on ? 0.95 : 0.35 + pulse * 0.3;
      const s = on ? 1.5 : hover === p.city.id ? 1.35 : 1;
      p.head.scale.setScalar(s);
      p.glow.scale.setScalar(0.09 * s * (on ? 1.3 : 1));
      // the name: beside the pin while it faces you, gone round the back
      p.head.getWorldPosition(wp);
      camDir.copy(camera.position).sub(wp).normalize();
      const facing = wp.clone().normalize().dot(camDir);
      const v = wp.project(camera);
      const vis = THREE.MathUtils.clamp((facing - 0.08) / 0.2, 0, 1);
      const [dx, dy, align] = LABEL[p.city.id] ?? [0, 18, 'center'];
      const x = (v.x * 0.5 + 0.5) * W + dx + (align === 'right' ? -6 : align === 'left' ? 6 : 0);
      const y = (-v.y * 0.5 + 0.5) * H + dy;
      const tx = align === 'right' ? '-100%' : align === 'left' ? '0' : '-50%';
      p.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${tx}, -50%)`;
      p.label.style.opacity = vis.toFixed(2);
      p.label.style.pointerEvents = vis > 0.5 ? 'auto' : 'none';
    }
  };

  /* input -------------------------------------------------------------------------------------- */
  const canvas = ms.canvas;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hits = pins.map((p) => p.group.children[3]);
  const cityAt = (x: number, y: number): string | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([sphere, ...hits], false)[0];
    return (hit?.object.userData.city as string | undefined) ?? null;
  };
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let downX = 0;
  let downY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    focus = null;
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    lastT = performance.now();
    yawVel = 0;
    tiltVel = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) {
      hover = cityAt(e.clientX, e.clientY);
      canvas.style.cursor = hover ? 'pointer' : 'grab';
      return;
    }
    canvas.style.cursor = 'grabbing';
    const now = performance.now();
    const k = (2.2 / Math.max(300, ms.size.h)) * (dist / 4);
    const dx = (e.clientX - lastX) * k;
    const dy = (e.clientY - lastY) * k;
    yaw += dx;
    tilt = THREE.MathUtils.clamp(tilt + dy, -1.2, 1.2);
    const sec = Math.max(0.008, (now - lastT) / 1000);
    yawVel = dx / sec;
    tiltVel = dy / sec;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = now;
  });
  const up = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    idle = 0;
    canvas.style.cursor = 'grab';
    if (performance.now() - lastT > 80) {
      yawVel = 0;
      tiltVel = 0;
    }
    yawVel = THREE.MathUtils.clamp(yawVel, -6, 6);
    tiltVel = THREE.MathUtils.clamp(tiltVel, -4, 4);
    if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5) {
      const id = cityAt(e.clientX, e.clientY);
      if (id) o.toggle(id);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      distTo = THREE.MathUtils.clamp(distTo * Math.exp(e.deltaY * 0.0012), 2.1, 5);
    },
    { passive: false },
  );

  update();
  const el = h('div', { class: 'tg' }, canvas, labels, h('span', { class: 'tg-hint' }, 'Drag to turn · scroll to zoom · click a city'));
  el.style.setProperty('--tc', o.color);
  return { el, update };
}
