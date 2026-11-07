import { CSSProperties, useEffect, useRef, useState } from "react";
import type { Choice } from "../game/engine";
import { MAX_WEAPON_LEVEL, PASSIVES, PassiveId } from "../game/content";
import { I18n, useI18n } from "../i18n";
import { Icon, Pips } from "./common";

interface Props {
  level: number;
  choices: Choice[];
  rerolls: number;
  onPick: (i: number) => void;
  onReroll: () => void;
}

const ARM_MS = 350;

/** Name and description for a level-up choice, in the current language. */
function choiceText(i18n: I18n, c: Choice): { name: string; text: string } {
  const { t, td } = i18n;
  switch (c.kind) {
    case "weapon":
      return { name: td(`weapon.${c.id}`), text: td(c.isNew ? `weapon.${c.id}.blurb` : `weapon.${c.id}.${c.level}`) };
    case "passive":
      return { name: td(`passive.${c.id}`), text: td(`passive.${c.id}.text`) };
    case "heal":
      return { name: t("choice.repair"), text: t("choice.repairText") };
    default:
      return { name: t("choice.cache"), text: t("choice.cacheText") };
  }
}

export function LevelUp({ level, choices, rerolls, onPick, onReroll }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  // `focus` always mirrors the card that has real DOM focus, so the highlight,
  // the focus ring, Enter, and gamepad A all act on the same card.
  const [focus, setFocus] = useState(-1);
  const [armed, setArmed] = useState(false);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const armedRef = useRef(false);
  armedRef.current = armed;

  // Ignore input for a beat so a held key or a tap meant for the game doesn't pick blindly.
  useEffect(() => {
    setArmed(false);
    setFocus(-1);
    const id = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(id);
  }, [choices]);

  const focusCard = (i: number) => cards.current[i]?.focus({ preventScroll: true });

  // Latest callbacks in refs so parent re-renders never re-register input.
  const cb = useRef({ onPick, onReroll, rerolls, count: choices.length });
  cb.current = { onPick, onReroll, rerolls, count: choices.length };

  useEffect(() => {
    if (!armed) return;
    const current = () => cards.current.findIndex((el) => el === document.activeElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return; // held movement keys must not drive the menu
      const { count, rerolls: r } = cb.current;
      // Physical keys, so digits and R work on any keyboard layout.
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      const n = digit ? Number(digit[1]) : 0;
      const i = current();
      if (n >= 1 && n <= count) cb.current.onPick(n - 1);
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        focusCard(i < 0 ? 0 : (i + 1) % count);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        focusCard(i <= 0 ? count - 1 : i - 1);
      } else if (e.code === "KeyR" && r > 0) cb.current.onReroll();
      // Enter is handled natively: it clicks the focused card.
    };
    window.addEventListener("keydown", onKey);

    // Gamepad: stick or d-pad to move, A to confirm, Y to reroll. Buttons
    // already held when the menu arms are ignored until released.
    const firstPad = navigator.getGamepads?.().find((p) => p);
    let prev: boolean[] = firstPad ? firstPad.buttons.map((x) => x.pressed) : [];
    let prevDir = 1;
    let raf = 0;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pad = navigator.getGamepads?.().find((p) => p);
      if (!pad) return;
      const b = pad.buttons.map((x) => x.pressed);
      // Use the stick's dominant axis so a diagonal push still moves.
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      const x = (Math.abs(ax) >= Math.abs(ay) ? ax : ay) + (b[15] || b[13] ? 1 : 0) - (b[14] || b[12] ? 1 : 0);
      const dir = x > 0.6 ? 1 : x < -0.6 ? -1 : 0;
      const { count, rerolls: r } = cb.current;
      if (dir !== 0 && prevDir === 0) {
        document.documentElement.classList.add("gamepad-nav");
        const i = current();
        focusCard(i < 0 ? 0 : (i + dir + count) % count);
      }
      prevDir = dir;
      if (b[0] && !prev[0]) {
        const i = current();
        if (i >= 0) cb.current.onPick(i);
        else focusCard(0);
      }
      if (b[3] && !prev[3] && r > 0) cb.current.onReroll();
      prev = b;
    };
    raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, [armed]);

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="lvl-title">
      <div className="levelup">
        <h2 id="lvl-title">{t("levelup.title", { n: level })}</h2>
        <p className="lede">{t("levelup.lede")}</p>
        <div className="cards">
          {choices.map((c, i) => {
            const { name, text } = choiceText(i18n, c);
            const max = c.kind === "weapon" ? MAX_WEAPON_LEVEL : c.kind === "passive" ? PASSIVES[c.id as PassiveId].max : 0;
            return (
              <button
                key={`${c.kind}-${c.id}-${i}`}
                ref={(el) => {
                  cards.current[i] = el;
                }}
                className={`card${focus === i ? " focused" : ""}`}
                style={{ "--c": c.color } as CSSProperties}
                onClick={() => armedRef.current && onPick(i)}
                onFocus={() => setFocus(i)}
                onBlur={() => setFocus((f) => (f === i ? -1 : f))}
                onMouseEnter={() => focusCard(i)}
                // Space is the dash key: it must never pick a card.
                onKeyDown={(e) => {
                  if (e.key === " ") e.preventDefault();
                }}
                onKeyUp={(e) => {
                  if (e.key === " ") e.preventDefault();
                }}
              >
                <div className="glyph">
                  <Icon d={c.icon} />
                </div>
                {c.isNew && <span className="tag">{t("levelup.new")}</span>}
                {c.isMax && <span className="tag">{t("levelup.max")}</span>}
                <h3>{name}</h3>
                <p>{text}</p>
                {max > 0 && <Pips level={c.level} max={max} next color={c.color} />}
                <span className="key kbd hide-mobile">{i + 1}</span>
              </button>
            );
          })}
        </div>
        {rerolls > 0 && (
          <div className="levelup-foot">
            <button className="btn" onClick={() => armedRef.current && onReroll()}>
              {t("levelup.reroll", { n: rerolls })}
              <span className="kbd hide-mobile">R</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
