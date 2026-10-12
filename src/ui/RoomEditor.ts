/*
 * The Room editor: build your own crazy room from parts (walls, floor,
 * ceiling, extras), pick three colours and a size, name it, and it's saved as
 * a venue (three/venues/rooms/custom.ts). Up to eight rooms; each can be
 * edited, deleted or gone to straight away.
 */
import { CEILINGS, EXTRAS, FLOORS, MAX_CUSTOM_ROOMS, PART_LABEL, SIZES, WALLS, cleanRoomConfig, customVenueId, loadCustomRooms, saveCustomRooms, type CustomRoomConfig } from '../three/venues/rooms/custom';
import { registerCustomRooms } from '../three/venues';
import { h, setClass } from './dom';
import { openModal } from './modal';
import { toast } from './toast';
import { forgetThumb } from './VenuePicker';

export interface RoomEditorHooks {
  venueId(): string;
  setVenue(id: string): void;
  /** the venue list changed (venue cards redraw) */
  changed(): void;
}

const newId = () => Math.random().toString(36).slice(2, 10);

export function openRoomEditor(hooks: RoomEditorHooks, editId?: string): void {
  let rooms = loadCustomRooms();
  const start = rooms.find((r) => r.id === editId);
  let cfg: CustomRoomConfig = start ? { ...start, extras: [...start.extras] } : cleanRoomConfig({ id: newId(), name: `Room ${rooms.length + 1}` });

  const chips = <T extends string>(label: string, list: readonly T[], get: () => T, set: (v: T) => void) => {
    const row = h('div', { class: 'gs-chips', role: 'radiogroup', 'aria-label': label });
    const btns = list.map((v) => {
      const b = h('button', { type: 'button', class: 'gs-chip', role: 'radio' }, PART_LABEL[v] ?? v);
      b.addEventListener('click', () => {
        set(v);
        sync();
      });
      row.append(b);
      return { b, v };
    });
    const sync = () => btns.forEach(({ b, v }) => (setClass(b, 'active', v === get()), b.setAttribute('aria-checked', String(v === get()))));
    sync();
    return h('section', {}, h('h3', {}, label), row);
  };
  const extras = h('div', { class: 'gs-chips', role: 'group', 'aria-label': 'Extras' });
  for (const e of EXTRAS) {
    const b = h('button', { type: 'button', class: 'gs-chip', 'aria-pressed': 'false' }, PART_LABEL[e]);
    const sync = () => {
      const on = cfg.extras.includes(e);
      setClass(b, 'active', on);
      b.setAttribute('aria-pressed', String(on));
    };
    b.addEventListener('click', () => {
      cfg.extras = cfg.extras.includes(e) ? cfg.extras.filter((x) => x !== e) : [...cfg.extras, e];
      sync();
    });
    sync();
    extras.append(b);
  }
  const name = h('input', { type: 'text', value: cfg.name, maxlength: 28, 'aria-label': 'Room name' }) as HTMLInputElement;
  name.addEventListener('input', () => (cfg.name = name.value));
  const colours = h(
    'div',
    { class: 'toggle-row' },
    ...cfg.colors.map((c, i) => {
      const inp = h('input', { type: 'color', value: c, 'aria-label': `Colour ${i + 1}` }) as HTMLInputElement;
      inp.addEventListener('input', () => (cfg.colors[i] = inp.value));
      return inp;
    }),
  );
  const list = h('div', { class: 'room-list' });
  const drawList = () => {
    rooms = loadCustomRooms();
    list.replaceChildren(
      ...(rooms.length
        ? rooms.map((r) => {
            const go = h('button', { type: 'button', class: 'btn small' }, 'Go');
            go.addEventListener('click', () => {
              hooks.setVenue(customVenueId(r));
              m.close();
            });
            const edit = h('button', { type: 'button', class: 'btn ghost small' }, 'Edit');
            edit.addEventListener('click', () => {
              m.close();
              openRoomEditor(hooks, r.id);
            });
            const del = h('button', { type: 'button', class: 'btn ghost small' }, 'Delete');
            del.addEventListener('click', () => {
              if (hooks.venueId() === customVenueId(r)) hooks.setVenue('warehouse');
              saveCustomRooms(loadCustomRooms().filter((x) => x.id !== r.id));
              registerCustomRooms(loadCustomRooms());
              hooks.changed();
              drawList();
            });
            return h('div', { class: 'room-list-item', style: `--rc:${r.colors[0]}` }, h('b', {}, r.name), h('span', { class: 'note' }, `${PART_LABEL[r.walls]} · ${PART_LABEL[r.floor]} · ${PART_LABEL[r.ceiling]}`), go, edit, del);
          })
        : [h('p', { class: 'note' }, 'No rooms yet. Build one above.')]),
    );
  };
  const save = (go: boolean) => {
    const all = loadCustomRooms();
    const i = all.findIndex((r) => r.id === cfg.id);
    if (i < 0 && all.length >= MAX_CUSTOM_ROOMS) {
      toast(`You can keep ${MAX_CUSTOM_ROOMS} rooms. Delete one first.`);
      return;
    }
    const clean = cleanRoomConfig(cfg, cfg.id);
    if (i >= 0) all[i] = clean;
    else all.push(clean);
    saveCustomRooms(all);
    registerCustomRooms(loadCustomRooms());
    forgetThumb(customVenueId(clean));
    hooks.changed();
    toast(`${clean.name} saved`);
    // already standing in it: rebuild it with the new parts
    if (go || hooks.venueId() === customVenueId(clean)) {
      hooks.setVenue(customVenueId(clean));
      m.close();
    } else drawList();
  };
  const saveBtn = h('button', { type: 'button', class: 'btn' }, 'Save');
  saveBtn.addEventListener('click', () => save(false));
  const goBtn = h('button', { type: 'button', class: 'btn primary' }, 'Save and go there');
  goBtn.addEventListener('click', () => save(true));
  const content = h(
    'div',
    { class: 'gig-setup room-editor' },
    h('label', { class: 'field' }, 'Name', name),
    chips('Size', SIZES, () => cfg.size, (v) => (cfg.size = v)),
    chips('Walls', WALLS, () => cfg.walls, (v) => (cfg.walls = v)),
    chips('Floor', FLOORS, () => cfg.floor, (v) => (cfg.floor = v)),
    chips('Ceiling', CEILINGS, () => cfg.ceiling, (v) => (cfg.ceiling = v)),
    h('section', {}, h('h3', {}, 'Extras'), extras, h('p', { class: 'gs-note' }, 'The beam grid at body height is light, not lasers. Lasers always stay overhead.')),
    h('section', {}, h('h3', {}, 'Colours'), colours),
    h('div', { class: 'gs-actions' }, saveBtn, goBtn),
    h('section', {}, h('h3', {}, 'Your rooms'), list),
  );
  drawList();
  const m = openModal(start ? `Edit ${start.name}` : 'Build a room', content, { wide: true });
}
