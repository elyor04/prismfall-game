package game

// The catalog is the single source of truth for everything meta-progression:
// forge upgrades, playable cores, achievements and daily modifiers. The
// frontend reads it through GameService.GetCatalog so prices and stats are
// never duplicated in TypeScript.

// ForgeUpgrade is a permanent upgrade bought with shards between runs.
type ForgeUpgrade struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	MaxLevel    int     `json:"maxLevel"`
	BaseCost    int     `json:"baseCost"`
	CostStep    int     `json:"costStep"`
	PerLevel    float64 `json:"perLevel"`
	Unit        string  `json:"unit"`
}

// Cost returns the shard price of buying the next level when the upgrade is
// currently at `level`.
func (u ForgeUpgrade) Cost(level int) int {
	return u.BaseCost + u.CostStep*level
}

// CoreDef is a playable ship ("core") with its own starting weapon and stats.
type CoreDef struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	Weapon       string  `json:"weapon"`
	Cost         int     `json:"cost"`
	Hue          int     `json:"hue"`
	HpBonus      int     `json:"hpBonus"`
	SpeedMult    float64 `json:"speedMult"`
	DamageMult   float64 `json:"damageMult"`
	CooldownMult float64 `json:"cooldownMult"`
	AreaMult     float64 `json:"areaMult"`
}

// Achievement is a one-time goal that pays a shard reward when completed.
type Achievement struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Reward      int    `json:"reward"`
}

// Modifier changes the rules of a daily challenge run.
type Modifier struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Catalog bundles all static meta data for the frontend.
type Catalog struct {
	Forge        []ForgeUpgrade `json:"forge"`
	Cores        []CoreDef      `json:"cores"`
	Achievements []Achievement  `json:"achievements"`
	Modifiers    []Modifier     `json:"modifiers"`
}

var forgeUpgrades = []ForgeUpgrade{
	{ID: "vitality", Name: "Vitality", Description: "Start every run with more hull.", MaxLevel: 5, BaseCost: 40, CostStep: 35, PerLevel: 10, Unit: "max HP"},
	{ID: "power", Name: "Focus", Description: "All weapons hit harder.", MaxLevel: 5, BaseCost: 60, CostStep: 45, PerLevel: 5, Unit: "% damage"},
	{ID: "haste", Name: "Thrust", Description: "Move faster across the void.", MaxLevel: 5, BaseCost: 45, CostStep: 35, PerLevel: 4, Unit: "% speed"},
	{ID: "reach", Name: "Pull", Description: "Collect shards from further away.", MaxLevel: 5, BaseCost: 30, CostStep: 25, PerLevel: 15, Unit: "% pickup radius"},
	{ID: "wisdom", Name: "Insight", Description: "Level up sooner.", MaxLevel: 5, BaseCost: 55, CostStep: 40, PerLevel: 8, Unit: "% XP"},
	{ID: "greed", Name: "Greed", Description: "Earn more shards per run.", MaxLevel: 5, BaseCost: 80, CostStep: 60, PerLevel: 10, Unit: "% shards"},
	{ID: "reroll", Name: "Second thought", Description: "Reroll level-up choices.", MaxLevel: 3, BaseCost: 90, CostStep: 90, PerLevel: 1, Unit: "reroll per run"},
	{ID: "revive", Name: "Afterglow", Description: "Come back once at half hull.", MaxLevel: 1, BaseCost: 400, CostStep: 0, PerLevel: 1, Unit: "revive per run"},
}

var cores = []CoreDef{
	{ID: "prism", Name: "Prism", Description: "Balanced core. Fires seeking pulse bolts.", Weapon: "pulse", Cost: 0, Hue: 190, SpeedMult: 1, DamageMult: 1, CooldownMult: 1, AreaMult: 1},
	{ID: "halo", Name: "Halo", Description: "Sturdy and slow. Shards orbit the hull.", Weapon: "orbit", Cost: 250, Hue: 265, HpBonus: 25, SpeedMult: 0.95, DamageMult: 1, CooldownMult: 1, AreaMult: 1.1},
	{ID: "tesla", Name: "Tesla", Description: "Arc lightning that jumps between foes.", Weapon: "arc", Cost: 400, Hue: 210, SpeedMult: 1.05, DamageMult: 1, CooldownMult: 0.9, AreaMult: 1},
	{ID: "nova", Name: "Nova", Description: "Unleashes shockwaves that shove the swarm.", Weapon: "nova", Cost: 600, Hue: 40, HpBonus: 10, SpeedMult: 1, DamageMult: 1, CooldownMult: 1, AreaMult: 1.15},
	{ID: "spectre", Name: "Spectre", Description: "Fragile glass core with a spectral beam.", Weapon: "beam", Cost: 900, Hue: 320, HpBonus: -30, SpeedMult: 1.1, DamageMult: 1.15, CooldownMult: 1, AreaMult: 1},
}

var achievements = []Achievement{
	{ID: "first_light", Name: "First light", Description: "Finish your first run.", Reward: 25},
	{ID: "survivor_5", Name: "Holding on", Description: "Survive for 5 minutes.", Reward: 60},
	{ID: "warden", Name: "Wardenfall", Description: "Defeat your first boss.", Reward: 80},
	{ID: "victory", Name: "Prismfall", Description: "Defeat the Eclipse and win a run.", Reward: 250},
	{ID: "kills_1000", Name: "Thousand sparks", Description: "Destroy 1,000 enemies in one run.", Reward: 120},
	{ID: "level_25", Name: "Overcharged", Description: "Reach level 25 in one run.", Reward: 100},
	{ID: "combo_50", Name: "Chain reaction", Description: "Hit a 50-kill combo.", Reward: 70},
	{ID: "untouched", Name: "Ghost", Description: "Survive 3 minutes without taking damage.", Reward: 90},
	{ID: "daily", Name: "Daily ritual", Description: "Complete a daily challenge.", Reward: 50},
	{ID: "collector", Name: "Full spectrum", Description: "Unlock every core.", Reward: 300},
}

var modifiers = []Modifier{
	{ID: "glass", Name: "Glass cannon", Description: "Deal 50% more damage, but your hull is halved."},
	{ID: "swarm", Name: "Swarm", Description: "Enemies arrive 40% faster."},
	{ID: "haste", Name: "Overdrive", Description: "Everything moves 20% faster."},
	{ID: "rich", Name: "Rich veins", Description: "30% more XP, but enemies are 30% tougher."},
	{ID: "volatile", Name: "Volatile", Description: "Enemies burst into bullets when destroyed."},
	{ID: "elite", Name: "Big game", Description: "Elites appear three times as often."},
	{ID: "noregen", Name: "Cold hull", Description: "No hull regeneration of any kind."},
	{ID: "giant", Name: "Giants", Description: "Enemies are larger and slower, with double health."},
}

func findForge(id string) (ForgeUpgrade, bool) {
	for _, u := range forgeUpgrades {
		if u.ID == id {
			return u, true
		}
	}
	return ForgeUpgrade{}, false
}

func findCore(id string) (CoreDef, bool) {
	for _, c := range cores {
		if c.ID == id {
			return c, true
		}
	}
	return CoreDef{}, false
}

func findAchievement(id string) (Achievement, bool) {
	for _, a := range achievements {
		if a.ID == id {
			return a, true
		}
	}
	return Achievement{}, false
}
