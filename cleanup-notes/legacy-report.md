# Legacy / Fallback Code Audit

_Date: 2026-05-03_
_Scope: `apps/native/src-tauri/src/**` — legacy, fallback, backwards-compat, deprecated paths_
_Method: `rg -n 'legacy|fallback|deprecated|backwards|backcompat|compat|v1|old_|_old'`+`git blame`/`git log -p`_

______________________________________________________________________

## Summary Table

| # | Location | Pattern | Classification | Proposed Action |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- | ----------------------- |
| 1 | `credential_store.rs` + `store.rs` | `legacy_settings_store`, `get_with_lazy_migration`, `set_with_cleanup` | **Active migration — KEEP** | No action |
| 2 | `db/schema.rs` `repair_legacy_evolutions_schema` | Migration hook for pre-migration-03 DBs | **Active migration — KEEP** | No action |
| 3 | `store.rs:109` `read_host_attr_from_file` | Reads `~/.config/darwin/host` for backwards compat | **Active compat — KEEP** | No action |
| 4 | `default_config.rs:134` `_up_/templates/nix-darwin-determinate` | Legacy Tauri bundling path candidate | **Requires approval** | See § Requires Approval |
| 5 | `shared_types.rs:165` `changeset_at_build` | `#[serde(skip_serializing)]` / `#[allow(dead_code)]` field | **Active deserialization compat — KEEP** | No action |
| 6 | `evolve/mod.rs:1376` "legacy edits list" comment | Semantic edits appended to `evolution.edits` | **Active — not a dead path** | No action |
| 7 | `evolve/tools.rs:389` `"raw"` accepted for backwards compat | `raw` scaffold type aliased to `yaml_map` behaviour | **Active compat alias — KEEP** | No action |
| 8 | `darwin.rs:149` `use_fallback` (`nix run nix-darwin/master#darwin-rebuild`) | Fallback when `darwin-rebuild` not on PATH | **Active runtime branch — KEEP** | No action |

**No high-confidence dead-branch removals were executed.** All located legacy paths are either
active migrations that have not yet reached all users, active runtime branches, or backwards-compat
guards still needed. One item requires approval before removal.

______________________________________________________________________

## Detailed Findings

### 1. `credential_store.rs` + `store.rs` — `legacy_settings_store` / `get_with_lazy_migration`

**Classification: Active migration — KEEP**

Introduced in `0796f1d6` (2026-04-29, ~4 days ago). Migrates API keys from plaintext
`settings.json` to the macOS Keychain on first access. The keychain PR explicitly notes
that any user who last ran the app before this version still has credentials in
`settings.json`. The migration is lazy (fires on first `get_secret_pref` call) so it has
**not** reached every user yet — virtually no time has passed.

Tests in `credential_store.rs` and `store.rs` cover the migration and cleanup paths.

**Condition that triggers legacy path:** `keychain.get()` returns `Ok(None)` AND
`legacy.get()` returns `Ok(Some(_))`. This remains reachable for any user upgrading from
pre-`0796f1d6`.

**Decision: KEEP.** Cannot be removed until a release forced-migration period has passed
(suggested: ≥ 2 releases after `0796f1d6` ships).

______________________________________________________________________

### 2. `db/schema.rs` — `repair_legacy_evolutions_schema`

**Classification: Active migration — KEEP**

Introduced in `e70b0cd5` (2026-05-03, today). Fixes a schema inconsistency where the
`evolutions` table had a `branch` column instead of `origin_branch`, or was missing the
column entirely.

The broken schema would exist on databases created before migration `03-evolutions-origin-branch`
ran. Any user at `user_version` 1 or 2 (i.e., any database created before this PR) would
have this schema.

The hook fires during `migrations.to_latest()` as a pre-migration hook for migration 03.
Once migration 03 has run, `table_has_column(tx, "evolutions", "origin_branch")` returns
`true`, so `needs_repair = false` and the hook is a no-op for all future app starts.

**Condition for repair:** only triggered on databases with `user_version < 3`. Every
database at version ≥ 3 skips this entirely (idempotent guard at the top).

**Decision: KEEP.** The migration is hours old. Users who have not yet launched the app
since `e70b0cd5` still need it.

______________________________________________________________________

### 3. `store.rs:109` — `read_host_attr_from_file`

**Classification: Active backwards-compat — KEEP**

Reads `$XDG_CONFIG_HOME/darwin/host` (default `~/.config/darwin/host`) as a fallback for
the `hostAttr` setting. Used in two places:

- `nix.rs:97` — `determine_host_attr`
- `commands.rs:60` — `config_get` via `.or_else(store::read_host_attr_from_file)`

This path predates the JSON settings store. There is no migration that writes the
`hostAttr` key to `settings.json` for users who previously only had the file — it relies
on the user saving settings again or the app writing it on next `config_set_host_attr`.

**Condition:** `store.get("hostAttr")` returns `None` (user never explicitly saved host in
the new UI) AND the file `~/.config/darwin/host` exists. Reachable for any long-time user
who hasn't resaved their host attribute.

**Decision: KEEP.** Cannot determine when all legacy users have been migrated without
telemetry data. Removal requires explicit approval.

______________________________________________________________________

### 4. `default_config.rs:134` — `_up_/templates/nix-darwin-determinate` ← REQUIRES APPROVAL

**Classification: Likely-dead search candidate — requires approval**

Added in `ce3c2684` ("Add misc fixes and UAT commands", ~9 weeks ago) with the comment
"Legacy bundling path (Tauri encodes `../` as `_up_/`)".

