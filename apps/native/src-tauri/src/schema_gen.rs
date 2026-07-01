//! JSON Schema codegen for `#[derive(Configurable)]` settings files.
//!
//! Run: `cd apps/native/src-tauri && cargo run -- gen-schemas`

use anyhow::{Context, Result};
use configurable::{ConfigurableMeta, inventory};
use std::path::Path;

use crate::env::config::NixmacEnvSettings;
use crate::evolve::config::UserPreferences;

const DEFAULT_OUT_DIR: &str = "resources/schemas";

/// Ensures inventory entries are linked into the binary.
fn link_configurables() {
    let _ = (
        UserPreferences::json_schema(),
        NixmacEnvSettings::json_schema(),
    );
}

/// Write JSON Schema files for every registered configurable.
pub fn write_config_schemas(out_dir: impl AsRef<Path>) -> Result<()> {
    link_configurables();
    let out_dir = out_dir.as_ref();
    std::fs::create_dir_all(out_dir)
        .with_context(|| format!("create schema output dir {}", out_dir.display()))?;

    for meta in inventory::iter::<ConfigurableMeta>() {
        let schema = (meta.json_schema_fn)();
        let path = out_dir.join(meta.schema_file);
        let contents = serde_json::to_string_pretty(&schema).context("serialize JSON Schema")?;
        std::fs::write(&path, format!("{contents}\n"))
            .with_context(|| format!("write {}", path.display()))?;
        println!("Wrote {}", path.display());
    }

    Ok(())
}

pub fn write_default_config_schemas() -> Result<()> {
    write_config_schemas(DEFAULT_OUT_DIR)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn user_preferences_json_schema_has_expected_shape() {
        link_configurables();
        let schema = UserPreferences::json_schema();
        assert_eq!(
            schema.get("$schema").and_then(Value::as_str),
            Some("https://json-schema.org/draft/2020-12/schema")
        );
        let props = schema
            .get("properties")
            .and_then(Value::as_object)
            .expect("properties");
        let max_iterations = props
            .get("maxIterations")
            .and_then(Value::as_object)
            .expect("maxIterations");
        assert_eq!(
            max_iterations.get("type").and_then(Value::as_str),
            Some("integer")
        );
        assert_eq!(
            max_iterations.get("minimum").and_then(Value::as_f64),
            Some(1.0)
        );
        assert_eq!(
            max_iterations.get("maximum").and_then(Value::as_f64),
            Some(200.0)
        );
    }

    #[test]
    fn committed_config_schemas_match_generated() {
        link_configurables();
        for meta in inventory::iter::<ConfigurableMeta>() {
            let generated = (meta.json_schema_fn)();
            let path = Path::new(DEFAULT_OUT_DIR).join(meta.schema_file);
            let committed = std::fs::read_to_string(&path)
                .unwrap_or_else(|_| panic!("missing committed schema at {}", path.display()));
            let committed_value: Value =
                serde_json::from_str(committed.trim()).expect("parse committed schema");
            assert_eq!(
                generated, committed_value,
                "schema drift for {} — run: cargo run -- gen-schemas",
                meta.schema_file
            );
        }
    }
}
