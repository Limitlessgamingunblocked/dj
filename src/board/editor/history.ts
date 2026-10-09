/*
 * Undo and redo for the Board Builder (Section 13.3): whole-board snapshots
 * (a board is small JSON), each with a label for the button's tooltip.
 */
export interface Step {
  label: string;
  state: string;
}

export class History {
  private past: Step[] = [];
  private future: Step[] = [];

  constructor(private limit = 150) {}

  /** call with the state from before a change */
  record(state: string, label: string): void {
    const last = this.past[this.past.length - 1];
    if (last && last.state === state) return;
    this.past.push({ label, state });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** the state to go back to (give it the current one so redo can return) */
  undo(current: string): Step | null {
    const p = this.past.pop();
    if (!p) return null;
    this.future.push({ label: p.label, state: current });
    return p;
  }

  redo(current: string): Step | null {
    const f = this.future.pop();
    if (!f) return null;
    this.past.push({ label: f.label, state: current });
    return f;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string {
    return this.past[this.past.length - 1]?.label ?? '';
  }

  get redoLabel(): string {
    return this.future[this.future.length - 1]?.label ?? '';
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
