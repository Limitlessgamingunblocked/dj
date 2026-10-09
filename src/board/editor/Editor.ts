/*
 * The Board Builder's editor (Section 13.3): your board on the workshop
 * bench, built live from its file as you change it.
 *
 *   select      click; shift/ctrl-click adds or removes; shift-drag on an
 *               empty spot draws a box; double-click a group to work inside
 *               it (Esc steps back out)
 *   move        drag a part across the bench, or use the gizmo (move,
 *               rotate, scale), with the snap grid, 15° steps and alignment
 *               guides to the other parts and the centre line
 *   symmetry    whatever you add, move or change on one side happens
 *               mirrored on the other (deck 1 ↔ 2 swapped)
 *   history     every change can be undone and redone
 *
 * Parts here are built from the same catalogue as the playable board, so
 * what you see is what you'll play; they just don't respond to the hand
 * until you press Test.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ControlRegistry } from '../../core/controls';
import { Emitter } from '../../core/emitter';
import type { Progress } from '../../core/models';
import type { EditHook, Stage } from '../../three/Stage';
import type { Part, PartCtx } from '../../three/parts';
import { TABLE_Y } from '../../three/venues/fixtures';
import { buildBooth, type BuiltBooth } from '../booth';
import { buildComponent, defOf } from '../catalog';
import type { BoardComponent, BoardFile, Booth, Vec3 } from '../format';
import { NO_HOOKS } from '../hooks';
import type { BoardLibrary } from '../library';
import { walkComponents } from '../logic';
import { updateBoardUniforms } from '../materials';
import { make, newId } from '../templates';
import { History } from './history';
import * as ops from './ops';

export interface EditorHost {
  stage: Stage;
  reg: ControlRegistry;
  library: BoardLibrary;
  progress(): Progress;
  /** play this board on the stage (test mode) */
  play(doc: BoardFile): void;
  setVenue(id: string): void;
  venue(): string;
  /** the editor closed: keep `doc` on the stage, or go back to what was there (null) */
  closed(doc: BoardFile | null): void;
  /** the kick, for animated materials while you build */
  kick(): number;
}

export type Tool = 'move' | 'rotate' | 'scale';
export type EditorEvents = { doc: void; selection: void; mode: void; drag: void };

const ACCENT = new THREE.Color('#3ad7ff');
const PRIMARY = new THREE.Color('#ff2e88');
const DEG = Math.PI / 180;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

interface DragState {
  kind: 'move' | 'box' | 'pending';
  id: string | null;
  sx: number;
  sy: number;
  moved: boolean;
  /** pressed on a part already selected, with shift: toggles it off if it doesn't move */
  toggleOff: boolean;
  planeY: number;
  start: THREE.Vector3;
  items: { id: string; obj: THREE.Object3D; world: THREE.Vector3 }[];
  twins: { id: string; of: string; obj: THREE.Object3D }[];
  others: ops.Box2[];
  selBox: ops.Box2;
  primaryLocal: THREE.Vector3;
}

export class BoardEditor implements EditHook {
  doc: BoardFile;
  readonly changed = new Emitter<EditorEvents>();
  /** selected component ids; the last is the one the inspector shows */
  selection: string[] = [];
  /** the group you've stepped into (double-click), or null for the whole board */
  context: string | null = null;
  tool: Tool = 'move';
  /** snap grid, metres (0 = off) */
  grid = 0.005;
  angleSnap = true;
  symmetry = false;
  /** box select with a plain drag (for touch screens) */
  boxTool = false;
  /**
   * Precise tools: the move / turn / size gizmo and exact numbers. Off, you
   * just drag parts across the bench and turn them in 15° steps, which is
   * all most boards need.
   */
  precise = false;
  /** show the booth table you've designed instead of the workbench */
  boothPreview = false;
  mode: 'build' | 'test' = 'build';
  dirty = false;
  /** how much of the stage the builder's panels cover, pixels (framing keeps the board in the clear part) */
  insets = { left: 0, right: 0, top: 0 };
  readonly root = new THREE.Group();
  private objects = new Map<string, THREE.Object3D>();
  private parts: Part[] = [];
  private ticks: ((c: PartCtx) => void)[] = [];
  private booth: BuiltBooth | null = null;
  private history = new History();
  private tc: TransformControls;
  private pivot = new THREE.Object3D();
  private gizmoStart: { pivot: THREE.Matrix4; items: { id: string; obj: THREE.Object3D; world: THREE.Matrix4 }[] } | null = null;
  private outlines: THREE.Box3Helper[] = [];
  /** the part under the mouse, lightly outlined */
  private hoverId: string | null = null;
  private hoverBox: THREE.Box3Helper | null = null;
  private guideLines: THREE.LineSegments;
  private centreLine: THREE.Line;
  private drag: DragState | null = null;
  private press: { x: number; y: number; t: number } | null = null;
  private lastDown = { id: '', t: 0 };
  private rubber: HTMLElement;
  private clipboard: BoardComponent[] = [];
  private raycaster = new THREE.Raycaster();
  private disposers: (() => void)[] = [];
  private open = false;

