//! Persistence backends for observable state.
//!
//! `AppDataJson` stores per-device state in the OS app-data directory.
//! `RepoScopedJson` stores repo-scoped state under the user's config repo.
//! Subscribers attach a backend to an [`Observable<T>`] via
//! [`Observable::persist_to`](super::Observable::persist_to).

use anyhow::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::Runtime;

use super::json_io::{read_json_file, write_json_file};

/// Storage boundary for an observable.
///
/// Implementations work with JSON values so `Observable<T>` can keep the typed
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

    /// Resolve a file under the app data directory (honors the hermetic
    /// `NIXMAC_APP_DATA_DIR` override).
    #[allow(dead_code)]
    pub fn for_app<R: Runtime>(
        app: &tauri::AppHandle<R>,
        file_name: impl AsRef<Path>,
    ) -> Result<Self> {
        let app_data = crate::env::app_data_dir(app)?;
        Ok(Self::new(app_data.join(file_name)))
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

/// Repo-scoped persistence that waits for the app's config directory to be set
/// before doing anything.
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
}

impl Persistence for RepoScopedJson {
    fn load(&self) -> Result<Option<Value>> {
        read_json_file(&self.path)
    }

    fn flush(&self, value: &Value) -> Result<()> {
        crate::storage::configurable_scope::ensure_repo_store_dir_for_path(&self.path)?;
        write_json_file(&self.path, value)
    }
}

/// Repo-scoped JSON persistence that follows the app's explicitly configured
/// config directory.
///
/// This intentionally ignores the onboarding default (`/etc/nix-darwin`) until the
/// user has confirmed a directory. That keeps first-launch reads and accidental
/// pre-setup writes from making a clone/import target non-empty, which is disallowed
/// later in the UI and therefore bad.
#[derive(Debug, Clone)]
pub struct ConfiguredRepoScopedJson<R: Runtime> {
    app: tauri::AppHandle<R>,
}

impl<R: Runtime> ConfiguredRepoScopedJson<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        Self { app }
    }

    fn path(&self) -> Result<Option<PathBuf>> {
        let Some(config_dir) = crate::storage::store::get_config_dir_if_set(&self.app)? else {
            return Ok(None);
        };
        Ok(Some(PathBuf::from(
            crate::storage::configurable_scope::repo_store_path_for_config_dir(&config_dir)?,
        )))
    }
}

impl<R: Runtime> Persistence for ConfiguredRepoScopedJson<R> {
    fn load(&self) -> Result<Option<Value>> {
        let Some(path) = self.path()? else {
            return Ok(None);
        };
        read_json_file(&path)
    }

    fn flush(&self, value: &Value) -> Result<()> {
        let Some(path) = self.path()? else {
            return Ok(());
        };
        crate::storage::configurable_scope::ensure_repo_store_dir_for_path(&path)?;
        write_json_file(&path, value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_persistence_round_trips_by_scope_path() {
        let temp = tempfile::tempdir().expect("temp dir");
        let app_data_path = temp.path().join("app-data").join("settings.json");
        let repo_path = temp
            .path()
            .join("repo")
            .join(".nixmac")
            .join("settings.json");
        let app_data = AppDataJson::new(&app_data_path);
        let repo_scoped = RepoScopedJson::new(&repo_path);

        app_data
            .flush(&json!({ "count": 3, "label": "global" }))
            .expect("app data flushes");
        repo_scoped
            .flush(&json!({ "count": 4, "label": "repo" }))
            .expect("repo scoped flushes");

        assert!(app_data_path.ends_with("app-data/settings.json"));
        assert!(repo_path.ends_with("repo/.nixmac/settings.json"));
        assert_eq!(
            app_data.load().expect("app data loads"),
            Some(json!({ "count": 3, "label": "global" }))
        );
        assert_eq!(
            repo_scoped.load().expect("repo scoped loads"),
            Some(json!({ "count": 4, "label": "repo" }))
        );
    }
}
