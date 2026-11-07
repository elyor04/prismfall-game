import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Window } from "@wailsio/runtime";
import { Backend, Catalog, DailyChallenge, Profile, RunResult, RunReward, Settings, connect } from "./api/backend";
import { AudioEngine } from "./game/audio";
import { BannerId, Choice, Game, HudState, RunSummary } from "./game/engine";
import { I18nProvider, Lang, errorText, makeI18n, resolveLang } from "./i18n";
import type { InputMode } from "./game/input";
import { Hud } from "./ui/Hud";
import { LevelUp } from "./ui/LevelUp";
import { Forge, PauseMenu, Records, Results, SettingsScreen } from "./ui/Screens";
import { Title, TitleFocus } from "./ui/Title";
import { useGamepadMenus } from "./ui/gamepadNav";

type Screen = "boot" | "title" | "forge" | "records" | "playing" | "results";
type Banner = { id: BannerId | "daily"; tone: string; index: number; key: number };
type ResultState = { summary: RunSummary; reward: RunReward | null; error: string | null };
type HapticKind = "light" | "medium" | "heavy" | "success" | "warning" | "error";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const audioRef = useRef<AudioEngine>(new AudioEngine());
  const backendRef = useRef<Backend | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [daily, setDaily] = useState<DailyChallenge | null>(null);
  const dailyRef = useRef(daily);
  dailyRef.current = daily;
  const starting = useRef(false); // a run is being opened with Go
  const bootRef = useRef<() => void>(() => {});
  const pendingRun = useRef<RunResult | null>(null); // a finished run not yet saved
  const [screen, setScreen] = useState<Screen>("boot");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [levelUp, setLevelUp] = useState<{ choices: Choice[]; rerolls: number } | null>(null);
  const [paused, setPausedState] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [results, setResults] = useState<ResultState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>(matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard");
  const [bootError, setBootError] = useState<string | null>(null);

  const lang: Lang = resolveLang(profile?.settings.language);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;
  useEffect(() => {
    document.documentElement.lang = lang === "uz" ? "uz-Latn" : lang;
  }, [lang]);

  // Mirrors of state for use inside long-lived engine callbacks.
  const live = useRef({ screen, paused, settingsOpen, profile, levelUp: false, run: null as null | { daily: boolean; key: string; core: string; token: string; submitted: boolean } });
  live.current.screen = screen;
  live.current.paused = paused;
  live.current.settingsOpen = settingsOpen;
  live.current.profile = profile;
  live.current.levelUp = !!levelUp;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }, []);

  const setPaused = useCallback((p: boolean) => {
    setPausedState(p);
    gameRef.current?.setPaused(p);
  }, []);

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    const canvas = canvasRef.current!;
    const audio = audioRef.current;
    const game = new Game(canvas, audio);
    gameRef.current = game;
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
    game.input.onModeChange = (m) => setInputMode(m);

    game.setEvents({
      hud: (h) => setHud(h),
      levelUp: (choices, rerolls) => setLevelUp({ choices, rerolls }),
      banner: (id, tone, index) => setBanner({ id, tone, index: index ?? 0, key: performance.now() }),
      pauseToggle: () => {
        const l = live.current;
        if (l.screen !== "playing" || l.levelUp) return;
        if (l.settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        setPaused(!l.paused);
      },
      haptic: (kind: HapticKind) => {
        if (live.current.profile?.settings.haptics) backendRef.current?.haptic(kind);
      },
      gameOver: (summary) => onGameOver(summary),
    });

    const onResize = () => game.resize();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    let cancelled = false;
    const boot = async () => {
      setBootError(null);
      try {
        const be = await connect();
        const [p, c, d] = await Promise.all([be.getProfile(), be.getCatalog(), be.getDaily().catch(() => null)]);
        if (cancelled) return;
        backendRef.current = be;
        setProfile(p);
        setCatalog(c);
        setDaily(d);
        game.applySettings(p.settings);
        setScreen("title");
      } catch (e) {
        if (!cancelled) setBootError(errorText(i18nRef.current, e));
      }
    };
    bootRef.current = boot;
    void boot();

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      game.destroy();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Audio needs a user gesture before it may start.
  useEffect(() => {
    const unlock = () => audioRef.current.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Pause when the app goes to the background.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (live.current.screen === "playing" && !live.current.levelUp) setPaused(true);
        audioRef.current.suspend();
      } else {
        audioRef.current.resume();
        // The daily challenge changes at UTC midnight; the app may have slept past it.
        backendRef.current?.getDaily().then(setDaily).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [setPaused]);

  const toggleFullscreen = useCallback(() => {
    if (backendRef.current?.native) {
      void Window.ToggleFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

  // Menu keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (e.key !== "Escape") return;
      const s = live.current.screen;
      if (s === "playing" || s === "results") return; // engine pause toggle / Results handle these
      backRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen]);

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner((b) => (b?.key === banner.key ? null : b)), 3400);
    return () => clearTimeout(t);
  }, [banner]);

  // ---------------------------------------------------------------- runs

  const startRun = useCallback(async (isDaily: boolean) => {
    const game = gameRef.current;
    const be = backendRef.current;
    if (!game || !be || !catalog || !profile || starting.current) return;
    starting.current = true;
    audioRef.current.unlock();
    let daily = dailyRef.current;
    let token: string;
    try {
      if (isDaily) {
        // Always play today's challenge, even if the app has been open since yesterday.
        daily = await be.getDaily().catch(() => daily);
        setDaily(daily);
      }
      token = await be.beginRun();
    } catch (e) {
      showToast(errorText(i18nRef.current, e));
      return;
    } finally {
      starting.current = false;
    }
    const cores = catalog.cores ?? [];
    const coreId = isDaily && daily ? daily.core : profile.selectedCore;
    const core = cores.find((c) => c.id === coreId) ?? cores[0];
    live.current.run = { daily: isDaily, key: daily?.key ?? "", core: core.id, token, submitted: false };
    game.startRun({
      mode: isDaily ? "daily" : "run",
      seed: isDaily && daily ? daily.seed : (Math.random() * 2 ** 31) | 0,
      core,
      forge: (profile.forge ?? {}) as Record<string, number>,
      modifiers: isDaily && daily ? (daily.modifiers ?? []).map((m) => m.id) : [],
    });
    setHud(null);
    setLevelUp(null);
    setResults(null);
    setBanner(null);
    setSettingsOpen(false);
    setPaused(false);
    setScreen("playing");
    be.setKeepAwake(true);
    if (isDaily && daily) setBanner({ id: "daily", tone: "info", index: 0, key: performance.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, profile, setPaused]);

  const onGameOver = (summary: RunSummary) => {
    const be = backendRef.current;
    const run = live.current.run;
    if (run?.submitted) return; // a run is recorded exactly once
    if (run) run.submitted = true;
    setLevelUp(null);
    setPausedState(false);
    setScreen("results");
    setResults({ summary, reward: null, error: null });
    if (!be || !run) return;
    be.setKeepAwake(false);
    pendingRun.current = {
      score: summary.score, kills: summary.kills, level: summary.level, bossesDefeated: summary.bossesDefeated,
      timeSec: summary.timeSec, core: run.core, victory: summary.victory, daily: run.daily, dailyKey: run.daily ? run.key : "",
      maxCombo: summary.maxCombo, noHitSec: summary.noHitSec, token: run.token,
    };
    submitPending();
  };

  /** Sends the finished run. On failure the same payload (and token) can be retried. */
  const submitPending = () => {
    const be = backendRef.current;
    const payload = pendingRun.current;
    if (!be || !payload) return;
    setResults((r) => (r ? { ...r, error: null } : r));
    be.submitRun(payload)
      .then((reward) => {
        pendingRun.current = null;
        setResults((r) => (r ? { ...r, reward } : r));
        setProfile(reward.profile);
        if (payload.daily) be.getDaily().then(setDaily).catch(() => {});
      })
      .catch((e: unknown) => setResults((r) => (r ? { ...r, error: errorText(i18nRef.current, e) } : r)));
  };

  const toMenu = () => {
    gameRef.current?.startDemo();
    setResults(null);
    setHud(null);
    setTitleFocus("start");
    setScreen("title");
  };

  /**
   * The single "back" action shared by Esc, gamepad B and the Android Back
   * button. Returns false only on the title screen, where Back may leave the app.
   */
  const back = (): boolean => {
    const l = live.current;
    if (l.settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    switch (l.screen) {
      case "forge":
      case "records":
        setScreen("title");
        return true;
      case "results":
        // Through the Results Esc handler, so Back respects its input guard
        // exactly like Esc and gamepad B.
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        return true;
      case "playing":
        if (!l.levelUp) setPaused(!l.paused);
        return true;
      default:
        return false;
    }
  };
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const w = window as unknown as { __prismfallBack?: () => boolean };
    w.__prismfallBack = () => backRef.current();
    return () => {
      delete w.__prismfallBack;
    };
  }, []);

  // Gamepad drives every menu except the level-up cards (which have their own
  // handling) and live gameplay (where the engine reads the pad).
  const menusActive = screen !== "boot" && !levelUp && (screen !== "playing" || paused || settingsOpen);
  useGamepadMenus(menusActive, () => backRef.current());

  const quitRun = () => {
    setPaused(false);
    gameRef.current?.abandon();
  };

  // ---------------------------------------------------------------- profile actions

  const act = async (fn: (be: Backend) => Promise<Profile>) => {
    const be = backendRef.current;
    if (!be || busy) return;
    setBusy(true);
    try {
      const p = await fn(be);
      setProfile(p);
      audioRef.current.play("ui");
    } catch (e) {
      showToast(errorText(i18nRef.current, e));
      audioRef.current.play("uiBack");
    } finally {
      setBusy(false);
    }
  };

  const saveTimer = useRef<number | undefined>(undefined);
  const changeSettings = (s: Settings) => {
    if (!profile) return;
    setProfile({ ...profile, settings: s });
    gameRef.current?.applySettings(s);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      backendRef.current?.saveSettings(s).catch((e: unknown) => showToast(errorText(i18nRef.current, e)));
    }, 300);
  };

  const cycleCore = (dir: 1 | -1) => {
    if (!catalog || !profile) return;
    const owned = (catalog.cores ?? []).filter((c) => (profile.unlockedCores ?? []).includes(c.id));
    const i = owned.findIndex((c) => c.id === profile.selectedCore);
    const next = owned[(i + dir + owned.length) % owned.length];
    if (next) void act((be) => be.selectCore(next.id));
  };

  // ---------------------------------------------------------------- render

  const isDaily = live.current.run?.daily ?? false;

  const bannerText = (b: Banner): { title: string; sub: string } => {
    const { t, td } = i18n;
    switch (b.id) {
      case "boss":
        return { title: td(`boss.${b.index}`), sub: td(`banner.bossSub${b.index}`) };
      case "bossDown":
        return { title: td(`banner.bossDown${b.index}`), sub: t("banner.bossDownSub") };
      case "victory":
        return { title: t("banner.victory"), sub: t("banner.victorySub") };
      case "revive":
        return { title: t("banner.revive"), sub: t("banner.reviveSub") };
      default:
        // Name each rule and say what it does, one rule per line.
        return {
          title: t("banner.daily"),
          sub: (daily?.modifiers ?? []).map((m) => `${td(`mod.${m.id}`, undefined, m.name)}: ${td(`mod.${m.id}.desc`, undefined, m.description)}`).join("\n"),
        };
    }
  };

  const [titleFocus, setTitleFocus] = useState<TitleFocus>("start");

  const setLanguage = (l: Lang) => {
    if (profile) changeSettings({ ...profile.settings, language: l });
  };

  return (
    <I18nProvider lang={lang}>
      <canvas ref={canvasRef} className="stage" aria-label={i18n.t("common.gameView")} />

      {screen === "boot" && (
        <div className="boot" role={bootError ? "alert" : "status"}>
          {bootError ? (
            <>
              <p>{i18n.t("common.bootError", { error: bootError })}</p>
              <button className="btn primary" autoFocus onClick={() => bootRef.current()}>{i18n.t("common.retry")}</button>
            </>
          ) : (
            i18n.t("common.loading")
          )}
        </div>
      )}

      {screen === "title" && profile && catalog && !settingsOpen && (
        <Title
          profile={profile}
          catalog={catalog}
          daily={daily}
          inputMode={inputMode}
          preview={!backendRef.current?.native}
          onPlay={() => startRun(false)}
          onDaily={() => startRun(true)}
          focusTarget={titleFocus}
          onNav={(s) => {
            audioRef.current.play("ui");
            setTitleFocus(s);
            if (s === "settings") setSettingsOpen(true);
            else setScreen(s);
          }}
          onCycleCore={cycleCore}
          onLanguage={setLanguage}
        />
      )}

      {screen === "playing" && hud && (
        // While a dialog is open the HUD behind it is inert: no Tab stops, no clicks.
        <div className="hud-root" {...(levelUp || paused || settingsOpen ? { inert: "" } : {})}>
          <Hud hud={hud} inputMode={inputMode} onPause={() => !levelUp && setPaused(true)} onDash={() => gameRef.current?.input.requestDash()} />
        </div>
      )}

      {banner && screen === "playing" && (() => {
        const b = bannerText(banner);
        return (
          <div key={banner.key} className={`banner ${banner.tone}`} role="status">
            <h2>{b.title}</h2>
            {b.sub && <p>{b.sub}</p>}
          </div>
        );
      })()}

      {screen === "playing" && levelUp && hud && (
        <LevelUp
          level={hud.level}
          choices={levelUp.choices}
          rerolls={levelUp.rerolls}
          onPick={(i) => {
            setLevelUp(null);
            gameRef.current?.chooseUpgrade(i);
          }}
          onReroll={() => gameRef.current?.reroll()}
        />
      )}

      {screen === "playing" && paused && !settingsOpen && (
        <PauseMenu onResume={() => setPaused(false)} onSettings={() => setSettingsOpen(true)} onQuit={quitRun} />
      )}

      {screen === "results" && results && (
        <Results
          summary={results.summary}
          reward={results.reward}
          error={results.error}
          onRetrySave={submitPending}
          daily={isDaily}
          onAgain={() => startRun(isDaily)}
          onForge={() => {
            gameRef.current?.startDemo();
            setScreen("forge");
          }}
          onMenu={toMenu}
        />
      )}

      {screen === "forge" && profile && catalog && (
        <Forge
          profile={profile}
          catalog={catalog}
          busy={busy}
          onBack={() => setScreen("title")}
          onBuy={(id) => act((be) => be.buyUpgrade(id))}
          onUnlock={(id) => act((be) => be.unlockCore(id))}
          onSelect={(id) => act((be) => be.selectCore(id))}
        />
      )}

      {screen === "records" && profile && catalog && <Records profile={profile} catalog={catalog} onBack={() => setScreen("title")} />}

      {settingsOpen && profile && (
        <SettingsScreen
          settings={profile.settings}
          native={!!backendRef.current?.native}
          onChange={changeSettings}
          onBack={() => setSettingsOpen(false)}
          onReset={() => act((be) => be.resetProfile())}
          onFullscreen={toggleFullscreen}
        />
      )}

      {toast && <div className="toast" role="alert">{toast}</div>}
    </I18nProvider>
  );
}
