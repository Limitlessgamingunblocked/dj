/*
 * The character creator and wardrobe (Section 4), in the dressing room
 * backstage (three/venues/dressingroom.ts): your character stands in the
 * middle grooving to the set next door, the panel on the left edits them.
 *
 *   tabs       Body · Face · Eyes · Skin · Hair · Makeup & art · Outfit ·
 *              Moves (DJ personality) · Wardrobe (saved looks, every item)
 *   lights     Dressing room / Club strobe / Daylight terrace / UV blacklight
 *   camera     full body, face close-up, turn (or auto-turn), zoom; dragging
 *              the room orbits, the wheel zooms
 *   tools      randomise everything or one tab, undo / redo, reset a tab,
 *              name the look, save it as a new look
 *
 * Every change saves straight away (Section 16.4: autosave after every
 * creator change) into the look you're wearing. Sliders show live while
 * dragged and land in the undo history when let go.
 */
import * as THREE from 'three';
import { wallThump, type WallThump } from '../audio/sfx';
import type { AvatarInput } from '../character/Avatar';
import {
  BROW_SLITS,
  BROWS,
  EYE_COLORS,
  EYELINER,
  FACE_PAINT,
  FACIAL_HAIR,
  HAIR,
  HAIR_FINISHES,
  IRIS_STYLES,
  ITEMS,
  MATERIALS,
  NATURAL_HAIR,
  OPTION_LABEL,
  OPTIONS,
  OUTFIT_SETS,
  PATTERNS,
  PIERCINGS,
  SKIN_TONES,
  SLIDERS,
  SLOT_LABEL,
  SLOTS,
  TATTOO_PLACES,
  TATTOOS,
  VENUE_VIBES,
  WILD_HAIR,
  type ItemDef,
  type Slot,
  type Unlock,
  type Vibe,
} from '../character/catalog';
import { cloneLook, dressCodeBonus, LookHistory, option, owned, randomize, resetCategory, slider, slotMaterial, slotPattern, unlockText, wearSet, zoneColors, type Category } from '../character/look';
import type { Look } from '../core/models';
import type { Career } from '../game/Career';
import { nameService } from '../name/NameService';
import type { ViewId } from '../three/CameraRig';
import type { Stage } from '../three/Stage';
import { VENUES } from '../three/venues';
import { dressingRoom, LIGHTINGS, STAND, type DressingRoomScene, type Lighting } from '../three/venues/dressingroom';
import { clear, h, setClass, setText } from './dom';

export interface CreatorHost {
  stage: Stage;
  ctx: AudioContext;
  career: Career;
  /** the venue to go back to (and whose dress code the wardrobe shows) */
  venue(): string;
  restoreVenue(id: string): void;
  /** the creator is open (the app holds its auto camera and its own look updates) */
  busy(on: boolean): void;
  /** the music, if the decks are playing (the room grooves to it instead of the wall) */
  music(): { playing: boolean; beat: number; kick: number };
}

type Tab = 'body' | 'face' | 'eyes' | 'skin' | 'hair' | 'makeup' | 'outfit' | 'moves' | 'wardrobe';
const TABS: { id: Tab; label: string; cat?: Exclude<Category, 'all'> }[] = [
  { id: 'body', label: 'Body', cat: 'body' },
  { id: 'face', label: 'Face', cat: 'face' },
  { id: 'eyes', label: 'Eyes', cat: 'eyes' },
  { id: 'skin', label: 'Skin', cat: 'skin' },
  { id: 'hair', label: 'Hair', cat: 'hair' },
  { id: 'makeup', label: 'Makeup & art', cat: 'makeup' },
  { id: 'outfit', label: 'Outfit', cat: 'outfit' },
  { id: 'moves', label: 'Moves', cat: 'personality' },
  { id: 'wardrobe', label: 'Wardrobe' },
];

const pretty = (id: string) => OPTION_LABEL[id] ?? id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** the camera framings */
type Shot = 'body' | 'face';

export class CharacterCreator {
  private el: HTMLElement | null = null;
  private body!: HTMLElement;
  private tabBar!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private nameInput!: HTMLInputElement;
  private status!: HTMLElement;
  private lightBtns: HTMLButtonElement[] = [];
  private history: LookHistory | null = null;
  private tab: Tab = 'body';
  private room: DressingRoomScene | null = null;
  private thump: WallThump | null = null;
  private prevVenue = '';
  private prevView: ViewId = 'perf';
  private lighting: Lighting = 'room';
  private face = 0;
  private faceGoal = 0;
  private autoTurn = false;
  /** a look waiting to be shown (sliders while dragged; rebuilt a few times a second) */
  private pending: Look | null = null;
  private appliedAt = -1;
  private t = 0;
  private dropNow = false;
  /** the last framing, kept when the screen changes size (a phone turned round) */
  private shot: Shot = 'body';
  private resizer: ResizeObserver | null = null;
  private resizeTimer = 0;
  /** the skin tab's sweat preview (the dressing room is otherwise dry) */
  private previewSweat = 0;
  private wardrobe = { slot: 'all' as Slot | 'all', vibe: 'all' as Vibe | 'all', locked: true };

  constructor(private host: CreatorHost) {}

  get open(): boolean {
    return this.el !== null;
  }

  private get look(): Look {
    return this.history!.look;
  }

