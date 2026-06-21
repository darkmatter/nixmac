# Weak-Type Replacement Report

Generated: 2026-05-03

## Summary

Replaced all stringly-typed and `serde_json::Value`-typed Tauri command APIs in
`commands.rs` with strong Rust structs. New types are defined in `shared_types.rs`,
exported via `specta_gen_ts`, and reflected in `src/types/shared.ts` and
`src/tauri-api.ts`.

______________________________________________________________________

## Replacements Made

### New types added to `shared_types.rs`

| Type | Purpose |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `OkResult` | Generic `{ ok: true }` acknowledgement for fire-and-forget commands |
| `NixCheckResult` | `nix_check` — replaces `json!({ "installed": ..., "version": ..., "darwin_rebuild_available": ... })` |
| `BuildCheckResult` | `darwin_build_check` — replaces `json!({ "passed": ..., "output": ... })` |
| `ConfigEditApplyResult` | Managed-edit result (homebrew, system-defaults) — replaces ad-hoc `json!({...})` |
| `CliToolsState` | `check_cli_tools` — replaces `HashMap<String, bool>` with fixed `claude`/`codex`/`opencode` fields |
| `UiPrefsUpdate` | Typed partial-update for `ui_set_prefs` — replaces `prefs: serde_json::Value` |
| `DebugSentryResult` | `debug_sentry_event` (debug-only) — replaces `json!({...})` |
| `EvolveCancelResult` | `darwin_evolve_cancel` — replaces `json!({ "ok": true, "message": ... })` |

______________________________________________________________________

## Command-by-Command Status

| Command | Old return type | New return type | Status |
| ----------------------------- | ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `config_set_host_attr` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `debug_sentry_event` | `Result<Value, String>` | `Result<DebugSentryResult, String>` | ✅ Done |
| `homebrew_apply_diff` | `Result<Value, String>` | `Result<ConfigEditApplyResult, String>` | ✅ Done |
| `git_stash` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `darwin_evolve` | `Result<Value, String>` | `Result<EvolutionResult, String>` | ✅ Done (was using `to_value(...).unwrap_or_default()`) |
| `darwin_evolve_cancel` | `Result<Value, String>` | `Result<EvolveCancelResult, String>` | ✅ Done |
| `darwin_evolve_answer` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `darwin_apply_stream_start` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `darwin_activate_store_path` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `darwin_apply_stream_cancel` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `nix_check` | `Result<Value, String>` | `Result<NixCheckResult, String>` | ✅ Done |
| `darwin_rebuild_prefetch` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `nix_install_start` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `finalize_flake_lock` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `ui_set_prefs` | `(prefs: Value) -> Result<Value, String>` | `(prefs: UiPrefsUpdate) -> Result<OkResult, String>` | ✅ Done |
| `clear_cached_models` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `set_cached_models` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `add_to_prompt_history` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `show_main_window` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `preview_indicator_show` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `preview_indicator_hide` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `preview_indicator_update` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `set_has_uncommitted_changes` | `Result<Value, String>` | `Result<OkResult, String>` | ✅ Done |
| `apply_system_defaults` | `Result<Value, String>` | `Result<ConfigEditApplyResult, String>` | ✅ Done |
| `darwin_build_check` | `Result<Value, String>` | `Result<BuildCheckResult, String>` | ✅ Done |
| `check_cli_tools` | `Result<HashMap<String, bool>, String>` | `Result<CliToolsState, String>` | ✅ Done |

______________________________________________________________________

## Supporting module changes

| File | Change |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `managed_edit.rs` | `finalize_managed_edit` now returns `Result<ConfigEditApplyResult>` instead of `Result<serde_json::Value>` |
| `apply_system_defaults.rs` | Updated return type to `Result<ConfigEditApplyResult>` |
| `mac/homebrew.rs` | `apply_homebrew_diff` now returns `Result<ConfigEditApplyResult>` |
| `examples/specta_gen_ts.rs` | Registers all 8 new types so they are exported to TypeScript |

______________________________________________________________________

## Retained `serde_json::Value` (justified)

| Location | Reason |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flake_installed_apps` → `Vec<serde_json::Value>` | Returns `nix eval .#darwinConfigurations.<host>.config.environment.systemPackages` — the package attribute set shape is entirely determined by the user's flake and is genuinely dynamic. Frontend uses `unknown[]` accordingly. |
| `nix.rs` `evaluate_installed_apps` → `Vec<Value>` | Same as above — evaluates arbitrary nix package attrs. |
| `provider_errors.rs` `parse_provider_error_body` | Parses a third-party provider error JSON body of unpredictable shape. |
| `types.rs` `FeedbackMetadata.current_app_state_snapshot: Option<Value>` | Captures an arbitrary snapshot of frontend app state; shape varies by UI version. |
| `types.rs` `FeedbackUsageStats.extra: Option<Value>` | Open-ended metadata bag for future extensibility in feedback payloads. |
| `nix.rs` `nix:install:end` / `nix:darwin-rebuild:end` events | Emitted via `serde_json::json!` directly into Tauri events (not Tauri commands); these are event payloads consumed directly by the frontend with inline type assertions. Replacing them would require adding typed event structs across the Tauri event bus — deferred to a separate task. |

______________________________________________________________________

## Frontend updates

| File | Change |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------- |
| `src/tauri-api.ts` | Imports `BuildCheckResult`, `CliToolsState`, `ConfigEditApplyResult`, `NixCheckResult`, `OkResult`, `UiPrefsUpdate` from `shared.ts`; all `invoke<...>` generics updated; removed inline `ConfigEditApplyResult` interface (was duplicate) |
| `src/hooks/use-nix-install.ts` | Updated `result.darwin_rebuild_available` → `result.darwinRebuildAvailable` (camelCase from new typed struct) |
| `src/lib/ai-provider-validation.ts` | `cliStatus` parameter changed from `Record<string, boolean>` to `CliToolsState                                                                                                                                                             | null  | undefined` |
| `src/components/widget/settings/ai-models-tab.tsx` | `useCliToolStatus` hook state typed as `CliToolsState                                                                                                                                                                                      | null` |
| `src/types/shared.ts` | Regenerated via `cargo run --example specta_gen_ts` — 8 new types added |

______________________________________________________________________

## `Box<dyn Any>` audit

No instances of `Box<dyn Any>` found in `src/` (searched all `.rs` files in the crate).

______________________________________________________________________

## Verification

```
cargo check --all-targets   ✅ clean
cargo clippy --all-targets -- -D warnings   ✅ clean
cargo test   ✅ 243 pass / 4 fail (pre-existing token_budget failures, unrelated to this PR)
cargo run --example specta_gen_ts   ✅ TypeScript bindings regenerated
bun run tsc --noEmit   ✅ no new errors (pre-existing errors in kibo-ui/code-example4 etc. unchanged)
```
