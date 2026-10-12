/*
 * The crazy rooms' pads in the control registry, so the Show tab, the
 * keyboard (Settings → Keyboard can put them on keys) and MIDI learn can all
 * play the room: room.pad.1–6 are the room's own actions (held for the
 * hold ones), room.pad.7 and room.pad.8 recall scene slots A and B.
 */
import type { ControlRegistry } from '../core/controls';
import { loadScenes, roomShow } from '../three/venues/rooms/kit';

export const ROOM_PADS = 8;

/** recall one of the room's scene slots (false: it's empty, or no room) */
export function recallScene(slot: number): boolean {
  const r = roomShow.current;
  if (!r) return false;
  const sc = loadScenes(r.roomId, r.modes.length)[slot];
  if (!sc) return false;
  r.setLook(sc);
  return true;
}

export function registerRoomControls(reg: ControlRegistry): void {
  let sceneFlash = 0;
  for (let i = 1; i <= ROOM_PADS; i++) {
    const action = () => (i <= 6 ? roomShow.current?.actions[i - 1] ?? null : null);
    reg.register({
      id: `room.pad.${i}`,
      label: i <= 6 ? `Room pad ${i} (the room's action)` : `Room: recall scene ${i === 7 ? 'A' : 'B'}`,
      kind: 'button',
      press: () => {
        const a = action();
        if (a) roomShow.press(a.id);
        else if (i > 6 && recallScene(i - 7)) sceneFlash = performance.now();
      },
      release: () => {
        const a = action();
        if (a) roomShow.release(a.id);
      },
      lit: () => {
        const a = action();
        if (a) return roomShow.current?.active(a.id) ? '#ff2e88' : false;
        return i > 6 && performance.now() - sceneFlash < 400 ? '#3dd6ff' : false;
      },
    });
  }
}
