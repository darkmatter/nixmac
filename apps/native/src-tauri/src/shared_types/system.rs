use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specta::Type;

/// Current Homebrew package state detected on the machine.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HomebrewState {
    /// Whether Homebrew is installed and discoverable.
    pub is_installed: bool,
    /// Installed cask names.
    pub casks: Vec<String>,
    /// Installed formula names.
    pub brews: Vec<String>,
    /// Configured Homebrew tap names.
    pub taps: Vec<String>,
    /// Source used to collect the state, when known.
    pub source: Option<String>,
    /// Unix timestamp when this state was last collected.
    #[specta(type = f64)]
    pub last_checked: i64,
}

/// State sent to the preview indicator window.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewIndicatorState {
    /// Whether the floating preview indicator should be visible.
    pub visible: bool,
    /// Summary text displayed in the indicator.
    pub summary: Option<String>,
    /// Number of changed files represented by the indicator.
    #[specta(type = f64)]
    pub files_changed: usize,
    /// Added lines displayed in the indicator.
    #[specta(type = Option<f64>)]
    pub additions: Option<usize>,
    /// Removed lines displayed in the indicator.
    #[specta(type = Option<f64>)]
    pub deletions: Option<usize>,
    /// Whether the indicator should show a loading state.
    pub is_loading: bool,
}

/// Permission status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "lowercase")]
pub enum PermissionStatus {
    /// Permission has been granted.
    Granted,
    /// Permission was checked and denied.
    Denied,
    /// Permission has not been resolved yet.
    Pending,
    /// Permission state could not be determined.
    Unknown,
}

/// Individual permission state.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    /// Stable permission identifier.
    pub id: String,
    /// Human-readable permission name.
    pub name: String,
    /// Why nixmac needs this permission.
    pub description: String,
    /// Whether onboarding requires this permission.
    pub required: bool,
    /// Whether the app can trigger the system prompt directly.
    pub can_request_programmatically: bool,
    /// Current permission status.
    pub status: PermissionStatus,
    /// Manual instructions for permissions that cannot be requested programmatically.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

/// All permissions state.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsState {
    /// Individual permission states.
    pub permissions: Vec<Permission>,
    /// True when every required permission is granted.
    pub all_required_granted: bool,
    /// Unix timestamp when permissions were last checked.
    #[specta(type = Option<f64>)]
    pub checked_at: Option<i64>,
}

/// Status of the nix / darwin-rebuild installation flow.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NixInstallState {
    /// Whether nix is installed; `None` until first checked.
    pub installed: Option<bool>,
    /// Whether darwin-rebuild is available; `None` until first checked.
    pub darwin_rebuild_available: Option<bool>,
    /// True while an install run is in flight.
    pub installing: bool,
    /// Current installer phase ("downloading", "waiting-for-installer",
    /// "prefetching"); `None` when idle.
    pub install_phase: Option<String>,
    /// True while the standalone darwin-rebuild prefetch is in flight.
    pub prefetching: bool,
    /// Error from the last finished run, if it failed.
    pub last_error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LaunchdItemType {
    LaunchAgent,
    LaunchDaemon,
    LaunchdUserAgent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LaunchdItem {
    /// launchd Label
    pub label: String,
    pub scope: LaunchdItemType,
    /// Suggested Nix attribute name.
    /// Example: "redis"
    pub name: String,
    /// Command and arguments to execute.
    pub program_arguments: Vec<String>,
    /// Launch when loaded.
    pub run_at_load: bool,
    /// Keep the service running.
    pub keep_alive: bool,
    /// Environment variables.
    pub environment_variables: BTreeMap<String, String>,
    /// Log file locations.
    pub standard_out_path: Option<String>,
    pub standard_error_path: Option<String>,
    /// Working directory, if specified.
    pub working_directory: Option<String>,
}

/// Lifecycle status of the darwin-rebuild apply/activate streams.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RebuildStatus {
    /// True while a rebuild stream is in flight.
    pub is_running: bool,
    /// Outcome of the last finished run; `None` while running or never run.
    pub success: Option<bool>,
    /// Exit code of the last finished run.
    pub exit_code: Option<i32>,
    /// Error class of the last failed run.
    pub error_type: Option<String>,
    /// Error message of the last failed run.
    pub error_message: Option<String>,
    /// Whether the failure left the system untouched.
    pub system_untouched: Option<bool>,
}

/// A single macOS system default that differs from the factory value.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemDefault {
    /// nix-darwin option path for this macOS default.
    pub nix_key: String,
    /// Human-readable setting label.
    pub label: String,
    /// UI grouping category.
    pub category: String,
    /// Current value read from macOS defaults.
    pub current_value: String,
    /// Factory/default value used for comparison.
    pub default_value: String,
}