  show(): void {
    if (this.open) return;
    const st = this.host.stage;
    this.prevVenue = this.host.venue();
    const v = st.rig.view;
    this.prevView = v === 'drone' || v === 'custom' ? 'perf' : v;
    st.setVenue(dressingRoom);
    this.room = st.venue as unknown as DressingRoomScene;
    this.room.lighting = this.lighting;
    this.history = new LookHistory(cloneLook(this.host.career.look));
    this.face = this.faceGoal = 0;
    st.avatarSpot = { pos: STAND.clone(), face: 0, input: () => this.avatarInput() };
    st.setLook(this.look, nameService.text);
    st.avatar.sweat = 0;
    this.host.busy(true);
    document.body.classList.add('creator-open');
    void this.host.ctx.resume();
    this.thump = this.host.music().playing ? null : wallThump(this.host.ctx);
    this.build();
    st.el.append(this.el!);
    requestAnimationFrame(() => {
      st.resize();
      this.frame('body', true);
    });
    this.resizer = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.open && this.frame(this.shot, true), 150);
    });
    this.resizer.observe(st.el);
  }

  close(): void {
    if (!this.open) return;
    const st = this.host.stage;
    this.flush();
    this.thump?.stop();
    this.thump = null;
    this.resizer?.disconnect();
    this.resizer = null;
    clearTimeout(this.resizeTimer);
    this.el?.remove();
    this.el = null;
    this.room = null;
    st.avatarSpot = null;
    st.avatar.uv = 0;
    document.body.classList.remove('creator-open');
    this.host.restoreVenue(this.prevVenue);
    st.rig.goTo(this.prevView, true);
    st.setLook(this.host.career.look, nameService.text);
    this.host.busy(false);
    requestAnimationFrame(() => st.resize());
  }

  private avatarInput(): AvatarInput {
    const m = this.host.music();
    const beat = m.playing ? m.beat : this.thump && this.host.ctx.state === 'running' ? this.thump.beat() : (this.t * 124) / 60;
    const drop = this.dropNow;
    this.dropNow = false;
    return { beat, playing: true, dropHit: drop, peak: 0, build: 0, kick: m.playing ? m.kick : Math.exp(-(((beat % 1) + 1) % 1) * 7) };
  }

  /* ---------------------------------------------------------------- */
  /* changes                                                           */
  /* ---------------------------------------------------------------- */

  /** a finished change: into the history, saved, shown */
  private commit(next: Look, rerender = true): void {
    if (!this.history) return;
    if (JSON.stringify(next) === JSON.stringify(this.history.look)) {
      this.pending = null;
      return;
    }
    this.history.push(next);
    this.pending = next;
    this.host.career.saveLook(next);
    this.syncTools();
    if (rerender) this.render();
  }

  /** a change in progress (a slider being dragged): shown, not yet kept */
  private preview(next: Look): void {
    this.pending = next;
  }

  private edit(fn: (l: Look) => void, rerender = true): void {
    const next = cloneLook(this.look);
    fn(next);
    this.commit(next, rerender);
  }

  /** show a waiting look now */
  private flush(): void {
    if (this.pending) {
      this.host.stage.setLook(this.pending, nameService.text);
      this.pending = null;
      this.appliedAt = this.t;
    }
  }

  private undo(): void {
    if (!this.history?.canUndo) return;
    const l = this.history.undo();
    this.after(l);
  }

  private redo(): void {
    if (!this.history?.canRedo) return;
    const l = this.history.redo();
    this.after(l);
  }

  private after(l: Look): void {
    this.pending = l;
    this.host.career.saveLook(l);
    this.syncTools();
    this.render();
  }

  private syncTools(): void {
    if (!this.history) return;
    this.undoBtn.disabled = !this.history.canUndo;
    this.redoBtn.disabled = !this.history.canRedo;
    if (document.activeElement !== this.nameInput) this.nameInput.value = this.look.name;
  }

  private say(text: string): void {
    setText(this.status, text);
  }

  /* ---------------------------------------------------------------- */
  /* camera                                                            */
  /* ---------------------------------------------------------------- */

  /** frame the full body or the face, centred in the part of the screen the panel leaves free */
  private frame(shot: Shot, instant = false): void {
    this.shot = shot;
    const st = this.host.stage;
    const cam = st.camera;
    st.avatar.object.updateMatrixWorld(true);
    // the head bone sits at the base of the skull: the face is a hand's width above it
    const face = st.avatar.bones.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0));
    const top = face.y + 0.18;
    const target = shot === 'face' ? face.clone() : new THREE.Vector3(STAND.x, top * 0.5, STAND.z);
    // the panel covers the left side (or the bottom half on a phone), the camera buttons the top
    // and the tools the bottom: frame into what's left
    const rect = st.el.getBoundingClientRect();
    const box = (sel: string) => this.el?.querySelector(sel)?.getBoundingClientRect();
    const panel = box('.creator-panel');
    const tools = box('.creator-tools');
    const cams = box('.creator-cam');
    const H = Math.max(1, rect.height);
    const sheet = !!panel && panel.height < H * 0.8;
    const above = cams ? Math.min(0.3, (cams.bottom - rect.top + 6) / H) : 0;
    const below = Math.min(0.62, Math.max(sheet ? (rect.bottom - panel!.top) / H : 0, tools ? (rect.bottom - tools.top + 6) / H : 0));
    const free = Math.max(0.3, 1 - above - below);
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    // fit the height into the free band, and the width on a narrow screen
    const need = shot === 'face' ? 0.17 : top * 0.5 * 1.1;
    const fitH = need / tan / free;
    const fitW = (shot === 'face' ? 0.16 : 0.5) / (tan * cam.aspect);
    const dist = Math.max(shot === 'face' ? 0.72 : 2.4, fitH, fitW);
    const hh = dist * tan;
    const hw = hh * cam.aspect;
    const shift = new THREE.Vector3(0, -(below - above) * hh, 0);
    if (panel && rect.width > 0 && !sheet) shift.x = -(Math.min(panel.right - rect.left, rect.width * 0.6) / rect.width) * hw;
    target.add(shift);
    const pos = target.clone().add(new THREE.Vector3(0, shot === 'face' ? 0.02 : 0.05, dist));
    st.rig.goToAnchor({ name: 'creator', pos: pos.toArray() as [number, number, number], target: target.toArray() as [number, number, number] });
    if (instant) {
      cam.position.copy(pos);
      st.rig.controls.target.copy(target);
      st.rig.hold();
      st.rig.controls.update();
    }
  }

  private zoom(k: number): void {
    const st = this.host.stage;
    const c = st.rig.controls;
    const off = st.camera.position.clone().sub(c.target);
    const d = THREE.MathUtils.clamp(off.length() * k, 0.45, 6);
    const pos = c.target.clone().add(off.setLength(d));
    st.rig.goToAnchor({ name: 'creator', pos: pos.toArray() as [number, number, number], target: c.target.toArray() as [number, number, number] });
  }

  private setLighting(l: Lighting): void {
    this.lighting = l;
    if (this.room) this.room.lighting = l;
    this.host.stage.avatar.uv = l === 'uv' ? 1 : 0;
    this.lightBtns.forEach((b, i) => {
      setClass(b, 'active', LIGHTINGS[i].id === l);
      b.setAttribute('aria-pressed', String(LIGHTINGS[i].id === l));
    });
  }

  /** every frame while open */
  update(dt: number): void {
    if (!this.open) return;
    this.t += dt;
    const st = this.host.stage;
    if (this.room) {
      this.room.beat = this.avatarBeat();
      this.room.reduceFlash = st.show.controls.reduceFlash;
    }
    if (this.autoTurn) this.faceGoal += dt * 0.6;
    this.face += (this.faceGoal - this.face) * Math.min(1, dt * 6);
    if (st.avatarSpot) st.avatarSpot.face = this.face;
    st.avatar.sweat = this.previewSweat;
    if (this.pending && this.t - this.appliedAt > 0.14) this.flush();
  }

  private avatarBeat(): number {
    const m = this.host.music();
    return m.playing ? m.beat : this.thump && this.host.ctx.state === 'running' ? this.thump.beat() : (this.t * 124) / 60;
  }

  /* ---------------------------------------------------------------- */
  /* the page                                                          */
  /* ---------------------------------------------------------------- */

  private build(): void {
    const btn = (label: string, title: string, fn: () => void, cls = 'btn') => {
      const b = h('button', { class: cls, type: 'button', title, 'aria-label': title }, label) as HTMLButtonElement;
      b.addEventListener('click', fn);
      return b;
    };
    this.tabBar = h('div', { class: 'creator-tabs', role: 'tablist', 'aria-label': 'Character' });
    for (const t of TABS) {
      const b = h('button', { class: 'creator-tab', type: 'button', role: 'tab', 'data-tab': t.id }, t.label);
      b.addEventListener('click', () => {
        this.tab = t.id;
        this.render();
      });
      this.tabBar.append(b);
    }
    this.body = h('div', { class: 'creator-body', role: 'tabpanel' });
    this.status = h('p', { class: 'creator-status', role: 'status' });

    this.lightBtns = LIGHTINGS.map((l) => btn(l.label, `Preview under: ${l.label}`, () => this.setLighting(l.id), 'cchip'));
    const turn = btn('Auto-turn', 'Turn slowly all the way round', () => {
      this.autoTurn = !this.autoTurn;
      setClass(turn, 'active', this.autoTurn);
    }, 'cchip');
    const camBar = h(
      'div',
      { class: 'creator-cam' },
      h('div', { class: 'creator-group', role: 'group', 'aria-label': 'Lighting preview' }, ...this.lightBtns),
      h(
        'div',
        { class: 'creator-group', role: 'group', 'aria-label': 'Camera' },
        btn('Full body', 'Full body', () => this.frame('body'), 'cchip'),
        btn('Face', 'Face close-up', () => this.frame('face'), 'cchip'),
        btn('⟲', 'Turn left', () => (this.faceGoal -= Math.PI / 4), 'cchip'),
        btn('⟳', 'Turn right', () => (this.faceGoal += Math.PI / 4), 'cchip'),
        turn,
        btn('−', 'Zoom out', () => this.zoom(1.25), 'cchip'),
        btn('+', 'Zoom in', () => this.zoom(0.8), 'cchip'),
      ),
    );

    this.undoBtn = btn('Undo', 'Undo (Ctrl+Z)', () => this.undo());
    this.redoBtn = btn('Redo', 'Redo (Ctrl+Shift+Z)', () => this.redo());
    this.nameInput = h('input', { class: 'creator-name', type: 'text', maxlength: 40, 'aria-label': 'Look name', placeholder: 'Name this look' }) as HTMLInputElement;
    this.nameInput.addEventListener('change', () => this.edit((l) => (l.name = this.nameInput.value.trim().slice(0, 40) || 'My look'), false));
    const saveNew = btn('Save as new look', 'Keep this look in the wardrobe as a new look', () => this.saveAsNew());
    const random = btn('Randomise all', 'A whole new character (only things you own)', () => this.commit({ ...randomize(this.look, 'all', Math.random, this.host.career.progress), id: this.look.id, name: this.look.name }));
    const done = btn('Done', 'Back to the decks', () => this.close(), 'btn primary');
    const tools = h('div', { class: 'creator-tools' }, random, this.undoBtn, this.redoBtn, this.nameInput, saveNew, done);

    this.el = h(
      'div',
      { class: 'creator', role: 'dialog', 'aria-label': 'Dressing room: character creator' },
      h('div', { class: 'creator-panel' }, h('div', { class: 'creator-head' }, h('span', { class: 'creator-kicker' }, 'Dressing room'), h('h2', {}, 'Who walks out there?')), this.tabBar, this.body, this.status),
      camBar,
      tools,
    );
    this.el.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === 'Escape') this.close();
      e.stopPropagation();
    });
    this.setLighting(this.lighting);
    this.syncTools();
    this.render();
  }

  private saveAsNew(): void {
    const c = this.host.career;
    const n = cloneLook(this.look);
    n.id = c.newLookId();
    const base = this.nameInput.value.trim() || 'Look';
    n.name = c.looks.items.some((x) => x.name === base) ? `${base} ${c.looks.items.length + 1}` : base;
    c.saveLook(n);
    this.history = new LookHistory(n);
    this.syncTools();
    this.say(`Saved "${n.name}" to the wardrobe.`);
    if (this.tab === 'wardrobe') this.render();
  }

  /** the open tab's controls (keeps the scroll position) */
  private render(): void {
    if (!this.el) return;
    for (const b of this.tabBar.children) {
      const on = (b as HTMLElement).dataset.tab === this.tab;
      setClass(b, 'active', on);
      b.setAttribute('aria-selected', String(on));
    }
    const top = this.body.scrollTop;
    clear(this.body);
    const meta = TABS.find((t) => t.id === this.tab)!;
    if (meta.cat) {
      const cat = meta.cat;
      const r = h('button', { class: 'btn ghost', type: 'button', title: `Randomise ${meta.label.toLowerCase()}` }, 'Randomise');
      r.addEventListener('click', () => this.commit(randomize(this.look, cat, Math.random, this.host.career.progress)));
      const z = h('button', { class: 'btn ghost', type: 'button', title: `Put ${meta.label.toLowerCase()} back to the start` }, 'Reset');
      z.addEventListener('click', () => this.commit(resetCategory(this.look, cat)));
      this.body.append(h('div', { class: 'creator-tabtools' }, h('h3', {}, meta.label), r, z));
    }
    const sections: Record<Tab, () => Node[]> = {
      body: () => this.sliders('body'),
      face: () => this.faceTab(),
      eyes: () => this.eyesTab(),
      skin: () => this.skinTab(),
      hair: () => this.hairTab(),
      makeup: () => this.makeupTab(),
      outfit: () => this.outfitTab(),
      moves: () => this.movesTab(),
      wardrobe: () => this.wardrobeTab(),
    };
    this.body.append(...sections[this.tab]());
    this.body.scrollTop = top;
  }

  /* ---------------------------------------------------------------- */
  /* controls                                                          */
  /* ---------------------------------------------------------------- */

  private section(title: string, ...kids: (Node | null)[]): HTMLElement {
    return h('section', { class: 'creator-sec' }, h('h4', {}, title), ...kids.filter((k): k is Node => !!k));
  }

  private range(label: string, value: number, min: number, max: number, set: (l: Look, v: number) => void, step = 0.01): HTMLElement {
    const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label }) as HTMLInputElement;
    const out = h('output', {}, value.toFixed(2));
    const apply = (commit: boolean) => {
      const v = Number(input.value);
      setText(out, v.toFixed(2));
      const next = cloneLook(this.look);
      set(next, v);
      if (commit) this.commit(next, false);
      else this.preview(next);
    };
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => apply(true));
    input.addEventListener('dblclick', () => {
      input.value = String(Math.max(min, 0));
      apply(true);
    });
    return h('label', { class: 'creator-range', title: 'Double-click to reset' }, h('span', {}, label), input, out);
  }

  private sliders(group: string, skip: string[] = []): HTMLElement[] {
    return SLIDERS.filter((s) => s.group === group && !skip.includes(s.id)).map((s) => this.range(s.label, slider(this.look, s.id), s.min, 1, (l, v) => (l.sliders[s.id] = v)));
  }

  /** a row of choices; `locked` ones show how they unlock */
  private chips<T extends string>(label: string, values: readonly T[], current: string, pick: (v: T) => void, o: { name?: (v: T) => string; locked?: (v: T) => Unlock | null; swatch?: (v: T) => string } = {}): HTMLElement {
    const row = h('div', { class: 'creator-chips', role: 'radiogroup', 'aria-label': label });
    for (const v of values) {
      const lock = o.locked?.(v) ?? null;
      const name = o.name ? o.name(v) : pretty(v);
      const b = h('button', { class: 'cchip', type: 'button', role: 'radio', 'aria-checked': String(v === current), title: lock ? `${name}: locked. ${unlockText(lock)}` : name }, o.swatch ? h('i', { class: 'creator-sw', style: { background: o.swatch(v) } }) : null, name, lock ? h('span', { class: 'creator-lock', 'aria-hidden': 'true' }, '🔒') : null) as HTMLButtonElement;
      if (v === current) b.classList.add('active');
      if (lock) b.disabled = true;
      b.addEventListener('click', () => pick(v));
      row.append(b);
    }
    return row;
  }

  private colour(label: string, key: string, presets: readonly string[] = [], fallback = '#888888'): HTMLElement {
    const value = this.look.colors[key] ?? fallback;
    const input = h('input', { type: 'color', value, 'aria-label': label }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const next = cloneLook(this.look);
      next.colors[key] = input.value;
      this.preview(next);
    });
    input.addEventListener('change', () => this.edit((l) => (l.colors[key] = input.value), false));
    const sw = presets.map((c) => {
      const b = h('button', { class: 'creator-swatch', type: 'button', title: c, 'aria-label': `${label} ${c}`, style: { background: c } }) as HTMLButtonElement;
      if (c.toLowerCase() === value.toLowerCase()) b.classList.add('active');
      b.addEventListener('click', () => this.edit((l) => (l.colors[key] = c)));
      return b;
    });
    return h('div', { class: 'creator-colour' }, h('span', {}, label), input, sw.length ? h('div', { class: 'creator-swatches' }, ...sw) : null);
  }

  private opt<K extends keyof typeof OPTIONS>(label: string, key: K, o: { locked?: (v: string) => Unlock | null; name?: (v: string) => string } = {}): HTMLElement {
    return this.chips(label, OPTIONS[key] as readonly string[], option(this.look, key), (v) => this.edit((l) => (l.options[key] = v)), o);
  }

  /* ---------------------------------------------------------------- */
  /* tabs                                                              */
  /* ---------------------------------------------------------------- */

  private faceTab(): Node[] {
    return [
      this.section('Face shape', this.opt('Face shape', 'face_shape')),
      this.section('Shape', ...this.sliders('face', ['brow_thickness', 'facial_hair_length'])),
      this.section(
        'Brows',
        this.chips('Brow shape', BROWS, option(this.look, 'brows'), (v) => this.edit((l) => (l.options.brows = v))),
        this.range('Thickness', slider(this.look, 'brow_thickness'), -1, 1, (l, v) => (l.sliders.brow_thickness = v)),
        this.colour('Colour', 'brows', NATURAL_HAIR),
        this.chips('Slit', BROW_SLITS, option(this.look, 'brow_slit'), (v) => this.edit((l) => (l.options.brow_slit = v))),
      ),
      this.section(
        'Facial hair',
        this.chips('Facial hair', FACIAL_HAIR, option(this.look, 'facial_hair'), (v) => this.edit((l) => (l.options.facial_hair = v))),
        this.range('Length', slider(this.look, 'facial_hair_length'), 0, 1, (l, v) => (l.sliders.facial_hair_length = v)),
        this.colour('Colour', 'facial_hair', NATURAL_HAIR),
      ),
    ];
  }

  private eyesTab(): Node[] {
    const p = this.host.career.progress;
    const same = (this.look.colors.iris_l ?? '') === (this.look.colors.iris_r ?? '');
    const pair = h('label', { class: 'creator-check' }, h('input', { type: 'checkbox', checked: !same }), 'Different colour in each eye');
    pair.querySelector('input')!.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.edit((l) => (l.colors.iris_r = on ? EYE_COLORS[(EYE_COLORS.indexOf(l.colors.iris_l ?? '') + 5) % EYE_COLORS.length] : (l.colors.iris_l ?? EYE_COLORS[1])));
    });
    const left = h('input', { type: 'color', value: this.look.colors.iris_l ?? EYE_COLORS[1], 'aria-label': same ? 'Iris colour' : 'Left iris colour' }) as HTMLInputElement;
    left.addEventListener('change', () =>
      this.edit((l) => {
        l.colors.iris_l = left.value;
        if (same) l.colors.iris_r = left.value;
      }),
    );
    const presets = EYE_COLORS.map((c) => {
      const b = h('button', { class: 'creator-swatch', type: 'button', 'aria-label': `Iris ${c}`, style: { background: c } });
      b.addEventListener('click', () =>
        this.edit((l) => {
          l.colors.iris_l = c;
          if (same) l.colors.iris_r = c;
        }),
      );
      return b;
    });
    return [
      this.section('Shape', ...this.sliders('eyes', ['glitter'])),
      this.section('Iris', h('div', { class: 'creator-colour' }, h('span', {}, same ? 'Colour' : 'Left'), left, h('div', { class: 'creator-swatches' }, ...presets)), same ? null : this.colour('Right', 'iris_r', EYE_COLORS), pair),
      this.section(
        'Fantasy eyes',
        this.chips('Iris style', IRIS_STYLES.map((i) => i.id), option(this.look, 'iris_style'), (v) => this.edit((l) => (l.options.iris_style = v)), {
          name: (v) => IRIS_STYLES.find((i) => i.id === v)!.label,
          locked: (v) => {
            const u = IRIS_STYLES.find((i) => i.id === v)!.unlock;
            return owned(u, p) ? null : u;
          },
        }),
        h('p', { class: 'creator-hint' }, 'UV-glow irises light up under the blacklight preview.'),
      ),
    ];
  }

  private skinTab(): Node[] {
    // not part of the look: a peek at the sheen a long set builds up
    const sweat = this.range('Sweat (preview only)', this.previewSweat, 0, 1, () => undefined);
    const input = sweat.querySelector('input')!;
    input.addEventListener('input', () => (this.previewSweat = Number(input.value)));
    return [
      this.section('Tone', this.colour('Skin tone', 'skin', SKIN_TONES)),
      this.section('Details', ...this.sliders('skin')),
      this.section('During a set', h('p', { class: 'creator-hint' }, 'A sheen builds up through a long set and resets between gigs.'), sweat),
    ];
  }

  private hairTab(): Node[] {
    const p = this.host.career.progress;
    const cats: [string, string][] = [
      ['none', 'None'],
      ['short', 'Short'],
      ['medium', 'Medium'],
      ['long', 'Long'],
      ['textured', 'Textured & protective'],
    ];
    const cur = this.look.items.hair ?? 'bald';
    const groups = cats.map(([c, label]) =>
      this.section(
        label,
        this.chips(
          label,
          HAIR.filter((x) => x.category === c).map((x) => x.id),
          cur,
          (v) => this.edit((l) => (l.items.hair = v)),
          {
            name: (v) => HAIR.find((x) => x.id === v)!.label,
            locked: (v) => {
              const u = HAIR.find((x) => x.id === v)!.unlock;
              return owned(u, p) ? null : u;
            },
          },
        ),
      ),
    );
    const mode = option(this.look, 'hair_color_mode');
    return [
      this.section(
        'Colour',
        this.opt('Colour mode', 'hair_color_mode', { name: (v) => ({ solid: 'Solid', gradient: 'Gradient (root to tip)', tips: 'Tips only', streaks: 'Streaks' })[v] ?? pretty(v) }),
        this.colour(mode === 'solid' ? 'Colour' : 'Primary', 'hair', [...NATURAL_HAIR, ...WILD_HAIR]),
        mode === 'solid' ? null : this.colour(mode === 'gradient' ? 'Tips' : mode === 'tips' ? 'Tips' : 'Streaks', 'hair2', [...NATURAL_HAIR, ...WILD_HAIR]),
        this.chips('Finish', HAIR_FINISHES, option(this.look, 'hair_finish'), (v) => this.edit((l) => (l.options.hair_finish = v))),
      ),
      ...groups,
    ];
  }

  private makeupTab(): Node[] {
    const l0 = this.look;
    const tattoos = l0.tattoos.map((t, i) => {
      const design = h('select', { 'aria-label': 'Design' }) as HTMLSelectElement;
      for (const fam of ['flash', 'script', 'geometric', 'rave', 'music'] as const) {
        const g = h('optgroup', { label: pretty(fam) });
        for (const d of TATTOOS.filter((x) => x.family === fam)) g.append(h('option', { value: d.id, selected: d.id === t.design }, d.id === 'script_name' ? `Your DJ name (${nameService.text || 'name'})` : d.label));
        design.append(g);
      }
      design.addEventListener('change', () => this.edit((l) => (l.tattoos[i].design = design.value)));
      const place = h('select', { 'aria-label': 'Placement' }, ...TATTOO_PLACES.map((p) => h('option', { value: p, selected: p === t.place }, pretty(p).replace(/ l$/, ' (left)').replace(/ r$/, ' (right)')))) as HTMLSelectElement;
      place.addEventListener('change', () => this.edit((l) => (l.tattoos[i].place = place.value)));
      const ink = h('input', { type: 'color', value: t.color, 'aria-label': 'Ink colour' }) as HTMLInputElement;
      ink.addEventListener('change', () => this.edit((l) => (l.tattoos[i].color = ink.value), false));
      const del = h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Remove tattoo' }, 'Remove');
      del.addEventListener('click', () => this.edit((l) => l.tattoos.splice(i, 1)));
      return h(
        'div',
        { class: 'creator-tattoo' },
        h('div', { class: 'creator-row' }, design, place, ink, del),
        this.range('Size', t.size, 0.3, 1.5, (l, v) => (l.tattoos[i].size = v)),
        this.range('Rotation', t.rot, -Math.PI, Math.PI, (l, v) => (l.tattoos[i].rot = v)),
      );
    });
    const add = h('button', { class: 'btn', type: 'button', disabled: l0.tattoos.length >= 12 }, 'Add a tattoo');
    add.addEventListener('click', () => this.edit((l) => l.tattoos.push({ design: 'flash_star', place: 'forearm_l', size: 1, rot: 0, color: '#1a1a1a' })));
    const pierce = h('div', { class: 'creator-chips', role: 'group', 'aria-label': 'Piercings' });
    for (const p of PIERCINGS) {
      const on = l0.piercings.includes(p);
      const b = h('button', { class: `cchip${on ? ' active' : ''}`, type: 'button', 'aria-pressed': String(on) }, pretty(p).replace(/ l$/, ' (left)').replace(/ r$/, ' (right)'));
      b.addEventListener('click', () => this.edit((l) => (l.piercings = on ? l.piercings.filter((x) => x !== p) : [...l.piercings, p])));
      pierce.append(b);
    }
    return [
      this.section('Eyes', this.chips('Eyeliner', EYELINER, option(l0, 'eyeliner'), (v) => this.edit((l) => (l.options.eyeliner = v))), this.colour('Liner', 'liner', ['#111111', '#2a1a10', '#ff2e88', '#3ad7ff', '#b6ff3b']), this.colour('Shadow', 'eyeshadow', ['#7a3cff', '#ff2e88', '#ffb547', '#3ad7ff', '#c9a24a', '#2a2d33']), this.range('Glitter', slider(l0, 'glitter'), 0, 1, (l, v) => (l.sliders.glitter = v))),
      this.section('Face paint & gems', this.chips('Face paint', FACE_PAINT, option(l0, 'face_paint'), (v) => this.edit((l) => (l.options.face_paint = v)), { name: (v) => ({ none: 'None', stripes: 'Stripes', dots: 'Dots', uv_stripes: 'UV stripes', uv_dots: 'UV dots', gems: 'Face gems' })[v] ?? pretty(v) }), this.colour('Paint', 'paint', WILD_HAIR), h('p', { class: 'creator-hint' }, 'UV paint glows under the blacklight preview.')),
      this.section(`Tattoos (${l0.tattoos.length}/12)`, ...tattoos, add),
      this.section('Piercings', pierce),
    ];
  }

  private outfitTab(): Node[] {
    const p = this.host.career.progress;
    const sets = h('div', { class: 'creator-sets' });
    for (const s of OUTFIT_SETS) {
      const ok = owned(s.unlock, p);
      const worn = Object.entries(s.pieces).every(([slot, id]) => this.look.items[slot] === id);
      const b = h('button', { class: `creator-set${worn ? ' active' : ''}`, type: 'button', disabled: !ok, title: ok ? `Wear ${s.label}` : `${s.label}: locked. ${unlockText(s.unlock)}` }, h('b', {}, s.label), h('span', {}, ok ? s.vibe : unlockText(s.unlock)), ok ? null : h('span', { class: 'creator-lock', 'aria-hidden': 'true' }, '🔒'));
      b.addEventListener('click', () => this.commit(wearSet(this.look, s)));
      sets.append(b);
    }
    const slots = SLOTS.map((slot) => this.slotEditor(slot));
    return [this.section('Signature sets', sets), ...slots];
  }

  private slotEditor(slot: Slot): HTMLElement {
    const p = this.host.career.progress;
    const l0 = this.look;
    const items = ITEMS.filter((i) => i.slot === slot);
    const cur = l0.items[slot] ?? 'none';
    const required = slot === 'top' || slot === 'bottom' || slot === 'shoes';
    const values = [...(required ? [] : ['none']), ...items.map((i) => i.id)];
    const chips = this.chips(SLOT_LABEL[slot], values, cur, (v) => this.edit((l) => {
      l.items[slot] = v === 'none' ? null : v;
      for (let z = 1; z <= 3; z++) delete l.colors[`${slot}_${z}`];
      delete l.options[`${slot}_material`];
      delete l.options[`${slot}_pattern`];
    }), {
      name: (v) => (v === 'none' ? 'None' : items.find((i) => i.id === v)!.label),
      locked: (v) => {
        const it = items.find((i) => i.id === v);
        return it && !owned(it.unlock, p) ? it.unlock : null;
      },
    });
    const kids: (Node | null)[] = [chips];
    if (l0.items[slot]) {
      const zones = zoneColors(l0, slot);
      const zone = (z: number) => {
        const input = h('input', { type: 'color', value: zones[z], 'aria-label': `${SLOT_LABEL[slot]} colour ${z + 1}` }) as HTMLInputElement;
        input.addEventListener('input', () => {
          const next = cloneLook(this.look);
          next.colors[`${slot}_${z + 1}`] = input.value;
          this.preview(next);
        });
        input.addEventListener('change', () => this.edit((l) => (l.colors[`${slot}_${z + 1}`] = input.value), false));
        return input;
      };
      kids.push(
        h('div', { class: 'creator-colour' }, h('span', {}, 'Colours'), zone(0), zone(1), zone(2)),
        this.chips('Material', MATERIALS, slotMaterial(l0, slot), (v) => this.edit((l) => (l.options[`${slot}_material`] = v))),
        this.chips('Pattern', PATTERNS, slotPattern(l0, slot), (v) => this.edit((l) => (l.options[`${slot}_pattern`] = v)), { name: (v) => (v === 'flyer' ? 'Rave flyer' : pretty(v)) }),
      );
      if (slot === 'headphones') kids.push(this.opt('Wear them', 'phones_wear'));
      if (slot === 'head' && l0.items.head === 'cap') kids.push(this.opt('Cap', 'cap_wear'));
    }
    return this.section(SLOT_LABEL[slot], ...kids);
  }

  private movesTab(): Node[] {
    const tryDrop = h('button', { class: 'btn', type: 'button' }, 'Try the drop move');
    tryDrop.addEventListener('click', () => (this.dropNow = true));
    return [
      this.section('Groove', this.opt('Groove style', 'groove')),
      this.section('Signature drop move', this.opt('Drop move', 'drop_move'), tryDrop),
      this.section('Headphone habit', this.opt('Headphones', 'phones_wear'), this.look.items.headphones ? null : h('p', { class: 'creator-hint' }, 'Pick some headphones in Outfit to see it.')),
      this.section('Between mixes', this.opt('Between-mix habit', 'between_habit'), h('p', { class: 'creator-hint' }, 'Every 32 bars, when the mix is calm.')),
    ];
  }

  private wardrobeTab(): Node[] {
    const c = this.host.career;
    const p = c.progress;
    // saved looks
    const looks = h('div', { class: 'creator-looks' });
    const list = c.looks.items.length ? c.looks.items : [this.look];
    for (const l of list) {
      const wearing = l.id === this.look.id;
      const wear = h('button', { class: 'btn', type: 'button', disabled: wearing }, wearing ? 'Wearing' : 'Wear');
      wear.addEventListener('click', () => {
        c.wearLook(l.id);
        this.history = new LookHistory(cloneLook(c.look));
        this.pending = this.look;
        this.syncTools();
        this.render();
      });
      const del = h('button', { class: 'btn ghost', type: 'button', disabled: list.length < 2, 'aria-label': `Delete ${l.name}` }, 'Delete');
      del.addEventListener('click', () => {
        if (!confirm(`Delete the look "${l.name}"?`)) return;
        c.deleteLook(l.id);
        if (wearing) {
          this.history = new LookHistory(cloneLook(c.look));
          this.pending = this.look;
          this.syncTools();
        }
        this.render();
      });
      looks.append(h('div', { class: `creator-look${wearing ? ' active' : ''}` }, h('i', { class: 'creator-sw', style: { background: zoneColors(l, 'top')[0] } }), h('b', {}, l.name), wear, del));
    }
    // the dress code where you're about to play
    const venue = this.host.venue();
    const vibes = VENUE_VIBES[venue] ?? [];
    const dc = dressCodeBonus(this.look, venue);
    const venueName = VENUES.find((v) => v.id === venue)?.name ?? venue;
    const code = vibes.length
      ? h('p', { class: 'creator-hint' }, `${venueName} dresses ${vibes.join(' / ')}. `, dc.matched.length ? `You match with ${dc.matched.length} piece${dc.matched.length > 1 ? 's' : ''}: +${Math.round(dc.bonus * 100)}% crowd energy at the start of the set.` : 'Nothing you wear matches yet.')
      : null;
    // every item, with filters
    const slotSel = h('select', { 'aria-label': 'Slot' }, h('option', { value: 'all' }, 'All slots'), ...SLOTS.map((s) => h('option', { value: s, selected: s === this.wardrobe.slot }, SLOT_LABEL[s]))) as HTMLSelectElement;
    slotSel.addEventListener('change', () => {
      this.wardrobe.slot = slotSel.value as Slot | 'all';
      this.render();
    });
    const allVibes = [...new Set(ITEMS.flatMap((i) => i.vibes))].sort();
    const vibeSel = h('select', { 'aria-label': 'Vibe' }, h('option', { value: 'all' }, 'Any vibe'), ...allVibes.map((v) => h('option', { value: v, selected: v === this.wardrobe.vibe }, pretty(v)))) as HTMLSelectElement;
    vibeSel.addEventListener('change', () => {
      this.wardrobe.vibe = vibeSel.value as Vibe | 'all';
      this.render();
    });
    const locked = h('label', { class: 'creator-check' }, h('input', { type: 'checkbox', checked: this.wardrobe.locked }), 'Show locked');
    locked.querySelector('input')!.addEventListener('change', (e) => {
      this.wardrobe.locked = (e.target as HTMLInputElement).checked;
      this.render();
    });
    const shown = ITEMS.filter((i) => (this.wardrobe.slot === 'all' || i.slot === this.wardrobe.slot) && (this.wardrobe.vibe === 'all' || i.vibes.includes(this.wardrobe.vibe)) && (this.wardrobe.locked || owned(i.unlock, p)));
    const ownedN = ITEMS.filter((i) => owned(i.unlock, p)).length;
    const grid = h('div', { class: 'creator-items' }, ...shown.map((i) => this.itemCard(i)));
    return [
      this.section('Saved looks', looks),
      code ? this.section('Dress code', code) : null,
      this.section(`Everything (${ownedN} of ${ITEMS.length} owned)`, h('div', { class: 'creator-row' }, slotSel, vibeSel, locked), grid),
    ].filter((x): x is HTMLElement => !!x);
  }

  private itemCard(i: ItemDef): HTMLElement {
    const ok = owned(i.unlock, this.host.career.progress);
    const wearing = this.look.items[i.slot] === i.id;
    const b = h(
      'button',
      { class: `creator-item${wearing ? ' active' : ''}`, type: 'button', disabled: !ok, title: ok ? (wearing ? `Take off ${i.label}` : `Wear ${i.label}`) : `${i.label}: locked. ${unlockText(i.unlock)}` },
      h('span', { class: 'creator-item-sw' }, ...i.colors.map((c) => h('i', { style: { background: c } }))),
      h('b', {}, i.label),
      h('span', {}, `${SLOT_LABEL[i.slot]} · ${i.vibes.join(', ')}`),
      ok ? null : h('span', { class: 'creator-item-lock' }, `🔒 ${unlockText(i.unlock)}`),
    );
    b.addEventListener('click', () =>
      this.edit((l) => {
        const required = i.slot === 'top' || i.slot === 'bottom' || i.slot === 'shoes';
        l.items[i.slot] = wearing && !required ? null : i.id;
        for (let z = 1; z <= 3; z++) delete l.colors[`${i.slot}_${z}`];
        delete l.options[`${i.slot}_material`];
        delete l.options[`${i.slot}_pattern`];
      }),
    );
    return b;
  }
}
