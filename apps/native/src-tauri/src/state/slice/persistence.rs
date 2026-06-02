//! Persistence backends for state slices.
//!
//! `AppDataJson` stores per-device state in the OS app-data directory.
//! `RepoScopedJson` stores repo-scoped state under the user's config repo.

use anyhow::{Context, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

use super::json_io::{read_json_file, write_json_file};

/// Storage boundary for a slice.
///
/// Implementations work with JSON values so `Slice<T>` can keep the typed
/// serialization/deserialization logic central while backends only decide
/// where bytes live.
pub trait Persistence: Send + Sync {
    /// Load the last persisted JSON value, or `None` when the slice has not
    /// been persisted yet.
    fn load(&self) -> Result<Option<Value>>;

    /// Persist the complete serialized state value.
    fn flush(&self, value: &Value) -> Result<()>;
}

/// JSON persistence rooted in Tauri's app data directory.
///
/// Use this for per-device state and global preferences that should not follow
/// the user's config repository.
#[derive(Debug, Clone)]
pub struct AppDataJson {
    path: PathBuf,
}

impl AppDataJson {
    /// Build an app-data persistence backend from an already resolved path.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Resolve a file under Tauri's app data directory.
    #[allow(dead_code)]
    pub fn for_app<R: Runtime>(
        app: &tauri::AppHandle<R>,
        file_name: impl AsRef<Path>,
    ) -> Result<Self> {
        let app_data = app
            .path()
            .app_data_dir()
            .context("failed to resolve app data directory")?;
        Ok(Self::new(app_data.join(file_name)))
    }

    /// Return the backing JSON path.
    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Persistence for AppDataJson {
    fn load(&self) -> Result<Option<Value>> {
        read_json_file(&self.path)
    }

    fn flush(&self, value: &Value) -> Result<()> {
        write_json_file(&self.path, value)
    }
}

/// JSON persistence rooted in the user's selected config repository.
///
/// This is the backend for settings that should travel with the repo, for
/// example repo-scoped tuning knobs. Path resolution delegates to
/// `storage::configurable_scope` so onboarding and README creation stay in one
/// place.
#[derive(Debug, Clone)]
pub struct RepoScopedJson {
    path: PathBuf,
}

impl RepoScopedJson {
    /// Build a repo-scoped persistence backend from an already resolved path.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Resolve the current repo-scoped settings path from app configuration.
    #[allow(dead_code)]
    pub fn for_app<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Self> {
        Ok(Self::new(
            crate::storage::configurable_scope::repo_store_path(app)?,
        ))
    }

    /// Return the backing JSON path.
    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Persistence for RepoScopedJson {
    fn load(&self) -> Result<Option<Value>> {
        read_json_file(&self.path)
    }

    fn flush(&self, value: &Value) -> Result<()> {
        write_json_file(&self.path, value)
    }
}
