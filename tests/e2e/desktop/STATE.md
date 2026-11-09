# Starting Nix Mac from saved state

The desktop runtime accepts arbitrary JSON values under `initialState` names.
The Nix Mac recipe owns the corresponding guest paths in `stateFiles`. It
writes complete files before the app starts, so the release binary reads them
through its normal persistence code. Supplying a name that the recipe does not
register is an error before a VM is acquired.

These paths and the recovery behavior were checked against release tag
`v0.33.1` (`ff44c469ae152c7c3c92184648cf3527280413cc`) as well as this checkout.
The tested release DMG is
`https://github.com/darkmatter/nixmac/releases/download/v0.33.1/nixmac_0.33.1_aarch64.dmg`,
SHA-256 `bf4586a6563098809be6b3f344d84470d9d667fa4ea8b1c07fc0e2d664836ca3`.
Changing builds can change how older state loads; the runtime records the exact
build and starting state used for each phase.

## Registered files

All six targets are beneath
`~/Library/Application Support/com.darkmatter.nixmac/` in the disposable guest.
The bundle identifier in `apps/native/src-tauri/tauri.conf.json` determines this
default Tauri directory. `~` is resolved by the worker for the guest user.

| Target name | Filename | Actual representation and owner |
| --- | --- | --- |
| `preferences` | `global-preferences.json` | Flat camelCase `GlobalPreferences`: config/repo paths, selected host, provider/model preferences, UI options. Defined in `shared_types/prefs.rs`; loaded by `state/preferences.rs`. |
| `onboarding` | `onboarding-state.json` | Flat camelCase `OnboardingState`: `completedAt`, `lastBuildAt`, `macScannedAt`, `loginDecided`, `provisionalConfigDir`. Defined in `shared_types/onboarding.rs`; loaded and reconciled by `state/onboarding.rs`. Timestamps are Unix seconds. |
| `evolve` | `evolve-state.json` | Flat camelCase `EvolveSession`: evolution/changeset IDs, backup/rollback references, last evolution outcome. Owned by `state/evolve_state.rs` and `shared_types/evolve.rs`. |
| `build` | `build-state.json` | Tauri store object with a **`buildState` wrapper** around `nixmacBuiltStorePath`, `changesetId`, `headCommitHash`, `builtAt`, and `currentNixStorePath`. Owned by `state/build_state.rs`. |
| `legacy-settings` | `settings.json` | Legacy Tauri key/value store, including migration markers, prompt history, cached model names, account metadata and usage statistics. Owned by `storage/legacy_kv.rs`, `storage/store.rs`, and `statistics.rs`. |
| `query-cache` | `query-cache.json` | Tauri store; `nixmac-query-cache` holds a serialized React Query cache string. `src/lib/query-persist.ts` saves only successful, explicitly opted-in queries. `{}` starts without this cache. |

Rust owner paths above are relative to `apps/native/src-tauri/src/`; frontend
paths are relative to `apps/native/`. Never treat an API/view-model snapshot as
the persisted schema: notably, `evolve.step` and `evolve.committable` are derived
from the real Git worktree and active Nix store path when the app loads.

Other persistence has different owners and is not registered as arbitrary JSON
targets in this recipe:

- `<configDir>/.nixmac/settings.json` holds flat repo-scoped tuning settings
  such as `maxIterations`, `maxTokenBudget`, `maxBuildAttempts`, and
  `maxOutputTokens`. `evolve/config.rs` uses `ConfiguredRepoScopedJson` from
  `observable/persistence.rs`. It reads only an explicitly selected config
  directory. The default config location is `/etc/nix-darwin`; that repository's
  `flake.nix`, modules, Git history, and real system profile remain authoritative.
  A future repo fixture must prepare those files as well as the matching JSON.
- `nixmac.db` beneath the app-data directory is a SQLite cache. Its
  `PRAGMA user_version` is **1 in v0.33.1, 2 in this checkout**. A mismatch causes
  recreation before embedded Diesel migrations run (`db/schema.rs`). Do not
  write a JSON value to this database or transplant IDs without their backing
  Git/DB data.
- Docs caches (`nix-darwin-docs.json`, `home-manager-docs.json`, and
  `docs-cache-meta.json`) live beneath app data; the feedback queue is
  `report.json`. They are caches/delivery state, not loading controls. No feedback
  queue fixture is supplied because app startup may retry its external delivery.
