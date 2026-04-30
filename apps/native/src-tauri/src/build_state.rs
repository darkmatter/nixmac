//! Persisted build state — tracks the last successful nix-darwin build.
//!
//! Intentionally separate from `evolve-state.json` so that build records
//! survive evolution discards and resets.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::sqlite_types::Change;
use crate::types::GitStatus;

const BUILD_STATE_PATH: &str = "build-state.json";
const BUILD_STATE_KEY: &str = "buildState";

/// The last successful nix-darwin build recorded by nixmac.
/// And the current nix store path for validation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildState {
    pub nixmac_built_store_path: Option<String>,
    pub changeset_id: Option<i64>,
    pub head_commit_hash: Option<String>,
    pub built_at: Option<i64>,
    pub current_nix_store_path: Option<String>,
}

impl BuildState {
    pub fn unknown_build(&self) -> bool {
        self.current_nix_store_path.is_none()
            || self.current_nix_store_path != self.nixmac_built_store_path
    }
}

/// Resolve the nix store path for the currently active system profile.
pub fn read_current_store_path() -> Option<String> {
    std::fs::canonicalize("/nix/var/nix/profiles/system")
        .ok()
        .and_then(|p| p.to_str().map(String::from))
}

/// Load the persisted build state. Returns `BuildState::default()` if absent or corrupt.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> Result<BuildState> {
    let store = app.store(BUILD_STATE_PATH)?;
    if let Some(val) = store.get(BUILD_STATE_KEY) {
        if let Ok(state) = serde_json::from_value::<BuildState>(val.clone()) {
            return Ok(state);
        }
    }
    Ok(BuildState::default())
}

/// Persist build state to `build-state.json`.
pub fn set<R: Runtime>(app: &AppHandle<R>, state: BuildState) -> Result<BuildState> {
    let store = app.store(BUILD_STATE_PATH)?;
    store.set(BUILD_STATE_KEY, serde_json::to_value(&state)?);
    store.save()?;
    Ok(state)
}

/// Returns true if the current working tree state was actually built.
///
/// 1. Fast-fail: live nix store path must match `nixmac_built_store_path`.
/// 2. No changes is not committable.
/// 3. If `changeset_id` is Some: the stored change hashes must exactly match
///    the hashes in `current_changes` (from git status).
pub fn current_state_built<R: Runtime>(app: &AppHandle<R>, current_changes: &[Change]) -> bool {
    let Ok(state) = get(app) else { return false };

    // Fast-fail: if the live store path doesn't match what nixmac last built, not built.
    let live = read_current_store_path();
    if live.is_none() || live != state.nixmac_built_store_path {
        return false;
    }

    match state.changeset_id {
        None => current_changes.is_empty(),
        Some(id) => {
            let Ok(db_path) = crate::db::get_db_path(app) else { return false };
            let Ok(conn) = rusqlite::Connection::open(&db_path) else { return false };
            let Ok(stored_hashes) =
                crate::db::changesets::fetch_hashes_for_changeset(&conn, id)
            else {
                return false;
            };
            let current_hashes: std::collections::HashSet<&str> =
                current_changes.iter().map(|c| c.hash.as_str()).collect();
            let stored_set: std::collections::HashSet<&str> =
                stored_hashes.iter().map(|h| h.as_str()).collect();
            current_hashes == stored_set
        }
    }
}

pub fn set_active_build<R: Runtime>(
    app: &AppHandle<R>,
    store_path: Option<String>,
    changeset_id: Option<i64>,
    head_commit_hash: Option<String>,
) -> Result<()> {
    set(
        app,
        BuildState {
            nixmac_built_store_path: store_path.clone(),
            changeset_id,
            head_commit_hash,
            built_at: Some(crate::utils::unix_now()),
            current_nix_store_path: store_path,
        },
    )
    .map(|_| ())
}

/// Compute build state with a "bare" changeset to verify it
pub fn record_build<R: Runtime>(app: &AppHandle<R>, git_status: &GitStatus) -> Result<()> {
    let db_path = crate::db::get_db_path(app)?;
    let config_dir = crate::store::get_config_dir(app)?;

    let build_changeset_id = if !git_status.changes.is_empty() {
        let base_id = crate::db::commits::store_head_commit(&db_path, &config_dir, None)?
            .ok_or_else(|| anyhow::anyhow!("missing HEAD commit while recording build state"))?;
        Some(crate::db::store_bare_changeset::store(
            &db_path,
            base_id,
            &git_status.changes,
        )?)
    } else {
        None
    };

    set_active_build(
        app,
        read_current_store_path(),
        build_changeset_id,
        git_status.head_commit_hash.clone(),
    )
}

/// Read the current nix-darwin generation number from the system profile symlink.
/// `/nix/var/nix/profiles/system` → `system-N-link` → N
pub fn read_current_nix_generation() -> Option<i64> {
    let target = std::fs::read_link("/nix/var/nix/profiles/system").ok()?;
    let name = target.file_name()?.to_str()?;
    let stripped = name.strip_prefix("system-")?;
    let (num_str, _) = stripped.split_once('-')?;
    num_str.parse().ok()
}

/// Record a completed nixmac-initiated build into the new build tables.
pub fn record_nixmac_build<R: Runtime>(
    app: &AppHandle<R>,
    changeset_id: Option<i64>,
    store_path: &str,
) -> Result<()> {
    let Some(gen) = read_current_nix_generation() else {
        return Err(anyhow::anyhow!(
            "record_nixmac_build: could not read nix generation from /nix/var/nix/profiles/system"
        ));
    };
    let db_path = crate::db::get_db_path(app)?;
    let now = crate::utils::unix_now();
    let conn = rusqlite::Connection::open(&db_path)?;
    crate::db::builds::record_nixmac(&conn, gen, store_path, changeset_id, now)?;
    Ok(())
}

/// Record a watcher-detected external build (nixmac_build_id = NULL).
pub fn record_external_build<R: Runtime>(
    app: &AppHandle<R>,
    nix_generation: i64,
    store_path: &str,
) -> Result<()> {
    let db_path = crate::db::get_db_path(app)?;
    let conn = rusqlite::Connection::open(&db_path)?;
    let now = crate::utils::unix_now();
    crate::db::builds::record_external(&conn, nix_generation, store_path, now)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(nixmac: Option<&str>, current: Option<&str>) -> BuildState {
        BuildState {
            nixmac_built_store_path: nixmac.map(str::to_owned),
            current_nix_store_path: current.map(str::to_owned),
            ..Default::default()
        }
    }

    #[test]
    fn unknown_build_when_current_is_none() {
        assert!(state(Some("/nix/store/abc"), None).unknown_build());
    }

    #[test]
    fn unknown_build_when_paths_differ() {
        assert!(state(Some("/nix/store/abc"), Some("/nix/store/xyz")).unknown_build());
    }

    #[test]
    fn known_build_when_paths_match() {
        assert!(!state(Some("/nix/store/abc"), Some("/nix/store/abc")).unknown_build());
    }

    #[test]
    fn unknown_build_when_nixmac_path_is_none() {
        assert!(state(None, Some("/nix/store/abc")).unknown_build());
    }

    #[test]
    fn both_none_is_unknown() {
        assert!(state(None, None).unknown_build());
    }
}
