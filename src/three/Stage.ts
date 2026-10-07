/*
 * 3D stage: WebGL renderer, the venue and its light show, the selected board, camera rig,
 * post-processing and all pointer interaction with the hardware.
 *
 * Views
 *   booth  – the booth with the visual player on the LED wall
 *   split  – booth plus a picture-in-picture of the visual player
 *   visual – the visual player full frame
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AudioEngine } from '../audio/AudioEngine';
import type { ControlRegistry } from '../core/controls';
import type { LyricFrame } from '../lyrics/LyricsEngine';
import type { Features } from '../visualizer/AudioFeatures';
import { Visualizer } from '../visualizer/Visualizer';
import { buildBoard, type BoardDef } from './boards';
import type { BoardBuild } from './builder';
import { CameraRig, type ViewId } from './CameraRig';
import { LensOutputPass, NEUTRAL_GRADE } from './lens';
import { AdaptiveQuality } from './quality';
import { planeHit, type Part, type PartCtx, type PointerInfo } from './parts';
import type { VenueDef, VenueScene } from './venues/base';
import { Crowd, TABLE_Y } from './venues/fixtures';
import { Pyro } from './venues/pyro';
import { LightShow } from './venues/show';

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
  /** a control of fixed deck `n` was touched */
  focusDeck(n: number): void;
}

interface Zone {
  id: string;
  box: THREE.Box3;
  side: 'L' | 'R' | null;
  deck: number | null;
  mixer: boolean;
}

