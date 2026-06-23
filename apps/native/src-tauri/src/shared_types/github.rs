//! Contract types for the server-brokered GitHub App connection.
//!
//! The desktop never holds the App private key or a long-lived GitHub token —
//! the nixmac server brokers the install and mints short-lived, repo-scoped
//! installation tokens on demand (see `docs/github-app-server-contract.md`).
//! These structs are what the frontend consumes.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Result of `github_connect_start`: the GitHub App install URL to open in the
/// browser. `state` is server-tracked CSRF; the client only needs `install_url`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubConnectStart {
    /// GitHub App installation URL to open in the user's browser.
    pub install_url: String,
    /// Opaque CSRF state bound to the account server-side.
    pub state: String,
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
