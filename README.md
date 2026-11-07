# Prismfall

A neon survivor roguelite for desktop and mobile, built with **Wails v3**, **Go**, **React** and **TypeScript**.

Steer a fragile core of light through a swarm. Weapons fire on their own; you move, dash and choose upgrades. Survive ten minutes and bring down three bosses: the Warden (3:00), the Lattice (6:00) and the Eclipse (10:00).

## Features

- **Six weapons** (pulse bolts, orbiting halo shards, chain lightning, nova shockwaves, homing missiles and a rotating spectral beam), each with five levels, plus eight passive upgrades.
- **Seven enemy types and three bosses.** Enemies include dashers, splitters, shooters, bombers and tanks. Bosses use spiral, ring, charge and summon patterns, and enrage at half health.
- **Meta progression in Go**: shards, eight forge upgrades, five unlockable cores, ten achievements and a local top-ten leaderboard. Go validates all of it and saves atomically. Each run gets a single-use token from Go. Reported game time can't exceed the real time since the run began. Kills, level and bosses are capped to what that time allows, and the daily bonus only counts for today's (or yesterday's) challenge played with its own core.
- **Daily challenge**: Go derives a seed, a core and two rule modifiers from the UTC date, so everyone gets the same run that day.
- **Visual effects**: pre-rendered glow sprites, a grid that warps under shockwaves and gravity wells, particles, screen shake, hit-stop and slow-motion boss kills.
- **Procedural audio**: every sound effect is synthesized with WebAudio, and the generative soundtrack opens up as the run intensifies. No audio files ship with the game.
- **One control scheme for every device**: keyboard, gamepad, and a floating touch joystick with a dash button. Native haptics on mobile come from Go (`application.Mobile.Haptic`), and the screen stays awake during runs.
- **Adaptive quality**: Auto drops the detail level if the frame rate falls. Reduced-flash and screen-shake settings are included, and the game respects reduced motion.
- **Three languages**: English, Russian and Uzbek (Latin script, with proper oʻ/gʻ). On first launch the game follows the device language. Switch from the EN/RU/UZ toggle on the title screen or in Settings, and the choice is saved to your profile.

## Languages

All display text lives in `frontend/src/i18n/`: `en.ts` is the reference, and `ru.ts` and `uz.ts` must define exactly the same keys. A missing or extra key fails the TypeScript build. The engine and Go backend send IDs only (weapon, boss, banner, error code), and the UI translates them. Go errors carry a stable `code` (`GameError`), which the frontend maps to `error.<code>`.

To add a language: copy `en.ts`, translate it, and register it in `i18n/index.tsx` (`LANGS`, `DICTS`, `LOCALE`). Then add its code to `sanitizeSettings` in `internal/game/profile.go`.

Text uses Exo 2 (Latin, Cyrillic). Headings use Unbounded, but ʻ/ʼ are drawn from Exo 2 through a `unicode-range` face, because Unbounded draws them like an accent.

## Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move | WASD / arrows | Left stick / d-pad | Drag anywhere |
| Dash | Space / Shift | A / RB | Dash button |
| Pause | Esc / P | Start | Pause button |
| Pick upgrade | 1, 2, 3 or arrows + Enter | Stick + A | Tap a card |
| Reroll | R | Y | Reroll button |
| Fullscreen | F11 | | |

## Project layout

```
main.go                           Wails app and window
internal/game/gameservice.go      Bound service: profile, forge, cores, runs, daily, haptics
internal/game/profile.go          Profile model and atomic JSON store
internal/game/catalog.go          Forge upgrades, cores, achievements, daily modifiers
internal/game/gameservice_test.go Economy, persistence and daily-seed tests
frontend/src/game   Canvas engine (engine.ts), input, audio, sprites, content
frontend/src/ui     React screens: title, HUD, level-up, forge, records, settings
frontend/src/api    Typed adapter over generated bindings (+ browser preview fallback)
frontend/src/i18n   English, Russian and Uzbek dictionaries + translation helpers
```

Saves live in `%APPDATA%\Prismfall` on Windows, `~/Library/Application Support/Prismfall` on macOS and `~/.config/Prismfall` on Linux. On phones they go to the app's private storage.

## Develop

```bash
wails3 dev                 # desktop app with hot reload
go test ./...              # backend tests (internal/game)
cd frontend && npx vite    # browser-only UI preview (progress kept in localStorage)
```

In the browser preview, `window.__game.debugWarp(seconds)` and `window.__game.debugLevels(n)` jump ahead to test bosses and upgrades. These hooks exist only in dev builds.

## Build

```bash
wails3 build                     # bin/prismfall.exe (or the macOS/Linux binary)
wails3 task android:package      # bin/prismfall.apk, arm64 release
wails3 task android:package:fat  # arm64 + x86_64 (runs on emulators)
wails3 task android:bundle       # .aab for Google Play
```

Android release builds are signed with the debug key unless `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` are set. That's fine for sideloading, but Google Play will reject it.

### macOS and iOS

These need a Mac with Xcode.

```bash
wails3 task darwin:package             # bin/prismfall.app, arm64, ad-hoc signed
wails3 task darwin:package:universal   # same, arm64 + amd64
wails3 task darwin:package:dmg         # bin/prismfall.dmg installer
wails3 task ios:package                # bin/prismfall.app for the iOS Simulator (iOS 15+)
wails3 task ios:deploy-simulator       # package, install and launch on the booted simulator
```

Both packages are written to `bin/prismfall.app`, so move one aside before building the other platform.

The macOS icons (`build/darwin/icons.icns` and `Assets.car`) are compiled from `build/appicon.icon`. Its only layer is a full-bleed copy of `build/appicon.png`, the same artwork as the Windows and Android icons. After changing `appicon.png`, refresh that layer, then rebuild the icons. The icon task also rewrites `build/windows/icon.ico`. Builds use the committed icons and never regenerate them, so run this only when the artwork changes.

```bash
magick \( build/appicon.png -resize 135% -gravity center -extent 1024x1024 -blur 0x24 -background black -alpha remove \) \
  build/appicon.png -gravity center -composite -alpha off build/appicon.icon/Assets/appicon.png
wails3 task common:generate:icons
```

`build/ios/xcode/` is regenerated from `build/config.yml` and `build/appicon.png` on every iOS build and isn't committed.

A real iPhone needs real signing and a provisioning profile: `wails3 task ios:package:ipa IOS_PLATFORM=device CODESIGN_IDENTITY="Apple Development: …" PROVISIONING_PROFILE=path/to/profile.mobileprovision`, or `wails3 task ios:xcode` to let Xcode manage signing.
