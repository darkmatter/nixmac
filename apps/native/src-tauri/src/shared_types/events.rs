//! Tauri event payload types emitted from Rust to the frontend.
//!
//! Each struct is the typed payload for a specific event name (e.g.
//! `nix:install:progress` → `NixInstallProgressEvent`). The frontend
//! registers listeners via `ipcRenderer.on` and receives these as
//! `event.payload`. Fields use `camelCase` serialization to match the
//! TypeScript convention on the other side of the IPC boundary.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use specta::Type;

use super::system::EtcClobberCheckResult;

/// Phase emitted during Nix installation/setup.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum NixInstallPhase {
    /// Downloading the Determinate Nix installer package.
    Downloading,
    /// Waiting for the macOS installer UI to complete.
    WaitingForInstaller,
    /// Prefetching nix-darwin's `darwin-rebuild` command.
    Prefetching,
}

/// Known Nix installation failure categories.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum NixInstallErrorType {
    /// Unexpected internal error before a specific phase failed.
    Internal,
    /// Failed while downloading the installer package.
    DownloadFailed,
    /// The macOS installer failed or was cancelled.
    InstallerFailed,
    /// A setup phase timed out.
    Timeout,
    /// nix-darwin prefetch/setup failed.
    DarwinRebuild,
}

/// Payload for `nix:install:progress`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NixInstallProgressEvent {
    /// Current setup phase.
    pub phase: NixInstallPhase,
    /// Bytes downloaded so far, for download phase progress.
    pub downloaded: Option<u64>,
    /// Total bytes expected, when known.
    pub total: Option<u64>,
}

/// Payload for `nix:install:end`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub struct NixInstallEndEvent {
    /// Whether setup completed successfully.
    pub ok: bool,
    /// Exit/status code for the completed setup phase.
    pub code: i32,
    /// Installed Nix version on success.
    pub nix_version: Option<String>,
    /// Whether `darwin-rebuild` is available after setup.
    pub darwin_rebuild_available: Option<bool>,
    /// Failure category on error.
    pub error_type: Option<NixInstallErrorType>,
    /// Human-readable failure message.
    pub error: Option<String>,
}

/// Payload for `nix:darwin-rebuild:end`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NixDarwinRebuildEndEvent {
    /// Whether nix-darwin setup completed successfully.
    pub ok: bool,
    /// Human-readable failure message.
    pub error: Option<String>,
}

/// Known rebuild/activation failure categories.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RebuildErrorType {
    /// Nix evaluation hit infinite recursion.
    InfiniteRecursion,
    /// Nix evaluation failed.
    EvaluationError,
    /// Build failed after evaluation.
    BuildError,
    /// Full Disk Access is missing for activation.
    FullDiskAccess,
    /// App Management is missing for managed app bundle updates.
    AppManagement,
    /// User cancelled the privileged activation prompt.
    UserCancelled,
    /// Administrator authorization failed.
    AuthorizationDenied,
    /// nix-darwin would overwrite unmanaged files in /etc.
    EtcClobber,
    /// Fallback for uncategorized failures.
    GenericError,
}

/// Payload for `darwin:apply:data`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DarwinApplyDataEvent {
    /// Raw output chunk from the rebuild process.
    pub chunk: String,
}

/// Payload for `darwin:apply:summary`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub struct DarwinApplySummaryEvent {
    /// Human-readable summary text.
    pub text: String,
    /// Whether this is the final summary event.
    pub complete: Option<bool>,
    /// Whether the rebuild succeeded.
    pub success: Option<bool>,
    /// Whether this event describes an error.
    pub error: Option<bool>,
    /// Error category when `error` or `complete && !success` is set.
    pub error_type: Option<RebuildErrorType>,
}

/// Payload for `darwin:apply:end`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub struct DarwinApplyEndEvent {
    /// Whether rebuild/apply completed successfully.
    pub ok: bool,
    /// Exit/status code for the rebuild/apply operation.
    pub code: i32,
    /// Error category on failure.
    pub error_type: Option<RebuildErrorType>,
    /// Human-readable failure message.
    pub error: Option<String>,
    /// Whether the failed operation completed before changing system state.
    pub system_untouched: Option<bool>,
    /// Path to the captured rebuild log, when available.
    pub log_file: Option<String>,
    /// Structured `/etc` clobber conflicts when `error_type` is `etc_clobber`.
    pub etc_clobber: Option<EtcClobberCheckResult>,
}

/// Payload for `rust:panic`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RustPanicEvent {
    /// Panic message captured by the panic hook.
    pub message: String,
    /// Source location reported by Rust, when available.
    pub location: Option<String>,
    /// Captured backtrace, when available.
    pub backtrace: Option<String>,
    /// UTC timestamp when the panic was captured.
    pub timestamp: String,
}

/// Payload for `config:changed`, when emitted by a filesystem watcher.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChangedEvent {
    /// Whether the selected config currently has changes.
    pub has_changes: bool,
}
