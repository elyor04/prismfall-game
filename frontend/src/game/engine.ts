import type { CoreDef, Settings } from "../../bindings/prismfall/internal/game/models";
import { AudioEngine, Sfx } from "./audio";
import {
  BOSSES, ENEMIES, EnemyDef, EnemyKind, MAX_PASSIVES, MAX_WEAPON_LEVEL, MAX_WEAPONS, PALETTE, PASSIVES,
  PassiveId, RUN_LENGTH, Shape, W, WEAPONS, WeaponId, coreColor, xpToNext,
} from "./content";
import { Input } from "./input";
import { Rng, TAU, angleDiff, clamp, damp, distToSegment, lerp } from "./math";
import { drawSprite, drawSpriteRot, glowSprite, nebula, ringSprite, shapeSprite, starTile } from "./render";

// ------------------------------------------------------------------ types

export type Mode = "run" | "daily" | "demo";

export interface RunConfig {
  mode: Mode;
  seed: number;
  core: CoreDef;
  forge: Record<string, number>;
  modifiers: string[];
}

export interface Loadout {
  kind: "weapon" | "passive";
  id: string;
  level: number;
  max: number;
  color: string;
  icon: string;
}

export interface HudState {
  hp: number;
  maxHp: number;
  xp: number;
  xpNext: number;
  level: number;
  time: number;
  kills: number;
  score: number;
  combo: number;
  comboMult: number;
  boss: { index: number; hp: number } | null;
  weapons: Loadout[];
  passives: Loadout[];
  dash: number; // 0..1 readiness
  revives: number;
}

export interface Choice {
  kind: "weapon" | "passive" | "heal" | "score";
  id: string;
  level: number;
  color: string;
  icon: string;
  isNew: boolean;
  isMax: boolean;
}

export interface RunSummary {
  score: number;
  kills: number;
  level: number;
  timeSec: number;
  bossesDefeated: number;
  victory: boolean;
  maxCombo: number;
  noHitSec: number;
  weapons: Loadout[];
  passives: Loadout[];
}

export type BannerId = "boss" | "bossDown" | "victory" | "revive";

export interface EngineEvents {
  hud(h: HudState): void;
  levelUp(choices: Choice[], rerolls: number): void;
  /** Banners carry ids, not text: the UI translates them. */
  banner(id: BannerId, tone: "boss" | "info" | "good" | "bad", index?: number): void;
  gameOver(s: RunSummary): void;
  pauseToggle(): void;
  haptic(kind: "light" | "medium" | "heavy" | "success" | "warning" | "error"): void;
}

interface BossState {
  tier: number;
  pattern: number;
  step: number; // position in the tier's pattern order
  patternT: number;
  fireT: number;
  spiral: number;
  charges: number;
}

interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number; y: number;
  vx: number; vy: number;
  kx: number; ky: number;
  r: number;
  hp: number; maxHp: number;
  speed: number;
  dmg: number;
  xp: number;
  score: number;
  color: string;
  shape: Shape;
  knockResist: number;
  elite: boolean;
  flash: number;
  t: number;
  state: number;
  stateT: number;
  angle: number;
  orbitHit: number;
  dead: boolean;
  boss: BossState | null;
}

interface Shot {
  x: number; y: number; vx: number; vy: number;
  r: number; dmg: number; pierce: number; life: number;
  color: string; kind: "bolt" | "missile";
  target: Enemy | null; hits: number[]; blast: number; speed: number;
}

interface Bullet { x: number; y: number; vx: number; vy: number; r: number; life: number; dmg: number; }
interface Gem { x: number; y: number; vx: number; vy: number; value: number; kind: "xp" | "heal" | "vortex"; magnet: boolean; t: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; drag: number; spark: boolean; }
interface FloatText { x: number; y: number; vy: number; life: number; text: string; crit: boolean; }
interface Ring { x: number; y: number; r: number; maxR: number; life: number; max: number; color: string; width: number; }
interface ArcFx { pts: number[]; life: number; }
interface Wave { x: number; y: number; t: number; life: number; strength: number; speed: number; }

interface WeaponState { id: WeaponId; level: number; cd: number; angle: number; tick: number; }

interface Stats {
  dmg: number; cd: number; area: number; speed: number; magnet: number; crit: number;
  extra: number; maxHp: number; regen: number; xpMult: number;
}

// --------------------------------------------------------------- constants

const STEP = 1 / 60;
const GRID = 56;
const SPECTRUM = ["#FF4D6D", "#FFB547", "#FFE14D", "#6BFFB8", "#4DC9FF", "#9B6BFF", "#FF3DCB"];
const QUALITY = {
  high: { particles: 2400, dpr: 2, enemies: 420 },
  balanced: { particles: 1300, dpr: 1.5, enemies: 320 },
  low: { particles: 600, dpr: 1, enemies: 240 },
} as const;
type QualityTier = keyof typeof QUALITY;

// ------------------------------------------------------------ spatial hash

class SpatialHash {
  private cell = 80;
  private buckets = new Map<number, Enemy[]>();
  private used: Enemy[][] = [];
  clear() {
    for (const b of this.used) b.length = 0;
    this.used.length = 0;
    if (this.buckets.size > 6000) this.buckets.clear();
  }
  private key(cx: number, cy: number) {
    return (cx + 32768) * 65536 + (cy + 32768);
  }
  insert(e: Enemy) {
    const k = this.key(Math.floor(e.x / this.cell), Math.floor(e.y / this.cell));
    let b = this.buckets.get(k);
    if (!b) {
      b = [];
      this.buckets.set(k, b);
    }
    if (b.length === 0) this.used.push(b);
    b.push(e);
  }
  query(x: number, y: number, r: number, out: Enemy[]) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = this.buckets.get(this.key(cx, cy));
        if (b) for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------ engine

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly input: Input;
  readonly audio: AudioEngine;
  private events: EngineEvents | null = null;

  // view
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private scale = 1;
  private cam = { x: 0, y: 0 };
  private shake = 0;
  private flash = 0;
  private flashColor = "#ff2050";
  private nebulaCanvas: HTMLCanvasElement | null = null;
  private stars: HTMLCanvasElement[] = [];

  // settings
  private settings: Settings = {
    masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.8, screenShake: 1,
    haptics: true, damageNumbers: true, reducedFlash: false, quality: "auto", language: "",
  };
  private quality: QualityTier = "high";
  private frameTimes: number[] = [];

  // loop
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private hitstop = 0;
  private timeScale = 1;
  private paused = false;
  private choosing = false;
  private hudTimer = 0;

  // run state
  private cfg: RunConfig | null = null;
  /** Effects, drops and recycling: may diverge between players. */
  private rng = new Rng(1);
  /** Director and bosses only, so daily runs share a spawn sequence. */
  private spawnRng = new Rng(1);
  private gridPts = new Float32Array(0); // reused grid vertex buffer
  private over = false;
  private mode: Mode = "demo";
  private time = 0;
  private nextId = 1;
  private player = {
    x: 0, y: 0, vx: 0, vy: 0, r: 14, hp: 100, maxHp: 100, angle: -Math.PI / 2,
    invuln: 0, dashT: 0, dashCd: 0, dashVx: 0, dashVy: 0, alive: true, deathT: 0, color: PALETTE.cyan as string,
  };
  private stats: Stats = this.baseStats();
  private weapons: WeaponState[] = [];
  private passives = new Map<PassiveId, number>();
  private enemies: Enemy[] = [];
  private shots: Shot[] = [];
  private bullets: Bullet[] = [];
  private gems: Gem[] = [];
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private rings: Ring[] = [];
  private arcs: ArcFx[] = [];
  private waves: Wave[] = [];
  private hash = new SpatialHash();
  private q: Enemy[] = [];
  private q2: Enemy[] = [];

  private xp = 0;
  private level = 1;
  private pendingLevels = 0;
  private rerolls = 0;
  private revives = 0;
  private kills = 0;
  private score = 0;
  private combo = 0;
  private comboT = 0;
  private maxCombo = 0;
  private noHit = 0;
  private bestNoHit = 0;
  private spawnAcc = 0;
  private surgeT = 60;
  private bossIndex = 0;
  private bossWarned = -1;
  private bossesDefeated = 0;
  private victory = false;
  private endT = -1;
  private pickupChain = 0;
  private pickupChainT = 0;
  private currentChoices: Choice[] = [];
  private demoWander = 0;

