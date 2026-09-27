/*
 * Lighting desk controls in the control registry, so the Lights panel, the
 * keyboard and MIDI (learn) can all fire them:
 *   light.strobe / light.blinder / light.lasers / light.blackout  (hold)
 *   light.co2 / light.pyro (hit), light.auto / light.dropfx / light.autopyro (toggle)
 */
import type { ControlRegistry } from '../core/controls';
import type { LightShow } from '../three/venues/show';

export function registerLightControls(reg: ControlRegistry, show: LightShow, changed: () => void): void {
  const c = show.controls;
  let co2Flash = 0;
  let pyroFlash = 0;
  const hold = (id: string, label: string, key: 'strobeHold' | 'blinderHold' | 'laserHold' | 'blackoutHold', color: string) =>
    reg.register({
      id,
      label,
      kind: 'button',
      press: () => (c[key] = true),
      release: () => (c[key] = false),
      lit: () => (c[key] ? color : false),
    });
  hold('light.strobe', 'Lights: strobe (hold)', 'strobeHold', '#ffffff');
  hold('light.blinder', 'Lights: blinders (hold)', 'blinderHold', '#ffb347');
  hold('light.lasers', 'Lights: lasers (hold)', 'laserHold', '#3dff7a');
  hold('light.blackout', 'Lights: blackout (hold)', 'blackoutHold', '#ff3b5c');
  reg.register({
    id: 'light.co2',
    label: 'Lights: CO2 cannons',
    kind: 'button',
    press: () => {
      show.fireCo2();
      co2Flash = performance.now();
    },
    lit: () => (performance.now() - co2Flash < 600 ? '#bfe8ff' : false),
  });
  reg.register({
    id: 'light.pyro',
    label: 'Lights: pyro (flame jets / cold sparks)',
    kind: 'button',
    press: () => {
      show.firePyro();
      pyroFlash = performance.now();
    },
    lit: () => (performance.now() - pyroFlash < 900 ? '#ff7a1a' : false),
  });
  reg.register({
    id: 'light.autopyro',
    label: 'Lights: pyro on drops',
    kind: 'button',
    press: () => {
      c.pyro = !c.pyro;
      changed();
    },
    lit: () => (c.pyro ? '#ff7a1a' : false),
  });
  reg.register({
    id: 'light.auto',
    label: 'Lights: follow the music',
    kind: 'button',
    press: () => {
      c.auto = !c.auto;
      changed();
    },
    lit: () => (c.auto ? '#3ddc97' : false),
  });
  reg.register({
    id: 'light.dropfx',
    label: 'Lights: drop FX (strobe, blinders, CO2 on drops)',
    kind: 'button',
    press: () => {
      c.dropFx = !c.dropFx;
      changed();
    },
    lit: () => (c.dropFx ? '#ffd23f' : false),
  });
}
