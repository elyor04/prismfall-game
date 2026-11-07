import { CSSProperties, KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Catalog, CoreDef, Profile, RunReward, Settings } from "../api/backend";
import type { RunSummary } from "../game/engine";
import { formatTime } from "../game/math";
import { Key, LANGS, rich, useI18n } from "../i18n";
import { CoreGlyph, Icon, ICONS, Pips, ScreenHead, Shards } from "./common";
import { ConfirmButton } from "./ConfirmButton";

// ------------------------------------------------------------------ pause

export function PauseMenu({ onResume, onSettings, onQuit }: { onResume: () => void; onSettings: () => void; onQuit: () => void }) {
  const { t } = useI18n();
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="panel">
        <h2 id="pause-title">{t("pause.title")}</h2>
        <p className="lede">{t("pause.lede")}</p>
        <div className="stack">
          <button className="btn primary" onClick={onResume} autoFocus>{t("pause.resume")}</button>
          <button className="btn" onClick={onSettings}>{t("pause.settings")}</button>
          <ConfirmButton label={t("pause.end")} confirmLabel={t("pause.endConfirm")} onConfirm={onQuit} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- results

interface ResultsProps {
  summary: RunSummary;
  reward: RunReward | null;
  error: string | null;
  onRetrySave: () => void;
  daily: boolean;
  onAgain: () => void;
  onForge: () => void;
  onMenu: () => void;
}

const RESULTS_ARM_MS = 700;

export function Results({ summary, reward, error, onRetrySave, daily, onAgain, onForge, onMenu }: ResultsProps) {
  const { t, tn, td, num } = useI18n();
  // A dash or Enter pressed as the run ends must not skip straight past the
  // payout, so the buttons ignore input briefly and take focus afterwards.
  const [armed, setArmed] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setArmed(true);
      primary.current?.focus({ preventScroll: true });
    }, RESULTS_ARM_MS);
    return () => clearTimeout(id);
  }, []);
  const menu = useRef(onMenu);
  menu.current = onMenu;
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") menu.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);
  const guard = (fn: () => void) => () => {
    if (armed) fn();
  };
  const title = summary.victory ? t("results.victory") : t("results.lost");
  const lede = summary.victory
    ? t("results.ledeVictory")
    : summary.bossesDefeated > 0
      ? tn("results.ledeBosses", summary.bossesDefeated)
      : t("results.ledeNone");
  const sub = [reward && reward.rank > 0 ? t("results.ranked", { n: reward.rank }) : t("results.unranked"), daily ? t("results.dailyBonus") : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="results-title">
      <div className="panel results">
        <h2 id="results-title">
          {title}
          {reward?.newBest && <span className="badge">{t("results.newBest")}</span>}
          {!reward?.newBest && reward?.dailyBest && <span className="badge">{t("results.dailyBest")}</span>}
        </h2>
        <p className="lede">{lede}</p>
        <div className="result-stats">
          <Stat k={t("results.score")} v={num(summary.score)} />
          <Stat k={t("results.survived")} v={formatTime(summary.timeSec)} />
          <Stat k={t("results.destroyed")} v={num(summary.kills)} />
          <Stat k={t("results.level")} v={String(summary.level)} />
        </div>

        {reward && (
          <div className="payout">
            <div>
              <div>{t("results.shards")}</div>
              <small>{sub}</small>
            </div>
            <div className="numeric">+{num(reward.shardsEarned + reward.achievementBonus)}</div>
          </div>
        )}
        {!reward && !error && <div className="payout"><div>{t("results.recording")}</div></div>}
        {error && (
          <div className="payout" role="alert" style={{ borderColor: "rgba(255,77,109,.5)" }}>
            <div>{t("results.saveFailed", { error })}</div>
            <button className="btn" onClick={guard(onRetrySave)}>{t("common.retry")}</button>
          </div>
        )}

        {reward && (reward.newAchievements ?? []).length > 0 && (
          <div className="unlocks">
            {(reward.newAchievements ?? []).map((a, i) => (
              <div className="unlock" key={a.id} style={{ animationDelay: `${0.2 + i * 0.12}s` }}>
                <span><b>{td(`ach.${a.id}`, undefined, a.name)}</b>: {td(`ach.${a.id}.desc`, undefined, a.description)}</span>
                <span className="cost"><span className="gem" />+{num(a.reward)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="actions">
          <button ref={primary} className="btn primary" onClick={guard(onAgain)}>{daily ? t("results.retryDaily") : t("results.again")}</button>
          <button className="btn" onClick={guard(onForge)}>{t("results.forge")}</button>
          <button className="btn ghost" onClick={guard(onMenu)}>{t("results.menu")}</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

// ------------------------------------------------------------------ forge

interface ForgeProps {
  profile: Profile;
  catalog: Catalog;
  busy: boolean;
  onBack: () => void;
  onBuy: (id: string) => void;
  onUnlock: (id: string) => void;
  onSelect: (id: string) => void;
}

export function Forge({ profile, catalog, busy, onBack, onBuy, onUnlock, onSelect }: ForgeProps) {
  const { t, td, num } = useI18n();
  const [tab, setTab] = useState<"upgrades" | "cores">("upgrades");
  const tabs = ["upgrades", "cores"] as const;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // WAI-ARIA tabs: arrows/Home/End move between tabs; only the active tab is in the Tab order.
  const onTabKey = (e: KeyboardEvent) => {
    const i = tabs.indexOf(tab);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(tabs[next]);
    tabRefs.current[next]?.focus();
  };
  return (
    <div className="screen">
      <ScreenHead title={t("forge.title")} onBack={onBack}>
        <Shards value={profile.shards} />
      </ScreenHead>
      <div className="screen-body">
        <div className="tabs" role="tablist" aria-label={t("forge.title")} onKeyDown={onTabKey}>
          {tabs.map((id, i) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {t(id === "upgrades" ? "forge.upgrades" : "forge.cores")}
            </button>
          ))}
        </div>
        {tab === "upgrades" ? (
          <div className="upgrades" role="tabpanel" id="panel-upgrades" aria-labelledby="tab-upgrades">
            {(catalog.forge ?? []).map((u) => {
              const lvl = profile.forge?.[u.id] ?? 0;
              const maxed = lvl >= u.maxLevel;
              const cost = u.baseCost + u.costStep * lvl;
              const name = td(`forge.${u.id}`, undefined, u.name);
              const amount = td(`forge.${u.id}.effect`, { n: u.perLevel }, `+${u.perLevel} ${u.unit}`);
              const effect = u.maxLevel > 1 ? t("forge.eachLevel", { effect: amount }) : amount;
              return (
                <div className="upgrade" key={u.id}>
                  <h3>{name}</h3>
                  <p>{td(`forge.${u.id}.desc`, undefined, u.description)} {effect}.</p>
                  <Pips level={lvl} max={u.maxLevel} color="var(--mint)" />
                  <button
                    className="btn"
                    disabled={busy || maxed || profile.shards < cost}
                    onClick={() => onBuy(u.id)}
                    aria-label={maxed ? t("forge.maxedAria", { name }) : t("forge.buyAria", { name, cost })}
                  >
                    {maxed ? t("forge.maxed") : <span className="cost"><span className="gem" />{num(cost)}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="cores" role="tabpanel" id="panel-cores" aria-labelledby="tab-cores">
            {(catalog.cores ?? []).map((c) => (
              <CoreCard key={c.id} core={c} profile={profile} busy={busy} onUnlock={onUnlock} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CoreCard({ core: c, profile, busy, onUnlock, onSelect }: { core: CoreDef; profile: Profile; busy: boolean; onUnlock: (id: string) => void; onSelect: (id: string) => void }) {
  const { t, td, num } = useI18n();
  const owned = (profile.unlockedCores ?? []).includes(c.id);
  const selected = profile.selectedCore === c.id;
  const pct = (x: number) => Math.round(Math.abs(x) * 100);
  const signed = (x: number) => `${x > 0 ? "+" : "−"}${Math.abs(x)}`;
  const traits: { t: string; good: boolean }[] = [];
  if (c.hpBonus) traits.push({ t: t("trait.hull", { n: signed(c.hpBonus) }), good: c.hpBonus > 0 });
  if (c.speedMult !== 1) traits.push({ t: t("trait.speed", { n: signed(pct(c.speedMult - 1) * Math.sign(c.speedMult - 1)) }), good: c.speedMult > 1 });
  if (c.damageMult !== 1) traits.push({ t: t("trait.damage", { n: pct(c.damageMult - 1) }), good: c.damageMult > 1 });
  if (c.cooldownMult !== 1) traits.push({ t: t("trait.cooldown", { n: pct(1 - c.cooldownMult) }), good: c.cooldownMult < 1 });
  if (c.areaMult !== 1) traits.push({ t: t("trait.area", { n: pct(c.areaMult - 1) }), good: c.areaMult > 1 });
  return (
    <div className={`core-card${selected ? " selected" : ""}${owned ? "" : " locked"}`} style={{ "--c": `hsl(${c.hue} 100% 66%)` } as CSSProperties}>
      <div className="glyph-wrap"><CoreGlyph hue={c.hue} size={84} locked={!owned} /></div>
      <h3>{td(`core.${c.id}`, undefined, c.name)}</h3>
      <p>
        {td(`core.${c.id}.desc`, undefined, c.description)} {t("forge.startsWith", { weapon: td(`weapon.${c.weapon}`) })}
      </p>
      {traits.length > 0 && (
        <div className="traits">
          {traits.map((x) => <span key={x.t} className={`trait ${x.good ? "good" : "bad"}`}>{x.t}</span>)}
        </div>
      )}
      {owned ? (
        <button className="btn" disabled={selected || busy} onClick={() => onSelect(c.id)}>{selected ? t("forge.selected") : t("forge.fly")}</button>
      ) : (
        <button className="btn" disabled={busy || profile.shards < c.cost} onClick={() => onUnlock(c.id)}>
          <span className="cost">{rich(t("forge.unlock"), { cost: <><span className="gem" /> {num(c.cost)}</> })}</span>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- records

export function Records({ profile, catalog, onBack }: { profile: Profile; catalog: Catalog; onBack: () => void }) {
  const { t, td, num, date } = useI18n();
  const records = profile.records ?? [];
  const st = profile.stats;
  const done = new Set(profile.achievements ?? []);
  const achs = catalog.achievements ?? [];
  return (
    <div className="screen">
      <ScreenHead title={t("records.title")} onBack={onBack} />
      <div className="screen-body" tabIndex={0} aria-label={t("records.title")}>
        <div className="records-grid">
          <div className="box">
            <h3>{t("records.top")}</h3>
            {records.length === 0 ? (
              <div className="empty">{t("records.empty")}</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("records.rank")}</th>
                    <th>{t("records.score")}</th>
                    <th>{t("records.time")}</th>
                    <th className="hide-mobile">{t("records.destroyed")}</th>
                    <th>{t("records.core")}</th>
                    <th className="hide-mobile">{t("records.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => {
                    const core = td(`core.${r.core}`);
                    return (
                      <tr key={i} className={i === 0 ? "first" : ""}>
                        <td className="rank">{i + 1}</td>
                        <td>{num(r.score)}{r.victory ? " ★" : ""}</td>
                        <td>{formatTime(r.timeSec)}</td>
                        <td className="hide-mobile">{num(r.kills)}</td>
                        <td>{r.daily ? t("records.daily", { core }) : core}</td>
                        <td className="hide-mobile">{date(r.date)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <div className="box">
              <h3>{t("records.lifetime")}</h3>
              <div className="statlist">
                <Stat k={t("records.runs")} v={num(st.runs)} />
                <Stat k={t("records.victories")} v={num(st.victories)} />
                <Stat k={t("records.destroyed")} v={num(st.totalKills)} />
                <Stat k={t("records.bosses")} v={num(st.bossesDefeated)} />
                <Stat k={t("records.longest")} v={formatTime(st.bestTimeSec)} />
                <Stat k={t("records.highest")} v={String(st.highestLevel)} />
              </div>
            </div>
            <div className="box">
              <h3>{t("records.achievements", { done: done.size, total: achs.length })}</h3>
              <div className="achievements">
                {achs.map((a) => (
                  <div className={`ach${done.has(a.id) ? " done" : ""}`} key={a.id}>
                    <span className="mark" aria-hidden="true" />
                    <div>
                      <b>{td(`ach.${a.id}`, undefined, a.name)}</b>
                      <small>{td(`ach.${a.id}.desc`, undefined, a.description)}</small>
                    </div>
                    <span className="cost"><span className="gem" />{num(a.reward)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- settings

interface SettingsProps {
  settings: Settings;
  native: boolean;
  onChange: (s: Settings) => void;
  onBack: () => void;
  onReset: () => void;
  onFullscreen: () => void;
}

export function SettingsScreen({ settings: s, native, onChange, onBack, onReset, onFullscreen }: SettingsProps) {
  const { t } = useI18n();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const slider = (k: "masterVolume" | "musicVolume" | "sfxVolume" | "screenShake", label: Key, hint?: Key) => (
    <div className="setting">
      <label htmlFor={k}>{t(label)}{hint && <small>{t(hint)}</small>}</label>
      <input id={k} type="range" min={0} max={1} step={0.05} value={s[k]} aria-valuetext={`${Math.round(s[k] * 100)}%`} onChange={(e) => set(k, Number(e.target.value))} />
    </div>
  );
  const toggle = (k: "haptics" | "damageNumbers" | "reducedFlash", label: Key, hint?: Key) => (
    <div className="setting">
      <span className="label" id={`${k}-l`}>{t(label)}{hint && <small>{t(hint)}</small>}</span>
      <button className="switch" role="switch" aria-checked={s[k]} aria-labelledby={`${k}-l`} onClick={() => set(k, !s[k])} />
    </div>
  );
  return (
    <div className="screen">
      <ScreenHead title={t("settings.title")} onBack={onBack} />
      <div className="screen-body">
        <div className="box" style={{ maxWidth: 680 }}>
          <div className="setting setting-wide">
            <span className="label" id="lang-l">{t("settings.language")}<small>{t("settings.languageHint")}</small></span>
            <div className="segmented" role="group" aria-labelledby="lang-l">
              <button aria-pressed={s.language === ""} onClick={() => set("language", "")}>{t("settings.auto")}</button>
              {LANGS.map((l) => (
                <button key={l.id} lang={l.id} aria-pressed={s.language === l.id} onClick={() => set("language", l.id)}>{l.label}</button>
              ))}
            </div>
          </div>
          {slider("masterVolume", "settings.master")}
          {slider("musicVolume", "settings.music")}
          {slider("sfxVolume", "settings.sfx")}
          {slider("screenShake", "settings.shake", "settings.shakeHint")}
          {toggle("haptics", "settings.haptics", "settings.hapticsHint")}
          {toggle("damageNumbers", "settings.damage")}
          {toggle("reducedFlash", "settings.flash", "settings.flashHint")}
          <div className="setting setting-wide">
            <span className="label" id="gfx-l">{t("settings.graphics")}<small>{t("settings.graphicsHint")}</small></span>
            <div className="segmented" role="group" aria-labelledby="gfx-l">
              {(["auto", "high", "balanced", "low"] as const).map((q) => (
                <button key={q} aria-pressed={s.quality === q} onClick={() => set("quality", q)}>{t(`settings.q.${q}`)}</button>
              ))}
            </div>
          </div>
          <div className="setting">
            <span className="label">{t("settings.fullscreen")}<small>{native ? t("settings.fullscreenNative") : t("settings.fullscreenWeb")}</small></span>
            <button className="btn" style={{ justifySelf: "end" }} onClick={onFullscreen}>
              <Icon d={ICONS.expand} size={18} /> {t("settings.toggle")}
            </button>
          </div>
          <div className="setting">
            <span className="label">{t("settings.reset")}<small>{t("settings.resetHint")}</small></span>
            <ConfirmButton style={{ justifySelf: "end" }} label={t("settings.resetButton")} confirmLabel={t("settings.resetConfirm")} onConfirm={onReset} />
          </div>
        </div>
      </div>
    </div>
  );
}
