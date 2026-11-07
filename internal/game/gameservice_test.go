package game

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTestService(t *testing.T) (*GameService, string) {
	t.Helper()
	dir := t.TempDir()
	clock := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	return &GameService{
		store: NewStore(func() (string, error) { return dir, nil }),
		now:   func() time.Time { return clock },
	}, dir
}

// play opens a run, lets the given game time pass on the service clock and
// submits r with the issued token.
func play(t *testing.T, g *GameService, r RunResult) (RunReward, error) {
	t.Helper()
	token, err := g.BeginRun()
	if err != nil {
		t.Fatal(err)
	}
	start := g.now()
	g.now = func() time.Time { return start.Add(time.Duration(r.TimeSec*float64(time.Second)) + time.Second) }
	r.Token = token
	return g.SubmitRun(r)
}

func TestNewProfileDefaults(t *testing.T) {
	g, _ := newTestService(t)
	p, err := g.GetProfile()
	if err != nil {
		t.Fatal(err)
	}
	if p.SelectedCore != "prism" || len(p.UnlockedCores) != 1 || p.Shards != 0 {
		t.Fatalf("unexpected defaults: %+v", p)
	}
	if p.Settings.Quality != "auto" || p.Settings.MasterVolume != 0.8 {
		t.Fatalf("unexpected default settings: %+v", p.Settings)
	}
}

func TestFirstLoadWritesProfile(t *testing.T) {
	g, dir := newTestService(t)
	if _, err := g.GetProfile(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "profile.json")); err != nil {
		t.Fatalf("profile not written on first load: %v", err)
	}
}

func TestSubmitRunPaysAndPersists(t *testing.T) {
	g, dir := newTestService(t)
	reward, err := play(t, g, RunResult{Score: 5000, Kills: 240, Level: 12, TimeSec: 320, Core: "prism", BossesDefeated: 1, MaxCombo: 20})
	if err != nil {
		t.Fatal(err)
	}
	// 240/12 + 320/8 + 12*2 + 30 = 20 + 40 + 24 + 30 = 114
	if reward.ShardsEarned != 114 {
		t.Fatalf("shards = %d, want 114", reward.ShardsEarned)
	}
	wantAch := []string{"first_light", "survivor_5", "warden"}
	if len(reward.NewAchievements) != len(wantAch) {
		t.Fatalf("achievements = %+v", reward.NewAchievements)
	}
	for i, id := range wantAch {
		if reward.NewAchievements[i].ID != id {
			t.Fatalf("achievement %d = %s, want %s", i, reward.NewAchievements[i].ID, id)
		}
	}
	if reward.AchievementBonus != 25+60+80 {
		t.Fatalf("bonus = %d", reward.AchievementBonus)
	}
	if reward.Profile.Shards != 114+165 || reward.Rank != 1 || !reward.NewBest {
		t.Fatalf("reward profile = %+v rank=%d best=%v", reward.Profile.Shards, reward.Rank, reward.NewBest)
	}

	// A fresh store reading the same directory sees the same data.
	g2 := &GameService{store: NewStore(func() (string, error) { return dir, nil }), now: time.Now}
	p, err := g2.GetProfile()
	if err != nil {
		t.Fatal(err)
	}
	if p.Shards != 279 || p.Stats.Runs != 1 || len(p.Records) != 1 {
		t.Fatalf("reloaded profile = %+v", p)
	}
}

