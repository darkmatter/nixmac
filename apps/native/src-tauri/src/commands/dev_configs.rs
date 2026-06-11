//! Tauri commands that walk the compile-time configurable registry.
//!
//! The dev-settings UI fetches metadata in two halves:
//!
//! - [`dev_configs_schemas`] returns the static `ConfigurableSchema` for every
//!   `#[derive(Configurable)]` struct. Same value every call — cacheable.
//! - [`dev_configs_values`] returns the current store-backed value of each
//!   configurable as a JSON object, keyed by struct name. Refresh this after
//!   `dev_config_set` instead of re-fetching the schemas.
//!
//! Edits go back through `dev_config_set`, which dispatches by struct name to
//! the registered shim emitted by the derive and replaces the whole struct in
//! one Serde-validated write.
//!
//! The registry itself lives in `inventory`: the derive macro pushes one
//! `ConfigurableMeta` per struct at compile time, so these commands never
//! see a runtime registry handle.

use super::helpers::capture_err;
use configurable::{ConfigurableMeta, ConfigurableSchema, inventory};
use std::collections::HashMap;
use tauri::AppHandle;

fn find_meta(struct_name: &str) -> Option<&'static ConfigurableMeta> {
    inventory::iter::<ConfigurableMeta>()
        .into_iter()
        .find(|meta| meta.name == struct_name)
}

/// Enumerate the static schema for every registered Configurable struct.
#[tauri::command]
pub async fn dev_configs_schemas(_app: AppHandle) -> Result<Vec<ConfigurableSchema>, String> {
    Ok(inventory::iter::<ConfigurableMeta>()
        .into_iter()
        .map(|meta| (meta.schema_fn)())
        .collect())
}

/// Fetch the current store-backed value of every registered Configurable
/// struct. Keyed by struct name (matches `ConfigurableSchema::name`).
#[tauri::command]
pub async fn dev_configs_values(
    app: AppHandle,
) -> Result<HashMap<String, serde_json::Value>, String> {
    inventory::iter::<ConfigurableMeta>()
        .into_iter()
        .map(|meta| (meta.load_fn)(&app).map(|v| (meta.name.to_string(), v)))
        .collect::<anyhow::Result<HashMap<_, _>>>()
        .map_err(|e| capture_err("dev_configs_values", e))
}

/// Replace one Configurable struct with a new whole-struct payload.
///
/// `value` must deserialize into the target Configurable type as a whole;
/// Serde validates every field in one pass. Frontends that update a single
/// field should send the full struct with the other fields' current values
/// preserved.
#[tauri::command]
pub async fn dev_config_set(
    app: AppHandle,
    struct_name: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let meta = find_meta(&struct_name)
        .ok_or_else(|| format!("dev_config_set: unknown configurable: {struct_name}"))?;
    (meta.set_fn)(&app, value).map_err(|e| capture_err("dev_config_set", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::Future;

    #[test]
    fn command_signatures_match_frontend_contract() {
        fn assert_schemas_command<F, Fut>(_f: F)
        where
            F: Fn(AppHandle) -> Fut,
            Fut: Future<Output = Result<Vec<ConfigurableSchema>, String>>,
        {
        }

        fn assert_values_command<F, Fut>(_f: F)
        where
            F: Fn(AppHandle) -> Fut,
            Fut: Future<Output = Result<HashMap<String, serde_json::Value>, String>>,
        {
        }

        fn assert_set_command<F, Fut>(_f: F)
        where
            F: Fn(AppHandle, String, serde_json::Value) -> Fut,
            Fut: Future<Output = Result<(), String>>,
        {
        }

        assert_schemas_command(dev_configs_schemas);
        assert_values_command(dev_configs_values);
        assert_set_command(dev_config_set);
    }

    #[test]
    fn evolution_limits_is_registered_via_inventory() {
        // Verifies the link-time submit! actually wires EvolutionLimits into
        // the static collection. If inventory's linker tricks regress on a
        // future toolchain, this test catches it before the dev settings UI
        // silently goes empty.
        assert!(find_meta("EvolutionLimits").is_some());
    }
}
