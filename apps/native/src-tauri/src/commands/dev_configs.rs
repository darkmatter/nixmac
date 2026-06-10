//! Tauri commands that walk the compile-time configurable registry.
//!
//! Frontend calls `dev_configs_list` to enumerate every `#[derive(Configurable)]`
//! struct in the codebase. Each entry returns as a [`ConfigurableSnapshot`]:
//! the static schema (labels, types, ranges, defaults — same value every call)
//! paired with the current values pulled from the managed observable. Edits go
//! back through `dev_config_set`, which dispatches by struct name to the
//! registered shim emitted by the derive and replaces the whole struct in one
//! Serde-validated write.
//!
//! The registry itself lives in `inventory`: the derive macro pushes one
//! `ConfigurableMeta` per struct at compile time, so these commands never
//! see a runtime registry handle.

use super::helpers::capture_err;
use configurable::{inventory, ConfigFieldValue, ConfigurableMeta, ConfigurableSnapshot};
use tauri::AppHandle;

fn find_meta(struct_name: &str) -> Option<&'static ConfigurableMeta> {
    inventory::iter::<ConfigurableMeta>()
        .into_iter()
        .find(|meta| meta.name == struct_name)
}

fn snapshot_for(
    meta: &ConfigurableMeta,
    app: &AppHandle,
) -> anyhow::Result<ConfigurableSnapshot> {
    let schema = (meta.schema_fn)();
    let current = (meta.load_value_fn)(app)?;
    let values = schema
        .fields
        .iter()
        .map(|field| ConfigFieldValue {
            key: field.key.clone(),
            current: current
                .get(&field.key)
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        })
        .collect();
    Ok(ConfigurableSnapshot { schema, values })
}

/// Enumerate every registered Configurable struct with its current values.
#[tauri::command]
pub async fn dev_configs_list(app: AppHandle) -> Result<Vec<ConfigurableSnapshot>, String> {
    inventory::iter::<ConfigurableMeta>()
        .into_iter()
        .map(|meta| snapshot_for(meta, &app))
        .collect::<anyhow::Result<Vec<_>>>()
        .map_err(|e| capture_err("dev_configs_list", e))
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
        fn assert_list_command<F, Fut>(_f: F)
        where
            F: Fn(AppHandle) -> Fut,
            Fut: Future<Output = Result<Vec<ConfigurableSnapshot>, String>>,
        {
        }

        fn assert_set_command<F, Fut>(_f: F)
        where
            F: Fn(AppHandle, String, serde_json::Value) -> Fut,
            Fut: Future<Output = Result<(), String>>,
        {
        }

        assert_list_command(dev_configs_list);
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
