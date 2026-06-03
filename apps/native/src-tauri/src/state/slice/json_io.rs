//! Low-level JSON file read/write helpers used by persistence backends.

use anyhow::{Context, Result};
use serde_json::Value;
use std::fs;
use std::path::Path;

pub(super) fn read_json_file(path: &Path) -> Result<Option<Value>> {
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map(Some)
            .with_context(|| format!("failed to parse JSON at {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => {
            Err(error).with_context(|| format!("failed to read JSON at {}", path.display()))
        }
    }
}

pub(super) fn write_json_file(path: &Path, value: &Value) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }
    let json = serde_json::to_vec_pretty(value)
        .with_context(|| format!("failed to serialize JSON for {}", path.display()))?;
    fs::write(path, json).with_context(|| format!("failed to write JSON at {}", path.display()))
}
