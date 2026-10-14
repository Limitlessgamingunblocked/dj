/*
 * The board showroom: every board stands on its own lit plinth in a dark
 * room, real size, built from the same presets as the one on stage. The
 * plinths stand in a ring that turns to bring the board you're looking at to
 * the front, where it sways under a spotlight.
 *
 *   browse     ‹ › buttons, ← → keys, the names along the bottom, or click a
 *              board at the side
 *   look       drag to spin the board, scroll to zoom
 *   finish     the swatches repaint the board on its plinth
 *   pick       "Play on this" (or Enter): the camera dives in, the dialog
 *              closes and the board is yours
 *
 * Without WebGL, or from "Grid view", the flat cards (BoardPicker) stand in.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { uiSound } from '../audio/uisound';
import { BOARDS, buildBoard, type BoardDef } from '../three/boards';
import type { BoardBuild, Finish } from '../three/builder';
import { TouchScreenPart } from '../three/deviceScreen';
import { ScreenPart } from '../three/parts';
import { plinthScale, ringTurnFor, slotPosition, wrapIndex } from '../three/carousel';
import { createMenuScene, damp, glowTexture } from '../three/menu3d';
import { h } from './dom';
import { icon } from './icons';
import type { ModalHandle } from './modal';

const N = BOARDS.length;
/** the ring's radius (m) */
const RING = 3.4;
/** plinth height: about a booth table */
const PLINTH_H = 0.82;
/** the widest board a plinth takes at real size (m) */
const MAX_W = 1.25;
/** how far the front board sways either way when you're not spinning it (radians) */
const SWAY = 0.42;

interface Slot {
  def: BoardDef;
  finish: string;
  holder: THREE.Group;
  /** turns the board (sway or your drag) */
  spin: THREE.Group;
  build: BoardBuild | null;
  plinth: THREE.Mesh;
  strip: THREE.MeshBasicMaterial;
  pool: THREE.MeshBasicMaterial;
  /** the board's hardware footprint after scaling (m) */
  w: number;
  d: number;
  /** set when the board's been rebuilt and should pop */
  pop: number;
}

export interface ShowroomHooks {
  current: { board: string; finish: string };
  choose(board: string, finish: string): void;
  /** swap to the flat cards */
  grid(): void;
}

