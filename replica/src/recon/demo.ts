import * as THREE from 'three';
import type { FrameSet } from './frames';
import type { Frame } from './types';

/** The demo jug is 1.6 units tall, standing in for a 120 mm real object. */
const DEMO_HEIGHT = 1.6;
const DEMO_HEIGHT_MM = 120;

function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c4532d';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#f2c14e';
  for (let i = 0; i < 16; i++) g.fillRect(i * 32, 0, 12, 256);
  g.fillStyle = '#1f3b57';
  for (let i = 0; i < 24; i++) {
    g.beginPath();
    g.arc((i * 97) % 512, 40 + ((i * 53) % 180), 9, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * Renders a clip of a jug with a handle spinning on a turntable against a plain backdrop, like a
 * phone video would capture. The clip runs a little over one turn so turn detection has work to do.
 */
export async function makeDemoFrames(onProgress?: (fraction: number) => void): Promise<FrameSet> {
  const width = 480;
  const height = 360;
  const framesPerTurn = 140;
  const total = 164;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9ebef');

  // Orthographic, level camera (the recommended way to film).
  const viewH = 2.4;
  const camera = new THREE.OrthographicCamera((-viewH * width) / height / 2, (viewH * width) / height / 2, viewH / 2 + 0.95, -viewH / 2 + 0.95, 0.1, 50);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight('#ffffff', '#b7b2aa', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(3, 5, 6);
  scene.add(sun);

  const item = new THREE.Group();
  const profile = [
    [0.0, 0], [0.52, 0], [0.56, 0.06], [0.6, 0.35], [0.58, 0.7], [0.46, 1.05],
    [0.3, 1.25], [0.26, 1.42], [0.32, 1.56], [0.3, DEMO_HEIGHT], [0.0, DEMO_HEIGHT],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 96),
    new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.6 }),
  );
  item.add(body);
  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.075, 20, 48, Math.PI * 1.25),
    new THREE.MeshStandardMaterial({ color: '#1f3b57', roughness: 0.5 }),
  );
  handle.position.set(0.55, 0.78, 0);
  handle.rotation.z = -Math.PI * 0.62;
  item.add(handle);
  const spout = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.34, 24),
    new THREE.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.5 }),
  );
  spout.position.set(-0.36, 1.48, 0);
  spout.rotation.z = Math.PI * 0.32;
  item.add(spout);
  scene.add(item);

  // Turntable platter below the item (below the floor line).
  const platter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 0.95, 0.08, 64),
    new THREE.MeshStandardMaterial({ color: '#5b5f66', roughness: 0.8 }),
  );
  platter.position.y = -0.04;
  scene.add(platter);

  const pixels = new Uint8Array(width * height * 4);
  const gl = renderer.getContext();
  const frames: Frame[] = [];
  for (let i = 0; i < total; i++) {
    const angle = (2 * Math.PI * i) / framesPerTurn;
    item.rotation.y = angle;
    platter.rotation.y = angle;
    renderer.render(scene, camera);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // WebGL rows run bottom-up.
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    frames.push({ width, height, data, time: i / 30 });
    onProgress?.((i + 1) / total);
    if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  renderer.dispose();
  renderer.forceContextLoss();

  // Image row of the turntable surface (y = 0).
  const floorY = Math.round(((camera.top - 0) / (camera.top - camera.bottom)) * height);
  return { frames, duration: total / 30, width, height, floorY, knownHeightMm: DEMO_HEIGHT_MM, label: 'Demo: painted jug' };
}
