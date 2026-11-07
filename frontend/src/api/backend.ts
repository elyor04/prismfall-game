// Thin adapter over the generated Wails bindings. Inside the Wails app every
// call goes to Go. When the page is opened in a plain browser (vite dev or a
// Playwright run) the Go side is missing, so a small localStorage-backed
// preview implementation takes over. Game rules live in Go; the preview only
// mirrors them closely enough to click through the UI.

import * as Go from "../../bindings/prismfall/internal/game/gameservice";
import type {
  Catalog, DailyChallenge, Profile, RunResult, RunReward, Settings,
} from "../../bindings/prismfall/internal/game/models";

export type { Catalog, DailyChallenge, Profile, RunResult, RunReward, Settings };
export type { Achievement, CoreDef, ForgeUpgrade, Modifier, RunRecord } from "../../bindings/prismfall/internal/game/models";

export interface Backend {
  native: boolean;
  getProfile(): Promise<Profile>;
  getCatalog(): Promise<Catalog>;
  saveSettings(s: Settings): Promise<Profile>;
  buyUpgrade(id: string): Promise<Profile>;
  unlockCore(id: string): Promise<Profile>;
  selectCore(id: string): Promise<Profile>;
  getDaily(): Promise<DailyChallenge>;
  /** Opens a run; the returned token must accompany submitRun. */
  beginRun(): Promise<string>;
  submitRun(r: RunResult): Promise<RunReward>;
  resetProfile(): Promise<Profile>;
  haptic(kind: string): void;
  setKeepAwake(on: boolean): void;
}

/** Normalise nullable collections from Go so the UI never has to. */
export function fixProfile(p: Profile): Profile {
  return {
    ...p,
    forge: p.forge ?? {},
    unlockedCores: p.unlockedCores ?? ["prism"],
    achievements: p.achievements ?? [],
    records: p.records ?? [],
    dailyBest: p.dailyBest ?? {},
  };
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong talking to the game service.";
}

/** An error from the game service. `code` matches Go's GameError.Code. */
export class BackendError extends Error {
  code: string;
  constructor(message: string, code = "generic") {
    super(message);
    this.code = code;
  }
}

/**
 * Wails puts the marshalled Go error in `cause`; keep its code. The Android
 * transport drops `cause` and sends only the text, so fall back to the
 * "[code]" suffix that Go's GameError.Error() appends.
 */
function errorCode(e: unknown): string {
  const cause = (e as { cause?: unknown })?.cause;
  const c = typeof cause === "string" ? safeParse(cause) : cause;
  const code = (c as { code?: unknown } | undefined)?.code;
  if (typeof code === "string") return code;
  return /\[([a-z_]+)\]\s*$/.exec(errorMessage(e))?.[1] ?? "generic";
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

const wrap = async <T,>(p: Promise<T>): Promise<T> => {
  try {
    return await p;
  } catch (e) {
    throw new BackendError(errorMessage(e), errorCode(e));
  }
};

const native: Backend = {
  native: true,
  getProfile: async () => fixProfile(await wrap(Go.GetProfile())),
  getCatalog: () => wrap(Go.GetCatalog()),
  saveSettings: async (s) => fixProfile(await wrap(Go.SaveSettings(s))),
  buyUpgrade: async (id) => fixProfile(await wrap(Go.BuyUpgrade(id))),
  unlockCore: async (id) => fixProfile(await wrap(Go.UnlockCore(id))),
  selectCore: async (id) => fixProfile(await wrap(Go.SelectCore(id))),
  getDaily: () => wrap(Go.GetDaily()),
  beginRun: () => wrap(Go.BeginRun()),
  submitRun: async (r) => {
    const res = await wrap(Go.SubmitRun(r));
    return { ...res, newAchievements: res.newAchievements ?? [], profile: fixProfile(res.profile) };
  },
  resetProfile: async () => fixProfile(await wrap(Go.ResetProfile())),
  haptic: (k) => void Go.Haptic(k).catch(() => {}),
  setKeepAwake: (on) => void Go.SetKeepAwake(on).catch(() => {}),
};

let chosen: Backend | null = null;

/**
 * True inside the Wails app. The native side injects `window._wails.environment`
 * and a message bridge (WebView2, WKWebView or the Android JS interface), and
 * serves the page from wails.localhost.
 */
function insideWails(): boolean {
  const w = window as unknown as {
    _wails?: { environment?: unknown; invoke?: unknown };
    wails?: { invoke?: unknown };
    chrome?: { webview?: unknown };
    webkit?: { messageHandlers?: { external?: unknown } };
  };
  return Boolean(
    w._wails?.environment || w.wails?.invoke || w.chrome?.webview || w.webkit?.messageHandlers?.external ||
      location.hostname === "wails.localhost" || location.protocol === "wails:",
  );
}

/**
 * Picks the backend once. Inside the app it is always Go: a failing Go call
 * surfaces as an error the UI can retry, and never silently swaps the player's
 * save for the browser preview store. Only a plain browser gets the preview.
 */
export async function connect(): Promise<Backend> {
  if (chosen) return chosen;
  if (insideWails()) {
    chosen = native;
  } else {
    const { previewBackend } = await import("./preview");
    chosen = previewBackend();
  }
  return chosen;
}
