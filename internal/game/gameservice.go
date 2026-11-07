package game

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// GameError is returned to the frontend. Wails serialises the error value
// into the call's `cause`, so the UI reads Code and shows its own translated
// message; Message is the English fallback for logs and tools.
type GameError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *GameError) Error() string { return e.Message }

var (
	ErrUnknownUpgrade = &GameError{"unknown_upgrade", "that upgrade does not exist"}
	ErrMaxLevel       = &GameError{"max_level", "this upgrade is already at its highest level"}
	ErrNotEnough      = &GameError{"not_enough_shards", "not enough shards yet — finish more runs to earn them"}
	ErrUnknownCore    = &GameError{"unknown_core", "that core does not exist"}
	ErrCoreLocked     = &GameError{"core_locked", "unlock this core in the forge before selecting it"}
	ErrAlreadyOwned   = &GameError{"already_owned", "you already own this core"}
	ErrUnknownRun     = &GameError{"unknown_run", "this run was already recorded or was never started"}
)

// RunResult is what the frontend reports when a run ends.
type RunResult struct {
	Score          int     `json:"score"`
	Kills          int     `json:"kills"`
	Level          int     `json:"level"`
	BossesDefeated int     `json:"bossesDefeated"`
	TimeSec        float64 `json:"timeSec"`
	Core           string  `json:"core"`
	Victory        bool    `json:"victory"`
	Daily          bool    `json:"daily"`
	DailyKey       string  `json:"dailyKey"`
	MaxCombo       int     `json:"maxCombo"`
	NoHitSec       float64 `json:"noHitSec"`
	// Token is the one-time value BeginRun issued for this run.
	Token string `json:"token"`
}

// RunReward is returned after a run has been recorded.
type RunReward struct {
	ShardsEarned     int           `json:"shardsEarned"`
	AchievementBonus int           `json:"achievementBonus"`
	Rank             int           `json:"rank"` // 1-based leaderboard rank, 0 if not placed
	NewBest          bool          `json:"newBest"`
	DailyBest        bool          `json:"dailyBest"`
	NewAchievements  []Achievement `json:"newAchievements"`
	Profile          Profile       `json:"profile"`
}

// DailyChallenge is the same for every player on a given UTC day.
type DailyChallenge struct {
	Key       string     `json:"key"`
	Seed      int        `json:"seed"`
	Core      string     `json:"core"`
	Modifiers []Modifier `json:"modifiers"`
	Best      int        `json:"best"`
}

// GameService is bound to the frontend. Every exported method becomes a
// typed TypeScript function in frontend/bindings.
type GameService struct {
	store *Store
	now   func() time.Time

	runsMu sync.Mutex
	runs   map[string]time.Time // open run tokens -> start time
}

// maxOpenRuns bounds the open-token table; the oldest token is dropped first.
const maxOpenRuns = 8

// bossTimes are the run times (seconds) at which bosses appear; they mirror
// BOSSES in frontend/src/game/content.ts.
var bossTimes = []float64{180, 360, 600}

// NewGameService wires a service to the platform's save directory.
func NewGameService() *GameService {
	return &GameService{store: NewStore(saveDir), now: time.Now}
}

// saveDir prefers the native app storage path on mobile and falls back to the
// per-user config directory on desktop.
func saveDir() (string, error) {
	if p := application.Mobile.StoragePath(); p != "" {
		return p, nil
	}
	if runtime.GOOS == "android" || runtime.GOOS == "ios" {
		// The native bridge is not up yet. Fail (the store retries on the next
		// call) rather than saving to a directory the app will not use later.
		return "", errors.New("app storage is not ready yet")
	}
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "Prismfall"), nil
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".prismfall"), nil
	}
	return "", errors.New("no writable directory available for save data")
}

// GetProfile returns the saved profile.
func (g *GameService) GetProfile() (Profile, error) {
	return g.store.View()
}

// GetCatalog returns forge upgrades, cores, achievements and modifiers.
func (g *GameService) GetCatalog() Catalog {
	return Catalog{Forge: forgeUpgrades, Cores: cores, Achievements: achievements, Modifiers: modifiers}
}

// SaveSettings persists player preferences.
func (g *GameService) SaveSettings(s Settings) (Profile, error) {
	return g.store.Update(func(p *Profile) error {
		p.Settings = sanitizeSettings(s)
		return nil
	})
}

// BuyUpgrade spends shards on the next level of a forge upgrade.
func (g *GameService) BuyUpgrade(id string) (Profile, error) {
	return g.store.Update(func(p *Profile) error {
		u, ok := findForge(id)
		if !ok {
			return ErrUnknownUpgrade
		}
		lvl := p.Forge[id]
		if lvl >= u.MaxLevel {
			return ErrMaxLevel
		}
		cost := u.Cost(lvl)
		if p.Shards < cost {
			return ErrNotEnough
		}
		p.Shards -= cost
		p.Forge[id] = lvl + 1
		return nil
	})
}