func TestAchievementsOnlyOnce(t *testing.T) {
	g, _ := newTestService(t)
	if _, err := play(t, g, RunResult{Score: 10, Level: 1, Core: "prism"}); err != nil {
		t.Fatal(err)
	}
	r, err := play(t, g, RunResult{Score: 5, Level: 1, Core: "prism"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.NewAchievements) != 0 {
		t.Fatalf("first_light granted twice: %+v", r.NewAchievements)
	}
	if r.Rank != 2 || r.NewBest {
		t.Fatalf("rank=%d newBest=%v", r.Rank, r.NewBest)
	}
}

func TestSanitizeRunBlocksFakeVictory(t *testing.T) {
	r := sanitizeRun(RunResult{Victory: true, BossesDefeated: 1, Kills: -5, TimeSec: 1e9, MaxCombo: 999, Core: "nope"}, 1e9)
	if r.Victory || r.Kills != 0 || r.TimeSec != 4*3600 || r.MaxCombo != 0 || r.Core != "prism" {
		t.Fatalf("sanitize failed: %+v", r)
	}
}

func TestBuyUpgrade(t *testing.T) {
	g, _ := newTestService(t)
	if _, err := g.BuyUpgrade("vitality"); !errors.Is(err, ErrNotEnough) {
		t.Fatalf("want ErrNotEnough, got %v", err)
	}
	if _, err := g.BuyUpgrade("bogus"); !errors.Is(err, ErrUnknownUpgrade) {
		t.Fatalf("want ErrUnknownUpgrade, got %v", err)
	}
	if _, err := g.store.Update(func(p *Profile) error { p.Shards = 10000; return nil }); err != nil {
		t.Fatal(err)
	}
	var p Profile
	var err error
	for i := 0; i < 5; i++ {
		if p, err = g.BuyUpgrade("vitality"); err != nil {
			t.Fatalf("buy %d: %v", i, err)
		}
	}
	// 40 + 75 + 110 + 145 + 180 = 550
	if p.Forge["vitality"] != 5 || p.Shards != 10000-550 {
		t.Fatalf("after 5 buys: level=%d shards=%d", p.Forge["vitality"], p.Shards)
	}
	if _, err := g.BuyUpgrade("vitality"); !errors.Is(err, ErrMaxLevel) {
		t.Fatalf("want ErrMaxLevel, got %v", err)
	}
}

func TestFailedUpdateDoesNotMutate(t *testing.T) {
	g, _ := newTestService(t)
	_, _ = g.store.Update(func(p *Profile) error { p.Shards = 30; return nil })
	_, _ = g.BuyUpgrade("vitality") // costs 40, must fail
	p, _ := g.GetProfile()
	if p.Shards != 30 || p.Forge["vitality"] != 0 {
		t.Fatalf("failed purchase mutated profile: %+v", p)
	}
}

func TestCores(t *testing.T) {
	g, _ := newTestService(t)
	if _, err := g.SelectCore("halo"); !errors.Is(err, ErrCoreLocked) {
		t.Fatalf("want ErrCoreLocked, got %v", err)
	}
	_, _ = g.store.Update(func(p *Profile) error { p.Shards = 5000; return nil })
	p, err := g.UnlockCore("halo")
	if err != nil {
		t.Fatal(err)
	}
	if p.SelectedCore != "halo" || p.Shards != 4750 {
		t.Fatalf("unlock: %+v", p)
	}
	if _, err := g.UnlockCore("halo"); !errors.Is(err, ErrAlreadyOwned) {
		t.Fatalf("want ErrAlreadyOwned, got %v", err)
	}
	for _, id := range []string{"tesla", "nova", "spectre"} {
		if p, err = g.UnlockCore(id); err != nil {
			t.Fatal(err)
		}
	}
	if !contains(p.Achievements, "collector") {
		t.Fatal("collector achievement not granted")
	}
}

func TestDailyDeterministic(t *testing.T) {
	a := dailyFor(time.Date(2026, 11, 7, 1, 0, 0, 0, time.UTC))
	b := dailyFor(time.Date(2026, 11, 7, 23, 59, 0, 0, time.UTC))
	c := dailyFor(time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC))
	if a.Seed != b.Seed || a.Core != b.Core || a.Modifiers[0] != b.Modifiers[0] {
		t.Fatal("same day produced different challenges")
	}
	if a.Seed == c.Seed {
		t.Fatal("different days produced the same seed")
	}
	for d := 0; d < 400; d++ {
		x := dailyFor(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, d))
		if x.Modifiers[0].ID == x.Modifiers[1].ID {
			t.Fatalf("duplicate modifiers on day %d", d)
		}
	}
}

func TestDailyBestTracked(t *testing.T) {
	g, _ := newTestService(t)
	d, _ := g.GetDaily()
	r, err := play(t, g, RunResult{Score: 900, Level: 3, Core: d.Core, Daily: true, DailyKey: d.Key})
	if err != nil {
		t.Fatal(err)
	}
	if !r.DailyBest {
		t.Fatal("expected daily best")
	}
	d2, _ := g.GetDaily()
	if d2.Best != 900 {
		t.Fatalf("daily best = %d", d2.Best)
	}
}

