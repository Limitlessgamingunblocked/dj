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
import { arcPoints, cityLatLon, LABEL, latLonToXYZ } from '../three/globe';
import { createMenuScene, glowTexture } from '../three/menu3d';
import { buildPlanet, GlobeSpin, makePin, pickAt, type PinMesh, placeLabel, PLANET_R as R, v3 } from '../three/planet';
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
interface Pin extends PinMesh {
  city: City;
  label: HTMLButtonElement;
  num: HTMLElement;
}

export function tourGlobe(o: GlobeHooks): TourGlobe | null {
  const ms = createMenuScene({ fov: 35, label: 'World map globe: drag to turn it, click cities to add them to the tour', className: 'tg-canvas' });
  if (!ms) return null;
  const { scene, camera } = ms;
  const planet = buildPlanet(scene);
  const { spinG, sphere } = planet;

  /* the cities ------------------------------------------------------------------- */
  const labels = h('div', { class: 'tg-labels' });
  const glow = glowTexture();
  const pins: Pin[] = CITIES.map((city) => {
    const pin = makePin(...cityLatLon(city), city.id);
    spinG.add(pin.group);
    const num = h('span', { class: 'tg-n' });
    const label = h('button', { type: 'button', class: 'tg-label', tabindex: '-1' }, num, h('span', {}, city.name));
    label.addEventListener('click', () => o.toggle(city.id));
    labels.append(label);
    return { ...pin, city, label, num };
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
  const spin = new GlobeSpin(planet, { lat: 24, lon: -30, dist: 4, zoom: [2.1, 5] });
  let rideT = 0;

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
      spin.focusOn(...cityLatLon(CITIES.find((c) => c.id === added)!));
    }
    for (const p of pins) {
      const n = o.route.indexOf(p.city.id);
      p.num.textContent = n >= 0 ? String(n + 1) : '';
      p.label.classList.toggle('on', n >= 0);
      p.label.classList.toggle('played', o.toured.includes(p.city.id));
      p.label.setAttribute('aria-pressed', String(n >= 0));
    }
  };

  const tColor = new THREE.Color(o.color);
  const white = new THREE.Color(0xffffff);
  const lime = new THREE.Color(0xb6ff3b);
  ms.onFrame = (dt, t) => {
    // turn: your drag, a turn to a city, or the slow drift
    spin.update(dt);
    camera.position.set(0, 0, spin.dist);
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
    const hover = spin.hover;
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
      placeLabel(p.label, p.head, camera, ms.size, LABEL[p.city.id]);
    }
  };

  /* input -------------------------------------------------------------------------------------- */
  const canvas = ms.canvas;
  const hits = pins.map((p) => p.hit);
  spin.attach(canvas, ms.size, (x, y) => pickAt(canvas, camera, x, y, [sphere], hits), (id) => o.toggle(id));

  update();
  const el = h('div', { class: 'tg' }, canvas, labels, h('span', { class: 'tg-hint' }, 'Drag to turn · scroll to zoom · click a city'));
  el.style.setProperty('--tc', o.color);
  return { el, update };
}
