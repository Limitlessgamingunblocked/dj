import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Mesh } from './recon/types';

/** Interactive 3D preview of a model on a print bed grid. Units are whatever the mesh uses (mm). */
export class Viewer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
  private controls: OrbitControls;
  private model: THREE.Mesh | null = null;
  private grid: THREE.GridHelper | null = null;
  private resize: ResizeObserver;
  private frame = 0;
  private disposed = false;

  constructor(private host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewer-canvas';
    host.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color('#16181d');
    this.scene.add(new THREE.HemisphereLight('#f4f1ea', '#2a2d35', 1.4));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(1, 1.6, 1.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#ffb38a', 1.1);
    rim.position.set(-1.4, 0.6, -1);
    this.scene.add(rim);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    const loop = () => {
      if (this.disposed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(loop);
    };
    loop();
  }

  private fit() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Shows a mesh (Y-up, base at y = 0). `scale` multiplies its coordinates, e.g. pixels → mm. */
  setMesh(mesh: Mesh, scale = 1) {
    if (this.model) {
      this.scene.remove(this.model);
      this.model.geometry.dispose();
      (this.model.material as THREE.Material).dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions.slice(), 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    geo.translate(-center.x, -box.min.y, -center.z);
    this.model = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: '#e8e2d6', roughness: 0.55, metalness: 0.02 }),
    );
    this.scene.add(this.model);
    this.setScale(scale, true);
  }

  /** Changes the display scale; reframes the camera when asked. */
  setScale(scale: number, reframe = false) {
    if (!this.model) return;
    this.model.scale.setScalar(scale);
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z) || 1;
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
    }
    // Grid lines every 10 mm (or 1 inch-ish at large sizes), like a print bed.
    const step = span > 400 ? 50 : span > 120 ? 20 : 10;
    const extent = Math.ceil((span * 1.6) / step) * step;
    this.grid = new THREE.GridHelper(extent, extent / step, '#4b505c', '#2c3039');
    this.scene.add(this.grid);
    if (reframe) {
      const target = new THREE.Vector3(0, size.y / 2, 0);
      this.controls.target.copy(target);
      const dist = span * 2.3;
      this.camera.position.set(target.x + dist * 0.75, target.y + dist * 0.45, target.z + dist * 0.9);
      this.camera.near = span / 100;
      this.camera.far = span * 100;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Small JPEG of the current view, for model cards. */
  snapshot(size = 320): string {
    this.renderer.render(this.scene, this.camera);
    const c = document.createElement('canvas');
    const aspect = this.canvas.width / this.canvas.height;
    c.width = size;
    c.height = Math.round(size / Math.max(0.5, Math.min(2, aspect)));
    const g = c.getContext('2d')!;
    const sw = Math.min(this.canvas.width, this.canvas.height * (c.width / c.height));
    const sh = sw * (c.height / c.width);
    g.drawImage(this.canvas, (this.canvas.width - sw) / 2, (this.canvas.height - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.model?.geometry.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
