/** Keyboard + mouse state with per-frame edge detection and pointer lock. */
export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.buttons = [false, false, false];
    this.pressedButtons = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.onLockChange = null;
    this.onKey = null;

    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      if (this.onKey) this.onKey(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());

    dom.addEventListener('mousedown', (e) => {
      if (e.button > 2) return;
      this.buttons[e.button] = true;
      this.pressedButtons[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button > 2) return;
      this.buttons[e.button] = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) this.releaseAll();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (this.locked) return;
    // Raw mouse input isn't supported everywhere; fall back to a plain lock. Chrome also
    // refuses a re-lock right after Esc, in which case the "click to play" prompt covers it.
    const plain = () => {
      const q = this.dom.requestPointerLock();
      if (q && q.catch) q.catch(() => {});
    };
    try {
      const p = this.dom.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(plain);
    } catch {
      plain();
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  releaseAll() {
    this.keys.clear();
    this.buttons = [false, false, false];
  }

  down(code) {
    return this.keys.has(code);
  }

  pressed(code) {
    return this.pressedKeys.has(code);
  }

  takeMouse() {
    const d = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  endFrame() {
    this.pressedKeys.clear();
    this.pressedButtons = [false, false, false];
    this.wheel = 0;
  }
}
