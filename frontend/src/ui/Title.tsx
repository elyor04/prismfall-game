import { useEffect, useRef } from "react";
import type { Catalog, DailyChallenge, Profile } from "../api/backend";
import type { InputMode } from "../game/input";
import { LANGS, Lang, rich, useI18n } from "../i18n";
import { CoreGlyph, Icon, ICONS, Shards } from "./common";

export type TitleFocus = "start" | "forge" | "records" | "settings";

interface Props {
  focusTarget: TitleFocus;
  profile: Profile;
  catalog: Catalog;
  daily: DailyChallenge | null;
  inputMode: InputMode;
  preview: boolean;
  onPlay: () => void;
  onDaily: () => void;
  onNav: (s: "forge" | "records" | "settings") => void;
  onCycleCore: (dir: 1 | -1) => void;
  onLanguage: (lang: Lang) => void;
}

export function Title({ focusTarget, profile, catalog, daily, inputMode, preview, onPlay, onDaily, onNav, onCycleCore, onLanguage }: Props) {
  const { t, td, num, list, lang } = useI18n();
  // Return focus to the button that opened a sub-screen (Forge, Records, Settings).
  const refs = useRef<Partial<Record<TitleFocus, HTMLButtonElement | null>>>({});
  useEffect(() => {
    refs.current[focusTarget]?.focus({ preventScroll: true });
  }, [focusTarget]);
  const cores = catalog.cores ?? [];
  const core = cores.find((c) => c.id === profile.selectedCore) ?? cores[0];
  const unlocked = (profile.unlockedCores ?? []).length;
  const playedDaily = daily ? (profile.dailyBest?.[daily.key] ?? 0) > 0 : false;
  const coreName = (id: string) => td(`core.${id}`);
  const mods = daily ? list((daily.modifiers ?? []).map((m) => td(`mod.${m.id}`, undefined, m.name))) : "";

  return (
    <div className="layer title-screen">
      <div className="title-col">
        <div>
          <h1 className="wordmark">Prism<br />fall</h1>
          <p className="tagline">{t("title.tagline")}</p>
        </div>

        {core && (
          <div className="core-picker">
            <CoreGlyph hue={core.hue} size={44} />
            <div className="meta">
              <div className="name">{coreName(core.id)}</div>
              <small>{td(`core.${core.id}.desc`, undefined, core.description)}</small>
            </div>
            {unlocked > 1 && (
              <>
                <button className="icon-btn" onClick={() => onCycleCore(-1)} aria-label={t("title.prevCore")}>
                  <Icon d={ICONS.left} />
                </button>
                <button className="icon-btn" onClick={() => onCycleCore(1)} aria-label={t("title.nextCore")}>
                  <Icon d={ICONS.right} />
                </button>
              </>
            )}
          </div>
        )}

        <div className="menu">
          <button className="btn primary" onClick={onPlay} ref={(el) => { refs.current.start = el; }}>
            <span>
              {t("title.start")}
              <span className="sub">{t("title.startSub")}</span>
            </span>
            <Icon d={ICONS.play} />
          </button>
          {daily && (
            <button className="btn" onClick={onDaily}>
              <span>
                {playedDaily ? t("title.dailyBest", { score: num(daily.best) }) : t("title.daily")}
                <span className="sub">{t("title.dailySub", { core: coreName(daily.core), mods })}</span>
              </span>
            </button>
          )}
          <div className="menu-row">
            <button className="btn" onClick={() => onNav("forge")} ref={(el) => { refs.current.forge = el; }}>{t("title.forge")}</button>
            <button className="btn" onClick={() => onNav("records")} ref={(el) => { refs.current.records = el; }}>{t("title.records")}</button>
            <button className="btn" onClick={() => onNav("settings")} ref={(el) => { refs.current.settings = el; }}>{t("title.settings")}</button>
          </div>
        </div>

        <div className="hint">
          {inputMode === "touch" ? (
            <span>{t("title.hintTouch")}</span>
          ) : inputMode === "gamepad" ? (
            <span>{t("title.hintPad")}</span>
          ) : (
            rich(t("title.hintKeys"), {
              move: (
                <>
                  <span className="kbd">W</span> <span className="kbd">A</span> <span className="kbd">S</span> <span className="kbd">D</span>
                </>
              ),
              dash: <span className="kbd">Space</span>,
            })
          )}
        </div>
      </div>

      <div className="topbar">
        <div className="segmented lang-switch" role="group" aria-label={t("title.language")}>
          {LANGS.map((l) => (
            <button key={l.id} aria-pressed={lang === l.id} onClick={() => onLanguage(l.id)} lang={l.id} title={l.label}>
              {l.id.toUpperCase()}
            </button>
          ))}
        </div>
        <Shards value={profile.shards} />
      </div>
      {preview && <div className="preview-badge">{t("title.preview")}</div>}
    </div>
  );
}
