// Static gameplay content: weapons, passives and enemies. Meta progression
// (forge, cores, achievements) lives in Go and arrives via GetCatalog.

export const PALETTE = {
  void: "#07061A",
  nebula: "#1B1446",
  white: "#F2F0FF",
  red: "#FF4D6D",
  amber: "#FFB547",
  mint: "#6BFFB8",
  cyan: "#4DC9FF",
  violet: "#9B6BFF",
  magenta: "#FF3DCB",
  orange: "#FF7A3D",
  yellow: "#FFE14D",
  crimson: "#E0245E",
  bullet: "#FF5E8A",
} as const;

export type WeaponId = "pulse" | "orbit" | "arc" | "nova" | "seeker" | "beam";
export type PassiveId = "amp" | "overclock" | "lens" | "thrusters" | "magnet" | "hull" | "fracture" | "echo";

// Display text for weapons, passives and bosses lives in src/i18n.
export interface WeaponDef {
  id: WeaponId;
  color: string;
  icon: string; // SVG path data in a 24x24 box
}

export const MAX_WEAPON_LEVEL = 5;
export const MAX_WEAPONS = 4;
export const MAX_PASSIVES = 4;

// Per-level stat tables (index 0 = level 1).
export const W = {
  pulse: { dmg: [12, 15, 18, 22, 27], cd: [0.6, 0.55, 0.5, 0.45, 0.4], count: [1, 1, 2, 2, 3], pierce: [0, 1, 1, 2, 2] },
  orbit: { dmg: [10, 13, 16, 20, 25], count: [2, 3, 3, 4, 5], spin: [2.6, 2.8, 3.0, 3.3, 3.6] },
  arc: { dmg: [16, 20, 24, 29, 35], cd: [1.4, 1.25, 1.1, 1.0, 0.9], jumps: [3, 4, 5, 6, 7] },
  nova: { dmg: [24, 30, 36, 44, 55], cd: [3.0, 2.8, 2.5, 2.3, 2.0], radius: [150, 170, 190, 215, 240] },
  seeker: { dmg: [18, 21, 25, 29, 34], cd: [1.6, 1.45, 1.3, 1.15, 1.0], count: [2, 2, 3, 4, 5] },
  beam: { dps: [32, 40, 48, 58, 72], count: [1, 1, 2, 2, 3], len: [240, 270, 300, 330, 360] },
} as const;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pulse: {
    id: "pulse", color: PALETTE.cyan,
    icon: "M4 12h10M14 7l6 5-6 5",
  },
  orbit: {
    id: "orbit", color: PALETTE.violet,
    icon: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18M12 3l2 3h-4zM12 21l-2-3h4z",
  },
  arc: {
    id: "arc", color: "#9FE8FF",
    icon: "M13 2L5 14h6l-1 8 8-12h-6z",
  },
  nova: {
    id: "nova", color: PALETTE.amber,
    icon: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  },
  seeker: {
    id: "seeker", color: PALETTE.magenta,
    icon: "M5 19l5-5M14 4l6 6-7 7-6-6zM4 20l2-4 2 2z",
  },
  beam: {
    id: "beam", color: "#FFFFFF",
    icon: "M12 12L21 5M12 12L3 19M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  },
};

export interface PassiveDef {
  id: PassiveId;
  max: number;
  color: string;
  icon: string;
}

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  amp: { id: "amp", max: 5, color: PALETTE.red, icon: "M12 3v18M5 10l7-7 7 7" },
  overclock: { id: "overclock", max: 5, color: PALETTE.amber, icon: "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 7v5l3 3" },
  lens: { id: "lens", max: 5, color: PALETTE.cyan, icon: "M3 12h18M12 3v18M6 6l12 12M18 6L6 18" },
  thrusters: { id: "thrusters", max: 5, color: PALETTE.mint, icon: "M5 12h14M13 6l6 6-6 6M5 7l4 5-4 5" },
  magnet: { id: "magnet", max: 5, color: PALETTE.violet, icon: "M6 4v8a6 6 0 0 0 12 0V4M6 8h4M14 8h4" },
  hull: { id: "hull", max: 5, color: PALETTE.white, icon: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" },
  fracture: { id: "fracture", max: 5, color: PALETTE.yellow, icon: "M12 2l3 7h7l-6 4 2 8-6-5-6 5 2-8-6-4h7z" },
  echo: { id: "echo", max: 2, color: PALETTE.magenta, icon: "M4 8h8M4 16h8M14 5l6 7-6 7" },
};

export type EnemyKind = "drifter" | "darter" | "splitter" | "mini" | "shooter" | "tank" | "bomber" | "boss";
export type Shape = "tri" | "diamond" | "square" | "pent" | "hex" | "star" | "circle" | "ring" | "boss";

export interface EnemyDef {
  kind: EnemyKind;
  hp: number;
  speed: number;
  r: number;
  dmg: number;
  xp: number;
  score: number;
  color: string;
  shape: Shape;
  knockResist: number; // 0 = full knockback, 1 = immovable
  unlockAt: number; // seconds into the run
  weight: (t: number) => number;
}

export const ENEMIES: Record<Exclude<EnemyKind, "boss">, EnemyDef> = {
  drifter: { kind: "drifter", hp: 14, speed: 72, r: 12, dmg: 8, xp: 1, score: 10, color: PALETTE.red, shape: "tri", knockResist: 0, unlockAt: 0, weight: (t) => Math.max(4, 10 - t / 60) },
  darter: { kind: "darter", hp: 11, speed: 55, r: 11, dmg: 9, xp: 2, score: 15, color: PALETTE.amber, shape: "diamond", knockResist: 0, unlockAt: 40, weight: () => 3 },
  splitter: { kind: "splitter", hp: 42, speed: 50, r: 17, dmg: 10, xp: 3, score: 20, color: PALETTE.magenta, shape: "square", knockResist: 0.3, unlockAt: 80, weight: () => 2.5 },
  mini: { kind: "mini", hp: 9, speed: 105, r: 8, dmg: 5, xp: 1, score: 5, color: PALETTE.magenta, shape: "square", knockResist: 0, unlockAt: 1e9, weight: () => 0 },
  shooter: { kind: "shooter", hp: 30, speed: 80, r: 14, dmg: 8, xp: 3, score: 25, color: PALETTE.orange, shape: "pent", knockResist: 0.2, unlockAt: 120, weight: () => 2 },
  bomber: { kind: "bomber", hp: 20, speed: 98, r: 13, dmg: 10, xp: 2, score: 15, color: PALETTE.yellow, shape: "star", knockResist: 0, unlockAt: 150, weight: () => 2.2 },
  tank: { kind: "tank", hp: 170, speed: 38, r: 26, dmg: 18, xp: 8, score: 60, color: PALETTE.crimson, shape: "hex", knockResist: 0.8, unlockAt: 200, weight: (t) => 1 + t / 300 },
};

export const BOSSES = [
  { hp: 3200, r: 54, color: PALETTE.red, at: 180 },
  { hp: 9000, r: 62, color: PALETTE.magenta, at: 360 },
  { hp: 22000, r: 72, color: PALETTE.orange, at: 600 },
] as const;

export const RUN_LENGTH = BOSSES[2].at;

export function xpToNext(level: number) {
  return Math.floor(4 + level * 3 + Math.pow(level, 1.7));
}

/** Hue for a core, used for the player's ship colour. */
export function coreColor(hue: number) {
  return `hsl(${hue} 100% 66%)`;
}