// UnlockCore spends shards to make a core playable and selects it.
func (g *GameService) UnlockCore(id string) (Profile, error) {
	return g.store.Update(func(p *Profile) error {
		c, ok := findCore(id)
		if !ok {
			return ErrUnknownCore
		}
		if contains(p.UnlockedCores, id) {
			return ErrAlreadyOwned
		}
		if p.Shards < c.Cost {
			return ErrNotEnough
		}
		p.Shards -= c.Cost
		p.UnlockedCores = append(p.UnlockedCores, id)
		p.SelectedCore = id
		if len(p.UnlockedCores) == len(cores) {
			grantAchievement(p, "collector")
		}
		return nil
	})
}

// SelectCore chooses which unlocked core starts the next run.
func (g *GameService) SelectCore(id string) (Profile, error) {
	return g.store.Update(func(p *Profile) error {
		if _, ok := findCore(id); !ok {
			return ErrUnknownCore
		}
		if !contains(p.UnlockedCores, id) {
			return ErrCoreLocked
		}
		p.SelectedCore = id
		return nil
	})
}

// GetDaily returns today's challenge and the player's best score for it.
func (g *GameService) GetDaily() (DailyChallenge, error) {
	d := dailyFor(g.now())
	p, err := g.store.View()
	if err != nil {
		return d, err
	}
	d.Best = p.DailyBest[d.Key]
	return d, nil
}

// BeginRun opens a run and returns the one-time token SubmitRun requires.
// The token makes submissions idempotent and lets Go bound the reported run
// time by the real time that has passed.
func (g *GameService) BeginRun() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("create run token: %w", err)
	}
	token := hex.EncodeToString(b[:])
	g.runsMu.Lock()
	defer g.runsMu.Unlock()
	if g.runs == nil {
		g.runs = map[string]time.Time{}
	}
	for len(g.runs) >= maxOpenRuns {
		oldest, at := "", time.Time{}
		for k, t := range g.runs {
			if oldest == "" || t.Before(at) {
				oldest, at = k, t
			}
		}
		delete(g.runs, oldest)
	}
	g.runs[token] = g.now()
	return token, nil
}

// SubmitRun records a finished run, pays out shards and checks achievements.
// Each token is accepted once; if saving fails the token stays open so the
// same run can be retried.
func (g *GameService) SubmitRun(r RunResult) (RunReward, error) {
	g.runsMu.Lock()
	defer g.runsMu.Unlock()
	started, ok := g.runs[r.Token]
	if !ok || r.Token == "" {
		return RunReward{}, ErrUnknownRun
	}
	now := g.now()
	r = sanitizeRun(r, now.Sub(started).Seconds())
	r = checkDaily(r, now)
	var reward RunReward
	profile, err := g.store.Update(func(p *Profile) error {
		if !contains(p.UnlockedCores, r.Core) && !r.Daily {
			r.Core = p.SelectedCore
		}
		reward = applyRun(p, r, now)
		return nil
	})
	if err != nil {
		return RunReward{}, err
	}
	delete(g.runs, r.Token)
	reward.Profile = profile
	return reward, nil
}

// checkDaily keeps the daily flag only for today's or yesterday's challenge
// (a run may cross UTC midnight) played with that day's core.
func checkDaily(r RunResult, now time.Time) RunResult {
	if !r.Daily {
		r.DailyKey = ""
		return r
	}
	for _, d := range []DailyChallenge{dailyFor(now), dailyFor(now.Add(-24 * time.Hour))} {
		if r.DailyKey == d.Key && r.Core == d.Core {
			return r
		}
	}
	r.Daily, r.DailyKey = false, ""
	return r
}

// ResetProfile wipes all progress but keeps settings.
func (g *GameService) ResetProfile() (Profile, error) {
	return g.store.Update(func(p *Profile) error {
		settings := p.Settings
		*p = newProfile()
		p.Settings = settings
		return nil
	})
}

// Haptic triggers native haptics on mobile; a no-op on desktop.
// kind is one of light, medium, heavy, success, warning, error, selection.
func (g *GameService) Haptic(kind string) {
	switch kind {
	case "light", "medium", "heavy":
		application.Mobile.Haptic("impact-" + kind)
	case "success", "warning", "error", "selection":
		application.Mobile.Haptic(kind)
	}
}

// SetKeepAwake keeps the screen on during a run on mobile.
func (g *GameService) SetKeepAwake(enabled bool) {
	application.Mobile.SetKeepAwake(enabled)
}

// Plausibility limits for client-reported runs. They are generous: a real
// run stays far below them, while a forged report gains little.
const (
	maxKillsPerSec = 40
	maxRunSec      = 4 * 3600
)

// sanitizeRun clamps client-reported numbers to plausible ranges so a broken
// or tampered report cannot flood the economy. elapsed is the real time in
// seconds since BeginRun; game time can never run ahead of it.
func sanitizeRun(r RunResult, elapsed float64) RunResult {
	r.TimeSec = clampFloat(r.TimeSec, 0, math.Min(maxRunSec, elapsed+5))
	r.Kills = clampInt(r.Kills, 0, int(r.TimeSec*maxKillsPerSec)+50)
	r.Level = clampInt(r.Level, 1, 5+int(r.TimeSec/4))
	bossCap := 0
	for _, at := range bossTimes {
		if r.TimeSec >= at {
			bossCap++
		}
	}
	r.BossesDefeated = clampInt(r.BossesDefeated, 0, bossCap)
	r.Score = clampInt(r.Score, 0, 1<<30)
	r.MaxCombo = clampInt(r.MaxCombo, 0, r.Kills)
	r.NoHitSec = clampFloat(r.NoHitSec, 0, r.TimeSec)
	if _, ok := findCore(r.Core); !ok {
		r.Core = "prism"
	}
	if r.Victory && r.BossesDefeated < 3 {
		r.Victory = false
	}
	return r
}