/** the showroom inside a dialog's body, or null without WebGL */
export function boardShowroom(o: ShowroomHooks, modal: () => ModalHandle | null): HTMLElement | null {
  const ms = createMenuScene({ fov: 32, label: 'Board showroom: drag to spin the board, scroll to zoom', className: 'sr-canvas' });
  if (!ms) return null;
  const { scene, camera } = ms;
  scene.background = new THREE.Color(0x06080c);
  scene.fog = new THREE.Fog(0x06080c, 6, 18);

  /* the room ----------------------------------------------------------------- */
  const floor = new THREE.Mesh(new THREE.CircleGeometry(18, 64), new THREE.MeshStandardMaterial({ color: 0x07090d, roughness: 0.85, metalness: 0, envMapIntensity: 0.1 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // a ring of light set into the floor around the plinths
  const inlay = new THREE.Mesh(new THREE.RingGeometry(RING + 0.92, RING + 0.95, 128), new THREE.MeshBasicMaterial({ color: 0x2a3550, fog: true }));
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.002;
  scene.add(inlay);
  // tall light strips on the far walls
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x1d2a44, fog: true });
  const stripGeo = new THREE.BoxGeometry(0.05, 4.2, 0.05);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const m = new THREE.Mesh(stripGeo, stripMat);
    m.position.set(Math.sin(a) * 12, 2.1, Math.cos(a) * 12);
    scene.add(m);
  }
  scene.add(new THREE.HemisphereLight(0x8fa6d8, 0x06070a, 0.35));
  // the showroom spot, fixed over the front plinth
  const spot = new THREE.SpotLight(0xfff4e8, 26, 6, 0.36, 0.5, 1.4);
  spot.position.set(0.5, PLINTH_H + 2.6, RING + 1.0);
  spot.target.position.set(0, PLINTH_H, RING);
  scene.add(spot, spot.target);
  const rim = new THREE.DirectionalLight(0x6f8cff, 0.6);
  rim.position.set(-2, 3, -1);
  scene.add(rim);

  /* the plinths ---------------------------------------------------------------- */
  const ring = new THREE.Group();
  scene.add(ring);
  const glow = glowTexture();
  const shadowTex = glowTexture();
  const startIdx = Math.max(0, BOARDS.findIndex((d) => d.id === o.current.board));
  const slots: Slot[] = BOARDS.map((def, i) => {
    const holder = new THREE.Group();
    const [x, z] = slotPosition(i, N, RING);
    holder.position.set(x, 0, z);
    // each plinth faces the middle of the ring's front (so the board faces out)
    holder.rotation.y = (i / N) * Math.PI * 2;
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.5, metalness: 0.5 });
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(1, PLINTH_H, 1, 3, 0.02), plinthMat);
    plinth.position.y = PLINTH_H / 2;
    plinth.userData.slot = i;
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.finishes[0].accent), toneMapped: false });
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1, 0.005, 0.005), strip);
    edge.name = 'edge';
    // a pool of the board's colour on the floor in front
    const pool = new THREE.MeshBasicMaterial({ map: glow, color: new THREE.Color(def.finishes[0].accent), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    const poolSprite = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), pool);
    poolSprite.rotation.x = -Math.PI / 2;
    poolSprite.name = 'pool';
    // under the board: a soft dark patch on the plinth top, so it sits rather than floats
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
    shade.name = 'shade';
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = PLINTH_H + 0.0015;
    const spin = new THREE.Group();
    spin.position.y = PLINTH_H;
    holder.add(plinth, edge, poolSprite, shade, spin);
    ring.add(holder);
    const finish = def.id === o.current.board ? o.current.finish : def.finishes[0].id;
    return { def, finish, holder, spin, build: null, plinth, strip, pool, w: 0.8, d: 0.5, pop: 0 };
  });

  /** size the plinth and its trim to the board on it */
  const fitPlinth = (s: Slot) => {
    const pw = s.w + 0.22;
    const pd = s.d + 0.26;
    s.plinth.scale.set(pw, 1, pd);
    const edge = s.holder.getObjectByName('edge')!;
    edge.scale.x = pw - 0.04;
    edge.position.set(0, PLINTH_H - 0.05, pd / 2 + 0.002);
    const pool = s.holder.getObjectByName('pool')!;
    pool.scale.set(pw * 2.2, pw * 1.1, 1);
    pool.position.set(0, 0.004, pd / 2 + 0.3);
    const shade = s.holder.getObjectByName('shade')!;
    shade.scale.set(s.w * 1.25, s.d * 1.45, 1);
  };

  /** the screens show a demo splash, as boards on a shop floor do (nothing's driving them here) */
  const splash = (b: BoardBuild, def: BoardDef, f: Finish) => {
    for (const p of b.parts) {
      if (!(p instanceof ScreenPart || p instanceof TouchScreenPart)) continue;
      p.object.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        const c = m?.map?.image;
        if (!m?.isMeshBasicMaterial || !(c instanceof HTMLCanvasElement)) return;
        const g = c.getContext('2d');
        if (!g) return;
        const W = c.width;
        const H = c.height;
        const grad = g.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, '#0a0d14');
        grad.addColorStop(1, '#141a28');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
        g.fillStyle = f.accent;
        g.fillRect(0, H * 0.62, W, Math.max(2, H * 0.012));
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#f2f5fa';
        g.font = `700 ${Math.round(Math.min(H * 0.16, W * 0.09))}px system-ui, sans-serif`;
        g.fillText('DECKHOUSE', W / 2, H * 0.4, W * 0.9);
        g.fillStyle = 'rgba(230,236,255,0.7)';
        g.font = `500 ${Math.round(Math.min(H * 0.08, W * 0.045))}px system-ui, sans-serif`;
        g.fillText(def.name.toUpperCase(), W / 2, H * 0.78, W * 0.9);
        m.map!.needsUpdate = true;
      });
    }
  };

  const place = (s: Slot) => {
    if (s.build) s.spin.remove(s.build.root);
    const b = buildBoard(s.def, s.finish);
    // the cables would hang off the plinth's back: the showroom shows the hardware
    b.cables?.removeFromParent();
    b.root.updateMatrixWorld(true);
    const hw = new THREE.Box3();
    for (const u of b.units) hw.union(new THREE.Box3().setFromObject(u.group));
    const box = hw.isEmpty() ? new THREE.Box3().setFromObject(b.root) : hw;
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const k = plinthScale(size.x, MAX_W);
    b.root.scale.setScalar(k);
    b.root.position.set(-c.x * k, 0, -c.z * k);
    s.spin.add(b.root);
    s.build = b;
    s.w = size.x * k;
    s.d = size.z * k;
    const f = s.def.finishes.find((x) => x.id === s.finish) ?? s.def.finishes[0];
    splash(b, s.def, f);
    s.strip.color.set(f.accent);
    s.pool.color.set(f.accent);
    fitPlinth(s);
  };

  /* state ---------------------------------------------------------------------- */
  let idx = startIdx;
  let turn = ringTurnFor(idx, N, 0);
  ring.rotation.y = turn;
  let zoom = 1;
  let zoomTo = 1;
  // the front board's spin: your drag, then a drift back to the sway
  let yaw = 0;
  let yawVel = 0;
  let dragging = false;
  let released = 99;
  let dive = -1;
  let diveDone: (() => void) | null = null;
  place(slots[idx]);
  // the rest are built a frame at a time, nearest first, so opening doesn't stall
  const queue = slots
    .map((s, i) => ({ s, d: Math.min(wrapIndex(i - idx, N), wrapIndex(idx - i, N)) }))
    .filter((q) => q.s !== slots[idx])
    .sort((a, b) => a.d - b.d)
    .map((q) => q.s);

  /* the camera ---------------------------------------------------------------------- */
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const frame = (immediate: boolean, dt: number) => {
    const s = slots[idx];
    // back far enough to fit the board's width, a little more for deep ones
    const span = Math.max(s.w * 1.15, s.d * 1.9, 0.75);
    let dist = (span / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1.6, Math.max(0.9, camera.aspect))) * 1.05 + 0.45;
    dist *= zoom;
    let look = new THREE.Vector3(0, PLINTH_H + 0.02, RING);
    let pos = new THREE.Vector3(0, PLINTH_H + 0.12 + dist * 0.55, RING + dist * 0.84);
    if (dive >= 0) {
      // dive towards the board, ending over it like the performance view
      const k = Math.min(1, dive / 0.75);
      const e = k * k * (3 - 2 * k);
      pos = pos.lerp(new THREE.Vector3(0, PLINTH_H + 0.55 + s.d * 0.4, RING + s.d * 0.55), e);
      look = look.lerp(new THREE.Vector3(0, PLINTH_H, RING - 0.02), e);
    }
    if (immediate) {
      camPos.copy(pos);
      camLook.copy(look);
    } else {
      const r = dive >= 0 ? 14 : 5;
      camPos.set(damp(camPos.x, pos.x, r, dt), damp(camPos.y, pos.y, r, dt), damp(camPos.z, pos.z, r, dt));
      camLook.set(damp(camLook.x, look.x, r, dt), damp(camLook.y, look.y, r, dt), damp(camLook.z, look.z, r, dt));
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  };
  camera.aspect = 16 / 9;
  frame(true, 0);

  ms.onFrame = (dt, t) => {
    if (queue.length && t > 0.25) place(queue.shift()!);
    turn = ringTurnFor(idx, N, turn);
    ring.rotation.y = damp(ring.rotation.y, turn, 6, dt);
    zoom = damp(zoom, zoomTo, 8, dt);
    // only the boards in sight are drawn: the front one and its neighbours (two each way while the ring turns)
    const reach = Math.abs(ring.rotation.y - turn) > 0.03 ? 2 : 1;
    for (let i = 0; i < N; i++) {
      const s = slots[i];
      const front = i === idx;
      s.holder.visible = Math.min(wrapIndex(i - idx, N), wrapIndex(idx - i, N)) <= reach;
      if (front) {
        if (!dragging) {
          released += dt;
          yaw += yawVel * dt;
          yawVel *= Math.exp(-3 * dt);
          // after a while untouched, settle back into the sway
          if (released > 3) yaw = damp(yaw, Math.sin(t * 0.5) * SWAY, 1.2, dt);
        }
        s.spin.rotation.y = yaw;
      } else s.spin.rotation.y = damp(s.spin.rotation.y, 0, 4, dt);
      // the front plinth glows; the others wait in the half light
      s.pool.opacity = damp(s.pool.opacity, front ? 0.55 : 0.14, 6, dt);
      if (s.pop > 0) {
        s.pop = Math.max(0, s.pop - dt * 3);
        const k = 1 + Math.sin(s.pop * Math.PI) * 0.04;
        s.spin.scale.setScalar(k);
      }
    }
    if (dive >= 0) {
      dive += dt;
      if (dive > 0.8 && diveDone) {
        const f = diveDone;
        diveDone = null;
        f();
      }
    }
    frame(false, dt);
  };

  /* the panel ------------------------------------------------------------------------- */
  const cls = h('span', { class: 'sr-cls' });
  const name = h('b', { class: 'sr-name' });
  const desc = h('p', { class: 'sr-desc' });
  const tag = h('span', { class: 'sr-tag' }, 'Playing now');
  const swatches = h('div', { class: 'finishes sr-finishes', role: 'radiogroup', 'aria-label': 'Finish' });
  const finishName = h('span', { class: 'sr-finish-name' });
  const play = h('button', { type: 'button', class: 'btn primary sr-play' }, 'Play on this');
  const gridBtn = h('button', { type: 'button', class: 'btn ghost small sr-grid' }, 'Grid view');
  const strip = h('div', { class: 'sr-strip', role: 'tablist', 'aria-label': 'Boards' });
  const chips = BOARDS.map((def, i) => {
    const b = h('button', { type: 'button', class: 'sr-chip', role: 'tab' }, def.name);
    b.addEventListener('click', () => go(i));
    strip.append(b);
    return b;
  });

  const refresh = () => {
    const s = slots[idx];
    cls.textContent = `${s.def.category} · ${s.def.decks} decks`;
    name.textContent = s.def.name;
    desc.textContent = s.def.description;
    tag.hidden = s.def.id !== o.current.board;
    swatches.replaceChildren(
      ...s.def.finishes.map((f) => {
        const on = f.id === s.finish;
        const sw = h('button', { type: 'button', role: 'radio', class: `swatch${on ? ' active' : ''}`, title: f.name, 'aria-label': f.name, 'aria-checked': String(on), style: { background: f.swatch } });
        sw.addEventListener('click', () => {
          if (s.finish === f.id) return;
          s.finish = f.id;
          place(s);
          s.pop = 1;
          uiSound('tick');
          refresh();
        });
        return sw;
      }),
    );
    finishName.textContent = (s.def.finishes.find((f) => f.id === s.finish) ?? s.def.finishes[0]).name;
    const same = s.def.id === o.current.board && s.finish === o.current.finish;
    play.textContent = same ? 'Keep playing this' : s.def.id === o.current.board ? 'Use this finish' : 'Play on this';
    chips.forEach((c, i) => {
      c.classList.toggle('active', i === idx);
      c.setAttribute('aria-selected', String(i === idx));
      c.classList.toggle('current', BOARDS[i].id === o.current.board);
    });
  };

  const go = (i: number) => {
    const n = wrapIndex(i, N);
    if (n === idx || dive >= 0) return;
    // the board leaving the front keeps its turn for a moment (it eases home on its own)
    idx = n;
    yaw = slots[idx].spin.rotation.y;
    yawVel = 0;
    released = 99;
    zoomTo = 1;
    // a board not built yet jumps the queue
    const s = slots[idx];
    if (!s.build) {
      queue.splice(queue.indexOf(s), 1);
      place(s);
    }
    uiSound('tap');
    refresh();
  };

  const pick = () => {
    if (dive >= 0) return;
    const s = slots[idx];
    const same = s.def.id === o.current.board && s.finish === o.current.finish;
    if (same) {
      modal()?.close();
      return;
    }
    dive = 0;
    yawVel = 0;
    released = 0;
    yaw = 0;
    dragging = false;
    uiSound('stamp');
    diveDone = () => {
      o.choose(s.def.id, s.finish);
      modal()?.close();
    };
  };

  /* input ------------------------------------------------------------------------------- */
  const canvas = ms.canvas;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastT = 0;
  let moved = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (dive >= 0) return;
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    moved = false;
    downX = lastX = e.clientX;
    downY = e.clientY;
    lastT = performance.now();
    yawVel = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) {
      // a board at the side is clickable
      const hit = slotAt(e.clientX, e.clientY);
      canvas.style.cursor = hit !== null && hit !== idx ? 'pointer' : 'grab';
      return;
    }
    canvas.style.cursor = 'grabbing';
    const dx = e.clientX - lastX;
    const now = performance.now();
    const rate = 4.2 / Math.max(300, ms.size.w);
    yaw += dx * rate * Math.PI;
    yawVel = (dx * rate * Math.PI) / Math.max(0.008, (now - lastT) / 1000);
    lastX = e.clientX;
    lastT = now;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) moved = true;
  });
  const up = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    released = 0;
    canvas.style.cursor = 'grab';
    // a flick that stopped before letting go doesn't keep spinning
    if (performance.now() - lastT > 80) yawVel = 0;
    yawVel = THREE.MathUtils.clamp(yawVel, -12, 12);
    if (!moved) {
      const hit = slotAt(e.clientX, e.clientY);
      if (hit !== null && hit !== idx) go(hit);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', (e) => {
    if (slotAt(e.clientX, e.clientY) === idx) pick();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomTo = THREE.MathUtils.clamp(zoomTo * Math.exp(e.deltaY * 0.0012), 0.55, 1.6);
    },
    { passive: false },
  );
  const slotAt = (x: number, y: number): number | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const targets: THREE.Object3D[] = [];
    for (const s of slots) {
      targets.push(s.plinth);
      if (s.build) targets.push(s.build.root);
    }
    const hit = ray.intersectObjects(targets, true)[0];
    if (!hit) return null;
    let obj: THREE.Object3D | null = hit.object;
    while (obj && obj.parent !== ring) obj = obj.parent;
    const i = slots.findIndex((s) => s.holder === obj);
    return i >= 0 ? i : null;
  };

  const prev = h('button', { type: 'button', class: 'sr-arrow prev', 'aria-label': 'Previous board' }, icon('back', 22));
  const next = h('button', { type: 'button', class: 'sr-arrow next', 'aria-label': 'Next board' }, icon('next', 22));
  prev.addEventListener('click', () => go(idx - 1));
  next.addEventListener('click', () => go(idx + 1));
  play.addEventListener('click', pick);
  gridBtn.addEventListener('click', () => o.grid());

  const root = h(
    'div',
    { class: 'showroom', tabindex: '-1' },
    h('div', { class: 'sr-stage' }, canvas, prev, next, tag, h('span', { class: 'sr-hint' }, 'Drag to spin · scroll to zoom · double-click to play')),
    h(
      'div',
      { class: 'sr-info' },
      h('div', { class: 'sr-text' }, cls, name, desc),
      h('div', { class: 'sr-side' }, h('div', { class: 'sr-finish' }, swatches, finishName), h('div', { class: 'sr-actions' }, gridBtn, play)),
    ),
    strip,
  );
  root.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') go(idx - 1);
    else if (e.key === 'ArrowRight') go(idx + 1);
    else if (e.key === 'Enter' && (e.target === root || e.target === canvas)) pick();
    else return;
    e.preventDefault();
  });
  refresh();
  queueMicrotask(() => root.focus({ preventScroll: true }));
  return root;
}