export class Stage {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  readonly visualizer: Visualizer;
  readonly show = new LightShow();
  venue: VenueScene | null = null;
  venueDef: VenueDef | null = null;
  /** crowd energy 0..1 (set by the app's hype meter) */
  hype = 0.3;
  /** the lyrics the room is hearing (set by the app every frame) */
  lyric: LyricFrame | null = null;
  board: BoardBuild | null = null;
  boardDef: BoardDef | null = null;
  /** old stickers on the hardware */
  stickers = true;
  view: StageView = 'booth';
  quality: Quality = 'medium';
  readonly keyLight: THREE.SpotLight;
  private avatar: Crowd;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private lens: LensOutputPass;
  /** steps the render load down (and back up) when frames run long */
  readonly adaptive = new AdaptiveQuality();
  private msaa = 4;
  /** shaders for a new venue or board are compiling in the background: hold the last frame */
  private compiling = 0;
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
  private zones: Zone[] = [];
  private boardTop = TABLE_Y;
  private pointerInside = false;
  private zoneCandidate: string | null = null;
  private zoneSince = 0;
  private focusedZone: string | null = null;
  private lastDragEnd = 0;
  private tap: { id: number; x: number; y: number; t: number } | null = null;
  /** the last pointer was a mouse (hover-to-zoom); touch zooms by tapping instead */
  private hoverMode = true;
  private focusXY = { x: 0, y: 0 };
  private wallFrustum = new THREE.Frustum();
  private avatarHead = new THREE.Vector3(0, 1.55, 0.7);
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
    this.renderer.shadowMap.autoUpdate = false;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.02, 160);
    this.camera.position.set(0, 1.5, 0.8);
    // booth work light (the only shadow caster)
    this.keyLight = new THREE.SpotLight(0xfff4e6, 15, 7, 0.55, 0.65, 1.6);
    this.keyLight.position.set(0.35, TABLE_Y + 2.4, 1.1);
    this.keyLight.target.position.set(0, TABLE_Y, 0);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.015;
    this.keyLight.shadow.radius = 3;
    this.keyLight.shadow.camera.near = 0.8;
    this.keyLight.shadow.camera.far = 5;
    const fill = new THREE.DirectionalLight(0x9fb4ff, 0.3);
    fill.position.set(-2, 3, 3);
    this.scene.add(this.keyLight, this.keyLight.target, fill);
    // you, as seen from the crowd and venue cameras
    this.avatar = new Crowd([{ x: 0, z: 0.7, face: Math.PI, scale: 1.02, role: 'dj' }], { clothes: ['#e9e6df'], seed: 3 });
    this.scene.add(this.avatar.object);
    this.rig = new CameraRig(this.camera, this.canvas);

    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.msaa }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.4, 0.93);
    this.composer.addPass(this.bloom);
    // lens effects, tone mapping, grade and output in one pass
    this.lens = new LensOutputPass();
    this.composer.addPass(this.lens);

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

  /** lights follow the music */
  get reactiveLights(): boolean {
    return this.show.controls.auto;
  }

  set reactiveLights(v: boolean) {
    this.show.controls.auto = v;
  }

  /* ------------------------------------------------------------------ */
  /* venue                                                                */
  /* ------------------------------------------------------------------ */

  setVenue(def: VenueDef): void {
    if (this.venue) {
      this.scene.remove(this.venue.group);
      this.venue.dispose();
    }
    this.venueDef = def;
    const v = def.build();
    this.venue = v;
    // the studio environment map is for the hardware; keep big venue surfaces from mirroring it
    v.group.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) (m as THREE.MeshStandardMaterial).envMapIntensity *= 0.3;
    });
    this.scene.add(v.group);
    this.scene.background = v.background;
    this.scene.fog = v.fog;
    this.keyLight.color.set(v.keyLight.color);
    this.keyLight.intensity = v.keyLight.intensity;
    this.show.setVenuePalette(def.palette);
    this.lens.setGrade(v.grade ?? NEUTRAL_GRADE);
    // only the output pass tone-maps (scene programs render to a float target), so this recompiles one shader
    this.renderer.toneMapping = v.toneMapping === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    this.rig.setViews(v.views);
    this.precompile();
  }

  /**
   * Compile the scene's shaders off the main path (KHR_parallel_shader_compile)
   * so switching venue or board doesn't stall on the first frame. The club
   * view holds its last frame until they're ready (at most 4 s).
   */
  private precompile(): void {
    const id = ++this.compiling;
    const done = () => {
      if (this.compiling === id) this.compiling = 0;
    };
    // compile against the composer's target: programs bake in tone mapping and colour space,
    // which differ between the screen and the half-float buffer the club actually renders into
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.readBuffer);
    this.renderer.compileAsync(this.scene, this.camera).then(done, done);
    this.renderer.setRenderTarget(prev);
    setTimeout(done, 4000);
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
    this.board = buildBoard(def, finishId, { stickers: this.stickers });
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
    this.precompile();
  }

  /** Sections of the board the camera can zoom to: one per hardware unit, or
   * left deck / mixer / right deck slabs of a single-chassis controller. */
  private computeZones(): void {
    this.zones = [];
    const b = this.board;
    if (!b) return;
    const boxes = b.units.map((u) => new THREE.Box3().setFromObject(u.group));
    if (boxes.length >= 3) {
      const units = b.units.map((u, i) => ({ u, box: boxes[i] })).sort((a, c) => a.box.getCenter(new THREE.Vector3()).x - c.box.getCenter(new THREE.Vector3()).x);
      units.forEach(({ u, box }, i) => {
        const ids = b.parts.filter((p) => p.object.parent === u.group && p.id).map((p) => p.id!);
        const mixer = ids.some((id) => id.startsWith('ch.'));
        const m = ids.map((id) => /^deck\.(\w)\./.exec(id)).find(Boolean);
        const ref = m ? m[1] : null;
        this.zones.push({ id: `u${i}`, box, mixer, side: ref === 'L' || ref === 'R' ? ref : null, deck: ref && /\d/.test(ref) ? Number(ref) : null });
      });
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
      { id: 'L', box: slab(unit.min.x, lo), side: 'L', deck: null, mixer: false },
      { id: 'M', box: slab(lo, hi), side: null, deck: null, mixer: true },
      { id: 'R', box: slab(hi, unit.max.x), side: 'R', deck: null, mixer: false },
    ];
  }

  private zoneAt(clientX: number, clientY: number, margin = 0): string | null {
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
        let best = this.zones[0];
        let bd = Infinity;
        for (const z of this.zones) {
          const d = Math.max(0, z.box.min.x - p.x, p.x - z.box.max.x);
          if (d < bd) {
            bd = d;
            best = z;
          }
        }
        return best.id;
      }
    }
    return null;
  }

  /** what the camera is zoomed in on, for the HUD */
  get zoomedLabel(): string | null {
    if (!this.rig.focused || !this.focusedZone) return null;
    const z = this.zones.find((q) => q.id === this.focusedZone);
    if (!z) return null;
    if (z.mixer) return 'Mixer';
    if (z.deck) return `Deck ${z.deck}${this.boardDef && Array.isArray(this.boardDef.turntable) && this.boardDef.turntable.includes(z.deck) ? ' turntable' : ''}`;
    const four = this.boardDef?.decks === 4;
    return `${z.side === 'L' ? 'Left' : 'Right'} deck${four ? ` (${this.reg.layers[z.side ?? 'L']})` : ''}`;
  }

  focusZone(id: string | null): void {
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
    if (!this.autoZoom || this.view === 'visual' || !this.hoverMode || this.rig.view === 'drone') return;
    if (this.drags.size || this.rig.interacting || this.rig.moving || now - this.lastDragEnd < 450 || now - this.rig.lastManual < 1200) {
      this.zoneSince = now;
      return;
    }
    const movedSinceFocus = !this.pointerInside || Math.hypot(this.hoverXY.x - this.focusXY.x, this.hoverXY.y - this.focusXY.y) > 6;
    let zone: string | null;
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
    this.keyLight.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    this.renderer.shadowMap.enabled = q !== 'low';
    // multisampling is the biggest fill cost: none on low
    const samples = q === 'low' ? 0 : 4;
    if (samples !== this.msaa) {
      this.msaa = samples;
      this.composer.reset(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples }));
    }
    this.adaptive.reset(0);
    this.applyAdaptive();
  }

  /** Apply the adaptive quality step: render scale, crowd detail, effects. */
  applyAdaptive(): void {
    const st = this.adaptive.step;
    Crowd.detailDistance = (this.quality === 'high' ? 16 : this.quality === 'medium' ? 12 : 8) * st.crowdDetail;
    this.visualizer.bloomAllowed = st.visualizerBloom;
    this.resize();
  }

  /* ------------------------------------------------------------------ */
  /* sizing                                                               */
  /* ------------------------------------------------------------------ */

  resize(): void {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.size = { w, h };
    const cap = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1);
    const dpr = Math.max(0.5, cap * this.adaptive.step.renderScale);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    const bloomScale = this.quality === 'high' ? 1 : 0.5;
    this.bloom.resolution.set(w * bloomScale, h * bloomScale);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lens.uniforms.uRes.value.set(w * dpr, h * dpr);
    Pyro.pixelScale = h * dpr * 1.25;
    const q = this.quality === 'high' ? 1 : this.quality === 'medium' ? 0.75 : 0.5;
    if (this.view === 'visual') this.visualizer.setSize(w * dpr * q, h * dpr * q);
    else {
      // on the venue screens it's seen small: scale it with the render load
      const vs = Math.max(0.5, this.adaptive.step.renderScale);
      this.visualizer.setSize((this.quality === 'low' ? 640 : 960) * vs, (this.quality === 'low' ? 360 : 540) * vs);
    }
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
        const fixed = hit.part.id ? /^deck\.(\d)\./.exec(hit.part.id) : null;
        if (fixed) this.hooks.focusDeck(Number(fixed[1]));
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

  private onScreen(objects: THREE.Object3D[]): boolean {
    if (!objects.length) return false;
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.wallFrustum.setFromProjectionMatrix(this.projScreen);
    return objects.some((o) => this.wallFrustum.intersectsBox(this.wallBox.setFromObject(o)));
  }

  /** `throttled`: the app is deliberately rendering less often (don't count it as slow frames) */
  render(dt: number, f: Features, visSettings: { shake: boolean }, throttled = false): void {
    this.frame++;
    if (!throttled && !this.compiling && this.adaptive.sample(dt * 1000)) this.applyAdaptive();
    this.ctx.dt = dt;
    this.ctx.now += dt;
    this.ctx.frame = this.frame;
    this.updateHover();
    this.updateAutoZoom();

    const lyric = this.lyric;
    // a hook line landing is a key-phrase hit for the lights
    if (lyric?.lineStarted && lyric.line?.hook && this.visualizer.settings.lyrics && this.visualizer.settings.lyricHooks) this.show.accent(1);
    const show = this.show.update(f, dt, this.hype);
    const venue = this.venue;
    if (this.view !== 'visual') {
      this.rig.update(dt, f, visSettings.shake);
      if (this.board) for (const p of this.board.parts) p.update(this.ctx);
      venue?.update(show, f, dt, this.camera);
      this.avatar.update(show, dt);
      // you only appear in the venue / crowd shots, or when the camera is out in front of the booth
      const v = this.rig.view;
      this.avatar.object.visible = !this.rig.focused && (v === 'wide' || v === 'crowd' || v === 'drone' || (v === 'custom' && this.camera.position.z < 0.3 && this.camera.position.distanceTo(this.avatarHead) > 1.2));
    }

    // on the venue screens the visual player can run at half rate when the load is high
    const needVis = this.view !== 'booth' || (!!venue && this.onScreen(venue.visObjects));
    const visFrame = this.view !== 'booth' || this.adaptive.step.visualizerFull || this.frame % 2 === 0;
    if (needVis && visFrame) {
      this.visualizer.render(f, dt, { frame: lyric, colors: show.colors });
      const tex = this.visualizer.texture;
      if (venue) {
        for (const m of venue.visMaterials) {
          if (m.map !== tex) {
            m.map = tex;
            m.color.set(0xffffff);
            m.needsUpdate = true;
          }
        }
      }
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
    this.bloom.strength = 0.5 + show.kick * 0.2 + show.drop * 0.35 + show.flash * 0.3;
    // cinematic lens: streaks and ghosts off the brightest fixtures, the drone's wide lens and speed blur
    const drone = this.rig.droneFx;
    const a = drone.amount;
    const lu = this.lens.uniforms;
    const lensFx = this.quality !== 'low' && this.adaptive.step.lensFx;
    lu.uTime.value = this.ctx.now;
    lu.uTaps.value = lensFx ? (this.quality === 'high' ? 11 : 7) : 0;
    lu.uStreak.value = (0.2 + show.flash * 0.25 + show.drop * 0.1) * (this.rig.focused ? 0.3 : 1);
    lu.uGhost.value = !lensFx || this.rig.focused ? 0 : 0.2;
    lu.uDistort.value = 0.34 * a;
    lu.uCA.value = 0.014 * a;
    lu.uBlur.value = a * (0.15 + THREE.MathUtils.clamp((drone.speed - 2.5) / 5, 0, 1) * 0.6);
    lu.uGrain.value = this.quality === 'low' ? 0 : 0.03 + 0.03 * a;
    lu.uVignette.value = 0.2 + 0.25 * a;
    // the booth light's shadows update at 30 Hz
    r.shadowMap.needsUpdate = this.frame % 2 === 0 || !this.keyLight.shadow.map;
    // live camera feeds (Boiler Room's stream monitor, Alexandra Palace's IMAG towers)
    const feed = venue?.feed;
    if (this.compiling) return;
    if (feed && this.frame % (feed.every ?? 3) === 0 && this.onScreen([feed.screen])) {
      const auto = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false;
      const vis = this.avatar.object.visible;
      this.avatar.object.visible = true;
      feed.screen.visible = false;
      r.setRenderTarget(feed.target);
      r.render(this.scene, feed.camera);
      r.setRenderTarget(null);
      feed.screen.visible = true;
      this.avatar.object.visible = vis;
      r.shadowMap.autoUpdate = auto;
    }
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
