/** localStorage-backed settings. Every access is guarded: storage can be unavailable. */
const PREFIX = 'deckhouse:';

export function loadSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveSetting<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, sandbox): settings stay in memory */
  }
}