func TestCorruptProfileIsKept(t *testing.T) {
	g, dir := newTestService(t)
	path := filepath.Join(dir, "profile.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := g.GetProfile()
	if err != nil {
		t.Fatal(err)
	}
	if p.SelectedCore != "prism" {
		t.Fatal("expected fresh profile")
	}
	kept, _ := filepath.Glob(path + ".*.corrupt")
	if len(kept) != 1 {
		t.Fatalf("corrupt file was not preserved: %v", kept)
	}
}

func TestLanguageSetting(t *testing.T) {
	g, _ := newTestService(t)
	for lang, want := range map[string]string{"ru": "ru", "uz": "uz", "en": "en", "": "", "fr": "", "RU": ""} {
		p, err := g.SaveSettings(Settings{Language: lang, Quality: "auto"})
		if err != nil {
			t.Fatal(err)
		}
		if p.Settings.Language != want {
			t.Errorf("language %q saved as %q, want %q", lang, p.Settings.Language, want)
		}
	}
}

func TestErrorsCarryCodes(t *testing.T) {
	g, _ := newTestService(t)
	_, err := g.BuyUpgrade("vitality")
	var ge *GameError
	if !errors.As(err, &ge) || ge.Code != "not_enough_shards" {
		t.Fatalf("want GameError not_enough_shards, got %#v", err)
	}
	b, _ := json.Marshal(err)
	if string(b) != `{"code":"not_enough_shards","message":"not enough shards yet — finish more runs to earn them"}` {
		t.Fatalf("unexpected wire format: %s", b)
	}
}

func TestSettingsSanitized(t *testing.T) {
	g, _ := newTestService(t)
	p, err := g.SaveSettings(Settings{MasterVolume: 3, MusicVolume: -1, Quality: "ultra"})
	if err != nil {
		t.Fatal(err)
	}
	if p.Settings.MasterVolume != 1 || p.Settings.MusicVolume != 0 || p.Settings.Quality != "auto" {
		t.Fatalf("settings not sanitized: %+v", p.Settings)
	}
}

func TestRunTokenIsSingleUse(t *testing.T) {
	g, _ := newTestService(t)
	token, err := g.BeginRun()
	if err != nil {
		t.Fatal(err)
	}
	r := RunResult{Score: 10, Level: 1, Core: "prism", Token: token}
	if _, err := g.SubmitRun(r); err != nil {
		t.Fatal(err)
	}
	if _, err := g.SubmitRun(r); !errors.Is(err, ErrUnknownRun) {
		t.Fatalf("second submit err = %v, want ErrUnknownRun", err)
	}
	if _, err := g.SubmitRun(RunResult{Level: 1, Core: "prism"}); !errors.Is(err, ErrUnknownRun) {
		t.Fatalf("tokenless submit err = %v, want ErrUnknownRun", err)
	}
}

func TestRunTimeBoundedByRealTime(t *testing.T) {
	g, _ := newTestService(t)
	token, _ := g.BeginRun()
	// Only ten real seconds pass, but the report claims a full victory.
	start := g.now()
	g.now = func() time.Time { return start.Add(10 * time.Second) }
	r, err := g.SubmitRun(RunResult{Token: token, TimeSec: 900, Kills: 100000, Level: 400, BossesDefeated: 3, Victory: true, Core: "prism"})
	if err != nil {
		t.Fatal(err)
	}
	rec := r.Profile.Records[0]
	if rec.Victory || rec.TimeSec > 15 || rec.Kills > 15*maxKillsPerSec+50 || rec.Level > 5+15/4 {
		t.Fatalf("implausible run accepted: %+v", rec)
	}
}

func TestDailyFlagValidated(t *testing.T) {
	g, _ := newTestService(t)
	d, _ := g.GetDaily()
	other := "prism"
	if d.Core == "prism" {
		other = "halo"
	}
	for name, run := range map[string]RunResult{
		"future key": {Daily: true, DailyKey: "9999-12-31", Core: d.Core},
		"wrong core": {Daily: true, DailyKey: d.Key, Core: other},
	} {
		run.Level = 1
		r, err := play(t, g, run)
		if err != nil {
			t.Fatal(err)
		}
		if r.DailyBest || r.Profile.Records[len(r.Profile.Records)-1].Daily {
			t.Fatalf("%s: daily run accepted", name)
		}
		if _, ok := r.Profile.DailyBest["9999-12-31"]; ok {
			t.Fatalf("%s: bogus daily key stored", name)
		}
	}
}

func TestSecondRetryAfterFailedSaveKeepsToken(t *testing.T) {
	dir := t.TempDir()
	blocked := filepath.Join(dir, "file")
	if err := os.WriteFile(blocked, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	saveTo := blocked // a file, not a directory: the store cannot load
	g := &GameService{store: NewStore(func() (string, error) { return saveTo, nil }), now: time.Now}
	token, _ := g.BeginRun()
	r := RunResult{Token: token, Level: 1, Core: "prism"}
	if _, err := g.SubmitRun(r); err == nil {
		t.Fatal("expected a save error")
	}
	saveTo = filepath.Join(dir, "ok")
	if _, err := g.SubmitRun(r); err != nil {
		t.Fatalf("retry with the same token failed: %v", err)
	}
}

func TestNormalizeCleansCores(t *testing.T) {
	p := newProfile()
	p.UnlockedCores = []string{"halo", "bogus", "halo", "prism"}
	p.normalize()
	if len(p.UnlockedCores) != 2 || p.UnlockedCores[0] != "prism" || p.UnlockedCores[1] != "halo" {
		t.Fatalf("cores = %v", p.UnlockedCores)
	}
}
