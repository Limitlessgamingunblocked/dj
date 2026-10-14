/*
 * The shop's fitting room: your DJ on a purple stage, wearing whatever card
 * is picked, turning slowly (drag to turn them yourself). It's the same
 * Avatar the stage draws, in a small scene of its own (three/menu3d.ts), so
 * the shop shows exactly what you'd walk out in.
 *
 * The same renderer draws the cards' pictures: a second avatar puts each
 * piece on, the camera frames the part of the body it's on, and the frame is
 * read back into a little image. It's drawn twice, over black and over
 * white, so the image can carry its own transparency and the card's colour
 * shows round it. One a frame, cached for the session (per look).
 */
import * as THREE from 'three';
import { Avatar, type AvatarInput } from '../character/Avatar';
import { bodyReady } from '../character/modelBody';
import type { Look } from '../core/models';
import type { ShopFocus } from '../game/shop';
import { createMenuScene, damp, glowTexture } from '../three/menu3d';

export interface ShopPreview {
  readonly canvas: HTMLCanvasElement;
  /** put this look on the stage (null: nobody, for a home), framed on a part of the body */
  show(look: Look | null, focus: ShopFocus): void;
  /** a picture of `look` framed on `focus`, for a card: from the cache, or drawn soon and handed to `done` */
  thumb(key: string, look: Look, focus: ShopFocus, done: (url: string) => void): string | null;
  /** forget queued pictures (the grid changed) */
  clearQueue(): void;
  dispose(): void;
}

/** the stage colour (the CSS stage behind the canvas matches it) */
export const STAGE_BG = 0x24173f;
/** card pictures, in device pixels */
const TW = 168;
const TH = 200;

/** the pictures drawn this session, by key (the caller's: the look and the entry) → data URL */
const THUMBS = new Map<string, string>();

const idle = (t: number): AvatarInput => ({ beat: t * 1.6, playing: false, dropHit: false, peak: 0, build: 0, kick: 0 });

/** how tall the avatar stands, hat and hair included */
function heightOf(av: Avatar): number {
  av.object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(av.object).max.y;
}

/** where the camera looks and how much it fits in (half the height, in metres), from the bones and the height */
function framing(av: Avatar, top: number, focus: ShopFocus, tight: boolean): { y: number; half: number } {
  av.object.updateMatrixWorld(true);
  const y = (n: keyof Avatar['bones']) => av.bones[n].getWorldPosition(tmp).y;
  // the head bone sits at the base of the skull
  const head = y('head');
  const hips = y('hips');
  if (tight) {
    // a card: close on the piece
    switch (focus) {
      case 'eyes':
        return { y: head + 0.1, half: 0.075 };
      case 'head':
        return { y: (head + Math.min(top, head + 0.4)) / 2 + 0.03, half: 0.27 };
      case 'torso':
        return { y: (y('chest') + hips) / 2 + 0.08, half: 0.4 };
      case 'legs':
        return { y: hips * 0.5, half: hips * 0.6 };
      case 'feet':
        return { y: 0.12, half: 0.22 };
      default:
        return { y: top / 2, half: (top / 2) * 1.06 };
    }
  }
  // the stage: a bit of you round it as well
  switch (focus) {
    case 'eyes':
      return { y: head + 0.1, half: 0.17 };
    case 'head':
      return { y: head + 0.06, half: 0.36 };
    case 'torso': {
      // head to mid-thigh
      const low = hips * 0.6;
      return { y: (top + low) / 2, half: ((top - low) / 2) * 1.12 };
    }
    case 'legs':
      return { y: hips * 0.62, half: hips * 0.72 };
    case 'feet':
      return { y: 0.32, half: 0.44 };
    default:
      return { y: top / 2, half: (top / 2) * 1.12 };
  }
}
const tmp = new THREE.Vector3();

/** a stage's lights: a warm key, a lilac fill, a pink rim from behind */
function light(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xc9b8ff, 0x1a1030, 0.55));
  const key = new THREE.DirectionalLight(0xfff1e6, 2.1);
  key.position.set(1.4, 2.6, 2.4);
  const fill = new THREE.DirectionalLight(0x9b8cff, 0.7);
  fill.position.set(-2.2, 1.4, 1.2);
  const rim = new THREE.DirectionalLight(0xff6fb5, 1.3);
  rim.position.set(-0.8, 2.2, -2.4);
  scene.add(key, fill, rim);
}