The current `tauri.conf.json` bundles resources as `"../templates/nix-darwin-determinate/"`.
With Tauri 2, the resource is exposed under `resource_dir` as `nix-darwin-determinate`
(the basename of the resolved path). Candidates 1 (`nix-darwin-determinate`) and 2
(`templates/nix-darwin-determinate`) cover the realistic production and alternative layouts.
Candidate 3 (`_up_/templates/nix-darwin-determinate`) was the path used by an older Tauri
resource resolution scheme that encoded `../` as `_up_/`. This encoding does not occur in
Tauri 2.

**Condition:** `resource_dir.join("_up_/templates/nix-darwin-determinate")` resolves to an
existing directory with a `flake.nix` file inside. This directory does not exist in any
current Tauri 2 bundle, so the candidate never matches.

**Risk of removal:** Very low — `candidates.into_iter().find(...)` short-circuits at the
first match. Candidate 3 is only tried if candidates 1 and 2 both fail, meaning current
production users are unaffected whether this line exists or not.

**To remove (once approved):** Delete lines 133–134 from `default_config.rs`:

```rust
        // Legacy bundling path (Tauri encodes `../` as `_up_/`)
        resource_dir.join("_up_/templates/nix-darwin-determinate"),
```

______________________________________________________________________

### 5. `shared_types.rs:165` — `changeset_at_build` field

**Classification: Active deserialization compat — KEEP**

The field is `#[serde(skip_serializing)]` and `#[allow(dead_code)]`. It was marked for
compatibility in `e80a35ad` ("refactor(build-state): prepare migration for historic build
tracking", 5 days ago), where it was noted as preserved so that existing `evolve-state.json`
files on disk that contain a `changesetAtBuild` key don't fail deserialization.

The field is never read in Rust or TypeScript production code (only in Storybook fixtures),
but it prevents a deserialization panic for users whose `evolve-state.json` predates the
field removal.

**Condition for need:** any user whose `evolve-state.json` was written by a version that
included `changesetAtBuild`. The removal PR is only 5 days old.

**Decision: KEEP.** Cannot remove until confident all on-disk state files have been
rewritten without the field. This happens automatically on the next successful evolve cycle
per user, but we have no visibility into when that is for all users.

______________________________________________________________________

### 6. `evolve/mod.rs:1376` — "Preserve semantic edit events in the legacy edits list"

**Classification: Active — comment is slightly misleading, not a dead path**

The comment says "legacy edits list" but means "the `Evolution.edits: Vec<FileEdit>`
field, which was originally only for search/replace edits". Semantic edits (a newer edit
type) are also appended here so that `evolution.edits.len()` accurately reflects total edit
count for telemetry. This is an active, called path on every semantic edit.

**Decision: No action.**

______________________________________________________________________

### 7. `evolve/tools.rs:389` + `ensure_secret.rs:34` — `"raw"` scaffold alias

**Classification: Active backwards-compat alias — KEEP**

The `ensure_secret` tool schema advertises `"raw"` in the `enum` alongside `"envFile"` and
`"yamlMap"`, with the note it is "accepted for backwards compatibility". The model may
have learned to emit `"raw"` from prior prompts/conversations. The `serde` alias maps `raw`
and `raw_yaml` / `raw-yaml` to `SecretScaffoldType::Raw`, which falls through to the
`YamlMap` rendering branch.

This is an active guard against stale model outputs. Removal would cause deserialization
failures for any conversation that remembered the old `"raw"` value.

**Decision: KEEP.**

______________________________________________________________________

### 8. `darwin.rs:149` — `use_fallback` (`nix run nix-darwin/master#darwin-rebuild`)

**Classification: Active runtime branch — KEEP**

`!crate::nix::is_darwin_rebuild_available()` is true on a fresh macOS install before Nix
has been installed and `darwin-rebuild` placed on PATH. In that state the app falls back to
`nix run nix-darwin/master#darwin-rebuild`. This is a real, tested code path; `nix.rs:191`
documents that `prefetch_darwin_rebuild_stream` pre-warms the Nix store so this fallback is
fast.

**Decision: KEEP.** Absolutely needed for the onboarding flow.

______________________________________________________________________

## Requires Approval

| Item | File:Lines | What to remove | Why waiting |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_up_` bundle candidate | `default_config.rs:133-134` | Comment + `resource_dir.join("_up_/templates/nix-darwin-determinate"),` | Tauri 2 never produces `_up_/` paths; this candidate cannot match in production. But if wrong, bootstrap silently fails for affected users. Removal is a 2-line edit. Low risk, needs explicit sign-off. |

______________________________________________________________________

## Changes Executed

None. All legacy paths are active migrations, active runtime branches, or backwards-compat
guards still needed. The one candidate for removal (§4) requires explicit approval.

______________________________________________________________________

## Verification

```
cargo check --all-targets   → PASSED (0 errors, 0 warnings)
cargo clippy --all-targets -- -D warnings → PASSED (no issues)
cargo test                  → 243 passed, 4 failed (pre-existing failures in
                               token_budgets.rs and gitignore.rs — unrelated to this audit)
cargo run --example specta_gen_ts → PASSED (types exported)
```

Pre-existing test failures (not introduced by this audit):

- `summarize::token_budgets::tests::clamps_output_to_available_context_when_needed`
- `summarize::token_budgets::tests::returns_zero_output_when_only_tiny_completion_would_fit`
- `summarize::token_budgets::tests::returns_requested_output_when_budget_fits`
- `evolve::gitignore::tests::malformed_gitignore_fails_closed`
