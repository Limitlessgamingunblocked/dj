/*
 * 3D stage: WebGL renderer, club scene, the selected board, camera rig,
 * post-processing and all pointer interaction with the hardware.
 *
 * Views
 *   booth  – the booth with the visual player on the LED wall
 *   split  – booth plus a picture-in-picture of the visual player
 *   visual – the visual player full frame
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AudioEngine } from '../audio/AudioEngine';
import type { ControlRegistry } from '../core/controls';
import type { Features } from '../visualizer/AudioFeatures';
import { Visualizer } from '../visualizer/Visualizer';
import { buildBoard, type BoardDef } from './boards';
import type { BoardBuild } from './builder';
import { CameraRig, type ViewId } from './CameraRig';
import { Club, TABLE_Y } from './Club';
import { planeHit, type Part, type PartCtx, type PointerInfo } from './parts';

export type StageView = 'booth' | 'split' | 'visual';
export type Quality = 'low' | 'medium' | 'high';

interface Drag {
  part: Part;
  sx: number;
  sy: number;
  point: THREE.Vector3;
  object: THREE.Object3D;
}

export interface StageHooks {
  levels(ch: number): [number, number];
  master(): [number, number];
  /** MIDI learn: return true when the click was consumed to pick a control */
  learnPick(id: string | null): boolean;
  learning(): boolean;
}

export class Stage {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  readonly club: Club;
  readonly visualizer: Visualizer;
  board: BoardBuild | null = null;
  boardDef: BoardDef | null = null;
  view: StageView = 'booth';
  quality: Quality = 'medium';
  reactiveLights = true;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private screenScene = new THREE.Scene();
  private screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private screenQuad: THREE.Mesh;
  private hits: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private drags = new Map<number, Drag>();
  private hoverXY = { x: 0, y: 0 };
  private tooltip: HTMLElement;
  private lastClick = { part: null as Part | null, t: 0 };
  private frame = 0;
  private ctx: PartCtx;
  private size = { w: 1, h: 1 };
  private hoverDirty = false;
  /** hover-to-zoom */
  autoZoom = true;
  private zones: { id: 'L' | 'M' | 'R'; box: THREE.Box3 }[] = [];
  private boardTop = TABLE_Y;
  private pointerInside = false;
  private zoneCandidate: 'L' | 'M' | 'R' | null = null;
  private zoneSince = 0;
  private focusedZone: 'L' | 'M' | 'R' | null = null;
  private lastDragEnd = 0;
  private tap: { id: number; x: number; y: number; t: number } | null = null;
  /** the last pointer was a mouse (hover-to-zoom); touch zooms by tapping instead */
  private hoverMode = true;
  private focusXY = { x: 0, y: 0 };
  private wallFrustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private wallBox = new THREE.Box3();

