//! Contract types for the server-brokered GitHub App connection.
//!
//! The desktop never holds the App private key or a long-lived GitHub token —
//! the nixmac server brokers the install and mints short-lived, repo-scoped
//! installation tokens on demand (see `docs/github-app-server-contract.md`).
//! These structs are what the frontend consumes.

use super::account::AuthAccount;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Result of starting a GitHub connection flow. Authenticated connections use
/// `install_url` as the GitHub App install URL; unauthenticated bootstrap uses
/// GitHub device OAuth and includes a user code to display.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubConnectStart {
    /// GitHub URL to open in the user's browser.
    pub install_url: String,
    /// Opaque state bound to the account/server flow.
    pub state: String,
    /// Device OAuth code the user must enter at `verification_uri`.
    pub user_code: Option<String>,
    /// Device OAuth verification URL.
    pub verification_uri: Option<String>,
    /// Seconds until the device code expires.
    pub expires_in: Option<u32>,
    /// Minimum polling interval, in seconds.
    pub interval: Option<u32>,
}

/// Current state of a GitHub-first desktop bootstrap flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GithubBootstrapState {
    /// The browser OAuth/install flow has not finished yet.
    Pending,
    /// The server created/bound the Better Auth user and returned a device key.
    Complete,
    /// The server could not create an account from GitHub identity; use email OTP.
    FallbackRequired,
    /// The state token expired or is no longer usable.
    Expired,
}

/// Public bootstrap status returned to the frontend. Secret material returned by
/// the server is persisted natively and intentionally omitted from this type.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubBootstrapStatus {
    /// Bootstrap lifecycle state for this browser flow.
    pub state: GithubBootstrapState,
    /// True once the account is linked to a GitHub App installation.
    pub connected: bool,
    /// The connected GitHub login (for display), when known.
    pub login: Option<String>,
    /// The linked installation id, when connected.
    #[specta(type = f64)]
    pub installation_id: Option<i64>,
    /// The Better Auth account created or bound by the server, when complete.
    pub account: Option<AuthAccount>,
    /// Human-readable reason to show when email OTP fallback is needed.
    pub fallback_reason: Option<String>,
    /// Server-requested polling interval in seconds (used for GitHub slow_down).
    pub poll_interval_seconds: Option<u32>,
}

/// Whether this account has a linked GitHub App installation, returned by
/// `github_status` (polled while the browser install completes).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    /// True once the account is linked to a GitHub App installation.
    pub connected: bool,
    /// The connected GitHub login (for display), when known.
    pub login: Option<String>,
    /// The linked installation id, when connected.
    #[specta(type = f64)]
    pub installation_id: Option<i64>,
}

/// A repository the installation can access, returned by `github_list_repos`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepo {
    /// Repository owner login.
    pub owner: String,
    /// Repository name.
    pub name: String,
    /// Whether the repository is private.
    pub private: bool,
    /// ISO-8601 timestamp of the last update.
    pub updated_at: String,
    /// Default branch name (where `flake.nix` is checked).
    pub default_branch: String,
    /// Whether a `flake.nix` exists at the default branch root.
    pub has_flake: bool,
}
