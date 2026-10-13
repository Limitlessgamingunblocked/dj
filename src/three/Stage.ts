/*
 * 3D stage: WebGL renderer, the venue and its light show, the selected board, camera rig,
 * post-processing and all pointer interaction with the hardware.
 *
 * Views
 *   booth  – the booth with the visual player on the LED wall
 *   split  – booth plus a picture-in-picture of the visual player
 *   visual – the visual player full frame
 */
import type { LibraryBrowser } from './deviceScreen';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AOPass, DepthTap } from './ao';
import { DofPass } from './dof';
import { ReflectPass, tagBright } from './reflect';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ShowEnv } from './showenv';
import { noteWork } from '../core/stutter';
import type { AudioEngine } from '../audio/AudioEngine';
import { Avatar, type AvatarInput } from '../character/Avatar';
import { defaultLook } from '../character/look';
import type { Look } from '../core/models';
import type { ControlRegistry } from '../core/controls';
import type { LyricFrame } from '../lyrics/LyricsEngine';
import type { Features } from '../visualizer/AudioFeatures';
import { Visualizer } from '../visualizer/Visualizer';
import { buildBoard, type BoardDef } from './boards';
import type { BoardBuild } from './builder';
import { CameraRig, type ActiveShot, type ViewId } from './CameraRig';
import { guardScale, landmarkPose, scalePose, SHOTS, venueScale, type ShotId, type ShotPose } from './shots';
import { FX } from './fx';
import { FINITE_GLSL, LensOutputPass, NEUTRAL_GRADE } from './lens';
import { approachLook, copyLook, lookFor, LOOKS, type LensLook } from './looks';
import { ExposurePass } from './exposure';
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
  /** the user moved the camera by hand (drag, camera pad, keys) */
  cameraTouched?(): void;
}

interface Zone {
  id: string;
  box: THREE.Box3;
  side: 'L' | 'R' | null;
  deck: number | null;
  mixer: boolean;
}

/** the composer's buffers: half float for the glow, multisampled, with the depth kept for the ambient occlusion */
/** the sharpest texture filtering the GPU has, on every texture under `root` (print and floors stay crisp at an angle) */
function sharpenTextures(root: THREE.Object3D, maxAniso: number): void {
  const want = Math.min(16, Math.max(1, maxAniso));
  const keys = ['map', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'normalMap', 'bumpMap', 'aoMap', 'alphaMap', 'clearcoatMap'] as const;
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
      for (const k of keys) {
        const t = (mm as unknown as Record<string, THREE.Texture | null | undefined>)[k];
        if (t && t.isTexture && t.anisotropy < want && t.image && !(t as THREE.DataTexture).isDataTexture && !t.isRenderTargetTexture) {
          t.anisotropy = want;
          t.needsUpdate = true;
        }
      }
    }
  });
}

function composerTarget(samples: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthTexture: new THREE.DepthTexture(1, 1) });
}

/** how bright (in the scene's light, at exposure 1) a pixel must be to bloom */
const BLOOM_THRESHOLD = 0.93;
/** the deck light's intensity in a room with light of its own */
const DECK_LIGHT = 3.2;
/** the bloom threshold's multiplier close on the board */
const CLOSE_BLOOM = 2.4;
/** how bright (linear, at exposure 1) the board's patch of the frame should be at least: the deck light lifts it there */
const DECK_LEVEL = 0.05;

