import type { CSSProperties } from "react";
import type { HudState, Loadout } from "../game/engine";
import type { InputMode } from "../game/input";
import { formatTime } from "../game/math";
import { useI18n } from "../i18n";
import { Icon, ICONS } from "./common";

interface Props {
  hud: HudState;
  inputMode: InputMode;
  onPause: () => void;
  onDash: () => void;
}

export function Hud({ hud, inputMode, onPause, onDash }: Props) {
  const { t, td, num } = useI18n();
  const hpPct = Math.max(0, Math.min(1, hud.hp / hud.maxHp));
  const xpPct = Math.max(0, Math.min(1, hud.xp / hud.xpNext));
  const low = hpPct < 0.3 && hud.hp > 0;
  const slotTitle = (l: Loadout) => t("hud.slot", { name: td(`${l.kind}.${l.id}`), n: l.level });

  return (
    <>
      {low && <div className="vignette" />}
      <div className="layer hud">
        <div className="xpbar" role="progressbar" aria-label={t("hud.xp")} aria-valuenow={Math.round(xpPct * 100)}>
          <i style={{ width: `${xpPct * 100}%` }} />
        </div>
        <div className="hud-top">
          <div className="vitals">
            <div className="hp">
              <span className="lvl" aria-label={t("hud.levelAria", { n: hud.level })}>{t("hud.level", { n: hud.level })}</span>
              <div className="hpbar" role="progressbar" aria-label={t("hud.hull")} aria-valuenow={Math.round(hpPct * 100)}>
                <i style={{ width: `${hpPct * 100}%` }} />
              </div>
              <span className="hptext hide-mobile">{Math.ceil(hud.hp)}/{hud.maxHp}</span>
            </div>
            <div className="loadout">
              {[...hud.weapons, ...hud.passives].map((l) => (
                <div className={`slot${l.kind === "passive" ? " passive" : ""}`} key={`${l.kind}-${l.id}`} style={{ color: l.color }} title={slotTitle(l)}>
                  <Icon d={l.icon} />
                  <b>{l.level}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="clock">
            <div className="time">{formatTime(hud.time)}</div>
            {hud.combo >= 10 && (
              <div className="combo" key={Math.floor(hud.combo / 10)}>
                {t("hud.chain", { n: hud.combo, mult: Math.round(hud.comboMult * 10) / 10 })}
              </div>
            )}
          </div>

          <div className="score">
            <div className="stack">
              <div className="big">{num(hud.score)}</div>
              <small>{num(hud.kills)}<span className="hide-mobile"> {t("hud.destroyed")}</span></small>
            </div>
            <button className="icon-btn" onClick={onPause} aria-label={t("hud.pause")}>
              <Icon d={ICONS.pause} />
            </button>
          </div>
        </div>

        {hud.boss && (
          <div className="bossbar">
            <div className="name">{td(`boss.${hud.boss.index}`)}</div>
            <div className="bar">
              <i style={{ width: `${hud.boss.hp * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {inputMode === "touch" && (
        <>
          <button
            className="dash-btn"
            style={{ "--ready": hud.dash } as CSSProperties}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDash();
            }}
            aria-label={t("hud.dash")}
          >
            <span>{t("hud.dash")}</span>
          </button>
          {hud.time < 6 && <div className="touch-hint">{t("hud.dragHint")}</div>}
        </>
      )}
    </>
  );
}
