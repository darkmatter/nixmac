//! Runtime registry for slice-backed configurable state.
//!
//! Startup registers generated `Configurable` entries here so commands can
//! iterate slices instead of opening store files directly.

use anyhow::Result;
use serde_json::Value;
use std::sync::RwLock as StdRwLock;

/// Type-erased configurable metadata for a registered slice.
///
/// Generated `Configurable` implementations expose these shims so developer
/// settings commands can enumerate schemas and write fields without knowing
/// which persistence backend a slice uses.
#[derive(Clone, Copy)]
pub struct RegisteredSliceConfig {
    /// Stable Rust-side name of the configurable state type.
    pub name: &'static str,
    /// Returns the UI schema with current values populated.
    pub schema_fn: fn(&tauri::AppHandle<tauri::Wry>) -> Result<configurable::ConfigurableSchema>,
    /// Writes one validated field value into the slice.
    pub set_field_fn: fn(&tauri::AppHandle<tauri::Wry>, &str, Value) -> Result<()>,
}

/// Runtime registry for slice-backed configurable state.
///
/// Startup registers generated `Configurable` entries here so commands can
/// iterate slices instead of opening store files directly.
#[derive(Default)]
pub struct SliceRegistry {
    entries: StdRwLock<Vec<RegisteredSliceConfig>>,
}

impl SliceRegistry {
    /// Add one configurable slice entry.
    pub fn register(&self, entry: RegisteredSliceConfig) -> Result<()> {
        self.entries
            .write()
            .map_err(|_| anyhow::anyhow!("slice registry lock poisoned"))?
            .push(entry);
        Ok(())
    }

    /// Return a stable snapshot of the registered entries.
    pub fn entries(&self) -> Result<Vec<RegisteredSliceConfig>> {
        Ok(self
            .entries
            .read()
            .map_err(|_| anyhow::anyhow!("slice registry lock poisoned"))?
            .clone())
    }

    /// Find one registered entry by name.
    pub fn get(&self, name: &str) -> Result<Option<RegisteredSliceConfig>> {
        Ok(self
            .entries
            .read()
            .map_err(|_| anyhow::anyhow!("slice registry lock poisoned"))?
            .iter()
            .copied()
            .find(|entry| entry.name == name))
    }

    /// Build schemas for every registered configurable slice.
    #[allow(dead_code)]
    pub fn schemas(
        &self,
        app: &tauri::AppHandle<tauri::Wry>,
    ) -> Result<Vec<configurable::ConfigurableSchema>> {
        self.entries()?
            .into_iter()
            .map(|entry| (entry.schema_fn)(app))
            .collect()
    }

    /// Dispatch a validated field write by registered slice name.
    #[allow(dead_code)]
    pub fn set_field_by_name(
        &self,
        app: &tauri::AppHandle<tauri::Wry>,
        slice_name: &str,
        field_key: &str,
        value: Value,
    ) -> Result<()> {
        let entry = self
            .get(slice_name)?
            .ok_or_else(|| anyhow::anyhow!("unknown slice config: {slice_name}"))?;
        (entry.set_field_fn)(app, field_key, value)
    }
}
