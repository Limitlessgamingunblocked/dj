/*
 * The venue globe: every room you can play, round one planet. The real
 * clubs are pins where they really are (one per city, so London's pin holds
 * Printworks and both Ally Pally rooms), the career's own rooms ride an orbit
 * of picture cards round it, and the secret rooms (and the ones you've
 * built) float further out as glowing portals.
 *
 *   look       drag the planet; scroll to zoom
 *   pick       click a pin, a card or a portal, or a name in the list; the
 *              planet turns to a club (and leans in), a ring turns its room
 *              to the front
 *   go         "Go there", Enter or a double-click: the camera dives into it
 *              and the room loads behind the dialog with its walk-in
 *
 * Without WebGL, the cards stand in (createMenuScene returns null).
 */
import * as THREE from 'three';
import { uiSound } from '../audio/uisound';
import { prefs } from '../core/prefs';
import { ringTurnFor, slotPosition } from '../three/carousel';
import { createMenuScene, damp, glowTexture } from '../three/menu3d';
import { buildPlanet, GlobeSpin, makePin, pickAt, type PinMesh, placeLabel } from '../three/planet';
import { CITY_LABEL, cityPins, GROUP_NAMES, ringRadius, venueGroup, type CityPin, type VenueGroup } from '../three/venueMap';
import { VENUES, type VenueDef } from '../three/venues';
import { CRAZY_ROOMS } from '../three/venues/rooms';
import { h } from './dom';
import type { ModalHandle } from './modal';

export interface VenueGlobeHooks {
  current: () => string;
  pick: (id: string) => void;
  locked: (id: string) => string | null;
  /** switch to the flat cards */
  grid(): void;
}

/** how far out the camera sits: the whole system, and leaning in to a club */
const FAR = 6.6;
const NEAR = 4.3;
const CARD_W = 0.56;
const CARD_H = CARD_W * (9 / 16);
const PORTAL_R = 0.2;

const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

interface Ring {
  g: THREE.Group;
  items: Item[];
  yaw: number;
  /** turning a room to the front (null: drifting) */
  yawTo: number | null;
  drift: number;
}

interface Item {
  def: VenueDef;
  group: VenueGroup;
  ring: Ring;
  slot: number;
  holder: THREE.Group;
  pic: THREE.MeshBasicMaterial;
  frame: THREE.MeshBasicMaterial;
  glow: THREE.Sprite;
  /** the portal's spinning rim (cards have none) */
  rim?: THREE.Mesh;
  built: boolean;
}

interface CityMark extends PinMesh {
  pin: CityPin;
  label: HTMLButtonElement;
}

