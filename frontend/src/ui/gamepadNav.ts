import { useEffect, useRef } from "react";

// Gamepad navigation for every menu that has no gamepad handling of its own
// (the level-up screen has its own). D-pad or left stick moves focus to the
// nearest control in that direction, A activates it, B goes back. On a
// focused slider, left/right change its value instead of moving focus.

type Dir = "up" | "down" | "left" | "right";

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex="0"]';

/** The top-most open menu surface; overlays render after the title screen. */
function activeRoot(): HTMLElement | null {
  const roots = document.querySelectorAll<HTMLElement>(".scrim, .screen, .title-screen");
  return roots.length ? roots[roots.length - 1] : null;
}

function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null && !el.closest("[inert]"));
}

function markGamepad() {
  document.documentElement.classList.add("gamepad-nav");
}

function stepSlider(el: HTMLInputElement, dir: 1 | -1) {
  if (dir > 0) el.stepUp();
  else el.stepDown();
  // React tracks the value set through the property setter; stepUp/stepDown
  // bypass it, so dispatching `input` makes React see the change.
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function move(dir: Dir) {
  const root = activeRoot();
  if (!root) return;
  const items = focusables(root);
  if (!items.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (cur instanceof HTMLInputElement && cur.type === "range" && (dir === "left" || dir === "right") && items.includes(cur)) {
    stepSlider(cur, dir === "right" ? 1 : -1);
    return;
  }
  if (!cur || !items.includes(cur)) {
    items[0].focus();
    return;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    const primary = dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
    if (primary <= 4) continue;
    const cross = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
    const score = primary + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: "nearest" });
  }
}

function activate() {
  const root = activeRoot();
  if (!root) return;
  const cur = document.activeElement as HTMLElement | null;
  const items = focusables(root);
  if (cur && items.includes(cur)) {
    if (!(cur instanceof HTMLInputElement)) cur.click();
  } else if (items[0]) {
    items[0].focus();
  }
}

export function useGamepadMenus(active: boolean, onBack: () => void) {
  const back = useRef(onBack);
  back.current = onBack;

  // Hide the gamepad focus ring again as soon as the mouse or touch is used.
  useEffect(() => {
    const off = () => document.documentElement.classList.remove("gamepad-nav");
    window.addEventListener("pointerdown", off);
    window.addEventListener("mousemove", off);
    return () => {
      window.removeEventListener("pointerdown", off);
      window.removeEventListener("mousemove", off);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let prev: boolean[] | null = null;
    let lastDir: Dir | "" = "";
    let repeatAt = 0;
    const poll = (now: number) => {
      raf = requestAnimationFrame(poll);
      const pad = navigator.getGamepads?.().find((p) => p && p.connected);
      if (!pad) {
        prev = null;
        return;
      }
      const b = pad.buttons.map((x) => x.pressed);
      // Buttons already held when the menu appears are ignored until released.
      if (prev === null) {
        prev = b;
        return;
      }
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const dir: Dir | "" = b[12] || ay < -0.6 ? "up" : b[13] || ay > 0.6 ? "down" : b[14] || ax < -0.6 ? "left" : b[15] || ax > 0.6 ? "right" : "";
      if (dir && (dir !== lastDir || now >= repeatAt)) {
        markGamepad();
        move(dir);
        repeatAt = now + (dir !== lastDir ? 420 : 140);
      }
      lastDir = dir;
      if (b[0] && !prev[0]) {
        markGamepad();
        activate();
      }
      if (b[1] && !prev[1]) back.current();
      prev = b;
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}