export function createShopPreview(o: { look: Look; djName: string }): ShopPreview | null {
  const ms = createMenuScene({ fov: 26, label: 'Fitting room: your DJ wearing the picked piece. Drag to turn them.', className: 'shop-canvas' });
  if (!ms) return null;
  const { scene, camera, renderer, canvas } = ms;
  scene.background = new THREE.Color(STAGE_BG);

  /* the stage ---------------------------------------------------------------- */
  light(scene);
  const glow = glowTexture();
  // a pool of light on the floor, and a soft glow on the wall behind
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: glow, color: 0x8c6bff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.002;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: glow, color: 0x5a3aa8, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.set(0, 1.2, -2.5);
  scene.add(pool, halo);

  const av = new Avatar(o.look, { djName: o.djName });
  av.mode = 'idle';
  scene.add(av.object);
  let focus: ShopFocus = 'full';
  let shown: Look | null = o.look;
  let yaw = 0.35;
  let spin = 0.5;
  let dragging = false;
  let released = 10;
  let lastX = 0;
  const aim = { y: 1, dist: 4 };
  const cur = { y: 1, dist: 4 };
  let snap = true;
  let nextThumb = 0;
  /** the avatar's height, measured once per look */
  let top: number | null = null;

  const frame = () => {
    top ??= heightOf(av);
    const f = framing(av, top, focus, false);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // narrow stages (a phone) need room for the shoulders as well as the height
    aim.dist = (f.half / tan) * Math.max(1, 0.62 / Math.max(0.2, camera.aspect));
    aim.y = f.y;
  };

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.012;
    lastX = e.clientX;
  });
  const up = () => {
    dragging = false;
    released = 0;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      yaw += e.key === 'ArrowLeft' ? -0.3 : 0.3;
      released = 0;
      e.preventDefault();
    }
  });

  /* card pictures -------------------------------------------------------------- */
  const tScene = new THREE.Scene();
  tScene.environment = scene.environment;
  tScene.environmentIntensity = scene.environmentIntensity;
  light(tScene);
  const tCam = new THREE.PerspectiveCamera(24, TW / TH, 0.02, 50);
  let tAv: Avatar | null = null;
  const queue: { key: string; look: Look; focus: ShopFocus; done: (url: string) => void }[] = [];
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = TW;
    c.height = TH;
    return c.getContext('2d', { willReadFrequently: true })!;
  };
  let black: CanvasRenderingContext2D | null = null;
  let white: CanvasRenderingContext2D | null = null;
  const prevClear = new THREE.Color();

  const drawThumb = (job: (typeof queue)[number]) => {
    const pr = renderer.getPixelRatio();
    if (ms.size.w * pr < TW + 2 || ms.size.h * pr < TH + 2) return false;
    black ??= mk();
    white ??= mk();
    if (!tAv) {
      tAv = new Avatar(job.look, { djName: o.djName });
      tAv.mode = 'idle';
      tScene.add(tAv.object);
    } else tAv.setLook(job.look);
    // a three-quarter view, settled into its idle stance
    tAv.object.rotation.y = job.focus === 'eyes' ? 0.12 : 0.4;
    for (let i = 0; i < 4; i++) tAv.update(idle(i * 0.05), 1 / 30);
    const f = framing(tAv, heightOf(tAv), job.focus, true);
    const dist = f.half / Math.tan(THREE.MathUtils.degToRad(tCam.fov / 2));
    tCam.position.set(0, f.y + (job.focus === 'feet' ? 0.25 : 0.05), dist);
    tCam.lookAt(0, f.y, 0);
    const cw = TW / pr;
    const ch = TH / pr;
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, cw, ch);
    renderer.setViewport(0, 0, cw, ch);
    const src = renderer.domElement;
    const sy = src.height - TH;
    renderer.setClearColor(0x000000, 1);
    renderer.render(tScene, tCam);
    black.clearRect(0, 0, TW, TH);
    black.drawImage(src, 0, sy, TW, TH, 0, 0, TW, TH);
    renderer.setClearColor(0xffffff, 1);
    renderer.render(tScene, tCam);
    white.clearRect(0, 0, TW, TH);
    white.drawImage(src, 0, sy, TW, TH, 0, 0, TW, TH);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, ms.size.w, ms.size.h);
    // the matte: what changes between black and white is the background showing through
    const a = black.getImageData(0, 0, TW, TH);
    const b = white.getImageData(0, 0, TW, TH).data;
    const d = a.data;
    for (let i = 0; i < d.length; i += 4) {
      const through = (b[i] - d[i] + (b[i + 1] - d[i + 1]) + (b[i + 2] - d[i + 2])) / 765;
      const al = Math.max(0, Math.min(1, 1 - through));
      if (al > 0.004) {
        d[i] = Math.min(255, d[i] / al);
        d[i + 1] = Math.min(255, d[i + 1] / al);
        d[i + 2] = Math.min(255, d[i + 2] / al);
      }
      d[i + 3] = Math.round(al * 255);
    }
    black.putImageData(a, 0, 0);
    const url = black.canvas.toDataURL('image/png');
    if (THUMBS.size > 600) THUMBS.clear();
    THUMBS.set(job.key, url);
    job.done(url);
    return true;
  };

  /* every frame ---------------------------------------------------------------- */
  ms.onFrame = (dt, t) => {
    // a card picture first (it borrows a corner of the canvas the stage then draws over);
    // once the modelled body is in, or after a moment without it
    // one a frame on a quick GPU; a slow one gets frames in between (reading a picture back waits for the GPU)
    if (queue.length && (bodyReady() || t > 2.5) && t > 0.3 && t >= nextThumb) {
      const job = queue.shift()!;
      const t0 = performance.now();
      if (!THUMBS.has(job.key) && !drawThumb(job)) queue.unshift(job);
      const took = (performance.now() - t0) / 1000;
      nextThumb = t + (took > 0.03 ? Math.min(2, took * 2) : 0);
    }
    if (shown) {
      av.update(idle(t), dt);
      if (!dragging) {
        released += dt;
        // the head and eyes sway, so they stay in sight; anything else turns all the way round,
        // lingering on the front
        if (focus === 'head' || focus === 'eyes') {
          yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
          if (released > 1.5) yaw = damp(yaw, Math.sin(t * 0.45) * 0.55, 1.2, dt);
        } else if (released > 1.5) yaw += spin * (0.4 + 0.6 * (1 - Math.cos(yaw)) * 0.5) * dt;
      }
      av.object.rotation.y = yaw;
    }
    frame();
    if (snap) {
      cur.y = aim.y;
      cur.dist = aim.dist;
      snap = false;
    }
    cur.y = damp(cur.y, aim.y, 5, dt);
    cur.dist = damp(cur.dist, aim.dist, 5, dt);
    const lift = focus === 'feet' ? 0.3 : focus === 'full' ? 0.12 : 0.04;
    camera.position.set(0, cur.y + lift, cur.dist);
    camera.lookAt(0, cur.y, 0);
  };

  let dead = false;
  const dispose = ms.dispose.bind(ms);
  const preview: ShopPreview = {
    canvas,
    show(look, f) {
      focus = f;
      if (!look) {
        shown = null;
        av.object.visible = false;
        pool.visible = false;
        return;
      }
      av.object.visible = true;
      pool.visible = true;
      if (shown === null || JSON.stringify(look) !== JSON.stringify(shown)) {
        av.setLook(look);
        top = null;
      }
      shown = look;
      spin = f === 'full' ? 0.5 : 0.6;
    },
    thumb(key, look, f, done) {
      const have = THUMBS.get(key);
      if (have) return have;
      if (!queue.some((q) => q.key === key)) queue.push({ key, look, focus: f, done });
      return null;
    },
    clearQueue() {
      queue.length = 0;
    },
    dispose() {
      if (dead) return;
      dead = true;
      queue.length = 0;
      av.dispose();
      tAv?.dispose();
      glow.dispose();
      dispose();
    },
  };
  // the canvas leaving the page disposes the scene by itself: take the avatars with it
  ms.dispose = () => preview.dispose();
  return preview;
}
