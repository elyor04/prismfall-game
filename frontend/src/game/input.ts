// Unified input: keyboard, gamepad, and a floating virtual joystick that
// works with touch and mouse-drag. The engine only ever reads `move`,
// `consumeDash()` and `consumePause()`.

export type InputMode = "keyboard" | "touch" | "gamepad";

const JOY_RADIUS = 56; // CSS pixels

// Physical key codes (e.code), so controls work on any keyboard layout:
// on a Russian layout the W key reports "ц" as e.key but "KeyW" as e.code.
const LEFT = ["KeyA", "ArrowLeft"];
const RIGHT = ["KeyD", "ArrowRight"];
const UP = ["KeyW", "ArrowUp"];
const DOWN = ["KeyS", "ArrowDown"];
const DASH = ["Space", "ShiftLeft", "ShiftRight", "KeyK"];
const PAUSE = ["Escape", "KeyP"];
const DEAD = 0.12;

export interface Joystick {
  active: boolean;
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

export class Input {
  readonly keys = new Set<string>();
  readonly move = { x: 0, y: 0 };
  readonly joy: Joystick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  mode: InputMode = matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard";
  onModeChange: ((m: InputMode) => void) | null = null;

  private dash = false;
  private pause = false;
  private padPrev: boolean[] = [];
  private el: HTMLElement;
  private cleanup: (() => void)[] = [];

  constructor(el: HTMLElement) {
    this.el = el;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };

    on(window, "keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (DASH.includes(e.code)) this.dash = true;
      if (PAUSE.includes(e.code)) this.pause = true;
      this.setMode("keyboard");
    });
    on(window, "keyup", (e) => {
      this.keys.delete(e.code);
      // macOS swallows letter keyups while Cmd is held; drop everything then.
      if (e.key === "Meta") this.keys.clear();
    });
    on(window, "blur", () => {
      this.keys.clear();
      this.releaseJoy();
    });

    on(el, "pointerdown", (e) => {
      if (this.joy.active) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      this.joy.active = true;
      this.joy.id = e.pointerId;
      this.joy.ox = this.joy.x = e.clientX;
      this.joy.oy = this.joy.y = e.clientY;
      if (e.pointerType === "touch") this.setMode("touch");
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is best-effort; synthetic or already-released pointers throw */
      }
    });
    on(el, "pointermove", (e) => {
      if (!this.joy.active || e.pointerId !== this.joy.id) return;
      this.joy.x = e.clientX;
      this.joy.y = e.clientY;
      // Floating stick: drag the origin along when the finger overshoots.
      const dx = this.joy.x - this.joy.ox;
      const dy = this.joy.y - this.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_RADIUS) {
        this.joy.ox = this.joy.x - (dx / d) * JOY_RADIUS;
        this.joy.oy = this.joy.y - (dy / d) * JOY_RADIUS;
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.joy.id) this.releaseJoy();
    };
    on(el, "pointerup", end);
    on(el, "pointercancel", end);
    on(el, "contextmenu", (e) => e.preventDefault());
  }

  private releaseJoy() {
    this.joy.active = false;
    this.joy.id = -1;
  }

  private setMode(m: InputMode) {
    if (this.mode !== m) {
      this.mode = m;
      this.onModeChange?.(m);
    }
  }

  requestDash() {
    this.dash = true;
  }

  consumeDash() {
    const d = this.dash;
    this.dash = false;
    return d;
  }

  consumePause() {
    const p = this.pause;
    this.pause = false;
    return p;
  }

  /** Clear edge-triggered presses (e.g. when a menu closes). */
  flush() {
    this.dash = false;
    this.pause = false;
  }

  get joyRadius() {
    return JOY_RADIUS;
  }

  /** Recompute the movement vector. Call once per frame. */
  poll() {
    let x = 0;
    let y = 0;
    const held = (codes: string[]) => codes.some((c) => this.keys.has(c));
    if (held(LEFT)) x -= 1;
    if (held(RIGHT)) x += 1;
    if (held(UP)) y -= 1;
    if (held(DOWN)) y += 1;
    if (x !== 0 || y !== 0) {
      const l = Math.hypot(x, y);
      x /= l;
      y /= l;
    }

    if (this.joy.active) {
      const dx = (this.joy.x - this.joy.ox) / JOY_RADIUS;
      const dy = (this.joy.y - this.joy.oy) / JOY_RADIUS;
      const m = Math.min(1, Math.hypot(dx, dy));
      if (m > DEAD) {
        const a = Math.atan2(dy, dx);
        const mag = (m - DEAD) / (1 - DEAD);
        x = Math.cos(a) * mag;
        y = Math.sin(a) * mag;
      }
    }

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      const m = Math.hypot(ax, ay);
      if (m > 0.2) {
        const mag = Math.min(1, (m - 0.2) / 0.8);
        x = (ax / m) * mag;
        y = (ay / m) * mag;
        this.setMode("gamepad");
      }
      const b = p.buttons;
      const pressed = (i: number) => !!b[i]?.pressed;
      const dpadX = (pressed(15) ? 1 : 0) - (pressed(14) ? 1 : 0);
      const dpadY = (pressed(13) ? 1 : 0) - (pressed(12) ? 1 : 0);
      if (dpadX || dpadY) {
        const l = Math.hypot(dpadX, dpadY);
        x = dpadX / l;
        y = dpadY / l;
        this.setMode("gamepad");
      }
      const edge = (i: number) => pressed(i) && !this.padPrev[i];
      if (edge(0) || edge(5) || edge(7)) {
        this.dash = true;
        this.setMode("gamepad");
      }
      if (edge(9)) this.pause = true;
      this.padPrev = b.map((btn) => btn.pressed);
      break;
    }

    this.move.x = x;
    this.move.y = y;
  }

  destroy() {
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
  }

  get element() {
    return this.el;
  }
}