  constructor(
    private reg: ControlRegistry,
    engine: AudioEngine,
    private hooks: StageHooks,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', '3D DJ booth. Drag knobs, faders, jog wheels and pads. Drag empty space to orbit the camera.');
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tooltip3d';
    this.tooltip.hidden = true;
    this.el = document.createElement('div');
    this.el.className = 'stage';
    this.el.append(this.canvas, this.tooltip);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.02, 80);
    this.camera.position.set(0, 1.5, 0.8);
    this.club = new Club(this.scene);
    this.rig = new CameraRig(this.camera, this.canvas);

    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.4, 0.93);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.visualizer = new Visualizer(this.renderer, {});
    this.screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.visualizer.texture, depthTest: false, depthWrite: false }));
    this.screenQuad.frustumCulled = false;
    this.screenScene.add(this.screenQuad);

    this.ctx = {
      reg,
      engine,
      deck: (ref) => engine.deck(typeof ref === 'number' ? ref : reg.layers[ref]),
      levels: (ch) => hooks.levels(ch),
      master: () => hooks.master(),
      now: 0,
      dt: 0,
      frame: 0,
      accent: '#2ec4f1',
    };
    this.bindPointer();
    this.rig.onManualMove(() => {
      this.focusedZone = null;
      this.zoneCandidate = null;
    });
    new ResizeObserver(() => this.resize()).observe(this.el);
  }

  /* ------------------------------------------------------------------ */
  /* board management                                                     */
  /* ------------------------------------------------------------------ */

  setBoard(def: BoardDef, finishId: string): void {
    if (this.board) {
      this.scene.remove(this.board.root);
      this.board.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose?.();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mm of mats) {
            const std = mm as THREE.MeshStandardMaterial;
            if (std.map && !(std.map as THREE.Texture & { isDataTexture?: boolean }).isDataTexture && std.map.userData?.shared !== true) std.map.dispose();
          }
        }
      });
    }
    this.boardDef = def;
    this.board = buildBoard(def, finishId);
    this.board.root.position.y = TABLE_Y;
    this.scene.add(this.board.root);
    this.hits = this.board.parts.flatMap((p) => p.hit);
    this.ctx.accent = this.board.finish.accent;
    this.board.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.board.root);
    this.rig.setBounds(box, def.id);
    this.boardTop = box.max.y;
    this.computeZones();
    this.focusedZone = null;
    this.rig.focused = false;
    this.rig.refit(true);
    if (this.rig.view === 'custom') this.rig.goTo('perf', true);
  }

  /** Sections of the board the camera can zoom to: left deck, mixer, right deck. */
  private computeZones(): void {
    this.zones = [];
    const b = this.board;
    if (!b) return;
    const boxes = b.units.map((u) => new THREE.Box3().setFromObject(u.group));
    if (boxes.length >= 3) {
      boxes.sort((a, c) => a.getCenter(new THREE.Vector3()).x - c.getCenter(new THREE.Vector3()).x);
      this.zones = [
        { id: 'L', box: boxes[0] },
        { id: 'M', box: boxes[1] },
        { id: 'R', box: boxes[boxes.length - 1] },
      ];
      return;
    }
    // single chassis: split into slabs around the mixer section
    const unit = boxes[0];
    const v = new THREE.Vector3();
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of b.parts) {
      if (!p.id || !(p.id.startsWith('ch.') || p.id.startsWith('mixer.'))) continue;
      p.object.getWorldPosition(v);
      lo = Math.min(lo, v.x);
      hi = Math.max(hi, v.x);
    }
    const cx = unit.getCenter(new THREE.Vector3()).x;
    if (!isFinite(lo)) {
      lo = cx - 0.08;
      hi = cx + 0.08;
    }
    lo -= 0.03;
    hi += 0.03;
    const slab = (x0: number, x1: number) => {
      const bx = unit.clone();
      bx.min.x = x0;
      bx.max.x = x1;
      return bx;
    };
    this.zones = [
      { id: 'L', box: slab(unit.min.x, lo) },
      { id: 'M', box: slab(lo, hi) },
      { id: 'R', box: slab(hi, unit.max.x) },
    ];
  }

  private zoneAt(clientX: number, clientY: number, margin = 0): 'L' | 'M' | 'R' | null {
    if (!this.zones.length) return null;
    const ray = this.rayFrom(clientX, clientY);
    const p = planeHit(ray, this.boardTop - 0.01);
    if (!p) return null;
    for (const z of this.zones) {
      const b = z.box;
      if (p.x >= b.min.x - 0.01 && p.x <= b.max.x + 0.01 && p.z >= b.min.z - 0.015 - margin && p.z <= b.max.z + 0.015 + margin) return z.id;
    }
    if (margin > 0) {
      // within the margin around the whole board: nearest section
      const all = this.zones.reduce((acc, z) => acc.union(z.box), new THREE.Box3());
      if (p.x >= all.min.x - margin && p.x <= all.max.x + margin && p.z >= all.min.z - margin && p.z <= all.max.z + margin) {
        return p.x < this.zones[0].box.max.x ? 'L' : p.x > this.zones[2].box.min.x ? 'R' : 'M';
      }
    }
    return null;
  }

  get zoomedZone(): 'L' | 'M' | 'R' | null {
    return this.rig.focused ? this.focusedZone : null;
  }

  focusZone(id: 'L' | 'M' | 'R' | null): void {
    if (id === this.focusedZone) return;
    this.focusedZone = id;
    this.focusXY = { ...this.hoverXY };
    const z = this.zones.find((x) => x.id === id);
    if (z) this.rig.focusBox(z.box);
    else this.rig.unfocus();
  }

  setAutoZoom(on: boolean): void {
    this.autoZoom = on;
    if (!on) this.focusZone(null);
  }

  /** Hover-to-zoom: dwell on a section to zoom in, move off the board to zoom out.
   * The camera only reacts to the user moving the pointer (never to the view
   * shifting under a still pointer), and while zoomed in the whole board area
   * plus a margin counts as "still here", so it can't oscillate. */
  private updateAutoZoom(): void {
    const now = performance.now();
    if (!this.autoZoom || this.view === 'visual' || !this.hoverMode) return;
    if (this.drags.size || this.rig.interacting || this.rig.moving || now - this.lastDragEnd < 450 || now - this.rig.lastManual < 1200) {
      this.zoneSince = now;
      return;
    }
    const movedSinceFocus = !this.pointerInside || Math.hypot(this.hoverXY.x - this.focusXY.x, this.hoverXY.y - this.focusXY.y) > 6;
    let zone: 'L' | 'M' | 'R' | null;
    if (!this.pointerInside) zone = null;
    else if (!movedSinceFocus) zone = this.focusedZone;
    else zone = this.zoneAt(this.hoverXY.x, this.hoverXY.y, this.focusedZone ? 0.08 : 0);
    if (zone !== this.zoneCandidate) {
      this.zoneCandidate = zone;
      this.zoneSince = now;
      return;
    }
    const dwell = now - this.zoneSince;
    if (zone && zone !== this.focusedZone && dwell > (this.focusedZone ? 420 : 160)) this.focusZone(zone);
    else if (!zone && this.focusedZone && dwell > 650) this.focusZone(null);
  }

  setView(v: StageView): void {
    this.view = v;
    this.resize();
  }

  goTo(v: ViewId): void {
    this.focusedZone = null;
    this.rig.goTo(v);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.club.setShadows(q !== 'low', q === 'high' ? 2048 : 1024);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.resize();
  }

  /* ------------------------------------------------------------------ */
  /* sizing                                                               */
  /* ------------------------------------------------------------------ */

  resize(): void {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.size = { w, h };
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    const bloomScale = this.quality === 'high' ? 1 : 0.5;
    this.bloom.resolution.set(w * bloomScale, h * bloomScale);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const q = this.quality === 'high' ? 1 : this.quality === 'medium' ? 0.75 : 0.5;
    if (this.view === 'visual') this.visualizer.setSize(w * dpr * q, h * dpr * q);
    else this.visualizer.setSize(this.quality === 'low' ? 640 : 960, this.quality === 'low' ? 360 : 540);
    const fz = this.zones.find((z) => z.id === this.focusedZone);
    if (fz && this.rig.focused) this.rig.focusBox(fz.box);
    else this.rig.refit(false);
  }

  /* ------------------------------------------------------------------ */
  /* pointer interaction                                                  */
  /* ------------------------------------------------------------------ */

  private rayFrom(clientX: number, clientY: number): THREE.Ray {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.clone();
  }

  private pick(clientX: number, clientY: number): { part: Part; point: THREE.Vector3; object: THREE.Object3D } | null {
    if (this.view === 'visual' || !this.hits.length) return null;
    this.rayFrom(clientX, clientY);
    const hit = this.raycaster.intersectObjects(this.hits, false)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.part) o = o.parent;
    if (!o) return null;
    return { part: o.userData.part as Part, point: hit.point.clone(), object: hit.object };
  }

  private info(e: PointerEvent | WheelEvent, d: Drag): PointerInfo {
    return { ray: this.rayFrom(e.clientX, e.clientY), point: d.point, object: d.object, dx: e.clientX - d.sx, dy: e.clientY - d.sy, shift: e.shiftKey };
  }

  private bindPointer(): void {
    const el = this.el;
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (e.target !== this.canvas) return;
        this.canvas.focus({ preventScroll: true });
        this.hoverMode = e.pointerType === 'mouse';
        const hit = this.pick(e.clientX, e.clientY);
        if (!hit) {
          this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
          return;
        }
        if (this.hooks.learning()) {
          const id = hit.part.id ? this.reg.resolveId(hit.part.control(this.reg) ?? hit.part.id) : null;
          if (this.hooks.learnPick(id)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        e.preventDefault();
        e.stopPropagation();
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const drag: Drag = { part: hit.part, sx: e.clientX, sy: e.clientY, point: hit.point, object: hit.object };
        this.drags.set(e.pointerId, drag);
        this.rig.hold();
        this.rig.noteInteraction();
        const now = performance.now();
        if (this.lastClick.part === hit.part && now - this.lastClick.t < 320 && hit.part.double) {
          hit.part.double(this.ctx);
          this.lastClick.part = null;
        } else this.lastClick = { part: hit.part, t: now };
        hit.part.down?.(this.info(e, drag), this.ctx);
        this.showTooltip(hit.part, e.clientX, e.clientY);
      },
      { capture: true },
    );
    el.addEventListener(
      'pointermove',
      (e) => {
        const d = this.drags.get(e.pointerId);
        if (d) {
          e.preventDefault();
          e.stopPropagation();
          d.part.move?.(this.info(e, d), this.ctx);
          this.showTooltip(d.part, e.clientX, e.clientY);
          return;
        }
        if (e.pointerType === 'mouse' && e.buttons === 0) {
          this.hoverMode = true;
          this.hoverXY = { x: e.clientX, y: e.clientY };
          this.hoverDirty = true;
          this.pointerInside = e.target === this.canvas;
        }
      },
      { capture: true },
    );
    const end = (e: PointerEvent) => {
      const t = this.tap;
      if (t && t.id === e.pointerId) {
        this.tap = null;
        // a tap/click on an empty part of the board zooms to that section (touch has no hover)
        if (e.type === 'pointerup' && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8 && performance.now() - t.t < 350 && this.autoZoom && this.view !== 'visual') {
          const zone = this.zoneAt(e.clientX, e.clientY);
          this.focusZone(zone === this.focusedZone && e.pointerType !== 'mouse' ? null : zone);
          this.zoneCandidate = zone;
          this.zoneSince = performance.now();
        }
      }
      const d = this.drags.get(e.pointerId);
      if (!d) return;
      this.drags.delete(e.pointerId);
      this.lastDragEnd = performance.now();
      d.part.up?.(this.info(e, d), this.ctx);
      if (!this.drags.size) this.tooltip.hidden = true;
    };
    el.addEventListener('pointerup', end, { capture: true });
    el.addEventListener('pointercancel', end, { capture: true });
    el.addEventListener('lostpointercapture', (e) => end(e as PointerEvent), { capture: true });
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
        this.canvas.style.cursor = '';
      if (!this.drags.size) this.tooltip.hidden = true;
    });
    el.addEventListener(
      'wheel',
      (e) => {
        const hit = this.pick(e.clientX, e.clientY);
        if (!hit || !hit.part.wheel) return;
        e.preventDefault();
        e.stopPropagation();
        hit.part.wheel(e.deltaY < 0 ? 1 : -1, this.ctx);
        this.showTooltip(hit.part, e.clientX, e.clientY);
      },
      { capture: true, passive: false },
    );
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private showTooltip(part: Part, x: number, y: number): void {
    const r = this.el.getBoundingClientRect();
    const val = part.valueText?.(this.ctx) ?? '';
    const learn = this.hooks.learning() ? ' — click to learn' : '';
    this.tooltip.innerHTML = '';
    this.tooltip.append(document.createTextNode(part.label + learn));
    if (val) {
      const b = document.createElement('b');
      b.textContent = val;
      this.tooltip.append(b);
    }
    this.tooltip.style.left = `${x - r.left}px`;
    this.tooltip.style.top = `${y - r.top}px`;
    this.tooltip.hidden = false;
  }

  private updateHover(): void {
    if (!this.hoverDirty || this.drags.size) return;
    this.hoverDirty = false;
    const hit = this.pick(this.hoverXY.x, this.hoverXY.y);
    const part = hit?.part ?? null;
    this.canvas.style.cursor = part ? part.cursor : 'grab';
    if (part) this.showTooltip(part, this.hoverXY.x, this.hoverXY.y);
    else this.tooltip.hidden = true;
  }

  /* ------------------------------------------------------------------ */
  /* frame                                                                */
  /* ------------------------------------------------------------------ */

  private wallVisible(): boolean {
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.wallFrustum.setFromProjectionMatrix(this.projScreen);
    this.wallBox.setFromObject(this.club.ledWall);
    return this.wallFrustum.intersectsBox(this.wallBox);
  }

  render(dt: number, f: Features, visSettings: { shake: boolean }): void {
    this.frame++;
    this.ctx.dt = dt;
    this.ctx.now += dt;
    this.ctx.frame = this.frame;
    this.updateHover();
    this.updateAutoZoom();

    if (this.view !== 'visual') {
      this.rig.update(dt, f, visSettings.shake);
      if (this.board) for (const p of this.board.parts) p.update(this.ctx);
      this.club.update(f, dt, this.reactiveLights);
    }

    const needVis = this.view !== 'booth' || this.wallVisible();
    if (needVis) {
      this.visualizer.render(f, dt);
      const tex = this.visualizer.texture;
      this.club.setVisTexture(tex);
      const mat = this.screenQuad.material as THREE.MeshBasicMaterial;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }

    const r = this.renderer;
    if (this.view === 'visual') {
      r.setRenderTarget(null);
      r.render(this.screenScene, this.screenCam);
      return;
    }
    this.bloom.enabled = this.quality !== 'low';
    this.bloom.strength = 0.45 + (this.reactiveLights ? f.kickPulse * 0.25 + f.drop * 0.4 : 0);
    this.composer.render(dt);
    if (this.view === 'split') {
      const { w, h } = this.size;
      const pw = Math.round(Math.min(w * 0.34, 420));
      const ph = Math.round((pw * 9) / 16);
      r.autoClear = false;
      r.setScissorTest(true);
      r.setScissor(w - pw - 10, 10, pw, ph);
      r.setViewport(w - pw - 10, 10, pw, ph);
      r.render(this.screenScene, this.screenCam);
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
      r.autoClear = true;
    }
  }
}
