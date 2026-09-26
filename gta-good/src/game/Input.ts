/** Keyboard and mouse state, with "pressed this frame" edges. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  /** Accumulated mouse drag since the last read (for camera orbit). */
  dragX = 0;
  dragY = 0;
  wheel = 0;
  private dragging = false;
  enabled = true;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const k = norm(e);
      if (['tab', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = norm(e);
      this.down.delete(k);
      this.released.add(k);
    });
    window.addEventListener('blur', () => this.down.clear());
    target.addEventListener('pointerdown', (e) => {
      if (e.button === 0 || e.button === 2) {
        this.dragging = true;
        target.setPointerCapture(e.pointerId);
      }
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.dragX += e.movementX;
      this.dragY += e.movementY;
    });
    const end = () => (this.dragging = false);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  isDown(...keys: string[]) {
    return this.enabled && keys.some((k) => this.down.has(k));
  }

  wasPressed(...keys: string[]) {
    return this.enabled && keys.some((k) => this.pressed.has(k));
  }

  wasReleased(...keys: string[]) {
    return keys.some((k) => this.released.has(k));
  }

  axis(neg: string[], pos: string[]) {
    return (this.isDown(...pos) ? 1 : 0) - (this.isDown(...neg) ? 1 : 0);
  }

  takeDrag() {
    const d = { x: this.dragX, y: this.dragY, wheel: this.wheel };
    this.dragX = this.dragY = this.wheel = 0;
    return d;
  }

  /** Call once per rendered frame after the game has read input. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }

  clear() {
    this.down.clear();
    this.pressed.clear();
  }
}

function norm(e: KeyboardEvent) {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