export class Stage {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  readonly visualizer: Visualizer;
  /** the song whose colours the lights' Song palette has */
  private songLookId = '';
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
  /** the shadowless light over the board that keeps its controls readable */
  readonly deckLight: THREE.SpotLight;
  private fill: THREE.DirectionalLight;
  /** the studio light the indoor venues reflect */
  private roomEnv!: THREE.Texture;
  /** indoors on Medium and High the hardware reflects the show's colours (showenv.ts) */
  private showEnv = new ShowEnv();
  private showEnvAge = 1;
  /** the lighting rules every room shares (Section 2.3): a spotlight on you when a vocal carries the track, the low end glowing on the floor under the booth */
  private djSpot: THREE.SpotLight;
  private underGlow: THREE.PointLight;
  /** you: at the decks, seen from the crowd and venue cameras (and in the dressing room) */
  readonly avatar: Avatar;
  /**
   * A scene that stands you somewhere other than the decks (the dressing
   * room): where, which way you face, and what you're moving to. The booth
   * hides while it's set.
   */
  avatarSpot: { pos: THREE.Vector3; face: number; input: () => AvatarInput } | null = null;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  /** ambient occlusion (public for the debug menu's view of it) */
  readonly ao: AOPass;
  readonly dof: DofPass;
  /** reflective floors (public for the debug menu) */
  readonly reflect: ReflectPass;
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
  /**
   * Pixels at the bottom of the stage covered by an overlay (the camera bar in
   * board full screen): the camera frames the board in the space above it.
   */
  bottomInset = 0;
  /** the lens look picked in the camera menu / Settings ('auto' = each angle's own) */
  lensPick: LensLook | 'auto' = 'auto';
  /** the look on screen now (eases towards the wanted one) */
  private look = copyLook(LOOKS.none);
  private lookId: LensLook = 'none';
  /** time since the picture last updated, for looks with a low frame rate (the security camera) */
  private lookHold = 0;
  private insetFrac = 0;
  /** auto exposure: a camera that stops down when the frame blows out */
  readonly exposure = new ExposurePass();
  /** the club's base exposure; auto exposure works around it */
  private baseExposure = 1.05;
  /** the auto director is cutting the camera (hover zoom stays out of its way) */
  directing = false;
  /** a cut through a quick dip to black: k is the picture's brightness */
  /** a cut through black: what to switch to once it's dark */
  private fade: { k: number; phase: 'none' | 'out' | 'in'; go: (() => void) | null } = { k: 1, phase: 'none', go: null };
  /** the lens look on the director's own moves when the look is on Auto (the cinematic style letterboxes) */
  shotLook: LensLook = 'none';
  /** a photo was asked for: called with the canvas right after the next frame is drawn */
  private shotWanted: ((src: HTMLCanvasElement) => void) | null = null;
  /** called with the canvas after every frame (recording, the replay buffer's video), same task as the draw */
  readonly frameHooks = new Set<(src: HTMLCanvasElement) => void>();
  /**
   * While recording video: the frame size it needs from the stage (after cropping to its aspect).
   * The stage renders sharper to give it (up to 3× the screen), whatever the adaptive quality says.
   */
  private recordNeed: { w: number; h: number } | null = null;
  /** text burnt into the picture by some looks: the security camera's clock, the camcorder's REC */
  private lensText: { el: HTMLElement; tl: HTMLElement; tr: HTMLElement; bl: HTMLElement; br: HTMLElement; shown: string; at: number; since: number };
  private zones: Zone[] = [];
  private boardTop = TABLE_Y;
  /** the hardware you play (no cables or laptop), in world space */
  private hwBox = new THREE.Box3();
  /** how much the deck light is lifted for a dark room (1: as set) */
  private deckBoost = 1;
  private tmpV = new THREE.Vector3();
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
    {
      const span = (cls: string) => Object.assign(document.createElement('span'), { className: cls });
      const el = document.createElement('div');
      el.className = 'lens-text';
      el.setAttribute('aria-hidden', 'true');
      const tl = span('tl');
      const tr = span('tr');
      const bl = span('bl');
      const br = span('br');
      el.append(tl, tr, bl, br);
      this.el.append(el);
      this.lensText = { el, tl, tr, bl, br, shown: '', at: 0, since: 0 };
    }

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    // the studio's skylight straight overhead is far brighter than its other panels: looking down on
    // the board, every metal jog, platter and cap mirrored it as a white disc that bloomed
    const studio = new RoomEnvironment();
    studio.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m && o.position.y > 19 && m.emissiveIntensity) m.emissiveIntensity *= 0.12;
    });
    this.roomEnv = pmrem.fromScene(studio, 0.04).texture;
    this.scene.environment = this.roomEnv;
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
    this.fill = fill;
    this.scene.add(this.keyLight, this.keyLight.target, fill);
    this.djSpot = new THREE.SpotLight(0xfff1e2, 0, 7, 0.22, 0.55, 1.3);
    this.djSpot.position.set(0, 3.6, -1.6);
    this.djSpot.target.position.set(0, 1.35, 0.68);
    this.underGlow = new THREE.PointLight(0xff2e88, 0, 3.2, 1.6);
    this.underGlow.position.set(0, 0.12, -0.75);
    this.scene.add(this.djSpot, this.djSpot.target, this.underGlow);
    // the deck light: a soft, shadowless light just over the board, so its print, caps and
    // faders read in every venue, however dark the room (like the gooseneck lamps in real booths)
    this.deckLight = new THREE.SpotLight(0xf2f5ff, DECK_LIGHT, 3, 0.9, 0.85, 1.4);
    this.deckLight.castShadow = false;
    this.scene.add(this.deckLight, this.deckLight.target);
    // you, as seen from the crowd and venue cameras
    this.avatar = new Avatar(defaultLook());
    this.scene.add(this.avatar.object);
    this.rig = new CameraRig(this.camera, this.canvas);

    this.composer = new EffectComposer(this.renderer, composerTarget(this.msaa));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // the scene's depth, for the passes after it (and a copy in metres for depth of field)
    const tap = new DepthTap(this.camera);
    this.composer.addPass(tap);
    // the room's light in a polished floor
    this.reflect = new ReflectPass(this.scene, this.camera, tap);
    this.composer.addPass(this.reflect);
    // contact shadow where things meet, from the frame's depth
    this.ao = new AOPass(this.camera, tap);
    this.composer.addPass(this.ao);
    // photo mode's depth of field (off otherwise)
    this.dof = new DofPass(tap);
    this.composer.addPass(this.dof);
    // measures the scene for auto exposure (leaves the picture alone)
    this.composer.addPass(this.exposure);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.4, BLOOM_THRESHOLD);
    // the bloom blurs its input across the whole frame, so a single NaN pixel would black it all
    // out: scrub non-finite values as they enter
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader
      .replace('void main() {', `${FINITE_GLSL}\nvoid main() {`)
      .replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = vec4( finite3( texture2D( tDiffuse, vUv ).rgb ), 1.0 );');
    hp.needsUpdate = true;
    this.composer.addPass(this.bloom);
    // lens effects, tone mapping, grade and output in one pass
    this.lens = new LensOutputPass();
    // the lens dirt is lit by the bloom's widest blur
    this.lens.uniforms.tGlow.value = this.bloom.renderTargetsVertical[2].texture;
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
      browser: null,
    };
    this.bindPointer();
    // whatever moves a control (the mouse, a key, MIDI, the Auto DJ), your hand goes to it
    reg.on('activity', ({ id }) => this.handTo(id));
    // touching the stage skips the walk in
    for (const ev of ['pointerdown', 'wheel'] as const) this.el.addEventListener(ev, () => this.rig.arriving && this.skipArrival(), { passive: true });
    this.rig.onManualMove(() => {
      this.focusedZone = null;
      this.zoneCandidate = null;
      this.hooks.cameraTouched?.();
    });
    new ResizeObserver(() => this.resize()).observe(this.el);
  }

  /** what you look like (rebuilds the avatar) */
  setLook(look: Look, djName?: string): void {
    this.avatar.setLook(look, djName);
    this.djLook = look;
    this.venue?.attachDJ?.(this.avatar, look);
  }
  /** what you look like now (for rooms that copy you) */
  private djLook: Look = defaultLook();

  /** the part on the board for a control that just moved, and your hand to it */
  private handTo(id: string): void {
    if (!this.board || this.avatarSpot) return;
    const reg = this.ctx.reg;
    const part = this.board.parts.find((p) => (p.id !== null && reg.resolveId(p.id) === id) || (p.alt !== null && reg.resolveId(p.alt) === id));
    if (!part) return;
    const at = new THREE.Vector3();
    this.avatar.touch(() => (part.object.parent ? part.grip(at) : null), part.hold, () => part.turn());
  }

  /** you at the decks, facing the room, or where a scene has put you */
  private placeAvatar(show: AvatarInput, dt: number): void {
    const av = this.avatar;
    const spot = this.avatarSpot;
    if (this.board) this.board.root.visible = !spot;
    if (spot) {
      av.mode = 'idle';
      av.object.position.copy(spot.pos);
      av.object.rotation.y = spot.face;
      av.object.visible = true;
      av.update(spot.input(), dt);
      return;
    }
    av.mode = 'dj';
    // a channel cued in the headphones: the cup goes to the ear
    av.cueing = this.ctx.engine.channels.some((c) => c.state.cue);
    av.object.position.set(0, 0, 0.68);
    av.object.rotation.y = Math.PI;
    // you only appear in the venue / crowd shots, or when the camera is out in front of the booth;
    // in photo mode the camera can come round you for a portrait, as long as it isn't in your head
    const v = this.rig.view;
    const toHead = this.camera.position.distanceTo(this.avatarHead);
    const custom = this.dof.enabled ? toHead > 0.35 : this.camera.position.z < 0.3 && toHead > 1.2;
    av.object.visible = !this.rig.focused && (v === 'wide' || v === 'crowd' || v === 'drone' || this.rig.isLive || (v === 'custom' && custom));
    // the live feeds (stream monitor, IMAG) show you even when the main camera doesn't
    if (av.object.visible || this.venue?.feed) av.update(show, dt);
  }

  /** lights follow the music */
  get reactiveLights(): boolean {
    return this.show.controls.auto;
  }

  set reactiveLights(v: boolean) {
    this.show.controls.auto = v;
  }

  /** the track library the boards' screens browse */
  setBrowser(b: LibraryBrowser): void {
    this.ctx.browser = b;
  }

  /* ------------------------------------------------------------------ */
  /* venue                                                                */
  /* ------------------------------------------------------------------ */

  /** photo mode: hold the room still, and a filter over the grade */
  freeze = false;
  photoFilter: import('./lens').Grade | null = null;
  private frozenShow: ReturnType<LightShow['update']> | null = null;
  /** a walk into the venue waiting for its shaders to finish compiling */
  private pendingArrival = false;
  private arrivalCard: HTMLElement | null = null;
  /** the night's flyer, shown with the venue's name on the next walk in (a gig) */
  arrivalFlyer: HTMLCanvasElement | null = null;

  /** a walk in is waiting to start or under way */
  get arriving(): boolean {
    return this.pendingArrival || this.rig.arriving;
  }

  setVenue(def: VenueDef, o: { arrive?: boolean } = {}): void {
    noteWork('venue build');
    if (this.venue) {
      this.scene.remove(this.venue.group);
      this.venue.dispose();
    }
    this.venueDef = def;
    // a new gig: you start it fresh
    this.avatar.sweat = 0;
    const v = def.build();
    this.venue = v;
    // the studio environment map is for the hardware; keep big venue surfaces from mirroring it
    v.group.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) (m as THREE.MeshStandardMaterial).envMapIntensity *= 0.3;
    });
    this.scene.add(v.group);
    sharpenTextures(v.group, this.renderer.capabilities.getMaxAnisotropy());
    v.attachDJ?.(this.avatar, this.djLook);
    // the floor's reflection shows the bright things: the screens, beams, lasers, lamps and neon
    this.reflect.floor = v.reflect ?? null;
    if (v.reflect) tagBright(v.group);
    this.scene.background = v.background;
    this.scene.fog = v.fog;
    this.keyLight.color.set(v.keyLight.color);
    this.keyLight.intensity = v.keyLight.intensity;
    this.show.setVenuePalette(def.palette);
    this.lens.setGrade(v.grade ?? NEUTRAL_GRADE);
    // only the output pass tone-maps (scene programs render to a float target), so this recompiles one shader
    this.renderer.toneMapping = v.toneMapping === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    this.rig.setViews(v.views);
    // open air: see out to the horizon
    this.camera.far = v.far ?? 160;
    this.camera.updateProjectionMatrix();
    this.clearDesk();
    this.precompile();
    // walking in: doors, over the crowd, the booth (once it's ready to draw)
    this.pendingArrival = !!o.arrive && this.view !== 'visual' && !this.avatarSpot;
    if (this.pendingArrival) this.showArrivalCard(def);
  }

  /**
   * The drinks and the laptop on the booth (tagged deskProp) stay off the hardware: a four-deck
   * setup fills the desk they were put on, and they stood in a jog or over a player. Each one
   * slides out past the board's edge if that's a short way, and is put away if it isn't.
   */
  private clearDesk(): void {
    if (!this.venue || this.hwBox.isEmpty()) return;
    const keep = this.hwBox.clone().expandByVector(this.tmpV.set(0.04, 0.5, 0.04));
    const mid = keep.getCenter(new THREE.Vector3());
    const props: THREE.Object3D[] = [];
    this.venue.group.traverse((o) => {
      if (o.userData.deskProp) props.push(o);
    });
    for (const o of props) {
      const home = (o.userData.deskHome as THREE.Vector3 | undefined) ?? (o.userData.deskHome = o.position.clone());
      o.position.copy(home);
      o.visible = true;
      o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o);
      if (!b.intersectsBox(keep)) continue;
      const out = (b.min.x + b.max.x) / 2 >= mid.x ? keep.max.x - b.min.x : keep.min.x - b.max.x;
      if (Math.abs(out) > 0.14) {
        o.visible = false;
        continue;
      }
      const wp = o.getWorldPosition(new THREE.Vector3());
      wp.x += out;
      o.position.copy(o.parent ? o.parent.worldToLocal(wp) : wp);
    }
  }

  /**
   * The deck light comes up in a dark room (an empty festival stage, the crazy rooms between drops) so
   * the board still reads, and back down as the room's own light arrives: it meters the board's patch
   * of the frame and steers its brightness towards DECK_LEVEL, never below the light as set.
   */
  private liftDeckLight(dt: number): void {
    let want = 1;
    if (this.exposure.enabled && this.exposure.ready && this.board && !this.hwBox.isEmpty()) {
      // the board's rectangle on screen
      let x0 = 1;
      let y0 = 1;
      let x1 = -1;
      let y1 = -1;
      for (let i = 0; i < 8; i++) {
        const p = this.tmpV.set(i & 1 ? this.hwBox.max.x : this.hwBox.min.x, i & 2 ? this.hwBox.max.y : this.hwBox.min.y, i & 4 ? this.hwBox.max.z : this.hwBox.min.z).project(this.camera);
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      const level = this.exposure.level((x0 + 1) / 2, (y0 + 1) / 2, (x1 + 1) / 2, (y1 + 1) / 2);
      // on screen and measured: nudge towards the level (what's measured includes the light's own work)
      want = level > 0 && x1 > -1 && x0 < 1 && y1 > -1 && y0 < 1 ? THREE.MathUtils.clamp(this.deckBoost * Math.sqrt(DECK_LEVEL / level), 1, 2.6) : this.deckBoost;
    }
    this.deckBoost += (want - this.deckBoost) * (1 - Math.exp(-Math.min(dt, 0.1) * 2));
    this.deckLight.intensity = DECK_LIGHT * this.deckBoost;
  }

  /** the venue's name over the walk in */
  private showArrivalCard(def: VenueDef): void {
    this.arrivalCard?.remove();
    const card = document.createElement('div');
    card.className = 'arrival-card';
    const name = document.createElement('b');
    name.textContent = def.name;
    const place = document.createElement('span');
    place.textContent = def.place;
    const text = document.createElement('div');
    text.className = 'arrival-text';
    text.append(name, place);
    card.append(text);
    // a gig: its flyer slides in beside the name, pinned at a slight angle
    const flyer = this.arrivalFlyer;
    this.arrivalFlyer = null;
    if (flyer) {
      flyer.className = 'arrival-flyer';
      flyer.setAttribute('aria-hidden', 'true');
      card.classList.add('with-flyer');
      card.prepend(flyer);
    }
    this.el.append(card);
    this.arrivalCard = card;
    window.setTimeout(() => {
      if (this.arrivalCard === card) this.arrivalCard = null;
      card.remove();
    }, 5200);
  }

  /** start the walk in, from black */
  private startArrival(): void {
    this.pendingArrival = false;
    const v = this.rig.view;
    const end = (v !== 'custom' ? this.rig.poseOf(v) : null) ?? { pos: this.camera.position.clone(), target: this.rig.controls.target.clone() };
    if (this.rig.arrive(end)) this.fade = { k: 0, phase: 'in', go: null };
  }

  /** how far away the first solid thing under a point on the screen is (photo mode's tap to focus) */
  distanceAt(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    ray.far = this.camera.far;
    const roots: THREE.Object3D[] = [this.avatar.object];
    if (this.venue) roots.push(this.venue.group);
    if (this.board) roots.push(this.board.root);
    const hit = ray.intersectObjects(roots, true).find((h) => {
      const m = h.object as THREE.Mesh;
      if (!m.isMesh || !m.visible) return false;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
      return !mat.transparent && mat.visible;
    });
    return hit ? hit.distance : null;
  }

  /** how far the DJ's face is from the camera */
  distanceToDJ(): number {
    return this.camera.position.distanceTo(this.avatar.bones.head.getWorldPosition(new THREE.Vector3()));
  }

  /** walk into the venue that's up now (after the title screen) */
  arrive(): void {
    if (!this.venueDef || this.view === 'visual') return;
    this.pendingArrival = true;
    this.showArrivalCard(this.venueDef);
  }

  /** any input: straight to the end of the walk in */
  skipArrival(): void {
    this.pendingArrival = false;
    this.rig.skipArrival();
    this.arrivalCard?.remove();
    this.arrivalCard = null;
  }

  /**
   * Compile the scene's shaders off the main path (KHR_parallel_shader_compile)
   * so switching venue or board doesn't stall on the first frame. The club
   * view holds its last frame until they're ready (at most 4 s).
   */
  private precompile(): void {
    noteWork('shader compile');
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
    noteWork('board build');
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
    this.highlight(null);
    this.board = buildBoard(def, finishId, { stickers: this.stickers });
    this.board.root.position.y = TABLE_Y;
    this.scene.add(this.board.root);
    this.hits = this.board.parts.flatMap((p) => p.hit);
    this.ctx.accent = this.board.finish.accent;
    this.board.root.updateMatrixWorld(true);
    // the cables running off behind the units are not part of what the light and camera frame
    const cables = this.board.cables;
    cables?.removeFromParent();
    const box = new THREE.Box3().setFromObject(this.board.root);
    if (cables) this.board.root.add(cables);
    // the camera frames the hardware you play (its chassis), not a laptop or stand behind it:
    // fitting those in left the controls small at the bottom of the frame
    const hw = new THREE.Box3();
    for (const u of this.board.units) hw.union(new THREE.Box3().setFromObject(u.group));
    this.rig.setBounds(hw.isEmpty() ? box : hw, def.id);
    // the deck light sits over the front of the board, aimed at its middle, wide enough to cover it
    const bc = box.getCenter(new THREE.Vector3());
    const bs = box.getSize(new THREE.Vector3());
    this.deckLight.position.set(bc.x, box.max.y + 0.75, bc.z + bs.z * 0.45 + 0.35);
    this.deckLight.target.position.set(bc.x, box.max.y - 0.02, bc.z - bs.z * 0.05);
    this.deckLight.angle = Math.min(1.2, Math.atan2(Math.max(bs.x, bs.z) * 0.62, 0.9));
    this.deckLight.distance = 3;
    // crisp print at any angle, and the hardware's own sheen
    sharpenTextures(this.board.root, this.renderer.capabilities.getMaxAnisotropy());
    this.board.root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
        const std = mm as THREE.MeshStandardMaterial;
        // plastics and rubber only: metal is mostly reflection, and looking down on a jog, a platter
        // or an aluminium cap it mirrored the studio light overhead as a white, blooming disc
        if (std.isMeshStandardMaterial && !std.userData.envBoosted && std.metalness < 0.5) {
          std.userData.envBoosted = true;
          std.envMapIntensity *= 1.6;
        }
      }
    });
    this.boardTop = box.max.y;
    this.hwBox.copy(hw.isEmpty() ? box : hw);
    this.clearDesk();
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
    // the angles that move on their own are for watching: hovering over the board doesn't zoom them in
    if (!this.autoZoom || this.view === 'visual' || !this.hoverMode || this.rig.view === 'drone' || this.rig.isLive || this.directing) return;
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
    const p = this.rig.poseOf(v);
    // a long way to go (across the room, through walls and the crowd): cut instead of flying
    if (p && p.pos.distanceTo(this.camera.position) > 9 && this.view !== 'visual') this.cutTo(v);
    else this.rig.goTo(v);
  }

  /** Cut to an angle: through a quick dip to black (moves too long to fly), or straight there on the beat (the director). */
  cutTo(v: ViewId, cut: 'dip' | 'hard' = 'dip'): void {
    this.cutWith(() => this.rig.goTo(v, true), cut);
  }

  private cutWith(go: () => void, cut: 'dip' | 'hard'): void {
    this.focusedZone = null;
    if (cut === 'hard' || this.view === 'visual') {
      go();
      this.fade = { k: 1, phase: 'none', go: null };
      return;
    }
    this.fade.go = go;
    // asked again while it's going dark: just change where it cuts to
    if (this.fade.phase !== 'out') this.fade.phase = 'out';
  }

  /**
   * Cut to one of the director's moves (shots.ts) or the venue's landmarks,
   * paced to run `seconds`. The move is pulled in towards the booth if a wall
   * or ceiling is in the way. False if there's no such landmark here.
   */
  cutToShot(take: { id: ShotId | 'landmark'; landmark: number; side: number; seconds: number }, cut: 'dip' | 'hard' = 'hard'): boolean {
    const views = this.venue?.views ?? null;
    let shot: ActiveShot;
    if (take.id === 'landmark') {
      const l = views?.director?.landmarks?.[take.landmark];
      if (!l) return false;
      shot = { label: l.label, close: false, hand: 0.06, seconds: take.seconds, pose: (u) => scalePose(landmarkPose(l, u), 1) };
    } else {
      const def = SHOTS[take.id];
      const ctx = { box: this.rig.board.clone(), scale: venueScale(views), fov: this.rig.normalFov };
      const raw = (u: number): ShotPose => def.pose(ctx, u, take.side);
      const k = guardScale([raw(0), raw(0.5), raw(1)], (a, b) => this.clearance(a, b));
      shot = { label: def.label, close: !!def.close, hand: def.hand, seconds: take.seconds, pose: (u) => scalePose(raw(u), k) };
    }
    this.cutWith(() => this.rig.playShot(shot), cut);
    return true;
  }

  private clearRay = new THREE.Raycaster();
  /** How far from `from` towards `to` before something solid in the venue (not people, glass, haze or light) is in the way. */
  private clearance(from: THREE.Vector3, to: THREE.Vector3): number {
    const v = this.venue;
    if (!v) return Infinity;
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-3) return Infinity;
    const ray = this.clearRay;
    ray.set(from, dir.divideScalar(len));
    ray.near = 0.3;
    ray.far = len + 0.5;
    const avatar = this.avatar.object;
    const solid = (o: THREE.Object3D): boolean => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh || (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return false;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!mat || !mat.visible || mat.transparent || !mat.depthWrite || (mat as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending) return false;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible || p === avatar) return false;
      return true;
    };
    for (const h of ray.intersectObject(v.group, true)) if (solid(h.object)) return h.distance;
    return Infinity;
  }

  /** The next frame as a PNG, with the lens look and the text it burns in. */
  snapshot(): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.shotWanted = (src) => {
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const g = c.getContext('2d');
        if (!g) return resolve(null);
        g.drawImage(src, 0, 0);
        const t = this.lensText;
        if (t.shown && this.view !== 'visual') {
          // the burnt-in text is HTML over the canvas: draw it where it sits, at the canvas's scale
          const box = this.canvas.getBoundingClientRect();
          const k = src.width / Math.max(1, box.width);
          g.textBaseline = 'top';
          for (const sp of [t.tl, t.tr, t.bl, t.br]) {
            if (!sp.textContent) continue;
            const r = sp.getBoundingClientRect();
            const cs = getComputedStyle(sp);
            g.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * k}px ${cs.fontFamily}`;
            g.fillStyle = cs.color;
            g.shadowColor = 'rgba(0,0,0,0.85)';
            g.shadowBlur = 3 * k;
            g.fillText(sp.textContent, (r.left - box.left) * k, (r.top - box.top) * k);
          }
        }
        c.toBlob((b) => resolve(b), 'image/png');
      };
    });
  }

  setQuality(q: Quality): void {
    this.quality = q;
    FX.quality = q;
    this.keyLight.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    this.renderer.shadowMap.enabled = q !== 'low';
    // the crowd's detailed front row (venues built from now on): none on low
    Crowd.frontRow = q === 'low' ? 0 : 24;
    // multisampling is the biggest fill cost: none on low
    const samples = q === 'low' ? 0 : 4;
    if (samples !== this.msaa) {
      this.msaa = samples;
      this.composer.reset(composerTarget(samples));
    }
    this.adaptive.reset(0);
    this.applyAdaptive();
  }

  /** Apply the adaptive quality step: render scale, crowd detail, effects. */
  applyAdaptive(): void {
    const st = this.adaptive.step;
    FX.detail = st.crowdDetail;
    Crowd.detailDistance = (this.quality === 'high' ? 16 : this.quality === 'medium' ? 12 : 8) * st.crowdDetail;
    this.visualizer.bloomAllowed = st.visualizerBloom;
    this.resize();
  }

  /* ------------------------------------------------------------------ */
  /* sizing                                                               */
  /* ------------------------------------------------------------------ */

  /** The text some looks burn into the picture, refreshed twice a second. */
  private updateLensText(look: LensLook): void {
    const t = this.lensText;
    const kind = this.view === 'visual' ? '' : look === 'cctv' || look === 'vhs' ? look : '';
    if (kind !== t.shown) {
      t.shown = kind;
      t.el.dataset.look = kind;
      t.at = 0;
    }
    if (!kind || this.ctx.now - t.at < 0.5) return;
    t.at = this.ctx.now;
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const clock = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    if (kind === 'cctv') {
      t.tl.textContent = `CAM 0${(this.venueDef?.id.length ?? 3) % 8 + 1}  ${(this.venueDef?.short ?? this.venueDef?.name ?? '').toUpperCase()}`;
      t.tr.textContent = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}  ${clock}`;
      t.bl.textContent = '● REC';
      t.br.textContent = '';
    } else {
      const el = Math.floor(this.ctx.now - t.since);
      t.tl.textContent = '● REC';
      t.tr.textContent = '▮▮▮▯';
      t.bl.textContent = `SP  ${Math.floor(el / 3600)}:${p2(Math.floor(el / 60) % 60)}:${p2(el % 60)}`;
      t.br.textContent = `${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()}. ${p2(d.getDate())} ${d.getFullYear()}  ${clock}`;
    }
  }

  /**
   * The fisheye reads the wide render at tan(angle): its focal length in pixels, and a
   * fisheye scale that brings the frame's side edges to the render's side edges.
   */
  private fisheyeUniforms(): void {
    const lu = this.lens.uniforms;
    const res = lu.uRes.value;
    const hFull = res.y * (1 - this.insetFrac);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    lu.uCenter.value.set(0.5, 0.5 + this.insetFrac / 2);
    lu.uFocal.value = hFull / 2 / tanHalf;
    lu.uFishF.value = res.x / 2 / (Math.atan((tanHalf * res.x) / hFull) * 0.97);
  }

  /** the render's pixel ratio for live frames: the quality's cap times the adaptive resolution */
  private livePixelRatio(): number {
    const cap = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1);
    const live = Math.max(0.5, cap * this.adaptive.step.renderScale);
    const need = this.recordNeed;
    if (!need) return live;
    // the crop of the stage that fills the recording's frame, in CSS pixels
    const { w, h } = this.size;
    const cw = w / h > need.w / need.h ? h * (need.w / need.h) : w;
    return Math.min(3, Math.max(live, need.w / cw));
  }

  /** Render sharp enough for a recording of this frame size (null: back to normal). */
  setRecordSize(need: { w: number; h: number } | null): void {
    this.recordNeed = need;
    this.resize();
  }

  /** the canvas's drawing size right now */
  get pixelSize(): { w: number; h: number } {
    return { w: this.canvas.width, h: this.canvas.height };
  }

  private setPixels(dpr: number): void {
    const { w, h } = this.size;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.lens.uniforms.uRes.value.set(w * dpr, h * dpr);
    // pyro sparks are sized in pixels
    Pyro.pixelScale = h * dpr * 1.25;
    this.fisheyeUniforms();
  }

  resize(): void {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.size = { w, h };
    this.setPixels(this.livePixelRatio());
    const bloomScale = this.quality === 'high' ? 1 : 0.5;
    this.bloom.resolution.set(w * bloomScale, h * bloomScale);
    // with a bottom inset the lens is centred on the area above it (the picture still fills the stage)
    const inset = Math.min(Math.max(0, this.bottomInset), h * 0.35);
    this.insetFrac = inset / h;
    this.el.style.setProperty('--inset', `${inset}px`);
    this.lensText.el.style.fontSize = `${Math.round(Math.max(11, Math.min(22, h * 0.03)))}px`;
    this.camera.aspect = w / (h - inset);
    if (inset > 0) this.camera.setViewOffset(w, h - inset, 0, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
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
        if (e.type === 'pointerup' && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8 && performance.now() - t.t < 350 && this.autoZoom && this.view !== 'visual' && !this.rig.isLive && this.rig.view !== 'drone') {
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
      if (!this.drags.size) {
        this.tooltip.hidden = true;
        this.highlight(null);
      }
    };
    el.addEventListener('pointerup', end, { capture: true });
    el.addEventListener('pointercancel', end, { capture: true });
    el.addEventListener('lostpointercapture', (e) => end(e as PointerEvent), { capture: true });
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
        this.canvas.style.cursor = '';
      if (!this.drags.size) {
        this.tooltip.hidden = true;
        this.highlight(null);
      }
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
    this.highlight(part);
  }

  /** the control under the pointer: a glowing outline on the panel round it, the size of the control */
  private hoverOutline: THREE.Mesh | null = null;
  private outlined: Part | null = null;
  private highlight(part: Part | null): void {
    if (part === this.outlined) return;
    this.outlined = part;
    if (this.hoverOutline) {
      this.scene.remove(this.hoverOutline);
      this.hoverOutline.geometry.dispose();
      (this.hoverOutline.material as THREE.Material).dispose();
      this.hoverOutline = null;
    }
    if (!part) return;
    const box = new THREE.Box3().setFromObject(part.object);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const pad = 0.0022;
    const w = size.x + pad * 2;
    const d = size.z + pad * 2;
    const t = Math.max(0.0007, Math.min(w, d) * 0.06);
    const rr = (ww: number, dd: number, r: number) => {
      const sh = new THREE.Shape();
      const x0 = -ww / 2;
      const y0 = -dd / 2;
      const rad = Math.min(r, ww / 2, dd / 2);
      sh.moveTo(x0 + rad, y0);
      sh.lineTo(x0 + ww - rad, y0);
      sh.quadraticCurveTo(x0 + ww, y0, x0 + ww, y0 + rad);
      sh.lineTo(x0 + ww, y0 + dd - rad);
      sh.quadraticCurveTo(x0 + ww, y0 + dd, x0 + ww - rad, y0 + dd);
      sh.lineTo(x0 + rad, y0 + dd);
      sh.quadraticCurveTo(x0, y0 + dd, x0, y0 + dd - rad);
      sh.lineTo(x0, y0 + rad);
      sh.quadraticCurveTo(x0, y0, x0 + rad, y0);
      return sh;
    };
    const outer = rr(w, d, Math.min(w, d) * 0.35);
    outer.holes.push(new THREE.Path(rr(w - t * 2, d - t * 2, Math.min(w, d) * 0.3).getPoints(24).reverse()));
    const geo = new THREE.ShapeGeometry(outer, 8);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: this.ctx.accent || '#2ec4f1', transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const m = new THREE.Mesh(geo, mat);
    const c = box.getCenter(new THREE.Vector3());
    m.position.set(c.x, box.min.y + 0.0004, c.z);
    m.renderOrder = 3;
    this.hoverOutline = m;
    this.scene.add(m);
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
    // photo mode's freeze: the room holds the moment (the camera still moves)
    const frozen = this.freeze && !!this.frozenShow;
    const show = frozen ? this.frozenShow! : this.show.update(f, dt, this.hype);
    if (!frozen) this.frozenShow = show;
    const sdt = frozen ? 0 : dt;
    const venue = this.venue;
    if (this.view !== 'visual') {
      this.rig.update(dt, f, visSettings.shake);
      if (this.board) for (const p of this.board.parts) p.update(this.ctx);
      venue?.update(show, f, sdt, this.camera);
      // vocals → a spotlight on the DJ; bass → a glow on the floor under the booth
      const atBooth = !this.avatarSpot;
      this.djSpot.intensity = atBooth ? 14 * show.vocal * show.master * Math.min(1.2, show.intensity) : 0;
      this.underGlow.color.copy(show.colors[1]);
      this.underGlow.intensity = atBooth ? 3.2 * show.bass * show.master * Math.min(1.2, show.intensity) : 0;
      const amb = venue?.ambient ?? 1;
      // outside, things reflect the sky; inside, the show's colours (the studio light on Low)
      let env = venue?.environment ?? null;
      if (!env && this.quality !== 'low') {
        this.showEnvAge += dt;
        if (this.showEnvAge > 1 / 15) {
          this.showEnv.update(this.renderer, show, this.showEnvAge);
          this.showEnvAge = 0;
        }
        env = this.showEnv.texture;
      }
      this.scene.environment = env ?? this.roomEnv;
      this.scene.environmentIntensity = 0.45 * amb;
      this.fill.intensity = 0.3 * amb;
      this.placeAvatar(show, sdt);
    }

    // on the venue screens the visual player can run at half rate when the load is high
    const needVis = this.view !== 'booth' || (!!venue && this.onScreen(venue.visObjects));
    const visFrame = this.view !== 'booth' || this.adaptive.step.visualizerFull || this.frame % 2 === 0;
    if (needVis && visFrame) {
      this.visualizer.safe = this.show.controls.reduceFlash;
      this.visualizer.render(f, dt, { frame: lyric, colors: show.colors });
      const look = this.visualizer.look;
      if (look && look.id !== this.songLookId) {
        this.songLookId = look.id;
        this.show.setSongPalette(look.colors);
      }
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
      this.frameDone();
      return;
    }
    this.bloom.enabled = this.quality !== 'low';
    // contact shadow: not on Low, and not when the adaptive step drops it
    this.ao.enabled = this.quality !== 'low' && this.adaptive.step.surfaces;
    // close on the board, no occlusion on the hardware or the desk round it (it smudged the print and
    // ringed every jog and knob); the crowd and the room behind still get it
    const close = this.rig.focused || this.rig.view === 'top' || this.rig.view === 'perf' || this.rig.view === 'booth' || !!this.rig.shot?.close;
    if (close && !this.hwBox.isEmpty()) {
      const cam = this.camera.position;
      let far = 0;
      for (let i = 0; i < 8; i++) {
        this.tmpV.set(i & 1 ? this.hwBox.max.x : this.hwBox.min.x, i & 2 ? this.hwBox.max.y : this.hwBox.min.y, i & 4 ? this.hwBox.max.z : this.hwBox.min.z);
        far = Math.max(far, this.tmpV.distanceTo(cam));
      }
      this.ao.clearTo = far + 0.35;
      this.ao.clearSoft = 0.8;
    } else this.ao.clearTo = 0;
    // the floor's reflection: not on Low, not when the adaptive step drops it, and not looking down on the board
    this.reflect.enabled = this.ao.enabled && this.reflect.planes.length > 0 && this.rig.view !== 'top';
    // close on the board (the board angles, or zoomed in on a section) the picture stays clean
    // glow, not fog: with dozens of beams and lasers on a drop, a strong bloom turns the frame milky;
    // on the board, LEDs glow a little rather than blooming into blobs over the controls
    this.bloom.strength = (0.42 + show.kick * 0.12 + show.drop * 0.14 + show.flash * 0.1) * (close ? 0.45 : 1);
    this.bloom.radius = close ? 0.18 : 0.4;
    // cinematic lens: streaks and ghosts off the brightest fixtures, the drone's wide lens and speed blur
    const drone = this.rig.droneFx;
    const a = drone.amount;
    const lu = this.lens.uniforms;
    const lensFx = this.quality !== 'low' && this.adaptive.step.lensFx;
    lu.uTime.value = this.ctx.now;
    lu.uTaps.value = lensFx ? (this.quality === 'high' ? 11 : 7) : 0;
    // close on the board the lens stays clean: a desk lamp's ghost smeared over the decks reads as a bug, not as cinema
    lu.uStreak.value = (0.2 + show.flash * 0.25 + show.drop * 0.1) * (close ? 0.15 : 1);
    lu.uGhost.value = !lensFx || close ? 0 : 0.2 * (this.venue?.lensGhost ?? 1);
    // dirt on the front element lights up when a wall of light hits it; stars on the brightest points
    lu.uDirt.value = lensFx && this.bloom.enabled ? 0.5 * (close ? 0.15 : 1) : 0;
    lu.uStarDirs.value = lensFx && !close ? (this.quality === 'high' ? 3 : 2) : 0;
    lu.uStar.value = 0.018;
    // the grade moves with the track: softer through a breakdown, harder at the peak
    this.lens.followShow(show.build, show.peak);
    // a photo filter on top of the room's grade
    if (this.photoFilter) this.lens.applyFilter(this.photoFilter);
    // a cut: dark, switch angle, back up
    const fd = this.fade;
    if (fd.phase === 'out') {
      fd.k = Math.max(0, fd.k - dt / 0.16);
      if (fd.k === 0 && fd.go) {
        fd.go();
        fd.go = null;
        fd.phase = 'in';
      }
    } else if (fd.phase === 'in') {
      fd.k = Math.min(1, fd.k + dt / 0.3);
      if (fd.k === 1) fd.phase = 'none';
    }
    lu.uFade.value = fd.k;
    // auto exposure (the security camera's auto gain pumps harder)
    r.toneMappingExposure = this.baseExposure * (this.exposure.enabled ? this.exposure.exposure : 1);
    this.liftDeckLight(dt);
    // the bloom's threshold is in the scene's light before exposure: when the camera stops down
    // for daylight, raise it to match, or the whole bright sky blooms into a veil over the picture
    // and close on the board only light sources glow (LEDs, pads, screens): lit metal and white caps
    // under the deck light crossed the room's threshold and bloomed into rings and blobs
    this.bloom.threshold = (BLOOM_THRESHOLD * (close ? CLOSE_BLOOM : 1)) / Math.min(1, Math.max(0.05, r.toneMappingExposure));
    // lens looks (looks.ts): the angle's own or the one picked; clean while zoomed in on the board
    const lookId = this.rig.focused ? 'none' : this.rig.shot ? (this.lensPick === 'auto' ? this.shotLook : this.lensPick) : lookFor(this.rig.view === 'custom' ? this.rig.named : this.rig.view, this.lensPick);
    if (lookId !== this.lookId) {
      this.lookId = lookId;
      this.lookHold = 1e9;
      this.lensText.since = this.ctx.now;
    }
    const L = approachLook(this.look, LOOKS[lookId], 1 - Math.exp(-dt * 6));
    this.rig.lensFov = L.fov || null;
    lu.uDistort.value = 0.34 * a + L.distort;
    lu.uCA.value = 0.014 * a + L.ca;
    lu.uBlur.value = a * (0.15 + THREE.MathUtils.clamp((drone.speed - 2.5) / 5, 0, 1) * 0.6);
    // no film grain by default (it read as noise, and sharpening made it worse): only the drone's
    // speed and the looks that are meant to be grainy (VHS, CCTV, night vision) add it
    lu.uGrain.value = (this.quality === 'low' ? 0 : 0.03 * a) + L.grain;
    // crisp: sharpen the board more, the wide shots gently, and more when the render is scaled down
    const scaled = 1 - Math.min(1, this.renderer.getPixelRatio() / Math.min(window.devicePixelRatio || 1, 2));
    lu.uSharpen.value = (L.grain > 0.01 ? 0 : close ? 0.5 : 0.22) + scaled * 0.8;
    lu.uVignette.value = Math.min(1.2, 0.2 + 0.25 * a + L.vignette);
    lu.uFish.value = L.fish < 0.002 ? 0 : L.fish;
    lu.uMono.value = L.mono < 0.002 ? 0 : L.mono;
    lu.uMonoTint.value.setRGB(...L.monoTint);
    lu.uMonoGain.value = L.monoGain;
    lu.uScan.value = L.scan < 0.002 ? 0 : L.scan;
    lu.uVhs.value = L.vhs < 0.002 ? 0 : L.vhs;
    lu.uTilt.value = L.tilt < 0.002 ? 0 : L.tilt;
    lu.uBars.value = L.bars < 0.002 ? 0 : L.bars;
    lu.uSplit.value = L.split;
    lu.uThermal.value = L.thermal < 0.002 ? 0 : L.thermal;
    lu.uSatBoost.value = L.sat;
    if (L.fish > 0) this.fisheyeUniforms();
    this.updateLensText(lookId);
    // the booth light's shadows update at 30 Hz
    r.shadowMap.needsUpdate = this.frame % 2 === 0 || !this.keyLight.shadow.map;
    // live camera feeds (Boiler Room's stream monitor, Alexandra Palace's IMAG towers)
    const feed = venue?.feed;
    if (this.compiling) return;
    if (this.pendingArrival) this.startArrival();
    // a security camera updates a few times a second: hold the last picture in between
    if (L.fps > 0) {
      this.lookHold += dt;
      if (this.lookHold < 1 / L.fps) return;
      this.lookHold = Math.min(this.lookHold - 1 / L.fps, 1 / L.fps);
    }
    // the venue's own off-screen renders (the floor light map)
    venue?.prerender?.(r, dt);
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
    // a photo is drawn at full resolution (at least 1920 px wide), whatever the live frames use
    const photo = !!this.shotWanted;
    if (photo) this.setPixels(Math.min(3, Math.max(this.livePixelRatio(), 1920 / this.size.w)));
    this.composer.render(dt);
    if (photo) {
      // the photo (and any recording) gets the full-size frame before the canvas shrinks back, which clears it
      this.frameDone();
      this.setPixels(this.livePixelRatio());
      return;
    }
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
    this.frameDone();
  }

  /** hand the frame just drawn to the frame hooks and a waiting photo (same task: the drawing buffer is still there) */
  private frameDone(): void {
    for (const fn of this.frameHooks) {
      try {
        fn(this.canvas);
      } catch (err) {
        console.warn('frame hook failed:', err);
      }
    }
    const f = this.shotWanted;
    if (!f) return;
    this.shotWanted = null;
    f(this.canvas);
  }
}
