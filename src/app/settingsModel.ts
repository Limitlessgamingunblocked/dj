/* The app's saved layout and stage settings (the user preferences are in core/prefs.ts). */
import type { FaderCurve } from '../audio/Channel';
import type { ViewId } from '../three/CameraRig';
import type { Quality, StageView } from '../three/Stage';
import type { ShowControls } from '../three/venues/show';
import type { VisSettings } from '../visualizer/Visualizer';

export interface Settings {
  board: string;
  finish: string;
  venue: string;
  view: StageView;
  camera: ViewId;
  quality: Quality;
  /** Simple shows the essentials on the deck panels; Pro shows everything */
  uiMode: 'simple' | 'pro';
  /** step the render load down / up automatically to keep frames smooth */
  autoQuality: boolean;
  autoGain: boolean;
  faderCurve: FaderCurve;
  dockHeight: number;
  tab: string;
  vis: Partial<VisSettings>;
  focus: boolean;
  /** board full screen framing */
  boardFraming?: 'top' | 'perf';
  reactiveLights: boolean;
  autoZoom: boolean;
  stickers: boolean;
  lights: Partial<ShowControls>;
}

export const DEFAULTS: Settings = {
  board: 'club4',
  finish: 'booth',
  venue: 'dc10',
  view: 'booth',
  camera: 'perf',
  quality: 'medium',
  uiMode: 'simple',
  autoQuality: true,
  autoGain: true,
  faderCurve: 'log',
  dockHeight: 0,
  tab: 'library',
  vis: {},
  focus: false,
  reactiveLights: true,
  autoZoom: true,
  stickers: true,
  lights: {},
};

/**
 * Saved settings over the defaults, keeping only fields the app knows with the
 * type it expects (an old version's or a hand-edited file can't break startup).
 */
export function cleanSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULTS, vis: {}, lights: {} };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const v = r[k];
    if (v === undefined || v === null) continue;
    const want = typeof DEFAULTS[k];
    if (want === 'object' ? typeof v === 'object' && !Array.isArray(v) : typeof v === want) (out as unknown as Record<string, unknown>)[k] = v;
  }
  if (r.boardFraming === 'top' || r.boardFraming === 'perf') out.boardFraming = r.boardFraming;
  const custom = out.lights.custom as unknown;
  if (custom !== undefined && !(Array.isArray(custom) && custom.length === 3 && custom.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)))) delete out.lights.custom;
  return out;
}