  constructor(canvas: HTMLCanvasElement, audio: AudioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.input = new Input(canvas);
    this.audio = audio;
    this.resize();
    this.stars = [starTile(512, 90, 1.1, 7), starTile(512, 45, 1.6, 21), starTile(512, 18, 2.2, 99)];
    this.startDemo();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ public API

  setEvents(e: EngineEvents | null) {
    this.events = e;
  }

  applySettings(s: Settings) {
    this.settings = s;
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    const before = this.quality;
    this.pickQuality();
    // Only a quality change needs a new backing store (volume sliders call this per tick).
    if (this.quality !== before) this.resize();
  }

  private pickQuality() {
    const q = this.settings.quality;
    if (q === "high" || q === "balanced" || q === "low") this.quality = q;
    else this.quality = matchMedia("(pointer: coarse)").matches ? "balanced" : "high";
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.cssW = w;
    this.cssH = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].dpr);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.scale = clamp(Math.sqrt((w * h) / 770000), 0.5, 1.7);
    this.nebulaCanvas = nebula(w, h);
  }

  get isDemo() {
    return this.mode === "demo";
  }

  startDemo() {
    this.reset({ mode: "demo", seed: (Math.random() * 1e9) | 0, core: DEMO_CORE, forge: {}, modifiers: [] });
    const picks: WeaponId[] = ["orbit", "beam", "pulse", "seeker", "arc", "nova"];
    const a = picks[Math.floor(Math.random() * picks.length)];
    let b = picks[Math.floor(Math.random() * picks.length)];
    if (b === a) b = a === "pulse" ? "nova" : "pulse";
    this.weapons = [a, b].map((id) => ({ id, level: 3, cd: 0, angle: 0, tick: 0 }));
    this.passives.set("amp", 3);
    this.time = 140;
    this.surgeT = 1e9;
    this.bossIndex = BOSSES.length;
    this.recomputeStats();
    this.player.hp = this.player.maxHp;
    this.audio.intensity = 0.15;
    this.audio.boss = false;
  }

  startRun(cfg: RunConfig) {
    this.reset(cfg);
    const startWeapon = (WEAPONS[cfg.core.weapon as WeaponId] ? cfg.core.weapon : "pulse") as WeaponId;
    this.weapons = [{ id: startWeapon, level: 1, cd: 0.5, angle: 0, tick: 0 }];
    this.rerolls = cfg.forge["reroll"] ?? 0;
    this.revives = cfg.forge["revive"] ?? 0;
    this.recomputeStats();
    this.player.hp = this.player.maxHp;
    for (let i = 0; i < 8; i++) this.spawnEnemy(ENEMIES.drifter, null, null, false);
    this.audio.intensity = 0.3;
    this.audio.boss = false;
    this.audio.setMuffled(false);
    this.emitHud();
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.input.flush();
    this.audio.setMuffled(p || this.mode === "demo");
  }

  chooseUpgrade(i: number) {
    const c = this.currentChoices[i];
    if (!this.choosing || !c) return;
    this.applyChoice(c);
    this.choosing = false;
    this.currentChoices = [];
    this.pendingLevels--;
    this.recomputeStats();
    this.audio.play("ui");
    this.audio.setMuffled(false);
    this.input.flush();
    this.emitHud();
    if (this.pendingLevels > 0 && this.player.alive && this.endT < 0 && !this.over) this.openLevelUp();
  }

  reroll() {
    if (!this.choosing || this.rerolls <= 0) return;
    this.rerolls--;
    this.currentChoices = this.rollChoices();
    this.audio.play("ui");
    this.events?.levelUp(this.currentChoices, this.rerolls);
  }

  /** End the current run immediately (player quit). */
  abandon() {
    if (this.mode === "demo" || this.endT >= 0 || this.over) return;
    this.player.alive = false;
    this.finish();
  }

  /** Development helper: jump the run clock forward to test late-game content. */
  debugWarp(seconds: number) {
    if (this.mode === "demo") return;
    this.time += seconds;
    this.surgeT = Math.min(this.surgeT, 5);
  }

  /** Development helper: grant levels immediately. */
  debugLevels(n: number) {
    if (this.mode === "demo") return;
    this.pendingLevels += n;
    this.level += n;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.input.destroy();
  }

  // ------------------------------------------------------------ setup

  private baseStats(): Stats {
    return { dmg: 1, cd: 1, area: 1, speed: 1, magnet: 90, crit: 0.03, extra: 0, maxHp: 100, regen: 0, xpMult: 1 };
  }

  private reset(cfg: RunConfig) {
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.rng = new Rng(cfg.seed ^ 0x5bd1e995);
    this.spawnRng = new Rng(cfg.seed);
    this.over = false;
    this.time = 0;
    this.nextId = 1;
    const p = this.player;
    p.x = p.y = p.vx = p.vy = 0;
    p.invuln = 0;
    p.dashT = p.dashCd = 0;
    p.alive = true;
    p.deathT = 0;
    p.color = coreColor(cfg.core.hue);
    this.cam.x = this.cam.y = 0;
    this.weapons = [];
    this.passives.clear();
    this.enemies = [];
    this.shots = [];
    this.bullets = [];
    this.gems = [];
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.arcs = [];
    this.waves = [];
    this.xp = 0;
    this.level = 1;
    this.pendingLevels = 0;
    this.rerolls = 0;
    this.revives = 0;
    this.kills = 0;
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.maxCombo = 0;
    this.noHit = 0;
    this.bestNoHit = 0;
    this.spawnAcc = 0;
    this.surgeT = 60;
    this.bossIndex = 0;
    this.bossWarned = -1;
    this.bossesDefeated = 0;
    this.victory = false;
    this.endT = -1;
    this.paused = false;
    this.choosing = false;
    this.currentChoices = [];
    this.timeScale = 1;
    this.hitstop = 0;
    this.shake = 0;
    this.flash = 0;
    this.acc = 0;
    this.audio.sfxEnabled = cfg.mode !== "demo";
    this.audio.setMuffled(cfg.mode === "demo");
  }

  private has(mod: string) {
    return this.cfg?.modifiers.includes(mod) ?? false;
  }

  private recomputeStats() {
    const cfg = this.cfg!;
    const f = (id: string) => cfg.forge[id] ?? 0;
    const pv = (id: PassiveId) => this.passives.get(id) ?? 0;
    const s = this.baseStats();
    const core = cfg.core;
    s.dmg = (core.damageMult || 1) * (1 + 0.05 * f("power")) * (1 + 0.12 * pv("amp"));
    s.cd = (core.cooldownMult || 1) * (1 - 0.07 * pv("overclock"));
    s.area = (core.areaMult || 1) * (1 + 0.12 * pv("lens"));
    s.speed = (core.speedMult || 1) * (1 + 0.04 * f("haste")) * (1 + 0.08 * pv("thrusters"));
    s.magnet = 90 * (1 + 0.15 * f("reach")) * (1 + 0.3 * pv("magnet"));
    s.crit = 0.03 + 0.06 * pv("fracture");
    s.extra = pv("echo");
    s.maxHp = 100 + (core.hpBonus || 0) + 10 * f("vitality") + 20 * pv("hull");
    s.regen = 0.4 * pv("hull");
    s.xpMult = 1 + 0.08 * f("wisdom");
    if (this.has("glass")) {
      s.dmg *= 1.5;
      s.maxHp *= 0.5;
    }
    if (this.has("haste")) s.speed *= 1.2;
    if (this.has("rich")) s.xpMult *= 1.3;
    if (this.has("noregen")) s.regen = 0;
    s.maxHp = Math.max(20, Math.round(s.maxHp));

    const prevMax = this.player.maxHp;
    this.stats = s;
    this.player.maxHp = s.maxHp;
    if (s.maxHp > prevMax) this.player.hp += s.maxHp - prevMax;
    this.player.hp = Math.min(this.player.hp, s.maxHp);
  }

  // ------------------------------------------------------------ loop

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    this.trackPerf(dt);

    this.input.poll();
    if (this.mode !== "demo" && !this.choosing && !this.over && this.endT < 0 && this.input.consumePause()) {
      this.events?.pauseToggle();
    }

    const simulating = !this.paused && !this.choosing && !this.over;
    if (simulating) {
      if (this.hitstop > 0) {
        this.hitstop -= dt;
      } else {
        this.acc += dt * this.timeScale;
        let steps = 0;
        while (this.acc >= STEP && steps < 5 && !this.choosing && !this.paused && !this.over) {
          this.update(STEP);
          this.acc -= STEP;
          steps++;
        }
        if (steps === 5) this.acc = 0;
      }
      this.timeScale = lerp(this.timeScale, 1, damp(1.6, dt));
      if (this.endT >= 0) {
        this.endT -= dt;
        if (this.endT < 0) this.finish();
      }
    }

    if (this.over) this.updateFx(dt);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0 && this.mode !== "demo" && !this.choosing && !this.over) {
      this.hudTimer = 0.1;
      this.emitHud();
    }
    this.render(dt, simulating);
  };

  private trackPerf(dt: number) {
    if (this.settings.quality !== "auto" || this.mode === "demo" || this.paused) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length >= 120) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      if (avg > 0.024 && this.quality !== "low") {
        this.quality = this.quality === "high" ? "balanced" : "low";
        this.resize();
      }
    }
  }

  private update(dt: number) {
    this.time += dt;
    const p = this.player;

    if (this.mode !== "demo" && p.alive) {
      this.director(dt);
      this.noHit += dt;
      if (this.noHit > this.bestNoHit) this.bestNoHit = this.noHit;
      this.score += dt * 2;
    } else if (this.mode === "demo") {
      this.demoDirector(dt);
    }

    this.updatePlayer(dt);
    this.updateEnemies(dt);

    this.hash.clear();
    for (const e of this.enemies) if (!e.dead) this.hash.insert(e);
    this.separate();

    if (p.alive) this.updateWeapons(dt);
    this.updateShots(dt);
    this.updateBullets(dt);
    this.updateGems(dt);
    this.updateFx(dt);

    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (this.pickupChainT > 0) {
      this.pickupChainT -= dt;
      if (this.pickupChainT <= 0) this.pickupChain = 0;
    }

    // Compact dead enemies.
    let j = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.dead) this.enemies[j++] = e;
    }
    this.enemies.length = j;

    const boss = this.enemies.find((e) => e.boss);
    this.audio.boss = !!boss;
    if (this.mode !== "demo") {
      this.audio.intensity = clamp(0.32 + this.time / RUN_LENGTH * 0.6 + Math.min(0.2, this.enemies.length / 900), 0, 1);
    }

    if (this.pendingLevels > 0 && !this.choosing && p.alive && this.endT < 0 && !this.over) this.openLevelUp();
  }

  // ------------------------------------------------------------ director

  private viewHalf() {
    return { w: this.cssW / (2 * this.scale), h: this.cssH / (2 * this.scale) };
  }

  private spawnRadius() {
    const v = this.viewHalf();
    return Math.hypot(v.w, v.h) + 60;
  }

  private director(dt: number) {
    const t = this.time;
    const bossAlive = this.enemies.some((e) => e.boss);
    const cap = QUALITY[this.quality].enemies;

    // Boss schedule with a short warning first.
    if (this.bossIndex < BOSSES.length) {
      const b = BOSSES[this.bossIndex];
      if (t >= b.at - 3 && this.bossWarned < this.bossIndex) {
        this.bossWarned = this.bossIndex;
        this.events?.banner("boss", "boss", this.bossIndex);
        this.audio.play("warn");
        this.events?.haptic("warning");
      }
      if (t >= b.at) {
        this.spawnBoss(this.bossIndex);
        this.bossIndex++;
      }
    }

    let rate = Math.min(15, 1.7 + t * 0.03);
    if (this.has("swarm")) rate *= 1.4;
    if (bossAlive) rate *= 0.4;
    this.spawnAcc += dt * rate;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      // Exactly one draw per spawn slot, even when the cap (which depends on
      // the quality tier) skips it, so daily runs stay identical for everyone.
      const roll = this.spawnRng.next();
      if (this.enemies.length >= cap) continue;
      const sub = new Rng((roll * 4294967296) >>> 0);
      const def = sub.weighted(Object.values(ENEMIES), (d) => (t >= d.unlockAt ? d.weight(t) : 0));
      if (def) this.spawnEnemy(def, null, null, undefined, sub);
    }

    // Surges: a ring of drifters closing in from every side.
    this.surgeT -= dt;
    if (this.surgeT <= 0 && !bossAlive) {
      this.surgeT = 50;
      const n = Math.min(40, 14 + Math.floor(t / 18));
      const R = this.spawnRadius();
      const kind = t > 240 ? ENEMIES.darter : ENEMIES.drifter;
      for (let i = 0; i < n && this.enemies.length < cap + 40; i++) {
        const a = (i / n) * TAU;
        this.spawnEnemy(kind, this.player.x + Math.cos(a) * R, this.player.y + Math.sin(a) * R, undefined, this.spawnRng);
      }
    }
  }

  private demoDirector(dt: number) {
    this.spawnAcc += dt * 4.5;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.enemies.length > 140) break;
      const def = this.rng.weighted(Object.values(ENEMIES), (d) => (d.kind === "mini" ? 0 : d.kind === "tank" ? 0.6 : d.weight(140)));
      if (def) this.spawnEnemy(def, null, null);
    }
  }

  private hpScale() {
    const t = this.time;
    let s = 1 + t / 160 + Math.pow(t / 420, 2);
    if (this.has("rich")) s *= 1.3;
    if (this.has("giant")) s *= 2;
    if (this.mode === "demo") s = 1.2;
    return s;
  }

  private spawnEnemy(def: EnemyDef, x: number | null, y: number | null, eliteOverride?: boolean, rng: Rng = this.rng): Enemy {
    if (x === null || y === null) {
      const a = rng.range(0, TAU);
      const R = this.spawnRadius() + rng.range(0, 80);
      x = this.player.x + Math.cos(a) * R;
      y = this.player.y + Math.sin(a) * R;
    }
    let eliteChance = this.time > 90 ? 0.022 : 0;
    if (this.has("elite")) eliteChance *= 3;
    const elite = eliteOverride ?? (def.kind !== "mini" && rng.chance(eliteChance));
    const giant = this.has("giant");
    const hp = def.hp * this.hpScale() * (elite ? 5 : 1);
    let speed = def.speed * (giant ? 0.85 : 1) * (this.has("haste") ? 1.2 : 1);
    speed *= 1 + Math.min(0.35, this.time / 1200);
    const e: Enemy = {
      id: this.nextId++, kind: def.kind, x, y, vx: 0, vy: 0, kx: 0, ky: 0,
      r: def.r * (elite ? 1.35 : 1) * (giant ? 1.35 : 1),
      hp, maxHp: hp, speed, dmg: def.dmg * (elite ? 1.5 : 1) * (1 + this.time / 900),
      xp: def.xp * (elite ? 8 : 1), score: def.score * (elite ? 5 : 1), color: def.color, shape: def.shape,
      knockResist: elite ? Math.max(0.6, def.knockResist) : def.knockResist, elite,
      flash: 0, t: rng.range(0, 3), state: 0, stateT: rng.range(0.5, 2), angle: 0, orbitHit: 0, dead: false, boss: null,
    };
    this.enemies.push(e);
    if (elite && this.mode !== "demo") this.audio.play("elite");
    return e;
  }

  private spawnBoss(i: number) {
    const b = BOSSES[i];
    const a = this.spawnRng.range(0, TAU);
    const R = this.spawnRadius() * 0.8;
    const hp = b.hp * (this.has("rich") ? 1.3 : 1) * (this.has("giant") ? 1.5 : 1);
    const e: Enemy = {
      id: this.nextId++, kind: "boss", x: this.player.x + Math.cos(a) * R, y: this.player.y + Math.sin(a) * R,
      vx: 0, vy: 0, kx: 0, ky: 0, r: b.r, hp, maxHp: hp, speed: 60 + i * 8, dmg: 22 + i * 6,
      xp: 0, score: 5000 * (i + 1), color: b.color, shape: "boss", knockResist: 1, elite: false,
      flash: 0, t: 0, state: 0, stateT: 0, angle: 0, orbitHit: 0, dead: false,
      boss: { tier: i + 1, pattern: 0, step: 0, patternT: 4, fireT: 0, spiral: 0, charges: 0 },
    };
    this.enemies.push(e);
    this.waves.push({ x: e.x, y: e.y, t: 0, life: 1.4, strength: 60, speed: 500 });
    this.addShake(10);
  }

  // ------------------------------------------------------------ player

  private updatePlayer(dt: number) {
    const p = this.player;
    if (!p.alive) return;
    let mx = this.input.move.x;
    let my = this.input.move.y;
    let wantDash = this.input.consumeDash();

    if (this.mode === "demo") {
      const ai = this.demoSteer(dt);
      mx = ai.x;
      my = ai.y;
      wantDash = ai.dash;
    }

    const speed = 215 * this.stats.speed;
    p.dashCd -= dt;
    if (wantDash && p.dashCd <= 0 && p.dashT <= 0) {
      let dx = mx, dy = my;
      if (Math.hypot(dx, dy) < 0.1) {
        dx = Math.cos(p.angle);
        dy = Math.sin(p.angle);
      }
      const l = Math.hypot(dx, dy) || 1;
      p.dashVx = (dx / l) * 760;
      p.dashVy = (dy / l) * 760;
      p.dashT = 0.16;
      p.dashCd = 1.5;
      p.invuln = Math.max(p.invuln, 0.32);
      this.audio.play("dash");
      this.events?.haptic("light");
    }

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashVx;
      p.vy = p.dashVy;
      if (Math.random() < 0.9) this.burst(p.x, p.y, 2, p.color, 60, 0.35, 3, true);
    } else {
      const k = damp(14, dt);
      p.vx = lerp(p.vx, mx * speed, k);
      p.vy = lerp(p.vy, my * speed, k);
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 20) p.angle += angleDiff(p.angle, Math.atan2(p.vy, p.vx)) * damp(12, dt);
    if (sp > 60 && Math.random() < 0.5) {
      this.particle(p.x - Math.cos(p.angle) * 14, p.y - Math.sin(p.angle) * 14,
        -p.vx * 0.2 + (Math.random() - 0.5) * 30, -p.vy * 0.2 + (Math.random() - 0.5) * 30, 0.4, 2.4, p.color, 3, false);
    }

    p.invuln -= dt;
    if (this.stats.regen > 0) p.hp = Math.min(p.maxHp, p.hp + this.stats.regen * dt);
    if (this.mode === "demo") p.hp = p.maxHp;

    // Camera with a little look-ahead.
    const tx = p.x + p.vx * 0.18;
    const ty = p.y + p.vy * 0.18;
    const ck = damp(5, dt);
    this.cam.x = lerp(this.cam.x, tx, ck);
    this.cam.y = lerp(this.cam.y, ty, ck);
  }

  private demoSteer(dt: number) {
    const p = this.player;
    let ax = 0, ay = 0, threat = 0;
    for (const e of this.enemies) {
      const dx = p.x - e.x, dy = p.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 260 * 260 && d2 > 1) {
        const w = 1 / d2;
        ax += dx * w;
        ay += dy * w;
        if (d2 < 70 * 70) threat++;
      }
    }
    for (const b of this.bullets) {
      const dx = p.x - b.x, dy = p.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 120 * 120 && d2 > 1) {
        ax += (dx / d2) * 2;
        ay += (dy / d2) * 2;
      }
    }
    this.demoWander += dt * 0.35;
    // A lazy figure-eight around the origin keeps the demo on screen.
    const wx = Math.cos(this.demoWander) * 260 - p.x;
    const wy = Math.sin(this.demoWander * 2) * 140 - p.y;
    const wl = Math.hypot(wx, wy) || 1;
    let x = ax * 900 + (wx / wl) * 0.6;
    let y = ay * 900 + (wy / wl) * 0.6;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y, dash: threat > 2 && Math.random() < 0.05 };
  }

  private hurtPlayer(dmg: number) {
    const p = this.player;
    if (p.invuln > 0 || !p.alive || this.mode === "demo" || this.endT >= 0) return;
    p.hp -= dmg;
    p.invuln = 0.75;
    this.noHit = 0;
    this.addShake(9);
    this.hitstop = Math.max(this.hitstop, 0.045);
    this.flash = this.settings.reducedFlash ? 0.12 : 0.35;
    this.flashColor = "#ff2050";
    this.audio.play("hurt");
    this.events?.haptic("medium");
    this.burst(p.x, p.y, 14, PALETTE.red, 260, 0.5, 3, true);
    if (p.hp <= 0) {
      if (this.revives > 0) {
        this.revives--;
        p.hp = p.maxHp * 0.5;
        p.invuln = 2.5;
        this.shockwave(p.x, p.y, 320, 80, 520, PALETTE.white);
        this.events?.banner("revive", "good");
        this.audio.play("levelup");
        this.events?.haptic("success");
        return;
      }
      p.hp = 0;
      p.alive = false;
      this.timeScale = 0.25;
      this.addShake(22);
      this.flash = this.settings.reducedFlash ? 0.2 : 0.7;
      this.flashColor = "#ffffff";
      this.burst(p.x, p.y, 120, p.color, 520, 1.4, 4, true);
      this.burst(p.x, p.y, 60, PALETTE.white, 300, 1, 3, false);
      this.rings.push({ x: p.x, y: p.y, r: 10, maxR: 400, life: 1.2, max: 1.2, color: p.color, width: 6 });
      this.waves.push({ x: p.x, y: p.y, t: 0, life: 1.6, strength: 80, speed: 600 });
      this.audio.play("boom");
      this.events?.haptic("error");
      this.endT = 2.2;
    }
  }

  // ------------------------------------------------------------ weapons

  private nearest(x: number, y: number, maxD: number, exclude?: Set<number>): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxD * maxD;
    for (const e of this.enemies) {
      if (e.dead || (exclude && exclude.has(e.id))) continue;
      const dx = e.x - x, dy = e.y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private updateWeapons(dt: number) {
    const p = this.player;
    const s = this.stats;
    for (const w of this.weapons) {
      const L = w.level - 1;
      switch (w.id) {
        case "pulse": {
          w.cd -= dt;
          if (w.cd > 0) break;
          const tgt = this.nearest(p.x, p.y, 560);
          if (!tgt) {
            w.cd = 0.1;
            break;
          }
          w.cd = W.pulse.cd[L] * s.cd;
          const d = Math.hypot(tgt.x - p.x, tgt.y - p.y);
          const lead = d / 640;
          const base = Math.atan2(tgt.y + tgt.vy * lead - p.y, tgt.x + tgt.vx * lead - p.x);
          const n = W.pulse.count[L] + s.extra;
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.13;
            this.shots.push({
              x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16, vx: Math.cos(a) * 640, vy: Math.sin(a) * 640,
              r: 5 * Math.sqrt(s.area), dmg: W.pulse.dmg[L] * s.dmg, pierce: W.pulse.pierce[L], life: 1.1,
              color: PALETTE.cyan, kind: "bolt", target: null, hits: [], blast: 0, speed: 640,
            });
          }
          this.audio.play("shoot", 1 + Math.random() * 0.1);
          break;
        }
        case "orbit": {
          w.angle += W.orbit.spin[L] * dt;
          const n = W.orbit.count[L] + s.extra;
          const R = 78 * s.area;
          const hitR = 11 * s.area;
          for (let i = 0; i < n; i++) {
            const a = w.angle + (i / n) * TAU;
            const ox = p.x + Math.cos(a) * R;
            const oy = p.y + Math.sin(a) * R;
            this.hash.query(ox, oy, hitR + 40, this.q);
            for (const e of this.q) {
              if (e.dead || e.orbitHit > this.time) continue;
              const dx = e.x - ox, dy = e.y - oy;
              if (dx * dx + dy * dy < (e.r + hitR) * (e.r + hitR)) {
                e.orbitHit = this.time + 0.4;
                const kl = Math.hypot(e.x - p.x, e.y - p.y) || 1;
                this.damage(e, W.orbit.dmg[L] * s.dmg, ((e.x - p.x) / kl) * 220, ((e.y - p.y) / kl) * 220);
              }
            }
          }
          break;
        }
        case "arc": {
          w.cd -= dt;
          if (w.cd > 0) break;
          const first = this.nearest(p.x, p.y, 380);
          if (!first) {
            w.cd = 0.15;
            break;
          }
          w.cd = W.arc.cd[L] * s.cd;
          const seen = new Set<number>();
          const pts = [p.x, p.y];
          let cur: Enemy | null = first;
          for (let j = 0; j < W.arc.jumps[L] + s.extra && cur; j++) {
            seen.add(cur.id);
            pts.push(cur.x, cur.y);
            this.damage(cur, W.arc.dmg[L] * s.dmg, 0, 0);
            this.burst(cur.x, cur.y, 4, "#9FE8FF", 160, 0.25, 2, true);
            cur = this.nearest(cur.x, cur.y, 170 * s.area, seen);
          }
          this.arcs.push({ pts, life: 0.2 });
          this.audio.play("zap", 0.9 + Math.random() * 0.3);
          break;
        }
        case "nova": {
          w.cd -= dt;
          if (w.cd > 0) break;
          w.cd = W.nova.cd[L] * s.cd;
          this.shockwave(p.x, p.y, W.nova.radius[L] * s.area, W.nova.dmg[L] * s.dmg, 320, PALETTE.amber);
          this.audio.play("nova");
          break;
        }
        case "seeker": {
          w.cd -= dt;
          if (w.cd > 0) break;
          if (!this.nearest(p.x, p.y, 600)) {
            w.cd = 0.2;
            break;
          }
          w.cd = W.seeker.cd[L] * s.cd;
          const n = W.seeker.count[L] + s.extra;
          for (let i = 0; i < n; i++) {
            const a = p.angle + Math.PI + (i - (n - 1) / 2) * 0.5 + (Math.random() - 0.5) * 0.3;
            this.shots.push({
              x: p.x, y: p.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, r: 6, dmg: W.seeker.dmg[L] * s.dmg,
              pierce: 0, life: 2.6, color: PALETTE.magenta, kind: "missile", target: null, hits: [],
              blast: (44 + L * 4) * s.area, speed: 240,
            });
          }
          this.audio.play("missile");
          break;
        }
        case "beam": {
          w.angle += 1.5 * dt;
          w.tick -= dt;
          if (w.tick > 0) break;
          w.tick = 0.1;
          const n = Math.min(4, W.beam.count[L] + s.extra);
          const len = W.beam.len[L] * s.area;
          const dmg = W.beam.dps[L] * 0.1 * s.dmg;
          for (let i = 0; i < n; i++) {
            const a = w.angle + (i / n) * TAU;
            const ex = p.x + Math.cos(a) * len;
            const ey = p.y + Math.sin(a) * len;
            this.hash.query((p.x + ex) / 2, (p.y + ey) / 2, len / 2 + 30, this.q2);
            for (const e of this.q2) {
              if (e.dead) continue;
              if (distToSegment(e.x, e.y, p.x, p.y, ex, ey) < e.r + 7) {
                this.damage(e, dmg, Math.cos(a) * 30, Math.sin(a) * 30, true);
                if (Math.random() < 0.4) this.particle(e.x, e.y, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.3, 2.5, SPECTRUM[(Math.random() * SPECTRUM.length) | 0], 4, true);
              }
            }
          }
          break;
        }
      }
    }
  }

  private shockwave(x: number, y: number, radius: number, dmg: number, knock: number, color: string) {
    this.hash.query(x, y, radius + 30, this.q);
    for (const e of this.q) {
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y;
      const d = Math.hypot(dx, dy);
      if (d < radius + e.r) {
        const l = d || 1;
        this.damage(e, dmg, (dx / l) * knock, (dy / l) * knock);
      }
    }
    // Clear nearby enemy bullets too, so shockwaves feel defensive.
    for (const b of this.bullets) {
      if (Math.hypot(b.x - x, b.y - y) < radius) b.life = 0;
    }
    this.rings.push({ x, y, r: 10, maxR: radius, life: 0.45, max: 0.45, color, width: 5 });
    this.waves.push({ x, y, t: 0, life: 0.9, strength: 26, speed: radius * 2.2 });
    this.addShake(4);
  }

  private damage(e: Enemy, amount: number, kx: number, ky: number, quiet = false) {
    if (e.dead) return;
    const crit = Math.random() < this.stats.crit;
    const dmg = crit ? amount * 2 : amount;
    e.hp -= dmg;
    e.flash = 0.07;
    const res = 1 - e.knockResist;
    e.kx += kx * res;
    e.ky += ky * res;
    if (this.settings.damageNumbers && this.mode !== "demo" && (!quiet || crit) && this.texts.length < 70) {
      this.texts.push({ x: e.x + (Math.random() - 0.5) * 10, y: e.y - e.r, vy: -60, life: 0.6, text: String(Math.round(dmg)), crit });
    }
    if (!quiet) this.audio.play("hit", 1, 0.8);
    if (e.hp <= 0) this.kill(e);
  }

  private kill(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    const big = e.r > 20 || e.elite;
    this.burst(e.x, e.y, big ? 36 : 14, e.color, big ? 340 : 240, big ? 0.8 : 0.5, big ? 4 : 3, true);
    this.burst(e.x, e.y, big ? 10 : 4, PALETTE.white, 120, 0.3, 2.5, false);
    if (big) {
      this.rings.push({ x: e.x, y: e.y, r: e.r, maxR: e.r * 4, life: 0.4, max: 0.4, color: e.color, width: 4 });
      this.waves.push({ x: e.x, y: e.y, t: 0, life: 0.7, strength: 14, speed: 360 });
    }

    if (e.boss) {
      this.onBossKilled(e);
      return;
    }

    if (this.mode !== "demo") {
      this.kills++;
      this.combo++;
      this.comboT = 2.5;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.score += e.score * this.comboMult();
      this.audio.play("kill", 0.9 + Math.random() * 0.25, big ? 1.2 : 0.8);
      if (e.elite) {
        this.addShake(5);
        this.events?.haptic("light");
      }
    }

    // Drops
    this.dropGem(e.x, e.y, e.xp, "xp");
    if (e.elite) {
      if (this.rng.chance(0.35)) this.dropGem(e.x + 10, e.y, 0, "heal");
      if (this.rng.chance(0.15)) this.dropGem(e.x - 10, e.y, 0, "vortex");
    } else if (this.rng.chance(0.003)) {
      this.dropGem(e.x, e.y, 0, this.rng.chance(0.6) ? "heal" : "vortex");
    }

    if (e.kind === "splitter") {
      for (let i = 0; i < 3; i++) {
        const m = this.spawnEnemy(ENEMIES.mini, e.x + (Math.random() - 0.5) * 20, e.y + (Math.random() - 0.5) * 20, false);
        const a = (i / 3) * TAU;
        m.kx = Math.cos(a) * 200;
        m.ky = Math.sin(a) * 200;
      }
    }
    if (this.has("volatile") && e.kind !== "mini") {
      for (let i = 0; i < 6; i++) this.fireBullet(e.x, e.y, (i / 6) * TAU + e.t, 120);
    }
  }

  private onBossKilled(e: Enemy) {
    const tier = e.boss!.tier;
    this.bossesDefeated++;
    this.kills++;
    this.score += e.score;
    this.timeScale = 0.2;
    this.hitstop = 0.12;
    this.addShake(24);
    this.flash = this.settings.reducedFlash ? 0.15 : 0.6;
    this.flashColor = "#ffffff";
    this.burst(e.x, e.y, 160, e.color, 600, 1.6, 5, true);
    this.burst(e.x, e.y, 80, PALETTE.white, 380, 1.2, 3, false);
    for (let i = 0; i < 4; i++) {
      this.rings.push({ x: e.x, y: e.y, r: 20, maxR: 200 + i * 120, life: 0.6 + i * 0.25, max: 0.6 + i * 0.25, color: SPECTRUM[i * 2], width: 6 });
    }
    this.waves.push({ x: e.x, y: e.y, t: 0, life: 1.8, strength: 90, speed: 700 });
    this.bullets.length = 0;
    this.audio.play("boom");
    this.audio.play("victory");
    this.events?.haptic("heavy");
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU;
      this.dropGem(e.x + Math.cos(a) * 40, e.y + Math.sin(a) * 40, 6 + tier * 4, "xp");
    }
    this.dropGem(e.x, e.y - 30, 0, "heal");
    this.dropGem(e.x, e.y + 30, 0, "vortex");
    if (tier >= BOSSES.length) {
      this.victory = true;
      this.events?.banner("victory", "good");
      this.endT = 4;
      for (const o of this.enemies) {
        if (o.boss || o.dead) continue;
        o.dead = true;
        this.burst(o.x, o.y, 6, o.color, 220, 0.5, 3, true);
      }
      this.bullets.length = 0;
    } else {
      this.events?.banner("bossDown", "good", tier - 1);
    }
  }

  private comboMult() {
    return Math.min(5, 1 + Math.floor(this.combo / 10) * 0.5);
  }

  // ------------------------------------------------------------ enemies

  private fireBullet(x: number, y: number, a: number, speed: number, dmg = 12) {
    if (this.bullets.length > 500) return;
    const sp = speed * (this.has("haste") ? 1.2 : 1);
    this.bullets.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 6, life: 6, dmg: dmg * (1 + this.time / 900) });
  }

  private updateEnemies(dt: number) {
    const p = this.player;
    const R = this.spawnRadius();
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.t += dt;
      e.flash -= dt;
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      let tvx = ux * e.speed, tvy = uy * e.speed;
      let accel = 4;

      switch (e.kind) {
        case "darter":
          e.stateT -= dt;
          if (e.state === 0) {
            if (d < 380 && e.stateT <= 0) {
              e.state = 1;
              e.stateT = 0.45;
            }
          } else if (e.state === 1) {
            tvx = tvy = 0;
            accel = 10;
            if (e.stateT <= 0) {
              e.state = 2;
              e.stateT = 0.5;
              e.vx = ux * 440;
              e.vy = uy * 440;
            }
          } else {
            tvx = e.vx;
            tvy = e.vy;
            if (e.stateT <= 0) {
              e.state = 0;
              e.stateT = 2.2;
            }
          }
          break;
        case "shooter": {
          if (d > 330) { /* approach */ } else if (d < 230) {
            tvx = -ux * e.speed;
            tvy = -uy * e.speed;
          } else {
            const side = e.id % 2 ? 1 : -1;
            tvx = -uy * e.speed * 0.7 * side;
            tvy = ux * e.speed * 0.7 * side;
          }
          e.stateT -= dt;
          if (e.stateT <= 0 && d < 560) {
            e.stateT = this.mode === "demo" ? 3.5 : 2.4;
            const a = Math.atan2(dy, dx);
            if (this.time > 300) for (let k = -1; k <= 1; k++) this.fireBullet(e.x, e.y, a + k * 0.22, 190);
            else this.fireBullet(e.x, e.y, a, 190);
          }
          break;
        }
        case "bomber":
          if (e.state === 0 && d < 72) {
            e.state = 1;
            e.stateT = 0.55;
          }
          if (e.state === 1) {
            tvx *= 0.2;
            tvy *= 0.2;
            e.stateT -= dt;
            if (e.stateT <= 0) {
              this.explodeBomber(e);
              continue;
            }
          }
          break;
        case "boss":
          this.updateBoss(e, dt, d, ux, uy);
          continue;
      }

      const k = damp(accel, dt);
      e.vx = lerp(e.vx, tvx, k);
      e.vy = lerp(e.vy, tvy, k);
      e.x += (e.vx + e.kx) * dt;
      e.y += (e.vy + e.ky) * dt;
      const kd = Math.exp(-8 * dt);
      e.kx *= kd;
      e.ky *= kd;
      if (e.shape === "tri" || e.shape === "diamond") e.angle = Math.atan2(e.vy, e.vx);
      else e.angle += dt * (e.shape === "star" ? 3 : 0.8);

      if (d < e.r + p.r - 2) this.hurtPlayer(e.dmg);

      // Enemies left far behind are recycled to the front of the swarm.
      if (d > R * 1.6) {
        const a = Math.atan2(p.vy || this.rng.range(-1, 1), p.vx || this.rng.range(-1, 1)) + this.rng.range(-0.8, 0.8);
        e.x = p.x + Math.cos(a) * R;
        e.y = p.y + Math.sin(a) * R;
      }
    }
  }

  private explodeBomber(e: Enemy) {
    const p = this.player;
    e.dead = true;
    const R = 80;
    this.burst(e.x, e.y, 30, PALETTE.yellow, 360, 0.6, 4, true);
    this.rings.push({ x: e.x, y: e.y, r: 10, maxR: R, life: 0.35, max: 0.35, color: PALETTE.yellow, width: 5 });
    this.waves.push({ x: e.x, y: e.y, t: 0, life: 0.6, strength: 18, speed: 300 });
    this.audio.play("boom", 1, 0.5);
    if (Math.hypot(p.x - e.x, p.y - e.y) < R + p.r) this.hurtPlayer(e.dmg * 2);
    this.hash.query(e.x, e.y, R, this.q2);
    for (const o of this.q2) {
      if (o !== e && !o.dead && !o.boss && Math.hypot(o.x - e.x, o.y - e.y) < R) this.damage(o, 40, 0, 0, true);
    }
  }

  private updateBoss(e: Enemy, dt: number, d: number, ux: number, uy: number) {
    const b = e.boss!;
    const p = this.player;
    const enr = e.hp < e.maxHp * 0.5 ? 1.35 : 1;
    const tier = b.tier;
    b.patternT -= dt;
    e.angle += dt * (0.6 + tier * 0.15) * enr;

    let tvx = 0, tvy = 0;
    if (b.pattern !== 2) {
      if (d > 260) {
        tvx = ux * e.speed;
        tvy = uy * e.speed;
      } else {
        tvx = -uy * e.speed * 0.8;
        tvy = ux * e.speed * 0.8;
      }
    }

    b.fireT -= dt;
    switch (b.pattern) {
      case 0: // spiral
        if (b.fireT <= 0) {
          b.fireT = (0.1 - tier * 0.008) / enr;
          const arms = 2 + tier;
          for (let k = 0; k < arms; k++) this.fireBullet(e.x, e.y, b.spiral + (k / arms) * TAU, 165 + tier * 10, 14);
          b.spiral += 0.21;
        }
        break;
      case 1: // rings, plus aimed fans from the second boss on
        if (b.fireT <= 0) {
          b.fireT = 0.85 / enr;
          const n = 14 + tier * 4;
          const off = Math.random() * TAU;
          for (let k = 0; k < n; k++) this.fireBullet(e.x, e.y, off + (k / n) * TAU, 150, 14);
          if (tier >= 2) {
            const a = Math.atan2(p.y - e.y, p.x - e.x);
            for (let k = -2; k <= 2; k++) this.fireBullet(e.x, e.y, a + k * 0.14, 240, 14);
          }
        }
        break;
      case 2: // charge
        e.stateT -= dt;
        if (e.state === 0) {
          // wind-up: shudder in place
          e.x += (Math.random() - 0.5) * 3;
          e.y += (Math.random() - 0.5) * 3;
          if (e.stateT <= 0) {
            e.state = 1;
            e.stateT = 0.65;
            e.vx = ux * (520 + tier * 40);
            e.vy = uy * (520 + tier * 40);
            this.addShake(6);
            this.audio.play("dash", 0.6, 1.5);
          }
        } else {
          tvx = e.vx;
          tvy = e.vy;
          if (tier >= 2 && b.fireT <= 0) {
            b.fireT = 0.06;
            const a = Math.atan2(e.vy, e.vx) + Math.PI / 2;
            this.fireBullet(e.x, e.y, a, 80, 12);
            this.fireBullet(e.x, e.y, a + Math.PI, 80, 12);
          }
          if (e.stateT <= 0) {
            b.charges--;
            e.state = 0;
            e.stateT = 0.7 / enr;
            if (b.charges <= 0) b.patternT = 0;
          }
        }
        break;
      case 3: // summon
        if (b.fireT <= 0 && b.charges > 0) {
          b.charges = 0;
          const n = 5 + tier * 3;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * TAU;
            this.spawnEnemy(tier >= 2 ? ENEMIES.darter : ENEMIES.drifter, e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 90, false);
          }
          this.rings.push({ x: e.x, y: e.y, r: e.r, maxR: 140, life: 0.5, max: 0.5, color: e.color, width: 4 });
        }
        break;
    }

    if (b.patternT <= 0) {
      const order = tier >= 3 ? [0, 2, 1, 3, 2] : [0, 1, 2, 3];
      // Walk the order by index: it repeats patterns, so indexOf would loop early.
      b.step = (b.step + 1) % order.length;
      b.pattern = order[b.step];
      b.fireT = 0.4;
      b.patternT = b.pattern === 2 ? 99 : b.pattern === 3 ? 1.6 : 4.2;
      b.charges = b.pattern === 2 ? 2 + (tier >= 3 ? 1 : 0) : 1;
      e.state = 0;
      e.stateT = b.pattern === 2 ? 0.8 : 0;
    }

    const k = damp(b.pattern === 2 ? 20 : 3, dt);
    e.vx = lerp(e.vx, tvx, k);
    e.vy = lerp(e.vy, tvy, k);
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (d < e.r + p.r - 4) this.hurtPlayer(e.dmg);
  }

  private separate() {
    for (const e of this.enemies) {
      if (e.dead || e.boss) continue;
      this.hash.query(e.x, e.y, e.r * 2, this.q);
      let checked = 0;
      for (const o of this.q) {
        if (o === e || o.dead) continue;
        if (++checked > 10) break;
        const dx = e.x - o.x, dy = e.y - o.y;
        const min = e.r + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.25;
          e.x += dx * push;
          e.y += dy * push;
          if (!o.boss) {
            o.x -= dx * push;
            o.y -= dy * push;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ projectiles

  private updateShots(dt: number) {
    let j = 0;
    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i];
      s.life -= dt;
      if (s.kind === "missile") {
        if (!s.target || s.target.dead) s.target = this.nearest(s.x, s.y, 520);
        s.speed = Math.min(480, s.speed + 600 * dt);
        let a = Math.atan2(s.vy, s.vx);
        if (s.target) a += clamp(angleDiff(a, Math.atan2(s.target.y - s.y, s.target.x - s.x)), -6 * dt, 6 * dt);
        s.vx = Math.cos(a) * s.speed;
        s.vy = Math.sin(a) * s.speed;
        if (Math.random() < 0.7) this.particle(s.x, s.y, -s.vx * 0.1, -s.vy * 0.1, 0.3, 2, PALETTE.magenta, 3, false);
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      this.hash.query(s.x, s.y, s.r + 30, this.q);
      for (const e of this.q) {
        if (e.dead || s.hits.includes(e.id)) continue;
        const dx = e.x - s.x, dy = e.y - s.y;
        if (dx * dx + dy * dy < (e.r + s.r) * (e.r + s.r)) {
          if (s.kind === "missile") {
            this.missileBlast(s);
            s.life = 0;
            break;
          }
          const l = Math.hypot(s.vx, s.vy) || 1;
          this.damage(e, s.dmg, (s.vx / l) * 120, (s.vy / l) * 120);
          this.burst(s.x, s.y, 3, s.color, 140, 0.2, 2, true);
          s.hits.push(e.id);
          if (s.pierce-- <= 0) {
            s.life = 0;
            break;
          }
        }
      }
      if (s.life > 0) this.shots[j++] = s;
      else if (s.kind === "missile" && s.hits.length === 0 && s.life > -1) {
        // Missiles that time out still pop.
        this.missileBlast(s);
      }
    }
    this.shots.length = j;
  }

  private missileBlast(s: Shot) {
    s.hits.push(-1);
    this.hash.query(s.x, s.y, s.blast + 30, this.q2);
    for (const e of this.q2) {
      if (!e.dead && Math.hypot(e.x - s.x, e.y - s.y) < s.blast + e.r) {
        const l = Math.hypot(e.x - s.x, e.y - s.y) || 1;
        this.damage(e, s.dmg, ((e.x - s.x) / l) * 160, ((e.y - s.y) / l) * 160, true);
      }
    }
    this.burst(s.x, s.y, 12, PALETTE.magenta, 220, 0.4, 3, true);
    this.rings.push({ x: s.x, y: s.y, r: 6, maxR: s.blast, life: 0.25, max: 0.25, color: PALETTE.magenta, width: 3 });
    this.audio.play("hit", 0.6);
  }

  private updateBullets(dt: number) {
    const p = this.player;
    let j = 0;
    for (const b of this.bullets) {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const dx = b.x - p.x, dy = b.y - p.y;
      if (p.alive && dx * dx + dy * dy < (b.r + p.r * 0.7) * (b.r + p.r * 0.7)) {
        this.hurtPlayer(b.dmg);
        if (p.invuln > 0.5 || this.mode === "demo") b.life = 0;
      }
      if (b.life > 0 && dx * dx + dy * dy < 1600 * 1600) this.bullets[j++] = b;
    }
    this.bullets.length = j;
  }

  // ------------------------------------------------------------ pickups

  private dropGem(x: number, y: number, value: number, kind: Gem["kind"]) {
    if (kind === "xp") {
      if (value <= 0) return;
      // Merge into a nearby gem when the field is crowded.
      if (this.gems.length > 260) {
        for (let i = this.gems.length - 1; i >= Math.max(0, this.gems.length - 60); i--) {
          const g = this.gems[i];
          if (g.kind === "xp" && Math.abs(g.x - x) < 90 && Math.abs(g.y - y) < 90) {
            g.value += value;
            return;
          }
        }
      }
    }
    const a = Math.random() * TAU;
    this.gems.push({ x, y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, value, kind, magnet: false, t: 0 });
  }

  private updateGems(dt: number) {
    const p = this.player;
    const mag = this.stats.magnet;
    let j = 0;
    for (const g of this.gems) {
      g.t += dt;
      const dx = p.x - g.x, dy = p.y - g.y;
      const d = Math.hypot(dx, dy) || 1;
      if (!g.magnet && p.alive && d < mag) g.magnet = true;
      if (g.magnet) {
        const sp = 300 + g.t * 400;
        g.vx = lerp(g.vx, (dx / d) * sp, damp(10, dt));
        g.vy = lerp(g.vy, (dy / d) * sp, damp(10, dt));
      } else {
        g.vx *= Math.exp(-4 * dt);
        g.vy *= Math.exp(-4 * dt);
      }
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      if (p.alive && d < p.r + 10) {
        this.collect(g);
        continue;
      }
      if (d > 2400) continue; // lost forever
      this.gems[j++] = g;
    }
    this.gems.length = j;
  }

  private collect(g: Gem) {
    const p = this.player;
    if (g.kind === "heal") {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
      this.audio.play("heal");
      this.burst(p.x, p.y, 16, PALETTE.mint, 200, 0.5, 3, true);
      this.events?.haptic("light");
      return;
    }
    if (g.kind === "vortex") {
      for (const o of this.gems) if (o.kind === "xp") o.magnet = true;
      this.rings.push({ x: p.x, y: p.y, r: 10, maxR: 500, life: 0.6, max: 0.6, color: PALETTE.violet, width: 4 });
      this.audio.play("levelup", 1, 0.5);
      return;
    }
    if (this.mode === "demo") return;
    this.xp += g.value * this.stats.xpMult;
    this.audio.play("pickup", this.pickupChain);
    this.pickupChain = Math.min(this.pickupChain + 1, 14);
    this.pickupChainT = 0.6;
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      this.pendingLevels++;
    }
  }

  // ------------------------------------------------------------ level up

  private openLevelUp() {
    this.choosing = true;
    this.currentChoices = this.rollChoices();
    const p = this.player;
    this.audio.play("levelup");
    this.audio.setMuffled(true);
    this.events?.haptic("success");
    this.burst(p.x, p.y, 40, PALETTE.mint, 300, 0.8, 3, true);
    this.rings.push({ x: p.x, y: p.y, r: 10, maxR: 220, life: 0.5, max: 0.5, color: PALETTE.mint, width: 5 });
    // Give the player room to breathe when play resumes.
    this.hash.query(p.x, p.y, 200, this.q);
    for (const e of this.q) {
      if (e.boss) continue;
      const l = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      e.kx += ((e.x - p.x) / l) * 360 * (1 - e.knockResist);
      e.ky += ((e.y - p.y) / l) * 360 * (1 - e.knockResist);
    }
    this.emitHud();
    this.events?.levelUp(this.currentChoices, this.rerolls);
  }

  private rollChoices(): Choice[] {
    type Opt = { c: Choice; w: number };
    const opts: Opt[] = [];
    for (const w of this.weapons) {
      if (w.level < MAX_WEAPON_LEVEL) {
        const d = WEAPONS[w.id];
        opts.push({ w: 3, c: { kind: "weapon", id: w.id, level: w.level + 1, color: d.color, icon: d.icon, isNew: false, isMax: w.level + 1 === MAX_WEAPON_LEVEL } });
      }
    }
    if (this.weapons.length < MAX_WEAPONS) {
      for (const d of Object.values(WEAPONS)) {
        if (this.weapons.some((w) => w.id === d.id)) continue;
        opts.push({ w: 2, c: { kind: "weapon", id: d.id, level: 1, color: d.color, icon: d.icon, isNew: true, isMax: false } });
      }
    }
    for (const d of Object.values(PASSIVES)) {
      const lv = this.passives.get(d.id) ?? 0;
      if (lv >= d.max) continue;
      if (lv === 0 && this.passives.size >= MAX_PASSIVES) continue;
      opts.push({ w: lv > 0 ? 2.4 : 1.5, c: { kind: "passive", id: d.id, level: lv + 1, color: d.color, icon: d.icon, isNew: lv === 0, isMax: lv + 1 === d.max } });
    }
    const out: Choice[] = [];
    // Choices use Math.random so daily-run spawns stay in sync regardless of picks.
    while (out.length < 3 && opts.length > 0) {
      let total = 0;
      for (const o of opts) total += o.w;
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < opts.length - 1; idx++) {
        r -= opts[idx].w;
        if (r <= 0) break;
      }
      out.push(opts[idx].c);
      opts.splice(idx, 1);
    }
    if (out.length < 3) {
      out.push({ kind: "heal", id: "repair", level: 0, color: PALETTE.mint, icon: PASSIVES.hull.icon, isNew: false, isMax: false });
    }
    if (out.length < 3) {
      out.push({ kind: "score", id: "cache", level: 0, color: PALETTE.amber, icon: PASSIVES.fracture.icon, isNew: false, isMax: false });
    }
    return out;
  }

  private applyChoice(c: Choice) {
    if (c.kind === "weapon") {
      const w = this.weapons.find((x) => x.id === c.id);
      if (w) w.level = c.level;
      else this.weapons.push({ id: c.id as WeaponId, level: 1, cd: 0.2, angle: 0, tick: 0 });
    } else if (c.kind === "passive") {
      this.passives.set(c.id as PassiveId, c.level);
    } else if (c.kind === "heal") {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.4);
    } else {
      this.score += 1000;
    }
  }

  // ------------------------------------------------------------ end of run

  private finish() {
    this.endT = -1;
    if (this.over) return;
    this.over = true;
    this.player.invuln = 1e9;
    this.events?.gameOver({
      score: Math.round(this.score),
      kills: this.kills,
      level: this.level,
      timeSec: this.time,
      bossesDefeated: this.bossesDefeated,
      victory: this.victory,
      maxCombo: this.maxCombo,
      noHitSec: this.bestNoHit,
      weapons: this.loadoutWeapons(),
      passives: this.loadoutPassives(),
    });
  }

  private loadoutWeapons(): Loadout[] {
    return this.weapons.map((w) => ({ kind: "weapon" as const, id: w.id, level: w.level, max: MAX_WEAPON_LEVEL, color: WEAPONS[w.id].color, icon: WEAPONS[w.id].icon }));
  }

  private loadoutPassives(): Loadout[] {
    return [...this.passives.entries()].map(([id, level]) => ({ kind: "passive" as const, id, level, max: PASSIVES[id].max, color: PASSIVES[id].color, icon: PASSIVES[id].icon }));
  }

  private emitHud() {
    if (!this.events || this.mode === "demo") return;
    const boss = this.enemies.find((e) => e.boss && !e.dead);
    this.events.hud({
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      xp: this.xp,
      xpNext: xpToNext(this.level),
      level: this.level,
      time: this.time,
      kills: this.kills,
      score: Math.round(this.score),
      combo: this.combo,
      comboMult: this.comboMult(),
      boss: boss ? { index: boss.boss!.tier - 1, hp: Math.max(0, boss.hp / boss.maxHp) } : null,
      weapons: this.loadoutWeapons(),
      passives: this.loadoutPassives(),
      dash: clamp(1 - this.player.dashCd / 1.5, 0, 1),
      revives: this.revives,
    });
  }

  // ------------------------------------------------------------ effects

  private addShake(v: number) {
    this.shake = Math.min(30, this.shake + v * this.settings.screenShake);
  }

  private particle(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, drag: number, spark: boolean) {
    if (this.particles.length >= QUALITY[this.quality].particles) return;
    this.particles.push({ x, y, vx, vy, life, max: life, size, color, drag, spark });
  }

  private burst(x: number, y: number, n: number, color: string, speed: number, life: number, size: number, spark: boolean) {
    const budget = QUALITY[this.quality].particles;
    if (this.quality === "low") n = Math.ceil(n / 2);
    for (let i = 0; i < n && this.particles.length < budget; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.25 + Math.random() * 0.75);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.5 + Math.random() * 0.5), max: life,
        size: size * (0.6 + Math.random() * 0.8), color, drag: 3 + Math.random() * 2, spark,
      });
    }
  }

  private updateFx(dt: number) {
    let j = 0;
    for (const pt of this.particles) {
      pt.life -= dt;
      if (pt.life <= 0) continue;
      const k = Math.exp(-pt.drag * dt);
      pt.vx *= k;
      pt.vy *= k;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      this.particles[j++] = pt;
    }
    this.particles.length = j;

    j = 0;
    for (const t of this.texts) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-3 * dt);
      if (t.life > 0) this.texts[j++] = t;
    }
    this.texts.length = j;

    j = 0;
    for (const r of this.rings) {
      r.life -= dt;
      if (r.life > 0) this.rings[j++] = r;
    }
    this.rings.length = j;

    j = 0;
    for (const a of this.arcs) {
      a.life -= dt;
      if (a.life > 0) this.arcs[j++] = a;
    }
    this.arcs.length = j;

    j = 0;
    for (const w of this.waves) {
      w.t += dt;
      if (w.t < w.life) this.waves[j++] = w;
    }
    this.waves.length = j;
    if (this.waves.length > 14) this.waves.splice(0, this.waves.length - 14);
  }

  // ------------------------------------------------------------ rendering

  private render(dt: number, simulating: boolean) {
    const ctx = this.ctx;
    const { cssW: w, cssH: h, dpr } = this;
    const sc = this.scale * (this.mode === "demo" ? 0.92 : 1);

    if (simulating) {
      this.shake *= Math.exp(-9 * dt);
      this.flash = Math.max(0, this.flash - dt * 2.2);
    }
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    const camX = this.cam.x + sx;
    const camY = this.cam.y + sy;

    // Background (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (this.nebulaCanvas) ctx.drawImage(this.nebulaCanvas, 0, 0, w, h);
    else {
      ctx.fillStyle = PALETTE.void;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "lighter";
    this.stars.forEach((tile, i) => {
      const f = [0.05, 0.12, 0.22][i];
      const ox = (((-camX * f) % 512) + 512) % 512;
      const oy = (((-camY * f) % 512) + 512) % 512;
      for (let x = ox - 512; x < w; x += 512) for (let y = oy - 512; y < h; y += 512) ctx.drawImage(tile, x, y);
    });

    // World space
    const tx = w / 2 - camX * sc;
    const ty = h / 2 - camY * sc;
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * tx, dpr * ty);
    const halfW = w / (2 * sc), halfH = h / (2 * sc);
    const L = camX - halfW - 60, R = camX + halfW + 60, T = camY - halfH - 60, B = camY + halfH + 60;
    const vis = (x: number, y: number, r: number) => x + r > L && x - r < R && y + r > T && y - r < B;

    this.drawGrid(ctx, L, R, T, B);

    const p = this.player;
    // Soft light pool under the player.
    ctx.globalAlpha = 0.18;
    drawSprite(ctx, glowSprite(p.color, 140, 0.05), p.x, p.y);
    ctx.globalAlpha = 1;

    // Pickups
    for (const g of this.gems) {
      if (!vis(g.x, g.y, 20)) continue;
      if (g.kind === "xp") {
        const big = g.value >= 10, mid = g.value >= 3;
        const col = big ? "#B48CFF" : mid ? PALETTE.cyan : PALETTE.mint;
        const r = big ? 7 : mid ? 5.5 : 4.5;
        drawSpriteRot(ctx, shapeSprite("diamond", col, r, false, 0.6), g.x, g.y, g.t * 3);
      } else {
        const col = g.kind === "heal" ? PALETTE.mint : PALETTE.violet;
        const pulse = 1 + Math.sin(g.t * 6) * 0.12;
        drawSprite(ctx, glowSprite(col, 22), g.x, g.y, pulse);
        drawSpriteRot(ctx, shapeSprite(g.kind === "heal" ? "hex" : "star", col, 8, false, 0.5), g.x, g.y, g.t, pulse);
      }
    }

    // Enemy bullets
    const bs = glowSprite(PALETTE.bullet, 11, 0.4);
    for (const b of this.bullets) if (vis(b.x, b.y, 12)) drawSprite(ctx, bs, b.x, b.y);

    // Enemies
    ctx.globalCompositeOperation = "source-over";
    for (const e of this.enemies) {
      if (!vis(e.x, e.y, e.r * 3)) continue;
      if (e.boss) {
        this.drawBoss(ctx, e);
        continue;
      }
      const flashing = e.flash > 0;
      let scale = 1;
      if ((e.kind === "darter" && e.state === 1) || (e.kind === "bomber" && e.state === 1)) {
        scale = 1 + Math.sin(e.t * 40) * 0.15;
      }
      if (e.elite) {
        ctx.globalCompositeOperation = "lighter";
        drawSpriteRot(ctx, ringSprite(e.color, e.r + 8, 2), e.x, e.y, 0, 1 + Math.sin(e.t * 5) * 0.06);
        ctx.globalCompositeOperation = "source-over";
      }
      drawSpriteRot(ctx, shapeSprite(e.shape, e.color, Math.round(e.r), flashing), e.x, e.y, e.angle, scale);
    }

    ctx.globalCompositeOperation = "lighter";
    // Player projectiles
    for (const s of this.shots) {
      if (!vis(s.x, s.y, 20)) continue;
      if (s.kind === "bolt") {
        const a = Math.atan2(s.vy, s.vx);
        ctx.translate(s.x, s.y);
        ctx.rotate(a);
        const g = glowSprite(s.color, 10);
        ctx.drawImage(g.c, -18, -s.r * 1.2, 30, s.r * 2.4);
        ctx.rotate(-a);
        ctx.translate(-s.x, -s.y);
      } else {
        drawSpriteRot(ctx, shapeSprite("tri", s.color, 7, false, 0.5), s.x, s.y, Math.atan2(s.vy, s.vx));
      }
    }

    // Weapon visuals tied to the player
    if (p.alive) this.drawWeaponFx(ctx);

    // Arcs
    if (this.arcs.length) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const a of this.arcs) {
        const alpha = a.life / 0.2;
        for (const [lw, col] of [[7, "rgba(120,200,255,0.25)"], [2.2, "rgba(220,245,255,0.95)"]] as const) {
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = col;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(a.pts[0], a.pts[1]);
          for (let i = 2; i < a.pts.length; i += 2) {
            const x0 = a.pts[i - 2], y0 = a.pts[i - 1], x1 = a.pts[i], y1 = a.pts[i + 1];
            const segs = 5;
            for (let k = 1; k <= segs; k++) {
              const t = k / segs;
              const jx = k === segs ? 0 : (Math.random() - 0.5) * 22;
              const jy = k === segs ? 0 : (Math.random() - 0.5) * 22;
              ctx.lineTo(lerp(x0, x1, t) + jx, lerp(y0, y1, t) + jy);
            }
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // Rings
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      const rad = lerp(r.r, r.maxR, 1 - Math.pow(1 - t, 3));
      ctx.globalAlpha = (1 - t) * 0.9;
      const spr = ringSprite(r.color, 160, r.width * 1.5);
      drawSprite(ctx, spr, r.x, r.y, rad / 160);
    }
    ctx.globalAlpha = 1;

    // Player
    if (p.alive) {
      const blink = p.invuln > 0 && p.dashT <= 0 && Math.floor(p.invuln * 20) % 2 === 0;
      if (!blink) {
        drawSprite(ctx, glowSprite(p.color, 34, 0.15), p.x, p.y, 1 + Math.sin(this.time * 4) * 0.05);
        drawSpriteRot(ctx, ringSprite(p.color, 22, 1.5), p.x, p.y, 0);
        ctx.globalCompositeOperation = "source-over";
        drawSpriteRot(ctx, shapeSprite("player", p.color, 13, false, 0.35), p.x, p.y, p.angle);
        drawSpriteRot(ctx, shapeSprite("player", "#ffffff", 6, true), p.x, p.y, p.angle);
        ctx.globalCompositeOperation = "lighter";
      }
      if (this.mode !== "demo") {
        // Magnet radius hint, very faint.
        ctx.globalAlpha = 0.05;
        drawSprite(ctx, ringSprite(PALETTE.mint, 64, 1), p.x, p.y, this.stats.magnet / 64);
        ctx.globalAlpha = 1;
      }
    }

    // Particles
    for (const pt of this.particles) {
      if (!vis(pt.x, pt.y, 10)) continue;
      const t = pt.life / pt.max;
      ctx.globalAlpha = t;
      const g = glowSprite(pt.color, 8, 0.25);
      if (pt.spark) {
        const sp = Math.hypot(pt.vx, pt.vy);
        const len = Math.max(pt.size * 2, Math.min(28, sp * 0.06));
        const a = Math.atan2(pt.vy, pt.vx);
        ctx.translate(pt.x, pt.y);
        ctx.rotate(a);
        ctx.drawImage(g.c, -len / 2, -pt.size / 2, len, pt.size);
        ctx.rotate(-a);
        ctx.translate(-pt.x, -pt.y);
      } else {
        const s = pt.size * 2 * (0.5 + t * 0.5);
        ctx.drawImage(g.c, pt.x - s / 2, pt.y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // Screen space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.texts.length) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const t of this.texts) {
        const x = (t.x - camX) * sc + w / 2;
        const y = (t.y - camY) * sc + h / 2;
        ctx.globalAlpha = Math.min(1, t.life * 3);
        ctx.font = t.crit ? "700 17px 'Exo 2 Variable', sans-serif" : "600 12px 'Exo 2 Variable', sans-serif";
        ctx.fillStyle = t.crit ? PALETTE.amber : "rgba(242,240,255,0.9)";
        ctx.fillText(t.text, x, y);
      }
      ctx.globalAlpha = 1;
    }

    // Off-screen boss pointer
    const boss = this.enemies.find((e) => e.boss);
    if (boss) {
      const bx = (boss.x - camX) * sc + w / 2;
      const by = (boss.y - camY) * sc + h / 2;
      if (bx < 0 || bx > w || by < 0 || by > h) {
        const a = Math.atan2(by - h / 2, bx - w / 2);
        const m = 34;
        const ex = clamp(w / 2 + Math.cos(a) * w, m, w - m);
        const ey = clamp(h / 2 + Math.sin(a) * h, m + 40, h - m);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(a);
        ctx.fillStyle = boss.color;
        ctx.shadowColor = boss.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-8, 9);
        ctx.lineTo(-8, -9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // Virtual joystick
    const j = this.input.joy;
    if (j.active && this.mode !== "demo" && this.input.mode === "touch") {
      const r = this.input.joyRadius;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "rgba(242,240,255,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(j.ox, j.oy, r, 0, TAU);
      ctx.stroke();
      const dx = j.x - j.ox, dy = j.y - j.oy;
      const d = Math.min(r, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      ctx.fillStyle = "rgba(242,240,255,0.8)";
      ctx.beginPath();
      ctx.arc(j.ox + Math.cos(a) * d, j.oy + Math.sin(a) * d, 22, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(0.6, this.flash) * (this.settings.reducedFlash ? 0.4 : 1);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, L: number, R: number, T: number, B: number) {
    const x0 = Math.floor(L / GRID) * GRID;
    const y0 = Math.floor(T / GRID) * GRID;
    const cols = Math.ceil((R - x0) / GRID) + 1;
    const rows = Math.ceil((B - y0) / GRID) + 1;
    const p = this.player;
    const boss = this.enemies.find((e) => e.boss);
    const waves = this.waves;

    const disp = (x: number, y: number, out: number[]) => {
      let dx = 0, dy = 0;
      for (const wv of waves) {
        const ox = x - wv.x, oy = y - wv.y;
        const d = Math.hypot(ox, oy) || 1;
        const ring = wv.t * wv.speed;
        const delta = d - ring;
        const f = Math.exp(-(delta * delta) / 1800) * wv.strength * (1 - wv.t / wv.life);
        dx += (ox / d) * f;
        dy += (oy / d) * f;
      }
      // Gravity wells around the player and the boss.
      const wells = boss ? [[p.x, p.y, 10, 90], [boss.x, boss.y, 26, 200]] : [[p.x, p.y, 10, 90]];
      for (const [wx, wy, s, r] of wells) {
        const ox = x - wx, oy = y - wy;
        const d2 = ox * ox + oy * oy;
        const d = Math.sqrt(d2) || 1;
        const f = s * Math.exp(-d2 / (2 * r * r));
        dx -= (ox / d) * f;
        dy -= (oy / d) * f;
      }
      out[0] = x + dx;
      out[1] = y + dy;
    };

    if (this.gridPts.length < cols * rows * 2) this.gridPts = new Float32Array(cols * rows * 2);
    const pts = this.gridPts;
    const tmp = [0, 0];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        disp(x0 + c * GRID, y0 + r * GRID, tmp);
        const i = (r * cols + c) * 2;
        pts[i] = tmp[0];
        pts[i + 1] = tmp[1];
      }
    }

    ctx.globalCompositeOperation = "lighter";
    const pass = (major: boolean) => {
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        const gy = Math.round((y0 + r * GRID) / GRID);
        if ((gy % 4 === 0) !== major) continue;
        for (let c = 0; c < cols; c++) {
          const i = (r * cols + c) * 2;
          if (c === 0) ctx.moveTo(pts[i], pts[i + 1]);
          else ctx.lineTo(pts[i], pts[i + 1]);
        }
      }
      for (let c = 0; c < cols; c++) {
        const gx = Math.round((x0 + c * GRID) / GRID);
        if ((gx % 4 === 0) !== major) continue;
        for (let r = 0; r < rows; r++) {
          const i = (r * cols + c) * 2;
          if (r === 0) ctx.moveTo(pts[i], pts[i + 1]);
          else ctx.lineTo(pts[i], pts[i + 1]);
        }
      }
      ctx.strokeStyle = major ? "rgba(155,107,255,0.16)" : "rgba(155,107,255,0.07)";
      ctx.lineWidth = major ? 1.4 : 1;
      ctx.stroke();
    };
    pass(false);
    pass(true);
  }

  private drawWeaponFx(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    const s = this.stats;
    for (const w of this.weapons) {
      const L = w.level - 1;
      if (w.id === "orbit") {
        const n = W.orbit.count[L] + s.extra;
        const R = 78 * s.area;
        for (let i = 0; i < n; i++) {
          const a = w.angle + (i / n) * TAU;
          const x = p.x + Math.cos(a) * R, y = p.y + Math.sin(a) * R;
          // Trail
          for (let k = 1; k <= 3; k++) {
            const ta = a - k * 0.12;
            ctx.globalAlpha = 0.25 / k;
            drawSprite(ctx, glowSprite(PALETTE.violet, 10), p.x + Math.cos(ta) * R, p.y + Math.sin(ta) * R);
          }
          ctx.globalAlpha = 1;
          drawSpriteRot(ctx, shapeSprite("diamond", PALETTE.violet, Math.round(10 * Math.sqrt(s.area)), false, 0.5), x, y, a + Math.PI / 2);
        }
      } else if (w.id === "beam") {
        const n = Math.min(4, W.beam.count[L] + s.extra);
        const len = W.beam.len[L] * s.area;
        ctx.lineCap = "round";
        for (let i = 0; i < n; i++) {
          const a = w.angle + (i / n) * TAU;
          const ex = p.x + Math.cos(a) * len, ey = p.y + Math.sin(a) * len;
          const g = ctx.createLinearGradient(p.x, p.y, ex, ey);
          SPECTRUM.forEach((c, k) => g.addColorStop(k / (SPECTRUM.length - 1), c));
          ctx.strokeStyle = g;
          const flick = 0.85 + Math.random() * 0.15;
          for (const [lw, al] of [[16, 0.18], [7, 0.55], [2.5, 1]] as const) {
            ctx.globalAlpha = al * flick;
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(ex, ey);
            ctx.stroke();
          }
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(lerp(p.x, ex, 0.8), lerp(p.y, ey, 0.8));
          ctx.stroke();
          drawSprite(ctx, glowSprite("#ffffff", 14), ex, ey, flick);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawBoss(ctx: CanvasRenderingContext2D, e: Enemy) {
    const b = e.boss!;
    const flashing = e.flash > 0;
    const windup = b.pattern === 2 && e.state === 0;
    const s = windup ? 1 + Math.sin(e.t * 50) * 0.04 : 1;
    ctx.globalCompositeOperation = "lighter";
    drawSprite(ctx, glowSprite(e.color, e.r * 2.2, 0.1), e.x, e.y, 0.9 + Math.sin(e.t * 3) * 0.08);
    drawSpriteRot(ctx, ringSprite(e.color, e.r + 18, 2), e.x, e.y, 0, 1 + Math.sin(e.t * 2) * 0.05);
    ctx.globalCompositeOperation = "source-over";
    drawSpriteRot(ctx, shapeSprite("boss", e.color, e.r, flashing, 0.22), e.x, e.y, e.angle, s);
    drawSpriteRot(ctx, shapeSprite("hex", PALETTE.white, Math.round(e.r * 0.42), flashing, 0.3), e.x, e.y, -e.angle * 1.7, s);
    if (b.tier >= 2) drawSpriteRot(ctx, shapeSprite("tri", e.color, Math.round(e.r * 0.25), flashing, 0.6), e.x, e.y, e.angle * 3);
  }
}

const DEMO_CORE: CoreDef = {
  id: "demo", name: "Demo", description: "", weapon: "pulse", cost: 0, hue: 190,
  hpBonus: 0, speedMult: 1, damageMult: 1, cooldownMult: 1, areaMult: 1,
};

export type { Sfx };
