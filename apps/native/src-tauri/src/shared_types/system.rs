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
    pub files_changed: usize,
    /// Added lines displayed in the indicator.
    pub additions: Option<usize>,
    /// Removed lines displayed in the indicator.
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
    pub checked_at: Option<i64>,
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
    pub total_scanned: usize,
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
