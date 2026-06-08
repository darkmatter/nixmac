use serde::{Deserialize, Serialize};
use specta::Type;

use super::evolve::EvolveState;
use super::git::{GitStatus, SemanticChangeMap};

/// Application configuration returned by `config_get`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Absolute path to the selected nix-darwin flake/config directory.
    pub config_dir: String,
    /// Selected `darwinConfigurations.<host>` attribute, when configured.
    pub host_attr: Option<String>,
}

/// Result returned when the config directory is set (typed or picked).
/// `evolve_state` and `hosts` are `Some` only when the directory actually changed.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetDirResult {
    /// Selected absolute config directory.
    pub dir: String,
    /// Fresh evolve state after changing directories, when applicable.
    pub evolve_state: Option<EvolveState>,
    /// Hosts discovered in the selected flake, when applicable.
    pub hosts: Option<Vec<String>>,
}

/// Result returned from a rollback erase operation.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    /// Git status after rollback preparation.
    pub git_status: GitStatus,
    /// Evolve state after rollback preparation.
    pub evolve_state: EvolveState,
    /// Store path to reactivate as part of the rollback flow.
    pub rollback_store_path: Option<String>,
    /// Changeset id associated with the rollback target.
    pub rollback_changeset_id: Option<i64>,
}

/// Generic acknowledgement returned by fire-and-forget commands.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OkResult {
    /// True when the command completed successfully.
    pub ok: bool,
}

impl OkResult {
    #[allow(dead_code)]
    pub fn yes() -> Self {
        Self { ok: true }
    }
}

/// Result of `nix_check` — reports whether Nix and darwin-rebuild are available.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NixCheckResult {
    /// Whether Nix is installed.
    pub installed: bool,
    /// Installed Nix version string, when available.
    pub version: Option<String>,
    /// Whether `darwin-rebuild` is available.
    pub darwin_rebuild_available: bool,
}

/// Result of `darwin_build_check` — dry-run build outcome.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BuildCheckResult {
    /// Whether the dry-run build passed.
    pub passed: bool,
    /// Build output or failure details.
    pub output: String,
}

/// Result of a managed-edit apply operation (homebrew, system-defaults, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEditApplyResult {
    /// Whether the config edit was applied.
    pub ok: bool,
    /// Number of items applied.
    pub count: usize,
    /// Semantic summary after applying the edit.
    pub change_map: SemanticChangeMap,
    /// Git status after applying the edit.
    pub git_status: GitStatus,
    /// Evolve routing state after applying the edit.
    pub evolve_state: EvolveState,
}

/// Availability of known AI CLI tools.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CliToolsState {
    /// Whether the Claude CLI is installed.
    pub claude: bool,
    /// Whether the Codex CLI is installed.
    pub codex: bool,
    /// Whether the OpenCode CLI is installed.
    pub opencode: bool,
}
