use serde::{Deserialize, Serialize};
use specta::Type;

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
/// State mirrors (evolve state, git state, hosts) flow through the
/// `*_changed` events; this only carries genuine command results.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetDirResult {
    /// Selected absolute config directory.
    pub dir: String,
    /// True when the selected directory differs from the previous one.
    pub changed: bool,
}

/// Result returned from a rollback erase operation. Git/evolve state mirrors
/// flow through the `*_changed` events; this only carries the rollback target.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    /// Store path to reactivate as part of the rollback flow.
    pub rollback_store_path: Option<String>,
    /// Changeset id associated with the rollback target.
    #[specta(type = Option<f64>)]
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