/** draw a venue's illustration onto a canvas texture: 16:9 for a card, a centred square for a portal */
function thumbTexture(def: VenueDef, square: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  const H = 160;
  const W = Math.round((H * 16) / 9);
  c.width = square ? H : W;
  c.height = H;
  const g = c.getContext('2d')!;
  if (square) g.translate(-(W - H) / 2, 0);
  def.thumb(g, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function venueGlobe(o: VenueGlobeHooks, modal: () => ModalHandle | null): HTMLElement | null {
  const ms = createMenuScene({ fov: 35, label: 'Venue globe: real clubs pinned on the planet, the career rooms in orbit, the secret rooms as portals', className: 'vg-canvas' });
  if (!ms) return null;
  const { scene, camera, canvas } = ms;
  const planet = buildPlanet(scene);
  // start over the Atlantic, Europe and the US both in view
  const spin = new GlobeSpin(planet, { lat: 38, lon: -40, dist: FAR, zoom: [3.6, 8.5] });
  spin.drift = 0.05;

  const secret = new Set(CRAZY_ROOMS.map((v) => v.id));
  const venues = VENUES.slice();
  const groupOf = (id: string) => venueGroup(id, secret);
  const glow = glowTexture();

  /* the real clubs ------------------------------------------------------------------------------ */
  const labels = h('div', { class: 'tg-labels vg-labels' });
  const cities: CityMark[] = cityPins(venues.map((v) => v.id)).map((pin) => {
    const mark = makePin(pin.lat, pin.lon, `city:${pin.city}`);
    mark.group.scale.setScalar(1.45);
    planet.spinG.add(mark.group);
    const label = h('button', { type: 'button', class: 'tg-label vg-city', tabindex: '-1' }, h('span', {}, pin.city), pin.ids.length > 1 ? h('span', { class: 'vg-count' }, String(pin.ids.length)) : null);
    label.addEventListener('click', () => clickCity(pin));
    labels.append(label);
    return { ...mark, pin, label };
  });

  /* the rings: the career's rooms as cards, the secret rooms as portals ----------------------- */
  const tilt = new THREE.Group();
  tilt.rotation.x = 0.3;
  scene.add(tilt);
  const outerTilt = new THREE.Group();
  outerTilt.rotation.set(0.3, 0, 0.06);
  scene.add(outerTilt);
  const cardRing: Ring = { g: new THREE.Group(), items: [], yaw: 0, yawTo: null, drift: 0.06 };
  const portalRing: Ring = { g: new THREE.Group(), items: [], yaw: 0, yawTo: null, drift: -0.035 };
  tilt.add(cardRing.g);
  outerTilt.add(portalRing.g);

  const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const frameGeo = new THREE.PlaneGeometry(CARD_W + 0.03, CARD_H + 0.03);
  const discGeo = new THREE.CircleGeometry(PORTAL_R * 0.94, 48);
  const rimGeo = new THREE.TorusGeometry(PORTAL_R, 0.014, 10, 64);
  const swirlGeo = new THREE.TorusGeometry(PORTAL_R * 1.12, 0.004, 6, 64, Math.PI * 1.3);
  const hitCard = new THREE.PlaneGeometry(CARD_W * 1.1, CARD_H * 1.2);
  const hitPortal = new THREE.CircleGeometry(PORTAL_R * 1.25, 16);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });

  const items: Item[] = [];
  for (const def of venues) {
    const group = groupOf(def.id);
    if (group === 'real') continue;
    const portal = group !== 'circuit';
    const ring = portal ? portalRing : cardRing;
    const holder = new THREE.Group();
    const col = new THREE.Color(def.ui);
    const pic = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.25), toneMapped: false, transparent: true, side: THREE.DoubleSide });
    const frame = new THREE.MeshBasicMaterial({ color: col, toneMapped: false, transparent: true, side: THREE.DoubleSide });
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: col, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    const hit = new THREE.Mesh(portal ? hitPortal : hitCard, hitMat);
    hit.userData.id = def.id;
    const item: Item = { def, group, ring, slot: ring.items.length, holder, pic, frame, glow: halo, built: false };
    if (portal) {
      halo.scale.setScalar(PORTAL_R * 3.6);
      const rim = new THREE.Mesh(rimGeo, frame);
      const swirl = new THREE.Mesh(swirlGeo, frame);
      rim.add(swirl);
      holder.add(halo, new THREE.Mesh(discGeo, pic), rim, hit);
      item.rim = rim;
    } else {
      halo.scale.set(CARD_W * 1.9, CARD_H * 2.4, 1);
      const back = new THREE.Mesh(frameGeo, frame);
      back.position.z = -0.003;
      holder.add(halo, back, new THREE.Mesh(cardGeo, pic), hit);
    }
    ring.items.push(item);
    ring.g.add(holder);
    items.push(item);
  }
  const placeRing = (ring: Ring, r: number) => {
    for (const it of ring.items) {
      const [x, z] = slotPosition(it.slot, ring.items.length, r);
      it.holder.position.set(x, 0, z);
    }
  };
  placeRing(cardRing, ringRadius(cardRing.items.length, CARD_W * 2.1, 1.85));
  placeRing(portalRing, ringRadius(portalRing.items.length, PORTAL_R * 2.9, 2.75));
  // pictures are drawn a couple a frame, the chosen room first
  const queue = items.slice();
  const build = (it: Item) => {
    if (it.built) return;
    it.built = true;
    queue.splice(queue.indexOf(it), 1);
    it.pic.map = thumbTexture(it.def, !!it.rim);
    it.pic.color.set(0xffffff);
    it.pic.needsUpdate = true;
  };

  /* the dialog around it ------------------------------------------------------------------------ */
  const kind = h('span', { class: 'sr-cls' });
  const name = h('b', { class: 'sr-name' });
  const desc = h('p', { class: 'sr-desc' });
  const cap = h('span', { class: 'vg-cap' });
  const tag = h('span', { class: 'sr-tag vg-here' }, "You're here");
  const tip = h('span', { class: 'vg-tip' });
  const flash = h('div', { class: 'vg-flash' });
  const go = h('button', { type: 'button', class: 'btn primary' }, 'Go there');
  const gridBtn = h('button', { type: 'button', class: 'btn ghost small' }, 'Grid view');
  const list = h('div', { class: 'vg-list', role: 'listbox', 'aria-label': 'Venues' });
  const rows = new Map<string, HTMLButtonElement>();
  for (const g of ['real', 'circuit', 'secret', 'yours'] as VenueGroup[]) {
    const here = venues.filter((v) => groupOf(v.id) === g);
    if (!here.length) continue;
    list.append(h('span', { class: 'vg-head' }, GROUP_NAMES[g]));
    for (const v of here) {
      const lock = o.locked(v.id);
      const row = h('button', { type: 'button', class: `vg-row${lock ? ' locked' : ''}`, role: 'option', title: lock ?? v.place }, h('i', { style: { background: v.ui } }), h('span', {}, v.name));
      row.addEventListener('click', () => select(v.id));
      rows.set(v.id, row);
      list.append(row);
    }
  }
  const order = [...rows.keys()];

  let sel = o.current();
  if (!rows.has(sel)) sel = order[0];
  let dive = -1;
  let diveDone: (() => void) | null = null;
  let diveFrom = new THREE.Vector3();
  const itemOf = (id: string) => items.find((i) => i.def.id === id);
  const cityOf = (id: string) => cities.find((c) => c.pin.ids.includes(id));

  const refresh = () => {
    const def = venues.find((v) => v.id === sel)!;
    const g = groupOf(sel);
    const lock = o.locked(sel);
    const here = sel === o.current();
    kind.textContent = g === 'real' ? `${GROUP_NAMES.real} · ${def.place}` : g === 'circuit' ? `${GROUP_NAMES.circuit} · ${def.place}` : g === 'secret' ? 'Secret room' : 'Your room';
    name.textContent = def.name;
    desc.textContent = lock ?? def.blurb;
    desc.classList.toggle('vg-locked', !!lock);
    cap.textContent = `Capacity ${def.capacity}`;
    tag.hidden = !here;
    go.textContent = here ? 'Stay here' : lock ? 'Locked' : 'Go there';
    go.disabled = !!lock && !here;
    root.style.setProperty('--vc', def.ui);
    for (const [id, row] of rows) {
      row.classList.toggle('active', id === sel);
      row.classList.toggle('current', id === o.current());
      row.setAttribute('aria-selected', String(id === sel));
    }
    rows.get(sel)?.scrollIntoView({ block: 'nearest' });
  };

  /** bring a venue round to the front */
  const select = (id: string, quiet = false) => {
    if (dive >= 0) return;
    sel = id;
    const it = itemOf(id);
    const city = cityOf(id);
    if (city) {
      spin.focusOn(city.pin.lat, city.pin.lon);
      spin.distTo = NEAR;
    } else if (it) {
      it.ring.yawTo = ringTurnFor(it.slot, it.ring.items.length, it.ring.yaw);
      spin.distTo = FAR;
      build(it);
    }
    if (!quiet) uiSound('tap');
    refresh();
  };

  const clickCity = (pin: CityPin) => {
    // a second click on a city with more than one room steps through them
    const at = pin.ids.indexOf(sel);
    select(pin.ids[at >= 0 ? (at + 1) % pin.ids.length : 0]);
  };

  const goThere = () => {
    if (dive >= 0) return;
    if (sel === o.current()) {
      modal()?.close();
      return;
    }
    if (o.locked(sel)) return;
    const id = sel;
    const done = () => {
      modal()?.close();
      o.pick(id);
    };
    uiSound('stamp');
    if (motionQuery?.matches || !prefs.cameraMotion) {
      done();
      return;
    }
    dive = 0;
    diveFrom = camera.position.clone();
    spin.hold();
    diveDone = done;
  };

  /* every frame --------------------------------------------------------------------------------- */
  const wp = new THREE.Vector3();
  const pq = new THREE.Quaternion();
  const target = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const white = new THREE.Color(0xffffff);
  const lime = new THREE.Color(0xb6ff3b);
  const grey = new THREE.Color(0x5b6478);
  const turnRing = (r: Ring, dt: number) => {
    if (dive >= 0) return;
    if (r.yawTo !== null) {
      r.yaw = damp(r.yaw, r.yawTo, 3.5, dt);
      if (Math.abs(r.yaw - r.yawTo) < 0.001) r.yawTo = null;
    } else if (!itemOf(sel) || itemOf(sel)!.ring !== r) r.yaw += r.drift * dt;
    r.g.rotation.y = r.yaw;
  };
  /** where the camera dives to: the pin's head, or the room's picture */
  const diveTarget = (out: THREE.Vector3) => {
    const it = itemOf(sel);
    if (it) return it.holder.getWorldPosition(out);
    return cityOf(sel)!.head.getWorldPosition(out);
  };

  ms.onFrame = (dt, t) => {
    spin.update(dt);
    turnRing(cardRing, dt);
    turnRing(portalRing, dt);
    if (dive >= 0) {
      dive += dt;
      const k = Math.min(1, dive / 0.9);
      const e = k * k * (3 - 2 * k);
      diveTarget(target);
      // stop just short of it, coming at it from where the camera was
      const end = target.clone().add(diveFrom.clone().sub(target).normalize().multiplyScalar(0.06));
      camera.position.lerpVectors(diveFrom, end, e);
      camera.fov = 35 - 14 * e;
      camera.updateProjectionMatrix();
      camera.lookAt(aim.clone().lerp(target, e));
      flash.style.opacity = Math.max(0, (k - 0.55) / 0.45).toFixed(2);
      if (dive > 0.95 && diveDone) {
        const f = diveDone;
        diveDone = null;
        f();
      }
    } else {
      // looking a little below the planet, so the front of the rings is in view (not when leaning in to a club)
      aim.set(0, -0.25 * THREE.MathUtils.clamp((spin.dist - NEAR) / (FAR - NEAR), 0, 1), 0);
      camera.position.set(0, 0, spin.dist);
      camera.lookAt(aim);
    }
    camera.updateMatrixWorld();

    // a couple of pictures a frame
    for (let n = 0; n < 2 && queue.length; n++) build(queue[0]);

    const current = o.current();
    const hover = spin.hover;
    const near = THREE.MathUtils.clamp((FAR - spin.dist) / (FAR - NEAR), 0, 1);
    for (const it of items) {
      // face the camera; dim round the back of the ring, and while leaning in to a club
      it.holder.parent!.getWorldQuaternion(pq);
      it.holder.quaternion.copy(pq.invert().multiply(camera.quaternion));
      it.holder.getWorldPosition(wp);
      const front = THREE.MathUtils.smoothstep(wp.z, -2.4, 2.4);
      const on = it.def.id === sel;
      const locked = !!o.locked(it.def.id);
      const fade = (0.3 + 0.7 * front) * (1 - near * 0.75);
      it.pic.opacity = fade * (locked ? 0.45 : 1);
      it.frame.opacity = fade;
      it.frame.color.set(locked ? grey : it.def.id === current ? lime : it.def.ui);
      (it.glow.material as THREE.SpriteMaterial).opacity = fade * (on ? 0.9 : hover === it.def.id ? 0.6 : 0.25 + 0.1 * Math.sin(t * 2 + it.slot));
      const s = on ? 1.3 : hover === it.def.id ? 1.12 : 1;
      it.holder.scale.setScalar(damp(it.holder.scale.x, s, 10, dt));
      if (it.rim) it.rim.rotation.z = t * (0.6 + (it.slot % 3) * 0.2) * (it.slot % 2 ? 1 : -1);
    }
    for (const c of cities) {
      const has = c.pin.ids.includes(sel);
      const locked = c.pin.ids.every((id) => o.locked(id));
      const col = c.pin.ids.includes(current) ? lime : locked ? grey : white;
      c.mat.color.copy(col);
      const gm = c.glow.material as THREE.SpriteMaterial;
      gm.color.copy(col);
      gm.opacity = has ? 0.95 : 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.4 + c.pin.lon));
      const s = has ? 1.6 : hover === `city:${c.pin.city}` ? 1.35 : 1;
      c.head.scale.setScalar(s);
      c.glow.scale.setScalar(0.09 * s);
      placeLabel(c.label, c.head, camera, ms.size, CITY_LABEL[c.pin.city]);
      c.label.classList.toggle('on', has);
      c.label.classList.toggle('played', c.pin.ids.includes(current));
    }
    // the name of the room under the pointer (or the chosen one), beside it
    const named = (hover && !hover.startsWith('city:') ? itemOf(hover) : null) ?? itemOf(sel);
    if (named && dive < 0) {
      named.holder.getWorldPosition(wp);
      const v = wp.project(camera);
      const dy = (named.rim ? PORTAL_R : CARD_H / 2) * 1.3;
      const px = (v.x * 0.5 + 0.5) * ms.size.w;
      const py = (-v.y * 0.5 + 0.5) * ms.size.h;
      // the picture's half-height in pixels, from its distance
      const half = (dy / Math.max(0.1, camera.position.distanceTo(named.holder.getWorldPosition(wp)))) * (ms.size.h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      tip.textContent = named.def.name;
      tip.style.transform = `translate(${px.toFixed(1)}px, ${(py + half + 4).toFixed(1)}px) translate(-50%, 0)`;
      tip.style.opacity = (1 - near).toFixed(2);
    } else tip.style.opacity = '0';
  };

  /* input --------------------------------------------------------------------------------------- */
  const blockers = [planet.sphere];
  const targets = [...cities.map((c) => c.hit), ...items.map((i) => i.holder.children[i.holder.children.length - 1])];
  const pick = (x: number, y: number) => (dive >= 0 ? null : pickAt(canvas, camera, x, y, blockers, targets));
  const clickAt = (id: string) => {
    if (id.startsWith('city:')) {
      const c = cities.find((m) => `city:${m.pin.city}` === id);
      if (c) clickCity(c.pin);
    } else select(id);
  };
  spin.attach(canvas, ms.size, pick, clickAt);
  canvas.addEventListener('dblclick', (e) => {
    const id = pick(e.clientX, e.clientY);
    if (!id) return;
    if (!id.startsWith('city:')) select(id, true);
    goThere();
  });
  go.addEventListener('click', goThere);
  gridBtn.addEventListener('click', () => o.grid());

  const root = h(
    'div',
    { class: 'showroom vg', tabindex: '-1' },
    h('div', { class: 'vg-main' }, h('div', { class: 'tg vg-stage' }, canvas, labels, tip, tag, flash, h('span', { class: 'sr-hint' }, 'Drag to turn · scroll to zoom · double-click to go')), list),
    h('div', { class: 'sr-info' }, h('div', { class: 'sr-text' }, kind, name, desc, cap), h('div', { class: 'sr-side' }, h('div', { class: 'sr-actions' }, gridBtn, go))),
    h('p', { class: 'note fineprint' }, 'Real venues are fan-made recreations, not affiliated with the clubs.'),
  );
  root.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const i = order.indexOf(sel);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') select(order[(i + 1) % order.length]);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') select(order[(i - 1 + order.length) % order.length]);
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) goThere();
    else return;
    e.preventDefault();
  });

  select(sel, true);
  // the first look is the whole system, not leaning in
  spin.distTo = spin.dist = FAR;
  const it = itemOf(sel);
  if (it) {
    it.ring.yaw = it.ring.yawTo!;
    it.ring.yawTo = null;
  }
  return root;
}
