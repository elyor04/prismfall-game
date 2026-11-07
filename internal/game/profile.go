package game

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const profileVersion = 1
const maxRecords = 10

// Settings are player preferences persisted with the profile.
type Settings struct {
	MasterVolume  float64 `json:"masterVolume"`
	MusicVolume   float64 `json:"musicVolume"`
	SfxVolume     float64 `json:"sfxVolume"`
	ScreenShake   float64 `json:"screenShake"`
	Haptics       bool    `json:"haptics"`
	DamageNumbers bool    `json:"damageNumbers"`
	ReducedFlash  bool    `json:"reducedFlash"`
	Quality       string  `json:"quality"`  // "auto", "high", "balanced" or "low"
	Language      string  `json:"language"` // "", "en", "ru" or "uz"; "" follows the device
}

// RunRecord is one entry in the local leaderboard.
type RunRecord struct {
	Score   int     `json:"score"`
	TimeSec float64 `json:"timeSec"`
	Kills   int     `json:"kills"`
	Level   int     `json:"level"`
	Core    string  `json:"core"`
	Victory bool    `json:"victory"`
	Daily   bool    `json:"daily"`
	Date    string  `json:"date"`
}

// Stats are lifetime totals.
type Stats struct {
	Runs           int     `json:"runs"`
	Victories      int     `json:"victories"`
	TotalKills     int     `json:"totalKills"`
	TotalTimeSec   float64 `json:"totalTimeSec"`
	BossesDefeated int     `json:"bossesDefeated"`
	BestTimeSec    float64 `json:"bestTimeSec"`
	HighestLevel   int     `json:"highestLevel"`
	ShardsEarned   int     `json:"shardsEarned"`
}

// Profile is everything persisted between sessions.
type Profile struct {
	Version       int            `json:"version"`
	Shards        int            `json:"shards"`
	Forge         map[string]int `json:"forge"`
	UnlockedCores []string       `json:"unlockedCores"`
	SelectedCore  string         `json:"selectedCore"`
	Achievements  []string       `json:"achievements"`
	Records       []RunRecord    `json:"records"`
	DailyBest     map[string]int `json:"dailyBest"`
	Stats         Stats          `json:"stats"`
	Settings      Settings       `json:"settings"`
}

func defaultSettings() Settings {
	return Settings{
		MasterVolume:  0.8,
		MusicVolume:   0.6,
		SfxVolume:     0.8,
		ScreenShake:   1,
		Haptics:       true,
		DamageNumbers: true,
		Quality:       "auto",
	}
}

func newProfile() Profile {
	return Profile{
		Version:       profileVersion,
		Forge:         map[string]int{},
		UnlockedCores: []string{"prism"},
		SelectedCore:  "prism",
		Achievements:  []string{},
		Records:       []RunRecord{},
		DailyBest:     map[string]int{},
		Settings:      defaultSettings(),
	}
}

// normalize repairs a profile loaded from disk so the rest of the code can
// rely on its invariants (non-nil maps, valid selected core, clamped values).
func (p *Profile) normalize() {
	if p.Forge == nil {
		p.Forge = map[string]int{}
	}
	if p.DailyBest == nil {
		p.DailyBest = map[string]int{}
	}
	if p.Achievements == nil {
		p.Achievements = []string{}
	}
	if p.Records == nil {
		p.Records = []RunRecord{}
	}
	// Keep only known cores, each once, with the free core always owned.
	owned := []string{"prism"}
	for _, id := range p.UnlockedCores {
		if _, ok := findCore(id); ok && !contains(owned, id) {
			owned = append(owned, id)
		}
	}
	p.UnlockedCores = owned
	if !contains(p.UnlockedCores, p.SelectedCore) {
		p.SelectedCore = "prism"
	}
	for id, lvl := range p.Forge {
		u, ok := findForge(id)
		if !ok {
			delete(p.Forge, id)
			continue
		}
		p.Forge[id] = clampInt(lvl, 0, u.MaxLevel)
	}
	if p.Shards < 0 {
		p.Shards = 0
	}
	if p.Version == 0 {
		// Profiles written before settings existed get sane defaults.
		p.Settings = defaultSettings()
	}
	p.Settings = sanitizeSettings(p.Settings)
	sort.SliceStable(p.Records, func(i, j int) bool { return p.Records[i].Score > p.Records[j].Score })
	if len(p.Records) > maxRecords {
		p.Records = p.Records[:maxRecords]
	}
	p.Version = profileVersion
}

