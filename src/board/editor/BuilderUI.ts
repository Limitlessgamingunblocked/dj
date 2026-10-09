/*
 * The Board Builder screen (Section 13.3), kept simple:
 *   top bar     Done · the board's name · undo / redo · More · Save · ▶ Try it
 *   left        parts to add (the essentials first; click, or drag onto the bench)
 *   right       Edit (the part you clicked) · All parts · Booth
 *   on the bench  drag parts to move them; a small bar by the selected part
 *               turns, copies, mirrors or deletes it
 * Everything else (precise tools, snap, symmetry, the logic, sharing) is in
 * the More menu. Try it plays the board for real; the bar at the top takes it
 * to any venue.
 */
import * as THREE from 'three';
import type { ControlRegistry } from '../../core/controls';
import { saveFile } from '../../core/download';
import type { Progress } from '../../core/models';
import { loadSetting, saveSetting } from '../../core/settings';
import { clear, h, setText } from '../../ui/dom';
import { contextMenu, openModal, type MenuItem } from '../../ui/modal';
import { toast } from '../../ui/toast';
import type { Stage } from '../../three/Stage';
import type { BoardFile } from '../format';
import type { BoardLibrary } from '../library';
import { measure } from '../perf';
import { BoardEditor, type EditorHost } from './Editor';
import { openGallery } from './gallery';
import { openLogic, type MidiLearn } from './logicui';
import * as ops from './ops';
import { boothPanel, inspectorPanel, layersPanel, nameOf, palettePanel, perfMeter, setMacros } from './panels';

export interface BuilderDeps {
  stage: Stage;
  reg: ControlRegistry;
  library: BoardLibrary;
  progress(): Progress;
  shell: HTMLElement;
  play(doc: BoardFile): void;
  setVenue(id: string): void;
  venue(): string;
  venues(): { id: string; name: string }[];
  kick(): number;
  midi: MidiLearn | null;
  closed(doc: BoardFile | null): void;
}

export interface BuilderHandle {
  editor: BoardEditor;
  update(dt: number): void;
  close(keep: boolean): void;
}

