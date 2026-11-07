// Browser-only stand-in for the Go GameService, used when the page runs
// outside Wails (vite dev, Playwright). It mirrors catalog.go and
// gameservice.go closely enough to exercise every screen. The Go code is the
// real implementation; keep this in sync only as far as previews need.

import type { Backend, Catalog, DailyChallenge, Profile, RunResult, RunReward, Settings } from "./backend";
import { BackendError } from "./backend";

const KEY = "prismfall.preview.profile";

const CATALOG: Catalog = {
  forge: [
    { id: "vitality", name: "Vitality", description: "Start every run with more hull.", maxLevel: 5, baseCost: 40, costStep: 35, perLevel: 10, unit: "max HP" },
    { id: "power", name: "Focus", description: "All weapons hit harder.", maxLevel: 5, baseCost: 60, costStep: 45, perLevel: 5, unit: "% damage" },
    { id: "haste", name: "Thrust", description: "Move faster across the void.", maxLevel: 5, baseCost: 45, costStep: 35, perLevel: 4, unit: "% speed" },
    { id: "reach", name: "Pull", description: "Collect shards from further away.", maxLevel: 5, baseCost: 30, costStep: 25, perLevel: 15, unit: "% pickup radius" },
    { id: "wisdom", name: "Insight", description: "Level up sooner.", maxLevel: 5, baseCost: 55, costStep: 40, perLevel: 8, unit: "% XP" },
    { id: "greed", name: "Greed", description: "Earn more shards per run.", maxLevel: 5, baseCost: 80, costStep: 60, perLevel: 10, unit: "% shards" },
    { id: "reroll", name: "Second thought", description: "Reroll level-up choices.", maxLevel: 3, baseCost: 90, costStep: 90, perLevel: 1, unit: "reroll per run" },
    { id: "revive", name: "Afterglow", description: "Come back once at half hull.", maxLevel: 1, baseCost: 400, costStep: 0, perLevel: 1, unit: "revive per run" },
  ],
  cores: [
    { id: "prism", name: "Prism", description: "Balanced core. Fires seeking pulse bolts.", weapon: "pulse", cost: 0, hue: 190, hpBonus: 0, speedMult: 1, damageMult: 1, cooldownMult: 1, areaMult: 1 },
    { id: "halo", name: "Halo", description: "Sturdy and slow. Shards orbit the hull.", weapon: "orbit", cost: 250, hue: 265, hpBonus: 25, speedMult: 0.95, damageMult: 1, cooldownMult: 1, areaMult: 1.1 },
    { id: "tesla", name: "Tesla", description: "Arc lightning that jumps between foes.", weapon: "arc", cost: 400, hue: 210, hpBonus: 0, speedMult: 1.05, damageMult: 1, cooldownMult: 0.9, areaMult: 1 },
    { id: "nova", name: "Nova", description: "Unleashes shockwaves that shove the swarm.", weapon: "nova", cost: 600, hue: 40, hpBonus: 10, speedMult: 1, damageMult: 1, cooldownMult: 1, areaMult: 1.15 },
    { id: "spectre", name: "Spectre", description: "Fragile glass core with a spectral beam.", weapon: "beam", cost: 900, hue: 320, hpBonus: -30, speedMult: 1.1, damageMult: 1.15, cooldownMult: 1, areaMult: 1 },
  ],
  achievements: [
    { id: "first_light", name: "First light", description: "Finish your first run.", reward: 25 },
    { id: "survivor_5", name: "Holding on", description: "Survive for 5 minutes.", reward: 60 },
    { id: "warden", name: "Wardenfall", description: "Defeat your first boss.", reward: 80 },
    { id: "victory", name: "Prismfall", description: "Defeat the Eclipse and win a run.", reward: 250 },
    { id: "kills_1000", name: "Thousand sparks", description: "Destroy 1,000 enemies in one run.", reward: 120 },
    { id: "level_25", name: "Overcharged", description: "Reach level 25 in one run.", reward: 100 },
    { id: "combo_50", name: "Chain reaction", description: "Hit a 50-kill combo.", reward: 70 },
    { id: "untouched", name: "Ghost", description: "Survive 3 minutes without taking damage.", reward: 90 },
    { id: "daily", name: "Daily ritual", description: "Complete a daily challenge.", reward: 50 },
    { id: "collector", name: "Full spectrum", description: "Unlock every core.", reward: 300 },
  ],
  modifiers: [
    { id: "glass", name: "Glass cannon", description: "Deal 50% more damage, but your hull is halved." },
    { id: "swarm", name: "Swarm", description: "Enemies arrive 40% faster." },
    { id: "haste", name: "Overdrive", description: "Everything moves 20% faster." },
    { id: "rich", name: "Rich veins", description: "30% more XP, but enemies are 30% tougher." },
    { id: "volatile", name: "Volatile", description: "Enemies burst into bullets when destroyed." },
    { id: "elite", name: "Big game", description: "Elites appear three times as often." },
    { id: "noregen", name: "Cold hull", description: "No hull regeneration of any kind." },
    { id: "giant", name: "Giants", description: "Enemies are larger and slower, with double health." },
  ],
};

