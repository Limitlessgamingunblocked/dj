/*
 * The stutter log (the debug menu shows it): every frame that took longer
 * than 50 ms to come round, with what the frame before it spent its time on.
 * The app's frame loop times its main parts (the 3D stage, the panels, the
 * gig, the audio side), and code that does known heavy work notes it as it
 * happens (a venue built, shaders compiled, a track decoded), so a hitch
 * comes with a likely cause instead of a guess. Frames after the tab was
 * hidden aren't hitches and are left out.
 */

export interface Stutter {
  /** wall-clock time (ms since the epoch) */
  at: number;
  /** how long the frame took to come round */
  ms: number;
  /** of that, the frame before's own work (the rest is the browser: drawing on the GPU, garbage collection, other tabs) */
  work: number;
  /** the frame's biggest parts, longest first */
  parts: [string, number][];
  /** heavy work noted during it */
  notes: string[];
}

/** longer than this between frames is a hitch (three missed frames at 60 Hz) */
export const STUTTER_MS = 50;
/** longer than this is a pause (a hidden tab, a debugger, a sleeping laptop), not a hitch */
const PAUSE_MS = 2000;
const KEEP = 40;

export class StutterLog {
  readonly items: Stutter[] = [];
  private parts = new Map<string, number>();
  private notes: string[] = [];
  private prev: { work: number; parts: Map<string, number>; notes: string[] } | null = null;
  private listeners = new Set<() => void>();

  /** a frame begins: `gapMs` since the last one; log it if the last frame ran long */
  frame(gapMs: number, hidden: boolean, now = Date.now()): Stutter | null {
    const p = this.prev;
    if (!p || hidden || gapMs <= STUTTER_MS || gapMs > PAUSE_MS) return null;
    const parts = [...p.parts].filter(([, ms]) => ms >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const s: Stutter = { at: now, ms: Math.round(gapMs), work: Math.round(p.work), parts: parts.map(([k, v]) => [k, Math.round(v)]), notes: [...new Set(p.notes)] };
    this.items.unshift(s);
    if (this.items.length > KEEP) this.items.length = KEEP;
    for (const fn of this.listeners) fn();
    return s;
  }

  /** time spent on one part of this frame (adds up if a part runs twice) */
  part(name: string, ms: number): void {
    this.parts.set(name, (this.parts.get(name) ?? 0) + ms);
  }

  /** heavy work happening now ("venue build", "shader compile") */
  note(label: string): void {
    if (this.notes.length < 12) this.notes.push(label);
  }

  /** the frame's work is done: keep it for the next frame to judge */
  end(workMs: number): void {
    this.prev = { work: workMs, parts: this.parts, notes: this.notes };
    this.parts = new Map();
    this.notes = [];
  }

  clear(): void {
    this.items.length = 0;
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** one line of the log: "21:04:13  84 ms · stage 52 · panels 9 · venue build · outside 23" */
export function stutterLine(s: Stutter): string {
  const d = new Date(s.at);
  const clock = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  const outside = s.ms - s.work;
  const bits = [...s.parts.map(([k, v]) => `${k} ${v}`), ...s.notes, outside >= 20 ? `outside ${outside}` : ''].filter(Boolean);
  return `${clock}  ${s.ms} ms${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
}

/** the app's log */
export const stutters = new StutterLog();

/** note heavy work for the stutter log */
export function noteWork(label: string): void {
  stutters.note(label);
}
