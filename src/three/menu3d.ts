/*
 * A small 3D scene for a menu (the board showroom, the tour globe): its own
 * renderer on its own canvas, lit like the stage (ACES, the room environment),
 * sized to its box, drawing until the canvas leaves the page. The stage behind
 * a dialog drops to a third of its frames (App.tick), so the two don't fight.
 *
 * `createMenuScene` returns null when WebGL isn't there: the menus keep their
 * flat versions for that.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface MenuScene {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** called every frame with the seconds since the last one */
  onFrame: ((dt: number, t: number) => void) | null;
  /** canvas size in CSS pixels */
  readonly size: { w: number; h: number };
  /** stop drawing and free the GPU (also happens by itself once the canvas is gone) */
  dispose(): void;
}

export function createMenuScene(o: { fov?: number; label: string; className?: string }): MenuScene | null {
  const canvas = document.createElement('canvas');
  canvas.className = o.className ?? 'menu3d';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', o.label);
  canvas.tabIndex = 0;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.5;
  const camera = new THREE.PerspectiveCamera(o.fov ?? 35, 16 / 9, 0.02, 200);
  const size = { w: 0, h: 0 };
  let raf = 0;
  let last = 0;
  let t = 0;
  let dead = false;
  let seen = false;

  const fit = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth));
    const h = Math.max(1, Math.round(canvas.clientHeight));
    if (w === size.w && h === size.h) return;
    size.w = w;
    size.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const ms: MenuScene = {
    canvas,
    renderer,
    scene,
    camera,
    onFrame: null,
    size,
    dispose() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      // geometry and materials aren't disposed one by one: boards share theirs with the stage's
      // board, and a dispose event would make the stage upload them again. Losing the context
      // frees everything this renderer put on the GPU.
      env.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };

  const loop = (now: number) => {
    if (dead) return;
    // the dialog closed: let go of everything
    if (!canvas.isConnected) {
      if (seen) {
        ms.dispose();
        return;
      }
    } else seen = true;
    raf = requestAnimationFrame(loop);
    if (!seen) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    t += dt;
    fit();
    ms.onFrame?.(dt, t);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
  return ms;
}

/** ease towards a target, framerate-independent (rate: about 1/seconds to get most of the way) */
export function damp(from: number, to: number, rate: number, dt: number): number {
  return to + (from - to) * Math.exp(-rate * dt);
}

/** a soft round glow texture (for floor pools and halos) */
export function glowTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