function fresh(): Profile {
  return {
    version: 1, shards: 0, forge: {}, unlockedCores: ["prism"], selectedCore: "prism", achievements: [], records: [], dailyBest: {},
    stats: { runs: 0, victories: 0, totalKills: 0, totalTimeSec: 0, bossesDefeated: 0, bestTimeSec: 0, highestLevel: 0, shardsEarned: 0 },
    settings: { masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.8, screenShake: 1, haptics: true, damageNumbers: true, reducedFlash: false, quality: "auto", language: "" },
  };
}

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: fall through to a fresh profile */
  }
  return fresh();
}

function save(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore: preview data is disposable */
  }
}

function update(fn: (p: Profile) => void): Profile {
  const p = load();
  fn(p);
  save(p);
  return structuredClone(p);
}

function grant(p: Profile, id: string): boolean {
  if (p.achievements!.includes(id)) return false;
  const a = CATALOG.achievements!.find((x) => x.id === id);
  if (!a) return false;
  p.achievements!.push(id);
  p.shards += a.reward;
  return true;
}

function daily(): DailyChallenge {
  const key = new Date().toISOString().slice(0, 10);
  let h = 2166136261;
  for (const ch of `prismfall:${key}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let r = h || 1;
  const next = () => {
    r ^= r << 13; r >>>= 0;
    r ^= r >>> 17;
    r ^= r << 5; r >>>= 0;
    return r;
  };
  const cores = CATALOG.cores!;
  const mods = CATALOG.modifiers!;
  const core = cores[next() % cores.length].id;
  const a = next() % mods.length;
  let b = next() % (mods.length - 1);
  if (b >= a) b++;
  return { key, seed: h & 0x7fffffff, core, modifiers: [mods[a], mods[b]], best: load().dailyBest![key] ?? 0 };
}

export function previewBackend(): Backend {
  const openRuns = new Set<string>();
  return {
    native: false,
    getProfile: async () => load(),
    getCatalog: async () => CATALOG,
    saveSettings: async (s: Settings) => update((p) => { p.settings = s; }),
    buyUpgrade: async (id) => {
      const u = CATALOG.forge!.find((f) => f.id === id);
      if (!u) throw new BackendError("that upgrade does not exist", "unknown_upgrade");
      const p = load();
      const lvl = p.forge![id] ?? 0;
      if (lvl >= u.maxLevel) throw new BackendError("this upgrade is already at its highest level", "max_level");
      const cost = u.baseCost + u.costStep * lvl;
      if (p.shards < cost) throw new BackendError("not enough shards yet", "not_enough_shards");
      return update((q) => { q.shards -= cost; q.forge![id] = lvl + 1; });
    },
    unlockCore: async (id) => {
      const c = CATALOG.cores!.find((x) => x.id === id);
      if (!c) throw new BackendError("that core does not exist", "unknown_core");
      const p = load();
      if (p.unlockedCores!.includes(id)) throw new BackendError("you already own this core", "already_owned");
      if (p.shards < c.cost) throw new BackendError("not enough shards yet", "not_enough_shards");
      return update((q) => {
        q.shards -= c.cost;
        q.unlockedCores!.push(id);
        q.selectedCore = id;
        if (q.unlockedCores!.length === CATALOG.cores!.length) grant(q, "collector");
      });
    },
    selectCore: async (id) => {
      if (!load().unlockedCores!.includes(id)) throw new BackendError("unlock this core in the forge first", "core_locked");
      return update((p) => { p.selectedCore = id; });
    },
    getDaily: async () => daily(),
    beginRun: async () => {
      const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      openRuns.add(token);
      return token;
    },
    submitRun: async (r: RunResult): Promise<RunReward> => {
      if (!openRuns.has(r.token)) throw new BackendError("this run was already recorded or was never started", "unknown_run");
      const reward: RunReward = { shardsEarned: 0, achievementBonus: 0, rank: 0, newBest: false, dailyBest: false, newAchievements: [], profile: fresh() };
      const profile = update((p) => {
        let base = r.kills / 12 + r.timeSec / 8 + r.level * 2 + r.bossesDefeated * 30 + (r.victory ? 120 : 0);
        if (r.daily) base *= 1.5;
        base *= 1 + 0.1 * (p.forge!["greed"] ?? 0);
        reward.shardsEarned = Math.round(base);
        p.shards += reward.shardsEarned;
        const st = p.stats;
        st.runs++; st.totalKills += r.kills; st.totalTimeSec += r.timeSec; st.bossesDefeated += r.bossesDefeated;
        st.shardsEarned += reward.shardsEarned;
        if (r.victory) st.victories++;
        st.bestTimeSec = Math.max(st.bestTimeSec, r.timeSec);
        st.highestLevel = Math.max(st.highestLevel, r.level);
        const prevBest = p.records![0]?.score ?? 0;
        const rec = { score: r.score, timeSec: r.timeSec, kills: r.kills, level: r.level, core: r.core, victory: r.victory, daily: r.daily, date: new Date().toISOString() };
        p.records = [...p.records!, rec].sort((a, b) => b.score - a.score).slice(0, 10);
        reward.rank = p.records.indexOf(rec) + 1;
        reward.newBest = r.score > prevBest && r.score > 0;
        if (r.daily && r.score > (p.dailyBest![r.dailyKey] ?? 0)) {
          p.dailyBest![r.dailyKey] = r.score;
          reward.dailyBest = true;
        }
        const checks: Record<string, boolean> = {
          first_light: true, survivor_5: r.timeSec >= 300, warden: r.bossesDefeated >= 1, victory: r.victory,
          kills_1000: r.kills >= 1000, level_25: r.level >= 25, combo_50: r.maxCombo >= 50, untouched: r.noHitSec >= 180, daily: r.daily,
        };
        for (const a of CATALOG.achievements!) {
          if (checks[a.id] && grant(p, a.id)) {
            reward.newAchievements!.push(a);
            reward.achievementBonus += a.reward;
          }
        }
      });
      reward.profile = profile;
      openRuns.delete(r.token); // like Go: the token is spent only once the save worked
      return reward;
    },
    resetProfile: async () => update((p) => { const s = p.settings; Object.assign(p, fresh()); p.settings = s; }),
    haptic: (kind) => {
      const ms: Record<string, number | number[]> = { light: 10, medium: 25, heavy: 50, success: [15, 40, 15], warning: [30, 60, 30], error: 80 };
      try { navigator.vibrate?.(ms[kind] ?? 10); } catch { /* unsupported */ }
    },
    setKeepAwake: () => {},
  };
}