/// Result of a full system defaults scan.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemDefaultsScan {
    /// Defaults that differ from known factory values.
    pub defaults: Vec<SystemDefault>,
    /// Number of defaults keys scanned.
    #[specta(type = f64)]
    pub total_scanned: usize,
}

/// Managed file root inspected by the clobber preflight.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ManagedFileRoot {
    /// nix-darwin `environment.etc`, rooted at `/etc`.
    Etc,
    /// Home Manager `xdg.configFile`, rooted at `$XDG_CONFIG_HOME`.
    XdgConfig,
}

/// Kind of `/etc` clobber conflict detected before nix-darwin activation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EtcClobberConflictKind {
    /// Existing file content does not match any nix-darwin known safe hash.
    UnrecognizedContent,
    /// Existing path is not a regular file, so nix-darwin cannot hash/adopt it.
    NonRegularTarget,
    /// Existing path could not be inspected or hashed by nixmac.
    Unreadable,
}

/// A managed file that will be moved aside before activation continues.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManagedFileWarning {
    /// Absolute path that will be moved aside or replaced by activation.
    pub path: String,
    /// Managed-file target relative to its root.
    pub target: String,
    /// Root and option family that owns this target.
    pub managed_root: ManagedFileRoot,
    /// Home Manager user that owns the file, when known.
    pub user: Option<String>,
    /// Existing symlink target, if the path is currently a symlink.
    pub current_link_target: Option<String>,
    /// Expected symlink target, when the configuration exposes a concrete source.
    pub expected_link_target: Option<String>,
    /// Backup suffix activation will append before linking the generated file.
    pub backup_extension: Option<String>,
}

/// A single `/etc` path that nix-darwin would refuse to overwrite.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EtcClobberConflict {
    /// Absolute path under `/etc` that would be clobbered.
    pub path: String,
    /// nix-darwin `environment.etc.<name>.target` value.
    pub target: String,
    /// Symlink target nix-darwin expects for an already-managed file.
    pub expected_static_path: String,
    /// Existing symlink target, if the path is currently a symlink.
    pub current_link_target: Option<String>,
    /// Safe hashes advertised by nix-darwin for this entry.
    pub known_sha256_hashes: Vec<String>,
    /// Reason this path is considered unsafe to overwrite.
    pub kind: EtcClobberConflictKind,
}

/// Result of proactively checking managed-file overwrite safety.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EtcClobberCheckResult {
    /// True when no hard conflicts were detected.
    pub ok: bool,
    /// Number of enabled managed-file entries inspected.
    #[specta(type = f64)]
    pub checked: usize,
    /// Conflicts that would make nix-darwin abort activation.
    pub conflicts: Vec<EtcClobberConflict>,
    /// Non-blocking managed-file collisions that activation will back up.
    pub warnings: Vec<ManagedFileWarning>,
}

/// Home Manager copyApps target that requires App Management-sensitive probing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppManagementPermissionTarget {
    /// Home Manager user that owns the target directory.
    pub user: String,
    /// Absolute copyApps target directory.
    pub directory: String,
    /// Existing app bundles inspected under the target directory.
    pub app_bundles: Vec<String>,
}

/// An existing app bundle that could not be updated during the preflight probe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppManagementProbeFailure {
    /// Home Manager user that owns the app bundle target.
    pub user: String,
    /// Existing app bundle that macOS blocked nixmac from updating.
    pub app_bundle: String,
    /// OS error returned by the harmless `.DS_Store` update probe.
    pub error: String,
}

/// Result of proactively checking App Management-sensitive copyApps targets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppManagementCheckResult {
    /// True when every existing managed app bundle accepted the update probe.
    pub ok: bool,
    /// Number of existing app bundles inspected.
    #[specta(type = f64)]
    pub checked: usize,
    /// Target directories with existing app bundles that were inspected.
    pub targets: Vec<AppManagementPermissionTarget>,
    /// Existing app bundles that could not be updated.
    pub failures: Vec<AppManagementProbeFailure>,
}

/// A recommended prompt based on the user's current macOS settings.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedPrompt {
    /// Stable prompt identifier.
    pub id: String,
    /// Prompt text suggested to the user.
    pub prompt_text: String,
}

/// Result of inspecting the running app's install location.
///
/// The UI surfaces a "move to /Applications" warning when the app is running
/// from a `.app` bundle that is not in `/Applications` (e.g. still on the
/// mounted DMG). When `bundle_path` is `None` the process is not running from
/// a bundle at all (e.g. `tauri dev`, cargo test, e2e runners); the UI must
/// treat that as "check not applicable" rather than "misplaced" so dev and
/// test runs don't show a false warning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InstallLocationState {
    /// True when the `.app` bundle's parent directory is `/Applications`.
    pub in_applications_dir: bool,
    /// Absolute path to the detected `.app` bundle, or `None` when the process
    /// is not running from inside a bundle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_path: Option<String>,
}
