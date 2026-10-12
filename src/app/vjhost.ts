/*
 * The deck's side of VJ mode: hear the VJ (another window over a
 * BroadcastChannel, or a paired device over WebRTC) and play their moves on
 * the show: pads (lights, sky, the room's pads), the visual mode (held so
 * the auto VJ leaves it), the palette and crowd moments. Four times a second
 * it tells the VJ what's going on: the modes, what's lit, the track, the vibe.
 */
import type { ControlRegistry } from '../core/controls';
import { crowdShow, CROWD_MOMENTS, type CrowdMomentId } from '../three/venues/crowdShow';
import { roomShow } from '../three/venues/rooms/kit';
import { PALETTES, type PaletteId } from '../three/venues/show';
import type { Visualizer } from '../visualizer/Visualizer';
import { Visualizer as Vis } from '../visualizer/Visualizer';
import { windowLink, type VjLink, type VjMsg, type VjState } from './vjlink';

const PADS: [string, string][] = [
  ['light.strobe', 'Strobe'],
  ['light.blinder', 'Blinders'],
  ['light.lasers', 'Lasers'],
  ['light.blackout', 'Blackout'],
  ['light.co2', 'CO2'],
  ['light.pyro', 'Pyro'],
  ['light.confetti', 'Confetti'],
  ['sky.fireworks', 'Fireworks'],
  ['sky.drones', 'Drones'],
  ['fun.airhorn', 'Air horn'],
];

export interface VjHostHooks {
  reg: ControlRegistry;
  visualizer: Visualizer;
  palette(): string;
  setPalette(id: PaletteId): void;
  track(): string;
  bpm(): number;
  vibe(): number;
  venue(): string;
  /** a VJ joined or left */
  changed(count: number): void;
}

export class VjHost {
  private links: VjLink[] = [];
  private live = new Set<VjLink>();
  private t = 0;

  constructor(private hooks: VjHostHooks) {
    const w = windowLink();
    if (w) this.attach(w);
  }

  /** a new link (a paired device) */
  attach(link: VjLink): void {
    this.links.push(link);
    if (link.kind === 'device') {
      this.live.add(link);
      this.hooks.changed(this.live.size);
    }
    link.onMessage((m) => this.hear(link, m));
  }

  get connected(): number {
    return this.live.size;
  }

  private hear(link: VjLink, m: VjMsg): void {
    const h = this.hooks;
    if (!this.live.has(link)) {
      this.live.add(link);
      h.changed(this.live.size);
    }
    switch (m.t) {
      case 'press':
        h.reg.press(m.id, 'ui');
        break;
      case 'release':
        h.reg.release(m.id, 'ui');
        break;
      case 'mode':
        h.visualizer.vjHold = true;
        h.visualizer.setMode(m.id);
        break;
      case 'hold':
        h.visualizer.vjHold = m.on;
        break;
      case 'palette':
        if (PALETTES.some((p) => p.id === m.id)) h.setPalette(m.id as PaletteId);
        break;
      case 'moment':
        if (crowdShow.moment?.id === m.id) crowdShow.stop();
        else if (CROWD_MOMENTS.some((x) => x.id === m.id)) crowdShow.start(m.id as CrowdMomentId);
        break;
      default:
        break;
    }
    if (m.t !== 'state') this.t = 1;
  }

  private state(): VjState {
    const h = this.hooks;
    const pads = PADS.map(([id, label]) => ({ id, label, lit: litColor(h.reg.lit(id)) }));
    const room = roomShow.current;
    if (room) room.actions.slice(0, 6).forEach((a, i) => pads.push({ id: `room.pad.${i + 1}`, label: a.label, lit: litColor(h.reg.lit(`room.pad.${i + 1}`)) }));
    return {
      modes: Vis.modeInfo().map((m) => ({ id: m.id, name: m.name, energy: m.energy })),
      mode: h.visualizer.modeId,
      hold: h.visualizer.vjHold,
      pads,
      palettes: PALETTES.map((p) => ({ id: p.id, name: p.name })),
      palette: h.palette(),
      moments: CROWD_MOMENTS.map((m) => ({ id: m.id, label: m.label, on: crowdShow.moment?.id === m.id })),
      track: h.track(),
      bpm: Math.round(h.bpm()),
      vibe: h.vibe(),
      venue: h.venue(),
    };
  }

  update(dt: number): void {
    if (!this.links.length) return;
    this.t += dt;
    if (this.t < 0.25) return;
    this.t = 0;
    const msg: VjMsg = { t: 'state', s: this.state() };
    for (const l of this.links) l.send(msg);
  }
}

function litColor(v: unknown): string | false {
  if (!v) return false;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && typeof (v as { color?: unknown }).color === 'string') return (v as { color: string }).color;
  return '#ffffff';
}