// shardsFor is the run payout formula, before achievement bonuses.
func shardsFor(r RunResult, greedLevel int) int {
	base := float64(r.Kills)/12 + r.TimeSec/8 + float64(r.Level)*2 + float64(r.BossesDefeated)*30
	if r.Victory {
		base += 120
	}
	if r.Daily {
		base *= 1.5
	}
	base *= 1 + 0.10*float64(greedLevel)
	return int(math.Round(base))
}

func applyRun(p *Profile, r RunResult, now time.Time) RunReward {
	reward := RunReward{NewAchievements: []Achievement{}}

	shards := shardsFor(r, p.Forge["greed"])
	reward.ShardsEarned = shards
	p.Shards += shards

	st := &p.Stats
	st.Runs++
	st.TotalKills += r.Kills
	st.TotalTimeSec += r.TimeSec
	st.BossesDefeated += r.BossesDefeated
	st.ShardsEarned += shards
	if r.Victory {
		st.Victories++
	}
	if r.TimeSec > st.BestTimeSec {
		st.BestTimeSec = r.TimeSec
	}
	if r.Level > st.HighestLevel {
		st.HighestLevel = r.Level
	}

	prevBest := 0
	if len(p.Records) > 0 {
		prevBest = p.Records[0].Score
	}
	rec := RunRecord{
		Score: r.Score, TimeSec: r.TimeSec, Kills: r.Kills, Level: r.Level,
		Core: r.Core, Victory: r.Victory, Daily: r.Daily, Date: now.UTC().Format(time.RFC3339),
	}
	p.Records = append(p.Records, rec)
	sort.SliceStable(p.Records, func(i, j int) bool { return p.Records[i].Score > p.Records[j].Score })
	if len(p.Records) > maxRecords {
		p.Records = p.Records[:maxRecords]
	}
	for i, x := range p.Records {
		if x == rec {
			reward.Rank = i + 1
			break
		}
	}
	reward.NewBest = r.Score > prevBest && r.Score > 0

	if r.Daily && r.DailyKey != "" {
		if r.Score > p.DailyBest[r.DailyKey] {
			p.DailyBest[r.DailyKey] = r.Score
			reward.DailyBest = true
		}
		pruneDaily(p.DailyBest, 30)
	}

	checks := map[string]bool{
		"first_light": true,
		"survivor_5":  r.TimeSec >= 300,
		"warden":      r.BossesDefeated >= 1,
		"victory":     r.Victory,
		"kills_1000":  r.Kills >= 1000,
		"level_25":    r.Level >= 25,
		"combo_50":    r.MaxCombo >= 50,
		"untouched":   r.NoHitSec >= 180,
		"daily":       r.Daily,
	}
	// Iterate in catalog order so rewards are reported deterministically.
	for _, a := range achievements {
		if checks[a.ID] && grantAchievement(p, a.ID) {
			reward.NewAchievements = append(reward.NewAchievements, a)
			reward.AchievementBonus += a.Reward
		}
	}
	return reward
}

// grantAchievement unlocks an achievement and pays its reward. It reports
// whether the achievement was newly granted.
func grantAchievement(p *Profile, id string) bool {
	if contains(p.Achievements, id) {
		return false
	}
	a, ok := findAchievement(id)
	if !ok {
		return false
	}
	p.Achievements = append(p.Achievements, id)
	p.Shards += a.Reward
	return true
}

// pruneDaily keeps only the most recent `keep` daily scores (keys sort
// chronologically because they are YYYY-MM-DD).
func pruneDaily(m map[string]int, keep int) {
	if len(m) <= keep {
		return
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys[:len(keys)-keep] {
		delete(m, k)
	}
}

// dailyFor derives the challenge for the UTC day containing t.
func dailyFor(t time.Time) DailyChallenge {
	key := t.UTC().Format("2006-01-02")
	h := fnv.New32a()
	_, _ = fmt.Fprintf(h, "prismfall:%s", key)
	seed := h.Sum32()

	rng := seed
	next := func() uint32 { // xorshift32
		rng ^= rng << 13
		rng ^= rng >> 17
		rng ^= rng << 5
		return rng
	}
	core := cores[int(next()%uint32(len(cores)))].ID

	first := int(next() % uint32(len(modifiers)))
	second := int(next() % uint32(len(modifiers)-1))
	if second >= first {
		second++
	}
	return DailyChallenge{
		Key:       key,
		Seed:      int(seed & 0x7fffffff),
		Core:      core,
		Modifiers: []Modifier{modifiers[first], modifiers[second]},
	}
}