func sanitizeSettings(s Settings) Settings {
	s.MasterVolume = clampFloat(s.MasterVolume, 0, 1)
	s.MusicVolume = clampFloat(s.MusicVolume, 0, 1)
	s.SfxVolume = clampFloat(s.SfxVolume, 0, 1)
	s.ScreenShake = clampFloat(s.ScreenShake, 0, 1)
	switch s.Quality {
	case "auto", "high", "balanced", "low":
	default:
		s.Quality = "auto"
	}
	switch s.Language {
	case "", "en", "ru", "uz":
	default:
		s.Language = ""
	}
	return s
}

// clone returns a deep copy so callers can never mutate the stored profile.
func (p Profile) clone() Profile {
	c := p
	c.Forge = make(map[string]int, len(p.Forge))
	for k, v := range p.Forge {
		c.Forge[k] = v
	}
	c.DailyBest = make(map[string]int, len(p.DailyBest))
	for k, v := range p.DailyBest {
		c.DailyBest[k] = v
	}
	c.UnlockedCores = append([]string{}, p.UnlockedCores...)
	c.Achievements = append([]string{}, p.Achievements...)
	c.Records = append([]RunRecord{}, p.Records...)
	return c
}

// Store persists a single profile as JSON. All access goes through the mutex.
type Store struct {
	mu      sync.Mutex
	dirFunc func() (string, error)
	path    string
	profile *Profile
}

// NewStore creates a store that resolves its directory lazily with dirFunc.
// Resolution is deferred because on mobile the native storage path is only
// available once the platform bridge is up.
func NewStore(dirFunc func() (string, error)) *Store {
	return &Store{dirFunc: dirFunc}
}

func (s *Store) ensureLoaded() error {
	if s.profile != nil {
		return nil
	}
	dir, err := s.dirFunc()
	if err != nil {
		return fmt.Errorf("resolve save directory: %w", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create save directory: %w", err)
	}
	s.path = filepath.Join(dir, "profile.json")
	p := newProfile()
	data, err := os.ReadFile(s.path)
	switch {
	case err == nil:
		if jerr := json.Unmarshal(data, &p); jerr != nil {
			// Keep the unreadable file for inspection instead of silently
			// overwriting the player's progress.
			// Timestamped, so a later corruption never overwrites this copy.
			_ = os.Rename(s.path, fmt.Sprintf("%s.%d.corrupt", s.path, time.Now().UnixNano()))
			p = newProfile()
		}
	case errors.Is(err, os.ErrNotExist):
	default:
		return fmt.Errorf("read profile: %w", err)
	}
	p.normalize()
	if err != nil {
		// First launch: write the fresh profile now so an unwritable save
		// directory is reported immediately rather than after a run.
		if werr := s.write(p); werr != nil {
			return werr
		}
	}
	s.profile = &p
	return nil
}

// View returns a copy of the current profile.
func (s *Store) View() (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return Profile{}, err
	}
	return s.profile.clone(), nil
}

// Update applies fn to the profile and persists it atomically. If fn returns
// an error nothing is changed.
func (s *Store) Update(fn func(p *Profile) error) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return Profile{}, err
	}
	next := s.profile.clone()
	if err := fn(&next); err != nil {
		return s.profile.clone(), err
	}
	next.normalize()
	if err := s.write(next); err != nil {
		return s.profile.clone(), err
	}
	s.profile = &next
	return next.clone(), nil
}

func (s *Store) write(p Profile) error {
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return fmt.Errorf("encode profile: %w", err)
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("write profile: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return fmt.Errorf("write profile: %w", err)
	}
	// Flush to disk before the rename so a crash or a mobile OS kill can
	// never leave an empty profile.json behind.
	if err := f.Sync(); err != nil {
		f.Close()
		return fmt.Errorf("sync profile: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close profile: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("commit profile: %w", err)
	}
	// Persist the rename itself (matters on Linux/Android). Directories cannot
	// be synced on Windows, so failures here are ignored.
	if d, err := os.Open(filepath.Dir(s.path)); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	if v != v { // NaN
		return lo
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