  constructor(
    private host: EditorHost,
    doc: BoardFile,
  ) {
    this.doc = structuredClone(doc);
    const st = host.stage;
    this.tc = new TransformControls(st.camera, st.canvas);
    this.tc.setSize(0.65);
    this.tc.addEventListener('dragging-changed', (e) => {
      st.rig.controls.enabled = !e.value;
      if (e.value) this.gizmoDown();
      else this.gizmoUp();
    });
    this.tc.addEventListener('objectChange', () => this.gizmoMove());
    const gm = new THREE.LineBasicMaterial({ color: '#ffd23f', depthTest: false, transparent: true });
    this.guideLines = new THREE.LineSegments(new THREE.BufferGeometry(), gm);
    this.guideLines.renderOrder = 999;
    this.guideLines.frustumCulled = false;
    const cg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.0015, -0.6), new THREE.Vector3(0, 0.0015, 0.6)]);
    this.centreLine = new THREE.Line(cg, new THREE.LineDashedMaterial({ color: '#ff2e88', dashSize: 0.02, gapSize: 0.012, transparent: true, opacity: 0.7 }));
    this.centreLine.computeLineDistances();
    this.centreLine.visible = false;
    this.rubber = document.createElement('div');
    this.rubber.className = 'bb-rubber';
    this.rubber.hidden = true;
  }

  /* ------------------------------------------------------------------ */
  /* open and close                                                       */
  /* ------------------------------------------------------------------ */

  /** take over the stage: the editor's own copy of the board on the bench */
  start(): void {
    if (this.open) return;
    this.open = true;
    const st = this.host.stage;
    st.scene.add(this.root, this.pivot, this.tc.getHelper());
    this.root.add(this.guideLines, this.centreLine);
    st.el.append(this.rubber);
    this.enterBuild();
    this.rebuild();
    this.frame('all', true);
    const up = (e: PointerEvent) => this.pointerUpAnywhere(e);
    st.canvas.addEventListener('pointerup', up);
    const key = (e: KeyboardEvent) => this.key(e);
    window.addEventListener('keydown', key, true);
    this.disposers.push(
      () => st.canvas.removeEventListener('pointerup', up),
      () => window.removeEventListener('keydown', key, true),
    );
  }

  private enterBuild(): void {
    const st = this.host.stage;
    this.mode = 'build';
    st.editor = this;
    st.hideBoard = true;
    this.root.visible = true;
    st.previewBooth(this.boothPreview);
    this.placeRoot();
    this.attachGizmo();
    this.changed.emit('mode', undefined);
  }

  /** play the board for real, here in the workshop (or a venue, from the test bar) */
  test(): void {
    if (this.mode === 'test') return;
    const st = this.host.stage;
    this.mode = 'test';
    st.editor = null;
    st.hideBoard = false;
    this.root.visible = false;
    this.tc.detach();
    this.updateOutlines();
    st.previewBooth(null);
    this.host.play(this.doc);
    this.changed.emit('mode', undefined);
  }

  /** back from test mode to building */
  back(): void {
    if (this.mode === 'build') return;
    if (this.host.venue() !== 'workshop') this.host.setVenue('workshop');
    this.enterBuild();
  }

  /** leave the builder: keep the board (it goes on the stage) or not */
  close(keep: boolean): void {
    if (!this.open) return;
    this.open = false;
    const st = this.host.stage;
    st.editor = null;
    st.hideBoard = false;
    st.rig.controls.enabled = true;
    st.previewBooth(null);
    this.tc.detach();
    this.tc.dispose();
    st.scene.remove(this.root, this.pivot, this.tc.getHelper());
    this.clearBuilt();
    for (const o of this.outlines) o.removeFromParent();
    this.hoverBox?.removeFromParent();
    this.rubber.remove();
    for (const d of this.disposers) d();
    this.disposers = [];
    this.host.closed(keep ? this.doc : null);
  }

  get stage(): Stage {
    return this.host.stage;
  }

  /** while testing: the playing board picks up changes made to the file (a new macro) */
  replay(): void {
    if (this.mode === 'test') this.host.play(this.doc);
  }

  /* ------------------------------------------------------------------ */
  /* building the copy on the bench                                       */
  /* ------------------------------------------------------------------ */

  /** the board sits on the workbench, or on its own table when you preview the booth */
  private placeRoot(): void {
    const b = this.doc.booth;
    this.root.position.set(0, this.boothPreview && b.table !== 'none' ? b.height + b.riser : TABLE_Y, 0);
  }

  private clearBuilt(): void {
    for (const o of [...this.root.children]) {
      if (o === this.guideLines || o === this.centreLine) continue;
      o.removeFromParent();
      disposeTree(o);
    }
    this.objects.clear();
    this.parts = [];
    this.ticks = [];
    this.booth = null;
  }

  /** build everything from the file again */
  rebuild(): void {
    this.clearBuilt();
    const env = { reg: this.host.reg, hooks: NO_HOOKS };
    for (const c of this.doc.components) {
      const o = buildComponent(c, env, this.parts, this.ticks);
      if (o) this.root.add(o);
    }
    this.root.traverse((o) => {
      if (o.userData.compRoot) this.objects.set(o.userData.componentId as string, o);
    });
    if (this.boothPreview && this.doc.booth.table !== 'none') {
      this.booth = buildBooth(this.doc.booth);
      this.booth.group.position.y = -(this.doc.booth.height + this.doc.booth.riser);
      this.booth.group.userData.booth = true;
      this.root.add(this.booth.group);
    }
    this.placeRoot();
    this.root.updateMatrixWorld(true);
    // a selection that no longer exists goes
    this.selection = this.selection.filter((id) => this.objects.has(id) || ops.find(this.doc, id));
    if (this.context && !ops.find(this.doc, this.context)) this.context = null;
    this.attachGizmo();
  }

  /** per frame while the editor is open */
  update(dt: number): void {
    if (!this.open || this.mode !== 'build') return;
    const kick = this.host.kick();
    updateBoardUniforms(dt, kick, 0);
    const ctx = this.host.stage.partContext;
    for (const p of this.parts) p.update(ctx);
    for (const t of this.ticks) t(ctx);
    this.booth?.update(dt, kick, 0.5);
    this.updateOutlines();
    this.centreLine.visible = this.symmetry;
  }

  /* ------------------------------------------------------------------ */
  /* changes                                                              */
  /* ------------------------------------------------------------------ */

  /** make a change: recorded for undo, then rebuilt */
  edit(label: string, fn: (doc: BoardFile) => void, rebuild = true): void {
    const before = JSON.stringify(this.doc);
    fn(this.doc);
    const after = JSON.stringify(this.doc);
    if (after === before) return;
    this.history.record(before, label);
    this.dirty = true;
    if (rebuild) this.rebuild();
    this.changed.emit('doc', undefined);
  }

  undo(): void {
    const s = this.history.undo(JSON.stringify(this.doc));
    if (!s) return;
    this.doc = JSON.parse(s.state) as BoardFile;
    this.dirty = true;
    this.rebuild();
    this.changed.emit('doc', undefined);
    this.changed.emit('selection', undefined);
  }

  redo(): void {
    const s = this.history.redo(JSON.stringify(this.doc));
    if (!s) return;
    this.doc = JSON.parse(s.state) as BoardFile;
    this.dirty = true;
    this.rebuild();
    this.changed.emit('doc', undefined);
    this.changed.emit('selection', undefined);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }
  get undoLabel(): string {
    return this.history.undoLabel;
  }
  get redoLabel(): string {
    return this.history.redoLabel;
  }

  /** start again from another board (a template, a gallery board, a random one) */
  load(doc: BoardFile, keepHistory = true): void {
    if (keepHistory) this.history.record(JSON.stringify(this.doc), 'New board');
    else this.history.clear();
    this.doc = structuredClone(doc);
    this.selection = [];
    this.context = null;
    this.dirty = keepHistory;
    this.rebuild();
    this.frame('all');
    this.changed.emit('doc', undefined);
    this.changed.emit('selection', undefined);
  }

  /** the list the current context adds to and selects from */
  private levelList(): BoardComponent[] {
    return this.context ? (ops.find(this.doc, this.context)?.c.children ?? this.doc.components) : this.doc.components;
  }

  /** add a part: at `at` (board space), or somewhere free in front of you */
  add(type: string, at?: Vec3): string | null {
    const def = defOf(type);
    if (!def) return null;
    const pos = at ?? this.freeSpot();
    const c = make(type, [r4(pos[0]), r4(pos[1]), r4(pos[2])]);
    let ids = [c.id];
    this.edit(`Add ${def.label}`, (doc) => {
      ops.add(doc, c, this.context);
      if (this.symmetry && Math.abs(c.pos[0]) > 0.004) {
        const twin = ops.freshCopy(c);
        ops.mirrorInPlace(twin);
        ops.add(doc, twin, this.context);
        ids = [c.id, twin.id];
      }
    });
    this.select(ids.slice(0, 1));
    return c.id;
  }

  /** a free spot near the middle of the view, on the bench */
  private freeSpot(): Vec3 {
    const st = this.host.stage;
    this.raycaster.setFromCamera(new THREE.Vector2(0, -0.1), st.camera);
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.root.position.y), new THREE.Vector3());
    const p = hit ? this.root.worldToLocal(hit) : new THREE.Vector3(0, 0, 0.1);
    p.x = THREE.MathUtils.clamp(p.x, -1.1, 1.1);
    p.z = THREE.MathUtils.clamp(p.z, -0.35, 0.35);
    // step aside from anything already right there
    const taken = [...this.objects.values()].map((o) => new THREE.Box3().setFromObject(o));
    const v = new THREE.Vector3();
    for (let i = 0; i < 12 && taken.some((b) => b.containsPoint(this.root.localToWorld(v.copy(p)).setY(b.min.y + 0.001))); i++) p.x += 0.06 * (i % 2 ? -i : i);
    if (this.context) {
      const g = ops.worldMatrix(this.doc, this.context);
      p.applyMatrix4(g.invert());
    }
    return [this.grid ? ops.snap(p.x, this.grid) : p.x, 0, this.grid ? ops.snap(p.z, this.grid) : p.z];
  }

  /** with symmetry on, the selection plus the twins on the other side */
  private withTwins(ids: string[]): string[] {
    if (!this.symmetry) return ids;
    const out = new Set(ids);
    for (const id of ids) {
      const t = ops.twinOf(this.doc, id);
      if (t) out.add(t);
    }
    return [...out];
  }

  remove(ids = this.selection): void {
    if (!ids.length) return;
    const all = this.withTwins(ids);
    this.edit(all.length === 1 ? 'Delete' : `Delete ${all.length} parts`, (doc) => ops.remove(doc, all));
    this.select([]);
  }

  duplicate(): void {
    if (!this.selection.length) return;
    let out: string[] = [];
    this.edit('Duplicate', (doc) => (out = ops.duplicate(doc, this.selection, [this.grid ? Math.max(this.grid, 0.02) : 0.02, 0, this.grid ? Math.max(this.grid, 0.02) : 0.02])));
    this.select(out);
  }

  mirror(): void {
    if (!this.selection.length) return;
    let out: string[] = [];
    this.edit('Mirror', (doc) => (out = ops.mirrorCopy(doc, this.selection)));
    this.select(out);
  }

  array(count: number, step: Vec3): void {
    if (!this.selection.length) return;
    let out: string[] = [];
    this.edit(`Array of ${count}`, (doc) => (out = ops.arrayCopy(doc, this.selection, count, step)));
    this.select([...this.selection, ...out]);
  }

  group(): void {
    if (this.selection.length < 1) return;
    let gid: string | null = null;
    this.edit('Group', (doc) => (gid = ops.group(doc, this.selection, (pos) => make('group', pos, { name: 'Group' }))));
    if (gid) this.select([gid]);
    else this.host.stage.el.dispatchEvent(new CustomEvent('bb-note', { detail: 'Only parts at the same level can be grouped.' }));
  }

  ungroup(): void {
    const id = this.primary;
    if (!id) return;
    const f = ops.find(this.doc, id);
    if (!f || !f.c.children.length) return;
    let kids: string[] = [];
    this.edit('Ungroup', (doc) => (kids = ops.ungroup(doc, id)));
    this.select(kids);
  }

  copy(): void {
    this.clipboard = ops.outermost(this.doc, this.selection).map((id) => structuredClone(ops.find(this.doc, id)!.c));
  }

  paste(): void {
    if (!this.clipboard.length) return;
    const fresh = this.clipboard.map((c) => {
      const x = ops.freshCopy(c);
      x.pos = [x.pos[0] + 0.03, x.pos[1], x.pos[2] + 0.03];
      return x;
    });
    this.edit('Paste', (doc) => fresh.forEach((c) => ops.add(doc, c, this.context)));
    this.select(fresh.map((c) => c.id));
  }

  /** set a property on the selection (with symmetry: on the twins too, except what they control) */
  setProp(path: string, value: unknown, ids = this.selection): void {
    if (!ids.length) return;
    const own = /^(fn|fn2|deck|base)$/.test(path);
    const all = own ? ids : this.withTwins(ids);
    this.edit(`Change ${path.split('.')[0]}`, (doc) => ops.setProp(doc, all, path, value));
  }

  /** move, turn or size one part by numbers (the inspector) */
  setTransform(id: string, t: { pos?: Vec3; rot?: Vec3; scale?: Vec3 }): void {
    this.edit('Move', (doc) => {
      const f = ops.find(doc, id);
      if (!f) return;
      if (t.pos) f.c.pos = t.pos.map(r6) as Vec3;
      if (t.rot) f.c.rot = t.rot.map(r6) as Vec3;
      if (t.scale) f.c.scale = t.scale.map((s) => Math.max(0.05, r6(s))) as Vec3;
      if (this.symmetry) {
        const tw = ops.twinOf(this.doc, id) ? ops.find(doc, ops.twinOf(this.doc, id)!) : null;
        if (tw) {
          tw.c.pos = [-f.c.pos[0], f.c.pos[1], f.c.pos[2]];
          tw.c.rot = [f.c.rot[0], -f.c.rot[1], -f.c.rot[2]];
          tw.c.scale = [...f.c.scale];
        }
      }
    });
  }

  setBooth(patch: Partial<Booth>): void {
    this.edit('Booth', (doc) => Object.assign(doc.booth, patch));
  }

  rename(name: string): void {
    const n = name.trim().slice(0, 60);
    if (n) this.edit('Rename', (doc) => (doc.name = n), false);
  }

  hide(ids: string[], on: boolean): void {
    this.edit(on ? 'Hide' : 'Show', (doc) => ops.setProp(doc, ids, 'hidden', on));
  }

  lock(ids: string[], on: boolean): void {
    this.edit(on ? 'Lock' : 'Unlock', (doc) => ops.setProp(doc, ids, 'locked', on), false);
    this.attachGizmo();
  }

  reorder(id: string, dir: -1 | 1): void {
    this.edit('Reorder', (doc) => ops.reorder(doc, id, dir), false);
  }

  moveTo(id: string, target: { before?: string; parent?: string | null }): void {
    this.edit('Move in the list', (doc) => ops.moveTo(doc, id, target));
  }

  /* ------------------------------------------------------------------ */
  /* selection                                                            */
  /* ------------------------------------------------------------------ */

  get primary(): string | null {
    return this.selection[this.selection.length - 1] ?? null;
  }

  select(ids: string[], add = false): void {
    const next = add ? [...this.selection.filter((x) => !ids.includes(x)), ...ids] : [...ids];
    this.selection = next.filter((id) => !!ops.find(this.doc, id));
    this.attachGizmo();
    this.changed.emit('selection', undefined);
  }

  toggle(id: string): void {
    if (this.selection.includes(id)) this.select(this.selection.filter((x) => x !== id));
    else this.select([id], true);
  }

  selectAll(): void {
    this.select(this.levelList().filter((c) => !c.props.locked && !c.props.hidden).map((c) => c.id));
  }

  selectType(type: string): void {
    this.select(ops.ofType(this.doc, type).filter((id) => !ops.find(this.doc, id)!.c.props.locked));
  }

  /** work inside a group */
  enter(id: string): void {
    const f = ops.find(this.doc, id);
    if (!f || !f.c.children.length) return;
    this.context = id;
    this.select([]);
  }

  exit(): void {
    if (!this.context) return this.select([]);
    const f = ops.find(this.doc, this.context);
    const was = this.context;
    this.context = f?.parent?.id ?? null;
    this.select([was]);
  }

  /** the selection's box on the stage */
  private selectionBox(ids = this.selection): THREE.Box3 {
    const box = new THREE.Box3();
    for (const id of ids) {
      const o = this.objects.get(id);
      if (o) box.expandByObject(o);
    }
    return box;
  }

  /* ------------------------------------------------------------------ */
  /* the camera                                                           */
  /* ------------------------------------------------------------------ */

  /** frame the selection, the whole board, or look straight down */
  frame(what: 'selection' | 'all' | 'top', instant = false): void {
    const st = this.host.stage;
    let box = what === 'selection' && this.selection.length ? this.selectionBox() : new THREE.Box3();
    if (box.isEmpty()) for (const o of this.objects.values()) box.expandByObject(o);
    if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-0.5, this.root.position.y, -0.3), new THREE.Vector3(0.5, this.root.position.y + 0.05, 0.3));
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // fit the part of the stage the panels leave clear
    const w = Math.max(1, st.canvas.clientWidth);
    const h = Math.max(1, st.canvas.clientHeight);
    const freeW = Math.max(0.3, (w - this.insets.left - this.insets.right) / w);
    const freeH = Math.max(0.4, (h - this.insets.top) / h);
    const t = Math.tan((st.camera.fov * Math.PI) / 360);
    const distW = size.x / 2 / (t * st.camera.aspect * freeW);
    const distD = (size.z / 2 + size.y * 0.6) / (t * freeH);
    const dist = Math.max(distW, distD, 0.35) * 1.2;
    const dir = what === 'top' ? new THREE.Vector3(0, 1, 0.02) : new THREE.Vector3(0, 0.8, 0.6);
    // the clear area's middle isn't the screen's: slide the view so the board sits in it
    const shiftX = ((this.insets.right - this.insets.left) / 2 / w) * 2 * t * st.camera.aspect * dist;
    const shiftY = (this.insets.top / 2 / h) * 2 * t * dist;
    c.x += shiftX;
    c.z -= shiftY * 0.8;
    // a wide board would put the camera through the workshop ceiling: come in lower and further back instead
    const room = st.rig.room;
    const pos = room ? room.clampPoint(ops.underCeiling(c, dir, dist, room.max.y - 0.15, what === 'top'), new THREE.Vector3()) : c.clone().addScaledVector(dir.normalize(), dist);
    st.rig.goToAnchor({ name: 'builder', pos: pos.toArray() as Vec3, target: c.toArray() as Vec3 });
    if (instant) {
      st.camera.position.copy(pos);
      st.rig.controls.target.copy(c);
      st.rig.controls.update();
    }
  }

  /* ------------------------------------------------------------------ */
  /* picking                                                              */
  /* ------------------------------------------------------------------ */

  /** the part under the pointer, at the level you're working on */
  private pickId(ray: THREE.Ray): { id: string; point: THREE.Vector3 } | null {
    this.raycaster.ray.copy(ray);
    const hits = this.raycaster.intersectObjects([...this.objects.values()].filter((o) => o.parent === this.root || !!o.parent), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      let visible = true;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) visible = false;
      if (!visible) continue;
      while (o && !o.userData.compRoot) o = o.parent;
      if (!o) continue;
      const id = o.userData.componentId as string;
      const chain = [...ops.ancestors(this.doc, id), id];
      let pick = chain[0];
      if (this.context) {
        const i = chain.indexOf(this.context);
        if (i >= 0) pick = chain[i + 1] ?? id;
        else this.context = null;
      }
      const f = ops.find(this.doc, pick);
      if (!f || f.c.props.locked) continue;
      return { id: pick, point: h.point.clone() };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* the pointer (Stage.editor)                                           */
  /* ------------------------------------------------------------------ */

  down(e: PointerEvent, ray: THREE.Ray): boolean {
    if (this.mode !== 'build') return false;
    // the gizmo under the pointer: it takes the press
    const r = this.host.stage.canvas.getBoundingClientRect();
    const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, button: e.button };
    if (this.tc.object) {
      (this.tc as unknown as { pointerHover(p: { x: number; y: number; button: number }): void }).pointerHover(ndc);
      if (this.tc.axis) return false;
    }
    if (e.button !== 0) return false;
    const hit = this.pickId(ray);
    this.press = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (!hit) {
      if (e.shiftKey || this.boxTool) {
        this.drag = this.newDrag('box', null, e, 0);
        return true;
      }
      return false; // the camera orbits
    }
    const now = performance.now();
    // double-click a group: step inside it
    if (this.lastDown.id === hit.id && now - this.lastDown.t < 320) {
      this.lastDown = { id: '', t: 0 };
      const f = ops.find(this.doc, hit.id);
      if (f && f.c.children.length) {
        this.enter(hit.id);
        return true;
      }
    }
    this.lastDown = { id: hit.id, t: now };
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    let toggleOff = false;
    if (multi) {
      if (this.selection.includes(hit.id)) toggleOff = true;
      else this.select([hit.id], true);
    } else if (!this.selection.includes(hit.id)) this.select([hit.id]);
    this.drag = this.newDrag('pending', hit.id, e, hit.point.y);
    this.drag.toggleOff = toggleOff;
    this.drag.start.copy(hit.point);
    return true;
  }

  private newDrag(kind: DragState['kind'], id: string | null, e: PointerEvent, planeY: number): DragState {
    return { kind, id, sx: e.clientX, sy: e.clientY, moved: false, toggleOff: false, planeY, start: new THREE.Vector3(), items: [], twins: [], others: [], selBox: { x0: 0, x1: 0, z0: 0, z1: 0 }, primaryLocal: new THREE.Vector3() };
  }

  /** a drag on parts starts once the pointer has really moved */
  private beginMove(d: DragState): void {
    d.kind = 'move';
    const ids = ops.outermost(this.doc, this.selection);
    d.items = ids.flatMap((id) => {
      const obj = this.objects.get(id);
      return obj ? [{ id, obj, world: obj.getWorldPosition(new THREE.Vector3()) }] : [];
    });
    const moving = new Set(ids);
    if (this.symmetry)
      for (const id of ids) {
        const t = ops.twinOf(this.doc, id);
        const obj = t ? this.objects.get(t) : null;
        if (t && obj && !moving.has(t)) {
          d.twins.push({ id: t, of: id, obj });
          moving.add(t);
        }
      }
    // the other parts at this level, for the alignment guides (board space)
    const toBoard = (b: THREE.Box3): ops.Box2 => {
      const a = this.root.worldToLocal(b.min.clone());
      const c = this.root.worldToLocal(b.max.clone());
      return { x0: a.x, x1: c.x, z0: a.z, z1: c.z };
    };
    d.others = this.levelList()
      .filter((c) => !moving.has(c.id))
      .flatMap((c) => {
        const o = this.objects.get(c.id);
        return o ? [toBoard(new THREE.Box3().setFromObject(o))] : [];
      });
    d.selBox = toBoard(this.selectionBox(ids));
    const p = d.items.find((x) => x.id === this.primary) ?? d.items[0];
    d.primaryLocal = p ? this.root.worldToLocal(p.world.clone()) : new THREE.Vector3();
  }

  move(e: PointerEvent, ray: THREE.Ray): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    if (d.kind === 'box') return this.rubberTo(d, e);
    if (d.kind === 'pending') this.beginMove(d);
    const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -d.planeY), new THREE.Vector3());
    if (!hit) return;
    const delta = hit.sub(d.start);
    // the grid snaps the main part's spot; guides line its box up with its neighbours
    let target = d.primaryLocal.clone().add(delta);
    if (this.grid) target.set(ops.snap(target.x, this.grid), target.y, ops.snap(target.z, this.grid));
    let dx = target.x - d.primaryLocal.x;
    let dz = target.z - d.primaryLocal.z;
    const moved = { x0: d.selBox.x0 + dx, x1: d.selBox.x1 + dx, z0: d.selBox.z0 + dz, z1: d.selBox.z1 + dz };
    const a = e.altKey ? { dx: 0, dz: 0, guides: [] } : ops.align(moved, d.others, 0.003);
    dx += a.dx;
    dz += a.dz;
    this.showGuides(a.guides);
    target = new THREE.Vector3(dx, 0, dz);
    for (const it of d.items) {
      const w = it.world.clone().add(target);
      it.obj.position.copy(it.obj.parent!.worldToLocal(w));
    }
    for (const t of d.twins) {
      const src = d.items.find((x) => x.id === t.of)?.obj;
      if (src) t.obj.position.set(-src.position.x, src.position.y, src.position.z);
    }
    this.placePivot();
    this.changed.emit('drag', undefined);
  }

  up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.showGuides([]);
    if (!d) return;
    if (d.kind === 'box') {
      this.rubber.hidden = true;
      if (d.moved) this.boxSelect(d, e, e.shiftKey);
      else if (!e.shiftKey) this.select([]);
      return;
    }
    if (d.kind === 'pending') {
      // a click: shift-click on a selected part takes it off
      if (d.toggleOff && d.id) this.select(this.selection.filter((x) => x !== d.id));
      else if (d.id && !(e.shiftKey || e.ctrlKey || e.metaKey)) this.select([d.id]);
      return;
    }
    this.commitObjects([...d.items.map((x) => x.id), ...d.twins.map((x) => x.id)], 'Move');
  }

  hover(_e: PointerEvent, ray: THREE.Ray): void {
    if (this.mode !== 'build') return;
    const hit = this.pickId(ray);
    this.hoverId = hit && !this.selection.includes(hit.id) ? hit.id : null;
    this.host.stage.canvas.style.cursor = hit ? (this.selection.includes(hit.id) ? 'move' : 'pointer') : this.boxTool ? 'crosshair' : 'grab';
  }

  /** a click on an empty spot (the camera had the press) clears the selection */
  private pointerUpAnywhere(e: PointerEvent): void {
    const p = this.press;
    this.press = null;
    if (!p || this.mode !== 'build' || this.drag) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5 && performance.now() - p.t < 450 && !this.tc.dragging && !e.shiftKey) {
      // only if nothing was hit (a part press is handled in up())
      const st = this.host.stage;
      const r = st.canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), st.camera);
      if (!this.pickId(this.raycaster.ray)) {
        if (this.context) this.context = null;
        this.select([]);
      }
    }
  }

  private rubberTo(d: DragState, e: PointerEvent): void {
    const r = this.host.stage.el.getBoundingClientRect();
    const x0 = Math.min(d.sx, e.clientX) - r.left;
    const y0 = Math.min(d.sy, e.clientY) - r.top;
    Object.assign(this.rubber.style, { left: `${x0}px`, top: `${y0}px`, width: `${Math.abs(e.clientX - d.sx)}px`, height: `${Math.abs(e.clientY - d.sy)}px` });
    this.rubber.hidden = false;
  }

  /** everything at this level whose middle is inside the box */
  private boxSelect(d: DragState, e: PointerEvent, add: boolean): void {
    const st = this.host.stage;
    const r = st.canvas.getBoundingClientRect();
    const x0 = Math.min(d.sx, e.clientX);
    const x1 = Math.max(d.sx, e.clientX);
    const y0 = Math.min(d.sy, e.clientY);
    const y1 = Math.max(d.sy, e.clientY);
    const v = new THREE.Vector3();
    const ids = this.levelList()
      .filter((c) => !c.props.locked && !c.props.hidden)
      .filter((c) => {
        const o = this.objects.get(c.id);
        if (!o) return false;
        new THREE.Box3().setFromObject(o).getCenter(v).project(st.camera);
        const sx = r.left + ((v.x + 1) / 2) * r.width;
        const sy = r.top + ((1 - v.y) / 2) * r.height;
        return v.z < 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      })
      .map((c) => c.id);
    this.select(ids, add);
  }

  /** write parts' positions on the stage back into the file */
  private commitObjects(ids: string[], label: string): void {
    this.edit(
      label,
      (doc) => {
        for (const id of ids) {
          const f = ops.find(doc, id);
          const o = this.objects.get(id);
          if (!f || !o) continue;
          f.c.pos = [r6(o.position.x), r6(o.position.y), r6(o.position.z)];
          f.c.rot = [r6(o.rotation.x), r6(o.rotation.y), r6(o.rotation.z)];
          f.c.scale = [r6(o.scale.x), r6(o.scale.y), r6(o.scale.z)];
        }
      },
      false,
    );
    this.placePivot();
  }

  private showGuides(gs: ops.Guide[]): void {
    const pts: number[] = [];
    const y = this.selectionBox().max.y - this.root.position.y + 0.002;
    for (const g of gs) {
      if (g.axis === 'x') pts.push(g.at, y, g.from, g.at, y, g.to);
      else pts.push(g.from, y, g.at, g.to, y, g.at);
    }
    const geo = this.guideLines.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.computeBoundingSphere();
    this.guideLines.visible = pts.length > 0;
  }

  /* ------------------------------------------------------------------ */
  /* the gizmo                                                            */
  /* ------------------------------------------------------------------ */

  setTool(t: Tool): void {
    this.tool = t;
    this.attachGizmo();
    this.changed.emit('mode', undefined);
  }

  setGrid(step: number): void {
    this.grid = step;
    this.attachGizmo();
    this.changed.emit('mode', undefined);
  }

  setPrecise(on: boolean): void {
    this.precise = on;
    this.attachGizmo();
    this.changed.emit('mode', undefined);
  }

  /** turn the selection round the vertical, each part on its own spot (twins turn the other way) */
  turn(deg: number): void {
    const ids = ops.outermost(this.doc, this.selection);
    if (!ids.length) return;
    const sel = new Set(ids);
    const all = this.withTwins(ids);
    this.edit('Turn', (doc) => {
      for (const id of all) {
        const f = ops.find(doc, id);
        if (!f) continue;
        const d = (sel.has(id) ? deg : -deg) * DEG;
        let y = f.c.rot[1] + d;
        // tidy: whole steps stay whole, and the angle stays within a turn
        y = Math.round(y / (DEG * 0.5)) * DEG * 0.5;
        y = Math.atan2(Math.sin(y), Math.cos(y));
        f.c.rot = [f.c.rot[0], r6(y), f.c.rot[2]];
      }
    });
  }

  /** make the selection bigger or smaller, all sides alike */
  setSize(k: number, ids = this.selection): void {
    const all = this.withTwins(ops.outermost(this.doc, ids));
    const s = Math.max(0.2, Math.min(6, k));
    this.edit('Resize', (doc) => {
      for (const id of all) {
        const f = ops.find(doc, id);
        if (f) f.c.scale = [r6(s), r6(s), r6(s)];
      }
    });
  }

  /** where the selection is on screen (the floating bar sits by it), or null */
  selectionScreen(): { x: number; y: number } | null {
    const box = this.selectionBox(ops.outermost(this.doc, this.selection));
    if (box.isEmpty()) return null;
    const st = this.host.stage;
    const r = st.canvas.getBoundingClientRect();
    const v = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, box.max.z).project(st.camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
  }

  /** put the gizmo on the selection (not on locked parts, not while testing) */
  private attachGizmo(): void {
    const ids = this.selection.filter((id) => !ops.find(this.doc, id)?.c.props.locked && this.objects.has(id));
    if (!this.open || this.mode !== 'build' || !ids.length || !this.precise) {
      this.tc.detach();
      return;
    }
    this.tc.setMode(this.tool === 'move' ? 'translate' : this.tool === 'rotate' ? 'rotate' : 'scale');
    // parts slide across the bench: no up arrow standing in the way of grabbing them (Page Up/Down raise them)
    this.tc.showY = this.tool !== 'move';
    this.tc.setTranslationSnap(this.grid || null);
    this.tc.setRotationSnap(this.angleSnap ? 15 * DEG : null);
    this.tc.setScaleSnap(this.grid ? 0.05 : null);
    this.tc.setSpace(ids.length === 1 && this.tool !== 'move' ? 'local' : 'world');
    // turning happens round the vertical on a flat board; tilting is there with the other rings
    this.placePivot();
    this.tc.attach(this.pivot);
  }

  private placePivot(): void {
    const ids = ops.outermost(this.doc, this.selection);
    if (!ids.length) return;
    if (ids.length === 1) {
      const o = this.objects.get(ids[0]);
      if (!o) return;
      o.updateMatrixWorld(true);
      o.matrixWorld.decompose(this.pivot.position, this.pivot.quaternion, this.pivot.scale);
    } else {
      this.selectionBox(ids).getCenter(this.pivot.position);
      this.pivot.quaternion.identity();
      this.pivot.scale.set(1, 1, 1);
    }
    this.pivot.updateMatrixWorld(true);
  }

  private gizmoDown(): void {
    this.pivot.updateMatrixWorld(true);
    const ids = ops.outermost(this.doc, this.selection);
    this.gizmoStart = {
      pivot: this.pivot.matrixWorld.clone(),
      items: ids.flatMap((id) => {
        const obj = this.objects.get(id);
        if (!obj) return [];
        obj.updateMatrixWorld(true);
        return [{ id, obj, world: obj.matrixWorld.clone() }];
      }),
    };
  }

  private gizmoMove(): void {
    const g = this.gizmoStart;
    if (!g) return;
    this.pivot.updateMatrixWorld(true);
    const delta = this.pivot.matrixWorld.clone().multiply(g.pivot.clone().invert());
    for (const it of g.items) {
      const world = delta.clone().multiply(it.world);
      const local = it.obj.parent!.matrixWorld.clone().invert().multiply(world);
      local.decompose(it.obj.position, it.obj.quaternion, it.obj.scale);
      if (this.symmetry) {
        const tid = ops.twinOf(this.doc, it.id);
        const t = tid && !g.items.some((x) => x.id === tid) ? this.objects.get(tid) : null;
        if (t) {
          t.position.set(-it.obj.position.x, it.obj.position.y, it.obj.position.z);
          t.rotation.set(it.obj.rotation.x, -it.obj.rotation.y, -it.obj.rotation.z);
          t.scale.copy(it.obj.scale);
        }
      }
    }
    this.changed.emit('drag', undefined);
  }

  private gizmoUp(): void {
    const g = this.gizmoStart;
    this.gizmoStart = null;
    if (!g) return;
    const ids = g.items.map((x) => x.id);
    if (this.symmetry) for (const id of [...ids]) {
      const t = ops.twinOf(this.doc, id);
      if (t && !ids.includes(t)) ids.push(t);
    }
    this.commitObjects(ids, this.tool === 'move' ? 'Move' : this.tool === 'rotate' ? 'Turn' : 'Resize');
  }

  /* ------------------------------------------------------------------ */
  /* outlines                                                             */
  /* ------------------------------------------------------------------ */

  private updateOutlines(): void {
    if (!this.hoverBox) {
      this.hoverBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#ffffff'));
      const m = this.hoverBox.material as THREE.LineBasicMaterial;
      m.transparent = true;
      m.opacity = 0.35;
      m.depthTest = false;
      this.hoverBox.renderOrder = 997;
      this.host.stage.scene.add(this.hoverBox);
    }
    const hov = this.mode === 'build' && this.hoverId ? this.objects.get(this.hoverId) : null;
    this.hoverBox.visible = !!hov;
    if (hov) this.hoverBox.box.setFromObject(hov).expandByScalar(0.002);
    const ids = this.mode === 'build' ? this.selection.filter((id) => this.objects.has(id)) : [];
    while (this.outlines.length < ids.length) {
      const b = new THREE.Box3Helper(new THREE.Box3(), ACCENT.clone());
      (b.material as THREE.LineBasicMaterial).depthTest = false;
      (b.material as THREE.LineBasicMaterial).transparent = true;
      b.renderOrder = 998;
      this.host.stage.scene.add(b);
      this.outlines.push(b);
    }
    this.outlines.forEach((b, i) => {
      const id = ids[i];
      b.visible = !!id;
      if (!id) return;
      b.box.setFromObject(this.objects.get(id)!).expandByScalar(0.003);
      (b.material as THREE.LineBasicMaterial).color.copy(id === this.primary ? PRIMARY : ACCENT);
    });
  }

  /** hide the editor's helpers for a clean picture (the thumbnail) */
  helpers(on: boolean): void {
    this.tc.getHelper().visible = on;
    if (this.hoverBox) this.hoverBox.visible = false;
    for (const b of this.outlines) b.visible = on && b.visible;
    this.guideLines.visible = false;
    this.centreLine.visible = on && this.symmetry;
  }

  /* ------------------------------------------------------------------ */
  /* the keyboard                                                         */
  /* ------------------------------------------------------------------ */

  private key(e: KeyboardEvent): void {
    if (!this.open || this.mode !== 'build') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.body.classList.contains('modal-open')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    let done = true;
    if (mod && k === 'z' && !e.shiftKey) this.undo();
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) this.redo();
    else if (mod && k === 'd') this.duplicate();
    else if (mod && k === 'g' && e.shiftKey) this.ungroup();
    else if (mod && k === 'g') this.group();
    else if (mod && k === 'a') this.selectAll();
    else if (mod && k === 'c') this.copy();
    else if (mod && k === 'v') this.paste();
    else if (mod) done = false;
    else if (k === 'delete' || k === 'backspace') this.remove();
    else if (k === 'escape') this.exit();
    else if (this.precise && (k === 'w' || k === 'g')) this.setTool('move');
    else if (this.precise && k === 'e') this.setTool('rotate');
    else if (this.precise && k === 's') this.setTool('scale');
    else if (k === 'r' || k === ']') this.turn(e.shiftKey ? -15 : 15);
    else if (k === '[') this.turn(-15);
    else if (k === 'm') this.mirror();
    else if (k === 'f') this.frame(this.selection.length ? 'selection' : 'all');
    else if (k === 'h' && this.selection.length) this.hide(this.selection, true);
    else if (k === 'l' && this.selection.length) this.lock(this.selection, true);
    else if (k.startsWith('arrow') || k === 'pageup' || k === 'pagedown') this.nudge(k, e.shiftKey);
    else done = false;
    if (done) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  /** arrows move the selection a grid step (shift: ten); page up and down raise and lower it */
  private nudge(k: string, big: boolean): void {
    if (!this.selection.length) return;
    const step = (this.grid || 0.001) * (big ? 10 : 1);
    const d: Vec3 = k === 'arrowleft' ? [-step, 0, 0] : k === 'arrowright' ? [step, 0, 0] : k === 'arrowup' ? [0, 0, -step] : k === 'arrowdown' ? [0, 0, step] : k === 'pageup' ? [0, 0.001 * (big ? 10 : 1), 0] : [0, -0.001 * (big ? 10 : 1), 0];
    const ids = this.withTwins(ops.outermost(this.doc, this.selection));
    const sel = new Set(ops.outermost(this.doc, this.selection));
    this.edit('Nudge', (doc) => {
      for (const id of ids) {
        const f = ops.find(doc, id);
        if (!f) continue;
        const mirrored = !sel.has(id);
        f.c.pos = [r6(f.c.pos[0] + (mirrored ? -d[0] : d[0])), r6(f.c.pos[1] + d[1]), r6(f.c.pos[2] + d[2])];
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* saving                                                               */
  /* ------------------------------------------------------------------ */

  /** a small picture of the board for the gallery (the editor's helpers hidden) */
  async thumbnail(): Promise<Blob | null> {
    this.helpers(false);
    try {
      const png = await this.host.stage.snapshot();
      if (!png) return null;
      const bmp = await createImageBitmap(png);
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      const g = c.getContext('2d')!;
      const k = Math.max(c.width / bmp.width, c.height / bmp.height);
      g.drawImage(bmp, (c.width - bmp.width * k) / 2, (c.height - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
      bmp.close();
      return await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.8));
    } finally {
      this.helpers(true);
    }
  }

  async save(): Promise<void> {
    const thumb = await this.thumbnail().catch(() => null);
    await this.host.library.save(this.doc, { thumb });
    this.dirty = false;
    this.changed.emit('doc', undefined);
  }

  /** every component, flat, with its depth (the layers panel) */
  flat(): { c: BoardComponent; depth: number; parent: string | null }[] {
    const out: { c: BoardComponent; depth: number; parent: string | null }[] = [];
    const walk = (list: BoardComponent[], depth: number, parent: string | null) => {
      for (const c of list) {
        out.push({ c, depth, parent });
        walk(c.children, depth + 1, c.id);
      }
    };
    walk(this.doc.components, 0, null);
    return out;
  }

  partCount(): number {
    let n = 0;
    walkComponents(this.doc.components, () => n++);
    return n;
  }

  /** a fresh board id (Save as new) */
  fork(name: string): void {
    this.doc = { ...this.doc, id: this.host.library.newId(), name: name.slice(0, 60), created: new Date().toISOString() };
    this.dirty = true;
    this.changed.emit('doc', undefined);
  }
}

/** free a built part's geometry and its own materials (shared board materials stay cached) */
function disposeTree(o: THREE.Object3D): void {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh && !(x as THREE.Line).isLine && !(x as THREE.Points).isPoints) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mm of mats) {
      if (mm.userData?.boardShared) continue;
      const map = (mm as THREE.MeshStandardMaterial).map;
      if (map && !map.userData?.shared) map.dispose();
      mm.dispose();
    }
  });
}

export { newId };
