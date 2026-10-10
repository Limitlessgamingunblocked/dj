/*
 * Playing through a DJ controller's own sound card: the output device the mix
 * goes to (kept between visits) and whether the headphone cue goes to outputs
 * 3/4, where controllers like the DDJ-REV5 wire their headphone jack.
 */
import type { Mixer } from '../audio/Mixer';
import { loadSetting, saveSetting } from '../core/settings';

export interface SoundCardSetting {
  /** '' = the system default */
  device: string;
  /** its name when it was picked, to find it again if its id changes */
  label: string;
  quad: boolean;
}

const KEY = 'soundCard';

export function loadSoundCard(): SoundCardSetting {
  const s = loadSetting<Partial<SoundCardSetting>>(KEY, {});
  return { device: typeof s.device === 'string' ? s.device : '', label: typeof s.label === 'string' ? s.label : '', quad: s.quad === true };
}

export function saveSoundCard(s: SoundCardSetting): void {
  saveSetting(KEY, s);
}

export interface OutputInfo {
  deviceId: string;
  label: string;
}

export async function listOutputs(): Promise<OutputInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

/**
 * Device names stay hidden until the page may use a microphone (a browser
 * privacy rule). Asks once, then lets the microphone go straight away.
 */
export async function revealNames(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of s.getTracks()) t.stop();
    return true;
  } catch {
    return false;
  }
}

/** the controller's output among the devices: its name contains the board's model ('DDJ-REV5' → "Speakers (DDJ-REV5)") */
export function pickOutput(devs: OutputInfo[], model: string): OutputInfo | null {
  const want = model.replace(/[\s-]+/g, '').toLowerCase();
  if (!want) return null;
  return devs.find((d) => d.label.replace(/[\s-]+/g, '').toLowerCase().includes(want)) ?? null;
}

/** at start: back on the sound card picked last time, if it's still there */
export async function restoreSoundCard(mixer: Mixer): Promise<string | null> {
  const s = loadSoundCard();
  if (!s.device) return null;
  let id = s.device;
  let n = await mixer.setOutputDevice(id);
  if (n === null && s.label) {
    // its id changed (new USB port, cleared site data): find it by name
    const again = (await listOutputs().catch(() => [])).find((d) => d.label === s.label);
    if (again) {
      id = again.deviceId;
      n = await mixer.setOutputDevice(id);
      if (n !== null) saveSoundCard({ ...s, device: id });
    }
  }
  if (n === null) return `${s.label || 'Your sound card'} isn’t connected, so the game is playing through the default output.`;
  if (s.quad && !mixer.setQuadPhones(true)) return 'Headphones on outputs 3/4 are off: this output has only two.';
  return null;
}
