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
  /** the camera angle board full screen opens with (the last one picked there) */
  boardFraming?: ViewId;
  /** the board view the camera pad's ⌂ goes back to: Top-down or Angled, whichever was picked last */
  boardHome?: 'top' | 'perf';
  /** the camera pad shows in board full screen (it can be folded away) */
  camPad: boolean;
  /** the auto director cuts the camera with the music */
  director: boolean;
  /** frame rate shown over the stage */
  fpsMeter: boolean;
  /** the track on each deck when the page closed (deck number → track id), loaded again on start */
  lastTracks: Record<string, string>;
  reactiveLights: boolean;
  autoZoom: boolean;
  stickers: boolean;
  lights: Partial<ShowControls>;
  /** the player chose "Later" at the naming scene: don't open it by itself again */
  namingLater: boolean;
  /** the recording studio's settings (checked by app/recording.ts → cleanRecord) */
  record: Record<string, unknown>;
  /** the replay buffer: length in minutes (0 off) and whether it keeps video */
  replay: Record<string, unknown>;
}

export const DEFAULTS: Settings = {
  // new players start on a two-deck all-in-one: two decks, one screen, nothing to switch
  board: 'aio2',
  finish: 'black',
  venue: 'bedroom',
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
  camPad: true,
  director: false,
  fpsMeter: false,
  lastTracks: {},
  namingLater: false,
  record: {},
  replay: {},
};

const VIEW_IDS: ViewId[] = ['top', 'perf', 'booth', 'wide', 'crowd', 'fisheye', 'crane', 'rig', 'cctv', 'camcorder', 'vertigo', 'drone'];

/**
 * Saved settings over the defaults, keeping only fields the app knows with the
 * type it expects (an old version's or a hand-edited file can't break startup).
 */
export function cleanSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULTS, vis: {}, lights: {}, lastTracks: {}, record: {}, replay: {} };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const v = r[k];
    if (v === undefined || v === null) continue;
    const want = typeof DEFAULTS[k];
    if (want === 'object' ? typeof v === 'object' && !Array.isArray(v) : typeof v === want) (out as unknown as Record<string, unknown>)[k] = v;
  }
  if (VIEW_IDS.includes(r.boardFraming as ViewId)) out.boardFraming = r.boardFraming as ViewId;
  if (!VIEW_IDS.includes(out.camera)) out.camera = DEFAULTS.camera;
  out.lastTracks = Object.fromEntries(Object.entries(out.lastTracks).filter(([k, v]) => /^[1-4]$/.test(k) && typeof v === 'string' && v.length < 200));
  if (r.boardHome === 'top' || r.boardHome === 'perf') out.boardHome = r.boardHome;
  const custom = out.lights.custom as unknown;
  if (custom !== undefined && !(Array.isArray(custom) && custom.length === 3 && custom.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)))) delete out.lights.custom;
  return out;
}
