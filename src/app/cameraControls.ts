/*
 * Camera controls in the control registry, so the camera pad in board full
 * screen, the keyboard and MIDI (learn) can all move the camera:
 *   cam.left / cam.right    orbit round the board (hold)
 *   cam.raise / cam.lower   more from above / lower down (hold)
 *   cam.in / cam.out        zoom (hold)
 *   cam.next                the next camera angle
 *   cam.reset               back to the board view (in board full screen) or the chosen view
 */
import type { ControlRegistry } from '../core/controls';
import type { CameraRig } from '../three/CameraRig';

export function registerCameraControls(reg: ControlRegistry, rig: CameraRig, actions: { next(): void; reset(): void }): void {
  const hold = (id: string, label: string, axis: keyof CameraRig['move'], dir: 1 | -1) =>
    reg.register({
      id,
      label,
      kind: 'button',
      press: () => {
        rig.move[axis] = dir;
      },
      release: () => {
        // a second key held the other way keeps going
        if (rig.move[axis] === dir) rig.move[axis] = 0;
      },
      lit: () => (rig.move[axis] === dir ? '#6fd6ff' : false),
    });
  hold('cam.left', 'Camera: orbit left (hold)', 'yaw', -1);
  hold('cam.right', 'Camera: orbit right (hold)', 'yaw', 1);
  hold('cam.raise', 'Camera: look more from above (hold)', 'pitch', 1);
  hold('cam.lower', 'Camera: look from lower down (hold)', 'pitch', -1);
  hold('cam.in', 'Camera: zoom in (hold)', 'zoom', 1);
  hold('cam.out', 'Camera: zoom out (hold)', 'zoom', -1);
  reg.register({ id: 'cam.next', label: 'Camera: next angle', kind: 'button', press: () => actions.next() });
  reg.register({ id: 'cam.reset', label: 'Camera: back to the board view', kind: 'button', press: () => actions.reset() });
}
