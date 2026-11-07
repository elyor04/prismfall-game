import { useEffect, useRef, useState } from "react";

const ARM_MS = 450;

interface Props {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A destructive action that needs a second, deliberate press. The confirm
 * button is a different element (distinct key) and ignores presses for a
 * moment, so a double-click or a held Enter can never skip the confirmation.
 *
 * It cancels when focus moves to another control or the player presses
 * anywhere else. It does not cancel on a bare blur: WebKit (macOS, iOS) does
 * not focus buttons on click, so pressing the confirm button itself blurs it
 * and would otherwise unmount it before the click lands.
 */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = "btn", style }: Props) {
  const [asking, setAsking] = useState(false);
  const shownAt = useRef(0);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!asking) return;
    shownAt.current = performance.now();
    ref.current?.focus({ preventScroll: true });
    const onOutside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAsking(false);
    };
    window.addEventListener("pointerdown", onOutside, true);
    return () => window.removeEventListener("pointerdown", onOutside, true);
  }, [asking]);

  if (!asking) {
    return (
      <button key="ask" className={className} style={style} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <button
      key="confirm"
      ref={ref}
      className="btn danger"
      style={style}
      // Keep focus where it is while pressing, so the press cannot blur us away.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        if (e.detail > 1 || performance.now() - shownAt.current < ARM_MS) return;
        onConfirm();
      }}
      onKeyDown={(e) => {
        if (e.repeat) e.preventDefault();
      }}
      onBlur={(e) => {
        // Tab / gamepad moved focus to another control: cancel.
        if (e.relatedTarget) setAsking(false);
      }}
    >
      {confirmLabel}
    </button>
  );
}