- API credentials use the native credential store, and WebView localStorage
  holds browser-owned values such as telemetry cache and recovery notices.
  The checked-in fixtures contain no credentials or copied user data.

The native `NIXMAC_APP_DATA_DIR` override is available in release builds and
redirects `AppDataJson`, the legacy settings store, SQLite, and other explicit
users of that helper. **It does not redirect every store**: `build-state.json`
and the frontend query store currently use relative Tauri plugin-store paths.
The desktop recipe therefore uses the actual standard directory in fresh VMs,
without relying on that override for isolation.

## Loading and migrations

The JSON slices have no common schema-version envelope. Serde uses camelCase,
defaults missing fields, and ignores unknown fields. For the preference,
onboarding, and evolve slices, a well-formed JSON value that cannot deserialize
falls back to the whole slice's defaults. Syntactically invalid JSON fails the
underlying `AppDataJson` read and can prevent startup. The request API accepts
JSON values, so it can exercise schema-mismatched values but does not inject
syntactically invalid JSON bytes.

Startup migrations matter when composing a seed:

1. Legacy `settings.json` preference values are copied once unless
   `globalPreferencesMigratedV1` is `true`. The fixtures set that marker and
   clear other legacy values, preventing stale image preferences from
   overriding the supplied `preferences` slice.
1. Unacknowledged `sendDiagnostics: false` migrates to the default-on setting.
   Both fixtures set `diagnosticsNoticeAcknowledged: true` with the explicit
   false preference. Deprecated scalar `evolveModel`/`summaryModel` values
   migrate into per-provider maps, with existing map entries winning.
1. Legacy `onboarding*` fields in the global preferences file are copied into
   unset onboarding fields and removed from the original file. This removal
   makes the migration single-shot.
1. When `completedAt` is absent/null and `lastBuildAt` exists, startup sets
   `completedAt = lastBuildAt` and persists the result. This recovers a process
   killed after the first successful apply and before the celebration finished.
1. Evolve sessions with stale backup/rollback anchors are cleared against real
   Git HEAD. Legacy `step`/`committable` JSON fields are ignored. A populated
   build record alone cannot prove the current worktree was built: the app
   checks the live Nix system profile and corresponding change hashes.

There is **no persisted switch that starts an in-flight loading operation**.
`packages/state/src/viewmodel/store.ts` begins with `hydrated: false`;
`DarwinWidget` hydrates the backend slices and probes permissions, Nix and Git
before showing the onboarding or main view. During that initial hydration,
release v0.33.1 renders a neutral container; current source renders a staged
`SplashScreen`. Both depend on live probes rather than a persisted loading flag.
UI processing flags, Nix installation progress,
rebuild-running status, Git status and permissions are runtime state. Current
source also keeps secrets-vault loading in memory. `lastEvolutionState` accepts
the historical enum value `"loading"`, but setting it does not launch or resume
an evolution, and does not force a loading overlay.

## Two reproducible starting points

Use [fresh-onboarding.initial-state.json](fresh-onboarding.initial-state.json)
as `initialState` with `scenarioIds: ["launch"]`. It clears the persisted
journey and cached session while retaining the prepared VM's real Nix,
Homebrew and permissions. The actual GUI must reach `Config Directory`.

Use [startup-recovery.initial-state.json](startup-recovery.initial-state.json)
with `scenarioIds: ["startup-recovery"]`. It represents an interrupted
completion and a configuration folder that was subsequently lost. The fixture
contains a historical `lastBuildAt: 1751967600` and `completedAt: null`; it does
not assert that this test performed that build. The recipe verifies:

1. The pre-launch JSON really has `completedAt: null`, the expected
   `lastBuildAt` and configuration path, and no `flake.nix` exists there.
1. The real application exits initial hydration and renders
   `Configuration not found`, including that exact seeded path.
1. The app-written onboarding file contains `completedAt: 1751967600`.
1. Screenshots, continuous video, loaded preferences and recovered onboarding
   JSON are retained outside the VM.

An empty window, a model's success claim, or merely echoing the supplied seed
does not satisfy these checks. The app-written timestamp is a concrete
before/after proof of loading and reconciliation. This tests recovery through
startup; it does not claim to reproduce a timed spinner or run an interrupted
AI/build process. To test those transitions, a scenario must initiate the real
operation and observe its live progress.

Run the two scenarios as separate requests because they intentionally require
different starting states. Candidate, baseline and confirmation each receive
the selected request's same seed in a fresh VM. Capture the starting request
alongside the resulting report when reproducing a failure.