export function openBuilder(deps: BuilderDeps, doc: BoardFile): BuilderHandle {
  const host: EditorHost = {
    stage: deps.stage,
    reg: deps.reg,
    library: deps.library,
    progress: deps.progress,
    play: deps.play,
    setVenue: deps.setVenue,
    venue: deps.venue,
    kick: deps.kick,
    closed: (d) => {
      ui.remove();
      testBar.remove();
      deps.shell.classList.remove('building', 'bb-testing');
      off.forEach((f) => f());
      deps.closed(d);
    },
  };
  const ed = new BoardEditor(host, doc);
  const st = deps.stage;
  const off: (() => void)[] = [];
  const note = (t: string) => toast(t);
  const btn = (label: string, title: string, on: () => void, cls = '') => {
    const b = h('button', { class: `btn ${cls}`, type: 'button', title, 'aria-label': title }, label) as HTMLButtonElement;
    b.addEventListener('click', on);
    return b;
  };

  /* ---------------------------- the top bar ---------------------------- */
  const doneB = btn('← Done', 'Leave the builder', () => done(), 'bb-done');
  const nameIn = h('input', { class: 'bb-name', type: 'text', maxlength: 60, value: ed.doc.name, 'aria-label': 'Board name', title: 'Click to rename your board' }) as HTMLInputElement;
  nameIn.addEventListener('change', () => ed.rename(nameIn.value));
  const dirty = h('span', { class: 'bb-dirty', title: 'Not saved yet' }, 'not saved');
  const undoB = btn('↶', 'Undo (Ctrl+Z)', () => ed.undo(), 'bb-icon');
  const redoB = btn('↷', 'Redo (Ctrl+Shift+Z)', () => ed.redo(), 'bb-icon');
  const partsB = btn('＋ Parts', 'Show the parts to add', () => togglePanel('left'), 'bb-narrow');
  const editB = btn('✎ Edit', 'Show the settings for the selected part', () => togglePanel('right'), 'bb-narrow');
  const moreB = btn('More ▾', 'More: open or share boards, the booth, logic, precise tools', () => moreMenu());
  const saveB = btn('Save', 'Save to My boards', () => void save());
  const tryB = btn('▶ Try it', 'Play your board for real', () => ed.test(), 'primary');
  const toolbar = h(
    'div',
    { class: 'bb-toolbar', role: 'toolbar', 'aria-label': 'Board Builder' },
    doneB,
    h('div', { class: 'bb-namebox' }, nameIn, dirty),
    h('div', { class: 'bb-tg' }, undoB, redoB),
    partsB,
    editB,
    h('div', { class: 'bb-tg bb-right' }, moreB, saveB, tryB),
  );

  const moreMenu = () => {
    const r = moreB.getBoundingClientRect();
    const tick = (on: boolean, label: string) => `${on ? '✓ ' : '  '}${label}`;
    const items: (MenuItem | 'sep')[] = [
      { label: 'New board, templates and my boards…', action: () => gallery() },
      { label: 'Share this board…', action: () => void deps.library.code(ed.doc).then((code) => showShare(code)) },
      { label: 'Save as a file', action: () => void saveFile(deps.library.exportText(ed.doc), `${safe(ed.doc.name)}.deckhouse-board.json`, 'application/json') },
      'sep',
      { label: 'Design the booth…', action: () => showTab('booth') },
      { label: 'Logic: wiring, macros, triggers, MIDI…', action: () => openLogic({ ed, reg: deps.reg, midi: deps.midi }) },
      'sep',
      { label: tick(ed.symmetry, 'Mirror mode: build both sides at once'), action: () => ((ed.symmetry = !ed.symmetry), sync()) },
      { label: tick(ed.grid > 0, 'Snap to a 5 mm grid'), action: () => ed.setGrid(ed.grid > 0 ? 0 : 0.005) },
      { label: tick(ed.precise, 'Precise tools (arrows to move, turn, size; exact numbers)'), action: () => ed.setPrecise(!ed.precise) },
      { label: tick(ed.boxTool, 'Drag on the bench to select several'), action: () => ((ed.boxTool = !ed.boxTool), sync()) },
      'sep',
      { label: 'Frame the whole board', action: () => ed.frame('all') },
      { label: 'Look straight down', action: () => ed.frame('top') },
      { label: 'How the builder works', action: () => showCoach(true) },
    ];
    contextMenu(r.left, r.bottom + 4, items);
  };

  /* ---------------------------- the panels ---------------------------- */
  const palette = palettePanel({ ed, library: deps.library, progress: deps.progress, note });
  const inspector = inspectorPanel(ed, deps.reg);
  const layers = layersPanel(ed);
  const booth = boothPanel(ed, (on) => {
    ed.boothPreview = on;
    ed.rebuild();
    st.previewBooth(on);
    booth.refresh();
  });
  const perf = perfMeter(ed);
  type Tab = 'inspect' | 'layers' | 'booth';
  let tab: Tab = 'inspect';
  const tabBtns = (['inspect', 'layers', 'booth'] as Tab[]).map((t) => {
    const b = h('button', { class: 'bb-tab', type: 'button', role: 'tab' }, t === 'inspect' ? 'Edit' : t === 'layers' ? 'All parts' : 'Booth');
    b.addEventListener('click', () => showTab(t));
    return { t, b };
  });
  const tabBody = h('div', { class: 'bb-tabbody' });
  const showTab = (t: Tab) => {
    tab = t;
    for (const { t: x, b } of tabBtns) {
      b.classList.toggle('active', x === tab);
      b.setAttribute('aria-selected', String(x === tab));
    }
    clear(tabBody);
    tabBody.append(tab === 'inspect' ? inspector.el : tab === 'layers' ? layers.el : booth.el);
    if (narrow()) ui.classList.remove('fold-right');
  };
  const crumbs = h('div', { class: 'bb-crumbs' });
  const left = h('aside', { class: 'bb-left', 'aria-label': 'Parts to add' }, h('h3', {}, 'Add parts'), palette.el);
  const right = h('aside', { class: 'bb-right-panel', 'aria-label': 'Settings' }, h('div', { class: 'bb-tabs', role: 'tablist' }, tabBtns.map((x) => x.b)), tabBody);

  /* ---------------------------- on the bench ---------------------------- */
  // the bar by the selected part: the things you do to a part, in words
  const selLabel = h('b', {});
  const groupB = btn('Group', 'Group these parts (Ctrl+G)', () => ed.group());
  const ungroupB = btn('Ungroup', 'Take the parts out of this group', () => ed.ungroup());
  const selBar = h(
    'div',
    { class: 'bb-selbar', role: 'toolbar', 'aria-label': 'Selected part' },
    selLabel,
    btn('↺', 'Turn left 15° ([)', () => ed.turn(-15), 'bb-icon'),
    btn('↻', 'Turn right 15° (])', () => ed.turn(15), 'bb-icon'),
    btn('Copy', 'Make a copy beside it (Ctrl+D)', () => ed.duplicate()),
    btn('Mirror', 'A copy on the other side of the board (M)', () => ed.mirror()),
    groupB,
    ungroupB,
    btn('Delete', 'Delete (Del)', () => ed.remove(), 'danger'),
  );
  const toolsBar = h(
    'div',
    { class: 'bb-tools', role: 'radiogroup', 'aria-label': 'Precise tool' },
    ...(['move', 'rotate', 'scale'] as const).map((t) => {
      const b = btn(t === 'move' ? 'Move' : t === 'rotate' ? 'Turn' : 'Size', `${t === 'move' ? 'Move' : t === 'rotate' ? 'Turn' : 'Size'} with the arrows`, () => ed.setTool(t));
      b.dataset.tool = t;
      return b;
    }),
  );
  const empty = h('div', { class: 'bb-emptybench', 'aria-live': 'polite' }, h('b', {}, 'An empty bench'), h('span', {}, 'Click a part on the left to add it, or drag it here. Or start from a template: More → New board.'));

  /* ---------------------------- first time ---------------------------- */
  const coach = h('div', { class: 'bb-coach', role: 'dialog', 'aria-label': 'How the builder works', hidden: true });
  const showCoach = (force = false) => {
    if (!force && loadSetting('builderCoached', false)) return;
    clear(coach);
    coach.append(
      h('b', {}, 'Build your own board'),
      h(
        'ol',
        {},
        h('li', {}, h('b', {}, 'Add parts'), ' from the left: click one, or drag it onto the bench.'),
        h('li', {}, h('b', {}, 'Drag parts'), ' to move them. Click one to change what it does, its look and colour on the right.'),
        h('li', {}, h('b', {}, '▶ Try it'), ' plays your board for real. ', h('b', {}, 'Save'), ' keeps it, and you can play on it in every venue.'),
      ),
      btn('Got it', 'Close this', () => {
        coach.hidden = true;
        saveSetting('builderCoached', true);
      }, 'primary'),
    );
    coach.hidden = false;
  };

  const ui = h('div', { class: 'bb-ui' }, toolbar, crumbs, left, right, perf.el, selBar, toolsBar, empty, coach);

  /* ---------------------------- trying it out ---------------------------- */
  const venueSel = h('select', { 'aria-label': 'Try it in a venue' }, h('option', { value: 'workshop' }, 'The workshop'), deps.venues().map((v) => h('option', { value: v.id }, v.name))) as HTMLSelectElement;
  venueSel.addEventListener('change', () => deps.setVenue(venueSel.value));
  const testBar = h(
    'div',
    { class: 'bb-testbar', role: 'region', 'aria-label': 'Trying your board' },
    h('b', {}, 'Playing your board'),
    h('span', { class: 'bb-hint' }, 'Everything works. Try it in:'),
    venueSel,
    h('button', { class: 'btn primary', type: 'button', onclick: () => ed.back() }, '← Keep building'),
    h('button', { class: 'btn', type: 'button', onclick: () => done() }, 'Done'),
  );

  /* ---------------------------- dialogs ---------------------------- */
  const showShare = (code: string) => {
    const ta = h('textarea', { class: 'bb-code', readonly: true, rows: 5, 'aria-label': 'Share code' }, code) as HTMLTextAreaElement;
    const copy = h('button', { class: 'btn primary', type: 'button' }, 'Copy code');
    copy.addEventListener('click', () =>
      navigator.clipboard?.writeText(code).then(
        () => toast('Share code copied.'),
        () => {
          ta.select();
          toast('Copying isn’t allowed here: the code is selected, press Ctrl/⌘+C.', 'error');
        },
      ),
    );
    openModal(`Share “${ed.doc.name}”`, h('div', { class: 'bb-dialog' }, h('p', { class: 'bb-hint' }, 'Send this code to a friend: in their builder, More → New board → Import code gives them a copy to play on or remix.'), ta, h('div', { class: 'bb-flags' }, copy, h('button', { class: 'btn', type: 'button', onclick: () => void saveFile(deps.library.exportText(ed.doc), `${safe(ed.doc.name)}.deckhouse-board.json`, 'application/json') }, 'Save as a file instead'))));
    requestAnimationFrame(() => ta.select());
  };

  const save = async () => {
    saveB.disabled = true;
    try {
      await ed.save();
      toast(`Saved “${ed.doc.name}”. It’s in the board list (top bar) to play on anywhere.`);
    } catch (e) {
      toast(`Couldn’t save: ${(e as Error).message}`, 'error');
    } finally {
      saveB.disabled = false;
    }
  };

  const gallery = () =>
    openGallery({
      library: deps.library,
      current: ed.doc,
      progress: deps.progress,
      open: (d) => {
        if (ed.dirty && !confirm('Your changes to this board aren’t saved. Open the other one anyway?')) return false;
        ed.load(d, false);
        nameIn.value = ed.doc.name;
        return true;
      },
      startFrom: (d) => {
        ed.load(d, true);
        nameIn.value = ed.doc.name;
      },
      exportFile: () => void saveFile(deps.library.exportText(ed.doc), `${safe(ed.doc.name)}.deckhouse-board.json`, 'application/json'),
      saveAsNew: async (name) => {
        ed.fork(name);
        nameIn.value = ed.doc.name;
        await save();
      },
    });

  const done = () => {
    if (ed.dirty) {
      const m = openModal(
        'Leave the builder',
        h(
          'div',
          { class: 'bb-dialog' },
          h('p', {}, `“${ed.doc.name}” has changes that aren’t saved.`),
          h(
            'div',
            { class: 'bb-flags' },
            h('button', { class: 'btn primary', type: 'button', onclick: async () => (m.close(), await save(), ed.close(true)) }, 'Save and play on it'),
            h('button', { class: 'btn', type: 'button', onclick: () => (m.close(), ed.close(false)) }, 'Leave without saving'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'Keep building'),
          ),
        ),
      );
      return;
    }
    ed.close(deps.library.get(ed.doc.id) !== undefined);
  };

  /* ---------------------------- drop parts onto the bench ---------------------------- */
  const onOver = (e: DragEvent) => {
    if (ed.mode !== 'build' || !e.dataTransfer?.types.includes('application/x-deckhouse-part')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer?.getData('application/x-deckhouse-part');
    if (!type || ed.mode !== 'build') return;
    e.preventDefault();
    const r = st.canvas.getBoundingClientRect();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), st.camera);
    const hit = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -ed.root.position.y), new THREE.Vector3());
    if (!hit) return void ed.add(type);
    const p = ed.root.worldToLocal(hit);
    if (ed.context) p.applyMatrix4(ops.worldMatrix(ed.doc, ed.context).invert());
    const g = ed.grid;
    ed.add(type, [g ? ops.snap(p.x, g) : p.x, 0, g ? ops.snap(p.z, g) : p.z]);
  };
  st.el.addEventListener('dragover', onOver);
  st.el.addEventListener('drop', onDrop);
  const onNote = (e: Event) => note((e as CustomEvent<string>).detail);
  st.el.addEventListener('bb-note', onNote);
  off.push(
    () => st.el.removeEventListener('dragover', onOver),
    () => st.el.removeEventListener('drop', onDrop),
    () => st.el.removeEventListener('bb-note', onNote),
  );

  /* ---------------------------- narrow screens ---------------------------- */
  const narrow = () => window.innerWidth < 900;
  const togglePanel = (which: 'left' | 'right') => {
    const cls = which === 'left' ? 'fold-left' : 'fold-right';
    const other = which === 'left' ? 'fold-right' : 'fold-left';
    const opening = ui.classList.contains(cls);
    ui.classList.toggle(cls, !opening);
    // one drawer at a time on a small screen
    if (opening && narrow()) ui.classList.add(other);
  };
  if (narrow()) ui.classList.add('fold-left', 'fold-right');

  /* ---------------------------- keeping it all in step ---------------------------- */
  const sync = () => {
    undoB.disabled = !ed.canUndo;
    redoB.disabled = !ed.canRedo;
    undoB.title = ed.canUndo ? `Undo ${ed.undoLabel.toLowerCase()} (Ctrl+Z)` : 'Nothing to undo';
    redoB.title = ed.canRedo ? `Redo ${ed.redoLabel.toLowerCase()} (Ctrl+Shift+Z)` : 'Nothing to redo';
    dirty.hidden = !ed.dirty;
    const sel = ops.outermost(ed.doc, ed.selection);
    const first = sel[0] ? ops.find(ed.doc, sel[0])?.c : null;
    setText(selLabel, sel.length === 1 && first ? nameOf(first) : `${sel.length} parts`);
    groupB.hidden = sel.length < 2;
    ungroupB.hidden = !(sel.length === 1 && first && first.children.length);
    toolsBar.hidden = !ed.precise || !sel.length || ed.mode !== 'build';
    for (const b of toolsBar.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('active', b.dataset.tool === ed.tool);
    empty.hidden = ed.doc.components.length > 0 || ed.mode !== 'build';
    perf.el.hidden = measure(ed.doc).level === 'light';
    const path = ed.context ? [...ops.ancestors(ed.doc, ed.context), ed.context].map((id) => ops.find(ed.doc, id)?.c) : [];
    clear(crumbs);
    crumbs.hidden = !path.length;
    if (path.length) {
      crumbs.append(h('span', {}, 'Inside '), ...path.flatMap((c) => (c ? [h('b', {}, (c.props.name as string) || 'a group'), h('span', {}, ' ')] : [])), h('button', { class: 'btn ghost', type: 'button', onclick: () => ed.exit() }, '← Back out (Esc)'));
    }
  };
  const placeSelBar = () => {
    const at = ed.mode === 'build' && ed.selection.length ? ed.selectionScreen() : null;
    selBar.hidden = !at;
    if (!at) return;
    const w = selBar.offsetWidth || 320;
    const sw = st.el.clientWidth;
    // on a phone the panels slide up from the bottom: the bar keeps to the screen
    const l = narrow() ? 0 : ed.insets.left;
    const rr = narrow() ? 0 : ed.insets.right;
    const x = Math.max(l + 8, Math.min(sw - rr - w - 8, at.x - w / 2));
    // keep above a panel that has slid up from the bottom (phones)
    const sheet = narrow() && !(ui.classList.contains('fold-left') && ui.classList.contains('fold-right')) && window.innerWidth < 600;
    const floor = sheet ? st.el.clientHeight * 0.52 - 56 : st.el.clientHeight - 56;
    const y = Math.max(ed.insets.top + 6, Math.min(floor, at.y + 16));
    selBar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const onMode = () => {
    const testing = ed.mode === 'test';
    ui.hidden = testing;
    testBar.hidden = !testing;
    deps.shell.classList.toggle('bb-testing', testing);
    if (!testing) venueSel.value = 'workshop';
    inspector.refresh();
    sync();
  };
  off.push(
    ed.changed.on('doc', () => {
      setMacros(ed.doc.macros);
      if (!inspector.el.contains(document.activeElement)) inspector.refresh();
      layers.refresh();
      booth.refresh();
      perf.refresh();
      if (document.activeElement !== nameIn) nameIn.value = ed.doc.name;
      sync();
    }),
    ed.changed.on('selection', () => {
      inspector.refresh();
      layers.refresh();
      // picking a part shows its settings
      if (ed.selection.length && tab !== 'inspect') showTab('inspect');
      if (ed.selection.length && narrow() && ui.classList.contains('fold-right') && ui.classList.contains('fold-left')) ui.classList.remove('fold-right');
      sync();
    }),
    ed.changed.on('mode', onMode),
    ed.changed.on('drag', () => inspector.live()),
    deps.library.changed.on('list', () => palette.refresh()),
  );

  setMacros(ed.doc.macros);
  deps.shell.classList.add('building');
  st.el.append(ui, testBar);
  showTab('inspect');
  // the framing keeps the board clear of the panels
  const measureInsets = () => {
    const sr = st.canvas.getBoundingClientRect();
    const l = ui.classList.contains('fold-left') ? null : left.getBoundingClientRect();
    const r = ui.classList.contains('fold-right') ? null : right.getBoundingClientRect();
    const t = toolbar.getBoundingClientRect();
    const phone = window.innerWidth < 600;
    ed.insets = { left: !phone && l && l.width ? Math.max(0, l.right - sr.left) : 0, right: !phone && r && r.width ? Math.max(0, sr.right - r.left) : 0, top: Math.max(0, t.bottom - sr.top) };
    ui.style.setProperty('--bb-top', `${Math.round(t.height)}px`);
  };
  measureInsets();
  const ro = new ResizeObserver(measureInsets);
  ro.observe(st.el);
  ro.observe(toolbar);
  off.push(() => ro.disconnect());
  ed.start();
  onMode();
  showCoach();
  return {
    editor: ed,
    update: (dt) => {
      ed.update(dt);
      placeSelBar();
    },
    close: (keep) => ed.close(keep),
  };
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'board';

